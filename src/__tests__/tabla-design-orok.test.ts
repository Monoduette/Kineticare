import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    expect(vonal).toContain('background-color: var(--kc-testimonials-ink)')

    expect(kommentNelkul(testimonialsCss)).toMatch(
      /\.kc-testimonials \.kc-testimonials__cite,[\s\S]*?font-size: var\(--kc-font-s\)/,
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
