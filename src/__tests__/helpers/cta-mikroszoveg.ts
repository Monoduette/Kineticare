/**
 * CTA mikroszöveg-ellenőrző segéd: tiltott írásjelek (em dash, en dash),
 * folyamatban-felirat három pontja, felirat-normalizálás a szótár-őrhöz.
 */
export const EM_DASH = String.fromCharCode(0x2014)

/** U+2013 — nagykötőjel / gondolatjel. Gomb-, menü- és címkeszövegben tiltott (§3.1.2). */
export const EN_DASH = String.fromCharCode(0x2013)

/** U+2026 — a folyamatban-feliratok három pontja (nem három darab pont). */
export const ELLIPSIS = String.fromCharCode(0x2026)

/**
 * M-7 — a puszta, célt nem nevező feliratok. Kiegészítés nélkül egyik sem lehet
 * CTA: „a link ígéret" (NN/g), és a puszta „Tovább" nem mondja meg, mit ígér.
 *
 * A lista a §3.2 M-7 pontjából származik; a G-UI1 a szótárra, a G-UI2 a
 * termék élő feliratára alkalmazza.
 */
export const BARE_FORBIDDEN_LABELS: readonly string[] = [
  'tovább',
  'küldés',
  'ok',
  'mehet',
  'kattints ide',
  'bővebben',
  'részletek',
  'submit',
]

/** A felirat záró írásjeleitől megtisztított, kisbetűs alakja (a puszta-szó vizsgálathoz). */
export function pusztaAlak(felirat: string): string {
  return felirat.toLocaleLowerCase('hu').replace(/[.…!?]+$/u, '')
}
