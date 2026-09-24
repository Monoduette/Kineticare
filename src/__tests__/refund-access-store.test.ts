import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  applyRefundAccessCleanup,
  readRefundAccessBaseline,
  type RefundAccessBaseline,
} from '@/lib/refund/access-store'
import type { RefundIntent } from '@/payload-types'

const intent: RefundIntent = {
  id: 7,
  order: 10,
  actor: 2,
  state: 'provider_succeeded',
  requestedAmountHuf: 100,
  provider: 'barion',
  providerPaymentId: 'DUMMY-payment',
  providerTransactionId: 'DUMMY-transaction',
  requestHash: 'a'.repeat(64),
  idempotencyKeyHash: 'b'.repeat(64),
  activeOrderKey: 'DUMMY-active',
  schemaVersion: 1,
  refundSequence: 1,
  currency: 'HUF',
  providerStartedAt: '2026-09-05T12:00:00.000Z',
  providerResolvedAt: '2026-09-05T12:00:01.000Z',
  createdAt: '2026-09-05T11:59:59.000Z',
  updatedAt: '2026-09-05T12:00:01.000Z',
}

type Purchase = { id: number; productId: number }
type Grant = {
  id: string
  productId: number
  grantedAt: string
  position?: number
  xmin?: string
  age?: number
  sourceKind?: 'order' | 'independent' | null
  sourceOrder?: number | null
}
type Event = { actorId: number; after: Record<string, unknown> }

function fakeDatabase() {
  const state = {
    purchases: [
      { id: 101, productId: 5 },
      { id: 102, productId: 99 },
    ] as Purchase[],
    grants: [
      {
        id: 'DUMMY-target-grant',
        productId: 5,
        grantedAt: intent.createdAt,
        sourceKind: 'order',
        sourceOrder: 10,
      },
    ] as Grant[],
    orders: [{ id: 10, status: 'refunded' }],
    items: [{ id: 'DUMMY-item', orderId: 10, productId: 5 }],
    receipts: {} as Record<string, Event>,
    intentPresent: true,
    fullXid: '1000',
    xidCeiling: '1001',
    rawSnapshotXmax: undefined as string | undefined,
  }
  let fault:
    'delete-count' | 'receipt-write' | 'receipt-result' | 'lost-commit-ack' | 'lock' | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const queries: { sql: string; params: unknown[] }[] = []
  const dialect = new PgDialect()
  const execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query)
    queries.push(compiled)
    const { sql: text, params } = compiled
    let result: unknown[]
    if (text.startsWith('SET')) return { rows: [], rowCount: 0 }
    if (fault === 'lock') throw new Error('DUMMY-lock-timeout')
    if (text.includes('pg_current_xact_id()')) {
      let ceiling = state.rawSnapshotXmax ?? state.xidCeiling
      if (state.rawSnapshotXmax !== undefined && text.includes('GREATEST(')) {
        ceiling = String(
          BigInt(state.fullXid) > BigInt(ceiling) ? BigInt(state.fullXid) : BigInt(ceiling),
        )
      }
      result = [{ fullXid: state.fullXid, xidCeiling: ceiling }]
    } else if (text.includes('FROM "public"."refund_intents"')) {
      result =
        state.intentPresent &&
        params[0] === intent.id &&
        params[1] === intent.order &&
        params[2] === intent.actor &&
        params[3] === intent.refundSequence &&
        params[4] === intent.requestHash
          ? [{ id: intent.id }]
          : []
    } else if (text.includes('FROM "public"."users"')) {
      result = params[0] === 1 ? [{ id: 1 }] : []
    } else if (text.startsWith('SELECT') && text.includes('FROM "public"."users_rels"')) {
      result = state.purchases
    } else if (text.includes('FROM "public"."users_access_grants"')) {
      result = state.grants.map((grant) => ({
        ...grant,
        position: grant.position ?? 1,
        xmin: grant.xmin ?? '900',
        age:
          grant.age ??
          Number(
            ((BigInt(state.fullXid) % 4_294_967_296n) -
              BigInt(grant.xmin ?? '900') +
              4_294_967_296n) %
              4_294_967_296n,
          ),
      }))
    } else if (text.includes('FROM "public"."orders_items"')) {
      result = state.items
    } else if (text.includes('FROM "public"."orders"')) {
      result = state.orders
    } else if (text.startsWith('SELECT') && text.includes('FROM "public"."audit_logs"')) {
      const event = state.receipts[String(params[0])]
      result = event ? [event] : []
    } else if (text.startsWith('DELETE')) {
      const expected = new Map<number, number>()
      for (let index = 1; index < params.length; index += 2)
        expected.set(params[index] as number, params[index + 1] as number)
      result = state.purchases.filter((row) => expected.get(row.id) === row.productId)
      state.purchases = state.purchases.filter((row) => expected.get(row.id) !== row.productId)
      if (fault === 'delete-count') result = []
    } else if (text.startsWith('INSERT')) {
      if (fault === 'receipt-write') throw new Error('DUMMY-private-db-message')
      const event = {
        actorId: params[0] as number,
        after: JSON.parse(params[2] as string) as Record<string, unknown>,
      }
      state.receipts['refund-cleanup-done'] = event
      result = fault === 'receipt-result' ? [] : [event]
    } else throw new Error('Unexpected SQL')
    return { rows: structuredClone(result), rowCount: result.length }
  })
  const transaction = <T>(run: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
    const current = tail.then(async () => {
      const snapshot = structuredClone(state)
      let committed = false
      try {
        const result = await run({ execute })
        committed = true
        if (fault === 'lost-commit-ack') throw new Error('DUMMY-commit-acknowledgement-lost')
        return result
      } catch (error) {
        if (!committed) Object.assign(state, snapshot)
        throw error
      }
    })
    tail = current.catch(() => undefined)
    return current
  }
  const payload = { db: { drizzle: { transaction } } } as unknown as Payload
  return {
    state,
    queries,
    execute,
    payload,
    fault: (value: typeof fault) => {
      fault = value
    },
    prepare: async (): Promise<RefundAccessBaseline> => {
      const baseline = await readRefundAccessBaseline(payload, 1, [5])
      state.receipts['refund-prepared'] = {
        actorId: 2,
        after: {
          version: 1,
          intentId: 7,
          orderId: 10,
          sequence: 1,
          requestFingerprint: intent.requestHash,
          accessBaseline: structuredClone(baseline),
        },
      }
      return baseline
    },
  }
}

describe('bounded SQL refund access cleanup', () => {
  it('captures source identity in V2 and preserves an independent gift alongside the refunded source', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-order',
        productId: 5,
        grantedAt: intent.createdAt,
        sourceKind: 'order',
        sourceOrder: 10,
      },
      { id: 'DUMMY-gift', productId: 5, grantedAt: intent.createdAt, sourceKind: 'independent' },
    ]
    const baseline = await db.prepare()
    expect(baseline).toMatchObject({
      version: 2,
      grantProof: 'bounded-xmin-provenance-v2',
      grants: [
        expect.objectContaining({ sourceKind: 'order', sourceOrder: 10 }),
        expect.objectContaining({ sourceKind: 'independent', sourceOrder: null }),
      ],
    })
    expect(
      await applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).toEqual({ status: 'completed' })
    expect(db.state.purchases).toContainEqual({ id: 101, productId: 5 })
    expect(db.queries.some((query) => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it.each(['absent', 'legacy', 'unrelated'] as const)(
    'holds %s origin instead of deleting membership',
    async (kind) => {
      const db = fakeDatabase()
      db.state.grants =
        kind === 'absent'
          ? []
          : [
              {
                id: 'DUMMY-unproven',
                productId: 5,
                grantedAt: intent.createdAt,
                ...(kind === 'unrelated' ? { sourceKind: 'order' as const, sourceOrder: 999 } : {}),
              },
            ]
      const baseline = await db.prepare()
      expect(
        await applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      ).toEqual(
        // a-refund-10: a kurzus és az ok a tulajdonosi üzenetnek szól; az
        // ismeretlen rendelésre mutató eredet az általános ellenőrzésen bukik.
        kind === 'unrelated'
          ? { status: 'manual_review' }
          : { status: 'manual_review', detail: 'grant-provenance', productId: 5 },
      )
      expect(db.state.purchases).toContainEqual({ id: 101, productId: 5 })
      expect(db.queries.some((query) => query.sql.startsWith('DELETE'))).toBe(false)
    },
  )

  it('honors an already completed V1 receipt without promoting a pending V1 baseline', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    baseline.version = 1
    baseline.grantProof = 'absence-only'
    delete baseline.grants
    delete baseline.fullXid
    delete baseline.xidCeiling
    db.state.receipts['refund-prepared'].after.accessBaseline = structuredClone(baseline)
    expect(
      await applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).toEqual({ status: 'manual_review' })
    db.state.receipts['refund-cleanup-done'] = {
      actorId: 2,
      after: {
        version: 1,
        intentId: 7,
        orderId: 10,
        sequence: 1,
        requestFingerprint: intent.requestHash,
        completed: true,
        reason: 'resolved',
        cleanupKind: 'sql-access-v1',
      },
    }
    expect(
      await applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).toEqual({ status: 'completed' })
    expect(db.queries.some((query) => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it('preserves a new independent gift added after baseline capture', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    db.state.grants.push({
      id: 'DUMMY-later-gift',
      productId: 5,
      grantedAt: intent.updatedAt,
      sourceKind: 'independent',
    })
    expect(
      await applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).toEqual({ status: 'completed' })
    expect(db.state.purchases).toHaveLength(2)
  })

  it('reads minimal row identities with bounded grant version evidence', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await readRefundAccessBaseline(db.payload, '1', [5])
    expect(baseline).toMatchObject({
      purchases: [{ id: 101, productId: 5 }],
      grantProof: 'bounded-xmin-provenance-v2',
      grantProductIds: [5],
      fullXid: '1000',
      xidCeiling: '1001',
      grants: [{ id: 'DUMMY-grant', productId: 5, xmin: '900', age: 100 }],
    })
    expect(baseline.grantsFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(baseline).not.toHaveProperty('email')
    expect(
      db.queries
        .filter((query) => query.sql.startsWith('SELECT') && query.sql.includes('FROM'))
        .every((query) => query.sql.includes('FOR UPDATE')),
    ).toBe(true)
  })

  it('deletes only exact baseline target rows and commits a bound receipt with the deletion', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.state.purchases).toEqual([{ id: 102, productId: 99 }])
    expect(db.state.receipts['refund-cleanup-done']).toMatchObject({
      actorId: 2,
      after: {
        version: 1,
        intentId: 7,
        orderId: 10,
        sequence: 1,
        requestFingerprint: intent.requestHash,
        completed: true,
        reason: 'resolved',
        cleanupKind: 'sql-access-v2',
        deletedRelationIds: [101],
      },
    })
    const deletion = db.queries.find((query) => query.sql.startsWith('DELETE'))!
    expect(deletion.sql).toContain("path = 'purchases'")
    expect(deletion.sql).toContain('id = $2 AND products_id = $3')
    expect(deletion.params).toEqual([1, 101, 5])
  })

  it('preserves a remove/reinsert replacement even when membership is unchanged', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    db.state.purchases[0] = { id: 201, productId: 5 }
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'manual_review', detail: 'access-changed', productId: 5 })
    expect(db.state.purchases).toContainEqual({ id: 201, productId: 5 })
    expect(db.queries.some((query) => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it.each(['baseline', 'current'] as const)(
    'does not revoke when %s grant provenance is uncertain',
    async (phase) => {
      const db = fakeDatabase()
      const grant = { id: 'DUMMY-same-id', productId: 5, grantedAt: intent.createdAt }
      if (phase === 'baseline') db.state.grants = [grant]
      const baseline = await db.prepare()
      db.state.grants = phase === 'baseline' ? [] : [grant]
      await expect(
        applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      ).resolves.toEqual({ status: 'manual_review', detail: 'grant-provenance', productId: 5 })
      expect(db.state.purchases).toContainEqual({ id: 101, productId: 5 })
    },
  )

  it('cleans normal paid access with unchanged versioned grants without removing grant rows', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    db.state.fullXid = '1100'
    db.state.xidCeiling = '1101'
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.state.purchases).toEqual([{ id: 102, productId: 99 }])
    expect(db.state.grants).toEqual([
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ])
    expect(
      db.queries
        .filter((query) => query.sql.startsWith('DELETE'))
        .every((query) => query.sql.includes('"users_rels"')),
    ).toBe(true)
  })

  it('keeps a valid horizon when unfinished transactions make snapshot xmax precede our own xid', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    db.state.fullXid = '1100'
    db.state.rawSnapshotXmax = '1099'
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.queries.some((query) => query.sql.includes('GREATEST(pg_current_xact_id(),'))).toBe(
      true,
    )
  })

  it('accepts a persisted baseline whose JSONB grant object keys have been reordered', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    baseline.grants = baseline.grants!.map(
      ({ id, productId, grantedAt, position, xmin, age, sourceKind, sourceOrder }) => ({
        sourceOrder,
        sourceKind,
        age,
        xmin,
        position,
        grantedAt,
        productId,
        id,
      }),
    )
    db.state.receipts['refund-prepared'].after.accessBaseline = JSON.parse(JSON.stringify(baseline))
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.state.purchases).toEqual([{ id: 102, productId: 99 }])
  })

  it.each(['xmin', 'id', 'grantedAt', 'position'] as const)(
    'preserves later grant mutation in %s',
    async (field) => {
      const db = fakeDatabase()
      db.state.grants = [
        {
          id: 'DUMMY-grant',
          productId: 5,
          sourceKind: 'order',
          sourceOrder: 10,
          grantedAt: intent.createdAt,
          xmin: '900',
          position: 1,
        },
      ]
      const baseline = await db.prepare()
      Object.assign(db.state.grants[0], {
        [field]: { xmin: '950', id: 'DUMMY-new', grantedAt: intent.updatedAt, position: 2 }[field],
      })
      await expect(
        applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      ).resolves.toEqual({ status: 'manual_review', detail: 'access-changed', productId: 5 })
      expect(db.state.purchases).toHaveLength(2)
      expect(db.state.receipts['refund-cleanup-done']).toBeUndefined()
    },
  )

  it.each([
    ['999', '1001'], // Regressed full transaction ID.
    ['1001000', '1001001'], // Expired observation window.
    ['1100', '1001000'], // An earlier assigned transaction ID cannot hide a long wait.
    ['1100', '1099'], // Incoherent sample.
    ['4294968296', '4294968297'], // Same raw xmin after a full wrap.
  ])('rejects an unsafe xid8 observation %s/%s', async (full, ceiling) => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    db.state.fullXid = full
    db.state.xidCeiling = ceiling
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual(
      // Az összefüggéstelen minta már a zárolt olvasásnál bukik, részlet nélkül.
      full === '1100' && ceiling === '1099'
        ? { status: 'manual_review' }
        : { status: 'manual_review', detail: 'access-changed', productId: 5 },
    )
    expect(db.state.purchases).toHaveLength(2)
  })

  it.each([
    { xmin: '2' },
    { xmin: '0' },
    { xmin: '4294967296' },
    { age: -1 },
    { age: 0 },
    { age: 2147483648 },
    { age: 101 },
  ])('rejects special, malformed or incoherent grant version %j', async (version) => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
        ...version,
      },
    ]
    await expect(db.prepare()).rejects.toThrow('unverified')
    expect(db.queries.some((query) => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it('accepts a bounded observation crossing the raw xid epoch boundary', async () => {
    const db = fakeDatabase()
    db.state.fullXid = '4294967290'
    db.state.xidCeiling = '4294967291'
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
        xmin: '4294967200',
      },
    ]
    const baseline = await db.prepare()
    db.state.fullXid = '4294967300'
    db.state.xidCeiling = '4294967301'
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.state.grants).toHaveLength(1)
  })

  it('accepts the last safe horizon tick in an already nonzero epoch', async () => {
    const db = fakeDatabase()
    const epoch = 2n * 4_294_967_296n
    db.state.fullXid = String(epoch + 1000n)
    db.state.xidCeiling = String(epoch + 1001n)
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    db.state.fullXid = String(epoch + 1_000_998n)
    db.state.xidCeiling = String(epoch + 1_000_999n)
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
  })

  it('ignores unrelated grant changes and never promotes an absence-only grant baseline', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    db.state.grants.push({ id: 'DUMMY-unrelated', productId: 99, grantedAt: intent.createdAt })
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    const legacy = fakeDatabase()
    legacy.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const old = await legacy.prepare()
    old.version = 1
    old.grantProof = 'absence-only'
    delete old.grants
    delete old.fullXid
    delete old.xidCeiling
    legacy.state.receipts['refund-prepared'].after.accessBaseline = structuredClone(old)
    await expect(
      applyRefundAccessCleanup(legacy.payload, { intent, baseline: old, productIds: [5] }),
    ).resolves.toEqual({ status: 'manual_review' })
  })

  it('preserves access supported by another paid order without rejecting its grants', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    db.state.orders.push({ id: 11, status: 'paid' })
    db.state.items.push({ id: 'DUMMY-other', orderId: 11, productId: 5 })
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.state.purchases).toHaveLength(2)
    expect(db.state.receipts['refund-cleanup-done'].after.preservedProductIds).toEqual([5])
  })

  it.each(['created', 'payment_pending', 'unexpected'])(
    'fails closed on competing %s orders',
    async (status) => {
      const db = fakeDatabase()
      const baseline = await db.prepare()
      db.state.orders.push({ id: 11, status })
      db.state.items.push({ id: 'DUMMY-other', orderId: 11, productId: 5 })
      await expect(
        applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      ).resolves.toEqual({ status: 'manual_review' })
      expect(db.state.purchases).toHaveLength(2)
    },
  )

  it.each(['delete-count', 'receipt-write', 'receipt-result', 'lock'] as const)(
    'rolls back cleanup on %s failure',
    async (failure) => {
      const db = fakeDatabase()
      const baseline = await db.prepare()
      db.fault(failure)
      await expect(
        applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      ).resolves.toEqual({ status: 'manual_review' })
      expect(db.state.purchases).toHaveLength(2)
      expect(db.state.receipts['refund-cleanup-done']).toBeUndefined()
    },
  )

  it('resolves a lost commit acknowledgement from the atomic receipt without repeating deletion', async () => {
    const db = fakeDatabase()
    db.state.grants = [
      {
        id: 'DUMMY-grant',
        productId: 5,
        sourceKind: 'order',
        sourceOrder: 10,
        grantedAt: intent.createdAt,
      },
    ]
    const baseline = await db.prepare()
    db.fault('lost-commit-ack')
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'manual_review' })
    expect(db.state.purchases).toHaveLength(1)
    expect(db.state.receipts['refund-cleanup-done']).toBeDefined()
    db.fault(undefined)
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'completed' })
    expect(db.queries.filter((query) => query.sql.startsWith('DELETE'))).toHaveLength(1)
    expect(db.state.grants).toHaveLength(1)
  })

  it('serializes duplicate cleanups and writes only one completion receipt', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    const results = await Promise.all([
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
    ])
    expect(results).toEqual([{ status: 'completed' }, { status: 'completed' }])
    expect(db.queries.filter((query) => query.sql.startsWith('INSERT'))).toHaveLength(1)
  })

  it.each(['actorId', 'sequence', 'orderId', 'requestFingerprint'] as const)(
    'requires a correctly bound prepared receipt: %s',
    async (field) => {
      const db = fakeDatabase()
      const baseline = await db.prepare()
      if (field === 'actorId') db.state.receipts['refund-prepared'].actorId = 3
      else db.state.receipts['refund-prepared'].after[field] = 'DUMMY-wrong-binding'
      await expect(
        applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [5] }),
      ).resolves.toEqual({ status: 'manual_review' })
      expect(db.state.purchases).toHaveLength(2)
    },
  )

  it('rejects changed baselines, wrong products and missing database capabilities', async () => {
    const db = fakeDatabase()
    const baseline = await db.prepare()
    await expect(
      applyRefundAccessCleanup(db.payload, {
        intent,
        baseline: { ...baseline, purchases: [] },
        productIds: [5],
      }),
    ).resolves.toEqual({ status: 'manual_review' })
    await expect(
      applyRefundAccessCleanup(db.payload, { intent, baseline, productIds: [99] }),
    ).resolves.toEqual({ status: 'manual_review' })
    await expect(readRefundAccessBaseline({} as Payload, 1, [5])).rejects.toThrow('unverified')
    await expect(
      applyRefundAccessCleanup({} as Payload, { intent, baseline, productIds: [5] }),
    ).resolves.toEqual({ status: 'manual_review' })
  })
})
