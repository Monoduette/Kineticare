import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { coursePackage } from '../blocks/CoursePackage'
import { extractCoursePackage, parseCoursePackageNode } from '../lib/course-package'
import type { Product } from '../payload-types'

const block = (fields: Record<string, unknown> = {}) => ({
  type: 'block',
  version: 2,
  fields: {
    blockType: 'coursePackage',
    heading: 'A csomag tartalma',
    items: [{ icon: 'video', title: 'Videós tananyag', description: 'Saját tempóban.' }],
    ...fields,
  },
})

function content(children: unknown[]): NonNullable<Product['longDescription']> {
  return {
    root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children },
  } as NonNullable<Product['longDescription']>
}

describe('kurzuscsomag strukturált tartalma', () => {
  it('megőrzi a szöveget és csak rögzített ikonértéket ad tovább', () => {
    expect(
      parseCoursePackageNode(block({ items: [{ title: '  Eredeti cím  ', icon: '<svg>' }] })),
    ).toEqual({
      heading: 'A csomag tartalma',
      items: [{ icon: 'book', title: '  Eredeti cím  ', description: null }],
    })
  })

  it.each([
    null,
    {},
    { type: 'paragraph', fields: block().fields },
    block({ blockType: 'other' }),
    block({ heading: ' ' }),
    block({ items: [] }),
    block({ items: [{ title: '' }] }),
    block({ items: [{ title: 'Cím', description: {} }] }),
    block({ items: [{ title: 'Érvényes' }, null] }),
    block({ items: Array.from({ length: 13 }, () => ({ title: 'Cím' })) }),
  ])('hibás/idegen blokkot nem emel ki: %#', (node) => {
    expect(parseCoursePackageNode(node)).toBeNull()
    const document = content([node])
    expect(extractCoursePackage(document)).toEqual({ package: null, body: document })
    expect(extractCoursePackage(document).body).toBe(document)
  })

  it('csak az első érvényes felső szintű blokkot emeli ki, változtatás nélkül hagyja a többi csomópontot', () => {
    const nested = { type: 'paragraph', children: [block()] }
    const malformed = block({ items: [] })
    const second = block({ heading: 'Második csomag' })
    const paragraph = { type: 'paragraph', children: [{ type: 'text', text: 'Megmaradó szöveg' }] }
    const nodes = [nested, malformed, block(), second, paragraph]
    const document = content(nodes)
    const snapshot = JSON.stringify(document)
    Object.freeze(document.root.children)
    Object.freeze(document.root)
    Object.freeze(document)
    const result = extractCoursePackage(document)
    expect(result.package?.heading).toBe('A csomag tartalma')
    expect(result.body?.root.children).toEqual([nested, malformed, second, paragraph])
    expect(result.body?.root.children[0]).toBe(nested)
    expect(result.body?.root.children[1]).toBe(malformed)
    expect(result.body?.root.children[2]).toBe(second)
    expect(result.body?.root.children[3]).toBe(paragraph)
    expect(JSON.stringify(document)).toBe(snapshot)
  })

  it('üres leírás és csak beágyazott blokk esetén ugyanazt a törzset adja vissza', () => {
    expect(extractCoursePackage(null)).toEqual({ package: null, body: null })
    expect(extractCoursePackage(undefined)).toEqual({ package: null, body: undefined })
    const document = content([{ type: 'paragraph', children: [block()] }])
    expect(extractCoursePackage(document).body).toBe(document)
    expect(extractCoursePackage(document).package).toBeNull()
  })

  it('a CMS csak szöveget és rögzített ikonokat kínál, legfeljebb 12 elemmel', () => {
    expect(coursePackage.slug).toBe('coursePackage')
    expect(coursePackage.interfaceName).toBe('CoursePackageBlock')
    const items = coursePackage.fields.find((field) => 'name' in field && field.name === 'items')
    if (!items || items.type !== 'array') throw new Error('Hiányzik az items tömb')
    expect(items).toMatchObject({ required: true, minRows: 1, maxRows: 12 })
    expect(items.fields.map((field) => field.type)).toEqual(['select', 'text', 'textarea'])
    const icon = items.fields[0]
    if (icon.type !== 'select') throw new Error('Hiányzik az ikonválasztó')
    expect(icon.options).toEqual([
      { label: 'Lejátszás', value: 'play' },
      { label: 'Videó', value: 'video' },
      { label: 'Időtartam', value: 'clock' },
      { label: 'Pajzs', value: 'shield' },
      { label: 'Tananyag', value: 'book' },
      { label: 'Dokumentum', value: 'file' },
      { label: 'Szakemberek', value: 'users' },
    ])
  })

  it('a mező szerkesztője örökli a globális funkciókat, a blokk nem globális szerkesztőfunkció', () => {
    const source = readFileSync(new URL('../plugins/ecommerce.ts', import.meta.url), 'utf8')
    const local = source.slice(
      source.indexOf("name: 'longDescription'"),
      source.indexOf("name: 'salesHighlights'"),
    )
    expect(local).toContain('...rootFeatures')
    expect(local).toContain('BlocksFeature({ blocks: [coursePackage] })')
    expect(local).not.toContain('parentFeatures')
    const global = readFileSync(new URL('../payload.config.ts', import.meta.url), 'utf8')
    expect(global).toContain('...defaultFeatures, FixedToolbarFeature()')
    expect(global).not.toContain('coursePackage')
  })
})
