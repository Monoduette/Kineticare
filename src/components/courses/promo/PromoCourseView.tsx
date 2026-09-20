import { Fragment, type ReactNode } from 'react'

import type { CoursePromo } from '../../../lib/course-promo'
import type { CourseCtaState } from '../../../lib/courses'
import type { CurriculumModule } from '../../../lib/curriculum/curriculum'
import type { Media, Product } from '../../../payload-types'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'
import { CourseBuyBar } from '../CourseBuyBar'
import { CourseJumpNav, type CourseJumpTarget } from '../CourseJumpNav'
import { RelatedCourses } from '../RelatedCourses'
import type { CourseSalesContent } from '../sales-content'
import { PromoClosingCta } from './PromoClosingCta'
import { PromoHero } from './PromoHero'
import { PromoHighlights } from './PromoHighlights'

import './promo-course.css'

/**
 * PromoCourseView — a kurzusoldal AKCIÓS sablonja (WP59, tulajdonosi kérés).
 *
 * Mikor: a `course-promo.ts` szerint az akció ÉL, a kurzusnak kiírt ára van
 * (`priceBadge === 'price'`) és nem szerkesztői előnézet — a kapcsoló a
 * page.tsx-ben áll, ott van az indoklás is. Ez a komponens NEM számol
 * semmit: a lap már kiszámolt adatait kapja propként, és a rendes
 * kurzusoldal SZAKASZAIT (ugyanazok a komponensek, ugyanaz a sorrend,
 * ugyanazok az id-k) rendezi teljes szélességű, váltakozó hátterű sávokba.
 * Így a horgony-chipek, a JSON-LD (FAQPage, Course/Product) és a ragadós
 * vásárlósáv változatlanul működnek.
 *
 * Szerkezet (fentről lefelé): PromoHero → ugrás-chipek → fő előnyök (tint)
 * → a szakaszok (default / tint váltakozva) → záró vásárlási sáv (sötét,
 * csak `buy` ágon) → ragadós vásárlósáv → kapcsolódó kurzusok.
 * A váltakozó háttér a tájékozódást segíti: a teljes szélességű oldalon a
 * sáv-határ mondja meg, hol ér véget egy gondolat (Material 3, tonal
 * surfaces: szomszédos felület = kis tónuslépés,
 * https://m3.material.io/styles/color/roles ; NN/g, visual hierarchy:
 * https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ ).
 */

/** A rendes kurzusoldal szakasz-leírója (page.tsx `PageSection`), szerkezetileg azonos. */
export interface PromoPageSection {
  target: CourseJumpTarget | null
  node: ReactNode
}

export interface PromoCourseViewProps {
  product: Product
  title: string
  lead: string | null
  priceHuf: number
  promo: CoursePromo
  sales: CourseSalesContent
  curriculumModules: CurriculumModule[]
  cta: CourseCtaState
  /** A CTA-blokk horgonya (page.tsx `CTA_ID`) — a ragadós vásárlósáv figyeli. */
  ctaId: string
  showBuyBar: boolean
  priceLabel: string | null
  guaranteeLabel: string | null
  /** A rendes kurzusoldal szakaszai, dokumentum-sorrendben (célpont + tartalom). */
  sections: PromoPageSection[]
  jumpTargets: CourseJumpTarget[]
  related: Product[]
  category: string | null
  audienceLabel: string
  /** Az ingyenes előzetes videó (a rendes oldallal közös csomópont) vagy null. */
  preview?: ReactNode
}

interface Band {
  variant: 'default' | 'tint'
  key: string
  nodes: ReactNode[]
}

/**
 * A szakaszok sávokba rendezése. Minden ugrócélos szakasz ÚJ sávot nyit; a
 * célpont nélküli elem (a galéria-kép) az ELŐZŐ sávban marad, a leírás után
 * — a kép a szöveg része, nem önálló szakasz, és a háttérváltás nem vághatja
 * el tőle. A sávok háttere felváltva default / tint.
 */
export function groupSectionsIntoBands(sections: PromoPageSection[]): Band[] {
  const bands: Band[] = []
  for (const [index, section] of sections.entries()) {
    const last = bands[bands.length - 1]
    if (section.target === null && last !== undefined) {
      last.nodes.push(<Fragment key={`szakasz-${index}`}>{section.node}</Fragment>)
      continue
    }
    bands.push({
      variant: bands.length % 2 === 0 ? 'default' : 'tint',
      key: section.target?.id ?? `sav-${index}`,
      nodes: [<Fragment key={`szakasz-${index}`}>{section.node}</Fragment>],
    })
  }
  return bands
}

/** Ellenőrizhető tényadatok a hero bizalmi sorába — nem ígéret, adat. */
export function promoFacts(
  modules: CurriculumModule[],
  accessDurationDays: number | null | undefined,
): string[] {
  const rows: string[] = []
  const lessonCount = modules.reduce((sum, module) => sum + module.lessons.length, 0)
  if (modules.length > 1) {
    rows.push(`${modules.length} modul`)
  }
  if (lessonCount > 0) {
    rows.push(`${lessonCount} lecke`)
  }
  if (typeof accessDurationDays === 'number' && accessDurationDays > 0) {
    rows.push(`${accessDurationDays} napos hozzáférés`)
  } else {
    rows.push('Örökös hozzáférés')
  }
  return rows
}

export function PromoCourseView({
  product,
  title,
  lead,
  priceHuf,
  promo,
  sales,
  curriculumModules,
  cta,
  ctaId,
  showBuyBar,
  priceLabel,
  guaranteeLabel,
  sections,
  preview = null,
  jumpTargets,
  related,
  category,
  audienceLabel,
}: PromoCourseViewProps) {
  const heroMedia: Media | null =
    typeof product.coverImage === 'object' && product.coverImage !== null
      ? product.coverImage
      : null
  const hasCurriculum = curriculumModules.length > 0
  const bands = groupSectionsIntoBands(sections)

  return (
    <article className="kc-promo-course">
      <PromoHero
        audienceLabel={audienceLabel}
        categoryLabel={category}
        cta={cta}
        ctaId={ctaId}
        facts={promoFacts(curriculumModules, product.accessDurationDays)}
        guaranteeLabel={guaranteeLabel}
        hasCurriculum={hasCurriculum}
        heroMedia={heroMedia}
        lead={lead}
        originalPriceHuf={promo.originalPriceHuf}
        priceHuf={priceHuf}
        title={title}
      />

      {jumpTargets.length >= 2 ? (
        <Section as="div" className="kc-promo-course__jump" flush>
          <Container>
            <CourseJumpNav targets={jumpTargets} />
          </Container>
        </Section>
      ) : null}

      {preview ? (
        <Section as="div" className="kc-promo-course__preview">
          <Container>{preview}</Container>
        </Section>
      ) : null}

      <PromoHighlights highlights={sales.highlights} />

      {bands.map((band) => (
        <Section as="div" className="kc-promo-course__band" key={band.key} variant={band.variant}>
          <Container>{band.nodes}</Container>
        </Section>
      ))}

      {cta.kind === 'buy' && cta.href !== null && cta.label !== null ? (
        <PromoClosingCta
          guaranteeLabel={guaranteeLabel}
          href={cta.href}
          originalPriceHuf={promo.originalPriceHuf}
          priceHuf={priceHuf}
        />
      ) : null}

      {showBuyBar && cta.href !== null && cta.label !== null ? (
        <CourseBuyBar
          anchorId={ctaId}
          courseTitle={title}
          href={cta.href}
          label={cta.label}
          priceLabel={priceLabel}
        />
      ) : null}

      <RelatedCourses products={related} />
    </article>
  )
}
