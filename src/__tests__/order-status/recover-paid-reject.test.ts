import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BarionPaymentStateResponse, BarionRefundResponse } from '../../lib/barion'
import { createLogger } from '../../lib/logger'
import {
  hungarianAutoRefundReason,
  isAutoRefundRejectReason,
  pickRefundableTransaction,
  recoverRejectedSucceededPayment,
} from '../../lib/order-status/recover-paid-reject'
import type { Order } from '../../payload-types'

// CLAUDE.md 15.: tesztből SOSEM mehet ki valódi hálózati hívás.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const TRANSACTION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ORDER_TOTAL_HUF = 19990

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 101,
    orderNumber: 'KH-2026-000123',
    status: 'payment_pending',
    barionPaymentId: PAYMENT_ID,
    currency: 'HUF',
    totalHufSnapshot: ORDER_TOTAL_HUF,
    refunds: [],
    ...overrides,
  } as unknown as Order
}

function createState(
  overrides: Partial<BarionPaymentStateResponse> = {},
): BarionPaymentStateResponse {
  return {
    PaymentId: PAYMENT_ID,
    PaymentRequestId: 'KH-2026-000123',
    Status: 'Succeeded',
    Total: ORDER_TOTAL_HUF,
    Currency: 'HUF',
    Transactions: [
      {
        TransactionId: TRANSACTION_ID,
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: ORDER_TOTAL_HUF,
      },
    ],
    ...overrides,
  }
}

function createMockPayload(order: Order) {
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    findByID: vi.fn(async () => order),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      Object.assign(order, data)
      return data
    }),
  }
  return { payload: payload as unknown as Payload, updates }
}

describe('isAutoRefundRejectReason', () => {
  it.each(['duplicate-paid-order', 'guest-bind-privileged-account', 'total-mismatch'] as const)(
    '%s → refundolható',
    (reason) => {
      expect(isAutoRefundRejectReason(reason)).toBe(true)
    },
  )

  it.each(['paid-not-allowed', 'cancel-not-allowed', 'unknown', undefined])(
    '%s → nem refundolható',
    (reason) => {
      expect(isAutoRefundRejectReason(reason)).toBe(false)
    },
  )
})

describe('pickRefundableTransaction', () => {
  it('üres Transactions → null (nincs HTTP)', () => {
    expect(pickRefundableTransaction(createState({ Transactions: [] }))).toBeNull()
  })

  it('Succeeded CardPayment → TransactionId + Barion összeg', () => {
    expect(pickRefundableTransaction(createState())).toEqual({
      transactionId: TRANSACTION_ID,
      amountHuf: ORDER_TOTAL_HUF,
      alreadyRefunded: false,
      alreadyPartiallyRefunded: false,
    })
  })

  it('már Refunded tranzakció → alreadyRefunded, PartiallyRefunded NEM teljes', () => {
    expect(
      pickRefundableTransaction(
        createState({
          Transactions: [
            {
              TransactionId: TRANSACTION_ID,
              TransactionType: 'CardPayment',
              Status: 'Refunded',
              Total: ORDER_TOTAL_HUF,
            },
          ],
        }),
      ),
    ).toMatchObject({ alreadyRefunded: true, alreadyPartiallyRefunded: false })

    expect(
      pickRefundableTransaction(
        createState({
          Transactions: [
            {
              TransactionId: TRANSACTION_ID,
              TransactionType: 'CardPayment',
              Status: 'PartiallyRefunded',
              Total: ORDER_TOTAL_HUF,
            },
          ],
        }),
      ),
    ).toMatchObject({ alreadyRefunded: false, alreadyPartiallyRefunded: true })
  })
})

describe('recoverRejectedSucceededPayment', () => {
  it('ismeretlen ok → skip, refund NEM hívódik', async () => {
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn()

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'paid-not-allowed',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'skipped', detail: 'reason-not-refundable' })
    expect(refund).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('üres Transactions → skip + riasztás, nincs HTTP', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn()

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState({ Transactions: [] }),
      reason: 'duplicate-paid-order',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'skipped', detail: 'no-refundable-transaction' })
    expect(refund).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('duplicate-paid-order + Succeeded → Barion refund + helyi refunded nyom', async () => {
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [{ TransactionId: TRANSACTION_ID, Status: 'Refunded' }],
      }
    })

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'duplicate-paid-order',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'refunded' })
    expect(refund).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      transactionsToRefund: [{ transactionId: TRANSACTION_ID, amountToRefund: ORDER_TOTAL_HUF }],
    })
    expect(order.status).toBe('refunded')
    expect(order.refundReason).toBe(hungarianAutoRefundReason('duplicate-paid-order'))
    expect(order.refunds).toEqual([
      expect.objectContaining({
        transactionId: TRANSACTION_ID,
        amountHuf: ORDER_TOTAL_HUF,
        status: 'Refunded',
        type: 'full',
      }),
    ])
    expect(updates.length).toBeGreaterThanOrEqual(1)
  })

  it('staff-kötés reject → refund, kötés NINCS (csak a refund-nyom)', async () => {
    const order = createOrder({ status: 'payment_pending', customer: null })
    const { payload } = createMockPayload(order)
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [{ TransactionId: TRANSACTION_ID, Status: 'Succeeded' }],
      }
    })

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'guest-bind-privileged-account',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'refunded' })
    expect(order.customer).toBeNull()
    expect(order.status).toBe('refunded')
    expect(order.refundReason).toBe(hungarianAutoRefundReason('guest-bind-privileged-account'))
  })

  it('total-mismatch a Barion összegét téríti, nem a helyi snapshotot', async () => {
    const order = createOrder({ totalHufSnapshot: 19990 })
    const { payload } = createMockPayload(order)
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [{ TransactionId: TRANSACTION_ID, Status: 'Refunded' }],
      }
    })

    await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState({
        Total: 1,
        Transactions: [
          {
            TransactionId: TRANSACTION_ID,
            TransactionType: 'CardPayment',
            Status: 'Succeeded',
            Total: 1,
          },
        ],
      }),
      reason: 'total-mismatch',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(refund).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      transactionsToRefund: [{ transactionId: TRANSACTION_ID, amountToRefund: 1 }],
    })
  })

  it('már rögzített refund-nyom → skip, második HTTP nincs', async () => {
    const order = createOrder({
      refunds: [
        {
          transactionId: TRANSACTION_ID,
          amountHuf: ORDER_TOTAL_HUF,
          status: 'Refunded',
          refundedAt: '2026-08-28T00:00:00.000Z',
          type: 'full',
        },
      ],
    })
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn()

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'duplicate-paid-order',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'skipped', detail: 'already-recorded' })
    expect(refund).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('RefundFailed → failed, a rendelés NEM refunded', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [{ TransactionId: TRANSACTION_ID, Status: 'RefundFailed' }],
      }
    })

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'duplicate-paid-order',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'failed', detail: 'barion-refund-failed' })
    expect(order.status).toBe('payment_pending')
    expect(updates).toHaveLength(0)
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('RF-1: két párhuzamos recover ugyanarra a rendelésre → egy HTTP refund', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    let inFlight = 0
    let maxConcurrent = 0
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      inFlight += 1
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 40))
      inFlight -= 1
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [{ TransactionId: TRANSACTION_ID, Status: 'Refunded' }],
      }
    })
    const input = {
      payload,
      order,
      state: createState(),
      reason: 'duplicate-paid-order' as const,
      log: createLogger(),
      source: 'callback' as const,
      refundPayment: refund,
    }

    const [first, second] = await Promise.all([
      recoverRejectedSucceededPayment(input),
      recoverRejectedSucceededPayment(input),
    ])

    expect(refund).toHaveBeenCalledTimes(1)
    expect(maxConcurrent).toBe(1)
    expect([first.action, second.action].sort()).toEqual(['refunded', 'skipped'])
    expect(order.status).toBe('refunded')
    expect(order.refunds).toHaveLength(1)
  })

  it('RF-2: GetState PartiallyRefunded → nem refunded, type partial, nincs HTTP', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn()

    const result = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState({
        Transactions: [
          {
            TransactionId: TRANSACTION_ID,
            TransactionType: 'CardPayment',
            Status: 'PartiallyRefunded',
            Total: ORDER_TOTAL_HUF,
          },
        ],
      }),
      reason: 'duplicate-paid-order',
      log: createLogger(),
      source: 'order-poll',
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'skipped', detail: 'barion-partially-refunded' })
    expect(refund).not.toHaveBeenCalled()
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([
      expect.objectContaining({ type: 'partial', status: 'PartiallyRefunded' }),
    ])
    expect(updates.some((row) => row.status === 'refunded')).toBe(false)
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('RF-2: Barion refund PartiallyRefunded → nem refunded, nincs második HTTP', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [{ TransactionId: TRANSACTION_ID, Status: 'PartiallyRefunded' }],
      }
    })

    const first = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'total-mismatch',
      log: createLogger(),
      source: 'checkout-start',
      refundPayment: refund,
    })
    const second = await recoverRejectedSucceededPayment({
      payload,
      order,
      state: createState(),
      reason: 'total-mismatch',
      log: createLogger(),
      source: 'checkout-start',
      refundPayment: refund,
    })

    expect(first).toEqual({ action: 'skipped', detail: 'barion-partially-refunded' })
    expect(second).toEqual({ action: 'skipped', detail: 'barion-partially-refunded' })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([expect.objectContaining({ type: 'partial' })])
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })
})
