/**
 * A Kurzusok szerkesztőjének tömbsor-címkéi (modul-térkép H13, B3).
 *
 * Összecsukott sorban a Payload „Kérdés 01”, „Sor 03” feliratot adna; a közös
 * ArrayRowLabel az első kitöltött cím-mezőt mutatja. Az őr a
 * productsCollectionOverride tényleges kimenetét járja be (a
 * course-editor-bindings.test.ts `runtime.override` mintája), így egy új,
 * címke nélküli tömb vagy egy elgépelt cím-mező azonnal bukik.
 */
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

import { ecommerce } from '../plugins/ecommerce'

const ARRAY_ROW_LABEL = '/components/admin/SectionRowLabel#ArrayRowLabel'

type ArrayFieldShape = Extract<Field, { type: 'array' }>

/** Minden tömbmező a teljes mezőfában, pontozott útvonallal (a fülek és a név nélküli csoportok átlátszók). */
function arrayFields(fields: readonly Field[], prefix = ''): Map<string, ArrayFieldShape> {
  const result = new Map<string, ArrayFieldShape>()
  for (const field of fields) {
    const named = 'name' in field && typeof field.name === 'string' && field.name.length > 0
    const path = named ? `${prefix}${field.name}` : prefix
    if (field.type === 'array') {
      result.set(path, field)
    }
    if ('fields' in field && Array.isArray(field.fields)) {
      for (const [key, value] of arrayFields(field.fields, named ? `${path}.` : prefix)) {
        result.set(key, value)
      }
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        for (const [key, value] of arrayFields(tab.fields, prefix)) {
          result.set(key, value)
        }
      }
    }
  }
  return result
}

function rowLabelOf(field: ArrayFieldShape): unknown {
  return field.admin?.components?.RowLabel
}

function subFieldNames(field: ArrayFieldShape): string[] {
  return field.fields.flatMap((inner) =>
    'name' in inner && typeof inner.name === 'string' ? [inner.name] : [],
  )
}

let arrays: Map<string, ArrayFieldShape>

beforeAll(async () => {
  await ecommerce({ collections: [] } as unknown as Config)
  const collection = await runtime.override!({
    defaultCollection: { slug: 'products', fields: [] },
  })
  arrays = arrayFields(collection.fields)
})

/** A B3-ban bekötött címkék: mezőnév → várt clientProps (a leírás H13 szerinti kiosztása). */
const VART_CIMKEK: Record<
  string,
  { singular: string; titleFields: string[]; imageField?: string; subFields: string[] }
> = {
  cardHighlights: { singular: 'Előny', titleFields: ['text'], subFields: ['text'] },
  salesHighlights: { singular: 'Előny', titleFields: ['text'], subFields: ['text'] },
  howItWorks: { singular: 'Lépés', titleFields: ['title', 'text'], subFields: ['title', 'text'] },
  fitFor: { singular: 'Sor', titleFields: ['text'], subFields: ['text'] },
  notFitFor: { singular: 'Sor', titleFields: ['text'], subFields: ['text'] },
  faq: { singular: 'Kérdés', titleFields: ['question'], subFields: ['question', 'answer'] },
  gallery: { singular: 'Kép', titleFields: [], imageField: 'image', subFields: ['image'] },
  videos: {
    singular: 'Videó',
    titleFields: ['title'],
    subFields: ['title', 'streamAssetId', 'durationSec', 'status'],
  },
}

/**
 * Ismert, NEM ebben a csomagban javítható hiány: a leckék „Letölthető anyagok”
 * tömbje a src/fields/course-modules.ts-ben él (más fájl-tulajdonos). Ha
 * valaki címkét ad neki, a teszt jelzi, hogy innen törölni kell.
 */
const ISMERT_HIANY = new Set(['modules.lessons.attachments'])

describe('Kurzusok: minden tömbsor beszédes címkét kap (H13)', () => {
  it('a bejárás a várt tömböket találja meg (nem üres, nem csúszott el)', () => {
    for (const name of [...Object.keys(VART_CIMKEK), 'seoKeywords', 'modules', 'modules.lessons'])
      expect(arrays.has(name), name).toBe(true)
  })

  it('minden tömbnek van RowLabel-je (a tananyag saját Modul/Lecke-címkéje is elfogadott)', () => {
    const hianyzik = [...arrays.entries()]
      .filter(([, field]) => rowLabelOf(field) === undefined)
      .map(([path]) => path)
    expect(new Set(hianyzik)).toEqual(ISMERT_HIANY)
  })

  it.each(Object.entries(VART_CIMKEK))(
    '%s: a közös ArrayRowLabel a kiírt cím-mezőkkel, a séma változatlan',
    (name, vart) => {
      const field = arrays.get(name)!
      expect(field.type).toBe('array')
      expect(field.name).toBe(name)
      expect(subFieldNames(field)).toEqual(vart.subFields)
      expect(rowLabelOf(field)).toEqual({
        path: ARRAY_ROW_LABEL,
        clientProps: {
          singular: vart.singular,
          titleFields: vart.titleFields,
          ...(vart.imageField === undefined ? {} : { imageField: vart.imageField }),
        },
      })
      // A cím-mező és a képmező valóban a sor mezője: elgépelésnél a címke
      // csendben mindig „(még üres)” lenne.
      for (const cim of vart.titleFields) expect(subFieldNames(field), cim).toContain(cim)
      if (vart.imageField !== undefined) expect(subFieldNames(field)).toContain(vart.imageField)
    },
  )

  it('a címke egyes számú neve a tömb saját egyes számú feliratával egyezik', () => {
    for (const [name, vart] of Object.entries(VART_CIMKEK)) {
      const labels = arrays.get(name)!.labels
      expect(labels?.singular, name).toBe(vart.singular)
    }
  })

  it('a tananyag a saját Modul- és Lecke-címkéjét tartja meg', () => {
    expect(rowLabelOf(arrays.get('modules')!)).toBe(
      '/components/admin/CurriculumRowLabels#ModuleRowLabel',
    )
    expect(rowLabelOf(arrays.get('modules.lessons')!)).toBe(
      '/components/admin/CurriculumRowLabels#LessonRowLabel',
    )
  })
})
