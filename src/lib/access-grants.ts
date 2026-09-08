import type { Payload } from 'payload'
import type { Order } from '../payload-types'

/**
 * Ajándék-hozzáférés időpontjai — a 365 napos (vagy a terméken beállított)
 * óra KEZDŐPONTJA, paid rendelés nélkül.
 *
 * Miért NEM hamis paid rendelés: a paid átmenet számlát indít, az
 * ár-snapshot a termék élő árát rögzítené, a duplavásárlás-őr pedig
 * örökre tiltaná az újravásárlást. Az `accessGrants` tömb csak a
 * kezdőpontot tárolja; a lejáratot továbbra is `resolveCourseAccess`
 * számolja.
 *
 * Írás: kizárólag rendszerfolyamat (`overrideAccess: true`), a mező
 * create/update access-e zárt — ugyanaz a minta, mint a
 * `passwordSetupPending`.
 */

export interface AccessGrantRow {
  /** Payload tömbsor stabil azonosítója; meglévő sornál mindig megőrzendő. */
  id?: string | null
  product?: number | { id: number } | null
  /** ISO-8601; Payload date mező stringként tárol. */
  grantedAt?: string | null
  /** Hiányzó eredet: történeti bizonytalanság, nem automatikusan ajándék. */
  sourceKind?: 'order' | 'independent' | null
  sourceOrder?: number | { id: number } | null
}

export type AccessGrantSource =
  { sourceKind: 'order'; sourceOrder: number } | { sourceKind: 'independent'; sourceOrder?: null }

export function productIdFromGrant(product: AccessGrantRow['product']): number | null {
  const id = typeof product === 'object' && product !== null ? product.id : product
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** null = legacy; undefined = hibás/hiányos explicit eredet. */
function sourceFromRow(row: AccessGrantRow): AccessGrantSource | null | undefined {
  if (row.sourceKind == null && row.sourceOrder == null) return null
  if (row.sourceKind === 'independent' && row.sourceOrder == null)
    return { sourceKind: 'independent' }
  if (row.sourceKind === 'order') {
    const orderId = productIdFromGrant(row.sourceOrder)
    if (orderId !== null) return { sourceKind: 'order', sourceOrder: orderId }
  }
  return undefined
}

export type AccessGrantOrderEvidence = Pick<Order, 'id' | 'customer' | 'status' | 'items'>

export interface EligibleGrantDates {
  dates: Map<number, string>
  legacyDates: Map<number, string>
  unresolvedProductIds: Set<number>
  /** Explicit eredetű, de esetleg már nem jogosító SKU; nem eshet fail-open-ra. */
  knownProductIds: Set<number>
}

/** Tiszta eligibility: az order snapshotot a hívó friss, korlátos DB-olvasásból adja. */
export function resolveEligibleGrantDates(input: {
  rows: unknown
  userId: number
  ordersById: ReadonlyMap<number, AccessGrantOrderEvidence>
}): EligibleGrantDates {
  const result: EligibleGrantDates = {
    dates: new Map(),
    legacyDates: new Map(),
    unresolvedProductIds: new Set(),
    knownProductIds: new Set(),
  }
  if (!Array.isArray(input.rows)) return result
  const putLatest = (dates: Map<number, string>, product: number, date: string) => {
    const previous = dates.get(product)
    if (previous === undefined || Date.parse(date) > Date.parse(previous)) dates.set(product, date)
  }
  for (const value of input.rows) {
    if (!isRecord(value)) continue
    const row = value as AccessGrantRow
    const product = productIdFromGrant(row.product)
    if (product === null) continue
    const source = sourceFromRow(row)
    const date = toIso(row.grantedAt)
    if (source === null) {
      if (date) putLatest(result.legacyDates, product, date.iso)
      continue
    }
    result.knownProductIds.add(product)
    if (source === undefined || date === null) {
      result.unresolvedProductIds.add(product)
      continue
    }
    if (source.sourceKind === 'order') {
      const order = input.ordersById.get(source.sourceOrder)
      if (
        !order ||
        order.id !== source.sourceOrder ||
        productIdFromGrant(order.customer) !== input.userId ||
        !order.items?.some((item) => productIdFromGrant(item.product) === product)
      ) {
        result.unresolvedProductIds.add(product)
        continue
      }
      if (order.status !== 'paid') continue
    }
    putLatest(result.dates, product, date.iso)
  }
  return result
}

export function orderIdsFromAccessGrantRows(rows: unknown): number[] {
  const ids = new Set<number>()
  if (!Array.isArray(rows)) return []
  for (const value of rows) {
    if (!isRecord(value)) continue
    const source = sourceFromRow(value as AccessGrantRow)
    if (source?.sourceKind === 'order') ids.add(source.sourceOrder)
  }
  return [...ids].sort((a, b) => a - b)
}

function toIso(value: string | Date | null | undefined): { iso: string; ms: number } | null {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isNaN(ms) ? null : { iso: value.toISOString(), ms }
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : { iso: value, ms }
}

/** productId → a legutolsó ajándék `grantedAt` értéke (ISO). */
export function grantDatesFromRows(rows: unknown): Map<number, string> {
  const latest = new Map<number, { iso: string; ms: number }>()
  if (!Array.isArray(rows)) {
    return new Map()
  }
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue
    }
    const rec = row as AccessGrantRow
    const productId = productIdFromGrant(rec.product)
    const granted = toIso(rec.grantedAt ?? null)
    if (productId === null || granted === null) {
      continue
    }
    const previous = latest.get(productId)
    if (previous === undefined || granted.ms > previous.ms) {
      latest.set(productId, granted)
    }
  }
  return new Map([...latest].map(([productId, value]) => [productId, value.iso]))
}

/** Paid dátum és ajándék-dátum: a későbbi nyeri a kezdőpontot. */
export function mergeAccessStartDates(
  paidDates: Map<number, string>,
  grantDates: Map<number, string>,
): Map<number, string> {
  const merged = new Map(paidDates)
  for (const [productId, iso] of grantDates) {
    const previous = merged.get(productId)
    const previousMs = previous === undefined ? Number.NEGATIVE_INFINITY : Date.parse(previous)
    const nextMs = Date.parse(iso)
    if (previous === undefined || (!Number.isNaN(nextMs) && nextMs >= previousMs)) {
      merged.set(productId, iso)
    }
  }
  return merged
}

export function grantRowsFromUnknown(raw: unknown): AccessGrantRow[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw as AccessGrantRow[]
}

/**
 * Upsert eredetenként: másik paid rendelés, ajándék vagy legacy sor érintetlen.
 * A null eredet kizárólag kifejezett legacy művelethez használható.
 */
export function withUpsertedAccessGrant(
  existing: AccessGrantRow[],
  productId: number,
  grantedAt: Date,
  source: AccessGrantSource | null = null,
): AccessGrantRow[] {
  if (productIdFromGrant(productId) === null || sourceFromRow(source ?? {}) === undefined) {
    throw new Error('Access grant: invalid source identity')
  }
  const iso = grantedAt.toISOString()
  let found = 0
  const next = existing.map((row) => {
    const rowSource = sourceFromRow(row)
    const sameSource =
      source === null
        ? rowSource === null
        : source.sourceKind === rowSource?.sourceKind &&
          (source.sourceKind !== 'order' ||
            (rowSource?.sourceKind === 'order' && source.sourceOrder === rowSource.sourceOrder))
    if (productIdFromGrant(row.product) !== productId || !sameSource) {
      return row
    }
    found += 1
    return { ...row, product: productId, grantedAt: iso }
  })
  if (found > 1) throw new Error('Access grant: ambiguous source rows')
  if (!found) {
    next.push({ product: productId, grantedAt: iso, ...(source ?? {}) })
  }
  return next
}

/** Payload update-hez: kötelező product + grantedAt, null nélkül. */
export type AccessGrantWriteRow = {
  id?: string
  product: number
  grantedAt: string
  sourceKind?: 'order' | 'independent' | null
  sourceOrder?: number | null
}

export function accessGrantsForWrite(rows: AccessGrantRow[]): AccessGrantWriteRow[] {
  const next: AccessGrantWriteRow[] = []
  const seenIds = new Set<string>()
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      throw new Error('Access grant: invalid row')
    const productId = productIdFromGrant(row.product)
    const granted = toIso(row.grantedAt)
    const source = sourceFromRow(row)
    if (productId === null || granted === null || source === undefined) {
      throw new Error('Access grant: invalid persisted row requires reconciliation')
    }
    if (row.id != null) {
      if (
        typeof row.id !== 'string' ||
        !row.id.trim() ||
        row.id !== row.id.trim() ||
        seenIds.has(row.id)
      ) {
        throw new Error('Access grant: invalid or duplicate row identity')
      }
      seenIds.add(row.id)
    }
    next.push({
      ...(row.id != null ? { id: row.id } : {}),
      product: productId,
      grantedAt: granted.iso,
      ...(row.sourceKind !== undefined ? { sourceKind: row.sourceKind } : {}),
      ...(row.sourceOrder !== undefined
        ? { sourceOrder: productIdFromGrant(row.sourceOrder) }
        : {}),
    })
  }
  return next
}

/** A collection és a rendszerírók ugyanazt a provenance alakot fogadják el. */
export function validateAccessGrantRows(value: unknown): true | string {
  if (value == null) return true
  if (!Array.isArray(value)) return 'A hozzáférési sorok formátuma hibás.'
  try {
    accessGrantsForWrite(value as AccessGrantRow[])
    return true
  } catch {
    return 'A hozzáférési sorok azonosítója vagy eredete hibás. Ellenőrzés szükséges.'
  }
}

export async function upsertAccessGrant(input: {
  payload: Payload
  userId: number
  productId: number
  grantedAt?: Date
  existingRows?: unknown
  source?: AccessGrantSource | null
}): Promise<AccessGrantRow[]> {
  const grantedAt = input.grantedAt ?? new Date()
  const next = withUpsertedAccessGrant(
    grantRowsFromUnknown(input.existingRows),
    input.productId,
    grantedAt,
    input.source ?? null,
  )
  const saved = await input.payload.update({
    collection: 'users',
    id: input.userId,
    data: { accessGrants: accessGrantsForWrite(next) },
    overrideAccess: true,
  })
  // A következő SKU írása már a Payload által kiosztott új sor-ID-ket is őrizze.
  if (!Array.isArray(saved.accessGrants))
    throw new Error('A hozzáférési sorok mentése nem igazolható.')
  return grantRowsFromUnknown(saved.accessGrants)
}

export function durationDaysFromProduct(product: {
  accessDurationDays?: number | null
}): number | null {
  const days = product.accessDurationDays
  if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
    return days
  }
  return null
}
