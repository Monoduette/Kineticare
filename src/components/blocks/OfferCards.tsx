import type { ReactNode } from 'react'

import type { BlockOfferCards } from '../../payload-types'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import { ExternalLinkIcon } from '../layout/NavAnchor'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/offer-cards.css'

/**
 * Ajánlat-kártyák (offerCards) — 1–4 egyenrangú ajánlat egy rácsban, kártyánként
 * egy cselekvéssel (modul-térkép H11). A /szakembereknek lap (WP49) kártyáinak
 * szerkezete és akadálymentessége, CMS-ből: a lap kódtartaléka is ezzel a
 * komponenssel renderel (`szakembereknekAlapBlokk`, src/lib/szakembereknek.ts).
 *
 * MINTA: kártyás választó (két-négy út, egy-egy cselekvéssel).
 * - NN/g, Cards: UI Design Patterns: a kártyák EGYFORMA szerkezetűek, hogy
 *   pásztázhatók legyenek (https://www.nngroup.com/articles/cards-component/).
 * - Material 3, Cards: a kártya egy témát tartalmaz, a cselekvés a kártya
 *   alján áll (https://m3.material.io/components/cards/guidelines).
 * - GOV.UK, Button: egy lapon egy elsődleges gomb, a többi másodlagos
 *   (https://design-system.service.gov.uk/components/button/). A súlyt a
 *   szerkesztő a „Gomb súlya” mezőben adja; az alap a keretes.
 *
 * CÍMSORSZINT (WCAG 2.2 SC 1.3.1, Info and Relationships). Ha a blokknak van
 * címe, az H2, a kártyák címe H3; ha nincs, a kártyák címe H2 (a /szakembereknek
 * lapon a lap H1-e alatt, ahogy a WP49 lap). W3C WAI Headings tutorial:
 * „Skipping heading ranks can be confusing and should be avoided where
 * possible” (https://www.w3.org/WAI/tutorials/page-structure/headings/);
 * GOV.UK, Headings: a címsorok a lap szerkezetét követik, szint kihagyása
 * nélkül (https://design-system.service.gov.uk/styles/headings/).
 *
 * JEGYZET A GOMB ALATT. Kitöltött jegyzet: az áll ott (a „hova jutok” válasz,
 * SC 2.4.4). Üres jegyzet és új lapon nyíló gomb: a figyelmeztetés magától
 * („Külső oldal, új lapon nyílik.”, belső címnél „Új lapon nyílik.”, hogy a
 * mondat igaz legyen), ikonnal és az `aria-describedby`-on át a gombhoz kötve.
 * WCAG 2.2 SC 3.2.5 (Change on Request) és a G201 technika: „provide advanced
 * warning for links and buttons that open a new window or tab”
 * (https://www.w3.org/WAI/WCAG22/Techniques/general/G201); NN/g, Opening
 * Links in New Browser Windows and Tabs: ha új lapon nyílik, szólj előre
 * (https://www.nngroup.com/articles/new-browser-windows-and-tabs/). Minden más
 * esetben nincs jegyzet.
 *
 * A gomb célja a biztonságos CMS-URL segéden megy át (src/lib/safe-url.ts
 * `sanitizeCmsUrl`, ahogy az Appointment.tsx): tiltott vagy üres címnél és üres
 * feliratnál a kártya gomb nélkül jelenik meg (a séma súgója ezt ígéri).
 *
 * AZONOSÍTÓK. Minden id az `idElotag`-ból és a kártya sorszámából épül; a
 * RenderBlocks a blokk azonosítóját adja, így két blokk egy lapon sem ütközik.
 */

/** A kártya-ikonok forrásának közös tulajdonságai (Phosphor 256-os rács, kitöltött glifa). */
function ikonProps() {
  return {
    'aria-hidden': true as const,
    className: 'kc-ajanlat-kartyak__glifa',
    fill: 'currentColor',
    focusable: false as const,
    viewBox: '0 0 256 256',
  }
}

/**
 * Phosphor `chalkboard-teacher` (regular), MIT
 * (https://github.com/phosphor-icons/core/blob/main/LICENSE): a képzés jele.
 * A path betűhíven a `@phosphor-icons/core` 2.1.1 `assets/regular/` fájljából;
 * a repó nem húz be ikoncsomag-függőséget (a Services-sín ugyanígy).
 */
function KepzesIkon() {
  return (
    <svg {...ikonProps()}>
      <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H53.39a8,8,0,0,0,7.23-4.57,48,48,0,0,1,86.76,0,8,8,0,0,0,7.23,4.57H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM80,144a24,24,0,1,1,24,24A24,24,0,0,1,80,144Zm136,56H159.43a64.39,64.39,0,0,0-28.83-26.16,40,40,0,1,0-53.2,0A64.39,64.39,0,0,0,48.57,200H40V56H216ZM56,96V80a8,8,0,0,1,8-8H192a8,8,0,0,1,8,8v96a8,8,0,0,1-8,8H176a8,8,0,0,1,0-16h8V88H72v8a8,8,0,0,1-16,0Z" />
    </svg>
  )
}

/** Phosphor `book-open` (regular), MIT: a szakkönyv jele (forrás: fent). */
function SzakkonyvIkon() {
  return (
    <svg {...ikonProps()}>
      <path d="M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z" />
    </svg>
  )
}

type Kartya = NonNullable<BlockOfferCards['kartyak']>[number]

/** A beépített új-lap figyelmeztetés külső címre (WCAG 2.2 SC 3.2.5). */
export const KULSO_UJ_LAP_JEGYZET = 'Külső oldal, új lapon nyílik.'

/** A beépített új-lap figyelmeztetés belső címre: igaz marad, ha nem külső a cél. */
export const BELSO_UJ_LAP_JEGYZET = 'Új lapon nyílik.'

/** Az ikon a választó értéke szerint; „nincs” vagy ismeretlen érték: nincs ikon. */
function kartyaIkon(ikon: Kartya['ikon']): ReactNode {
  if (ikon === 'kepzes') return <KepzesIkon />
  if (ikon === 'szakkonyv') return <SzakkonyvIkon />
  return null
}

/** Az id-előtag HTML-id-barát alakja (betű, szám, kötőjel, aláhúzás). */
function tisztaElotag(elotag: string): string {
  const tiszta = elotag.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return tiszta.length > 0 ? tiszta : 'ajanlat-kartyak'
}

interface KartyaGomb {
  felirat: string
  href: string
  ujLap: boolean
  kulso: boolean
}

/** A kártya gombja, ha a felirat és a biztonságos cél is megvan. */
function kartyaGomb(kartya: Kartya): KartyaGomb | null {
  const felirat = kartya.felirat?.trim() ?? ''
  const href = sanitizeCmsUrl(kartya.url?.trim() ?? '')
  if (felirat.length === 0 || href === null) {
    return null
  }
  return {
    felirat,
    href,
    ujLap: kartya.ujAblakban === true,
    kulso: /^https?:\/\//i.test(href),
  }
}

/** A gomb alatti jegyzet tartalma a fejkomment szabálya szerint, vagy null. */
function jegyzetTartalma(kartya: Kartya, gomb: KartyaGomb): ReactNode {
  const jegyzet = kartya.jegyzet?.trim() ?? ''
  if (jegyzet.length > 0) {
    return jegyzet
  }
  if (gomb.ujLap) {
    return (
      <>
        <ExternalLinkIcon />
        {gomb.kulso ? KULSO_UJ_LAP_JEGYZET : BELSO_UJ_LAP_JEGYZET}
      </>
    )
  }
  return null
}

function AjanlatKartya({
  kartya,
  cimSzint,
  jegyzetId,
}: {
  kartya: Kartya
  cimSzint: 'h2' | 'h3'
  jegyzetId: string
}) {
  const Cim = cimSzint
  const ikon = kartyaIkon(kartya.ikon)
  const kicker = kartya.kicker?.trim() ?? ''
  const szoveg = kartya.szoveg?.trim() ?? ''
  const tenyek = (kartya.tenyek ?? [])
    .map((teny) => teny.szoveg?.trim() ?? '')
    .filter((teny) => teny.length > 0)
  const allapot = kartya.hamarosan === true ? (kartya.allapotSzoveg?.trim() ?? '') : ''
  const gomb = kartyaGomb(kartya)
  const jegyzet = gomb ? jegyzetTartalma(kartya, gomb) : null

  return (
    <li className="kc-ajanlat-kartyak__cell">
      <Card as="article" className="kc-ajanlat-kartyak__card" padded={false}>
        <div className="kc-ajanlat-kartyak__body">
          {ikon ? (
            <span aria-hidden="true" className="kc-ajanlat-kartyak__ikon">
              {ikon}
            </span>
          ) : null}
          {kicker.length > 0 ? <p className="kc-ajanlat-kartyak__kicker">{kicker}</p> : null}
          <Cim className="kc-ajanlat-kartyak__cim">{kartya.cim.trim()}</Cim>
          {szoveg.length > 0 ? <p className="kc-ajanlat-kartyak__szoveg">{szoveg}</p> : null}
          {tenyek.length > 0 ? (
            <ul className="kc-ajanlat-kartyak__tenyek">
              {tenyek.map((teny, index) => (
                <li key={`${index}-${teny}`}>{teny}</li>
              ))}
            </ul>
          ) : null}
          {allapot.length > 0 ? <p className="kc-ajanlat-kartyak__allapot">{allapot}</p> : null}
        </div>
        {gomb ? (
          <div className="kc-ajanlat-kartyak__lab">
            <Button
              className="kc-ajanlat-kartyak__gomb"
              {...(jegyzet === null ? {} : { describedBy: jegyzetId })}
              href={gomb.href}
              openInNewTab={gomb.ujLap}
              variant={kartya.gombSuly === 'elsodleges' ? 'primary' : 'secondary'}
            >
              {gomb.felirat}
            </Button>
            {jegyzet === null ? null : (
              <p className="kc-ajanlat-kartyak__jegyzet" id={jegyzetId}>
                {jegyzet}
              </p>
            )}
          </div>
        ) : null}
      </Card>
    </li>
  )
}

export interface OfferCardsProps {
  block: BlockOfferCards
  /** Horgony (`sectionSettings.anchorId`), a RenderBlocks `sectionProps`-ából. */
  id?: string
  /** Háttér-változat, a RenderBlocks `sectionProps`-ából. */
  variant?: 'default' | 'tint' | 'dark'
  /**
   * Az id-k előtagja. A RenderBlocks a blokk kulcsát adja (a blokk
   * azonosítója); elhagyva a blokk `id`-je, annak híján `ajanlat-kartyak`.
   */
  idElotag?: string
  /**
   * Beágyazva: a blokk-fej és a rács Section és Container NÉLKÜL, egy lap
   * saját szekciójában (a /szakembereknek kódtartaléka a lapfej alatt, a WP49
   * lap egyetlen szekciójával azonos szerkezetben).
   */
  beagyazott?: boolean
}

export function OfferCards({ block, id, variant, idElotag, beagyazott = false }: OfferCardsProps) {
  const kartyak = (block.kartyak ?? []).filter((kartya) => (kartya.cim?.trim() ?? '').length > 0)
  if (kartyak.length === 0) {
    return null
  }
  const elotag = tisztaElotag(idElotag ?? block.id ?? 'ajanlat-kartyak')
  const eyebrow = block.eyebrow?.trim() ?? ''
  const title = block.title?.trim() ?? ''
  const lead = block.lead?.trim() ?? ''
  const cimId = `${elotag}-cim`
  const cimSzint = title.length > 0 ? 'h3' : 'h2'

  const tartalom = (
    <>
      {eyebrow.length > 0 || title.length > 0 || lead.length > 0 ? (
        <header className="kc-ajanlat-kartyak__fej">
          {eyebrow.length > 0 ? <p className="kc-eyebrow">{eyebrow}</p> : null}
          {title.length > 0 ? (
            <h2 className="kc-section-title" id={cimId}>
              {title}
            </h2>
          ) : null}
          {lead.length > 0 ? (
            <p className="kc-section-lead kc-ajanlat-kartyak__lead">{lead}</p>
          ) : null}
        </header>
      ) : null}
      <ul className="kc-ajanlat-kartyak__grid">
        {kartyak.map((kartya, index) => (
          <AjanlatKartya
            key={kartya.id ?? `kartya-${index}`}
            cimSzint={cimSzint}
            jegyzetId={`${elotag}-${index + 1}-jegyzet`}
            kartya={kartya}
          />
        ))}
      </ul>
    </>
  )

  if (beagyazott) {
    return tartalom
  }
  return (
    <Section
      {...(title.length > 0 ? { 'aria-labelledby': cimId } : {})}
      className="kc-ajanlat-kartyak"
      id={id}
      variant={variant}
    >
      <Container>{tartalom}</Container>
    </Section>
  )
}
