import { isDeepStrictEqual } from 'node:util'
import type { Payload } from 'payload'
import type { Order, RefundIntent } from '../../payload-types'
import { parseRefundIntentActorIdentity } from './refund-intent'
import { transitionRefundIntent } from './intent-store'
import {
  readReceipt,
  readProviderReceipt,
  RECEIPTS,
  relationId,
  writeReceipt,
} from './recovery-receipts'
import type { OrderRefundEntry } from './refund-order'

export function isAutomaticRefundIntent(intent: RefundIntent): boolean {
  return (
    parseRefundIntentActorIdentity({ ...intent, actor: relationId(intent.actor) }).actorKind ===
    'system'
  )
}

export function isNeverPaidRefundCandidate(order: Order): boolean {
  return (
    ['created', 'payment_pending', 'payment_failed', 'cancelled'].includes(order.status ?? '') &&
    !order.invoiceNumber &&
    !order.refundedAt &&
    (order.refunds == null || (Array.isArray(order.refunds) && order.refunds.length === 0))
  )
}

/** No provider call, access mutation or invoice action belongs to a never-paid recovery. */
async function evidence(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
): Promise<OrderRefundEntry> {
  const prepared = await readReceipt(payload, intent, RECEIPTS.prepared)
  const proof = await readProviderReceipt(payload, intent)
  if (
    !isAutomaticRefundIntent(intent) ||
    !['provider_succeeded', 'committed'].includes(intent.state) ||
    relationId(intent.order) !== order.id ||
    order.barionPaymentId !== intent.providerPaymentId ||
    intent.refundSequence !== 1 ||
    !intent.providerResolvedAt ||
    prepared?.version !== 2 ||
    prepared.operationKind !== 'paid-reject-recovery' ||
    prepared.paymentId !== intent.providerPaymentId ||
    prepared.transactionId !== intent.providerTransactionId ||
    prepared.amountHuf !== intent.requestedAmountHuf ||
    prepared.reason !== intent.reason ||
    !['created', 'payment_pending', 'payment_failed', 'cancelled'].includes(
      String(prepared.originalStatus),
    ) ||
    proof?.version !== 2 ||
    proof.operationKind !== 'paid-reject-recovery' ||
    proof.posTransactionId !== prepared.posTransactionId ||
    proof.type !== 'full' ||
    proof.amountHuf !== intent.requestedAmountHuf ||
    proof.status !== 'Succeeded' ||
    order.invoiceNumber ||
    (order.status !== 'refunded' && order.status !== prepared.originalStatus)
  )
    throw new Error('automatic refund recovery: insufficient evidence')
  return {
    transactionId: intent.providerTransactionId,
    amountHuf: intent.requestedAmountHuf,
    status: 'Succeeded',
    refundedAt: intent.providerResolvedAt,
    type: 'full',
    reason: intent.reason,
  }
}

function verifyOrder(order: Order, entry: OrderRefundEntry): boolean {
  return (
    order.status === 'refunded' &&
    order.refundedAt === entry.refundedAt &&
    (order.refundReason ?? null) === (entry.reason ?? null) &&
    isDeepStrictEqual(order.refunds, [entry])
  )
}

/** Call only inside order:mutate:<id>. Acknowledged proof permits local completion, never another POST. */
export async function commitAutomaticRefund(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
): Promise<void> {
  const entry = await evidence(payload, order, intent)
  const history: unknown = order.refunds
  if (
    history != null &&
    (!Array.isArray(history) || (history.length > 0 && !isDeepStrictEqual(history, [entry])))
  )
    throw new Error('automatic refund recovery: historical conflict')
  if (!verifyOrder(order, entry)) {
    if (intent.state === 'committed' || !isNeverPaidRefundCandidate(order))
      throw new Error('automatic refund recovery: order state conflict')
    await payload.update({
      collection: 'orders',
      id: order.id,
      overrideAccess: true,
      data: {
        status: 'refunded',
        refunds: [entry],
        refundedAt: entry.refundedAt,
        ...(entry.reason ? { refundReason: entry.reason } : {}),
      },
    })
    const fresh = await payload.findByID({
      collection: 'orders',
      id: order.id,
      depth: 0,
      overrideAccess: true,
    })
    if (!verifyOrder(fresh, entry))
      throw new Error('automatic refund recovery: unacknowledged order write')
  }
  await writeReceipt(payload, intent, 'order-refund', {
    version: 2,
    operationKind: 'paid-reject-recovery',
    amountHuf: entry.amountHuf,
    transactionId: entry.transactionId,
    status: entry.status,
    completed: true,
  })
  if (intent.state === 'provider_succeeded')
    await transitionRefundIntent(payload, intent, 'committed')
}

/** Pure readback for operational GETs and already-refunded callbacks. */
export async function verifyAutomaticRefundCompletion(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
): Promise<boolean> {
  const entry = await evidence(payload, order, intent)
  const audit = await readReceipt(payload, intent, 'order-refund')
  return (
    intent.state === 'committed' &&
    verifyOrder(order, entry) &&
    audit?.completed === true &&
    audit.operationKind === 'paid-reject-recovery' &&
    audit.amountHuf === entry.amountHuf &&
    audit.transactionId === entry.transactionId &&
    audit.status === entry.status
  )
}

export async function canRecoverAutomaticRefund(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
): Promise<boolean> {
  const entry = await evidence(payload, order, intent)
  return (
    intent.state === 'provider_succeeded' &&
    (isNeverPaidRefundCandidate(order) || verifyOrder(order, entry))
  )
}
