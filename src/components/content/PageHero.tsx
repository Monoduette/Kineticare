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
 * (`apply-owner-content.ts`, ROLUNK_HERO_FORRAS). Mérés: content.css
 * `.kc-page-hero--paired` (1440: a cím és a kép felső éle 0 px eltéréssel;
 * 390: a kép a bevezető alatt).
 */
/**
 * A CMS-oldalak, amelyeken a fejléc-kép a cím MELLETT áll (`paired`): a
 * /rolunk (a két alapító stúdiófotója) és a /szolgaltatasok (kezelés a
 * kezelőasztalon). Tulajdonosi kérés (2026-09-19) a Szolgáltatások oldalra:
 * „Ahogy belépünk, olyan szűknek néz ki a sáv, amiben a szövegek vannak”,
 * és „ide is egy képet rólunk kezelés közben” — mérve 1440 px-en a fejléc
 * egy 672 px-es szövegoszlop volt, a sáv 53 %-a üres; a páros rács a teljes
 * konténert használja (NN/g Common Region, Material 3 supporting pane, lásd
 * fent). Minden más slug marad `stacked` (Codex, 2026-09-19).
 */
export const PAROS_FEJLEC_SLUGOK: ReadonlySet<string> = new Set(['rolunk', 'szolgaltatasok'])

export interface PageHeroProps {
  title: string
  lead?: string | null
  media?: Media | null
  /**
   * `stacked` (alap): a kép a fejléc-sáv ALATT, saját sávban, a természetes
   * képarányán, vágás nélkül — minden CMS-oldal ezt kapja, mert a
   * `pages.heroImage` mező általános (fekvő, négyzetes, grafikus kép is
   * lehet). `paired`: a Rólunk és a Szolgáltatások fotós elrendezése (3:2-es
   * keret, a kép a cím MELLETT; a WP54 óta a fejléc-fotók natív 3:2-esek,
   * vágás nincs) — csak ott, ahol a tulajdonosi kérés ezt kérte
   * (Codex, 2026-09-19).
   */
  variant?: 'stacked' | 'paired'
}

export function PageHero({ title, lead, media, variant = 'stacked' }: PageHeroProps) {
  const leadText = lead?.trim() ?? ''
  if (!media || variant === 'stacked') {
    return (
      <>
        <Section className="kc-page-hero" variant="tint">
          <Container size="narrow">
            <h1 className="kc-page-hero__title">{title}</h1>
            {leadText.length > 0 ? <p className="kc-page-hero__lead">{leadText}</p> : null}
          </Container>
        </Section>
        {media ? (
          <Section flush>
            <Container>
              <div className="kc-page-hero__media">
                <MediaImage
                  media={media}
                  preferredSize="lg"
                  priority
                  sizes="(max-width: 1120px) 100vw, 1120px"
                />
              </div>
            </Container>
          </Section>
        ) : null}
      </>
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
            {/* A fejléc-kép a lap LCP-jelöltje: priority (preload, high).
                A `sizes` egy hasábban a figure 28rem-es (448 px) sapkáját is
                tükrözi: 600–899 px-en enélkül a böngésző ~1,6×-os képet kért
                volna (md 1280 az sm 640 helyett), mérve. */}
            <MediaImage
              media={media}
              preferredSize="lg"
              priority
              sizes="(max-width: 899px) min(calc(100vw - 48px), 448px), (max-width: 1200px) 45vw, 528px"
            />
          </figure>
        </div>
      </Container>
    </Section>
  )
}
