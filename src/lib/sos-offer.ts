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

/**
 * A nevesített SOS-ajánlat nem helyettesíthető másik ingyenes kurzussal.
 *
 * 2026-09-07-től a látogatói feltétellel AZONOS: a drafts `_status` már nem
 * szűr. Ok (mérve élesben): a publikált SOS fölött autosave-piszkozat áll
 * (`versions.drafts.autosave`), ezért a kezdőlap rácsa, hero-ja és SOS-sávja
 * eltűnt, miközben a /kurzusok lista és a menü mutatta a kurzust. Ugyanaz a
 * termék ugyanúgy jelenjen meg mindenhol (WCAG 2.2 SC 3.2.4 Consistent
 * Identification, https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html;
 * NN/g Consistency and Standards, https://www.nngroup.com/articles/consistency-and-standards/).
 * A `getPublishedProducts` `draft: false`-szal eleve a publikált változatot adja.
 */
export function isAvailableSosProduct(product: Product | null | undefined): product is Product {
  return isStorefrontFreeSos(product)
}
