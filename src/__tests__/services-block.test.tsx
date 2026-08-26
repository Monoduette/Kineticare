import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Services } from '../components/blocks/Services'
import { buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'
import type { BlockServices } from '../payload-types'

/**
 * SZOLGÁLTATÁS-TÁBLA (Services) — a 2026-08-16-i tulajdonosi hibajelzés két
 * regressziós őre, plusz a tábla stíluslap-szerződései.
 * A tábla bal hasábjában a fotó ABSZOLÚT pozicionálva ült a hasáb alsó 70%-án,
 * a cím pedig `z-index: 2`-vel fölé rajzolódott, 7,2ch-s mértékkel és a
 * `--kc-text-board-6xl` lépcsővel — mindkettő a tükör HÁROM SZAVAS címére
 */

const cssFajl = (nev: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../app/(frontend)/styles/blocks/${nev}`, import.meta.url)),
    'utf8',
  )

/** Egy szelektor ÖSSZES szabálytörzse (a töréspont-változatok is). */
function szabalyTorzsek(css: string, szelektor: string): string[] {
  const torzsek: string[] = []
  let honnan = 0
  for (;;) {
    const kezdet = css.indexOf(`${szelektor} {`, honnan)
    if (kezdet < 0) break
    const vege = css.indexOf('}', kezdet)
    torzsek.push(css.slice(kezdet, vege))
    honnan = vege
  }
  if (torzsek.length === 0) {
    throw new Error(`Nincs ilyen szabály a stíluslapon: ${szelektor}`)
  }
  return torzsek
}

/** Egy szelektor első szabálytörzse. */
const szabalyTorzs = (css: string, szelektor: string): string => szabalyTorzsek(css, szelektor)[0]

function block(overrides: Partial<BlockServices> = {}): BlockServices {
  return {
    id: 'sz1',
    blockType: 'services',
    eyebrow: 'Szolgáltatásaink',
    title: 'Így tudunk segíteni',
    image: null,
    rows: [{ id: 's1', number: '01', title: 'Rendelői kezelések', body: 'Szöveg.' }],
    sectionSettings: { visible: true },
    ...overrides,
  } as unknown as BlockServices
}

const render = (b: BlockServices): string =>
  renderToStaticMarkup(createElement(Services, { block: b }))

describe('Services — cím-fokozat hosszú CMS-címnél', () => {
  it('a tükör rövid címe a nagy tábla-lépcsőn marad (a kezdőlap változatlan)', () => {
    const markup = render(block({ title: 'Így tudunk segíteni' }))

    expect(markup).toContain('class="kc-services__title"')
    expect(markup).not.toContain('kc-services__title--long')
  })

  it('a hosszú cím megkapja a kisebb fokozat módosítóját', () => {
    const markup = render(block({ title: 'Válaszd ki, hogyan segíthetünk neked a legjobban' }))

    expect(markup).toContain('kc-services__title--long')
  })

  it('az ÉLŐ /szolgaltatasok szekciósorának címe a hosszú fokozatba esik', () => {
    const services = buildSzolgaltatasokLayout().find((b) => b.blockType === 'services')
    if (services?.blockType !== 'services') {
      throw new Error('A szolgáltatás-szekció hiányzik a szekciósorból.')
    }

    expect(render(services as unknown as BlockServices)).toContain('kc-services__title--long')
  })

  it('a cím nélküli blokk nem kap üres címsort (a sorok maradnak)', () => {
    const markup = render(block({ title: '', eyebrow: '' }))

    expect(markup).not.toContain('kc-services__title')
    expect(markup).toContain('kc-services__row')
  })
})

describe('services.css — a rácsúszás és a sorprés őrei', () => {
  const css = cssFajl('services.css')

  it('a fotó a NORMÁL FOLYAMBAN áll (nincs kiemelt, átfedő doboz)', () => {
    // A régi megoldásban a hasáb `position: relative` volt, a fotó pedig
    // abszolút, a hasáb alsó 70%-án — így a hosszú cím ráfolyhatott. Most a
    // hasáb flex-oszlop, a fotó a cím ALATT, a maradék helyen áll. (A kép a
    // saját dobozán belül továbbra is abszolút — az nem okozhat átfedést.)
    for (const torzs of szabalyTorzsek(css, '.kc-services__lead')) {
      expect(torzs).not.toContain('position:')
    }
    for (const torzs of szabalyTorzsek(css, '.kc-services__media')) {
      expect(torzs).not.toContain('position: absolute')
      expect(torzs).not.toContain('height: 70%')
    }
    expect(css).toContain('flex-direction: column')
  })

  it('a cím és a felirat nem emel stacking contextet (nincs mit „fölé" rajzolni)', () => {
    expect(szabalyTorzs(css, '.kc-services__title')).not.toContain('z-index')
    expect(szabalyTorzs(css, '.kc-services__eyebrow')).not.toContain('z-index')
  })

  it('a hosszú cím fokozata csak a mértéket bővíti, betűméretet nem ír felül', () => {
    const hosszu = szabalyTorzs(css, '.kc-services__title--long')

    // A három-méretes skála (tokens.css) világában a fokozat NEM válthat
    // méretet: a cím a közös L lépcsőn marad, a rácsúszást a szerkezeti
    // javítás zárja ki. A módosító dolga a bővebb sortörés-keret.
    expect(hosszu).toContain('max-width: 16ch')
    expect(hosszu).not.toContain('font-size')
    // Elemre írt px/rem betűméret az egész stíluslapon tilos (UX-skill 4. pont);
    // minden méret a három-méretes skála tokenje (--kc-font-l/m/s).
    for (const sor of css.split('\n').filter((s) => s.includes('font-size:'))) {
      expect(sor).toMatch(/font-size:\s*var\(--kc-font-(l|m|s)\)/)
    }
  })

  it('a sorlista magassága MINIMUM, a sávok nem nyomhatók a tartalom alá', () => {
    const lista = szabalyTorzs(css, '.kc-services__list')

    expect(css).toContain('min-height: min(82%, 42rem)')
    expect(css).not.toContain('height: min(82%, 42rem)\n')
    expect(css).toContain('grid-auto-rows: 1fr')
    expect(css).not.toContain('grid-auto-rows: minmax(0, 1fr)')
    expect(lista).not.toContain('min-height: 0')
  })

  it('a sor megtartja a saját belső margóját (nincs min-height: 0 kiskapu)', () => {
    const sor = szabalyTorzs(css, '.kc-services__row')

    expect(sor).toContain('padding: var(--kc-space-5) 0')
    expect(sor).not.toContain('min-height: 0')
  })

  it('a hosszú szó megtörik, nem vágja le a szekció (WCAG 1.4.10 Reflow)', () => {
    expect(szabalyTorzs(css, '.kc-services__title')).toContain('overflow-wrap: break-word')
  })
})

describe('welcome.css — a keskeny nézet őre', () => {
  const css = cssFajl('welcome.css')

  it('az üdvözlő cím hosszú szava megtörik (320 px-en a lap nem görgethető oldalra)', () => {
    expect(szabalyTorzs(css, '.kc-welcome__title')).toContain('overflow-wrap: break-word')
  })
})
