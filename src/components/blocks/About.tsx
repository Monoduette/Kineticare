import type { BlockAbout } from '../../payload-types'
import { MediaImage } from '../content/MediaImage'
import { pickMediaUrl } from '../content/media-url'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/about.css'

/**
 * Tartalomhoz igazodó bemutatkozás, külön statisztikasorral. A valódi fotó
 * és az olvasható szöveg együtt adja a bizalmi elemet, nem egy üres hasáb.
 * https://www.nngroup.com/articles/photos-as-web-content/
 * https://design-system.service.gov.uk/styles/layout/
 */
export interface AboutProps {
  block: BlockAbout
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

export function About({ block }: AboutProps) {
  const paragraphs = (block.paragraphs ?? []).filter((item) => (item.text?.trim() ?? '').length > 0)
  const stats = (block.stats ?? []).filter(
    (item) => (item.value?.trim() ?? '').length > 0 && (item.label?.trim() ?? '').length > 0,
  )
  const photo =
    typeof block.photo === 'object' && block.photo !== null && pickMediaUrl(block.photo, 'lg')
      ? block.photo
      : null
  const title = block.title?.trim() ?? ''
  const featureLabel = block.feature?.label?.trim() ?? ''
  const featureNote = block.feature?.note?.trim() ?? ''
  const hasFeature = featureLabel.length > 0 || featureNote.length > 0
  const eyebrow = block.eyebrow?.trim() ?? ''
  const hasCopy = title.length > 0 || paragraphs.length > 0 || hasFeature || eyebrow.length > 0

  // Cím, szöveg, kép és számok nélkül nincs mit mutatni — a szekció kimarad.
  if (!hasCopy && stats.length === 0 && !photo) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `about-cim-${block.id ?? 'fo'}`

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className={`kc-about kc-board kc-board--band${photo && hasCopy ? ' kc-about--paired' : ''}`}
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner kc-about__grid">
        {hasCopy ? (
          <div className="kc-about__copy">
            {eyebrow.length > 0 ? <p className="kc-about__eyebrow">{eyebrow}</p> : null}
            {title.length > 0 ? (
              <h2 className="kc-about__title" id={headingId}>
                {title}
              </h2>
            ) : null}
            {paragraphs.map((item, index) => {
              const text = item.text.trim()
              return (
                <p className="kc-about__text" key={item.id ?? `bekezdes-${index}`}>
                  {item.emphasized ? <strong>{text}</strong> : text}
                </p>
              )
            })}
            {hasFeature ? (
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
