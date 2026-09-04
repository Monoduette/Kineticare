import { formatPriceHuf } from '../../lib/format-price'
import type { RefundOrderResult } from '../../lib/refund/refund-order'

export const REFUND_REVIEW_GUIDANCE =
  'Ne indíts új visszatérítést ehhez a rendeléshez. Ellenőrizd a rendelést és a Barion tranzakcióit, majd egyeztesd az eltérést az üzemeltetővel.'

export const REFUND_UNCERTAIN_MESSAGE = `A visszatérítés eredménye nem állapítható meg biztonságosan a válaszból. ${REFUND_REVIEW_GUIDANCE}`

export type RefundPresentation =
  | { kind: 'error'; message: string }
  | { kind: 'warning'; message: string }
  | { kind: 'success'; message: string; type: RefundOrderResult['type'] }

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

// Validate the service response shape, not the provider's financial decisions.
function isRefundResult(
  body: Record<string, unknown>,
  orderNumber: string,
): body is RefundOrderResult & Record<string, unknown> {
  return (
    body.orderNumber === orderNumber &&
    (body.type === 'full' || body.type === 'partial') &&
    nonNegativeInteger(body.amountHuf) &&
    body.amountHuf > 0 &&
    nonEmptyString(body.transactionId) &&
    nonEmptyString(body.refundedTransactionStatus) &&
    nonNegativeInteger(body.alreadyRefundedHuf) &&
    nonNegativeInteger(body.totalRefundedHuf) &&
    body.orderStatus === (body.type === 'full' ? 'refunded' : 'paid') &&
    (body.refundStatusOutcome === 'succeeded' || body.refundStatusOutcome === 'unknown')
  )
}

export function presentRefundResponse(
  status: number,
  body: unknown,
  orderNumber: string,
): RefundPresentation {
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  const error = record && nonEmptyString(record.error) ? record.error : null
  if (record?.manualReviewRequired === true) {
    return {
      kind: 'warning',
      message: error ? `${error} ${REFUND_REVIEW_GUIDANCE}` : REFUND_UNCERTAIN_MESSAGE,
    }
  }
  if (status >= 400 && status < 500 && error) {
    return { kind: 'error', message: error }
  }
  if (status < 200 || status >= 300 || !record || !isRefundResult(record, orderNumber)) {
    return { kind: 'warning', message: REFUND_UNCERTAIN_MESSAGE }
  }
  if (record.refundStatusOutcome === 'unknown') {
    return {
      kind: 'warning',
      message: `A Barion nem igazolta vissza a visszatérítés sikerét. Tranzakció-azonosító: ${record.transactionId}. ${REFUND_REVIEW_GUIDANCE}`,
    }
  }
  const type = record.type === 'partial' ? 'Részleges' : 'Teljes'
  return {
    kind: 'success',
    type: record.type,
    message: `${type} visszatérítés megtörtént (${formatPriceHuf(record.amountHuf)}). Tranzakció-azonosító: ${record.transactionId}`,
  }
}
