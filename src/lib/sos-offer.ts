import type { Product } from '../payload-types'
import { isFreeCourse } from './courses'

/**
 * Látogatói SOS: a kurzuslista és a kurzusoldal a saját `status` mezőt nézi,
 * nem a drafts `_status`-t (`src/app/(frontend)/kurzusok/page.tsx`).
 * A menüfeliratnak ezzel kell egyeznie, különben ugyanaz a kurzus a kártyán
 * „Ingyenes”, a navban pedig nem (WCAG 2.2 SC 3.2.4).
 */
export function isStorefrontFreeSos(product: Product | null | undefined): product is Product {
  return (
    product != null &&
    product.slug === 'sos-kezrelax-villamkurzus' &&
    product.status === 'published' &&
    isFreeCourse(product)
  )
}

/** A nevesített SOS-ajánlat nem helyettesíthető másik ingyenes kurzussal. */
export function isAvailableSosProduct(product: Product | null | undefined): product is Product {
  return isStorefrontFreeSos(product) && product._status === 'published'
}
