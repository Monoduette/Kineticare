import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'

import type { RefundIntent } from '../../payload-types'

export interface RefundAccessBaseline {
  version: 1 | 2
  customerId: number
  productIds: number[]
  purchases: Array<{ id: number; productId: number }>
  grantProductIds: number[]
  grantsFingerprint: string
  grantProof: 'absence-only' | 'bounded-xmin-v1' | 'bounded-xmin-provenance-v2'
  fullXid?: string
  xidCeiling?: string
  grants?: GrantVersion[]
}

interface GrantVersion {
  id: string
  productId: number
  grantedAt: string
  position: number
  xmin: string
  age: number
  sourceKind?: 'order' | 'independent' | null
  sourceOrder?: number | null
}

/**
 * Miért nem vonható vissza automatikusan egy kurzus hozzáférése (a-refund-10).
 * - grant-provenance: a vevőnek nincs ehhez a rendeléshez kötött
 *   hozzáférés-sora a kurzusra, vagy eredet nélküli (örökölt, átállásból
 *   jött) sora is van: a rendelés nem bizonyítja, hogy a hozzáférés tőle
 *   származik, ezért a rendszer nem vesz el semmit.
 * - access-changed: a vevő hozzáférései a visszatérítés előkészítése óta
 *   megváltoztak (új vásárlás, ajándék, kézi módosítás), vagy a változatlanság
 *   nem bizonyítható (a tranzakció-azonosító ablakon kívüli megfigyelés).
 * A tulajdonosi üzenet (refund-recovery.ts) ebből nevezi meg a kurzust és a
 * következő lépést. A jogosultság-szabály maga nem változik.
 */
export type RefundAccessCleanupDetail = 'grant-provenance' | 'access-changed'

export type RefundAccessCleanupResult =
  | { status: 'completed' }
  | { status: 'manual_review'; detail?: RefundAccessCleanupDetail; productId?: number }

class AccessCleanupFailure extends Error {
  constructor(
    readonly detail: RefundAccessCleanupDetail,
    readonly productId: number,
  ) {
    super(`Refund access cleanup: ${detail}`)
    this.name = 'AccessCleanupFailure'
  }
}

interface Executor {
  execute(query: SQL): Promise<unknown>
}

interface Database {
  transaction<T>(run: (tx: Executor) => Promise<T>): Promise<T>
}

const LIMIT = 1_000
const ORDER_LIMIT = 100
const XID_MODULUS = 4_294_967_296n
const MAX_XID_DELTA = 1_000_000n
const MANUAL: RefundAccessCleanupResult = { status: 'manual_review' }
const COMPLETED: RefundAccessCleanupResult = { status: 'completed' }

function fail(): never {
  throw new Error('Refund access storage: unverified')
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail()
  return value
}

function relationId(value: unknown): number {
  return id(record(value) ? value.id : value)
}

function ids(value: readonly number[]): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMIT) fail()
  const result = [...new Set(value.map(id))].sort((a, b) => a - b)
  if (result.length !== value.length) fail()
  return result
}

function iso(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') fail()
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) fail()
  return date.toISOString()
}

function xid(value: unknown, maximum = 18_446_744_073_709_551_615n): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value)) fail()
  const parsed = BigInt(value)
  if (parsed < 3n || parsed > maximum) fail()
  return parsed
}

function grantSource(row: Record<string, unknown>): {
  sourceKind: 'order' | 'independent' | null
  sourceOrder: number | null
} {
  if (row.sourceKind == null && row.sourceOrder == null)
    return { sourceKind: null, sourceOrder: null }
  if (row.sourceKind === 'independent' && row.sourceOrder == null)
    return { sourceKind: 'independent', sourceOrder: null }
  if (row.sourceKind === 'order') return { sourceKind: 'order', sourceOrder: id(row.sourceOrder) }
  return fail()
}

function fingerprint(grants: GrantVersion[], version: 1 | 2): string {
  // JSONB does not preserve object key order; keep V1 hashes byte-compatible.
  const tuples = grants.map(
    ({ id, productId, grantedAt, position, xmin, age, sourceKind, sourceOrder }) => [
      id,
      productId,
      grantedAt,
      position,
      xmin,
      age,
      ...(version === 2 ? [sourceKind, sourceOrder] : []),
    ],
  )
  return createHash('sha256').update(JSON.stringify(tuples)).digest('hex')
}

function validateVersions(value: RefundAccessBaseline): void {
  const full = xid(value.fullXid)
  const ceiling = xid(value.xidCeiling)
  // Also bound the observation horizon: a transaction ID assigned before a long wait
  // alone cannot bound the IDs of tuples that became visible during that wait.
  if (ceiling < full || ceiling - full >= MAX_XID_DELTA) fail()
  if (!Array.isArray(value.grants) || value.grants.length > LIMIT) fail()
  for (const grant of value.grants) {
    if (
      !record(grant) ||
      typeof grant.id !== 'string' ||
      !grant.id ||
      grant.id.length > 256 ||
      !value.productIds.includes(id(grant.productId)) ||
      iso(grant.grantedAt) !== grant.grantedAt ||
      !Number.isSafeInteger(grant.position) ||
      grant.position < 0 ||
      !Number.isSafeInteger(grant.age) ||
      grant.age <= 0 ||
      grant.age >= 2_147_483_648
    )
      fail()
    if (value.version === 2) {
      const source = grantSource(grant)
      if (source.sourceKind !== grant.sourceKind || source.sourceOrder !== grant.sourceOrder) fail()
    }
    const inserting = xid(grant.xmin, XID_MODULUS - 1n)
    if (((full % XID_MODULUS) - inserting + XID_MODULUS) % XID_MODULUS !== BigInt(grant.age)) fail()
  }
  if (new Set(value.grants.map((grant) => grant.id)).size !== value.grants.length) fail()
  if (
    fingerprint(value.grants, value.version) !== value.grantsFingerprint ||
    !isDeepStrictEqual(
      [...new Set(value.grants.map((grant) => grant.productId))].sort((a, b) => a - b),
      value.grantProductIds,
    )
  )
    fail()
}

function database(payload: Payload): Database {
  const db: unknown = payload.db
  const drizzle = record(db) ? db.drizzle : undefined
  if (!record(drizzle) || typeof drizzle.transaction !== 'function') fail()
  return drizzle as unknown as Database
}

async function rows(tx: Executor, query: SQL, limit = LIMIT): Promise<Record<string, unknown>[]> {
  const result = await tx.execute(query)
  if (
    !record(result) ||
    !Array.isArray(result.rows) ||
    result.rowCount !== result.rows.length ||
    result.rows.length > limit ||
    !result.rows.every(record)
  )
    fail()
  return result.rows
}

async function configure(tx: Executor): Promise<void> {
  if (!record(tx) || typeof tx.execute !== 'function') fail()
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`)
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`)
}

async function lockedBaseline(
  tx: Executor,
  customerId: number,
  productIds: number[],
): Promise<RefundAccessBaseline> {
  const user = await rows(
    tx,
    sql`SELECT id FROM "public"."users"
    WHERE id = ${customerId} FOR UPDATE`,
    1,
  )
  if (user.length !== 1 || user[0].id !== customerId) fail()
  // Parent FK locks prevent insertions; child locks also cover parent-skipping adapter deletes.
  const purchases = await rows(
    tx,
    sql`SELECT id, products_id AS "productId"
    FROM "public"."users_rels" WHERE parent_id = ${customerId} AND path = 'purchases'
    ORDER BY id LIMIT ${LIMIT + 1} FOR UPDATE`,
  )
  const grants = await rows(
    tx,
    sql`SELECT id, product_id AS "productId", granted_at AS "grantedAt",
    _order AS "position", xmin::text AS "xmin", age(xmin) AS "age",
    source_kind AS "sourceKind", source_order_id AS "sourceOrder"
    FROM "public"."users_access_grants" WHERE _parent_id = ${customerId}
    ORDER BY id LIMIT ${LIMIT + 1} FOR UPDATE`,
  )
  // Snapshot xmax follows completed XIDs, so a running blocker can leave it below our own XID.
  const clock = await rows(
    tx,
    sql`SELECT pg_current_xact_id()::text AS "fullXid",
    GREATEST(pg_current_xact_id(), pg_snapshot_xmax(pg_current_snapshot()))::text AS "xidCeiling"`,
    1,
  )
  if (clock.length !== 1) fail()
  const purchaseRows = purchases.map((row) => ({ id: id(row.id), productId: id(row.productId) }))
  if (new Set(purchaseRows.map((row) => row.id)).size !== purchaseRows.length) fail()
  const grantRows = grants.map((row) => {
    if (typeof row.id !== 'string' || !row.id || row.id.length > 256) fail()
    return {
      id: row.id,
      productId: id(row.productId),
      grantedAt: iso(row.grantedAt),
      position: row.position as number,
      xmin: row.xmin as string,
      age: row.age as number,
      ...grantSource(row),
    }
  })
  if (new Set(grantRows.map((row) => row.id)).size !== grantRows.length) fail()
  const relevantGrants = grantRows.filter((row) => productIds.includes(row.productId))
  const baseline: RefundAccessBaseline = {
    version: 2,
    customerId,
    productIds,
    purchases: purchaseRows.filter((row) => productIds.includes(row.productId)),
    grantProductIds: [...new Set(relevantGrants.map((row) => row.productId))].sort((a, b) => a - b),
    grantsFingerprint: fingerprint(relevantGrants, 2),
    grantProof: 'bounded-xmin-provenance-v2',
    fullXid: clock[0].fullXid as string,
    xidCeiling: clock[0].xidCeiling as string,
    grants: relevantGrants,
  }
  validateVersions(baseline)
  return baseline
}

/** PostgreSQL xid8/age proof (PG18 documented/source semantics), not an unbounded xmin identity.
 * Modern VACUUM preserves xmin; changed/special tokens or invalid ages fail closed.
 * No grant provenance is inferred and no grant rows are removed.
 * Persist this before the provider call. Retain the original prepared/completion receipts;
 * never refresh this baseline to extend the one-million-transaction recovery window.
 */
export async function readRefundAccessBaseline(
  payload: Payload,
  userId: number | string,
  productIds: readonly number[],
): Promise<RefundAccessBaseline> {
  try {
    const customerId =
      typeof userId === 'string' && /^[1-9][0-9]*$/u.test(userId) ? Number(userId) : userId
    const selected = ids(productIds)
    return await database(payload).transaction(async (tx) => {
      await configure(tx)
      return lockedBaseline(tx, id(customerId), selected)
    })
  } catch {
    return fail()
  }
}

function validateBaseline(value: RefundAccessBaseline, productIds: number[]): void {
  if (
    !record(value) ||
    !(
      (value.version === 1 && ['absence-only', 'bounded-xmin-v1'].includes(value.grantProof)) ||
      (value.version === 2 && value.grantProof === 'bounded-xmin-provenance-v2')
    ) ||
    !isDeepStrictEqual(value.productIds, productIds) ||
    !Array.isArray(value.purchases) ||
    value.purchases.length > LIMIT ||
    !Array.isArray(value.grantProductIds) ||
    typeof value.grantsFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.grantsFingerprint)
  )
    fail()
  id(value.customerId)
  for (const row of value.purchases) {
    if (!record(row) || !productIds.includes(id(row.productId))) fail()
    id(row.id)
  }
  if (new Set(value.purchases.map((row) => row.id)).size !== value.purchases.length) fail()
  if (value.grantProductIds.some((product) => !productIds.includes(id(product)))) fail()
  if (value.grantProof !== 'absence-only') validateVersions(value)
}

function unchangedGrants(
  baseline: RefundAccessBaseline,
  current: RefundAccessBaseline,
  product: number,
): boolean {
  if (!baseline.grantProductIds.includes(product) && !current.grantProductIds.includes(product))
    return true
  if (baseline.version !== 2 || baseline.grantProof !== 'bounded-xmin-provenance-v2') return false
  const start = xid(baseline.fullXid)
  const end = xid(current.fullXid)
  const ceiling = xid(current.xidCeiling)
  if (end < start || ceiling < xid(baseline.xidCeiling) || ceiling - start >= MAX_XID_DELTA)
    return false
  // Initial modular age is in (0, 2^31). Reallocation of that xmin needs >2^31
  // further IDs, impossible within this strictly bounded xid8 horizon, across epochs too.
  const versions = (value: RefundAccessBaseline) =>
    value
      .grants!.filter((grant) => grant.productId === product)
      .map(({ id, productId, grantedAt, position, xmin, sourceKind, sourceOrder }) => ({
        id,
        productId,
        grantedAt,
        position,
        xmin,
        sourceKind,
        sourceOrder,
      }))
  return isDeepStrictEqual(versions(baseline), versions(current))
}

function identity(intent: RefundIntent): Record<string, unknown> {
  return {
    version: 1,
    intentId: id(intent.id),
    orderId: relationId(intent.order),
    sequence: id(intent.refundSequence),
    requestFingerprint: intent.requestHash,
  }
}

async function receipt(
  tx: Executor,
  intent: RefundIntent,
  action: string,
): Promise<Record<string, unknown> | null> {
  const result = await rows(
    tx,
    sql`SELECT actor_id AS "actorId", "after"
    FROM "public"."audit_logs" WHERE action = ${action}
      AND entity_type = 'refund-intents' AND entity_id = ${String(intent.id)}
    ORDER BY id LIMIT 2 FOR UPDATE`,
    1,
  )
  if (!result.length) return null
  const event = result[0]
  if (event.actorId !== relationId(intent.actor) || !record(event.after)) fail()
  const expected = identity(intent)
  if (
    Object.entries(expected).some(
      ([key, value]) => event.after && (event.after as Record<string, unknown>)[key] !== value,
    )
  )
    fail()
  return event.after
}

async function protectedProducts(
  tx: Executor,
  intent: RefundIntent,
  customerId: number,
  productIds: number[],
  grants: GrantVersion[],
): Promise<Set<number>> {
  // Lock every existing customer order before reading items; new customer FKs wait on users.
  const orders = await rows(
    tx,
    sql`SELECT id, status FROM "public"."orders"
    WHERE customer_id = ${customerId} ORDER BY id LIMIT ${ORDER_LIMIT + 1} FOR UPDATE`,
    ORDER_LIMIT,
  )
  if (new Set(orders.map((order) => id(order.id))).size !== orders.length) fail()
  const target = orders.find((order) => order.id === relationId(intent.order))
  if (!target || target.status !== 'refunded') fail()
  const orderIds = orders.map((order) => id(order.id))
  const items = await rows(
    tx,
    sql`SELECT id, _parent_id AS "orderId", product_id AS "productId"
    FROM "public"."orders_items" WHERE _parent_id IN (${sql.join(
      orderIds.map((value) => sql`${value}`),
      sql`, `,
    )})
    ORDER BY _parent_id, id LIMIT ${LIMIT + 1} FOR UPDATE`,
  )
  if (items.some((item) => !orderIds.includes(id(item.orderId)) || !id(item.productId))) fail()
  const ownProducts = [
    ...new Set(
      items.filter((item) => item.orderId === target.id).map((item) => id(item.productId)),
    ),
  ].sort((a, b) => a - b)
  if (!isDeepStrictEqual(ownProducts, productIds)) fail()
  const protectedIds = new Set<number>()
  for (const order of orders) {
    if (order.id === target.id) continue
    const overlap = items.filter(
      (item) => item.orderId === order.id && productIds.includes(id(item.productId)),
    )
    if (!overlap.length) continue
    if (order.status === 'paid') overlap.forEach((item) => protectedIds.add(id(item.productId)))
    else if (!['payment_failed', 'cancelled', 'refunded'].includes(String(order.status))) fail()
  }
  for (const grant of grants) {
    if (grant.sourceKind === 'independent') {
      protectedIds.add(grant.productId)
    } else if (grant.sourceKind === 'order') {
      // A foreign/missing source or a source that never contained the SKU is not origin proof.
      if (
        !orders.some((order) => order.id === grant.sourceOrder) ||
        !items.some(
          (item) => item.orderId === grant.sourceOrder && item.productId === grant.productId,
        )
      )
        fail()
    }
  }
  return protectedIds
}

/** Full-refund cleanup only. Caller must hold withUserPurchasesLock through this entire call.
 * Do not reacquire that advisory lock here: the caller holds it on a separate connection.
 * Grant-bearing targets require matching fields/IDs/xmin inside the bounded xid8 window.
 */
export async function applyRefundAccessCleanup(
  payload: Payload,
  input: { intent: RefundIntent; baseline: RefundAccessBaseline; productIds: readonly number[] },
): Promise<RefundAccessCleanupResult> {
  try {
    const { intent, baseline } = input
    const productIds = ids(input.productIds)
    validateBaseline(baseline, productIds)
    if (intent.state !== 'provider_succeeded' || !/^[a-f0-9]{64}$/u.test(intent.requestHash)) fail()
    const binding = identity(intent)
    return await database(payload).transaction(async (tx) => {
      await configure(tx)
      const stored = await rows(
        tx,
        sql`SELECT id FROM "public"."refund_intents"
        WHERE id = ${intent.id} AND state = 'provider_succeeded'
          AND order_id = ${relationId(intent.order)} AND actor_id = ${relationId(intent.actor)}
          AND refund_sequence = ${intent.refundSequence} AND request_hash = ${intent.requestHash}
        FOR UPDATE`,
        1,
      )
      if (stored.length !== 1 || stored[0].id !== intent.id) fail()
      const done = await receipt(tx, intent, 'refund-cleanup-done')
      if (done) {
        if (
          done.completed !== true ||
          done.reason !== 'resolved' ||
          !['sql-access-v1', 'sql-access-v2'].includes(String(done.cleanupKind))
        )
          fail()
        return COMPLETED
      }
      // A completed V1 receipt remains final; a pending V1 observation cannot prove origin.
      if (baseline.version !== 2) fail()
      const prepared = await receipt(tx, intent, 'refund-prepared')
      if (!prepared || !isDeepStrictEqual(prepared.accessBaseline, baseline)) fail()
      const current = await lockedBaseline(tx, baseline.customerId, productIds)
      const protectedIds = await protectedProducts(
        tx,
        intent,
        baseline.customerId,
        productIds,
        current.grants!,
      )
      const deleted: Array<{ id: number; productId: number }> = []
      for (const product of productIds) {
        if (protectedIds.has(product)) continue
        const existing = current.purchases.filter((row) => row.productId === product)
        if (!existing.length) continue
        const relevant = current.grants!.filter((grant) => grant.productId === product)
        if (
          !relevant.some(
            (grant) =>
              grant.sourceKind === 'order' && grant.sourceOrder === relationId(intent.order),
          ) ||
          relevant.some((grant) => grant.sourceKind == null)
        )
          throw new AccessCleanupFailure('grant-provenance', product)
        if (!unchangedGrants(baseline, current, product))
          throw new AccessCleanupFailure('access-changed', product)
        const original = baseline.purchases.filter((row) => row.productId === product)
        if (!isDeepStrictEqual(existing, original))
          throw new AccessCleanupFailure('access-changed', product)
        deleted.push(...existing)
      }
      if (deleted.length) {
        const actual = await rows(
          tx,
          sql`DELETE FROM "public"."users_rels"
          WHERE parent_id = ${baseline.customerId} AND path = 'purchases'
            AND (${sql.join(
              deleted.map((row) => sql`(id = ${row.id} AND products_id = ${row.productId})`),
              sql` OR `,
            )})
          RETURNING id, products_id AS "productId"`,
        )
        const normalized = actual
          .map((row) => ({ id: id(row.id), productId: id(row.productId) }))
          .sort((a, b) => a.id - b.id)
        if (
          !isDeepStrictEqual(
            normalized,
            [...deleted].sort((a, b) => a.id - b.id),
          )
        )
          fail()
      }
      const after = {
        ...binding,
        completed: true,
        reason: 'resolved',
        cleanupKind: 'sql-access-v2',
        revokedSourceOrderId: relationId(intent.order),
        retainedGrantIds: current.grants!.map((grant) => grant.id).sort(),
        deletedRelationIds: deleted.map((row) => row.id).sort((a, b) => a - b),
        preservedProductIds: [...protectedIds].sort((a, b) => a - b),
      }
      const saved = await rows(
        tx,
        sql`INSERT INTO "public"."audit_logs"
        (actor_id, action, entity_type, entity_id, "after")
        VALUES (${relationId(intent.actor)}, 'refund-cleanup-done', 'refund-intents',
          ${String(intent.id)}, ${JSON.stringify(after)}::jsonb)
        RETURNING actor_id AS "actorId", "after"`,
        1,
      )
      if (
        saved.length !== 1 ||
        saved[0].actorId !== relationId(intent.actor) ||
        !isDeepStrictEqual(saved[0].after, after)
      )
        fail()
      return COMPLETED
    })
  } catch (error) {
    // A tranzakció visszagördült: hozzáférés nem veszett el. A kurzus és az ok
    // a tulajdonosi üzenethez megy; minden más hiba részlet nélküli kézi eset.
    return error instanceof AccessCleanupFailure
      ? { status: 'manual_review', detail: error.detail, productId: error.productId }
      : MANUAL
  }
}
