import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { grantFreeCoursesToUser } from '../lib/free-course-grant'
import type { Logger } from '../lib/logger'
import { Users } from '../collections/Users'
import type { AccessGrantRow } from '../lib/access-grants'

/**
 * Ingyenes kurzus hozzáférés-adása — CSAK a kért productId.
 *
 * Login/regisztráció NEM ír purchases-t. A nyilvános igénylő a kért SKU-t
 * adja át. A mock a where-objektumot TÉNYLEGESEN kiértékeli — így az is
 * bukik, ha a lekérdezés feltételei ellazulnának.
 */

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

interface FixtureProduct {
  id: number
  status: string
  _status?: string | null
  priceInHUFEnabled?: boolean | null
  priceInHUF?: number | null
  accessDurationDays?: number | null
}

const FREE_PUBLISHED: FixtureProduct = { id: 11, status: 'published', priceInHUFEnabled: false }
const FREE_TIMED: FixtureProduct = {
  id: 15,
  status: 'published',
  priceInHUFEnabled: false,
  accessDurationDays: 365,
}
const FREE_PUBLISHED_OTHER: FixtureProduct = {
  id: 14,
  status: 'published',
  priceInHUFEnabled: false,
}
const UNSET_PRICE_FLAG: FixtureProduct = {
  id: 12,
  status: 'published',
  priceInHUFEnabled: null,
}
const PAID_PUBLISHED: FixtureProduct = {
  id: 21,
  status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: 19900,
}
const FREE_ARCHIVED: FixtureProduct = { id: 31, status: 'archived', priceInHUFEnabled: false }
const MISCONFIGURED: FixtureProduct = {
  id: 41,
  status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: null,
}
/**
 * r2-termekor H4: lomtárból piszkozatként visszaállított fizetős kurzus. A
 * Payload validálás nélkül a meg nem erősített piszkozatot (kivett pipa) írta
 * a fő sorba, `_status: 'draft'`-tal; a `status` közben „published” maradt.
 */
const RESTORED_AS_DRAFT: FixtureProduct = {
  id: 51,
  status: 'published',
  _status: 'draft',
  priceInHUFEnabled: false,
  priceInHUF: 79500,
}

const ALL_PRODUCTS = [
  FREE_PUBLISHED,
  FREE_PUBLISHED_OTHER,
  FREE_TIMED,
  UNSET_PRICE_FLAG,
  PAID_PUBLISHED,
  FREE_ARCHIVED,
  MISCONFIGURED,
  RESTORED_AS_DRAFT,
]

function matchesWhere(product: FixtureProduct, where: unknown): boolean {
  const clauses = (where as { and?: Array<Record<string, Record<string, unknown>>> }).and ?? []
  for (const clause of clauses) {
    if (clause.id?.equals !== undefined && product.id !== clause.id.equals) {
      return false
    }
    if (clause.status?.equals !== undefined && product.status !== clause.status.equals) {
      return false
    }
    if (
      clause.priceInHUFEnabled?.equals !== undefined &&
      product.priceInHUFEnabled !== clause.priceInHUFEnabled.equals
    ) {
      return false
    }
    if (
      clause.priceInHUFEnabled?.not_equals !== undefined &&
      product.priceInHUFEnabled === clause.priceInHUFEnabled.not_equals
    ) {
      return false
    }
  }
  return true
}

function createMockPayload(
  products: FixtureProduct[] = ALL_PRODUCTS,
  userSeed: {
    id?: number
    purchases?: number[]
    accessGrants?: AccessGrantRow[]
  } = {},
) {
  const userDoc = {
    id: userSeed.id ?? 7,
    purchases: [...(userSeed.purchases ?? [])],
    accessGrants: [...(userSeed.accessGrants ?? [])],
  }
  const updates: Array<{ collection: string; id: number | string; data: Record<string, unknown> }> =
    []
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
      if (collection !== 'products') {
        return { docs: [], totalDocs: 0 }
      }
      const docs = products.filter((product) => matchesWhere(product, where))
      return { docs, totalDocs: docs.length }
    }),
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: number | string }) => {
      if (collection === 'users' && Number(id) === userDoc.id) {
        return {
          id: userDoc.id,
          purchases: [...userDoc.purchases],
          accessGrants: [...userDoc.accessGrants],
        }
      }
      throw new Error('Not Found')
    }),
    update: vi.fn(
      async (args: { collection: string; id: number | string; data: Record<string, unknown> }) => {
        updates.push(args)
        if (args.collection === 'users' && Array.isArray(args.data.purchases)) {
          userDoc.purchases = args.data.purchases as number[]
        }
        if (args.collection === 'users' && Array.isArray(args.data.accessGrants)) {
          userDoc.accessGrants = args.data.accessGrants as Array<{
            product: number
            grantedAt: string
          }>
        }
        return args.data
      },
    ),
  }
  return { payload: payload as unknown as Payload, updates }
}

describe('grantFreeCoursesToUser — csak a kért SKU', () => {
  it('egy új explicit ingyenes grant külön independent eredetet kap a paid/legacy sorok mellett', async () => {
    const untouched: AccessGrantRow[] = [
      {
        id: 'DUMMY-paid-row',
        product: FREE_TIMED.id,
        grantedAt: '2025-01-01T00:00:00.000Z',
        sourceKind: 'order',
        sourceOrder: 10,
      },
      { id: 'DUMMY-legacy-row', product: FREE_TIMED.id, grantedAt: '2024-01-01T00:00:00.000Z' },
    ]
    const { payload, updates } = createMockPayload(ALL_PRODUCTS, {
      purchases: [FREE_TIMED.id],
      accessGrants: untouched,
    })
    await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [FREE_TIMED.id] },
      productId: FREE_TIMED.id,
      logger: silentLogger(),
    })
    const rows = updates[0]?.data.accessGrants as AccessGrantRow[]
    expect(rows?.slice(0, 2)).toEqual(untouched)
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ product: FREE_TIMED.id, sourceKind: 'independent' })
  })

  it('korlátlan új free SKU-nál is van independent tagsági eredet', async () => {
    const { payload, updates } = createMockPayload()
    await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [] },
      productId: FREE_PUBLISHED.id,
      logger: silentLogger(),
    })
    expect(updates[0].data.accessGrants).toEqual([
      expect.objectContaining({ product: FREE_PUBLISHED.id, sourceKind: 'independent' }),
    ])
  })

  it('CSAK a kért, published + TUDATOSAN ingyenes termék kerül a purchases-be', async () => {
    const { payload, updates } = createMockPayload()

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [] },
      productId: FREE_PUBLISHED.id,
      logger: silentLogger(),
    })

    expect(result.grantedProductIds).toEqual([FREE_PUBLISHED.id])
    expect(result.freeProductCount).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      collection: 'users',
      id: 7,
      data: { purchases: [FREE_PUBLISHED.id] },
    })
    expect(updates[0].data.accessGrants).toEqual([
      expect.objectContaining({ product: FREE_PUBLISHED.id, sourceKind: 'independent' }),
    ])
  })

  it('második ingyenes SKU-t NEM írja be, ha azt nem kérték', async () => {
    const { payload, updates } = createMockPayload()

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [] },
      productId: FREE_PUBLISHED.id,
      logger: silentLogger(),
    })

    expect(result.grantedProductIds).toEqual([FREE_PUBLISHED.id])
    expect(updates[0].data.purchases).not.toContain(FREE_PUBLISHED_OTHER.id)
  })

  it('a BEÁLLÍTATLAN ár-pipájú (NULL) publikált termék NEM ingyenes — nem kerül be', async () => {
    const { payload, updates } = createMockPayload([UNSET_PRICE_FLAG])

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [] },
      productId: UNSET_PRICE_FLAG.id,
      logger: silentLogger(),
    })

    expect(result.grantedProductIds).toEqual([])
    expect(result.freeProductCount).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('a lekérdezés a kért id-re + SZIGORÚ `equals: false` feltétellel megy', async () => {
    const { payload } = createMockPayload()

    await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [] },
      productId: FREE_PUBLISHED.id,
      logger: silentLogger(),
    })

    const where = (payload.find as unknown as { mock: { calls: [{ where: unknown }][] } }).mock
      .calls[0][0].where as { and: Array<Record<string, Record<string, unknown>>> }
    expect(where.and.find((clause) => 'id' in clause)?.id).toEqual({ equals: FREE_PUBLISHED.id })
    const priceClause = where.and.find((clause) => 'priceInHUFEnabled' in clause)
    expect(priceClause?.priceInHUFEnabled).toEqual({ equals: false })
  })

  it('fizetős, archivált, hibásan konfigurált és piszkozat-sorban álló termék NEM kerül be', async () => {
    const { payload, updates } = createMockPayload()

    for (const productId of [
      PAID_PUBLISHED.id,
      FREE_ARCHIVED.id,
      MISCONFIGURED.id,
      RESTORED_AS_DRAFT.id,
    ]) {
      const result = await grantFreeCoursesToUser({
        payload,
        user: { id: 7, purchases: [] },
        productId,
        logger: silentLogger(),
      })
      expect(result.grantedProductIds).toEqual([])
    }
    expect(updates).toHaveLength(0)
  })

  it('idempotens: a már meglévő independent eredetű kért termék mellett NEM ír', async () => {
    const { payload, updates } = createMockPayload(ALL_PRODUCTS, {
      purchases: [FREE_PUBLISHED.id, PAID_PUBLISHED.id],
      accessGrants: [
        {
          product: FREE_PUBLISHED.id,
          grantedAt: '2026-01-15T00:00:00.000Z',
          sourceKind: 'independent',
        },
      ],
    })
    const log = silentLogger()

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [FREE_PUBLISHED.id, PAID_PUBLISHED.id] },
      productId: FREE_PUBLISHED.id,
      logger: log,
    })

    expect(result.grantedProductIds).toEqual([])
    expect(updates).toHaveLength(0)
    expect(log.info).not.toHaveBeenCalled()
  })

  it('a meglévő purchases sosem csökken — csak a kért hiányzó fűződik hozzá', async () => {
    const { payload, updates } = createMockPayload([FREE_PUBLISHED], {
      purchases: [PAID_PUBLISHED.id],
    })

    await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [PAID_PUBLISHED.id] },
      productId: FREE_PUBLISHED.id,
      logger: silentLogger(),
    })

    expect(updates[0].data.purchases).toEqual([PAID_PUBLISHED.id, FREE_PUBLISHED.id])
  })

  it('időkorlátos ingyenes SKU: purchases + accessGrants kezdőpont', async () => {
    const { payload, updates } = createMockPayload([FREE_TIMED])

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [] },
      productId: FREE_TIMED.id,
      logger: silentLogger(),
    })

    expect(result.grantedProductIds).toEqual([FREE_TIMED.id])
    expect(updates).toHaveLength(1)
    expect(updates[0].data.purchases).toEqual([FREE_TIMED.id])
    const grants = updates[0].data.accessGrants as Array<{ product: number; grantedAt: string }>
    expect(grants).toHaveLength(1)
    expect(grants[0].product).toBe(FREE_TIMED.id)
    expect(typeof grants[0].grantedAt).toBe('string')
    expect(Number.isNaN(Date.parse(grants[0].grantedAt))).toBe(false)
  })

  it('már birtokolt időkorlátos SKU hiányzó órával: csak az accessGrants íródik', async () => {
    const { payload, updates } = createMockPayload([FREE_TIMED], {
      purchases: [FREE_TIMED.id],
    })

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [FREE_TIMED.id] },
      productId: FREE_TIMED.id,
      logger: silentLogger(),
    })

    expect(result.grantedProductIds).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0].data).not.toHaveProperty('purchases')
    const grants = updates[0].data.accessGrants as Array<{ product: number; grantedAt: string }>
    expect(grants[0].product).toBe(FREE_TIMED.id)
  })

  it('már birtokolt időkorlátos SKU meglévő órával: nincs írás (az órát nem nullázzuk)', async () => {
    const { payload, updates } = createMockPayload([FREE_TIMED], {
      purchases: [FREE_TIMED.id],
      accessGrants: [
        {
          product: FREE_TIMED.id,
          grantedAt: '2026-01-15T00:00:00.000Z',
          sourceKind: 'independent',
        },
      ],
    })

    const result = await grantFreeCoursesToUser({
      payload,
      user: { id: 7, purchases: [FREE_TIMED.id] },
      productId: FREE_TIMED.id,
      logger: silentLogger(),
    })

    expect(result.grantedProductIds).toEqual([])
    expect(updates).toHaveLength(0)
  })
})

describe('Users hookok — nincs csendes free-grant', () => {
  it('afterChange create NEM ír purchases-t', async () => {
    const afterChange = Users.hooks?.afterChange ?? []
    expect(afterChange.map((hook) => hook.name)).not.toContain('grantFreeCoursesAfterCreate')
  })

  it('afterLogin NEM ír purchases-t', async () => {
    const afterLogin = Users.hooks?.afterLogin ?? []
    expect(afterLogin.map((hook) => hook.name)).not.toContain('grantFreeCoursesAfterLogin')
    expect(afterLogin.map((hook) => hook.name)).toContain('clearPasswordSetupPendingAfterLogin')
  })
})
