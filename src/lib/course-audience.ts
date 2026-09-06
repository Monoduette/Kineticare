/**
 * Kétirányú kurzusstruktúra — a kínálat két ága: „laikus" (otthoni gyakorlók)
 * és „szakember". Tiszta, DB- és Next-független logika, hogy a
 * course-audience.test.ts egységtesztelje; a frontend KIZÁRÓLAG ezeken a
 * függvényeken keresztül dönt arról, melyik sávba kerül egy kurzus.
 *
 * Mező-konvenció (products.audience, src/plugins/ecommerce.ts): select
 * ('laikus' | 'szakember'), defaultValue 'laikus', NEM kötelező — a mező
 * bevezetése ELŐTT létrehozott soroknál NULL marad. A megjelenítés ezért
 * sosem támaszkodhat az értékre: minden nem-'szakember' érték (null,
 * undefined, ismeretlen string) a laikus ágba esik.
 */

export type CourseAudience = 'laikus' | 'szakember'

/** A két ág megjelenő neve (admin-label és a felület egyaránt ezt használja). */
export const AUDIENCE_LABELS: Record<CourseAudience, string> = {
  laikus: 'Otthoni gyakorlóknak',
  szakember: 'Szakembereknek',
}

/**
 * Bármilyen bejövő érték normalizálása a két ág egyikére.
 * Minden nem-'szakember' érték → 'laikus' (a NULL-os régi sorok fallbackje).
 */
export function normalizeAudience(value: unknown): CourseAudience {
  return value === 'szakember' ? 'szakember' : 'laikus'
}

/** A csoportosítás eredménye: mindkét kulcs mindig létezik (üres tömbként is). */
export type CourseAudienceGroups<T> = Record<CourseAudience, T[]>

/**
 * Kurzusok szétosztása a két ág közé. A bejövő rendezést NEM borítja fel:
 * mindkét sávon belül a lista eredeti sorrendje marad (egyszeri bejárás,
 * sorrend-tartó push) — a lekérdezés `sort`-ja így végig érvényben marad.
 */
export function groupProductsByAudience<T extends { audience?: unknown }>(
  products: T[],
): CourseAudienceGroups<T> {
  const groups: CourseAudienceGroups<T> = { laikus: [], szakember: [] }
  for (const product of products) {
    groups[normalizeAudience(product.audience)].push(product)
  }
  return groups
}

/**
 * Egy sáv megjelenítési leírója. Az `anchorId` STABIL magyar horgony
 * (/kurzusok#otthoni, /kurzusok#szakembereknek), hogy a navigáció és a
 * kezdőlapi CTA-k később közvetlenül a sávra mutathassanak.
 */
export interface AudienceBand {
  audience: CourseAudience
  anchorId: string
  title: string
  /** Egymondatos felvezető a sáv alatt (a sáv „kinek szól" ígérete). */
  lead: string
}

/**
 * A sávok megjelenítési SORRENDJE: az otthoni (laikus) ág elöl — ez a szélesebb
 * közönség belépője, a szakmai továbbképzés utána következik.
 */
export const AUDIENCE_BANDS: readonly AudienceBand[] = [
  {
    audience: 'laikus',
    anchorId: 'otthoni',
    title: AUDIENCE_LABELS.laikus,
    lead: 'Otthon, egyedül is végezhető gyakorlatok a fájdalom enyhítésére, érthetően, szaknyelv nélkül.',
  },
  {
    audience: 'szakember',
    anchorId: 'szakembereknek',
    title: AUDIENCE_LABELS.szakember,
    lead: 'Szakmai továbbképzés gyógytornászoknak és terapeutáknak: protokollok, vizsgálati technikák, esetek.',
  },
]
