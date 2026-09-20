import Link from 'next/link'

import { AUDIENCE_LABELS, normalizeAudience } from '../../../lib/course-audience'
import {
  COURSE_SHOWCASE_HEADING,
  COURSE_SHOWCASE_LEAD,
  COURSE_SHOWCASE_MARK,
  COURSE_SHOWCASE_SCENE_PHOTOS,
  showcaseFallbackAt,
  splitEditorialTitle,
} from '../../../lib/course-showcase'
import { courseHref } from '../../../lib/course-url'
import { ctaLabel } from '../../../lib/cta-vocabulary'
import { coursePriceBadgeKind, courseTitle } from '../../../lib/courses'
import { rewriteVisitorDashLeftover } from '../../../lib/gondolatjel-leftover'
import type { Product } from '../../../payload-types'
import { PriceTag } from '../../ui/PriceTag'
import { CoursePromoBadge, promoAccessibleNamePrefix } from '../../courses/CoursePromoBadge'
import { MediaImage } from '../MediaImage'

import '../../../app/(frontend)/styles/blocks/course-showcase.css'

export interface CourseShowcaseProps {
  products: Product[]
  /** CMS-feliratok; üresen a jelenlegi galéria megjelenítése marad. */
  eyebrow?: string
  ctaLabel?: string
  heading?: string
  lead?: string
  /** A vízjel. Üresen a beépített „Kurzusaink”. `null`: nincs vízjel. */
  mark?: string | null
  /**
   * A vízjel alatti három csapatfotó (a jelenet). `false`: a jelenet csak a
   * vízjelet viszi (kurzuslista). A név a WP50 előtti „drift" (görgetésre
   * úszó fotók) helyett a mai, statikus rácsot írja le; a régi
   * `kc-course-showcase__photo--N` osztály és a `data-drift` attribútum
   * halott kódként maradt vissza, egyetlen stílus és teszt sem címezte
   * (takarítás, 2026-09-19).
   */
  scenePhotos?: boolean
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

function ShowcaseCard({
  product,
  index,
  ctaLabel: customCtaLabel,
}: {
  product: Product
  index: number
  ctaLabel?: string
}) {
  const title = courseTitle(product)
  const href = courseHref(product)
  const { head, tail } = splitEditorialTitle(title)
  const audienceLabel = AUDIENCE_LABELS[normalizeAudience(product.audience)]
  const priceBadge = coursePriceBadgeKind(product)
  const coverMedia =
    product.coverImage && typeof product.coverImage === 'object' ? product.coverImage : null
  const fallback = showcaseFallbackAt(index)
  /*
    LÁTHATÓ HÍVÁS A KÁRTYA ALJÁN (WP19, audit P2-5). A kártya egésze marad az
    EGYETLEN link (egy link, egy cél); a felirat csak vizuálisan gomb, nem
    második interaktív elem: nincs beágyazott gomb vagy link. A felirat a
    §3.2 szótárból jön: fizetősnél #28 `course-sales-open` („Nyisd meg a
    kurzusoldalt”), ingyenesnél #3/#4 `free-course-claim` („Elindítom
    ingyen”), ugyanaz, mint a lentebbi SOS-sáv gombja (WCAG 2.2 SC 3.2.4:
    azonos cél, azonos felirat). Források: NN/g, Cards: UX Component
    Guidelines: a kártya egésze linkel, a felismerhető cselekvés mellette áll
    (https://www.nngroup.com/articles/cards-component/); Baymard, Product
    Listing UX: a listatétel mutassa a döntéshez és a továbblépéshez szükséges
    adatot (https://baymard.com/blog/product-listing-information); NN/g
    heurisztika #6 (felismerés, nem felidézés). A hozzáférhető név a látható
    címmel kezdődik és a látható hívást is tartalmazza (WCAG 2.2 SC 2.5.3
    Label in Name).
  */
  const ctaText =
    customCtaLabel?.trim() ||
    ctaLabel(priceBadge === 'free' ? 'free-course-claim' : 'course-sales-open')
  // Élő akciónál a link neve „Akciós kurzus: ” előtaggal kezdődik: a kártya
  // egyetlen link, az `aria-label` elfedné a belső címkét (CoursePromoBadge).
  const promoPrefix = promoAccessibleNamePrefix(product)

  return (
    <article className="kc-course-showcase__card">
      <Link
        aria-label={`${promoPrefix}${title}: ${ctaText}`}
        className="kc-course-showcase__link"
        href={href}
      >
        {/* Borító: átlátszó packshot, `contain` (course-showcase.css). Tartalék
            csapatportré (nincs borító): fotó, ezért `--photo` → `cover`. */}
        <span
          className={
            coverMedia
              ? 'kc-course-showcase__media'
              : 'kc-course-showcase__media kc-course-showcase__media--photo'
          }
        >
          {coverMedia ? (
            <MediaImage
              decorative
              media={coverMedia}
              preferredSize="md"
              sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw"
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
          <CoursePromoBadge className="kc-course-showcase__promo" nameInLink product={product} />
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
          {/*
            „Ingyenes” az ár helyén (nem CTA, hanem ár-tény, §3.1.4 M-8): a rácsba
            csak a `showcaseProducts` által igazolt SOS jut el ilyen jelzéssel
            (src/lib/course-showcase.ts, P03: az ingyenes állítás bizalmi
            határ). A kártya a kurzusoldalra visz; a lentebbi FreeSos sáv
            külön dolga a lead-magnet részletezése és a szótári „Elindítom
            ingyen” CTA (docs/ui-sztenderdek.md §3.2 #4). Ugyanaz a stílus,
            mint a fizetős áré: az ingyenes tétel sorrendben is hátul áll, nem
            kap külön súlyt (UX-skill M4/K2).
          */}
          {priceBadge === 'free' ? (
            <span className="kc-course-showcase__price">Ingyenes</span>
          ) : null}
          <span className="kc-course-showcase__cta">{ctaText}</span>
        </span>
      </Link>
    </article>
  )
}

/**
 * Kurzusgaléria: képkártyák (ár a kártyán), alattuk külön „színpadon” a
 * halvány Kurzusaink vízjel, alatta három egyforma csapatfotó egy
 * háromhasábos rácsban (WP50: szimmetrikus, nem döntött), legalul a lead.
 * A DOM-sorrend egyben az olvasási sorrend: rács → jelenet → lead; a jelenet
 * teljes egészében dekoratív (aria-hidden), a lead-et sosem fedi.
 * A két audience-ág a kártya kickere, nem külön szekció.
 */
export function CourseShowcase({
  products,
  eyebrow,
  ctaLabel,
  heading,
  lead,
  mark = COURSE_SHOWCASE_MARK,
  scenePhotos = true,
}: CourseShowcaseProps) {
  if (products.length === 0) {
    return null
  }

  const title = heading?.trim() || COURSE_SHOWCASE_HEADING
  const leadText = rewriteVisitorDashLeftover(lead?.trim() || COURSE_SHOWCASE_LEAD)
  const markText = mark === null ? '' : mark.trim() || COURSE_SHOWCASE_MARK
  const hasScene = markText.length > 0 || scenePhotos

  return (
    <div className="kc-course-showcase" data-count={products.length}>
      <div className="kc-course-showcase__head">
        {eyebrow?.trim() ? <p className="kc-eyebrow">{eyebrow.trim()}</p> : null}
        <h2 className="kc-course-showcase__heading">{title}</h2>
      </div>
      <div className="kc-course-showcase__grid" data-count={Math.min(products.length, 3)}>
        {products.map((product, index) => (
          <ShowcaseCard ctaLabel={ctaLabel} index={index} key={product.id} product={product} />
        ))}
      </div>
      {hasScene ? (
        <div aria-hidden="true" className="kc-course-showcase__scene">
          {markText.length > 0 ? <p className="kc-course-showcase__word">{markText}</p> : null}
          {scenePhotos
            ? COURSE_SHOWCASE_SCENE_PHOTOS.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element -- dekoratív, statikus csapatkép
                <img
                  alt=""
                  className="kc-course-showcase__photo"
                  decoding="async"
                  height={image.height}
                  key={image.src}
                  loading="lazy"
                  src={image.src}
                  width={image.width}
                />
              ))
            : null}
        </div>
      ) : null}
      <p className="kc-course-showcase__lead">{leadText}</p>
    </div>
  )
}
