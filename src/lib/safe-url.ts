import { hasControlCharacter } from './return-url'

/**
 * CMS-ből érkező URL-ek allowlist-alapú tisztítása (CTA, menü, richText).
 *
 * Engedélyezett: https/http/mailto, gyökér-relatív (/…), horgony (#…). Tiltott: //host,
 * data:/tel:/javascript:, vezérlőkarakter, backslash. `null` = nincs href.
 * Mentéskor validateCmsUrl magyar üzenettel elutasít; sanitizeCmsUrl rendereléskor is fut.
 */

/** A href-ként rendereltethető abszolút sémák. */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['https:', 'http:', 'mailto:'])

/**
 * A `\` (backslash) a relatív ágon TILOS.
 *
 * A böngésző URL-értelmezője a relatív feloldáskor a backslasht perjelként
 * kezeli, ezért a `/\idegen.host` ugyanoda visz, mint a `//idegen.host` — a
 * puszta `startsWith('//')` vizsgálat tehát megkerülhető lenne.
 */
function hasBackslash(value: string): boolean {
  return value.includes('\\')
}

/**
 * Egy CMS-ből érkező webcím tisztítása; `null`, ha nem renderelhető href-ként.
 *
 * A bemenet szándékosan `unknown`: a Lexical-csomópontok mezői típus nélkül
 * érkeznek, és a hiányzó/nem szöveg érték ugyanúgy „nincs link", mint a tiltott
 * séma — a hívóknak nem kell előszűrniük.
 */
export function sanitizeCmsUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  // Vezérlőkarakter belül is tiltott — a böngésző másképp normalizálhatja.
  if (hasControlCharacter(trimmed)) {
    return null
  }

  // Lapon belüli horgony. Sémát nem vihet be, de a csupasz '#' nem visz sehová
  // (üres cél), ezért az sem renderelhető linkként.
  if (trimmed.startsWith('#')) {
    return trimmed.length > 1 && !hasBackslash(trimmed) ? trimmed : null
  }

  // Gyökér-relatív útvonal — azonos eredet.
  if (trimmed.startsWith('/')) {
    return !trimmed.startsWith('//') && !hasBackslash(trimmed) ? trimmed : null
  }

  // Innentől csak abszolút, sémás URL jöhet szóba. A séma vizsgálata a
  // FELDOLGOZOTT értéken történik: a `java<TAB>script:` alakot a vezérlőkarakter
  // -szűrő már kizárta, de a kis/nagybetűs és százalék-kódolt változatokat is a
  // parser normalizálja — nyers szövegre illesztett minta ezt nem tenné meg.
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    // Séma nélküli relatív útvonal ('kurzusok/12') vagy hibás alak ('https://').
    return null
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return null
  }

  // A 'mailto:' önmagában érvényes URL, de címzett nélkül üres linket adna.
  if (parsed.protocol === 'mailto:' && parsed.pathname.length === 0) {
    return null
  }

  // Abszolút URL: normalizált href — a külső/belső ág ezt várja.
  return parsed.href
}

/**
 * A szerkesztőnek szóló, MAGYAR hibaüzenet a tiltott alakú webcímre.
 *
 * Nem „hibás formátum", hanem MEGMONDJA, mi a jó alak — a szerkesztő nem
 * fejlesztő, a puszta elutasításból nem tudná, mit gépeljen helyette.
 */
export const CMS_URL_VALIDATION_MESSAGE =
  'Ez a webcím nem használható. Saját oldalra a perjellel kezdődő rész való (pl. /kurzusok), ' +
  'másik weboldalra a teljes cím https://-sel kezdve (pl. https://pelda.hu), e-mail-címhez ' +
  'mailto:valaki@pelda.hu, lapon belüli ugráshoz pedig #horgony.'

/** Kötelező, de üresen hagyott webcím üzenete. */
export const CMS_URL_REQUIRED_MESSAGE = 'A webcím megadása kötelező.'

/**
 * Payload `validate` CMS webcím-mezőkhöz — mentéskor magyar hibaüzenet.
 * A renderelés-oldali sanitizeCmsUrl régi rekordokra is kell; a kettő együtt fed.
 * Payload: saját required csak validate nélkül fut — kötelezőséget itt is kezeljük.
 */
export function validateCmsUrl(value: unknown, options: { required?: boolean } = {}): string | true {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)

  if (isEmpty) {
    // Az ÜRES érték ott marad érvényes, ahol a mező nem kötelező — a
    // szerkesztőnek nem kell kitöltenie minden opcionális gomb-célt.
    return options.required ? CMS_URL_REQUIRED_MESSAGE : true
  }

  return sanitizeCmsUrl(value) === null ? CMS_URL_VALIDATION_MESSAGE : true
}
