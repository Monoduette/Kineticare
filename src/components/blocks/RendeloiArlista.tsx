import { createElement } from 'react'

import { ctaLabel } from '../../lib/cta-vocabulary'
import { MAPS_LINK_HINT, mapsHref } from '../../lib/maps-href'
import { labjegyzetMondat, type RendeloiArlista as ArlistaModell } from '../../lib/rendeloi-arlista'
import { linkFields, renderLexicalContent } from '../lexical/serialize'
import { Button } from '../ui/Button'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/rendeloi-arlista.css'

/**
 * RendeloiArlista — a /szolgaltatasok „Rendelői kezelések" szekciójának
 * strukturált alakja (WP58, tulajdonosi kérés 2026-09-19).
 *
 * A TARTALOM a CMS `richText` blokkjáé marad; ez a komponens a
 * `felismerRendeloiArlista` (src/lib/rendeloi-arlista.ts) által kinyert
 * szerkezetet rendezi el. Mérve ELŐTTE élőben (Chromium, 1440 px): a szekció
 * 938 px magas, 720 px-es szűk hasábban, csupa folyószöveg, a két ár-tétel
 * ugyanazt a zárójeles magyarázatot ismétli, az időpontkérés mondatba
 * ágyazott 133×26 px-es szöveglink.
 *
 * ELRENDEZÉS ÉS FORRÁSAI.
 *  - Két hasáb 900 px fölött: balra a cím, a bevezető és a gomb; jobbra az
 *    árkártyák és a tények. A tartozó elemek egy csoportba, a csoportok
 *    közé nagyobb köz (NN/g, Proximity Principle:
 *    https://www.nngroup.com/articles/gestalt-proximity/; Material 3 Layout,
 *    Spacing: https://m3.material.io/foundations/layout/understanding-layout/spacing).
 *  - A két ár EGYMÁS MELLETT, azonos felépítésű kártyán (időtartam, ár): az
 *    NN/g összehasonlító táblái szerint kevés (≤ 5) alternatíva közti
 *    választásnál az egymás melletti, azonos attribútum-sorrendű bemutatás a
 *    helyes, kis képernyőn legfeljebb 2 egymás mellett
 *    (https://www.nngroup.com/articles/comparison-tables/); Baymard Plan
 *    Matrix: a csomagok egymás melletti összevetése a döntés fő felülete
 *    (https://baymard.com/ecommerce-design-examples/plan-matrix). Material 3
 *    Cards: egy kártya egy témáról szól, a kártyák gyűjteménye rácsban áll
 *    (https://m3.material.io/components/cards/guidelines).
 *  - Az ismétlődő zárójeles magyarázat EGYSZER, közös lábjegyzetként a
 *    kártyák alatt: az NN/g szerint az összehasonlító felület a különbséget
 *    tegye szkennelhetővé, a közös tulajdonság ne ismétlődjön tételenként.
 *  - A tény-sor (első alkalom, fizetés, helyszínek) a GOV.UK Summary list
 *    mintáján: kulcs-tények sorai, elválasztó vonallal, mert a vonal a
 *    nagyítva olvasóknak is segít sort tartani
 *    (https://design-system.service.gov.uk/components/summary-list/).
 *  - A gomb a §3.2 #24 sor („Kérj időpontot üzenetben", másodlagos): a
 *    kattintás NAVIGÁL az időpontkérő szekcióra, a vállalás ott, a #25
 *    gombbal történik. Másodlagos, mert a lapon a záró sáv az egyetlen
 *    elsődleges CTA (GOV.UK Button: egy fő cselekvés laponként,
 *    https://design-system.service.gov.uk/components/button/). A cél a
 *    szerkesztő linkjéé (a CMS-ből jön), a felirat a szótáré (WCAG 2.2 SC
 *    3.2.4 Consistent Identification).
 *  - Érintőcél: a gomb a közös `kc-button` (min-height 44 px), tehát a
 *    WCAG 2.2 SC 2.5.8 24 px-es minimuma fölött; a korábbi szöveglink az
 *    „inline" kivétellel élt (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
 *  - 320 px-en egy hasáb, a kártyák egymás alatt, vízszintes görgetés nélkül
 *    (WCAG 2.2 SC 1.4.10 Reflow, https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
 */
export interface RendeloiArlistaProps {
  modell: ArlistaModell
  /** A szekció horgonya (a fejléc-menü ide ugrik). */
  id: string | undefined
  variant: 'default' | 'tint' | 'dark' | undefined
  /** A blokk azonosítója a címsor-id egyediségéhez. */
  blockId: string | null | undefined
}

export function RendeloiArlista({ modell, id, variant, blockId }: RendeloiArlistaProps) {
  const headingId = `rendeloi-cim-${blockId ?? 'fo'}`
  const bevezeto =
    modell.bevezeto.length > 0
      ? renderLexicalContent({ root: { children: modell.bevezeto } })
      : null
  const ctaCel = modell.cta ? linkFields(modell.cta) : null

  return (
    <Section
      aria-labelledby={headingId}
      className="kc-arlista"
      id={id}
      variant={variant ?? 'default'}
    >
      <Container>
        <div className="kc-arlista__grid">
          <div className="kc-arlista__lead">
            {createElement(
              modell.cimTag,
              { className: 'kc-section-title kc-arlista__title', id: headingId },
              modell.cim,
            )}
            {bevezeto ? <div className="kc-richtext kc-arlista__intro">{bevezeto}</div> : null}
            {ctaCel ? (
              <p className="kc-arlista__action">
                <Button href={ctaCel.url} openInNewTab={ctaCel.newTab} variant="secondary">
                  {ctaLabel('appointment-request-link')}
                </Button>
              </p>
            ) : null}
          </div>

          <div className="kc-arlista__panel">
            <h3 className="kc-arlista__panel-title">
              {modell.arlistaCim}
              {modell.arlistaAlcim ? (
                <span className="kc-arlista__panel-sub">{modell.arlistaAlcim}</span>
              ) : null}
            </h3>
            <ul className="kc-arlista__cards">
              {modell.tetelek.map((tetel) => (
                <li className="kc-card kc-arlista__card" key={tetel.idotartam}>
                  <span className="kc-arlista__duration">{tetel.idotartam}</span>
                  <span className="kc-arlista__price">{tetel.ar}</span>
                  {tetel.megjegyzes ? (
                    <span className="kc-arlista__card-note">
                      {labjegyzetMondat(tetel.megjegyzes)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {modell.kozosMegjegyzes ? (
              <p className="kc-arlista__note">{labjegyzetMondat(modell.kozosMegjegyzes)}</p>
            ) : null}
            {modell.tenyek.length > 0 || modell.helyszinek ? (
              <ul className="kc-arlista__facts">
                {modell.tenyek.map((teny) => (
                  <li className="kc-arlista__fact" key={teny}>
                    {teny}
                  </li>
                ))}
                {modell.helyszinek ? (
                  <li className="kc-arlista__fact kc-arlista__fact--places">
                    <span className="kc-arlista__fact-key">{modell.helyszinek.cimke}</span>
                    <ul className="kc-arlista__places">
                      {modell.helyszinek.cimek.map((cim) => {
                        // Ugyanaz a címlink-minta, mint a Kapcsolat oldal
                        // időpontkérő szekciójában (WCAG 2.2 SC 3.2.4, azonos
                        // cselekvés = azonos alak): látható szöveg a cím, a
                        // link a Google Térképet nyitja új lapon, a rejtett
                        // toldat a képernyőolvasónak szól. Miért `search`,
                        // miért új lap, források: src/lib/maps-href.ts.
                        const href = mapsHref(cim)
                        return (
                          <li className="kc-arlista__place" key={cim}>
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                {cim}
                                <span className="kc-visually-hidden">{MAPS_LINK_HINT}</span>
                              </a>
                            ) : (
                              cim
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </div>
      </Container>
    </Section>
  )
}
