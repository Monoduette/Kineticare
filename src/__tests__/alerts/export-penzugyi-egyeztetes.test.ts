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
