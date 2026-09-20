import { ctaLabel } from '../../../lib/cta-vocabulary'
import { Button } from '../../ui/Button'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'
import { PromoPrice } from './PromoPrice'

/**
 * PromoClosingCta — záró vásárlási sáv a szakaszok után, sötét háttéren.
 *
 * A rendes kurzusoldal SZÁNDÉKOSAN nem ismétli a gombot (a ragadós doboz a
 * lap egyetlen célja). Az akciós sablonon nincs ragadós doboz, a hero gombja
 * több képernyőnyire van a GYIK végétől, ezért a lap olvasási végén — ahol a
 * döntés születik — egyszer még ott a cselekvés, UGYANAZZAL a felirattal és
 * céllal (WCAG 2.2 SC 3.2.4 Consistent Identification). Csak a `buy` ágon
 * jelenik meg: „már megvetted" vagy „nem vásárolható" mellett hamis ígéret
 * lenne (docs/ui-sztenderdek.md Á-3). A minta a kampány-sáv (CtaBanner,
 * cta-banner.css): cím + ár + egy gomb + egy sor garancia. A sötét sávon az
 * elsődleges gomb fordul (fehér alap, ink felirat: 15,63:1), mert az
 * akcent-mély kitöltés az inken belefolyna a háttérbe (ui.css levezetése).
 */
export interface PromoClosingCtaProps {
  priceHuf: number
  originalPriceHuf: number | null
  /** A pénztár címe (a `buy` ág `href`-je) — a felirat a szótár #1 sora. */
  href: string
  guaranteeLabel: string | null
}

export const PROMO_CLOSING_ID = 'akcios-vasarlas'

export function PromoClosingCta({
  priceHuf,
  originalPriceHuf,
  href,
  guaranteeLabel,
}: PromoClosingCtaProps) {
  return (
    <Section
      aria-labelledby={`${PROMO_CLOSING_ID}-cim`}
      className="kc-promo-closing"
      id={PROMO_CLOSING_ID}
      variant="dark"
    >
      <Container className="kc-promo-closing__inner">
        <div className="kc-promo-closing__copy">
          <h2 className="kc-promo-closing__title" id={`${PROMO_CLOSING_ID}-cim`}>
            Kezdd el az akciós áron
          </h2>
          <PromoPrice
            className="kc-promo-closing__price"
            originalPriceHuf={originalPriceHuf}
            priceHuf={priceHuf}
          />
          {guaranteeLabel !== null ? (
            <p className="kc-promo-closing__guarantee">
              <span aria-hidden="true" className="kc-promo-closing__guarantee-mark">
                ✓
              </span>
              {guaranteeLabel}
            </p>
          ) : null}
        </div>
        <div className="kc-promo-closing__action">
          <Button className="kc-promo-closing__button" href={href} variant="primary">
            {ctaLabel('course-buy')}
          </Button>
        </div>
      </Container>
    </Section>
  )
}
