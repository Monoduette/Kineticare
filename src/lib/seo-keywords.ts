/**
 * CMS `seoKeywords` — szerkeszthető keresőszavak, amik a HTML-forrásba mennek.
 *
 * A mező a `posts` és a `pages` kollekción él (lásd `src/fields/seo-keywords.ts`).
 * A nyilvános lapon NEM jelenik meg külön listaként: a kifejezések a
 * JSON-LD `keywords` kulcsába és a `<meta name="keywords">` tagbe kerülnek.
 * Üres mezőnél mindkettő kimarad — H1-ből vagy más látható szövegből
 * kulcsszót kitalálni tilos.
 */

/** Egyezzen a Payload-mező `maxRows` értékével. */
export const SEO_KEYWORDS_MAX_ROWS = 12

/** Egy CMS-sor a `seoKeywords` tömbből. */
export interface SeoKeywordRow {
  phrase?: string | null
  id?: string | null
}

function trimmedPhrase(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

/**
 * A CMS-mezőből a forráskódba írható kifejezések.
 *
 * Trimmel, üreset eldob, ismétlést kiszűr, a `maxRows` plafonnál megáll.
 * Érvényes tétel híján `undefined` — a hívó így tudja kihagyni a meta-taget
 * és a JSON-LD kulcsot, üres `keywords=""` nélkül.
 */
export function resolveSeoKeywords(
  rows: readonly SeoKeywordRow[] | null | undefined,
): string[] | undefined {
  const unique = new Set<string>()
  const phrases: string[] = []
  for (const row of rows ?? []) {
    const phrase = trimmedPhrase(row?.phrase)
    if (phrase === undefined || unique.has(phrase)) {
      continue
    }
    unique.add(phrase)
    phrases.push(phrase)
    if (phrases.length === SEO_KEYWORDS_MAX_ROWS) {
      break
    }
  }
  return phrases.length > 0 ? phrases : undefined
}
