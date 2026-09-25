import { isSzamlazzVatMode, szamlazzVatModes } from '../../env'
import { createLogger } from '../logger'
import { SzamlazzApiError, type SzamlazzAgentError, type SzamlazzClientConfig } from './types'

/**
 * Számlázz.hu Számla Agent kliensmag (T-024/W4-01): környezetfeloldás,
 * timeoutos HTTP-hívás, a valaszVerzio=2 XML-válasz és a szlahu_* fejlécek
 * értelmezése, strukturált hibakezelés és titokmentes naplózás.
 *
 * KÖTELEZŐEN OPCIONÁLIS: a SZAMLAZZ_AGENT_KEY hiánya NEM indulási hiba —
 * a számlázás ekkor kikapcsolt (enabled=false), a fizetési lánc ettől
 * változatlanul működik. (A Barion-klienstől eltérően itt nincs assert:
 * a számlázás üzletileg kiegészítő, nem a fizetés előfeltétele.)
 *
 * Titokvédelem: az agent-kulcs kizárólag az XML-bodyba kerül (sosem URL-be);
 * a naplóba sem kérés-, sem válasz-body nem kerül. A logger redact-listája az
 * 'apikey' kulcsot amúgy is maszkolja.
 */

/**
 * A hivatalos Agent-végpont — ZÁRÓ PERJELLEL (https://www.szamlazz.hu/szamla/).
 * A perjel nélküli alakra a szerver átirányíthat, és egy 301/302-es redirectet
 * a fetch GET-ként követne: a multipart törzs (benne az XML) elveszne, a hívás
 * pedig 53-as „Hiányzó XML fájl" hibába futna.
 */
export const SZAMLAZZ_DEFAULT_API_URL = 'https://www.szamlazz.hu/szamla/'
export const SZAMLAZZ_DEFAULT_TIMEOUT_MS = 15_000
/**
 * A kérés-timeout FELSŐ korlátja (a-szamlazz-11, a-refund-14). A számla-,
 * stornó- és helyesbítő-hívás egy advisory-zár tranzakcióján BELÜL fut, amelyet
 * a Postgres `idle_in_transaction_session_timeout` (60 s) leöl; a refund-panel
 * pedig 30 s-ig vár a szerverre, amely sorban GetState + Refund + bizonylat
 * hívásokat végez. Egy 15 s fölé állított `SZAMLAZZ_TIMEOUT_MS` így a zár
 * elvesztéséhez (második beküldő) és téves „bizonytalan" panel-üzenethez
 * vezetne — a konfig ezért ezt az értéket némán levágja.
 */
export const SZAMLAZZ_MAX_TIMEOUT_MS = 15_000
export const SZAMLAZZ_DEFAULT_INVOICE_PREFIX = 'KIN'

/**
 * Hivatalos hibakód-osztályozás (docs.szamlazz.hu/hu/agent/basics/error-handling):
 * - '1' — rendszerkarbantartás: pár perc múlva újrapróbálható.
 * - '55' — „E-számla aláírása sikertelen … az időbélyegző szerverhez nem
 *   lehetett kapcsolódni": a szolgáltató oldali kiesés a tudástár szerint
 *   („sikertelen-szamlakeszites-kezelese") egy idő után magától megszűnik,
 *   ezért ÚJRAPRÓBÁLHATÓ. Ha mégis a lejárt tanúsítvány az ok, a perzisztens
 *   5-ös beküldési plafon állítja meg (utána RIASZTÁS és kézi rendezés).
 * - Minden más agent-kód végleges: auth/fiók (3, 135, 136, 164), kérésformátum
 *   (53, 57), e-számla-engedély (54), előtag (202), tétel-matematika
 *   (259–264). Ezekre az újraküldés ugyanazt a hibát adná, a max. 5 beküldés
 *   keretét pedig feleslegesen égetné.
 * - '71'/'152' — „Már létező rendelésszám": nem hiba, hanem idempotencia-
 *   találat (kind: 'duplicate') — a hívó a szamlaKulsoAzon-lekérdezéssel veszi
 *   át a meglévő bizonylat számát.
 * - '56' — a számlaértesítő e-mail kézbesítése sikertelen: lásd
 *   SZAMLAZZ_NOTIFICATION_FAILED_CODE.
 */
export const SZAMLAZZ_RETRYABLE_AGENT_CODES: ReadonlySet<string> = new Set(['1', '55'])
export const SZAMLAZZ_DUPLICATE_AGENT_CODES: ReadonlySet<string> = new Set(['71', '152'])

/**
 * 56 — „a számlaértesítő kézbesítése sikertelen". A hivatalos PHP SDK
 * (PHPApiAgent 2.12.4, InvoiceResponse::isError) szerint ha a válasz
 * számlaszámot is hoz, „akkor a számla kiállítása sikeres": a bizonylat
 * létezik és a NAV-hoz is bejelentésre került, csak a vevő nem kapta meg a
 * levelet. Ilyenkor SIKERként kezeljük (a hívó RIASZTÁST ír a kézi
 * újraküldéshez). Számlaszám NÉLKÜL a kimenet bizonytalan: újrapróbálható
 * hiba, és a következő kísérlet a beküldés ELŐTTI szamlaKulsoAzon-lekérdezéssel
 * veszi át a bizonylatot, ha az mégis elkészült.
 */
export const SZAMLAZZ_NOTIFICATION_FAILED_CODE = '56'

/**
 * Átmeneti HTTP-státuszok: 408 (kérés-időtúllépés), 425 (túl korai), 429
 * (sebességkorlát; a hivatalos hálózati oldal szerinti bejövő címtartományok
 * egy CDN-szolgáltató publikus tartományai, amely sebességkorlátnál 429-et
 * ad) és minden 5xx. Ezekre az újrapróbálás a helyes válasz; minden más 4xx
 * végleges.
 */
export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/** 71/152 — a Számlázz.hu duplikátum-jelzése (idempotencia-találat, nem hiba). */
export function isDuplicateOrderError(error: unknown): error is SzamlazzApiError {
  return error instanceof SzamlazzApiError && error.kind === 'duplicate'
}

const logger = createLogger({ module: 'szamlazz' })

/** A Számlázz-konfig env-felülete (mind opcionális) — teszteléshez paraméterezhető. */
export interface SzamlazzEnv {
  SZAMLAZZ_AGENT_KEY?: string
  SZAMLAZZ_API_URL?: string
  SZAMLAZZ_INVOICE_PREFIX?: string
  SZAMLAZZ_AFAKULCS?: string
  SZAMLAZZ_TIMEOUT_MS?: string
  [key: string]: string | undefined
}

function readEnv(env: SzamlazzEnv, key: string): string | undefined {
  const value = env[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function parseTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return SZAMLAZZ_DEFAULT_TIMEOUT_MS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SZAMLAZZ_DEFAULT_TIMEOUT_MS
  }
  return Math.min(parsed, SZAMLAZZ_MAX_TIMEOUT_MS)
}

/**
 * Beágyazott hitelesítő adat maszkolása a hibaüzenetben (`//user:pass@` →
 * `//***@`). A hibaüzenet naplóba és képernyőre is kerülhet — egy elgépelt,
 * jelszót tartalmazó URL-t nem szabad ott kiírni.
 */
function maskUrlCredentials(raw: string): string {
  return raw.replace(/\/\/[^/@\s]*@/, '//***@')
}

function invalidApiUrlError(rawApiUrl: string): Error {
  return new Error(
    `Számlázz.hu-konfigurációs hiba: a SZAMLAZZ_API_URL nem érvényes https URL ` +
      `('${maskUrlCredentials(rawApiUrl)}'). Az alapértelmezett érték: ${SZAMLAZZ_DEFAULT_API_URL}.`,
  )
}

/**
 * Be van-e KAPCSOLVA a Számlázz.hu-integráció? Csak a kapcsolót
 * (`SZAMLAZZ_AGENT_KEY` megléte) nézi, és SOSEM DOB.
 *
 * MIÉRT KÜLÖN FÜGGVÉNY (2026-08-17). A `getSzamlazzConfig` szándékosan dob
 * hibás konfigurációnál (elgépelt API-URL, hiányzó áfakulcs) — a SZÁMLÁZÁSI
 * műveleteknél pont ez a helyes: ott a hangos hiba a cél. Van viszont hívási
 * hely, ahol csak az „lesz-e egyáltalán számla?" eldöntendő kérdés a tét, és
 * ott a dobás KÁRT okoz: a rendelés-visszaigazoló levél best-effort
 * try/catch-ében (src/lib/order-paid.ts) egy számlázási konfighiba az EGÉSZ
 * levelet elvinné — pedig a levél a fizetés egyetlen visszajelzése a vevő felé,
 * és a levélnek semmi köze a számla áfakulcsához. Egy MELLÉKES kérdést nem
 * szabad olyan függvénnyel eldönteni, amelyik a FŐ folyamatot is elviheti.
 *
 * A visszaadott igaz érték ígéret marad akkor is, ha a konfig egyébként hibás:
 * a számla a job újrapróbálásából, illetve az order-poll resweep-jéből a
 * konfig javítása után is kiáll — a levélben tett „a számlát külön küldjük"
 * mondat tehát nem válik hazuggá.
 */
export function isSzamlazzEnabled(env: SzamlazzEnv = process.env): boolean {
  return readEnv(env, 'SZAMLAZZ_AGENT_KEY') !== undefined
}

/**
 * Környezetfeloldás. SZAMLAZZ_AGENT_KEY nélkül enabled=false (kikapcsolt
 * számlázás). Érvénytelen SZAMLAZZ_API_URL esetén dob — az elgépelt végpont
 * ne csendben működjön. Tiszta függvény (teszteléshez env-paraméteres).
 *
 * FIGYELEM: ez a függvény DOBHAT. Ha csak a be/ki állapot kell, használd az
 * `isSzamlazzEnabled`-et — különösen olyan ágon, ahol a hiba elnyelődne.
 */
export function getSzamlazzConfig(env: SzamlazzEnv = process.env): SzamlazzClientConfig {
  const agentKey = readEnv(env, 'SZAMLAZZ_AGENT_KEY')
  const rawApiUrl = readEnv(env, 'SZAMLAZZ_API_URL') ?? SZAMLAZZ_DEFAULT_API_URL

  let parsed: URL
  try {
    parsed = new URL(rawApiUrl)
  } catch {
    throw invalidApiUrlError(rawApiUrl)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    // A hitelesítő adat az URL-ben nemcsak felesleges (az agent-kulcs az
    // XML-törzsben utazik), hanem szivárgásveszélyes is: proxykon, naplókban,
    // Referer-fejlécben végigmenne. Inkább hangos hiba, mint csendes titok.
    throw new Error(
      'Számlázz.hu-konfigurációs hiba: a SZAMLAZZ_API_URL nem tartalmazhat beágyazott ' +
        'felhasználónevet vagy jelszót (https://felhasznalo:jelszo@… alak). Töröld a ' +
        'hitelesítő adatot az URL-ből — a Számla Agent kulcs kizárólag az XML-törzsben utazik.',
    )
  }
  if (parsed.protocol !== 'https:') {
    throw invalidApiUrlError(rawApiUrl)
  }
  // Pontosan EGY záró perjel — perjel nélkül a POST egy redirecten GET-té
  // silányulhat (a multipart törzs elveszne), dupla perjel pedig zaj.
  // A query string MEGMARAD: egy proxy-végpont ('…/agent?env=test') elhagyott
  // paramétere csendben ÉLES bizonylatot állíttatna ki teszt-szándék mellett.
  // (A fragment szándékosan kimarad — a hálózatra amúgy sem megy ki.)
  const normalizedApiUrl = parsed.origin + parsed.pathname.replace(/\/*$/, '/') + parsed.search

  /**
   * ÁFAKULCS — élesben KÖTELEZŐ, alapértelmezés nélkül.
   *
   * MIÉRT NINCS CSENDES ALAPÉRTELMEZÉS (2026-08-17): korábban a hiányzó kulcs
   * némán `'27'`-re esett. Egy alanyi adómentes eladónál ez a legrosszabb fajta
   * hiba: nem száll el semmi, nem naplóz semmit, csak minden kiállított számla
   * rossz áfakulccsal megy ki, és a bizonylat utólag csak helyesbítővel
   * javítható. Egy adószámot senki nem gépel be „véletlenül helyesen" —
   * az áfakulcsot viszont pont ilyen könnyű elfelejteni.
   *
   * A szigor CSAK akkor él, ha a számlázás TÉNYLEG be van kapcsolva (van
   * agent-kulcs). Kikapcsolt számlázásnál nincs bizonylat, tehát nincs mit
   * elrontani — a fejlesztői és teszt-környezetek így nem kényszerülnek egy
   * olyan érték megadására, aminek ott semmi szerepe.
   */
  const rawVatMode = readEnv(env, 'SZAMLAZZ_AFAKULCS') ?? (agentKey === undefined ? '27' : null)
  if (rawVatMode === null) {
    throw new Error(
      'Számlázz.hu-konfigurációs hiba: a SZAMLAZZ_AFAKULCS nincs beállítva, ' +
        'miközben a számlázás be van kapcsolva (van SZAMLAZZ_AGENT_KEY). ' +
        `Add meg kifejezetten: ${szamlazzVatModes.map((mode) => `'${mode}'`).join(' vagy ')}. ` +
        'Alanyi adómentes eladóként az „AAM” a jogszerű, általános áfás esetben a „27”. ' +
        'Alapértelmezést itt SZÁNDÉKOSAN nem adunk: a rossz áfakulcs minden ' +
        'számlát elront, és utólag csak helyesbítő számlával javítható.',
    )
  }
  if (!isSzamlazzVatMode(rawVatMode)) {
    // Hangos hiba: egy elgépelt áfakulcs minden számlát rossz kulccsal állítana
    // ki — azt nem szabad csendben az alapértelmezésre ejteni. (Ugyanez a
    // kulcs INDULÁSKOR is ellenőrződik, lásd src/env.ts assertRequiredEnv.)
    throw new Error(
      `Számlázz.hu-konfigurációs hiba: a SZAMLAZZ_AFAKULCS értéke csak ` +
        `${szamlazzVatModes.map((mode) => `'${mode}'`).join(' vagy ')} lehet ('${rawVatMode}'). ` +
        `Alanyi adómentes eladóként az 'AAM' a jogszerű, általános áfás esetben a '27'.`,
    )
  }

  return {
    // EGY forrásból: a be/ki állapot definíciója az `isSzamlazzEnabled`-ben él,
    // hogy a két hívási út ne csúszhasson szét egy későbbi módosításnál.
    enabled: isSzamlazzEnabled(env),
    apiUrl: normalizedApiUrl,
    ...(agentKey ? { agentKey } : {}),
    invoicePrefix: readEnv(env, 'SZAMLAZZ_INVOICE_PREFIX') ?? SZAMLAZZ_DEFAULT_INVOICE_PREFIX,
    vatMode: rawVatMode,
    timeoutMs: parseTimeoutMs(readEnv(env, 'SZAMLAZZ_TIMEOUT_MS')),
  }
}

// ---------------------------------------------------------------------------
// Válasz-értelmezés (valaszVerzio=2 XML + szlahu_* fejlécek)
// ---------------------------------------------------------------------------

const XML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

/** Az XML-entitások (nevesített és numerikus) feloldása egy szövegrészben. */
function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (match, entity: string) => {
    const named = XML_NAMED_ENTITIES[entity]
    if (named !== undefined) {
      return named
    }
    if (!entity.startsWith('#')) {
      return match
    }
    const codePoint = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10)
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match
  })
}

/**
 * Egy elem belsejének SZÖVEGES értéke: a CDATA-szakaszok tartalma betű
 * szerint, a többi rész entitás-feloldva.
 *
 * MIÉRT KELL: a valódi Agent-válaszok a vevői fiók URL-jét és a hibaüzenetet
 * CDATA-ba csomagolják (`<vevoifiokurl><![CDATA[https://…]]></vevoifiokurl>`,
 * a hivatalos hibaminta `<hibauzenet><![CDATA[…]]></hibauzenet>`). Nyers
 * belső szöveggel a link a `<![CDATA[` jelöléssel együtt került volna az
 * allowlist elé (és bukott el), egy CDATA-s `7`-es hibakódot pedig a
 * lekérdezés nem ismert volna fel „nincs találat"-ként.
 */
function xmlText(inner: string): string {
  let result = ''
  let cursor = 0
  for (const match of inner.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    result += decodeXmlEntities(inner.slice(cursor, match.index)) + (match[1] ?? '')
    cursor = match.index + match[0].length
  }
  result += decodeXmlEntities(inner.slice(cursor))
  return result.trim()
}

/**
 * Egy XML-tag összes előfordulásának szöveges értéke, dokumentum-sorrendben.
 * Az elem attribútumot is hordozhat; az önzáró alak (`<tag/>`) üres érték. A
 * záró taget CDATA-n KÍVÜL keressük, így a CDATA-ban álló `</tag>` sem zárja
 * le idő előtt az elemet. Lineáris bejárás, visszalépő regex nélkül: egy
 * lezáratlan elemet tartalmazó, sérült válasz sem okozhat elszálló futásidőt.
 */
function tagValues(xml: string, tag: string): string[] {
  const values: string[] = []
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g')
  const close = new RegExp(`</${tag}\\s*>`, 'g')
  let opening = open.exec(xml)
  while (opening !== null) {
    if (opening[0].endsWith('/>')) {
      values.push('')
      opening = open.exec(xml)
      continue
    }
    const start = opening.index + opening[0].length
    let cursor = start
    let end = -1
    for (;;) {
      close.lastIndex = cursor
      const closing = close.exec(xml)
      if (!closing) {
        break
      }
      const cdata = xml.indexOf('<![CDATA[', cursor)
      if (cdata >= 0 && cdata < closing.index) {
        const cdataEnd = xml.indexOf(']]>', cdata + 9)
        if (cdataEnd < 0) {
          break
        }
        cursor = cdataEnd + 3
        continue
      }
      end = closing.index
      open.lastIndex = closing.index + closing[0].length
      break
    }
    if (end < 0) {
      break
    }
    values.push(xmlText(xml.slice(start, end)))
    opening = open.exec(xml)
  }
  return values
}

/**
 * Egy XML-tag értékének kinyerése (első előfordulás). Exportált: a
 * számlaadat-lekérdezés (invoice-data.ts) a <szamla> dokumentumot ugyanezzel a
 * CDATA-tudatos olvasóval járja be.
 */
export function tagValue(xml: string, tag: string): string | undefined {
  return tagValues(xml, tag)[0]
}

/** Összes hibakod/hibauzenet pár kinyerése — <hiba>-blokkonként vagy laposan. */
function extractAgentErrors(xml: string): SzamlazzAgentError[] {
  const errors: SzamlazzAgentError[] = []
  const hibaBlocks = xml.match(/<hiba(?:\s[^>]*)?>[\s\S]*?<\/hiba\s*>/g)
  if (hibaBlocks && hibaBlocks.length > 0) {
    for (const block of hibaBlocks) {
      errors.push({
        code: tagValue(block, 'hibakod') || 'Ismeretlen',
        message: tagValue(block, 'hibauzenet') ?? '',
      })
    }
    return errors
  }
  // Lapos forma: közvetlen <hibakod>/<hibauzenet> a gyökérben.
  const flatCode = tagValue(xml, 'hibakod')
  if (flatCode !== undefined) {
    errors.push({ code: flatCode || 'Ismeretlen', message: tagValue(xml, 'hibauzenet') ?? '' })
  }
  return errors
}

/** Az azonos (kód + üzenet) hibapárok kiszűrése, az első előfordulás sorrendjében. */
function uniqueAgentErrors(errors: SzamlazzAgentError[]): SzamlazzAgentError[] {
  const seen = new Set<string>()
  return errors.filter((entry) => {
    const key = `${entry.code.trim()}\u0000${entry.message}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function isTruthyHeader(value: string | null): value is string {
  return (
    value !== null &&
    value.trim() !== '' &&
    value.trim() !== '0' &&
    value.trim().toLowerCase() !== 'false'
  )
}

/**
 * A `szlahu_error` fejléc értéke URL-KÓDOLT (hivatalos A6 követelmény).
 * Dekódolás nélkül a hibaüzenet a rendelés `*LastError` mezőjébe is így kerül,
 * és az ügyintéző `Sikertelen+bejelentkez%C3%A9s`-t lát a magyar mondat helyett.
 * Hibás kódolásnál (URIError) a NYERS érték marad — a hibaüzenet elveszni nem
 * fog, csak olvashatatlanabb.
 */
function decodeHeaderValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/**
 * URL-értékű fejléc dekódolása (`szlahu_vevoifiokurl`). A hivatalos PHP SDK
 * `rawurldecode`-dal olvassa: a `+` itt NEM szóköz (egy URL query-stringjében
 * jelentése van), ezért a `decodeHeaderValue` szabálya nem alkalmazható.
 */
function decodeUrlHeaderValue(value: string): string {
  try {
    return decodeURIComponent(value.trim())
  } catch {
    return value.trim()
  }
}

/**
 * Agent-hiba a hibakódok hivatalos osztályozásával: 71/152 → 'duplicate'
 * (idempotencia-találat, a hívó lekérdezéssel oldja fel); '1' és '55' →
 * retryable (karbantartás, időbélyeg-szolgáltatás); minden más végleges
 * 'agent' hiba.
 */
function agentErrorFromCodes(message: string, agentErrors: SzamlazzAgentError[]): SzamlazzApiError {
  const codes = agentErrors.map((entry) => entry.code.trim())
  const duplicate = codes.some((code) => SZAMLAZZ_DUPLICATE_AGENT_CODES.has(code))
  const retryable = !duplicate && codes.some((code) => SZAMLAZZ_RETRYABLE_AGENT_CODES.has(code))
  return new SzamlazzApiError({
    message,
    kind: duplicate ? 'duplicate' : 'agent',
    agentErrors,
    retryable,
  })
}

/**
 * Bizonytalan kimenetű válasz: a bizonylat vagy elkészült, vagy nem, a
 * válaszból ez nem dönthető el. ÚJRAPRÓBÁLHATÓ — a számla- és a
 * helyesbítő-ág a következő beküldés ELŐTT szamlaKulsoAzon-lekérdezéssel
 * nézi meg, létezik-e már a bizonylat, a beküldéseket pedig a perzisztens
 * 5-ös plafon fogja. (A stornó-ág retryable hibán RIASZTÁST ír és nem küld
 * újra — ott ez a kézi ellenőrzés jelzése.)
 */
function uncertainResponseError(
  message: string,
  agentErrors: SzamlazzAgentError[] = [],
): SzamlazzApiError {
  return new SzamlazzApiError({ message, kind: 'invalid_response', agentErrors, retryable: true })
}

/**
 * Bizonylatszám-alak ellenőrzése: nem üres, nincs benne jelölő- vagy
 * vezérlőkarakter, és ésszerű hosszú. Egy sérült vagy manipulált válasz így
 * nem kerülhet számlaszámként a rendelésre.
 */
function isPlausibleDocumentNumber(value: string): boolean {
  return value.length > 0 && value.length <= 100 && !/[<>\u0000-\u001f]/.test(value)
}

export interface SzamlazzParsedSuccess {
  szamlaszam: string
  /** Vevői fiók URL (ha a Számlázz.hu adja) — a rendelés invoicePdfUrl mezőjéhez. */
  vevoifiokUrl?: string
  /**
   * A bizonylat nettó és bruttó végösszege a válasz törzséből (`szamlanetto` /
   * `szamlabrutto`, xs:double; stornón és helyesbítőn negatív). Csak akkor
   * van kitöltve, ha a törzsben véges szám áll. A lekérdezés (pdf.ts) ebből
   * dönti el, hogy a talált bizonylat a MI rendelésünké-e (a-szamlazz-5).
   */
  szamlanetto?: number
  szamlabrutto?: number
  /**
   * 56-os jelzés: a bizonylat KIÁLLT, de a számlaértesítő e-mail nem ment ki a
   * vevőnek. A hívó RIASZTÁST ír, hogy a levelet kézzel újra lehessen küldeni.
   */
  notificationError?: SzamlazzAgentError
}

/**
 * A Számla Agent válasz értelmezése. Siker esetén a számlaszám (és a vevői
 * fiók URL, ha adott); minden hibaág strukturált SzamlazzApiError.
 *
 * Sorrend:
 * 1. szlahu_down (karbantartás) → retryable;
 * 2. hibajelzés (szlahu_error / szlahu_error_code fejléc, illetve
 *    <sikeres>false</sikeres> a törzsben): a fejléc és a törzs hibakódjainak
 *    UNIÓJA számít. Ha az unió KIZÁRÓLAG 56-os (értesítő-hiba) kódokból áll
 *    és van egyértelmű számlaszám → SIKER `notificationError`-ral; 56 szám
 *    nélkül → bizonytalan (retryable); minden más a hivatalos
 *    kód-osztályozással, az unió MINDEN kódjára: duplikátum-kód (71/152)
 *    esetén 'duplicate', különben ha BÁRMELY kód újrapróbálható (1, 55), a
 *    hiba újrapróbálható (így egy ellentmondó 57-es fejléc + 55-ös törzs is
 *    az, amit az 5-ös plafon és a beküldés előtti lekérdezés fékez). A
 *    lekérdezésnél (pdf.ts) az unió bármely 7-es kódja „nincs ilyen
 *    bizonylat";
 * 3. <sikeres>true</sikeres> → a számlaszám a törzsből, hiányában a
 *    `szlahu_szamlaszam` fejlécből; a vevői fiók URL a törzsből, hiányában a
 *    `szlahu_vevoifiokurl` fejlécből;
 * 4. <sikeres> nélkül, de hibamentes fejlécekkel és `szlahu_szamlaszam`-mal →
 *    SIKER (a hivatalos PHP SDK is a fejlécből olvassa a számot);
 * 5. minden más (pl. HTML-karbantartási oldal 200-zal) → bizonytalan
 *    'invalid_response', retryable.
 *
 * Ha a törzs és a fejléc KÜLÖNBÖZŐ számlaszámot mond (vagy a törzsben több
 * eltérő szám áll), a válasz bizonytalan: egy rossz szám átvétele egy másik
 * bizonylatot kötne a rendeléshez.
 */
export function parseAgentResponse(body: string, headers: Headers): SzamlazzParsedSuccess {
  const down = headers.get('szlahu_down')
  if (isTruthyHeader(down)) {
    throw new SzamlazzApiError({
      message: 'A Számlázz.hu karbantartás miatt átmenetileg nem elérhető (szlahu_down).',
      kind: 'http',
      retryable: true,
      // Hatás nélküli (noEffect), de csak a dokumentált `szlahu_down: true`
      // értéknél. A hivatalos Hibakezelés oldal szerint ilyenkor a választ a
      // Számlázz.hu CMS-e szolgálja ki, és „a rendszerből jelenleg nem lehet
      // számlákat létrehozni, lekérdezni” (docs.szamlazz.hu/hu/agent/basics/
      // error-handling, v202505151456, Wayback 2025-06-14; angolul: „it is not
      // possible to create/query invoices from the system at the moment”). A
      // kérés tehát nem jutott el a számlázóig.
      noEffect: down.trim().toLowerCase() === 'true',
    })
  }

  const headerErrorRaw = headers.get('szlahu_error')
  const headerCodeRaw = headers.get('szlahu_error_code')
  const headerErrors: SzamlazzAgentError[] =
    isTruthyHeader(headerErrorRaw) || isTruthyHeader(headerCodeRaw)
      ? [
          {
            code: isTruthyHeader(headerCodeRaw) ? headerCodeRaw.trim() : 'Ismeretlen',
            message: isTruthyHeader(headerErrorRaw) ? decodeHeaderValue(headerErrorRaw) : '',
          },
        ]
      : []

  // xs:boolean: a 'true'/'false' mellett az '1'/'0' is érvényes alak.
  const sikeresRaw = tagValue(body, 'sikeres')?.toLowerCase()
  const sikeres = sikeresRaw === '1' ? 'true' : sikeresRaw === '0' ? 'false' : sikeresRaw
  const bodyErrors = extractAgentErrors(body)
  const headerNumberRaw = headers.get('szlahu_szamlaszam')
  const headerNumber = headerNumberRaw?.trim() ? decodeUrlHeaderValue(headerNumberRaw) : undefined
  const numbers = new Set(
    [...tagValues(body, 'szamlaszam'), ...(headerNumber ? [headerNumber] : [])].filter(
      (value) => value.length > 0,
    ),
  )
  /** Az egyértelmű, ép bizonylatszám — vagy null, ha nincs / ellentmondásos. */
  const resolveNumber = (): { number: string | null; conflict: boolean } => {
    if (numbers.size === 0) {
      return { number: null, conflict: false }
    }
    const [only] = [...numbers]
    if (numbers.size > 1 || only === undefined || !isPlausibleDocumentNumber(only)) {
      return { number: null, conflict: true }
    }
    return { number: only, conflict: false }
  }
  const vevoifiokUrl = (): string | undefined => {
    const fromBody = tagValue(body, 'vevoifiokurl')
    if (fromBody) {
      return fromBody
    }
    const fromHeader = headers.get('szlahu_vevoifiokurl')
    return fromHeader?.trim() ? decodeUrlHeaderValue(fromHeader) : undefined
  }
  /** A törzs `szamlanetto` / `szamlabrutto` értéke, ha véges szám (xs:double). */
  const amounts = (): Pick<SzamlazzParsedSuccess, 'szamlanetto' | 'szamlabrutto'> => {
    const read = (tag: string): number | undefined => {
      const raw = tagValue(body, tag)
      if (raw === undefined || raw === '') {
        return undefined
      }
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const szamlanetto = read('szamlanetto')
    const szamlabrutto = read('szamlabrutto')
    return {
      ...(szamlanetto !== undefined ? { szamlanetto } : {}),
      ...(szamlabrutto !== undefined ? { szamlabrutto } : {}),
    }
  }

  // Hibajelzésnél a fejléc és a törzs hibakódjainak UNIÓJA dönt: egy 56-os
  // fejléc mellett a törzsben álló 57-es (vagy bármely más) kód sem tűnhet el,
  // különben egy el sem készült bizonylatot vennénk át „értesítő-hibás
  // sikerként". Az ismétlődő (azonos kód + üzenet) párok egyszer számítanak.
  const reportedErrors =
    headerErrors.length > 0
      ? uniqueAgentErrors([...headerErrors, ...bodyErrors])
      : sikeres === 'true'
        ? []
        : bodyErrors
  if (reportedErrors.length > 0 || sikeres === 'false') {
    const onlyNotificationFailure =
      reportedErrors.length > 0 &&
      reportedErrors.every((entry) => entry.code.trim() === SZAMLAZZ_NOTIFICATION_FAILED_CODE)
    if (onlyNotificationFailure) {
      const { number } = resolveNumber()
      if (number) {
        const url = vevoifiokUrl()
        return {
          szamlaszam: number,
          ...(url ? { vevoifiokUrl: url } : {}),
          ...amounts(),
          notificationError: reportedErrors[0] ?? {
            code: SZAMLAZZ_NOTIFICATION_FAILED_CODE,
            message: '',
          },
        }
      }
      throw uncertainResponseError(
        'A Számlázz.hu 56-os jelzést adott (a számlaértesítő nem ment ki), de egyértelmű ' +
          'számlaszám nélkül: nem dönthető el, hogy a bizonylat elkészült-e. Az újrapróbálás ' +
          'előtt lekérdezés dönt.',
        reportedErrors,
      )
    }
    const fromHeader = headerErrors.length > 0
    const channel = reportedErrors.length > headerErrors.length ? 'fejléc és törzs' : 'fejléc'
    throw agentErrorFromCodes(
      fromHeader
        ? `Számla Agent hiba (${channel}): ${reportedErrors
            .map((error) => `${error.code} — ${error.message}`)
            .join('; ')}`
        : `Számla Agent elutasította a kérést: ${
            reportedErrors.map((error) => `${error.code} — ${error.message}`).join('; ') ||
            'ismeretlen hiba'
          }`,
      reportedErrors,
    )
  }

  if (sikeres === 'true' || (sikeres === undefined && headerNumber !== undefined)) {
    const { number, conflict } = resolveNumber()
    if (!number) {
      throw uncertainResponseError(
        conflict
          ? 'A Számlázz.hu sikerválasza nem egyértelmű számlaszámot tartalmaz (a törzs és a fejléc eltér, vagy a szám sérült).'
          : 'A Számlázz.hu sikerválasza nem tartalmaz számlaszámot.',
      )
    }
    const url = vevoifiokUrl()
    const notification = bodyErrors.find(
      (entry) => entry.code.trim() === SZAMLAZZ_NOTIFICATION_FAILED_CODE,
    )
    return {
      szamlaszam: number,
      ...(url ? { vevoifiokUrl: url } : {}),
      ...amounts(),
      ...(notification ? { notificationError: notification } : {}),
    }
  }

  throw uncertainResponseError('A Számlázz.hu válasza nem értelmezhető (nincs <sikeres> elem).')
}

/**
 * A HTTP-válasz olvasása és értelmezése — a három Agent-hívás (kiállítás,
 * stornó, lekérdezés) KÖZÖS útja.
 *
 * - 2xx: a törzs a parseAgentResponse szabályai szerint.
 * - Nem-2xx: a törzset és a szlahu_* fejléceket IS kiolvassuk, mert a hibakód
 *   ott is megjöhet (korábban a státusz alapján, olvasás nélkül dobtunk, és a
 *   kód elveszett). Agent-hibakódnál a hivatalos osztályozás érvényes, de az
 *   átmeneti státusz (408/425/429/5xx) önmagában is újrapróbálhatóvá teszi;
 *   kód nélkül a státusz dönt.
 * - A törzs olvasása közbeni hiba (timeout, TCP-vágás) osztályozott,
 *   újrapróbálható hibává válik (bodyReadError).
 *
 * A `context` a magyar hibaüzenetben nevezi meg a hívó ágát.
 */
export async function readAgentResponse(
  response: Pick<Response, 'ok' | 'status' | 'headers' | 'text'>,
  timeoutMs: number,
  context?: string,
): Promise<SzamlazzParsedSuccess> {
  const suffix = context ? ` (${context})` : ''
  const httpError = (): SzamlazzApiError =>
    new SzamlazzApiError({
      message: `Számlázz.hu HTTP-hiba (${response.status})${suffix}.`,
      kind: 'http',
      httpStatus: response.status,
      retryable: isTransientHttpStatus(response.status),
    })

  let body: string
  try {
    body = await response.text()
  } catch (error) {
    if (!response.ok) {
      throw httpError()
    }
    throw bodyReadError(error, timeoutMs, context)
  }

  if (response.ok) {
    return parseAgentResponse(body, response.headers)
  }

  try {
    return parseAgentResponse(body, response.headers)
  } catch (error) {
    if (!(error instanceof SzamlazzApiError)) {
      throw error
    }
    if (error.kind === 'agent' || error.kind === 'duplicate') {
      throw new SzamlazzApiError({
        message: `${error.message} (HTTP ${response.status})`,
        kind: error.kind,
        httpStatus: response.status,
        agentErrors: error.agentErrors,
        retryable: error.retryable || isTransientHttpStatus(response.status),
      })
    }
    if (error.kind === 'http' || error.agentErrors.length > 0) {
      // szlahu_down, illetve a számlaszám nélküli 56-os (bizonytalan) jelzés:
      // mindkettő újrapróbálható, a státusztól függetlenül.
      throw error
    }
    throw httpError()
  }
}

/** Timeout/abort eredetű hiba-e (AbortSignal.timeout, fetch-megszakítás). */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error.message.toLowerCase().includes('aborted'))
  )
}

/**
 * A válasz-TÖRZS beolvasása közben keletkezett hiba osztályozása.
 *
 * A fejlécek megérkezése UTÁN a stream még elszakadhat: az AbortSignal.timeout
 * a törzs olvasása közben is elsülhet, a Railway privát hálózata pedig félúton
 * elvághatja a TCP-kapcsolatot. Osztályozás nélkül ez nyers TypeError-ként
 * lépne ki, elveszítve a `retryable` jelzést — a hívó (refund-folyamat) nem
 * állítaná sorba az újrapróbáló jobot, és a bizonylat NÉMÁN elveszne.
 *
 * A `context` a hívó ágát nevezi meg a magyar üzenetben (pl. bizonylat-lekérdezés).
 */
export function bodyReadError(
  error: unknown,
  timeoutMs: number,
  context?: string,
): SzamlazzApiError {
  const suffix = context ? ` (${context})` : ''
  if (isAbortError(error)) {
    return new SzamlazzApiError({
      message: `A Számlázz.hu válaszának letöltése nem fejeződött be ${timeoutMs} ms-en belül${suffix}.`,
      kind: 'timeout',
      retryable: true,
    })
  }
  return new SzamlazzApiError({
    message: `A Számlázz.hu válaszának letöltése megszakadt${suffix}: ${
      error instanceof Error ? error.message : String(error)
    }`,
    kind: 'network',
    retryable: true,
  })
}

/**
 * Kapcsolódás előtti hálózati hibák: névfeloldási hiba (`getaddrinfo`) és
 * elutasított TCP-kapcsolat (`connect`). Ezek csak kapcsolódás előtt
 * keletkezhetnek; egy már felépült kapcsolat hibája ECONNRESET, EPIPE,
 * UND_ERR_SOCKET vagy timeout, és az egyik sem került ide.
 *
 * Miért nem ment ki egyetlen kérés-bájt sem (node_modules/undici 7.29):
 * a lib/core/connect.js a socket `connect`/`secureConnect` eseménye ELŐTTI
 * hibát a kapcsolódás visszahívásának adja, a lib/dispatcher/client.js
 * `connect()` pedig ezt a `handleConnectError` → `onError` ágon csak akkor
 * osztja ki a kérésekre, ha egyik sem fut (`kRunning === 0`). A kérést író
 * HTTP-réteg (`connectH1` / `connectH2`) csak sikeres kapcsolódás után jön
 * létre. A kapcsolódási időtúllépés (UND_ERR_CONNECT_TIMEOUT) szándékosan
 * nincs itt: időtúllépés nem számít bizonyítéknak.
 */
const CONNECT_PHASE_ERROR_SYSCALLS: ReadonlyMap<string, string> = new Map([
  ['ECONNREFUSED', 'connect'],
  ['ENOTFOUND', 'getaddrinfo'],
  ['EAI_AGAIN', 'getaddrinfo'],
])

/**
 * A fetch („fetch failed”) oka igazoltan kapcsolódás előtti hiba-e. Több
 * címre próbálkozó kapcsolódásnál (Happy Eyeballs, a www.szamlazz.hu-nak
 * több A-rekordja van) a Node AggregateError-t ad: ez csak akkor számít, ha
 * MINDEN próbálkozás ilyen hibával ért véget.
 */
function isConnectPhaseFailure(cause: unknown): boolean {
  if (cause instanceof AggregateError) {
    return cause.errors.length > 0 && cause.errors.every(isConnectPhaseFailure)
  }
  if (!(cause instanceof Error)) {
    return false
  }
  const { code, syscall } = cause as Error & { code?: unknown; syscall?: unknown }
  return (
    typeof code === 'string' &&
    typeof syscall === 'string' &&
    CONNECT_PHASE_ERROR_SYSCALLS.get(code) === syscall
  )
}

/**
 * Számla-Agent hívás: a kész számla-XML POST-olása az
 * 'action-xmlagentxmlfile' multipart-mezőben. Az agent-kulcs az XML-ben
 * (bodyban) utazik — sosem az URL-ben. Naplózás titokmentesen.
 */
export async function postInvoiceXml(
  xml: string,
  config?: SzamlazzClientConfig,
): Promise<SzamlazzParsedSuccess> {
  const resolved = config ?? getSzamlazzConfig()
  if (!resolved.enabled || !resolved.agentKey) {
    throw new SzamlazzApiError({
      message: 'A Számlázz.hu-integráció nincs beállítva (SZAMLAZZ_AGENT_KEY hiányzik).',
      kind: 'invalid_data',
      retryable: false,
    })
  }

  const endpoint = 'POST /szamla (action-xmlagentxmlfile)'
  const form = new FormData()
  form.append('action-xmlagentxmlfile', new Blob([xml], { type: 'text/xml' }), 'szamla.xml')

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(resolved.apiUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(resolved.timeoutMs),
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    if (isAbortError(error)) {
      logger.error('Számlázz.hu hívás timeout', {
        endpoint,
        timeoutMs: resolved.timeoutMs,
        durationMs,
      })
      throw new SzamlazzApiError({
        message: `A Számlázz.hu nem válaszolt ${resolved.timeoutMs} ms-en belül.`,
        kind: 'timeout',
        retryable: true,
      })
    }
    logger.error('Számlázz.hu hálózati hiba', {
      endpoint,
      durationMs,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw new SzamlazzApiError({
      message: `A Számlázz.hu elérhetetlen: ${error instanceof Error ? error.message : String(error)}`,
      kind: 'network',
      retryable: true,
      noEffect: isConnectPhaseFailure(error instanceof Error ? error.cause : undefined),
    })
  }

  const durationMs = Date.now() - startedAt
  if (!response.ok) {
    logger.error('Számlázz.hu HTTP-hiba', { endpoint, httpStatus: response.status, durationMs })
  }

  // A törzs-olvasás és az értelmezés a közös readAgentResponse-ban: a stream
  // félbeszakadása (timeout a fejlécek után, TCP-vágás) osztályozott, retryable
  // hibává válik, a nem-2xx válasz hibakódja sem vész el, a parseAgentResponse
  // strukturált hibái (duplicate/agent) pedig változatlanul mennek tovább.
  let result: SzamlazzParsedSuccess
  try {
    result = await readAgentResponse(response, resolved.timeoutMs)
  } catch (error) {
    if (
      error instanceof SzamlazzApiError &&
      (error.kind === 'timeout' || error.kind === 'network')
    ) {
      logger.error('Számlázz.hu válasz-törzs olvasási hiba', {
        endpoint,
        durationMs: Date.now() - startedAt,
        errorMessage: error.message,
      })
    }
    throw error
  }
  logger.info('Számlázz.hu számla kiállítva', {
    endpoint,
    durationMs,
    szamlaszam: result.szamlaszam,
    ...(result.notificationError ? { ertesitoKezbesitesSikertelen: true } : {}),
  })
  return result
}
