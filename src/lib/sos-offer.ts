import type { Product } from '../payload-types'
import { isFreeCourse } from './courses'

/** A nevesített SOS-ajánlat nem helyettesíthető másik ingyenes kurzussal. */
export function isAvailableSosProduct(product: Product | null | undefined): product is Product {
  return (
    product?.slug === 'sos-kezrelax-villamkurzus' &&
    product.status === 'published' &&
    isFreeCourse(product)
  )
}
