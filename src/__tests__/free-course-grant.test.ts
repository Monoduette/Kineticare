import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { grantFreeCoursesToUser } from '../lib/free-course-grant'
import type { Logger } from '../lib/logger'
import { Users } from '../collections/Users'

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
  priceInHUFEnabled?: boolean | null
  priceInHUF?: number | null
}

const FREE_PUBLISHED: FixtureProduct = { id: 11, status: 'published', priceInHUFEnabled: false }
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

const ALL_PRODUCTS = [
  FREE_PUBLISHED,
  FREE_PUBLISHED_OTHER,
  UNSET_PRICE_FLAG,
  PAID_PUBLISHED,
  FREE_ARCHIVED,
  MISCONFIGURED,
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
  userSeed: { id?: number; purchases?: number[] } = {},
) {
  const userDoc = {
    id: userSeed.id ?? 7,
    purchases: [...(userSeed.purchases ?? [])],
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
        return { id: userDoc.id, purchases: [...userDoc.purchases] }
      }
      throw new Error('Not Found')
    }),
    update: vi.fn(
      async (args: { collection: string; id: number | string; data: Record<string, unknown> }) => {
        updates.push(args)
        if (args.collection === 'users' && Array.isArray(args.data.purchases)) {
          userDoc.purchases = args.data.purchases as number[]
        }
        return args.data
      },
    ),
  }
  return { payload: payload as unknown as Payload, updates }
}

describe('grantFreeCoursesToUser — csak a kért SKU', () => {
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

  it('fizetős, archivált és hibásan konfigurált termék NEM kerül be', async () => {
    const { payload, updates } = createMockPayload()

    for (const productId of [PAID_PUBLISHED.id, FREE_ARCHIVED.id, MISCONFIGURED.id]) {
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

  it('idempotens: a már meglévő kért termék mellett NEM ír', async () => {
    const { payload, updates } = createMockPayload()
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
