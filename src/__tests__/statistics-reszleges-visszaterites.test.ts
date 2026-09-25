import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MonthlyRevenueSection } from '../components/admin/statistics/MonthlyRevenueSection'
import {
  aggregateMonthlyRevenue,
  buildRevenueReport,
  emptyFunnel,
  type RevenueOrderInput,
} from '../lib/statistics/revenue'
import { partialRefundsOf, queryRevenueReport } from '../lib/statistics/query'

/**
 * Részleges visszatérítés a statisztikában (a-egyeztetes-8): a levonás a
 * visszatérítés HÓNAPJÁBAN történik, nem a rendelésében; csak tulajdonosi
 * lekérdezésnél (a `refunds` mező tulajdonosi olvasású), és csak összeg +
 * időpont jut az aggregátorba.
 */

const NOW = new Date('2026-10-20T12:00:00Z')

function order(overrides: Partial<RevenueOrderInput> = {}): RevenueOrderInput {
  return {
    status: 'paid',
    createdAt: '2026-09-10T10:00:00.000Z',
    invoiceCompletionDate: '2026-09-10',
    totalHuf: 79_500,
    items: [{ audience: 'laikus', priceHuf: 79_500, quantity: 1, titleSnapshot: 'Otthoni' }],
    ...overrides,
  }
}

describe('aggregateMonthlyRevenue — részleges visszatérítés', () => {
  it('a szeptemberi 79 500 Ft-os eladás októberi 20 000 Ft-os részrefundja októberben vonódik le', () => {
    const rows = aggregateMonthlyRevenue(
      [order({ partialRefunds: [{ amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' }] })],
      { months: 2, now: NOW },
    )
    expect(rows).toEqual([
      {
        month: '2026-09',
        laikusHuf: 79_500,
        szakemberHuf: 0,
        refundHuf: 0,
        totalHuf: 79_500,
        orderCount: 1,
      },
      {
        month: '2026-10',
        laikusHuf: 0,
        szakemberHuf: 0,
        refundHuf: 20_000,
        totalHuf: -20_000,
        orderCount: 0,
      },
    ])
  })

  it('a hónap Budapest szerint dől el (október 31. 23:30 UTC = november 1.)', () => {
    const rows = aggregateMonthlyRevenue(
      [order({ partialRefunds: [{ amountHuf: 5_000, refundedAt: '2026-10-31T23:30:00.000Z' }] })],
      { months: 3, now: new Date('2026-11-15T12:00:00Z') },
    )
    expect(rows.find((row) => row.month === '2026-11')?.refundHuf).toBe(5_000)
    expect(rows.find((row) => row.month === '2026-10')?.refundHuf).toBe(0)
  })

  it('a nem fizetett (teljesen visszatérített) rendelés részrefundja nem vonódik le kétszer', () => {
    const rows = aggregateMonthlyRevenue(
      [
        order({
          status: 'refunded',
          partialRefunds: [{ amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' }],
        }),
      ],
      { months: 2, now: NOW },
    )
    expect(rows.every((row) => row.refundHuf === 0 && row.totalHuf === 0)).toBe(true)
  })

  it('a jelentés összesítője a levont összeget és a levonás tényét is hordozza', () => {
    const report = buildRevenueReport(
      [order({ partialRefunds: [{ amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' }] })],
      emptyFunnel(),
      { months: 2, now: NOW, refundsDeducted: true },
    )
    expect(report.totals).toMatchObject({
      laikusHuf: 79_500,
      refundHuf: 20_000,
      totalHuf: 59_500,
      refundsDeducted: true,
    })
    expect(report.refundsDeducted).toBe(true)
  })
})

describe('partialRefundsOf', () => {
  it('csak a részleges tétel összegét és időpontját adja tovább', () => {
    expect(
      partialRefundsOf([
        {
          type: 'partial',
          amountHuf: 20_000,
          refundedAt: '2026-10-05T09:00:00.000Z',
          transactionId: 'tx-1',
          reason: 'kártérítés',
        },
        {
          type: 'full',
          amountHuf: 79_500,
          refundedAt: '2026-10-06T09:00:00.000Z',
          transactionId: 'tx-2',
        },
        { type: 'partial', amountHuf: -5, refundedAt: '2026-10-05T09:00:00.000Z' },
        'hibás',
      ]),
    ).toEqual([{ amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' }])
    expect(partialRefundsOf(null)).toEqual([])
  })
})

describe('queryRevenueReport — a refunds csak tulajdonosi kérésre', () => {
  function payloadMock() {
    const paidDoc = {
      status: 'paid',
      createdAt: '2026-09-10T10:00:00.000Z',
      invoiceCompletionDate: '2026-09-10',
      totalHufSnapshot: 79_500,
      items: [
        {
          product: { id: 1, audience: 'laikus' },
          quantity: 1,
          priceHufSnapshot: 79_500,
          titleSnapshot: 'Otthoni',
        },
      ],
      refunds: [
        {
          type: 'partial',
          amountHuf: 20_000,
          refundedAt: '2026-10-05T09:00:00.000Z',
          transactionId: 'tx-1',
        },
      ],
    }
    const find = vi.fn<(args: unknown) => Promise<unknown>>(async () => ({
      docs: [paidDoc],
      hasNextPage: false,
      totalDocs: 1,
    }))
    const count = vi.fn(async () => ({ totalDocs: 1 }))
    return { find, count }
  }

  it('alapból (munkatársi nézet) nem kéri le a refunds mezőt és nem von le', async () => {
    const payload = payloadMock()
    const report = await queryRevenueReport({ payload: payload as never, now: NOW, months: 2 })
    const args = payload.find.mock.calls[0]?.[0] as { select?: Record<string, unknown> } | undefined
    expect(args?.select).not.toHaveProperty('refunds')
    expect(report.totals.totalHuf).toBe(79_500)
    expect(report.refundsDeducted).toBe(false)
  })

  it('tulajdonosi kérésre lekéri és a visszatérítés hónapjában levonja', async () => {
    const payload = payloadMock()
    const report = await queryRevenueReport({
      payload: payload as never,
      now: NOW,
      months: 2,
      includePartialRefunds: true,
    })
    const args = payload.find.mock.calls[0]?.[0] as { select?: Record<string, unknown> } | undefined
    expect(args?.select).toHaveProperty('refunds', true)
    expect(report.totals.totalHuf).toBe(59_500)
    expect(report.months.find((row) => row.month === '2026-10')?.refundHuf).toBe(20_000)
    expect(report.refundsDeducted).toBe(true)
  })
})

describe('MonthlyRevenueSection — levonási oszlop', () => {
  it('csak akkor van „Részleges visszatérítés" oszlop, ha volt levonás; a címsor tájékoztató', () => {
    const rows = aggregateMonthlyRevenue(
      [order({ partialRefunds: [{ amountHuf: 20_000, refundedAt: '2026-10-05T09:00:00.000Z' }] })],
      { months: 2, now: NOW },
    )
    const withRefund = renderToStaticMarkup(createElement(MonthlyRevenueSection, { rows }))
    expect(withRefund).toContain('<h2>Havi befizetések (tájékoztató)</h2>')
    expect(withRefund).toContain('Részleges visszatérítés')
    expect(withRefund).toContain(`−${(20_000).toLocaleString('hu-HU')} Ft`)

    const without = renderToStaticMarkup(
      createElement(MonthlyRevenueSection, {
        rows: aggregateMonthlyRevenue([order()], { months: 2, now: NOW }),
      }),
    )
    expect(without).not.toContain('Részleges visszatérítés')
  })
})
