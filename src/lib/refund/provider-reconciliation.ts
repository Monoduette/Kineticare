import type { Payload } from 'payload'

import type { Order, RefundIntent } from '../../payload-types'
import type { BarionPaymentStateResponse } from '../barion'
import { isAutomaticRefundIntent, isNeverPaidRefundCandidate } from './auto-refund-recovery'
import {
  PAYMENT_STATE_NO_REFUND_REFERENCE,
  providerNoEffectEvidence,
  refundEvidenceFromPaymentState,
} from './barion-refund-evidence'
import { transitionRefundIntent } from './intent-store'
import {
  consumedRefundTransactionIds,
  readProviderReceipt,
  readReceipt,
  RECEIPTS,
  writeReceipt,
} from './recovery-receipts'
import {
  NO_PROVIDER_REQUEST_REFERENCE,
  type RefundIntentProviderNoEffectEvidence,
} from './refund-intent'

/**
 * Egy elakadt refund-kísérlet lezárása bizonyíték alapján (Phase A:
 * provider_unknown → manual_review → provider_failed | provider_succeeded).
 *
 * Minden függvény a hívó `order:mutate:<id>` zárja alatt fut, a zár alatt
 * frissen beolvasott intenttel és rendeléssel. A GetState HTTP-hívás a zár
 * ELŐTT történik; itt csak a már lekért állapotot értékeljük. Pénzt mozgató
 * hívás itt soha nincs.
 */

/** Az intent állapota, amelyből GetState-bizonyítékkal lezárható. */
export const RECONCILABLE_LAUNCHED_STATES: ReadonlySet<RefundIntent['state']> = new Set([
  'provider_started',
  'provider_unknown',
  'manual_review',
])

export type IntentSettlement =
  | { kind: 'succeeded'; intent: RefundIntent }
  | { kind: 'no_effect'; intent: RefundIntent }
  | {
      kind: 'pending'
      reason: 'in_progress' | 'too_early' | 'unprovable'
      notBefore?: string
      intent: RefundIntent
    }

/** A dokumentált út a végállapotig: provider_unknown csak manual_review-n át zárható le. */
export async function settleProviderOutcome(
  payload: Payload,
  intent: RefundIntent,
  target: 'provider_failed' | 'provider_succeeded',
  evidence?: RefundIntentProviderNoEffectEvidence,
): Promise<RefundIntent> {
  const current =
    intent.state === 'provider_unknown'
      ? await transitionRefundIntent(payload, intent, 'manual_review')
      : intent
  return transitionRefundIntent(payload, current, target, evidence)
}

/**
 * A provider_started CAS előtt megszakadt kísérlet lezárása. Biztonságos: az
 * indítási engedély (prepared → provider_started) sosem született meg, tehát a
 * Barionnak kérés sem mehetett. A CAS state = 'prepared' feltétele miatt egy
 * közben mégis elindított kísérletet nem írhat felül.
 */
export async function releaseNeverLaunchedIntent(
  payload: Payload,
  intent: RefundIntent,
  now: Date = new Date(),
): Promise<RefundIntent> {
  return transitionRefundIntent(
    payload,
    intent,
    'provider_failed',
    providerNoEffectEvidence(NO_PROVIDER_REQUEST_REFERENCE, now),
  )
}

/**
 * Elindított, de le nem zárt kísérlet egyeztetése egy friss GetState-tel.
 *
 * `ownerLedger`: tulajdonosi kísérletnél a rendelés végösszege és a kísérlet
 * előtti, már visszatérített összeg (a hívó a validált refund-nyomból számolja).
 * Automatikus kísérletnél nem kell: ott a rendelés sosem lett paid, a teljes
 * összeg a kísérlet tárgya.
 */
export async function reconcileLaunchedIntent(input: {
  payload: Payload
  order: Order
  intent: RefundIntent
  state: BarionPaymentStateResponse
  ownerLedger?: { totalHuf: number; alreadyRefundedHuf: number } | null
  now?: Date
}): Promise<IntentSettlement> {
  const { payload, order, intent, state } = input
  const now = input.now ?? new Date()
  if (!RECONCILABLE_LAUNCHED_STATES.has(intent.state))
    throw new Error('refund reconciliation: unsupported intent state')

  // A rögzített, korrelált Barion-siker (pl. elveszett CAS-nyugta után) önmagában bizonyíték.
  if (await readProviderReceipt(payload, intent)) {
    return {
      kind: 'succeeded',
      intent: await settleProviderOutcome(payload, intent, 'provider_succeeded'),
    }
  }

  const automatic = isAutomaticRefundIntent(intent)
  const ledger = automatic ? null : (input.ownerLedger ?? null)
  const expectedRemainingHuf = automatic
    ? isNeverPaidRefundCandidate(order)
      ? intent.requestedAmountHuf
      : null
    : ledger
      ? ledger.totalHuf - ledger.alreadyRefundedHuf
      : null
  const evidence = refundEvidenceFromPaymentState({
    state,
    paymentId: intent.providerPaymentId,
    sourceTransactionId: intent.providerTransactionId,
    amountHuf: intent.requestedAmountHuf,
    consumedRefundTransactionIds: await consumedRefundTransactionIds(payload, intent),
    expectedRemainingHuf,
    providerStartedAt: intent.providerStartedAt,
    now: now.getTime(),
  })

  if (evidence.kind === 'succeeded') {
    if (automatic) {
      const prepared = await readReceipt(payload, intent, RECEIPTS.prepared)
      if (
        prepared?.version !== 2 ||
        prepared.operationKind !== 'paid-reject-recovery' ||
        prepared.posTransactionId !== evidence.posTransactionId
      )
        return pending(payload, intent, 'unprovable')
      await writeReceipt(payload, intent, RECEIPTS.provider, {
        version: 2,
        operationKind: 'paid-reject-recovery',
        paymentId: intent.providerPaymentId,
        transactionId: intent.providerTransactionId,
        refundTransactionId: evidence.refundTransactionId,
        posTransactionId: evidence.posTransactionId,
        amountHuf: intent.requestedAmountHuf,
        status: 'Succeeded',
        type: 'full',
        reconciledFrom: 'barion-paymentstate',
      })
    } else {
      if (!ledger) return pending(payload, intent, 'unprovable')
      const after = ledger.alreadyRefundedHuf + intent.requestedAmountHuf
      await writeReceipt(payload, intent, RECEIPTS.provider, {
        version: 2,
        paymentId: intent.providerPaymentId,
        transactionId: intent.providerTransactionId,
        refundTransactionId: evidence.refundTransactionId,
        posTransactionId: evidence.posTransactionId,
        amountHuf: intent.requestedAmountHuf,
        sequence: intent.refundSequence,
        status: 'Succeeded',
        totalHuf: ledger.totalHuf,
        alreadyRefundedHuf: ledger.alreadyRefundedHuf,
        type: after === ledger.totalHuf ? 'full' : 'partial',
        reconciledFrom: 'barion-paymentstate',
      })
    }
    // A frissen írt bizonyíték ugyanazon az ellenőrzésen megy át, mint a közvetlen válaszé.
    if (!(await readProviderReceipt(payload, intent)))
      throw new Error('refund reconciliation: provider receipt unacknowledged')
    return {
      kind: 'succeeded',
      intent: await settleProviderOutcome(payload, intent, 'provider_succeeded'),
    }
  }
  if (evidence.kind === 'no_effect') {
    return {
      kind: 'no_effect',
      intent: await settleProviderOutcome(
        payload,
        intent,
        'provider_failed',
        providerNoEffectEvidence(PAYMENT_STATE_NO_REFUND_REFERENCE, now),
      ),
    }
  }
  return pending(
    payload,
    intent,
    evidence.kind,
    evidence.kind === 'too_early' ? evidence.notBefore : undefined,
  )
}

/**
 * Nincs döntő bizonyíték. A zár alatt látott provider_started kísérletnek már
 * nincs futó indítója (az a teljes Barion-hívás alatt tartja ugyanezt a zárat),
 * ezért állapota provider_unknown lesz: a kimenet ismeretlen, nem folyamatban lévő.
 */
async function pending(
  payload: Payload,
  intent: RefundIntent,
  reason: 'in_progress' | 'too_early' | 'unprovable',
  notBefore?: string,
): Promise<IntentSettlement> {
  const current =
    intent.state === 'provider_started'
      ? await transitionRefundIntent(payload, intent, 'provider_unknown')
      : intent
  return { kind: 'pending', reason, ...(notBefore ? { notBefore } : {}), intent: current }
}
