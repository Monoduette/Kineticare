import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  ACCESS_EXPIRED_TITLE,
  ACCESS_GRANT_PENDING_MESSAGE,
  ACCESS_LOOKUP_FAILED_MESSAGE,
  accessExpiredMessage,
  accessExpiryLabel,
  formatAccessDate,
  MS_PER_DAY,
  resolveCourseAccess,
  resolvePlayerGate,
  toCourseAccessView,
} from '../lib/course-access'
import {
  fetchPurchaseDates,
  PURCHASE_HISTORY_QUERY_LIMIT,
  purchaseDatesFromOrders,
  resolveCourseAccessForUser,
  resolveSingleCourseAccess,
} from '../lib/course-access-lookup'
import type { Order, Product } from '../payload-types'

/**
 * A1 — az accessDurationDays kikényszerítése (szabály + vásárlásidőpont).
 *
 * A hozzáférés-szabály egyetlen forrása az src/lib/course-access.ts tiszta
 * `resolveCourseAccess` függvénye; itt a határeseteit és a vásárlásidőpont-
 * felderítést (course-access-lookup.ts) fedjük le. A felületi megjelenítés
 * tesztje: src/__tests__/course-access-ui.test.ts.
 */

const PURCHASE = '2026-01-01T10:00:00.000Z'
/** PURCHASE + 30 nap — a 30 napos hozzáférés lejárati pillanata. */
const EXPIRY_30 = new Date(new Date(PURCHASE).getTime() + 30 * MS_PER_DAY)

describe('resolveCourseAccess — a korlátlan hozzáférés esetei (mai viselkedés a default)', () => {
  it('hiányzó accessDurationDays (undefined) → korlátlan', () => {
    expect(resolveCourseAccess({ purchasedAt: PURCHASE })).toEqual({
      hasAccess: true,
      expiresAt: null,
      reason: 'unlimited',
    })
  })

  it('üres accessDurationDays (null) → korlátlan', () => {
    expect(resolveCourseAccess({ purchasedAt: PURCHASE, accessDurationDays: null })).toMatchObject({
      hasAccess: true,
      expiresAt: null,
      reason: 'unlimited',
    })
  })

  it('0 nap → korlátlan (NEM azonnali lejárat)', () => {
    expect(resolveCourseAccess({ purchasedAt: PURCHASE, accessDurationDays: 0 })).toMatchObject({
      hasAccess: true,
      expiresAt: null,
      reason: 'unlimited',
    })
  })

  it('negatív nap → korlátlan (hibás adat nem zárhat ki vevőt)', () => {
    expect(resolveCourseAccess({ purchasedAt: PURCHASE, accessDurationDays: -30 })).toMatchObject({
      hasAccess: true,
      reason: 'unlimited',
    })
  })

  it('NaN / Infinity → korlátlan', () => {
    expect(
      resolveCourseAccess({ purchasedAt: PURCHASE, accessDurationDays: Number.NaN }),
    ).toMatchObject({ hasAccess: true, reason: 'unlimited' })
    expect(
      resolveCourseAccess({ purchasedAt: PURCHASE, accessDurationDays: Number.POSITIVE_INFINITY }),
    ).toMatchObject({ hasAccess: true, reason: 'unlimited' })
  })

  it('hiányzó vásárlási időpont (nincs paid rendelés) → korlátlan, fail-open', () => {
    for (const purchasedAt of [undefined, null, '', '   ', 'nem-datum']) {
      expect(resolveCourseAccess({ purchasedAt, accessDurationDays: 365 })).toMatchObject({
        hasAccess: true,
        expiresAt: null,
        reason: 'unknown-purchase-date',
      })
    }
  })

  it('érvénytelen Date-példány → korlátlan, fail-open', () => {
    expect(
      resolveCourseAccess({ purchasedAt: new Date('nem-datum'), accessDurationDays: 365 }),
    ).toMatchObject({ hasAccess: true, reason: 'unknown-purchase-date' })
  })
})

describe('resolveCourseAccess — lejárat-számítás és határesetek', () => {
  it('lejárat = vásárlás + nap × 24 óra', () => {
    const state = resolveCourseAccess({
      purchasedAt: PURCHASE,
      accessDurationDays: 30,
      now: new Date(PURCHASE),
    })
    expect(state.reason).toBe('active')
    expect(state.hasAccess).toBe(true)
    expect(state.expiresAt?.toISOString()).toBe('2026-01-31T10:00:00.000Z')
  })

  it('1 ezredmásodperccel a lejárat ELŐTT → még van hozzáférés', () => {
    const state = resolveCourseAccess({
      purchasedAt: PURCHASE,
      accessDurationDays: 30,
      now: new Date(EXPIRY_30.getTime() - 1),
    })
    expect(state).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it('PONT a lejárat pillanatában → már lejárt', () => {
    const state = resolveCourseAccess({
      purchasedAt: PURCHASE,
      accessDurationDays: 30,
      now: new Date(EXPIRY_30.getTime()),
    })
    expect(state).toMatchObject({ hasAccess: false, reason: 'expired' })
    expect(state.expiresAt?.toISOString()).toBe('2026-01-31T10:00:00.000Z')
  })

  it('a lejárat NAPJÁN, de a lejárat órája előtt → még van hozzáférés', () => {
    expect(
      resolveCourseAccess({
        purchasedAt: PURCHASE,
        accessDurationDays: 30,
        now: new Date('2026-01-31T09:59:59.999Z'),
      }),
    ).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it('a lejárat után → nincs hozzáférés, a lejárat időpontja megmarad', () => {
    const state = resolveCourseAccess({
      purchasedAt: PURCHASE,
      accessDurationDays: 30,
      now: new Date('2026-06-01T00:00:00.000Z'),
    })
    expect(state.hasAccess).toBe(false)
    expect(state.reason).toBe('expired')
    expect(state.expiresAt?.toISOString()).toBe('2026-01-31T10:00:00.000Z')
  })

  it('1 napos hozzáférés: 23:59 után még él, 24:00-kor lejár', () => {
    const base = { purchasedAt: PURCHASE, accessDurationDays: 1 }
    expect(
      resolveCourseAccess({ ...base, now: new Date('2026-01-02T09:59:00.000Z') }),
    ).toMatchObject({ hasAccess: true })
    expect(
      resolveCourseAccess({ ...base, now: new Date('2026-01-02T10:00:00.000Z') }),
    ).toMatchObject({ hasAccess: false })
  })

  it('tört nap is értelmezett (0,5 nap = 12 óra)', () => {
    const state = resolveCourseAccess({
      purchasedAt: PURCHASE,
      accessDurationDays: 0.5,
      now: new Date('2026-01-01T21:59:00.000Z'),
    })
    expect(state.hasAccess).toBe(true)
    expect(state.expiresAt?.toISOString()).toBe('2026-01-01T22:00:00.000Z')
  })

  it('Date-példány és ISO-string bemenet ugyanazt adja', () => {
    const fromString = resolveCourseAccess({
      purchasedAt: PURCHASE,
      accessDurationDays: 30,
      now: new Date(PURCHASE),
    })
    const fromDate = resolveCourseAccess({
      purchasedAt: new Date(PURCHASE),
      accessDurationDays: 30,
      now: new Date(PURCHASE),
    })
    expect(fromDate.expiresAt?.toISOString()).toBe(fromString.expiresAt?.toISOString())
    expect(fromDate.reason).toBe(fromString.reason)
  })

  it('jövőbeli vásárlási időpont (órajel-eltérés) sem zár ki', () => {
    expect(
      resolveCourseAccess({
        purchasedAt: '2027-01-01T00:00:00.000Z',
        accessDurationDays: 1,
        now: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it('a `now` alapértelmezése a valós idő (paraméter nélkül is működik)', () => {
    expect(
      resolveCourseAccess({ purchasedAt: '2000-01-01T00:00:00.000Z', accessDurationDays: 1 }),
    ).toMatchObject({ hasAccess: false, reason: 'expired' })
  })
})

describe('magyar üzenetek és dátumformázás', () => {
  it('a dátum magyar formátumú, Europe/Budapest zónában', () => {
    expect(formatAccessDate(new Date('2027-03-04T12:00:00.000Z'))).toBe('2027. 03. 04.')
    // 23:30 UTC = a következő nap 00:30 Budapesten — a vevő a saját napját látja.
    expect(formatAccessDate(new Date('2027-03-04T23:30:00.000Z'))).toBe('2027. 03. 05.')
  })

  it('a lejárati címke a kurzusaim listához', () => {
    expect(accessExpiryLabel(new Date('2027-03-04T12:00:00.000Z'))).toBe(
      'Hozzáférés eddig: 2027. 03. 04.',
    )
    expect(accessExpiryLabel(null)).toBeNull()
  })

  it('a lejárt hozzáférés üzenete magyar, empatikus, és tartalmazza a lejárat napját', () => {
    const message = accessExpiredMessage(new Date('2027-03-04T12:00:00.000Z'))
    expect(message).toContain(ACCESS_EXPIRED_TITLE)
    expect(message).toContain('2027. 03. 04.')
    expect(message).toContain('újra megvásárolható')
    // Nincs sürgetés/dark pattern a szövegben.
    expect(message).not.toMatch(/most azonnal|csak ma|utolsó esély/i)
  })

  it('ismeretlen lejárat esetén is teljes mondat marad az üzenet', () => {
    expect(accessExpiredMessage(null)).toBe(
      `${ACCESS_EXPIRED_TITLE} Ha szeretnéd folytatni, a kurzus újra megvásárolható.`,
    )
  })

  it('toCourseAccessView: élő hozzáférésnél nincs hibaüzenet, lejártnál nincs címke-hazugság', () => {
    const active = toCourseAccessView(
      resolveCourseAccess({
        purchasedAt: PURCHASE,
        accessDurationDays: 30,
        now: new Date(PURCHASE),
      }),
    )
    expect(active).toEqual({
      hasAccess: true,
      expiryLabel: 'Hozzáférés eddig: 2026. 01. 31.',
      expiredMessage: null,
    })

    const expired = toCourseAccessView(
      resolveCourseAccess({
        purchasedAt: PURCHASE,
        accessDurationDays: 30,
        now: new Date('2026-06-01T00:00:00.000Z'),
      }),
    )
    expect(expired.hasAccess).toBe(false)
    expect(expired.expiredMessage).toContain('2026. 01. 31.')

    const unlimited = toCourseAccessView(resolveCourseAccess({ purchasedAt: PURCHASE }))
    expect(unlimited).toEqual({ hasAccess: true, expiryLabel: null, expiredMessage: null })
  })
})

/** Rendelés-fixtúra: a séma releváns mezői (nincs paidAt — a createdAt a forrás). */
function makeOrder(overrides: {
  id: number
  status: Order['status']
  createdAt: string
  productIds: (number | { id: number })[]
}): Order {
  return {
    id: overrides.id,
    status: overrides.status,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
    items: overrides.productIds.map((product, index) => ({
      id: `sor-${index}`,
      product,
      quantity: 1,
    })),
  } as unknown as Order
}

describe('purchaseDatesFromOrders — mikor vette meg a vevő', () => {
  it('a paid rendelés createdAt-je a vásárlás időpontja', () => {
    const dates = purchaseDatesFromOrders([
      makeOrder({ id: 1, status: 'paid', createdAt: PURCHASE, productIds: [42] }),
    ])
    expect(dates.get(42)).toBe(PURCHASE)
  })

  it('a nem paid rendelések (created/pending/cancelled/failed/refunded) kimaradnak', () => {
    const dates = purchaseDatesFromOrders([
      makeOrder({ id: 1, status: 'created', createdAt: PURCHASE, productIds: [42] }),
      makeOrder({ id: 2, status: 'payment_pending', createdAt: PURCHASE, productIds: [42] }),
      makeOrder({ id: 3, status: 'cancelled', createdAt: PURCHASE, productIds: [42] }),
      makeOrder({ id: 4, status: 'payment_failed', createdAt: PURCHASE, productIds: [42] }),
      makeOrder({ id: 5, status: 'refunded', createdAt: PURCHASE, productIds: [42] }),
    ])
    expect(dates.size).toBe(0)
  })

  it('újravásárláskor a LEGUTOLSÓ paid rendelés számít (a hozzáférés megújul)', () => {
    const older = makeOrder({ id: 1, status: 'paid', createdAt: PURCHASE, productIds: [42] })
    const newer = makeOrder({
      id: 2,
      status: 'paid',
      createdAt: '2026-05-01T08:00:00.000Z',
      productIds: [42],
    })
    // A rendezéstől függetlenül ugyanaz az eredmény (a lekérdezés '-createdAt').
    expect(purchaseDatesFromOrders([older, newer]).get(42)).toBe('2026-05-01T08:00:00.000Z')
    expect(purchaseDatesFromOrders([newer, older]).get(42)).toBe('2026-05-01T08:00:00.000Z')
  })

  it('populate-olt termék (objektum) és nyers id egyaránt feldolgozódik', () => {
    const dates = purchaseDatesFromOrders([
      makeOrder({ id: 1, status: 'paid', createdAt: PURCHASE, productIds: [{ id: 7 }, 9] }),
    ])
    expect(dates.get(7)).toBe(PURCHASE)
    expect(dates.get(9)).toBe(PURCHASE)
  })

  it('hiányzó/érvénytelen createdAt vagy termék nélküli sor nem okoz hibát', () => {
    const broken = {
      id: 1,
      status: 'paid',
      createdAt: 'nem-datum',
      items: [{ id: 'sor-0', product: null, quantity: 1 }],
    } as unknown as Order
    expect(purchaseDatesFromOrders([broken]).size).toBe(0)
    expect(purchaseDatesFromOrders([]).size).toBe(0)
  })
})

interface MockPayloadOptions {
  orders?: Order[]
  findError?: boolean
}

function createMockPayload(options: MockPayloadOptions = {}) {
  const find = vi.fn(async () => {
    if (options.findError === true) {
      throw new Error('adatbázis-hiba')
    }
    return { docs: options.orders ?? [] }
  })
  const findByID = vi.fn(async () => ({ accessGrants: [] }))
  return { payload: { find, findByID } as unknown as Payload, find }
}

function makeProduct(id: number, accessDurationDays?: number | null): Product {
  return { id, sku: `KURZUS-${id}`, accessDurationDays: accessDurationDays ?? null } as Product
}

describe('resolveCourseAccessForUser — Payload-lekérdezéssel', () => {
  it('korlát nélküli termékeknél EL SEM INDUL a rendelés-lekérdezés', async () => {
    const { payload, find } = createMockPayload()

    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [makeProduct(42), makeProduct(43, 0)],
    })

    expect(find).not.toHaveBeenCalled()
    expect(states.get(42)).toMatchObject({ hasAccess: true, reason: 'unlimited' })
    expect(states.get(43)).toMatchObject({ hasAccess: true, reason: 'unlimited' })
  })

  it('érvényes hozzáférés: a paid rendelés dátuma alapján még él', async () => {
    const { payload, find } = createMockPayload({
      orders: [makeOrder({ id: 1, status: 'paid', createdAt: PURCHASE, productIds: [42] })],
    })

    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [makeProduct(42, 30)],
      now: new Date('2026-01-15T00:00:00.000Z'),
    })

    expect(find).toHaveBeenCalledTimes(1)
    expect(states.get(42)).toMatchObject({ hasAccess: true, reason: 'active' })
    // A lekérdezés kizárólag a saját, kifizetett rendeléseket olvassa.
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'orders',
        where: {
          and: [
            { customer: { equals: 7 } },
            { status: { equals: 'paid' } },
            { 'items.product': { in: [42] } },
          ],
        },
      }),
    )
  })

  it('lejárt hozzáférés: a 30 napos kurzus fél év után nem elérhető', async () => {
    const { payload } = createMockPayload({
      orders: [makeOrder({ id: 1, status: 'paid', createdAt: PURCHASE, productIds: [42] })],
    })

    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [makeProduct(42, 30)],
      now: new Date('2026-07-01T00:00:00.000Z'),
    })

    expect(states.get(42)).toMatchObject({ hasAccess: false, reason: 'expired' })
  })

  it('korlátos termék paid rendelés NÉLKÜL (pl. kézzel adott hozzáférés) → korlátlan', async () => {
    const { payload } = createMockPayload({ orders: [] })

    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [makeProduct(42, 30)],
      now: new Date('2030-01-01T00:00:00.000Z'),
    })

    expect(states.get(42)).toMatchObject({ hasAccess: true, reason: 'unknown-purchase-date' })
  })

  it('lekérdezési hiba → a vevő NEM esik ki (fail-open), a hiba naplóba kerül', async () => {
    const { payload } = createMockPayload({ findError: true })
    const warn = vi.fn()
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: vi.fn(),
    }

    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [makeProduct(42, 30)],
      now: new Date('2030-01-01T00:00:00.000Z'),
      logger: log,
    })

    expect(states.get(42)).toMatchObject({ hasAccess: true, reason: 'unknown-purchase-date' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('vásárlási időpontok')
  })

  it('üres terméklistára üres eredmény, lekérdezés nélkül', async () => {
    const { payload, find } = createMockPayload()
    const states = await resolveCourseAccessForUser({ payload, userId: 7, products: [] })
    expect(states.size).toBe(0)
    expect(find).not.toHaveBeenCalled()
  })

  it('fetchPurchaseDates: depth 0, overrideAccess, korlátozott limit, legfrissebb elöl', async () => {
    const { payload, find } = createMockPayload({ orders: [] })
    await fetchPurchaseDates({ payload, userId: 7 })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        depth: 0,
        overrideAccess: true,
        sort: '-createdAt',
        limit: PURCHASE_HISTORY_QUERY_LIMIT,
      }),
    )
  })

  it('resolveSingleCourseAccess: egy termékre ugyanazt a szabályt adja', async () => {
    const { payload } = createMockPayload({
      orders: [makeOrder({ id: 1, status: 'paid', createdAt: PURCHASE, productIds: [42] })],
    })

    const state = await resolveSingleCourseAccess({
      payload,
      userId: 7,
      product: makeProduct(42, 30),
      now: new Date('2026-07-01T00:00:00.000Z'),
    })

    expect(state).toMatchObject({ hasAccess: false, reason: 'expired' })
  })

  it('stream-token ág: lekérdezési hibánál a korlátos kurzus zárva marad (fail-closed)', async () => {
    const { payload } = createMockPayload({ findError: true })
    const warn = vi.fn()
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: vi.fn(),
    }

    const state = await resolveSingleCourseAccess({
      payload,
      userId: 7,
      product: makeProduct(42, 30),
      now: new Date('2026-01-15T00:00:00.000Z'),
      logger: log,
    })

    expect(state).toMatchObject({ hasAccess: false, reason: 'unknown-purchase-date' })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('resolvePlayerGate', () => {
  const expired = resolveCourseAccess({
    purchasedAt: PURCHASE,
    accessDurationDays: 30,
    now: new Date('2026-03-01T00:00:00.000Z'),
  })
  const lookupFailed = {
    hasAccess: false,
    expiresAt: null,
    reason: 'unknown-purchase-date' as const,
  }

  it('megvett + élő hozzáférés → játszható', () => {
    expect(
      resolvePlayerGate({
        purchased: true,
        access: resolveCourseAccess({ purchasedAt: PURCHASE }),
        hasPaidOrder: false,
      }),
    ).toEqual({ hasAccess: true, gate: null })
  })

  it('lookup-hiba nem lejárat', () => {
    expect(
      resolvePlayerGate({ purchased: true, access: lookupFailed, hasPaidOrder: false }),
    ).toEqual({
      hasAccess: false,
      gate: { kind: 'lookup-failed', message: ACCESS_LOOKUP_FAILED_MESSAGE },
    })
    expect(ACCESS_LOOKUP_FAILED_MESSAGE).not.toContain(ACCESS_EXPIRED_TITLE)
  })

  it('lejárt hozzáférés → expired kapu', () => {
    expect(
      resolvePlayerGate({ purchased: true, access: expired, hasPaidOrder: false }),
    ).toMatchObject({
      hasAccess: false,
      gate: { kind: 'expired' },
    })
  })

  it('paid rendelés purchases nélkül → grant-pending, nem vásárlási kapu', () => {
    expect(resolvePlayerGate({ purchased: false, access: null, hasPaidOrder: true })).toEqual({
      hasAccess: false,
      gate: { kind: 'grant-pending', message: ACCESS_GRANT_PENDING_MESSAGE },
    })
  })

  it('nincs vásárlás → not-purchased', () => {
    expect(resolvePlayerGate({ purchased: false, access: null, hasPaidOrder: false })).toEqual({
      hasAccess: false,
      gate: { kind: 'not-purchased', message: null },
    })
  })
})
