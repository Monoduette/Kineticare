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
 * a nyitott sor alatt a panel. Az ajtó-ikon (rendelő / ház / oklevél, Lucide,
 * ISC; WP51) MINDEN állapotban a tétel jele: inaktívan chrome a fehér körön,
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
                        <RailDoorIcon index={index} />
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
 * A sín ajtó-ikonjai: rendelő (1. út) / ház (2. út) / oklevél (3. út).
 *
 * FORRÁS (WP51, tulajdonosi kör 2026-09-19, a lányok mintaképe: három
 * sötét kártya, mindegyiken vékony vonalas, világoskék ikon és felirat —
 * „rendelő kezelése" = épület kereszttel, „otthoni képzés" = ház körvonal,
 * „szakmai továbbképzés" = oklevél jelvénnyel): Lucide Icons, `hospital`,
 * `house`, `file-badge`. Licenc: ISC
 * (https://github.com/lucide-icons/lucide/blob/main/LICENSE). Katalógus:
 * https://lucide.dev/icons/hospital · https://lucide.dev/icons/house ·
 * https://lucide.dev/icons/file-badge. A path-ok betűhíven a Lucide
 * `icons/*.svg` forrásfájljaiból jönnek (24×24 viewBox, `stroke=
 * "currentColor"`, `stroke-width="2"`, kerek végződés és sarok, `fill=
 * "none"`); a repó nem húz be ikoncsomag-függőséget.
 *
 * MIÉRT EZ A HÁROM, ÉS MIÉRT EGY KÉSZLETBŐL: a három út (rendelő → otthon →
 * képzés) egy sorozatként olvasandó, ezért egy készlet, egy rács, egy
 * vonalvastagság kell (Lucide Icon Design Guide: 24-es rács, 2 px-es vonal,
 * 2 px-es belső margó, kerek vég és sarok, optikailag azonos súly —
 * https://lucide.dev/guide/design/icon-design-guide). Material 3 Icons: a
 * rendszerikonok egy családból, azonos vonalvastagsággal
 * (https://m3.material.io/styles/icons/designing-icons). NN/g Icon
 * Usability: az ikon önmagában ritkán egyértelmű, ezért MINDIG felirattal
 * áll — a sínen a cím és az egysoros összefoglaló a jelentés hordozója, az
 * ikon a gyors felismerést gyorsítja (a ház és a kórház-kereszt a
 * legismertebb univerzális jelek közé tartozik;
 * https://www.nngroup.com/articles/icon-usability/).
 *
 * MÉRET ÉS VONAL: a glifa a kör 50%-a marad (asztal 40/80 px, mobil 28/56
 * px; a körjelölő tokenjei a services-sin.css-ben). A 2/24-es vonal 40 px-en
 * 3,3 px-re, 28 px-en 2,3 px-re nyúlna — a mintakép vékony vonalat kér,
 * ezért a vonalvastagságot a CSS a mérethez igazítja (a Lucide
 * `absoluteStrokeWidth` elve: a vonal a KÉPERNYŐN legyen egyforma, ne a
 * rácson): asztalon 1,5 → 2,5 px, mobilon 2 → 2,3 px (services-sin.css,
 * `.kc-services-sin__marker svg`). A `stroke: currentColor` miatt a kör
 * állapotszíne (chrome / help-ink / fehér) változatlanul öröklődik:
 * inaktív chrome a fehér körön 4,21:1, aktív fehér az inken 14,32:1
 * (WCAG 2.2 SC 1.4.11, küszöb 3:1; gomb-kontraszt.test.ts mátrix).
 *
 * Ugyanaz a glifa látszik inaktívan és aktívan — az állapotváltás csak szín,
 * nem ikoncsere és nem méretugrás (Material 3 icon button: outlined vs
 * filled, azonos méret; https://m3.material.io/components/icon-buttons/overview).
 * A `place-items: center` rács a kört és a glifát középre zárja
 * (services-sin.css), a felirat a kör mellett, a sor közepére igazítva.
 */
function RailDoorIcon({ index }: { index: number }) {
  if (index % 3 === 0) return <ClinicIcon />
  if (index % 3 === 1) return <HomeIcon />
  return <CertificateIcon />
}

/** Lucide 24-es rács: vonalas glifa, a vonal a `stroke`, nem a kitöltés. */
function railIconProps() {
  return {
    'aria-hidden': true as const,
    fill: 'none',
    focusable: false as const,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
    viewBox: '0 0 24 24',
  }
}

/** Lucide `hospital` — rendelő: épület, kereszttel az ajtó fölött. */
function ClinicIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__glyph kc-services-sin__glyph--rendelo">
      <path d="M12 7v4" />
      <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
      <path d="M14 9h-4" />
      <path d="M18 11h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2" />
      <path d="M18 21V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16" />
    </svg>
  )
}

/** Lucide `house` — otthoni program: ház körvonal. */
function HomeIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__glyph kc-services-sin__glyph--otthon">
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/** Lucide `file-badge` — szakmai képzés: oklevél jelvénnyel. */
function CertificateIcon() {
  return (
    <svg {...railIconProps()} className="kc-services-sin__glyph kc-services-sin__glyph--kepzes">
      <path d="M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.3" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m7.69 16.479 1.29 4.88a.5.5 0 0 1-.698.591l-1.843-.849a1 1 0 0 0-.879.001l-1.846.85a.5.5 0 0 1-.692-.593l1.29-4.88" />
      <circle cx="6" cy="14" r="3" />
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
