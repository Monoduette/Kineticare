import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../../lib/alert-throttle'
import { CHECKOUT_GUEST_ORDER_BURST_THRESHOLD } from '../../lib/checkout/abuse-limits'
import { CheckoutError, startCheckout } from '../../lib/checkout/start-checkout'
import type { Logger } from '../../lib/logger'
import type { Order, Product, User } from '../../payload-types'

/**
 * a-checkout-9 — visszaélés elleni korlátok a pénztárban.
 *
 * Az ADATBÁZISBAN tárolt rendelésekből számolnak, ezért a teszt egy memóriás
 * rendelés-tárolót használ, amely a Payload `where` szemantikáját (equals, in,
 * greater_than, exists, and) értékeli ki, és a pénztár a valódi lekérdezéseit
 * futtatja rajta. Így az állítás a viselkedésről szól (melyik rendelés számít
 * bele), nem a lekérdezés alakjáról.
 *
 * A vezetői kikötés: a korlát nem zárhat ki valódi, fizetést újrapróbáló
 * vevőt. Ezt külön esetek védik (fizetett és elutasított Start nem számít).
 */

/**
 * A valódi advisory-zár helyén kulcsonkénti in-memory mutex (mint a
 * checkout-lock.test.ts-ben): a zár nélküli teszt-út a párhuzamos kéréseket
 * nem sorosítaná, így a korlát zár alatti számolása nem volna mérhető.
 */
const lockChains = new Map<string, Promise<unknown>>()
vi.mock('../../lib/advisory-lock', () => ({
  withAdvisoryLock: async <T>(
    _payload: unknown,
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const run = (lockChains.get(lockKey) ?? Promise.resolve()).then(fn)
    lockChains.set(
      lockKey,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  },
}))

const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const NOW = new Date('2026-09-24T12:00:00.000Z')
const GUEST_EMAIL = 'vendeg@example.test'

type StoredOrder = {
  id: number
  status: string
  customer?: number | null
  customerEmail: string
  createdAt: string
  items: Array<{ product: number }>
  orderNumber?: string
}

type Condition = Record<string, unknown>

function fieldValue(order: StoredOrder, field: string): unknown {
  if (field === 'items.product') {
    return order.items.map((item) => item.product)
  }
  return (order as unknown as Record<string, unknown>)[field]
}

/** A Payload `where` részhalmaza, amit a pénztár használ. */
function matches(order: StoredOrder, where: unknown): boolean {
  if (where === null || typeof where !== 'object') {
    return true
  }
  return Object.entries(where as Record<string, unknown>).every(([key, condition]) => {
    if (key === 'and') {
      return (condition as unknown[]).every((part) => matches(order, part))
    }
    const value = fieldValue(order, key)
    const operators = condition as Condition
    return Object.entries(operators).every(([operator, expected]) => {
      const values = Array.isArray(value) ? value : [value]
      switch (operator) {
        case 'equals':
          return values.includes(expected)
        case 'in':
          return (expected as unknown[]).some((candidate) => values.includes(candidate))
        case 'greater_than':
          return typeof value === 'string' && Date.parse(value) > Date.parse(String(expected))
        case 'exists':
          return expected === (value !== null && value !== undefined)
        default:
          throw new Error(`TESZT: nem kezelt operátor: ${operator}`)
      }
    })
  })
}

function storePayload(initial: StoredOrder[]) {
  const orders = [...initial]
  let nextId = 1000
  const product = (id: number) =>
    ({
      id,
      sku: id === 42 ? 'KURZUS-ALAP' : `KURZUS-${id}`,
      status: 'published',
      priceInHUF: 5000,
      priceInHUFEnabled: true,
      shortDescription: 'Alap kurzus',
    }) as unknown as Product
  const payload = {
    findByID: vi.fn(async (args: { collection: string; id: number }) =>
      args.collection === 'orders'
        ? orders.find((order) => order.id === args.id)
        : product(Number(args.id)),
    ),
    find: vi.fn(
      async (args: { collection: string; where?: unknown; sort?: string; limit?: number }) => {
        if (args.collection === 'users') {
          return { docs: [], totalDocs: 0 }
        }
        const matched = orders.filter((order) => matches(order, args.where))
        if (args.sort === '-createdAt') {
          matched.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        }
        return { docs: matched.slice(0, args.limit ?? 10), totalDocs: matched.length }
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      nextId += 1
      const items = data.items as Array<{ product: number }> | undefined
      const productId = items?.[0]?.product ?? 42
      const stored: StoredOrder = {
        id: nextId,
        status: String(data.status),
        customer: typeof data.customer === 'number' ? data.customer : null,
        customerEmail: String(data.customerEmail),
        createdAt: NOW.toISOString(),
        items: [{ product: productId }],
        orderNumber: `KH-2026-${String(nextId).padStart(6, '0')}`,
      }
      orders.push(stored)
      return {
        ...data,
        ...stored,
        totalHufSnapshot: 5000,
        items: [
          {
            product: productId,
            quantity: 1,
            titleSnapshot: productId === 42 ? 'KURZUS-ALAP' : `KURZUS-${productId}`,
            priceHufSnapshot: 5000,
          },
        ],
      } as unknown as Order
    }),
    update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const row = orders.find((order) => order.id === id)
      if (row) {
        Object.assign(row, data)
      }
      return { id, ...data }
    }),
  }
  return { payload: payload as unknown as Payload, orders }
}

/** Egy korábbi rendelés ugyanarra a címre, MÁS kurzusra (hogy a duplavásárlás-blokk ne fogja meg). */
function earlier(
  id: number,
  status: string,
  minutesAgo: number,
  extra: Partial<StoredOrder> = {},
): StoredOrder {
  return {
    id,
    status,
    customer: null,
    customerEmail: GUEST_EMAIL,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    items: [{ product: 900 + id }],
    ...extra,
  }
}

const guestInput = {
  productId: 42,
  consentWithdrawalWaiver: true,
  consentTerms: true,
  billing: { name: 'Vendég Vevő', zip: '1011', city: 'Budapest', street: 'Fő utca 1.' },
  guest: { email: GUEST_EMAIL, name: 'Vendég Vevő' },
}

function captureLogger(): {
  log: Logger
  errors: Array<{ message: string; context: Record<string, unknown> }>
} {
  const errors: Array<{ message: string; context: Record<string, unknown> }> = []
  const nothing = (): void => undefined
  const log: Logger = {
    debug: nothing,
    info: nothing,
    warn: nothing,
    error: (message, context) => {
      errors.push({ message, context: context ?? {} })
    },
    child: () => log,
  }
  return { log, errors }
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
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          PaymentId: '11111111-2222-3333-4444-555555555555',
          PaymentRequestId: 'KH-2026-001001',
          Status: 'Prepared',
          GatewayUrl: 'https://secure.test.barion.com/Pay?id=11111111-2222-3333-4444-555555555555',
          Transactions: [],
          Errors: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  resetAlertThrottle()
  lockChains.clear()
})

async function checkoutError(promise: Promise<unknown>): Promise<CheckoutError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof CheckoutError)) {
    throw new Error(`TESZT: CheckoutError-t vártunk, ez jött: ${String(caught)}`)
  }
  return caught
}

describe('a-checkout-9 — nyitott fizetések e-mail-címenként', () => {
  it('3 élő függő fizetés (más kurzusokra) → 409, új rendelés és Barion Start NÉLKÜL, a kapcsolati címmel', async () => {
    const { payload, orders } = storePayload([
      earlier(1, 'payment_pending', 25),
      earlier(2, 'payment_pending', 10),
      earlier(3, 'payment_pending', 2),
    ])

    const error = await checkoutError(startCheckout({ payload, input: guestInput, now: NOW }))

    expect(error.status).toBe(409)
    expect(error.message).toContain('3 befejezetlen fizetés')
    expect(error.message).toContain('info@kineticare.hu')
    // A korlátba beleszámító legrégebbi (25 perce indult) 5 perc múlva jár le.
    expect(error.message).toContain('5 perc múlva')
    expect(orders).toHaveLength(3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a bejelentkezett vevőre is érvényes (e-mail szerint)', async () => {
    const { payload } = storePayload([
      earlier(1, 'payment_pending', 5),
      earlier(2, 'payment_pending', 5),
      earlier(3, 'payment_pending', 5),
    ])
    const user = {
      id: 7,
      email: GUEST_EMAIL,
      name: 'Vendég Vevő',
      role: 'customer',
    } as unknown as User

    const error = await checkoutError(startCheckout({ payload, user, input: guestInput, now: NOW }))
    expect(error.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Codex (PR #307): a korlát a vevő összes rendelését számolja, ezért a zárnak
  // is vevőnkéntinek kell lennie. Termékenkénti zár mellett két párhuzamos
  // kérés két különböző kurzusra mindkettő a korlát alatt látná a számot, és
  // mindkettő rendelést és Barion-fizetést indítana.
  it('két párhuzamos kérés ugyanarra a címre, két különböző kurzusra: a korlát nem léphető át', async () => {
    const { payload, orders } = storePayload([
      earlier(1, 'payment_pending', 10),
      earlier(2, 'payment_pending', 5),
    ])

    const results = await Promise.allSettled([
      startCheckout({ payload, input: guestInput, now: NOW }),
      startCheckout({ payload, input: { ...guestInput, productId: 43 }, now: NOW }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find((result) => result.status === 'rejected')
    const reason = (rejected as PromiseRejectedResult).reason as CheckoutError
    expect(reason.status).toBe(409)
    expect(reason.message).toContain('3 befejezetlen fizetés')
    expect(orders.filter((order) => order.status === 'payment_pending')).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a fizetési ablakon túli (lejárt) függő sor nem tartja fogva a vevőt: 2 élő + 1 lejárt → a fizetés indul', async () => {
    const { payload } = storePayload([
      earlier(1, 'payment_pending', 45),
      earlier(2, 'payment_pending', 10),
      earlier(3, 'payment_pending', 2),
    ])

    const result = await startCheckout({ payload, input: guestInput, now: NOW })
    expect(result.gatewayUrl).toContain('Pay?id=')
  })
})

describe('a-checkout-9 — vendég új rendelései e-mail-címenként, óránként', () => {
  it('5 lezárult (kifizetetlen) rendelés az elmúlt órában → 429 a várakozási idővel és a kapcsolati címmel', async () => {
    const { payload, orders } = storePayload([
      earlier(1, 'cancelled', 55),
      earlier(2, 'cancelled', 40),
      earlier(3, 'cancelled', 30),
      earlier(4, 'cancelled', 20),
      earlier(5, 'cancelled', 10),
    ])

    const error = await checkoutError(startCheckout({ payload, input: guestInput, now: NOW }))

    expect(error.status).toBe(429)
    expect(error.message).toContain('info@kineticare.hu')
    // Az 55 perce indult kicsúszik az ablakból 5 perc múlva.
    expect(error.message).toContain('5 perc múlva')
    expect(orders).toHaveLength(5)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('valódi újrapróbálkozás: 4 megszakított fizetés után az ötödik még indul', async () => {
    const { payload } = storePayload([
      earlier(1, 'cancelled', 40),
      earlier(2, 'cancelled', 30),
      earlier(3, 'cancelled', 20),
      earlier(4, 'cancelled', 10),
    ])

    const result = await startCheckout({ payload, input: guestInput, now: NOW })
    expect(result.gatewayUrl).toContain('Pay?id=')
  })

  it.each([
    ['kifizetett', 'paid'],
    ['visszatérített', 'refunded'],
    ['a Barion által elutasított Start (payment_failed)', 'payment_failed'],
  ])('a %s rendelés nem számít bele (5 ilyen után is indul a fizetés)', async (_label, status) => {
    const { payload } = storePayload([1, 2, 3, 4, 5].map((id) => earlier(id, status, 10 * id)))

    const result = await startCheckout({ payload, input: guestInput, now: NOW })
    expect(result.gatewayUrl).toContain('Pay?id=')
  })

  it('az egy óránál régebbi rendelés nem számít bele', async () => {
    const { payload } = storePayload([1, 2, 3, 4, 5].map((id) => earlier(id, 'cancelled', 60 + id)))

    const result = await startCheckout({ payload, input: guestInput, now: NOW })
    expect(result.gatewayUrl).toContain('Pay?id=')
  })

  it('bejelentkezett vevőre az óránkénti vendég-korlát nem vonatkozik', async () => {
    const { payload } = storePayload([1, 2, 3, 4, 5].map((id) => earlier(id, 'cancelled', 5 * id)))
    const user = {
      id: 7,
      email: GUEST_EMAIL,
      name: 'Vendég Vevő',
      role: 'customer',
    } as unknown as User

    const result = await startCheckout({ payload, user, input: guestInput, now: NOW })
    expect(result.gatewayUrl).toContain('Pay?id=')
  })
})

describe('a-checkout-9 — riasztás a vendég-rendelések tömeges növekedésére', () => {
  function otherGuests(count: number): StoredOrder[] {
    return Array.from({ length: count }, (_unused, index) => ({
      id: 100 + index,
      status: 'payment_pending',
      customer: null,
      customerEmail: `mas${index}@example.test`,
      createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
      items: [{ product: 42 }],
    }))
  }

  it(`a küszöb (${CHECKOUT_GUEST_ORDER_BURST_THRESHOLD}) fölött RIASZTÁS, de a vásárlás NEM áll meg; a második már fojtott`, async () => {
    const { payload } = storePayload(otherGuests(CHECKOUT_GUEST_ORDER_BURST_THRESHOLD))
    const { log, errors } = captureLogger()

    const first = await startCheckout({ payload, input: guestInput, now: NOW, logger: log })
    expect(first.gatewayUrl).toContain('Pay?id=')
    const alerts = errors.filter((entry) => entry.message.startsWith('RIASZTÁS:'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toContain('szokatlanul sok új vendég-rendelés')
    expect(alerts[0]?.context).toMatchObject({
      guestOrdersInWindow: CHECKOUT_GUEST_ORDER_BURST_THRESHOLD + 1,
    })

    await startCheckout({
      payload,
      input: { ...guestInput, guest: { email: 'harmadik@example.test', name: 'Harmadik Vevő' } },
      now: NOW,
      logger: log,
    })
    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS:'))).toHaveLength(1)
  })

  it('a küszöbig nincs riasztás', async () => {
    const { payload } = storePayload(otherGuests(CHECKOUT_GUEST_ORDER_BURST_THRESHOLD - 1))
    const { log, errors } = captureLogger()

    await startCheckout({ payload, input: guestInput, now: NOW, logger: log })
    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS:'))).toEqual([])
  })
})
