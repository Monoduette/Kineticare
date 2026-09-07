import type { BlockAbout } from '../../payload-types'
import { MediaImage } from '../content/MediaImage'
import { pickMediaUrl } from '../content/media-url'
import { Section } from '../ui/Section'
import { PhotoFrieze } from './PhotoFrieze'

import '../../app/(frontend)/styles/blocks/about.css'

/**
 * Tartalomhoz igazodó bemutatkozás, külön statisztikasorral. A valódi fotó
 * és az olvasható szöveg együtt adja a bizalmi elemet, nem egy üres hasáb.
 * https://www.nngroup.com/articles/photos-as-web-content/
 * https://design-system.service.gov.uk/styles/layout/
 *
 * KÉT ALAK, EGY SZERKEZET:
 *  - páros (`kc-about--paired`, pl. /rolunk): bal hasáb szöveg, jobb hasáb a
 *    CMS-fotó hullámos alsó éllel, alatta a statisztikasor;
 *  - alapítók (`kc-about--founders`, a kezdőlap filmsáv utáni blokkja, a
 *    `frieze` prop jelére): ugyanez a párosítás, de a jobb hasábban a CMS-fotó
 *    HELYETT a négy íves csapatfotó-fríz áll (PhotoFrieze), ugyanazzal a
 *    hullámos alsó éllel. A CMS-fotó ilyenkor szándékosan nem renderel: a
 *    fríz már mutatja a két gyógytornászt, és egy régióban két azonos arcpár
 *    ismétlés lenne (NN/g Common Region: egy határ = egy tartalmi egység;
 *    https://www.nngroup.com/articles/common-region/). A tulajdonos
 *    2026-09-07-i kérése: „az alapítók és a fölső mozgó 4 kép mehetne
 *    egybe", és a /rolunk-féle szöveg–fotó párosítás a kezdőlapon is.
 *
 * A szöveghasáb három csoportra oszlik (fej: eyebrow + cím; törzs:
 * bekezdések; láb: kiemelés). WP18 (2026-09-07): a csoportok TERMÉSZETES
 * folyásban, felül igazítva állnak, tokenes közökkel; a korábbi
 * `space-between` elosztás 1440 px-en 106 px-es réseket adott, ami már nem
 * csoportosított (about.css; NN/g whitespace és proximity: a térköz akkor
 * jelent valamit, ha a közelség mondja meg, mi tartozik össze). A kezdőlap
 * és a /rolunk About-ja ugyanazt a szöveget viszi egy közös forrásból
 * (src/lib/home-seed.ts `rolunkBemutatkozasSzoveg`), a statisztikasor
 * oldalanként más. A hullámos fotókon visszafogott hover-nagyítás
 * (about.css, photo-frieze.css; csak `hover: hover`, reduced-motion alatt
 * nincs).
 */
export interface AboutProps {
  block: BlockAbout
  /**
   * Alapítók-alak: a jobb hasábban a kódban élő fotó-fríz áll a CMS-fotó
   * helyett. A RenderBlocks akkor adja, ha a blokk a kezdőlap ELSŐ
   * About-ja és közvetlenül a filmsáv után áll.
   */
  frieze?: boolean
}

/**
 * A kiemelt blokk dekoratív ikonja. A landingen ez egy Phosphor-glif volt; a fő
 * site nem húz be ikonkészlet-függőséget, ezért beágyazott SVG — tisztán
 * dekoratív (aria-hidden), a jelentést a felirat hordozza.
 */
function FeatureIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="26"
      viewBox="0 0 32 32"
      width="26"
    >
      <circle cx="16" cy="6.5" r="3.25" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 14.5h24M16 12v16M16 20l-6 8M16 20l6 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

export function About({ block, frieze = false }: AboutProps) {
  const paragraphs = (block.paragraphs ?? []).filter((item) => (item.text?.trim() ?? '').length > 0)
  const stats = (block.stats ?? []).filter(
    (item) => (item.value?.trim() ?? '').length > 0 && (item.label?.trim() ?? '').length > 0,
  )
  const title = block.title?.trim() ?? ''
  const featureLabel = block.feature?.label?.trim() ?? ''
  const featureNote = block.feature?.note?.trim() ?? ''
  const hasFeature = featureLabel.length > 0 || featureNote.length > 0
  const eyebrow = block.eyebrow?.trim() ?? ''
  const hasCopy = title.length > 0 || paragraphs.length > 0 || hasFeature || eyebrow.length > 0
  // Az alapítók-alak szöveg nélkül értelmetlen (a fríz a bemutatkozás képi
  // fele, nem önálló szekció): szöveg híján a blokk a sima alakra esik vissza.
  const founders = frieze && hasCopy
  const photo =
    !founders &&
    typeof block.photo === 'object' &&
    block.photo !== null &&
    pickMediaUrl(block.photo, 'lg')
      ? block.photo
      : null

  // Cím, szöveg, kép és számok nélkül nincs mit mutatni — a szekció kimarad.
  if (!hasCopy && stats.length === 0 && !photo) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `about-cim-${block.id ?? 'fo'}`
  const shape = founders ? ' kc-about--founders' : photo && hasCopy ? ' kc-about--paired' : ''

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className={`kc-about kc-board kc-board--band${shape}`}
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner kc-about__grid">
        {founders ? <PhotoFrieze /> : null}
        {hasCopy ? (
          <div className="kc-about__copy">
            {eyebrow.length > 0 || title.length > 0 ? (
              <div className="kc-about__head">
                {eyebrow.length > 0 ? <p className="kc-about__eyebrow">{eyebrow}</p> : null}
                {title.length > 0 ? (
                  <h2 className="kc-about__title" id={headingId}>
                    {title}
                  </h2>
                ) : null}
              </div>
            ) : null}
            {paragraphs.length > 0 ? (
              <div className="kc-about__body">
                {paragraphs.map((item, index) => {
                  const text = item.text.trim()
                  return (
                    <p className="kc-about__text" key={item.id ?? `bekezdes-${index}`}>
                      {item.emphasized ? <strong>{text}</strong> : text}
                    </p>
                  )
                })}
              </div>
            ) : null}
            {hasFeature ? (
              <div className="kc-about__foot">
                <div className="kc-about__feature">
                  <span className="kc-about__feature-icon">
                    <FeatureIcon />
                  </span>
                  <div className="kc-about__feature-copy">
                    {featureLabel.length > 0 ? (
                      <p className="kc-about__feature-label">{featureLabel}</p>
                    ) : null}
                    {featureNote.length > 0 ? (
                      <p className="kc-about__feature-note">{featureNote}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {photo ? (
          <figure className="kc-about__figure">
            <MediaImage
              media={photo}
              preferredSize="lg"
              sizes="(max-width: 512px) calc(100vw - 64px), (max-width: 899px) 448px, 50vw"
            />
          </figure>
        ) : null}
        {stats.length > 0 ? (
          <dl className="kc-about__stats">
            {stats.map((item, index) => (
              <div className="kc-about__stat" key={item.id ?? `szam-${index}`}>
                <dt className="kc-about__stat-label">{item.label.trim()}</dt>
                <dd className="kc-about__stat-value">{item.value.trim()}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </Section>
  )
}
