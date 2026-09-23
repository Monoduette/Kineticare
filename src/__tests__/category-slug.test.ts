import type { Field, FieldHook, TextField } from 'payload'
import { describe, expect, it } from 'vitest'

import { Categories } from '../collections/Categories'
import { slugField } from '../fields/slug'
import configPromise from '../payload.config'

/**
 * Categories auto-slug (A3).
 *
 * A kategóriák korábban kézi text slugot használtak: a szerkesztőnek magának
 * kellett webcímet írnia, és ha ékezetesen tette, törött URL keletkezett. A mező
 * mostantól a Pages/Posts-szal közös `slugField('title')` factoryból jön — ez a
 * teszt őrzi, hogy a slug a címből generálódjon, a kézi érték megmaradjon, és
 * hogy az oszlop-tulajdonságok (required, unique) ne változzanak (séma-stabilitás).
 */

type NamedField = Field & { name?: string }

const findSlugField = (fields: Field[]): TextField => {
  const field = (fields as NamedField[]).find((candidate) => candidate.name === 'slug')
  if (!field || field.type !== 'text') {
    throw new Error('A categories collectionben nincs text típusú slug mező.')
  }
  return field
}

const categorySlugField = findSlugField(Categories.fields)

/** A generáló hook a beforeValidate lánc első eleme (lásd src/fields/slug.ts). */
const generateSlug = (categorySlugField.hooks?.beforeValidate ?? [])[0] as FieldHook

type FieldHookArgs = Parameters<FieldHook>[0]

const runGenerate = (args: { data?: Record<string, unknown>; value?: unknown }): unknown =>
  generateSlug(args as unknown as FieldHookArgs)

describe('Categories: slug generálása a címből', () => {
  it('üres slug esetén a címből generál (ékezet nélkül, kötőjelesen)', () => {
    expect(runGenerate({ data: { title: 'Kézrehabilitáció' }, value: undefined })).toBe(
      'kezrehabilitacio',
    )
  })

  it('a magyar ő/ű betűket is kezeli, a többszavas címet elválasztja', () => {
    expect(runGenerate({ data: { title: 'Ősszel az Űrben' }, value: '' })).toBe('osszel-az-urben')
  })

  it('csak szóközből álló slug is generálásra kerül', () => {
    expect(runGenerate({ data: { title: 'Kéztorna otthon' }, value: '   ' })).toBe(
      'keztorna-otthon',
    )
  })

  it('a kézzel megadott slug megmarad (nem írja felül a cím)', () => {
    expect(
      runGenerate({ data: { title: 'Kézrehabilitáció' }, value: 'sajat-webcim' }),
    ).toBe('sajat-webcim')
  })

  it('a kézi slugot is URL-barát alakra hozza (ékezet, nagybetű, szóköz)', () => {
    expect(runGenerate({ data: { title: 'Bármi' }, value: 'Saját Webcím' })).toBe('sajat-webcim')
  })

  it('cím és slug nélkül a kapott értéket adja vissza (nem talál ki webcímet)', () => {
    expect(runGenerate({ data: {}, value: undefined })).toBeUndefined()
    expect(runGenerate({ data: { title: '   ' }, value: null })).toBeNull()
    expect(runGenerate({ value: undefined })).toBeUndefined()
  })
})

describe('Categories: a slug mező tulajdonságai', () => {
  it('a közös slugField factoryból jön (a Pages/Posts-szal azonos alak)', () => {
    const shared = slugField('title')

    expect(categorySlugField.name).toBe(shared.name)
    expect(categorySlugField.type).toBe(shared.type)
    expect(categorySlugField.required).toBe(shared.required)
    expect(categorySlugField.unique).toBe(shared.unique)
  })

  it('required + unique (a séma nem változik a korábbi kézi mezőhöz képest)', () => {
    expect(categorySlugField.required).toBe(true)
    expect(categorySlugField.unique).toBe(true)
  })

  it('magyar label és laikusnak szóló leírás', () => {
    // K40: a „slug” zsargon kikerült a címkéből (a közös slugField adja).
    expect(categorySlugField.label).toBe('Webcím')
    expect(categorySlugField.admin?.description).toContain('magától kitöltődik')
  })

  it('a duplikálás-kezelő hook is a helyén van', () => {
    expect(categorySlugField.hooks?.beforeDuplicate?.length).toBeGreaterThan(0)
  })

  it('a végleges configban is a generáló hookkal szerepel', async () => {
    const config = await configPromise
    const categories = (config.collections ?? []).find(
      (collection) => collection.slug === 'categories',
    )

    expect(categories).toBeDefined()
    const slug = findSlugField(categories?.fields ?? [])
    expect(slug.unique).toBe(true)
    expect(slug.hooks?.beforeValidate?.length).toBeGreaterThan(0)
  })
})
