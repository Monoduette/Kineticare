import type { Metadata } from 'next'

import { JsonLd } from '@/components/content/JsonLd'
import { ExternalLinkIcon } from '@/components/layout/NavAnchor'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ctaLabel } from '@/lib/cta-vocabulary'
import { buildStaticPageMetadata } from '@/lib/seo'
import { siteGraphJsonLd } from '@/lib/seo-graph'
import {
  resolveKepzesCta,
  resolveSzakkonyvCta,
  SZAKEMBEREKNEK_DESCRIPTION,
  SZAKEMBEREKNEK_PATH,
  SZAKEMBEREKNEK_TITLE,
  SZAKKONYV_URL,
} from '@/lib/szakembereknek'

/**
 * /szakembereknek — a szakmai választó oldal (WP49, tulajdonosi kérés 2026-09).
 *
 * MIÉRT VAN. A fejléc „Szakembereknek" menüpontja eddig („Szakmai képzés")
 * egyből a ProBody külső oldalára vitt: a látogató a menüből kilépett a
 * Kineticare-ből, és a második szakmai ajánlatról (szakkönyv) nem is tudott.
 * Itt két EGYENRANGÚ kártya közül választ: képzés vagy szakkönyv.
 *
 * MINTA: kártyás választó (két út, egy-egy cselekvéssel).
 * - NN/g, Cards: Ul Design Patterns: „a card should be an entry point to
 *   more detailed information", a kártyák EGYFORMA szerkezetűek, hogy
 *   pásztázhatók legyenek (https://www.nngroup.com/articles/cards-component/).
 * - Material 3, Cards: a kártya egy témát tartalmaz, a cselekvések a kártya
 *   alján, egyértelmű hierarchiával (https://m3.material.io/components/cards/guidelines).
 * - GOV.UK, Button: egy lapon egy elsődleges gomb; a többi másodlagos
 *   (https://design-system.service.gov.uk/components/button/). Ezért a képzés
 *   gombja `primary` (§3.2 #41), a szakkönyvé `secondary` (§3.2 #42/#43).
 * - Apple HIG, Layout: az érintőcélok legalább 44×44 pt
 *   (https://developer.apple.com/design/human-interface-guidelines/layout) és
 *   WCAG 2.2 SC 2.5.8: a `.kc-button` min-height 2.75rem (44 px).
 * - WCAG 2.2 SC 3.2.5 (Change on Request): az új lapon nyíló külső link
 *   előre jelzi ezt (ikon + „Külső oldal, új lapon nyílik" jegyzet, amelyet
 *   az `aria-describedby` a gombhoz köt);
 *   https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html
 *
 * A SZAKKÖNYV VÁSÁRLÁSI CÍMÉT A TULAJDONOSOK MÉG NEM ADTÁK MEG (`SZAKKONYV_URL`
 * = null): addig a kártya a /kapcsolat oldalra visz érdeklődő felirattal.
 * Kitalált URL tilos.
 *
 * Mikroszöveg: natív magyar, tegező, töltelék gondolatjel nélkül (docs/
 * ui-sztenderdek.md §3.1). A képzés adatai a tulajdonosok korábbi, jóváhagyott
 * szövegéből (restore-legacy-content.ts, „Szakmai képzések").
 */

export const metadata: Metadata = buildStaticPageMetadata({
  title: SZAKEMBEREKNEK_TITLE,
  description: SZAKEMBEREKNEK_DESCRIPTION,
  path: SZAKEMBEREKNEK_PATH,
})

const CIM_ID = 'szakembereknek-cim'
const KEPZES_JEGYZET_ID = 'szakembereknek-kepzes-jegyzet'
const SZAKKONYV_JEGYZET_ID = 'szakembereknek-szakkonyv-jegyzet'

/** Phosphor 256-os rács, kitöltött glifa (a Services-sín kézikonjainak mintája). */
function ikonProps() {
  return {
    'aria-hidden': true as const,
    className: 'kc-szakemberek__glifa',
    fill: 'currentColor',
    focusable: false as const,
    viewBox: '0 0 256 256',
  }
}

/**
 * Phosphor `chalkboard-teacher` (regular), MIT
 * (https://github.com/phosphor-icons/core/blob/main/LICENSE) — a képzés jele.
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

/** Phosphor `book-open` (regular), MIT — a szakkönyv jele (forrás: fent). */
function SzakkonyvIkon() {
  return (
    <svg {...ikonProps()}>
      <path d="M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z" />
    </svg>
  )
}

export default function SzakembereknekPage() {
  const kepzes = resolveKepzesCta()
  const szakkonyv = resolveSzakkonyvCta()

  return (
    <Section aria-labelledby={CIM_ID} className="kc-szakemberek">
      {/* Oldal-gráf: Organization + WebSite + WebPage + BreadcrumbList
          (Kezdőlap → Szakembereknek), a /kurzusok mintájára. */}
      <JsonLd
        data={siteGraphJsonLd({
          page: {
            path: SZAKEMBEREKNEK_PATH,
            name: SZAKEMBEREKNEK_TITLE,
            description: SZAKEMBEREKNEK_DESCRIPTION,
          },
          breadcrumbs: [
            { name: 'Kezdőlap', path: '/' },
            { name: SZAKEMBEREKNEK_TITLE, path: SZAKEMBEREKNEK_PATH },
          ],
        })}
      />
      <Container>
        <header className="kc-szakemberek__head">
          <p className="kc-eyebrow">Gyógytornászoknak és terapeutáknak</p>
          <h1 className="kc-section-title" id={CIM_ID}>
            {SZAKEMBEREKNEK_TITLE}
          </h1>
          <p className="kc-section-lead kc-szakemberek__lead">
            Ha gyógytornászként vagy terapeutaként dolgozol a kézzel, két úton mélyítheted a tudásod
            nálunk. Válaszd a képzést, ha gyakorlatban tanulnál, vagy a szakkönyvet, ha a szakmai
            hátteret a saját tempódban olvasnád át.
          </p>
        </header>

        <ul className="kc-szakemberek__grid">
          <li className="kc-szakemberek__cell">
            <Card as="article" className="kc-szakemberek__card" padded={false}>
              <div className="kc-szakemberek__body">
                <span aria-hidden="true" className="kc-szakemberek__ikon">
                  <KepzesIkon />
                </span>
                <p className="kc-szakemberek__kicker">Képzés</p>
                <h2 className="kc-szakemberek__cim">Akkreditált kézrehabilitációs képzés</h2>
                <p className="kc-szakemberek__szoveg">
                  Tantermi képzés a kéz, a csukló- és a könyökízület rehabilitációjáról,
                  gyógytornászoknak, orvosoknak, mozgásterapeutáknak és edzőknek, a ProBody
                  Stúdióval együttműködve.
                </p>
                <ul className="kc-szakemberek__tenyek">
                  <li>12 kreditpont (SZTK-A-33553/2024)</li>
                  <li>Az időpontokat és a díjat a ProBody Stúdió oldalán találod</li>
                </ul>
              </div>
              <div className="kc-szakemberek__lab">
                <Button
                  className="kc-szakemberek__gomb"
                  describedBy={KEPZES_JEGYZET_ID}
                  href={kepzes.href}
                  openInNewTab={kepzes.external}
                  variant="primary"
                >
                  {/* A felirat a JSX-ben, közvetlen `ctaLabel` hívással: a G-UI2 őr
                      (cta-a-termekben.test.ts) így statikusan látja, hogy szótári
                      alak; a `resolveKepzesCta().label` ugyanezt adja (őr-teszt). */}
                  {ctaLabel('workshop-open')}
                </Button>
                <p className="kc-szakemberek__jegyzet" id={KEPZES_JEGYZET_ID}>
                  <ExternalLinkIcon />
                  Külső oldal, új lapon nyílik.
                </p>
              </div>
            </Card>
          </li>

          <li className="kc-szakemberek__cell">
            <Card as="article" className="kc-szakemberek__card" padded={false}>
              <div className="kc-szakemberek__body">
                <span aria-hidden="true" className="kc-szakemberek__ikon">
                  <SzakkonyvIkon />
                </span>
                <p className="kc-szakemberek__kicker">Szakkönyv</p>
                <h2 className="kc-szakemberek__cim">A Kineticare szakkönyve</h2>
                <p className="kc-szakemberek__szoveg">
                  A Kineticare gyógytornászainak szakkönyve a kézrehabilitációról, kollégáknak: a
                  szakmai háttér, amit a saját tempódban olvashatsz át.
                </p>
                {SZAKKONYV_URL === null ? (
                  <p className="kc-szakemberek__allapot">
                    A vásárlás lehetőségét hamarosan közzétesszük. Addig kérdezz tőlünk, és szólunk,
                    amint elérhető.
                  </p>
                ) : null}
              </div>
              <div className="kc-szakemberek__lab">
                <Button
                  className="kc-szakemberek__gomb"
                  describedBy={SZAKKONYV_JEGYZET_ID}
                  href={szakkonyv.href}
                  openInNewTab={szakkonyv.external}
                  variant="secondary"
                >
                  {SZAKKONYV_URL === null ? ctaLabel('book-inquiry') : ctaLabel('book-open')}
                </Button>
                {/* A jegyzet MINDIG áll: külső célnál a „új lapon nyílik" figyelmeztetés
                    (SC 3.2.5), belső célnál a „hova jutok" válasz (UX-skill 5. pont,
                    WCAG 2.2 SC 2.4.4). Így a két kártya lába egyforma magas, és a két
                    gomb egy vonalban áll (mérve: enélkül 33 px-es eltolás 768 px felett). */}
                <p className="kc-szakemberek__jegyzet" id={SZAKKONYV_JEGYZET_ID}>
                  {szakkonyv.external ? (
                    <>
                      <ExternalLinkIcon />
                      Külső oldal, új lapon nyílik.
                    </>
                  ) : (
                    'A kapcsolat-oldalunkra visz.'
                  )}
                </p>
              </div>
            </Card>
          </li>
        </ul>
      </Container>
    </Section>
  )
}
