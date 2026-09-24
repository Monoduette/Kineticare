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
export const SZAMLAZZ_DEFAULT_INVOICE_PREFIX = 'KIN'

/**
 * Hivatalos hibakód-osztályozás (docs.szamlazz.hu/agent/basics/error-handling):
 * - '1' — rendszerkarbantartás: az EGYETLEN explicit újrapróbálhatóként
 *   dokumentált kód (pár perc múlva). Minden más agent-kód végleges: auth/fiók
 *   (3, 135, 136, 164), kérésformátum (53, 57), e-számla-beállítás (54, 55),
 *   előtag (202), tétel-matematika (259–264) — ezekre az újraküldés ugyanazt
 *   a hibát adná, a max. 5 beküldés keretét pedig feleslegesen égetné.
 * - '71'/'152' — „Már létező rendelésszám": nem hiba, hanem idempotencia-
 *   találat (kind: 'duplicate') — a hívó a szamlaKulsoAzon-lekérdezéssel veszi
 *   át a meglévő bizonylat számát.
 */
export const SZAMLAZZ_RETRYABLE_AGENT_CODES: ReadonlySet<string> = new Set(['1'])
export const SZAMLAZZ_DUPLICATE_AGENT_CODES: ReadonlySet<string> = new Set(['71', '152'])

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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SZAMLAZZ_DEFAULT_TIMEOUT_MS
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

/** Egy XML-tag értékének kinyerése (első előfordulás). */
function tagValue(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match?.[1]?.trim()
}

/** Összes hibakod/hibauzenet pár kinyerése — <hiba>-blokkonként vagy laposan. */
function extractAgentErrors(xml: string): SzamlazzAgentError[] {
  const errors: SzamlazzAgentError[] = []
  const hibaBlocks = xml.match(/<hiba>[\s\S]*?<\/hiba>/g)
  if (hibaBlocks && hibaBlocks.length > 0) {
    for (const block of hibaBlocks) {
      errors.push({
        code: tagValue(block, 'hibakod') ?? 'Ismeretlen',
        message: tagValue(block, 'hibauzenet') ?? '',
      })
    }
    return errors
  }
  // Lapos forma: közvetlen <hibakod>/<hibauzenet> a gyökérben.
  const flatCode = tagValue(xml, 'hibakod')
  if (flatCode !== undefined) {
    errors.push({ code: flatCode, message: tagValue(xml, 'hibauzenet') ?? '' })
  }
  return errors
}

function isTruthyHeader(value: string | null): value is string {
  return value !== null && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
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
 * Agent-hiba a hibakódok hivatalos osztályozásával: 71/152 → 'duplicate'
 * (idempotencia-találat, a hívó lekérdezéssel oldja fel); '1' → retryable
 * (karbantartás); minden más végleges 'agent' hiba.
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

export interface SzamlazzParsedSuccess {
  szamlaszam: string
  /** Vevői fiók URL (ha a Számlázz.hu adja) — a rendelés invoicePdfUrl mezőjéhez. */
  vevoifiokUrl?: string
}

/**
 * A Számla Agent válasz értelmezése. Siker esetén a számlaszám (és a vevői
 * fiók URL, ha adott); minden hibaág strukturált SzamlazzApiError.
 *
 * Sorrend: szlahu_down (karbantartás, retryable) → szlahu_error fejléc →
 * XML <sikeres>false</sikeres> → <sikeres>true</sikeres> → egyéb: invalid_response.
 */
export function parseAgentResponse(body: string, headers: Headers): SzamlazzParsedSuccess {
  if (isTruthyHeader(headers.get('szlahu_down'))) {
    throw new SzamlazzApiError({
      message: 'A Számlázz.hu karbantartás miatt átmenetileg nem elérhető (szlahu_down).',
      kind: 'http',
      retryable: true,
    })
  }

  const headerError = headers.get('szlahu_error')
  if (isTruthyHeader(headerError)) {
    const headerCode = headers.get('szlahu_error_code') ?? 'Ismeretlen'
    const decodedError = decodeHeaderValue(headerError)
    throw agentErrorFromCodes(`Számla Agent hiba (fejléc): ${headerCode} — ${decodedError}`, [
      { code: headerCode, message: decodedError },
    ])
  }

  const sikeres = tagValue(body, 'sikeres')
  if (sikeres === 'true') {
    const szamlaszam = tagValue(body, 'szamlaszam')
    if (!szamlaszam) {
      throw new SzamlazzApiError({
        message: 'A Számlázz.hu sikerválasza nem tartalmaz számlaszámot.',
        kind: 'invalid_response',
        retryable: false,
      })
    }
    const vevoifiokUrl = tagValue(body, 'vevoifiokurl')
    return { szamlaszam, ...(vevoifiokUrl ? { vevoifiokUrl } : {}) }
  }
  if (sikeres === 'false') {
    const agentErrors = extractAgentErrors(body)
    throw agentErrorFromCodes(
      `Számla Agent elutasította a számlakiállítást: ${
        agentErrors.map((error) => `${error.code} — ${error.message}`).join('; ') ||
        'ismeretlen hiba'
      }`,
      agentErrors,
    )
  }

  throw new SzamlazzApiError({
    message: 'A Számlázz.hu válasza nem értelmezhető (nincs <sikeres> elem).',
    kind: 'invalid_response',
    retryable: false,
  })
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
    })
  }

  const durationMs = Date.now() - startedAt
  if (!response.ok) {
    logger.error('Számlázz.hu HTTP-hiba', { endpoint, httpStatus: response.status, durationMs })
    throw new SzamlazzApiError({
      message: `Számlázz.hu HTTP-hiba (${response.status}).`,
      kind: 'http',
      httpStatus: response.status,
      retryable: response.status >= 500,
    })
  }

  // A törzs-olvasás és az értelmezés EGY védett blokkban: a stream félbeszakadása
  // (timeout a fejlécek után, TCP-vágás) osztályozott, retryable hibává válik,
  // a parseAgentResponse saját — már strukturált — hibái viszont változatlanul
  // mennek tovább (különben a duplicate/agent besorolás veszne el).
  let result: SzamlazzParsedSuccess
  try {
    const body = await response.text()
    result = parseAgentResponse(body, response.headers)
  } catch (error) {
    if (error instanceof SzamlazzApiError) {
      throw error
    }
    logger.error('Számlázz.hu válasz-törzs olvasási hiba', {
      endpoint,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw bodyReadError(error, resolved.timeoutMs)
  }
  logger.info('Számlázz.hu számla kiállítva', {
    endpoint,
    durationMs,
    szamlaszam: result.szamlaszam,
  })
  return result
}
