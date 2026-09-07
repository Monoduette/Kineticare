/**
 * Kurzus-galéria (Astra „Bring ideas” szerkezet) — tiszta, DB nélkül tesztelhető.
 *
 * A két audience-sáv (Otthoni / Szakembereknek) a kártya kickerében marad,
 * nem külön szekciócím. A borító hiányánál a csapatportrék lépnek be, index
 * szerint, hogy a háromhasábos rács ne legyen üres keret.
 */

import type { Product } from '../payload-types'
import { isPaidCourse } from './courses'
import { isStorefrontFreeSos } from './sos-offer'

export const COURSE_SHOWCASE_MARK = 'Kurzusaink'

export const COURSE_SHOWCASE_HEADING = 'A kezed, lépésről lépésre.'

export const COURSE_SHOWCASE_LEAD =
  'Online kézrehabilitációs kurzusok otthon és szakembereknek, egy kínálatban. Ár minden kártyán.'

export interface CourseShowcaseFallbackImage {
  src: string
  width: number
  height: number
}

/**
 * A public/media/team fájlok — sorrend: két portré, majd közös munka.
 * Az alt üres: a kártya egésze link, a kép dekoratív (ProductCard mintája).
 */
export const COURSE_SHOWCASE_FALLBACKS: readonly CourseShowcaseFallbackImage[] = [
  {
    src: '/media/team/portrait-seated-ball-a-portrait-1600.webp',
    width: 1600,
    height: 2000,
  },
  {
    src: '/media/team/portrait-seated-ball-b-portrait-1600.webp',
    width: 1600,
    height: 2000,
  },
  {
    src: '/media/team/founders-working-laptop-1600.webp',
    width: 1600,
    height: 2400,
  },
]

/**
 * A „Kurzusaink” vízjel körüli három döntött csapatfotó (a galéria alatti
 * jelenet). Sorrend = a CSS `__photo--0/1/2` helye: bal, közép, jobb.
 */
export const COURSE_SHOWCASE_DRIFT: readonly CourseShowcaseFallbackImage[] = [
  {
    src: '/media/team/founders-shared-laugh-1600.webp',
    width: 1600,
    height: 1006,
  },
  {
    src: '/media/team/hand-treatment-detail-1600.webp',
    width: 1600,
    height: 2400,
  },
  {
    src: '/media/team/founders-intro-white-1600.webp',
    width: 1600,
    height: 1067,
  },
]

export function showcaseFallbackAt(index: number): CourseShowcaseFallbackImage {
  const image = COURSE_SHOWCASE_FALLBACKS[index % COURSE_SHOWCASE_FALLBACKS.length]
  if (image === undefined) {
    return COURSE_SHOWCASE_FALLBACKS[0]
  }
  return image
}

/**
 * Astra-címforma: „A place, imagined.” — az első vessző utáni tag dőlt.
 * Vessző nélkül a teljes cím a főág.
 */
export function splitEditorialTitle(title: string): { head: string; tail: string | null } {
  const trimmed = title.trim()
  const comma = trimmed.indexOf(',')
  if (comma <= 0 || comma >= trimmed.length - 1) {
    return { head: trimmed, tail: null }
  }
  const head = trimmed.slice(0, comma + 1)
  const tail = trimmed.slice(comma + 1).trim()
  if (tail.length === 0) {
    return { head: trimmed, tail: null }
  }
  return { head, tail }
}

/**
 * A kezdőlapi Kurzusaink rács tételei és sorrendje (WP12, tulajdonosi kérés
 * 2026-09-07: „a kurzusaink részből hiányzik az ingyenes”).
 *
 * MIT enged be:
 * 1. minden fizetős kurzust (érvényes, megjeleníthető ár: `isPaidCourse`), a
 *    bejövő lekérdezés sorrendjében;
 * 2. az ingyenes SOS-t, de KIZÁRÓLAG az igazolt példányt
 *    (`isStorefrontFreeSos`: kanonikus slug + publikált storefront-`status` +
 *    explicit `priceInHUFEnabled === false`). Az „Ingyenes” felirat bizalmi
 *    határ (docs/kc-v1-owner-review.md P03/H13): hiányosan árazott vagy másik
 *    ingyenes termék NEM kerül a rácsba, mert ott „Ingyenes” címkét kapna, ami
 *    szerkesztői hibát takarna el.
 *
 * MIÉRT a látogatói feltétel, és nem a szigorúbb `isAvailableSosProduct`
 * (WP19, 2026-09-07): a rács korábban a drafts `_status === 'published'`-t is
 * kérte, a /kurzusok lista (src/app/(frontend)/kurzusok/page.tsx) viszont csak
 * a saját `status` mezőt nézi. Élesben az SOS `_status`-a nem published
 * (autosave-piszkozat a publikált rekord fölött), ezért a listán látszott, a
 * kezdőlapi rácsból hiányzott: ugyanaz a termék két helyen kétféleképp.
 * WCAG 2.2 SC 3.2.4 Consistent Identification: az azonos funkciójú elem
 * azonosítása legyen következetes
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html);
 * NN/g, Consistency in design: az egy helyen megtanult szabály máshol is
 * érvényes (https://www.nngroup.com/articles/consistency-and-standards/).
 * A lazítás BIZTONSÁGOS: a P03 bizalmi határ (kanonikus slug + `status` +
 * explicit ingyenes ár) változatlan, csak a technikai piszkozat-jelző esett
 * ki, ami a látogatói láthatóságot sehol máshol (lista, kurzusoldal, menü:
 * src/lib/menu-tree.ts) nem befolyásolja. A termék-lekérdezés (`getPublishedProducts`,
 * `draft: false`) eleve a publikált változatot adja.
 *
 * MIÉRT látszik az ár és az ingyenesség a listában is (a 2026-08-15-i
 * kezdőlap-audit K2-döntése ezt duplikáció miatt vette ki; a felülvizsgálat
 * alapja):
 * - NN/g, „The Anatomy of a List Entry”: „in all our 22 years of usability
 *   testing, there's one piece of info that every user has requested: the
 *   price” (https://www.nngroup.com/articles/list-entries/);
 * - Baymard, „Product Listing UX: What Information to Display in Product
 *   Listings”: „It is therefore vital that the price be permanently visible
 *   at all times” a listatételen, különben a látogató a bizonytalanság miatt
 *   ejti a tételt vagy oda-vissza kattintgat
 *   (https://baymard.com/blog/product-listing-information);
 * - NN/g, „Pricing information gives B2B sites a competitive advantage”: az
 *   elrejtett ár bizalomvesztés (https://www.nngroup.com/articles/show-price/).
 * A teljes kínálat egy listában (fizetős + ingyenes, ár mindkettőn) a
 * termékcsapat P03 kérése is: az SOS minden ajánlati megjelenésénél
 * egyértelműen ingyenes. A lentebbi FreeSos sáv NEM duplikátum, hanem a
 * lead-magnet részletezése saját CTA-val („Elindítom ingyen”, §3.2 #4).
 *
 * MIÉRT ez a sorrend (fizetős elöl, ingyenes hátul): az értékesítési
 * UX-skill M-hierarchiája (docs/ertekesitesi-ux-skill.md 2. szakasz) az M3
 * fizetős kártyákat elsődleges, az M4 ingyenes lead-magnetet másodlagos célnak
 * teszi, és a K2-tilalom szerint az ingyenes nem uralhatja el az oldalt. A
 * pozíció a rácsban a súlyozás eszköze: az olvasás bal felülről indul (NN/g
 * F-minta), így az első kártya a fizetős program.
 */
export function showcaseProducts(visibleProducts: readonly Product[]): Product[] {
  const paid = visibleProducts.filter(isPaidCourse)
  const sos = visibleProducts.find(isStorefrontFreeSos)
  return sos ? [...paid, sos] : paid
}
