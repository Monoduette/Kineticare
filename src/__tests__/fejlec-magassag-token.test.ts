import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A `--kc-header-height` token a VALÓDI fejlécsáv magassága (tokens.css).
 *
 * Bejelentett hiba (2026-09-23, iPhone, álló és fekvő nézet): a token minden
 * szélességen 4.5rem volt, a mobil sáv viszont 3.5rem. A kezdőlapi film
 * haladáscsíkja (film-hero.css, `top: var(--kc-header-height)`) így mobilon
 * 16 px-szel a fejléc alatt futott, és a sávban középen ülő logó fentebb
 * ülőnek látszott. Az őr azt rögzíti, hogy a token mobilon a sáv mobil
 * magasságával, 900 px-től az asztalival egyezzen.
 */

const olvas = (relativ: string) =>
  readFileSync(fileURLToPath(new URL(relativ, import.meta.url)), 'utf8')

const tokens = olvas('../app/(frontend)/styles/tokens.css')
const layout = olvas('../app/(frontend)/styles/layout.css')
const filmHero = olvas('../app/(frontend)/styles/blocks/film-hero.css')

describe('a fejléc-magasság token a valódi sávot követi', () => {
  it('mobilon 3.5rem, 900 px-től 4.5rem', () => {
    const alap = tokens.indexOf('--kc-header-height: 3.5rem;')
    const asztal = tokens.search(
      /@media \(min-width: 900px\)\s*\{\s*:root\s*\{\s*--kc-header-height:\s*4\.5rem;\s*\}\s*\}/,
    )
    expect(alap).toBeGreaterThan(-1)
    expect(asztal).toBeGreaterThan(alap)
    expect(tokens.match(/--kc-header-height:/g)).toHaveLength(2)
  })

  it('a mobil sáv és a film felhúzása ugyanazt a 3.5rem-et használja', () => {
    expect(layout).toMatch(/\.kc-site-header__bar\s*\{[^}]*min-height:\s*3\.5rem;/)
    expect(filmHero).toMatch(/main > \.kc-film-hero:first-of-type\s*\{\s*margin-top:\s*-3\.5rem;/)
  })

  it('a film haladáscsíkja a fejléc aljához, a tokenhez igazodik', () => {
    expect(filmHero).toMatch(
      /\.kc-film-hero \.scroll-scrub__progress\s*\{\s*top:\s*var\(--kc-header-height\);/,
    )
  })
})
