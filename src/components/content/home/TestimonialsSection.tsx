import type { Testimonial } from '../../../payload-types'
import { Card } from '../../ui/Card'
import { Section } from '../../ui/Section'

import '../../../app/(frontend)/styles/blocks/testimonials.css'

/**
 * TestimonialsSection — páciens-vélemények a kezdőlapon (audit M6/K4).
 * ki. Ha nincs kiemelt vélemény, a szekció NEM renderelődik — üres állapotban
 */

/** A kezdőlapon megjelenő vélemények felső korlátja (UX-skill M6: max 2–3). */
export const MAX_HOME_TESTIMONIALS = 3

/**
 * A kezdőlapra kerülő vélemények: kiemelt + látható, `order` szerint, max 3.
 *
 * A cms.ts `getTestimonials()` lekérdezése ugyanezt szűri — ez a védőháló (a
 * kártyakomponensek mintájára), hogy a szekció fixture-ből és éles adatból is
 * azonosan viselkedjen. A `limit` 1 és MAX_HOME_TESTIMONIALS közé szorítva
 * érvényesül — a kezdőlapi felső korlátot a blokk sem lépheti át.
 */
export function featuredTestimonials(
  testimonials: Testimonial[],
  limit: number = MAX_HOME_TESTIMONIALS,
): Testimonial[] {
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_HOME_TESTIMONIALS)
  return testimonials
    .filter((testimonial) => testimonial.featured === true && testimonial.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, clampedLimit)
}

/** A megjelenő idézet: a rövid változat elsőbbséget élvez a teljes szöveg felett. */
export function testimonialQuoteText(testimonial: Testimonial): string {
  const short = testimonial.shortQuote?.trim() ?? ''
  return short.length > 0 ? short : testimonial.quote.trim()
}

export interface TestimonialsSectionProps {
  testimonials: Testimonial[]
  /** Kis felső felirat-felülírás a `testimonials` blokkból. */
  eyebrow?: string
  /** Cím-felülírás a blokkból — üresen a beépített cím marad. */
  heading?: string
  /** Megjelenő vélemények száma (1–3 közé szorítva). */
  maxItems?: number
  id?: string
  variant?: 'default' | 'tint' | 'dark'
  /**
   * A címsor egyedi id-je az `aria-labelledby`-hoz — akkor kell felülírni, ha
   * a blokk többször szerepel egy oldalon (különben duplikált id születne).
   */
  headingId?: string
}

export function TestimonialsSection({
  testimonials,
  eyebrow,
  heading,
  maxItems,
  id = 'velemenyek',
  variant = 'tint',
  headingId = 'velemenyek-cim',
}: TestimonialsSectionProps) {
  const items = featuredTestimonials(testimonials, maxItems ?? MAX_HOME_TESTIMONIALS)

  if (items.length === 0) {
    return null
  }

  const eyebrowText = eyebrow?.trim() || 'Vélemények'
  const title = heading?.trim() || 'Pácienseink mondták'
  // Rács-változat: 1 vélemény = csak a nagy idézet, 2 = nagy + 1 kis, 3 = nagy
  // + 2 kis (a nagy idézet ilyenkor két rácssort fog át).
  const listVariant = items.length >= 3 ? 'trio' : items.length === 2 ? 'pair' : 'single'

  return (
    <Section
      aria-labelledby={headingId}
      className="kc-testimonials kc-board kc-board--edge"
      id={id}
      variant={variant}
    >
      <div className="kc-board__inner">
        <div className="kc-testimonials__head">
          <p className="kc-testimonials__eyebrow">{eyebrowText}</p>
          <h2 className="kc-section-title kc-testimonials__title" id={headingId}>
            {title}
          </h2>
        </div>
        <ul className={`kc-testimonials__list kc-testimonials__list--${listVariant}`}>
          {items.map((testimonial, index) => {
            const role = testimonial.authorTitle?.trim() ?? ''
            const emphasis = index === 0 ? 'big' : 'small'
            return (
              <li
                className={`kc-testimonials__item kc-testimonials__item--${emphasis}`}
                key={testimonial.id}
              >
                <Card as="article" className="kc-testimonials__card" padded={false}>
                  <figure className="kc-testimonials__figure">
                    <span aria-hidden="true" className="kc-testimonials__mark">
                      „
                    </span>
                    <blockquote className="kc-testimonials__quote">
                      <p className="kc-testimonials__text">{testimonialQuoteText(testimonial)}</p>
                    </blockquote>
                    <figcaption className="kc-testimonials__attribution">
                      <span className="kc-testimonials__cite">{testimonial.authorName.trim()}</span>
                      {role.length > 0 ? <span className="kc-testimonials__role">{role}</span> : null}
                    </figcaption>
                  </figure>
                </Card>
              </li>
            )
          })}
        </ul>
      </div>
    </Section>
  )
}
