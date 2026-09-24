import { describe, expect, it, vi } from 'vitest'

import {
  budapestHonapHatarai,
  CSV_FEJLEC,
  csvCella,
  elozoHonap,
  fizetesiIdok,
  penzugyiExport,
} from '../../scripts/export-penzugyi-egyeztetes'

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
        '2026. 09. 10. 10:00',
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
