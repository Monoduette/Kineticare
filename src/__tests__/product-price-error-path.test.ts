import { initI18n } from '@payloadcms/translations'
import {
  beforeChangeTraverseFields,
  type JsonObject,
  type PayloadRequest,
  type ValidationFieldError,
} from 'payload'
import { describe, expect, it } from 'vitest'

import { FREE_COURSE_GUARD_MESSAGE, PRICE_MESSAGE } from '../components/admin/huf-price'
import configPromise from '../payload.config'

/**
 * r2-termekor (H6): a kurzus ár-őreinek elutasításakor a Payload a hibaüzenet
 * mezőútvonalát (a toastban: „Javítsd ezt a mezőt: …”) a mezőfából építi. A
 * plugin ár-csoportja névtelen és címke nélküli, ezért a helyére a mező
 * típusa került: „Ár és hozzáférés > Group > Ár (Ft)”. A teszt a VALÓDI,
 * végleges payload.config products collectionjén a Payload saját
 * beforeChange-bejárását futtatja (adatbázis nélkül: a közzétett sor és a
 * rendelésszám stub), és a ténylegesen előállt útvonalat méri.
 */

const PUBLISHED_PAID = {
  id: 1,
  _status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: 79_500,
}

async function errorsFor(
  operation: 'create' | 'update',
  data: JsonObject,
): Promise<ValidationFieldError[]> {
  const config = await configPromise
  const products = config.collections.find((collection) => collection.slug === 'products')
  if (!products) throw new Error('A products collection hiányzik a configból.')
  const i18n = await initI18n({ config: config.i18n, language: 'hu', context: 'api' })
  const req = {
    i18n,
    t: i18n.t,
    user: { id: 1, role: 'owner', collection: 'users' },
    context: {},
    payload: {
      config,
      findByID: async () => PUBLISHED_PAID,
      find: async () => ({ docs: [], totalDocs: 0 }),
      count: async () => ({ totalDocs: 3 }),
    },
  } as unknown as PayloadRequest
  const errors: ValidationFieldError[] = []
  const doc = operation === 'update' ? { ...PUBLISHED_PAID } : {}
  await beforeChangeTraverseFields({
    ...(operation === 'update' ? { id: 1 } : {}),
    collection: products,
    context: {},
    data,
    doc,
    docWithLocales: doc,
    errors,
    fieldLabelPath: '',
    fields: products.fields,
    global: null,
    mergeLocaleActions: [],
    operation,
    overrideAccess: true,
    parentIndexPath: '',
    parentPath: '',
    parentSchemaPath: '',
    req,
    siblingData: data,
    siblingDoc: doc,
    siblingDocWithLocales: doc,
    skipValidation: false,
  })
  return errors
}

describe('a kurzus ár-őreinek hibaútvonala magyar (H6)', () => {
  it('Ár (Ft): „Ár és hozzáférés > Ár (Ft)”, a névtelen csoport nem kerül az útvonalba', async () => {
    const errors = await errorsFor('create', { priceInHUFEnabled: true, priceInHUF: 5 })
    const price = errors.find((error) => error.path === 'priceInHUF')
    expect(price?.message).toBe(PRICE_MESSAGE)
    expect(price?.label).toBe('Ár és hozzáférés > Ár (Ft)')
  })

  it('a plugin angol csoport-súgója nem kerül a kurzus-szerkesztőbe', async () => {
    // A névtelen ár-csoport gyári súgója („Prices for this product in different
    // currencies.”) a fül tetején állt; a felületi szöveg magyar (CLAUDE.md).
    const config = await configPromise
    const products = config.collections.find((collection) => collection.slug === 'products')
    const descriptions: string[] = []
    const walk = (fields: readonly unknown[]): void => {
      for (const field of fields) {
        if (typeof field !== 'object' || field === null) continue
        const {
          admin,
          fields: children,
          tabs,
        } = field as {
          admin?: { description?: unknown }
          fields?: unknown[]
          tabs?: Array<{ fields?: unknown[] }>
        }
        if (typeof admin?.description === 'string') descriptions.push(admin.description)
        if (Array.isArray(children)) walk(children)
        for (const tab of tabs ?? []) walk(tab.fields ?? [])
      }
    }
    walk(products?.fields ?? [])
    expect(descriptions.length).toBeGreaterThan(0)
    expect(descriptions.join('\n')).not.toContain('Prices for this product')
  })

  it('Fizetős kurzus: „Ár és hozzáférés > Fizetős kurzus”', async () => {
    const errors = await errorsFor('update', { priceInHUFEnabled: false, priceInHUF: 79_500 })
    const paid = errors.find((error) => error.path === 'priceInHUFEnabled')
    expect(paid?.message).toBe(FREE_COURSE_GUARD_MESSAGE)
    expect(paid?.label).toBe('Ár és hozzáférés > Fizetős kurzus')
    expect(errors.map((error) => String(error.label))).not.toContainEqual(
      expect.stringContaining('Group'),
    )
  })
})
