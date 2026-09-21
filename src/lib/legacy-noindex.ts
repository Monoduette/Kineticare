/**
 * Örökölt, kódból már nem szolgált CMS-lap, amelyet a keresők és a gépi
 * olvasók elől el kell zárni, amíg a CMS-rekord közzétételét vissza nem
 * vonjuk (`demo-oldal-visszavonas` szabály, src/scripts/apply-owner-content.ts).
 *
 * A kód-deploy és az owner-content futás két külön éles lépés: a kettő közti
 * ablakban az általános oldal-útvonal (src/app/(frontend)/[slug]) a még
 * közzétett demólapot indexelhető oldalként adná, a sitemap és az llms.txt
 * pedig hirdetné (Devin, #278). Ezért a noindex és a feed-kizárás kódszinten
 * marad; a lista akkor üríthető, ha az éles adat igazoltan tiszta (a lap
 * piszkozat).
 *
 * A webcím ÉS a cím együtt azonosít (Codex, #278): ha a szerkesztő később egy
 * másik, valódi lapot tesz ugyanerre a webcímre, azt nem zárjuk el, ahogy a
 * visszavonó szabály sem vonja vissza (ugyanaz a cím-őr). Két ismert cím: az
 * eredeti demó-cím, és az, amire a szerkesztők 2026-09-20-án átnevezték
 * (mérve élesben: pages #16, a tartalma változatlanul a demó).
 */
export const LEGACY_DEMO_SLUG = 'akcios-kurzus'
export const LEGACY_DEMO_TITLES: ReadonlySet<string> = new Set([
  'Képzeletbeli akciós kurzus',
  'Akciós kézrehab kurzus',
])

export function isLegacyDemoTitle(title: unknown): boolean {
  return typeof title === 'string' && LEGACY_DEMO_TITLES.has(title.trim())
}

export function isLegacyNoindexPage(page: { slug?: unknown; title?: unknown }): boolean {
  return page.slug === LEGACY_DEMO_SLUG && isLegacyDemoTitle(page.title)
}
