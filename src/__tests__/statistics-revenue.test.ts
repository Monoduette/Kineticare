import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RevenueChart } from '../components/admin/RevenueChart'
import { StatisticsReport } from '../components/admin/StatisticsReport'
import { shouldWrapAdminChrome } from '../lib/admin/custom-view-auth'
import {
  STATISTICS_ACCESS_DENIED_MESSAGE,
  aggregateCourseRevenue,
  aggregateMonthlyRevenue,
  aggregateOrderFunnel,
  buildOrderFunnelFromCounts,
  buildRevenueReport,
  canAccessStatistics,
  formatHuf,
  formatMonthShort,
  FUNNEL_STATUSES,
  orderMonthKey,
  type OrderFunnelCounts,
  type RevenueOrderInput,
} from '../lib/statistics/revenue'

/**
 * T-013 statisztika-aggregátor — tiszta adatok, nincs DB, nincs hálózat.
 *
 * A Payload custom view egyetlen védelme a szerepkör-kapu; azt is itt
 * ellenőrizzük (be nem jelentkezett / customer / staff).
 */

const NOW = new Date('2026-08-20T12:00:00Z')

function paid(
  overrides: Partial<RevenueOrderInput> & Pick<RevenueOrderInput, 'createdAt'>,
): RevenueOrderInput {
  return {
    status: 'paid',
    invoiceCompletionDate: null,
    totalHuf: null,
    items: [],
    ...overrides,
  }
}

describe('canAccessStatistics — a nézet egyetlen védelme', () => {
  it('be nem jelentkezett látogató (null) NEM fér hozzá', () => {
    expect(canAccessStatistics(null)).toBe(false)
    expect(canAccessStatistics(undefined)).toBe(false)
  })

  it('customer NEM fér hozzá', () => {
    expect(canAccessStatistics({ role: 'customer' })).toBe(false)
  })

  it('staff és owner hozzáfér', () => {
    expect(canAccessStatistics({ role: 'staff' })).toBe(true)
    expect(canAccessStatistics({ role: 'owner' })).toBe(true)
  })

  it('a magyar elutasító szöveg a nézetben él', () => {
    // „Oldal", nem „nézet": a „nézet" a Payload fejlesztői szava, a munkatárs
    // oldalt lát (ui-sztenderdek §3.1 — a felhasználó szavát használjuk).
    expect(STATISTICS_ACCESS_DENIED_MESSAGE).toBe(
      'A Statisztikát csak munkatárs vagy tulajdonos nézheti meg.',
    )
  })

  it('anoním látogatónál a DefaultTemplate kimarad, bejelentkezett usernél nem', () => {
    expect(shouldWrapAdminChrome(null)).toBe(false)
    expect(shouldWrapAdminChrome(undefined)).toBe(false)
    expect(shouldWrapAdminChrome({ role: 'customer' })).toBe(true)
    expect(shouldWrapAdminChrome({ role: 'staff' })).toBe(true)
  })
})

describe('orderMonthKey — invoiceCompletionDate, tartalék createdAt, Budapest', () => {
  it('2026-01-31T23:30:00Z a 2026-02 vödörbe esik (Budapest 00:30)', () => {
    expect(
      orderMonthKey({ createdAt: '2026-01-31T23:30:00.000Z', invoiceCompletionDate: null }),
    ).toBe('2026-02')
  })

  it('az invoiceCompletionDate felülírja a createdAt-et', () => {
    expect(
      orderMonthKey({
        createdAt: '2026-01-31T23:30:00.000Z',
        invoiceCompletionDate: '2026-01-15',
      }),
    ).toBe('2026-01')
  })

  it('hibás invoiceCompletionDate → createdAt tartalék', () => {
    expect(
      orderMonthKey({
        createdAt: '2026-03-10T10:00:00.000Z',
        invoiceCompletionDate: '2026/03/10',
      }),
    ).toBe('2026-03')
  })
})

describe('aggregateMonthlyRevenue', () => {
  it('NULL audience a laikus ágba esik', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-01T10:00:00.000Z',
          items: [{ audience: null, priceHuf: 1000, quantity: 1 }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.laikusHuf).toBe(1000)
    expect(rows[0]?.szakemberHuf).toBe(0)
    expect(rows[0]?.totalHuf).toBe(1000)
  })

  it('vegyes rendelés tételenként hasad szét', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-02T10:00:00.000Z',
          items: [
            { audience: 'laikus', priceHuf: 79500, quantity: 1 },
            { audience: 'szakember', priceHuf: 120000, quantity: 1 },
          ],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.laikusHuf).toBe(79500)
    expect(rows[0]?.szakemberHuf).toBe(120000)
    expect(rows[0]?.totalHuf).toBe(199500)
    expect(rows[0]?.orderCount).toBe(1)
  })

  it('quantity > 1 → priceHuf × quantity', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-03T10:00:00.000Z',
          items: [{ audience: 'laikus', priceHuf: 1000, quantity: 3 }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.totalHuf).toBe(3000)
  })

  it('nem-paid státusz kimarad (refunded, payment_failed, cancelled)', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          status: 'refunded',
          createdAt: '2026-08-04T10:00:00.000Z',
          items: [{ audience: 'laikus', priceHuf: 5000, quantity: 1 }],
        }),
        paid({
          status: 'payment_failed',
          createdAt: '2026-08-04T11:00:00.000Z',
          items: [{ audience: 'laikus', priceHuf: 5000, quantity: 1 }],
        }),
        paid({
          status: 'cancelled',
          createdAt: '2026-08-04T12:00:00.000Z',
          items: [{ audience: 'laikus', priceHuf: 5000, quantity: 1 }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.totalHuf).toBe(0)
    expect(rows[0]?.orderCount).toBe(0)
  })

  it('üres hónap nullás sorként jelenik meg, nem hiányzik', () => {
    const rows = aggregateMonthlyRevenue([], { months: 12, now: NOW })
    expect(rows).toHaveLength(12)
    expect(rows[0]?.month).toBe('2025-09')
    expect(rows[11]?.month).toBe('2026-08')
    for (const row of rows) {
      expect(row.laikusHuf + row.szakemberHuf).toBe(row.totalHuf)
      expect(row.totalHuf).toBe(0)
      expect(row.orderCount).toBe(0)
    }
  })

  it('minden során laikusHuf + szakemberHuf === totalHuf', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-07-15T10:00:00.000Z',
          items: [
            { audience: 'laikus', priceHuf: 10, quantity: 2 },
            { audience: 'szakember', priceHuf: 7, quantity: 1 },
          ],
        }),
        paid({
          createdAt: '2026-08-01T10:00:00.000Z',
          totalHuf: 50,
          items: [],
        }),
      ],
      { months: 3, now: NOW },
    )
    for (const row of rows) {
      expect(row.laikusHuf + row.szakemberHuf).toBe(row.totalHuf)
    }
    const august = rows.find((row) => row.month === '2026-08')
    expect(august?.laikusHuf).toBe(50)
  })
})

describe('F3 — rendelés-szintű tartalék: a hiányos snapshot nem nyeli el a bevételt', () => {
  it('tétel van, de a tételekből 0 Ft jön ki → a pozitív totalHuf a bevétel (79 500 Ft, nem 0)', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-05T10:00:00.000Z',
          totalHuf: 79500,
          // A pre-T-017 rendelés item-sora: a priceHufSnapshot NULL volt,
          // a leképezés 0-t ad — a mennyiség viszont 1 (order-integrity szabály).
          items: [{ audience: 'laikus', priceHuf: 0, quantity: 1, titleSnapshot: 'Otthoni' }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.totalHuf).toBe(79500)
    expect(rows[0]?.laikusHuf).toBe(79500)
    expect(rows[0]?.orderCount).toBe(1)
    expect((rows[0]?.laikusHuf ?? 0) + (rows[0]?.szakemberHuf ?? 0)).toBe(rows[0]?.totalHuf)
  })

  it('a tartalék NEM inverz: az items: [] és a nullás tételsor UGYANAZT adja', () => {
    const itemNelkul = aggregateMonthlyRevenue(
      [paid({ createdAt: '2026-08-05T10:00:00.000Z', totalHuf: 79500, items: [] })],
      { months: 1, now: NOW },
    )
    const nullasTetellel = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-05T10:00:00.000Z',
          totalHuf: 79500,
          items: [{ audience: 'laikus', priceHuf: 0, quantity: 1, titleSnapshot: 'Otthoni' }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(itemNelkul[0]?.totalHuf).toBe(79500)
    expect(nullasTetellel[0]?.totalHuf).toBe(79500)
    expect(nullasTetellel[0]?.totalHuf).toBe(itemNelkul[0]?.totalHuf)
  })

  it('egyöntetűen szakmai tételeknél a tartalék a szakember ágba kerül', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-06T10:00:00.000Z',
          totalHuf: 120000,
          items: [{ audience: 'szakember', priceHuf: 0, quantity: 1, titleSnapshot: 'Szakmai' }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.szakemberHuf).toBe(120000)
    expect(rows[0]?.laikusHuf).toBe(0)
    expect(rows[0]?.totalHuf).toBe(120000)
  })

  it('vegyes ágú rendelésnél és tétel nélkül a laikus ág a tartalék (változatlan szabály)', () => {
    const vegyes = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-07T10:00:00.000Z',
          totalHuf: 199500,
          items: [
            { audience: 'laikus', priceHuf: 0, quantity: 1 },
            { audience: 'szakember', priceHuf: 0, quantity: 1 },
          ],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(vegyes[0]?.laikusHuf).toBe(199500)
    expect(vegyes[0]?.szakemberHuf).toBe(0)

    const ures = aggregateMonthlyRevenue(
      [paid({ createdAt: '2026-08-07T10:00:00.000Z', totalHuf: 50, items: [] })],
      { months: 1, now: NOW },
    )
    expect(ures[0]?.laikusHuf).toBe(50)
  })

  it('a tartalék csak POZITÍV rendelés-összegre lép be (0 és negatív snapshot nem mozdít)', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-08T10:00:00.000Z',
          totalHuf: 0,
          items: [{ audience: 'laikus', priceHuf: 0, quantity: 1, titleSnapshot: 'Ingyenes' }],
        }),
        paid({ createdAt: '2026-08-08T11:00:00.000Z', totalHuf: -5000, items: [] }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.totalHuf).toBe(0)
    expect(rows[0]?.orderCount).toBe(2)
  })

  it('ha a tételekből JÖN szám, az marad a forrás (a tartalék nem írja felül)', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-09T10:00:00.000Z',
          totalHuf: 999999,
          items: [{ audience: 'laikus', priceHuf: 79500, quantity: 1, titleSnapshot: 'Otthoni' }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.totalHuf).toBe(79500)
  })

  it('ŐR: pozitív totalHuf mellett nincs olyan sor, ahol orderCount > 0 és totalHuf === 0', () => {
    const esetek: RevenueOrderInput[] = [
      paid({
        createdAt: '2026-08-10T10:00:00.000Z',
        totalHuf: 79500,
        items: [{ audience: 'laikus', priceHuf: 0, quantity: 1, titleSnapshot: 'NULL ár' }],
      }),
      paid({ createdAt: '2026-08-11T10:00:00.000Z', totalHuf: 120000, items: [] }),
      paid({
        createdAt: '2026-08-12T10:00:00.000Z',
        totalHuf: 45000,
        items: [{ audience: 'szakember', priceHuf: 0, quantity: 0, titleSnapshot: 'nincs qty' }],
      }),
    ]
    for (const order of esetek) {
      const rows = aggregateMonthlyRevenue([order], { months: 1, now: NOW })
      const row = rows[0]
      expect(row?.orderCount).toBe(1)
      expect(
        row?.totalHuf === 0 && (row?.orderCount ?? 0) > 0,
        `pozitív snapshot (${String(order.totalHuf)} Ft) mellett 0 Ft-os hónap-sor`,
      ).toBe(false)
      expect(row?.totalHuf).toBe(order.totalHuf)
    }
  })
})

describe('F4 — naptárilag érvénytelen számla-dátum nem nyelheti el a rendelést', () => {
  it('orderMonthKey: a naptárilag lehetetlen dátum createdAt-tartalékra fut', () => {
    for (const rossz of ['2026-13-45', '2026-02-30', '2026-13-01', '2026-04-31', '2026-00-05']) {
      expect(
        orderMonthKey({ createdAt: '2026-03-10T10:00:00.000Z', invoiceCompletionDate: rossz }),
        rossz,
      ).toBe('2026-03')
    }
  })

  it('orderMonthKey: a VALÓDI szökőnap érvényes marad, a nem létező nem', () => {
    // 2024 szökőév, 2026 NEM (2026 % 4 = 2).
    expect(
      orderMonthKey({
        createdAt: '2024-03-10T10:00:00.000Z',
        invoiceCompletionDate: '2024-02-29',
      }),
    ).toBe('2024-02')
    expect(
      orderMonthKey({
        createdAt: '2026-03-10T10:00:00.000Z',
        invoiceCompletionDate: '2026-02-29',
      }),
    ).toBe('2026-03')
  })

  it('a rendelés a createdAt hónapjába kerül — nem esik ki a bevételből és az orderCount-ból', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-13T10:00:00.000Z',
          invoiceCompletionDate: '2026-13-45',
          totalHuf: 30000,
          items: [{ audience: 'laikus', priceHuf: 30000, quantity: 1, titleSnapshot: 'Otthoni' }],
        }),
      ],
      { months: 1, now: NOW },
    )
    expect(rows[0]?.month).toBe('2026-08')
    expect(rows[0]?.totalHuf).toBe(30000)
    expect(rows[0]?.orderCount).toBe(1)
  })

  it('a kurzus-tábla is látja az ilyen rendelést (a hónap-ablak nem ejti ki)', () => {
    const report = buildRevenueReport(
      [
        paid({
          createdAt: '2026-08-13T10:00:00.000Z',
          invoiceCompletionDate: '2026-13-45',
          totalHuf: 30000,
          items: [{ audience: 'laikus', priceHuf: 30000, quantity: 1, titleSnapshot: 'Otthoni' }],
        }),
      ],
      aggregateOrderFunnel(['paid']),
      { months: 12, now: NOW },
    )
    expect(report.totals.totalHuf).toBe(30000)
    expect(report.totals.orderCount).toBe(1)
    expect(report.courses.map((row) => row.sku)).toEqual(['Otthoni'])
  })

  it('érvénytelen `now` nem borítja fel a jelentést (listMonthKeys nem dob)', () => {
    const invalidNow = new Date('nem-datum')
    expect(() =>
      buildRevenueReport([], aggregateOrderFunnel(['paid']), { months: 12, now: invalidNow }),
    ).not.toThrow()
    const report = buildRevenueReport([], aggregateOrderFunnel(['paid']), {
      months: 12,
      now: invalidNow,
    })
    expect(report.months).toEqual([])
    expect(report.totals.totalHuf).toBe(0)
    // A tölcsér a hónap-ablaktól függetlenül számol, tehát megmarad.
    expect(report.funnel.paid).toBe(1)
  })
})

describe('kurzus-bontás és tölcsér', () => {
  it('kurzusonként összegzi a bevételt, az ingyenes tételt külön számolja', () => {
    const rows = aggregateCourseRevenue([
      paid({
        createdAt: '2026-08-01T10:00:00.000Z',
        items: [
          { audience: 'laikus', priceHuf: 79500, quantity: 1, titleSnapshot: 'Otthoni' },
          { audience: 'laikus', priceHuf: 0, quantity: 1, titleSnapshot: 'SOS ingyenes' },
        ],
      }),
    ])
    expect(rows[0]?.sku).toBe('Otthoni')
    expect(rows[0]?.revenueHuf).toBe(79500)
    expect(rows.find((row) => row.sku === 'SOS ingyenes')?.freeItemCount).toBe(1)
  })

  /**
   * ŐR — A SORFEJLÉC A KURZUS CÍME (H7, 2026-08-21-i audit).
   *
   * A bevétel-tábla sorfejléce korábban a sku volt, miközben ugyanaz a kurzus
   * a haladás-táblában a címével szerepelt: egy lapon két néven futott ugyanaz
   * a termék (WCAG 2.2 SC 3.2.4 Consistent Identification). A csoportosítás
   * viszont MARAD a sku-snapshoton, mert a cím változhat, a snapshot nem.
   */
  it('a kurzus-sor CÍMET kap, de sku szerint csoportosít', () => {
    const rows = aggregateCourseRevenue([
      paid({
        createdAt: '2026-08-01T10:00:00.000Z',
        items: [
          {
            audience: 'laikus',
            priceHuf: 79500,
            quantity: 1,
            titleSnapshot: 'kez-rehab-otthon-alap',
            displayTitle: 'Kézrehabilitáció otthon: az alapok',
          },
        ],
      }),
      paid({
        createdAt: '2026-07-01T10:00:00.000Z',
        items: [
          {
            audience: 'laikus',
            priceHuf: 79500,
            quantity: 1,
            titleSnapshot: 'kez-rehab-otthon-alap',
            displayTitle: 'Kézrehabilitáció otthon: az alapok',
          },
        ],
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Kézrehabilitáció otthon: az alapok')
    expect(rows[0]?.sku).toBe('kez-rehab-otthon-alap')
    expect(rows[0]?.revenueHuf).toBe(159000)
  })

  it('törölt terméknél (nincs populált cím) a sku marad a sor neve', () => {
    const rows = aggregateCourseRevenue([
      paid({
        createdAt: '2026-08-01T10:00:00.000Z',
        items: [{ audience: 'laikus', priceHuf: 1000, quantity: 1, titleSnapshot: 'regi-kurzus' }],
      }),
    ])
    expect(rows[0]?.title).toBe('regi-kurzus')
    expect(rows[0]?.sku).toBe('regi-kurzus')
  })

  it('a tölcsér a státuszokat számolja, a refunded-et is, de az nem bevétel', () => {
    const funnel = aggregateOrderFunnel(['paid', 'paid', 'payment_failed', 'refunded', 'created'])
    expect(funnel.paid).toBe(2)
    expect(funnel.paymentFailed).toBe(1)
    expect(funnel.refunded).toBe(1)
    expect(funnel.created).toBe(1)
    expect(funnel.total).toBe(5)
  })

  it('a kurzus-tábla ugyanarra a 12 hónapra vonatkozik, a tölcsér a teljes állományt számolja', () => {
    const report = buildRevenueReport(
      [
        paid({
          createdAt: '2024-01-10T10:00:00.000Z',
          items: [
            { audience: 'laikus', priceHuf: 10000, quantity: 1, titleSnapshot: 'Régi kurzus' },
          ],
        }),
        paid({
          createdAt: '2026-08-01T10:00:00.000Z',
          items: [
            { audience: 'laikus', priceHuf: 5000, quantity: 1, titleSnapshot: 'Friss kurzus' },
          ],
        }),
      ],
      aggregateOrderFunnel(['paid', 'paid', 'payment_failed']),
      { months: 12, now: NOW },
    )
    expect(report.courses.map((row) => row.sku)).toEqual(['Friss kurzus'])
    expect(report.totals.totalHuf).toBe(5000)
    expect(report.funnel.paid).toBe(2)
    expect(report.funnel.paymentFailed).toBe(1)
  })
})

/**
 * F8 (2026-08-21-i vizsgálat) — a tölcsér KÉSZ darabszámokból is felépíthető,
 * nem csak státusz-listából. A két útnak PONTOSAN ugyanazt kell adnia, mert
 * ugyanaz a státusz→mező tábla hajtja őket.
 */
describe('F8 — tölcsér darabszámokból', () => {
  function counts(entries: Record<string, number>): ReadonlyMap<string, number> {
    return new Map(Object.entries(entries))
  }

  it('a nevesített hat státuszt a saját mezőjébe teszi', () => {
    const funnel = buildOrderFunnelFromCounts(
      counts({
        created: 3,
        payment_pending: 5,
        paid: 100,
        payment_failed: 7,
        cancelled: 2,
        refunded: 1,
      }),
      118,
    )
    expect(funnel).toEqual({
      created: 3,
      paymentPending: 5,
      paid: 100,
      paymentFailed: 7,
      cancelled: 2,
      refunded: 1,
      other: 0,
      total: 118,
    })
  })

  it('az `other` a teljes darabszám és a nevesített státuszok különbsége', () => {
    // 118 nevesített + 12 ismeretlen (régi enum-érték, importból maradt sor).
    const funnel = buildOrderFunnelFromCounts(
      counts({
        created: 3,
        payment_pending: 5,
        paid: 100,
        payment_failed: 7,
        cancelled: 2,
        refunded: 1,
      }),
      130,
    )
    expect(funnel.other).toBe(12)
    expect(funnel.total).toBe(130)
    expect(
      funnel.created +
        funnel.paymentPending +
        funnel.paid +
        funnel.paymentFailed +
        funnel.cancelled +
        funnel.refunded +
        funnel.other,
    ).toBe(funnel.total)
  })

  it('az `other` NEM megy negatívba, ha a hét lekérdezés között beérkezik egy rendelés', () => {
    // A `total` korábban futott le, mint a `paid` számlálója → a nevesített
    // összeg (101) meghaladja a total-t (100).
    const funnel = buildOrderFunnelFromCounts(counts({ paid: 101 }), 100)
    expect(funnel.other).toBe(0)
    // A `total` az marad, amit az adatbázis mondott — nem gyártunk rá becslést.
    expect(funnel.total).toBe(100)
  })

  it('a hiányzó, negatív, tört és nem véges darabszám 0-ra esik', () => {
    const funnel = buildOrderFunnelFromCounts(
      counts({ created: -5, paid: 2.7, payment_failed: Number.NaN }),
      10,
    )
    expect(funnel.created).toBe(0)
    expect(funnel.paid).toBe(2)
    expect(funnel.paymentFailed).toBe(0)
    expect(funnel.cancelled).toBe(0)
    expect(funnel.other).toBe(8)
  })

  it('a listás és a darabszámos út UGYANAZT adja (nincs két külön leképezés)', () => {
    const lista = [
      'created',
      'payment_pending',
      'paid',
      'paid',
      'payment_failed',
      'cancelled',
      'refunded',
      'ismeretlen_statusz',
    ]
    const listabol = aggregateOrderFunnel(lista)
    const szamokbol = buildOrderFunnelFromCounts(
      counts({
        created: 1,
        payment_pending: 1,
        paid: 2,
        payment_failed: 1,
        cancelled: 1,
        refunded: 1,
      }),
      lista.length,
    )
    expect(szamokbol).toEqual(listabol)
    expect(listabol.other).toBe(1)
  })

  it('a FUNNEL_STATUSES pontosan a hat nevesített státusz, életút-sorrendben', () => {
    expect(FUNNEL_STATUSES).toEqual([
      'created',
      'payment_pending',
      'paid',
      'payment_failed',
      'cancelled',
      'refunded',
    ])
  })

  it('a buildRevenueReport kész darabszámokat is elfogad, és nem aliasolja a bemenetet', () => {
    const forras: OrderFunnelCounts = {
      created: 1,
      paymentPending: 2,
      paid: 3,
      paymentFailed: 4,
      cancelled: 5,
      refunded: 6,
      other: 7,
      total: 28,
    }
    const report = buildRevenueReport([], forras, { months: 1, now: NOW })
    expect(report.funnel).toEqual(forras)
    report.funnel.paid = 999
    expect(forras.paid).toBe(3)
  })
})

describe('StatisticsReport + RevenueChart — a számok a táblázatban is ott vannak', () => {
  it('a jelentés kiírja a havi összegeket magyar ezres tagolással', () => {
    const report = buildRevenueReport(
      [
        paid({
          createdAt: '2026-08-01T10:00:00.000Z',
          items: [{ audience: 'laikus', priceHuf: 79500, quantity: 1, titleSnapshot: 'Otthoni' }],
        }),
      ],
      aggregateOrderFunnel(['paid', 'payment_failed']),
      { months: 1, now: NOW },
    )
    const html = renderToStaticMarkup(createElement(StatisticsReport, { report }))
    expect(html).toContain('Statisztika')
    expect(html).toContain(formatHuf(79500))
    expect(html).toContain('Otthoni')
    expect(html).toContain('Sikertelen fizetés')
    expect(html).toContain('ugyanabban a 12 hónapban')
  })

  it('a gyökér a kc-adminstat márka-scope-ot viseli, eyebrow-sorral (tulajdonosi döntés, 2026-08-20)', () => {
    const report = buildRevenueReport([], aggregateOrderFunnel([]), { months: 1, now: NOW })
    const html = renderToStaticMarkup(createElement(StatisticsReport, { report }))
    // A custom.scss márka-rétege ezen a classon keresztül hat — nélküle a
    // nézet a Payload-kinézetre esne vissza, ezért a jelenléte szerkezeti
    // követelmény.
    expect(html).toContain('class="kc-adminstat"')
    // A h1 fölötti eyebrow a landing felvezető-nyelvének színét és vonalát
    // viszi, de mondatkezdő írással: verzál és ritkított betűköz nélkül
    // (admin-audit K31, 2026-09-22; admin-szótár: verzál helyett mondatkezdő
    // írás).
    expect(html).toContain('Kimutatások')
    const eyebrowStilus = /<p class="kc-adminstat__eyebrow" style="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(eyebrowStilus).not.toBe('')
    expect(eyebrowStilus).not.toMatch(/text-transform/)
    expect(eyebrowStilus).not.toMatch(/letter-spacing/)
    // Az inline stílusok a márka-tokenre hivatkoznak, Payload-tartalékkal.
    expect(html).toContain('--kc-as-')
    expect(html).toContain('--theme-')
  })

  it('az SVG oszlopdiagram role=img és aria-label mellett a táblázat is megjelenik', () => {
    const rows = aggregateMonthlyRevenue([], { months: 1, now: NOW })
    const svg = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label=')
    expect(svg).toContain('<rect')
  })
})

describe('formatMonthShort — rövid magyar hónap-tick a diagramhoz', () => {
  it('rövid magyar hónapnevet ad', () => {
    expect(formatMonthShort('2025-09')).toBe('szept.')
    expect(formatMonthShort('2026-01')).toBe('jan.')
    expect(formatMonthShort('2026-08')).toBe('aug.')
  })

  it('értelmezhetetlen kulcsnál magát a kulcsot adja vissza', () => {
    expect(formatMonthShort('nem-honap')).toBe('nem-honap')
    expect(formatMonthShort('2026-13')).toBe('2026-13')
  })
})

describe('RevenueChart — jelmagyarázat, rövid tickek, Y-tengely', () => {
  it('a jelmagyarázat szöveggel nevezi meg a két ágat (WCAG 1.4.1)', () => {
    const rows = aggregateMonthlyRevenue([], { months: 12, now: NOW })
    const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(html).toContain('Otthoni')
    expect(html).toContain('Szakmai')
  })

  it('az X-tengely tickje rövid hónap, évszám az első oszlopon és januárnál', () => {
    const rows = aggregateMonthlyRevenue([], { months: 12, now: NOW })
    const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(html).toContain('>szept.<')
    expect(html).toContain('>jan.<')
    // Évszám „landmark" felirat: az ablak eleje (2025) és az évváltás (2026).
    expect(html).toContain('>2025<')
    expect(html).toContain('>2026<')
    // A hosszú hónapcímke csak az aria-labelben él, tickként nem jelenik meg.
    expect(html).not.toContain('>2025. szeptember<')
  })

  it('az Y-tengelyen legalább 3 tick van magyar Ft-formátummal', () => {
    const rows = aggregateMonthlyRevenue(
      [
        paid({
          createdAt: '2026-08-01T10:00:00.000Z',
          items: [
            { audience: 'laikus', priceHuf: 79500, quantity: 1 },
            { audience: 'szakember', priceHuf: 120000, quantity: 1 },
          ],
        }),
      ],
      { months: 12, now: NOW },
    )
    const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(html).toContain('>0 Ft<')
    expect(html).toContain('>60 e Ft<')
    expect(html).toContain('>120 e Ft<')
  })

  it('a role=img és az aria-label a jelmagyarázattal együtt is megmarad', () => {
    const rows = aggregateMonthlyRevenue([], { months: 12, now: NOW })
    const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label=')
    expect(html).toContain('<rect')
  })

  it('a diagram saját konténerében görög, a viewBox-szöveg nem zsugorodik 320 px-re', () => {
    const rows = aggregateMonthlyRevenue([], { months: 12, now: NOW })
    const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(html).toContain('overflow-x:auto')
    // A 720 a viewBox natív szélessége, a --kc-as-px a 13-as Payload-
    // gyökérhez igazított rem-egység (custom.scss). A `max()` alsó korlát
    // AZÉRT kell, mert a Payload 1024 px alatt 12 px-re viszi a gyökeret —
    // enélkül a rajzolat 0,9231-szeresére kicsinyedne, a tick 11,08 px-re.
    // FIGYELEM: ez csak a kifejezés ALAKJÁT rögzíti. A tényleges tick-méretet
    // SZÁMOLÓ őr méri: src/__tests__/statisztika-diagram-tick.test.ts — egy
    // string-egyezés nem tud különbséget tenni 12,00 és 11,08 px között, és
    // pontosan ezért engedte át ez az állítás a #126 regresszióját.
    expect(html).toContain('min-width:max(720px, calc(720 * var(--kc-as-px, 1px)))')
  })

  it('a diagram görgetője billentyűzetről fókuszálható és nevesített (WCAG 2.1.1, 4.1.2)', () => {
    // axe: scrollable-region-focusable —
    // https://dequeuniversity.com/rules/axe/4.12/scrollable-region-focusable
    const rows = aggregateMonthlyRevenue([], { months: 12, now: NOW })
    const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
    expect(html).toContain('role="region"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="Havi bevétel oszlopdiagram"')
  })
})

describe('kc-adminstat márka-CSS őrök — fókusz, link-állapotok, méret-egység', () => {
  const brandCss = readFileSync(
    join(process.cwd(), 'src', 'app', '(payload)', 'custom.scss'),
    'utf8',
  )

  it('a linknek explicit aláhúzása van (WCAG 1.4.1: a link színe a törzsével azonos)', () => {
    // A link ink-színű, tehát az aláhúzás az egyetlen nem-szín jelzés —
    // GOV.UK: https://design-system.service.gov.uk/styles/links/
    const linkRule = brandCss.match(/\.kc-adminstat a \{[^}]*\}/)?.[0]
    expect(linkRule).toBeDefined()
    expect(linkRule).toContain('text-decoration: underline')
  })

  it('a fókuszgyűrű a linkre ÉS a görgethető régiókra is definiált (WCAG 2.4.7)', () => {
    // Az inline stílus nem tud :focus-visible-t, ezért ennek a custom.scss-ben
    // KELL élnie; a régió-szelektor az axe scrollable-region-focusable
    // szabályhoz felvett tabindexes wrappereket fedi (2026-08-20-i audit).
    expect(brandCss).toContain('.kc-adminstat a:focus-visible')
    expect(brandCss).toContain(".kc-adminstat [role='region'][tabindex]:focus-visible")
    const focusRule = brandCss.match(/:focus-visible \{[^}]*\}/)?.[0]
    expect(focusRule).toContain('outline: 2px solid var(--kc-as-focus)')
  })

  it('a link active állapota definiált (termektervezes skill 4. pont: hét állapot)', () => {
    expect(brandCss).toContain('.kc-adminstat a:active')
  })

  it('a méret-tokenek a --kc-as-px rem-egységgel mennek (NN/g + WCAG C14)', () => {
    // Tulajdonosi döntés (2026-08-20): a méretek REM-alapúak, a 13-as
    // Payload-gyökérhez igazított közös egységgel — a szövegméret kövesse a
    // gyökér skálázását (NN/g, Let Users Control Font Size:
    // https://www.nngroup.com/articles/let-users-control-font-size/;
    // WCAG C14: https://www.w3.org/WAI/WCAG22/Techniques/css/C14).
    // Az egység definíciója kötelező, és a méret-tokenek NYERS px-értéket
    // nem hordozhatnak (a kommentek magyarázó hivatkozásai nem számítanak).
    const uncommented = brandCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(uncommented).toContain('--kc-as-px: calc(1rem / 13)')
    const tokenChunks = uncommented.match(/--kc-as-(space|radius|font-cim)[\w-]*:[^;]+;/g) ?? []
    expect(tokenChunks.length).toBeGreaterThanOrEqual(9)
    for (const chunk of tokenChunks) {
      expect(chunk, `nyers px-es méret-token: ${chunk.trim()}`).not.toMatch(/[\d.]px/)
      expect(chunk, `nem a közös egységgel megy: ${chunk.trim()}`).toContain('var(--kc-as-px)')
    }
    // A törzs betűmérete is az egységgel megy (16 tervezési px).
    expect(uncommented).toContain('font-size: calc(16 * var(--kc-as-px))')
  })
})
