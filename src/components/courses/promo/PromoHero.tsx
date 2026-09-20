import type { CourseCtaState } from '../../../lib/courses'
import { ctaLabel } from '../../../lib/cta-vocabulary'
import type { Media } from '../../../payload-types'
import { MediaImage } from '../../content/MediaImage'
import { Button } from '../../ui/Button'
import { Container } from '../../ui/Container'
import { PromoPrice } from './PromoPrice'

/**
 * PromoHero — az akciós kurzusoldal teljes szélességű, sötét, fotós fejléce.
 *
 * A minta a kampányoldal hero-ja (korábban DemoCourseLanding): borítókép a
 * háttérben, ink-fátyol, alul igazított szöveg. A fátyol NEM dísz: a GOV.UK
 * képútmutatója szerint a képre tett szövegnek a kép MINDEN részletén
 * kontrasztosnak kell maradnia (https://design-system.service.gov.uk/styles/images/),
 * ezért a fátyol a legrosszabb esetre (tiszta fehér képrészlet) is 4,5:1
 * fölött tartja a fehér szöveget — a számítás a promo-course.css fejlécében.
 *
 * Felépítés (fentről lefelé), a kutatás szerinti sorrendben:
 *  1. akció-jelzés (statikus „…-ig" dátum; ÉLŐ visszaszámláló NINCS: a NN/g
 *     és a Baymard szerint a visszaszámláló nyomásgyakorló sötét minta,
 *     https://www.nngroup.com/articles/dark-patterns/ ,
 *     https://baymard.com/blog/countdown-timers ),
 *  2. H1, lead,
 *  3. ár-sor (eredeti ár áthúzva + akciós ár, képernyőolvasó-címkékkel),
 *  4. EGY elsődleges cselekvés + egy másodlagos ugrás (GOV.UK: egy oldal,
 *     egy elsődleges gomb, https://design-system.service.gov.uk/components/button/),
 *  5. bizalmi sor: garancia + tényadatok (Baymard: a visszaküldési feltétel
 *     és a „mit kapok" a gomb KÖZELÉBEN csökkenti a kockázatérzetet).
 * A CTA-ágak a `resolveCourseCta` állapotgépből jönnek, itt csak
 * megjelenítés van: `buy` → gomb a pénztárba; `purchased` → a lejátszó
 * gombja + a „már megvetted" mondat; nem cselekvő ág → csak a magyarázat,
 * gomb nélkül (docs/ui-sztenderdek.md Á-3).
 */
export interface PromoHeroProps {
  title: string
  lead: string | null
  /** Kategória és célközönség rövid jelzése (a vásárlódoboz meta-sora). */
  categoryLabel: string | null
  audienceLabel: string
  /** A hero háttérképe (a kurzus borítója, populate-olva) vagy null. */
  heroMedia: Media | null
  priceHuf: number
  originalPriceHuf: number | null
  /** „szeptember 30-ig" vagy null, ha az akciónak nincs vége. */
  untilLabel: string | null
  cta: CourseCtaState
  /** A CTA-blokk horgonya — a ragadós vásárlósáv EZT figyeli. */
  ctaId: string
  /**
   * Másodlagos ugrás: a tananyag szakasz (`#tananyag`), ha van. Tananyag
   * nélkül nincs másodlagos gomb: a hero alatt közvetlenül ott állnak az
   * ugrás-chipek minden szakaszra, egy második, a szótárban nem szereplő
   * felirat („Kinek való?") csak zajt adna (GOV.UK: egy elsődleges gomb,
   * a másodlagos csak akkor, ha valódi, külön célja van).
   */
  hasCurriculum: boolean
  guaranteeLabel: string | null
  /** Tényadatok (modulok, leckék, hozzáférés) — ellenőrizhető adat, nem ígéret. */
  facts: string[]
}

export const PROMO_HERO_TITLE_ID = 'kurzus-cim'

export function PromoHero({
  title,
  lead,
  categoryLabel,
  audienceLabel,
  heroMedia,
  priceHuf,
  originalPriceHuf,
  untilLabel,
  cta,
  ctaId,
  hasCurriculum,
  guaranteeLabel,
  facts,
}: PromoHeroProps) {
  const trustRows = [...(guaranteeLabel === null ? [] : [guaranteeLabel]), ...facts]
  return (
    <section
      aria-labelledby={PROMO_HERO_TITLE_ID}
      className="kc-section kc-section--dark kc-section--flush kc-promo-hero"
    >
      {heroMedia !== null ? (
        <div aria-hidden="true" className="kc-promo-hero__media">
          <MediaImage
            className="kc-promo-hero__image"
            decorative
            media={heroMedia}
            preferredSize="lg"
            priority
            sizes="100vw"
          />
        </div>
      ) : null}
      <div aria-hidden="true" className="kc-promo-hero__veil" />
      <Container className="kc-promo-hero__inner">
        <div className="kc-promo-hero__copy">
          <p className="kc-promo-hero__badge">
            {untilLabel === null ? 'Akciós ár' : `Akciós ár ${untilLabel}`}
          </p>
          <p className="kc-promo-hero__meta">
            {categoryLabel !== null ? <span>{categoryLabel}</span> : null}
            <span>{audienceLabel}</span>
          </p>
          <h1 className="kc-promo-hero__title" id={PROMO_HERO_TITLE_ID}>
            {title}
          </h1>
          {lead ? <p className="kc-promo-hero__lead">{lead}</p> : null}

          <PromoPrice
            className="kc-promo-hero__price"
            note="egyszeri díj, további költség nincs"
            originalPriceHuf={originalPriceHuf}
            priceHuf={priceHuf}
          />

          <div className="kc-promo-hero__cta" id={ctaId}>
            <div className="kc-promo-hero__actions">
              {/* A felirat a szótárból, a CTA-ág szerint (§3.2 #1 / #8) — a
                  `resolveCourseCta` ugyanezt adja a `label` mezőben; a két
                  cselekvő ágon a gomb, a nem cselekvő ágon (label null) nincs
                  gomb, csak a magyarázat. */}
              {cta.kind === 'purchased' && cta.href !== null ? (
                <Button className="kc-promo-hero__button" href={cta.href} variant="secondary">
                  {ctaLabel('course-start')}
                </Button>
              ) : cta.kind === 'buy' && cta.href !== null ? (
                <Button className="kc-promo-hero__button" href={cta.href} variant="primary">
                  {ctaLabel('course-buy')}
                </Button>
              ) : null}
              {hasCurriculum ? (
                <Button className="kc-promo-hero__button" href="#tananyag" variant="secondary">
                  {ctaLabel('course-modules-jump')}
                </Button>
              ) : null}
            </div>
            {cta.note !== null ? <p className="kc-promo-hero__note">{cta.note}</p> : null}
            {cta.kind === 'purchased' ? (
              <p className="kc-promo-hero__note">
                Már megvetted ezt a kurzust. A lejátszóban éred el.
              </p>
            ) : null}
          </div>

          {trustRows.length > 0 ? (
            <ul aria-label="Amit a kurzussal kapsz" className="kc-promo-hero__trust" role="list">
              {trustRows.map((row, index) => (
                <li className="kc-promo-hero__trust-item" key={`${index}-${row}`}>
                  <span aria-hidden="true" className="kc-promo-hero__trust-mark">
                    ✓
                  </span>
                  <span>{row}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
