/**
 * Tudástár lista-oldal — megjelenítési szabályok (tiszta függvények).
 * A `docs/tudastar-technikai-terv.md` 3.7 pontja ezt a szabályt az
 * `src/lib/tudastar.ts`-be tervezi (B-csomag). Az a modul ebben a körben más
 * csapat fájlja, ezért a lista-oldal a saját, azonos szerződésű függvényét
 * hozza. Ha a B-csomag megérkezik, ez a modul egy importcserével kiváltható.
 *
 * A modul SZÁNDÉKOSAN DB- és React-független: a szerver-oldali lap és a
 * kliens-oldali szűrő UGYANEZEKET a függvényeket futtatja, így a SSR-rel
 * kirajzolt szűrt lista és a kattintás utáni kliens-állapot nem térhet el.
 */

import type { Category, Post } from '../../payload-types'

/**
 * Megjelenjen-e a kategória-szűrő chip-sora.
 * Küszöb (`docs/ux-belso-oldalak-kutatas.md` B4.3): legalább HÁROM olyan
 * kategória van, amelyhez tartozik cikk, VAGY legalább ÖT cikk van a listán.
 * és plusz kattintási költséget. A szűrő értelme a választás szűkítése; ha
 * nincs mit szűkíteni, a sor csak elveszi a helyet a tartalom elől, és
 * lejjebb tolja az első kártyát a hajtás alá.
 */
export function shouldShowCategoryFilter(
  categoriesWithPostCount: number,
  postCount: number,
): boolean {
  return categoriesWithPostCount >= 3 || postCount >= 5
}

/** A Tudástár listájának útvonala; a kategória-nézeté a dedikált al-cím. */
export const BLOG_PATH = '/blog'
export const BLOG_CATEGORY_PREFIX = '/blog/kategoria/'

/** A poszt kategória-hivatkozásai id-ként (nyers szám VAGY populate-olt doksi). */
export function postCategoryIds(post: Pick<Post, 'categories'>): number[] {
  if (!Array.isArray(post.categories)) {
    return []
  }
  return post.categories
    .map((category) => (typeof category === 'object' && category !== null ? category.id : category))
    .filter((id): id is number => typeof id === 'number')
}

/**
 * A szűrő címe egy kategória-sluggal (undefined = „Összes”, azaz a lista).
 * Ez az EGYETLEN hely, ahol a chip href-je és a kliens-oldali `pushState`
 * címe képződik: a kettő így nem csúszhat szét (a megosztott link és a
 * kattintás utáni cím ugyanaz a kanonikus, sitemapben szereplő URL).
 */
export function categoryPath(slug: string | undefined): string {
  return slug === undefined ? BLOG_PATH : `${BLOG_CATEGORY_PREFIX}${slug}`
}

/**
 * Útvonal → kategória-slug (a `popstate` kezelőjének).
 *  - `/blog` (záró perjellel is) → undefined („Összes”);
 *  - `/blog/kategoria/<slug>` → a slug;
 *  - bármi más (pl. `/blog/<cikk>`, más lap) → null: NEM a szűrő címe, a
 *    kezelő nem nyúl az állapothoz. A lekérdezési rész (`?kategoria=`) nem
 *    számít: a kliens csak kanonikus címeket ír a history-ba.
 */
export function categorySlugFromPath(pathname: string): string | undefined | null {
  const path = pathname.replace(/\/+$/, '')
  if (path === BLOG_PATH) return undefined
  if (path.startsWith(BLOG_CATEGORY_PREFIX)) {
    const rest = path.slice(BLOG_CATEGORY_PREFIX.length)
    return rest.length > 0 && !rest.includes('/') ? decodeURIComponent(rest) : null
  }
  return null
}

/**
 * A látható állapotsor szövege (WCAG 2.2 SC 4.1.3 Status Messages: a szűrés
 * eredményét a képernyőolvasó fókuszváltás nélkül kapja meg; az Understanding
 * példája a „5 results returned” találatszám,
 * https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
 * Kettősponttal, névelő nélkül: a magyar névelő (a/az) a kategória nevétől
 * függene, és a „a Törés kategóriában” alak félrecsúszhat („az Ujj…”).
 */
export function filterStatusText(count: number, categoryTitle: string | null): string {
  return `${categoryTitle ?? 'Összes kategória'}: ${count} cikk`
}

/** Az aktív slughoz tartozó kategória (ismeretlen slugra null). */
export function findCategory<T extends Pick<Category, 'slug'>>(
  categories: readonly T[],
  slug: string | undefined,
): T | null {
  if (slug === undefined) return null
  return categories.find((category) => category.slug === slug) ?? null
}
