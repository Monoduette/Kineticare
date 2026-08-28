import type { Payload } from 'payload'
import { describe, expect, it, vi, type MockInstance } from 'vitest'

import type { BarionPaymentStateResponse, OrderPaymentState } from '../../lib/barion'
import { createLogger } from '../../lib/logger'
import {
  applyBarionStateTransition,
  assertPaymentAmountMatches,
  hasPaidOrderFor,
  shouldBlockSecondPaidOrder,
} from '../../lib/order-status/apply-barion-state'
import type { Order, User } from '../../payload-types'

/**
 * S2 — ÖSSZEG-ASSERT az állapotgép KÖZÖS MAGJÁN.
 *
 * A Barion `Succeeded` státusz csak annyit jelent, hogy „valamilyen fizetés
 * sikerült"; azt nem, hogy MENNYI és MILYEN devizában. A PaymentId nem titok
 * (a vevő látja a saját redirect-URL-jében), a callback-payload pedig önmagában
 * nem bizonyíték — ezért a paid-átmenet előtt a GetState Total/Currency mezőjét
 * a rendelés SZERVER-OLDALI snapshotjához (totalHufSnapshot + currency) mérjük.
 *
 * A négy vizsgált eset: egyezés → paid; Total-eltérés → rejected;
 * Currency-eltérés → rejected; hiányzó érték → rejected (konzervatív).
 */

const ORDER_TOTAL_HUF = 19990
const PRODUCT_ID = 42
const CUSTOMER_ID = 7

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 101,
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
  order: Order,
  existingOrders: Array<{ id: number; customer: number; product: number; status: string }> = [],
  product: { id: number; accessDurationDays?: number | null } = { id: PRODUCT_ID },
) {
  const user = {
    id: CUSTOMER_ID,
    email: 'vevo@example.test',
    purchases: [] as number[],
  } as unknown as User
  const updates: Array<{ collection: string; data: Record<string, unknown> }> = []
  const payload = {
    // Az M5 zár a záron belül findByID-val OLVASSA ÚJRA a rendelést — a mock
    // ezért collection-tudatos: 'orders'-re a teszt rendelése, 'users'-re a vevő,
    // 'products'-re a K5 megújítás-őr terméke.
    findByID: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'orders') {
        return order
      }
      if (collection === 'products') {
        return product
      }
      return user
    }),
    // A hasPaidOrderFor (K5) where-kiértékelése a fixtúrákon — a valódi szűrés mása.
    find: vi.fn(
      async ({ where }: { where: { and: Array<Record<string, Record<string, unknown>>> } }) => {
        const clauses = where.and ?? []
        const customerId = clauses.find((clause) => 'customer' in clause)?.customer.equals
        const productIds = (clauses.find((clause) => 'items.product' in clause)?.['items.product']
          .in ?? []) as number[]
        const status = clauses.find((clause) => 'status' in clause)?.status.equals
        const excludeId = clauses.find((clause) => 'id' in clause)?.id.not_equals
        const docs = existingOrders.filter(
          (order) =>
            order.customer === customerId &&
            productIds.includes(order.product) &&
            order.status === status &&
            order.id !== excludeId,
        )
        return { docs, totalDocs: docs.length }
      },
    ),
    update: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      updates.push({ collection: args.collection, data: args.data })
      if (args.collection === 'users') {
        Object.assign(user, args.data)
      }
      if (args.collection === 'orders') {
        Object.assign(order, args.data)
      }
      return args.data
    }),
  }
  return { payload: payload as unknown as Payload, updates, user }
}

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

describe('assertPaymentAmountMatches — a tiszta összeg-ellenőrző', () => {
  it('egyezés (azonos Total és Currency) → ok', () => {
    expect(assertPaymentAmountMatches(createOrder(), createState())).toMatchObject({ ok: true })
  })

  it('kisebb Total → total-differs', () => {
    expect(assertPaymentAmountMatches(createOrder(), createState({ Total: 1 }))).toMatchObject({
      ok: false,
      detail: 'total-differs',
      expectedTotal: ORDER_TOTAL_HUF,
      actualTotal: 1,
    })
  })

  it('eltérő deviza → currency-differs (az összeg-egyezés önmagában NEM elég)', () => {
    expect(
      assertPaymentAmountMatches(createOrder(), createState({ Currency: 'EUR' })),
    ).toMatchObject({ ok: false, detail: 'currency-differs' })
  })

  it('a deviza összehasonlítása kis-nagybetű- és szóköz-tűrő', () => {
    expect(
      assertPaymentAmountMatches(createOrder(), createState({ Currency: ' huf ' })),
    ).toMatchObject({ ok: true })
  })

  it.each([
    ['hiányzó Total a válaszban', { Total: undefined }, 'state-total-missing'],
    ['hiányzó Currency a válaszban', { Currency: undefined }, 'state-currency-missing'],
  ])('%s → konzervatív bukás (%s)', (_label, overrides, detail) => {
    expect(
      assertPaymentAmountMatches(
        createOrder(),
        createState(overrides as Partial<BarionPaymentStateResponse>),
      ),
    ).toMatchObject({ ok: false, detail })
  })

  it.each([
    ['hiányzó totalHufSnapshot', { totalHufSnapshot: null }, 'order-total-missing'],
    ['hiányzó currency', { currency: null }, 'order-currency-missing'],
  ])('a rendelés oldalán %s → konzervatív bukás (%s)', (_label, overrides, detail) => {
    expect(
      assertPaymentAmountMatches(createOrder(overrides as Partial<Order>), createState()),
    ).toMatchObject({ ok: false, detail })
  })
})

describe('applyBarionStateTransition — paid-átmenet összeg-assert', () => {
  it('(1) EGYEZÉS → paid: státusz-írás + purchases-jogosultság + transitionedToPaid', async () => {
    const order = createOrder()
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toMatchObject({ action: 'paid', transitionedToPaid: true, purchasesGranted: 1 })
    expect(updates.filter((entry) => entry.collection === 'orders')).toEqual([
      { collection: 'orders', data: { status: 'paid' } },
    ])
    expect(user.purchases).toEqual([PRODUCT_ID])
  })

  it('(2) TOTAL-ELTÉRÉS → rejected/total-mismatch: se státusz, se jogosultság, riasztás', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState({ Total: 1 }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'total-mismatch' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
    const logs = logOutput(logSpy)
    expect(logs).toContain('RIASZT')
    expect(logs).toContain('total-differs')
    logSpy.mockRestore()
  })

  it('(3) CURRENCY-ELTÉRÉS → rejected/total-mismatch (azonos szám, más deviza)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState({ Currency: 'EUR' }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'total-mismatch' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
    expect(logOutput(logSpy)).toContain('currency-differs')
    logSpy.mockRestore()
  })

  it('(4) HIÁNYZÓ Total/Currency → rejected/total-mismatch (konzervatív elutasítás)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState({ Total: undefined, Currency: undefined }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'total-mismatch' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
    expect(logOutput(logSpy)).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('MÁR paid rendelés + eltérő Total → a jogosultság-kijavítás sem fut le', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder({ status: 'paid' })
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState({ Total: 1 }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'total-mismatch' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
    logSpy.mockRestore()
  })

  it('a cancelled és a pending ág NEM függ az összegtől (csak a paid-átmenet védett)', async () => {
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)

    const pending = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'payment_pending',
      state: createState({ Total: undefined, Currency: undefined, Status: 'Started' }),
      log: createLogger(),
    })
    expect(pending).toEqual({ action: 'pending' })

    const cancelled = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'cancelled',
      state: createState({ Total: undefined, Currency: undefined, Status: 'Canceled' }),
      log: createLogger(),
    })
    expect(cancelled).toEqual({ action: 'cancelled' })
    expect(updates).toEqual([{ collection: 'orders', data: { status: 'cancelled' } }])
  })
})

/**
 * K5 — DUPLA-FIZETÉS BLOKK a paid-átmenet közös pontján (hasPaidOrderFor).
 * A checkout duplavásárlás-blokkja csak szűk ablakban véd (paid VAGY aktív
 * payment_pending a Barion-ablakon belül). Elveszett callback + lejárt ablak
 * után a vevő második rendelést indíthat, és ha mindkét fizetés sikeres a
 * Barionnál, mindkét rendelés paid-re mehetett — dupla terhelés. A második
 */
describe('applyBarionStateTransition — K5 dupla-fizetés blokk', () => {
  it('MÁS paid rendelés ugyanarra a vevő+termékre → rejected/duplicate-paid-order (se státusz, se jogosultság)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { payload, updates, user } = createMockPayload(createOrder(), [
      { id: 202, customer: CUSTOMER_ID, product: PRODUCT_ID, status: 'paid' },
    ])

    const result = await applyBarionStateTransition({
      payload,
      order: createOrder(), // id: 101, payment_pending
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'duplicate-paid-order' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
    expect(logOutput(logSpy)).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('lejárt időkorlátos hozzáférés + más paid → megújítás ENGEDÉLYEZETT (R-01)', async () => {
    const { payload, updates, user } = createMockPayload(
      createOrder(),
      [{ id: 202, customer: CUSTOMER_ID, product: PRODUCT_ID, status: 'paid' }],
      { id: PRODUCT_ID, accessDurationDays: 365 },
    )

    const result = await applyBarionStateTransition({
      payload,
      order: createOrder(),
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
      resolveSingleCourseAccess: async () => ({
        hasAccess: false,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        reason: 'expired',
      }),
    })

    expect(result).toMatchObject({ action: 'paid', transitionedToPaid: true })
    expect(updates.filter((entry) => entry.collection === 'orders')).toEqual([
      { collection: 'orders', data: { status: 'paid' } },
    ])
    expect(user.purchases).toEqual([PRODUCT_ID])
  })

  it('élő időkorlátos hozzáférés + más paid → továbbra is rejected', async () => {
    const { payload, updates, user } = createMockPayload(
      createOrder(),
      [{ id: 202, customer: CUSTOMER_ID, product: PRODUCT_ID, status: 'paid' }],
      { id: PRODUCT_ID, accessDurationDays: 365 },
    )

    const result = await applyBarionStateTransition({
      payload,
      order: createOrder(),
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
      resolveSingleCourseAccess: async () => ({
        hasAccess: true,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        reason: 'active',
      }),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'duplicate-paid-order' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
  })

  it('MÁS termékre (vagy más vevőre) paid rendelés → az átmenet ENGEDÉLYEZETT', async () => {
    const { payload, updates, user } = createMockPayload(createOrder(), [
      { id: 202, customer: CUSTOMER_ID, product: 99, status: 'paid' }, // más termék
      { id: 303, customer: 8, product: PRODUCT_ID, status: 'paid' }, // más vevő
    ])

    const result = await applyBarionStateTransition({
      payload,
      order: createOrder(),
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toMatchObject({ action: 'paid', transitionedToPaid: true })
    expect(updates.filter((entry) => entry.collection === 'orders')).toEqual([
      { collection: 'orders', data: { status: 'paid' } },
    ])
    expect(user.purchases).toEqual([PRODUCT_ID])
  })

  it('a MÁR paid rendelés no-op ága NEM érintett: a jogosultság-javítás akkor is lefut, ha közben más paid rendelés is van', async () => {
    const { payload, user } = createMockPayload(createOrder({ status: 'paid' }), [
      { id: 202, customer: CUSTOMER_ID, product: PRODUCT_ID, status: 'paid' },
    ])

    const result = await applyBarionStateTransition({
      payload,
      order: createOrder({ status: 'paid' }),
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toMatchObject({ action: 'paid', duplicate: true, transitionedToPaid: false })
    expect(user.purchases).toEqual([PRODUCT_ID])
  })

  it('hasPaidOrderFor: üres terméklista → false (lekérdezés nélkül is biztonságos)', async () => {
    const { payload } = createMockPayload(createOrder())

    await expect(
      hasPaidOrderFor(payload, { customerId: CUSTOMER_ID, productIds: [], excludeOrderId: 101 }),
    ).resolves.toBe(false)
  })

  it('shouldBlockSecondPaidOrder: nincs más paid → false', async () => {
    const { payload } = createMockPayload(createOrder())
    await expect(
      shouldBlockSecondPaidOrder({
        payload,
        customerId: CUSTOMER_ID,
        productIds: [PRODUCT_ID],
        excludeOrderId: 101,
        log: createLogger(),
      }),
    ).resolves.toBe(false)
  })
})

/**
 * K1 — ÍRÁSI SORREND a paid-átmenetben (jogosultság ELŐBB, státusz UTÁNA).
 * Fordított sorrendben a két írás közötti megszakadás (grant-hiba, crash)
 * VÉGLEGESEN elnyelte a paid-átmenet mellékhatásait: a rendelés már `paid`
 * volt, tehát az újrapróbáláskor `alreadyPaid === true` → `transitionedToPaid:
 * false` → az onOrderPaid (számla + visszaigazoló/aktiváló e-mail) SOHA nem
 */
describe('applyBarionStateTransition — K1 írási sorrend', () => {
  it('a jogosultság-beírás MEGELŐZI a paid státusz-írást', async () => {
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)

    await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(updates.map((entry) => entry.collection)).toEqual(['users', 'orders'])
  })

  it('a grant elhasalása után az újrapróbálás FRISS paid-átmenet (a levél pontosan egyszer megy ki)', async () => {
    const order = createOrder()
    const base = createMockPayload(order)
    let grantFails = true
    const payload = {
      ...(base.payload as unknown as Record<string, unknown>),
      update: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
        if (args.collection === 'users' && grantFails) {
          throw new Error('teszt: a jogosultság-beírás elhasal (DB-hiba)')
        }
        return (base.payload as unknown as { update: (a: unknown) => Promise<unknown> }).update(
          args,
        )
      }),
    } as unknown as Parameters<typeof applyBarionStateTransition>[0]['payload']

    // 1. kísérlet: a grant dob → a rendelés NEM lehet paid (különben a
    //    mellékhatások örökre elvesznének).
    await expect(
      applyBarionStateTransition({
        payload,
        order,
        mapped: 'paid',
        state: createState(),
        log: createLogger(),
      }),
    ).rejects.toThrow()
    expect(order.status).toBe('payment_pending')
    expect(base.updates.filter((entry) => entry.collection === 'orders')).toHaveLength(0)

    // 2. kísérlet (callback-retry vagy order-poll): most már végigmegy, és a
    //    transitionedToPaid IGAZ — az onOrderPaid tehát pontosan egyszer fut.
    grantFails = false
    const retry = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(retry).toMatchObject({ action: 'paid', transitionedToPaid: true, duplicate: false })
    expect(order.status).toBe('paid')
    expect(base.user.purchases).toEqual([PRODUCT_ID])
  })
})

// ---------------------------------------------------------------------------
// Vendég-rendelés paid-átmenete (a fiók a fizetés UTÁN dől el)
// ---------------------------------------------------------------------------

/**
 * A vendég-rendelésen a `customer` ÜRES, a kapocs a `customerEmail`. A
 * paid-átmenetnek ezért előbb fel kell oldania a fiókot (megtalálás vagy
 * létrehozás), különben a jogosultság-beírás vevő nélkül maradna — pénz
 * levonva, kurzus sehol.
 *
 * A fiók-feloldás saját, részletes tesztje: resolve-order-customer.test.ts.
 * Itt a MAGBA KÖTÉST igazoljuk: a rendelés a fiókhoz kötődik, a jogosultság
 * beíródik, és az eredmény hordozza a levél-változathoz szükséges jelzőt.
 */
function createGuestMockPayload() {
  const order = createOrder({
    customer: null,
    customerEmail: 'vendeg@example.test',
  } as Partial<Order>)
  const users: Array<Record<string, unknown>> = [
    { id: 1, email: 'tulaj@example.test', name: 'Tulajdonos', role: 'owner', purchases: [] },
  ]
  let nextId = 2
  const updates: Array<{ collection: string; id: unknown; data: Record<string, unknown> }> = []
  const payload = {
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: number }) =>
      collection === 'orders' ? order : users.find((user) => user.id === id),
    ),
    find: vi.fn(async (args: { collection: string; where?: unknown }) => {
      if (args.collection === 'users') {
        const wanted = (args.where as { email?: { equals?: string } } | undefined)?.email?.equals
        const docs = users.filter((user) => user.email === wanted)
        return { docs, totalDocs: docs.length }
      }
      // Nincs másik paid rendelés (K5).
      return { docs: [], totalDocs: 0 }
    }),
    count: vi.fn(async () => ({ totalDocs: users.length })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const user = { ...data, id: nextId, purchases: [] }
      nextId += 1
      users.push(user)
      return user
    }),
    update: vi.fn(
      async (args: { collection: string; id: unknown; data: Record<string, unknown> }) => {
        updates.push(args)
        if (args.collection === 'orders') {
          Object.assign(order, args.data)
        }
        if (args.collection === 'users') {
          const user = users.find((entry) => entry.id === args.id)
          Object.assign(user ?? {}, args.data)
        }
        return args.data
      },
    ),
  }
  return { payload: payload as unknown as Payload, order, users, updates }
}

describe('applyBarionStateTransition — vendég-rendelés (fiók nélküli) paid-átmenete', () => {
  it('feloldja (létrehozza) a fiókot, hozzáköti a rendelést és beírja a jogosultságot', async () => {
    const { payload, order, users, updates } = createGuestMockPayload()

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger({ module: 'teszt' }),
    })

    expect(result).toMatchObject({ action: 'paid', transitionedToPaid: true, purchasesGranted: 1 })
    // A levél-változathoz szükséges jelzők (most létrehozott, jelszó nélküli fiók).
    expect(result.customer).toMatchObject({
      created: true,
      alreadyLinked: false,
      passwordSetupPending: true,
      email: 'vendeg@example.test',
    })
    // Új, customer szerepkörű fiók.
    expect(users).toHaveLength(2)
    expect(users[1]).toMatchObject({ email: 'vendeg@example.test', role: 'customer' })
    // A rendelés a fiókhoz kötve, és paid lett.
    expect(
      updates
        .filter((update) => update.collection === 'orders')
        .map((update) => ({ id: update.id, data: update.data })),
    ).toEqual([
      { id: 101, data: { customer: users[1].id } },
      { id: 101, data: { status: 'paid' } },
    ])
    // A jogosultság a FELOLDOTT fiókra íródott.
    const userUpdate = updates.find((update) => update.collection === 'users')
    expect(userUpdate).toMatchObject({ id: users[1].id, data: { purchases: [PRODUCT_ID] } })
  })

  it('aktivált customer e-mail: KÖT, paid, nincs új fiók', async () => {
    const { payload, order, users, updates } = createGuestMockPayload()
    users.push({
      id: 8,
      email: 'vendeg@example.test',
      name: 'Meglévő Vevő',
      role: 'customer',
      passwordSetupPending: false,
      purchases: [],
    })

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger({ module: 'teszt' }),
    })

    expect(result).toMatchObject({
      action: 'paid',
      transitionedToPaid: true,
      purchasesGranted: 1,
      customer: {
        userId: 8,
        created: false,
        alreadyLinked: false,
        passwordSetupPending: false,
        email: 'vendeg@example.test',
      },
    })
    expect(users.filter((user) => user.email === 'vendeg@example.test')).toHaveLength(1)
    expect(order.customer).toBe(8)
    expect(order.status).toBe('paid')
    const userUpdate = updates.find((update) => update.collection === 'users')
    expect(userUpdate).toMatchObject({ id: 8, data: { purchases: [PRODUCT_ID] } })
  })

  it('staff e-mail: rejected guest-bind-privileged-account, nincs kötés, nincs paid', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { payload, order, users, updates } = createGuestMockPayload()
    users.push({
      id: 3,
      email: 'vendeg@example.test',
      name: 'Munkatárs',
      role: 'staff',
      passwordSetupPending: false,
      purchases: [],
    })

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger({ module: 'teszt' }),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'guest-bind-privileged-account' })
    expect(result.transitionedToPaid).toBeUndefined()
    expect(order.status).toBe('payment_pending')
    expect(order.customer).toBeNull()
    expect(updates).toHaveLength(0)
    expect(users[1]).toMatchObject({ role: 'staff', purchases: [] })
    const output = logOutput(logSpy)
    expect(output).toContain('RIASZT')
    // A riasztás címzettje maszkolt. A nyers cím a zárkulcs warnban
    // (advisory-lock, már meglévő) megjelenhet — azt itt nem vizsgáljuk.
    expect(output).toContain('"cimzett":"v***@example.test"')
    expect(output).not.toMatch(/"cimzett":"vendeg@example\.test"/)
    logSpy.mockRestore()
  })
})

/**
 * K6 — a paid ág NEM `else`. Egy negyedik mapped állapot (pl. a dokumentált
 * `payment_failed`) hamisan paid-nek jelölné a sikertelen fizetést.
 */
describe('applyBarionStateTransition — K6 exhaustiveness (paid nem else)', () => {
  it('negyedik mapped állapot NEM produkál action:paid / transitionedToPaid — dob', async () => {
    const order = createOrder()
    const { payload, updates, user } = createMockPayload(order)
    const unknownMapped = 'payment_failed' as OrderPaymentState

    await expect(
      applyBarionStateTransition({
        payload,
        order,
        mapped: unknownMapped,
        state: createState(),
        log: createLogger(),
      }),
    ).rejects.toThrow(/ismeretlen Barion-leképezett állapot/)

    expect(updates.filter((entry) => entry.collection === 'orders')).toHaveLength(0)
    expect(user.purchases).toEqual([])
  })
})

/**
 * W20 — a `paid-not-allowed` és `cancel-not-allowed` reject okoknak legyen tesztjük.
 */
describe('applyBarionStateTransition — W20 reject okok', () => {
  it('refunded rendelés + Succeeded → paid-not-allowed, onOrderPaid NEM triggerelődik', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder({ status: 'refunded' })
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'paid-not-allowed' })
    expect(result.transitionedToPaid).toBeUndefined()
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
    expect(logOutput(logSpy)).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('cancelled rendelés + Succeeded → paid-not-allowed (nincs visszaállítás paid-re)', async () => {
    const order = createOrder({ status: 'cancelled' })
    const { payload, updates, user } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'paid-not-allowed' })
    expect(updates).toHaveLength(0)
    expect(user.purchases).toEqual([])
  })

  it('payment_failed rendelés + Succeeded → paid-not-allowed', async () => {
    const order = createOrder({ status: 'payment_failed' })
    const { payload, updates } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'paid',
      state: createState(),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'paid-not-allowed' })
    expect(updates).toHaveLength(0)
  })

  it('refunded rendelés + Failed/Expired (cancelled) → cancel-not-allowed', async () => {
    const order = createOrder({ status: 'refunded' })
    const { payload, updates } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'cancelled',
      state: createState({ Status: 'Expired' }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'cancel-not-allowed' })
    expect(updates).toHaveLength(0)
    expect(order.status).toBe('refunded')
  })

  it('payment_failed rendelés + Failed (cancelled) → cancel-not-allowed', async () => {
    const order = createOrder({ status: 'payment_failed' })
    const { payload, updates } = createMockPayload(order)

    const result = await applyBarionStateTransition({
      payload,
      order,
      mapped: 'cancelled',
      state: createState({ Status: 'Failed' }),
      log: createLogger(),
    })

    expect(result).toEqual({ action: 'rejected', reason: 'cancel-not-allowed' })
    expect(updates).toHaveLength(0)
  })
})
