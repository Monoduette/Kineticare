import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeChangeHook,
  PayloadRequest,
  Plugin,
} from 'payload'

import { auditLogStore, resolveClientIp, writeAuditLog } from '../lib/audit'
import { logger } from '../lib/logger'

/**
 * Audit plugin — hook-injekció pages/posts/products/orders/users collectionökre.
 * Az ecommerce plugin UTÁN kell futnia. Publish/refund/purchases/role események,
 * a kurzusnál a közzétett ár, akció, hozzáférés-hossz, megjelenés és rejtettség
 * változása, valamint a közzététel visszavonása, a lomtár és a visszaállítás.
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

/**
 * r2-termekor (a-cms-12): a kurzus KÖZZÉTETT állapotának naplója.
 *
 * A products autosave-es piszkozatot használ, ezért az afterChange
 * `previousDoc`-ja a legutóbbi PISZKOZAT (payload/dist/collections/operations/
 * utilities/update.js: originalDoc = getLatestCollectionVersion), amely a
 * közzétételkor már az új árat hordozza: a régi „publish” bejegyzés `before`
 * mezőjéből nem derült ki a régi ár. A trash (lomtár), a visszaállítás és a
 * közzététel visszavonása pedig egyik figyelt műveletre sem illeszkedett.
 *
 * Ezért a kurzusnál a mentés ELŐTT (beforeChange) és UTÁN (afterChange) is
 * kiolvassuk a fő táblában álló, közzétett sort (findByID draft:false, ugyanabban
 * a tranzakcióban), és a kettő különbségét naplózzuk, a mentést végző
 * felhasználóval. A bejegyzés `before`/`after` mezője a két közzétett sor.
 */
export const PRODUCT_AUDIT_FIELD_GROUPS: Readonly<Record<string, readonly string[]>> = {
  'price-change': ['priceInHUF', 'priceInHUFEnabled'],
  'promo-change': ['promoEnabled', 'promoStart', 'promoEnd', 'promoPriceHuf'],
  'duration-change': ['accessDurationDays'],
  'status-change': ['status'],
  'unlisted-change': ['unlisted'],
}

/** Összehasonlítható alak: hiányzó és null egy; a dátum ISO-szövegként. */
function comparable(value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * A két közzétett sor közti műveletek (tiszta függvény, külön tesztelhető).
 * `before`: a mentés előtti, `after`: a mentés utáni fő táblás (közzétett) sor.
 */
export function productPublishedChangeActions(before: unknown, after: unknown): string[] {
  if (
    typeof before !== 'object' ||
    before === null ||
    typeof after !== 'object' ||
    after === null
  ) {
    return []
  }
  const actions: string[] = []
  if (
    fieldValue(before, '_status') === 'published' &&
    fieldValue(after, '_status') !== 'published'
  ) {
    actions.push('unpublish')
  }
  const trashedBefore = isPresent(fieldValue(before, 'deletedAt'))
  const trashedAfter = isPresent(fieldValue(after, 'deletedAt'))
  if (!trashedBefore && trashedAfter) {
    actions.push('trash')
  }
  if (trashedBefore && !trashedAfter) {
    actions.push('restore')
  }
  for (const [action, fields] of Object.entries(PRODUCT_AUDIT_FIELD_GROUPS)) {
    if (
      fields.some(
        (field) => comparable(fieldValue(before, field)) !== comparable(fieldValue(after, field)),
      )
    ) {
      actions.push(action)
    }
  }
  return actions
}

/** A mentés előtti közzétett sorok, kurzus-azonosítónként (a kérés `context`-jében). */
const PUBLISHED_BEFORE_KEY = 'kcAuditPublishedBefore'

type PublishedSnapshots = Record<string, Record<string, unknown>>

function snapshotStore(req: PayloadRequest): PublishedSnapshots {
  const context = req.context as Record<string, unknown> | undefined
  if (typeof context !== 'object' || context === null) {
    return {}
  }
  const existing = context[PUBLISHED_BEFORE_KEY]
  if (typeof existing === 'object' && existing !== null) {
    return existing as PublishedSnapshots
  }
  const created: PublishedSnapshots = {}
  context[PUBLISHED_BEFORE_KEY] = created
  return created
}

/** A kérés `draft` paramétere (REST: „true” szöveg). */
function isDraftRequest(req: PayloadRequest): boolean {
  const draft = (req.query as Record<string, unknown> | undefined)?.draft
  return draft === true || draft === 'true'
}

/**
 * A fő táblában álló (közzétett) kurzus-sor, a lomtárban lévőt is (trash: true);
 * olvasási hiba esetén null, ilyenkor a napló a régi módon (previousDoc/doc) ír.
 */
async function readPublishedProduct(
  req: PayloadRequest,
  id: unknown,
): Promise<Record<string, unknown> | null> {
  if (
    (typeof id !== 'number' && typeof id !== 'string') ||
    typeof req.payload?.findByID !== 'function'
  ) {
    return null
  }
  try {
    const doc = await req.payload.findByID({
      collection: 'products',
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      req,
      trash: true,
    })
    return doc as unknown as Record<string, unknown>
  } catch (error) {
    logger.warn('audit: a kurzus közzétett állapota nem olvasható', {
      productId: String(id),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * A kurzus mentése előtt a közzétett sor pillanatképe. A piszkozat-mentés
 * (autosave és „Mentés piszkozatként”: `?draft=true`, és a Payload a
 * `_status`-t „draft”-ra állította) nem érinti a fő táblát
 * (update.js: `if (!isSavingDraft) db.updateOne`), ezért ott nem olvasunk.
 * A közzététel visszavonása viszont `draft` paraméter nélkül fut, azt olvassuk.
 */
export const auditProductBeforeChange: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const id = fieldValue(originalDoc, 'id')
  if (operation !== 'update' || id === undefined) {
    return data
  }
  if (fieldValue(data, '_status') === 'draft' && isDraftRequest(req)) {
    return data
  }
  const published = await readPublishedProduct(req, id)
  if (published !== null) {
    snapshotStore(req)[String(id)] = published
  }
  return data
}

/** A mentés előtti pillanatkép kivétele (egyszer használatos). */
function takePublishedBefore(req: PayloadRequest, id: unknown): Record<string, unknown> | null {
  if (typeof id !== 'number' && typeof id !== 'string') return null
  const store = snapshotStore(req)
  const snapshot = store[String(id)] ?? null
  delete store[String(id)]
  return snapshot
}

export const auditAfterChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
  collection,
}) => {
  const actions = auditActionsForChange(collection.slug, operation, doc, previousDoc)
  let before: unknown = operation === 'update' ? previousDoc : undefined
  let after: unknown = doc
  if (collection.slug === 'products' && operation === 'update') {
    const id = fieldValue(doc, 'id')
    const publishedBefore = takePublishedBefore(req, id)
    const publishedAfter = publishedBefore === null ? null : await readPublishedProduct(req, id)
    if (publishedBefore !== null && publishedAfter !== null) {
      for (const action of productPublishedChangeActions(publishedBefore, publishedAfter)) {
        if (!actions.includes(action)) actions.push(action)
      }
      before = publishedBefore
      after = publishedAfter
    }
  }
  if (actions.length === 0) {
    return doc
  }
  await writeAuditLog({
    store: auditLogStore(req.payload),
    actor: req.user?.id ?? null,
    action: actions.join(','),
    entityType: collection.slug,
    entityId: fieldValue(doc, 'id') as number | string | undefined,
    before,
    after,
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
        ...(collection.slug === 'products'
          ? {
              beforeChange: [...(collection.hooks?.beforeChange ?? []), auditProductBeforeChange],
            }
          : {}),
        afterChange: [...(collection.hooks?.afterChange ?? []), auditAfterChange],
        afterDelete: [...(collection.hooks?.afterDelete ?? []), auditAfterDelete],
      },
    }
  }),
})

export default audit
