import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { CollectionConfig, Config } from 'payload'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  override: undefined as CollectionOverride | undefined,
  revalidate: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@payloadcms/plugin-ecommerce', () => ({
  ecommercePlugin: (options: { products: { productsCollectionOverride: CollectionOverride } }) => {
    runtime.override = options.products.productsCollectionOverride
    return (config: Config) => config
  },
}))
vi.mock('next/cache', () => ({ revalidateTag: runtime.revalidate }))
vi.mock('../lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/logger')>()),
  logger: { warn: runtime.warn, info: vi.fn(), error: vi.fn() },
}))

import { MENUS_CACHE_TAG } from '../lib/cache-tags'
import { preventCourseDeletionWithFiles } from '../access/courseFileDelete'
import { ecommerce } from '../plugins/ecommerce'

beforeAll(async () => {
  // Csak a plugin regisztrációját vizsgáljuk, adatbázis és Payload-indítás nélkül.
  await ecommerce({ collections: [] } as unknown as Config)
})
beforeEach(() => vi.resetAllMocks())

async function registeredProducts(hooks: CollectionConfig['hooks'] = {}) {
  expect(runtime.override).toBeTypeOf('function')
  return runtime.override!({ defaultCollection: { slug: 'products', fields: [], hooks } })
}

const doc = Object.freeze({
  id: 2,
  slug: 'sos-kezrelax-villamkurzus',
  status: 'published',
  _status: 'published',
  priceInHUFEnabled: false,
})

async function callHook(hook: unknown, current = doc, previousDoc: object = doc) {
  const fn = hook as (args: { doc: typeof doc; previousDoc: object; operation: string }) => unknown
  return fn({ doc: current, previousDoc, operation: 'update' })
}

describe('A regisztrált termékhookok érvénytelenítik a navigáció gyorsítótárát', () => {
  it('a gyári hookok sorrendje és a meglévő törlési takarítás megmarad', async () => {
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const firstDelete = vi.fn()
    const secondDelete = vi.fn()
    const beforeDelete = vi.fn()
    const beforeChange = vi.fn()
    const beforeOperation = vi.fn()
    const hooks = {
      afterChange: [firstChange, secondChange],
      afterDelete: [firstDelete, secondDelete],
      beforeDelete: [beforeDelete],
      beforeChange: [beforeChange],
      beforeOperation: [beforeOperation],
    }
    const products = await registeredProducts(hooks)
    expect(products.hooks?.afterChange).toHaveLength(3)
    expect(products.hooks?.afterChange?.slice(0, 2)).toEqual(hooks.afterChange)
    expect(products.hooks?.afterDelete).toHaveLength(3)
    expect(products.hooks?.afterDelete?.slice(0, 2)).toEqual(hooks.afterDelete)
    expect(products.hooks?.beforeDelete).toHaveLength(3)
    expect(products.hooks?.beforeDelete?.[0]).toBe(preventCourseDeletionWithFiles)
    expect(products.hooks?.beforeDelete?.[1]).toBe(beforeDelete)
    expect(hooks.beforeDelete).toEqual([beforeDelete])
    // r2-termekor (rev1): a validálás nélküli írást piszkozattá tevő hook a
    // gyáriak ELÉ kerül (beforeChange), illetve mögéjük (beforeOperation).
    expect(products.hooks?.beforeChange).toHaveLength(2)
    expect(products.hooks?.beforeChange?.slice(1)).toEqual(hooks.beforeChange)
    expect(products.hooks?.beforeOperation).toHaveLength(2)
    expect(products.hooks?.beforeOperation?.slice(0, 1)).toEqual(hooks.beforeOperation)
    expect(hooks.beforeChange).toEqual([beforeChange])
    expect(hooks.beforeOperation).toEqual([beforeOperation])
    expect(hooks.afterChange).toHaveLength(2)
    expect(hooks.afterDelete).toHaveLength(2)
  })

  it.each([
    ['ár engedélyezése', { priceInHUFEnabled: true }],
    ['ár módosítása', { priceInHUFEnabled: true, priceInHUF: 12000 }],
    ['publikáció visszavonása', { status: 'draft' }],
    ['Payload-piszkozat', { _status: 'draft' }],
    ['archiválás', { status: 'archived' }],
    ['kanonikus slug módosítása', { slug: 'masik-kurzus' }],
  ])(
    '%s után azonnali lejáratot kér, és ugyanazt a dokumentumot adja vissza',
    async (_, changes) => {
      const products = await registeredProducts()
      expect(products.hooks?.afterChange).toHaveLength(1)
      const changed = Object.freeze({ ...doc, ...changes }) as typeof doc
      expect(await callHook(products.hooks?.afterChange?.[0], changed)).toBe(changed)
      expect(runtime.revalidate).toHaveBeenCalledExactlyOnceWith(MENUS_CACHE_TAG, { expire: 0 })
      expect(runtime.warn).not.toHaveBeenCalled()
    },
  )

  it('törlés után is azonnali lejáratot kér, és megőrzi a dokumentumot', async () => {
    const products = await registeredProducts()
    expect(products.hooks?.afterDelete).toHaveLength(1)
    expect(await callHook(products.hooks?.afterDelete?.[0])).toBe(doc)
    expect(runtime.revalidate).toHaveBeenCalledExactlyOnceWith(MENUS_CACHE_TAG, { expire: 0 })
  })

  it.each(['afterChange', 'afterDelete'] as const)(
    '%s esetén a meglévő helper figyelmeztet, de cache-hibával nem szakítja meg a mentést',
    async (event) => {
      const products = await registeredProducts()
      runtime.revalidate.mockImplementation(() => {
        throw new Error('Nincs kéréskörnyezet')
      })
      expect(products.hooks?.[event]).toHaveLength(1)
      expect(await callHook(products.hooks?.[event]?.[0])).toBe(doc)
      expect(runtime.warn).toHaveBeenCalledOnce()
      expect(runtime.warn.mock.calls[0]?.[0]).toContain('menü-gyorsítótár ürítése sikertelen')
      expect(runtime.warn.mock.calls[0]?.[1]).toEqual({ error: 'Nincs kéréskörnyezet' })
    },
  )
})
