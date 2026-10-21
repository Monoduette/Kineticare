import type { Payload } from 'payload'

import type { User } from '../payload-types'
import {
  accessGrantsForWrite,
  grantRowsFromUnknown,
  validateAccessGrantRows,
  withUpsertedAccessGrant,
} from './access-grants'
import { auditLogStore, writeAuditLog } from './audit'
import { resolveSingleCourseAccess } from './course-access-lookup'
import { maskEmail } from './email/mask'
import { logger, type Logger } from './logger'
import { withUserPurchasesLock } from './user-purchases-lock'

/**
 * Manuális kurzus-hozzáférés (grant) — transportfüggetlen szolgáltatás.
 * Ugyanaz a purchases-RMW, mint fizetésnél (`withUserPurchasesLock`, field-access
 * zárt). Idempotens. Az üres `accessDurationDays` lejárat nélküli ajándék,
 * ugyanúgy, mint fizetésnél; csak az érvénytelen érték (0, negatív, tört) hiba.
 */

export type GrantPurchaseStatus =
  'granted' | 'already-had' | 'user-not-found' | 'product-not-found' | 'duration-invalid'

/** A kurzus hozzáférési hossza érvénytelen (régi 0/negatív/tört sor) — CMS-zsargon nélkül. */
export const GRANT_DURATION_INVALID_MESSAGE =
  'Ennél a kurzusnál hibás a hozzáférés hossza. Csak pozitív egész nap lehet, vagy hagyd üresen, ha a hozzáférés nem jár le. Javítsd a kurzusnál, aztán ajándékozd újra.'

/**
 * A termék hozzáférési hossza ajándékozáshoz. Üres = lejárat nélküli (a
 * collection-validátor és a `resolveCourseAccess` szerint is); pozitív egész =
 * napok; minden más érvénytelen, arra nem írunk új ajándék-órát.
 */
export function grantDurationFromProduct(product: {
  accessDurationDays?: number | null
}): 'unlimited' | 'invalid' | number {
  const days = product.accessDurationDays
  if (days === null || days === undefined) return 'unlimited'
  return Number.isSafeInteger(days) && days > 0 ? days : 'invalid'
}

/** A termék-hivatkozás feloldásának módja — a hívó hibaüzenetéhez. */
export type ProductRefKind = 'id' | 'sku'

/** A műveletet végző admin (audit actor). CLI-ből nincs bejelentkezett user. */
export interface GrantPurchaseActor {
  id: number | string
  email?: string | null
}

export interface GrantPurchaseOptions {
  payload: Payload
  /** A vevő regisztrált e-mail-címe (users kollekció). */
  email: string
  /** A termék sku-ja VAGY numerikus adatbázis-id-je (products kollekció). */
  productIdOrSku: string
  /** Indoklás — a strukturált audit-naplóba kerül. */
  reason?: string
  grantedBy?: GrantPurchaseActor | null
  logger?: Logger
}

export interface GrantPurchaseResult {
  status: GrantPurchaseStatus
  email: string
  /** A kérésben kapott, nyers termék-hivatkozás. */
  productRef: string
  productRefKind: ProductRefKind
  userId?: number
  productId?: number
  /** A termék megjelenő neve (sku), ha feloldható volt. */
  productLabel?: string
}

/** A users.purchases bejegyzéseinek id-listája (depth: 0 mellett nyers id-k). */
function userPurchaseIds(user: User): number[] {
  const purchases = user.purchases ?? []
  return purchases.map((entry) => (typeof entry === 'object' ? entry.id : entry))
}

/** Numerikus adatbázis-id vagy sku? (A products kollekcióban nincs slug — az üzleti kulcs a sku.) */
export function resolveProductRefKind(productIdOrSku: string): ProductRefKind {
  return /^\d+$/.test(productIdOrSku) ? 'id' : 'sku'
}

export async function grantPurchase(options: GrantPurchaseOptions): Promise<GrantPurchaseResult> {
  const { payload, email, productIdOrSku } = options
  const log = options.logger ?? logger
  const productRefKind = resolveProductRefKind(productIdOrSku)

  // Audit: maszkolt `cimzett` (a logger `email` kulcsot redaktál).
  const audit = {
    cimzett: maskEmail(email),
    productRef: productIdOrSku,
    productRefKind,
    grantedBy: options.grantedBy
      ? {
          id: options.grantedBy.id,
          cimzett: options.grantedBy.email ? maskEmail(options.grantedBy.email) : null,
        }
      : null,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  }

  // --- Felhasználó feloldása email alapján (NEM hozunk létre újat) -----------
  // W9: a Payload az e-mailt kisbetűsen tárolja. A CLI/admin `Vevo@Pelda.hu`
  // alakja trim + toLowerCase nélkül hamis „nincs ilyen user" lenne.
  const normalizedEmail = email.trim().toLowerCase()
  const users = await payload.find({
    collection: 'users',
    where: { email: { equals: normalizedEmail } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (users.docs.length === 0) {
    log.warn('manuális hozzáférés: ismeretlen felhasználó', { ...audit, result: 'user-not-found' })
    return { status: 'user-not-found', email, productRef: productIdOrSku, productRefKind }
  }
  const user = users.docs[0]

  // --- Termék feloldása sku VAGY numerikus id alapján ------------------------
  const products = await payload.find({
    collection: 'products',
    where:
      productRefKind === 'id'
        ? { id: { equals: Number(productIdOrSku) } }
        : { sku: { equals: productIdOrSku } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (products.docs.length === 0) {
    log.warn('manuális hozzáférés: ismeretlen termék', {
      ...audit,
      userId: user.id,
      result: 'product-not-found',
    })
    return {
      status: 'product-not-found',
      email,
      productRef: productIdOrSku,
      productRefKind,
      userId: user.id,
    }
  }
  const product = products.docs[0]
  const productLabel = product.sku ?? String(product.id)

  // --- Purchases RMW user-zár alatt: újraolvasás, majd merge/írás (K1) ------
  const outcome = await withUserPurchasesLock(
    payload,
    user.id,
    async () => {
      const fresh = (await payload.findByID({
        collection: 'users',
        id: user.id,
        depth: 0,
        overrideAccess: true,
      })) as User

      const owned = new Set(userPurchaseIds(fresh).map(String))
      const alreadyOwned = owned.has(String(product.id))
      const duration = grantDurationFromProduct(product)
      const now = new Date()
      const existingGrants = grantRowsFromUnknown(
        (fresh as User & { accessGrants?: unknown }).accessGrants,
      )

      if (alreadyOwned) {
        const access = await resolveSingleCourseAccess({
          payload,
          userId: user.id,
          product,
          logger: log,
        })
        // Élő (active) vagy korlátlan: ne írjuk újra. Lejárt, visszavont és
        // ismeretlen kezdőpont: ajándék-óra indítása accessGrants.grantedAt = most.
        if (access.reason === 'active' || access.reason === 'unlimited') {
          log.info('manuális hozzáférés: a termék már a vevőnél van — no-op', {
            ...audit,
            userId: user.id,
            productId: product.id,
            sku: product.sku,
            result: 'already-had',
          })
          return {
            status: 'already-had' as const,
            email,
            productRef: productIdOrSku,
            productRefKind,
            userId: user.id,
            productId: product.id,
            productLabel,
          }
        }
      }

      if (duration === 'invalid') {
        log.warn('manuális hozzáférés: a kurzus hozzáférési hossza érvénytelen', {
          ...audit,
          userId: user.id,
          productId: product.id,
          sku: product.sku,
          accessDurationDays: product.accessDurationDays,
          result: 'duration-invalid',
        })
        return {
          status: 'duration-invalid' as const,
          email,
          productRef: productIdOrSku,
          productRefKind,
          userId: user.id,
          productId: product.id,
          productLabel,
        }
      }

      const validation = validateAccessGrantRows(fresh.accessGrants)
      if (validation !== true) throw new Error(validation)
      const nextPurchases = alreadyOwned
        ? userPurchaseIds(fresh)
        : [...userPurchaseIds(fresh), product.id]
      // A fizetéses ághoz hasonlóan az eredet-sor korlátlan kurzusnál is
      // íródik: ha a tulajdonos később napokat állít be, az óra az ajándék
      // napjától indul, nem ismeretlen kezdőponttól.
      const nextGrants = withUpsertedAccessGrant(existingGrants, product.id, now, {
        sourceKind: 'independent',
      })

      await payload.update({
        collection: 'users',
        id: user.id,
        data: {
          purchases: nextPurchases,
          accessGrants: accessGrantsForWrite(nextGrants),
        },
        overrideAccess: true,
      })

      log.info('manuális hozzáférés rögzítve', {
        ...audit,
        userId: user.id,
        productId: product.id,
        sku: product.sku,
        result: 'granted',
        renewed: alreadyOwned,
      })

      return {
        status: 'granted' as const,
        email,
        productRef: productIdOrSku,
        productRefKind,
        userId: user.id,
        productId: product.id,
        productLabel,
      }
    },
    log,
  )

  // Az audit a zár ELENGEDÉSE után fut — a zár-tartomány csak a purchases RMW.
  if (outcome.status === 'granted') {
    await writeAuditLog({
      store: auditLogStore(payload),
      actor: options.grantedBy?.id ?? null,
      action: 'grant-purchase',
      entityType: 'users',
      entityId: user.id,
      after: { productId: product.id, sku: product.sku, reason: options.reason ?? null },
    })
  }

  return outcome
}
