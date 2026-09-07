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

  it('H11 (2026-09-07): a nagy jel doboza a skálázott tinta, a talpa a nagybetű-vonalon áll', () => {
    // Tenor Sans U+201C tinta: 0,45–0,725 em (0,275 em) → ×2,05 ≈ 0,56 L.
    // lh 0,775: (lh − 1,175)/2 + 0,925 − 0,725 = 0 → a tinta teteje a doboz teteje.
    // Az első sor cap-vonala 0,2 L-re van a sordoboz tetejétől; −0,1 L margó
    // → 0,1 L optikai rés (mérve 1440 px: 4,0 px; 390 px: 2,5 px).
    const big = css.match(/\.kc-testimonials__item--big \.kc-testimonials__mark\s*\{([^}]*)\}/)?.[1]
    expect(big).toContain('height: calc(var(--kc-font-l) * 0.56);')
    expect(big).toContain('margin: 0 0 calc(var(--kc-font-l) * -0.1);')
    expect(big).toContain('line-height: 0.775;')
    expect(big).toContain('transform-origin: left top;')
    expect(big).not.toMatch(/\b\d+px\b/)
  })

  it('H11 (2026-09-07): a kis jel a törzs cap-height-jére skálázódik, px-eltolás nélkül', () => {
    // 0,275 em × 1,3 ≈ 0,36 L ≈ 14 px = az M-es törzs cap-height-je (0,737 × 19 px).
    // A tinta teteje 0,244 L ≈ a cap-vonal 0,41 M + 2 px figure-eltolás (mérve
    // 1440 px: −0,1 px; 390 px: −0,8 px). Nem új font-size: L token + scale.
    const small = css.match(
      /\.kc-testimonials__item--small \.kc-testimonials__mark\s*\{([^}]*)\}/,
    )?.[1]
    expect(small).toContain('transform: scale(1.3);')
    expect(small).toContain('transform-origin: left top;')
    expect(small).toContain('font-size: var(--kc-font-l);')
    expect(small).not.toMatch(/translate|\b\d+px\b/)
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
