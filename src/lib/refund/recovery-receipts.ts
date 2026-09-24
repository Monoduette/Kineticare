import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import type { Order, RefundIntent } from '../../payload-types'
import { auditLogStore, writeAuditLog } from '../audit'
import { withUserPurchasesLock } from '../user-purchases-lock'
import { readRefundAccessBaseline } from './access-store'
import { parseRefundIntentActorIdentity } from './refund-intent'
import { validateRefundResponseProof } from '../barion/refund-response-proof'
import { loadRefundIntentsForOrder } from './intent-store'

export const RECEIPTS = {
  prepared: 'refund-prepared',
  provider: 'refund-provider-succeeded',
  cleanupStarted: 'refund-cleanup-started',
  cleanupDone: 'refund-cleanup-done',
  cleanupManual: 'refund-cleanup-manual',
  invoiceStarted: 'refund-invoice-started',
  invoiceDone: 'refund-invoice-done',
} as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function relationId(value: unknown): number | null {
  const id = isRecord(value) ? value.id : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

export function productIds(order: Order): number[] {
  const ids = (order.items ?? []).map((item) => relationId(item.product))
  if (ids.some((id) => id === null)) throw new Error('refund receipt: invalid product reference')
  return [...new Set(ids as number[])].sort((a, b) => a - b)
}

/** Exactly one immutable event is evidence; duplicates and truncated queries fail closed. */
export async function readReceipt(
  payload: Payload,
  intent: RefundIntent,
  action: string,
): Promise<Record<string, unknown> | null> {
  const orderAudit = action === 'order-refund' || action === 'order-partial-refund'
  const entityType = orderAudit ? 'orders' : 'refund-intents'
  const entityId = String(orderAudit ? relationId(intent.order) : intent.id)
  const found = await payload.find({
    collection: 'audit-logs',
    where: {
      and: [
        { action: { equals: action } },
        { entityType: { equals: entityType } },
        { entityId: { equals: entityId } },
      ],
    },
    limit: orderAudit ? 1000 : 2,
    depth: 0,
    overrideAccess: true,
  })
  if (found.hasNextPage || found.totalDocs !== found.docs.length) {
    throw new Error('refund receipt: ambiguous lookup')
  }
  const matching = orderAudit
    ? found.docs.filter((event) => isRecord(event.after) && event.after.intentId === intent.id)
    : found.docs
  if (matching.length > 1) throw new Error('refund receipt: ambiguous lookup')
  if (matching.length === 0) return null
  const event = matching[0]
  if (
    event.action !== action ||
    event.entityType !== entityType ||
    event.entityId !== entityId ||
    relationId(event.actor) !== relationId(intent.actor)
  )
    throw new Error('refund receipt: conflicting event')
  const after: unknown = event.after
  if (
    !isRecord(after) ||
    ![1, 2].includes(after.version as number) ||
    after.orderId !== relationId(intent.order) ||
    after.sequence !== intent.refundSequence ||
    after.requestFingerprint !== intent.requestHash ||
    after.intentId !== intent.id
  )
    throw new Error('refund receipt: invalid identity')
  if (after.version === 2 || intent.schemaVersion === 2) {
    const identity = parseRefundIntentActorIdentity({ ...intent, actor: relationId(intent.actor) })
    if (
      after.version !== 2 ||
      after.actorKind !== identity.actorKind ||
      after.systemActor !== identity.systemActor
    )
      throw new Error('refund receipt: invalid actor identity')
  }
  return after
}

/** Call under the order lock. A failed create acknowledgement never authorizes an effect. */
export async function writeReceipt(
  payload: Payload,
  intent: RefundIntent,
  action: string,
  after: Record<string, unknown>,
  actor = relationId(intent.actor),
  createOnly = false,
): Promise<void> {
  after = {
    ...after,
    ...(after.version === 2
      ? (() => {
          const identity = parseRefundIntentActorIdentity({
            ...intent,
            actor: relationId(intent.actor),
          })
          return { actorKind: identity.actorKind, systemActor: identity.systemActor }
        })()
      : {}),
    ...(createOnly ? { claimReference: randomUUID() } : {}),
    intentId: intent.id,
    orderId: relationId(intent.order),
    sequence: intent.refundSequence,
    requestFingerprint: intent.requestHash,
  }
  const existing = await readReceipt(payload, intent, action)
  if (existing) {
    if (createOnly) throw new Error('refund receipt: launch already claimed')
    if (!isDeepStrictEqual(existing, after)) throw new Error('refund receipt: conflicting evidence')
    return
  }
  const saved = await writeAuditLog({
    store: auditLogStore(payload),
    actor,
    action,
    entityType:
      action === 'order-refund' || action === 'order-partial-refund' ? 'orders' : 'refund-intents',
    entityId:
      action === 'order-refund' || action === 'order-partial-refund'
        ? relationId(intent.order)
        : intent.id,
    after,
  })
  if (!saved || !isDeepStrictEqual(await readReceipt(payload, intent, action), after)) {
    throw new Error('refund receipt: unacknowledged persistence')
  }
}

/** A launch claim must be created by this invocation, never adopted after lock loss. */
export async function createReceipt(
  payload: Payload,
  intent: RefundIntent,
  action: string,
  after: Record<string, unknown>,
): Promise<void> {
  await writeReceipt(payload, intent, action, after, relationId(intent.actor), true)
}

export async function prepareRefundReceipt(
  payload: Payload,
  intent: RefundIntent,
  order: Order,
): Promise<void> {
  const customerId = relationId(order.customer)
  if (customerId === null) throw new Error('refund receipt: missing customer')
  await withUserPurchasesLock(payload, customerId, async () => {
    const accessBaseline = await readRefundAccessBaseline(payload, customerId, productIds(order))
    if (
      !accessBaseline ||
      accessBaseline.customerId !== customerId ||
      accessBaseline.version !== 2
    ) {
      throw new Error('refund receipt: access baseline unavailable')
    }
    await writeReceipt(payload, intent, RECEIPTS.prepared, {
      version: 1,
      customerId,
      accessBaseline,
    })
  })
}

/** Distinct refund IDs cannot be consumed by two intents. Source-ID echoes are not unique refund IDs. */
export async function assertUnusedRefundTransaction(
  payload: Payload,
  intent: RefundIntent,
  refundTransactionId: string,
): Promise<void> {
  const canonical = (value: string) => value.replaceAll('-', '').toLowerCase()
  if (canonical(refundTransactionId) === canonical(intent.providerTransactionId)) return
  const intents = await loadRefundIntentsForOrder(payload, relationId(intent.order)!)
  for (const prior of intents) {
    if (prior.id === intent.id) continue
    const receipt = await readReceipt(payload, prior, RECEIPTS.provider)
    if (
      typeof receipt?.refundTransactionId === 'string' &&
      canonical(receipt.refundTransactionId) === canonical(refundTransactionId)
    )
      throw new Error('refund receipt: transaction already consumed')
  }
}

/**
 * A rendelés többi kísérletének már rögzített Barion refund-tranzakciói. A
 * GetState-egyeztetés ezeket zárja ki, hogy egy korábbi visszatérítést ne
 * tulajdonítson a mostani kísérletnek. Null (nem bizonyítható), ha egy sikeres
 * kísérlet bizonyítékából hiányzik a saját refund-azonosító, vagy az csak a
 * forrás-tranzakció visszhangja: ilyenkor a korábbi visszatérítés nem
 * azonosítható a Barion-adatokban.
 */
export async function consumedRefundTransactionIds(
  payload: Payload,
  intent: RefundIntent,
): Promise<string[] | null> {
  const orderId = relationId(intent.order)
  if (orderId === null) return null
  const ids: string[] = []
  for (const prior of await loadRefundIntentsForOrder(payload, orderId)) {
    if (prior.id === intent.id) continue
    const receipt = await readReceipt(payload, prior, RECEIPTS.provider)
    if (!receipt) {
      if (prior.state === 'provider_succeeded' || prior.state === 'committed') return null
      continue
    }
    const refundId = receipt.refundTransactionId
    if (
      typeof refundId !== 'string' ||
      !refundId.trim() ||
      refundId.replaceAll('-', '').toLowerCase() ===
        prior.providerTransactionId.replaceAll('-', '').toLowerCase()
    )
      return null
    ids.push(refundId)
  }
  return ids
}

/** A V2 receipt records both provider identities; V1 owner receipts retain their original contract. */
export async function readProviderReceipt(
  payload: Payload,
  intent: RefundIntent,
): Promise<Record<string, unknown> | null> {
  const receipt = await readReceipt(payload, intent, RECEIPTS.provider)
  if (!receipt || receipt.version === 1) return receipt
  if (
    !validateRefundResponseProof(
      {
        PaymentId: receipt.paymentId,
        RefundedTransactions: [
          {
            TransactionId: receipt.refundTransactionId,
            POSTransactionId: receipt.posTransactionId,
            Total: receipt.amountHuf,
            Status: receipt.status,
          },
        ],
      },
      {
        paymentId: intent.providerPaymentId,
        sourceTransactionId: intent.providerTransactionId,
        posTransactionId:
          typeof receipt.posTransactionId === 'string' ? receipt.posTransactionId : '',
        amountHuf: intent.requestedAmountHuf,
      },
    ) ||
    receipt.transactionId !== intent.providerTransactionId
  )
    throw new Error('refund receipt: invalid provider proof')
  await assertUnusedRefundTransaction(payload, intent, receipt.refundTransactionId as string)
  return receipt
}
