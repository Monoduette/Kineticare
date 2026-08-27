import type { Payload } from 'payload'

import type { Product, User } from '../payload-types'
import { purchaseIdsFrom } from './courses'

/**
 * A vevő `purchases` listájának termékei, ID-only és populate-olt alakban is.
 *
 * A Kurzusaim oldal korábban csak az objektum-alakú relációkat tartotta meg.
 * Ha a session `depth: 0` (vagy egy bejegyzés nyers id), a lista üresnek
 * látszott, miközben a paywall a nyers id-t elfogadta. Itt mindig id alapján
 * töltünk, a vásárlás sorrendjét megtartva.
 *
 * `overrideAccess`: a hívó már azonosította a belépett vevőt, és CSAK az ő
 * purchases-id-jeit kérdezzük. Az access-szabályt nem módosítjuk (TILOS ZÓNA 4).
 * Publikálatlan (draft) SKU kiesik: a lejátszó úgysem nyílik meg rá.
 */

export async function loadPurchasedProducts(input: {
  payload: Payload
  purchases: User['purchases']
}): Promise<Product[]> {
  const ids = purchaseIdsFrom(input.purchases)
  if (ids.length === 0) {
    return []
  }

  const { docs } = await input.payload.find({
    collection: 'products',
    where: {
      and: [{ id: { in: ids } }, { status: { in: ['published', 'archived'] } }],
    },
    limit: Math.max(ids.length, 1),
    depth: 1,
    overrideAccess: true,
  })

  const byId = new Map<number, Product>()
  for (const doc of docs) {
    byId.set(doc.id, doc as Product)
  }

  const ordered: Product[] = []
  for (const id of ids) {
    const product = byId.get(id)
    if (product !== undefined) {
      ordered.push(product)
    }
  }
  return ordered
}
