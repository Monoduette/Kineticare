/**
 * Örökölt, kódból már nem szolgált CMS-webcímek, amelyeket a keresők és a
 * gépi olvasók elől el kell zárni, amíg a CMS-rekord közzétételét vissza nem
 * vonjuk (`demo-oldal-visszavonas` szabály, src/scripts/apply-owner-content.ts).
 *
 * A kód-deploy és az owner-content futás két külön éles lépés: a kettő közti
 * ablakban az általános oldal-útvonal (src/app/(frontend)/[slug]) a még
 * közzétett „Képzeletbeli akciós kurzus” lapot indexelhető oldalként adná, a
 * sitemap és az llms.txt pedig hirdetné (Devin, #278). Ezért a noindex és a
 * feed-kizárás kódszinten marad; a lista akkor üríthető, ha az éles adat
 * igazoltan tiszta (a lap piszkozat).
 */
export const LEGACY_NOINDEX_SLUGS: ReadonlySet<string> = new Set(['akcios-kurzus'])

export function isLegacyNoindexSlug(slug: unknown): boolean {
  return typeof slug === 'string' && LEGACY_NOINDEX_SLUGS.has(slug)
}
