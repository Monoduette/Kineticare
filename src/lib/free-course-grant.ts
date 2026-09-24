import type { Payload, PayloadRequest } from 'payload'

import type { Product, User } from '../payload-types'
import {
  accessGrantsForWrite,
  grantRowsFromUnknown,
  productIdFromGrant,
  validateAccessGrantRows,
  withUpsertedAccessGrant,
} from './access-grants'
import { isFreeCourse } from './courses'
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
 * IDEMPOTENS: ha a kért termék már a purchases-ben van, és saját independent
 * eredete is be van írva, nincs írás. Az explicit igénylés más eredetek mellé
 * külön sort ad; a korábbi órákat és sorazonosítókat megőrzi. Más ingyenes
 * SKU-t a függvény nem ír be.
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

/**
 * Élő, ingyenesen igényelhető kurzus-e a fő táblában álló sor.
 *
 * - `status === 'published'`: a kurzus megjelenése (a bolt ezt a mezőt nézi,
 *   src/lib/courses.ts).
 * - `_status !== 'draft'`: a kurzusoldal a piszkozat-sort nem mutatja
 *   (src/app/(frontend)/kurzusok/[slug]/page.tsx, 404). A Payload a lomtárba
 *   helyezéskor és a „visszaállítás piszkozatként”-kor validálás nélkül a
 *   legutóbbi autosave-es piszkozatot írja a fő sorba `_status: 'draft'`-tal
 *   (payload/dist/collections/operations/utilities/update.js, skipValidation),
 *   így egy meg nem erősített, piszkozatban kivett „Fizetős kurzus” pipa a
 *   „Fizetős kurzus” őr (src/plugins/ecommerce.ts validatePriceInHUFEnabled)
 *   megkerülésével került a fő sorba, és a kurzus ingyen igényelhető lett
 *   (r2-termekor H4, mérve valódi Postgresen). A közzététel visszavonása és a
 *   duplikálás is piszkozat-sort ír. A NULL `_status` (drafts előtti régi sor)
 *   nem piszkozat: a kurzusoldal is élőnek veszi.
 * - `priceInHUFEnabled === false`: az egyetlen ingyenes-definíció (isFreeCourse).
 */
export function isLiveFreeCourse(
  product: Pick<Product, '_status' | 'status' | 'priceInHUFEnabled'> | null | undefined,
): boolean {
  return (
    product !== null &&
    product !== undefined &&
    product._status !== 'draft' &&
    product.status === 'published' &&
    isFreeCourse(product)
  )
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

  const requested = freeProducts.docs[0] as Product | undefined
  // A piszkozat-sor (`_status: 'draft'`) nem élő kurzus (isLiveFreeCourse).
  // JS-ben szűrünk, nem SQL-ben: a `not_equals` a NULL `_status`-ú régi sort
  // is kizárná.
  if (!requested || !isLiveFreeCourse(requested)) {
    return { grantedProductIds: [], freeProductCount: 0 }
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
      const validation = validateAccessGrantRows(fresh.accessGrants)
      if (validation !== true) throw new Error(validation)
      const existingGrants = grantRowsFromUnknown(fresh.accessGrants)
      const hasGrant = existingGrants.some(
        (row) =>
          productIdFromGrant(row.product) === requested.id && row.sourceKind === 'independent',
      )
      if (owned && hasGrant) {
        return { grantedProductIds: [], freeProductCount: 1 }
      }

      const shouldWriteGrant = !hasGrant
      const data: {
        purchases?: number[]
        accessGrants?: ReturnType<typeof accessGrantsForWrite>
      } = {}
      if (!owned) {
        data.purchases = [...userPurchaseIds(fresh), requested.id]
      }
      if (shouldWriteGrant) {
        data.accessGrants = accessGrantsForWrite(
          withUpsertedAccessGrant(existingGrants, requested.id, new Date(), {
            sourceKind: 'independent',
          }),
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
