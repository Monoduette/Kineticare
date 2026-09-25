import type { Payload } from 'payload'

import type { RefundIntent } from '../../payload-types'
import { auditLogStore, writeAuditLog } from '../audit'
import { REQUEST_ID_HEADER } from '../request-id'
import { parseRefundIntentActorIdentity } from './refund-intent'
import { relationId } from './recovery-receipts'

/**
 * A visszatérítési kísérlet Barion-válaszának nyoma a műveletnaplóban
 * (a-refund-9, a-riasztas-5).
 *
 * A sikeres út nyugtái (recovery-receipts.ts) csak a sikert rögzítik; a
 * Barion elutasítását vagy az értékelhetetlen válaszát eddig csak a napló
 * hordozta, rendelés-összefüggés nélkül. Vitánál vagy visszaterhelésnél
 * (chargeback) innen látszik, ki, mikor, honnan, mekkora összeggel próbálta,
 * és mit válaszolt a Barion (ErrorCode), a kérés azonosítójával együtt.
 *
 * Best-effort (writeAuditLog sosem dob): a pénzügyi döntést nem ez hordozza,
 * azt a refund_intents sor és a nyugták adják. Az `after` a hibakódot és a
 * metaadatot tartalmazza, nyers szolgáltatói törzset soha.
 */
export const REFUND_ATTEMPT_AUDIT_ACTIONS = {
  rejected: 'refund-provider-rejected',
  unknown: 'refund-provider-unknown',
  /** A sikeres kísérlet kérés-adatai (IP, kérésazonosító, belső indok); a pénzügyi bizonyíték a nyugta. */
  succeeded: 'refund-provider-accepted',
} as const

export type RefundAttemptOutcome = keyof typeof REFUND_ATTEMPT_AUDIT_ACTIONS

export interface RefundAttemptAuditInput {
  intent: RefundIntent
  outcome: RefundAttemptOutcome
  /** A Barion válaszának hibakódjai; üres, ha nem volt értékelhető válasz. */
  providerErrorCodes: readonly string[]
  /** A hiba osztálya (BarionApiError.kind, vagy a hívó saját jelölése). */
  errorKind: string | null
  httpStatus?: number | null
  /** A kérés azonosítója (a naplósorokkal közös); rendszerfolyamatnál null. */
  requestId?: string | null
  ipAddress?: string | null
  /** A kísérlet tárolt indoka (az API `reason` mezője). */
  reason?: string | null
  /** A panel belső indoka (a-refund-9): csak ide kerül. */
  note?: string | null
  /** Automatikus kísérletnél a hívó (callback, order-poll, checkout-start). */
  source?: string | null
}

/** Sosem dob: a hívó pénzügyi ágán egy naplóhiba nem változtathat semmit. */
export async function recordRefundAttemptOutcome(
  payload: Payload,
  input: RefundAttemptAuditInput,
): Promise<boolean> {
  try {
    const { intent } = input
    const identity = parseRefundIntentActorIdentity({ ...intent, actor: relationId(intent.actor) })
    const requestId = input.requestId?.trim() || null
    return await writeAuditLog({
      store: auditLogStore(payload),
      actor: identity.actorId,
      action: REFUND_ATTEMPT_AUDIT_ACTIONS[input.outcome],
      entityType: 'refund-intents',
      entityId: intent.id,
      after: {
        version: 1,
        outcome: input.outcome,
        intentId: intent.id,
        orderId: relationId(intent.order),
        sequence: intent.refundSequence,
        amountHuf: intent.requestedAmountHuf,
        paymentId: intent.providerPaymentId,
        transactionId: intent.providerTransactionId,
        providerErrorCodes: [...input.providerErrorCodes],
        errorKind: input.errorKind,
        httpStatus: input.httpStatus ?? null,
        actorKind: identity.actorKind,
        systemActor: identity.systemActor,
        source: input.source ?? null,
        requestId,
        reason: input.reason ?? null,
        note: input.note ?? null,
        recordedAt: new Date().toISOString(),
      },
      // A writeAuditLog a kérésazonosítót a fejlécből olvassa: a route által
      // generált azonosító a bejövő fejlécben nincs benne, ezért ide tesszük.
      ...(requestId ? { req: { headers: new Headers({ [REQUEST_ID_HEADER]: requestId }) } } : {}),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
    })
  } catch {
    return false
  }
}
