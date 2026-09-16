import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { withAdvisoryLock } from '../../lib/advisory-lock'
import { updateOrderStatusIfCurrent } from '../../lib/order-status/conditional-status'
import type { Order } from '../../payload-types'

function deferred() {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Valódi withAdvisoryLock-hívás, kulcsonként sorba állított SQL-zár fixture.
 * Ez az alkalmazás lock/recheck szerződését méri; PostgreSQL-t a DB-teszt igazol.
 */
function fixture(status: NonNullable<Order['status']> = 'payment_pending') {
  const row = { id: 5, status }
  const attemptedKeys: unknown[] = []
  const locks = new Map<string, Promise<void>>()
  const dialect = new PgDialect()
  const drizzle = {
    async transaction<T>(run: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>) {
      let release = (): void => undefined
      try {
        return await run({
          async execute(query) {
            const compiled = dialect.sqlToQuery(query)
            expect(compiled.sql).toContain('pg_advisory_xact_lock')
            const key = compiled.params[0]
            attemptedKeys.push(key)
            if (typeof key !== 'string') throw new Error('DUMMY lock key required')
            const previous = locks.get(key) ?? Promise.resolve()
            const current = deferred()
            locks.set(key, current.promise)
            release = current.resolve
            await previous
            return { rows: [] }
          },
        })
      } finally {
        release()
      }
    },
  }
  const findByID = vi.fn(async () => ({ ...row }))
  const update = vi.fn(
    async (args: {
      id?: number
      where?: { and: Array<{ status?: { equals: string } }> }
      data: { status: NonNullable<Order['status']> }
    }) => {
      // A régi bulk API alakját is kezeli, hogy a RED a hibás viselkedést mérje.
      const expected = args.where?.and.find((condition) => condition.status)?.status?.equals
      if (expected !== undefined && row.status !== expected) return { docs: [] }
      row.status = args.data.status
      return args.where ? { docs: [{ ...row }] } : { ...row }
    },
  )
  return {
    payload: { db: { drizzle }, findByID, update } as unknown as Payload,
    row,
    attemptedKeys,
    findByID,
    update,
  }
}

describe('updateOrderStatusIfCurrent — közös order-zár és friss feltétel', () => {
  it('a friss olvasás után ID-alapú Payload írással őrzi meg a hookokat', async () => {
    const f = fixture()
    await expect(
      updateOrderStatusIfCurrent({
        payload: f.payload,
        orderId: 5,
        expected: 'payment_pending',
        next: 'cancelled',
      }),
    ).resolves.toBe(true)
    expect(f.attemptedKeys).toEqual(['order:mutate:5'])
    expect(f.findByID).toHaveBeenCalledWith({
      collection: 'orders',
      id: 5,
      depth: 0,
      overrideAccess: true,
    })
    expect(f.update).toHaveBeenCalledWith({
      collection: 'orders',
      id: 5,
      data: { status: 'cancelled' },
      overrideAccess: true,
    })
  })

  it.each(['cancelled', 'payment_pending'] as const)(
    'a már paid sorra várt pending → %s nulla írással tér vissza',
    async (next) => {
      const f = fixture('paid')
      await expect(
        updateOrderStatusIfCurrent({
          payload: f.payload,
          orderId: 5,
          expected: 'payment_pending',
          next,
        }),
      ).resolves.toBe(false)
      expect(f.update).not.toHaveBeenCalled()
      expect(f.row.status).toBe('paid')
    },
  )

  it('a zárra várás közben befejezett fizetést újraolvassa, nem írja felül', async () => {
    const f = fixture()
    const held = deferred()
    const release = deferred()
    const callback = withAdvisoryLock(f.payload, 'order:mutate:5', async () => {
      held.resolve()
      await release.promise
      f.row.status = 'paid'
    })
    await held.promise
    const touch = updateOrderStatusIfCurrent({
      payload: f.payload,
      orderId: 5,
      expected: 'payment_pending',
      next: 'cancelled',
    })
    try {
      await expect.poll(() => f.attemptedKeys.length, { timeout: 200 }).toBe(2)
      expect(f.findByID).not.toHaveBeenCalled()
      expect(f.update).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await callback
      await touch
    }
    await expect(touch).resolves.toBe(false)
    expect(f.row.status).toBe('paid')
    expect(f.update).not.toHaveBeenCalled()
  })

  it.each(['read', 'write'] as const)(
    '%s hiba után a következő író megkapja a zárat',
    async (phase) => {
      const f = fixture()
      const error = new Error('DUMMY persistence failure')
      if (phase === 'read') f.findByID.mockRejectedValueOnce(error)
      else f.update.mockRejectedValueOnce(error)
      const input = {
        payload: f.payload,
        orderId: 5,
        expected: 'payment_pending',
        next: 'cancelled',
      } as const
      await expect(updateOrderStatusIfCurrent(input)).rejects.toThrow(error)
      await expect(updateOrderStatusIfCurrent(input)).resolves.toBe(true)
      expect(f.attemptedKeys).toEqual(['order:mutate:5', 'order:mutate:5'])
    },
  )
})
