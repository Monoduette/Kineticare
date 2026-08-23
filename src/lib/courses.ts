import type { Category, Media, Product } from '../payload-types'

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

/**
 * ARCHIVÁLT termék magyarázó mondata (a §3.2 #16 szerint gomb HELYETT áll).
 *
 * ═══ MIÉRT VÁLTOZOTT (2026-08-18) ═══
 * A korábbi szöveg egyetlen mondat volt, továbblépés nélkül: „Ez a kurzus
 * jelenleg nem vásárolható." A látogató megtudta, hogy nem kaphatja meg, de nem
 * tudta meg, mit tehet — és mivel a §3.2 #16 szerint GOMB SINCS az oldalon, ez
 * ZSÁKUTCA volt (a skill 5. pontja tiltja). NN/g, Error-Message Guidelines:
 * „Concisely and precisely describe the issue." és „Merely stating the problem
 * is also not enough; offer some potential remedies."
 * https://www.nngroup.com/articles/error-message-guidelines/
 *
 * Az ELSŐ MONDAT ezért szó szerint a §3.2 #16 jóváhagyott alakja (a korábbi
 * „nem vásárolható" a „meg" igekötő nélkül még a szótártól is eltért), a
 * MÁSODIK pedig a továbblépés — pontosan úgy, ahogy a párja, az
 * `UNAVAILABLE_COURSE_NOTE` már 2026-08-16 óta. A két állapot a látogató
 * szemszögéből ugyanaz („most nem tudom megvenni"), ezért ugyanazt is olvassa:
 * WCAG 2.2 · 3.2.4 Consistent Identification.
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 *
 * A KÉT KONSTANS mégis külön marad: két KÜLÖNBÖZŐ rendszerállapotot jelöl
 * (tudatosan visszavont termék ↔ hiányos szerkesztői konfiguráció, utóbbihoz
 * staff-riasztás is tartozik), és a hívóhelyek így maradnak olvashatók.
 */
export const ARCHIVED_COURSE_NOTE =
  'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.'

/**
 * NEM VÁSÁROLHATÓ (de nem archivált) termék magyarázó mondata.
 *
 * Ide a hiányos ár-konfigurációjú (`priceInHUFEnabled` beállítatlan, vagy
 * bepipált ár üres értékkel) és a nem publikált termék esik. A `docs/ui-sztenderdek.md`
 * §3.2 #16 és Á-3 szabálya szerint ilyenkor NINCS gomb, helyette magyarázó
 * mondat áll: a letiltott „Megveszem" hamis ígéret (NN/g: „a link ígéret"), a
 * magyarázat nélküli disabled gomb pedig a 2.7 pontot is sérti.
 *
 * A második mondat a GOV.UK hibaüzenet-elvét követi („mondd meg, mi történt és
 * hogyan léphet tovább"), és a zsákutcát is feloldja (skill 5. pont). A szöveg
 * natív magyar, E/2, gondolatjel nélkül (skill 2. pont).
 */
export const UNAVAILABLE_COURSE_NOTE =
  'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.'

/** A kurzuslista kategória-szűrőjének query-param neve (/kurzusok?kategoria=<slug>). */
export const CATEGORY_QUERY_PARAM = 'kategoria'

/** Checkout-link a termékhez (a pénztár a numerikus id-t kapja query-paraméterben). */
export function checkoutHref(productId: number): string {
  return `${CHECKOUT_PATH}?termek=${productId}`
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
 * ═══ AZ „INGYENES KURZUS" EGYETLEN IGAZSÁGFORRÁSA ═══
 *
 * Ingyenes = `priceInHUFEnabled === false`, azaz a szerkesztő TUDATOSAN kivette
 * az ár-pipát. SZIGORÚ szabály: a beállítatlan (`null`/`undefined`) érték NEM
 * ingyenes, hanem HIÁNYOS KONFIGURÁCIÓ.
 *
 * MIÉRT SZIGORÚ (a 2026-08-16-i átvizsgálás gyökéroka): korábban három helyen,
 * háromféleképp dőlt el ugyanez a kérdés. A hozzáférés-adó lekérdezés
 * (`free-course-grant.ts`) `not_equals: true`-val kérdezett — annak a NULL is
 * ingyenes volt —, a gomb-felirat és az ár-címke viszont szigorú `=== false`-t
 * használt. Egy publikált, de még be nem árazott kurzus így a látogatónak
 * „Megveszem" gombbal FIZETŐSNEK látszott, miközben MINDEN belépő felhasználó
 * megkapta a hozzáférést — és az ár utólagos beállítása után is bent maradt.
 * Üzletileg bevételkiesés, a felhasználónak érthetetlen felület.
 *
 * Ezt a függvényt használja a gomb-logika (`resolveCourseCta`), az ár-címke
 * (`coursePriceBadgeKind`), a kezdőlapi fizetős/ingyenes szétválasztás
 * (`isPaidProduct`) és a hozzáférés-adó lekérdezés (`free-course-grant.ts`,
 * `equals: false`). Új fogyasztó is KIZÁRÓLAG innen kérdezze.
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

/**
 * A CTA-állapotgép ágai.
 *
 * ═══ MIÉRT MARAD MEG A `free` ÁG (2026-08-18-i vezetői kérdés) ═══
 * A kérdés az volt, hogy a `free` ág ÁTIRÁNYÍTÁSA vagy TÖRLÉSE a tisztább.
 * A törlés a típust is szűkítené, de a `free` KIND nem csak feliratot ad: a
 * kurzusoldal (`app/(frontend)/kurzusok/[slug]/page.tsx`) EBBŐL dönti el, hogy
 * a vásárlódoboz CTA-helyére az igénylő űrlap kerüljön-e
 * (`showFreeRequestForm = cta.kind === 'free'`), és ebből tűnik el a ragadós
 * vásárlósáv is. Törlés esetén ugyanezt a döntést a lapon KELLENE újraszámolni
 * (`isFreeCourse` + státusz + `purchased`), vagyis az „ingyenes" fogalom
 * MÁSODIK definíciója keletkezne a kódban — pontosan az a gyökérok, amit ennek
 * a modulnak a `isFreeCourse` fejkommentje mért és felszámolt (három helyen,
 * háromféleképp dőlt el ugyanez a kérdés, és a látogató fizetős gombot látott
 * egy ingyenes kurzuson).
 *
 * Ezért az ÁTIRÁNYÍTÁS a helyes: az ág megmarad, de a `/kurzusaim` helyett a
 * kurzus saját oldalán álló igénylő űrlapra mutat (`courseCtaHref`). A régi cél
 * be nem jelentkezett látogatónak ZSÁKUTCA volt (a lista bejelentkezést kér, a
 * kurzushoz sosem jut hozzá) — a skill 5. pontja ezt tiltja. Így bármely ÚJ
 * fogyasztó (kártya, kezdőlapi sáv, kosár) is a működő útra kerül, nem a régi,
 * rossz viselkedést hozza elő.
 */
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
 * A kurzus-oldal CTA-állapotgépe.
 *
 * ═══ A VEZÉRELV ═══
 * `kind === 'buy'` AKKOR ÉS CSAK AKKOR, ha a checkout kapuja (`assertPurchasable`,
 * src/lib/checkout/start-checkout.ts) sem utasítaná el a terméket. A felület
 * sosem ígérhet olyan cselekvést, amit a szerver garantáltan visszautasít
 * (docs/ui-sztenderdek.md §3.2 #16; NN/g: „a link ígéret").
 *
 * ═══ A JAVÍTOTT HIBA (2026-08-16, gomb-inventár mérés) ═══
 * A published ág korábban MINDEN nem-ingyenes termékre `'buy'`-t adott, tehát
 * arra is, aminek nincs érvényes ára (`priceInHUFEnabled: true` + üres ár,
 * illetve beállítatlan pipa). A vevő végigment a pénztáron, kitöltötte a
 * számlázási adatait, elfogadta a jogszabályi nyilatkozatokat, és a beküldés
 * 400-zal elhasalt: „A termékhez nem tartozik érvényes ár, így nem vásárolható
 * meg." (`start-checkout.ts:260`). Ezért kérdezi a published ág az `isPaidCourse`-t
 * (ÉRVÉNYES ár), nem a `!isFreeCourse`-t.
 *
 * ═══ A FELIRATOK A SZÓTÁRBÓL JÖNNEK (2026-08-18) ═══
 * Egyetlen felirat sem literál: mind a `src/lib/cta-vocabulary.ts`-ből olvas
 * (`docs/ui-sztenderdek.md` §3.2). Korábban három szabad szöveg élt itt
 * („Megveszem", „Tovább a kurzusaimhoz", „Ingyenes — azonnal eléred"), és
 * mindhárom eltért a jóváhagyott alaktól – az utolsó ráadásul U+2014-et
 * használt elválasztóként (§3.1.1) és ígéretet tett a cselekvés helyett (M-8).
 *
 * ═══ AZ ÁGAK ═══
 * - bejelentkezett vevő (purchases tartalmazza) → §3.2 #9 link a kurzusaidhoz,
 *   archived terméknél is (a meglévő vevő tovább nézi);
 * - archived + nem vevő → NINCS gomb + ARCHIVED_COURSE_NOTE;
 * - published + nem vevő:
 *   - ingyenes (`isFreeCourse`) → §3.2 #3 („Elindítom ingyen") a KURZUS SAJÁT
 *     oldalán álló igénylő űrlaphoz (`courseCtaHref`), nem a Barion-checkouton
 *     keresztül; a purchases-be a free-course-grant ír;
 *   - érvényes árú (`isPaidCourse`) → §3.2 #1 („Megveszem a kurzust") → checkout;
 *   - se nem ingyenes, se nem érvényesen árazott (HIÁNYOS KONFIGURÁCIÓ) →
 *     NINCS gomb + UNAVAILABLE_COURSE_NOTE (a staffnak külön RIASZTÁS megy,
 *     lásd reportUnpricedPublishedCourses);
 * - minden más (draft/ismeretlen státusz) → NINCS gomb + UNAVAILABLE_COURSE_NOTE
 *   (a nyilvános oldal egyébként 404-et ad draft termékre; ez a védekező ág).
 */
export function resolveCourseCta(
  product: Pick<Product, 'id' | 'slug' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>,
  purchased: boolean,
): CourseCtaState {
  if (purchased) {
    return {
      kind: 'purchased',
      label: ctaLabel('my-courses-open'),
      href: MY_COURSES_PATH,
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

/** A termék ára egész forintban; null, ha az ár nincs engedélyezve/kitöltve. */
export function coursePriceHuf(
  product: Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>,
): number | null {
  if (product.priceInHUFEnabled !== true) {
    return null
  }
  if (typeof product.priceInHUF !== 'number' || !Number.isFinite(product.priceInHUF)) {
    return null
  }
  // A NEM POZITÍV ár nem ár, hanem konfigurációs hiba. A 0 Ft csábító
  // rövidítés lenne az „ingyenes"-re, de az ingyenességet KIZÁRÓLAG a
  // priceInHUFEnabled: false fejezi ki (lásd isFreeCourse). Ha a 0-t itt
  // érvényes árnak vennénk, a felület „Megveszem" gombot adna rá, a
  // checkout-kapu viszont elutasítaná — pontosan az a szétcsúszás, amit a
  // tulajdonos élő hibabejelentése után zártunk be. A kapu ugyanezt a
  // függvényt hívja (src/lib/checkout/start-checkout.ts), tehát a kettő nem
  // tud egymástól elsodródni.
  return product.priceInHUF > 0 ? product.priceInHUF : null
}

/** Ár-megjelenítés a kártyákon/részleteken — az 5A formatPriceHuf közös formázója. */
export function coursePriceLabel(
  product: Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>,
): string | null {
  const price = coursePriceHuf(product)
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
export function coursePriceBadgeKind(
  product: Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>,
): CoursePriceBadgeKind {
  if (coursePriceHuf(product) !== null) {
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
export function isPaidCourse(
  product: Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>,
): boolean {
  return coursePriceHuf(product) !== null
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
