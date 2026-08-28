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
    })
  })

  it('már Refunded tranzakció → alreadyRefunded', () => {
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
    ).toMatchObject({ alreadyRefunded: true, transactionId: TRANSACTION_ID })
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
      refundPayment: refund,
    })

    expect(result).toEqual({ action: 'failed', detail: 'barion-refund-failed' })
    expect(order.status).toBe('payment_pending')
    expect(updates).toHaveLength(0)
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })
})
