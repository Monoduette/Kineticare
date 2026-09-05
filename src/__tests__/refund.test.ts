import { describe, expect, it, vi } from 'vitest'
import { fixture, provider, store, locks } from './refund-fixture'
import { createRefundHandler } from '../lib/refund/route-handler'
import { readRefundEntries } from '../lib/refund/refund-order'

function route(f: ReturnType<typeof fixture>, input: unknown = { operationKey: 'A'.repeat(43) }) {
  return createRefundHandler({ getPayload: async () => f.payload })(
    new Request('https://shop.example.test/api/admin/orders/SYNTHETIC-RECOVERY-11/refund', {
      method: 'POST',
      headers: { origin: 'https://shop.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ orderNumber: f.order.orderNumber! }) },
  )
}

describe('owner refund route with durable recovery', () => {
  it.each([
    ['anonymous', null, 401],
    ['staff', { id: 2, role: 'staff' }, 403],
    ['customer', { id: 2, role: 'customer' }, 403],
  ] as const)('%s cannot launch a refund', async (_label, user, status) => {
    const f = fixture()
    vi.mocked(f.payload.auth).mockResolvedValue({ user } as never)
    expect((await route(f)).status).toBe(status)
    expect(provider.refund).not.toHaveBeenCalled()
  })
  it('owner: correct original transaction and amount, financial record, cleanup and audit', async () => {
    const f = fixture()
    const response = await route(f)
    expect(response.status).toBe(200)
    expect(provider.refund).toHaveBeenCalledWith({
      paymentId: 'SYNTHETIC-PAYMENT',
      transactionsToRefund: [
        {
          transactionId: 'SYNTHETIC-TX',
          posTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          amountToRefund: 20000,
        },
      ],
    })
    expect(f.order.status).toBe('refunded')
    expect(f.user.purchases).toEqual([99])
    expect(f.audits.some((audit) => audit.action === 'order-refund')).toBe(true)
  })
  it('protects access supported by another paid order', async () => {
    const f = fixture()
    f.failures.otherPaid = true
    expect((await route(f)).status).toBe(200)
    expect(f.user.purchases).toEqual([42, 99])
  })
  it.each(['created', 'payment_pending', 'payment_failed', 'cancelled', 'refunded'] as const)(
    '%s is not a new paid refund',
    async (status) => {
      const f = fixture()
      f.order.status = status
      expect((await route(f)).status).toBe(409)
      expect(provider.state).not.toHaveBeenCalled()
      expect(provider.refund).not.toHaveBeenCalled()
    },
  )
  it('partial preserves access and the paid status', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    expect(f.order.status).toBe('paid')
    expect(f.user.purchases).toEqual([42, 99])
    expect(readRefundEntries(f.order)[0].amountHuf).toBe(5000)
  })
  it('blocks direct owner POST for legacy partial history without completion proof before GetState', async () => {
    const f = fixture()
    f.order.refunds = [
      {
        transactionId: 'SYNTHETIC-TX',
        amountHuf: 5000,
        type: 'partial',
        status: 'Refunded',
        refundedAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    expect(await f.status()).toMatchObject({ state: 'manual_review' })
    expect((await route(f, { operationKey: 'A'.repeat(43), amountHuf: 5000 })).status).toBe(503)
    expect(provider.state).not.toHaveBeenCalled()
    expect(provider.refund).not.toHaveBeenCalled()
    expect(store.intents.has(f.payload)).toBe(false)
  })
  it('blocks a new operation when prior invoice completion proof is missing', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    f.audits.splice(
      f.audits.findIndex((audit) => audit.action === 'refund-invoice-done'),
      1,
    )
    await expect(
      f.start({ amountHuf: 5000, operationKey: 'B'.repeat(42) + 'A' }),
    ).rejects.toMatchObject({ status: 503 })
    expect(provider.state).toHaveBeenCalledTimes(1)
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(store.history.get(f.payload)).toHaveLength(1)
  })
  it('rechecks prior completion under the order lock before creating a new claim', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    locks.beforeOrder = () => {
      f.order.correctiveInvoiceNumber = null
    }
    await expect(
      f.start({ amountHuf: 5000, operationKey: 'B'.repeat(42) + 'A' }),
    ).rejects.toMatchObject({ status: 503 })
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(store.history.get(f.payload)).toHaveLength(1)
  })
  it('a fresh operation can close the remainder using GetState original POS identity', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    await f.start({ operationKey: 'B'.repeat(42) + 'A' })
    expect(provider.state).toHaveBeenCalledTimes(2)
    expect(f.order.status).toBe('refunded')
    expect(readRefundEntries(f.order).map((entry) => entry.amountHuf)).toEqual([5000, 15000])
  })
  it('a committed partial replay with the same caller key cannot send money again', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(store.history.get(f.payload)).toHaveLength(1)
  })
  it.each([0, -1, 20001, 0.5, 'invalid'])(
    'rejects amount %s before provider calls',
    async (amountHuf) => {
      const f = fixture()
      expect((await route(f, { operationKey: 'A'.repeat(43), amountHuf })).status).toBe(400)
      expect(provider.refund).not.toHaveBeenCalled()
    },
  )
  it.each([undefined, null, '', 'short', 'B'.repeat(43)])(
    'requires a canonical stable operation key: %s',
    async (operationKey) => {
      const f = fixture()
      expect((await route(f, { operationKey })).status).toBe(400)
      expect(provider.state).not.toHaveBeenCalled()
    },
  )
  it('unknown order returns 404 without provider calls', async () => {
    const f = fixture()
    vi.mocked(f.payload.find).mockResolvedValue({ docs: [], totalDocs: 0 } as never)
    expect((await route(f)).status).toBe(404)
  })
  it('provider transport failure keeps a durable blocker and hides raw errors', async () => {
    const f = fixture()
    provider.refund.mockRejectedValue(new Error('DUMMY-PRIVATE-ERROR'))
    const response = await route(f)
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('DUMMY-PRIVATE-ERROR')
    expect(f.order.refunds).toEqual([])
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    await route(f)
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('GetState failure leaves the provider unclaimed and does not refund', async () => {
    const f = fixture()
    provider.state.mockRejectedValue(new Error('SYNTHETIC state failure'))
    await expect(f.start()).rejects.toThrow()
    expect(provider.refund).not.toHaveBeenCalled()
    expect(store.intents.get(f.payload)).toBeUndefined()
  })
  it.each([
    { PaymentId: 'OTHER', Transactions: [] },
    { PaymentId: 'SYNTHETIC-PAYMENT', Transactions: [{ TransactionId: '', Total: 20000 }] },
    {
      PaymentId: 'SYNTHETIC-PAYMENT',
      Transactions: [{ TransactionId: 'SYNTHETIC-TX', Total: 20000 }],
    },
  ])('rejects uncorrelated or missing original GetState identifiers', async (state) => {
    const f = fixture()
    provider.state.mockResolvedValue(state)
    await expect(f.start()).rejects.toThrow()
    expect(provider.refund).not.toHaveBeenCalled()
  })
})
