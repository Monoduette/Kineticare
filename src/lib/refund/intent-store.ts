import { randomBytes } from 'node:crypto'
import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'

import type { RefundIntent } from '../../payload-types'
import {
  activeRefundOrderKey,
  decideRefundIntentCreation,
  decideRefundIntentTransition,
  digestRefundIdempotencyKey,
  hashRefundIntentRequestV1,
  isRefundIntentState,
  validateRefundIntentRequestV1,
  type CanonicalRefundIntentRequestV1,
  type RefundIntentProviderNoEffectEvidence,
  type RefundIntentState,
} from './refund-intent'

export type { RefundIntent } from '../../payload-types'

export class RefundIntentStoreError extends Error {
  constructor(
    readonly code:
      | 'unavailable'
      | 'invalid_record'
      | 'incomplete_lookup'
      | 'conflict'
      | 'invalid_transition'
      | 'transition_conflict'
      | 'persistence',
  ) {
    super(`Refund intent storage: ${code}`)
    this.name = 'RefundIntentStoreError'
  }
}

interface Executor {
  execute(query: SQL): Promise<unknown>
}

interface Database extends Executor {
  transaction<T>(run: (tx: Executor) => Promise<T>): Promise<T>
}

const MAX_RECORDS = 1_000
const DIGEST = /^[a-f0-9]{64}$/u
const columns = sql`id, order_id AS "order", actor_id AS "actor",
  requested_amount_huf AS "requestedAmountHuf", provider,
  provider_payment_id AS "providerPaymentId", provider_transaction_id AS "providerTransactionId",
  state, request_hash AS "requestHash", idempotency_key_hash AS "idempotencyKeyHash",
  active_order_key AS "activeOrderKey", schema_version AS "schemaVersion",
  refund_sequence AS "refundSequence", currency, reason,
  provider_started_at AS "providerStartedAt", provider_resolved_at AS "providerResolvedAt",
  committed_at AS "committedAt", reconciliation_checked_at AS "reconciliationCheckedAt",
  reconciliation_reference AS "reconciliationReference", created_at AS "createdAt",
  updated_at AS "updatedAt"`

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function database(payload: Payload): Database {
  const db: unknown = payload.db
  const candidate = record(db) ? db.drizzle : undefined
  if (
    !record(candidate) ||
    typeof candidate.execute !== 'function' ||
    typeof candidate.transaction !== 'function'
  ) {
    throw new RefundIntentStoreError('unavailable')
  }
  return candidate as unknown as Database
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof RefundIntentStoreError) throw error
    // SQL hibaszoveg/parameterek nem kerulhetnek a route valaszaba vagy a naploba.
    throw new RefundIntentStoreError('persistence')
  }
}

function integer(value: unknown): number {
  const number = typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
    throw new RefundIntentStoreError('invalid_record')
  }
  return number
}

function timestamp(value: unknown, required = false): string | null {
  if (value === null && !required) return null
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new RefundIntentStoreError('invalid_record')
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new RefundIntentStoreError('invalid_record')
  return date.toISOString()
}

function noEffect(intent: RefundIntent): RefundIntentProviderNoEffectEvidence | undefined {
  return intent.state === 'provider_failed' &&
    intent.reconciliationCheckedAt &&
    intent.reconciliationReference
    ? {
        kind: 'provider_confirmed_no_effect',
        confirmedAt: intent.reconciliationCheckedAt,
        reference: intent.reconciliationReference,
      }
    : undefined
}

function parseIntent(value: unknown): RefundIntent {
  if (!record(value) || !isRefundIntentState(value.state)) {
    throw new RefundIntentStoreError('invalid_record')
  }
  const order = integer(value.order)
  const actor = integer(value.actor)
  let request: CanonicalRefundIntentRequestV1
  try {
    request = validateRefundIntentRequestV1({
      schemaVersion: integer(value.schemaVersion),
      actorId: String(actor),
      orderId: String(order),
      provider: value.provider,
      providerPaymentId: value.providerPaymentId,
      providerTransactionId: value.providerTransactionId,
      refundSequence: integer(value.refundSequence),
      requestedAmountHuf: integer(value.requestedAmountHuf),
      currency: value.currency,
      reason: value.reason,
    })
  } catch {
    throw new RefundIntentStoreError('invalid_record')
  }
  if (
    value.requestHash !== hashRefundIntentRequestV1(request) ||
    value.reason !== request.reason ||
    typeof value.idempotencyKeyHash !== 'string' ||
    !DIGEST.test(value.idempotencyKeyHash) ||
    (value.activeOrderKey !== null && typeof value.activeOrderKey !== 'string') ||
    (value.reconciliationReference !== null && typeof value.reconciliationReference !== 'string')
  ) {
    throw new RefundIntentStoreError('invalid_record')
  }
  const intent: RefundIntent = {
    id: integer(value.id),
    order,
    actor,
    requestedAmountHuf: request.requestedAmountHuf,
    provider: request.provider,
    providerPaymentId: request.providerPaymentId,
    providerTransactionId: request.providerTransactionId,
    state: value.state,
    requestHash: value.requestHash,
    idempotencyKeyHash: value.idempotencyKeyHash,
    activeOrderKey: value.activeOrderKey,
    schemaVersion: request.schemaVersion,
    refundSequence: request.refundSequence,
    currency: request.currency,
    reason: request.reason,
    providerStartedAt: timestamp(value.providerStartedAt, value.state !== 'prepared'),
    providerResolvedAt: timestamp(
      value.providerResolvedAt,
      ['provider_failed', 'provider_succeeded', 'committed'].includes(value.state),
    ),
    committedAt: timestamp(value.committedAt, value.state === 'committed'),
    reconciliationCheckedAt: timestamp(
      value.reconciliationCheckedAt,
      value.state === 'provider_failed',
    ),
    reconciliationReference: value.reconciliationReference,
    createdAt: timestamp(value.createdAt, true)!,
    updatedAt: timestamp(value.updatedAt, true)!,
  }
  const evidence = noEffect(intent)
  if (
    (intent.state === 'prepared' && intent.providerStartedAt !== null) ||
    (!['provider_failed', 'provider_succeeded', 'committed'].includes(intent.state) &&
      intent.providerResolvedAt !== null) ||
    (intent.state !== 'committed' && intent.committedAt !== null) ||
    (intent.state !== 'provider_failed' &&
      (intent.reconciliationCheckedAt !== null || intent.reconciliationReference !== null)) ||
    (intent.state === 'provider_failed' &&
      !decideRefundIntentTransition('provider_started', 'provider_failed', evidence).allowed) ||
    intent.activeOrderKey !== activeRefundOrderKey(String(order), intent.state, evidence)
  ) {
    throw new RefundIntentStoreError('invalid_record')
  }
  return intent
}

function rows(result: unknown): unknown[] {
  if (!record(result) || !Array.isArray(result.rows) || result.rowCount !== result.rows.length) {
    throw new RefundIntentStoreError('persistence')
  }
  return result.rows
}

async function loadRelevant(
  db: Executor,
  orderId: number,
  keyHash?: string,
): Promise<RefundIntent[]> {
  const result = rows(
    await db.execute(sql`SELECT ${columns} FROM "public"."refund_intents"
    WHERE order_id = ${orderId}
      OR active_order_key = ${activeRefundOrderKey(String(orderId), 'prepared')}
      ${keyHash ? sql`OR idempotency_key_hash = ${keyHash}` : sql``}
    ORDER BY id LIMIT ${MAX_RECORDS + 1}`),
  )
  if (result.length > MAX_RECORDS) throw new RefundIntentStoreError('incomplete_lookup')
  const intents = result.map(parseIntent)
  if (
    new Set(intents.map((intent) => intent.id)).size !== intents.length ||
    new Set(intents.map((intent) => intent.idempotencyKeyHash)).size !== intents.length ||
    intents.some((intent) => intent.order !== orderId && intent.idempotencyKeyHash !== keyHash)
  ) {
    throw new RefundIntentStoreError('invalid_record')
  }
  const committedSequences = intents
    .filter((intent) => intent.order === orderId && intent.state === 'committed')
    .map((intent) => intent.refundSequence)
  if (new Set(committedSequences).size !== committedSequences.length) {
    throw new RefundIntentStoreError('invalid_record')
  }
  const active = intents.filter(
    (intent) => intent.order === orderId && intent.activeOrderKey !== null,
  )
  if (active.length > 1) throw new RefundIntentStoreError('invalid_record')
  return intents
}

/** Teljes, korlatos olvasas: hibas vagy tul nagy elozmeny nem jelent ures fokoenyvet. */
export async function loadActiveRefundIntent(
  payload: Payload,
  orderId: number | string,
): Promise<RefundIntent | null> {
  return guarded(async () => {
    const id = integer(orderId)
    const intents = await loadRelevant(database(payload), id)
    return intents.find((intent) => intent.order === id && intent.activeOrderKey !== null) ?? null
  })
}

/** A completed operation remains addressable after its active order key is released. */
export async function loadRefundIntentForOperation(
  payload: Payload,
  orderId: number | string,
  rawApplicationKey: string,
): Promise<RefundIntent | null> {
  return guarded(async () => {
    const id = integer(orderId)
    let keyHash: string
    try {
      keyHash = digestRefundIdempotencyKey(rawApplicationKey)
    } catch {
      throw new RefundIntentStoreError('invalid_record')
    }
    const intents = await loadRelevant(database(payload), id, keyHash)
    const intent = intents.find((candidate) => candidate.idempotencyKeyHash === keyHash)
    if (intent && intent.order !== id) throw new RefundIntentStoreError('conflict')
    return intent ?? null
  })
}

/** Shared invoice callers must also see committed intents, not only the active one. */
export async function loadRefundIntentsForOrder(
  payload: Payload,
  orderId: number | string,
): Promise<RefundIntent[]> {
  return guarded(() => loadRelevant(database(payload), integer(orderId)))
}

/** Csak uj prepared rekordot ad vissza; a replay soha nem inditasi engedely. */
export async function createRefundIntent(
  payload: Payload,
  request: CanonicalRefundIntentRequestV1,
  rawApplicationKey?: string,
): Promise<RefundIntent> {
  return guarded(async () => {
    const canonical = validateRefundIntentRequestV1(request)
    const orderId = integer(canonical.orderId)
    const actorId = integer(canonical.actorId)
    if (String(orderId) !== canonical.orderId || String(actorId) !== canonical.actorId) {
      throw new RefundIntentStoreError('invalid_record')
    }
    const requestHash = hashRefundIntentRequestV1(canonical)
    const keyHash = digestRefundIdempotencyKey(
      rawApplicationKey ?? randomBytes(32).toString('base64url'),
    )
    const activeKey = activeRefundOrderKey(canonical.orderId, 'prepared')
    return database(payload).transaction(async (tx) => {
      if (!record(tx) || typeof tx.execute !== 'function')
        throw new RefundIntentStoreError('unavailable')
      // Kulon nevter: a hivo mar tarthatja a order:mutate zarat masik kapcsolaton.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`refund-intent:order:${orderId}`}::text, 0))`,
      )
      const existing = await loadRelevant(tx, orderId, keyHash)
      const decision = decideRefundIntentCreation({
        orderId: canonical.orderId,
        requestHash,
        idempotencyKeyHash: keyHash,
        refundSequence: canonical.refundSequence,
        existingRecords: existing.map((intent) => ({
          ...intent,
          orderId: String(intent.order),
        })),
      })
      if (decision.kind !== 'create') throw new RefundIntentStoreError('conflict')
      const inserted = rows(
        await tx.execute(sql`INSERT INTO "public"."refund_intents"
        (order_id, actor_id, requested_amount_huf, provider, provider_payment_id,
         provider_transaction_id, state, request_hash, idempotency_key_hash, active_order_key,
         schema_version, refund_sequence, currency, reason)
        VALUES (${orderId}, ${actorId}, ${canonical.requestedAmountHuf}, ${canonical.provider},
          ${canonical.providerPaymentId}, ${canonical.providerTransactionId}, 'prepared',
          ${requestHash}, ${keyHash}, ${activeKey}, ${canonical.schemaVersion},
          ${canonical.refundSequence}, ${canonical.currency}, ${canonical.reason})
        RETURNING ${columns}`),
      )
      if (inserted.length !== 1) throw new RefundIntentStoreError('persistence')
      const intent = parseIntent(inserted[0])
      if (
        intent.state !== 'prepared' ||
        intent.requestHash !== requestHash ||
        intent.idempotencyKeyHash !== keyHash
      ) {
        throw new RefundIntentStoreError('persistence')
      }
      return intent
    })
  })
}

/** Egyetlen SQL CAS; csak az igazolt prepared -> provider_started jogosult POST-ra. */
export async function transitionRefundIntent(
  payload: Payload,
  intent: RefundIntent,
  to: RefundIntentState,
  evidence?: RefundIntentProviderNoEffectEvidence,
): Promise<RefundIntent> {
  return guarded(async () => {
    const current = parseIntent(intent)
    const decision = decideRefundIntentTransition(current.state, to, evidence)
    if (!decision.allowed) throw new RefundIntentStoreError('invalid_transition')
    const now = new Date().toISOString()
    const next: RefundIntent = {
      ...current,
      state: to,
      activeOrderKey: activeRefundOrderKey(String(current.order), to, evidence),
      providerStartedAt: to === 'provider_started' ? now : current.providerStartedAt,
      providerResolvedAt: ['provider_failed', 'provider_succeeded'].includes(to)
        ? now
        : current.providerResolvedAt,
      committedAt: to === 'committed' ? now : current.committedAt,
      ...decision.persistence,
      updatedAt: now,
    }
    parseIntent(next)
    const updated = rows(
      await database(payload).execute(sql`UPDATE "public"."refund_intents"
      SET state = ${next.state}, active_order_key = ${next.activeOrderKey},
        provider_started_at = ${next.providerStartedAt}, provider_resolved_at = ${next.providerResolvedAt},
        committed_at = ${next.committedAt}, reconciliation_checked_at = ${next.reconciliationCheckedAt},
        reconciliation_reference = ${next.reconciliationReference}, updated_at = ${next.updatedAt}
      WHERE id = ${current.id} AND state = ${current.state}
        AND active_order_key IS NOT DISTINCT FROM ${current.activeOrderKey}
        AND request_hash = ${current.requestHash} AND idempotency_key_hash = ${current.idempotencyKeyHash}
        AND order_id = ${current.order}
      RETURNING ${columns}`),
    )
    if (updated.length === 0) throw new RefundIntentStoreError('transition_conflict')
    if (updated.length !== 1) throw new RefundIntentStoreError('persistence')
    const persisted = parseIntent(updated[0])
    if (JSON.stringify(persisted) !== JSON.stringify(next)) {
      throw new RefundIntentStoreError('persistence')
    }
    return persisted
  })
}
