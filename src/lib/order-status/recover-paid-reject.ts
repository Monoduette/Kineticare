import type { Payload } from 'payload'

import type { Order, RefundIntent } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { shouldEmitThrottledAlert } from '../alert-throttle'
import { refundPayment, type BarionPaymentStateResponse } from '../barion'
import { validateRefundResponseProof } from '../barion/refund-response-proof'
import { formatPriceHuf } from '../format-price'
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
  expectedPosTransactionId,
  hasRelatedRefundActivity,
  providerNoEffectEvidence,
  refundComment,
  rejectionReference,
  sameBarionId,
  selectRefundSourceTransaction,
  type RefundRejection,
} from '../refund/barion-refund-evidence'
import {
  decideAutomaticRetry,
  isResolvedAutomaticFailure,
  type AutomaticRetryDecision,
} from '../refund/automatic-retry'
import {
  reconcileLaunchedIntent,
  RECONCILABLE_LAUNCHED_STATES,
  releaseNeverLaunchedIntent,
} from '../refund/provider-reconciliation'
import type { Logger } from '../logger'
import { refundLockKey } from '../refund/refund-order'

// Az újrapróbálási szabály a közös, tiszta modulban él (a panel állapota is abból dönt).
export {
  automaticRefundRetryDelayMs,
  decideAutomaticRetry,
  MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS,
} from '../refund/automatic-retry'

/** Automatic refunds share the owner intent ledger and order lock. A durable
 * prepared -> provider_started claim is the only permission for a provider POST.
 * Uncertain results remain active; acknowledged successes allow local recovery.
 * A Barion végleges elutasítása (pl. TooLowBalanceToMakeRefund) igazolt
 * nullhatás: provider_failed. A tulajdonos által javítható okoknál a rendszer
 * legfeljebb naponta, darabszám-korlát nélkül újrapróbál; a szabály és az
 * indoklása a src/lib/refund/automatic-retry.ts fejlécében áll. */

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

const PENDING: PaidRejectRecoveryResult = {
  action: 'failed',
  detail: 'refund-pending-reconciliation',
}

/**
 * RIASZTÁS-fojtás rendelésenként (src/lib/alert-throttle.ts): a poll 5
 * percenként fut, a riasztás értéke viszont a felszínre hozás. Egy javítható
 * elutasítási sorozat a harmadik kísérlettől riaszt (az első kettő után egy-két
 * órán belül gyakran egy új eladás már fedezi), utána naponta egyszer; a
 * végleges leállás és az idegen visszatérítés azonnal, majd naponta.
 */
const AUTOMATIC_REFUND_ALERT_COOLDOWN_MS = 24 * 60 * 60_000
const AUTOMATIC_REFUND_ALERT_FROM_ATTEMPT = 3

function shouldAlert(kind: 'rejected' | 'stop' | 'foreign-refund', orderId: number, now: Date) {
  return shouldEmitThrottledAlert(
    `automatic-refund-${kind}:${orderId}`,
    AUTOMATIC_REFUND_ALERT_COOLDOWN_MS,
    now.getTime(),
  )
}

/** A végleges leállás riasztása: kézi egyeztetés kell, a pénz a vásárlónál hiányzik. */
function alertAutomaticStop(
  log: Logger,
  now: Date,
  context: { orderId: number; source: RecoverPaidRejectSource; detail: string },
): void {
  if (!shouldAlert('stop', context.orderId, now)) return
  log.error(
    'RIASZTÁS: az automatikus visszatérítés leállt, kézi egyeztetés szükséges; pénzmozgás nem történt, a vásárló pénze még nincs visszautalva',
    context,
  )
}

/** Egy igazoltan hatástalan elutasítás naplója: sorozat-küszöbön RIASZTÁS, előtte figyelmeztetés. */
function logAutomaticRejection(
  log: Logger,
  now: Date,
  input: {
    orderId: number
    source: RecoverPaidRejectSource
    rejection: RefundRejection
    attempt: number
    amountHuf: number
    next: AutomaticRetryDecision
  },
): void {
  const { next, rejection } = input
  const context = {
    orderId: input.orderId,
    source: input.source,
    providerErrorCodes: rejection.codes,
    attempt: input.attempt,
    amountHuf: input.amountHuf,
    nextStep: next.kind === 'stop' ? next.detail : 'retry',
    nextAttemptNotBefore: next.kind === 'wait' ? next.notBefore : null,
  }
  if (next.kind === 'stop') {
    alertAutomaticStop(log, now, {
      orderId: input.orderId,
      source: input.source,
      detail: next.detail,
    })
    return
  }
  if (
    input.attempt < AUTOMATIC_REFUND_ALERT_FROM_ATTEMPT ||
    !shouldAlert('rejected', input.orderId, now)
  ) {
    log.warn(
      'automatikus visszatérítés: a Barion elutasította, pénzmozgás nem történt; újrapróbálás ütemezve',
      context,
    )
    return
  }
  log.error(
    rejection.codes.includes('TooLowBalanceToMakeRefund')
      ? `RIASZTÁS: az automatikus visszatérítéshez nincs elég egyenleg a Barion-tárcában, pénzmozgás nem történt. Tölts fel legalább ${formatPriceHuf(input.amountHuf)} összeget, vagy várd meg a következő eladásokat; a rendszer naponta újrapróbálja.`
      : 'RIASZTÁS: a Barion ismét elutasította az automatikus visszatérítést (a Barion-fiókban javítható ok), pénzmozgás nem történt; a rendszer naponta újrapróbálja',
    context,
  )
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
        if (retry.kind === 'stop') {
          alertAutomaticStop(log, now, {
            orderId: order.id,
            source: input.source,
            detail: retry.detail,
          })
          return { action: 'failed' as const, detail: retry.detail }
        }
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
        // fizetési tranzakció, a checkout által adott `${orderNumber}-1`
        // kereskedői azonosítóval és a fizetés teljes összegével; díj-tranzakció
        // és más rendszer tranzakciója soha (ugyanaz a választó, mint a kézi úton).
        const source = selectRefundSourceTransaction(state, {
          posTransactionId: expectedPosTransactionId(order.orderNumber) ?? '',
        })
        if (!source || source.totalHuf !== state.Total)
          return { action: 'failed' as const, detail: 'source-transaction-unproven' }
        // A korlátlan napi újrapróbálás védőkorlátja: a forrásra már van (pl. a
        // Barion felületén indított, K17) visszatérítés, új nem rakható rá.
        if (hasRelatedRefundActivity(state, source.transactionId)) {
          if (shouldAlert('foreign-refund', order.id, now))
            log.error(
              'RIASZTÁS: a Barionban már van visszatérítés ehhez a fizetéshez (például a Barion felületén indították), automatikus visszatérítés nem indul; kézi egyeztetés szükséges',
              { orderId: order.id, source: input.source },
            )
          return { action: 'failed' as const, detail: 'foreign-refund-detected' }
        }
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
          logAutomaticRejection(log, now, {
            orderId: order.id,
            source: input.source,
            rejection,
            attempt: retry.attempt,
            amountHuf: intent.requestedAmountHuf,
            next,
          })
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
