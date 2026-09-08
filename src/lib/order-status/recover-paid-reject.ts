import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { refundPayment, type BarionPaymentStateResponse } from '../barion'
import { validateRefundResponseProof } from '../barion/refund-response-proof'
import { autoRefundOperationKey } from '../refund/refund-intent'
import {
  createRefundIntent,
  loadActiveRefundIntent,
  loadRefundIntentsForOrder,
  transitionRefundIntent,
} from '../refund/intent-store'
import { assertUnusedRefundTransaction, RECEIPTS, writeReceipt } from '../refund/recovery-receipts'
import {
  commitAutomaticRefund,
  isAutomaticRefundIntent,
  isNeverPaidRefundCandidate,
  verifyAutomaticRefundCompletion,
} from '../refund/auto-refund-recovery'
import type { Logger } from '../logger'
import { refundLockKey } from '../refund/refund-order'

/** Automatic refunds share the owner intent ledger and order lock. A durable
 * prepared -> provider_started claim is the only permission for a provider POST.
 * Uncertain results remain active; acknowledged successes allow local recovery. */

export const AUTO_REFUND_REJECT_REASONS = [
  'duplicate-paid-order',
  'guest-bind-privileged-account',
  'total-mismatch',
] as const

export type AutoRefundRejectReason = (typeof AUTO_REFUND_REJECT_REASONS)[number]

export type PaidRejectRecoveryAction = 'refunded' | 'skipped' | 'failed'

export type RecoverPaidRejectSource = 'callback' | 'order-poll' | 'checkout-start'

export interface PaidRejectRecoveryResult {
  action: PaidRejectRecoveryAction
  detail?: string
}

export interface RecoverRejectedSucceededPaymentInput {
  payload: Payload
  order: Order
  /** A v4 GetState, amiből a paid-reject született (Succeeded). */
  state: BarionPaymentStateResponse
  reason: string
  log: Logger
  /** Melyik hívó indította: callback, poll vagy checkout. Kötelező a nyomhoz. */
  source: RecoverPaidRejectSource
  /** Injektálható (teszteléshez); alapból a valódi refundPayment. */
  refundPayment?: typeof refundPayment
}

export function isAutoRefundRejectReason(
  reason: string | undefined,
): reason is AutoRefundRejectReason {
  return reason !== undefined && (AUTO_REFUND_REJECT_REASONS as readonly string[]).includes(reason)
}

export function hungarianAutoRefundReason(reason: AutoRefundRejectReason): string {
  switch (reason) {
    case 'duplicate-paid-order':
      return 'Automatikus visszatérítés: a kurzushoz már van élő hozzáférés.'
    case 'guest-bind-privileged-account':
      return 'Automatikus visszatérítés: a fizetés staff vagy owner fiók e-mailjére érkezett, kötés tilos.'
    case 'total-mismatch':
      return 'Automatikus visszatérítés: a Barion összege nem egyezik a rendeléssel.'
  }
}

/** Egységes naplómezők: callback, poll és checkout ugyanazt írja. */
export function paidRejectRecoveryLogContext(input: {
  source: RecoverPaidRejectSource
  action: PaidRejectRecoveryAction
  detail?: string
  reason: string
  orderId: number
}): Record<string, unknown> {
  return {
    source: input.source,
    action: input.action,
    detail: input.detail ?? null,
    reason: input.reason,
    orderId: input.orderId,
  }
}

export interface RefundableBarionTransaction {
  transactionId: string
  amountHuf: number
  /** Csak a Barion `Refunded` — a `PartiallyRefunded` NEM teljes (RF-2). */
  alreadyRefunded: boolean
  alreadyPartiallyRefunded: boolean
}

/**
 * Visszatéríthető kártyás tranzakció a GetState Transactions tömbjéből.
 * Az orders nem tárol TransactionId-t (ugyanaz a szabály, mint a refundOrder).
 */
export function pickRefundableTransaction(
  state: BarionPaymentStateResponse,
): RefundableBarionTransaction | null {
  const transactions = state.Transactions ?? []
  const refundable =
    transactions.find((tx) => tx.TransactionType === 'CardPayment' && tx.Status === 'Succeeded') ??
    transactions.find((tx) => tx.TransactionType === 'CardPayment') ??
    transactions.find((tx) => tx.Status === 'Succeeded') ??
    transactions[0]
  if (
    !refundable ||
    typeof refundable.TransactionId !== 'string' ||
    refundable.TransactionId.length === 0
  ) {
    return null
  }
  const amountFromTx =
    typeof refundable.Total === 'number' &&
    Number.isFinite(refundable.Total) &&
    refundable.Total > 0
      ? refundable.Total
      : null
  const amountFromState =
    typeof state.Total === 'number' && Number.isFinite(state.Total) && state.Total > 0
      ? state.Total
      : null
  const amountHuf = amountFromTx ?? amountFromState
  if (amountHuf === null) {
    return null
  }
  const status = typeof refundable.Status === 'string' ? refundable.Status : ''
  return {
    transactionId: refundable.TransactionId,
    amountHuf,
    alreadyRefunded: status === 'Refunded',
    alreadyPartiallyRefunded: status === 'PartiallyRefunded',
  }
}

/** A verified GetState is correlated again to the freshly locked order before any intent. */
export async function recoverRejectedSucceededPayment(
  input: RecoverRejectedSucceededPaymentInput,
): Promise<PaidRejectRecoveryResult> {
  const { payload, state, log } = input
  const reconciliationOnly = input.reason === 'refund-pending-reconciliation'
  const reason = isAutoRefundRejectReason(input.reason) ? input.reason : null
  if (reason === null && !reconciliationOnly)
    return { action: 'skipped', detail: 'reason-not-refundable' }
  let providerClaimed = false
  try {
    return await withAdvisoryLock(
      payload,
      refundLockKey(input.order.id),
      async () => {
        const order = await payload.findByID({
          collection: 'orders',
          id: input.order.id,
          depth: 0,
          overrideAccess: true,
        })
        const active = await loadActiveRefundIntent(payload, order.id)
        if (active) {
          if (isAutomaticRefundIntent(active) && active.state === 'provider_succeeded') {
            await commitAutomaticRefund(payload, order, active)
            return { action: 'refunded' as const, detail: 'local-recovery-completed' }
          }
          return { action: 'failed' as const, detail: 'refund-pending-reconciliation' }
        }
        const history = await loadRefundIntentsForOrder(payload, order.id)
        if (order.status === 'refunded') {
          if (
            history.length === 1 &&
            isAutomaticRefundIntent(history[0]) &&
            (await verifyAutomaticRefundCompletion(payload, order, history[0]))
          )
            return { action: 'refunded' as const, detail: 'already-refunded' }
          return { action: 'failed' as const, detail: 'historical-refund-reconciliation-required' }
        }
        // Ez az ok egy már folyamatban levő refundról szól, nem új pénzművelet
        // felhatalmazása. Eltűnt/feloldott intent vagy verseny után sem indulhat POST.
        if (reconciliationOnly || reason === null)
          return { action: 'failed' as const, detail: 'refund-pending-reconciliation' }
        if (!isNeverPaidRefundCandidate(order) || history.length > 0)
          return { action: 'failed' as const, detail: 'order-state-reconciliation-required' }
        if (
          typeof order.barionPaymentId !== 'string' ||
          state.PaymentId !== order.barionPaymentId ||
          state.Status !== 'Succeeded' ||
          state.Currency !== 'HUF' ||
          typeof state.Total !== 'number' ||
          !Number.isSafeInteger(state.Total) ||
          state.Total <= 0 ||
          !Array.isArray(state.Transactions)
        )
          return { action: 'failed' as const, detail: 'payment-state-unproven' }
        // This shop starts one immediate card transaction. Ambiguous/multiple funding is manual.
        const candidates = state.Transactions.filter((tx) => tx.TransactionType === 'CardPayment')
        const tx = candidates.length === 1 ? candidates[0] : null
        if (
          !tx ||
          tx.Status !== 'Succeeded' ||
          typeof tx.TransactionId !== 'string' ||
          !tx.TransactionId.trim() ||
          typeof tx.POSTransactionId !== 'string' ||
          !tx.POSTransactionId.trim() ||
          typeof tx.Total !== 'number' ||
          tx.Total !== state.Total ||
          !Number.isSafeInteger(tx.Total) ||
          state.Transactions.filter((item) => item.TransactionId === tx.TransactionId).length !== 1
        )
          return { action: 'failed' as const, detail: 'source-transaction-unproven' }
        const intentReason = hungarianAutoRefundReason(reason)
        let intent = await createRefundIntent(
          payload,
          {
            schemaVersion: 2,
            actorId: null,
            actorKind: 'system',
            systemActor: 'paid-reject-recovery',
            orderId: String(order.id),
            provider: 'barion',
            providerPaymentId: order.barionPaymentId,
            providerTransactionId: tx.TransactionId,
            refundSequence: 1,
            requestedAmountHuf: tx.Total,
            currency: 'HUF',
            reason: intentReason,
          },
          autoRefundOperationKey({
            orderId: order.id,
            paymentId: order.barionPaymentId,
            transactionId: tx.TransactionId,
            reason,
          }),
        )
        await writeReceipt(payload, intent, RECEIPTS.prepared, {
          version: 2,
          operationKind: 'paid-reject-recovery',
          originalStatus: order.status,
          paymentId: intent.providerPaymentId,
          transactionId: intent.providerTransactionId,
          posTransactionId: tx.POSTransactionId,
          amountHuf: tx.Total,
          reason: intentReason,
        })
        intent = await transitionRefundIntent(payload, intent, 'provider_started')
        providerClaimed = true
        let response
        try {
          response = await (input.refundPayment ?? refundPayment)({
            paymentId: intent.providerPaymentId,
            transactionsToRefund: [
              {
                transactionId: intent.providerTransactionId,
                posTransactionId: tx.POSTransactionId,
                amountToRefund: intent.requestedAmountHuf,
              },
            ],
          })
        } catch {
          try {
            await transitionRefundIntent(payload, intent, 'provider_unknown')
          } catch {
            /* The launch claim remains blocking. */
          }
          return { action: 'failed' as const, detail: 'refund-pending-reconciliation' }
        }
        const proof = validateRefundResponseProof(response, {
          paymentId: intent.providerPaymentId,
          sourceTransactionId: intent.providerTransactionId,
          posTransactionId: tx.POSTransactionId,
          amountHuf: intent.requestedAmountHuf,
        })
        if (!proof) {
          await transitionRefundIntent(payload, intent, 'provider_unknown')
          return { action: 'failed' as const, detail: 'refund-pending-reconciliation' }
        }
        await assertUnusedRefundTransaction(payload, intent, proof.refundTransactionId)
        await writeReceipt(payload, intent, RECEIPTS.provider, {
          version: 2,
          operationKind: 'paid-reject-recovery',
          paymentId: intent.providerPaymentId,
          transactionId: intent.providerTransactionId,
          refundTransactionId: proof.refundTransactionId,
          posTransactionId: tx.POSTransactionId,
          amountHuf: intent.requestedAmountHuf,
          status: proof.status,
          type: 'full',
        })
        intent = await transitionRefundIntent(payload, intent, 'provider_succeeded')
        await commitAutomaticRefund(payload, order, intent)
        return { action: 'refunded' as const }
      },
      log,
    )
  } catch {
    log.warn('paid-reject recovery: tartós állapot ellenőrzése szükséges', {
      orderId: input.order.id,
      source: input.source,
      reason: input.reason,
    })
    return {
      action: 'failed',
      detail: providerClaimed ? 'refund-pending-reconciliation' : 'refund-reconciliation-required',
    }
  }
}
