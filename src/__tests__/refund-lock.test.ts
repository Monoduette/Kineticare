import { describe, expect, it } from 'vitest'
import { fixture, locks, provider, store, documents, access } from './refund-fixture'
import { orderTransitionLockKey } from '../lib/order-status/apply-barion-state'
import { classifyRefundedTransactionStatus, refundLockKey } from '../lib/refund/refund-order'

describe('refund claim and lock boundaries', () => {
  it('refundLockKey(5) === orderTransitionLockKey(5)', () => {
    expect(refundLockKey(5)).toBe(orderTransitionLockKey(5))
    expect(refundLockKey(5)).toBe('order:mutate:5')
  })
  it('GetState outside order lock, provider POST inside order lock and never user lock', async () => {
    const f = fixture()
    const state = provider.state.getMockImplementation()!
    provider.state.mockImplementation(async (...args) => {
      expect(locks.held).toEqual([])
      return state(...args)
    })
    const post = provider.refund.getMockImplementation()!
    provider.refund.mockImplementation(async (...args) => {
      expect(locks.held).toContain('order:mutate:11')
      expect(locks.held).not.toContain('purchases:user:7')
      return post(...args)
    })
    await f.start()
    expect(locks.events).toContain('purchases:user:7')
  })
  it('rereads paid status after acquiring the order lock', async () => {
    const f = fixture()
    locks.beforeOrder = () => {
      f.order.status = 'refunded'
    }
    await expect(f.start()).rejects.toMatchObject({ status: 409 })
    expect(provider.refund).not.toHaveBeenCalled()
  })
  it('two concurrent requests cannot obtain two active provider claims', async () => {
    const f = fixture()
    const results = await Promise.allSettled([f.start(), f.start()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('SQL cleanup executes within the user lock', async () => {
    const f = fixture()
    const apply = access.apply.getMockImplementation()!
    access.apply.mockImplementation(async (...args) => {
      expect(locks.held).toContain('purchases:user:7')
      return apply(...args)
    })
    await f.start()
    expect(access.apply).toHaveBeenCalledTimes(1)
  })
})

describe('provider response evidence', () => {
  it.each([
    ['Refunded', 'succeeded'],
    ['Succeeded', 'succeeded'],
    ['PartiallyRefunded', 'succeeded'],
    ['RefundFailed', 'failed'],
    ['Future', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('classifies %s as %s', (status, expected) =>
    expect(classifyRefundedTransactionStatus(status)).toBe(expected),
  )
  it.each(['RefundFailed', 'Future', 'Refunded', 'PartiallyRefunded', undefined])(
    'blocks %s without changing financial/access state',
    async (Status) => {
      const f = fixture()
      provider.refund.mockResolvedValue({
        PaymentId: 'SYNTHETIC-PAYMENT',
        RefundedTransactions: [
          {
            TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
            POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
            Total: 20000,
            Status,
          },
        ],
      })
      await expect(f.start()).rejects.toThrow()
      expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
      expect(f.order.refunds).toEqual([])
      expect(f.user.purchases).toEqual([42, 99])
      expect(documents.storno).not.toHaveBeenCalled()
    },
  )
  it.each([
    { PaymentId: 'OTHER' },
    { Errors: [{ ErrorCode: 'SYNTHETIC' }] },
    { Errors: null },
    { RefundedTransactions: [] },
    {
      RefundedTransactions: [
        {
          TransactionId: 'OTHER',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          Total: 20000,
          Status: 'Succeeded',
        },
      ],
    },
    {
      RefundedTransactions: [
        {
          TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          Total: 1,
          Status: 'Succeeded',
        },
      ],
    },
    {
      RefundedTransactions: [
        {
          TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          AmountToRefund: 20000,
          Status: 'Succeeded',
        },
      ],
    },
    {
      RefundedTransactions: [
        {
          TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          Total: 20000,
          Status: 'Succeeded',
        },
        {
          TransactionId: 'OTHER',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          Total: 20000,
          Status: 'Succeeded',
        },
      ],
    },
  ])('rejects insufficient or conflicting refund evidence %j', async (override) => {
    const f = fixture()
    provider.refund.mockResolvedValue({
      PaymentId: 'SYNTHETIC-PAYMENT',
      RefundedTransactions: [
        {
          TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          Total: 20000,
          Status: 'Succeeded',
        },
      ],
      ...override,
    })
    await expect(f.start()).rejects.toThrow()
    expect(f.order.refunds).toEqual([])
  })
  it('accepts documented Total with omitted Errors', async () => {
    const f = fixture()
    provider.refund.mockResolvedValue({
      PaymentId: 'SYNTHETIC-PAYMENT',
      RefundedTransactions: [
        {
          TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
          POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
          Total: 20000,
          Status: 'Succeeded',
        },
      ],
    })
    await expect(f.start()).resolves.toMatchObject({ refundStatusOutcome: 'succeeded' })
  })
})
