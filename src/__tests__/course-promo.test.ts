import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { Config, Field } from 'payload'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { isOwnerFieldAccess } from '../access'
import {
  effectiveCoursePriceHuf,
  isCoursePromoActive,
  isCoursePromoDisplayed,
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

const { ecommerce, coursePromoFieldNames, validatePromoEnd, validatePromoPriceHuf } =
  await import('../plugins/ecommerce')

beforeAll(async () => {
  await ecommerce({ collections: [] } as unknown as Config)
})

const base = { priceInHUF: 19_900, priceInHUFEnabled: true, promoPriceHuf: null }

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
      regularPriceHuf: 19_900,
      promoPriceHuf: null,
      priceHuf: 19_900,
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

  it('akciós ár csak akkor, ha kisebb a rendes árnál; különben nincs áthúzott ár sem', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null }
    expect(resolveCoursePromo({ ...base, ...on, promoPriceHuf: 14_900 })).toMatchObject({
      regularPriceHuf: 19_900,
      promoPriceHuf: 14_900,
      priceHuf: 14_900,
      originalPriceHuf: 19_900,
    })
    // Egyenlő vagy nagyobb „akció” nem kedvezmény: a rendes ár marad, áthúzás nincs.
    for (const promoPriceHuf of [19_900, 24_900]) {
      expect(resolveCoursePromo({ ...base, ...on, promoPriceHuf })).toMatchObject({
        promoPriceHuf: null,
        priceHuf: 19_900,
        originalPriceHuf: null,
      })
    }
    // Nem pozitív vagy nem szám: nincs akciós ár.
    expect(resolveCoursePromo({ ...base, ...on, promoPriceHuf: 0 }).priceHuf).toBe(19_900)
    expect(resolveCoursePromo({ ...base, ...on, promoPriceHuf: -5 }).promoPriceHuf).toBeNull()
    expect(resolveCoursePromo({ ...base, ...on, promoPriceHuf: Number.NaN }).priceHuf).toBe(19_900)
  })

  it('ingyenes vagy ár nélküli kurzuson nincs fizetendő ár, akciós ár mellett sem', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null, promoPriceHuf: 9_900 }
    expect(resolveCoursePromo({ ...base, ...on, priceInHUFEnabled: false })).toMatchObject({
      regularPriceHuf: null,
      promoPriceHuf: null,
      priceHuf: null,
      originalPriceHuf: null,
    })
    expect(resolveCoursePromo({ ...base, ...on, priceInHUF: null })).toMatchObject({
      regularPriceHuf: null,
      priceHuf: null,
      originalPriceHuf: null,
    })
    expect(resolveCoursePromo({ ...base, ...on, priceInHUF: 0 }).priceHuf).toBeNull()
  })

  it('fizetendő ár az időablakban az akciós, előtte és utána magától a rendes (budapesti naphatár)', () => {
    const fields = {
      ...base,
      promoEnabled: true,
      promoStart: '2026-10-01T12:00:00.000Z',
      promoEnd: '2026-10-31T12:00:00.000Z',
      promoPriceHuf: 9_900,
    }
    // Szeptember 30. 23:59 Budapest: még nem kezdődött el, a rendes ár.
    expect(resolveCoursePromo(fields, SEP30_2359_BUDAPEST)).toMatchObject({
      active: false,
      priceHuf: 19_900,
      originalPriceHuf: null,
    })
    // Október 1. 00:00 Budapest: az akciós ár, a rendes áthúzva.
    expect(resolveCoursePromo(fields, OCT1_0000_BUDAPEST)).toMatchObject({
      active: true,
      priceHuf: 9_900,
      originalPriceHuf: 19_900,
    })
    // Október 31. 23:59:59 Budapest (téli időszámítás előtt még nyári: 21:59Z): még él.
    expect(resolveCoursePromo(fields, new Date('2026-10-31T21:59:59.999Z')).priceHuf).toBe(9_900)
    // November 1. 00:00 Budapest (23:00Z, már téli időszámítás): lejárt, a rendes ár.
    expect(resolveCoursePromo(fields, new Date('2026-10-31T23:00:00.000Z'))).toMatchObject({
      active: false,
      reason: 'lejart',
      priceHuf: 19_900,
      originalPriceHuf: null,
    })
  })

  it('effectiveCoursePriceHuf: a most fizetendő ár, hiányzó promo-mezőknél a rendes ár', () => {
    const now = new Date('2026-09-20T10:00:00.000Z')
    expect(effectiveCoursePriceHuf({ priceInHUF: 19_900, priceInHUFEnabled: true }, now)).toBe(
      19_900,
    )
    expect(effectiveCoursePriceHuf({ priceInHUF: 19_900, priceInHUFEnabled: false }, now)).toBeNull()
    expect(
      effectiveCoursePriceHuf(
        { ...base, promoEnabled: true, promoStart: null, promoEnd: null, promoPriceHuf: 9_900 },
        now,
      ),
    ).toBe(9_900)
    expect(
      effectiveCoursePriceHuf(
        {
          ...base,
          promoEnabled: true,
          promoStart: null,
          promoEnd: '2026-09-19T12:00:00.000Z',
          promoPriceHuf: 9_900,
        },
        now,
      ),
    ).toBe(19_900)
    // Kikapcsolt pipa mellett az akciós ár hatástalan.
    expect(
      effectiveCoursePriceHuf(
        { ...base, promoEnabled: false, promoStart: null, promoEnd: null, promoPriceHuf: 9_900 },
        now,
      ),
    ).toBe(19_900)
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

describe('isCoursePromoDisplayed: élő időablak + közzétett + érvényes ár', () => {
  const alap = {
    promoEnabled: true,
    promoStart: '2026-09-01T12:00:00.000Z',
    promoEnd: '2026-09-30T12:00:00.000Z',
    promoPriceHuf: 39500,
    priceInHUF: 79500,
    priceInHUFEnabled: true,
    status: 'published' as const,
  }
  const most = new Date('2026-09-20T10:00:00.000Z')

  it('közzétett, fizetős, élő akció: megjelenik', () => {
    expect(isCoursePromoDisplayed(alap, most)).toBe(true)
  })

  it('archivált kurzuson nem, akkor sem, ha az időablak él', () => {
    expect(isCoursePromoDisplayed({ ...alap, status: 'archived' }, most)).toBe(false)
    expect(isCoursePromoDisplayed({ ...alap, status: 'draft' }, most)).toBe(false)
  })

  it('visszavont (draft) dokumentumon nem, közzétett dokumentumon igen', () => {
    expect(isCoursePromoDisplayed({ ...alap, _status: 'draft' }, most)).toBe(false)
    expect(isCoursePromoDisplayed({ ...alap, _status: 'published' }, most)).toBe(true)
  })

  it('ingyenes vagy ár nélküli kurzuson nem', () => {
    expect(isCoursePromoDisplayed({ ...alap, priceInHUFEnabled: false }, most)).toBe(false)
    expect(isCoursePromoDisplayed({ ...alap, priceInHUF: null }, most)).toBe(false)
    expect(isCoursePromoDisplayed({ ...alap, priceInHUF: 0 }, most)).toBe(false)
  })

  it('lejárt vagy kikapcsolt akciónál nem', () => {
    expect(isCoursePromoDisplayed(alap, new Date('2026-10-05T10:00:00.000Z'))).toBe(false)
    expect(isCoursePromoDisplayed({ ...alap, promoEnabled: false }, most)).toBe(false)
  })
})

describe('validatePromoEnd és validatePromoPriceHuf', () => {
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

  it('az akciós ár pozitív egész vagy üres', () => {
    const numberOpts = {} as unknown as Parameters<typeof validatePromoPriceHuf>[1]
    expect(validatePromoPriceHuf(14_900, numberOpts)).toBe(true)
    expect(validatePromoPriceHuf(null, numberOpts)).toBe(true)
    expect(validatePromoPriceHuf(undefined, numberOpts)).toBe(true)
    expect(validatePromoPriceHuf(0, numberOpts)).toMatch(/pozitív egész/)
    expect(validatePromoPriceHuf(-1, numberOpts)).toMatch(/pozitív egész/)
    expect(validatePromoPriceHuf(19.5, numberOpts)).toMatch(/pozitív egész/)
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
    const promoPrice = byName.get('promoPriceHuf')
    expect(promoPrice?.type).toBe('number')
    expect(promoPrice?.type === 'number' ? promoPrice.validate : undefined).toBe(
      validatePromoPriceHuf,
    )
    expect(promoPrice?.type === 'number' ? promoPrice.min : undefined).toBe(1)
    // Az örökölt mező a sémában marad, de rejtve: senki nem olvassa.
    const legacy = byName.get('promoOriginalPriceHuf')
    expect(legacy?.type).toBe('number')
    expect(legacy?.type === 'number' ? legacy.admin?.hidden : undefined).toBe(true)
  })

  it('a mezőnevek között ott az akciós ár, és az Ár mezővel azonos owner-only írás védi', async () => {
    expect(coursePromoFieldNames).toContain('promoPriceHuf')
    const byName = new Map(
      (await promoCollapsible()).fields.map((field) => ['name' in field ? field.name : '', field]),
    )
    // A mezőszintű access csak a nevesített (nem ui) mezőkön él (access.test.ts mintája).
    const accessOf = (field: Field | undefined) =>
      field !== undefined && field.type !== 'ui' ? field.access : undefined
    const promoPrice = accessOf(byName.get('promoPriceHuf'))
    expect(promoPrice?.create).toBe(isOwnerFieldAccess)
    expect(promoPrice?.update).toBe(isOwnerFieldAccess)
    expect(promoPrice?.read).toBeUndefined()
    // A többi akció-mező (pipa, dátumok) nem ár: a staff is állíthatja.
    for (const name of ['promoEnabled', 'promoStart', 'promoEnd']) {
      expect(accessOf(byName.get(name))?.update, name).toBeUndefined()
    }
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
