/**
 * Kurzus-galéria (Astra „Bring ideas” szerkezet) — tiszta, DB nélkül tesztelhető.
 *
 * A két audience-sáv (Otthoni / Szakembereknek) a kártya kickerében marad,
 * nem külön szekciócím. A borító hiányánál a csapatportrék lépnek be, index
 * szerint, hogy a háromhasábos rács ne legyen üres keret.
 */

import type { Product } from '../payload-types'
import { isPaidCourse } from './courses'
import { isAvailableSosProduct } from './sos-offer'

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
 * A „Kurzusaink” vízjel alatti három csapatfotó (a galéria alatti jelenet).
 * Sorrend = a rács helye: bal, közép, jobb. WP50: a fotók egyforma, 4:3-as
 * rácscellákban állnak (course-showcase.css `__photo`), ezért 800 px széles
 * változat elég (a cella 1440-en ~340 CSS px, 2×-en 680 px; a korábbi
 * 1600-as fájl 5,6-szoros túlméret volt, audit 2026-09-07, 2.5).
 * WP54 (tulajdonosi 2. kör, 2026-09-19): a középső cella a fotózás
 * fekvő gyakorlat-fotóját kapja (kéz kis labdán, kék törölközőn, `_MG_0387`,
 * manifest `showcase-home-exercise`), az addigi álló kezelés-fotó helyett.
 * Így mindhárom fotó fekvő és 3:2 közeli (1,59 / 1,50 / 1,50), a 4:3-as cella
 * mindhármat egyformán, szélességben vágja (css `object-position: 25% 50%`,
 * mérés ott). A tartalom a szekció tárgya (otthoni gyakorlat), nem az
 * alapítók ismétlése: NN/g, Photos as Web Content, a tartalomhoz kötött fotó
 * informatív, a töltelék nem
 * (https://www.nngroup.com/articles/photos-as-web-content/); Apple HIG,
 * Images: egy sorban álló képek azonos arányban és méretben állnak, hogy a
 * sor egységes maradjon
 * (https://developer.apple.com/design/human-interface-guidelines/images).
 * (Korábbi neve COURSE_SHOWCASE_DRIFT, a WP50 előtti görgetésre úszó
 * kompozíció után; a jelenet ma statikus.)
 */
export const COURSE_SHOWCASE_SCENE_PHOTOS: readonly CourseShowcaseFallbackImage[] = [
  {
    src: '/media/team/founders-shared-laugh-800.webp',
    width: 800,
    height: 503,
  },
  {
    src: '/media/team/home-exercise-ball-towel-800.webp',
    width: 800,
    height: 533,
  },
  {
    src: '/media/team/founders-intro-white-800.webp',
    width: 800,
    height: 534,
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
 *    (`isAvailableSosProduct`: kanonikus slug + publikált storefront-`status` +
 *    publikált drafts `_status` + explicit `priceInHUFEnabled === false`). Az „Ingyenes” felirat bizalmi
 *    határ (docs/kc-v1-owner-review.md P03/H13): hiányosan árazott vagy másik
 *    ingyenes termék NEM kerül a rácsba, mert ott „Ingyenes” címkét kapna, ami
 *    szerkesztői hibát takarna el.
 *
 * MIÉRT a szigorú `isAvailableSosProduct` (WP19 felülvizsgálat, 2026-09-07):
 * a hero, az SOS-sáv és a rács UGYANAZT az ellenőrzött terméket ajánlja
 * (P1-őr: src/__tests__/hero-free-sos-availability.test.tsx), ezért a drafts
 * `_status === 'published'` itt is feltétel. Élesben az SOS piszkozat-státuszú
 * volt (az adminban nem publikált), így a rács, a hero és a sáv egyformán
 * semleges maradt: a javítás a termék publikálása, nem a feltétel lazítása
 * (WCAG 2.2 SC 3.2.4: ugyanaz a termék mindenhol ugyanúgy jelenjen meg,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
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
  const sos = visibleProducts.find(isAvailableSosProduct)
  return sos ? [...paid, sos] : paid
}
