import type { Payload } from 'payload'

import { parentCourseIdsOf } from './course-family'
import { resolveCourseAccessForUser } from './course-access-lookup'
import { courseTitle, hasUserPurchased, type IncludingProgram } from './courses'
import type { Logger } from './logger'

/**
 * A vevő melyik, általa birtokolt és élő hozzáférésű teljes programjában van
 * benne ez a témakurzus (megjelenítéshez: kurzusoldal, kosár, pénztár).
 *
 * Csak a felület dönt rajta (vásárlógomb helyett a program linkje); a
 * pénztár a saját, zár alatti kapujával (checkout/parent-course-block.ts)
 * akkor is elutasít, ha ez a lekérdezés elszáll. Ezért itt hibánál a mai
 * viselkedés marad: `null`, és a vásárlógomb látszik.
 *
 * A programból csak a cím és a hozzáférés hossza töltődik be: a program
 * tananyaga (lecke-szöveg, videó-azonosító) nem kerül a témakurzus oldalára.
 */
export async function findOwnedIncludingProgram(input: {
  payload: Payload
  user: { id: number; purchases?: unknown } | null
  product: { id: number; parentCourses?: unknown }
  logger: Logger
  now?: Date
}): Promise<IncludingProgram | null> {
  if (input.user === null) return null
  const purchases = input.user.purchases as Parameters<typeof hasUserPurchased>[0]
  const ownedParentIds = parentCourseIdsOf(input.product).filter((id) =>
    hasUserPurchased(purchases, id),
  )
  if (ownedParentIds.length === 0) return null

  try {
    const parents = await input.payload.find({
      collection: 'products',
      where: { id: { in: ownedParentIds } },
      depth: 0,
      limit: ownedParentIds.length,
      pagination: false,
      select: { sku: true, displayTitle: true, accessDurationDays: true },
      overrideAccess: true,
    })
    if (parents.docs.length === 0) return null
    const states = await resolveCourseAccessForUser({
      payload: input.payload,
      userId: input.user.id,
      products: parents.docs.map((doc) => ({
        id: doc.id,
        accessDurationDays: doc.accessDurationDays ?? null,
      })),
      ...(input.now !== undefined ? { now: input.now } : {}),
      logger: input.logger,
    })
    for (const id of ownedParentIds) {
      const parent = parents.docs.find((doc) => doc.id === id)
      if (parent !== undefined && states.get(id)?.hasAccess === true) {
        return { id: parent.id, title: courseTitle(parent) }
      }
    }
    return null
  } catch (error) {
    input.logger.warn('témakurzus: a birtokolt teljes program lekérdezése sikertelen', {
      userId: input.user.id,
      productId: input.product.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
