/**
 * Order-status poll — a köszönőoldal rendelés-státusz lekérdezése.
 *
 * API-szerződés (a W3-ban létrehozott végpont): GET /api/orders/[orderNumber]/status
 * - 200 { status, productId, totalHufSnapshot, currency } — a rendelés aktuális
 *   állapota (created/payment_pending/paid/payment_failed/cancelled/refunded),
 *   az első tétel termék-id-je (null, ha nem feloldható — a „Újrapróbálom"
 *   linkhez), valamint a megrendeléskori végösszeg és pénzneme (a köszönőoldal
 *   bevétel-mérő `purchase_confirmed` eseményéhez; miért nem szivárgás:
 *   src/lib/checkout/order-status-handler.ts fejléce);
 * - 401 (nincs bejelentkezés), 404 (nem a saját/nem létezik), 400, 500.
 *
 * A VÉGÖSSZEG HIÁNYA NEM HIBA: érvénytelen vagy hiányzó mezőnél a `value` /
 * `currency` `null` lesz, a poll pedig ugyanúgy `status`-t ad vissza. A
 * köszönőoldal ilyenkor összeg nélkül küldi az eseményt — a rendelés állapota
 * sosem múlhat a mérésen.
 */

export const ORDER_STATUSES = [
  'created',
  'payment_pending',
  'paid',
  'payment_failed',
  'cancelled',
  'refunded',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.some((status) => status === value)
}

function toOrderStatus(value: string): OrderStatus {
  return isOrderStatus(value) ? value : 'created'
}

export type PollResult =
  | {
      kind: 'status'
      status: OrderStatus
      productId: number | null
      /**
       * A rendelés végösszege (a wire `totalHufSnapshot` mezője) — a PostHog
       * `purchase_confirmed` esemény `value` tulajdonsága lesz belőle.
       * `null`, ha a végpont nem adott értelmezhető összeget.
       */
      value: number | null
      /** ISO-4217 pénznem (a wire `currency` mezője), vagy `null`. */
      currency: string | null
    }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'review' }

export async function pollOrderStatus(
  orderNumber: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PollResult> {
  try {
    const response = await fetchImpl(`/api/orders/${encodeURIComponent(orderNumber)}/status`, {
      credentials: 'include',
    })
    if (response.status === 401) {
      return { kind: 'unauthorized' }
    }
    if (response.status === 404) {
      return { kind: 'not-found' }
    }
    if (!response.ok) {
      return { kind: 'error' }
    }
    const body = (await response.json()) as {
      status?: string
      productId?: unknown
      totalHufSnapshot?: unknown
      currency?: unknown
      paymentReviewRequired?: unknown
    }
    if (typeof body.status !== 'string') {
      return { kind: 'error' }
    }
    if (body.paymentReviewRequired === true) return { kind: 'review' }
    const productId =
      typeof body.productId === 'number' && Number.isInteger(body.productId) && body.productId > 0
        ? body.productId
        : null
    // A 0 érvényes összeg (ingyenes rendelés), a negatív és a nem-szám nem az.
    const value =
      typeof body.totalHufSnapshot === 'number' &&
      Number.isFinite(body.totalHufSnapshot) &&
      body.totalHufSnapshot >= 0
        ? body.totalHufSnapshot
        : null
    const currency =
      typeof body.currency === 'string' && body.currency.trim().length > 0
        ? body.currency.trim().toUpperCase()
        : null
    return { kind: 'status', status: toOrderStatus(body.status), productId, value, currency }
  } catch {
    return { kind: 'error' }
  }
}
