export interface RefundOperation {
  key: string
  amountHuf: number | null
}

const OPERATION_KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

function storageKey(orderNumber: string) {
  return `kineticare:refund-operation:${encodeURIComponent(orderNumber)}`
}

export function readRefundOperation(orderNumber: string): RefundOperation | null {
  const raw = window.sessionStorage.getItem(storageKey(orderNumber))
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid refund operation')
  const record = value as Record<string, unknown>
  if (
    typeof record.key !== 'string' ||
    !OPERATION_KEY.test(record.key) ||
    !(
      record.amountHuf === null ||
      (typeof record.amountHuf === 'number' &&
        Number.isSafeInteger(record.amountHuf) &&
        record.amountHuf > 0)
    )
  )
    throw new Error('Invalid refund operation')
  return { key: record.key, amountHuf: record.amountHuf }
}

export function ensureRefundOperation(
  orderNumber: string,
  amountHuf: number | null,
): RefundOperation {
  const existing = readRefundOperation(orderNumber)
  if (existing) {
    if (existing.amountHuf !== amountHuf) throw new Error('Refund operation amount mismatch')
    return existing
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  const key = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  const operation = { key, amountHuf }
  window.sessionStorage.setItem(storageKey(orderNumber), JSON.stringify(operation))
  if (readRefundOperation(orderNumber)?.key !== key)
    throw new Error('Refund operation not persisted')
  return operation
}

export function clearRefundOperation(orderNumber: string, expectedKey: string): void {
  if (readRefundOperation(orderNumber)?.key !== expectedKey)
    throw new Error('Refund operation changed')
  window.sessionStorage.removeItem(storageKey(orderNumber))
  if (readRefundOperation(orderNumber) !== null) throw new Error('Refund operation not cleared')
}
