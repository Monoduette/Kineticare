import Link from 'next/link'

import { courseHref } from '../../lib/course-url'
import { courseCover, coursePriceHuf, courseTitle } from '../../lib/courses'
import { rewriteVisitorDashLeftover } from '../../lib/gondolatjel-leftover'
import type { Product } from '../../payload-types'
import { Card } from '../ui/Card'
import { PriceTag } from '../ui/PriceTag'

/**
 * CourseCard — kurzuskártya a /kurzusok listán és a kapcsolódó kurzusok
 * (upsell) sávban. Borító (media sm-méret), cím, rövid leírás és az 5A
 * Ár-címke (PriceTag, ezres tagolás); a cím linkje a kurzus KANONIKUS
 * címére visz (courseHref: slug, ennek hiányában a régi id-s út).
 */
export interface CourseCardProps {
  product: Product
  /** A cím heading-szintje (lista: h2; upsell-sáv: h3). */
  headingLevel?: 'h2' | 'h3'
}

export function CourseCard({ product, headingLevel = 'h2' }: CourseCardProps) {
  const title = courseTitle(product)
  const href = courseHref(product)
  const cover = courseCover(product)
  const price = coursePriceHuf(product)
  const Heading = headingLevel

  return (
    <Card as="article" className="kc-course-card" interactive padded={false}>
      <Link
        aria-label={`${title}: a kurzus részletei`}
        className="kc-course-card__media"
        href={href}
        tabIndex={-1}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Payload media méretei kézileg vannak bekötve (width/height a CMS-ből)
          <img
            alt={cover.alt}
            decoding="async"
            height={cover.height ?? undefined}
            loading="lazy"
            src={cover.url}
            width={cover.width ?? undefined}
          />
        ) : (
          <span aria-hidden="true" className="kc-course-card__media-placeholder" />
        )}
      </Link>
      <div className="kc-course-card__body">
        <Heading className="kc-course-card__title">
          <Link href={href}>{title}</Link>
        </Heading>
        {product.shortDescription ? (
          <p className="kc-course-card__excerpt">
            {rewriteVisitorDashLeftover(product.shortDescription)}
          </p>
        ) : null}
        {price !== null ? (
          <p className="kc-course-card__price">
            <PriceTag label="Ár:" priceHuf={price} />
          </p>
        ) : null}
      </div>
    </Card>
  )
}
