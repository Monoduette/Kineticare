import { emptyRefundLedger } from '../empty-refund-ledger'
import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { BarionPaymentStateResponse } from '../../lib/barion'
import { createLogger } from '../../lib/logger'
import {
  applyBarionStateTransition,
  orderTransitionLockKey,
} from '../../lib/order-status/apply-barion-state'
import { userPurchasesLockKey } from '../../lib/user-purchases-lock'
import type { Order, User } from '../../payload-types'

/**
 * M5 — a paid-átmenet ATOMIKUSSÁGA (src/lib/order-status/apply-barion-state.ts).
 *
 * A check-then-act versenyhelyzet, amit a zár bezár: a Barion-callback és az
 * order-poll job PÁRHUZAMOSAN is átállíthatja ugyanazt a rendelést. Zár nélkül
 * mindkét szál a payment_pending kiindulást olvasta, így mindkettő
 * transitionedToPaid=true-t kapott, és az onOrderPaid-lánc (jogosultság-grant,
 * számla-queue, visszaigazoló e-mail) KÉTSZER futott.
 *
 * A tesztek a VALÓDI withAdvisoryLockot futtatják (nincs modul-mock): a
 * drizzle-példány szerkezeti utánzata FIFO-sorban sorosítja a tranzakciókat,
 * mint a Postgres advisory-zár. Így bizonyítjuk, hogy
 *  - a zár a rendelés-szintű `order:mutate:<id>` kulccsal, a döntés
 *    ELŐTT kerül megszerzésre, és a kulcs KÖTÖTT paraméterként utazik,
 *  - a rendelés a záron BELÜL olvasódik újra (findByID a zár megszerzése után),
 *  - két párhuzamos paid-átmenetből PONTOSAN EGY transitionedToPaid=true,
 *  - a paid↔cancelled verseny a FRISS állapoton dől el (a visszaállítás-tiltás
 *    az elavult példányon is megmarad).
 */

const ORDER_TOTAL_HUF = 19990
const ORDER_ID = 101
const PRODUCT_ID = 42
const CUSTOMER_ID = 7

interface CapturedQuery {
  sql: string
  params: unknown[]
}

function parseLockQuery(query: unknown): CapturedQuery {
  const candidate = query as { queryChunks?: unknown[] }
  const chunks = Array.isArray(candidate.queryChunks) ? candidate.queryChunks : []
  const text: string[] = []
  const params: unknown[] = []
  for (const chunk of chunks) {
    const stringChunk =
      typeof chunk === 'object' && chunk !== null ? (chunk as { value?: unknown }).value : undefined
    if (Array.isArray(stringChunk)) {
      text.push(stringChunk.join(''))
    } else {
      params.push(chunk)
    }
  }
  return { sql: text.join(''), params }
}

/**
 * Szerkezeti drizzle-mock: KULCSONKÉNT sorosít, mint a Postgres advisory-zár.
 * Különböző kulcsok párhuzamosan futhatnak (két rendelés), azonos kulcs
 * várakozik. A nestelt zár (order → user) más kulcson van, ezért NEM
 * deadlockol — a régi, mindenáltalános FIFO-lánc a nestelt user-záron
 * beragadt volna.
 */
function createSerializingDrizzle(events: string[]) {
  const queries: CapturedQuery[] = []
  const tails = new Map<string, Promise<void>>()
  const drizzle = {
    transaction: async <T>(
      run: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<T>,
    ): Promise<T> => {
      events.push('transaction-start')
      let release = (): void => {}
      try {
        return await run({
          execute: async (query: unknown) => {
            const parsed = parseLockQuery(query)
            queries.push(parsed)
            const lockKey = String(parsed.params[0] ?? '')
            let releaseThis = (): void => {}
            const held = new Promise<void>((resolve) => {
              releaseThis = resolve
            })
            const previous = tails.get(lockKey) ?? Promise.resolve()
            tails.set(
              lockKey,
              previous.then(
                () => held,
                () => held,
              ),
            )
            await previous
            release = releaseThis
            events.push('lock-acquired')
            return { rows: [] }
          },
        })
      } finally {
        events.push('transaction-end')
        release()
      }
    },
  }
  return { drizzle, queries }
}

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: 'KH-2026-000123',
    status: 'payment_pending',
    customer: CUSTOMER_ID,
    currency: 'HUF',
    totalHufSnapshot: ORDER_TOTAL_HUF,
    items: [{ product: PRODUCT_ID, quantity: 1 }],
    ...overrides,
  } as unknown as Order
}

function createState(
  overrides: Partial<BarionPaymentStateResponse> = {},
): BarionPaymentStateResponse {
  return {
    PaymentId: '11111111-2222-3333-4444-555555555555',
    PaymentRequestId: 'KH-2026-000123',
    Status: 'Succeeded',
    Total: ORDER_TOTAL_HUF,
    Currency: 'HUF',
    Transactions: [],
    ...overrides,
  }
}

function createMockPayload(
  orderOrOrders: Order | Order[],
  events: string[],
  options: { delayFirstUserUpdateMs?: number } = {},
) {
  const orders = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders]
  const user = {
    id: CUSTOMER_ID,
    email: 'vevo@example.test',
    purchases: [],
  } as unknown as User
  const { drizzle, queries } = createSerializingDrizzle(events)
  const updates: Array<{ collection: string; id?: unknown; data: Record<string, unknown> }> = []
  let userUpdates = 0
  const payload = {
    db: {
      drizzle: { ...drizzle, execute: emptyRefundLedger(orders.map((entry) => entry.id)).execute },
    },
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: number | string }) => {
      if (collection === 'orders') {
        events.push('order-reread')
        return orders.find((entry) => entry.id === id) ?? orders[0]
      }
      // Snapshot: a párhuzamos olvasók ne osszák meg a mutálható tömböt,
      // különben a lost-update teszt hamisan menne át objektum-azonosítón.
      return { ...user, purchases: [...(user.purchases ?? [])] }
    }),
    // A K5 dupla-fizetés őre (hasPaidOrderFor) ezt kérdezi — itt nincs más
    // paid rendelés, így az őr átenged (a zár-viselkedés a fókusz).
    find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
    update: vi.fn(
      async (args: { collection: string; id?: unknown; data: Record<string, unknown> }) => {
        if (args.collection === 'users' && options.delayFirstUserUpdateMs) {
          userUpdates += 1
          if (userUpdates === 1) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, options.delayFirstUserUpdateMs)
            })
          }
        }
        updates.push({ collection: args.collection, id: args.id, data: args.data })
        if (args.collection === 'orders') {
          const target = orders.find((entry) => entry.id === args.id) ?? orders[0]
          Object.assign(target, args.data)
        }
        if (args.collection === 'users') {
          Object.assign(user, args.data)
        }
        return args.data
      },
    ),
  }
  return { payload: payload as unknown as Payload, queries, updates, user }
}

const paidInput = (
  payload: Payload,
  order: Order,
): Parameters<typeof applyBarionStateTransition>[0] => ({
  payload,
  order,
  mapped: 'paid',
  state: createState(),
  log: createLogger(),
})

describe('M5 — rendelés-szintű advisory-zár a paid/cancelled átmeneten', () => {
  it('a zár a rendelésre szabott kulccsal, a döntés ELŐTT jön létre, és a rendelés a záron BELÜL olvasódik újra', async () => {
    const events: string[] = []
    const order = createOrder()
    const { payload, queries } = createMockPayload(order, events)

    await applyBarionStateTransition(paidInput(payload, order))

    // Paid-átmenet és refund ugyanazt a rendelés-mutációs zárat viseli.
    expect(orderTransitionLockKey(ORDER_ID)).toBe(`order:mutate:${ORDER_ID}`)
    expect(userPurchasesLockKey(CUSTOMER_ID)).toBe(`purchases:user:${CUSTOMER_ID}`)
    expect(queries.map((query) => query.params[0])).toEqual([
      `order:mutate:${ORDER_ID}`,
      `purchases:user:${CUSTOMER_ID}`,
      `purchases:user:${CUSTOMER_ID}`,
    ])
    expect(queries[0]?.sql).toContain('pg_advisory_xact_lock')
    // Sorrend: order-zár → friss order → membership user-zár → origin user-zár.
    // Deadlock-szabály: order → user, soha fordítva.
    expect(events).toEqual([
      'transaction-start',
      'lock-acquired',
      'order-reread',
      'transaction-start',
      'lock-acquired',
      'transaction-end',
      'transaction-start',
      'lock-acquired',
      'transaction-end',
      'transaction-end',
    ])
  })

  it('két PÁRHUZAMOS paid-átmenetből PONTOSAN EGY transitionedToPaid=true (az onOrderPaid egyszer futhat)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const events: string[] = []
    const order = createOrder()
    const { payload, updates, user } = createMockPayload(order, events)

    const [first, second] = await Promise.all([
      applyBarionStateTransition(paidInput(payload, order)),
      applyBarionStateTransition(paidInput(payload, order)),
    ])

    const transitions = [first, second]
    expect(transitions.every((result) => result.action === 'paid')).toBe(true)
    // A lényeg: a friss paid-átmenet — és vele az onOrderPaid trigger — egyszeri.
    expect(transitions.filter((result) => result.transitionedToPaid === true)).toHaveLength(1)
    expect(transitions.filter((result) => result.duplicate === true)).toHaveLength(1)
    // Egyetlen paid státusz-írás és egyetlen purchases-beírás történt.
    expect(
      updates.filter((entry) => entry.collection === 'orders' && entry.data.status === 'paid'),
    ).toHaveLength(1)
    const userWrites = updates.filter((entry) => entry.collection === 'users')
    expect(userWrites).toHaveLength(2)
    expect(userWrites.filter((entry) => Object.hasOwn(entry.data, 'purchases'))).toHaveLength(1)
    expect(userWrites.filter((entry) => Object.hasOwn(entry.data, 'accessGrants'))).toHaveLength(1)
    expect(user.accessGrants).toEqual([
      {
        product: PRODUCT_ID,
        sourceKind: 'order',
        sourceOrder: ORDER_ID,
        grantedAt: expect.any(String),
      },
    ])
    expect(order.status).toBe('paid')
    expect(user.purchases).toEqual([PRODUCT_ID])
  })

  it('paid↔cancelled verseny: a cancelled jelzés a FRISS (már paid) állapoton akad el — nincs visszaállítás', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const events: string[] = []
    const order = createOrder()
    const { payload, updates } = createMockPayload(order, events)

    // A „callback" paid-re állít, miközben a „poll" még az ELAVULT
    // payment_pending példánnyal futtatja a cancelled átmenetet.
    const staleOrder = createOrder()
    const [paidResult, cancelResult] = await Promise.all([
      applyBarionStateTransition(paidInput(payload, order)),
      applyBarionStateTransition({
        payload,
        order: staleOrder,
        mapped: 'cancelled',
        state: createState({ Status: 'Canceled' }),
        log: createLogger(),
      }),
    ])

    expect(paidResult.action).toBe('paid')
    // A cancelled ág a záron belüli friss olvasáson paid-et lát → állapotgép-védelem.
    expect(cancelResult).toEqual({ action: 'rejected', reason: 'paid-cancel-rejected' })
    expect(order.status).toBe('paid')
    expect(
      updates.filter((entry) => entry.collection === 'orders' && entry.data.status === 'cancelled'),
    ).toHaveLength(0)
  })

  it('a payment_pending ág NEM foglal zárat (nincs írás — nincs mit sorosítani)', async () => {
    const events: string[] = []
    const order = createOrder()
    const { payload, queries } = createMockPayload(order, events)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'payment_pending',
      state: createState({ Status: 'Started' }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'pending' })
    expect(queries).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})

/**
 * K1 — users.purchases lost update KÜLÖNBÖZŐ rendeléseken, ugyanarra a vevőre.
 *
 * A rendelés-zár ezt NEM fogja: két order-id = két kulcs, párhuzamosan futnak.
 * Zár nélkül: A beolvassa [], granteli 1-et, alszik az update előtt; B
 * beolvassa [], granteli 2-t, ír; A felülír → végső = [1]. User-zárral a
 * végső tömb MINDKÉT terméket tartalmazza.
 */
describe('K1 — user-szintű purchases-zár két különböző rendelésen', () => {
  it('két KÜLÖNBÖZŐ rendelés ugyanarra a vevőre: a user-zár mindkét termék jogosultságát megőrzi (nincs lost-update)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const events: string[] = []
    const orderA = createOrder({ id: 101, items: [{ product: 11, quantity: 1 }] })
    const orderB = createOrder({ id: 202, items: [{ product: 22, quantity: 1 }] })
    const { payload, user, queries } = createMockPayload([orderA, orderB], events, {
      delayFirstUserUpdateMs: 40,
    })

    const [resultA, resultB] = await Promise.all([
      applyBarionStateTransition(paidInput(payload, orderA)),
      applyBarionStateTransition(paidInput(payload, orderB)),
    ])

    expect(resultA.action).toBe('paid')
    expect(resultB.action).toBe('paid')
    expect(resultA.transitionedToPaid).toBe(true)
    expect(resultB.transitionedToPaid).toBe(true)
    expect(user.purchases).toEqual(expect.arrayContaining([11, 22]))
    expect(user.purchases).toHaveLength(2)
    expect(queries.map((query) => query.params[0])).toEqual(
      expect.arrayContaining(['order:mutate:101', 'order:mutate:202', 'purchases:user:7']),
    )
  })
})
