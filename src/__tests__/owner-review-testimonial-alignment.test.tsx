import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  TESTIMONIAL_OPENING_MARK,
  TestimonialsSection,
} from '../components/content/home/TestimonialsSection'
import type { Testimonial } from '../payload-types'

const css = readFileSync(
  new URL('../app/(frontend)/styles/blocks/testimonials.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('H11: az idézőjel, az idézet és az attribúció igazítása', () => {
  it('a kis idézőjel a törzs sormagasságán áll (közös alapvonal), nem a sor fölött', () => {
    // WP50: a jel a törzzsel azonos betű + M méret + leading-body → közös alapvonal.
    expect(css).toMatch(
      /\.kc-testimonials__item--small \.kc-testimonials__mark\s*\{[^}]*line-height: var\(--kc-leading-body\)/,
    )
    expect(css).toMatch(
      /\.kc-testimonials__item--small \.kc-testimonials__mark\s*\{[^}]*margin-top: 0;/,
    )
  })

  it('a #205 blokk-figurája saját magasságon, közös szövegoszlopban tartja a névsort', () => {
    const figure = css.match(
      /\.kc-testimonials__item--small \.kc-testimonials__figure\s*\{([^}]*)\}/,
    )?.[1]
    expect(figure).toContain('display: block;')
    expect(figure).toContain('position: relative;')
    expect(figure).toContain('box-sizing: border-box;')
    expect(figure).toContain('height: auto;')
    expect(figure).toContain(
      'padding-left: calc(var(--kc-testimonials-mark-col) + var(--kc-testimonials-mark-gap));',
    )
    expect(figure).not.toMatch(/flex|grid/)
  })

  it('a #205 abszolút jele és tartalomszéles névsora nem hozza vissza a flex-tördelést', () => {
    const mark = css.match(
      /\.kc-testimonials__item--small \.kc-testimonials__mark\s*\{([^}]*)\}/,
    )?.[1]
    expect(mark).toContain('position: absolute;')
    expect(mark).toContain('top: 0;')
    expect(mark).toContain('left: 0;')
    const attribution = css.match(
      /\.kc-testimonials__item--small \.kc-testimonials__attribution\s*\{([^}]*)\}/,
    )?.[1]
    expect(attribution).toContain('width: max-content;')
    expect(attribution).toContain('max-width: 100%;')
    expect(attribution).toContain('padding-left: 0;')
    expect(attribution).not.toContain('flex:')
  })

  it('WP50: a nagy jel a szöveg betűjével, L méretével és 1,18-as sormagasságával függ a margóban', () => {
    // A H11-es (2026-09-07) skálázott, felső 66-os jel „huncutnak" hatott; a
    // magyar alsó „ a szöveg első sorával közös alapvonalon áll: azonos betű
    // (Tenor Sans), azonos méret (L), azonos sormagasság (1,18), abszolút a
    // figure bal szélén, a szöveg 0,55 L behúzásában. Nincs transform, nincs
    // px, nincs negyedik font-size.
    const big = css.match(/\.kc-testimonials__item--big \.kc-testimonials__mark\s*\{([^}]*)\}/)?.[1]
    expect(big).toContain('position: absolute;')
    expect(big).toContain('left: 0;')
    expect(big).toContain('font-family: var(--kc-font-heading);')
    expect(big).toContain('font-size: var(--kc-font-l);')
    expect(big).toContain('line-height: 1.18;')
    expect(big).not.toMatch(/transform|scale|\b\d+px\b/)
    const figure = css.match(
      /\.kc-testimonials__item--big \.kc-testimonials__figure\s*\{([^}]*)\}/,
    )?.[1]
    expect(figure).toContain('position: relative;')
    expect(figure).toContain('padding-left: calc(var(--kc-font-l) * 0.55);')
    const text = css.match(
      /\.kc-testimonials__item--big \.kc-testimonials__text\s*\{([^}]*)\}/,
    )?.[1]
    expect(text).toContain('line-height: 1.18;')
  })

  it('WP50: a kis jel a törzs M méretén, skálázás nélkül; az oszlop a jel szélessége', () => {
    const small = css.match(
      /\.kc-testimonials__item--small \.kc-testimonials__mark\s*\{([^}]*)\}/,
    )?.[1]
    expect(small).toContain('font-size: var(--kc-font-m);')
    expect(small).not.toMatch(/transform|scale|translate|\b\d+px\b/)
    expect(css).toMatch(
      /\.kc-testimonials__item--small\s*\{[^}]*--kc-testimonials-mark-col: calc\(var\(--kc-font-m\) \* 0\.55\);/,
    )
  })

  it('WP50: a jel a magyar alsó „ (U+201E), nem a felső 66-os', () => {
    expect(TESTIMONIAL_OPENING_MARK).toBe('„')
  })

  it.each([1, 2, 3])('%i idézetnél megmarad a szöveg, a név és a szemantika', (count) => {
    const testimonials = Array.from(
      { length: count },
      (_, index) =>
        ({
          id: index + 1,
          featured: true,
          visible: true,
          authorName: `Tesztelő ${index + 1}`,
          quote: `Tesztidézet ${index + 1}`,
        }) as Testimonial,
    )
    const html = renderToStaticMarkup(createElement(TestimonialsSection, { testimonials }))
    expect([...html.matchAll(/<blockquote\b/g)]).toHaveLength(count)
    expect([...html.matchAll(/<figcaption\b/g)]).toHaveLength(count)
    expect([...html.matchAll(/aria-hidden="true" class="kc-testimonials__mark"/g)]).toHaveLength(
      count,
    )
    for (const testimonial of testimonials) {
      expect(html).toContain(testimonial.quote)
      expect(html).toContain(testimonial.authorName)
    }
  })
})
