/**
 * Import terv-készítés — olvasás-only. Soronként: create-user | append-purchases |
 * skip-complete. Kurzusnév→SKU csak `--map` párokból; ismeretlen név → figyelmeztetés.
 * Determinisztikus sorrend (e-mail, kurzusnév).
 */

import type { Payload } from 'payload'

import { normalizeKey, type CustomerRow, type RowIssue } from './parse'

export type PlanAction = 'create-user' | 'append-purchases' | 'skip-complete'

/** Egy konkrét, a vevőhöz hozzáadandó termék. */
export interface PlannedProduct {
  readonly id: number
  readonly sku: string
  /** A CSV-beli kurzusnév, amiből a leképezés ide vezetett (naplóhoz, mérleghez). */
  readonly courseName: string
}

/** A terv egy sora — pontosan egy vásárló. */
export interface PlanEntry {
  readonly action: PlanAction
  readonly email: string
  readonly name: string
  /** A meglévő felhasználó id-je; `create-user` esetén nincs. */
  readonly userId?: number
  /** Csak a HIÁNYZÓ termékek — amivel a vevő már rendelkezik, ide nem kerül be. */
  readonly missingProducts: readonly PlannedProduct[]
  /** A sor kurzusnevei, amikhez nincs `--map` pár. */
  readonly unknownCourseNames: readonly string[]
  /** A CSV-sorok, amikből ez a bejegyzés összeállt (hibaüzenetekhez). */
  readonly lines: readonly number[]
  /**
   * A régi rendszerbeli vevővé válás időpontja (ISO-8601), ha a fájl adta.
   * A végrehajtás ezt őrzi meg audit-bejegyzésben — lásd `execute.ts`.
   */
  readonly registeredAt?: string
}

export interface PlanSummary {
  readonly create: number
  readonly append: number
  readonly skip: number
}

export interface ImportPlan {
  readonly entries: readonly PlanEntry[]
  /** Az összes nem leképezett kurzusnév (rendezve, duplikátum nélkül). */
  readonly unknownCourseNames: readonly string[]
  /** A `--map`-ben megadott, de az adatbázisban NEM létező SKU-k. */
  readonly unknownSkus: readonly string[]
  readonly summary: PlanSummary
  /**
   * Igaz, ha a users kollekció ÜRES. Ilyenkor az első létrehozott felhasználó a
   * `promoteFirstUserToOwner` hook miatt OWNER szerepkört kapna — vásárlói
   * importot tehát tilos üres kollekcióra futtatni.
   */
  readonly emptyUserCollection: boolean
}

/** Egy `--map` pár: az eredeti kurzusnév és a hozzá tartozó SKU. */
export interface CourseMapping {
  readonly courseName: string
  readonly sku: string
}

export interface CourseMapResult {
  /** normalizált kurzusnév → SKU */
  readonly bySku: ReadonlyMap<string, string>
  readonly pairs: readonly CourseMapping[]
  readonly errors: readonly string[]
}

/**
 * A `--map "Kurzusnév=SKU"` értékek feldolgozása.
 *
 * Az első `=` választ: a kurzusnévben lehet `=`, a SKU-ban nem szokott.
 */
export function parseCourseMap(values: readonly string[]): CourseMapResult {
  const bySku = new Map<string, string>()
  const pairs: CourseMapping[] = []
  const errors: string[] = []

  for (const raw of values) {
    const separator = raw.indexOf('=')
    if (separator === -1) {
      errors.push(`Hibás --map érték: "${raw}". A helyes forma: --map "Kurzusnév=SKU".`)
      continue
    }
    const courseName = raw.slice(0, separator).trim()
    const sku = raw.slice(separator + 1).trim()
    if (courseName === '' || sku === '') {
      errors.push(`Hibás --map érték: "${raw}". A kurzusnév és a SKU sem lehet üres.`)
      continue
    }
    const key = normalizeKey(courseName)
    const existing = bySku.get(key)
    if (existing !== undefined && existing !== sku) {
      errors.push(
        `Ellentmondó --map: a(z) "${courseName}" kurzusnévhez már "${existing}" tartozik, ` +
          `de "${sku}" is meg lett adva.`,
      )
      continue
    }
    if (existing === undefined) {
      bySku.set(key, sku)
      pairs.push({ courseName, sku })
    }
  }

  return { bySku, pairs, errors }
}

/** Nagy listák darabolása — a `where … in` lekérdezések ne nőjenek korlátlanul. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const QUERY_CHUNK_SIZE = 100

/** A users.purchases bejegyzéseinek id-listája (depth: 0 mellett nyers id-k). */
export function purchaseIdsOf(purchases: unknown): number[] {
  if (!Array.isArray(purchases)) {
    return []
  }
  const ids: number[] = []
  for (const entry of purchases) {
    if (typeof entry === 'number') {
      ids.push(entry)
      continue
    }
    if (typeof entry === 'object' && entry !== null) {
      const id = (entry as { id?: unknown }).id
      if (typeof id === 'number') {
        ids.push(id)
      }
    }
  }
  return ids
}

interface ExistingUser {
  readonly id: number
  readonly purchaseIds: readonly number[]
}

/** E-mail → meglévő felhasználó (chunkolt lekérdezésekkel). */
async function findExistingUsers(
  payload: Payload,
  emails: readonly string[],
): Promise<Map<string, ExistingUser>> {
  const found = new Map<string, ExistingUser>()
  for (const emailChunk of chunk(emails, QUERY_CHUNK_SIZE)) {
    const result = await payload.find({
      collection: 'users',
      where: { email: { in: [...emailChunk] } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    for (const doc of result.docs) {
      found.set(doc.email.toLowerCase(), { id: doc.id, purchaseIds: purchaseIdsOf(doc.purchases) })
    }
  }
  return found
}

/** SKU → termék-id (chunkolt lekérdezésekkel). A nem létező SKU kimarad. */
async function findProductsBySku(
  payload: Payload,
  skus: readonly string[],
): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  for (const skuChunk of chunk(skus, QUERY_CHUNK_SIZE)) {
    const result = await payload.find({
      collection: 'products',
      where: { sku: { in: [...skuChunk] } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    for (const doc of result.docs) {
      if (typeof doc.sku === 'string' && doc.sku !== '') {
        found.set(doc.sku, doc.id)
      }
    }
  }
  return found
}

export interface BuildPlanInput {
  readonly rows: readonly CustomerRow[]
  /** A `--map` párok feldolgozott alakja. */
  readonly courseMap: CourseMapResult
}

/**
 * A terv felépítése. CSAK OLVAS — sem a `--dry-run`, sem az éles ág nem ír
 * ebben a lépésben.
 */
export async function buildImportPlan(
  payload: Payload,
  input: BuildPlanInput,
): Promise<ImportPlan> {
  const emails = input.rows.map((row) => row.email)
  const requestedSkus = [...new Set(input.courseMap.pairs.map((pair) => pair.sku))]

  const [existingUsers, productIdsBySku, userCount] = await Promise.all([
    emails.length > 0 ? findExistingUsers(payload, emails) : new Map<string, ExistingUser>(),
    requestedSkus.length > 0
      ? findProductsBySku(payload, requestedSkus)
      : new Map<string, number>(),
    payload.count({ collection: 'users', overrideAccess: true }),
  ])

  const unknownSkus = requestedSkus.filter((sku) => !productIdsBySku.has(sku)).sort()

  const entries: PlanEntry[] = []
  const unknownCourseNames = new Map<string, string>()
  let create = 0
  let append = 0
  let skip = 0

  for (const row of input.rows) {
    const products: PlannedProduct[] = []
    const seenProductIds = new Set<number>()
    const rowUnknown: string[] = []

    for (const courseName of row.courseNames) {
      const sku = input.courseMap.bySku.get(normalizeKey(courseName))
      const productId = sku === undefined ? undefined : productIdsBySku.get(sku)
      if (sku === undefined || productId === undefined) {
        // Nem leképezett (vagy nem létező SKU-ra képezett) kurzusnév — SOHA nem
        // tűnik el csendben, mindkét szinten összegyűjtjük.
        rowUnknown.push(courseName)
        unknownCourseNames.set(normalizeKey(courseName), courseName)
        continue
      }
      if (!seenProductIds.has(productId)) {
        seenProductIds.add(productId)
        products.push({ id: productId, sku, courseName })
      }
    }

    const existing = existingUsers.get(row.email)
    if (existing === undefined) {
      create += 1
      entries.push({
        action: 'create-user',
        email: row.email,
        name: row.name,
        missingProducts: products,
        unknownCourseNames: rowUnknown,
        lines: row.lines,
        ...(row.registeredAt !== undefined ? { registeredAt: row.registeredAt } : {}),
      })
      continue
    }

    const owned = new Set(existing.purchaseIds.map(String))
    const missing = products.filter((product) => !owned.has(String(product.id)))
    if (missing.length === 0) {
      skip += 1
      entries.push({
        action: 'skip-complete',
        email: row.email,
        name: row.name,
        userId: existing.id,
        missingProducts: [],
        unknownCourseNames: rowUnknown,
        lines: row.lines,
        ...(row.registeredAt !== undefined ? { registeredAt: row.registeredAt } : {}),
      })
      continue
    }

    append += 1
    entries.push({
      action: 'append-purchases',
      email: row.email,
      name: row.name,
      userId: existing.id,
      missingProducts: missing,
      unknownCourseNames: rowUnknown,
      lines: row.lines,
      ...(row.registeredAt !== undefined ? { registeredAt: row.registeredAt } : {}),
    })
  }

  entries.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))

  return {
    entries,
    unknownCourseNames: [...unknownCourseNames.values()].sort((a, b) =>
      normalizeKey(a) < normalizeKey(b) ? -1 : 1,
    ),
    unknownSkus,
    summary: { create, append, skip },
    emptyUserCollection: userCount.totalDocs === 0,
  }
}

/** A terv sor-szintű figyelmeztetései (nem leképezett kurzusnév) hibalistához. */
export function planIssues(plan: ImportPlan): RowIssue[] {
  const issues: RowIssue[] = []
  for (const entry of plan.entries) {
    if (entry.unknownCourseNames.length === 0) {
      continue
    }
    issues.push({
      line: entry.lines[0] ?? 0,
      email: entry.email,
      reason: `Nem leképezett kurzusnév: ${entry.unknownCourseNames.join(', ')} (hiányzó --map pár).`,
    })
  }
  return issues
}
