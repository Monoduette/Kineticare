import type { OrderPaymentState } from '../barion'

/**
 * Függő Barion-fizetés: élő fizetés → resume; Succeeded → paid helyben; GetState hiba → fail-closed.
 */

export const CHECKOUT_PAYMENT_STATE_UNAVAILABLE =
  'A fizetés állapotát most nem tudtuk ellenőrizni. Új fizetést nem indítunk, hogy ne vonjunk le kétszer. Próbáld újra egy perc múlva.'

export const CHECKOUT_PAYMENT_IN_PROGRESS =
  'Ehhez a termékhez már folyamatban van egy fizetés. Fejezd be azt, vagy várd meg a fizetési ablak lejártát.'

export function barionPayUrl(paymentId: string, environment: 'test' | 'prod'): string {
  const host = environment === 'prod' ? 'https://secure.barion.com' : 'https://secure.test.barion.com'
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
  mappedState: OrderPaymentState | 'unavailable' | null
  nowMs: number
  windowMs: number
}): PendingCheckoutDecision {
  const paymentId =
    typeof input.barionPaymentId === 'string' && input.barionPaymentId.trim().length > 0
      ? input.barionPaymentId.trim()
      : null

  if (paymentId === null) {
    const createdMs = input.createdAt ? Date.parse(input.createdAt) : Number.NaN
    const insideWindow =
      Number.isNaN(createdMs) || input.nowMs - createdMs <= input.windowMs
    return insideWindow ? { kind: 'wait-no-payment-id' } : { kind: 'cancel-and-restart' }
  }

  if (input.mappedState === 'unavailable' || input.mappedState === null) {
    return { kind: 'barion-unavailable' }
  }
  if (input.mappedState === 'paid') {
    return { kind: 'already-paid' }
  }
  if (input.mappedState === 'payment_pending') {
    return { kind: 'resume', paymentId }
  }
  return { kind: 'cancel-and-restart' }
}
