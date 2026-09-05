import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { transform as minifyCss } from 'lightningcss'
import { describe, expect, it } from 'vitest'

import { TESTIMONIAL_OPENING_MARK } from '../components/content/home/TestimonialsSection'

/**
 * ŐR — a 2026-08-26-i tulajdonosi mockup (Pácienseink mondták + Így tudunk
 * segíteni). A tükör paddingját, betűcsaládját, idézőjelét és a fotó fátylát
 * egy későbbi, jó szándékú szerkesztés könnyen visszavinné a 2026-08-17-i
 * Nunito-700 / alsó-9 állapotra. Forrás: NN/g Visual Hierarchy (type contrast),
 * WCAG 2.2 SC 1.4.3 Incidental a dekoratív jelre, Apple HIG Layout a fátyolra.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(join(REPO, relativUt), 'utf8')

const kommentNelkul = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')

function szabalyTorzs(css: string, szelektor: string): string {
  const tiszta = kommentNelkul(css)
  const kezdet = tiszta.indexOf(`${szelektor} {`)
  if (kezdet < 0) {
    throw new Error(`Nincs ilyen szabály: ${szelektor}`)
  }
  const vege = tiszta.indexOf('}', kezdet)
  return tiszta.slice(kezdet, vege)
}

const testimonialsCss = olvas('app/(frontend)/styles/blocks/testimonials.css')
const servicesCss = olvas('app/(frontend)/styles/blocks/services.css')
const testimonialsTsx = olvas('components/content/home/TestimonialsSection.tsx')

describe('Pácienseink mondták — tükör-szerződés', () => {
  it('a dekoratív nyitó jel a magas 66-os idézőjel (U+201C), nem a magyar alsó-9', () => {
    expect(TESTIMONIAL_OPENING_MARK).toBe('\u201C')
    expect(testimonialsTsx).toContain("TESTIMONIAL_OPENING_MARK = '\\u201C'")
    expect(testimonialsTsx).toContain('{TESTIMONIAL_OPENING_MARK}')
  })

  it('a kiemelt idézőjel az L tokenen áll, a vizuális méretet scale viszi', () => {
    const jel = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__item--big .kc-testimonials__mark',
    )
    expect(jel).toContain('font-size: var(--kc-font-l)')
    expect(jel).toContain('transform: scale(2.05)')
    expect(jel).toContain('font-family: var(--kc-font-heading)')
  })

  it('a kis idézőjel is L méretű szerif díszjel (függő, nem M törzs)', () => {
    const jel = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__item--small .kc-testimonials__mark',
    )
    expect(jel).toContain('font-size: var(--kc-font-l)')
    expect(jel).toContain('font-family: var(--kc-font-heading)')
  })

  it('a kis idézet törzse ink, nem muted (a mockup navy, mint a kiemelt)', () => {
    const szoveg = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__item--small .kc-testimonials__text',
    )
    expect(szoveg).toContain('color: var(--kc-testimonials-ink)')
    expect(szoveg).not.toContain('--kc-testimonials-muted')
  })

  it('a névsor S méretű, a hajszálvonal a név szélességét viszi', () => {
    const nev = szabalyTorzs(testimonialsCss, '.kc-testimonials .kc-testimonials__attribution')
    expect(nev).toContain('width: max-content')
    expect(nev).toContain('font-size: var(--kc-font-s)')
    expect(nev).toContain('padding-top: 0')

    const vonal = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__attribution::before',
    )
    expect(vonal).toContain('width: 100%')
    expect(vonal).toContain('margin-bottom: var(--kc-space-4)')
    expect(vonal).not.toContain('margin-bottom: var(--kc-space-3)')
    expect(vonal).toContain('background-color: var(--kc-testimonials-ink)')

    expect(kommentNelkul(testimonialsCss)).toMatch(
      /\.kc-testimonials \.kc-testimonials__cite,[\s\S]*?font-size: var\(--kc-font-s\)/,
    )
  })

  it('a kis kártya névsora a törzzsel egy vonalban marad, nem a jel-oszlopban', () => {
    const figura = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__item--small .kc-testimonials__figure',
    )
    expect(figura).toContain('display: block')
    expect(figura).toContain('position: relative')
    expect(figura).toContain('height: auto')
    expect(figura).toContain(
      'padding-left: calc(var(--kc-testimonials-mark-col) + var(--kc-testimonials-mark-gap))',
    )
    expect(figura).not.toContain('display: grid')
    expect(figura).not.toContain('display: flex')
    expect(kommentNelkul(testimonialsCss)).not.toMatch(
      /\.kc-testimonials__item--small \.kc-testimonials__figure\{[^}]*flex-flow:wrap[;}]/,
    )

    const jel = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__item--small .kc-testimonials__mark',
    )
    expect(jel).toContain('position: absolute')
    expect(jel).toContain('left: 0')

    const nev = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__item--small .kc-testimonials__attribution',
    )
    expect(nev).toContain('padding-left: 0')
    expect(nev).toContain('padding-bottom: var(--kc-space-5)')
    expect(kommentNelkul(testimonialsCss)).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.kc-section\.kc-board\.kc-board--edge\.kc-testimonials \{[\s\S]*?padding-bottom: var\(--kc-space-5\)/,
    )
    expect(nev).toContain('min-width: 0')
    expect(nev).toContain('width: max-content')
    expect(nev).not.toContain('width: auto')
    expect(nev).not.toContain('white-space: nowrap')
    expect(nev).not.toContain('grid-column:')
    expect(nev).not.toContain('flex:')

    expect(kommentNelkul(testimonialsCss)).toContain(
      '.kc-testimonials .kc-testimonials__cite:has(+ .kc-testimonials__role)::after',
    )
    const vesszo = szabalyTorzs(
      testimonialsCss,
      '.kc-testimonials .kc-testimonials__cite:has(+ .kc-testimonials__role)::after',
    )
    expect(vesszo).toContain("content: ','")
  })

  it('a kis figure LightningCSS minify után is blokkelrendezésű marad', () => {
    // A #204 `flex-direction: row` + `flex-wrap: wrap` productionben
    // `flex-flow: wrap` lett (a row alapérték). Ez az őr nem állít történeti
    // böngésző-gyökérokot: azt védi, hogy az új layout ne függjön a content.css
    // flex longhandje és a minifikált shorthand kölcsönhatásától.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/flex-flow
    const { code } = minifyCss({
      filename: 'testimonials.css',
      code: Buffer.from(testimonialsCss),
      minify: true,
    })
    const minified = Buffer.from(code).toString('utf8')
    expect(minified).toMatch(
      /\.kc-testimonials \.kc-testimonials__item--small \.kc-testimonials__figure\{[^}]*display:block/,
    )
    expect(minified).not.toMatch(
      /\.kc-testimonials__item--small \.kc-testimonials__figure\{[^}]*flex-flow:wrap/,
    )
    expect(minified).not.toMatch(
      /\.kc-testimonials__item--small \.kc-testimonials__figure\{[^}]*display:flex/,
    )
  })
})

describe('Így tudunk segíteni — tükör-szerződés', () => {
  it('a sorszám sans-serif UI-jel, a sor-cím szerif display', () => {
    const szam = szabalyTorzs(servicesCss, '.kc-services__num')
    expect(szam).toContain('font-family: var(--kc-font-body)')
    expect(szam).toContain('color: var(--kc-services-accent-text)')

    const cim = szabalyTorzs(servicesCss, '.kc-services__row-title')
    expect(cim).toContain('font-family: var(--kc-font-heading)')
    expect(cim).toContain('font-weight: var(--kc-font-weight-normal)')
    expect(cim).toContain('font-size: var(--kc-font-l)')
  })

  it('a fotó a szekció hátterébe simul (fátyol + alsó-bal vágás)', () => {
    const kep = szabalyTorzs(servicesCss, '.kc-services__media img')
    expect(kep).toContain('object-position: 22% 72%')

    const fatyol = szabalyTorzs(servicesCss, '.kc-services__media::after')
    expect(fatyol).toContain('position: absolute')
    expect(fatyol).toContain('linear-gradient')
    expect(fatyol).toContain('var(--kc-services-fade)')
  })

  it('a sor belső ritmusa a tükör space-6 paddingja', () => {
    const sor = szabalyTorzs(servicesCss, '.kc-services__row')
    expect(sor).toContain('padding: var(--kc-space-6) 0')
  })
})
