/**
 * Barion-azonosítók (PaymentId, TransactionId) egységes alakja.
 *
 * A Barion UGYANAZT a GUID-ot két alakban használja:
 *  - kötőjeles (8-4-4-4-12), pl. `64157032-d3dc-4296-aeda-fd4b0994c64e`:
 *    a Payment/Start válaszában és a fizetőoldal címében (hivatalos PHP-könyvtár,
 *    docs/immediate_payment.md);
 *  - kötőjel nélküli (32 hex), pl. `6faf16e245e44bc0b60aebad6aeb9ec2`: a
 *    callback `paymentId` paraméterében (docs/refund_payments.md:
 *    `CallbackUrl => …/processpayment?paymentId=6faf16e2…`) és a v4
 *    PaymentState útvonalában (docs.barion.com/Payment-PaymentState-v4:
 *    `GET https://api.barion.com/v4/payment/f28b2b2572644d1084bbb3a7d8362337/paymentstate`).
 *    Források: https://github.com/barion/barion-web-php
 *
 * A v4 `GET /v4/Payment/{id}/PaymentState` útvonal KIZÁRÓLAG a kötőjel nélküli
 * alakot illeszti. Mérve 2026-09-24, élesben és a teszt-környezetben is,
 * érvénytelen kulccsal: 32 hex → 401 AuthenticationFailed (az útvonal
 * illeszkedett), kötőjeles → 404 „No HTTP resource was found that matches the
 * request URI". A 404-et a kód „nem létező fizetésnek" veszi, tehát kötőjeles
 * útvonallal egy kifizetett rendelés lemondódna.
 *
 * A fizetőoldal (`/Pay?id=`) és a Payment/Refund v2 törzse mindkét alakot
 * elfogadja (ugyanaz a mérés).
 *
 * Belső, kanonikus alak: kisbetűs, kötőjeles (ezt tárolja az `orders.barionPaymentId`
 * és a `webhook-events.externalId`). Minden Barionból érkező azonosító erre
 * alakul, a v4 útvonalba pedig a kötőjel nélküli alak megy.
 */

const DASHED_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPACT_GUID = /^[0-9a-f]{32}$/i

/** Egy GUID szöveges alakjának leghosszabb (kötőjeles) változata. */
export const BARION_GUID_MAX_LENGTH = 36

/**
 * Kanonikus (kisbetűs, kötőjeles) alak a kötőjeles vagy a kötőjel nélküli
 * Barion-GUID-ból; minden más értékre null.
 */
export function canonicalBarionGuid(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length !== 32 && trimmed.length !== BARION_GUID_MAX_LENGTH) {
    return null
  }
  if (DASHED_GUID.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (COMPACT_GUID.test(trimmed)) {
    const hex = trimmed.toLowerCase()
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return null
}

/** Kanonikus alak, ha az érték Barion-GUID; különben változatlanul. */
export function canonicalizeBarionGuid<T>(value: T): T | string {
  return canonicalBarionGuid(value) ?? value
}

/**
 * A v4 PaymentState útvonalába illeszthető alak: kötőjel nélküli, kisbetűs.
 * Nem GUID-alakú értéket változatlanul ad vissza (a Barion arra 404-et ad).
 */
export function barionGuidForPath(value: string): string {
  const canonical = canonicalBarionGuid(value)
  return canonical === null ? value : canonical.replace(/-/g, '')
}

/** Ugyanazt a Barion-GUID-ot jelöli-e a két érték (alaktól és kis-nagybetűtől függetlenül). */
export function sameBarionGuid(a: unknown, b: unknown): boolean {
  const left = canonicalBarionGuid(a)
  return left !== null && left === canonicalBarionGuid(b)
}
