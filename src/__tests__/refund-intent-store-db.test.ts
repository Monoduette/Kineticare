import { randomBytes, randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createRefundIntent,
  loadActiveRefundIntent,
  transitionRefundIntent,
  type RefundIntent,
} from '@/lib/refund/intent-store'
import {
  digestRefundIdempotencyKey,
  hashRefundIntentRequestV1,
  hashRefundIntentRequest,
  type CanonicalRefundIntentRequestV1,
} from '@/lib/refund/refund-intent'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'
import { captureOwnedPostgresBootstrap } from './helpers/owned-postgres-bootstrap'

// Csak a CI vagy a kifejezetten eldobhato helyi DB fogadhatja a SQL-fixture-oket.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !(target.pathname === '/kineticare_ci' || (target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error('Refund intent DB verification requires the disposable localhost CI database')
  }
}
const hasDb = await isDatabaseAvailable()

describe.skipIf(!hasDb)('refund intent store (real PostgreSQL)', () => {
  const run = `refund-store-db-${randomUUID()}`
  const connections = new Set<Payload>()
  const bootstrapReleases = new Map<Payload, () => void>()
  let first: Payload
  let second: Payload
  let actorId: number
  let orderId: number | undefined
  let request: CanonicalRefundIntentRequestV1

  const adapter = (payload: Payload): PostgresAdapter => payload.db as unknown as PostgresAdapter
  const key = () => randomBytes(32).toString('base64url')

  async function connect(name: string): Promise<Payload> {
    const config = await configPromise
    const instance = new BasePayload()
    let releaseBootstrap: (() => void) | undefined
    const payload = await instance.init({
      config: {
        ...config,
        telemetry: false,
        typescript: { ...config.typescript, autoGenerate: false },
        db: {
          ...config.db,
          init(options) {
            const db = config.db.init(options) as unknown as PostgresAdapter
            db.poolOptions = { ...db.poolOptions, application_name: `${run}-${name}` }
            releaseBootstrap = captureOwnedPostgresBootstrap(db)
            return db
          },
        },
      },
      disableOnInit: true,
    })
    connections.add(payload)
    expect(releaseBootstrap).toBeTypeOf('function')
    bootstrapReleases.set(payload, releaseBootstrap!)
    return payload
  }

  async function close(payload: Payload): Promise<void> {
    const pool = adapter(payload).pool
    await payload.destroy()
    bootstrapReleases.get(payload)!()
    bootstrapReleases.delete(payload)
    await pool.end()
    expect(pool.ended).toBe(true)
    connections.delete(payload)
  }

  beforeAll(async () => {
    first = await connect('first')
    second = await connect('second')
    expect(adapter(first).pool).not.toBe(adapter(second).pool)
    const owner = await adapter(first).pool.query<{ id: number }>(
      'INSERT INTO users (name, role, email) VALUES ($1, $2, $3) RETURNING id',
      ['DUMMY refund concurrency owner', 'owner', `${run}@example.test`],
    )
    actorId = owner.rows[0].id
  }, 60_000)

  beforeEach(async () => {
    const order = await adapter(first).pool.query<{ id: number }>(
      'INSERT INTO orders (customer_id, status, amount, currency) VALUES ($1, $2, $3, $4) RETURNING id',
      [actorId, 'paid', 1000, 'HUF'],
    )
    orderId = order.rows[0].id
    request = {
      schemaVersion: 1,
      actorId: String(actorId),
      orderId: String(orderId),
      provider: 'barion',
      providerPaymentId: `DUMMY-payment-${randomUUID()}`,
      providerTransactionId: `DUMMY-transaction-${randomUUID()}`,
      refundSequence: 1,
      requestedAmountHuf: 100,
      currency: 'HUF',
      reason: 'DUMMY database verification',
    }
  })

  afterEach(async () => {
    if (orderId === undefined || !first) return
    await adapter(first).pool.query('DELETE FROM refund_intents WHERE order_id = $1', [orderId])
    await adapter(first).pool.query('DELETE FROM orders WHERE id = $1 AND customer_id = $2', [
      orderId,
      actorId,
    ])
    orderId = undefined
  })

  afterAll(async () => {
    try {
      if (first && actorId !== undefined) {
        await adapter(first).pool.query('DELETE FROM users WHERE id = $1 AND email = $2', [
          actorId,
          `${run}@example.test`,
        ])
      }
    } finally {
      await Promise.all([...connections].map(close))
    }
  })

  // A PostgreSQL-zar mindket valodi muveletet megallitja; nem az utemezo szerencseje a verseny.
  async function contend(
    lockQuery: string,
    params: unknown[],
    operations: () => Promise<PromiseSettledResult<RefundIntent>[]>,
  ): Promise<PromiseSettledResult<RefundIntent>[]> {
    const blocker = await adapter(first).pool.connect()
    let pending: Promise<PromiseSettledResult<RefundIntent>[]> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query(lockQuery, params)
      pending = operations()
      await expect
        .poll(
          async () => {
            // A blocker tranzakcio statisztikai snapshotjat minden meres elott frissitjuk.
            await blocker.query('SELECT pg_stat_clear_snapshot()')
            const waiting = await blocker.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE application_name LIKE $1 AND wait_event_type = 'Lock'
             AND pid <> pg_backend_pid()`,
              [`${run}-%`],
            )
            return waiting.rows[0].count
          },
          { timeout: 5000, interval: 25 },
        )
        .toBe(2)
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      // An assertion failure must still drain both operations before fixture cleanup.
      if (pending) await pending
    }
    expect(pending).toBeDefined()
    return pending!
  }

  function exactlyOne(
    results: PromiseSettledResult<RefundIntent>[],
    errorCode: string,
  ): RefundIntent {
    const winners = results.filter((entry) => entry.status === 'fulfilled')
    const losers = results.filter((entry) => entry.status === 'rejected')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].reason).toMatchObject({ code: errorCode })
    return winners[0].value
  }

  it('serializes two independent creates for one order: exactly one persisted winner', async () => {
    const results = await contend(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`refund-intent:order:${orderId}`],
      () =>
        Promise.allSettled([
          createRefundIntent(first, request, key()),
          createRefundIntent(second, request, key()),
        ]),
    )
    const winner = exactlyOne(results, 'conflict')
    const persisted = await adapter(first).pool.query<{ id: number }>(
      'SELECT id FROM refund_intents WHERE order_id = $1',
      [orderId],
    )
    expect(persisted.rows).toEqual([{ id: winner.id }])
    await expect(loadActiveRefundIntent(second, orderId!)).resolves.toEqual(winner)
  }, 15_000)

  it('round-trips a system V2 row with null user actor and preserves identity through SQL CAS', async () => {
    const system = {
      ...request,
      schemaVersion: 2 as const,
      actorId: null,
      actorKind: 'system' as const,
      systemActor: 'paid-reject-recovery' as const,
    }
    const created = await createRefundIntent(first, system, key())
    expect(created).toMatchObject({
      schemaVersion: 2,
      actor: null,
      actorKind: 'system',
      systemActor: 'paid-reject-recovery',
      requestHash: hashRefundIntentRequest(system),
    })
    const persisted = await adapter(first).pool.query(
      'SELECT actor_id, actor_kind, system_actor, schema_version FROM refund_intents WHERE id = $1',
      [created.id],
    )
    expect(persisted.rows).toEqual([
      {
        actor_id: null,
        actor_kind: 'system',
        system_actor: 'paid-reject-recovery',
        // node-postgres preserves raw numeric columns as strings; the store parses them.
        schema_version: '2',
      },
    ])
    expect(await loadActiveRefundIntent(second, orderId!)).toEqual(created)
    expect(await transitionRefundIntent(second, created, 'provider_started')).toMatchObject({
      actor: null,
      actorKind: 'system',
      state: 'provider_started',
    })
    await expect(createRefundIntent(first, request, key())).rejects.toMatchObject({
      code: 'conflict',
    })
    await adapter(first).pool.query('UPDATE refund_intents SET actor_id = $1 WHERE id = $2', [
      actorId,
      created.id,
    ])
    await expect(loadActiveRefundIntent(second, orderId!)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  }, 15_000)

  it('allows only one owner or system create when both connections contend for the same active order', async () => {
    const system = {
      ...request,
      schemaVersion: 2 as const,
      actorId: null,
      actorKind: 'system' as const,
      systemActor: 'paid-reject-recovery' as const,
    }
    const results = await contend(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`refund-intent:order:${orderId}`],
      () =>
        Promise.allSettled([
          createRefundIntent(first, request, key()),
          createRefundIntent(second, system, key()),
        ]),
    )
    const winner = exactlyOne(results, 'conflict')
    expect(await loadActiveRefundIntent(first, orderId!)).toEqual(winner)
    const records = await adapter(first).pool.query(
      'SELECT id FROM refund_intents WHERE order_id = $1',
      [orderId],
    )
    expect(records.rows).toHaveLength(1)
  }, 15_000)

  it('allows exactly one prepared CAS winner across independent connections', async () => {
    const prepared = await createRefundIntent(first, request, key())
    const results = await contend(
      'SELECT id FROM refund_intents WHERE id = $1 FOR UPDATE',
      [prepared.id],
      () =>
        Promise.allSettled([
          transitionRefundIntent(first, prepared, 'provider_started'),
          transitionRefundIntent(second, prepared, 'provider_started'),
        ]),
    )
    const winner = exactlyOne(results, 'transition_conflict')
    expect(winner.state).toBe('provider_started')
    await expect(loadActiveRefundIntent(second, orderId!)).resolves.toEqual(winner)
    await expect(transitionRefundIntent(first, prepared, 'provider_started')).rejects.toMatchObject(
      { code: 'transition_conflict' },
    )
  }, 15_000)

  it('keeps the active block after closing a Payload pool and initializing a new one', async () => {
    const prepared = await createRefundIntent(second, request, key())
    const started = await transitionRefundIntent(second, prepared, 'provider_started')
    const oldPool = adapter(second).pool
    const oldPid = await oldPool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    await close(second)
    expect(oldPool.ended).toBe(true)
    try {
      // A pool.end() a kliens oldalon kész, a PostgreSQL backend viszont még
      // egy pillanatig a pg_stat_activity-ben maradhat. Egyetlen pillanatkép
      // CI-terhelésen 1-et lát (main 6cd64b6, Actions 33999634006), és a
      // reconnect elmaradása a későbbi second-hívásokat unavailable-re viszi.
      await expect
        .poll(
          async () => {
            const closedBackend = await adapter(first).pool.query<{ count: number }>(
              'SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid = $1',
              [oldPid.rows[0].pid],
            )
            return closedBackend.rows[0].count
          },
          { timeout: 5000, interval: 25 },
        )
        .toBe(0)
    } finally {
      second = await connect('restarted')
    }
    const newPid = await adapter(second).pool.query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    )
    expect(adapter(second).pool).not.toBe(oldPool)
    expect(newPid.rows[0].pid).not.toBe(oldPid.rows[0].pid)
    await expect(loadActiveRefundIntent(second, orderId!)).resolves.toEqual(started)
    await expect(createRefundIntent(second, request, key())).rejects.toMatchObject({
      code: 'conflict',
    })
  }, 60_000)

  it('retains the block until a single persisted no-effect transition releases it with evidence', async () => {
    const prepared = await createRefundIntent(first, request, key())
    const started = await transitionRefundIntent(first, prepared, 'provider_started')
    const unknown = await transitionRefundIntent(first, started, 'provider_unknown')
    const review = await transitionRefundIntent(first, unknown, 'manual_review')
    await expect(transitionRefundIntent(first, review, 'provider_failed')).rejects.toMatchObject({
      code: 'invalid_transition',
    })
    const evidence = {
      kind: 'provider_confirmed_no_effect' as const,
      confirmedAt: '2026-09-05T10:00:00.123Z',
      reference: `DUMMY-no-effect-${randomUUID()}`,
    }
    const blocker = await adapter(first).pool.connect()
    let pending: Promise<RefundIntent> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM refund_intents WHERE id = $1 FOR UPDATE', [review.id])
      pending = transitionRefundIntent(second, review, 'provider_failed', evidence)
      // Attach the rejection handler immediately while the row is intentionally locked.
      void pending.catch(() => undefined)
      await expect
        .poll(
          async () => {
            await blocker.query('SELECT pg_stat_clear_snapshot()')
            const waiting = await blocker.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name LIKE $1 AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
              [`${run}-%`],
            )
            return waiting.rows[0].count
          },
          { timeout: 5000, interval: 25 },
        )
        .toBe(1)
      await expect(loadActiveRefundIntent(first, orderId!)).resolves.toEqual(review)
      await expect(createRefundIntent(first, request, key())).rejects.toMatchObject({
        code: 'conflict',
      })
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      if (pending) await pending
    }
    const failed = await pending!
    expect(failed).toMatchObject({
      state: 'provider_failed',
      activeOrderKey: null,
      reconciliationCheckedAt: evidence.confirmedAt,
      reconciliationReference: evidence.reference,
      providerStartedAt: started.providerStartedAt,
    })
    expect(failed.providerResolvedAt).toEqual(expect.any(String))
    const stored = await adapter(first).pool.query<{
      state: string
      active_order_key: string | null
      reconciliation_checked_at: Date
      reconciliation_reference: string
      provider_resolved_at: Date
    }>(
      'SELECT state, active_order_key, reconciliation_checked_at, reconciliation_reference, provider_resolved_at FROM refund_intents WHERE id = $1',
      [failed.id],
    )
    expect(stored.rows[0]).toEqual({
      state: 'provider_failed',
      active_order_key: null,
      reconciliation_checked_at: new Date(evidence.confirmedAt),
      reconciliation_reference: evidence.reference,
      provider_resolved_at: new Date(failed.providerResolvedAt!),
    })
    await expect(loadActiveRefundIntent(first, orderId!)).resolves.toBeNull()
    await expect(createRefundIntent(first, request, key())).resolves.toMatchObject({
      state: 'prepared',
    })
  }, 15_000)

  it('round-trips real numeric and timestamp columns exactly through success and commit', async () => {
    const rawKey = key()
    const prepared = await createRefundIntent(first, request, rawKey)
    const raw = await adapter(first).pool.query<{
      requested_amount_huf: string
      created_at: Date
      updated_at: Date
    }>('SELECT requested_amount_huf, created_at, updated_at FROM refund_intents WHERE id = $1', [
      prepared.id,
    ])
    expect(raw.rows[0].requested_amount_huf).toBe('100')
    expect(prepared.createdAt).toBe(raw.rows[0].created_at.toISOString())
    expect(prepared.updatedAt).toBe(raw.rows[0].updated_at.toISOString())
    expect(prepared.requestHash).toBe(hashRefundIntentRequestV1(request))
    expect(prepared.idempotencyKeyHash).toBe(digestRefundIdempotencyKey(rawKey))
    const started = await transitionRefundIntent(first, prepared, 'provider_started')
    const succeeded = await transitionRefundIntent(second, started, 'provider_succeeded')
    await expect(loadActiveRefundIntent(first, orderId!)).resolves.toEqual(succeeded)
    const committed = await transitionRefundIntent(second, succeeded, 'committed')
    const persisted = await adapter(first).pool.query<{
      provider_started_at: Date
      provider_resolved_at: Date
      committed_at: Date
      created_at: Date
      updated_at: Date
      active_order_key: null
    }>(
      'SELECT provider_started_at, provider_resolved_at, committed_at, created_at, updated_at, active_order_key FROM refund_intents WHERE id = $1',
      [committed.id],
    )
    expect(persisted.rows[0]).toEqual({
      provider_started_at: new Date(started.providerStartedAt!),
      provider_resolved_at: new Date(succeeded.providerResolvedAt!),
      committed_at: new Date(committed.committedAt!),
      created_at: new Date(prepared.createdAt),
      updated_at: new Date(committed.updatedAt),
      active_order_key: null,
    })
    await expect(loadActiveRefundIntent(first, orderId!)).resolves.toBeNull()
  })

  it('rejects a persisted hash/request mismatch instead of treating the ledger as empty', async () => {
    const prepared = await createRefundIntent(first, request, key())
    await adapter(first).pool.query(
      'UPDATE refund_intents SET reason = $1 WHERE id = $2 AND actor_id = $3',
      ['DUMMY corrupted request', prepared.id, actorId],
    )
    await expect(loadActiveRefundIntent(second, orderId!)).rejects.toMatchObject({
      code: 'invalid_record',
    })
    await expect(createRefundIntent(second, request, key())).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })
})
