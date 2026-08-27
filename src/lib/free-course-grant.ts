import type { Payload, PayloadRequest } from 'payload'

import type { User } from '../payload-types'
import {
  accessGrantsForWrite,
  durationDaysFromProduct,
  grantDatesFromRows,
  grantRowsFromUnknown,
  withUpsertedAccessGrant,
} from './access-grants'
import { logger as rootLogger, type Logger } from './logger'
import { withUserPurchasesLock } from './user-purchases-lock'

/**
 * Egyetlen, kért ingyenes kurzus hozzáférés-adása — transportfüggetlen
 * szolgáltatás. A nyilvános igénylő (`requestFreeCourseAccess`) hívja a
 * megadott `productId`-vel. Login/regisztráció NEM hívja: a belépés nem
 * oszt ki minden ingyenes SKU-t.
 *
 * „Ingyenes" definíció: KIZÁRÓLAG `priceInHUFEnabled === false` — az egyetlen
 * igazságforrás az `isFreeCourse` (src/lib/courses.ts). A beállítatlan
 * (NULL) ár-pipa nem ingyenes ajánlat.
 *
 * IDEMPOTENS: ha a kért termék már a purchases-ben van, és az óra (ha van)
 * is be van írva, nincs írás. Időkorlátos SKU-nál hiányzó `accessGrants`
 * sor fail-open órát jelentene, ezért azt pótoljuk. Más ingyenes SKU-t a
 * függvény nem ír be.
 *
 * A users.purchases mező field-access szinten RENDSZER-ÍRÁSÚ — az írás itt is
 * `overrideAccess: true`-val, kizárólag szerver-oldalon történik. Az
 * access-szabályt a modul NEM módosítja.
 */

export interface GrantFreeCoursesInput {
  payload: Payload
  /** A felhasználó, akinek a kért kurzust adjuk (purchases-szel). */
  user: Pick<User, 'id' | 'purchases'>
  /** A kért termék adatbázis-azonosítója — kötelező, más SKU-t nem írunk. */
  productId: number
  /**
   * A hívó kérése — hook-hívásnál a beágyazott update csak így fut
   * a hívó tranzakciójában. A nyilvános igénylő nem adja át (saját zár).
   */
  req?: PayloadRequest
  logger?: Logger
}

export interface GrantFreeCoursesResult {
  /** A TÉNYLEGESEN beírt termék-id-k (üres, ha a kért termék megvolt vagy nem adható). */
  grantedProductIds: number[]
  /** 1, ha a kért termék published + ingyenes; különben 0. */
  freeProductCount: number
}

/** A users.purchases bejegyzéseinek id-listája (nyers id vagy populate-olt dokumentum). */
function userPurchaseIds(user: Pick<User, 'purchases'>): number[] {
  const purchases = user.purchases ?? []
  return purchases.map((entry) => (typeof entry === 'object' ? entry.id : entry))
}

/**
 * A kért published + ingyenes termék idempotens beírása a felhasználó
 * purchases-listájába. Nincs mit beírnia → tiszta no-op.
 */
export async function grantFreeCoursesToUser(
  input: GrantFreeCoursesInput,
): Promise<GrantFreeCoursesResult> {
  const { payload, user, productId } = input
  const log = input.logger ?? rootLogger

  const freeProducts = await payload.find({
    collection: 'products',
    where: {
      and: [
        { id: { equals: productId } },
        { status: { equals: 'published' } },
        // SZIGORÚ ingyenes-feltétel — az isFreeCourse (src/lib/courses.ts)
        // SQL-oldali párja. A `not_equals: true` alak a beállítatlan (NULL)
        // ár-pipát is beengedte.
        { priceInHUFEnabled: { equals: false } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])

  const requested = freeProducts.docs[0]
  if (!requested) {
    return { grantedProductIds: [], freeProductCount: 0 }
  }

  const durationDays = durationDaysFromProduct(requested as { accessDurationDays?: number | null })
  const staleOwned = new Set(userPurchaseIds(user).map(String))
  // Korlátlan SKU, már a fiókban: nincs mit írni. Időkorlátosnál a lockban
  // dől el, van-e már accessGrants sor (hiányzó kezdőpont = fail-open).
  if (staleOwned.has(String(requested.id)) && durationDays === null) {
    return { grantedProductIds: [], freeProductCount: 1 }
  }

  return withUserPurchasesLock(
    payload,
    user.id,
    async () => {
      const fresh = (await payload.findByID({
        collection: 'users',
        id: user.id,
        depth: 0,
        overrideAccess: true,
        ...(input.req ? { req: input.req } : {}),
      })) as User

      const owned = new Set(userPurchaseIds(fresh).map(String)).has(String(requested.id))
      const existingGrants = grantRowsFromUnknown(fresh.accessGrants)
      const hasGrant = grantDatesFromRows(existingGrants).has(requested.id)
      if (owned && (durationDays === null || hasGrant)) {
        return { grantedProductIds: [], freeProductCount: 1 }
      }

      const shouldWriteGrant = durationDays !== null && !hasGrant
      const data: {
        purchases?: number[]
        accessGrants?: ReturnType<typeof accessGrantsForWrite>
      } = {}
      if (!owned) {
        data.purchases = [...userPurchaseIds(fresh), requested.id]
      }
      if (shouldWriteGrant) {
        data.accessGrants = accessGrantsForWrite(
          withUpsertedAccessGrant(existingGrants, requested.id, new Date()),
        )
      }

      await payload.update({
        collection: 'users',
        id: user.id,
        data,
        overrideAccess: true,
        ...(input.req ? { req: input.req } : {}),
      })

      log.info('ingyenes kurzus-hozzáférés beírva', {
        userId: user.id,
        grantedProductIds: owned ? [] : [requested.id],
        accessGrantWritten: shouldWriteGrant,
      })

      return {
        grantedProductIds: owned ? [] : [requested.id],
        freeProductCount: 1,
      }
    },
    log,
  )
}
