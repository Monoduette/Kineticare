import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type { PayloadRequest, SanitizedConfig } from 'payload'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import configPromise from '../../payload.config'

type RecordDoc = Record<string, unknown>
type AfterRead = (args: {
  collection: unknown
  context: RecordDoc
  depth: number
  doc: RecordDoc
  draft: boolean
  fallbackLocale: null
  global: null
  locale: string
  overrideAccess: boolean
  req: unknown
  showHiddenFields: boolean
}) => Promise<RecordDoc>

interface Query {
  collection: string
  id?: number
  req?: PayloadRequest
  where?: { id?: { in?: number[] } }
  select?: unknown
}

let afterRead: AfterRead
let config: SanitizedConfig
let collection: unknown
const now = new Date('2026-09-08T12:00:00Z')
const activeDate = '2026-09-01T12:00:00Z'
const expiredDate = '2025-01-01T12:00:00Z'

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('payload')
  const loaded = await import(
    pathToFileURL(entry.replace(/index\.js$/, 'fields/hooks/afterRead/index.js')).href
  )
  afterRead = (loaded as { afterRead: AfterRead }).afterRead
  config = await configPromise
  collection = config.collections.find((item) => item.slug === 'products')
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Nincs hálózat a jogosultságtesztben.')
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function product(id = 42, options: RecordDoc = {}): RecordDoc {
  return {
    id,
    status: 'published',
    _status: 'published',
    accessDurationDays: 30,
    modules: [
      {
        id: `module-${id}`,
        title: 'Nyilvános modulcím',
        lessons: Array.from({ length: 10 }, (_, index) => ({
          id: `lesson-${id}-${index}`,
          kind: 'link',
          title: 'Nyilvános leckecím',
          url: `https://example.test/paid-${id}`,
          content: {
            root: {
              type: 'root',
              children: [
                { type: 'paragraph', children: [{ type: 'text', text: `FIZETOS-${id}` }] },
              ],
            },
          },
          attachments: [{ id: `attachment-${id}-${index}`, label: `PRIVATE-${id}`, file: 71 }],
        })),
      },
    ],
    ...options,
  }
}

function harness(
  options: {
    products?: RecordDoc[]
    role?: 'customer' | 'staff' | 'owner' | 'anonymous'
    purchases?: number[]
    paidAt?: string | null
    grantAt?: string | null
    grantRows?: RecordDoc[]
    linkedOrderStatus?: 'paid' | 'refunded'
    fail?: 'products' | 'orders' | 'users'
  } = {},
) {
  const products = options.products ?? [product()]
  const ids = products.map((item) => item.id as number)
  const paidAt = options.paidAt === undefined ? expiredDate : options.paidAt
  const find = vi.fn(async (args: Query) => {
    if (args.collection === options.fail) throw new Error('Szintetikus lekérdezési hiba')
    if (args.collection === 'products') {
      const requested = args.where?.id?.in ?? []
      return {
        docs: products.filter((item) => requested.includes(item.id as number)),
        hasNextPage: false,
      }
    }
    if (args.collection === 'orders') {
      if (args.where?.id?.in) {
        return {
          docs: [
            {
              id: 900,
              customer: 7,
              status: options.linkedOrderStatus ?? 'refunded',
              items: ids.map((id) => ({ product: id })),
            },
          ],
          hasNextPage: false,
        }
      }
      return {
        docs:
          paidAt === null
            ? []
            : ids.map((id) => ({
                id: id + 1000,
                status: 'paid',
                createdAt: paidAt,
                items: [{ product: id }],
              })),
        hasNextPage: false,
      }
    }
    throw new Error(`Nem várt lekérdezés: ${args.collection}`)
  })
  const findByID = vi.fn(async (args: Query) => {
    if (args.collection !== 'users') throw new Error('Csak a friss vevői grant olvasható itt.')
    if (options.fail === 'users') throw new Error('Szintetikus grant-lekérdezési hiba')
    return {
      id: 7,
      purchases: options.purchases ?? ids,
      accessGrants:
        options.grantRows ??
        (options.grantAt ? ids.map((id) => ({ product: id, grantedAt: options.grantAt })) : []),
    }
  })
  const role = options.role ?? 'customer'
  const req = {
    context: {},
    transactionID: 'SYNTHETIC-READ-TRANSACTION',
    user: role === 'anonymous' ? null : { id: 7, role, purchases: options.purchases ?? ids },
    payload: {
      config,
      collections: Object.fromEntries(
        config.collections.map((item) => [item.slug, { config: item }]),
      ),
      find,
      findByID,
    },
  } as unknown as PayloadRequest
  const read = (doc: RecordDoc = products[0]!) =>
    afterRead({
      collection,
      context: req.context,
      depth: 0,
      doc: structuredClone(doc),
      draft: false,
      fallbackLocale: null,
      global: null,
      locale: 'hu',
      overrideAccess: false,
      req,
      showHiddenFields: false,
    })
  return { read, req, find, findByID, products }
}

function expectPrivateContentAbsent(result: RecordDoc, id = 42) {
  const serialized = JSON.stringify(result)
  expect(serialized).not.toContain(`FIZETOS-${id}`)
  expect(serialized).not.toContain(`PRIVATE-${id}`)
  expect(serialized).not.toContain(`https://example.test/paid-${id}`)
  expect(serialized).toContain('Nyilvános leckecím')
}

describe('a tényleges Payload afterRead védi a lejáró tananyagot', () => {
  it('a lejárt vásárló nem kapja meg a szöveget, linket és mellékletmetaadatot', async () => {
    expectPrivateContentAbsent(await harness().read())
  })

  it.each(['anonymous', 'customer'] as const)(
    '%s vásárlás nélkül DB-kör előtt elutasítva',
    async (role) => {
      const { read, find, findByID } = harness({ role, purchases: [] })
      expectPrivateContentAbsent(await read())
      expect(find).not.toHaveBeenCalled()
      expect(findByID).not.toHaveBeenCalled()
    },
  )

  it.each([
    { paidAt: activeDate },
    { paidAt: expiredDate, grantAt: activeDate },
    { paidAt: null, grantAt: activeDate },
    { paidAt: null, products: [product(42, { accessDurationDays: null })] },
    { paidAt: null, grantAt: null },
  ])('aktív/ajándék/korlátlan és igazolt legacy hozzáférés megmarad: %j', async (options) => {
    const serialized = JSON.stringify(await harness(options).read())
    expect(serialized).toContain('FIZETOS-42')
    expect(serialized).toContain('PRIVATE-42')
    expect(serialized).toContain('https://example.test/paid-42')
  })

  it.each(['staff', 'owner'] as const)(
    '%s draftot is olvas extra entitlement query nélkül',
    async (role) => {
      const { read, find, findByID } = harness({
        role,
        purchases: [],
        products: [product(42, { _status: 'draft', status: 'draft' })],
      })
      expect(JSON.stringify(await read())).toContain('FIZETOS-42')
      expect(find).not.toHaveBeenCalled()
      expect(findByID).not.toHaveBeenCalled()
    },
  )

  it.each(['products', 'orders', 'users'] as const)(
    '%s lekérdezési hiba nem jelent korlátlan hozzáférést',
    async (fail) => {
      const { read } = harness({ paidAt: null, fail })
      expectPrivateContentAbsent(await read())
    },
  )

  it('a caller selectből hiányzó accessDurationDays nem kerülheti meg az authoritative lejáratot', async () => {
    const { read } = harness()
    const selected = product()
    delete selected.accessDurationDays
    delete selected.status
    delete selected._status
    expectPrivateContentAbsent(await read(selected))
  })

  it('több termék sok párhuzamos mezője egy metadata és entitlement batchben fut', async () => {
    const { read, find, findByID, products, req } = harness({
      products: [product(42), product(43)],
      paidAt: activeDate,
    })
    const results = await Promise.all(products.map((doc) => read(doc)))
    expect(results.every((result) => JSON.stringify(result).includes('FIZETOS-'))).toBe(true)
    const productQueries = find.mock.calls.filter(([args]) => args.collection === 'products')
    expect(productQueries).toHaveLength(1)
    expect(productQueries[0]?.[0]).toMatchObject({
      req,
      select: { id: true, accessDurationDays: true, status: true, _status: true },
    })
    expect(find.mock.calls.filter(([args]) => args.collection === 'orders')).toHaveLength(1)
    expect(findByID).toHaveBeenCalledTimes(1)
  })

  it('egy másik kérés nem örökli az előző aktív engedélyét', async () => {
    expect(JSON.stringify(await harness({ paidAt: activeDate }).read())).toContain('FIZETOS-42')
    expectPrivateContentAbsent(await harness({ paidAt: expiredDate }).read())
  })

  it.each([
    { status: 'draft', _status: 'draft' },
    { status: 'published', _status: 'draft' },
    { status: 'unknown', _status: 'published' },
  ])('a customer nem olvas nem publikált/érvénytelen kurzust: %j', async (state) => {
    expectPrivateContentAbsent(
      await harness({ paidAt: activeDate, products: [product(42, state)] }).read(),
    )
  })

  it('az archivált, publikált példányt az aktív régi vevő továbbra is olvassa', async () => {
    const result = await harness({
      paidAt: activeDate,
      products: [product(42, { status: 'archived' })],
    }).read()
    expect(JSON.stringify(result)).toContain('FIZETOS-42')
  })

  it('a lejárat pontos pillanatában a hozzáférés már zárt', async () => {
    const paidAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    expectPrivateContentAbsent(await harness({ paidAt }).read())
  })

  it.each([30, null])(
    'refundolt eredet a %s napos kurzus nyers tananyagát sem nyitja meg',
    async (accessDurationDays) => {
      const scoped = harness({
        products: [product(42, { accessDurationDays })],
        paidAt: null,
        grantRows: [{ product: 42, grantedAt: activeDate, sourceKind: 'order', sourceOrder: 900 }],
      })
      expectPrivateContentAbsent(await scoped.read())
    },
  )

  it('lejárt régi vétel + refundolt renewal nem hosszabbít, de későbbi független gift igen', async () => {
    const grantRows = [
      { product: 42, grantedAt: activeDate, sourceKind: 'order', sourceOrder: 900 },
    ]
    expectPrivateContentAbsent(await harness({ paidAt: expiredDate, grantRows }).read())
    expect(
      JSON.stringify(
        await harness({
          paidAt: expiredDate,
          grantRows: [
            ...grantRows,
            { product: 42, grantedAt: activeDate, sourceKind: 'independent' },
          ],
        }).read(),
      ),
    ).toContain('FIZETOS-42')
  })
})
