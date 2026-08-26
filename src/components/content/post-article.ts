import {
  postFaqItems as faqItemsFrom,
  type PostFaqItem,
  type PostFaqSource,
} from '../../lib/seo-cikk'
import type { Category, Post } from '../../payload-types'
import type { MediaLike, MediaSizeInfo } from './media-url'

/**
 * Cikkoldal — tiszta (DB-független) segédfüggvények és MEZŐ-OLVASÓK.
 * SZÁNDÉKOSAN függetlenül élesíthető (technikai terv 2.1: „minden
 */

// ---------------------------------------------------------------------------
// Szűkítő segédek
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Egy mező értéke a dokumentumból, típus-feltevés nélkül. */
function readField(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : undefined
}

/** Nem üres, trimmelt szöveg vagy null (üres string sosem „érték"). */
function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Nyers szöveg-mező szűkítése, TRIMMELÉS NÉLKÜL.
 *
 * A `readText` a megjelenítési döntést is meghozza (üres szöveg = nincs érték);
 * ez a változat CSAK a típust szűkíti, mert a hozzá tartozó tartalmi döntés
 * máshol, egyetlen helyen él (lásd `postFaqItems`).
 */
function readRawText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// ---------------------------------------------------------------------------
// Megjelenítési szabályok
// ---------------------------------------------------------------------------

/**
 * Kell-e tartalomjegyzék: 800 szónál hosszabb cikk VAGY legalább 5 szakaszcím.
 *
 * A küszöb a `docs/ux-belso-oldalak-kutatas.md` B2.3 szabálya; az indoklás az
 * NN/g *In-Page Links for Content Navigation* mondata: „shorter pages make
 * tables of contents unnecessary"
 * (https://www.nngroup.com/articles/in-page-links-content-navigation/).
 * Rövid cikken a jegyzék nem segít, csak egy képernyőnyi zajt tesz a szöveg
 * elé, és eltolja a lényeget a hajtás alá.
 */
export function shouldShowToc(wordCount: number, h2Count: number): boolean {
  return wordCount > 800 || h2Count >= 5
}

/**
 * A kapcsolódó blokk címe.
 *
 * NN/g, *Related Content Boosts Pageviews, When Done Right*
 * (https://www.nngroup.com/articles/related-content-pageviews/): az általános
 * címke („From the Web", „More from…") gyenge információ-szagú; a témát
 * megnevező cím érdemben jobb. Ezért: ha MINDEN megjelenített kapcsolódó cikk
 * osztozik a jelen cikk első kategóriáján, a cím megnevezi a témát; ha nem,
 * nem állítunk valótlant, és az általános alakot használjuk.
 */
export function relatedHeading(
  post: Pick<Post, 'categories'>,
  related: ReadonlyArray<Pick<Post, 'categories'>>,
): string {
  const primary = firstCategoryOf(post)
  if (primary === null || related.length === 0) {
    return 'További cikkek a Tudástárból'
  }
  const sharedByAll = related.every((item) => categoryIdsOf(item).includes(primary.id))
  return sharedByAll ? `További cikkek a témában: ${primary.title}` : 'További cikkek a Tudástárból'
}

/**
 * Byline a cikk fejlécében: „Írta: Kocsis Kata, gyógytornász".
 *
 * NN/g, *Bylines for Web Articles* — a rövid, hitelesítő byline a lap
 * TETEJÉN áll, a bővebb bemutatkozás a lap alján
 * (https://www.nngroup.com/articles/bylines/). A Google E-E-A-T „Who"
 * kérdésére is ez az első válasz
 * (https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
 * Végzettség nélkül CSAK a nevet írjuk ki: titulust nem találunk ki.
 */
export function bylineOf(name: string, credentials?: string | null): string {
  const credential = readText(credentials)
  return credential === null ? `Írta: ${name}` : `Írta: ${name}, ${credential}`
}

// ---------------------------------------------------------------------------
// Kategóriák
// ---------------------------------------------------------------------------

/** A poszt kategória-hivatkozásai id-ként (nyers és populált alak is). */
function categoryIdsOf(post: Pick<Post, 'categories'>): number[] {
  if (!Array.isArray(post.categories)) return []
  return post.categories
    .map((category) => (typeof category === 'object' && category !== null ? category.id : category))
    .filter((id): id is number => typeof id === 'number')
}

/**
 * A cikk ELSŐ, megjeleníthető kategóriája (populált, címmel és sluggal).
 *
 * Miért pontosan egy: Baymard, *2 Key Design Principles for Product Listing
 * Information* (https://baymard.com/blog/list-item-design-ecommerce) — a
 * tételeken ugyanaz a mezőkészlet álljon; több címke tördel, és a kártyák
 * magassága szétcsúszik (docs/tudastar-ux-terv.md 3.2).
 */
export function firstCategoryOf(post: Pick<Post, 'categories'>): Category | null {
  if (!Array.isArray(post.categories)) return null
  for (const category of post.categories) {
    if (typeof category === 'object' && category !== null && typeof category.title === 'string') {
      return category
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Szerző és lektor
// ---------------------------------------------------------------------------

/** A szerző-blokk és a byline adata — CSAK a publikusra szánt mezők. */
export interface ArticlePerson {
  name: string
  credentials: string | null
  bioShort: string | null
  portrait: MediaLike | null
}

/** Media-dokumentum szűkítése a `MediaImage` laza szerződésére. */
function toMediaLike(value: unknown): MediaLike | null {
  if (!isRecord(value)) return null
  const url = readText(value.url)
  const rawSizes = value.sizes
  const sizes: Record<string, MediaSizeInfo> = {}
  if (isRecord(rawSizes)) {
    for (const [name, info] of Object.entries(rawSizes)) {
      if (!isRecord(info)) continue
      const sizeUrl = readText(info.url)
      if (sizeUrl === null) continue
      sizes[name] = { url: sizeUrl, width: readNumber(info.width), height: readNumber(info.height) }
    }
  }
  if (url === null && Object.keys(sizes).length === 0) return null
  return {
    url,
    alt: readText(value.alt),
    width: readNumber(value.width),
    height: readNumber(value.height),
    sizes,
  }
}

/** Populált user-dokumentum → publikus személy-adat (nyers dokumentum nélkül). */
function personOf(value: unknown): ArticlePerson | null {
  const name = readText(readField(value, 'name'))
  if (name === null) return null
  return {
    name,
    credentials: readText(readField(value, 'credentials')),
    bioShort: readText(readField(value, 'bioShort')),
    portrait: toMediaLike(readField(value, 'portrait')),
  }
}

/** A cikk szerzője (populált `author`), vagy null. */
export function authorPersonOf(doc: unknown): ArticlePerson | null {
  return personOf(readField(doc, 'author'))
}

/**
 * A cikk vagy CMS-oldal szakmai lektora (`reviewedBy`), vagy null.
 *
 * Populálatlan (nyers id) vagy üres mezőnél mindig null, és a szerző-blokk
 * lektor-sora némán elmarad.
 */
export function reviewerPersonOf(doc: unknown): ArticlePerson | null {
  return personOf(readField(doc, 'reviewedBy'))
}

/** Az ellenőrzés dátumai (ISO), ha ténylegesen ki vannak töltve. */
export interface ReviewDates {
  reviewedAt: string | null
  nextReviewAt: string | null
}

/**
 * A lektorálás dátumai.
 *
 * Az NHS „Page last reviewed" / „Next review due" párja
 * (https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date).
 * SZIGORÚ SZABÁLY: dátumot csak akkor írunk ki, ha az adat létezik —
 * ellenőrzés-dátum ellenőrzés nélkül hazugság, és pont azt a bizalmat rombolná,
 * amiért a blokk létezik (docs/tudastar-ux-terv.md 5.6, 8. fejezet).
 */
export function reviewDatesOf(doc: unknown): ReviewDates {
  return {
    reviewedAt: readText(readField(doc, 'reviewedAt')),
    nextReviewAt: readText(readField(doc, 'nextReviewAt')),
  }
}

// ---------------------------------------------------------------------------
// „Mások ezt is kérdezik" (GYIK)
// ---------------------------------------------------------------------------

/**
 * A GYIK-tétel alakja — a séma-réteg típusa, ÚJRAEXPORTÁLVA.
 *
 * Egy alak, egy definíció: a látható lista (`PostFaq`) és a `FAQPage` séma
 * ugyanazt a típust használja, tehát a kettő szerkezetileg nem tud
 * szétcsúszni. Korábban a típus két, karakterre azonos példányban élt.
 */
export type { PostFaqItem } from '../../lib/seo-cikk'

/**
 * A cikk GYIK-tételei a dokumentumból, hiányos tétel nélkül, legfeljebb hatan.
 * A szűrés (hiányos tétel kihagyása), a trimmelés és a hatos plafon EGYETLEN
 * helyen él, a `src/lib/seo-cikk.ts` `postFaqItems` függvényében. Korábban
 * ugyanaz a szabály két példányban futott — itt és ott —, márpedig két külön
 * szűrő idővel szétcsúszik, és pont az a látható lista és a séma közti eltérés
 * keletkezik belőle, ami miatt a keresők elvetik a strukturált adatot (Google,
 */
export function postFaqItems(doc: unknown): PostFaqItem[] {
  const raw = readField(doc, 'faq')
  if (!Array.isArray(raw)) return []
  const sources: PostFaqSource[] = raw.map((entry) => ({
    question: readRawText(readField(entry, 'question')),
    answer: readRawText(readField(entry, 'answer')),
  }))
  return faqItemsFrom(sources)
}

// ---------------------------------------------------------------------------
// Kurzus-CTA célja
// ---------------------------------------------------------------------------

/**
 * A cikk végi ajánló célja: a `ctaCourse` mezőn kapcsolt, POPULÁLT és
 * közzétett kurzus publikus adatai.
 */
export interface CourseCtaTarget {
  id: number
  slug: string | null
  sku: string | null
  displayTitle: string | null
  shortDescription: string | null
  priceInHUF: number | null
  priceInHUFEnabled: boolean | null
}

/**
 * A cikkhez kapcsolt kurzus, vagy null.
 *
 * Null-ra esik, ha nincs kapcsolás, ha a hivatkozás nincs populálva (nyers
 * id), vagy ha a kurzus NEM `published` — halott vagy archivált kurzusra
 * mutató ajánlót nem teszünk ki (a látogató 404-re vagy elérhetetlen
 * termékre futna). Ilyenkor a panel a kurzuslistára visz.
 */
export function courseCtaTargetOf(post: Post): CourseCtaTarget | null {
  const raw = readField(post, 'ctaCourse')
  if (!isRecord(raw)) return null
  const id = readNumber(raw.id)
  if (id === null) return null
  if (raw.status !== 'published') return null
  return {
    id,
    slug: readText(raw.slug),
    sku: readText(raw.sku),
    displayTitle: readText(raw.displayTitle),
    shortDescription: readText(raw.shortDescription),
    priceInHUF: readNumber(raw.priceInHUF),
    priceInHUFEnabled: typeof raw.priceInHUFEnabled === 'boolean' ? raw.priceInHUFEnabled : null,
  }
}

/**
 * A cikk végi ajánló VÁLTOZATA — témához igazítva (tulajdonosi döntés,
 * A fejléc „Kurzusok" navigációja (`Header.tsx`) NEM ide tartozik: az a
 */
export type PostCtaVariant = 'kurzus' | 'idopont'

export const APPOINTMENT_CTA_SLUGS: readonly string[] = ['befagyott-vall']

export function postCtaVariantOf(post: Pick<Post, 'slug'>): PostCtaVariant {
  return typeof post.slug === 'string' && APPOINTMENT_CTA_SLUGS.includes(post.slug)
    ? 'idopont'
    : 'kurzus'
}

/**
 * Az ingyenes belépő kurzus publikus adatai a cikk végi ajánlóhoz.
 *
 * Null-ra esik, ha nincs ilyen termék, ha nem `published`, vagy ha az
 * ár-pipa nem KIKAPCSOLT: „ingyenes" KIZÁRÓLAG a
 * `priceInHUFEnabled === false` (a beállítatlan NULL hiányos konfiguráció,
 * nem ingyenes ajánlat — lib/courses.ts, free-course-grant.ts).
 */
export function freeCourseCtaTargetOf(product: unknown): CourseCtaTarget | null {
  if (!isRecord(product)) return null
  const id = readNumber(product.id)
  if (id === null) return null
  if (product.status !== 'published') return null
  if (product.priceInHUFEnabled !== false) return null
  return {
    id,
    slug: readText(product.slug),
    sku: readText(product.sku),
    displayTitle: readText(product.displayTitle),
    shortDescription: readText(product.shortDescription),
    priceInHUF: readNumber(product.priceInHUF),
    priceInHUFEnabled: false,
  }
}
