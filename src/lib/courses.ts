import type { Category, Media, Product } from '../payload-types'

import { effectiveCoursePriceHuf, type CoursePromoFields } from './course-promo'
import { courseCtaHref } from './course-url'
import { ctaLabel } from './cta-vocabulary'
import { formatPriceHuf } from './format-price'
import { logger as rootLogger, type Logger } from './logger'

/**
 * Kurzus-storefront üzleti logika — tiszta, DB- és Next-függés nélküli
 * függvények, hogy a courses.test.ts egységtesztelje őket. A kurzus-oldalak
 * (src/app/(frontend)/kurzusok/**) ezeket használják.
 *
 * Mező-konvenciók (products collection, src/plugins/ecommerce.ts):
 * - A megjelenő név a `displayTitle` → `sku` lánc (courseTitle); az URL a
 *   `slug`, ennek hiányában a numerikus `id`. Az URL-építés és a slug-szabályok
 *   EGY helyen élnek: src/lib/course-url.ts (courseHref).
 * - Ár: `priceInHUF` (bruttó egész forint), csak `priceInHUFEnabled` mellett
 *   értelmezett.
 * - Státusz: saját `status` select (draft/published/archived) — NEM a drafts
 *   `_status`. A storefronton published listázódik; archived nem vehető és
 *   nem listázódik, de a meglévő vevő tovább nézi.
 */

/**
 * A checkout (pénztár) útvonala — a végső checkout-flow a W3-hullámban dől
 * el; addig is ide visz a „Megveszem" CTA, a terméket a `termek`
 * query-param hordozza. TODO(W3): a végleges útvonalra igazítani.
 */
export const CHECKOUT_PATH = '/penztar'

/**
 * A „kurzusaim" (vevői kurzuslista) útvonala — a védett lejátszó- és
 * fiókfelület a W3-hullám feladata. TODO(W3): a végleges útvonalra igazítani.
 */
export const MY_COURSES_PATH = '/kurzusaim'

/** Archivált termék magyarázó mondata — gomb helyett (§3.2 #16); második mondat: továbblépés. */
export const ARCHIVED_COURSE_NOTE =
  'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.'

/** Nem vásárolható (hiányos ár-konfig vagy nem publikált) — gomb helyett magyarázó mondat. */
export const UNAVAILABLE_COURSE_NOTE =
  'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.'

/** A kurzuslista kategória-szűrőjének query-param neve (/kurzusok?kategoria=<slug>). */
export const CATEGORY_QUERY_PARAM = 'kategoria'

/** Checkout-link a termékhez (a pénztár a numerikus id-t kapja query-paraméterben). */
export function checkoutHref(productId: number): string {
  return `${CHECKOUT_PATH}?termek=${productId}`
}

/** A megvett kurzus lejátszója (azonosító alapján, nem a lista). */
export function myCoursePlayerHref(productId: number): string {
  return `${MY_COURSES_PATH}/${productId}`
}

/** Igaz, ha a belső útvonal egy kurzus lejátszója (`/kurzusaim/12`). */
export function isMyCoursePlayerHref(path: string): boolean {
  return /^\/kurzusaim\/\d+$/.test(path)
}

/** Relatív vagy abszolút URL a lejátszóra mutat-e. */
export function isMyCoursePlayerUrl(url: string): boolean {
  const withoutOrigin = url.replace(/^https?:\/\/[^/?#]+/i, '')
  const path = withoutOrigin.split(/[?#]/)[0] ?? withoutOrigin
  return isMyCoursePlayerHref(path)
}

/**
 * Jelszó-beállítás / belépés után: egy ismert SKU → a lejátszó, több vagy
 * nulla → a Kurzusaim lista. A vendég-aktiváló levél így nem a üres listán
 * landol, ha a rendelés egy kurzus.
 */
export function postAuthLibraryOrPlayerHref(productIds: readonly number[]): string {
  const only = productIds.length === 1 ? productIds[0] : undefined
  return typeof only === 'number' ? myCoursePlayerHref(only) : MY_COURSES_PATH
}

/** Rendelés-tételek termék-azonosítói (id vagy populate-olt doc). */
export function productIdsFromOrderItems(
  items: ReadonlyArray<{ product?: number | { id?: number } | null }> | null | undefined,
): number[] {
  const ids: number[] = []
  for (const item of items ?? []) {
    const product = item.product
    if (product === null || product === undefined) {
      continue
    }
    const id = typeof product === 'object' ? product.id : product
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) {
      ids.push(id)
    }
  }
  return ids
}

/**
 * A `users.purchases` nyers id-i, populate-olt doc és kevert lista esetén is.
 * A Kurzusaim lista korábban eldobta a nem-objektum bejegyzéseket, ezért
 * üresnek látszott a fiók, miközben a paywall a nyers id-t elfogadta.
 */
export function purchaseIdsFrom(
  purchases: { id: number }[] | (number | { id: number })[] | null | undefined,
): number[] {
  if (!Array.isArray(purchases)) {
    return []
  }
  const ids: number[] = []
  for (const entry of purchases) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry > 0) {
      ids.push(entry)
      continue
    }
    if (typeof entry === 'object' && entry !== null && typeof entry.id === 'number') {
      ids.push(entry.id)
    }
  }
  return ids
}

/**
 * „Már megvetted" ellenőrzés: a users.purchases relationship eleme lehet
 * nyers id (number) vagy populate-olt Product-dokumentum (a lekérdezés
 * depth-jétől függ). Ugyanaz a szemantika, mint a stream-token paywallé.
 */
export function hasUserPurchased(
  purchases: { id: number }[] | (number | { id: number })[] | null | undefined,
  productId: number,
): boolean {
  if (!Array.isArray(purchases)) {
    return false
  }
  return purchases.some((entry) => {
    if (typeof entry === 'number') {
      return entry === productId
    }
    return typeof entry === 'object' && entry !== null && entry.id === productId
  })
}

/**
 * Ingyenes kurzus egyetlen igazságforrása: `priceInHUFEnabled === false`.
 * A `null`/`undefined` NEM ingyenes — hiányos konfig (korábban három helyen eltérő logika volt).
 */
export function isFreeCourse(product: Pick<Product, 'priceInHUFEnabled'>): boolean {
  return product.priceInHUFEnabled === false
}

/**
 * HIÁNYOS ÁR-KONFIGURÁCIÓ: az ár-pipa se be, se ki — a szerkesztő hozzá sem
 * nyúlt. Az ilyen termék se nem ingyenes, se nem eladható; a storefronton
 * inaktív ár-címkét és „Megveszem" gombot kapna, a checkout viszont
 * elutasítaná. Nem ugyanaz, mint a „pipa BE, ár ÜRES" eset (azt a
 * `coursePriceBadgeKind` 'none' ága kezeli).
 */
export function hasUnsetPriceFlag(product: Pick<Product, 'priceInHUFEnabled'>): boolean {
  return product.priceInHUFEnabled !== true && product.priceInHUFEnabled !== false
}

/**
 * PUBLIKÁLT termékek beállítatlan ár-pipával — a szerkesztői hiba felismerése.
 * Tiszta függvény (nem naplóz); a riasztást a `reportUnpricedPublishedCourses`
 * írja ki.
 */
export function unpricedPublishedCourseIds(
  products: Pick<Product, 'id' | 'status' | 'priceInHUFEnabled'>[],
): number[] {
  return products
    .filter((product) => product.status === 'published' && hasUnsetPriceFlag(product))
    .map((product) => product.id)
}

/**
 * RIASZTÁS a beállítatlan ár-pipájú, PUBLIKÁLT termékekről.
 *
 * Miért `logger.error` és miért „RIASZTÁS:" előtag (a repó mintája — lásd
 * `src/jobs/schedule-guard.ts`, `src/lib/szamlazz/invoice.ts`): a hibát EMBER
 * javítja az adminban, magától nem oldódik meg, és amíg fennáll, a látogató
 * megtévesztő felületet lát. A néma degradálás pontosan az a viselkedés, ami a
 * tulajdonos gomb-hibáját hetekig elrejtette.
 *
 * A hívó a storefront termék-lekérdezése (`src/lib/cms.ts`) — ott derül ki,
 * hogy a látogató elé kerülne a rosszul konfigurált termék. A függvény
 * MELLÉKHATÁSA kizárólag a naplósor; a visszaadott id-lista tesztelhetővé teszi.
 */
export function reportUnpricedPublishedCourses(
  products: Pick<Product, 'id' | 'status' | 'priceInHUFEnabled'>[],
  log: Pick<Logger, 'error'> = rootLogger,
): number[] {
  const ids = unpricedPublishedCourseIds(products)
  if (ids.length > 0) {
    log.error(
      'RIASZTÁS: publikált kurzus beállítatlan ár-pipával — a látogató „Megveszem" gombot lát, ' +
        'a rendszer viszont sem ingyenesként, sem fizetősként nem tudja kezelni. ' +
        'Az adminban az érintett termékeken az „Ár engedélyezve" pipát BE (ár megadásával) ' +
        'vagy KI (tudatosan ingyenes kurzus) kell állítani.',
      { productIds: ids },
    )
  }
  return ids
}

/** CTA-állapotgép ágai. A `free` ág a kurzusoldal igénylő űrlapját kapcsolja be — nem törölhető. */
export type CourseCtaKind = 'buy' | 'purchased' | 'archived' | 'unavailable' | 'free'

export interface CourseCtaState {
  kind: CourseCtaKind
  /**
   * A gomb felirata, VAGY `null`, ha egyáltalán NINCS gomb.
   *
   * A `null` az `archived` és az `unavailable` ágon áll: a
   * `docs/ui-sztenderdek.md` Á-3 szabálya szerint a letiltott gomb helyett a
   * cselekvésnek el kell tűnnie, és a `note` mondja meg, miért. A típus azért
   * nullable, hogy a hívó ne tudjon véletlenül visszacsempészni egy hamis
   * ígéretű („Megveszem") feliratot egy megvehetetlen termékre.
   */
  label: string | null
  /** Link-cél; nem cselekvő (archived/unavailable) állapotban null. */
  href: string | null
  /** true = a cselekvés nem végezhető el; ilyenkor `label === null` és `note !== null`. */
  disabled: boolean
  /** A látogatónak szóló magyarázó mondat — archived/unavailable ágon kötelező. */
  note: string | null
}

/**
 * Kurzus-oldal CTA-állapotgép. `buy` csak ha a checkout is engedné (`isPaidCourse`).
 * Feliratok a cta-vocabulary.ts-ből.
 */
export function resolveCourseCta(
  product: Pick<Product, 'id' | 'slug' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>,
  purchased: boolean,
): CourseCtaState {
  if (purchased) {
    return {
      kind: 'purchased',
      label: ctaLabel('course-start'),
      href: myCoursePlayerHref(product.id),
      disabled: false,
      note: null,
    }
  }
  if (product.status === 'archived') {
    return {
      kind: 'archived',
      label: null,
      href: null,
      disabled: true,
      note: ARCHIVED_COURSE_NOTE,
    }
  }
  if (product.status === 'published') {
    // Ingyenes kurzus: a kért SKU-t az igénylő űrlap írja a purchases-be
    // (free-course-grant.ts), NEM a Barion-checkout és NEM a belépés.
    // Az „ingyenes" fogalom EGYETLEN forrása az isFreeCourse: a beállítatlan
    // ár-pipa NEM ingyenes (lásd az indoklását).
    if (isFreeCourse(product)) {
      return {
        kind: 'free',
        label: ctaLabel('free-course-claim'),
        href: courseCtaHref(product),
        disabled: false,
        note: null,
      }
    }
    // ÉRVÉNYES ÁR a feltétel, nem a „nem ingyenes": a hiányos konfigurációjú
    // terméket a checkout kapuja úgyis elutasítaná (lásd a fejlécet).
    if (isPaidCourse(product)) {
      return {
        kind: 'buy',
        label: ctaLabel('course-buy'),
        href: checkoutHref(product.id),
        disabled: false,
        note: null,
      }
    }
  }
  return {
    kind: 'unavailable',
    label: null,
    href: null,
    disabled: true,
    note: UNAVAILABLE_COURSE_NOTE,
  }
}

/**
 * Numerikus kurzus-azonosító egy URL-szegmensből; bármi más → null.
 *
 * Két helyen kell: a védett lejátszó-útvonalon (/kurzusaim/[id]) és a
 * nyilvános kurzus-URL feloldásában (src/lib/course-url.ts), ahol a régi,
 * id-alapú címeket ismerjük fel — azok innen kapják a 301-es átirányítást a
 * slugos címre.
 */
export function parseCourseIdParam(slug: string | undefined): number | null {
  if (typeof slug !== 'string') {
    return null
  }
  const trimmed = slug.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const id = Number(trimmed)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * A kurzus megjelenített neve.
 *
 * Lánc: `displayTitle` (C3 — a látogatónak szóló cím) → `sku` (a régi, kettős
 * szerepű azonosító-név) → azonosítós fallback. A `displayTitle` opcionális,
 * ezért a szűkebb (csak `sku`-t hordozó) hívók változatlanul működnek.
 */
export function courseTitle(
  product: Pick<Product, 'id' | 'sku'> & { displayTitle?: string | null },
): string {
  const displayTitle = typeof product.displayTitle === 'string' ? product.displayTitle.trim() : ''
  if (displayTitle.length > 0) {
    return displayTitle
  }
  const sku = typeof product.sku === 'string' ? product.sku.trim() : ''
  return sku.length > 0 ? sku : `Kurzus #${product.id}`
}

/**
 * A termék MOST fizetendő ára egész forintban; null, ha az ár nincs
 * engedélyezve/kitöltve.
 *
 * WP63 (2026-09-21): élő akcióban az akciós ár (`promoPriceHuf`), az
 * időablakon kívül a rendes ár (`priceInHUF`). A visszaállás magától, a
 * lejárat pillanatában történik, ütemezett visszaírás nélkül, mert MINDEN
 * ár-olvasó (oldal, kártya, kosár, pénztár, Barion-összeg, rendelés-snapshot,
 * strukturált adat) ezt a függvényt hívja. A promo-mezők a típusban
 * opcionálisak a szűk Pick-hívók miatt; aki `select`-tel kér terméket, a
 * `COURSE_PRICE_SELECT` mezőit kérje, különben csendben a rendes árat kapja.
 *
 * A NEM POZITÍV ár nem ár, hanem konfigurációs hiba. A 0 Ft csábító
 * rövidítés lenne az „ingyenes"-re, de az ingyenességet KIZÁRÓLAG a
 * priceInHUFEnabled: false fejezi ki (lásd isFreeCourse). Ha a 0-t itt
 * érvényes árnak vennénk, a felület „Megveszem" gombot adna rá, a
 * checkout-kapu viszont elutasítaná; pontosan az a szétcsúszás, amit a
 * tulajdonos élő hibabejelentése után zártunk be. A kapu ugyanezt a
 * függvényt hívja (src/lib/checkout/start-checkout.ts), tehát a kettő nem
 * tud egymástól elsodródni.
 */
export function coursePriceHuf(product: CoursePriceInput, now: Date = new Date()): number | null {
  return effectiveCoursePriceHuf(product, now)
}

/** A `coursePriceHuf` bemenete: rendes ár + (opcionálisan) az akció mezői. */
export type CoursePriceInput = Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'> &
  Partial<CoursePromoFields>

/** A fizetendő ár kiszámításához `select`-ben kérendő mezők. */
export const COURSE_PRICE_SELECT = {
  priceInHUFEnabled: true,
  priceInHUF: true,
  promoEnabled: true,
  promoStart: true,
  promoEnd: true,
  promoPriceHuf: true,
} as const

/** Ár-megjelenítés a kártyákon/részleteken — az 5A formatPriceHuf közös formázója. */
export function coursePriceLabel(product: CoursePriceInput, now?: Date): string | null {
  const price = coursePriceHuf(product, now)
  return price === null ? null : formatPriceHuf(price)
}

export type CoursePriceBadgeKind = 'price' | 'free' | 'none'

/**
 * A kurzusoldal buybox ár-címkéje:
 * - 'price': érvényes ár van → a PriceTag látszik (forintban, rejtett ár nincs);
 * - 'free': TUDATOSAN ingyenes termék (priceInHUFEnabled: false) → „Ingyenes";
 * - 'none': az ár-pipa BE van kapcsolva, de az ár ÜRES (konfigurációs hiba) —
 *   ilyenkor NEM írunk „Ingyenes"-t: a címke a „Megveszem" gomb mellett
 *   megtévesztő lenne (a termék ára hiányzik, a checkout elutasítaná).
 *   A hibás rekordot a staff javítja — a storefront addig sem árat, sem
 *   „Ingyenes"-t nem mutat.
 */
export function coursePriceBadgeKind(product: CoursePriceInput, now?: Date): CoursePriceBadgeKind {
  if (coursePriceHuf(product, now) !== null) {
    return 'price'
  }
  // Az „ingyenes" megítélése az egyetlen igazságforrásból (isFreeCourse) jön:
  // a beállítatlan ár-pipa 'none' (hiányos konfiguráció), nem „Ingyenes".
  return isFreeCourse(product) ? 'free' : 'none'
}

/**
 * FIZETŐS-e a kurzus: érvényes, megjeleníthető ára van (`coursePriceHuf`).
 *
 * A „fizetős" és az „ingyenes" NEM egymás tagadása — a harmadik állapot a
 * HIÁNYOS KONFIGURÁCIÓ (beállítatlan ár-pipa, vagy bepipált ár üres értékkel),
 * ami egyik halmazba sem tartozik. Ezért kell a kettő külön kérdés: aki a
 * `!isPaidCourse`-t venné „ingyenes"-nek, a hibás rekordot is ingyenesként
 * kezelné (pontosan ez tette a rosszul konfigurált terméket a kezdőlap
 * lead-magnet sávjába).
 */
export function isPaidCourse(product: CoursePriceInput, now?: Date): boolean {
  return coursePriceHuf(product, now) !== null
}

export interface CourseCategoryOption {
  id: number
  slug: string
  title: string
}

/** A relationship-mező populate-olt értéke (objektum) vagy nyers id lehet. */
function populatedCategory(category: Product['category']): Category | null {
  return typeof category === 'object' && category !== null ? category : null
}

/**
 * A megjelenített kurzusok tényleges kategóriái (szűrő-chipek forrása).
 * Csak a listában ténylegesen előforduló, slug-gal rendelkező kategóriák —
 * így a szűrő sosem vezet biztosan üres eredményre. Cím szerinti magyar
 * ábécé-sorrend.
 */
export function collectCourseCategories(
  products: Pick<Product, 'category'>[],
): CourseCategoryOption[] {
  const byId = new Map<number, CourseCategoryOption>()
  for (const product of products) {
    const category = populatedCategory(product.category)
    if (!category || typeof category.slug !== 'string' || category.slug.trim().length === 0) {
      continue
    }
    if (!byId.has(category.id)) {
      byId.set(category.id, {
        id: category.id,
        slug: category.slug,
        title: category.title,
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, 'hu'))
}

/**
 * Kategória-szűrés a kurzuslistán. `null` slug = nincs szűrés (összes).
 * A nem populate-olt (nyers id) kategóriájú termék slug-szűrésnél kiesik —
 * a lista-lekérdezés depth:1-gyel populate-ol, ez a védekező ág.
 */
export function filterCoursesByCategory<T extends Pick<Product, 'category'>>(
  products: T[],
  categorySlug: string | null,
): T[] {
  if (categorySlug === null) {
    return products
  }
  return products.filter((product) => {
    const category = populatedCategory(product.category)
    return category !== null && category.slug === categorySlug
  })
}

/**
 * A ?kategoria= query-param normalizálása: csak a megjelenített kategóriák
 * valamelyike fogadható el; ismeretlen/üres érték → null (szűretlen lista),
 * így egy elgépelt link sem mutat látszólag „üres boltot".
 */
export function resolveCategoryFilter(
  raw: string | string[] | undefined,
  categories: CourseCategoryOption[],
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') {
    return null
  }
  const slug = value.trim()
  return categories.some((category) => category.slug === slug) ? slug : null
}

export interface CourseCover {
  url: string
  alt: string
  width: number | null
  height: number | null
}

/**
 * A kártya borítóképe: a media `sm` (640px) méretét részesíti előnyben,
 * arra hajazva, hogy a kártyarácson ez a tipikus megjelenítési méret;
 * hiányában az eredeti. Csak populate-olt, url-es képpel tér vissza.
 */
export function courseCover(product: Pick<Product, 'coverImage'>): CourseCover | null {
  const media: Media | null =
    typeof product.coverImage === 'object' && product.coverImage !== null
      ? product.coverImage
      : null
  if (!media) {
    return null
  }
  const sm = media.sizes?.sm
  const url = typeof sm?.url === 'string' && sm.url.length > 0 ? sm.url : media.url
  if (typeof url !== 'string' || url.length === 0) {
    return null
  }
  const width = url === sm?.url ? (sm?.width ?? null) : (media.width ?? null)
  const height = url === sm?.url ? (sm?.height ?? null) : (media.height ?? null)
  return { url, alt: media.alt, width, height }
}
