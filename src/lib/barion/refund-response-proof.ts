import { sameBarionGuid } from './guid'

export interface RefundResponseExpected {
  readonly paymentId: string
  readonly sourceTransactionId: string
  readonly posTransactionId: string
  readonly amountHuf: number
}

export interface RefundResponseProof {
  readonly refundTransactionId: string
  readonly status: 'Succeeded'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBarionGuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.length === 32 || value.length === 36) &&
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value)
  )
}

/**
 * Egyetlen, hitelesített Payment/Refund v2 hívás közvetlen válaszának proofja.
 * Az expected a tartós intent és a kiküldött, ellenőrzött source tranzakció
 * adata; ez a tiszta függvény önmagában nem hitelesít külső payloadot.
 *
 * A hivatalos PHP példa új refund TransactionId-t, a Marketplace példa a
 * forrás ID-jét adja vissza. A kötés ezért PaymentId + POSTransactionId +
 * pontos összeg + Succeeded; a source és returned ID nem cserélhető fel.
 * Források: docs.barion.com/RefundedTransaction, docs.barion.com/Calling_the_API,
 * github.com/barion/barion-web-php/blob/master/docs/refund_payments.md.
 * Nem helyettesíti a külön recovery-azonosítást vagy a duplikált intent őrét.
 */
export function validateRefundResponseProof(
  response: unknown,
  expected: RefundResponseExpected,
): RefundResponseProof | null {
  if (
    !isRecord(response) ||
    !isNonemptyString(expected.paymentId) ||
    !isNonemptyString(expected.sourceTransactionId) ||
    !isNonemptyString(expected.posTransactionId) ||
    !Number.isSafeInteger(expected.amountHuf) ||
    expected.amountHuf <= 0
  )
    return null
  const transactions = response.RefundedTransactions
  const transaction =
    Array.isArray(transactions) && transactions.length === 1 ? transactions[0] : null
  if (
    !isRecord(transaction) ||
    // A Barion a GUID-ot kötőjellel és anélkül is használja (guid.ts); a tárolt alak eltérhet.
    (response.PaymentId !== expected.paymentId &&
      !sameBarionGuid(response.PaymentId, expected.paymentId)) ||
    !(
      response.Errors === undefined ||
      (Array.isArray(response.Errors) && response.Errors.length === 0)
    ) ||
    !isBarionGuid(transaction.TransactionId) ||
    transaction.POSTransactionId !== expected.posTransactionId ||
    transaction.Total !== expected.amountHuf ||
    !(
      transaction.AmountToRefund === undefined || transaction.AmountToRefund === expected.amountHuf
    ) ||
    !Number.isSafeInteger(transaction.Total) ||
    transaction.Status !== 'Succeeded'
  )
    return null
  return { refundTransactionId: transaction.TransactionId, status: 'Succeeded' }
}
