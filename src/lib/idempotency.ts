import type { Payload, Where } from 'payload'

import { shouldEmitThrottledAlert } from './alert-throttle'
import { logger } from './logger'

/**
 * Webhook-idempotencia: (provider, externalId) unique + státuszgép (received/processed/failed).
 */

export type WebhookProvider = 'barion' | 'stream' | 'szamlazz'

export type WebhookEventStatus = 'received' | 'processed' | 'failed'

/**
 * NEM terminális webhook-kimenetelek (`pending_repoll`): a rekord `received` marad,
 * hogy a későbbi Succeeded callback ne essen el duplikátumként.
 */
export const NON_TERMINAL_WEBHOOK_RESULTS: readonly string[] = ['pending_repoll']

/** A TÁROLT `result` mező jelöl-e nem terminális (újrafeldolgozható) kimenetelt? */
export function isNonTerminalWebhookResult(result: string | null | undefined): boolean {
  return typeof result === 'string' && NON_TERMINAL_WEBHOOK_RESULTS.includes(result)
}

/**
 * VÉGLEGESEN lezárt-e az esemény? Csak ilyenkor szabad a következő kézbesítést
 * duplikátumként eldobni. (A `processed` + nem terminális eredmény kombináció a
 * B4 előtti kódból maradt sorokon fordulhat elő — azok is újrafeldolgozhatók.)
 */
export function isTerminallyProcessed(
  event: Pick<WebhookEventDoc, 'status' | 'result'>,
): boolean {
  return event.status === 'processed' && !isNonTerminalWebhookResult(event.result)
}

/**
 * A handler ezzel a mezővel jelzi vissza, hogy az esemény ÜZLETILEG NEM zárult
 * le (pl. a fizetés még függőben van). Ilyenkor a rekord `received` marad, tehát
 * a következő kézbesítés — és a webhook-retry job — újra feldolgozza.
 */
export interface NonTerminalHandlerOutcome {
  webhookNonTerminal: true
}

/** A handler visszatérési értéke jelöl-e nem terminális kimenetelt? */
export function isNonTerminalHandlerOutcome(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { webhookNonTerminal?: unknown }).webhookNonTerminal === true
  )
}

export interface WebhookEventDoc {
  id: number | string
  provider: WebhookProvider
  externalId: string
  eventType?: string | null
  payload?: unknown
  status: WebhookEventStatus
  attempts?: number | null
  lastError?: string | null
  requestId?: string | null
  /** A sikeres/végleges feldolgozás időpontja (hiba esetén null — retryable). */
  processedAt?: string | null
  /** Az utolsó feldolgozás üzleti kimenetele (pl. paid/cancelled/pending_repoll/failed/rejected). */
  result?: string | null
  updatedAt?: string
  createdAt?: string
}

/**
 * Minimális, strukturálisan mockolható tárolófelület a webhook-events
 * collectionhöz. A payload-types.ts a konsolidációs migrációs loop végéig még
 * nem tartalmazza ezt a collectiont, ezért a valódi Payload-példányt egyetlen,
 * dokumentált határponton (webhookEventStore) adjuk át — a belső logika és a
 * tesztek típusosak maradnak.
 */
export interface WebhookEventStore {
  find: (args: {
    collection: 'webhook-events'
    where?: Where
    sort?: string
    limit?: number
    overrideAccess?: boolean
  }) => Promise<{ docs: WebhookEventDoc[]; totalDocs: number }>
  create: (args: {
    collection: 'webhook-events'
    data: Record<string, unknown>
    overrideAccess?: boolean
  }) => Promise<WebhookEventDoc>
  update: (args: {
    collection: 'webhook-events'
    id: number | string
    data: Record<string, unknown>
    overrideAccess?: boolean
  }) => Promise<WebhookEventDoc>
}

export function webhookEventStore(payload: Payload): WebhookEventStore {
  return payload as unknown as WebhookEventStore
}

/** Egy esemény maximális feldolgozási kísérletei (első + újrapróbálások). */
export const MAX_WEBHOOK_ATTEMPTS = 5

/** Exponenciális backoff alapja és plafonja a retry-jobhoz. */
export const WEBHOOK_RETRY_BASE_MS = 60_000
export const WEBHOOK_RETRY_CAP_MS = 3_600_000

export type WebhookHandler = (event: WebhookEventDoc) => Promise<unknown>

export interface ProcessWebhookParams {
  store: WebhookEventStore
  provider: WebhookProvider
  externalId: string
  eventType?: string
  /** A nyers webhook-body — az első érkezéskor tároljuk (hibakereséshez). */
  payloadData?: unknown
  requestId?: string
  handler: WebhookHandler
}

export type ProcessWebhookOutcome =
  | {
      kind: 'processed'
      eventId: number | string
      attempts: number
      result: unknown
      /** true → a handler NEM terminális kimenetelt adott: a rekord received maradt. */
      nonTerminal?: boolean
    }
  /** Már korábban sikeresen feldolgoztuk — no-op, a korábbi eredmény jelzése. */
  | { kind: 'already-processed'; eventId: number | string }
  /** Versenyhelyzet: egy párhuzamos worker hozta létre / dolgozza fel éppen. */
  | { kind: 'in-progress'; eventId?: number | string }
  | {
      kind: 'failed'
      eventId: number | string
      attempts: number
      retryable: boolean
      error: string
    }

/** Postgres unique-violation (23505) felismerése a hibaláncban (cause-okkal együtt). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (candidate.code === '23505') {
      return true
    }
    if (typeof candidate.message === 'string' && candidate.message.includes('duplicate key')) {
      return true
    }
    current = candidate.cause
  }
  return false
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function findByKey(store: WebhookEventStore, provider: WebhookProvider, externalId: string) {
  return store.find({
    collection: 'webhook-events',
    where: {
      and: [{ provider: { equals: provider } }, { externalId: { equals: externalId } }],
    },
    limit: 1,
    overrideAccess: true,
  })
}

/** A státuszgép közös magja: attempts++ → handler → processed/failed. */
async function attemptProcessing(
  store: WebhookEventStore,
  record: WebhookEventDoc,
  handler: WebhookHandler,
): Promise<ProcessWebhookOutcome> {
  const attempts = (record.attempts ?? 0) + 1
  try {
    const result = await handler(record)
    // NEM TERMINÁLIS kimenetel (pl. még függő fizetés): a rekord `received`
    // marad, tehát a Barion következő — ugyanarra a PaymentId-re érkező —
    // callbackje és a webhook-retry job is újra feldolgozza (B4).
    const nonTerminal = isNonTerminalHandlerOutcome(result)
    await store.update({
      collection: 'webhook-events',
      id: record.id,
      data: {
        status: nonTerminal ? 'received' : 'processed',
        attempts,
        lastError: null,
        // W13 — a `pending_repoll` kimenetel a rekordon is látszik (a handler
        // gyakran már beírta; az ismételt írás idempotens). Új enum-érték
        // NINCS: a collection selectje már tartalmazza. `processed` státuszt
        // SZÁNDÉKOSAN nem írunk — az isTerminallyProcessed akkor elnyelné a
        // későbbi Succeeded callbacket.
        ...(nonTerminal ? { result: 'pending_repoll' } : {}),
      },
      overrideAccess: true,
    })
    if (nonTerminal) {
      if (attempts >= MAX_WEBHOOK_ATTEMPTS) {
        // W13 — a scan-szűrő (attempts < MAX) innentől kihagyja a sort, a
        // failed-ágat pedig ez a kimenetel sosem járja. A riasztás ITT megy ki,
        // akkor is, ha a route-handler vitte a kísérletet. Az order-poll
        // mentőháló ettől még él. A kimerült-ISMERT rekordot a Barion ismételt
        // kézbesítése (W13) újra és újra feldolgoztatja — a már felszínre
        // hozott ügy riasztása ezért FOJTOTT (alert-throttle), nem
        // kézbesítésenként ismétlődik.
        if (shouldEmitThrottledAlert(`webhook-exhausted:${record.provider}:${record.externalId}`)) {
          logger.error(
            'RIASZTÁS: a pending_repoll újrapróbálásai kimerültek — a tulajdonosnak ellenőriznie kell ' +
              '(provider, externalId, eventId, attempts). Az order-poll mentőháló továbbra is él, ' +
              'de ez a webhook-esemény a retry-jobból kikerül.',
            {
              provider: record.provider,
              externalId: record.externalId,
              eventId: record.id,
              attempts,
            },
          )
        }
      } else if (attempts >= MAX_WEBHOOK_ATTEMPTS - 2) {
        logger.warn(
          'a pending_repoll újrapróbálásai a kimerüléshez közelednek',
          {
            provider: record.provider,
            externalId: record.externalId,
            eventId: record.id,
            attempts,
            remaining: MAX_WEBHOOK_ATTEMPTS - attempts,
          },
        )
      }
    }
    return {
      kind: 'processed',
      eventId: record.id,
      attempts,
      result,
      ...(nonTerminal ? { nonTerminal: true } : {}),
    }
  } catch (error) {
    const message = errorMessage(error)
    // A státuszfrissítés best-effort: ha ez is elhasal, a rekord received/failed
    // marad, és a retry-job később újra elviszi.
    await store
      .update({
        collection: 'webhook-events',
        id: record.id,
        data: { status: 'failed', attempts, lastError: message },
        overrideAccess: true,
      })
      .catch(() => undefined)
    return {
      kind: 'failed',
      eventId: record.id,
      attempts,
      retryable: attempts < MAX_WEBHOOK_ATTEMPTS,
      error: message,
    }
  }
}

/**
 * Idempotens webhook-feldolgozás.
 *
 * - Ha az esemény VÉGLEGESEN lezárult (`processed` + terminális `result`):
 *   no-op, `already-processed` jelzéssel.
 * - Ha `received`/`failed` (vagy nem terminális eredménnyel zárult): attempts++
 *   és újrafeldolgozás.
 * - Ha még nincs rekord: létrehozás `received` státusszal; a (provider,
 *   externalId) unique-violation elkapása azt jelenti, hogy egy párhuzamos
 *   worker már feldolgozta / éppen feldolgozza (`in-progress`).
 */
export async function processWebhook({
  store,
  provider,
  externalId,
  eventType,
  payloadData,
  requestId,
  handler,
}: ProcessWebhookParams): Promise<ProcessWebhookOutcome> {
  const existing = await findByKey(store, provider, externalId)
  const record = existing.docs[0]

  if (record) {
    // Duplikátumot CSAK a véglegesen lezárt eseményre szabad mondani: a függő
    // (pending_repoll) kimenetel után ugyanarra a PaymentId-re érkezik majd a
    // végleges státusz — azt fel KELL dolgozni (B4).
    if (isTerminallyProcessed(record)) {
      logger.info('webhook-esemény már feldolgozva — duplikátum eldobva', {
        provider,
        externalId,
        eventId: record.id,
      })
      return { kind: 'already-processed', eventId: record.id }
    }
    return attemptProcessing(store, record, handler)
  }

  let created: WebhookEventDoc
  try {
    created = await store.create({
      collection: 'webhook-events',
      data: {
        provider,
        externalId,
        status: 'received',
        attempts: 0,
        ...(eventType ? { eventType } : {}),
        ...(payloadData !== undefined ? { payload: payloadData } : {}),
        ...(requestId ? { requestId } : {}),
      },
      overrideAccess: true,
    })
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error
    }
    // Versenyhelyzet: a unique kulcs másoknak már megvan — az esemény
    // feldolgozva vagy feldolgozás alatt áll, itt semmilyen handler nem futhat.
    const raced = await findByKey(store, provider, externalId)
    const racedRecord = raced.docs[0]
    logger.info('webhook-esemény versenyhelyzetben létrejött — feldolgozás kihagyva', {
      provider,
      externalId,
      eventId: racedRecord?.id,
    })
    return { kind: 'in-progress', eventId: racedRecord?.id }
  }

  return attemptProcessing(store, created, handler)
}

// ---------------------------------------------------------------------------
// Feldolgozó-regisztráció a retry-job számára
// ---------------------------------------------------------------------------

const processors = new Map<WebhookProvider, WebhookHandler>()

/**
 * Provider-specifikus feldolgozó regisztrációja (a Barion/Számlázz.hu/Stream
 * webhook-route import idején hívja). A webhook-retry job csak regisztrált
 * feldolgozójú eseményeket futtat újra.
 */
export function registerWebhookProcessor(provider: WebhookProvider, handler: WebhookHandler): void {
  processors.set(provider, handler)
}

export function getWebhookProcessor(provider: WebhookProvider): WebhookHandler | undefined {
  return processors.get(provider)
}

/** Várakozási idő a következő kísérletig (exponenciális, plafonozott). */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0)
  return Math.min(WEBHOOK_RETRY_BASE_MS * 2 ** exponent, WEBHOOK_RETRY_CAP_MS)
}

/** A retry-job szűrése: elégséges idő telt-e el az utolsó kísérlet óta. */
export function isRetryDue(event: WebhookEventDoc, nowMs: number): boolean {
  const attempts = event.attempts ?? 0
  if (!event.updatedAt) {
    return true
  }
  const lastAttemptMs = Date.parse(event.updatedAt)
  if (Number.isNaN(lastAttemptMs)) {
    return true
  }
  return nowMs - lastAttemptMs >= retryDelayMs(Math.max(attempts, 1))
}
