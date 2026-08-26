import { createLogger } from '../logger'
import { BarionApiError, type BarionError } from './types'

/**
 * Barion API-kliens: env-feloldás, timeoutos HTTP, titokmentes naplózás.
 * Refund a rendelés-zár alatt fut — `BARION_TIMEOUT_MS` plafonja ezért 30 s.
 */

export type BarionEnvironment = 'test' | 'prod'

export interface BarionClientConfig {
  environment: BarionEnvironment
  /** API alap-URL (pl. https://api.test.barion.com) — záró perjel nélkül. */
  apiUrl: string
  /** Az AKTÍV környezet POSKey-e. Soha ne naplózd! */
  posKey: string
  payeeEmail: string
  timeoutMs: number
  recurringEnabled: boolean
}

export const BARION_DEFAULT_TIMEOUT_MS = 15_000

/** BARION_TIMEOUT_MS plafon — refund rendelés-zár alatt fut, hosszú timeout sorzár-t kockáztat. */
export const BARION_MAX_TIMEOUT_MS = 30_000

/** Az AKTÍV környezethez tartozó, elvárt Barion API-hoszt. */
export const BARION_API_HOSTS: Record<BarionEnvironment, string> = {
  test: 'api.test.barion.com',
  prod: 'api.barion.com',
}

const logger = createLogger({ module: 'barion' })

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
    logger.warn('BARION_TIMEOUT_MS a megengedett plafon fölött — a plafon érvényesül', {
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

  const posKeyEnvName = environment === 'prod' ? 'BARION_POSKEY_PROD' : 'BARION_POSKEY_TEST'

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

  return {
    environment,
    apiUrl: normalizedApiUrl,
    posKey: posKey as string,
    payeeEmail: payeeEmail as string,
    timeoutMs: parseTimeoutMs(readEnv(env, 'BARION_TIMEOUT_MS')),
    recurringEnabled: readEnv(env, 'BARION_RECURRING_ENABLED') === 'true',
  }
}

/** Válasz-body JSON-parse, egységes 'invalid_response' hibával. */
async function parseJsonBody(response: Response, endpoint: string): Promise<Record<string, unknown>> {
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

interface BarionRequestOptions {
  method: 'GET' | 'POST'
  /** Szerveroldali útvonal az apiUrl-hez képest, pl. '/v2/Payment/Start'. */
  path: string
  /** POST-body a POSKey NÉLKÜL — azt a kliens injektálja bele. */
  body?: Record<string, unknown>
  config?: BarionClientConfig
}

/**
 * Közös, timeoutos Barion HTTP-hívás.
 *
 * - POSKey: POST esetén a body-ba, GET esetén az x-pos-key headerbe kerül
 *   (URL-be sosem — így proxy-/access-logban sem jelenhet meg).
 * - Minden hívás AbortSignal.timeout-tal fut (default 15 s, BARION_TIMEOUT_MS).
 * - A Barion hibaválaszait (akár HTTP 200 mellett is jöhet Errors tömbbel)
 *   strukturált BarionApiError-é alakítja, a provider-mezők megőrzésével.
 * - Naplózás titokmentesen: endpoint, method, httpStatus, durationMs,
 *   provider-hibakódok — body és POSKey sosem.
 */
async function barionRequest<TResponse>(options: BarionRequestOptions): Promise<TResponse> {
  const config = options.config ?? getBarionConfig()
  const endpoint = `${options.method} ${options.path}`
  const url = `${config.apiUrl}${options.path}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  let body: string | undefined
  if (options.method === 'POST') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ ...options.body, POSKey: config.posKey })
  } else {
    headers['x-pos-key'] = config.posKey
  }

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    if (isAbortError(error)) {
      logger.error('Barion API hívás timeout', { endpoint, timeoutMs: config.timeoutMs, durationMs })
      throw new BarionApiError({
        message: `A Barion API nem válaszolt ${config.timeoutMs} ms-en belül (${endpoint}).`,
        kind: 'timeout',
        endpoint,
      })
    }
    logger.error('Barion API hálózati hiba', {
      endpoint,
      durationMs,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw new BarionApiError({
      message: `A Barion API elérhetetlen (${endpoint}): ${error instanceof Error ? error.message : String(error)}`,
      kind: 'network',
      endpoint,
    })
  }

  const durationMs = Date.now() - startedAt
  const parsed = await parseJsonBody(response, endpoint)
  const providerErrors = extractProviderErrors(parsed)

  if (!response.ok) {
    logger.error('Barion API HTTP-hiba', {
      endpoint,
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
    logger.error('Barion provider-hiba', {
      endpoint,
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

  logger.debug('Barion API hívás kész', { endpoint, httpStatus: response.status, durationMs })
  return parsed as unknown as TResponse
}

/** POST-hívás a Barion API felé (a POSKey-t a body-ba injektálja). */
export function barionPost<TResponse>(
  path: string,
  body: Record<string, unknown>,
  config?: BarionClientConfig,
): Promise<TResponse> {
  return barionRequest<TResponse>({ method: 'POST', path, body, config })
}

/** GET-hívás a Barion API felé (a POSKey-t az x-pos-key headerbe teszi). */
export function barionGet<TResponse>(path: string, config?: BarionClientConfig): Promise<TResponse> {
  return barionRequest<TResponse>({ method: 'GET', path, config })
}
