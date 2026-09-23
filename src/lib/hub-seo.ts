import { resolveSeoKeywords, type SeoKeywordRow } from './seo-keywords'

/**
 * A gyökér tünet-hub (HUB_OLDALAK, src/lib/tudastar/hub-oldalak.ts) KÖZÖS
 * SEO-feloldólánca (modul-térkép H05, A20).
 *
 * A hub két dokumentumból áll: az Oldal (Oldalak) a publikálási kapcsoló és a
 * metaadat gazdája, a látható lap a Blogbejegyzés teljes cikkélménye. Korábban
 * a meta-leírás az Oldalból, a WebPage JSON-LD leírása a Blogbejegyzésből jött,
 * a meta-kulcsszavak az Oldalból, az Article kulcsszavai a Blogbejegyzésből:
 * ma a párok azonosak, de egy szerkesztés némán szétválasztotta volna őket.
 * A Google a meta-leírást és a strukturált adatot ugyanannak a lapnak a
 * leírásaként kezeli, és a strukturált adat nem mondhat mást, mint a lap
 * (Google Search Central, General structured data guidelines, „Relevance”:
 * https://developers.google.com/search/docs/appearance/structured-data/sd-policies;
 * Control your snippets: https://developers.google.com/search/docs/appearance/snippet).
 * Ezért a meta és a JSON-LD innen, EGY láncból kapja az értéket.
 *
 * - Leírás: az Oldal SEO-leírása → a Blogbejegyzés SEO-leírása → a
 *   Blogbejegyzés kivonata → az Oldal kivonata; az első nem üres, trimmelve.
 *   Az Oldal áll elöl, mert a hub metaadatát ma is az Oldal adja (a
 *   szerkesztői tájékoztató is ezt mondja), a forrásváltás a cikkre nem
 *   ennek a körnek a része (Ads-kapu, Search-lock: ugynok-kezikonyv.md 2.6, 5.6).
 * - Kulcsszavak: az Oldal SEO-kulcsszavai, ha a `resolveSeoKeywords` nem
 *   üreset ad belőlük; különben a Blogbejegyzéséi. A kulcsszavak TARTALMÁHOZ
 *   (Search-lock) ez a réteg nem nyúl, csak kiválasztja a forrást.
 */

/** Az Oldal és a Blogbejegyzés SEO-mezői, amennyi a lánchoz kell. */
export interface HubSeoDokumentum {
  seoDescription?: string | null
  excerpt?: string | null
  seoKeywords?: readonly SeoKeywordRow[] | null
}

export interface HubSeoForras {
  /** A meta-leírás és a WebPage JSON-LD leírása; `undefined`, ha minden forrás üres. */
  description: string | undefined
  /** A meta-kulcsszavak és az Article JSON-LD kulcsszavainak forrás-sorai. */
  keywords: SeoKeywordRow[] | null
}

function nemUres(value: string | null | undefined): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : undefined
}

/** A hub közös leírás- és kulcsszó-forrása (lásd a modul fejkommentjét). */
export function hubSeoForras({
  page,
  post,
}: {
  page: HubSeoDokumentum
  post: HubSeoDokumentum
}): HubSeoForras {
  const description =
    nemUres(page.seoDescription) ??
    nemUres(post.seoDescription) ??
    nemUres(post.excerpt) ??
    nemUres(page.excerpt)
  const keywordRows =
    resolveSeoKeywords(page.seoKeywords) !== undefined ? page.seoKeywords : post.seoKeywords
  return { description, keywords: keywordRows ? [...keywordRows] : null }
}
