import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  createRefundIntent,
  loadActiveRefundIntent,
  loadRefundIntentForOperation,
  loadRefundIntentsForOrder,
  transitionRefundIntent,
  type RefundIntent,
} from '@/lib/refund/intent-store'
import {
  activeRefundOrderKey,
  NO_PROVIDER_REQUEST_REFERENCE,
  digestRefundIdempotencyKey,
  hashRefundIntentRequestV1,
  hashRefundIntentRequest,
  type CanonicalRefundIntentRequestV1,
  type RefundIntentState,
} from '@/lib/refund/refund-intent'

const key = Buffer.alloc(32, 1).toString('base64url')
const anotherKey = Buffer.alloc(32, 2).toString('base64url')
const time = '2026-09-05T12:00:00.000Z'
const request: CanonicalRefundIntentRequestV1 = {
  schemaVersion: 1,
  actorId: '2',
  orderId: '1',
  provider: 'barion',
  providerPaymentId: 'DUMMY-payment',
  providerTransactionId: 'DUMMY-transaction',
  refundSequence: 1,
  requestedAmountHuf: 100,
  currency: 'HUF',
  reason: null,
}

function fixture(state: RefundIntentState = 'prepared'): RefundIntent {
  return {
    id: 1,
    order: 1,
    actor: 2,
    requestedAmountHuf: 100,
    provider: 'barion',
    providerPaymentId: request.providerPaymentId,
    providerTransactionId: request.providerTransactionId,
    state,
    requestHash: hashRefundIntentRequestV1(request),
    idempotencyKeyHash: digestRefundIdempotencyKey(key),
    activeOrderKey: activeRefundOrderKey('1', state),
    schemaVersion: 1,
    refundSequence: 1,
    currency: 'HUF',
    reason: null,
    providerStartedAt: state === 'prepared' ? null : time,
    providerResolvedAt: ['provider_succeeded', 'committed'].includes(state) ? time : null,
    committedAt: state === 'committed' ? time : null,
    reconciliationCheckedAt: null,
    reconciliationReference: null,
    createdAt: time,
    updatedAt: time,
  }
}

// Explicit SQL adapter fake: preserves rows across service instances and evaluates CAS predicates.
function fakeDatabase(initial: RefundIntent[] = []) {
  let stored = structuredClone(initial)
  const dialect = new PgDialect()
  const queries: { sql: string; params: unknown[] }[] = []
  let failure: 'select' | 'insert' | 'update-before' | 'update-after' | 'commit' | undefined
  let transform: ((result: { rows: unknown[]; rowCount: number }) => unknown) | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query)
    queries.push(compiled)
    const { sql: text, params: p } = compiled
    if (text.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 }
    let result: RefundIntent[]
    if (text.startsWith('SELECT')) {
      if (failure === 'select') throw new Error('DUMMY-private-database-detail')
      const [order, active, hashOrLimit] = p
      const matching = stored.filter(
        (row) =>
          row.order === order ||
          row.activeOrderKey === active ||
          row.idempotencyKeyHash === hashOrLimit,
      )
      result = matching.slice(0, Number(p.at(-1)))
    } else if (text.startsWith('INSERT')) {
      if (failure === 'insert') throw new Error('DUMMY-private-database-detail')
      const row: RefundIntent = {
        ...fixture(),
        id: Math.max(0, ...stored.map((entry) => entry.id)) + 1,
        order: p[0] as number,
        actor: p[1] as number,
        requestedAmountHuf: p[2] as number,
        provider: p[3] as 'barion',
        providerPaymentId: p[4] as string,
        providerTransactionId: p[5] as string,
        requestHash: p[6] as string,
        idempotencyKeyHash: p[7] as string,
        activeOrderKey: p[8] as string,
        schemaVersion: p[9] as number,
        refundSequence: p[10] as number,
        currency: p[11] as 'HUF',
        reason: p[12] as string | null,
        ...(p.length > 13
          ? {
              actorKind: p[13] as RefundIntent['actorKind'],
              systemActor: p[14] as RefundIntent['systemActor'],
            }
          : {}),
      }
      if (
        stored.some(
          (old) =>
            old.activeOrderKey === row.activeOrderKey ||
            old.idempotencyKeyHash === row.idempotencyKeyHash,
        )
      ) {
        throw new Error('unique constraint')
      }
      stored.push(row)
      result = [row]
    } else if (text.startsWith('UPDATE')) {
      if (failure === 'update-before') throw new Error('DUMMY-private-database-detail')
      const row = stored.find(
        (entry) =>
          entry.id === p[8] &&
          entry.state === p[9] &&
          entry.activeOrderKey === p[10] &&
          entry.requestHash === p[11] &&
          entry.idempotencyKeyHash === p[12] &&
          entry.order === p[13],
      )
      if (row) {
        Object.assign(row, {
          state: p[0],
          activeOrderKey: p[1],
          providerStartedAt: p[2],
          providerResolvedAt: p[3],
          committedAt: p[4],
          reconciliationCheckedAt: p[5],
          reconciliationReference: p[6],
          updatedAt: p[7],
        })
      }
      if (failure === 'update-after') throw new Error('DUMMY-lost-acknowledgement')
      result = row ? [row] : []
    } else {
      throw new Error('Unexpected SQL in adapter test')
    }
    const response = { rows: structuredClone(result), rowCount: result.length }
    return transform ? transform(response) : response
  })
  const db = {
    execute,
    transaction: vi.fn(<T>(run: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
      const current = tail.then(async () => {
        const snapshot = structuredClone(stored)
        try {
          const result = await run({ execute })
          if (failure === 'commit') throw new Error('DUMMY-commit-failure')
          return result
        } catch (error) {
          stored = snapshot
          throw error
        }
      })
      tail = current.catch(() => undefined)
      return current
    }),
  }
  return {
    payload: () => ({ db: { drizzle: db } }) as unknown as Payload,
    queries,
    execute,
    snapshot: () => structuredClone(stored),
    fail: (value: typeof failure) => {
      failure = value
    },
    transform: (value: typeof transform) => {
      transform = value
    },
  }
}

describe('refund intent SQL storage', () => {
  it('uses the same discriminated owner V2 identity rules in canonical requests, SQL and schema', async () => {
    const db = fakeDatabase()
    const created = await createRefundIntent(
      db.payload(),
      { ...request, schemaVersion: 2, actorKind: 'owner', systemActor: null },
      key,
    )
    expect(created).toMatchObject({ actor: 2, actorKind: 'owner', schemaVersion: 2 })
    expect(await loadActiveRefundIntent(db.payload(), 1)).toEqual(created)
    expect(await transitionRefundIntent(db.payload(), created, 'provider_started')).toMatchObject({
      actor: 2,
      actorKind: 'owner',
    })
  })
  it('persists a system V2 identity across SQL read and transition without a customer actor', async () => {
    const db = fakeDatabase()
    const systemRequest = {
      ...request,
      schemaVersion: 2 as const,
      actorId: null,
      actorKind: 'system' as const,
      systemActor: 'paid-reject-recovery' as const,
    }
    const created = await createRefundIntent(db.payload(), systemRequest, key)
    expect(created).toMatchObject({
      actor: null,
      actorKind: 'system',
      systemActor: 'paid-reject-recovery',
      schemaVersion: 2,
    })
    expect(created.requestHash).toBe(hashRefundIntentRequest(systemRequest))
    expect(db.queries.find((query) => query.sql.startsWith('INSERT'))?.sql).toContain('actor_kind')
    expect(await loadActiveRefundIntent(db.payload(), 1)).toEqual(created)
    expect(await transitionRefundIntent(db.payload(), created, 'provider_started')).toMatchObject({
      actor: null,
      state: 'provider_started',
    })
    await expect(createRefundIntent(db.payload(), request, anotherKey)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('rejects mixed system identity in SQL RETURNING even when its request hash is otherwise valid', async () => {
    const db = fakeDatabase()
    db.transform(({ rows, rowCount }) => ({
      rows: rows.map((row) => ({ ...(row as object), actor: 7 })),
      rowCount,
    }))
    await expect(
      createRefundIntent(
        db.payload(),
        {
          ...request,
          schemaVersion: 2,
          actorId: null,
          actorKind: 'system',
          systemActor: 'paid-reject-recovery',
        },
        key,
      ),
    ).rejects.toMatchObject({ code: 'invalid_record' })
    expect(db.snapshot()).toEqual([])
  })

  it('loads a committed operation by its stable key without exposing or binding the raw key', async () => {
    const db = fakeDatabase([fixture('committed')])
    await expect(loadRefundIntentForOperation(db.payload(), '1', key)).resolves.toEqual(
      fixture('committed'),
    )
    expect(db.queries).toHaveLength(1)
    expect(db.queries[0].sql).toContain('OR idempotency_key_hash = $3')
    expect(db.queries[0].params[2]).toBe(digestRefundIdempotencyKey(key))
    expect(JSON.stringify(db.queries)).not.toContain(key)
  })

  it('returns null for an absent operation, not another operation on the same order', async () => {
    const empty = fakeDatabase()
    await expect(loadRefundIntentForOperation(empty.payload(), 1, key)).resolves.toBeNull()
    const other = fakeDatabase([fixture('committed')])
    await expect(loadRefundIntentForOperation(other.payload(), 1, anotherKey)).resolves.toBeNull()
  })

  it('rejects a valid digest match belonging to a different order as a conflict', async () => {
    const db = fakeDatabase([fixture('committed')])
    await expect(loadRefundIntentForOperation(db.payload(), 3, key)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('does not mistake a malformed cross-order digest match for an absent operation', async () => {
    const db = fakeDatabase([{ ...fixture('committed'), requestHash: '0'.repeat(64) }])
    await expect(loadRefundIntentForOperation(db.payload(), 3, key)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })

  it.each(['', '00000000-0000-4000-8000-000000000000', `${key}=`, `${key.slice(0, -1)}F`])(
    'rejects a noncanonical application key before querying storage: %s',
    async (invalidKey) => {
      const db = fakeDatabase()
      await expect(loadRefundIntentForOperation(db.payload(), 1, invalidKey)).rejects.toMatchObject(
        { code: 'invalid_record' },
      )
      expect(db.execute).not.toHaveBeenCalled()
    },
  )

  it('preserves complete-lookup validation even when the requested operation exists', async () => {
    const db = fakeDatabase([fixture('committed')])
    db.transform(({ rows }) => ({ rows, rowCount: 2 }))
    await expect(loadRefundIntentForOperation(db.payload(), 1, key)).rejects.toMatchObject({
      code: 'persistence',
    })
    db.transform(({ rows }) => ({ rows: [rows[0], rows[0]], rowCount: 2 }))
    await expect(loadRefundIntentForOperation(db.payload(), 1, key)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })

  it('fails closed without explicit database capabilities, including in tests', async () => {
    for (const db of [{}, { drizzle: { execute: vi.fn() } }]) {
      await expect(loadActiveRefundIntent({ db } as unknown as Payload, 1)).rejects.toMatchObject({
        code: 'unavailable',
      })
    }
  })

  it('returns null only for a complete valid lookup with no active intent', async () => {
    const db = fakeDatabase([fixture('committed')])
    await expect(loadActiveRefundIntent(db.payload(), '1')).resolves.toBeNull()
    expect(db.queries[0].sql).toContain('LIMIT $3')
    expect(db.queries[0].params.at(-1)).toBe(1001)
  })

  it.each([
    'prepared',
    'provider_started',
    'provider_unknown',
    'manual_review',
    'provider_succeeded',
  ] as const)('keeps %s blocking across recreated callers', async (state) => {
    const db = fakeDatabase([fixture(state)])
    await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toMatchObject({ state })
    await expect(createRefundIntent(db.payload(), request, anotherKey)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(db.queries.some((query) => query.sql.startsWith('INSERT'))).toBe(false)
  })

  it.each([
    { requestHash: '0'.repeat(64) },
    { activeOrderKey: null },
    { state: 'future_state' },
    { idempotencyKeyHash: 'broken' },
    { providerStartedAt: 'not-a-date' },
    { providerStartedAt: time },
    { providerResolvedAt: time },
    { committedAt: time },
    { reconciliationCheckedAt: time },
    { reason: undefined },
    { reconciliationReference: undefined },
    { state: 'provider_failed', providerStartedAt: time, providerResolvedAt: time },
  ])('rejects corrupted persisted records %j', async (patch) => {
    const db = fakeDatabase([{ ...fixture(), ...patch } as RefundIntent])
    await expect(loadActiveRefundIntent(db.payload(), 1)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })

  it('rejects duplicate active records and histories beyond the complete-lookup bound', async () => {
    const duplicate = fakeDatabase([fixture(), { ...fixture(), id: 2 }])
    await expect(loadActiveRefundIntent(duplicate.payload(), 1)).rejects.toMatchObject({
      code: 'invalid_record',
    })
    const oversized = fakeDatabase(
      Array.from({ length: 1001 }, (_, index) => ({ ...fixture('committed'), id: index + 1 })),
    )
    await expect(loadActiveRefundIntent(oversized.payload(), 1)).rejects.toMatchObject({
      code: 'incomplete_lookup',
    })
  })

  it('normalizes PostgreSQL numeric strings and Date timestamps', async () => {
    const db = fakeDatabase([fixture()])
    db.transform(({ rows, rowCount }) => ({
      rows: rows.map((row) => ({
        ...(row as RefundIntent),
        requestedAmountHuf: '100',
        createdAt: new Date(time),
      })),
      rowCount,
    }))
    await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toMatchObject({
      requestedAmountHuf: 100,
      createdAt: time,
    })
  })

  it('rejects incomplete lookup envelopes and unrelated returned rows', async () => {
    const db = fakeDatabase()
    db.transform(() => ({ rows: [], rowCount: 1 }))
    await expect(loadActiveRefundIntent(db.payload(), 1)).rejects.toMatchObject({
      code: 'persistence',
    })
    const otherRequest = { ...request, orderId: '3' }
    db.transform(() => ({
      rows: [
        {
          ...fixture(),
          order: 3,
          activeOrderKey: activeRefundOrderKey('3', 'prepared'),
          requestHash: hashRefundIntentRequestV1(otherRequest),
        },
      ],
      rowCount: 1,
    }))
    await expect(loadActiveRefundIntent(db.payload(), 1)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })

  it('rejects duplicate committed sequences even when no active record exists', async () => {
    const db = fakeDatabase([
      fixture('committed'),
      {
        ...fixture('committed'),
        id: 2,
        idempotencyKeyHash: digestRefundIdempotencyKey(anotherKey),
      },
    ])
    await expect(loadActiveRefundIntent(db.payload(), 1)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })

  it('creates only prepared records, binding values and persisting no raw key', async () => {
    const db = fakeDatabase()
    const maliciousLooking = { ...request, reason: "DUMMY '); DROP TABLE anything; --" }
    const intent = await createRefundIntent(db.payload(), maliciousLooking, key)
    expect(intent).toMatchObject({
      state: 'prepared',
      idempotencyKeyHash: digestRefundIdempotencyKey(key),
      reason: maliciousLooking.reason,
    })
    expect(JSON.stringify(db.snapshot())).not.toContain(key)
    expect(JSON.stringify(db.queries)).not.toContain(key)
    const insert = db.queries.find((query) => query.sql.startsWith('INSERT'))!
    expect(insert.sql).not.toContain(maliciousLooking.reason)
    expect(insert.params).toContain(maliciousLooking.reason)
    expect(db.queries[0].params[0]).toBe('refund-intent:order:1')
  })

  it('generates an application-key digest when no stable caller key is supplied', async () => {
    const intent = await createRefundIntent(fakeDatabase().payload(), request)
    expect(intent.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('serializes two fresh creations and rejects same-key replay even after commitment', async () => {
    const db = fakeDatabase()
    const results = await Promise.allSettled([
      createRefundIntent(db.payload(), request, key),
      createRefundIntent(db.payload(), request, anotherKey),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(db.snapshot()).toHaveLength(1)
    const committed = fakeDatabase([fixture('committed')])
    await expect(createRefundIntent(committed.payload(), request, key)).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(
      createRefundIntent(committed.payload(), request, anotherKey),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      createRefundIntent(committed.payload(), { ...request, refundSequence: 2 }, anotherKey),
    ).resolves.toMatchObject({ refundSequence: 2 })
  })

  it.each(['select', 'insert', 'commit'] as const)(
    'does not acknowledge failed creation at %s',
    async (phase) => {
      const db = fakeDatabase()
      db.fail(phase)
      await expect(createRefundIntent(db.payload(), request, key)).rejects.toMatchObject({
        code: 'persistence',
        message: 'Refund intent storage: persistence',
      })
      expect(db.snapshot()).toHaveLength(0)
    },
  )

  it('allows exactly one concurrent launch CAS with all expected predicates', async () => {
    const db = fakeDatabase([fixture()])
    const calls = await Promise.allSettled([
      transitionRefundIntent(db.payload(), fixture(), 'provider_started'),
      transitionRefundIntent(db.payload(), fixture(), 'provider_started'),
    ])
    expect(calls.filter((call) => call.status === 'fulfilled')).toHaveLength(1)
    expect(calls.find((call) => call.status === 'rejected')).toMatchObject({
      reason: { code: 'transition_conflict' },
    })
    const update = db.queries[0]
    expect(update.sql).toMatch(/WHERE id = \$9 AND state = \$10/u)
    expect(update.sql).toContain('active_order_key IS NOT DISTINCT FROM $11')
    expect(update.sql).toContain('request_hash = $12')
    expect(update.sql).toContain('idempotency_key_hash = $13')
    expect(update.sql).toContain('RETURNING')
    expect(db.snapshot()[0].providerStartedAt).toBeTruthy()
  })

  it.each(['update-before', 'update-after'] as const)(
    'blocks restart retry after a launch claim %s failure',
    async (phase) => {
      const db = fakeDatabase([fixture()])
      db.fail(phase)
      await expect(
        transitionRefundIntent(db.payload(), fixture(), 'provider_started'),
      ).rejects.toMatchObject({ code: 'persistence' })
      db.fail(undefined)
      await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toMatchObject({
        state: phase === 'update-before' ? 'prepared' : 'provider_started',
      })
      await expect(createRefundIntent(db.payload(), request, anotherKey)).rejects.toMatchObject({
        code: 'conflict',
      })
      if (phase === 'update-after') {
        await expect(
          transitionRefundIntent(db.payload(), fixture(), 'provider_started'),
        ).rejects.toMatchObject({ code: 'transition_conflict' })
      }
    },
  )

  it('retains success for local-only recovery and releases only on committed', async () => {
    const db = fakeDatabase([fixture('provider_started')])
    const success = await transitionRefundIntent(
      db.payload(),
      fixture('provider_started'),
      'provider_succeeded',
    )
    await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toMatchObject({
      state: 'provider_succeeded',
    })
    for (const target of [
      'prepared',
      'provider_started',
      'provider_failed',
      'provider_unknown',
    ] as const) {
      await expect(transitionRefundIntent(db.payload(), success, target)).rejects.toMatchObject({
        code: 'invalid_transition',
      })
    }
    const committed = await transitionRefundIntent(db.payload(), success, 'committed')
    expect(committed).toMatchObject({
      activeOrderKey: null,
      state: 'committed',
      providerResolvedAt: success.providerResolvedAt,
    })
    expect(committed.committedAt).toBeTruthy()
    await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toBeNull()
  })

  it('releases a never-launched prepared attempt without a start time, and only with that evidence', async () => {
    const db = fakeDatabase([fixture('prepared')])
    await expect(
      transitionRefundIntent(db.payload(), fixture('prepared'), 'provider_failed', {
        kind: 'provider_confirmed_no_effect',
        confirmedAt: time,
        reference: 'DUMMY-confirmed-no-effect',
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    const released = await transitionRefundIntent(
      db.payload(),
      fixture('prepared'),
      'provider_failed',
      {
        kind: 'provider_confirmed_no_effect',
        confirmedAt: time,
        reference: NO_PROVIDER_REQUEST_REFERENCE,
      },
    )
    expect(released).toMatchObject({
      state: 'provider_failed',
      activeOrderKey: null,
      providerStartedAt: null,
      reconciliationReference: NO_PROVIDER_REQUEST_REFERENCE,
    })
    expect(released.providerResolvedAt).toBeTruthy()
    await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toBeNull()
    await expect(createRefundIntent(db.payload(), request, anotherKey)).resolves.toMatchObject({
      state: 'prepared',
    })
  })

  it.each([
    { providerStartedAt: null, reconciliationReference: 'DUMMY-confirmed-no-effect' },
    { providerStartedAt: time, reconciliationReference: NO_PROVIDER_REQUEST_REFERENCE },
  ])('rejects a failed record whose start time contradicts its evidence %j', async (patch) => {
    const failed = {
      ...fixture('provider_started'),
      state: 'provider_failed',
      activeOrderKey: null,
      providerResolvedAt: time,
      reconciliationCheckedAt: time,
      ...patch,
    } as RefundIntent
    const db = fakeDatabase([failed])
    await expect(loadRefundIntentsForOrder(db.payload(), 1)).rejects.toMatchObject({
      code: 'invalid_record',
    })
  })

  it('keeps ambiguity blocking until structured no-effect evidence is saved atomically', async () => {
    const db = fakeDatabase([fixture('provider_started')])
    const unknown = await transitionRefundIntent(
      db.payload(),
      fixture('provider_started'),
      'provider_unknown',
    )
    const review = await transitionRefundIntent(db.payload(), unknown, 'manual_review')
    await expect(
      transitionRefundIntent(db.payload(), review, 'provider_failed'),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    const failed = await transitionRefundIntent(db.payload(), review, 'provider_failed', {
      kind: 'provider_confirmed_no_effect',
      confirmedAt: time,
      reference: 'DUMMY-confirmed-no-effect',
    })
    expect(failed).toMatchObject({
      activeOrderKey: null,
      reconciliationCheckedAt: time,
      reconciliationReference: 'DUMMY-confirmed-no-effect',
    })
    await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toBeNull()
    await expect(createRefundIntent(db.payload(), request, anotherKey)).resolves.toMatchObject({
      state: 'prepared',
    })
  })

  it.each([
    () => ({}),
    () => ({ rows: [], rowCount: 1 }),
    ({ rows }: { rows: unknown[] }) => ({ rows: [rows[0], rows[0]], rowCount: 2 }),
    ({ rows, rowCount }: { rows: unknown[]; rowCount: number }) => ({
      rows: rows.map((row) => ({ ...(row as RefundIntent), updatedAt: time })),
      rowCount,
    }),
  ])(
    'never authorizes launch on malformed or unexpected CAS acknowledgement',
    async (transform) => {
      const db = fakeDatabase([fixture()])
      db.transform(transform)
      await expect(
        transitionRefundIntent(db.payload(), fixture(), 'provider_started'),
      ).rejects.toMatchObject({ code: 'persistence' })
      db.transform(undefined)
      await expect(loadActiveRefundIntent(db.payload(), 1)).resolves.toMatchObject({
        state: 'provider_started',
      })
    },
  )
})
