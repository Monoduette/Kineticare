import type { Payload, Where } from 'payload'

import type { Order, Product } from '../payload-types'
import { grantDatesFromRows, mergeAccessStartDates } from './access-grants'
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
 * Egy vevőnél ennél több paid rendeléssel nem számolunk egy oldalletöltésen.
 * A lekérdezés a LEGFRISSEBB rendelésekkel kezd (`-createdAt`), mert a
 * megújítás-szabály szerint úgyis a legutolsó vásárlás dönt.
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
}

export interface PurchaseDatesLookup {
  dates: Map<number, string>
  /** true: a Payload-lekérdezés hibára futott (nem „nincs rendelés"). */
  failed: boolean
}

function paidOrdersWhere(
  userId: number,
  productIds: readonly number[] | undefined,
): Where {
  const clauses: Where[] = [
    { customer: { equals: userId } },
    { status: { equals: 'paid' } },
  ]
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
  try {
    const result = await input.payload.find({
      collection: 'orders',
      where: paidOrdersWhere(input.userId, input.productIds),
      sort: '-createdAt',
      depth: 0,
      limit: PURCHASE_HISTORY_QUERY_LIMIT,
      overrideAccess: true,
    })
    return { dates: purchaseDatesFromOrders(result.docs as Order[]), failed: false }
  } catch (error) {
    log.warn('kurzus-hozzáférés: a vásárlási időpontok lekérdezése sikertelen', {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { dates: new Map(), failed: true }
  }
}

export async function fetchPurchaseDates(input: PurchaseHistoryInput): Promise<Map<number, string>> {
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
  /**
   * true: lekérdezési hibánál a korlátos SKU-t NEM nyitjuk ki (stream-token).
   * false/üres: a lista-nézet fail-open marad, hogy a vevő ne tűnjön el egy
   * adatbázis-akadás alatt.
   */
  denyOnLookupFailure?: boolean
}

/**
 * productId → hozzáférés-állapot az adott vevőre.
 *
 * Ha egyik terméken sincs érvényes `accessDurationDays`, a rendelés-lekérdezés
 * EL SEM INDUL (a mai, korlátlan viselkedés extra DB-kör nélkül marad).
 */
export async function resolveCourseAccessForUser(
  input: CourseAccessForUserInput,
): Promise<Map<number, CourseAccessState>> {
  const states = new Map<number, CourseAccessState>()
  if (input.products.length === 0) {
    return states
  }

  const limitedProductIds = input.products
    .filter((product) => hasAnyDurationLimit([product]))
    .map((product) => product.id)

  const lookup = hasAnyDurationLimit(input.products)
    ? await lookupPurchaseDates({
        payload: input.payload,
        userId: input.userId,
        productIds: limitedProductIds,
        logger: input.logger,
      })
    : { dates: new Map<number, string>(), failed: false }

  let grantDates = new Map<number, string>()
  let grantFailed = false
  if (hasAnyDurationLimit(input.products)) {
    try {
      const user = await input.payload.findByID({
        collection: 'users',
        id: input.userId,
        depth: 0,
        overrideAccess: true,
      })
      grantDates = grantDatesFromRows(
        user && typeof user === 'object' ? (user as { accessGrants?: unknown }).accessGrants : null,
      )
    } catch (error) {
      grantFailed = true
      const log = input.logger ?? rootLogger
      log.warn('kurzus-hozzáférés: az ajándék-időpontok lekérdezése sikertelen', {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const startDates = mergeAccessStartDates(lookup.dates, grantDates)

  for (const product of input.products) {
    const durationDays = product.accessDurationDays ?? null
    const isLimited =
      typeof durationDays === 'number' && Number.isFinite(durationDays) && durationDays > 0
    const grantMissingForProduct = grantFailed && !lookup.dates.has(product.id)
    if (
      (lookup.failed || grantMissingForProduct) &&
      input.denyOnLookupFailure === true &&
      isLimited
    ) {
      states.set(product.id, {
        hasAccess: false,
        expiresAt: null,
        reason: 'unknown-purchase-date',
      })
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
