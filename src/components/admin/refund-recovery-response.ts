export interface RefundRecoveryStatus {
  orderNumber: string
  state: 'clear' | 'manual_review' | 'recoverable'
  message: string
  operationState?: 'unseen' | 'pending' | 'completed' | 'no_effect'
}

export interface RefundRecoveryResponse {
  orderNumber: string
  recoveryStatus: 'completed' | 'manual_review'
  message: string
}

function readResponse(status: number, body: unknown, orderNumber: string) {
  if (status < 200 || status >= 300 || !body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const record = body as Record<string, unknown>
  if (
    record.orderNumber !== orderNumber ||
    typeof record.message !== 'string' ||
    !record.message.trim() ||
    Object.hasOwn(record, 'error') ||
    record.manualReviewRequired === true
  )
    return null
  return { record, message: record.message }
}

export function parseRefundRecoveryStatus(
  status: number,
  body: unknown,
  orderNumber: string,
  keyed = false,
): RefundRecoveryStatus | null {
  const value = readResponse(status, body, orderNumber)
  if (!value) return null
  const { state } = value.record
  if (state !== 'clear' && state !== 'manual_review' && state !== 'recoverable') return null
  const { operationState } = value.record
  if (keyed) {
    if (
      operationState !== 'unseen' &&
      operationState !== 'pending' &&
      operationState !== 'completed' &&
      operationState !== 'no_effect'
    )
      return null
    return { orderNumber, state, message: value.message, operationState }
  }
  if (Object.hasOwn(value.record, 'operationState')) return null
  return { orderNumber, state, message: value.message }
}

export function parseRefundRecoveryResponse(
  status: number,
  body: unknown,
  orderNumber: string,
): RefundRecoveryResponse | null {
  const value = readResponse(status, body, orderNumber)
  if (!value) return null
  const { recoveryStatus } = value.record
  if (recoveryStatus !== 'completed' && recoveryStatus !== 'manual_review') return null
  return { orderNumber, recoveryStatus, message: value.message }
}
