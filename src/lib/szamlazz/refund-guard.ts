import type { Payload } from 'payload'
import type { Order, RefundIntent } from '../../payload-types'
import { loadRefundIntentsForOrder } from '../refund/intent-store'
import {
  isRecord,
  readReceipt,
  RECEIPTS,
  relationId,
  createReceipt,
} from '../refund/recovery-receipts'

type DocumentKind = 'storno' | 'corrective'
export interface ManagedRefundDocument {
  intent: RefundIntent
  kind: DocumentKind
  number: string | null
}

const REQUIRED =
  'Refund document requires verified reconciliation; automatic submission is blocked.'
const SUCCESS = new Set(['Succeeded', 'Refunded', 'PartiallyRefunded'])

/** Called under the existing document lock by every issuer, including jobs. */
export async function managedRefundDocument(
  payload: Payload,
  order: Order,
  kind: DocumentKind,
  sequence = 1,
  amountHuf?: number,
): Promise<ManagedRefundDocument | null> {
  const intents = await loadRefundIntentsForOrder(payload, order.id)
  if (intents.length === 0) return null
  const matching = intents.filter(
    (intent) =>
      intent.refundSequence === sequence &&
      (intent.state === 'provider_succeeded' || intent.state === 'committed'),
  )
  if (matching.length !== 1 || !Array.isArray(order.refunds)) throw new Error(REQUIRED)
  const intent = matching[0]
  const total = order.totalHufSnapshot ?? order.amount
  const history: unknown[] = order.refunds
  if (
    !Number.isSafeInteger(total) ||
    (total ?? 0) <= 0 ||
    sequence < 1 ||
    sequence > history.length
  ) {
    throw new Error(REQUIRED)
  }
  let refunded = 0
  let preceding = 0
  for (let index = 0; index < history.length; index++) {
    const entry = history[index]
    if (
      !isRecord(entry) ||
      typeof entry.transactionId !== 'string' ||
      !entry.transactionId ||
      typeof entry.amountHuf !== 'number' ||
      !Number.isSafeInteger(entry.amountHuf) ||
      entry.amountHuf <= 0 ||
      typeof entry.status !== 'string' ||
      !SUCCESS.has(entry.status) ||
      typeof entry.refundedAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.refundedAt))
    )
      throw new Error(REQUIRED)
    if (index === sequence - 1) preceding = refunded
    refunded += entry.amountHuf
    if (
      !Number.isSafeInteger(refunded) ||
      refunded > total! ||
      entry.type !== (refunded === total ? 'full' : 'partial')
    )
      throw new Error(REQUIRED)
  }
  if (order.status !== (refunded === total ? 'refunded' : 'paid')) throw new Error(REQUIRED)
  const entry = history[sequence - 1] as Record<string, unknown>
  const expectedKind = sequence === 1 && entry.type === 'full' ? 'storno' : 'corrective'
  if (
    kind !== expectedKind ||
    relationId(intent.order) !== order.id ||
    order.barionPaymentId !== intent.providerPaymentId ||
    entry.transactionId !== intent.providerTransactionId ||
    entry.amountHuf !== intent.requestedAmountHuf ||
    entry.refundedAt !== intent.providerResolvedAt ||
    (amountHuf !== undefined && amountHuf !== intent.requestedAmountHuf)
  )
    throw new Error(REQUIRED)
  const proof = await readReceipt(payload, intent, RECEIPTS.provider)
  if (
    !proof ||
    proof.paymentId !== intent.providerPaymentId ||
    proof.transactionId !== intent.providerTransactionId ||
    proof.amountHuf !== intent.requestedAmountHuf ||
    proof.sequence !== sequence ||
    proof.status !== entry.status ||
    proof.totalHuf !== total ||
    proof.alreadyRefundedHuf !== preceding ||
    proof.type !== entry.type
  ) {
    throw new Error(REQUIRED)
  }
  const done = await readReceipt(payload, intent, RECEIPTS.invoiceDone)
  if (
    done &&
    (done.sequence !== sequence || typeof done.number !== 'string' || !done.number.trim())
  ) {
    throw new Error(REQUIRED)
  }
  return { intent, kind, number: done ? (done.number as string) : null }
}

/** Existing or unacknowledged claims never authorize another POST after a negative lookup. */
export async function claimManagedRefundDocument(
  payload: Payload,
  managed: ManagedRefundDocument,
  previousAttempts: number,
): Promise<void> {
  if (
    managed.intent.state !== 'provider_succeeded' ||
    managed.number ||
    previousAttempts !== 0 ||
    (await readReceipt(payload, managed.intent, RECEIPTS.invoiceStarted))
  )
    throw new Error(REQUIRED)
  await createReceipt(payload, managed.intent, RECEIPTS.invoiceStarted, {
    version: 1,
    kind: managed.kind,
    sequence: managed.intent.refundSequence,
  })
}
