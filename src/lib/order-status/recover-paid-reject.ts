import type { Payload } from 'payload'

import type { Order, RefundIntent } from '../../payload-types'
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
import {
  classifyRefundRejection,
  OWNER_FIXABLE_REJECTION_CODES,
  providerNoEffectEvidence,
  rejectionCodesFromReference,
  refundComment,
  rejectionReference,
  sameBarionId,
  selectRefundSourceTransaction,
} from '../refund/barion-refund-evidence'
import {
  reconcileLaunchedIntent,
  RECONCILABLE_LAUNCHED_STATES,
  releaseNeverLaunchedIntent,
} from '../refund/provider-reconciliation'
import type { Logger } from '../logger'
import { refundLockKey } from '../refund/refund-order'

/** Automatic refunds share the owner intent ledger and order lock. A durable
 * prepared -> provider_started claim is the only permission for a provider POST.
 * Uncertain results remain active; acknowledged successes allow local recovery.
 * A Barion végleges elutasítása (pl. TooLowBalanceToMakeRefund) igazolt
 * nullhatás: provider_failed, és a tulajdonos által javítható okoknál
 * korlátozott, egyre ritkább automatikus újrapróbálás következik. */

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
  /** Injektálható idő (teszteléshez); alapból a pillanatnyi idő. */
  now?: Date
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

/** Egy automatikus visszatérítés legfeljebb ennyi kísérletet kap. */
export const MAX_AUTOMATIC_REFUND_ATTEMPTS = 8
const AUTOMATIC_REFUND_RETRY_BASE_MS = 60 * 60_000
const AUTOMATIC_REFUND_RETRY_MAX_MS = 24 * 60 * 60_000

/** Várakozás az n-edik igazoltan hatástalan kísérlet után: 1, 2, 4, 8, 16, majd 24 óra. */
export function automaticRefundRetryDelayMs(failedAttempts: number): number {
  return Math.min(
    AUTOMATIC_REFUND_RETRY_MAX_MS,
    AUTOMATIC_REFUND_RETRY_BASE_MS * 2 ** Math.max(0, failedAttempts - 1),
  )
}

/** Igazoltan hatástalan (feloldott) automatikus kísérlet. */
function isResolvedAutomaticFailure(intent: RefundIntent): boolean {
  return (
    isAutomaticRefundIntent(intent) &&
    intent.state === 'provider_failed' &&
    intent.activeOrderKey == null &&
    typeof intent.reconciliationReference === 'string' &&
    typeof intent.providerResolvedAt === 'string'
  )
}

type AutomaticRetryDecision =
  | { kind: 'launch'; attempt: number }
  | { kind: 'wait'; notBefore: string }
  | { kind: 'stop'; detail: 'automatic-refund-rejected' | 'automatic-refund-attempts-exhausted' }

/**
 * Új kísérlet csak igazoltan hatástalan előzmények után indulhat. A tulajdonos
 * által nem javítható Barion-elutasítás (pl. PaymentStatusNotValid) megállítja
 * az automatikát; a javíthatóknál (egyenleg, fiók) egyre ritkábban próbálkozik.
 */
export function decideAutomaticRetry(
  failures: readonly RefundIntent[],
  now: Date,
): AutomaticRetryDecision {
  if (failures.length === 0) return { kind: 'launch', attempt: 1 }
  const last = [...failures].sort((a, b) =>
    String(a.providerResolvedAt).localeCompare(String(b.providerResolvedAt)),
  )[failures.length - 1]
  const codes = rejectionCodesFromReference(last.reconciliationReference)
  if (codes.some((code) => !OWNER_FIXABLE_REJECTION_CODES.has(code)))
    return { kind: 'stop', detail: 'automatic-refund-rejected' }
  if (failures.length >= MAX_AUTOMATIC_REFUND_ATTEMPTS)
    return { kind: 'stop', detail: 'automatic-refund-attempts-exhausted' }
  const notBefore =
    Date.parse(String(last.providerResolvedAt)) + automaticRefundRetryDelayMs(failures.length)
  if (!Number.isFinite(notBefore)) return { kind: 'stop', detail: 'automatic-refund-rejected' }
  if (now.getTime() < notBefore)
    return { kind: 'wait', notBefore: new Date(notBefore).toISOString() }
  return { kind: 'launch', attempt: failures.length + 1 }
}

const PENDING: PaidRejectRecoveryResult = {
  action: 'failed',
  detail: 'refund-pending-reconciliation',
}

/**
 * Aktív (le nem zárt) automatikus kísérlet a közös rendelés-zár alatt. A
 * hívó friss GetState-je az egyetlen bizonyítékforrás; új pénz-POST nincs.
 */
async function settleActiveAutomaticIntent(
  payload: Payload,
  order: Order,
  active: RefundIntent,
  state: BarionPaymentStateResponse,
  now: Date,
): Promise<PaidRejectRecoveryResult> {
  if (!isAutomaticRefundIntent(active)) return PENDING
  if (active.state === 'provider_succeeded') {
    await commitAutomaticRefund(payload, order, active)
    return { action: 'refunded', detail: 'local-recovery-completed' }
  }
  // A záron belül látott prepared kísérlet indítója már nem fut (ő is ezt a zárat tartja).
  if (active.state === 'prepared') {
    try {
      await releaseNeverLaunchedIntent(payload, active, now)
    } catch {
      /* The unreleased claim remains blocking until the next run. */
    }
    return PENDING
  }
  if (!RECONCILABLE_LAUNCHED_STATES.has(active.state)) return PENDING
  let settlement
  try {
    settlement = await reconcileLaunchedIntent({ payload, order, intent: active, state, now })
  } catch {
    // Bizonyíték nélkül a kísérlet blokkoló marad; a következő futás újra egyeztet.
    return PENDING
  }
  if (settlement.kind === 'succeeded') {
    await commitAutomaticRefund(payload, order, settlement.intent)
    return { action: 'refunded', detail: 'provider-reconciled' }
  }
  return PENDING
}

/** A verified GetState is correlated again to the freshly locked order before any intent. */
export async function recoverRejectedSucceededPayment(
  input: RecoverRejectedSucceededPaymentInput,
): Promise<PaidRejectRecoveryResult> {
  const { payload, state, log } = input
  const now = input.now ?? new Date()
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
        if (active) return settleActiveAutomaticIntent(payload, order, active, state, now)
        const history = await loadRefundIntentsForOrder(payload, order.id)
        if (order.status === 'refunded') {
          const committed = history.filter((intent) => intent.state === 'committed')
          if (
            committed.length === 1 &&
            isAutomaticRefundIntent(committed[0]) &&
            history.every(
              (intent) => intent.id === committed[0].id || isResolvedAutomaticFailure(intent),
            ) &&
            (await verifyAutomaticRefundCompletion(payload, order, committed[0]))
          )
            return { action: 'refunded' as const, detail: 'already-refunded' }
          return { action: 'failed' as const, detail: 'historical-refund-reconciliation-required' }
        }
        // Ez az ok egy már folyamatban levő refundról szól, nem új pénzművelet
        // felhatalmazása. Eltűnt/feloldott intent vagy verseny után sem indulhat POST.
        if (reconciliationOnly || reason === null) return PENDING
        if (!isNeverPaidRefundCandidate(order) || !history.every(isResolvedAutomaticFailure))
          return { action: 'failed' as const, detail: 'order-state-reconciliation-required' }
        const retry = decideAutomaticRetry(history, now)
        if (retry.kind === 'stop') return { action: 'failed' as const, detail: retry.detail }
        if (retry.kind === 'wait') return PENDING
        if (
          typeof order.barionPaymentId !== 'string' ||
          !sameBarionId(state.PaymentId, order.barionPaymentId) ||
          state.Status !== 'Succeeded' ||
          state.Currency !== 'HUF' ||
          typeof state.Total !== 'number' ||
          !Number.isSafeInteger(state.Total) ||
          state.Total <= 0 ||
          !Array.isArray(state.Transactions)
        )
          return { action: 'failed' as const, detail: 'payment-state-unproven' }
        // Egyetlen visszatéríthető (kártyás, Barion-egyenleges vagy átutalásos)
        // fizetési tranzakció, a fizetés teljes összegével; díj-tranzakció soha.
        const source = selectRefundSourceTransaction(state)
        if (!source || source.totalHuf !== state.Total)
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
            providerTransactionId: source.transactionId,
            refundSequence: 1,
            requestedAmountHuf: source.totalHuf,
            currency: 'HUF',
            reason: intentReason,
          },
          autoRefundOperationKey({
            orderId: order.id,
            paymentId: order.barionPaymentId,
            transactionId: source.transactionId,
            reason,
            attempt: retry.attempt,
          }),
        )
        try {
          await writeReceipt(payload, intent, RECEIPTS.prepared, {
            version: 2,
            operationKind: 'paid-reject-recovery',
            originalStatus: order.status,
            paymentId: intent.providerPaymentId,
            transactionId: intent.providerTransactionId,
            posTransactionId: source.posTransactionId,
            amountHuf: source.totalHuf,
            reason: intentReason,
          })
          intent = await transitionRefundIntent(payload, intent, 'provider_started')
        } catch {
          // Indítási engedély nélkül Barion-hívás nem történt; a kísérlet lezárható.
          // Elveszett CAS-nyugtánál a feltételes átmenet elbukik, és az intent blokkol.
          try {
            await releaseNeverLaunchedIntent(payload, intent, now)
          } catch {
            /* The unreleased claim remains blocking. */
          }
          return PENDING
        }
        providerClaimed = true
        let response
        try {
          response = await (input.refundPayment ?? refundPayment)({
            paymentId: intent.providerPaymentId,
            transactionsToRefund: [
              {
                transactionId: intent.providerTransactionId,
                posTransactionId: source.posTransactionId,
                amountToRefund: intent.requestedAmountHuf,
                comment: refundComment(order.orderNumber),
              },
            ],
          })
        } catch (error) {
          const rejection = classifyRefundRejection(error)
          if (!rejection) {
            try {
              await transitionRefundIntent(payload, intent, 'provider_unknown')
            } catch {
              /* The launch claim remains blocking. */
            }
            return PENDING
          }
          let failed: RefundIntent
          try {
            failed = await transitionRefundIntent(
              payload,
              intent,
              'provider_failed',
              providerNoEffectEvidence(rejectionReference(rejection), now),
            )
          } catch {
            try {
              await transitionRefundIntent(payload, intent, 'provider_unknown')
            } catch {
              /* The launch claim remains blocking. */
            }
            return PENDING
          }
          const next = decideAutomaticRetry([...history, failed], now)
          log.error(
            'RIASZTÁS: a Barion elutasította az automatikus visszatérítést, pénzmozgás nem történt',
            {
              orderId: order.id,
              source: input.source,
              providerErrorCodes: rejection.codes,
              attempt: retry.attempt,
              nextStep: next.kind === 'stop' ? next.detail : 'retry',
              nextAttemptNotBefore: next.kind === 'wait' ? next.notBefore : null,
            },
          )
          return next.kind === 'stop' ? { action: 'failed', detail: next.detail } : PENDING
        }
        const proof = validateRefundResponseProof(response, {
          paymentId: intent.providerPaymentId,
          sourceTransactionId: intent.providerTransactionId,
          posTransactionId: source.posTransactionId,
          amountHuf: intent.requestedAmountHuf,
        })
        if (!proof) {
          await transitionRefundIntent(payload, intent, 'provider_unknown')
          return PENDING
        }
        await assertUnusedRefundTransaction(payload, intent, proof.refundTransactionId)
        await writeReceipt(payload, intent, RECEIPTS.provider, {
          version: 2,
          operationKind: 'paid-reject-recovery',
          paymentId: intent.providerPaymentId,
          transactionId: intent.providerTransactionId,
          refundTransactionId: proof.refundTransactionId,
          posTransactionId: source.posTransactionId,
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
