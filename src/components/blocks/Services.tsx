import Link from 'next/link'
import type { CSSProperties } from 'react'

import type { BlockServices, Media } from '../../payload-types'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import { MediaImage } from '../content/MediaImage'
import { mediaDimensions } from '../content/media-url'
import { Button } from '../ui/Button'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/services.css'
import '../../app/(frontend)/styles/blocks/services-sin.css'

/**
 * Services — tábla (kép + számozott sorok) vagy sín + panel (REV C).
 * A sín natív rádiócsoport: W3C APG Radio Group, nem hamis tablista.
 * https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 * Vizuális króm: függőleges idővonal körjelölőkkel, kiemelt kétoszlopos panel.
 */
export interface ServicesProps {
  block: BlockServices
}

type ServiceRow = NonNullable<BlockServices['rows']>[number]

/**
 * A tábla-cím méret-fokozatának határa KARAKTERBEN.
 * A tükör `--kc-text-board-6xl` lépcsője (89 px @1440) és a 7,2ch-s mérték egy
 * HÁROMSZAVAS landing-címre van kalibrálva („Így tudunk segíteni", 19 karakter).
 * A CMS viszont tetszőleges hosszú címet enged: a /szolgaltatasok 47 karakteres
 * címe ezen a lépcsőn 525 px magas, 6 soros blokká nőtt, és rácsúszott a tábla
 * fotójára (Chromiumban mérve, 1440×900 — az átfedés 328 px volt).
 */
const CIM_HOSSZ_HATAR = 24

const populatedMedia = (value: ServiceRow['photo'] | BlockServices['image']): Media | null =>
  typeof value === 'object' && value !== null ? value : null

const radioGroupName = (blockId: BlockServices['id']): string => {
  const raw = String(blockId ?? 'fo').replace(/[^a-zA-Z0-9_-]+/g, '')
  return `kc-help-${raw.length > 0 ? raw : 'fo'}`
}

export function Services({ block }: ServicesProps) {
  const rows = (block.rows ?? []).filter((row) => (row.title?.trim() ?? '').length > 0)
  if (rows.length === 0) {
    return null
  }

  const isRail = block.elrendezes === 'sin'
  if (isRail) {
    return <ServicesRail block={block} rows={rows} />
  }

  return <ServicesTabla block={block} rows={rows} />
}

function ServicesRail({ block, rows }: { block: BlockServices; rows: ServiceRow[] }) {
  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  // A drót a sávot hűvös tinten kéri. A sötét sáv marad szerkesztői kivétel;
  // a fehér CMS-érték itt is tintet kap, különben a kiemelt panel nem válik el.
  const variant = settings?.hatter === 'sotet' ? 'dark' : 'tint'
  const headingId = `services-cim-${block.id ?? 'fo'}`
  const eyebrow = block.eyebrow?.trim() ?? ''
  const title = block.title?.trim() ?? ''
  const intro = block.lead?.trim() ?? ''
  const groupName = radioGroupName(block.id)

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className="kc-services kc-board kc-board--edge kc-services--sin"
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner">
        <fieldset className="kc-services-sin">
          <legend className="kc-visually-hidden">Szolgáltatás</legend>
          {rows.map((row, index) => {
            const inputId = `${groupName}-${index}`
            return (
              <input
                className="kc-visually-hidden kc-services-sin__input"
                defaultChecked={index === 0}
                id={inputId}
                key={`input-${row.id ?? inputId}`}
                name={groupName}
                type="radio"
                value={row.title.trim()}
              />
            )
          })}
          <div className="kc-services-sin__layout">
            <div className="kc-services-sin__col">
              {eyebrow.length > 0 || title.length > 0 || intro.length > 0 ? (
                <div className="kc-services-sin__header">
                  {eyebrow.length > 0 ? <p className="kc-services__eyebrow">{eyebrow}</p> : null}
                  {title.length > 0 ? (
                    <h2
                      className={`kc-services__title${
                        title.length > CIM_HOSSZ_HATAR ? ' kc-services__title--long' : ''
                      }`}
                      id={headingId}
                    >
                      {title}
                    </h2>
                  ) : null}
                  {intro.length > 0 ? <p className="kc-services-sin__intro">{intro}</p> : null}
                </div>
              ) : null}
              <div className="kc-services-sin__rail">
                {rows.map((row, index) => {
                  const rowTitle = row.title.trim()
                  const blurb = row.osszefoglalo?.trim() ?? ''
                  return (
                    <label
                      className="kc-services-sin__rail-label"
                      htmlFor={`${groupName}-${index}`}
                      key={`rail-${row.id ?? index}`}
                    >
                      <span aria-hidden="true" className="kc-services-sin__marker">
                        <span className="kc-services-sin__marker-idle">
                          <RailHandIcon index={index} />
                        </span>
                        <span className="kc-services-sin__marker-active">
                          <RailActiveArrow />
                        </span>
                      </span>
                      <span className="kc-services-sin__rail-copy">
                        <span className="kc-services-sin__rail-title">{rowTitle}</span>
                        {blurb.length > 0 ? (
                          <span className="kc-services-sin__rail-blurb">{blurb}</span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="kc-services-sin__stage">
              {rows.map((row, index) => (
                <RailPanel
                  groupName={groupName}
                  index={index}
                  key={row.id ?? `panel-${index}`}
                  row={row}
                />
              ))}
            </div>
          </div>
        </fieldset>
      </div>
    </Section>
  )
}

function RailPanel({
  row,
  index,
  groupName,
}: {
  row: ServiceRow
  index: number
  groupName: string
}) {
  const rowTitle = row.title.trim()
  const summary = row.osszefoglalo?.trim() ?? ''
  const body = row.body?.trim() ?? ''
  const url = sanitizeCmsUrl(row.url)
  const label = row.felirat?.trim() ?? ''
  const photo = populatedMedia(row.photo)
  const headingId = `${groupName}-panel-${index}`
  // Pocs: a tartalom szolgáltatás-ajtó, nem kézállapot. A címke egyezzen
  // a sávval (NN/g, Headings: Describe the Topic; WCAG 2.2 SC 2.4.6).
  // https://www.nngroup.com/articles/headings-learn-more/
  // https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
  const kicker = `${index + 1}. ÚT`

  return (
    <article aria-labelledby={headingId} className="kc-services-sin__panel">
      <div className="kc-services-sin__copy">
        <p aria-hidden="true" className="kc-services-sin__kicker">
          {kicker}
        </p>
        <h3 className="kc-services-sin__panel-title" id={headingId}>
          {rowTitle}
        </h3>
        {summary.length > 0 ? <p className="kc-services-sin__osszefoglalo">{summary}</p> : null}
        <hr className="kc-services-sin__rule" />
        {body.length > 0 ? <p className="kc-services-sin__body">{body}</p> : null}
        {url && label.length > 0 ? (
          <Button
            className="kc-services-sin__cta"
            href={url}
            openInNewTab={Boolean(row.ujAblakban)}
          >
            {label}
            <CtaArrowIcon />
          </Button>
        ) : null}
      </div>
      {photo ? (
        <span className="kc-services-sin__photo">
          <MediaImage media={photo} preferredSize="lg" sizes="(max-width: 900px) 100vw, 36vw" />
        </span>
      ) : (
        <div className="kc-services-sin__placeholder">
          <p className="kc-services-sin__placeholder-caption">Fotó később: {rowTitle}</p>
        </div>
      )}
    </article>
  )
}

function ServicesTabla({ block, rows }: { block: BlockServices; rows: ServiceRow[] }) {
  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `services-cim-${block.id ?? 'fo'}`
  const eyebrow = block.eyebrow?.trim() ?? ''
  const title = block.title?.trim() ?? ''
  const media = populatedMedia(block.image)
  const dimensions = media ? mediaDimensions(media, 'lg') : null
  const imageRatio =
    dimensions && dimensions.width > 0 && dimensions.height > 0
      ? dimensions.width / dimensions.height
      : undefined
  const hasThreeChoices = rows.length === 3

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className={`kc-services kc-board kc-board--edge${hasThreeChoices ? ' kc-services--choices' : ''}${media ? ' kc-services--photo' : ''}`}
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner kc-services__grid">
        {eyebrow.length > 0 || title.length > 0 || media ? (
          <div className="kc-services__lead">
            {eyebrow.length > 0 ? <p className="kc-services__eyebrow">{eyebrow}</p> : null}
            {title.length > 0 ? (
              <h2
                className={`kc-services__title${
                  title.length > CIM_HOSSZ_HATAR ? ' kc-services__title--long' : ''
                }`}
                id={headingId}
              >
                {title}
              </h2>
            ) : null}
            {media ? (
              <span
                className="kc-services__media"
                style={
                  imageRatio && Number.isFinite(imageRatio)
                    ? ({ '--kc-services-image-ratio': imageRatio } as CSSProperties)
                    : undefined
                }
              >
                {/* A tábla bal hasábja a viewport ~48%-a, és a kép balra kifut a
                    tábla-szegélyen — ezért 50vw a méret-tipp, nem fix px. */}
                <MediaImage
                  media={media}
                  preferredSize="lg"
                  sizes="(max-width: 900px) 100vw, 50vw"
                />
              </span>
            ) : null}
          </div>
        ) : null}
        <ol className="kc-services__list">
          {rows.map((row, index) => {
            // Sorszám nélkül a rendszer számoz (01, 02…).
            const number = row.number?.trim() || String(index + 1).padStart(2, '0')
            const rowTitle = row.title.trim()
            const body = row.body?.trim() ?? ''
            // CMS-webcím allowlist-szűrése (src/lib/safe-url.ts): tiltott
            // sémánál a sor hivatkozás NÉLKÜL renderelődik (a cím és a szöveg marad).
            const url = sanitizeCmsUrl(row.url) ?? ''
            const label = row.felirat?.trim() ?? ''
            const hasLink = url.length > 0 && label.length > 0
            const isExternal = /^https?:\/\//i.test(url)
            // A felirat és a nyíl KÜLÖN spanben áll: az aláhúzást a szöveg-span
            // viseli, a nyíl dísztelen marad. Egy elemre rajzolt vonaldíszt a
            // gyermek nem tud visszavonni, ezért ez szerkezeti kérdés, nem CSS-é
            // (lásd styles/blocks/services.css `.kc-services__link`).
            const linkContent = (
              <>
                <span className="kc-services__link-text">{label}</span>
                <span aria-hidden="true" className="kc-services__link-arrow">
                  →
                </span>
              </>
            )
            return (
              <li className="kc-services__row" key={row.id ?? `sor-${index}`}>
                <p aria-hidden="true" className="kc-services__num">
                  {number}
                </p>
                <div className="kc-services__body">
                  <h3 className="kc-services__row-title">{rowTitle}</h3>
                  {body.length > 0 ? <p className="kc-services__text">{body}</p> : null}
                  {hasLink ? (
                    isExternal ? (
                      <a
                        aria-label={`${rowTitle}: ${label}`}
                        className="kc-services__link"
                        href={url}
                        {...(row.ujAblakban
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {linkContent}
                      </a>
                    ) : (
                      <Link
                        aria-label={`${rowTitle}: ${label}`}
                        className="kc-services__link"
                        href={url}
                        {...(row.ujAblakban
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {linkContent}
                      </Link>
                    )
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </Section>
  )
}

/**
 * REV B kézikonok a C sín inaktív köreiben: ököl / nyíló / nyitott tenyér.
 * A kitöltött aktív kör fehér északkeleti nyilat visz (a C drót).
 */
function RailHandIcon({ index }: { index: number }) {
  if (index % 3 === 0) return <ClosedHandIcon />
  if (index % 3 === 1) return <OpeningHandIcon />
  return <OpenHandIcon />
}

function railIconProps() {
  return {
    'aria-hidden': true as const,
    fill: 'none',
    focusable: false as const,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.75,
    viewBox: '0 0 24 24',
  }
}

function ClosedHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--closed">
      <path d="M9 12V8.4c0-.7.6-1.2 1.2-1.2S11.4 7.7 11.4 8.4V12" />
      <path d="M11.4 12V7.2c0-.8.6-1.4 1.3-1.4s1.3.6 1.3 1.4V12" />
      <path d="M14 12V8.6c0-.7.5-1.2 1.2-1.2s1.2.5 1.2 1.2V12" />
      <path d="M8.6 12h8v3.6c0 2-1.6 3.6-3.6 3.6h-.8c-2 0-3.6-1.6-3.6-3.6V12z" />
      <path d="M8.6 13.6H6.8A1.5 1.5 0 0 1 6.8 10.6h1.8" />
    </svg>
  )
}

function OpeningHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--opening">
      <path d="M8.2 13.2V7.4c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v5.8" />
      <path d="M10.4 13.2V6c0-.7.5-1.2 1.2-1.2s1.2.5 1.2 1.2v7.2" />
      <path d="M12.8 13.2V6.6c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.6" />
      <path d="M15 13.2V8c0-.5.5-1 1.1-1s1.1.5 1.1 1v5.2" />
      <path d="M8.2 13.2h8v3.1c0 1.8-1.5 3.3-3.3 3.3h-1.4c-1.8 0-3.3-1.5-3.3-3.3v-3.1z" />
      <path d="M8.2 14.6H6.4A1.4 1.4 0 0 1 6.4 11.8h1.8" />
    </svg>
  )
}

function OpenHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--open">
      <path d="M7.5 13.4V5.6c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v7.8" />
      <path d="M9.7 13.4V4.4c0-.7.5-1.2 1.2-1.2s1.2.5 1.2 1.2v9" />
      <path d="M12.1 13.4V5.2c0-.6.5-1.1 1.2-1.1s1.1.5 1.1 1.1v8.2" />
      <path d="M14.4 13.4V6.2c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v7.2" />
      <path d="M7.5 13.4h8v3.3c0 1.9-1.5 3.4-3.4 3.4h-1.2c-1.9 0-3.4-1.5-3.4-3.4v-3.3z" />
      <path d="M7.5 15H5.6A1.6 1.6 0 0 1 5.6 11.8L7.5 12.4" />
    </svg>
  )
}

function RailActiveArrow() {
  return (
    <svg {...railIconProps()}>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  )
}

function CtaArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-services-sin__cta-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}
