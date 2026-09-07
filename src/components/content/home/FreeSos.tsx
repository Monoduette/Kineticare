import { courseHref } from '../../../lib/course-url'
import { isAvailableSosProduct } from '../../../lib/sos-offer'
import { ctaLabel } from '../../../lib/cta-vocabulary'
import { sanitizeCmsUrl } from '../../../lib/safe-url'
import type { Product } from '../../../payload-types'
import { Button } from '../../ui/Button'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'
import type { MediaLike } from '../media-url'

import '../../../app/(frontend)/styles/blocks/free-sos.css'

/**
 * FreeSos: ingyenes SOS lead-magnet, KOMPAKT SÁVKÉNT (WP26, tulajdonosi
 * kérés 2026-09-07 este, szó szerint: „Lehetne csak egy sáv, benne a szöveg:
 * full width kék sáv, ami most is van, csak kép nélkül, ‚Ingyenes
 * villámkurzus’ nagyon rövid leírással, benne a gomb ugyanúgy, és hogy ez
 * ingyenes.” Minta: a /szolgaltatasok „Kezdd el otthon, a saját tempódban”
 * CtaBanner-sávja: egy sor asztalon (szöveg balra, gomb jobbra), tördelve
 * mobilon.)
 *
 * Miért kompakt és kép nélküli:
 * - A kezdőlap-audit P1-3 tétele (docs/kezdolap-ux-audit-2026-09-07.md) 848
 *   px-es sávot mért, saját fotóval, miközben az ingyenes SOS a Kurzusaink
 *   rácsban már kártyaként áll: a sáv a rácsot ismételte a fizetős ajánlatnál
 *   nagyobb súllyal (UX-skill M4/K2).
 * - NN/g, Photos as Web Content: a felhasználó a dekoratív, „élénkítő” fotót
 *   átugorja, csak az információt hordozó képet nézi meg; a sáv fotója itt
 *   nem hordozott döntési információt (a rács kártyája már bemutatja).
 *   https://www.nngroup.com/articles/photos-as-web-content/
 * - NN/g, Banner Blindness: a színes hátterű, képes, „hirdetés-alakú” tömböt
 *   a felhasználó reklámnak nézi és kihagyja; a tömör, szöveges sáv a
 *   tartalom részeként olvasódik.
 *   https://www.nngroup.com/articles/banner-blindness-old-and-new-findings/
 * - GOV.UK Button: egy oldalon egy elsődleges hívás; a sáv gombja marad
 *   másodlagos (keretes), hogy a fizetős rács maradjon az elsődleges.
 *   https://design-system.service.gov.uk/components/button/
 *
 * A CTA célja és felirata SZÁMÍTOTT (kurzusoldal vagy kurzuslista); a CMS
 * nem írhatja felül a szótárt. A /kurzusok felülírást szándékosan figyelmen
 * kívül hagyjuk (mért CMS-hiba).
 */

/** A kurzuslista útvonala, a hibatűrő tartalék célja. */
export const COURSE_LIST_PATH = '/kurzusok'

/**
 * A kompakt sáv címe, RÖGZÍTETT, nem a CMS-ből jön.
 *
 * A tulajdonos 2026-09-07-i szava: „‚Ingyenes villámkurzus’ nagyon rövid
 * leírással”. A cím egyben az ÁR-TÉNY is (ingyenes), a sáv legnagyobb
 * szövegén, ezért nem kell külön tabletta. A CMS `title` mezője azért nem
 * kerül ide, mert (a) a sáv címét a tulajdonos szó szerint megadta, és (b) az
 * élő CMS-érték („SOS Kézrelax — ingyenes villámkurzus”) kvirtmínuszt
 * tartalmaz, amit a magyar tipográfia nem használ és a §3.1 tilt; a mező
 * tisztogatása helyett a sáv címe konstans, a KURZUS NEVÉT pedig a termék
 * adja a felvezető sorban (`productHeading`). Lásd `FreeSosProps.title`.
 */
export const FREE_SOS_STRIP_TITLE = 'Ingyenes villámkurzus'

/**
 * A gomb felirata, ha a cél VALÓBAN az ingyenes kurzus oldala.
 * Jóváhagyott felirat: `docs/ui-sztenderdek.md` §3.2 #4 („ingyenes kurzus
 * indítása"), kódbeli szótár: `src/lib/cta-vocabulary.ts` (`free-course-claim`).
 *
 * A SZÓTÁRBÓL OLVASVA, nem literálként: így a felirat és a §3.2 sor nem tud
 * elcsúszni egymástól, és a G-UI1/G-UI2 őr a hívóhelyet is látja.
 */
export const FREE_SOS_COURSE_CTA_LABEL = ctaLabel('free-course-claim')

/**
 * A gomb felirata a hibatűrő ágon (nincs ingyenes termék). A listán semmi nem
 * indul el, ezért ígéretet sem tehet: `docs/ui-sztenderdek.md` §3.2 #10
 * („kurzuskínálatra"), kódbeli szótár: `course-list-open`.
 */
export const FREE_SOS_LIST_CTA_LABEL = ctaLabel('course-list-open')

/** A szintaktikailag érvényes cél nem bizonyítja, hogy a kurzus ingyenes. */
function courseDetailPath(href: string): string | null {
  const safeHref = sanitizeCmsUrl(href)
  if (!safeHref?.startsWith('/')) return null
  const path = new URL(safeHref, 'https://kineticare.invalid').pathname.replace(/\/$/, '')
  return /^\/kurzusok\/[^/]+$/.test(path) ? path : null
}

/**
 * Kurzus-ALOLDALra mutat-e az útvonal (`/kurzusok/<slug>` vagy `/kurzusok/<id>`)?
 *
 * A puszta `/kurzusok` (és a szűrt `/kurzusok?kategoria=…`) SZÁNDÉKOSAN nem
 * számít annak: az a lista, ahol az ingyenes kurzus nem indul el.
 */
export function isCourseDetailHref(href: string): boolean {
  return courseDetailPath(href) !== null
}

/** A blokkból érkező, RÉSZLEGES gomb-felülírás (bármelyik mező hiányozhat). */
export interface FreeSosCtaOverride {
  /**
   * A blokk gomb-felirata (CMS).
   *
   * INAKTÍV, SZÁNDÉKOSAN: mindkét ág §3.2 SZÓTÁRI cselekvés, ezért a feliratot
   * a kód adja. A mező azért marad a típusban, mert az adatbázisban lévő
   * értékeket NEM dobjuk el (a `RenderBlocks.partialLinkFrom` továbbra is
   * átadja), és mert a hívóhely így mondja ki, hogy a mezőt ISMERI és
   * SZÁNDÉKOSAN hagyja figyelmen kívül. Lásd „A FELIRAT FORRÁSA" szakaszt.
   */
  label?: string
  href?: string
  newTab?: boolean
}

/** A kirendert gomb, a felirat és a cél mindig egymáshoz illik. */
export interface FreeSosCta {
  label: string
  href: string
  newTab: boolean
}

/**
 * A gomb feloldása: előbb a CÉL, aztán a hozzá illő felirat.
 *
 * Tiszta függvény, hogy az őr-teszt adatbázis és render nélkül is végigmérje
 * mind a négy ágat (`src/__tests__/kezdolap-cta-egyertelmuseg.test.tsx`).
 */
export function resolveFreeSosCta(
  freeProduct: Product | null,
  override?: FreeSosCtaOverride,
): FreeSosCta {
  if (!isAvailableSosProduct(freeProduct)) {
    return { href: COURSE_LIST_PATH, label: FREE_SOS_LIST_CTA_LABEL, newTab: false }
  }

  const overrideHref = sanitizeCmsUrl(override?.href) ?? ''
  const canonicalHref = courseHref(freeProduct)
  // P03: a teljes sáv ingyenes ajánlat, ezért más termékre semleges felirat
  // mellett sem mutathat. Csak az azonos termék query/horgony változata marad.
  // docs/ui-sztenderdek.md §3.2 #4/#10; NN/g: a link ígérete legyen igaz.
  // https://www.nngroup.com/articles/better-link-labels/
  const path = courseDetailPath(overrideHref)
  const matchingOverride =
    path === canonicalHref || path === `${COURSE_LIST_PATH}/${freeProduct.id}`

  return {
    label: FREE_SOS_COURSE_CTA_LABEL,
    href: matchingOverride ? overrideHref : canonicalHref,
    newTab: matchingOverride && override?.newTab === true,
  }
}

export interface FreeSosProps {
  /** A kanonikus, publikált és explicit ingyenes SOS-termék, ha elérhető. */
  freeProduct: Product | null
  /**
   * Cím-felülírás a `freeSos` blokkból.
   *
   * INAKTÍV, SZÁNDÉKOSAN (WP26): a kompakt sáv címe a rögzített
   * `FREE_SOS_STRIP_TITLE`, a tulajdonos szó szerinti kérése szerint. A mező
   * a típusban marad, mert a `RenderBlocks` továbbra is átadja, és az
   * adatbázisban élő szerkesztői értéket nem dobjuk el, csak nem jelenítjük
   * meg. (Indoklás a konstansnál.)
   */
  title?: string
  /** Szöveg-felülírás a blokkból: egy–két mondat a leírás helyén. */
  body?: string
  /**
   * Gomb-felülírás a blokkból. Bármelyik mező hiányozhat: a hiányzókat a
   * `resolveFreeSosCta` tölti ki úgy, hogy a felirat és a cél összeérjen.
   */
  cta?: FreeSosCtaOverride
  /**
   * CMS-fotó a blokkból.
   *
   * INAKTÍV, SZÁNDÉKOSAN (WP26): a sáv KÉP NÉLKÜLI („csak kép nélkül”,
   * tulajdonos, 2026-09-07). A mező a típusban marad, hogy a `RenderBlocks`
   * hívóhelye és a CMS-séma ne változzon, és a feltöltött kép ne vesszen el;
   * a komponens nem tölti le és nem rendereli (nincs `<img>`, nincs
   * képletöltés a kezdőlapon ebből a sávból).
   */
  backgroundImage?: MediaLike | null
  id?: string
  variant?: 'default' | 'tint' | 'dark'
}

export function FreeSos({ freeProduct, body, cta, id = 'ingyenes', variant = 'tint' }: FreeSosProps) {
  const knownFree = isAvailableSosProduct(freeProduct)
  // A termék neve a displayTitle → sku lánc; ha MINDKETTŐ üres, a felvezető
  // sor elmarad (a courseTitle „Kurzus #id" fallbackja itt félrevinne).
  // A kurzus neve a rács kártyájával és a hero szövegével AZONOS forrásból jön
  // (WCAG 2.2 SC 3.2.4 Consistent Identification: ugyanaz a kurzus ugyanazon
  // a néven, https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
  const productHeading = knownFree
    ? freeProduct.displayTitle?.trim() || freeProduct.sku?.trim() || ''
    : ''
  // Termék nélkül a CMS-ben maradt SOS-szöveg is elavult ígéret lehet.
  // Csak a megjelenítés vált semlegesre; a szerkesztett adatot nem módosítjuk.
  const heading = knownFree ? FREE_SOS_STRIP_TITLE : 'Kurzusaink'
  const text = knownFree
    ? body?.trim() ||
      freeProduct.shortDescription?.trim() ||
      'Rövid kézgyakorlatokat mutatunk, amelyeket otthon, a saját tempódban próbálhatsz ki.'
    : 'Ismerd meg a kurzusainkat, és válaszd ki a neked megfelelőt.'
  const button = resolveFreeSosCta(freeProduct, cta)
  const headingId = `${id}-cim`

  return (
    <Section aria-labelledby={headingId} className="kc-free-sos" id={id} variant={variant}>
      <Container className="kc-free-sos__layout">
        <div className="kc-free-sos__copy">
          {productHeading ? <p className="kc-free-sos__kicker">{productHeading}</p> : null}
          <h2 className="kc-free-sos__title" id={headingId}>
            {heading}
          </h2>
          <p className="kc-free-sos__text">{text}</p>
        </div>
        <div className="kc-free-sos__action">
          <Button
            className="kc-free-sos__cta"
            href={button.href}
            openInNewTab={button.newTab}
            variant="secondary"
          >
            {button.label} <span aria-hidden="true">→</span>
          </Button>
        </div>
      </Container>
    </Section>
  )
}
