/**
 * A Kurzusok szerkesztőjének súgói igazat mondanak (modul-térkép H23, H24,
 * H25, H34, H37, H47; B3).
 *
 * Minden súgó egy kódbeli tényt állít (mi hol látszik, mi mi után jön, mi
 * írható át). Az őr a súgót a tényt hordozó kódhoz köti, így ha a kód
 * változik, a teszt bukik, nem a súgó avul el csendben.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { Config, Field } from 'payload'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ override: undefined as CollectionOverride | undefined }))
vi.mock('@payloadcms/plugin-ecommerce', () => ({
  ecommercePlugin: (options: { products: { productsCollectionOverride: CollectionOverride } }) => {
    runtime.override = options.products.productsCollectionOverride
    return (config: Config) => config
  },
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import { CROSS_SELL_HEADING, RELATED_COURSES_HEADING } from '../components/courses/RelatedCourses'
import { classifyHeading } from '../components/courses/sales-content'
import { ecommerce, RESZLETES_LEIRAS_CIMSORAI_SUGO } from '../plugins/ecommerce'
import { productSeoDoc, resolveOgImageUrl } from '../lib/seo'
import type { Media } from '../payload-types'

const SRC = join(process.cwd(), 'src')
const DASHES = /[\u2013\u2014]/

let collectionFields: Field[]

beforeAll(async () => {
  await ecommerce({ collections: [] } as unknown as Config)
  const collection = await runtime.override!({
    defaultCollection: { slug: 'products', fields: [] },
  })
  collectionFields = collection.fields
})

/** Pontozott útvonal → mező (a fülek és a név nélküli csoportok átlátszók). */
function paths(fields: readonly Field[], prefix = ''): Map<string, Field> {
  const result = new Map<string, Field>()
  for (const field of fields) {
    const named = 'name' in field && typeof field.name === 'string' && field.name.length > 0
    const path = named ? `${prefix}${field.name}` : prefix
    if (named) result.set(path, field)
    if ('fields' in field && Array.isArray(field.fields))
      for (const [key, value] of paths(field.fields, named ? `${path}.` : prefix))
        result.set(key, value)
    if (field.type === 'tabs')
      for (const tab of field.tabs)
        for (const [key, value] of paths(tab.fields, prefix)) result.set(key, value)
  }
  return result
}

/** Minden mező a fában, sorrendben (a név nélküli collapsible-lel együtt). */
function allFields(fields: readonly Field[]): Field[] {
  return fields.flatMap((field) => [
    field,
    ...('fields' in field && Array.isArray(field.fields) ? allFields(field.fields) : []),
    ...(field.type === 'tabs' ? field.tabs.flatMap((tab) => allFields(tab.fields)) : []),
  ])
}

function descriptionOf(field: Field | undefined): string {
  const admin = field?.admin as { description?: unknown } | undefined
  const description = admin?.description
  if (typeof description !== 'string') throw new Error('a mezőnek nincs szöveges leírása')
  return description
}

function field(path: string): Field {
  const found = paths(collectionFields).get(path)
  if (found === undefined) throw new Error(`nincs ilyen mező: ${path}`)
  return found
}

/** A „…” idézőjelek közti szövegek, sorrendben. */
function quoted(text: string): string[] {
  return [...text.matchAll(/„([^”]+)”/g)].map((match) => match[1])
}

function promoSourceHasText(text: string): boolean {
  const dir = join(SRC, 'components/courses/promo')
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const asJsxText = new RegExp(`>\\s*${escaped}\\s*<`)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .some((name) => asJsxText.test(readFileSync(join(dir, name), 'utf8')))
}

const media = (url: string): Media => ({ id: 1, url, alt: 'kép' }) as Media

describe('H37 (B20): a kódban élő feliratokat a súgó kimondja', () => {
  it('a Kapcsolódó kurzusok súgója a sáv mindkét címét betűre idézi', () => {
    const text = descriptionOf(field('relatedProducts'))
    expect(text).toContain(`„${RELATED_COURSES_HEADING}”`)
    expect(text).toContain(`„${CROSS_SELL_HEADING}”`)
    expect(text).toContain('a weboldal kódjában van, itt nem írható át')
  })

  it('az Akciós megjelenés csoport súgója három, a promo-sablonban valóban álló feliratot idéz', () => {
    const group = allFields(collectionFields).find(
      (candidate) =>
        candidate.type === 'collapsible' &&
        allFields(candidate.fields).some(
          (inner) => 'name' in inner && inner.name === 'promoEnabled',
        ),
    )
    const text = descriptionOf(group)
    const feliratok = quoted(text)
    expect(feliratok).toEqual(['Akciós ár', 'A kurzus fő előnyei', 'Kezdd el az akciós áron'])
    for (const felirat of feliratok) expect(promoSourceHasText(felirat), felirat).toBe(true)
    expect(text).toContain('itt nem írhatók át')
  })
})

describe('H24 (B13): a Részletes leírás kulcsszavas címsorai', () => {
  /** Minden idézett példacímsor → a szakasz, ahová a jegyzet szerint kerül. */
  const PELDA_CIMSOROK: Record<string, ReturnType<typeof classifyHeading>> = {
    'Kinek nem való': 'notFitFor',
    'Nem javasoljuk': 'notFitFor',
    Garancia: 'guarantee',
    'Gyakori kérdések': 'faq',
    GYIK: 'faq',
    'Kinek való': 'fitFor',
    'neked való': 'fitFor',
    'tökéletes számodra, ha': 'fitFor',
    '30 napos kipróbálási garancia': 'guarantee',
  }

  it('a jegyzet UI-mező, közvetlenül a Részletes leírás után, a Payload FieldDescription-jével', () => {
    const fields = allFields(collectionFields)
    const index = fields.findIndex((f) => 'name' in f && f.name === 'longDescription')
    const note = fields[index + 1]
    expect(note).toMatchObject({ name: 'reszletesLeirasCimsorai', type: 'ui' })
    expect(note.admin?.components?.Field).toEqual({
      path: '@payloadcms/ui#FieldDescription',
      clientProps: { description: RESZLETES_LEIRAS_CIMSORAI_SUGO, marginPlacement: 'bottom' },
    })
    const longDescription = descriptionOf(fields[index])
    expect(longDescription).toContain('„A kurzusról”')
    expect(longDescription).not.toMatch(DASHES)
  })

  it('minden idézet vagy ellenőrzött példacímsor, vagy betűre egy mező címkéje', () => {
    const labels = new Set(
      allFields(collectionFields).flatMap((f) =>
        'label' in f && typeof f.label === 'string' ? [f.label] : [],
      ),
    )
    for (const idezet of quoted(RESZLETES_LEIRAS_CIMSORAI_SUGO)) {
      const vart = PELDA_CIMSOROK[idezet]
      if (vart !== undefined) {
        expect(classifyHeading(idezet), idezet).toBe(vart)
      } else {
        expect(labels.has(idezet), `se példacímsor, se mezőcímke: „${idezet}”`).toBe(true)
      }
    }
    // Minden példacímsor szerepel is (a táblázat nem tartalmaz halott sort).
    for (const pelda of Object.keys(PELDA_CIMSOROK))
      expect(RESZLETES_LEIRAS_CIMSORAI_SUGO).toContain(`„${pelda}”`)
  })

  it('kimondja a mező elsőbbségét, a tartalék szabályait és a következményt', () => {
    for (const kulcsmondat of [
      'a következő, vele azonos vagy magasabb szintű címsorig tart',
      'a mező tartalma látszik, a leírás szakasza pedig sehol',
      'a szöveg a helyén marad',
      'Ingyenes kurzusnál a garancia-szakasz sehol nem jelenik meg',
      'első három sora pipás előny lesz, és a leírásban is megmarad',
      'visszateheti a szövegbe, vagy kiveheti a sávból',
    ])
      expect(RESZLETES_LEIRAS_CIMSORAI_SUGO).toContain(kulcsmondat)
    expect(RESZLETES_LEIRAS_CIMSORAI_SUGO).not.toMatch(DASHES)
  })
})

describe('H25, H23, H47, H34: az azonosító, a galéria és a képek súgója', () => {
  it('Belső azonosító: hol látszik, és mitől lesz igaz a „következő vásárlástól”', () => {
    const text = descriptionOf(field('sku'))
    for (const kulcsmondat of [
      'két kurzusnak nem lehet ugyanaz',
      'a számlán, a rendeléseken, a vásárlási visszaigazoló e-mailben és a Barion fizetőoldalán',
      'a következő vásárlástól látszik',
      'A weboldalon a fenti „Kurzus címe” látszik, ha ki van töltve, különben ez az azonosító.',
    ])
      expect(text).toContain(kulcsmondat)
    // A tény forrása: a rendelés létrehozásakor a sku pillanatképe készül, és
    // a számla, a levél és a Barion-tétel ezt a pillanatképet olvassa.
    const read = (path: string) => readFileSync(join(SRC, path), 'utf8')
    expect(read('lib/order-integrity.ts')).toContain('item.titleSnapshot = product.sku')
    expect(read('lib/order-integrity.ts')).toMatch(/operation !== 'create'/)
    expect(read('lib/szamlazz/invoice.ts')).toContain('megnevezes: item.titleSnapshot')
    expect(read('lib/order-paid.ts')).toContain('title: item.titleSnapshot')
    expect(read('lib/checkout/start-checkout.ts')).toContain('name: item.titleSnapshot')
  })

  it('Képgaléria: csak az első kép jelenik meg, a Részletes leírás után', () => {
    const text = descriptionOf(field('gallery'))
    expect(text).toContain('Jelenleg csak az első kép jelenik meg')
    expect(text).toContain('a Részletes leírás után')
    expect(text).toContain('A további képek megmaradnak, de nem látszanak.')
    expect(descriptionOf(field('gallery.image'))).toBe(KEP_CSERE_SUGO)
  })

  it('Borítókép és Megosztási kép: a tartaléklánc és a képcsere-súgó', () => {
    const cover = descriptionOf(field('coverImage'))
    expect(cover).toContain(
      'Ha a Megosztási kép üres, megosztáskor is ez látszik; ha ez is üres, a Kineticare alapképe (csapatfotó).',
    )
    expect(cover).toContain('a kurzusoldal tetején')
    expect(cover).toContain(
      'Kurzusaim), a kezdőlap alsó felhívás-sávjában és a kurzusoldal tetején látszik',
    )
    expect(cover.endsWith(KEP_CSERE_SUGO)).toBe(true)

    const og = descriptionOf(field('ogImage'))
    expect(og).toContain(
      'Ha üres, a Borítókép, annak híján a Kineticare alapképe (csapatfotó) látszik.',
    )
    expect(og.endsWith(KEP_CSERE_SUGO)).toBe(true)
  })

  it('a leírt lánc a kódé: Megosztási kép, majd Borítókép, majd az alapkép', () => {
    const base = {
      id: 1,
      sku: 'kurzus',
      displayTitle: null,
      shortDescription: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: null,
    }
    expect(
      resolveOgImageUrl(
        productSeoDoc({ ...base, ogImage: media('/og.jpg'), coverImage: media('/cover.jpg') }),
      ),
    ).toMatch(/\/og\.jpg$/)
    expect(
      resolveOgImageUrl(productSeoDoc({ ...base, ogImage: null, coverImage: media('/cover.jpg') })),
    ).toMatch(/\/cover\.jpg$/)
    // Mindkettő üres: nincs saját kép, a lap a DEFAULT_OG_IMAGE-et (csapatfotó) örökli.
    expect(resolveOgImageUrl(productSeoDoc({ ...base, ogImage: null, coverImage: null }))).toBe(
      undefined,
    )
  })

  it('egyik érintett súgó sem tartalmaz töltelék-gondolatjelet (U+2013, U+2014)', () => {
    for (const path of [
      'sku',
      'coverImage',
      'gallery',
      'gallery.image',
      'ogImage',
      'relatedProducts',
    ])
      expect(descriptionOf(field(path)), path).not.toMatch(DASHES)
  })
})
