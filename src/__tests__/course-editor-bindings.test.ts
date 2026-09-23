import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { Config, Field, PayloadRequest } from 'payload'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ override: undefined as CollectionOverride | undefined }))
vi.mock('@payloadcms/plugin-ecommerce', () => ({
  ecommercePlugin: (options: { products: { productsCollectionOverride: CollectionOverride } }) => {
    runtime.override = options.products.productsCollectionOverride
    return (config: Config) => config
  },
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import { ecommerce } from '../plugins/ecommerce'
import { courseContentReadAccess } from '../access/courseContentRead'
import { streamAssetReadAccess } from '../access/streamAssetRead'
import { isOwnerFieldAccess } from '../access'

beforeAll(async () => {
  await ecommerce({ collections: [] } as unknown as Config)
})

function paths(fields: Field[], prefix = ''): Map<string, Field> {
  const result = new Map<string, Field>()
  for (const field of fields) {
    const path =
      'name' in field && field.name ? `${prefix}${field.name}` : prefix.replace(/\.$/, '')
    if ('name' in field && field.name) result.set(path, field)
    if ('fields' in field)
      for (const [key, value] of paths(
        field.fields,
        'name' in field && field.name ? `${path}.` : prefix,
      ))
        result.set(key, value)
    if (field.type === 'tabs')
      for (const tab of field.tabs) {
        expect('name' in tab).toBe(false)
        for (const [key, value] of paths(tab.fields, prefix)) result.set(key, value)
      }
  }
  return result
}

function readOnly(field: Field | undefined) {
  return field?.admin && 'readOnly' in field.admin ? field.admin.readOnly : undefined
}

describe('course editor presentation bindings', () => {
  it('keeps discovery separate from publication and uses the existing owner-only write policy', async () => {
    const collection = await runtime.override!({
      defaultCollection: { slug: 'products', fields: [] },
    })
    const field = paths(collection.fields).get('unlisted')
    expect(field).toMatchObject({
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar' },
    })
    expect(field && 'access' in field ? field.access?.create : null).toBe(isOwnerFieldAccess)
    expect(field && 'access' in field ? field.access?.update : null).toBe(isOwnerFieldAccess)
    expect(field?.type === 'checkbox' ? field.admin?.description : null).toContain(
      'nem hozzáférés-védelem',
    )
  })

  it('keeps root field paths and all original access functions under task tabs', async () => {
    const price: Field = {
      type: 'group',
      fields: [
        { type: 'number', name: 'priceInHUF', admin: { readOnly: true } },
        { type: 'checkbox', name: 'priceInHUFEnabled' },
      ],
    }
    const versions = { drafts: { autosave: true } }
    const collection = await runtime.override!({
      defaultCollection: { slug: 'products', fields: [price], versions },
    })
    expect(collection.versions).toBe(versions)
    expect(collection.fields.some((field) => field.type === 'tabs')).toBe(true)
    const fields = paths(collection.fields)
    expect(readOnly(fields.get('priceInHUF'))).toBe(true)
    expect('name' in collection.fields[0] && collection.fields[0].name).toBe(
      'courseVisibilityNotice',
    )
    for (const name of [
      'displayTitle',
      'sku',
      'slug',
      'category',
      'shortDescription',
      'longDescription',
      'cardHighlights',
      'salesHighlights',
      'coverImage',
      'gallery',
      'howItWorks',
      'fitFor',
      'notFitFor',
      'guaranteeTitle',
      'guaranteeText',
      'faq',
      'seoTitle',
      'seoDescription',
      'seoKeywords',
      'ogImage',
      'audience',
      'relatedProducts',
      'courseProgressPanel',
    ])
      expect(fields.has(name), name).toBe(true)
    expect(fields.has('bunnyLibraryPanel')).toBe(false)
    expect([...fields.values()].map((field) => field.admin?.components?.Field)).not.toContain(
      '/components/admin/BunnyLibraryPanel#BunnyLibraryPanel',
    )
    for (const path of ['modules.lessons.streamAssetId', 'videos.streamAssetId']) {
      const field = fields.get(path)!
      expect(field.admin?.components?.Field).toBe(
        '/components/admin/BunnyVideoField#ProtectedBunnyVideoField',
      )
      expect('access' in field && field.access?.read).toBe(streamAssetReadAccess)
      // A string registration forwards Payload's field/readOnly props unchanged;
      // no clientProps override may force an access-denied field editable.
      expect(readOnly(field)).not.toBe(false)
    }
    expect(fields.get('previewVideoStreamId')?.admin?.components?.Field).toBe(
      '/components/admin/BunnyVideoField#PublicBunnyVideoField',
    )
    for (const path of [
      'modules.lessons.content',
      'modules.lessons.url',
      'modules.lessons.attachments',
    ]) {
      const field = fields.get(path)!
      expect('access' in field && field.access?.read).toBe(courseContentReadAccess)
    }
    for (const path of ['priceInHUF', 'priceInHUFEnabled', 'accessDurationDays', 'status']) {
      const field = fields.get(path)!
      expect('access' in field && field.access?.update).toBe(isOwnerFieldAccess)
    }
    expect(fields.has('courseEditorialChecklist')).toBe(true)
    for (const prefix of ['modules.lessons', 'videos']) {
      expect(readOnly(fields.get(`${prefix}.durationSec`))).toBe(true)
      const status = fields.get(`${prefix}.status`)!
      expect(readOnly(status)).toBe(true)
      expect('defaultValue' in status && status.defaultValue).toBe('processing')
      expect('access' in status ? status.access : undefined).toBeUndefined()
    }
    expect(collection.admin?.preview).toBeTypeOf('function')
    const preview = collection.admin!.preview!
    const options = { locale: 'hu', req: {} as PayloadRequest, token: null }
    expect(preview({ slug: 'kez-torna' }, options)).toBeNull()
    expect(preview({ id: 12, slug: 'kez-torna' }, options)).toContain('collection=products')
    expect(preview({ id: 12, slug: '../admin' }, options)).toBeNull()
  })

  it('preserves inherited unnamed tabs and field-level readOnly without relaxing access', async () => {
    const read = vi.fn(() => false)
    const update = vi.fn(() => false)
    const original: Field = {
      name: 'pluginReadOnly',
      type: 'text',
      admin: { readOnly: true },
      access: { read, update },
    }
    const collection = await runtime.override!({
      defaultCollection: {
        slug: 'products',
        fields: [{ type: 'tabs', tabs: [{ label: 'Existing', fields: [original] }] }],
      },
    })
    const field = paths(collection.fields).get('pluginReadOnly')!
    expect(field).toBe(original)
    expect(readOnly(field)).toBe(true)
    expect('access' in field && field.access?.read).toBe(read)
    expect('access' in field && field.access?.update).toBe(update)
  })
})

/**
 * K34, K35, K25: a kurzus-szerkesztő feliratai. A plugin ár-mezőit a
 * course-promo.test.ts mintájára egy név nélküli group → row adja.
 */
describe('course editor labels and texts (K34)', () => {
  async function build() {
    return runtime.override!({
      defaultCollection: {
        slug: 'products',
        fields: [
          {
            type: 'group',
            fields: [
              {
                type: 'row',
                fields: [
                  { type: 'checkbox', name: 'priceInHUFEnabled', label: 'HUF ár engedélyezése' },
                  { type: 'number', name: 'priceInHUF', label: 'Ár (HUF)' },
                ],
              },
            ],
          },
        ],
      },
    })
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const description = (field: Field | undefined) =>
    text((field?.admin as { description?: unknown } | undefined)?.description)

  it('a plugin ár-mezői köznyelvi feliratot kapnak, az access változatlan', async () => {
    const fields = paths((await build()).fields)
    expect(fields.get('priceInHUF')).toMatchObject({ label: 'Ár (Ft)' })
    expect(fields.get('priceInHUFEnabled')).toMatchObject({ label: 'Megvásárolható' })
    for (const name of ['priceInHUF', 'priceInHUFEnabled']) {
      const field = fields.get(name)!
      expect('access' in field && field.access?.create).toBe(isOwnerFieldAccess)
      expect('access' in field && field.access?.update).toBe(isOwnerFieldAccess)
    }
  })

  it('a nyilvános előzetes videó, a „Kinek nem való” és a rejtett kurzus felirata', async () => {
    const fields = paths((await build()).fields)
    expect(fields.get('previewVideoStreamId')).toMatchObject({ label: 'Nyilvános előzetes videó' })
    expect(fields.get('notFitFor')).toMatchObject({ label: 'Kinek nem való' })
    expect(description(fields.get('unlisted'))!.length).toBeLessThanOrEqual(150)
    expect(description(fields.get('modules.lessons.streamAssetId'))).toContain(
      'nyilvános előzetes videót',
    )
  })

  it('a Kiemelt előnyök súgója őszintén kimondja, hogy ma nem látszik a weboldalon', async () => {
    const fields = paths((await build()).fields)
    expect(description(fields.get('cardHighlights'))).toMatch(
      /^Ma sehol nem jelenik meg a weboldalon/,
    )
  })

  it('a kurzus minden felirata és súgója: 0 gondolatjel, 0 verzál szó, 0 hibás záró idézőjel, szótár szerint', async () => {
    const texts: string[] = []
    const walk = (fields: readonly Field[]) => {
      for (const field of fields) {
        const label = 'label' in field ? text(field.label) : undefined
        if (label) texts.push(label)
        const desc = description(field)
        if (desc) texts.push(desc)
        if ('options' in field)
          for (const option of field.options)
            if (typeof option === 'object' && typeof option.label === 'string')
              texts.push(option.label)
        if ('fields' in field) walk(field.fields)
        if (field.type === 'tabs') for (const tab of field.tabs) walk(tab.fields)
      }
    }
    const collection = await build()
    walk(collection.fields)
    texts.push(String(collection.admin?.description ?? ''))
    expect(texts.length).toBeGreaterThan(60)
    for (const value of texts) {
      expect(value, value).not.toMatch(/[–—]/)
      expect(value, value).not.toMatch(/„[^”]*"/)
      // Rövidítés (GYIK, SEO, SOS) megengedett, verzállal kiemelt szó nem.
      const shouted = (value.match(/(?<![\p{L}])[A-ZÁÉÍÓÖŐÚÜŰ]{3,}(?![\p{L}])/gu) ?? []).filter(
        (word) => !['GYIK', 'SEO', 'SOS'].includes(word),
      )
      expect(shouted, value).toEqual([])
      expect(value, value).not.toMatch(/\bvevő|publikál|bemutató videó/)
    }
  })
})
