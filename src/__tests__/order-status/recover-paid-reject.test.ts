import { fixture, store } from '../refund-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BarionPaymentStateResponse, BarionRefundResponse } from '../../lib/barion'
import { createLogger } from '../../lib/logger'
import {
  AUTO_REFUND_REJECT_REASONS,
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
const POS_TRANSACTION_ID = 'DUMMY-ORIGINAL-SHOP-TRANSACTION'
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
        POSTransactionId: POS_TRANSACTION_ID,
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
  const { payload } = fixture(order)
  const update = vi.mocked(payload.update).getMockImplementation()!
  vi.mocked(payload.update).mockImplementation(async (args) => {
    updates.push(args.data as Record<string, unknown>)
    return update(args)
  })
  return { payload, updates }
}

describe('isAutoRefundRejectReason', () => {
  it.each([...AUTO_REFUND_REJECT_REASONS])('%s → refundolható', (reason) => {
    expect(isAutoRefundRejectReason(reason)).toBe(true)
  })

  it.each(['paid-not-allowed', 'cancel-not-allowed', 'unknown', undefined])(
    '%s → nem refundolható',
    (reason) => {
      expect(isAutoRefundRejectReason(reason)).toBe(false)
    },
  )

  it('a lista az EGYETLEN forrás: minden más ok elutasított', () => {
    const reasons: readonly string[] = AUTO_REFUND_REJECT_REASONS
    expect(reasons).toHaveLength(new Set(reasons).size)
    for (const reason of ['paid-not-allowed', 'cancel-not-allowed', 'total-mismatch-x', '']) {
      expect(isAutoRefundRejectReason(reason)).toBe(reasons.includes(reason))
    }
  })
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
  it.each([undefined, '', '   ', '\n\t', null, 0, false])(
    'hiányzó vagy hibás eredeti POSTransactionId esetén refund és helyi írás előtt leáll: %j',
    async (posTransactionId) => {
      const order = createOrder()
      const { payload, updates } = createMockPayload(order)
      const refund = vi.fn()
      const state = createState()
      state.Transactions[0]!.POSTransactionId = posTransactionId as unknown as string
      const result = await recoverRejectedSucceededPayment({
        payload,
        order,
        state,
        reason: 'duplicate-paid-order',
        log: createLogger(),
        source: 'callback',
        refundPayment: refund,
      })
      expect(result).toEqual({ action: 'failed', detail: 'source-transaction-unproven' })
      expect(refund).not.toHaveBeenCalled()
      expect(updates).toHaveLength(0)
      expect(order.status).toBe('payment_pending')
    },
  )

  it.each([POS_TRANSACTION_ID, 'DUMMY-OTHER-SHOP-TRANSACTION', undefined])(
    'duplikált Barion TransactionId akkor sem egyértelmű, ha a kereskedői azonosító %j',
    async (duplicatePosId) => {
      const order = createOrder()
      const { payload, updates } = createMockPayload(order)
      const refund = vi.fn()
      const state = createState()
      state.Transactions.push({ ...state.Transactions[0]!, POSTransactionId: duplicatePosId })
      const result = await recoverRejectedSucceededPayment({
        payload,
        order,
        state,
        reason: 'total-mismatch',
        log: createLogger(),
        source: 'order-poll',
        refundPayment: refund,
      })
      expect(result).toEqual({ action: 'failed', detail: 'source-transaction-unproven' })
      expect(refund).not.toHaveBeenCalled()
      expect(updates).toHaveLength(0)
    },
  )

  it('a kiválasztott tranzakció kereskedői azonosítóját használja, nem az első elemét', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const state = createState()
    state.Transactions.unshift({
      TransactionId: 'DUMMY-UNRELATED-TRANSACTION',
      POSTransactionId: 'DUMMY-UNRELATED-POS-ID',
      TransactionType: 'Fee',
      Status: 'Succeeded',
      Total: 100,
    })
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => ({
      PaymentId: PAYMENT_ID,
      RefundedTransactions: [
        {
          TransactionId: TRANSACTION_ID,
          POSTransactionId: POS_TRANSACTION_ID,
          Total: ORDER_TOTAL_HUF,
          Status: 'Succeeded',
        },
      ],
    }))
    expect(
      await recoverRejectedSucceededPayment({
        payload,
        order,
        state,
        reason: 'duplicate-paid-order',
        log: createLogger(),
        source: 'callback',
        refundPayment: refund,
      }),
    ).toEqual({ action: 'refunded' })
    expect(refund).toHaveBeenCalledExactlyOnceWith({
      paymentId: PAYMENT_ID,
      transactionsToRefund: [
        {
          transactionId: TRANSACTION_ID,
          posTransactionId: POS_TRANSACTION_ID,
          amountToRefund: ORDER_TOTAL_HUF,
        },
      ],
    })
  })

  it('a régi Refunded állapotot korrelált bizonyíték nélkül nem alakítja helyi sikerre', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const state = createState()
    state.Transactions[0]!.Status = 'Refunded'
    delete state.Transactions[0]!.POSTransactionId
    const refund = vi.fn()
    expect(
      await recoverRejectedSucceededPayment({
        payload,
        order,
        state,
        reason: 'duplicate-paid-order',
        log: createLogger(),
        source: 'callback',
        refundPayment: refund,
      }),
    ).toEqual({ action: 'failed', detail: 'source-transaction-unproven' })
    expect(refund).not.toHaveBeenCalled()
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([])
  })

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

  it('üres Transactions → ellenőrzés szükséges, nincs HTTP', async () => {
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

    expect(result).toEqual({ action: 'failed', detail: 'source-transaction-unproven' })
    expect(refund).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('duplicate-paid-order + Succeeded → Barion refund + helyi refunded nyom', async () => {
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      return {
        PaymentId: PAYMENT_ID,
        RefundedTransactions: [
          {
            TransactionId: TRANSACTION_ID,
            POSTransactionId: POS_TRANSACTION_ID,
            Total: ORDER_TOTAL_HUF,
            Status: 'Succeeded',
          },
        ],
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
      transactionsToRefund: [
        {
          transactionId: TRANSACTION_ID,
          posTransactionId: POS_TRANSACTION_ID,
          amountToRefund: ORDER_TOTAL_HUF,
        },
      ],
    })
    expect(order.status).toBe('refunded')
    expect(order.refundReason).toBe(hungarianAutoRefundReason('duplicate-paid-order'))
    expect(order.refunds).toEqual([
      expect.objectContaining({
        transactionId: TRANSACTION_ID,
        amountHuf: ORDER_TOTAL_HUF,
        status: 'Succeeded',
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
        RefundedTransactions: [
          {
            TransactionId: TRANSACTION_ID,
            POSTransactionId: POS_TRANSACTION_ID,
            Total: ORDER_TOTAL_HUF,
            Status: 'Succeeded',
          },
        ],
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
        RefundedTransactions: [
          {
            TransactionId: TRANSACTION_ID,
            POSTransactionId: POS_TRANSACTION_ID,
            Total: 1,
            Status: 'Succeeded',
          },
        ],
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
            POSTransactionId: POS_TRANSACTION_ID,
          },
        ],
      }),
      reason: 'total-mismatch',
      log: createLogger(),
      source: 'callback',
      refundPayment: refund,
    })

    expect(order.refunds).toEqual([expect.objectContaining({ amountHuf: 1, status: 'Succeeded' })])
    expect(refund).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      transactionsToRefund: [
        { transactionId: TRANSACTION_ID, posTransactionId: POS_TRANSACTION_ID, amountToRefund: 1 },
      ],
    })
  })

  it('régi helyi refund-nyom → ellenőrzés szükséges, második HTTP nincs', async () => {
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

    expect(result).toEqual({ action: 'failed', detail: 'order-state-reconciliation-required' })
    expect(refund).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('RefundFailed → failed, a rendelés NEM refunded', async () => {
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

    expect(result).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(order.status).toBe('payment_pending')
    expect(updates).toHaveLength(0)
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
        RefundedTransactions: [
          {
            TransactionId: TRANSACTION_ID,
            POSTransactionId: POS_TRANSACTION_ID,
            Total: ORDER_TOTAL_HUF,
            Status: 'Succeeded',
          },
        ],
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
    expect([first.action, second.action].sort()).toEqual(['refunded', 'refunded'])
    expect(order.status).toBe('refunded')
    expect(order.refunds).toHaveLength(1)
  })

  it('RF-2: GetState PartiallyRefunded → nincs kitalált refund összeg, nincs HTTP', async () => {
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

    expect(result).toEqual({ action: 'failed', detail: 'source-transaction-unproven' })
    expect(refund).not.toHaveBeenCalled()
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([])
    expect(updates.some((row) => row.status === 'refunded')).toBe(false)
  })

  it('RF-2: Barion refund PartiallyRefunded → nem refunded, nincs második HTTP', async () => {
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

    expect(first).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(second).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([])
    expect(store.intents.get(payload)?.state).toBe('provider_unknown')
  })
})
