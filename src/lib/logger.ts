/**
 * Könnyűsúlyú, nulla extra függőségű strukturált logger.
 *
 * Egy JSON-sort ír a stdoutra eseményenként, hogy a logaggregátorok gépileg
 * feldolgozhassák. Mezők: ts, level, msg, requestId (ha a child loggerhez
 * kötöttük), context (eseményenkénti strukturált adat).
 *
 * A LOG_LEVEL környezeti változó szabályozza a minimális szintet
 * (debug | info | warn | error). Alapértelmezés: production-ben "info",
 * egyébként "debug".
 *
 * A redact-lista minden környezetben érvényes: az itt felsorolt kulcsnevek
 * értéke sosem kerül a naplóba, hanem "[REDACTED]" jelöléssel helyettesül,
 * így production-ben sem szivároghat ki érzékeny adat. Az `email` PONTOS
 * egyezés (az `emailDelivered` üzemeltetési mező megmarad); a titok-jellegű
 * kulcsok RÉSZLEGES jelölővel illeszkednek (lásd `isRedactedKey`).
 *
 * RIASZTÁS-HOROG. Az error-szintű riasztás-sor (`RIASZTÁS` előtag, vagy
 * `alert: true` a kötésben / contextben) két legfelső szintű mezőt kap:
 * `alert: true` és `alertCode`. A Railway a legfelső szintű JSON-kulcsokat
 * attribútumként szűri (`@alert:true`, `@alertCode:<kód>`), a beágyazott
 * `context` viszont szövegként érkezik, ezért kell a kód a felső szintre.
 * A sor kiírása után a logger a regisztrált riasztás-csatornát (sink) is
 * meghívja (`setAlertSink`, `src/lib/alerts/`): az e-mailt és a PostHog-
 * eseményt a sink aszinkron intézi, a hívó felé soha nem dob.
 */

import { resolveAlertCode } from './alerts/classify'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  readonly [key: string]: unknown
}

export interface Logger {
  debug(msg: string, context?: LogContext): void
  info(msg: string, context?: LogContext): void
  warn(msg: string, context?: LogContext): void
  error(msg: string, context?: LogContext): void
  /** Új logger ugyanazzal a beállítással, fixen kötött mezőkkel (pl. requestId). */
  child(bindings: LogContext): Logger
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const REDACTED_VALUE = '[REDACTED]'

/**
 * Kulcsnevek (kis-nagybetű érzéketlen egyezés), amelyek értéke sosem naplózható.
 * Barion/Számlázz.hu/kártyás integrációk miatt a lista szándékosan bőv.
 *
 * Az `email` személyes adat (GDPR), ezért szintén a listán van: a napló
 * aggregátorba és mentésekbe kerül, a címzett-lista pedig egy kiszivárgott
 * naplóból közvetlenül támadható (célzott adathalászat, fiók-létezés
 * megerősítése). Ahol a cím az üzemeltetéshez tényleg kell, ott MASZKOLVA és
 * MÁS kulcsnéven megy (`maskEmail` → pl. `cimzett`, `identifier`) — így a
 * naplóban a domain és az első betű látszik, a teljes cím nem.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set(
  [
    'email',
    'password',
    'jelszo',
    'passphrase',
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'idtoken',
    'id_token',
    'secret',
    'payloadsecret',
    'payload_secret',
    'poskey',
    'apikey',
    'api_key',
    'agentkey',
    'agent_key',
    'szamlaagentkulcs',
    'cardnumber',
    'card_number',
    'cardexpiry',
    'card_expiry',
    'cvv',
    'cvc',
    'pin',
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'session',
    'sessionid',
    'session_id',
    'privatekey',
    'private_key',
    'accesskey',
    'access_key',
    'libraryapikey',
    'library_api_key',
  ].map((key) => key.toLowerCase()),
)

/**
 * Részleges, kisbetűs jelölők a titok-jellegű kulcsnevekre — az audit
 * `isSensitiveAuditKey` mintájára (`src/lib/audit.ts`). Így a
 * `resetPasswordToken`, `accessToken`, `sessions` és `activationUrl`
 * sem szivárog ki. Az `email` SZÁNDÉKOSAN nincs itt: az `emailDelivered`
 * üzemeltetési mező a terméknaplókban maradjon olvasható.
 */
const REDACT_KEY_MARKERS = ['password', 'token', 'secret', 'session', 'activation'] as const

function isRedactedKey(key: string): boolean {
  const lowered = key.toLowerCase()
  if (REDACTED_KEYS.has(lowered)) {
    return true
  }
  return REDACT_KEY_MARKERS.some((marker) => lowered.includes(marker))
}

function envValue(key: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined
  }
  return process.env[key]
}

function parseLogLevel(raw: string | undefined): LogLevel | undefined {
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw
  }
  return undefined
}

function resolveMinLevel(): LogLevel {
  const fromEnv = parseLogLevel(envValue('LOG_LEVEL'))
  if (fromEnv) {
    return fromEnv
  }
  return envValue('NODE_ENV') === 'production' ? 'info' : 'debug'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Mélységkorlátos, körkörösség-biztos redakció: a listázott kulcsok értékét
 * helyettesíti, a többit változatlan struktúrában hagyja.
 */
function redactValue(value: unknown, seen: ReadonlySet<object>, depth: number): unknown {
  if (depth > 6) {
    return '[TRUNCATED]'
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1))
  }
  if (!isPlainRecord(value)) {
    return value
  }
  if (seen.has(value)) {
    return '[CIRCULAR]'
  }
  const nextSeen = new Set(seen)
  nextSeen.add(value)
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = isRedactedKey(key) ? REDACTED_VALUE : redactValue(item, nextSeen, depth + 1)
  }
  return output
}

/** A riasztás-csatornának átadott, MÁR REDAKTÁLT riasztás-sor. */
export interface AlertLogEntry {
  readonly ts: string
  readonly msg: string
  readonly alertCode: string
  /** A logger kötései (requestId, module, orderNumber…), redakció után. */
  readonly bindings: Readonly<Record<string, unknown>>
  /** Az eseményenkénti context, redakció után (ha volt). */
  readonly context?: Readonly<Record<string, unknown>>
}

/**
 * Riasztás-csatorna: szinkron hívódik a sor kiírása után. A lassú munkát
 * (e-mail, PostHog) a csatorna maga ütemezi aszinkronra.
 */
export type AlertSink = (entry: AlertLogEntry) => void

/**
 * A csatorna a `globalThis`-en él, nem modul-változóban: a Next a szerver-
 * kódot több bundle-be (route handler, admin-nézet, instrumentation) is
 * becsomagolhatja, és mindegyik saját logger-példányt kaphat. A globális
 * szimbólum-kulcs miatt EGY regisztráció minden példányra érvényes.
 */
const ALERT_SINK_KEY = Symbol.for('kineticare.logger.alertSink')

type AlertSinkHolder = { [ALERT_SINK_KEY]?: AlertSink }

/** Riasztás-csatorna beállítása (`undefined`: leválasztás, teszthez). */
export function setAlertSink(sink: AlertSink | undefined): void {
  const holder = globalThis as AlertSinkHolder
  if (sink === undefined) {
    delete holder[ALERT_SINK_KEY]
    return
  }
  holder[ALERT_SINK_KEY] = sink
}

/** Van-e regisztrált riasztás-csatorna. */
export function hasAlertSink(): boolean {
  return (globalThis as AlertSinkHolder)[ALERT_SINK_KEY] !== undefined
}

/**
 * Szinkron újrabelépés-őr: ha a csatorna maga ír error-sort (közvetlenül,
 * a hívásán belül), az nem hívja újra a csatornát. Az aszinkron ágat a
 * csatorna saját őre védi (`src/lib/alerts/sink.ts`).
 */
let alertSinkActive = false

function notifyAlertSink(entry: AlertLogEntry): void {
  const sink = (globalThis as AlertSinkHolder)[ALERT_SINK_KEY]
  if (sink === undefined || alertSinkActive) {
    return
  }
  alertSinkActive = true
  try {
    sink(entry)
  } catch {
    // A riasztás-csatorna hibája nem juthat vissza a naplózó hívóhoz: a sor
    // már kiíródott, ez a riasztás legfontosabb csatornája.
  } finally {
    alertSinkActive = false
  }
}

function serialize(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry)
  } catch {
    // Végső fallback, ha bármilyen szerializálási hiba mégis előfordulna.
    return JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      msg: 'A naplóbejegyzés nem szerializálható.',
    })
  }
}

class StructuredLogger implements Logger {
  private readonly minLevel: LogLevel
  private readonly bindings: LogContext

  constructor(minLevel: LogLevel, bindings: LogContext) {
    this.minLevel = minLevel
    this.bindings = bindings
  }

  child(bindings: LogContext): Logger {
    return new StructuredLogger(this.minLevel, { ...this.bindings, ...bindings })
  }

  debug(msg: string, context?: LogContext): void {
    this.write('debug', msg, context)
  }

  info(msg: string, context?: LogContext): void {
    this.write('info', msg, context)
  }

  warn(msg: string, context?: LogContext): void {
    this.write('warn', msg, context)
  }

  error(msg: string, context?: LogContext): void {
    this.write('error', msg, context)
  }

  private write(level: LogLevel, msg: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) {
      return
    }
    const redactedBindings = redactValue(this.bindings, new Set(), 0)
    const bindings = isPlainRecord(redactedBindings) ? redactedBindings : {}
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...bindings,
    }
    const alertCode = level === 'error' ? resolveAlertCode(msg, this.bindings, context) : null
    if (alertCode !== null) {
      entry.alert = true
      entry.alertCode = alertCode
    }
    let redactedContext: Record<string, unknown> | undefined
    if (context && Object.keys(context).length > 0) {
      const redacted = redactValue(context, new Set(), 0)
      redactedContext = isPlainRecord(redacted) ? redacted : undefined
      entry.context = redacted
    }
    console.log(serialize(entry))
    if (alertCode !== null) {
      notifyAlertSink({
        ts: String(entry.ts),
        msg,
        alertCode,
        bindings,
        ...(redactedContext ? { context: redactedContext } : {}),
      })
    }
  }
}

/** Új logger példány, opcionális fixen kötött mezőkkel (pl. { requestId }). */
export function createLogger(bindings: LogContext = {}): Logger {
  return new StructuredLogger(resolveMinLevel(), bindings)
}

/** Alapértelmezett, kötetlen logger. */
export const logger = createLogger()
