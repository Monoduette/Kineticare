import { fixture, store } from '../refund-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BarionApiError,
  type BarionPaymentStateResponse,
  type BarionRefundResponse,
} from '../../lib/barion'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { createLogger, type Logger } from '../../lib/logger'
import {
  AUTO_REFUND_REJECT_REASONS,
  automaticRefundRetryDelayMs,
  hungarianAutoRefundReason,
  isAutoRefundRejectReason,
  MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS,
  recoverRejectedSucceededPayment,
} from '../../lib/order-status/recover-paid-reject'
import { decideAutomaticRetry } from '../../lib/refund/automatic-retry'
import { selectRefundSourceTransaction } from '../../lib/refund/barion-refund-evidence'
import * as intentStore from '../../lib/refund/intent-store'
import { NO_PROVIDER_REQUEST_REFERENCE } from '../../lib/refund/refund-intent'
import type { Order, RefundIntent } from '../../payload-types'

// CLAUDE.md 15.: tesztből SOSEM mehet ki valódi hálózati hívás.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
  // A RIASZTÁS-fojtás folyamat-szintű állapota nem szivároghat át tesztek között.
  resetAlertThrottle()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const TRANSACTION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
/** A checkout a rendelés egyetlen tranzakciójának `${orderNumber}-1` kereskedői azonosítót ad. */
const POS_TRANSACTION_ID = 'KH-2026-000123-1'
const ORDER_TOTAL_HUF = 19990
const REFUND_COMMENT = 'Kineticare visszatérítés KH-2026-000123'
/** A közös fixture a Barion-kérés indítását 2026-09-05T10:00:01Z-re rögzíti. */
const STARTED_AT = Date.parse('2026-09-05T10:00:01.000Z')
const at = (minutes: number) => new Date(STARTED_AT + minutes * 60_000)

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

describe('selectRefundSourceTransaction (a kézi és az automatikus visszatérítés közös választója)', () => {
  it('üres Transactions → null (nincs HTTP)', () => {
    expect(selectRefundSourceTransaction(createState({ Transactions: [] }))).toBeNull()
  })

  it('Succeeded CardPayment → TransactionId, kereskedői azonosító és Barion-összeg', () => {
    expect(selectRefundSourceTransaction(createState())).toEqual({
      transactionId: TRANSACTION_ID,
      posTransactionId: POS_TRANSACTION_ID,
      totalHuf: ORDER_TOTAL_HUF,
    })
  })

  it('díj-tranzakciót akkor sem választ, ha az áll elöl és Succeeded (r-barion-8, a-refund-13)', () => {
    const state = createState()
    state.Transactions.unshift(
      {
        TransactionId: 'fee00000-0000-0000-0000-000000000001',
        POSTransactionId: POS_TRANSACTION_ID,
        TransactionType: 'GatewayFee',
        Status: 'Succeeded',
        Total: 100,
      },
      {
        TransactionId: 'fee00000-0000-0000-0000-000000000002',
        POSTransactionId: '',
        TransactionType: 'CardProcessingFee',
        Status: 'Succeeded',
        Total: 298,
      },
    )
    expect(selectRefundSourceTransaction(state)?.transactionId).toBe(TRANSACTION_ID)
  })

  it.each(['Shop', 'BankTransferPayment'])(
    'a dokumentáltan visszatéríthető %s típust is elfogadja',
    (type) => {
      const state = createState()
      state.Transactions[0]!.TransactionType = type
      expect(selectRefundSourceTransaction(state)?.transactionId).toBe(TRANSACTION_ID)
    },
  )

  it.each(['Refunded', 'PartiallyRefunded', 'Prepared', undefined])(
    'nem Succeeded (%s) forrás nem választható',
    (status) => {
      const state = createState()
      state.Transactions[0]!.Status = status
      expect(selectRefundSourceTransaction(state)).toBeNull()
    },
  )

  it('korábbi visszatérítés (RefundToBankCard, azonos kereskedői azonosítóval) nem forrás', () => {
    const state = createState()
    state.Transactions.push({
      TransactionId: 'bbbbbbbb-0000-0000-0000-000000000001',
      POSTransactionId: POS_TRANSACTION_ID,
      TransactionType: 'RefundToBankCard',
      Status: 'Succeeded',
      Total: 5000,
      RelatedId: TRANSACTION_ID,
    })
    expect(selectRefundSourceTransaction(state)?.transactionId).toBe(TRANSACTION_ID)
  })

  it('a várt kereskedői azonosítót (`${orderNumber}-1`) megadva csak arra illő forrást ad', () => {
    const other = createState()
    other.Transactions[0]!.POSTransactionId = 'DUMMY-OTHER-SHOP-TRANSACTION'
    expect(
      selectRefundSourceTransaction(other, { posTransactionId: 'KH-2026-000123-1' }),
    ).toBeNull()
    const state = createState()
    state.Transactions[0]!.POSTransactionId = 'KH-2026-000123-1'
    expect(
      selectRefundSourceTransaction(state, { posTransactionId: 'KH-2026-000123-1' }),
    ).toMatchObject({ transactionId: TRANSACTION_ID, posTransactionId: 'KH-2026-000123-1' })
  })

  it('két visszatéríthető jelölt esetén nem választ', () => {
    const state = createState()
    state.Transactions.push({
      ...state.Transactions[0]!,
      TransactionId: 'cccccccc-0000-0000-0000-000000000001',
    })
    expect(selectRefundSourceTransaction(state)).toBeNull()
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
          comment: REFUND_COMMENT,
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
          comment: REFUND_COMMENT,
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
        {
          transactionId: TRANSACTION_ID,
          posTransactionId: POS_TRANSACTION_ID,
          amountToRefund: 1,
          comment: REFUND_COMMENT,
        },
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
      // A Barion egy kérést legfeljebb 30 mp-ig dolgoz fel; negyedórán belül nincs nullhatás-döntés.
      now: at(5),
    })

    expect(first).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(second).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([])
    expect(store.intents.get(payload)?.state).toBe('provider_unknown')
  })
})

describe('automatikus visszatérítés: végleges Barion-elutasítás, egyeztetés, korlátozott újrapróbálás', () => {
  const REFUND_ID = 'dddddddd-eeee-ffff-0000-111111111111'

  function rejection(code: string, httpStatus = 400) {
    return new BarionApiError({
      kind: 'http',
      message: 'SYNTHETIC',
      endpoint: 'POST /v2/Payment/Refund',
      httpStatus,
      providerErrors: [{ ErrorCode: code, Title: 'SYNTHETIC', Description: 'SYNTHETIC' }],
    })
  }

  const succeeded = async (): Promise<BarionRefundResponse> => ({
    PaymentId: PAYMENT_ID,
    RefundedTransactions: [
      {
        TransactionId: REFUND_ID,
        POSTransactionId: POS_TRANSACTION_ID,
        Total: ORDER_TOTAL_HUF,
        Status: 'Succeeded',
      },
    ],
  })

  function setup(refund: ReturnType<typeof vi.fn>) {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const run = (now: Date, state = createState()) =>
      recoverRejectedSucceededPayment({
        payload,
        order,
        state,
        reason: 'duplicate-paid-order',
        log: createLogger(),
        source: 'order-poll',
        refundPayment: refund as never,
        now,
      })
    return { order, payload, run }
  }

  it('TooLowBalanceToMakeRefund: igazolt nullhatás, a kísérlet lezárul, és feltöltés után új kísérlet sikerül', async () => {
    const refund = vi.fn().mockRejectedValueOnce(rejection('TooLowBalanceToMakeRefund'))
    refund.mockImplementation(succeeded)
    const { order, payload, run } = setup(refund)

    expect(await run(at(1))).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(store.intents.get(payload)).toMatchObject({
      state: 'provider_failed',
      activeOrderKey: null,
      reconciliationReference: 'barion:refund-rejected:TooLowBalanceToMakeRefund',
    })
    expect(order.status).toBe('payment_pending')
    expect(order.refunds).toEqual([])

    // A várakozási időn belül nincs új pénz-POST.
    expect(await run(at(30))).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(refund).toHaveBeenCalledTimes(1)

    // Egy óra múlva új kísérlet, új műveletazonosítóval.
    expect(await run(at(1 + 61))).toEqual({ action: 'refunded' })
    expect(refund).toHaveBeenCalledTimes(2)
    expect(order.status).toBe('refunded')
    expect(order.refunds).toHaveLength(1)
    expect(store.history.get(payload)?.map((intent) => intent.state)).toEqual([
      'provider_failed',
      'committed',
    ])
    expect(store.keys.get(payload)?.size).toBe(2)

    // A lezárt, egyszer sikeres visszatérítés későbbi jelzésre sem indít újat.
    expect(await run(at(200))).toEqual({ action: 'refunded', detail: 'already-refunded' })
    expect(refund).toHaveBeenCalledTimes(2)
  })

  it.each(['PaymentStatusNotValid', 'AmountToRefundIsGreaterThanTransactionAmount'])(
    'a tulajdonos által nem javítható %s leállítja az automatikát',
    async (code) => {
      const refund = vi.fn().mockRejectedValue(rejection(code))
      const { payload, run } = setup(refund)
      expect(await run(at(1))).toEqual({ action: 'failed', detail: 'automatic-refund-rejected' })
      expect(store.intents.get(payload)?.state).toBe('provider_failed')
      expect(await run(at(60 * 24 * 7))).toEqual({
        action: 'failed',
        detail: 'automatic-refund-rejected',
      })
      expect(refund).toHaveBeenCalledTimes(1)
    },
  )

  it('a kód nélküli (okát nem ismert) nullhatású kísérletek száma korlátos, a várakozás nő', async () => {
    // Elveszett válasz → provider_unknown; negyedóra múlva a GetState-ben nincs
    // visszatérítés → kód nélküli nullhatás. Ennek ismétlése nem segít.
    const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
    const { payload, run } = setup(refund)
    let clock = at(1).getTime()
    for (let attempt = 1; attempt <= MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS; attempt += 1) {
      await run(new Date(clock))
      expect(refund).toHaveBeenCalledTimes(attempt)
      expect(store.intents.get(payload)?.state).toBe('provider_unknown')
      clock += 16 * 60_000
      await run(new Date(clock))
      expect(store.intents.get(payload)).toMatchObject({
        state: 'provider_failed',
        reconciliationReference: 'barion:paymentstate:no-refund-transaction',
      })
      clock += automaticRefundRetryDelayMs(attempt) + 60_000
    }
    expect(await run(new Date(clock))).toEqual({
      action: 'failed',
      detail: 'automatic-refund-attempts-exhausted',
    })
    expect(await run(new Date(clock + 30 * 86_400_000))).toEqual({
      action: 'failed',
      detail: 'automatic-refund-attempts-exhausted',
    })
    expect(refund).toHaveBeenCalledTimes(MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS)
    expect([1, 2, 3, 6, 9].map(automaticRefundRetryDelayMs)).toEqual(
      [1, 2, 4, 24, 24].map((hours) => hours * 3_600_000),
    )
  })

  it('TooLowBalanceToMakeRefund korlát nélkül, legfeljebb naponta újrapróbál; két POST sosem fut egyszerre (K6)', async () => {
    let balanceOk = false
    let inFlight = 0
    let maxConcurrent = 0
    let responseLoss = false
    const refund = vi.fn(async (): Promise<BarionRefundResponse> => {
      inFlight += 1
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      if (responseLoss) {
        responseLoss = false
        throw new Error('SYNTHETIC response loss')
      }
      if (!balanceOk) throw rejection('TooLowBalanceToMakeRefund')
      return succeeded()
    })
    const { order, payload, run } = setup(refund)
    const both = async (now: Date) => {
      const results = await Promise.all([run(now), run(now)])
      return results
    }
    let clock = at(1).getTime()
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await both(new Date(clock))
      expect(refund).toHaveBeenCalledTimes(attempt)
      expect(store.intents.get(payload)).toMatchObject({
        state: 'provider_failed',
        reconciliationReference: 'barion:refund-rejected:TooLowBalanceToMakeRefund',
      })
      // A várakozási időn belül (5 perces poll) nincs új pénz-POST.
      expect(await run(new Date(clock + 5 * 60_000))).toEqual({
        action: 'failed',
        detail: 'refund-pending-reconciliation',
      })
      expect(refund).toHaveBeenCalledTimes(attempt)
      clock += automaticRefundRetryDelayMs(attempt) + 60_000
    }
    // A 12 elutasítás után a várakozás a 24 órás plafonon áll.
    expect(automaticRefundRetryDelayMs(12)).toBe(24 * 3_600_000)
    // Egy kód nélküli nullhatás (elveszett válasz, majd a GetState-ben nincs
    // visszatérítés) sem állítja le az automatikát.
    // (Egyetlen futás: a közös fixture az indítást rögzített időre teszi, így
    // egy párhuzamos második futás azonnal egyeztetne.)
    responseLoss = true
    await run(new Date(clock))
    expect(refund).toHaveBeenCalledTimes(13)
    expect(store.intents.get(payload)?.state).toBe('provider_unknown')
    clock += 16 * 60_000
    await run(new Date(clock))
    expect(store.intents.get(payload)).toMatchObject({
      state: 'provider_failed',
      reconciliationReference: 'barion:paymentstate:no-refund-transaction',
    })
    // A tárca közben feltöltődött: a következő napi kísérlet visszatérít.
    balanceOk = true
    clock += automaticRefundRetryDelayMs(13) + 60_000
    const [first, second] = await both(new Date(clock))
    expect([first.action, second.action]).toEqual(['refunded', 'refunded'])
    expect(refund).toHaveBeenCalledTimes(14)
    expect(maxConcurrent).toBe(1)
    expect(order.status).toBe('refunded')
    expect(order.refunds).toHaveLength(1)
    const states = store.history.get(payload)?.map((intent) => intent.state)
    expect(states?.filter((state) => state === 'provider_failed')).toHaveLength(13)
    expect(states?.filter((state) => state === 'committed')).toHaveLength(1)
    expect(store.keys.get(payload)?.size).toBe(14)
    expect(await run(new Date(clock + 86_400_000))).toEqual({
      action: 'refunded',
      detail: 'already-refunded',
    })
    expect(refund).toHaveBeenCalledTimes(14)
  })

  it.each([
    ['timeout', undefined],
    ['network', undefined],
    ['http', 500],
    ['http', 400],
    ['invalid_response', 200],
  ] as const)(
    'ismeretlen kimenet (%s %s) nem lesz nullhatás, a kísérlet blokkol',
    async (kind, httpStatus) => {
      const refund = vi.fn().mockRejectedValue(
        new BarionApiError({
          kind,
          message: 'SYNTHETIC',
          endpoint: 'POST /v2/Payment/Refund',
          httpStatus,
          providerErrors:
            kind === 'http' && httpStatus === 400
              ? [{ ErrorCode: 'InternalServerError', Title: '', Description: '' }]
              : [],
        }),
      )
      const { payload, run } = setup(refund)
      expect(await run(at(1))).toEqual({
        action: 'failed',
        detail: 'refund-pending-reconciliation',
      })
      expect(store.intents.get(payload)?.state).toBe('provider_unknown')
      expect(await run(at(10))).toEqual({
        action: 'failed',
        detail: 'refund-pending-reconciliation',
      })
      expect(store.intents.get(payload)?.state).toBe('provider_unknown')
      expect(refund).toHaveBeenCalledTimes(1)
    },
  )

  it('ismeretlen kimenet után a GetState-ben látszó sikeres visszatérítést új POST nélkül rögzíti', async () => {
    const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
    const { order, payload, run } = setup(refund)
    await run(at(1))
    expect(store.intents.get(payload)?.state).toBe('provider_unknown')
    const after = createState({ Total: 0 })
    after.Transactions.push({
      TransactionId: REFUND_ID,
      POSTransactionId: POS_TRANSACTION_ID,
      TransactionType: 'RefundToBankCard',
      Status: 'Succeeded',
      Total: ORDER_TOTAL_HUF,
      RelatedId: TRANSACTION_ID,
    })
    expect(await run(at(3), after)).toEqual({ action: 'refunded', detail: 'provider-reconciled' })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(order.status).toBe('refunded')
    expect(store.intents.get(payload)?.state).toBe('committed')
  })

  it('ismeretlen kimenet után csak a várakozási idő leteltével lesz GetState-alapú nullhatás', async () => {
    const refund = vi.fn().mockRejectedValueOnce(new Error('SYNTHETIC response loss'))
    refund.mockImplementation(succeeded)
    const { order, payload, run } = setup(refund)
    await run(at(1))
    expect(await run(at(14))).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(store.intents.get(payload)?.state).toBe('provider_unknown')
    expect(await run(at(16))).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(store.intents.get(payload)).toMatchObject({
      state: 'provider_failed',
      reconciliationReference: 'barion:paymentstate:no-refund-transaction',
    })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(await run(at(16 + 61))).toEqual({ action: 'refunded' })
    expect(refund).toHaveBeenCalledTimes(2)
    expect(order.status).toBe('refunded')
  })

  it('eltérő Barion-összeg (pl. a Barion felületén indított visszatérítés) mellett nincs nullhatás-döntés', async () => {
    const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
    const { payload, run } = setup(refund)
    await run(at(1))
    expect(await run(at(60), createState({ Total: 9990 }))).toEqual({
      action: 'failed',
      detail: 'refund-pending-reconciliation',
    })
    expect(store.intents.get(payload)?.state).toBe('provider_unknown')
  })

  it('előkészítés közben elakadt kísérletet Barion-hívás nélkül lezárja', async () => {
    const refund = vi.fn(succeeded)
    const order = createOrder()
    const f = fixture(order)
    f.failures.receipt = 'refund-prepared'
    const run = (now: Date) =>
      recoverRejectedSucceededPayment({
        payload: f.payload,
        order,
        state: createState(),
        reason: 'duplicate-paid-order',
        log: createLogger(),
        source: 'callback',
        refundPayment: refund,
        now,
      })
    expect(await run(at(1))).toEqual({ action: 'failed', detail: 'refund-pending-reconciliation' })
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'provider_failed',
      reconciliationReference: NO_PROVIDER_REQUEST_REFERENCE,
    })
    expect(store.intents.get(f.payload)?.providerStartedAt).toBeUndefined()
    expect(refund).not.toHaveBeenCalled()
    f.failures.receipt = ''
    expect(await run(at(62))).toEqual({ action: 'refunded' })
    expect(refund).toHaveBeenCalledTimes(1)
  })

  it('Barion-egyenlegből fizetett (Shop) dupla vásárlást is visszatérít', async () => {
    const refund = vi.fn(succeeded)
    const { order, run } = setup(refund)
    const state = createState()
    state.Transactions[0]!.TransactionType = 'Shop'
    expect(await run(at(1), state)).toEqual({ action: 'refunded' })
    expect(order.status).toBe('refunded')
  })

  it('kötőjel nélküli, nagybetűs Barion PaymentId-vel is korrelál (PR #303 kanonikus alak)', async () => {
    const refund = vi.fn(succeeded)
    const { order, run } = setup(refund)
    const state = createState({ PaymentId: PAYMENT_ID.replaceAll('-', '').toUpperCase() })
    expect(await run(at(1), state)).toEqual({ action: 'refunded' })
    expect(order.status).toBe('refunded')
  })

  it('két, egymásra rakódó futásból sosem indul kétszer ugyanaz a napi kísérlet', async () => {
    const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
    const { payload, run } = setup(refund)
    await run(at(1))
    // A várakozás lejártakor az 5 perces poll és egy callback egyszerre fut.
    const later = new Date(at(1).getTime() + automaticRefundRetryDelayMs(1) + 60_000)
    await Promise.all([run(later), run(later), run(later)])
    expect(refund).toHaveBeenCalledTimes(2)
    expect(store.keys.get(payload)?.size).toBe(2)
  })

  it('más kereskedői azonosítójú (nem `${orderNumber}-1`) fizetési tranzakcióra nem indít visszatérítést', async () => {
    const refund = vi.fn(succeeded)
    const { order, payload, run } = setup(refund)
    const state = createState()
    state.Transactions[0]!.POSTransactionId = 'MAS-RENDSZER-POS-1'
    expect(await run(at(1), state)).toEqual({
      action: 'failed',
      detail: 'source-transaction-unproven',
    })
    expect(refund).not.toHaveBeenCalled()
    expect(store.intents.get(payload)).toBeUndefined()
    expect(order.status).toBe('payment_pending')
  })

  it.each([
    ['sikeres', 'RefundToBankCard', 'Succeeded'],
    ['folyamatban lévő', 'Refund', 'Started'],
    ['sztornózott', 'StornoUnSuccessfulRefundToBankCard', 'Succeeded'],
  ])(
    'a forrásra már %s visszatérítés van (pl. a Barion felületén, K17): nincs új POST, csak riasztás',
    async (_label, type, status) => {
      const refund = vi.fn(succeeded)
      const { order, payload, run } = setup(refund)
      const state = createState()
      state.Transactions.push({
        TransactionId: REFUND_ID,
        POSTransactionId: POS_TRANSACTION_ID,
        TransactionType: type,
        Status: status,
        Total: ORDER_TOTAL_HUF,
        RelatedId: TRANSACTION_ID,
      })
      expect(await run(at(1), state)).toEqual({
        action: 'failed',
        detail: 'foreign-refund-detected',
      })
      expect(refund).not.toHaveBeenCalled()
      expect(store.intents.get(payload)).toBeUndefined()
      expect(order.status).toBe('payment_pending')
    },
  )

  it('egy elutasított (pénzt nem mozgató) visszatérítés-tranzakció nem akadálya az új kísérletnek', async () => {
    const refund = vi.fn(succeeded)
    const { order, run } = setup(refund)
    const state = createState()
    state.Transactions.push({
      TransactionId: REFUND_ID,
      POSTransactionId: POS_TRANSACTION_ID,
      TransactionType: 'RefundToBankCard',
      Status: 'Rejected',
      Total: ORDER_TOTAL_HUF,
      RelatedId: TRANSACTION_ID,
    })
    expect(await run(at(1), state)).toEqual({ action: 'refunded' })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(order.status).toBe('refunded')
  })

  describe('RIASZTÁS: sorozat-küszöb és fojtás rendelésenként', () => {
    function spyLogger() {
      const calls = { error: [] as string[], warn: [] as string[] }
      const log: Logger = {
        debug: () => {},
        info: () => {},
        warn: (message) => {
          calls.warn.push(message)
        },
        error: (message) => {
          calls.error.push(message)
        },
        child: () => log,
      }
      return { log, calls }
    }

    it('javítható elutasításnál a 3. kísérlettől riaszt, utána naponta legfeljebb egyszer', async () => {
      const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
      const order = createOrder()
      const { payload } = createMockPayload(order)
      const { log, calls } = spyLogger()
      const run = (now: Date) =>
        recoverRejectedSucceededPayment({
          payload,
          order,
          state: createState(),
          reason: 'guest-bind-privileged-account',
          log,
          source: 'order-poll',
          refundPayment: refund as never,
          now,
        })
      const alerts = () => calls.error.filter((message) => message.startsWith('RIASZTÁS'))
      let clock = at(1).getTime()
      const attemptAt: number[] = []
      for (let attempt = 1; attempt <= 7; attempt += 1) {
        attemptAt.push(clock)
        await run(new Date(clock))
        // Az 5 perces poll a várakozás alatt sem ismétli a riasztást.
        await run(new Date(clock + 5 * 60_000))
        clock += automaticRefundRetryDelayMs(attempt) + 60_000
      }
      expect(refund).toHaveBeenCalledTimes(7)
      // 1. és 2. kísérlet: csak figyelmeztetés; 3. (≈ +3 óra): riasztás; 4–5. (+7,
      // +15 óra): a napi fojtáson belül; 6. (+31 óra): újra; 7. (+55 óra): újra.
      expect(calls.warn.length).toBeGreaterThanOrEqual(4)
      expect(alerts()).toHaveLength(3)
      for (const message of alerts()) {
        expect(message).toContain('nincs elég egyenleg a Barion-tárcában')
        expect(message).toContain('Tölts fel legalább 19 990 Ft')
      }
      expect(attemptAt[5]! - attemptAt[2]!).toBeGreaterThanOrEqual(24 * 3_600_000)
    })

    it('végleges leállásnál azonnal riaszt, az 5 perces ismétlésnél nem, egy nap múlva újra', async () => {
      const refund = vi.fn().mockRejectedValue(rejection('PaymentStatusNotValid'))
      const order = createOrder()
      const { payload } = createMockPayload(order)
      const { log, calls } = spyLogger()
      const run = (now: Date) =>
        recoverRejectedSucceededPayment({
          payload,
          order,
          state: createState(),
          reason: 'duplicate-paid-order',
          log,
          source: 'order-poll',
          refundPayment: refund as never,
          now,
        })
      const alerts = () => calls.error.filter((message) => message.startsWith('RIASZTÁS'))
      expect(await run(at(1))).toEqual({ action: 'failed', detail: 'automatic-refund-rejected' })
      expect(alerts()).toHaveLength(1)
      for (let minutes = 6; minutes < 24 * 60; minutes += 5) await run(at(minutes))
      expect(alerts()).toHaveLength(1)
      expect(await run(at(24 * 60 + 2))).toEqual({
        action: 'failed',
        detail: 'automatic-refund-rejected',
      })
      expect(alerts()).toHaveLength(2)
      expect(alerts()[1]).toContain('leállt')
      expect(refund).toHaveBeenCalledTimes(1)
    })
  })

  describe('előkészítésnél elakadt, aktív automatikus kísérlet (a következő futás zárja le)', () => {
    it.each(['duplicate-paid-order', 'refund-pending-reconciliation'] as const)(
      '%s: Barion-hívás nélkül lezárja, a várakozás után új kísérlet visszatérít',
      async (reason) => {
        const order = createOrder()
        const f = fixture(order)
        await intentStore.createRefundIntent(
          f.payload,
          {
            schemaVersion: 2,
            actorId: null,
            actorKind: 'system',
            systemActor: 'paid-reject-recovery',
            orderId: String(order.id),
            provider: 'barion',
            providerPaymentId: PAYMENT_ID,
            providerTransactionId: TRANSACTION_ID,
            refundSequence: 1,
            requestedAmountHuf: ORDER_TOTAL_HUF,
            currency: 'HUF',
            reason: 'SYNTHETIC',
          },
          'SYNTHETIC-STUCK-PREPARED',
        )
        expect(store.intents.get(f.payload)?.state).toBe('prepared')
        const refund = vi.fn(succeeded)
        const run = (now: Date, runReason: string) =>
          recoverRejectedSucceededPayment({
            payload: f.payload,
            order,
            state: createState(),
            reason: runReason,
            log: createLogger(),
            source: 'order-poll',
            refundPayment: refund as never,
            now,
          })
        expect(await run(at(1), reason)).toEqual({
          action: 'failed',
          detail: 'refund-pending-reconciliation',
        })
        expect(store.intents.get(f.payload)).toMatchObject({
          state: 'provider_failed',
          activeOrderKey: null,
          reconciliationReference: NO_PROVIDER_REQUEST_REFERENCE,
        })
        expect(refund).not.toHaveBeenCalled()
        // A következő poll még a várakozáson belül fut: nincs POST.
        expect(await run(at(6), 'duplicate-paid-order')).toEqual({
          action: 'failed',
          detail: 'refund-pending-reconciliation',
        })
        expect(refund).not.toHaveBeenCalled()
        expect(await run(at(62), 'duplicate-paid-order')).toEqual({ action: 'refunded' })
        expect(refund).toHaveBeenCalledTimes(1)
        expect(order.status).toBe('refunded')
      },
    )
  })

  describe('GetState-egyeztetés csak a saját, előkészítéskor rögzített nyugtához', () => {
    function refundedState() {
      const after = createState({ Total: 0 })
      after.Transactions.push({
        TransactionId: REFUND_ID,
        POSTransactionId: POS_TRANSACTION_ID,
        TransactionType: 'RefundToBankCard',
        Status: 'Succeeded',
        Total: ORDER_TOTAL_HUF,
        RelatedId: TRANSACTION_ID,
      })
      return after
    }

    type Audit = { action: string; after: unknown }
    it.each([
      [
        'eltérő kereskedői azonosító',
        (audits: Audit[]) => {
          const prepared = audits.find((audit) => audit.action === 'refund-prepared')!
          ;(prepared.after as Record<string, unknown>).posTransactionId = 'IDEGEN-POS-1'
        },
      ],
      [
        'más művelet nyugtája',
        (audits: Audit[]) => {
          const prepared = audits.find((audit) => audit.action === 'refund-prepared')!
          ;(prepared.after as Record<string, unknown>).operationKind = 'owner'
        },
      ],
      [
        'hiányzó nyugta',
        (audits: Audit[]) => {
          audits.splice(
            audits.findIndex((audit) => audit.action === 'refund-prepared'),
            1,
          )
        },
      ],
    ])(
      '%s mellett a Barion-sikert nem fogadja el sajátjának: nincs nyugta, nincs állapotváltás',
      async (_label, tamper) => {
        const order = createOrder()
        const f = fixture(order)
        const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
        const run = (now: Date, state = createState()) =>
          recoverRejectedSucceededPayment({
            payload: f.payload,
            order,
            state,
            reason: 'duplicate-paid-order',
            log: createLogger(),
            source: 'order-poll',
            refundPayment: refund as never,
            now,
          })
        expect(await run(at(1))).toEqual({
          action: 'failed',
          detail: 'refund-pending-reconciliation',
        })
        expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
        tamper(f.audits)
        expect(await run(at(3), refundedState())).toEqual({
          action: 'failed',
          detail: 'refund-pending-reconciliation',
        })
        expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
        expect(f.audits.filter((audit) => audit.action === 'refund-provider-succeeded')).toEqual([])
        expect(order.status).toBe('payment_pending')
        expect(order.refunds).toEqual([])
        expect(refund).toHaveBeenCalledTimes(1)
      },
    )
  })
})

describe('decideAutomaticRetry (a közös újrapróbálási szabály)', () => {
  const T0 = Date.parse('2026-09-05T10:00:00.000Z')
  const failure = (hours: number, reference: string) =>
    ({
      schemaVersion: 2,
      actor: null,
      actorKind: 'system',
      systemActor: 'paid-reject-recovery',
      state: 'provider_failed',
      activeOrderKey: null,
      reconciliationReference: reference,
      providerResolvedAt: new Date(T0 + hours * 3_600_000).toISOString(),
    }) as unknown as RefundIntent
  const LOW = 'barion:refund-rejected:TooLowBalanceToMakeRefund'
  const NO_REFUND = 'barion:paymentstate:no-refund-transaction'

  it('20 egymás utáni TooLowBalance után is naponta új kísérlet jár', () => {
    const failures = Array.from({ length: 20 }, (_, index) => failure(index * 24, LOW))
    expect(decideAutomaticRetry(failures, new Date(T0 + (19 * 24 + 23) * 3_600_000))).toEqual({
      kind: 'wait',
      notBefore: new Date(T0 + 20 * 24 * 3_600_000).toISOString(),
    })
    expect(decideAutomaticRetry(failures, new Date(T0 + 20 * 24 * 3_600_000))).toEqual({
      kind: 'launch',
      attempt: 21,
    })
  })

  it('csak a kód nélküli nullhatás fogy a keretből, a javítható elutasítás nem', () => {
    const mixed = [
      ...Array.from({ length: 12 }, (_, index) => failure(index, LOW)),
      ...Array.from({ length: MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS - 1 }, (_, index) =>
        failure(20 + index, index % 2 ? NO_REFUND : NO_PROVIDER_REQUEST_REFERENCE),
      ),
    ]
    expect(decideAutomaticRetry(mixed, new Date(T0 + 365 * 86_400_000)).kind).toBe('launch')
    const exhausted = [...mixed, failure(40, NO_REFUND)]
    expect(decideAutomaticRetry(exhausted, new Date(T0 + 365 * 86_400_000))).toEqual({
      kind: 'stop',
      detail: 'automatic-refund-attempts-exhausted',
    })
  })

  it('egy tulajdonos által nem javítható elutasítás bárhol a sorban végleges leállás', () => {
    const failures = [
      failure(0, 'barion:refund-rejected:AmountToRefundIsGreaterThanTransactionAmount'),
      failure(1, LOW),
    ]
    expect(decideAutomaticRetry(failures, new Date(T0 + 365 * 86_400_000))).toEqual({
      kind: 'stop',
      detail: 'automatic-refund-rejected',
    })
  })
})
