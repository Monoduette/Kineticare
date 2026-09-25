import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../../lib/alert-throttle'
import { startCheckout } from '../../lib/checkout/start-checkout'
import type { Order, Product, User } from '../../payload-types'

/**
 * a-checkout-4 — a checkout advisory-zára nem éheztetheti ki a DB-poolt.
 *
 * A VALÓDI `withAdvisoryLock` fut (nincs mockolva): a zár egy tranzakcióban,
 * egy pool-kapcsolaton ül, amíg a védett szakasz fut, a szakasz Payload-
 * lekérdezései pedig további kapcsolatot kérnek ugyanabból a poolból. A pool
 * itt egy pg-pool-szerű modell: legfeljebb 10 kapcsolat (a pg alapértéke,
 * payload.config.ts nem állít max-ot), a várakozás felső határa után
 * „timeout exceeded when trying to connect" (pg-pool/index.js). A modell
 * a Payload-hívásokat és a zár-tranzakciót köti a poolhoz; a Barion-hívás
 * mockolt fetch (CLAUDE.md 15.).
 *
 * A javítás előtt tíz egyidejű pénztár mind a tíz kapcsolatot a zárra
 * foglalta, és a védett szakaszok első lekérdezése kapcsolat nélkül várt a
 * timeoutig: minden pénztár elbukott.
 */

const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const POOL_MAX = 10
/** A pg connectionTimeoutMillis modellje (élesben 10 s; itt rövid, hogy a teszt gyors legyen). */
const POOL_CONNECT_TIMEOUT_MS = 400
/** Egy lekérdezés ideje a modellben. */
const QUERY_MS = 5

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

class FakePool {
  inUse = 0
  timeouts = 0
  private readonly waiters: Array<() => void> = []

  private grant(): () => void {
    this.inUse += 1
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.inUse -= 1
      const next = this.waiters.shift()
      if (next) {
        next()
      }
    }
  }

  acquire(): Promise<() => void> {
    if (this.inUse < POOL_MAX) {
      return Promise.resolve(this.grant())
    }
    return new Promise((resolve, reject) => {
      const waiter = (): void => {
        clearTimeout(timer)
        resolve(this.grant())
      }
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) {
          this.waiters.splice(index, 1)
        }
        this.timeouts += 1
        reject(new Error('timeout exceeded when trying to connect'))
      }, POOL_CONNECT_TIMEOUT_MS)
      this.waiters.push(waiter)
    })
  }

  async withConnection<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/** A zárkulcs a drizzle `sql` sablon paramétere (a nyers string-darab). */
function lockKeyOf(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? []
  const key = chunks.find((chunk) => typeof chunk === 'string')
  return typeof key === 'string' ? key : JSON.stringify(chunks)
}

function createPooledPayload(pool: FakePool) {
  const keyChains = new Map<string, Promise<void>>()
  let openLockTransactions = 0
  let peakLockTransactions = 0
  let nextOrder = 0

  const drizzle = {
    transaction: <T>(
      run: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<T>,
    ): Promise<T> =>
      pool.withConnection(async () => {
        openLockTransactions += 1
        peakLockTransactions = Math.max(peakLockTransactions, openLockTransactions)
        let unlock: () => void = () => undefined
        try {
          return await run({
            // pg_advisory_xact_lock: kulcsonként soros, a tranzakció végéig tart.
            execute: async (query) => {
              const key = lockKeyOf(query)
              const previous = keyChains.get(key) ?? Promise.resolve()
              const held = new Promise<void>((resolve) => {
                unlock = resolve
              })
              keyChains.set(
                key,
                previous.then(() => held),
              )
              await previous
              return undefined
            },
          })
        } finally {
          unlock()
          openLockTransactions -= 1
        }
      }),
  }

  const product = {
    id: 42,
    sku: 'KURZUS-ALAP',
    status: 'published',
    priceInHUF: 5000,
    priceInHUFEnabled: true,
    shortDescription: 'Alap kurzus',
  } as unknown as Product
  const rows = new Map<number, Record<string, unknown>>()

  const payload = {
    db: { drizzle },
    findByID: vi.fn((args: { collection: string; id: number }) =>
      pool.withConnection(async () => {
        await sleep(QUERY_MS)
        return args.collection === 'orders' ? { ...rows.get(args.id) } : product
      }),
    ),
    find: vi.fn(() =>
      pool.withConnection(async () => {
        await sleep(QUERY_MS)
        return { docs: [], totalDocs: 0 }
      }),
    ),
    // A create a saját tranzakciójában végig fog egy kapcsolatot (a hookok
    // a req-jével ugyanezen futnak).
    create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
      pool.withConnection(async () => {
        await sleep(QUERY_MS * 2)
        nextOrder += 1
        const id = 100 + nextOrder
        const orderNumber = `KH-2026-${String(nextOrder).padStart(6, '0')}`
        rows.set(id, { id, status: 'payment_pending', orderNumber })
        return {
          ...data,
          id,
          orderNumber,
          createdAt: new Date().toISOString(),
          totalHufSnapshot: 5000,
          items: [
            { product: 42, quantity: 1, titleSnapshot: 'KURZUS-ALAP', priceHufSnapshot: 5000 },
          ],
        } as unknown as Order
      }),
    ),
    update: vi.fn(({ id, data }: { id: number; data: Record<string, unknown> }) =>
      pool.withConnection(async () => {
        await sleep(QUERY_MS)
        Object.assign(rows.get(id) ?? {}, data)
        return { id, ...data }
      }),
    ),
  }

  return {
    payload: payload as unknown as Payload,
    peakLockTransactions: () => peakLockTransactions,
  }
}

const fetchMock = vi.fn()
const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of [
    'BARION_API_URL',
    'BARION_PAYEE_EMAIL',
    'BARION_POSKEY_TEST',
    'NEXT_PUBLIC_SERVER_URL',
  ]) {
    savedEnv[key] = process.env[key]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
  process.env.NEXT_PUBLIC_SERVER_URL = 'https://shop.example.test'
})
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  resetAlertThrottle()
})

function barionStartSuccess(index: number): Response {
  const paymentId = `11111111-2222-3333-4444-${String(index).padStart(12, '0')}`
  return new Response(
    JSON.stringify({
      PaymentId: paymentId,
      PaymentRequestId: `KH-2026-${String(index).padStart(6, '0')}`,
      Status: 'Prepared',
      GatewayUrl: `https://secure.test.barion.com/Pay?id=${paymentId}`,
      Transactions: [],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('checkout-zár — 10 egyidejű pénztár egy 10 kapcsolatos poolon', () => {
  it('mind a tíz pénztár sikerül, egyetlen kapcsolat-timeout nélkül; a zár egyszerre legfeljebb két kapcsolatot fog', async () => {
    let started = 0
    fetchMock.mockImplementation(async () => {
      started += 1
      return barionStartSuccess(started)
    })
    const pool = new FakePool()
    const { payload, peakLockTransactions } = createPooledPayload(pool)

    const buyers = Array.from(
      { length: 10 },
      (_unused, index) =>
        ({
          id: index + 1,
          email: `vevo${index + 1}@example.test`,
          name: `Vevő ${index + 1}`,
          role: 'customer',
        }) as unknown as User,
    )
    const results = await Promise.allSettled(
      buyers.map((user) =>
        startCheckout({
          payload,
          user,
          input: {
            productId: 42,
            consentWithdrawalWaiver: true,
            consentTerms: true,
            billing: { name: user.name, zip: '1011', city: 'Budapest', street: 'Fő utca 1.' },
          },
        }),
      ),
    )

    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason))
    expect(failures).toEqual([])
    expect(pool.timeouts).toBe(0)
    expect(peakLockTransactions()).toBeLessThanOrEqual(2)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })
})
