import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { grantPurchase } from '../lib/grant-purchase'
import type { Logger } from '../lib/logger'

/**
 * Manuális kurzus-hozzáférés (grant) — a közös szolgáltatás egységtesztjei.
 *
 * A Payload local API mockolva (a refund.test.ts / barion-callback.test.ts
 * mintája). A teszt a kimeneti ágakat és az idempotenciát fedi: a
 * szolgáltatás csak hiányzó terméknél ír, lejárt időkorlátos hozzáférést megújítja, és a második, azonos hívás már nem ír.
 */

const EMAIL = 'vevo@example.test'
const SKU = 'DEMO-KEZREHAB-001'

/** Csendes logger — a tesztfutás kimenete ne teljen meg naplósorokkal. */
function silentLogger(): Logger {
  const log: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => log,
  }
  return log
}

interface PaidOrderSeed {
  createdAt: string
  productId?: number
}

interface MockOptions {
  /** Létezik-e a felhasználó. */
  userExists?: boolean
  /** Létezik-e a termék. */
  productExists?: boolean
  /** A felhasználó kezdeti purchases-listája. */
  purchases?: number[]
  /** A termék accessDurationDays értéke (hiányzó/null/0 = korlátlan). */
  accessDurationDays?: number | null
  /** Paid rendelések a hozzáférés-lejárat számításához. */
  paidOrders?: PaidOrderSeed[]
}

function createMockPayload(options: MockOptions = {}) {
  const user = {
    id: 7,
    email: EMAIL,
    purchases: options.purchases ?? [],
    accessGrants: [] as Array<{ product: number; grantedAt: string }>,
  }
  const product = {
    id: 42,
    sku: SKU,
    accessDurationDays: options.accessDurationDays ?? null,
  }
  const updates: Array<{ collection: string; id: number | string; data: Record<string, unknown> }> =
    []
  const creates: Array<{ collection: string; data: Record<string, unknown> }> = []

  const payload = {
    find: vi.fn(
      async ({
        collection,
        where,
      }: {
        collection: string
        where?: { email?: { equals?: string } }
      }) => {
        if (collection === 'users') {
          if (!(options.userExists ?? true)) {
            return { docs: [], totalDocs: 0 }
          }
          const wanted = where?.email?.equals
          if (wanted !== undefined && wanted !== user.email) {
            return { docs: [], totalDocs: 0 }
          }
          return { docs: [user], totalDocs: 1 }
        }
        if (collection === 'products') {
          return (options.productExists ?? true)
            ? { docs: [product], totalDocs: 1 }
            : { docs: [], totalDocs: 0 }
        }
        if (collection === 'orders') {
          const docs = (options.paidOrders ?? []).map((order, index) => ({
            id: 1000 + index,
            status: 'paid' as const,
            createdAt: order.createdAt,
            items: [{ product: order.productId ?? product.id }],
          }))
          return { docs, totalDocs: docs.length }
        }
        return { docs: [], totalDocs: 0 }
      },
    ),
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: number | string }) => {
      if (collection === 'users' && (options.userExists ?? true) && Number(id) === user.id) {
        return { ...user, purchases: [...user.purchases], accessGrants: [...user.accessGrants] }
      }
      throw new Error('Not Found')
    }),
    update: vi.fn(
      async (args: { collection: string; id: number | string; data: Record<string, unknown> }) => {
        updates.push(args)
        if (args.collection === 'users') {
          Object.assign(user, args.data)
        }
        return args.data
      },
    ),
    create: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      creates.push(args)
      return { id: 1 }
    }),
  }

  return { payload: payload as unknown as Payload, updates, creates, user, product }
}

describe('grantPurchase — kimeneti ágak', () => {
  it('granted: a hiányzó terméket hozzáfűzi a purchases-listához', async () => {
    const { payload, updates } = createMockPayload({
      purchases: [11],
      accessDurationDays: 365,
    })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      reason: 'elhibázott fizetés jóváírása',
      grantedBy: { id: 1, email: 'owner@example.test' },
      logger: silentLogger(),
    })

    expect(result.status).toBe('granted')
    expect(result.userId).toBe(7)
    expect(result.productId).toBe(42)
    expect(result.productLabel).toBe(SKU)
    expect(result.productRefKind).toBe('sku')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      collection: 'users',
      id: 7,
      data: { purchases: [11, 42] },
    })
    const grants = (updates[0]?.data as { accessGrants: Array<{ product: number }> }).accessGrants
    expect(grants).toEqual([expect.objectContaining({ product: 42 })])
  })

  it('granted: az audit-logs collectionbe is bekerül (action, actor, tétel)', async () => {
    const { payload, creates } = createMockPayload({
      purchases: [],
      accessDurationDays: 365,
    })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      reason: 'elhibázott fizetés jóváírása',
      grantedBy: { id: 1, email: 'owner@example.test' },
      logger: silentLogger(),
    })

    expect(result.status).toBe('granted')
    const auditWrites = creates.filter((entry) => entry.collection === 'audit-logs')
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0].data).toMatchObject({
      action: 'grant-purchase',
      actor: 1,
      entityType: 'users',
      entityId: '7',
      after: { productId: 42, sku: SKU, reason: 'elhibázott fizetés jóváírása' },
    })
  })

  it('already-had / user-not-found ágon NEM keletkezik audit-sor', async () => {
    const had = createMockPayload({ purchases: [42] })
    await grantPurchase({
      payload: had.payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })
    expect(had.creates).toHaveLength(0)

    const missing = createMockPayload({ userExists: false })
    await grantPurchase({
      payload: missing.payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })
    expect(missing.creates).toHaveLength(0)
  })

  it('already-had: meglévő hozzáférésnél nem ír (no-op, nem hiba)', async () => {
    const { payload, updates } = createMockPayload({ purchases: [42] })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(result.status).toBe('already-had')
    expect(result.productId).toBe(42)
    expect(updates).toHaveLength(0)
  })

  it('lejárt hozzáférés: az ajándékozás új grantedAt-tel megújítja az órát', async () => {
    const { payload, updates, creates } = createMockPayload({
      purchases: [42],
      accessDurationDays: 30,
      paidOrders: [{ createdAt: '2020-01-01T00:00:00.000Z' }],
    })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(result.status).toBe('granted')
    expect(result.productId).toBe(42)
    expect(updates).toHaveLength(1)
    const data = updates[0]?.data as { purchases?: number[]; accessGrants?: Array<{ product: number; grantedAt: string }> }
    expect(data.purchases).toEqual([42])
    expect(data.accessGrants).toHaveLength(1)
    expect(data.accessGrants?.[0]?.product).toBe(42)
    expect(typeof data.accessGrants?.[0]?.grantedAt).toBe('string')
    expect(creates.filter((entry) => entry.collection === 'audit-logs')).toHaveLength(1)
  })

  it('időkorlátos új ajándék: purchases és accessGrants együtt íródik', async () => {
    const { payload, updates } = createMockPayload({
      purchases: [11],
      accessDurationDays: 365,
    })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(result.status).toBe('granted')
    expect(updates[0]?.data).toMatchObject({ purchases: [11, 42] })
    const grants = (updates[0]?.data as { accessGrants: Array<{ product: number }> }).accessGrants
    expect(grants).toEqual([expect.objectContaining({ product: 42 })])
  })

  it('already-had: korlátlan termék (null/0) a purchases-ben — nem expired', async () => {
    for (const accessDurationDays of [null, 0] as const) {
      const { payload, updates } = createMockPayload({
        purchases: [42],
        accessDurationDays,
        paidOrders: [{ createdAt: '2020-01-01T00:00:00.000Z' }],
      })

      const result = await grantPurchase({
        payload,
        email: EMAIL,
        productIdOrSku: SKU,
        logger: silentLogger(),
      })

      expect(result.status, `accessDurationDays=${String(accessDurationDays)}`).toBe('already-had')
      expect(updates).toHaveLength(0)
    }
  })

  it('already-had: friss paid rendelés mellett a hozzáférés él — nem ír', async () => {
    const { payload, updates } = createMockPayload({
      purchases: [42],
      accessDurationDays: 30,
      paidOrders: [{ createdAt: new Date().toISOString() }],
    })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(result.status).toBe('already-had')
    expect(updates).toHaveLength(0)
  })

  it('duration-required: új ajándéknál üres/0 napos óra — nem ír', async () => {
    for (const accessDurationDays of [null, 0] as const) {
      const { payload, updates } = createMockPayload({
        purchases: [11],
        accessDurationDays,
      })

      const result = await grantPurchase({
        payload,
        email: EMAIL,
        productIdOrSku: SKU,
        logger: silentLogger(),
      })

      expect(result.status, `accessDurationDays=${String(accessDurationDays)}`).toBe(
        'duration-required',
      )
      expect(updates).toHaveLength(0)
    }
  })

  it('user-not-found: ismeretlen e-mail-cím', async () => {
    const { payload, updates } = createMockPayload({ userExists: false })

    const result = await grantPurchase({
      payload,
      email: 'nincs-ilyen@example.test',
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(result.status).toBe('user-not-found')
    expect(result.userId).toBeUndefined()
    expect(updates).toHaveLength(0)
  })

  it('product-not-found: ismeretlen sku', async () => {
    const { payload, updates } = createMockPayload({ productExists: false })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: 'NINCS-ILYEN-SKU',
      logger: silentLogger(),
    })

    expect(result.status).toBe('product-not-found')
    expect(result.productRefKind).toBe('sku')
    expect(result.userId).toBe(7)
    expect(updates).toHaveLength(0)
  })

  it('numerikus hivatkozás id-ként oldódik fel (id-kind a hívó üzenetéhez)', async () => {
    const { payload } = createMockPayload({ productExists: false })

    const result = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: '9999',
      logger: silentLogger(),
    })

    expect(result.status).toBe('product-not-found')
    expect(result.productRefKind).toBe('id')
  })
})

describe('grantPurchase — idempotencia', () => {
  it('kétszer hívva egyszer ír: a második hívás already-had', async () => {
    const { payload, updates } = createMockPayload({
      purchases: [],
      accessDurationDays: 365,
    })

    const first = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })
    const second = await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(first.status).toBe('granted')
    expect(second.status).toBe('already-had')
    expect(updates).toHaveLength(1)
    expect(updates[0].data).toMatchObject({ purchases: [42] })
    const grants = (updates[0].data as { accessGrants: Array<{ product: number }> }).accessGrants
    expect(grants).toEqual([expect.objectContaining({ product: 42 })])
  })

  it('meglévő jogosultságot sosem vesz el (csak hozzáfűz)', async () => {
    const { payload, updates } = createMockPayload({
      purchases: [11, 12],
      accessDurationDays: 365,
    })

    await grantPurchase({
      payload,
      email: EMAIL,
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    expect(updates[0].data).toMatchObject({ purchases: [11, 12, 42] })
    const grants = (updates[0].data as { accessGrants: Array<{ product: number }> }).accessGrants
    expect(grants).toEqual([expect.objectContaining({ product: 42 })])
  })
})

describe('grantPurchase — W9 e-mail kis-nagybetű', () => {
  it('vegyes kis-nagybetűs címmel is megtalálja a vevőt (Payload lower-case tárolás)', async () => {
    const storedEmail = 'vevo@pelda.hu'
    const user = { id: 7, email: storedEmail, purchases: [] as number[] }
    const product = { id: 42, sku: SKU, accessDurationDays: 365 }
    const findCalls: Array<{ collection: string; where?: { email?: { equals?: string } } }> = []
    const payload = {
      find: vi.fn(async (args: { collection: string; where?: { email?: { equals?: string } } }) => {
        findCalls.push(args)
        if (args.collection === 'users') {
          const wanted = args.where?.email?.equals
          return wanted === storedEmail
            ? { docs: [user], totalDocs: 1 }
            : { docs: [], totalDocs: 0 }
        }
        if (args.collection === 'products') {
          return { docs: [product], totalDocs: 1 }
        }
        return { docs: [], totalDocs: 0 }
      }),
      findByID: vi.fn(async () => ({
      ...user,
      purchases: [...user.purchases],
      accessGrants: [...((user as { accessGrants?: Array<{ product: number; grantedAt: string }> }).accessGrants ?? [])],
    })),
      update: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
        if (args.collection === 'users') {
          Object.assign(user, args.data)
        }
        return args.data
      }),
      create: vi.fn(async () => ({ id: 1 })),
    } as unknown as Payload

    const result = await grantPurchase({
      payload,
      email: '  Vevo@Pelda.hu  ',
      productIdOrSku: SKU,
      logger: silentLogger(),
    })

    const userQuery = findCalls.find((call) => call.collection === 'users')
    expect(userQuery?.where?.email?.equals).toBe(storedEmail)
    expect(result.status).toBe('granted')
    expect(result.userId).toBe(7)
    expect(user.purchases).toEqual([42])
  })
})
