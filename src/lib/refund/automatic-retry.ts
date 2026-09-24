import type { RefundIntent } from '../../payload-types'
import { isAutomaticRefundIntent } from './auto-refund-recovery'
import {
  OWNER_FIXABLE_REJECTION_CODES,
  rejectionCodesFromReference,
  type RefundRejectionCode,
} from './barion-refund-evidence'

/**
 * Az automatikus (paid-reject) visszatérítés újrapróbálási szabálya. Tiszta
 * modul: a kísérletet indító recover-paid-reject.ts és a tulajdonosi panel
 * állapota (refund-recovery.ts) ugyanebből dönt, így a panel pontosan azt
 * írja ki, amit a rendszer tenni fog.
 *
 * Új kísérlet csak akkor indulhat, ha MINDEN korábbi automatikus kísérlet
 * igazoltan hatástalan (provider_failed, bizonyítékkal, aktív zár nélkül); ezt
 * a hívó ellenőrzi, és a friss GetState-ben a forrástranzakció összege a
 * fizetés teljes Total értéke, kapcsolódó visszatérítés nélkül. Ezért a
 * korlátlan napi újrapróbálás sem mozgathat kétszer pénzt: minden kísérlet új
 * műveletazonosítót kap, és csak az előző igazolt nullhatása után indul.
 *
 * - Nem javítható Barion-kód (pl. AmountToRefundIsGreaterThanTransactionAmount,
 *   PaymentStatusNotValid): azonnali, végleges leállás
 *   (automatic-refund-rejected).
 * - A tulajdonos által javítható kód (TooLowBalanceToMakeRefund,
 *   SuspendedUserTriedToRefund, InvalidAccount, AuthenticationFailed): nincs
 *   darabszám-korlát, a várakozás 24 óránál megáll. A tulajdonos nem tart
 *   tartalékot a Barion-tárcában (K6), a későbbi eladások vagy egy feltöltés
 *   fedezik a visszatérítést, tehát a leállás itt végleges beragadás lenne.
 * - Kód nélküli nullhatás (GetState-egyeztetés: a várakozás után sincs
 *   visszatérítés; vagy a Barionhoz el sem jutott, lezárt kísérlet): ezekből
 *   legfeljebb MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS lehet, utána leáll
 *   (automatic-refund-attempts-exhausted), mert ismeretlen ok ismétlése nem segít.
 * - Várakozás az n-edik igazoltan hatástalan kísérlet után (minden kísérlet
 *   számít): 1, 2, 4, 8, 16, majd 24 óra.
 */

/** Ennyi kód nélküli (okát nem ismert) hatástalan kísérlet után áll le az automatika. */
export const MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS = 8
const AUTOMATIC_REFUND_RETRY_BASE_MS = 60 * 60_000
export const AUTOMATIC_REFUND_RETRY_MAX_MS = 24 * 60 * 60_000

/** Várakozás az n-edik igazoltan hatástalan kísérlet után: 1, 2, 4, 8, 16, majd 24 óra. */
export function automaticRefundRetryDelayMs(failedAttempts: number): number {
  return Math.min(
    AUTOMATIC_REFUND_RETRY_MAX_MS,
    AUTOMATIC_REFUND_RETRY_BASE_MS * 2 ** Math.max(0, failedAttempts - 1),
  )
}

/** Igazoltan hatástalan (feloldott) automatikus kísérlet. */
export function isResolvedAutomaticFailure(intent: RefundIntent): boolean {
  return (
    isAutomaticRefundIntent(intent) &&
    intent.state === 'provider_failed' &&
    intent.activeOrderKey == null &&
    typeof intent.reconciliationReference === 'string' &&
    typeof intent.providerResolvedAt === 'string'
  )
}

export type AutomaticRetryDecision =
  | { kind: 'launch'; attempt: number }
  | { kind: 'wait'; notBefore: string }
  | { kind: 'stop'; detail: 'automatic-refund-rejected' | 'automatic-refund-attempts-exhausted' }

function isUnexplained(intent: RefundIntent): boolean {
  return rejectionCodesFromReference(intent.reconciliationReference).length === 0
}

/** A legutóbb lezárt kísérlet (a lezárás ideje szerint). */
export function latestAutomaticFailure(failures: readonly RefundIntent[]): RefundIntent | null {
  return (
    [...failures].sort((a, b) =>
      String(a.providerResolvedAt).localeCompare(String(b.providerResolvedAt)),
    )[failures.length - 1] ?? null
  )
}

/** Az első, a tulajdonos által nem javítható elutasítási kód bármely kísérletből. */
export function nonFixableRejectionCode(
  failures: readonly RefundIntent[],
): RefundRejectionCode | null {
  for (const failure of failures) {
    const code = rejectionCodesFromReference(failure.reconciliationReference).find(
      (item) => !OWNER_FIXABLE_REJECTION_CODES.has(item),
    )
    if (code) return code
  }
  return null
}

/** Új kísérlet csak igazoltan hatástalan előzmények után indulhat (lásd a modul fejlécét). */
export function decideAutomaticRetry(
  failures: readonly RefundIntent[],
  now: Date,
): AutomaticRetryDecision {
  const last = latestAutomaticFailure(failures)
  if (!last) return { kind: 'launch', attempt: 1 }
  if (nonFixableRejectionCode(failures))
    return { kind: 'stop', detail: 'automatic-refund-rejected' }
  if (failures.filter(isUnexplained).length >= MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS)
    return { kind: 'stop', detail: 'automatic-refund-attempts-exhausted' }
  const notBefore =
    Date.parse(String(last.providerResolvedAt)) + automaticRefundRetryDelayMs(failures.length)
  if (!Number.isFinite(notBefore)) return { kind: 'stop', detail: 'automatic-refund-rejected' }
  if (now.getTime() < notBefore)
    return { kind: 'wait', notBefore: new Date(notBefore).toISOString() }
  return { kind: 'launch', attempt: failures.length + 1 }
}
