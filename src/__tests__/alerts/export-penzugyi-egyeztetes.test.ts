import { describe, expect, it, vi } from 'vitest'

import {
  budapestHonapHatarai,
  CSV_FEJLEC,
  csvCella,
  elozoHonap,
  fizetesiIdok,
  penzugyiExport,
} from '../../scripts/export-penzugyi-egyeztetes'
import { createMemoryPayload } from './where-eval'

/**
 * A könyvelői export (a-egyeztetes-9): csak `find`, a hónap Budapest szerint,
 * személyes adat nélkül, Excel-barát CSV (BOM, pontosvessző, képlet-védelem).
 */

describe('export — időszak', () => {
  it('a hónap határai Budapest szerint (nyári és téli idő)', () => {
    expect(budapestHonapHatarai('2026-09')).toEqual({
      kezdet: new Date('2026-08-31T22:00:00.000Z'),
      veg: new Date('2026-09-30T22:00:00.000Z'),
    })
    expect(budapestHonapHatarai('2026-12')).toEqual({
      kezdet: new Date('2026-11-30T23:00:00.000Z'),
      veg: new Date('2026-12-31T23:00:00.000Z'),
    })
    expect(() => budapestHonapHatarai('2026-13')).toThrow('ÉÉÉÉ-HH')
  })

  it('alapból az előző naptári hónap', () => {
    expect(elozoHonap(new Date('2026-09-24T10:00:00Z'))).toBe('2026-08')
    expect(elozoHonap(new Date('2026-01-01T00:30:00+01:00'))).toBe('2025-12')
  })
})

describe('export — CSV', () => {
  it('a képletként értelmezhető cella aposztrófot kap, a pontosvesszős idézőjelet', () => {
    expect(csvCella('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCella('-20000')).toBe("'-20000")
    expect(csvCella('a;b')).toBe('"a;b"')
    expect(csvCella('KH-2026-000001')).toBe('KH-2026-000001')
  })

  it('a fizetés ideje a rendeléshez kötött hozzáférés-óra legkorábbi ideje', () => {
    const idok = fizetesiIdok([
      {
        accessGrants: [
          { sourceOrder: 7, grantedAt: '2026-09-02T10:00:00.000Z' },
          { sourceOrder: 7, grantedAt: '2026-09-01T10:00:00.000Z' },
          { sourceOrder: { id: 8 }, grantedAt: '2026-09-03T10:00:00.000Z' },
          { sourceOrder: null, grantedAt: '2026-09-04T10:00:00.000Z' },
        ],
      },
    ])
    expect(idok.get(7)).toBe('2026-09-01T10:00:00.000Z')
    expect(idok.get(8)).toBe('2026-09-03T10:00:00.000Z')
    expect(idok.size).toBe(2)
  })

  it('a teljes export csak find-ot hív, a hónapra szűr, és nem tartalmaz vevőadatot', async () => {
    const find = vi.fn(async (args: { collection: string }) => {
      if (args.collection === 'orders') {
        return {
          docs: [
            {
              id: 7,
              orderNumber: 'KH-2026-000007',
              createdAt: '2026-09-01T08:00:00.000Z',
              status: 'paid',
              totalHufSnapshot: 79_500,
              invoiceNumber: 'KC-2026-7',
              invoiceStatus: 'issued',
              invoiceCompletionDate: '2026-09-01',
              correctiveInvoiceNumber: 'KC-2026-8',
              correctiveInvoiceStatus: 'issued',
              refunds: [
                {
                  type: 'partial',
                  amountHuf: 20_000,
                  refundedAt: '2026-09-10T08:00:00.000Z',
                  transactionId: 'tx',
                },
              ],
              barionPaymentId: 'abc123',
              customerEmail: 'vevo@example.com',
            },
          ],
          hasNextPage: false,
        }
      }
      return {
        docs: [{ accessGrants: [{ sourceOrder: 7, grantedAt: '2026-09-01T08:05:00.000Z' }] }],
        hasNextPage: false,
      }
    })
    const payload = {
      find,
      create: vi.fn(() => {
        throw new Error('az export nem írhat')
      }),
      update: vi.fn(() => {
        throw new Error('az export nem írhat')
      }),
    }

    const { csv, sorok } = await penzugyiExport(payload as never, '2026-09')

    expect(sorok).toBe(1)
    expect(csv.startsWith('﻿')).toBe(true)
    const [fejlec, sor] = csv.slice(1).split('\r\n')
    expect(fejlec).toBe(CSV_FEJLEC.join(';'))
    expect(sor).toBe(
      [
        'KH-2026-000007',
        '2026. 09. 01. 10:00',
        '2026. 09. 01. 10:05',
        'paid',
        '79500',
        'KC-2026-7',
        'issued',
        '2026-09-01',
        '',
        '',
        'KC-2026-8',
        'issued',
        '20000',
        '20000 Ft (2026. 09. 10. 10:00)',
        '20000',
        'abc123',
      ].join(';'),
    )
    expect(csv).not.toContain('example.com')
    expect(csv).not.toContain('tx')
    const ordersCall = find.mock.calls[0]?.[0] as { where?: unknown; select?: unknown } | undefined
    expect(JSON.stringify(ordersCall?.where)).toContain('2026-08-31T22:00:00.000Z')
    expect(ordersCall?.select).not.toHaveProperty('customerEmail')
    expect(payload.create).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })
})

/** A CSV sorai oszlopnév szerint (a fejléc a modul saját oszloplistája). */
function csvSorok(csv: string): Array<Record<string, string>> {
  const [, ...vonalak] = csv
    .slice(1)
    .split('\r\n')
    .filter((vonal) => vonal.length > 0)
  return vonalak.map((vonal) => {
    const cellak = vonal.split(';')
    return Object.fromEntries(CSV_FEJLEC.map((oszlop, index) => [oszlop, cellak[index] ?? '']))
  })
}

/**
 * H0: a könyvelői export a hónap MINDEN visszatérítését hozza, a részlegeset
 * is. A felső szintű `refundedAt`-et csak a teljes visszatérítés írja, a
 * részleges ideje csak a `refunds[]` tételben él. A memória-payload a `where`-t
 * ténylegesen kiértékeli (a fenti mock nem), így a lekérdezés szűrése is mérve van.
 */
describe('export — a hónap visszatérítései (valódi where-kiértékeléssel)', () => {
  const rendeles = (
    id: number,
    mezok: {
      createdAt: string
      updatedAt: string
      status?: string
      refundedAt?: string | null
      refunds?: Array<{ type: string; amountHuf: number; refundedAt: string }>
    },
  ) => ({
    id,
    orderNumber: `KH-2026-${String(id).padStart(6, '0')}`,
    status: mezok.status ?? 'paid',
    totalHufSnapshot: 79_500,
    refundedAt: mezok.refundedAt ?? null,
    refunds: mezok.refunds ?? [],
    createdAt: mezok.createdAt,
    updatedAt: mezok.updatedAt,
  })

  const orders = [
    // Októberben jött létre, visszatérítés nélkül.
    rendeles(1, { createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:05:00.000Z' }),
    // Szeptemberi rendelés: egy szeptemberi és két októberi RÉSZLEGES
    // visszatérítés, a felső szintű refundedAt üres, az állapot paid marad.
    rendeles(2, {
      createdAt: '2026-09-20T08:00:00.000Z',
      updatedAt: '2026-10-20T09:00:01.000Z',
      refunds: [
        { type: 'partial', amountHuf: 10_000, refundedAt: '2026-09-25T08:00:00.000Z' },
        { type: 'partial', amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' },
        { type: 'partial', amountHuf: 5_000, refundedAt: '2026-10-20T09:00:00.000Z' },
      ],
    }),
    // Októberi részleges, majd novemberi teljes visszatérítés: a refundedAt
    // novemberi, az állapot refunded.
    rendeles(3, {
      createdAt: '2026-09-21T08:00:00.000Z',
      updatedAt: '2026-11-03T09:00:01.000Z',
      status: 'refunded',
      refundedAt: '2026-11-03T09:00:00.000Z',
      refunds: [
        { type: 'partial', amountHuf: 20_000, refundedAt: '2026-10-06T09:00:00.000Z' },
        { type: 'full', amountHuf: 59_500, refundedAt: '2026-11-03T09:00:00.000Z' },
      ],
    }),
    // Budapesti idő szerint október 1-je 00:30: októberi.
    rendeles(4, {
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-30T22:30:01.000Z',
      refunds: [{ type: 'partial', amountHuf: 1_000, refundedAt: '2026-09-30T22:30:00.000Z' }],
    }),
    // Budapesti idő szerint szeptember 30. 23:59: nem októberi.
    rendeles(5, {
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-30T21:59:01.000Z',
      refunds: [{ type: 'partial', amountHuf: 1_000, refundedAt: '2026-09-30T21:59:00.000Z' }],
    }),
    // Októberben módosult (például számlaállapot), de októberben nem jött
    // létre és visszatérítést sem kapott.
    rendeles(6, {
      createdAt: '2026-09-15T08:00:00.000Z',
      updatedAt: '2026-10-12T08:00:00.000Z',
      refunds: [{ type: 'partial', amountHuf: 5_000, refundedAt: '2026-09-16T08:00:00.000Z' }],
    }),
    // Csak a hónap után történt vele valami (novemberi visszatérítés).
    rendeles(7, {
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-11-02T08:00:01.000Z',
      refunds: [{ type: 'partial', amountHuf: 5_000, refundedAt: '2026-11-02T08:00:00.000Z' }],
    }),
  ]

  it('bekerül a korábban létrehozott, a hónapban (részben) visszatérített rendelés; a hónapon kívüli nem', async () => {
    const { payload } = createMemoryPayload({ orders, users: [] })

    const { csv, sorok } = await penzugyiExport(payload as never, '2026-10')

    // A memória-payload nem rendez, ezért a halmazt vetjük össze.
    const rendelesszamok = csvSorok(csv).map((sor) => sor.rendelesszam)
    expect(rendelesszamok.sort()).toEqual([
      'KH-2026-000001',
      'KH-2026-000002',
      'KH-2026-000003',
      'KH-2026-000004',
    ])
    expect(sorok).toBe(4)
  })

  it('a havi oszlopok csak a hónap visszatérítéseit mutatják, tételenként összeggel; a halmozott a hónap végéig összegez', async () => {
    const { payload } = createMemoryPayload({ orders, users: [] })

    const sorLista = csvSorok((await penzugyiExport(payload as never, '2026-10')).csv)
    const szerint = new Map(sorLista.map((sor) => [sor.rendelesszam, sor]))

    // Két októberi visszatérítés: a Barion-sorok (-20 000 és -5 000) és a két
    // helyesbítő tételenként párosítható, a havi összeg ezek összege.
    expect(szerint.get('KH-2026-000002')).toMatchObject({
      allapot: 'paid',
      visszaterites_honapban_huf: '25000',
      visszaterites_honapban_tetelei:
        '20000 Ft (2026. 10. 05. 11:00) | 5000 Ft (2026. 10. 20. 11:00)',
      visszaterites_halmozott_huf: '35000',
    })
    // A novemberi teljes visszatérítés az októberi sor egyik oszlopába sem számít.
    expect(szerint.get('KH-2026-000003')).toMatchObject({
      allapot: 'refunded',
      visszaterites_honapban_huf: '20000',
      visszaterites_honapban_tetelei: '20000 Ft (2026. 10. 06. 11:00)',
      visszaterites_halmozott_huf: '20000',
    })
    expect(szerint.get('KH-2026-000004')).toMatchObject({
      visszaterites_honapban_tetelei: '1000 Ft (2026. 10. 01. 00:30)',
    })
    expect(szerint.get('KH-2026-000001')).toMatchObject({
      visszaterites_honapban_huf: '',
      visszaterites_halmozott_huf: '',
    })

    // Novemberben ugyanez a rendelés a maradék összeggel jelenik meg.
    const november = csvSorok((await penzugyiExport(payload as never, '2026-11')).csv)
    expect(november.find((sor) => sor.rendelesszam === 'KH-2026-000003')).toMatchObject({
      visszaterites_honapban_huf: '59500',
      visszaterites_halmozott_huf: '79500',
    })
  })
})

/**
 * PR #305 (Devin): a hónapban FIZETETT rendelés is bekerül, akkor is, ha
 * korábban jött létre, és a hónapban visszatérítést sem kapott. A fizetés ideje
 * a hozzáférés-óra (`accessGrants.grantedAt`); a paid-átmenet a rendelést ezután
 * menti, ezért a fixtúrában a rendelés `updatedAt`-je nem korábbi a
 * `grantedAt`-nél.
 *
 * A rendeléseket a memória-payload szűri (valódi where-kiértékeléssel), és
 * az adatbázishoz hasonlóan a kért `sort` szerint rendezve, oldalanként adja
 * vissza; a vevőket egy szűk kiszolgáló adja, amely kizárólag az export
 * `accessGrants.sourceOrder in [...]` lekérdezését ismeri, minden mást
 * hangosan elutasít.
 */
describe('export — a hónapban fizetett rendelés (Budapest szerinti hónaphatár)', () => {
  interface Hozzaferes {
    sourceOrder: number
    grantedAt: string
  }

  const rendeles = (
    id: number,
    mezok: {
      createdAt: string
      updatedAt: string
      refunds?: Array<{ type: string; amountHuf: number; refundedAt: string }>
    },
  ) => ({
    id,
    orderNumber: `KH-2026-${String(id).padStart(6, '0')}`,
    status: 'paid',
    totalHufSnapshot: 79_500,
    refundedAt: null,
    refunds: mezok.refunds ?? [],
    createdAt: mezok.createdAt,
    updatedAt: mezok.updatedAt,
  })

  /** Az adatbázis `ORDER BY`-ja: a `sort` kulcsai sorban, a `-` előtag csökkenő. */
  function rendez(
    docs: ReadonlyArray<Record<string, unknown>>,
    sort: string | readonly string[] | undefined,
  ): Array<Record<string, unknown>> {
    const kulcsok = sort === undefined ? [] : typeof sort === 'string' ? [sort] : sort
    return [...docs].sort((a, b) => {
      for (const kulcs of kulcsok) {
        const mezo = kulcs.replace(/^-/, '')
        const irany = kulcs.startsWith('-') ? -1 : 1
        const x = a[mezo]
        const y = b[mezo]
        const kul =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x) < String(y)
              ? -1
              : String(x) > String(y)
                ? 1
                : 0
        if (kul !== 0) return kul * irany
      }
      return 0
    })
  }

  function exportPayload(
    orders: ReadonlyArray<Record<string, unknown>>,
    hozzaferesek: readonly Hozzaferes[],
  ) {
    const { payload } = createMemoryPayload({ orders })
    const vevok = hozzaferesek.map((grant) => ({ accessGrants: [grant] }))
    const vevoLekerdezesek: unknown[][] = []
    return {
      vevoLekerdezesek,
      find: async (args: {
        collection: string
        where?: Record<string, unknown>
        sort?: string | string[]
        page?: number
        limit?: number
      }) => {
        if (args.collection !== 'users') {
          const { docs } = await payload.find({
            ...(args as Parameters<typeof payload.find>[0]),
            page: 1,
            limit: Number.MAX_SAFE_INTEGER,
          })
          const limit = args.limit ?? 10
          const page = args.page ?? 1
          const rendezett = rendez(docs, args.sort)
          return {
            docs: rendezett.slice((page - 1) * limit, page * limit),
            hasNextPage: page * limit < rendezett.length,
          }
        }
        const feltetel = args.where?.['accessGrants.sourceOrder'] as { in?: unknown } | undefined
        const ids = feltetel?.in
        if (!Array.isArray(ids) || Object.keys(args.where ?? {}).length !== 1) {
          throw new Error('váratlan vevő-lekérdezés')
        }
        vevoLekerdezesek.push(ids)
        return {
          docs: vevok.filter((vevo) => ids.includes(vevo.accessGrants[0]?.sourceOrder)),
          hasNextPage: false,
        }
      },
    }
  }

  // Devin példája: augusztus 31. 23:50-kor (Budapest) jött létre, szeptember
  // 1. 00:10-kor fizették, visszatérítés nélkül.
  const devinPeldaja = {
    createdAt: '2026-08-31T21:50:00.000Z',
    updatedAt: '2026-08-31T22:10:01.000Z',
  }
  const orders = [
    rendeles(1, devinPeldaja),
    // Ugyanígy a hónapfordulón fizetett, majd októberben részben visszatérített.
    rendeles(2, {
      createdAt: '2026-08-31T21:55:00.000Z',
      updatedAt: '2026-10-05T09:00:01.000Z',
      refunds: [{ type: 'partial', amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' }],
    }),
    // Téli időre váltó hónap: október 31. 23:40-kor (CET) jött létre, november
    // 1. 00:10-kor (CET) fizették. Egy rögzített nyári (+2 órás) hónaphatár
    // mindkettőt novemberinek látná.
    rendeles(3, { createdAt: '2026-10-31T22:40:00.000Z', updatedAt: '2026-10-31T23:10:01.000Z' }),
    // Szeptember 30. 23:50-kor (CEST) jött létre, október 1. 00:30-kor fizették.
    rendeles(4, { createdAt: '2026-09-30T21:50:00.000Z', updatedAt: '2026-09-30T22:30:01.000Z' }),
  ]
  const devinFizetese: Hozzaferes = { sourceOrder: 1, grantedAt: '2026-08-31T22:10:00.000Z' }
  const hozzaferesek: Hozzaferes[] = [
    devinFizetese,
    { sourceOrder: 2, grantedAt: '2026-08-31T22:12:00.000Z' },
    { sourceOrder: 3, grantedAt: '2026-10-31T23:10:00.000Z' },
    { sourceOrder: 4, grantedAt: '2026-09-30T22:30:00.000Z' },
  ]

  it.each([
    ['2026-08', ['KH-2026-000001', 'KH-2026-000002']],
    ['2026-09', ['KH-2026-000001', 'KH-2026-000002', 'KH-2026-000004']],
    ['2026-10', ['KH-2026-000002', 'KH-2026-000003', 'KH-2026-000004']],
    ['2026-11', ['KH-2026-000003']],
    ['2026-12', []],
  ])(
    '%s: a létrehozás, a fizetés és a visszatérítés hónapja is behozza a rendelést, más hónap nem',
    async (honap, varhato) => {
      const payload = exportPayload(orders, hozzaferesek)

      const { csv } = await penzugyiExport(payload as never, honap)

      expect(
        csvSorok(csv)
          .map((sor) => sor.rendelesszam)
          .sort(),
      ).toEqual(varhato)
    },
  )

  it('a fizetés hónapjának sora a fizetés idejét mutatja, visszatérítés nélkül', async () => {
    const payload = exportPayload(orders, hozzaferesek)

    const szeptember = csvSorok((await penzugyiExport(payload as never, '2026-09')).csv)

    expect(szeptember.find((sor) => sor.rendelesszam === 'KH-2026-000001')).toMatchObject({
      letrehozva_budapest: '2026. 08. 31. 23:50',
      fizetve_budapest: '2026. 09. 01. 00:10',
      visszaterites_honapban_huf: '',
      visszaterites_halmozott_huf: '',
    })
  })

  it('nagy jelölt-halmaznál a későbbi köteg rendelésének fizetési ideje is megvan', async () => {
    // Júliusi rendelések, amelyek szeptemberben módosultak (jelöltek), de
    // szeptemberben nem jöttek létre és nem is fizették őket.
    const toltelek = Array.from({ length: 450 }, (_, index) =>
      rendeles(1_000 + index, {
        createdAt: '2026-07-10T08:00:00.000Z',
        updatedAt: '2026-09-15T08:00:00.000Z',
      }),
    )
    const payload = exportPayload([...toltelek, rendeles(1, devinPeldaja)], [devinFizetese])

    const { csv } = await penzugyiExport(payload as never, '2026-09')

    expect(csvSorok(csv).map((sor) => sor.rendelesszam)).toEqual(['KH-2026-000001'])
    // Egy vevő-lekérdezés legfeljebb 200 rendelést kér (korlátos `in`-lista,
    // nem rendelésenként egy lekérdezés), és együtt minden jelöltet lefednek.
    expect(payload.vevoLekerdezesek.length).toBeGreaterThan(1)
    expect(Math.max(...payload.vevoLekerdezesek.map((ids) => ids.length))).toBeLessThanOrEqual(200)
    expect(new Set(payload.vevoLekerdezesek.flat()).size).toBe(451)
  })

  // Codex P2 (PR #305): a bővebb halmaz egy régi hónapra a hónap óta módosult
  // összes rendelést tartalmazza. Darabszám-korlátos lapozásnál (200 × 100 sor)
  // egy régi hónap exportja végleg elromlana, amint ennél több későbbi
  // rendelés gyűlik össze.
  it('sok későbbi rendelés mellett is elkészül egy régi hónap exportja', async () => {
    const kesobbiek = Array.from({ length: 20_001 }, (_, index) =>
      rendeles(10_000 + index, {
        createdAt: '2026-10-05T08:00:00.000Z',
        updatedAt: '2026-10-05T08:00:00.000Z',
      }),
    )
    const payload = exportPayload([rendeles(1, devinPeldaja), ...kesobbiek], [devinFizetese])

    const { csv } = await penzugyiExport(payload as never, '2026-08')

    expect(csvSorok(csv).map((sor) => sor.rendelesszam)).toEqual(['KH-2026-000001'])
  }, 120_000)
})
