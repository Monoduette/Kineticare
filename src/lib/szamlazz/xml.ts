/**
 * Közös XML-segéd a Számla Agent kérés-építőkhöz (invoice / storno / pdf).
 * Külön modulban él, hogy a lekérdező (pdf.ts) és a kiállító (invoice.ts)
 * között ne alakuljon ki körkörös import.
 */

/**
 * Az XML 1.0 `Char` produkcióján KÍVÜL eső kódpontok
 * (https://www.w3.org/TR/xml/#charsets): a C0-vezérlők a TAB/LF/CR
 * kivételével, a magányos surrogate-ek, valamint az U+FFFE és az U+FFFF.
 * Ezek escape-eléssel sem menthetők: a dokumentum nem jól formált, a Számla
 * Agent XML-elemzője 57-es „XML beolvasási hibával" utasítja el, és a
 * számla végleges `failed`-be fut.
 */
const XML_1_0_ILLEGAL_CHARS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu

/**
 * XML-escape a dinamikus értékekhez.
 *
 * EGYETLEN kapu a számla, a helyesbítő, a stornó és a lekérdezés minden
 * dinamikus mezőjéhez: az XML 1.0-ban tiltott karaktereket ELŐBB elhagyja,
 * utána escape-el. Így a már eltárolt rendelések vevőadata és a stáb által
 * beírt szöveg (tételnév, visszatérítési indok) sem tehet jólformálatlanná egy
 * kérést. A pénztár ugyanezeket a karaktereket már a bevitelnél kiszűri
 * (src/lib/checkout/billing.ts, normalizeText), hogy egy csak ilyenekből álló
 * név ne jusson át a hosszellenőrzésen, és ne üres <nev> menjen ki.
 */
export function escapeXml(value: string): string {
  return value
    .replace(XML_1_0_ILLEGAL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * A kelt-dátum és az alak-kapu a közös `src/lib/date/budapest.ts` modulból
 * jön (a statisztika-aggregátor is EZT használja, hogy a hónapforduló
 * Budapest szerint essen). A szamlazz-tesztek változatlanul innen importálnak.
 */
export { budapestDateString, isIsoDateString } from '../date/budapest'
