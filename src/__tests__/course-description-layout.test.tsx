import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseDescriptionContent } from '../components/courses/promo/CourseDescriptionContent'
import {
  groupCourseDescription,
  type CourseDescriptionDocument,
} from '../lib/course-description-layout'

type Node = CourseDescriptionDocument['root']['children'][number]
const text = (value: string) => ({ type: 'text', version: 1, text: value, format: 1 })
const p = (value: string): Node => ({ type: 'paragraph', version: 1, children: [text(value)] })
const h = (tag: string, value: string): Node => ({
  type: 'heading',
  tag,
  version: 1,
  children: [text(value)],
})
const list: Node = {
  type: 'list',
  version: 1,
  listType: 'bullet',
  children: [{ type: 'listitem', version: 1, children: [text('LISTA_ELEM')] }],
}
const document = (children: Node[]): CourseDescriptionDocument => ({
  root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children },
})

describe('veszteségmentes kurzusleírás-kiosztás', () => {
  it('intro 2 hasáb, 4 alcsoport 2×2, 3 alcsoport 3 hasáb; minden csomópont eredeti sorrendben marad', () => {
    const nodes = [
      p('INTRO'),
      p('LISTA_BEVEZETO'),
      list,
      h('h2', 'Tetszőleges programcím'),
      ...Array.from({ length: 4 }, (_, i) => [h('h3', `MODUL_${i}`), p(`LEIRAS_${i}`)]).flat(),
      h('h2', 'Tetszőleges bónuszcím'),
      list,
      ...Array.from({ length: 3 }, (_, i) => [
        h('h3', `BONUSZ_${i}`),
        p(`BONUSZLEIRAS_${i}`),
      ]).flat(),
    ]
    const source = document(nodes)
    const before = JSON.stringify(source)
    Object.freeze(source.root.children)
    const sections = groupCourseDescription(source)
    expect(sections.map((section) => section.columns)).toEqual([2, 2, 3])
    expect(sections.map((section) => section.groups.length)).toEqual([2, 4, 3])
    const flattened = sections.flatMap((section) => [...section.lead, ...section.groups.flat()])
    expect(flattened).toHaveLength(nodes.length)
    flattened.forEach((node, i) => expect(node).toBe(nodes[i]))
    expect(JSON.stringify(source)).toBe(before)
    const html = renderToStaticMarkup(<CourseDescriptionContent content={source} />)
    expect(html).toContain('<strong>INTRO</strong>')
    expect(html.indexOf('MODUL_3')).toBeLessThan(html.indexOf('BONUSZ_0'))
    expect(html.match(/MODUL_0/g)).toHaveLength(1)
  })

  it.each([
    [h('h3', 'Árva alcím'), p('Szöveg')],
    [h('h2', 'Cím'), h('h4', 'Mélyebb alcím'), p('Szöveg')],
    [h('ismeretlen', 'Hibás címsor'), p('Szöveg')],
    [h('h2', 'Cím'), h('h3', 'Leírás nélkül')],
  ])('szokatlan címsorstruktúra egyhasábos, az eredeti tömbbel: %#', (...nodes) => {
    const source = document(nodes)
    const result = groupCourseDescription(source)
    expect(result).toEqual([{ lead: nodes, groups: [], columns: 1 }])
    expect(result[0].lead).toBe(source.root.children)
  })

  it('nem bont bizonytalan bevezetőt, és a linkek/formázások az eredeti renderelőn haladnak át', () => {
    const link: Node = {
      type: 'paragraph',
      version: 1,
      children: [
        {
          type: 'link',
          version: 1,
          fields: { url: '/kapcsolat', linkType: 'custom' },
          children: [text('Kapcsolat')],
        },
      ],
    }
    const source = document([p('Intro'), link])
    expect(groupCourseDescription(source)[0].columns).toBe(1)
    const html = renderToStaticMarkup(<CourseDescriptionContent content={source} />)
    expect(html).toContain('href="/kapcsolat"')
    expect(html).toContain('<strong>Kapcsolat</strong>')
  })
})
