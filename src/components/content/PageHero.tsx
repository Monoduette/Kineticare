import type { Media } from '../../payload-types'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { MediaImage } from './MediaImage'

/**
 * PageHero — a CMS-oldal szöveges fejléce (cím + bevezető), opcionális
 * fejléc-képpel.
 *
 * KÉT ALAK, EGY SZERKEZET (WP51, tulajdonosi kör 2026-09-19, /rolunk: „»A kéz
 * a mindenünk« cím mellé kép róluk"):
 *  - kép nélkül: a mai szűk (720 px) hasáb, cím és bevezető egymás alatt;
 *  - képpel (`kc-page-hero--paired`): széles konténer, asztalon (≥ 900 px)
 *    a cím és a bevezető a BAL, a fotó a JOBB hasábban, a kettő felső éle
 *    egy vonalban (rács, `align-items: start`); 900 px alatt a kép a cím és
 *    a bevezető ALATT áll, a DOM-sorrend szerint (a szöveg nem csúszik a
 *    hajtás alá a kép miatt; WCAG 2.2 SC 1.3.2 Meaningful Sequence).
 *
 * A korábbi megoldás a képet a fejléc-sáv ALATT, külön teljes szélességű
 * sávban mutatta: a cím és a kép között egy sávhatár és 48–72 px térköz állt,
 * a fotó pedig 1120 px széles, hero-szerű csíkká nőtt. A cím MELLÉ tett kép
 * egy régióba zárja a „kik vagyunk" kérdés két felét (NN/g Common Region:
 * https://www.nngroup.com/articles/common-region/; NN/g About Us: a
 * bemutatkozás nyitánya mutassa a valódi csapatot, ne stockfotót —
 * https://www.nngroup.com/articles/about-us-information-on-corporate-websites/).
 * A fele-fele rács a Material 3 „supporting pane" kanonikus elrendezése
 * (szöveg elsődleges, kép mellérendelt; közepes/széles ablakban egymás
 * mellett, keskenyben egymás alatt:
 * https://m3.material.io/foundations/layout/canonical-layouts/supporting-pane).
 * GOV.UK Images: a kép a tartalom rácsán áll, nem díszként lebeg
 * (https://design-system.service.gov.uk/styles/images/).
 *
 * A képet a `pages.heroImage` mező adja; a /rolunk-on ez a páros csapatfotó
 * (`apply-owner-content.ts`, UJ_ROLUNK_HERO_PREFIX). Mérés: content.css
 * `.kc-page-hero--paired` (1440: a cím és a kép felső éle 0 px eltéréssel;
 * 390: a kép a bevezető alatt).
 */
export interface PageHeroProps {
  title: string
  lead?: string | null
  media?: Media | null
}

export function PageHero({ title, lead, media }: PageHeroProps) {
  const leadText = lead?.trim() ?? ''
  if (!media) {
    return (
      <Section className="kc-page-hero" variant="tint">
        <Container size="narrow">
          <h1 className="kc-page-hero__title">{title}</h1>
          {leadText.length > 0 ? <p className="kc-page-hero__lead">{leadText}</p> : null}
        </Container>
      </Section>
    )
  }
  return (
    <Section className="kc-page-hero kc-page-hero--paired" variant="tint">
      <Container>
        <div className="kc-page-hero__grid">
          <div className="kc-page-hero__copy">
            <h1 className="kc-page-hero__title">{title}</h1>
            {leadText.length > 0 ? <p className="kc-page-hero__lead">{leadText}</p> : null}
          </div>
          <figure className="kc-page-hero__figure">
            {/* A fejléc-kép a lap LCP-jelöltje: priority (preload, high). */}
            <MediaImage
              media={media}
              preferredSize="lg"
              priority
              sizes="(max-width: 899px) calc(100vw - 48px), (max-width: 1200px) 45vw, 528px"
            />
          </figure>
        </div>
      </Container>
    </Section>
  )
}
