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
 * a nyitott sor alatt a panel. A kéz-ikon (zárt / nyíló / nyitott, Phosphor
 * Icons, MIT) MINDEN állapotban a tétel jele: inaktívan chrome a fehér körön,
 * aktívan fehér a sötét körön.
 * A /szolgaltatasok „Szolgáltatásaink" blokkja is ezt a sínt kapja (WP25), a
 * lap saját soraival: a döntést a `presentSzolgaltatasokLayout` hozza.
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

/**
 * A tábla-fotó inline változói (WP30, 2026-09-07, tulajdonosi kör: „az ezért
 * fogod imádni bal oldala kicsit üres nekem, lehetne kicsit olyan mint a
 * megérdemled a törődést").
 *  - `--kc-services-image-ratio`: a feldolgozott kép aránya (a lusta kép helye
 *    betöltés előtt is áll; a háromutas tábla `max-width`-je erre épül).
 *  - `--kc-services-image-focus`: a Media `focalX`/`focalY` mezője százalékban.
 *    A kétsoros tábla fotója asztalon a hasáb teljes szélességét tölti ki
 *    (`object-fit: cover`), tehát álló forrásból vág; a vágás középpontját a
 *    szerkesztő a CMS fókuszpontjával állítja, nem a kód találgatja. Payload
 *    upload focal point: https://payloadcms.com/docs/upload/overview#crop-and-focal-point-selector
 *    Alapérték 50% 50% (a séma alapértéke is ez).
 */
function tablaMediaStyle(media: Media, imageRatio: number | undefined): CSSProperties {
  const clamp = (value: number) => Math.min(100, Math.max(0, value))
  const focalX = typeof media.focalX === 'number' ? media.focalX : 50
  const focalY = typeof media.focalY === 'number' ? media.focalY : 50
  const hasRatio = imageRatio !== undefined && Number.isFinite(imageRatio)
  return {
    ...(hasRatio ? { '--kc-services-image-ratio': imageRatio } : {}),
    '--kc-services-image-focus': `${clamp(focalX)}% ${clamp(focalY)}%`,
  } as CSSProperties
}

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
  // A séma `lead` mezője a táblán is a cím alatti bekezdés (WP30): a sín már
  // mutatta, a tábla eddig eldobta. CMS-tartalom nem változik: ahol üres, ott
  // nem renderel semmit.
  const intro = block.lead?.trim() ?? ''
  const media = populatedMedia(block.image)
  const dimensions = media ? mediaDimensions(media, 'lg') : null
  const imageRatio =
    dimensions && dimensions.width > 0 && dimensions.height > 0
      ? dimensions.width / dimensions.height
      : undefined
  const hasThreeChoices = rows.length === 3
  const mediaStyle = media ? tablaMediaStyle(media, imageRatio) : undefined
  // Hullámos tábla (WP30): a KÉTSOROS, fotós tábla bal hasábja a Rólunk-blokk
  // képnyelvét kapja (services.css „WP30"). A háromutas tábla (`--choices`)
  // saját rácsot visz, azt nem érinti.
  const isWave = media !== null && !hasThreeChoices

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className={`kc-services kc-board kc-board--edge${hasThreeChoices ? ' kc-services--choices' : ''}${media ? ' kc-services--photo' : ''}${isWave ? ' kc-services--hullam' : ''}`}
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner kc-services__grid">
        {eyebrow.length > 0 || title.length > 0 || intro.length > 0 || media ? (
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
            {intro.length > 0 ? <p className="kc-services__intro">{intro}</p> : null}
            {media ? (
              <span className="kc-services__media" style={mediaStyle}>
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
 * A sín kézikonjai: ököl (zárt) / markoló (félig nyitott) / tenyér (nyitott).
 *
 * FORRÁS (WP25, tulajdonosi kör 2026-09-07: „ezek az ikonok nem jók, csúnyák:
 * keress online kéz-ikonokat, hasonló stílusban: nyitott, zárt és félig
 * nyitott"): Phosphor Icons, `@phosphor-icons/core` 2.1.1, REGULAR súly,
 * `hand-fist`, `hand-grabbing`, `hand-palm`. Licenc: MIT
 * (https://github.com/phosphor-icons/core/blob/main/LICENSE). Katalógus:
 * https://phosphoricons.com. A path-ok betűhíven az npm-csomag
 * `assets/regular/*.svg` fájljaiból jönnek (256×256 viewBox, `currentColor`
 * kitöltés); a repó nem húz be ikoncsomag-függőséget. Részletes forrásjegyzék:
 * a WP25 beszámoló `ikon-forras.md` melléklete.
 *
 * MIÉRT EZ A HÁROM: egy készlet, egy súly, azonos optikai ráccsal — a
 * három állapot (zárt → félig nyitott → nyitott) így egy sorozatként olvasható,
 * nem három különböző rajzként. Material 3 Icons: a rendszerikonok egy
 * családból, azonos vonalvastagsággal jöjjenek
 * (https://m3.material.io/styles/icons/designing-icons). Apple HIG Icons: a
 * custom ikonok stílusa legyen egységes, a vonalvastagság a mérethez arányos
 * (https://developer.apple.com/design/human-interface-guidelines/icons).
 *
 * MÉRET: a glifa a kör 50%-a marad (asztal 40/80 px, mobil 28/56 px). A
 * regular súly vonala 16/256 = a doboz 6,25%-a → 40 px-en 2,5 px, 28 px-en
 * 1,75 px (a régi kézi rajz 1,85/24 = 7,7% volt; a light súly 12/256 = 4,7%
 * 28 px-en 1,3 px-re vékonyodna, ezért nem az). A kitöltés `currentColor`,
 * így a kör állapotszíne (chrome / ink / fehér) változatlanul öröklődik:
 * inaktív chrome a fehér körön 4,21:1, aktív fehér az inken 14,32:1
 * (WCAG 2.2 SC 1.4.11, küszöb 3:1; gomb-kontraszt.test.ts mátrix).
 *
 * Ugyanaz a glifa látszik inaktívan és aktívan — az állapotváltás csak szín,
 * nem ikoncsere és nem méretugrás (Material 3 icon button: outlined vs
 * filled, azonos méret; https://m3.material.io/components/icon-buttons/overview).
 */
function RailHandIcon({ index }: { index: number }) {
  if (index % 3 === 0) return <ClosedHandIcon />
  if (index % 3 === 1) return <OpeningHandIcon />
  return <OpenHandIcon />
}

/** Phosphor 256-os rács, kitöltött glifa (a vonal a path része, nem stroke). */
function railIconProps() {
  return {
    'aria-hidden': true as const,
    fill: 'currentColor',
    focusable: false as const,
    viewBox: '0 0 256 256',
  }
}

/** Phosphor `hand-fist` (regular) — zárt kéz. */
function ClosedHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--closed">
      <path d="M200,80H184V64a32,32,0,0,0-56-21.13A32,32,0,0,0,72.21,60.42,32,32,0,0,0,24,88v40a104,104,0,0,0,208,0V112A32,32,0,0,0,200,80ZM152,48a16,16,0,0,1,16,16V80H136V64A16,16,0,0,1,152,48ZM88,64a16,16,0,0,1,32,0v40a16,16,0,0,1-32,0ZM40,88a16,16,0,0,1,32,0v16a16,16,0,0,1-32,0Zm176,40a88,88,0,0,1-175.92,3.75A31.93,31.93,0,0,0,80,125.13a31.93,31.93,0,0,0,44.58,3.35,32.21,32.21,0,0,0,11.8,11.44A47.88,47.88,0,0,0,120,176a8,8,0,0,0,16,0,32,32,0,0,1,32-32,8,8,0,0,0,0-16H152a16,16,0,0,1-16-16V96h64a16,16,0,0,1,16,16Z" />
    </svg>
  )
}

/** Phosphor `hand-grabbing` (regular) — félig nyitott, markoló kéz. */
function OpeningHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--opening">
      <path d="M188,80a27.79,27.79,0,0,0-13.36,3.4,28,28,0,0,0-46.64-11A28,28,0,0,0,80,92v20H68a28,28,0,0,0-28,28v12a88,88,0,0,0,176,0V108A28,28,0,0,0,188,80Zm12,72a72,72,0,0,1-144,0V140a12,12,0,0,1,12-12H80v24a8,8,0,0,0,16,0V92a12,12,0,0,1,24,0v28a8,8,0,0,0,16,0V92a12,12,0,0,1,24,0v28a8,8,0,0,0,16,0V108a12,12,0,0,1,24,0Z" />
    </svg>
  )
}

/** Phosphor `hand-palm` (regular) — nyitott tenyér. */
function OpenHandIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__hand kc-services-sin__hand--open">
      <path d="M188,88a27.75,27.75,0,0,0-12,2.71V60a28,28,0,0,0-41.36-24.6A28,28,0,0,0,80,44v6.71A27.75,27.75,0,0,0,68,48,28,28,0,0,0,40,76v76a88,88,0,0,0,176,0V116A28,28,0,0,0,188,88Zm12,64a72,72,0,0,1-144,0V76a12,12,0,0,1,24,0v44a8,8,0,0,0,16,0V44a12,12,0,0,1,24,0v68a8,8,0,0,0,16,0V60a12,12,0,0,1,24,0v68.67A48.08,48.08,0,0,0,120,176a8,8,0,0,0,16,0,32,32,0,0,1,32-32,8,8,0,0,0,8-8V116a12,12,0,0,1,24,0Z" />
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
