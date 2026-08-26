import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, Plugin } from 'payload'

import { auditLogStore, resolveClientIp, writeAuditLog } from '../lib/audit'

/**
 * Audit plugin — hook-injekció pages/posts/products/orders/users collectionökre.
 * Az ecommerce plugin UTÁN kell futnia. Publish/refund/purchases/role események.
 */

const AUDITED_SLUGS: ReadonlySet<string> = new Set([
  'pages',
  'posts',
  'products',
  'orders',
  'users',
])

/** Mely collection mely státusz-mezőn publikál (pages/posts: saját status; products: drafts _status). */
const PUBLISH_STATUS_FIELD: Readonly<Record<string, string>> = {
  pages: 'status',
  posts: 'status',
  products: '_status',
}

const ORDER_REFUND_FIELDS = ['refundReason', 'refundedAt'] as const

function fieldChanged(before: unknown, after: unknown, field: string): boolean {
  if (
    typeof before !== 'object' ||
    before === null ||
    typeof after !== 'object' ||
    after === null
  ) {
    return false
  }
  const beforeValue = (before as Record<string, unknown>)[field]
  const afterValue = (after as Record<string, unknown>)[field]
  return beforeValue !== afterValue
}

function fieldValue(doc: unknown, field: string): unknown {
  if (typeof doc !== 'object' || doc === null) {
    return undefined
  }
  return (doc as Record<string, unknown>)[field]
}

/**
 * Relationship-id kinyerése: nyers szám/szöveg vagy populate-olt `{ id }`.
 * Ismeretlen alak → null (nem számít bele az összehasonlításba).
 */
function relationId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'object' && value !== null) {
    return relationId((value as { id?: unknown }).id)
  }
  return null
}

/**
 * A users.purchases mező stabil lenyomata: rendezett id-lista.
 * Az átrendezés önmagában nem esemény; id hozzáadása/elvétele igen.
 */
function sortedPurchaseIds(doc: unknown): string[] {
  const raw = fieldValue(doc, 'purchases')
  if (!Array.isArray(raw)) {
    return []
  }
  const ids: string[] = []
  for (const item of raw) {
    const id = relationId(item)
    if (id !== null) {
      ids.push(id)
    }
  }
  ids.sort()
  return ids
}

function purchasesChanged(previousDoc: unknown, doc: unknown): boolean {
  const before = sortedPurchaseIds(previousDoc)
  const after = sortedPurchaseIds(doc)
  if (before.length !== after.length) {
    return true
  }
  return before.some((id, index) => id !== after[index])
}

/** A vizsgált átmenetek eldöntése — tiszta függvény, külön tesztelhető. */
export function auditActionsForChange(
  collectionSlug: string,
  operation: 'create' | 'update' | string,
  doc: unknown,
  previousDoc: unknown,
): string[] {
  const actions: string[] = []
  if (operation === 'create') {
    actions.push('create')
  }
  if (operation === 'update') {
    const publishField = PUBLISH_STATUS_FIELD[collectionSlug]
    if (
      publishField &&
      fieldValue(doc, publishField) === 'published' &&
      fieldValue(previousDoc, publishField) !== 'published'
    ) {
      actions.push('publish')
    }
    if (
      collectionSlug === 'orders' &&
      ORDER_REFUND_FIELDS.some((field) => fieldChanged(previousDoc, doc, field))
    ) {
      actions.push('refund-update')
    }
    if (collectionSlug === 'users' && fieldValue(previousDoc, 'role') !== fieldValue(doc, 'role')) {
      actions.push('role-change')
    }
    if (collectionSlug === 'users' && purchasesChanged(previousDoc, doc)) {
      actions.push('purchase-change')
    }
  }
  return actions
}

export const auditAfterChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
  collection,
}) => {
  const actions = auditActionsForChange(collection.slug, operation, doc, previousDoc)
  if (actions.length === 0) {
    return doc
  }
  await writeAuditLog({
    store: auditLogStore(req.payload),
    actor: req.user?.id ?? null,
    action: actions.join(','),
    entityType: collection.slug,
    entityId: fieldValue(doc, 'id') as number | string | undefined,
    before: operation === 'update' ? previousDoc : undefined,
    after: doc,
    req,
    ipAddress: resolveClientIp(req.headers),
  })
  return doc
}

export const auditAfterDelete: CollectionAfterDeleteHook = async ({ doc, req, collection }) => {
  await writeAuditLog({
    store: auditLogStore(req.payload),
    actor: req.user?.id ?? null,
    action: 'delete',
    entityType: collection.slug,
    entityId: fieldValue(doc, 'id') as number | string | undefined,
    before: doc,
    req,
    ipAddress: resolveClientIp(req.headers),
  })
  return doc
}

export const audit: Plugin = (config) => ({
  ...config,
  collections: (config.collections ?? []).map((collection) => {
    if (!AUDITED_SLUGS.has(collection.slug)) {
      return collection
    }
    return {
      ...collection,
      hooks: {
        ...collection.hooks,
        afterChange: [...(collection.hooks?.afterChange ?? []), auditAfterChange],
        afterDelete: [...(collection.hooks?.afterDelete ?? []), auditAfterDelete],
      },
    }
  }),
})

export default audit
