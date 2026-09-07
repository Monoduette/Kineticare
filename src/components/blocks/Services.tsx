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
 * Vizuális króm (WP17, tulajdonosi drótváz 2026-09-07): asztalon függőleges
 * sín 5rem-es körjelölőkkel + kártya-panel; 900 px alatt accordion-sorok,
 * a nyitott sor alatt a panel. A kéz-ikon (zárt / nyíló / nyitott) MINDEN
 * állapotban a tétel jele: inaktívan körvonalas, aktívan fehér a sötét körön.
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
  // A drót a sávot világos hűvös lapon kéri, a panelt tint-kártyán.
  // A CMS fehér érték itt is a tint-osztályt kapja (H08); a CSS a sávot
  // paperre festi, hogy a tint panel elváljon. A sötét sáv szerkesztői kivétel.
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
                        <RailHandIcon index={index} />
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
          <MediaImage media={photo} preferredSize="lg" sizes="(max-width: 899px) 100vw, 30vw" />
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
 * A sín kézikonjai: ököl / nyíló / nyitott tenyér. A tulajdonos kérése
 * (2026-09-07): „azokat az ikonokat használd, ahol láthatóak a kezek", a zárt
 * és a nyitott is kell. Ugyanaz a glifa látszik inaktívan (chrome körvonal a
 * fehér körön) és aktívan (fehér a sötét körön) — az állapotváltás csak szín,
 * nem ikoncsere és nem méretugrás (Material 3 icon button: outlined vs filled,
 * azonos méret; https://m3.material.io/components/icon-buttons/overview).
 * Minden glifa ugyanazt a 24×24 viewBoxot és 1,85-ös vonalvastagságot viseli.
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
    strokeWidth: 1.85,
    viewBox: '0 0 24 24',
  }
}

function ClosedHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--closed">
      <path d="M8.2 12.2h8.2v4.1c0 2.05-1.65 3.7-3.7 3.7h-.8c-2.05 0-3.7-1.65-3.7-3.7v-4.1z" />
      <path d="M9.4 12.2V9.15c0-.5.4-.9.9-.9s.9.4.9.9V12.2" />
      <path d="M11.2 12.2V8.35c0-.55.42-1 .95-1s.95.45.95 1V12.2" />
      <path d="M13.1 12.2V8.7c0-.48.38-.88.88-.88s.88.4.88.88V12.2" />
      <path d="M14.86 12.2V9.35c0-.42.34-.78.78-.78s.78.36.78.78V12.2" />
      <path d="M8.2 13.85H6.35a1.35 1.35 0 0 1 0-2.7H8.2" />
    </svg>
  )
}

function OpeningHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--opening">
      <path d="M8.1 13.6V8.05c0-.52.42-.95.95-.95s.95.43.95.95V13.6" />
      <path d="M10 13.6V6.7c0-.6.48-1.08 1.08-1.08s1.08.48 1.08 1.08V13.6" />
      <path d="M12.16 13.6V7.35c0-.52.46-.96 1.02-.96s1.02.44 1.02.96V13.6" />
      <path d="M14.2 13.6V8.55c0-.48.42-.9.96-.9s.96.42.96.9V13.6" />
      <path d="M8.1 13.6h8.02v3c0 1.72-1.4 3.12-3.12 3.12h-1.78c-1.72 0-3.12-1.4-3.12-3.12v-3z" />
      <path d="M8.1 15.15H6.2a1.4 1.4 0 0 1 0-2.8H8.1" />
    </svg>
  )
}

function OpenHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--open">
      <path d="M7.15 13.85V5.55c0-.58.47-1.05 1.05-1.05s1.05.47 1.05 1.05v8.3" />
      <path d="M9.25 13.85V4.2c0-.68.52-1.22 1.18-1.22s1.18.54 1.18 1.22v9.65" />
      <path d="M11.6 13.85V4.85c0-.6.5-1.1 1.12-1.1s1.12.5 1.12 1.1v9" />
      <path d="M13.84 13.85V6.05c0-.55.47-1.02 1.05-1.02s1.05.47 1.05 1.02v7.8" />
      <path d="M15.94 13.85V7.35c0-.48.4-.9.92-.9s.92.42.92.9v6.5" />
      <path d="M7.15 13.85h10.55v3.15c0 1.82-1.48 3.3-3.3 3.3H10.45c-1.82 0-3.3-1.48-3.3-3.3v-3.15z" />
      <path d="M7.15 15.55H5.2a1.5 1.5 0 1 1 0-3l1.95.55" />
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
