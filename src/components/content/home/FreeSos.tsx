import { courseHref } from '../../../lib/course-url'
import { isAvailableSosProduct } from '../../../lib/sos-offer'
import { ctaLabel } from '../../../lib/cta-vocabulary'
import { sanitizeCmsUrl } from '../../../lib/safe-url'
import type { Product } from '../../../payload-types'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'
import { MediaImage } from '../MediaImage'
import { pickMediaUrl, type MediaLike } from '../media-url'

import '../../../app/(frontend)/styles/blocks/free-sos.css'

/**
 * FreeSos — ingyenes SOS lead-magnet, visszafogott súllyal (M4/K2).
 * CTA cél/felirat számított: kurzusoldal vagy kurzuslista; CMS nem írhatja felül a szótárt.
 * A /kurzusok felülírást szándékosan figyelmen kívül hagyjuk (mért CMS-hiba).
 */

/** A kurzuslista útvonala — a hibatűrő tartalék célja. */
export const COURSE_LIST_PATH = '/kurzusok'

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

/** A kirendert gomb — a felirat és a cél mindig egymáshoz illik. */
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
  /** Cím-felülírás a `freeSos` blokkból — üresen a termék/beépített cím marad. */
  title?: string
  /** Szöveg-felülírás a blokkból. */
  body?: string
  /**
   * Gomb-felülírás a blokkból. Bármelyik mező hiányozhat: a hiányzókat a
   * `resolveFreeSosCta` tölti ki úgy, hogy a felirat és a cél összeérjen.
   */
  cta?: FreeSosCtaOverride
  /**
   * Informatív CMS-fotó: saját alt-szöveggel, mobilon is láthatóan.
   * A mező neve kompatibilitásból marad; új CMS-séma nem szükséges.
   */
  backgroundImage?: MediaLike | null
  id?: string
  variant?: 'default' | 'tint' | 'dark'
}

export function FreeSos({
  freeProduct,
  title,
  body,
  cta,
  backgroundImage,
  id = 'ingyenes',
  variant = 'tint',
}: FreeSosProps) {
  const knownFree = isAvailableSosProduct(freeProduct)
  // A termék neve a displayTitle → sku lánc; ha MINDKETTŐ üres, a márkás
  // alapszöveg marad (a courseTitle „Kurzus #id" fallbackja itt félrevinne).
  const productHeading = freeProduct?.displayTitle?.trim() || freeProduct?.sku?.trim() || ''
  // Kettőspont, nem gondolatjel: a magyar tipográfiában a kvirtmínusz nem
  // írásjel, és a tulajdonos külön kikötötte a gondolatjel-halmozás tilalmát
  // (docs/ui-sztenderdek.md §3.1, docs/gomb-inventar.md §7).
  // Termék nélkül a CMS-ben maradt SOS-szöveg is elavult ígéret lehet.
  // Csak a megjelenítés vált semlegesre; a szerkesztett adatot nem módosítjuk.
  const heading = knownFree
    ? title?.trim() || productHeading || 'SOS Kézrelax: ingyenes villámkurzus'
    : 'Kurzusaink'
  const text = knownFree
    ? body?.trim() ||
      freeProduct.shortDescription?.trim() ||
      'Rövid kézgyakorlatokat mutatunk, amelyeket otthon, a saját tempódban próbálhatsz ki.'
    : 'Ismerd meg a kurzusainkat, és válaszd ki a neked megfelelőt.'
  const button = resolveFreeSosCta(freeProduct, cta)
  const photo = backgroundImage && pickMediaUrl(backgroundImage, 'md') ? backgroundImage : null

  return (
    <Section
      className={`kc-free-sos${photo ? ' kc-free-sos--with-image' : ''}`}
      id={id}
      variant={variant}
    >
      <Container className="kc-free-sos__layout">
        <div className="kc-free-sos__inner">
          {knownFree ? (
            <p className="kc-free-sos__badge">
              <Badge tone="success">Ingyenes</Badge>
            </p>
          ) : null}
          <h2 className="kc-free-sos__title">{heading}</h2>
          <p className="kc-free-sos__text">{text}</p>
          <Button
            className="kc-free-sos__cta"
            href={button.href}
            openInNewTab={button.newTab}
            variant="secondary"
          >
            {button.label} <span aria-hidden="true">→</span>
          </Button>
        </div>
        {photo ? (
          <div className="kc-free-sos__art">
            {/* H04: a valódi szereplők képe információ, nem rejtett dekoráció.
                https://www.w3.org/WAI/tutorials/images/informative/
                https://www.nngroup.com/articles/photos-as-web-content/ */}
            <MediaImage media={photo} preferredSize="md" sizes="(min-width: 900px) 44vw, 100vw" />
          </div>
        ) : null}
      </Container>
    </Section>
  )
}
