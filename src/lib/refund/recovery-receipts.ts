import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import type { Order, RefundIntent } from '../../payload-types'
import { auditLogStore, writeAuditLog } from '../audit'
import { withUserPurchasesLock } from '../user-purchases-lock'
import { readRefundAccessBaseline } from './access-store'

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
    after.version !== 1 ||
    after.orderId !== relationId(intent.order) ||
    after.sequence !== intent.refundSequence ||
    after.requestFingerprint !== intent.requestHash ||
    after.intentId !== intent.id
  )
    throw new Error('refund receipt: invalid identity')
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
      accessBaseline.version !== 1
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
