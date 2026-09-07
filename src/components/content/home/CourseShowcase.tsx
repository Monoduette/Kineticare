import Link from 'next/link'

import { AUDIENCE_LABELS, normalizeAudience } from '../../../lib/course-audience'
import {
  COURSE_SHOWCASE_DRIFT,
  COURSE_SHOWCASE_HEADING,
  COURSE_SHOWCASE_LEAD,
  COURSE_SHOWCASE_MARK,
  showcaseFallbackAt,
  splitEditorialTitle,
} from '../../../lib/course-showcase'
import { courseHref } from '../../../lib/course-url'
import { coursePriceBadgeKind, courseTitle } from '../../../lib/courses'
import { rewriteVisitorDashLeftover } from '../../../lib/gondolatjel-leftover'
import type { Product } from '../../../payload-types'
import { PriceTag } from '../../ui/PriceTag'
import { MediaImage } from '../MediaImage'

import '../../../app/(frontend)/styles/blocks/course-showcase.css'

export interface CourseShowcaseProps {
  products: Product[]
  heading?: string
  lead?: string
  /** A vízjel. Üresen a beépített „Kurzusaink”. `null`: nincs vízjel. */
  mark?: string | null
  /** Lassú, dekoratív csapatképek a vízjel körül. */
  drift?: boolean
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-course-showcase__arrow"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  )
}

function ShowcaseCard({ product, index }: { product: Product; index: number }) {
  const title = courseTitle(product)
  const href = courseHref(product)
  const { head, tail } = splitEditorialTitle(title)
  const audienceLabel = AUDIENCE_LABELS[normalizeAudience(product.audience)]
  const priceBadge = coursePriceBadgeKind(product)
  const coverMedia =
    product.coverImage && typeof product.coverImage === 'object' ? product.coverImage : null
  const fallback = showcaseFallbackAt(index)

  return (
    <article className="kc-course-showcase__card">
      <Link
        aria-label={`${title}: a kurzus részletei`}
        className="kc-course-showcase__link"
        href={href}
      >
        <span className="kc-course-showcase__media">
          {coverMedia ? (
            <MediaImage
              decorative
              media={coverMedia}
              preferredSize="md"
              sizes="(max-width: 900px) 100vw, 33vw"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- statikus csapatkép, Payload méret nélkül
            <img
              alt=""
              decoding="async"
              height={fallback.height}
              loading="lazy"
              src={fallback.src}
              width={fallback.width}
            />
          )}
          <span aria-hidden="true" className="kc-course-showcase__go">
            <ArrowIcon />
          </span>
        </span>
        <span className="kc-course-showcase__caption">
          <span className="kc-course-showcase__title">
            {head}
            {tail ? <em> {tail}</em> : null}
          </span>
          <span className="kc-course-showcase__kicker">{audienceLabel}</span>
          {priceBadge === 'price' ? (
            <span className="kc-course-showcase__price">
              <PriceTag label="Ár:" priceHuf={product.priceInHUF as number} />
            </span>
          ) : null}
          {priceBadge === 'free' ? (
            <span className="kc-course-showcase__price">Ingyenes</span>
          ) : null}
        </span>
      </Link>
    </article>
  )
}

/**
 * Astra-szerű kurzusgaléria: háromhasábos képkártyák, ár a kártyán,
 * alul Kineticare-kék vízjel. A két audience-ág kicker, nem külön szekció.
 */
export function CourseShowcase({
  products,
  heading,
  lead,
  mark = COURSE_SHOWCASE_MARK,
  drift = true,
}: CourseShowcaseProps) {
  if (products.length === 0) {
    return null
  }

  const title = heading?.trim() || COURSE_SHOWCASE_HEADING
  const leadText = rewriteVisitorDashLeftover(lead?.trim() || COURSE_SHOWCASE_LEAD)
  const markText = mark === null ? '' : mark.trim() || COURSE_SHOWCASE_MARK

  return (
    <div className="kc-course-showcase" data-count={products.length}>
      <div className="kc-course-showcase__head">
        <h2 className="kc-course-showcase__heading">{title}</h2>
      </div>
      <div className="kc-course-showcase__grid" data-count={Math.min(products.length, 3)}>
        {products.map((product, index) => (
          <ShowcaseCard index={index} key={product.id} product={product} />
        ))}
      </div>
      <p className="kc-course-showcase__lead">{leadText}</p>
      {markText.length > 0 ? (
        <p aria-hidden="true" className="kc-course-showcase__mark">
          {markText}
        </p>
      ) : null}
      {drift ? (
        <div aria-hidden="true" className="kc-course-showcase__drift">
          {COURSE_SHOWCASE_DRIFT.map((image, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- dekoratív, statikus csapatkép
            <img
              alt=""
              className={`kc-course-showcase__drift-img kc-course-showcase__drift-img--${index}`}
              decoding="async"
              height={image.height}
              key={image.src}
              loading="lazy"
              src={image.src}
              width={image.width}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
