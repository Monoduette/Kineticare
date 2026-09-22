import type { OrderPaymentState } from '../barion'

/**
 * Függő Barion-fizetés: élő fizetés → resume; Succeeded → paid helyben; GetState hiba → fail-closed.
 */

export const CHECKOUT_PAYMENT_STATE_UNAVAILABLE =
  'A fizetés állapotát most nem tudtuk ellenőrizni. Új fizetést nem indítunk, hogy ne vonjunk le kétszer. Próbáld újra egy perc múlva.'

export const CHECKOUT_PAYMENT_IN_PROGRESS =
  'Ehhez a termékhez már folyamatban van egy fizetés. Fejezd be azt, vagy várd meg a fizetési ablak lejártát.'

export function barionPayUrl(paymentId: string, environment: 'test' | 'prod'): string {
  const host =
    environment === 'prod' ? 'https://secure.barion.com' : 'https://secure.test.barion.com'
  return `${host}/Pay?id=${encodeURIComponent(paymentId)}`
}

export type PendingCheckoutDecision =
  | { kind: 'barion-unavailable' }
  | { kind: 'already-paid' }
  | { kind: 'resume'; paymentId: string }
  | { kind: 'cancel-and-restart' }
  | { kind: 'wait-no-payment-id' }

export function decidePendingCheckout(input: {
  barionPaymentId: string | null | undefined
  createdAt: string | null | undefined
  /**
   * `'not-found'`: a Barion DEFINITÍVEN nem ismeri a PaymentId-t (404 vagy
   * PaymentNotFound) — pl. más Barion-környezetben indított fizetés. Ilyenkor
   * nincs mit folytatni: a sor lezárul, és új Start mehet. Egy késői Succeeded
   * a late-success ágon (R-03) ettől függetlenül paid-dé válik.
   */
  mappedState: OrderPaymentState | 'unavailable' | 'not-found' | null
  nowMs: number
  windowMs: number
}): PendingCheckoutDecision {
  const paymentId =
    typeof input.barionPaymentId === 'string' && input.barionPaymentId.trim().length > 0
      ? input.barionPaymentId.trim()
      : null

  if (paymentId === null) {
    const createdMs = input.createdAt ? Date.parse(input.createdAt) : Number.NaN
    const insideWindow = Number.isNaN(createdMs) || input.nowMs - createdMs <= input.windowMs
    return insideWindow ? { kind: 'wait-no-payment-id' } : { kind: 'cancel-and-restart' }
  }

  if (input.mappedState === 'unavailable' || input.mappedState === null) {
    return { kind: 'barion-unavailable' }
  }
  if (input.mappedState === 'not-found') {
    return { kind: 'cancel-and-restart' }
  }
  if (input.mappedState === 'paid') {
    return { kind: 'already-paid' }
  }
  if (input.mappedState === 'payment_pending') {
    return { kind: 'resume', paymentId }
  }
  return { kind: 'cancel-and-restart' }
}

/**
 * Az új checkout-kérés adatai, amelyekkel egy függő fizetés folytatható.
 */
export interface PendingResumeExpectation {
  /** A MOST fizetendő ár (Ft), a szerver számolja; ismeretlen ár esetén null. */
  priceHuf: number | null
  buyerName: string | null
  billing: {
    name: string
    zip: string
    city: string
    street: string
    taxNumber: string | null
  }
}

function snapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key]
  return typeof value === 'string' ? value : null
}

/**
 * Folytatható-e a függő fizetés a MOSTANI kéréssel.
 *
 * A folytatás a régi Barion-fizetésre küldi a vevőt, a régi rendelés
 * ár- és számlázási snapshotjával. Ez csak akkor helyes, ha a kettő egyezik a
 * mostani kéréssel:
 * - az ár: az akció a két kérés között indulhatott vagy járhatott le, és a
 *   vevő nem fizethet mást, mint amit most a pénztárban lát;
 * - a vevő neve és a számlázási adatok: a számla a rendelés snapshotjából
 *   készül. E nélkül bárki indíthatna vendégként rendelést más e-mail-címével
 *   és a saját számlázási adataival, és a cím valódi gazdája ebbe a rendelésbe
 *   futna bele, a számla pedig idegen névre szólna.
 *
 * Eltérésnél a hívó a régi függő rendelést lezárja, és új fizetést indít
 * (ugyanaz az ág, mint a lejárt vagy megszakadt fizetésnél).
 */
export function pendingOrderMatchesRequest(
  order: { totalHufSnapshot?: number | null; customerSnapshot?: unknown },
  expected: PendingResumeExpectation,
): boolean {
  if (expected.priceHuf === null || order.totalHufSnapshot !== expected.priceHuf) {
    return false
  }
  const snapshot = order.customerSnapshot
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return false
  }
  const record = snapshot as Record<string, unknown>
  const taxNumber = record.taxNumber
  return (
    snapshotString(record, 'name') === expected.buyerName &&
    snapshotString(record, 'billingName') === expected.billing.name &&
    snapshotString(record, 'billingZip') === expected.billing.zip &&
    snapshotString(record, 'billingCity') === expected.billing.city &&
    snapshotString(record, 'billingStreet') === expected.billing.street &&
    (taxNumber === undefined ? null : taxNumber) === expected.billing.taxNumber
  )
}
