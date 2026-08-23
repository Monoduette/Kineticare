import type { Payload } from 'payload'

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
  product?: number | { id: number } | null
  grantedAt?: string | Date | null
}

export function productIdFromGrant(product: AccessGrantRow['product']): number | null {
  if (typeof product === 'number' && Number.isFinite(product)) {
    return product
  }
  if (typeof product === 'object' && product !== null && typeof product.id === 'number') {
    return product.id
  }
  return null
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
 * Upsert: a termékhez tartozó sor `grantedAt` értéke `now`.
 * Meglévő más termékek sorai érintetlenek.
 */
export function withUpsertedAccessGrant(
  existing: AccessGrantRow[],
  productId: number,
  grantedAt: Date,
): AccessGrantRow[] {
  const iso = grantedAt.toISOString()
  let found = false
  const next = existing.map((row) => {
    if (productIdFromGrant(row.product) !== productId) {
      return row
    }
    found = true
    return { ...row, product: productId, grantedAt: iso }
  })
  if (!found) {
    next.push({ product: productId, grantedAt: iso })
  }
  return next
}

export async function upsertAccessGrant(input: {
  payload: Payload
  userId: number
  productId: number
  grantedAt?: Date
  existingRows?: unknown
}): Promise<AccessGrantRow[]> {
  const grantedAt = input.grantedAt ?? new Date()
  const next = withUpsertedAccessGrant(
    grantRowsFromUnknown(input.existingRows),
    input.productId,
    grantedAt,
  )
  await input.payload.update({
    collection: 'users',
    id: input.userId,
    data: { accessGrants: next },
    overrideAccess: true,
  })
  return next
}

export function durationDaysFromProduct(product: { accessDurationDays?: number | null }): number | null {
  const days = product.accessDurationDays
  if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
    return days
  }
  return null
}
