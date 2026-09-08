import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { updateOrderStatusIfCurrent } from '../../lib/order-status/conditional-status'
import configPromise from '../../payload.config'
import { isDatabaseAvailable } from '../helpers/db-available'
import { captureOwnedPostgresBootstrap } from '../helpers/owned-postgres-bootstrap'

// A hálózati próba ELŐTT ellenőrizzük a célpontot. Az audit:1 kizárólag a
// hálózattiltott lokális runner elérhetetlen jelzője, nem futtatható fixture.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    (target.pathname !== '/kineticare_ci' && !(target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error('Order lock verification requires the disposable localhost CI database')
  }
}
const hasDb = await isDatabaseAvailable()

describe.skipIf(!hasDb)('conditional order status (real PostgreSQL locks)', () => {
  const run = `conditional-status-${randomUUID()}`
  const connections = new Map<Payload, () => void>()
  let first: Payload
  let second: Payload
  let userId: number
  let orderId: number | undefined

  const adapter = (payload: Payload) => payload.db as unknown as PostgresAdapter
  async function connect(name: string) {
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
    connections.set(payload, releaseBootstrap!)
    return payload
  }

  beforeAll(async () => {
    first = await connect('first')
    second = await connect('second')
    expect(adapter(first).pool).not.toBe(adapter(second).pool)
    const created = await adapter(first).pool.query<{ id: number }>(
      'INSERT INTO users (name, role, email) VALUES ($1, $2, $3) RETURNING id',
      ['DUMMY order-lock user', 'customer', `${run}@example.test`],
    )
    userId = created.rows[0].id
  }, 60_000)

  beforeEach(async () => {
    const created = await adapter(first).pool.query<{ id: number }>(
      'INSERT INTO orders (customer_id, status, amount, currency) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, 'payment_pending', 1000, 'HUF'],
    )
    orderId = created.rows[0].id
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (orderId === undefined || !first) return
    await adapter(first).pool.query('DELETE FROM orders WHERE id = $1 AND customer_id = $2', [
      orderId,
      userId,
    ])
    orderId = undefined
  })

  afterAll(async () => {
    try {
      if (first && userId !== undefined) {
        await adapter(first).pool.query('DELETE FROM users WHERE id = $1 AND email = $2', [
          userId,
          `${run}@example.test`,
        ])
      }
    } finally {
      await Promise.all(
        [...connections].map(async ([payload, release]) => {
          const pool = adapter(payload).pool
          await payload.destroy()
          release()
          await pool.end()
          expect(pool.ended).toBe(true)
        }),
      )
    }
  })

  async function expectWaiting() {
    await expect
      .poll(
        async () => {
          const result = await adapter(first).pool.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE application_name LIKE $1 AND wait_event_type = 'Lock'`,
            [`${run}-%`],
          )
          return result.rows[0].count
        },
        { timeout: 5000, interval: 25 },
      )
      .toBe(1)
  }

  it.each(['cancelled', 'payment_pending'] as const)(
    'a záron váró pending → %s a közben commitolt paid státuszt nem írja felül',
    async (next) => {
      const blocker = await adapter(first).pool.connect()
      let pending: Promise<boolean> | undefined
      try {
        await blocker.query('BEGIN')
        await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
          `order:mutate:${orderId}`,
        ])
        pending = updateOrderStatusIfCurrent({
          payload: second,
          orderId: orderId!,
          expected: 'payment_pending',
          next,
        })
        await expectWaiting()
        await blocker.query('UPDATE orders SET status = $1 WHERE id = $2 AND customer_id = $3', [
          'paid',
          orderId,
          userId,
        ])
        await blocker.query('COMMIT')
        await expect(pending).resolves.toBe(false)
        const saved = await first.findByID({
          collection: 'orders',
          id: orderId!,
          depth: 0,
          overrideAccess: true,
        })
        expect(saved.status).toBe('paid')
      } finally {
        await blocker.query('ROLLBACK')
        blocker.release()
        if (pending) await pending
      }
    },
    15_000,
  )

  it('két független Payload kapcsolat közül csak egy írhatja át a várt pending státuszt', async () => {
    const original = first.findByID.bind(first)
    let signalRead = (): void => undefined
    let releaseRead = (): void => undefined
    const read = new Promise<void>((resolve) => {
      signalRead = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    vi.spyOn(first, 'findByID').mockImplementationOnce(async (...args) => {
      const value = await original(...args)
      signalRead()
      await release
      return value
    })
    const paid = updateOrderStatusIfCurrent({
      payload: first,
      orderId: orderId!,
      expected: 'payment_pending',
      next: 'paid',
    })
    await read
    const cancel = updateOrderStatusIfCurrent({
      payload: second,
      orderId: orderId!,
      expected: 'payment_pending',
      next: 'cancelled',
    })
    try {
      await expectWaiting()
    } finally {
      releaseRead()
      await Promise.allSettled([paid, cancel])
    }
    await expect(paid).resolves.toBe(true)
    await expect(cancel).resolves.toBe(false)
    const saved = await second.findByID({
      collection: 'orders',
      id: orderId!,
      depth: 0,
      overrideAccess: true,
    })
    expect(saved.status).toBe('paid')
  }, 15_000)
})
