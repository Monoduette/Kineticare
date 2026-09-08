import type { Payload, PayloadRequest, Where } from 'payload'

import type { Order, Product } from '../payload-types'
import {
  mergeAccessStartDates,
  orderIdsFromAccessGrantRows,
  productIdFromGrant,
  resolveEligibleGrantDates,
  type AccessGrantOrderEvidence,
  type AccessGrantRow,
} from './access-grants'
import { resolveCourseAccess, type CourseAccessState } from './course-access'
import { logger as rootLogger, type Logger } from './logger'

/**
 * A vásárlási időpont felderítése a hozzáférés-számításhoz (A1).
 *
 * A `users.purchases` reláció csak azt tudja, MIT vett meg a felhasználó — azt
 * nem, hogy MIKOR. Az orders sémában nincs `paidAt` mező (új mező migrációt
 * igényelne, ami tilos zóna), ezért a vásárlás időpontja a termékre szóló
 * **paid** rendelés `createdAt` értéke. A rendelés és a paid átmenet között
 * percek telnek el, a hozzáférés hossza pedig napokban mérendő — ez a
 * pontosság bőven elegendő.
 *
 * Ismételt vásárlás (megújítás) esetén a LEGUTOLSÓ paid rendelés számít, így az
 * újravásárlás meghosszabbítja a hozzáférést.
 *
 * A modul tiszta magja a `purchaseDatesFromOrders` (rendelés-lista → térkép);
 * a Payload-lekérdezés csak az adatot szállítja hozzá.
 */

/**
 * Egy lekérdezés felső korlátja. Több SKU esetén a már megtalált SKU-kat
 * kizárjuk a következő körből, így egy népszerű kurzus nem rejthet el másikat.
 */
export const PURCHASE_HISTORY_QUERY_LIMIT = 250

/**
 * productId → a legutolsó PAID rendelés `createdAt` értéke (ISO-string).
 * A nem paid (created/pending/cancelled/failed/refunded) rendelések kimaradnak.
 */
export function purchaseDatesFromOrders(orders: Order[]): Map<number, string> {
  const latest = new Map<number, { iso: string; ms: number }>()
  for (const order of orders) {
    if (order.status !== 'paid') {
      continue
    }
    const createdAt = typeof order.createdAt === 'string' ? order.createdAt : null
    const createdAtMs = createdAt === null ? Number.NaN : new Date(createdAt).getTime()
    if (createdAt === null || Number.isNaN(createdAtMs)) {
      continue
    }
    for (const item of order.items ?? []) {
      const product = item.product
      if (product === null || product === undefined) {
        continue
      }
      const productId = typeof product === 'object' ? product.id : product
      const previous = latest.get(productId)
      if (previous === undefined || createdAtMs > previous.ms) {
        latest.set(productId, { iso: createdAt, ms: createdAtMs })
      }
    }
  }
  return new Map([...latest].map(([productId, value]) => [productId, value.iso]))
}

export interface PurchaseHistoryInput {
  payload: Payload
  /** A vevő azonosítója — a lekérdezés kizárólag az ő rendeléseit olvassa. */
  userId: number
  /**
   * Ha meg van adva, a lekérdezés csak ezekre a termékekre szűr.
   * Így egy régi, de a kért SKU-ra vonatkozó paid rendelés nem esik ki a
   * 250-es ablakból, ha a vevőnek közben sok más kurzusa is van.
   */
  productIds?: readonly number[]
  logger?: Logger
  req?: PayloadRequest
}

export interface PurchaseDatesLookup {
  dates: Map<number, string>
  /** true: a Payload-lekérdezés hibára futott (nem „nincs rendelés"). */
  failed: boolean
  /** Részleges hiba esetén csak az érintett SKU-k hozzáférése bizonytalan. */
  failedProductIds?: ReadonlySet<number>
}

function paidOrdersWhere(userId: number, productIds: readonly number[] | undefined): Where {
  const clauses: Where[] = [{ customer: { equals: userId } }, { status: { equals: 'paid' } }]
  if (productIds !== undefined && productIds.length > 0) {
    clauses.push({ 'items.product': { in: [...productIds] } })
  }
  return { and: clauses }
}

/**
 * A vevő paid rendeléseiből épített vásárlásidőpont-térkép.
 *
 * Lekérdezési hiba esetén ÜRES térképpel és `failed: true` jelzővel tér vissza.
 * A lista-nézet (fail-open) ettől még megmutatja a megvett kurzust; a
 * stream-token (fail-closed) nem ad ki videót dátum nélkül, ha a lekérdezés
 * elszállt. A hiba strukturált naplóba kerül.
 */
export async function lookupPurchaseDates(
  input: PurchaseHistoryInput,
): Promise<PurchaseDatesLookup> {
  const log = input.logger ?? rootLogger
  const dates = new Map<number, string>()
  const failedProductIds = new Set<number>()
  const remaining = input.productIds === undefined ? undefined : new Set(input.productIds)
  const failure = (): PurchaseDatesLookup => {
    for (const id of remaining ?? []) failedProductIds.add(id)
    return {
      dates,
      failed: true,
      failedProductIds: remaining === undefined ? undefined : failedProductIds,
    }
  }
  if (remaining?.size === 0) return { dates, failed: false, failedProductIds }
  try {
    // Minden folytatott kör legalább egy különböző SKU-t felold: legfeljebb
    // a kért SKU-k számával arányos a munka, nincs korlátlan lapozás.
    while (true) {
      const result = await input.payload.find({
        collection: 'orders',
        where: paidOrdersWhere(input.userId, remaining === undefined ? undefined : [...remaining]),
        sort: '-createdAt',
        depth: 0,
        limit: PURCHASE_HISTORY_QUERY_LIMIT,
        overrideAccess: true,
        ...(input.req === undefined ? {} : { req: input.req }),
      })
      const rows = result.docs as Order[]
      const roundDates = purchaseDatesFromOrders(rows)
      for (const row of rows) {
        if (row.status !== 'paid' || Number.isFinite(Date.parse(row.createdAt))) continue
        for (const item of row.items ?? []) {
          const id = typeof item.product === 'object' ? item.product?.id : item.product
          if (typeof id === 'number' && (remaining === undefined || remaining.has(id))) {
            failedProductIds.add(id)
            roundDates.delete(id)
          }
        }
      }
      let progress = 0
      for (const [id, date] of roundDates) {
        if (remaining !== undefined && !remaining.has(id)) continue
        if (failedProductIds.has(id)) continue
        dates.set(id, date)
        if (remaining?.delete(id)) progress += 1
      }
      // Hiányt csak teljes válaszból következtetünk. A rövid, metaadat nélküli
      // adapter-fixtúra is teljes; a limitet elérő bizonytalan válasz nem az.
      const complete =
        result.hasNextPage === false ||
        (result.hasNextPage === undefined && rows.length < PURCHASE_HISTORY_QUERY_LIMIT)
      if (complete || remaining?.size === 0) {
        return { dates, failed: failedProductIds.size > 0, failedProductIds }
      }
      if (result.hasNextPage !== true || remaining === undefined || progress === 0) return failure()
    }
  } catch (error) {
    log.warn('kurzus-hozzáférés: a vásárlási időpontok lekérdezése sikertelen', {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return failure()
  }
}

export async function fetchPurchaseDates(
  input: PurchaseHistoryInput,
): Promise<Map<number, string>> {
  const { dates } = await lookupPurchaseDates(input)
  return dates
}

/** A hozzáférés-számításhoz elegendő termék-alak (id + korlát). */
export type CourseAccessProduct = Pick<Product, 'id' | 'accessDurationDays'>

/** Van-e a listában olyan termék, amelyen egyáltalán értelmezett a lejárat. */
function hasAnyDurationLimit(products: CourseAccessProduct[]): boolean {
  return products.some(
    (product) =>
      typeof product.accessDurationDays === 'number' &&
      Number.isFinite(product.accessDurationDays) &&
      product.accessDurationDays > 0,
  )
}

export interface CourseAccessForUserInput {
  payload: Payload
  userId: number
  products: CourseAccessProduct[]
  /** „Most" — determinisztikus teszteléshez injektálható. */
  now?: Date
  logger?: Logger
  req?: PayloadRequest
  /**
   * true: lekérdezési hibánál a korlátos SKU-t NEM nyitjuk ki (stream-token).
   * false/üres: a lista-nézet fail-open marad, hogy a vevő ne tűnjön el egy
   * adatbázis-akadás alatt.
   */
  denyOnLookupFailure?: boolean
}

const GRANT_SNAPSHOT_KEY = Symbol('kineticare-course-grant-snapshot')
const ORDER_EVIDENCE_BATCH_SIZE = 100

interface GrantSnapshot {
  rows: unknown[]
  failed: boolean
  orders: Map<number, Promise<AccessGrantOrderEvidence | null>>
}

class GrantRequestCache {
  readonly payloads = new WeakMap<Payload, Map<number, Promise<GrantSnapshot>>>()
}

/** Az eredmény és a hiba is csak e kérésen belül él, actoronként elkülönítve. */
function grantSnapshot(input: CourseAccessForUserInput): Promise<GrantSnapshot> {
  const load = async (): Promise<GrantSnapshot> => {
    try {
      const user = await input.payload.findByID({
        collection: 'users',
        id: input.userId,
        depth: 0,
        select: { accessGrants: true },
        overrideAccess: true,
        ...(input.req === undefined ? {} : { req: input.req }),
      })
      if (!user || typeof user !== 'object') throw new Error('Missing course grant owner')
      const rows: unknown = user.accessGrants
      if (rows != null && !Array.isArray(rows)) throw new Error('Malformed course grant rows')
      return { rows: Array.isArray(rows) ? rows : [], failed: false, orders: new Map() }
    } catch {
      const log = input.logger ?? rootLogger
      log.warn('kurzus-hozzáférés: az ajándék-időpontok lekérdezése sikertelen', {
        userId: input.userId,
      })
      return { rows: [], failed: true, orders: new Map() }
    }
  }
  if (!input.req) return load()
  const context = (input.req.context ??= {}) as PayloadRequest['context'] & {
    [GRANT_SNAPSHOT_KEY]?: GrantRequestCache
  }
  const cache = (context[GRANT_SNAPSHOT_KEY] ??= new GrantRequestCache())
  let actors = cache.payloads.get(input.payload)
  if (!actors) {
    actors = new Map()
    cache.payloads.set(input.payload, actors)
  }
  let promise = actors.get(input.userId)
  if (!promise) {
    promise = load()
    actors.set(input.userId, promise)
  }
  return promise
}

async function linkedOrderEvidence(
  input: CourseAccessForUserInput,
  snapshot: GrantSnapshot,
  ids: number[],
): Promise<Map<number, AccessGrantOrderEvidence>> {
  const missing = ids.filter((id) => !snapshot.orders.has(id))
  for (let offset = 0; offset < missing.length; offset += ORDER_EVIDENCE_BATCH_SIZE) {
    const chunk = missing.slice(offset, offset + ORDER_EVIDENCE_BATCH_SIZE)
    const batch = (async (): Promise<Map<number, AccessGrantOrderEvidence>> => {
      try {
        const result = await input.payload.find({
          collection: 'orders',
          where: { id: { in: chunk } },
          depth: 0,
          select: { id: true, customer: true, status: true, items: true },
          limit: chunk.length,
          pagination: false,
          overrideAccess: true,
          ...(input.req === undefined ? {} : { req: input.req }),
        })
        const byId = new Map<number, AccessGrantOrderEvidence>()
        for (const order of result.docs) {
          if (!chunk.includes(order.id) || byId.has(order.id))
            throw new Error('Ambiguous grant source')
          byId.set(order.id, order)
        }
        return byId
      } catch {
        const log = input.logger ?? rootLogger
        log.warn('kurzus-hozzáférés: a jogosultság eredete nem ellenőrizhető', {
          userId: input.userId,
          sourceCount: chunk.length,
        })
        return new Map()
      }
    })()
    // A Promise minden ID-hoz az első await előtt bekerül, így egy másik
    // párhuzamos mezőcsoport sem indít újabb azonos forráslekérdezést.
    for (const id of chunk)
      snapshot.orders.set(
        id,
        batch.then((byId) => byId.get(id) ?? null),
      )
  }
  const results = await Promise.all(
    ids.map(async (id) => [id, await snapshot.orders.get(id)] as const),
  )
  return new Map(
    results.filter((pair): pair is readonly [number, AccessGrantOrderEvidence] => pair[1] != null),
  )
}

/**
 * productId → hozzáférés-állapot az adott vevőre.
 *
 * A friss eredet sorait a kérés megosztja. Korlátlan, provenance nélküli
 * kurzushoz nem kell rendelésolvasás; explicit eredetnél viszont igen, hogy
 * a refundolt forrás ne váljon a hiányzó dátum miatt korlátlan hozzáféréssé.
 */
export async function resolveCourseAccessForUser(
  input: CourseAccessForUserInput,
): Promise<Map<number, CourseAccessState>> {
  const states = new Map<number, CourseAccessState>()
  if (input.products.length === 0) {
    return states
  }

  const snapshot = await grantSnapshot(input)
  const productIds = new Set(input.products.map((product) => product.id))
  const rows = snapshot.rows.filter(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      productIds.has(productIdFromGrant((row as AccessGrantRow).product) ?? -1),
  )
  const knownProductIds = resolveEligibleGrantDates({
    rows,
    userId: input.userId,
    ordersById: new Map(),
  }).knownProductIds
  const historyProductIds = input.products
    .filter((product) => hasAnyDurationLimit([product]) || knownProductIds.has(product.id))
    .map((product) => product.id)
  const [lookup, ordersById] = await Promise.all([
    historyProductIds.length > 0
      ? lookupPurchaseDates({
          payload: input.payload,
          userId: input.userId,
          productIds: historyProductIds,
          logger: input.logger,
          req: input.req,
        })
      : ({ dates: new Map<number, string>(), failed: false } as PurchaseDatesLookup),
    linkedOrderEvidence(input, snapshot, orderIdsFromAccessGrantRows(rows)),
  ])
  const grants = resolveEligibleGrantDates({ rows, userId: input.userId, ordersById })
  const startDates = mergeAccessStartDates(
    lookup.dates,
    mergeAccessStartDates(grants.dates, grants.legacyDates),
  )

  for (const product of input.products) {
    const durationDays = product.accessDurationDays ?? null
    const grantMissingForProduct = snapshot.failed && !lookup.dates.has(product.id)
    if (
      (lookup.failed &&
        (lookup.failedProductIds === undefined || lookup.failedProductIds.has(product.id))) ||
      grantMissingForProduct ||
      grants.unresolvedProductIds.has(product.id)
    ) {
      states.set(product.id, {
        // A lista megtartja a kurzus linkjét; a tényleges tartalmi kapu újra
        // ellenőriz és tilt. Bizonytalanságot egyik nézet sem nevez refundnak.
        hasAccess: input.denyOnLookupFailure !== true,
        expiresAt: null,
        reason: 'unknown-purchase-date',
      })
      continue
    }
    if (knownProductIds.has(product.id) && !startDates.has(product.id)) {
      states.set(product.id, { hasAccess: false, expiresAt: null, reason: 'revoked' })
      continue
    }
    states.set(
      product.id,
      resolveCourseAccess({
        purchasedAt: startDates.get(product.id) ?? null,
        accessDurationDays: durationDays,
        now: input.now,
      }),
    )
  }
  return states
}

export interface SingleCourseAccessInput {
  payload: Payload
  userId: number
  product: CourseAccessProduct
  now?: Date
  logger?: Logger
  req?: PayloadRequest
}

/** Egy termék hozzáférés-állapota (a lejátszó-oldal és a stream-token ága). */
export async function resolveSingleCourseAccess(
  input: SingleCourseAccessInput,
): Promise<CourseAccessState> {
  const states = await resolveCourseAccessForUser({
    payload: input.payload,
    userId: input.userId,
    products: [input.product],
    now: input.now,
    logger: input.logger,
    req: input.req,
    denyOnLookupFailure: true,
  })
  return (
    states.get(input.product.id) ??
    resolveCourseAccess({
      purchasedAt: null,
      accessDurationDays: input.product.accessDurationDays ?? null,
      now: input.now,
    })
  )
}
