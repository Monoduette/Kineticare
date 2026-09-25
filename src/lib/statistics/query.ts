/**
 * Statisztika-lekérdezés — Payload local API → tiszta aggregátor bemenet.
 *
 * Csak szerepkör-kapu után (`overrideAccess: true`). A `refunds` mező
 * tulajdonosi olvasású (CLAUDE.md 4.), ezért alapból NEM kérjük le; csak ha a
 * hívó a tulajdonos nevében kifejezetten kéri (`includePartialRefunds`), és
 * akkor is csak a részleges visszatérítések összege és időpontja jut tovább
 * (tranzakció-azonosító, indok nem).
 * Lapozás felső korláttal; tölcsér `count`-ból; rendezés `['-createdAt','id']` (stabil lapozás).
 */

import type { Payload } from 'payload'

import {
  buildOrderFunnelFromCounts,
  buildRevenueReport,
  FUNNEL_STATUSES,
  type OrderFunnelCounts,
  type RevenueOrderInput,
  type RevenueOrderItemInput,
  type RevenuePartialRefundInput,
  type RevenueReport,
} from './revenue'

/** Egy lapon beolvasott rendelés. */
export const STATISTICS_ORDER_PAGE_SIZE = 200
/** Legfeljebb ennyi fizetett rendelést aggregálunk egy nézet-betöltéskor. */
export const STATISTICS_ORDER_MAX = 10_000

interface FindResultLike<T> {
  docs?: T[] | null
  totalDocs?: number | null
  hasNextPage?: boolean | null
}

interface PagedResult<T> {
  docs: T[]
  truncated: boolean
}

/**
 * A rendelés-dokumentum azon szelete, amit a lekérdezés KIKÉR. Nincs benne
 * `customerSnapshot`, `ipAddress`, `customerEmail`; a `refunds` csak a
 * tulajdonosi lekérdezésben.
 */
export interface StatisticsOrderDoc {
  status?: string | null
  createdAt?: string | null
  invoiceCompletionDate?: string | null
  totalHufSnapshot?: number | null
  items?: readonly StatisticsOrderItemDoc[] | null
  refunds?: unknown
}

export interface StatisticsOrderItemDoc {
  product?: unknown
  quantity?: number | null
  titleSnapshot?: string | null
  priceHufSnapshot?: number | null
}

const ORDER_SELECT = {
  status: true,
  createdAt: true,
  invoiceCompletionDate: true,
  totalHufSnapshot: true,
  items: true,
} as const

/** A tulajdonosi lekérdezés: a részleges visszatérítések levonásához a `refunds` is. */
const ORDER_SELECT_WITH_REFUNDS = { ...ORDER_SELECT, refunds: true } as const

/**
 * Lapozott rendelés-lekérdezés: ['-createdAt', 'id'] — stabil lapozás, friss sorok maradnak csonkolásnál.
 */
const PAGED_ORDER_SORT: string[] = ['-createdAt', 'id']

/**
 * Csonkolt-e a beolvasás: először totalDocs, majd hasNextPage, végül tartalék (tele utolsó lap).
 */
export function isReadTruncated(input: {
  /** A Payload `totalDocs` mezője az utolsó lapról (ha adta). */
  totalDocs: number | null | undefined
  /** A Payload `hasNextPage` mezője az utolsó lapról (ha adta). */
  hasNextPage: boolean | null | undefined
  /** A felső korlát. */
  maxDocs: number
  /** Ennyi sort olvastunk be a levágás ELŐTT. */
  loaded: number
  /** Az utolsó lap sorainak száma és a kért lapméret. */
  pageDocsLength: number
  pageSize: number
}): boolean {
  const { totalDocs, hasNextPage, maxDocs, loaded, pageDocsLength, pageSize } = input
  if (typeof totalDocs === 'number' && Number.isFinite(totalDocs) && totalDocs >= 0) {
    return totalDocs > maxDocs
  }
  if (typeof hasNextPage === 'boolean') {
    return hasNextPage || loaded > maxDocs
  }
  return pageDocsLength === pageSize || loaded > maxDocs
}

/**
 * Lapozott beolvasás felső korláttal. A pontosan a korláttal egyező, teljes
 * halmaz NEM csonkolt — ugyanaz a szabály, mint a kurzus-haladás panelen
 * (a döntést a KÖZÖS `isReadTruncated` hozza, hogy a két olvasó ne csúszhasson
 * szét).
 */
export async function readStatisticsPages<T>(
  fetchPage: (page: number, limit: number) => Promise<FindResultLike<T>>,
  pageSize: number,
  maxDocs: number,
): Promise<PagedResult<T>> {
  const docs: T[] = []
  let page = 1

  for (;;) {
    const result = await fetchPage(page, pageSize)
    const pageDocs = Array.isArray(result.docs) ? result.docs : []
    docs.push(...pageDocs)
    if (docs.length >= maxDocs) {
      return {
        docs: docs.slice(0, maxDocs),
        truncated: isReadTruncated({
          totalDocs: result.totalDocs,
          hasNextPage: result.hasNextPage,
          maxDocs,
          loaded: docs.length,
          pageDocsLength: pageDocs.length,
          pageSize,
        }),
      }
    }
    if (pageDocs.length < pageSize || result.hasNextPage === false) {
      return { docs, truncated: false }
    }
    page += 1
  }
}

function audienceFromProduct(product: unknown): unknown {
  if (typeof product !== 'object' || product === null) {
    return undefined
  }
  return (product as { audience?: unknown }).audience
}

/**
 * A termék MAI marketingcíme a populált relationshipből.
 *
 * A bevétel-tábla sorfejléce ez, nem a sku-snapshot (H7, 2026-08-21-i audit):
 * ugyanaz a kurzus nem futhat két néven egy lapon (WCAG 2.2 SC 3.2.4). Ha a
 * termék nincs populálva vagy időközben törölték, `null` jön vissza, és az
 * aggregátor a sku-ra esik vissza.
 */
function displayTitleFromProduct(product: unknown): string | null {
  if (typeof product !== 'object' || product === null) {
    return null
  }
  const value = (product as { displayTitle?: unknown }).displayTitle
  return typeof value === 'string' ? value : null
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Tétel-mennyiség bevételhez: hiányzó/nem pozitív = 1 (order-integrity és checkout szerint).
 */
function quantityOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * A `refunds` json-mezőből CSAK a részleges tételek összege és időpontja. A
 * teljes visszatérítés a rendelést `refunded` státuszba viszi, az eleve
 * kimarad; az azonosító és az indok nem kell a kimutatáshoz.
 */
export function partialRefundsOf(refunds: unknown): RevenuePartialRefundInput[] {
  if (!Array.isArray(refunds)) {
    return []
  }
  const result: RevenuePartialRefundInput[] = []
  for (const entry of refunds) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const { type, amountHuf, refundedAt } = entry as {
      type?: unknown
      amountHuf?: unknown
      refundedAt?: unknown
    }
    if (
      type === 'partial' &&
      typeof amountHuf === 'number' &&
      Number.isFinite(amountHuf) &&
      amountHuf > 0 &&
      typeof refundedAt === 'string'
    ) {
      result.push({ amountHuf, refundedAt })
    }
  }
  return result
}

/**
 * A Payload-dokumentum leképezése az aggregátor bemenetére — tiszta, tesztelhető.
 * A részleges visszatérítés CSAK kifejezett kérésre kerül át (akkor sem, ha a
 * dokumentum véletlenül hordozná a `refunds` mezőt).
 */
export function mapOrderDocToRevenueInput(
  doc: StatisticsOrderDoc,
  options: { includePartialRefunds?: boolean } = {},
): RevenueOrderInput {
  const items: RevenueOrderItemInput[] = []
  if (Array.isArray(doc.items)) {
    for (const item of doc.items) {
      items.push({
        audience: audienceFromProduct(item.product),
        priceHuf: finiteOrZero(item.priceHufSnapshot),
        quantity: quantityOf(item.quantity),
        titleSnapshot: typeof item.titleSnapshot === 'string' ? item.titleSnapshot : null,
        displayTitle: displayTitleFromProduct(item.product),
      })
    }
  }
  return {
    status: typeof doc.status === 'string' ? doc.status : '',
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : '',
    invoiceCompletionDate:
      typeof doc.invoiceCompletionDate === 'string' ? doc.invoiceCompletionDate : null,
    totalHuf: typeof doc.totalHufSnapshot === 'number' ? doc.totalHufSnapshot : null,
    items,
    ...(options.includePartialRefunds === true
      ? { partialRefunds: partialRefundsOf(doc.refunds) }
      : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function productIdOf(product: unknown): number | null {
  if (typeof product === 'number' && Number.isFinite(product)) {
    return product
  }
  if (isRecord(product) && typeof product.id === 'number' && Number.isFinite(product.id)) {
    return product.id
  }
  return null
}

/**
 * Pótolni kell a termék mezőit, ha a product csak azonosító, vagy `{ id }` van
 * audience kulcs nélkül. Explicit `audience: null` NEM hiányzó: az a laikus
 * fallback a `normalizeAudience`-ben.
 */
function productNeedsAudienceHydration(product: unknown): boolean {
  if (typeof product === 'number' && Number.isFinite(product)) {
    return true
  }
  if (!isRecord(product)) {
    return false
  }
  if (typeof product.id !== 'number' || !Number.isFinite(product.id)) {
    return false
  }
  return !('audience' in product)
}

/**
 * A hiányzó termék-mezők (ág és marketingcím) pótlása EGYETLEN, batchelt
 * lekérdezéssel. A cím ugyanabban a körben jön, mint az ág: külön hívás
 * ugyanazokra a sorokra fölösleges kör lenne.
 */
async function hydrateProductFields(
  payload: Pick<Payload, 'find'>,
  docs: StatisticsOrderDoc[],
): Promise<StatisticsOrderDoc[]> {
  const missingIds = new Set<number>()
  for (const doc of docs) {
    for (const item of doc.items ?? []) {
      if (productNeedsAudienceHydration(item.product)) {
        const id = productIdOf(item.product)
        if (id !== null) {
          missingIds.add(id)
        }
      }
    }
  }
  if (missingIds.size === 0) {
    return docs
  }

  const products = (await payload.find({
    collection: 'products',
    where: { id: { in: [...missingIds] } },
    depth: 0,
    pagination: false,
    limit: missingIds.size,
    select: { id: true, audience: true, displayTitle: true },
    overrideAccess: true,
  })) as FindResultLike<{ id?: unknown; audience?: unknown; displayTitle?: unknown }>

  const audienceById = new Map<number, unknown>()
  const titleById = new Map<number, unknown>()
  for (const product of products.docs ?? []) {
    if (typeof product.id === 'number') {
      audienceById.set(product.id, product.audience)
      titleById.set(product.id, product.displayTitle)
    }
  }

  return docs.map((doc) => ({
    ...doc,
    items: Array.isArray(doc.items)
      ? doc.items.map((item) => {
          if (!productNeedsAudienceHydration(item.product)) {
            return item
          }
          const id = productIdOf(item.product)
          if (id === null) {
            return item
          }
          return {
            ...item,
            product: { id, audience: audienceById.get(id), displayTitle: titleById.get(id) },
          }
        })
      : doc.items,
  }))
}

export interface QueryRevenueReportDeps {
  /**
   * `find` a fizetett rendelések lapozott beolvasásához és a product-audience
   * pótlásához; `count` a tölcsérhez (F8 — a hat szám nem 20 000 sorból jön).
   */
  payload: Pick<Payload, 'count' | 'find'>
  now?: Date
  months?: number
  /**
   * Tulajdonosi nézet: a részleges visszatérítések levonása a visszatérítés
   * hónapjában. Csak `role === 'owner'` mellett adható át (a `refunds` mező
   * tulajdonosi olvasású); munkatársnál a bruttó összeg marad.
   */
  includePartialRefunds?: boolean
}

/**
 * Rendelés-tölcsér hat száma — hét `payload.count`, sor-beolvasás nélkül (F8).
 */
async function countOrderFunnel(payload: Pick<Payload, 'count'>): Promise<OrderFunnelCounts> {
  const [totalResult, statusResults] = await Promise.all([
    payload.count({ collection: 'orders', overrideAccess: true }),
    Promise.all(
      FUNNEL_STATUSES.map((status) =>
        payload.count({
          collection: 'orders',
          where: { status: { equals: status } },
          overrideAccess: true,
        }),
      ),
    ),
  ])

  const countByStatus = new Map<string, number>()
  FUNNEL_STATUSES.forEach((status, index) => {
    countByStatus.set(status, statusResults[index]?.totalDocs ?? 0)
  })
  return buildOrderFunnelFromCounts(countByStatus, totalResult.totalDocs)
}

/**
 * Fizetett rendelések + státusz-tölcsér beolvasása, majd aggregálás.
 *
 * `overrideAccess: true` — a hívó felelőssége, hogy ezt CSAK a szerepkör-kapu
 * után hívja. A függvény magában nem ellenőriz szerepkört, hogy a unit-teszt
 * Payload-mockkal, auth nélkül futhasson.
 */
export async function queryRevenueReport(deps: QueryRevenueReportDeps): Promise<RevenueReport> {
  const paidPage = await readStatisticsPages<StatisticsOrderDoc>(
    (page, limit) =>
      deps.payload.find({
        collection: 'orders',
        where: { status: { equals: 'paid' } },
        depth: 1,
        page,
        limit,
        sort: PAGED_ORDER_SORT,
        select: deps.includePartialRefunds === true ? ORDER_SELECT_WITH_REFUNDS : ORDER_SELECT,
        overrideAccess: true,
      }) as Promise<FindResultLike<StatisticsOrderDoc>>,
    STATISTICS_ORDER_PAGE_SIZE,
    STATISTICS_ORDER_MAX,
  )

  const funnel = await countOrderFunnel(deps.payload)

  const hydrated = await hydrateProductFields(deps.payload, paidPage.docs)
  const includePartialRefunds = deps.includePartialRefunds === true
  const orders = hydrated.map((doc) => mapOrderDocToRevenueInput(doc, { includePartialRefunds }))
  return buildRevenueReport(orders, funnel, {
    now: deps.now,
    months: deps.months,
    // Csak a fizetett rendelések lapozása csonkolhat: a tölcsér `count`-ból
    // jön, azon nincs plafon.
    truncated: paidPage.truncated,
    refundsDeducted: includePartialRefunds,
  })
}
