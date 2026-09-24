/**
 * A riasztás-levél és a PostHog-esemény adattartalma. Tiszta modul: nincs
 * benne hálózat, logger vagy óra (az időpontot a hívó adja).
 *
 * ADATVÉDELEM. A naplósor kötései és contextje sok mindent hordozhatnak
 * (maszkolt e-mail, ügyfél-azonosító, hibaszöveg). A levélbe és a PostHogba
 * EZÉRT csak egy zárt kulcslista kerül (`SAFE_ALERT_FIELDS`), és abból is
 * csak rövid, kódszerű érték: szám, logikai érték vagy `[A-Za-z0-9 _.:/-]`
 * karakterekből álló, legfeljebb 80 hosszú szöveg. Személyes adatnak ebből
 * egyedül a rendelésszám számít, amit a feladat kifejezetten megenged. Az
 * üzenet szövegéből az esetleges e-mail-címet kitakarjuk.
 */

import { budapestDateTimeString } from '../date/budapest'
import { stripAlertPrefix } from './classify'

/** A riasztási runbook helye a repóban (a levél erre mutat). */
export const ALERT_RUNBOOK_PATH = 'docs/uzemeltetes/11-riasztas-es-ugyelet.md'

/** A levél tárgyának előtagja: a postafiókban szűrhető. */
export const ALERT_MAIL_SUBJECT_PREFIX = 'Kineticare riasztás:'

/** A PostHog-esemény neve (e-mailes trend-riasztás erre állítható). */
export const ALERT_POSTHOG_EVENT = 'kc_alert'

/** A szerveroldali esemény azonosítója: nem személy, nem kap profilt. */
export const ALERT_POSTHOG_DISTINCT_ID = 'kineticare-szerver'

/**
 * A levélbe és a PostHogba átengedett kulcsok. Mind üzemeltetési adat;
 * ügyfél-azonosító, e-mail, IP, hibaszöveg nincs köztük.
 */
export const SAFE_ALERT_FIELDS: readonly string[] = [
  'orderNumber',
  'orderId',
  'requestId',
  'module',
  'taskSlug',
  'queue',
  'httpStatus',
  'failureClass',
  'barionErrorKind',
  'reason',
  'action',
  'source',
  'provider',
  'stuckJobs',
  'releasedJobs',
  'skippedOrders',
  'invoiceResweep',
  'ageHours',
]

const SAFE_TEXT_PATTERN = /^[A-Za-z0-9 _.:/-]{1,80}$/
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const MAX_MESSAGE_LENGTH = 600
const MAX_SUBJECT_DETAIL_LENGTH = 90

export type SafeAlertValue = string | number | boolean

export interface AlertSummary {
  readonly alertCode: string
  /** Az üzenet, e-mail-címek nélkül, vágva. */
  readonly message: string
  /** Mikor íródott ki a naplósor (ISO). */
  readonly ts: string
  readonly fields: Readonly<Record<string, SafeAlertValue>>
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeValue(value: unknown): SafeAlertValue | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string' && SAFE_TEXT_PATTERN.test(value) && !value.includes('@')) {
    return value
  }
  return undefined
}

/** Az e-mail-címek kitakarása a szabad szövegből. */
export function scrubEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, '[e-mail-cím]')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * A naplósorból a továbbítható összefoglaló. A context felülírja a kötést
 * (a hívás-szintű adat a specifikusabb).
 */
export function summarizeAlert(input: {
  readonly alertCode: string
  readonly msg: string
  readonly ts: string
  readonly bindings: unknown
  readonly context?: unknown
}): AlertSummary {
  const merged: Record<string, unknown> = {
    ...(isRecord(input.bindings) ? input.bindings : {}),
    ...(isRecord(input.context) ? input.context : {}),
  }
  const fields: Record<string, SafeAlertValue> = {}
  for (const key of SAFE_ALERT_FIELDS) {
    const value = safeValue(merged[key])
    if (value !== undefined) {
      fields[key] = value
    }
  }
  return {
    alertCode: input.alertCode,
    message: truncate(scrubEmails(input.msg.trim()), MAX_MESSAGE_LENGTH),
    ts: input.ts,
    fields,
  }
}

/** A PostHog-esemény tulajdonságai: kód, környezet és a biztonságos mezők. */
export function alertPostHogProperties(
  summary: AlertSummary,
  environment: string | undefined,
): Record<string, unknown> {
  return {
    ...summary.fields,
    alertCode: summary.alertCode,
    kc_context: 'server:alert',
    environment: environment ?? 'ismeretlen',
    $process_person_profile: false,
    $geoip_disable: true,
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function budapestTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : `${budapestDateTimeString(date)} (magyar idő)`
}

export interface AlertMail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

/**
 * A riasztás-levél. Egy mondat arról, mi történt, utána a kód, az időpont,
 * a rendelésszám (ha van), és hogy hol nézze meg a tulajdonos a részleteket.
 */
export function buildAlertMail(summary: AlertSummary, suppressedSinceLast: number): AlertMail {
  const detail = truncate(stripAlertPrefix(summary.message), MAX_SUBJECT_DETAIL_LENGTH)
  const subject = `${ALERT_MAIL_SUBJECT_PREFIX} ${detail.length > 0 ? detail : summary.alertCode}`
  const { orderNumber, requestId, ...rest } = summary.fields
  const extra = Object.entries(rest).map(([key, value]) => `${key}: ${String(value)}`)
  const filter = `@alertCode:${summary.alertCode}`

  const lines: string[] = [
    'Riasztás érkezett a Kineticare rendszeréből.',
    '',
    'Mi történt:',
    summary.message,
    '',
    `Riasztáskód: ${summary.alertCode}`,
    `Időpont: ${budapestTime(summary.ts)}`,
    ...(orderNumber !== undefined ? [`Rendelésszám: ${String(orderNumber)}`] : []),
    ...(requestId !== undefined ? [`Kérésazonosító: ${String(requestId)}`] : []),
    ...(extra.length > 0 ? [`További adatok: ${extra.join(', ')}`] : []),
    ...(suppressedSinceLast > 0
      ? ['', `Az előző levél óta még ${String(suppressedSinceLast)} alkalommal jelentkezett.`]
      : []),
    '',
    `Részletek: a Railway naplójában (Kineticare szolgáltatás, Logs fül) ezzel a szűrővel: ${filter}`,
    `Teendő: a tulajdonosi kézikönyv riasztási fejezete kódonként leírja (${ALERT_RUNBOOK_PATH}).`,
    '',
    'Ugyanerre a riasztásra legfeljebb óránként egy levél megy. A nyitott ügyek a reggeli napi összesítőben is szerepelnek.',
  ]

  const htmlParagraphs: string[] = [
    '<p>Riasztás érkezett a Kineticare rendszeréből.</p>',
    `<p><strong>Mi történt:</strong><br>${escapeHtml(summary.message)}</p>`,
    '<p>',
    `Riasztáskód: <code>${escapeHtml(summary.alertCode)}</code><br>`,
    `Időpont: ${escapeHtml(budapestTime(summary.ts))}`,
    ...(orderNumber !== undefined
      ? [`<br>Rendelésszám: <strong>${escapeHtml(String(orderNumber))}</strong>`]
      : []),
    ...(requestId !== undefined ? [`<br>Kérésazonosító: ${escapeHtml(String(requestId))}`] : []),
    ...(extra.length > 0 ? [`<br>További adatok: ${escapeHtml(extra.join(', '))}`] : []),
    '</p>',
    ...(suppressedSinceLast > 0
      ? [`<p>Az előző levél óta még ${String(suppressedSinceLast)} alkalommal jelentkezett.</p>`]
      : []),
    `<p>Részletek: a Railway naplójában (Kineticare szolgáltatás, Logs fül) ezzel a szűrővel: <code>${escapeHtml(filter)}</code><br>`,
    `Teendő: a tulajdonosi kézikönyv riasztási fejezete kódonként leírja (${escapeHtml(ALERT_RUNBOOK_PATH)}).</p>`,
    '<p>Ugyanerre a riasztásra legfeljebb óránként egy levél megy. A nyitott ügyek a reggeli napi összesítőben is szerepelnek.</p>',
  ]

  return { subject, text: lines.join('\n'), html: htmlParagraphs.join('\n') }
}

/**
 * A Resend-idempotenciakulcs: kód + UTC-óra. Deploy-átfedéskor a két
 * folyamat ugyanabban az órában ugyanazt a kulcsot küldi, így a Resend csak
 * egy levelet kézbesít (a kulcs 24 óráig él, max. 256 karakter:
 * https://resend.com/docs/dashboard/emails/idempotency-keys).
 */
export function alertIdempotencyKey(alertCode: string, nowMs: number): string {
  return `kc-riasztas-${alertCode}-${new Date(nowMs).toISOString().slice(0, 13)}`
}

/**
 * Az OWNER_ALERT_EMAILS értelmezése: vesszővel, pontosvesszővel vagy
 * szóközzel elválasztott címek; az érvénytelen tétel kimarad, a duplikátum
 * egyszer szerepel, legfeljebb 10 cím.
 */
export function parseAlertRecipients(raw: string | undefined): string[] {
  if (typeof raw !== 'string') {
    return []
  }
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\s]+/)) {
    const address = part.trim()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      seen.add(address)
    }
    if (seen.size >= 10) {
      break
    }
  }
  return [...seen]
}
