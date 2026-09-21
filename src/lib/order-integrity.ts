import type { CollectionBeforeChangeHook } from 'payload'

import { coursePriceHuf } from './courses'
import { generateOrderNumber } from './order-number'

/**
 * Rendelés-integritási hook (T-017) — az orders beforeChange-hookja.
 *
 * Kizárólag create-kor fut; update-kor SEMMI sem számolódik újra:
 * a rendelésszám és a snapshotok a megrendeléskori igazságot rögzítik.
 *
 * - orderNumber: szerver-oldali, KH-<év>-<6 jegyű> formátum (generateOrderNumber).
 * - Item-szintű snapshotok: titleSnapshot + priceHufSnapshot mindig a products
 *   TÁRGYBELI (adatbázisbeli) adatából töltődik — a kliens által küldött ár/név
 *   sosem forrás (a mezők create/update access-e amúgy is zárt, a hook felülír).
 *   Megjegyzés: a products collectionben nincs külön title mező (useAsTitle: sku),
 *   ezért a titleSnapshot a sku pillanatértékét rögzíti.
 * - totalHufSnapshot: az item-snapshotok (ár × mennyiség) összege.
 * - amount (a plugin pénzügyi mezője): a totalHufSnapshot tükrözése — a HUF
 *   deviza decimals: 0, így az összeg egységértéke megegyezik. A snapshot marad
 *   a megrendeléskori igazság forrása; az amountot a plugin-belsők (pl. későbbi
 *   tranzakció-folyamat) konzisztenciája miatt töltjük ugyanazzal az értékkel.
 */
export const orderIntegrityBeforeChange: CollectionBeforeChangeHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create' || !data) {
    return data
  }

  const { payload } = req

  data.orderNumber = await generateOrderNumber(payload)

  const items = Array.isArray(data.items) ? data.items : []
  let totalHuf = 0

  for (const item of items) {
    const productRef = item?.product
    const productId =
      typeof productRef === 'object' && productRef !== null ? productRef.id : productRef
    if (productId === null || productId === undefined) {
      continue
    }

    const product = await payload.findByID({
      collection: 'products',
      id: productId,
      depth: 0,
      overrideAccess: true,
    })

    const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
    // WP63: a MOST fizetendő ár (élő akcióban az akciós ár), ugyanabból a
    // forrásból, mint az oldal és a pénztár (coursePriceHuf); hiányzó ár 0.
    const priceHuf = coursePriceHuf(product) ?? 0

    // A kliens által küldött értékek felülírása — a snapshot forrása mindig a DB.
    item.titleSnapshot = product.sku ?? null
    item.priceHufSnapshot = priceHuf

    totalHuf += priceHuf * quantity
  }

  data.totalHufSnapshot = totalHuf
  // A plugin amount mezőjének tükrözése (lásd a fejlécdokumentációt).
  data.amount = totalHuf

  return data
}
