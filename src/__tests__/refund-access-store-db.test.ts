import { randomBytes, randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  applyRefundAccessCleanup,
  readRefundAccessBaseline,
  type RefundAccessBaseline,
  type RefundAccessCleanupResult,
} from '@/lib/refund/access-store'
import { createRefundIntent, transitionRefundIntent } from '@/lib/refund/intent-store'
import { withUserPurchasesLock } from '@/lib/user-purchases-lock'
import type { RefundIntent } from '@/payload-types'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'
import { captureOwnedPostgresBootstrap } from './helpers/owned-postgres-bootstrap'

if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !['/kineticare_ci', '/kineticare_pr207_validation'].includes(target.pathname)
  ) {
    throw new Error('Refund access DB verification requires the disposable localhost CI database')
  }
}
const hasDb = await isDatabaseAvailable()

describe.skipIf(!hasDb)('refund access store (real PostgreSQL)', () => {
  const run = `access-db-${randomUUID()}`
  let worker: Payload
  let observer: Payload
  let actorId: number
  let customerId: number
  let productId: number
  let unrelatedProductId: number
  let purchaseId: number
  let unrelatedPurchaseId: number
  let grantId: string
  let orderId: number
  let intent: RefundIntent
  let baseline: RefundAccessBaseline
  const userIds: number[] = []
  const productIds: number[] = []
  const orderIds: number[] = []
  const bootstrapReleases = new Map<Payload, () => void>()
  const grantTime = '2026-09-05T09:00:00.123Z'
  const adapter = (payload: Payload) => payload.db as unknown as PostgresAdapter
  const pool = () => adapter(observer).pool

  async function connect(name: string): Promise<Payload> {
    const config = await configPromise
    let releaseBootstrap: (() => void) | undefined
    const payload = await new BasePayload().init({
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
    expect(releaseBootstrap).toBeTypeOf('function')
    bootstrapReleases.set(payload, releaseBootstrap!)
    return payload
  }

  beforeAll(async () => {
    worker = await connect('worker')
    observer = await connect('observer')
    expect(adapter(worker).pool).not.toBe(pool())
  }, 60_000)

  async function addOrder(status: string): Promise<number> {
    const row = await pool().query<{ id: number }>(
      'INSERT INTO orders (customer_id, status, amount, currency) VALUES ($1, $2, 1000, $3) RETURNING id',
      [customerId, status, 'HUF'],
    )
    const id = row.rows[0].id
    orderIds.push(id)
    await pool().query(
      'INSERT INTO orders_items (_order, _parent_id, id, product_id, quantity) VALUES (1, $1, $2, $3, 1)',
      [id, randomUUID(), productId],
    )
    return id
  }

  beforeEach(async () => {
    for (const role of ['owner', 'customer']) {
      const row = await pool().query<{ id: number }>(
        'INSERT INTO users (name, role, email) VALUES ($1, $2, $3) RETURNING id',
        [`DUMMY ${run}`, role, `${randomUUID()}@example.test`],
      )
      userIds.push(row.rows[0].id)
    }
    ;[actorId, customerId] = userIds
    for (let index = 0; index < 2; index++) {
      const row = await pool().query<{ id: number }>(
        'INSERT INTO products (sku) VALUES ($1) RETURNING id',
        [`DUMMY-${randomUUID()}`],
      )
      productIds.push(row.rows[0].id)
    }
    ;[productId, unrelatedProductId] = productIds
    const relations = await pool().query<{ id: number }>(
      `INSERT INTO users_rels (parent_id, path, products_id)
       VALUES ($1, 'purchases', $2), ($1, 'purchases', $3) RETURNING id`,
      [customerId, productId, unrelatedProductId],
    )
    ;[purchaseId, unrelatedPurchaseId] = relations.rows.map((row) => row.id)
    orderId = await addOrder('refunded')
    grantId = randomUUID()
    await pool().query(
      `INSERT INTO users_access_grants (_order, _parent_id, id, product_id, granted_at, source_kind, source_order_id)
       VALUES (1, $1, $2, $3, $4, 'order', $7), (2, $1, $5, $6, $4, NULL, NULL)`,
      [customerId, grantId, productId, grantTime, randomUUID(), unrelatedProductId, orderId],
    )
    const prepared = await createRefundIntent(
      worker,
      {
        schemaVersion: 1,
        actorId: String(actorId),
        orderId: String(orderId),
        provider: 'barion',
        providerPaymentId: `DUMMY-${randomUUID()}`,
        providerTransactionId: `DUMMY-${randomUUID()}`,
        refundSequence: 1,
        requestedAmountHuf: 1000,
        currency: 'HUF',
        reason: 'DUMMY independent SQL access verification',
      },
      randomBytes(32).toString('base64url'),
    )
    const started = await transitionRefundIntent(worker, prepared, 'provider_started')
    intent = await transitionRefundIntent(worker, started, 'provider_succeeded')
    baseline = await withUserPurchasesLock(worker, customerId, () =>
      readRefundAccessBaseline(worker, customerId, [productId]),
    )
    expect(baseline.grantProof).toBe('bounded-xmin-provenance-v2')
    expect(baseline.grants).toHaveLength(1)
    expect(baseline.grants![0].age).toBeGreaterThan(0)
    await pool().query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, "after")
       VALUES ($1, 'refund-prepared', 'refund-intents', $2, $3::jsonb)`,
      [
        actorId,
        String(intent.id),
        JSON.stringify({
          version: 1,
          intentId: intent.id,
          orderId,
          sequence: 1,
          requestFingerprint: intent.requestHash,
          accessBaseline: baseline,
        }),
      ],
    )
    const persisted = await pool().query<{ after: { accessBaseline: RefundAccessBaseline } }>(
      `SELECT "after" FROM audit_logs WHERE actor_id = $1 AND entity_id = $2
       AND entity_type = 'refund-intents' AND action = 'refund-prepared'`,
      [actorId, String(intent.id)],
    )
    expect(persisted.rows).toHaveLength(1)
    expect(persisted.rows[0].after.accessBaseline).toEqual(baseline)
    baseline = persisted.rows[0].after.accessBaseline
  }, 30_000)

  afterEach(async () => {
    if (!observer) return
    await pool().query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [userIds])
    await pool().query('DELETE FROM refund_intents WHERE order_id = ANY($1::int[])', [orderIds])
    await pool().query('DELETE FROM orders_items WHERE _parent_id = ANY($1::int[])', [orderIds])
    await pool().query('DELETE FROM orders WHERE id = ANY($1::int[])', [orderIds])
    await pool().query('DELETE FROM users_rels WHERE parent_id = ANY($1::int[])', [userIds])
    await pool().query('DELETE FROM users_access_grants WHERE _parent_id = ANY($1::int[])', [
      userIds,
    ])
    await pool().query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds])
    await pool().query('DELETE FROM products WHERE id = ANY($1::int[])', [productIds])
    userIds.length = productIds.length = orderIds.length = 0
  })

  afterAll(async () => {
    await Promise.all(
      [worker, observer].filter(Boolean).map(async (payload) => {
        const connectionPool = adapter(payload).pool
        await payload.destroy()
        bootstrapReleases.get(payload)!()
        bootstrapReleases.delete(payload)
        await connectionPool.end()
        expect(connectionPool.ended).toBe(true)
      }),
    )
  })

  function cleanup(): Promise<RefundAccessCleanupResult> {
    return withUserPurchasesLock(worker, customerId, () =>
      applyRefundAccessCleanup(worker, { intent, baseline, productIds: [productId] }),
    )
  }

  async function observe() {
    // One statement gives the observer one MVCC snapshot for deletion and receipt.
    const result = await pool().query<{
      purchases: number[]
      grants: unknown[]
      receipts: Array<{ actorId: number; after: Record<string, unknown> }>
    }>(
      `SELECT
       ARRAY(SELECT id FROM users_rels WHERE parent_id = $1 AND path = 'purchases' ORDER BY id) AS purchases,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'productId', product_id,
         'grantedAt', granted_at, 'position', _order, 'xmin', xmin::text, 'sourceKind', source_kind, 'sourceOrder', source_order_id) ORDER BY id), '[]'::jsonb)
         FROM users_access_grants WHERE _parent_id = $1) AS grants,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('actorId', actor_id, 'after', "after") ORDER BY id), '[]'::jsonb)
         FROM audit_logs WHERE entity_type = 'refund-intents' AND entity_id = $2
         AND action = 'refund-cleanup-done') AS receipts`,
      [customerId, String(intent.id)],
    )
    return result.rows[0]
  }

  async function expectWait(statement: string) {
    await expect
      .poll(
        async () => {
          const result = await pool().query<{ query: string; wait_event_type: string | null }>(
            `SELECT query, wait_event_type FROM pg_stat_activity WHERE application_name = $1`,
            [`${run}-worker`],
          )
          return result.rows
        },
        { timeout: 1500, interval: 10 },
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            query: expect.stringContaining(statement),
            wait_event_type: 'Lock',
          }),
        ]),
      )
  }

  it('cleans up an unchanged grant-bearing full refund and atomically records an idempotent receipt', async () => {
    const before = await observe()
    await expect(cleanup()).resolves.toEqual({ status: 'completed' })
    const after = await observe()
    expect(after.purchases).toEqual([unrelatedPurchaseId])
    expect(after.grants).toEqual(before.grants)
    expect(after.receipts).toEqual([
      {
        actorId,
        after: {
          version: 1,
          intentId: intent.id,
          orderId,
          sequence: 1,
          requestFingerprint: intent.requestHash,
          completed: true,
          reason: 'resolved',
          cleanupKind: 'sql-access-v2',
          revokedSourceOrderId: orderId,
          retainedGrantIds: [grantId],
          deletedRelationIds: [purchaseId],
          preservedProductIds: [],
        },
      },
    ])
    await expect(cleanup()).resolves.toEqual({ status: 'completed' })
    expect(await observe()).toEqual(after)
  })

  it('retains a new independent gift and every grant row after the target refund', async () => {
    await pool().query(
      `INSERT INTO users_access_grants (_order, _parent_id, id, product_id, granted_at, source_kind)
       VALUES (3, $1, $2, $3, $4, 'independent')`,
      [customerId, randomUUID(), productId, grantTime],
    )
    const before = await observe()
    await expect(cleanup()).resolves.toEqual({ status: 'completed' })
    const after = await observe()
    expect(after.purchases).toEqual(before.purchases)
    expect(after.grants).toEqual(before.grants)
    expect(after.receipts[0].after.preservedProductIds).toEqual([productId])
  })

  it('holds a persisted legacy origin without deleting the membership', async () => {
    await pool().query(
      'UPDATE users_access_grants SET source_kind = NULL, source_order_id = NULL WHERE id = $1',
      [grantId],
    )
    const before = await observe()
    await expect(cleanup()).resolves.toEqual({ status: 'manual_review' })
    expect(await observe()).toEqual(before)
  })

  it('preserves access after same-ID and identical-fields grant replacement changes its real xmin', async () => {
    const replacement = await pool().connect()
    try {
      await replacement.query('BEGIN')
      await replacement.query('DELETE FROM users_access_grants WHERE id = $1 AND _parent_id = $2', [
        grantId,
        customerId,
      ])
      await replacement.query(
        `INSERT INTO users_access_grants (_order, _parent_id, id, product_id, granted_at, source_kind, source_order_id)
         VALUES (1, $1, $2, $3, $4, 'order', $5)`,
        [customerId, grantId, productId, grantTime, orderId],
      )
      await replacement.query('COMMIT')
    } finally {
      await replacement.query('ROLLBACK')
      replacement.release()
    }
    const current = await readRefundAccessBaseline(observer, customerId, [productId])
    const originalGrant = baseline.grants![0]
    expect(current.grants![0]).toMatchObject({
      id: originalGrant.id,
      productId,
      grantedAt: originalGrant.grantedAt,
      position: originalGrant.position,
    })
    expect(current.grants![0].xmin).not.toBe(originalGrant.xmin)
    const before = await observe()
    await expect(cleanup()).resolves.toEqual({ status: 'manual_review' })
    expect(await observe()).toEqual(before)
    expect(before.receipts).toEqual([])
  })

  it.each(['commit', 'rollback'] as const)(
    'keeps deletion and receipt atomic on real receipt-FK contention: %s',
    async (outcome) => {
      const blocker = await pool().connect()
      let pending: Promise<RefundAccessCleanupResult> | undefined
      const before = await observe()
      try {
        await blocker.query('BEGIN')
        // Actor differs from customer: this blocks only the receipt INSERT's FK check.
        await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [actorId])
        pending = cleanup()
        await expectWait('INSERT INTO "public"."audit_logs"')
        expect(await observe()).toEqual(before)
        if (outcome === 'commit') {
          await blocker.query('ROLLBACK')
          await expect(pending).resolves.toEqual({ status: 'completed' })
          const after = await observe()
          expect(after.purchases).toEqual([unrelatedPurchaseId])
          expect(after.grants).toEqual(before.grants)
          expect(after.receipts).toHaveLength(1)
          expect(after.receipts[0].after.deletedRelationIds).toEqual([purchaseId])
        } else {
          // Retain the FK blocker until the real SET LOCAL lock_timeout aborts the transaction.
          await expect(pending).resolves.toEqual({ status: 'manual_review' })
          expect(await observe()).toEqual(before)
          expect(before.receipts).toEqual([])
          await blocker.query('ROLLBACK')
          await expect(cleanup()).resolves.toEqual({ status: 'completed' })
        }
      } finally {
        await blocker.query('ROLLBACK')
        blocker.release()
        if (pending) await pending
      }
    },
    15_000,
  )

  it('preserves purchases protected by a competing paid order', async () => {
    await addOrder('paid')
    const before = await observe()
    await expect(cleanup()).resolves.toEqual({ status: 'completed' })
    const after = await observe()
    expect(after.purchases).toEqual(before.purchases)
    expect(after.grants).toEqual(before.grants)
    expect(after.receipts).toHaveLength(1)
    expect(after.receipts[0].after).toMatchObject({
      deletedRelationIds: [],
      preservedProductIds: [productId],
    })
  })

  it('rechecks a competing order becoming paid while cleanup waits for its row lock', async () => {
    const competingId = await addOrder('payment_pending')
    const before = await observe()
    const blocker = await pool().connect()
    let pending: Promise<RefundAccessCleanupResult> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', competingId])
      pending = cleanup()
      await expectWait('FROM "public"."orders"')
      expect(await observe()).toEqual(before)
      await blocker.query('COMMIT')
      await expect(pending).resolves.toEqual({ status: 'completed' })
      const after = await observe()
      expect(after.purchases).toEqual(before.purchases)
      expect(after.grants).toEqual(before.grants)
      expect(after.receipts).toHaveLength(1)
      expect(after.receipts[0].after).toMatchObject({
        deletedRelationIds: [],
        preservedProductIds: [productId],
      })
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      if (pending) await pending
    }
  }, 15_000)
})
