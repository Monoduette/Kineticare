import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  ACCESS_GRANT_BACKFILL_LAPMERET,
  formazdAccessGrantJelentest,
  futtatAccessGrantBackfill,
  paidDatesByCustomer,
  parseMaxKapcsolo,
  productIdsFromPurchases,
  tervezzAccessGrantBackfill,
  type AccessGrantBackfillProductDoc,
  type AccessGrantBackfillUserDoc,
} from '../lib/access-grants-backfill'
import type { Order } from '../payload-types'

/**
 * accessGrants backfill mérése (src/lib/access-grants-backfill.ts).
 *
 * Nincs DB, nincs hálózat: memóriabeli fixtúra + injektált Payload-mock.
 * A mért tulajdonságok:
 *  (a) paid dátum + időkorlátos purchase + hiányzó grant → írás,
 *  (b) meglévő grant SOSEM íródik felül,
 *  (c) paid dátum nélkül KIHAGYÁS (nem mai nap, nem user.createdAt),
 *  (d) korlátlan SKU kimarad,
 *  (e) dry-runban 0 `payload.update`,
 *  (f) a script SOSEM a termék MAI árából dolgozik (forrás-őr).
 */

const PAID = '2024-03-01T10:00:00.000Z'

function order(reszlet: {
  id: number
  customer: number
  createdAt: string
  productId: number
  status?: Order['status']
}): Order {
  return {
    id: reszlet.id,
    status: reszlet.status ?? 'paid',
    createdAt: reszlet.createdAt,
    customer: reszlet.customer,
    items: [{ product: reszlet.productId, quantity: 1 }],
  } as Order
}

function keszitsPayloadMockot(input: {
  products: readonly AccessGrantBackfillProductDoc[]
  orders: readonly Order[]
  users: readonly AccessGrantBackfillUserDoc[]
}) {
  const find = vi.fn(
    async (args: {
      collection: string
      page?: number
      limit?: number
      where?: { and?: Array<{ id?: { in?: number[] } }> }
    }) => {
      let forras =
        args.collection === 'products'
          ? input.products
          : args.collection === 'orders'
            ? input.orders
            : input.users
      const selectedIds = args.where?.and?.find((clause) => clause.id)?.id?.in
      if (selectedIds) forras = forras.filter((doc) => selectedIds.includes(doc.id))
      const limit = args.limit ?? ACCESS_GRANT_BACKFILL_LAPMERET
      const page = args.page ?? 1
      const kezdet = (page - 1) * limit
      const docs = forras.slice(kezdet, kezdet + limit)
      return {
        docs,
        hasNextPage: kezdet + limit < forras.length,
        totalDocs: forras.length,
      }
    },
  )
  const findByID = vi.fn(async (args: { id: number }) => {
    return input.users.find((user) => user.id === args.id) ?? null
  })
  const update = vi.fn(async () => ({}))
  return { find, findByID, update }
}

describe('productIdsFromPurchases', () => {
  it('számot és { id } alakot is elfogad, deduplikál', () => {
    expect(productIdsFromPurchases([3, { id: 3 }, { id: 7 }, 'x', null])).toEqual([3, 7])
  })

  it('nem tömb → üres', () => {
    expect(productIdsFromPurchases(null)).toEqual([])
    expect(productIdsFromPurchases(undefined)).toEqual([])
  })
})

describe('paidDatesByCustomer', () => {
  it('vevőnként a legutolsó paid createdAt-et tartja', () => {
    const map = paidDatesByCustomer([
      order({ id: 1, customer: 10, createdAt: '2024-01-01T00:00:00.000Z', productId: 5 }),
      order({ id: 2, customer: 10, createdAt: '2024-06-01T00:00:00.000Z', productId: 5 }),
      order({
        id: 3,
        customer: 10,
        createdAt: '2025-01-01T00:00:00.000Z',
        productId: 5,
        status: 'refunded',
      }),
      order({ id: 4, customer: 11, createdAt: PAID, productId: 8 }),
    ])

    expect(map.get(10)?.get(5)).toBe('2024-06-01T00:00:00.000Z')
    expect(map.get(11)?.get(8)).toBe(PAID)
  })
})

describe('tervezzAccessGrantBackfill', () => {
  const limited = new Set([42])

  it('időkorlátos purchase + paid dátum + nincs grant → írás a paid dátummal', () => {
    expect(
      tervezzAccessGrantBackfill({
        purchases: [42],
        accessGrants: [],
        limitedProductIds: limited,
        paidSources: new Map([[42, { grantedAt: PAID, sourceOrder: 1 }]]),
      }),
    ).toEqual([{ dontes: 'ir', productId: 42, grantedAt: PAID, sourceOrder: 1 }])
  })

  it('meglévő grantot nem ír felül', () => {
    expect(
      tervezzAccessGrantBackfill({
        purchases: [42],
        accessGrants: [{ product: 42, grantedAt: '2020-01-01T00:00:00.000Z' }],
        limitedProductIds: limited,
        paidSources: new Map([[42, { grantedAt: PAID, sourceOrder: 1 }]]),
      }),
    ).toEqual([])
  })

  it('paid dátum nélkül kihagy — nem találgat', () => {
    const terv = tervezzAccessGrantBackfill({
      purchases: [42],
      accessGrants: [],
      limitedProductIds: limited,
      paidSources: new Map(),
    })

    expect(terv).toHaveLength(1)
    expect(terv[0]).toMatchObject({ dontes: 'kihagy', productId: 42, indok: 'nincs-paid-datum' })
    expect(terv[0]?.dontes === 'kihagy' && terv[0].reszlet).not.toMatch(/today|Date\.now/i)
  })

  it('korlátlan SKU (nincs a limited halmazban) kimarad', () => {
    expect(
      tervezzAccessGrantBackfill({
        purchases: [99],
        accessGrants: [],
        limitedProductIds: limited,
        paidSources: new Map([[99, { grantedAt: PAID, sourceOrder: 1 }]]),
      }),
    ).toEqual([])
  })
})

describe('futtatAccessGrantBackfill', () => {
  const identityLock = async (
    _payload: unknown,
    _userId: number,
    fn: () => Promise<void>,
  ): Promise<void> => {
    await fn()
  }

  it('records the exact latest paid source order without relabeling other legacy rows', async () => {
    const retained = { id: 'DUMMY-legacy', product: 99, grantedAt: PAID }
    const payload = keszitsPayloadMockot({
      products: [{ id: 42, accessDurationDays: 365 }],
      orders: [
        order({ id: 1, customer: 7, createdAt: '2020-01-01T00:00:00.000Z', productId: 42 }),
        order({ id: 2, customer: 7, createdAt: PAID, productId: 42 }),
      ],
      users: [{ id: 7, purchases: [42, 99], accessGrants: [retained] }],
    })
    await futtatAccessGrantBackfill({
      payload: payload as never,
      dryRun: false,
      withLock: identityLock,
    })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          accessGrants: [
            retained,
            { product: 42, grantedAt: PAID, sourceKind: 'order', sourceOrder: 2 },
          ],
        },
      }),
    )
  })

  it('never replaces a malformed persisted grant array', async () => {
    const payload = keszitsPayloadMockot({
      products: [{ id: 42, accessDurationDays: 365 }],
      orders: [order({ id: 1, customer: 7, createdAt: PAID, productId: 42 })],
      users: [{ id: 7, purchases: [42], accessGrants: { invalid: true } }],
    })
    const result = await futtatAccessGrantBackfill({
      payload: payload as never,
      dryRun: false,
      withLock: identityLock,
    })
    expect(payload.update).not.toHaveBeenCalled()
    expect(result.irasHibak).toHaveLength(1)
  })

  it('próbafutásban nulla payload.update', async () => {
    const payload = keszitsPayloadMockot({
      products: [{ id: 42, accessDurationDays: 365 }],
      orders: [order({ id: 1, customer: 7, createdAt: PAID, productId: 42 })],
      users: [{ id: 7, email: 'vevo@example.test', purchases: [42], accessGrants: [] }],
    })

    const jelentes = await futtatAccessGrantBackfill({
      payload: payload as never,
      dryRun: true,
      withLock: identityLock,
    })

    expect(payload.update).not.toHaveBeenCalled()
    expect(jelentes.dryRun).toBe(true)
    expect(jelentes.irasok).toBe(1)
    expect(jelentes.erintettFelhasznalok).toBe(1)
    expect(formazdAccessGrantJelentest(jelentes).join('\n')).toMatch(/PRÓBAFUTÁS/)
  })

  it('éles futásban a paid dátumot írja, nem a mostani időt', async () => {
    const payload = keszitsPayloadMockot({
      products: [{ id: 42, accessDurationDays: 365 }],
      orders: [order({ id: 1, customer: 7, createdAt: PAID, productId: 42 })],
      users: [{ id: 7, email: 'vevo@example.test', purchases: [42], accessGrants: [] }],
    })

    await futtatAccessGrantBackfill({
      payload: payload as never,
      dryRun: false,
      withLock: identityLock,
    })

    expect(payload.update).toHaveBeenCalledTimes(1)
    const elsoHivas = payload.update.mock.calls[0] as unknown as
      | [
          {
            collection: string
            id: number
            data: { accessGrants: { product: number; grantedAt: string }[] }
          },
        ]
      | undefined
    const iras = elsoHivas?.[0]
    expect(iras).toBeDefined()
    expect(iras?.collection).toBe('users')
    expect(iras?.id).toBe(7)
    expect(iras?.data.accessGrants).toEqual([
      { product: 42, grantedAt: PAID, sourceKind: 'order', sourceOrder: 1 },
    ])
  })

  it('paid nélküli időkorlátos purchase-t jelent, nem ír', async () => {
    const payload = keszitsPayloadMockot({
      products: [{ id: 42, accessDurationDays: 30 }],
      orders: [],
      users: [{ id: 9, email: 'nincs@example.test', purchases: [42], accessGrants: [] }],
    })

    const jelentes = await futtatAccessGrantBackfill({
      payload: payload as never,
      dryRun: false,
      withLock: identityLock,
    })

    expect(payload.update).not.toHaveBeenCalled()
    expect(jelentes.irasok).toBe(0)
    expect(jelentes.kihagyottak).toHaveLength(1)
    expect(jelentes.kihagyottak[0]?.indok).toBe('nincs-paid-datum')
  })
})

describe('parseMaxKapcsolo', () => {
  it('érvényes --max= felülír, hibás érték az alap', () => {
    expect(parseMaxKapcsolo(['--max=50'], 20_000)).toBe(50)
    expect(parseMaxKapcsolo(['--max=alma'], 20_000)).toBe(20_000)
    expect(parseMaxKapcsolo([], 20_000)).toBe(20_000)
  })
})

describe('forrás-őr', () => {
  it('a planner nem olvassa a termék mai árát', () => {
    const forras = readFileSync(
      fileURLToPath(new URL('../lib/access-grants-backfill.ts', import.meta.url)),
      'utf8',
    )
    expect(forras).not.toMatch(/priceInHUF\s*[=.]/)
    expect(forras).toMatch(/SOHA/)
    expect(forras).toMatch(/priceInHUF/)
  })
})
