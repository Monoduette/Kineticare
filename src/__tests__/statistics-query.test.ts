import { describe, expect, it, vi } from 'vitest'

import {
  mapOrderDocToRevenueInput,
  queryRevenueReport,
  readStatisticsPages,
  STATISTICS_ORDER_MAX,
  STATISTICS_ORDER_PAGE_SIZE,
  type StatisticsOrderDoc,
} from '../lib/statistics/query'

/**
 * A lekérdezés-leképezés: depth=1 audience, a refunds mező ki van zárva.
 * Mockolt Payload.find — nincs valódi DB.
 */

describe('mapOrderDocToRevenueInput', () => {
  it('a beágyazott product.audience-t tételenként átadja', () => {
    const mapped = mapOrderDocToRevenueInput({
      status: 'paid',
      createdAt: '2026-08-01T10:00:00.000Z',
      invoiceCompletionDate: '2026-08-01',
      totalHufSnapshot: 199500,
      items: [
        {
          product: { id: 1, audience: 'laikus' },
          quantity: 1,
          titleSnapshot: 'Otthoni',
          priceHufSnapshot: 79500,
        },
        {
          product: { id: 2, audience: 'szakember' },
          quantity: 1,
          titleSnapshot: 'Szakmai',
          priceHufSnapshot: 120000,
        },
      ],
    })
    expect(mapped.items[0]?.audience).toBe('laikus')
    expect(mapped.items[1]?.audience).toBe('szakember')
    expect(mapped.totalHuf).toBe(199500)
  })

  it('ha a product csak azonosító, az audience undefined (laikus fallback)', () => {
    const mapped = mapOrderDocToRevenueInput({
      status: 'paid',
      createdAt: '2026-08-01T10:00:00.000Z',
      items: [{ product: 12, quantity: 1, priceHufSnapshot: 1000, titleSnapshot: 'X' }],
    })
    expect(mapped.items[0]?.audience).toBeUndefined()
  })
})

describe('queryRevenueReport', () => {
  it('csak a kért mezőket kéri, a refunds kulcs nincs a selectben', async () => {
    const paidDoc: StatisticsOrderDoc = {
      status: 'paid',
      createdAt: '2026-08-10T10:00:00.000Z',
      totalHufSnapshot: 1000,
      items: [
        {
          product: { audience: 'laikus' },
          quantity: 1,
          priceHufSnapshot: 1000,
          titleSnapshot: 'Otthoni',
        },
      ],
    }
    const find = vi.fn(async (args: { collection: string; where?: unknown }) =>
      args.collection === 'products'
        ? { docs: [], hasNextPage: false, totalDocs: 0 }
        : { docs: [paidDoc], hasNextPage: false, totalDocs: 1 },
    )
    const count = vi.fn(async (args: { where?: unknown }) => ({
      totalDocs: statusEqualsOf(args.where) === null ? 2 : 1,
    }))

    const report = await queryRevenueReport({
      payload: { find, count } as never,
      now: new Date('2026-08-20T12:00:00Z'),
      months: 1,
    })

    expect(find).toHaveBeenCalled()
    for (const call of find.mock.calls) {
      const args = call[0] as { select?: Record<string, unknown>; depth?: number }
      expect(args.select).toBeDefined()
      expect(args.select).not.toHaveProperty('refunds')
      expect(args.select).not.toHaveProperty('customerSnapshot')
      expect(args.select).not.toHaveProperty('ipAddress')
    }
    const paidCall = find.mock.calls.find((call) => {
      const args = call[0] as { where?: unknown; depth?: number }
      return args.where !== undefined
    })
    expect((paidCall?.[0] as { depth?: number }).depth).toBe(1)
    expect(report.totals.totalHuf).toBe(1000)
    expect(report.funnel.paid).toBe(1)
    expect(report.funnel.paymentFailed).toBe(1)
    // A tölcsér `count`-ból jön, tehát a `select` szivárgás-őre ott nem
    // értelmezhető — helyette az számít, hogy a count NEM kér dokumentumot.
    for (const call of count.mock.calls) {
      const args = call[0] as { select?: unknown; depth?: unknown; limit?: unknown }
      expect(args.select).toBeUndefined()
      expect(args.depth).toBeUndefined()
      expect(args.limit).toBeUndefined()
    }
  })

  it('szám-product és { id } stub audience-ét products.find pótolja, id is a selectben van', async () => {
    const paidDocs: StatisticsOrderDoc[] = [
      {
        status: 'paid',
        createdAt: '2026-08-10T10:00:00.000Z',
        items: [
          { product: 41, quantity: 1, priceHufSnapshot: 1000, titleSnapshot: 'Szám' },
          { product: { id: 42 }, quantity: 1, priceHufSnapshot: 2000, titleSnapshot: 'Stub' },
          {
            product: { id: 43, audience: null },
            quantity: 1,
            priceHufSnapshot: 3000,
            titleSnapshot: 'Explicit null',
          },
        ],
      },
    ]
    const find = vi.fn(async (args: { collection: string; where?: unknown }) => {
      if (args.collection === 'products') {
        return {
          docs: [
            { id: 41, audience: 'szakember' },
            { id: 42, audience: 'szakember' },
          ],
        }
      }
      return { docs: paidDocs, hasNextPage: false, totalDocs: 1 }
    })
    const count = vi.fn(async () => ({ totalDocs: 1 }))

    const report = await queryRevenueReport({
      payload: { find, count } as never,
      now: new Date('2026-08-20T12:00:00Z'),
      months: 1,
    })

    const productCall = find.mock.calls.find((call) => {
      const args = call[0] as { collection?: string }
      return args.collection === 'products'
    })
    expect(productCall).toBeDefined()
    const productArgs = productCall?.[0] as {
      select?: Record<string, unknown>
      where?: { id?: { in?: number[] } }
    }
    // A cím ugyanabban a batchelt hívásban jön, mint az ág: a bevétel-tábla
    // sorfejléce a kurzus CÍME, nem a sku (H7, 2026-08-21-i audit).
    expect(productArgs.select).toEqual({ id: true, audience: true, displayTitle: true })
    expect(productArgs.where?.id?.in?.sort()).toEqual([41, 42])
    expect(report.totals.szakemberHuf).toBe(3000)
    expect(report.totals.laikusHuf).toBe(3000)
  })
})

/**
 * F2/F3 őrök (2026-08-21-i vizsgálat) — mockolt Payload.find, nincs hálózat.
 *
 * A mock RÖGZÍTI a find-argumentumokat: a lapozott lekérdezések rendezése és
 * a hiányos item-snapshotok kezelése így mérhető, nem hiedelem.
 */

interface RecordedFindArgs {
  collection?: string
  where?: unknown
  page?: number
  limit?: number
  sort?: unknown
  select?: Record<string, unknown>
  depth?: number
}

interface RecordedCountArgs {
  collection?: string
  where?: unknown
  overrideAccess?: boolean
}

/** A `{ status: { equals: 'paid' } }` alakú szűrőből kiolvasott státusz. */
function statusEqualsOf(where: unknown): string | null {
  if (typeof where !== 'object' || where === null) {
    return null
  }
  const status = (where as { status?: unknown }).status
  if (typeof status !== 'object' || status === null) {
    return null
  }
  const equals = (status as { equals?: unknown }).equals
  return typeof equals === 'string' ? equals : null
}

/**
 * Payload-mock `find` + `count` párral.
 *
 * A `statuses` lista a TELJES rendelésállomány státuszait írja le: a `count`
 * ebből számol (szűrő nélkül az összeset, státusz-szűrővel a darabszámot). A
 * `find` tölcsér-ága (orders, `where` nélkül) SZÁNDÉKOSAN életben marad, hogy
 * az F8 őre mérni tudja: oda a javítás után egyetlen hívás sem megy.
 */
function makePayloadMock(orderDocs: StatisticsOrderDoc[], statuses: string[] = ['paid']) {
  const calls: RecordedFindArgs[] = []
  const countCalls: RecordedCountArgs[] = []
  const find = vi.fn(async (args: RecordedFindArgs) => {
    calls.push(args)
    if (args.collection === 'products') {
      return { docs: [], hasNextPage: false, totalDocs: 0 }
    }
    if (args.where !== undefined) {
      return { docs: orderDocs, hasNextPage: false, totalDocs: orderDocs.length }
    }
    return {
      docs: statuses.map((status) => ({ status })),
      hasNextPage: false,
      totalDocs: statuses.length,
    }
  })
  const count = vi.fn(async (args: RecordedCountArgs) => {
    countCalls.push(args)
    const wanted = statusEqualsOf(args.where)
    return {
      totalDocs:
        wanted === null ? statuses.length : statuses.filter((status) => status === wanted).length,
    }
  })
  return { find, count, calls, countCalls }
}

/** A lapozott (page-es) hívások rendezési útvonalai. */
function sortPathsOf(args: RecordedFindArgs): string[] {
  if (typeof args.sort === 'string') {
    return [args.sort]
  }
  if (Array.isArray(args.sort)) {
    return args.sort.filter((entry): entry is string => typeof entry === 'string')
  }
  return []
}

describe('F2 — a lapozott order-lekérdezéseknek determinisztikus rendezésük van', () => {
  it('MINDEN lapozott statisztika-lekérdezésen van sort, egyedi tiebreakerrel', async () => {
    const { find, count, calls } = makePayloadMock([
      {
        status: 'paid',
        createdAt: '2026-08-10T10:00:00.000Z',
        totalHufSnapshot: 1000,
        items: [{ product: { audience: 'laikus' }, quantity: 1, priceHufSnapshot: 1000 }],
      },
    ])

    await queryRevenueReport({
      payload: { find, count } as never,
      now: new Date('2026-08-20T12:00:00Z'),
      months: 1,
    })

    // A lapozott hívás ismertetőjegye a `page` — a products-hydratáció
    // `pagination: false`-szal, zárt id-halmazra megy, azt nem lapozzuk.
    // Az F8 óta EGY lapozott lekérdezés van: a fizetett rendeléseké. A
    // tölcsér `payload.count`-tal megy, ott nincs mit rendezni.
    const paged = calls.filter((args) => typeof args.page === 'number')
    expect(paged).toHaveLength(1)
    for (const args of paged) {
      const paths = sortPathsOf(args)
      expect(
        paths.length,
        `sort nélküli lapozott lekérdezés (${String(args.collection)}) — a lapok határán sor duplázódhat vagy kieshet`,
      ).toBeGreaterThan(0)
      const tiebreaker = paths[paths.length - 1]?.replace(/^-/, '')
      expect(
        tiebreaker,
        `a rendezés utolsó kulcsa nem egyedi (${paths.join(', ')}) — azonos createdAt-nál nincs holtverseny-döntő`,
      ).toBe('id')
    }
  })

  it('a fizetett lekérdezés `-createdAt, id` szerint megy (csonkolásnál a friss sorok maradnak)', async () => {
    const { find, count, calls } = makePayloadMock([])
    await queryRevenueReport({
      payload: { find, count } as never,
      now: new Date('2026-08-20T12:00:00Z'),
      months: 1,
    })
    const paged = calls.filter((args) => typeof args.page === 'number')
    expect(paged).toHaveLength(1)
    for (const args of paged) {
      expect(sortPathsOf(args)).toEqual(['-createdAt', 'id'])
    }
  })
})

describe('F3 — hiányos item-snapshot nem nyelheti el a bevételt', () => {
  const NOW = new Date('2026-08-20T12:00:00Z')

  it('1. eset: items megvan, priceHufSnapshot NULL, totalHufSnapshot 79500 → 79 500 Ft, nem 0', async () => {
    const { find, count } = makePayloadMock([
      {
        status: 'paid',
        createdAt: '2026-08-10T10:00:00.000Z',
        totalHufSnapshot: 79500,
        items: [
          {
            product: { id: 1, audience: 'laikus' },
            quantity: 1,
            titleSnapshot: 'Otthoni',
            priceHufSnapshot: null,
          },
        ],
      },
    ])
    const report = await queryRevenueReport({
      payload: { find, count } as never,
      now: NOW,
      months: 1,
    })
    expect(report.totals.totalHuf).toBe(79500)
    expect(report.totals.orderCount).toBe(1)
    expect(report.totals.laikusHuf + report.totals.szakemberHuf).toBe(report.totals.totalHuf)
    // A kurzus-bontásban SZÁNDÉKOSAN nem keletkezik kitalált 79 500 Ft-os sor:
    // a rendelés-szintű összeg nem tudja, melyik kurzusra jutott.
    expect(report.courses.find((row) => row.sku === 'Otthoni')?.revenueHuf).toBe(0)
  })

  it('2. eset: ugyanaz a rendelés items: []-lel UGYANAZT a számot adja (a tartalék nem inverz)', async () => {
    const kozos = {
      status: 'paid',
      createdAt: '2026-08-10T10:00:00.000Z',
      totalHufSnapshot: 79500,
    } as const
    const { find: findItemekkel, count: countItemekkel } = makePayloadMock([
      {
        ...kozos,
        items: [
          {
            product: { id: 1, audience: 'laikus' },
            quantity: 1,
            titleSnapshot: 'Otthoni',
            priceHufSnapshot: null,
          },
        ],
      },
    ])
    const { find: findItemNelkul, count: countItemNelkul } = makePayloadMock([
      { ...kozos, items: [] },
    ])

    const itemekkel = await queryRevenueReport({
      payload: { find: findItemekkel, count: countItemekkel } as never,
      now: NOW,
      months: 1,
    })
    const itemNelkul = await queryRevenueReport({
      payload: { find: findItemNelkul, count: countItemNelkul } as never,
      now: NOW,
      months: 1,
    })

    expect(itemekkel.totals.totalHuf).toBe(79500)
    expect(itemNelkul.totals.totalHuf).toBe(79500)
    expect(itemekkel.totals.totalHuf).toBe(itemNelkul.totals.totalHuf)
    expect(itemekkel.totals.orderCount).toBe(itemNelkul.totals.orderCount)
  })

  it('3. eset: van ár, nincs quantity → a pénztár szabálya szerint 1 db', async () => {
    const { find, count } = makePayloadMock([
      {
        status: 'paid',
        createdAt: '2026-08-10T10:00:00.000Z',
        totalHufSnapshot: 79500,
        items: [
          {
            product: { id: 1, audience: 'laikus' },
            titleSnapshot: 'Otthoni',
            priceHufSnapshot: 79500,
          },
        ],
      },
    ])
    const report = await queryRevenueReport({
      payload: { find, count } as never,
      now: NOW,
      months: 1,
    })
    expect(report.totals.totalHuf).toBe(79500)
    // Itt a TÉTELBŐL jön a szám, tehát a kurzus-bontás is megkapja.
    expect(report.courses.find((row) => row.sku === 'Otthoni')?.revenueHuf).toBe(79500)
  })

  it('a mapper a hiányzó / nem pozitív mennyiséget 1-nek veszi (order-integrity szabály)', () => {
    const mapped = mapOrderDocToRevenueInput({
      status: 'paid',
      createdAt: '2026-08-10T10:00:00.000Z',
      items: [
        { product: { audience: 'laikus' }, priceHufSnapshot: 1000, titleSnapshot: 'nincs qty' },
        {
          product: { audience: 'laikus' },
          quantity: null,
          priceHufSnapshot: 1000,
          titleSnapshot: 'null qty',
        },
        {
          product: { audience: 'laikus' },
          quantity: 0,
          priceHufSnapshot: 1000,
          titleSnapshot: 'nulla qty',
        },
        {
          product: { audience: 'laikus' },
          quantity: -3,
          priceHufSnapshot: 1000,
          titleSnapshot: 'negatív qty',
        },
        {
          product: { audience: 'laikus' },
          quantity: 3,
          priceHufSnapshot: 1000,
          titleSnapshot: 'három',
        },
      ],
    })
    expect(mapped.items.map((item) => item.quantity)).toEqual([1, 1, 1, 1, 3])
  })

  it('ŐR: pozitív totalHufSnapshot mellett SOHA nem lehet orderCount > 0 és totalHuf === 0', async () => {
    const esetek: StatisticsOrderDoc[][] = [
      // NULL ár + meglévő tétel
      [
        {
          status: 'paid',
          createdAt: '2026-08-10T10:00:00.000Z',
          totalHufSnapshot: 79500,
          items: [{ product: { audience: 'laikus' }, quantity: 1, priceHufSnapshot: null }],
        },
      ],
      // tétel nélkül
      [
        {
          status: 'paid',
          createdAt: '2026-08-11T10:00:00.000Z',
          totalHufSnapshot: 120000,
          items: [],
        },
      ],
      // hiányzó quantity ÉS hiányzó ár
      [
        {
          status: 'paid',
          createdAt: '2026-08-12T10:00:00.000Z',
          totalHufSnapshot: 45000,
          items: [{ product: { audience: 'szakember' }, titleSnapshot: 'Szakmai' }],
        },
      ],
      // naptárilag érvénytelen számla-dátum (F4) — a createdAt hónapjába esik
      [
        {
          status: 'paid',
          createdAt: '2026-08-13T10:00:00.000Z',
          invoiceCompletionDate: '2026-13-45',
          totalHufSnapshot: 30000,
          items: [{ product: { audience: 'laikus' }, quantity: 1, priceHufSnapshot: 30000 }],
        },
      ],
    ]

    for (const docs of esetek) {
      const { find, count } = makePayloadMock(docs)
      const report = await queryRevenueReport({
        payload: { find, count } as never,
        now: NOW,
        months: 1,
      })
      const snapshotOsszeg = docs.reduce((sum, doc) => sum + (doc.totalHufSnapshot ?? 0), 0)
      expect(report.totals.orderCount, JSON.stringify(docs)).toBe(1)
      expect(
        report.totals.totalHuf,
        `pozitív snapshot (${snapshotOsszeg} Ft) mellett 0 Ft-os riport: ${JSON.stringify(docs)}`,
      ).toBe(snapshotOsszeg)
    }
  })
})

describe('readStatisticsPages — csonkolás csak ha maradt sor', () => {
  it('pontosan a korlátnyi, teljes halmaz nem truncated', async () => {
    const result = await readStatisticsPages(
      async () => ({ docs: [{ id: 1 }, { id: 2 }], hasNextPage: false }),
      2,
      2,
    )
    expect(result.docs).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('a korlátnál van következő lap → truncated', async () => {
    const result = await readStatisticsPages(
      async () => ({ docs: [{ id: 1 }, { id: 2 }], hasNextPage: true }),
      2,
      2,
    )
    expect(result.docs).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  /*
   * MÉRT HIBA (vezetői kör, 2026-08-21): `hasNextPage` hiányában a szabály a
   * „tele volt az utolsó lap" tartalék-ágra esett vissza, és így a PONTOSAN a
   * korláttal egyező, TELJES halmazt is csonkoltnak jelölte — a felület
   * hiánytalan adatra írta ki, hogy a számok a valóságnál kisebbek lehetnek.
   * A hamis riasztás ugyanolyan kár, mint az elhallgatott csonkolás.
   */
  it('pontosan a korláton, `hasNextPage` NÉLKÜL: a totalDocs dönt', async () => {
    const teljes = await readStatisticsPages(
      async () => ({ docs: [{ id: 1 }, { id: 2 }], totalDocs: 2 }),
      2,
      2,
    )
    expect(teljes.truncated).toBe(false)

    const csonka = await readStatisticsPages(
      async () => ({ docs: [{ id: 1 }, { id: 2 }], totalDocs: 7 }),
      2,
      2,
    )
    expect(csonka.truncated).toBe(true)
  })

  it('a totalDocs ERŐSEBB, mint a „tele volt a lap" becslés', async () => {
    // A lap tele van (2 = lapméret), de a szerver szerint ennyi az összes.
    const result = await readStatisticsPages(
      async () => ({ docs: [{ id: 1 }, { id: 2 }], totalDocs: 2, hasNextPage: true }),
      2,
      2,
    )
    // A `totalDocs` a találatok teljes száma, tehát ez a mérvadó válasz.
    expect(result.truncated).toBe(false)
  })

  it('EGYIK szám nélkül a tartalék-ág marad — és inkább jelez, mint hallgat', async () => {
    // Valós Payload-válasznál ez nem fordul elő (mindkét mezőt megadja),
    // mockolt tesztben viszont igen. Ilyenkor a becslés a hamis pozitív
    // irányába téved: inkább jelezzen csonkolást, mint hogy elhallgassa.
    const result = await readStatisticsPages(async () => ({ docs: [{ id: 1 }, { id: 2 }] }), 2, 2)
    expect(result.truncated).toBe(true)

    // Fél lappal viszont biztosan nincs több sor.
    const felLap = await readStatisticsPages(async () => ({ docs: [{ id: 1 }] }), 2, 1)
    expect(felLap.truncated).toBe(false)
  })
})

/**
 * F8 ŐR (2026-08-21-i vizsgálat) — a tölcsér NEM olvas be rendelés-sorokat.
 * A régi kód 500-asával olvasta be az ÖSSZES rendelést a 20 000-es plafonig,
 * hogy a végén hat számot mutasson: 25 000 rendelésnél 40 `find`, 20 000
 * dokumentum a memóriában, ráadásul CSONKA tölcsér (a valóság 80%-a) és
 * „csonka jelentés" felirat.
 */
describe('F8 — a tölcsér darabszámokból jön, nem beolvasott sorokból', () => {
  const NOW = new Date('2026-08-20T12:00:00Z')

  /** A rendelésállomány valós eloszlása — a régi 20 000-es plafon FÖLÖTT. */
  const TOLCSER: ReadonlyMap<string, number> = new Map([
    ['created', 1_000],
    ['payment_pending', 2_000],
    ['paid', 20_000],
    ['payment_failed', 1_500],
    ['cancelled', 300],
    ['refunded', 100],
  ])
  const NEVESITETT_OSSZEG = 24_900
  const OSSZES_RENDELES = 25_000
  /** A régi tölcsér-lapméret — a mock ekkora lapokkal csábít lapozásra. */
  const REGI_TOLCSER_LAPMERET = 500

  const PAID_DOC: StatisticsOrderDoc = {
    status: 'paid',
    createdAt: '2026-08-10T10:00:00.000Z',
    totalHufSnapshot: 79_500,
    items: [
      {
        product: { id: 1, audience: 'laikus' },
        quantity: 1,
        priceHufSnapshot: 79_500,
        titleSnapshot: 'Otthoni',
      },
    ],
  }

  function makeNagyAllomanyMock(paidPage?: { docs: StatisticsOrderDoc[]; hasNextPage: boolean }) {
    const findArgs: RecordedFindArgs[] = []
    const countArgs: RecordedCountArgs[] = []
    const tolcserLap = Array.from({ length: REGI_TOLCSER_LAPMERET }, () => ({ status: 'paid' }))
    const paid = paidPage ?? { docs: [PAID_DOC], hasNextPage: false }
    const find = vi.fn(async (args: RecordedFindArgs) => {
      findArgs.push(args)
      if (args.collection === 'products') {
        return { docs: [], hasNextPage: false, totalDocs: 0 }
      }
      if (args.where !== undefined) {
        return { docs: paid.docs, hasNextPage: paid.hasNextPage, totalDocs: OSSZES_RENDELES }
      }
      return { docs: tolcserLap, hasNextPage: true, totalDocs: OSSZES_RENDELES }
    })
    const count = vi.fn(async (args: RecordedCountArgs) => {
      countArgs.push(args)
      const wanted = statusEqualsOf(args.where)
      return { totalDocs: wanted === null ? OSSZES_RENDELES : (TOLCSER.get(wanted) ?? 0) }
    })
    return { find, count, findArgs, countArgs }
  }

  it('ŐR: 25 000 rendelésnél EGYETLEN tölcsér-sor sem jön be, a hat szám mégis pontos', async () => {
    const { find, count, findArgs, countArgs } = makeNagyAllomanyMock()

    const report = await queryRevenueReport({
      payload: { find, count } as never,
      now: NOW,
      months: 1,
    })

    const tolcserFind = findArgs.filter(
      (args) => args.collection === 'orders' && args.where === undefined,
    )
    expect(
      tolcserFind.length,
      `a tölcsér ${tolcserFind.length} lapozott lekérdezéssel sorokat olvasott be — hat szám kedvéért`,
    ).toBe(0)

    expect(report.funnel).toEqual({
      created: 1_000,
      paymentPending: 2_000,
      paid: 20_000,
      paymentFailed: 1_500,
      cancelled: 300,
      refunded: 100,
      other: OSSZES_RENDELES - NEVESITETT_OSSZEG,
      total: OSSZES_RENDELES,
    })
    // A tölcsérnek nincs plafonja: 25 000 rendelés SEM csonkolja a jelentést.
    expect(report.truncated).toBe(false)

    // Javítás után: 1 `find` (a fizetett lap) + 7 `count` = 8 lekérdezés.
    // Javítás előtt ugyanezzel a mockkal: 1 + 40 = 41 `find`, 0 `count`.
    expect(
      findArgs.length,
      `${findArgs.length} find-hívás ment ki (a fizetett lapon kívül nem szabadna több)`,
    ).toBe(1)
    expect(countArgs.length, `${countArgs.length} count-hívás ment ki (6 státusz + 1 összes)`).toBe(
      7,
    )
  })

  it('a count-hívások az orders collectionre, `overrideAccess: true`-val mennek', async () => {
    const { find, count, countArgs } = makeNagyAllomanyMock()
    await queryRevenueReport({ payload: { find, count } as never, now: NOW, months: 1 })

    expect(countArgs).toHaveLength(7)
    for (const args of countArgs) {
      expect(args.collection).toBe('orders')
      // A szerepkör-kaput a hívó `StatisticsView` adja — a modul fejkommentje
      // szerinti szerződés a `count`-ra is érvényes.
      expect(args.overrideAccess).toBe(true)
    }
    const szurok = countArgs.map((args) => statusEqualsOf(args.where))
    expect(szurok.filter((status) => status === null)).toHaveLength(1)
    expect(szurok.filter((status): status is string => status !== null).sort()).toEqual([
      'cancelled',
      'created',
      'paid',
      'payment_failed',
      'payment_pending',
      'refunded',
    ])
  })

  it('a `truncated` KIZÁRÓLAG a fizetett rendelések lapozásától függ', async () => {
    const teliLap = Array.from({ length: STATISTICS_ORDER_PAGE_SIZE }, () => PAID_DOC)
    const { find, count } = makeNagyAllomanyMock({ docs: teliLap, hasNextPage: true })

    const report = await queryRevenueReport({
      payload: { find, count } as never,
      now: NOW,
      months: 1,
    })

    expect(report.truncated).toBe(true)
    expect(report.totals.orderCount).toBe(STATISTICS_ORDER_MAX)
    // …a tölcsér viszont ettől függetlenül teljes marad.
    expect(report.funnel.total).toBe(OSSZES_RENDELES)
    expect(report.funnel.paid).toBe(20_000)
  })
})
