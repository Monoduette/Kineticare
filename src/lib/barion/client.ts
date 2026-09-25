import { maskEmail } from '../email/mask'
import { createLogger, type Logger } from '../logger'
import { BarionApiError, type BarionError } from './types'

/**
 * Barion API-kliens: env-feloldás, timeoutos HTTP, titokmentes naplózás.
 * Refund a rendelés-zár alatt fut, ezért a `BARION_TIMEOUT_MS` plafonja 35 s
 * (a zár-tranzakció 60 s-os idle_in_transaction_session_timeoutja alatt).
 */

export type BarionEnvironment = 'test' | 'prod'

export interface BarionClientConfig {
  environment: BarionEnvironment
  /** API alap-URL (pl. https://api.test.barion.com) — záró perjel nélkül. */
  apiUrl: string
  /** Az AKTÍV környezet POSKey-e. Soha ne naplózd! */
  posKey: string
  payeeEmail: string
  /** A POST-hívások timeoutja. A GET ugyanezt kapja, de legfeljebb BARION_GET_TIMEOUT_MS-et. */
  timeoutMs: number
  recurringEnabled: boolean
}

/**
 * Alapértelmezett timeout (POST: Payment/Start, Payment/Refund).
 *
 * A Barion egy kérést legfeljebb 30 másodpercig futtat, utána maga állítja le
 * („The maximum duration for an HTTP request is 30 seconds. After that the
 * server stops the request.” docs.barion.com/Calling_the_API, 2024-01-15).
 * A korábbi 15 s egy lassú, de sikeres Startot is elvágott: a fizetés a
 * Barionnál létrejött, mi viszont timeoutot láttunk. A 35 s a szerveroldali
 * 30 s plusz 5 s hálózati tartalék, így a Barion saját válasza (siker vagy
 * hiba) mindig előbb ér ide, mint ahogy mi feladnánk.
 */
export const BARION_DEFAULT_TIMEOUT_MS = 35_000

/**
 * BARION_TIMEOUT_MS plafon. A refund rendelés-zár (nyitott tranzakció) alatt
 * fut, amit a Postgres 60 s tétlenség után bont: a Barion-hívásnak jóval ez
 * alatt kell maradnia. 35 s fölött várni amúgy sem érdemes, mert a Barion 30 s
 * után maga állítja le a kérést. Az env tehát csak csökkentheti a timeoutot.
 */
export const BARION_MAX_TIMEOUT_MS = 35_000

/**
 * GET-hívások (PaymentState v4) timeout-plafonja. Az állapotlekérdezés
 * ismételhető, ezért itt a rövid timeout a helyes: a callbackre a Barion 15 s-on
 * belül vár választ (Callback_mechanism), az order-poll futásideje pedig
 * (src/jobs/schedule-guard.ts, 15 perces beragadási küszöb) hívásonként
 * 15 s-mal számol.
 */
export const BARION_GET_TIMEOUT_MS = 15_000

/** Az AKTÍV környezethez tartozó, elvárt Barion API-hoszt. */
export const BARION_API_HOSTS: Record<BarionEnvironment, string> = {
  test: 'api.test.barion.com',
  prod: 'api.barion.com',
}

/** A Barion titkos kulcsot kiadó felülete környezetenként (hibaüzenetekhez). */
const BARION_SECURE_HOSTS: Record<BarionEnvironment, string> = {
  test: 'secure.test.barion.com',
  prod: 'secure.barion.com',
}

/**
 * A POSKey elvárt alakja: GUID, kötőjelekkel (8-4-4-4-12) vagy anélkül
 * (32 hexadecimális karakter). A Barion a mezőt Guid típusúnak írja le
 * (Payment-Start-v2: „POSKey | Guid | Required”).
 */
const POS_KEY_PATTERN =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** Egyenes és tipográfiai idézőjelek, amelyek másoláskor a kulcs elé-mögé kerülhetnek. */
const QUOTE_CHARACTERS = /["'`‘’‚“”„]/

let moduleLogger: Logger | undefined

/**
 * A modul loggere, első használatkor létrehozva. A modult az src/env.ts is
 * importálja (induláskori assert), az env.ts-t pedig sok más modul: az
 * importnak ezért nem lehet mellékhatása.
 */
function barionLogger(): Logger {
  moduleLogger ??= createLogger({ module: 'barion' })
  return moduleLogger
}

/** Az adott Barion-környezet POSKey-ét tartalmazó környezeti változó NEVE. */
export function barionPosKeyEnvName(environment: BarionEnvironment): string {
  return environment === 'prod' ? 'BARION_POSKEY_PROD' : 'BARION_POSKEY_TEST'
}

/**
 * A POSKey alakjának ellenőrzése a már levágott (trim) értéken. `null`, ha az
 * alak rendben van; különben a hiba magyar leírása. A leírás sem az értéket,
 * sem annak egyetlen részletét nem tartalmazza, legfeljebb a hosszát.
 */
export function describeBarionPosKeyShapeProblem(posKey: string): string | null {
  if (POS_KEY_PATTERN.test(posKey)) {
    return null
  }
  if (QUOTE_CHARACTERS.test(posKey)) {
    return 'idézőjelet tartalmaz'
  }
  if (/\s/.test(posKey)) {
    return 'szóközt vagy sortörést tartalmaz'
  }
  return (
    'nem GUID-alakú: 32 hexadecimális karakter kell, kötőjelekkel vagy anélkül ' +
    `(a megadott érték ${posKey.length} karakter hosszú)`
  )
}

/** Az API-URL hosztja naplózáshoz; hibás URL-nél sem dob. */
function apiHostOf(apiUrl: string): string {
  try {
    return new URL(apiUrl).host
  } catch {
    return 'ismeretlen'
  }
}

/** A POSKey kiszedése egy szövegből (pl. a fetch hibaüzenetéből), mielőtt naplóba vagy hibába kerül. */
function withoutPosKey(text: string, posKey: string): string {
  return posKey.length > 0 ? text.split(posKey).join('[REDACTED]') : text
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function parseTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return BARION_DEFAULT_TIMEOUT_MS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return BARION_DEFAULT_TIMEOUT_MS
  }
  if (parsed > BARION_MAX_TIMEOUT_MS) {
    // NEM dobunk: egy túl nagyra állított timeout ne akassza meg az indulást —
    // de a plafon némán sem érvényesülhet, mert a beállító mást vár.
    barionLogger().warn('BARION_TIMEOUT_MS a megengedett plafon fölött — a plafon érvényesül', {
      requestedMs: parsed,
      appliedMs: BARION_MAX_TIMEOUT_MS,
    })
    return BARION_MAX_TIMEOUT_MS
  }
  return parsed
}

/**
 * Környezetfeloldás + induláskori assert egy lépésben. Hiányzó kötelező
 * Barion-env esetén magyar, a hiányzó kulcsokat felsoroló hibát dob.
 * Tiszta függvény: az env paraméterezhető (tesztelés), alapból process.env.
 */
export function getBarionConfig(env: NodeJS.ProcessEnv = process.env): BarionClientConfig {
  const rawEnvironment = readEnv(env, 'BARION_ENVIRONMENT') ?? 'test'
  if (rawEnvironment !== 'test' && rawEnvironment !== 'prod') {
    throw new Error(
      `Barion-konfigurációs hiba: a BARION_ENVIRONMENT értéke csak 'test' vagy 'prod' lehet, ` +
        `a megadott érték: '${rawEnvironment}'. Az alkalmazás így nem indulhat el — ` +
        'javítsd a környezeti változót (pl. .env fájl), majd indítsd újra.',
    )
  }
  const environment: BarionEnvironment = rawEnvironment

  const posKeyEnvName = barionPosKeyEnvName(environment)

  const missing: string[] = []
  const apiUrl = readEnv(env, 'BARION_API_URL')
  if (!apiUrl) {
    missing.push('BARION_API_URL')
  }
  const payeeEmail = readEnv(env, 'BARION_PAYEE_EMAIL')
  if (!payeeEmail) {
    missing.push('BARION_PAYEE_EMAIL')
  }
  const posKey = readEnv(env, posKeyEnvName)
  if (!posKey) {
    missing.push(posKeyEnvName)
  }

  if (missing.length > 0) {
    throw new Error(
      `Barion-konfigurációs hiba: hiányzó kötelező környezeti változó(k): ${missing.join(', ')}. ` +
        `Az alkalmazás nem indulhat el — állítsd be őket a környezetben (pl. helyben .env fájlban, ` +
        `a .env.example minta alapján), majd indítsd újra a szervert. ` +
        `(Aktív Barion-környezet: ${environment}.)`,
    )
  }

  let normalizedApiUrl: string
  let apiHost: string
  try {
    const parsed = new URL(apiUrl as string)
    if (parsed.protocol !== 'https:') {
      throw new Error('not-https')
    }
    normalizedApiUrl = parsed.origin
    apiHost = parsed.hostname.toLowerCase()
  } catch {
    throw new Error(
      `Barion-konfigurációs hiba: a BARION_API_URL nem érvényes https URL ('${apiUrl}'). ` +
        'Test környezetben https://api.test.barion.com, élesben https://api.barion.com az elvárt érték.',
    )
  }

  /**
   * KONZISZTENCIA-ELLENŐRZÉS (B3): a környezetkapcsoló és az API-hoszt EGYÜTT
   * dönti el, melyik Barion-világban fut a fizetés — a kettő szétcsúszása a
   * legdrágább néma hiba, amit ez a modul okozhat:
   * - `prod` környezet + teszt-hoszt: a vevő valódi kártyaadattal fizetne a
   *   sandboxban → a pénz SOSEM érkezik meg, a rendelés mégis paid lenne;
   * - `test` környezet + éles hoszt: a tesztkulcs az éles API-n hitelesítési
   *   hibát ad, tehát minden fizetésindítás elhasal.
   * Egyik sem derülne ki magától, ezért itt, a konfigfeloldásnál bukik el.
   */
  const expectedHost = BARION_API_HOSTS[environment]
  if (apiHost !== expectedHost) {
    throw new Error(
      `Barion-konfigurációs hiba: a BARION_ENVIRONMENT ('${environment}') és a BARION_API_URL ` +
        `hosztja ('${apiHost}') nem illik össze — a '${environment}' környezethez a ` +
        `'${expectedHost}' hoszt tartozik. Az alkalmazás így nem indulhat el: éles környezetben ` +
        'a teszt-API-val a fizetés sosem érkezne meg. Javítsd a környezeti változókat ' +
        '(BARION_ENVIRONMENT + BARION_API_URL együtt), majd indítsd újra a szervert.',
    )
  }

  /**
   * A POSKey ALAKJA. Egy idézőjellel, szóközzel vagy csonkán bemásolt kulcsra a
   * Barion minden hívásra AuthenticationFailed-et ad, és ez csak az első
   * vásárlónál derülne ki. Élesben (NODE_ENV=production) és az éles
   * Barion-környezetben ezért itt bukik el. Helyi fejlesztésben, teszt-
   * környezettel az ellenőrzés elmarad, mert ott jelölt álkulcs is lehet
   * (pl. .cursor/start.sh). Az üzenet az értéket soha nem tartalmazza.
   */
  const requireRealPosKey = environment === 'prod' || readEnv(env, 'NODE_ENV') === 'production'
  const posKeyProblem = requireRealPosKey
    ? describeBarionPosKeyShapeProblem(posKey as string)
    : null
  if (posKeyProblem !== null) {
    throw new Error(
      `Barion-konfigurációs hiba: a ${posKeyEnvName} értéke nem használható POSKey-ként, mert ` +
        `${posKeyProblem}. Az alkalmazás így nem indulhat el. Másold be újra a bolt titkos ` +
        `kulcsát a ${BARION_SECURE_HOSTS[environment]} oldalról (Shops → Actions → Details, ` +
        'Secret key), idézőjelek és szóközök nélkül. A nyilvános kulcs (Public key) nem jó. ' +
        'Az érték biztonsági okból nem szerepel ebben az üzenetben.',
    )
  }

  return {
    environment,
    apiUrl: normalizedApiUrl,
    posKey: posKey as string,
    payeeEmail: payeeEmail as string,
    timeoutMs: parseTimeoutMs(readEnv(env, 'BARION_TIMEOUT_MS')),
    recurringEnabled: readEnv(env, 'BARION_RECURRING_ENABLED') === 'true',
  }
}

/**
 * Az aktív Barion-konfiguráció titokmentes naplózása, induláskor egyszer
 * (src/env.ts assertRequiredEnv). Így a deploy-logból mindig kiderül, melyik
 * Barion-világban fut a bolt. A POSKey-ből csak a változó NEVE kerül a naplóba,
 * a kedvezményezett címe maszkolva.
 */
export function logBarionConfigSummary(config: BarionClientConfig): void {
  barionLogger().info('barion_konfiguracio', {
    barionEnvironment: config.environment,
    apiHost: apiHostOf(config.apiUrl),
    posKeyEnvName: barionPosKeyEnvName(config.environment),
    payee: maskEmail(config.payeeEmail),
    postTimeoutMs: config.timeoutMs,
    getTimeoutMs: Math.min(config.timeoutMs, BARION_GET_TIMEOUT_MS),
  })
}

/** Válasz-body JSON-parse, egységes 'invalid_response' hibával. */
async function parseJsonBody(
  response: Response,
  endpoint: string,
): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => '')
  if (text.length === 0) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('not-an-object')
  } catch {
    throw new BarionApiError({
      message: `A Barion válasza nem értelmezhető JSON (${endpoint}).`,
      kind: 'invalid_response',
      endpoint,
      httpStatus: response.status,
    })
  }
}

function extractProviderErrors(body: Record<string, unknown>): BarionError[] {
  const errors = body.Errors
  if (!Array.isArray(errors)) {
    return []
  }
  return errors
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    )
    .map((item) => ({
      ErrorCode: typeof item.ErrorCode === 'string' ? item.ErrorCode : 'Unknown',
      Title: typeof item.Title === 'string' ? item.Title : '',
      Description: typeof item.Description === 'string' ? item.Description : '',
    }))
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error.message.toLowerCase().includes('aborted'))
  )
}

/**
 * A hívó kérés-szintű naplózója. Ha a hívó átadja (pl. a callback-feldolgozó
 * `requestId`-s child loggerét), a 'Barion API HTTP-hiba' és a többi
 * kliens-sor UGYANAZT a requestId-t viszi, mint a kérés többi sora — enélkül
 * a hibasor csak az időbélyeg alapján volt a kéréshez köthető (a-riasztas-14).
 */
export interface BarionCallOptions {
  logger?: Logger
}

interface BarionRequestOptions extends BarionCallOptions {
  method: 'GET' | 'POST'
  /** Szerveroldali útvonal az apiUrl-hez képest, pl. '/v2/Payment/Start'. */
  path: string
  /** POST-body a POSKey NÉLKÜL — azt a kliens injektálja bele. */
  body?: Record<string, unknown>
  config?: BarionClientConfig
}

/**
 * HTTP 429 a Bariontól: ugyanarra a PaymentId-re 5 másodpercen belül több
 * PaymentState-hívás ment (Callback_mechanism: „if you call the endpoint with
 * the same PaymentID more than once within a 5-second interval … HTTP 429 Too
 * many requests”). Átmeneti: minden hívó újrapróbálható hibaként kezeli, a
 * fizetés létezéséről vagy állapotáról semmit nem mond.
 */
export function isBarionRateLimited(error: unknown): boolean {
  return error instanceof BarionApiError && error.httpStatus === 429
}

/**
 * Közös, timeoutos Barion HTTP-hívás.
 *
 * - POSKey: minden hívásnál az x-pos-key fejlécben megy (Barion_Shop_Authentication:
 *   „pass your Barion shop's POS key as the x-pos-key header parameter”), POST
 *   esetén a body POSKey mezőjében is, pontosan úgy, mint a hivatalos
 *   barion-web-php kliens (BarionClient.php, PostToBarion). URL-be sosem kerül,
 *   így proxy- és access-logban sem jelenhet meg.
 * - Timeout: POST-nál config.timeoutMs (alapból 35 s), GET-nél legfeljebb
 *   BARION_GET_TIMEOUT_MS (15 s).
 * - A Barion hibaválaszait (akár HTTP 200 mellett is jöhet Errors tömbbel)
 *   strukturált BarionApiError-é alakítja, a provider-mezők megőrzésével.
 * - Naplózás titokmentesen: endpoint, Barion-környezet, API-hoszt, httpStatus,
 *   durationMs, provider-hibakódok. Body és POSKey sosem.
 */
async function barionRequest<TResponse>(options: BarionRequestOptions): Promise<TResponse> {
  const config = options.config ?? getBarionConfig()
  const endpoint = `${options.method} ${options.path}`
  const url = `${config.apiUrl}${options.path}`
  const timeoutMs =
    options.method === 'GET' ? Math.min(config.timeoutMs, BARION_GET_TIMEOUT_MS) : config.timeoutMs
  // A kérés naplózója: a hívó requestId-s loggere (ha adott), a 'barion'
  // modul-jelöléssel, különben a modul saját loggere.
  const log = options.logger ? options.logger.child({ module: 'barion' }) : barionLogger()
  // Minden naplósorba: melyik környezet és hoszt felé ment a hívás (a kulcs soha).
  const logContext = {
    endpoint,
    barionEnvironment: config.environment,
    apiHost: apiHostOf(config.apiUrl),
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-pos-key': config.posKey,
  }
  let body: string | undefined
  if (options.method === 'POST') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ ...options.body, POSKey: config.posKey })
  }

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    if (isAbortError(error)) {
      log.error('Barion API hívás timeout', { ...logContext, timeoutMs, durationMs })
      throw new BarionApiError({
        message: `A Barion API nem válaszolt ${timeoutMs} ms-en belül (${endpoint}).`,
        kind: 'timeout',
        endpoint,
      })
    }
    // A fetch a hibás fejlécértéket szó szerint beleírja az üzenetébe
    // („Headers.append: "…" is an invalid header value."), ezért a kulcsot
    // kivesszük belőle, mielőtt naplóba vagy hibaüzenetbe kerülne.
    const errorMessage = withoutPosKey(
      error instanceof Error ? error.message : String(error),
      config.posKey,
    )
    log.error('Barion API hálózati hiba', { ...logContext, durationMs, errorMessage })
    throw new BarionApiError({
      message: `A Barion API elérhetetlen (${endpoint}): ${errorMessage}`,
      kind: 'network',
      endpoint,
    })
  }

  const durationMs = Date.now() - startedAt
  const parsed = await parseJsonBody(response, endpoint)
  const providerErrors = extractProviderErrors(parsed)

  if (!response.ok) {
    log.error('Barion API HTTP-hiba', {
      ...logContext,
      httpStatus: response.status,
      durationMs,
      providerErrorCodes: providerErrors.map((e) => e.ErrorCode),
    })
    throw new BarionApiError({
      message:
        providerErrors.length > 0
          ? `Barion API hiba (HTTP ${response.status}, ${endpoint}): ${providerErrors
              .map((e) => `${e.ErrorCode} — ${e.Title}`)
              .join('; ')}`
          : `Barion API hiba (HTTP ${response.status}, ${endpoint}).`,
      kind: 'http',
      endpoint,
      httpStatus: response.status,
      providerErrors,
    })
  }

  if (providerErrors.length > 0) {
    // A Barion bizonyos hibákat HTTP 200-zal, Errors tömbben jelez vissza.
    log.error('Barion provider-hiba', {
      ...logContext,
      durationMs,
      providerErrorCodes: providerErrors.map((e) => e.ErrorCode),
    })
    throw new BarionApiError({
      message: `Barion provider-hiba (${endpoint}): ${providerErrors
        .map((e) => `${e.ErrorCode} — ${e.Title}`)
        .join('; ')}`,
      kind: 'provider',
      endpoint,
      httpStatus: response.status,
      providerErrors,
    })
  }

  log.debug('Barion API hívás kész', {
    ...logContext,
    httpStatus: response.status,
    durationMs,
  })
  return parsed as unknown as TResponse
}

/** POST-hívás a Barion API felé (a POSKey az x-pos-key fejlécbe és a body-ba is bekerül). */
export function barionPost<TResponse>(
  path: string,
  body: Record<string, unknown>,
  config?: BarionClientConfig,
  options: BarionCallOptions = {},
): Promise<TResponse> {
  return barionRequest<TResponse>({ method: 'POST', path, body, config, ...options })
}

/** GET-hívás a Barion API felé (a POSKey-t az x-pos-key headerbe teszi). */
export function barionGet<TResponse>(
  path: string,
  config?: BarionClientConfig,
  options: BarionCallOptions = {},
): Promise<TResponse> {
  return barionRequest<TResponse>({ method: 'GET', path, config, ...options })
}
