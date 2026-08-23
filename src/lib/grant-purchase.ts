import type { Payload } from 'payload'

import type { User } from '../payload-types'
import { auditLogStore, writeAuditLog } from './audit'
import { resolveSingleCourseAccess } from './course-access-lookup'
import { maskEmail } from './email/mask'
import { logger, type Logger } from './logger'
import { withUserPurchasesLock } from './user-purchases-lock'

/**
 * Manuális kurzus-hozzáférés adása (grant) — transportfüggetlen szolgáltatás.
 *
 * Ugyanaz a users.purchases-beírás, amit a fizetésjóváhagyás végez (lásd
 * src/lib/order-status/apply-barion-state.ts grantPurchases): a Payload LOCAL
 * API-n, `overrideAccess: true`-val, `withUserPurchasesLock` alatt. A
 * fizetés/refund/grant írók ezt a zárat használják; a mezőt staff/owner a
 * Payload REST/admin felületén is írhatja (lásd Users.purchases access).
 * Az a REST-út NINCS zár alatt — ezért a grant-panel / ez a szolgáltatás az
 * éles író, nem a nyers PATCH. Az access-szabályt ez a modul NEM módosítja.
 *
 * Hívói:
 *  - src/scripts/grant-purchase.ts (CLI, vékony wrapper — a viselkedése
 *    változatlan),
 *  - src/lib/grant-purchase-route.ts (POST /api/admin/grant-purchase, staff
 *    vagy owner jogosultsággal).
 *
 * IDEMPOTENS: ha a vevőnél már megvan a termék ÉS a hozzáférés él (vagy
 * korlátlan), a hívás `already-had` eredménnyel tér vissza és NEM ír. Ha a
 * termék a purchases-ben van, de a hozzáférés lejárt (`accessDurationDays` +
 * utolsó paid rendelés), `access-expired` jön vissza: sem purchases-írás, sem
 * ajándék paid rendelés (az nem hosszabbítana, számlát/Bariont viszont
 * kockáztatna). Csak a hiányzó terméket fűzi a listához.
 *
 * A modul soha nem dob üzleti hibát: az ismeretlen felhasználó/termék is
 * strukturált eredmény (a hívó képezi HTTP-státuszra, illetve CLI-üzenetre).
 * Technikai hiba (DB) természetesen kibillen.
 */

export type GrantPurchaseStatus =
  'granted' | 'already-had' | 'access-expired' | 'user-not-found' | 'product-not-found'

/** A lejárt hozzáférés őszinte üzenete — route, CLI és admin panel. */
export const ACCESS_EXPIRED_GRANT_MESSAGE =
  'A hozzáférés lejárt. Új paid rendelés kell a megújításhoz. A manuális grant önmagában nem hosszabbít.'

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

  // Audit-alap: KI (grantedBy id + maszkolt cím), KINEK (maszkolt cím), MIT
  // (productRef), MIÉRT (reason) — az eredmény minden ágon rákerül.
  //
  // A címek MASZKOLVA (`maskEmail`) és `cimzett` néven kerülnek a naplóba: a
  // teljes e-mail-cím személyes adat, a logger `email` kulcsú mezőt eleve
  // redaktál (src/lib/logger.ts). A maszkolt alak a sor beazonosításához elég,
  // a rendszer belső azonosítója (userId) pedig a naplóban külön is szerepel.
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
      if (owned.has(String(product.id))) {
        const durationDays = product.accessDurationDays
        const hasFiniteDuration =
          typeof durationDays === 'number' && Number.isFinite(durationDays) && durationDays > 0

        if (hasFiniteDuration) {
          const access = await resolveSingleCourseAccess({
            payload,
            userId: user.id,
            product,
            logger: log,
          })
          if (access.reason === 'expired') {
            log.info('manuális hozzáférés: a hozzáférés lejárt — nem hosszabbít', {
              ...audit,
              userId: user.id,
              productId: product.id,
              sku: product.sku,
              result: 'access-expired',
            })
            return {
              status: 'access-expired' as const,
              email,
              productRef: productIdOrSku,
              productRefKind,
              userId: user.id,
              productId: product.id,
              productLabel,
            }
          }
        }

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

      await payload.update({
        collection: 'users',
        id: user.id,
        data: { purchases: [...userPurchaseIds(fresh), product.id] },
        overrideAccess: true,
      })

      log.info('manuális hozzáférés rögzítve', {
        ...audit,
        userId: user.id,
        productId: product.id,
        sku: product.sku,
        result: 'granted',
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
