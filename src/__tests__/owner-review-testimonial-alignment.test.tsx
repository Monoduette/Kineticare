import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TestimonialsSection } from '../components/content/home/TestimonialsSection'
import type { Testimonial } from '../payload-types'

const css = readFileSync(
  new URL('../app/(frontend)/styles/blocks/testimonials.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('H11: az idézőjel, az idézet és az attribúció igazítása', () => {
  it('a kis idézőjel sormagassága nem nyomja a jelet a törzssor fölé', () => {
    expect(css).toMatch(
      /\.kc-testimonials__item--small \.kc-testimonials__mark\s*\{[^}]*line-height: var\(--kc-leading-tight\)/,
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
