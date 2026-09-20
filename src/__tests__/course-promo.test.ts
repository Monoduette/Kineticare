import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { Config, Field } from 'payload'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  isCoursePromoActive,
  promoEndExclusive,
  promoFirstDayLabel,
  promoLastDayLabel,
  promoStartInclusive,
  resolveCoursePromo,
} from '../lib/course-promo'

/**
 * Az akciós megjelenés feloldójának (src/lib/course-promo.ts) és a products
 * „Akciós megjelenés” mezőcsoportjának (src/plugins/ecommerce.ts) őre. DB és
 * hálózat nélkül: a feloldó tiszta függvény, a collection-override a
 * course-editor-bindings.test.ts mintájára, mockolt pluginnal jön elő.
 *
 * Mért tény (@payloadcms/ui DatePicker, dayOnly): a választó a napot
 * `setHours(12 - tzOffset)`-tel, azaz 12:00 UTC-ként menti. A tesztek ezért
 * a 12:00 UTC és az éjfél UTC alakot is ellenőrzik: mindkettő ugyanarra a
 * Budapest szerinti napra vetül.
 */

const runtime = vi.hoisted(() => ({ override: undefined as CollectionOverride | undefined }))
vi.mock('@payloadcms/plugin-ecommerce', () => ({
  ecommercePlugin: (options: { products: { productsCollectionOverride: CollectionOverride } }) => {
    runtime.override = options.products.productsCollectionOverride
    return (config: Config) => config
  },
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const { ecommerce, coursePromoFieldNames, validatePromoEnd, validatePromoOriginalPriceHuf } =
  await import('../plugins/ecommerce')

beforeAll(async () => {
  await ecommerce({ collections: [] } as unknown as Config)
})

const base = { priceInHUF: 19_900, priceInHUFEnabled: true, promoOriginalPriceHuf: null }

/** Nyári időszámítás: 2026-09-30 23:59 Budapest = 21:59Z; október 1. 00:00 Budapest = 22:00Z. */
const SEP30_2359_BUDAPEST = new Date('2026-09-30T21:59:59.999Z')
const OCT1_0000_BUDAPEST = new Date('2026-09-30T22:00:00.000Z')

describe('resolveCoursePromo', () => {
  it('kikapcsolt pipa: nem él, oka kikapcsolva, a dátumoktól függetlenül', () => {
    const promo = resolveCoursePromo(
      { ...base, promoEnabled: false, promoStart: null, promoEnd: null },
      new Date('2026-09-20T10:00:00Z'),
    )
    expect(promo).toMatchObject({ active: false, enabled: false, reason: 'kikapcsolva' })
    expect(
      resolveCoursePromo({ ...base, promoEnabled: null, promoStart: null, promoEnd: null }).active,
    ).toBe(false)
  })

  it('csak pipa, dátum nélkül: azonnal és vég nélkül él', () => {
    const promo = resolveCoursePromo({
      ...base,
      promoEnabled: true,
      promoStart: null,
      promoEnd: null,
    })
    expect(promo).toEqual({
      active: true,
      enabled: true,
      start: null,
      end: null,
      originalPriceHuf: null,
      reason: null,
    })
    expect(isCoursePromoActive({ ...base, promoEnabled: true })).toBe(true)
  })

  it('jövőbeli kezdet: még nem kezdődött el; a kezdőnap 00:00-jától (Budapest) él', () => {
    const fields = {
      ...base,
      promoEnabled: true,
      promoStart: '2026-10-01T12:00:00.000Z',
      promoEnd: null,
    }
    expect(resolveCoursePromo(fields, SEP30_2359_BUDAPEST).reason).toBe('meg-nem-kezdodott')
    expect(resolveCoursePromo(fields, OCT1_0000_BUDAPEST).active).toBe(true)
    expect(promoStartInclusive('2026-10-01T12:00:00.000Z')?.toISOString()).toBe(
      '2026-09-30T22:00:00.000Z',
    )
  })

  it('a vég napja: aznap 23:59 Budapest még él, másnap 00:00 már lejárt (dayOnly 12:00Z alak)', () => {
    const fields = {
      ...base,
      promoEnabled: true,
      promoStart: null,
      promoEnd: '2026-09-30T12:00:00.000Z',
    }
    expect(resolveCoursePromo(fields, SEP30_2359_BUDAPEST).active).toBe(true)
    expect(resolveCoursePromo(fields, OCT1_0000_BUDAPEST).reason).toBe('lejart')
    // A tárolt ISO + 1 nap már biztosan lejárt.
    expect(resolveCoursePromo(fields, new Date('2026-10-01T12:00:00.000Z')).reason).toBe('lejart')
    expect(promoEndExclusive('2026-09-30T12:00:00.000Z')?.toISOString()).toBe(
      '2026-09-30T22:00:00.000Z',
    )
  })

  it('a vég napja UTC éjfél alakban (REST API-n beküldött dátum) ugyanarra a napra vetül', () => {
    const fields = {
      ...base,
      promoEnabled: true,
      promoStart: null,
      promoEnd: '2026-09-30T00:00:00.000Z',
    }
    expect(resolveCoursePromo(fields, SEP30_2359_BUDAPEST).active).toBe(true)
    expect(resolveCoursePromo(fields, OCT1_0000_BUDAPEST).reason).toBe('lejart')
  })

  it('téli időszámításban is a budapesti éjfél a határ', () => {
    expect(promoEndExclusive('2026-01-31T12:00:00.000Z')?.toISOString()).toBe(
      '2026-01-31T23:00:00.000Z',
    )
    expect(promoStartInclusive('2026-01-31T12:00:00.000Z')?.toISOString()).toBe(
      '2026-01-30T23:00:00.000Z',
    )
  })

  it('eredeti ár csak akkor, ha nagyobb a tényleges (bekapcsolt) árnál', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null }
    expect(
      resolveCoursePromo({ ...base, ...on, promoOriginalPriceHuf: 24_900 }).originalPriceHuf,
    ).toBe(24_900)
    expect(
      resolveCoursePromo({ ...base, ...on, promoOriginalPriceHuf: 19_900 }).originalPriceHuf,
    ).toBeNull()
    expect(
      resolveCoursePromo({ ...base, ...on, promoOriginalPriceHuf: 10_000 }).originalPriceHuf,
    ).toBeNull()
    expect(
      resolveCoursePromo({
        ...base,
        ...on,
        priceInHUFEnabled: false,
        promoOriginalPriceHuf: 24_900,
      }).originalPriceHuf,
    ).toBeNull()
    expect(
      resolveCoursePromo({ ...base, ...on, priceInHUF: null, promoOriginalPriceHuf: 24_900 })
        .originalPriceHuf,
    ).toBeNull()
  })

  it('érvénytelen dátum: null, és nem korlátoz', () => {
    const promo = resolveCoursePromo({
      ...base,
      promoEnabled: true,
      promoStart: 'nem dátum',
      promoEnd: '',
    })
    expect(promo.start).toBeNull()
    expect(promo.end).toBeNull()
    expect(promo.active).toBe(true)
    expect(promoEndExclusive(undefined)).toBeNull()
    expect(promoEndExclusive(42)).toBeNull()
  })

  it('promoLastDayLabel és promoFirstDayLabel Budapest szerint, záró pont nélkül', () => {
    const promo = resolveCoursePromo({
      ...base,
      promoEnabled: true,
      promoStart: '2026-10-01T12:00:00.000Z',
      promoEnd: '2026-09-30T12:00:00.000Z',
    })
    expect(promoLastDayLabel(promo)).toBe('szeptember 30')
    expect(promoFirstDayLabel(promo)).toBe('október 1')
    expect(promoLastDayLabel({ end: null })).toBeNull()
    expect(promoFirstDayLabel({ start: null })).toBeNull()
    // Az UTC-s vég (22:00Z) budapesti napja a következő nap lenne; a felirat a MEGADOTT nap.
    expect(promoLastDayLabel({ end: new Date('2026-09-30T22:00:00.000Z') })).toBe('szeptember 30')
  })
})

describe('validatePromoEnd és validatePromoOriginalPriceHuf', () => {
  const opts = (promoStart: unknown) =>
    ({ siblingData: { promoStart } }) as unknown as Parameters<typeof validatePromoEnd>[1]

  it('a vég nem lehet a kezdet előtt; azonos nap és üres mezők rendben', () => {
    expect(
      validatePromoEnd(new Date('2026-09-29T12:00:00.000Z'), opts('2026-09-30T12:00:00.000Z')),
    ).toMatch(/nem lehet a kezdete előtt/)
    expect(
      validatePromoEnd(new Date('2026-09-30T12:00:00.000Z'), opts('2026-09-30T12:00:00.000Z')),
    ).toBe(true)
    // Futásidőben a Payload ISO stringet is adhat: azt is kezeli.
    expect(
      validatePromoEnd(
        '2026-09-29T12:00:00.000Z' as unknown as Date,
        opts('2026-09-30T12:00:00.000Z'),
      ),
    ).toMatch(/nem lehet a kezdete előtt/)
    expect(
      validatePromoEnd(new Date('2026-10-02T12:00:00.000Z'), opts('2026-09-30T12:00:00.000Z')),
    ).toBe(true)
    expect(validatePromoEnd(null, opts('2026-09-30T12:00:00.000Z'))).toBe(true)
    expect(validatePromoEnd(new Date('2026-09-30T12:00:00.000Z'), opts(null))).toBe(true)
  })

  it('az eredeti ár pozitív egész vagy üres', () => {
    const numberOpts = {} as unknown as Parameters<typeof validatePromoOriginalPriceHuf>[1]
    expect(validatePromoOriginalPriceHuf(24_900, numberOpts)).toBe(true)
    expect(validatePromoOriginalPriceHuf(null, numberOpts)).toBe(true)
    expect(validatePromoOriginalPriceHuf(0, numberOpts)).toMatch(/pozitív egész/)
    expect(validatePromoOriginalPriceHuf(19.5, numberOpts)).toMatch(/pozitív egész/)
  })
})

describe('products collection: az „Akciós megjelenés” csoport', () => {
  async function build() {
    return runtime.override!({
      defaultCollection: {
        slug: 'products',
        fields: [
          {
            type: 'group',
            fields: [
              { type: 'number', name: 'priceInHUF' },
              { type: 'checkbox', name: 'priceInHUFEnabled' },
            ],
          },
        ],
        versions: { drafts: { autosave: true } },
      },
    })
  }

  const descriptionOf = (field: Field): string | undefined =>
    field.admin && 'description' in field.admin && typeof field.admin.description === 'string'
      ? field.admin.description
      : undefined

  async function priceTab() {
    const tabs = (await build()).fields.find((field) => field.type === 'tabs')
    expect(tabs?.type).toBe('tabs')
    const tab =
      tabs?.type === 'tabs' ? tabs.tabs.find((t) => t.label === 'Ár és hozzáférés') : undefined
    expect(tab).toBeDefined()
    return tab!
  }

  async function promoCollapsible() {
    const collapsible = (await priceTab()).fields.find(
      (field) => field.type === 'collapsible' && field.label === 'Akciós megjelenés',
    )
    expect(collapsible?.type).toBe('collapsible')
    return collapsible as Extract<Field, { type: 'collapsible' }>
  }

  it('a csoport az „Ár és hozzáférés” fülön áll, lapos nevekkel, a megadott sorrendben', async () => {
    const names = (await promoCollapsible()).fields.map((field) =>
      'name' in field ? field.name : '',
    )
    expect(names).toEqual([...coursePromoFieldNames])
    const nested = (await build()).fields.filter(
      (field) => field.type === 'group' && 'name' in field,
    )
    expect(nested.some((field) => 'name' in field && /promo/i.test(field.name))).toBe(false)
  })

  it('mezőtípusok: pipa, két napi dátum, egész szám, és a validálók be vannak kötve', async () => {
    const byName = new Map(
      (await promoCollapsible()).fields.map((field) => ['name' in field ? field.name : '', field]),
    )
    const enabled = byName.get('promoEnabled')
    expect(enabled?.type).toBe('checkbox')
    expect(enabled && 'defaultValue' in enabled ? enabled.defaultValue : undefined).toBe(false)
    for (const name of ['promoStart', 'promoEnd']) {
      const field = byName.get(name)
      expect(field?.type).toBe('date')
      expect(field?.type === 'date' ? field.admin?.date?.pickerAppearance : undefined).toBe(
        'dayOnly',
      )
    }
    const end = byName.get('promoEnd')
    expect(end?.type === 'date' ? end.validate : undefined).toBe(validatePromoEnd)
    expect(end === undefined ? undefined : descriptionOf(end)).toContain('nap végéig')
    const original = byName.get('promoOriginalPriceHuf')
    expect(original?.type).toBe('number')
    expect(original?.type === 'number' ? original.validate : undefined).toBe(
      validatePromoOriginalPriceHuf,
    )
    expect(original?.type === 'number' ? original.min : undefined).toBe(1)
  })

  it('az állapot-doboz ui-mező, a saját komponensére mutat, és csak bekapcsolt pipa mellett látszik', async () => {
    const panel = (await promoCollapsible()).fields.find(
      (field) => 'name' in field && field.name === 'promoStatusPanel',
    )
    expect(panel?.type).toBe('ui')
    expect(panel?.admin?.components?.Field).toBe(
      '/components/admin/CoursePromoStatus#CoursePromoStatus',
    )
    const condition = panel?.admin?.condition
    expect(typeof condition).toBe('function')
    const call = (siblingData: Record<string, unknown>) =>
      (condition as (data: unknown, sibling: unknown, ctx: unknown) => boolean)({}, siblingData, {})
    expect(call({ promoEnabled: true })).toBe(true)
    expect(call({ promoEnabled: false })).toBe(false)
    expect(call({})).toBe(false)
  })

  it('a felületi szövegekben nincs gondolatjel (tulajdonosi kikötés)', async () => {
    const collapsible = await promoCollapsible()
    const texts: string[] = [String(collapsible.label)]
    for (const field of collapsible.fields) {
      if ('label' in field && typeof field.label === 'string') texts.push(field.label)
      const description = descriptionOf(field)
      if (description !== undefined) texts.push(description)
    }
    expect(texts.length).toBeGreaterThan(5)
    for (const text of texts) expect(text).not.toMatch(/[–—]/)
  })
})
