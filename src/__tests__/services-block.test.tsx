import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Services } from '../components/blocks/Services'
import { HOME_HELP_LEAD, HOME_HELP_STATES, HOME_HELP_TITLE } from '../lib/home-help-states'
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

describe('Services — három összehasonlítható út', () => {
  it('az álló fotót nem zsugorítja fekvő képarányú keretbe', () => {
    const css = cssFajl('services.css')
    expect(szabalyTorzs(css, '.kc-services--choices .kc-services__media')).toContain(
      'aspect-ratio: auto',
    )
    expect(szabalyTorzs(css, '.kc-services--choices .kc-services__media img')).toContain(
      'height: auto',
    )
    expect(szabalyTorzs(css, '.kc-services--photo .kc-services__media img')).toContain(
      'width: 100%',
    )
  })
  it('a lusta fotó helyét a feldolgozott kép aránya már betöltés előtt meghatározza', () => {
    const markup = render(
      block({
        image: {
          id: 1,
          url: '/photo.webp',
          alt: 'Közös szakmai fotó',
          width: 1600,
          height: 2400,
          sizes: { lg: { url: '/photo-lg.webp', width: 800, height: 1000 } },
        } as BlockServices['image'],
      }),
    )
    expect(markup).toContain('--kc-services-image-ratio:0.8')
    const imageRule = szabalyTorzs(
      cssFajl('services.css'),
      '.kc-services--photo .kc-services__media img',
    )
    expect(imageRule).toContain('width: 100%')
    expect(imageRule).toContain('max-width: calc(34rem * var(--kc-services-image-ratio, 1))')
  })
  it('három érvényes sor háromrészes elrendezést kap, a CMS-linkek megmaradnak', () => {
    const rows = [
      {
        title: 'Rendelői kezelések',
        body: 'Személyesen.',
        felirat: 'Nézd meg a kezeléseket',
        url: '/szolgaltatasok#rendeloi',
      },
      {
        title: 'Otthoni program',
        body: 'Online.',
        felirat: 'Nézd meg a kurzusokat',
        url: '/kurzusok',
      },
      {
        title: 'Szakmai képzések',
        body: 'Szakembereknek.',
        felirat: 'Nézd meg a képzést',
        url: 'https://example.com/workshop',
      },
    ]
    const markup = render(block({ rows }))
    expect(markup).toContain('kc-services--choices')
    expect(markup).not.toContain('kc-services--sin')
    for (const row of rows) expect(markup).toContain(`href="${row.url}"`)
    expect(markup.match(/class="kc-services__row"/g)).toHaveLength(3)
  })

  it('nem számol üres címmel, és nem változtatja meg az egy- vagy kétsoros blokkot', () => {
    expect(render(block())).not.toContain('kc-services--choices')
    expect(
      render(
        block({
          rows: [
            { title: 'Egy', body: '' },
            { title: 'Kettő', body: '' },
            { title: ' ', body: '' },
          ],
        }),
      ),
    ).not.toContain('kc-services--choices')
  })
})

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

    expect(sor).toContain('padding: var(--kc-space-6) 0')
    expect(sor).not.toContain('min-height: 0')
  })

  it('a hosszú szó megtörik, nem vágja le a szekció (WCAG 1.4.10 Reflow)', () => {
    expect(szabalyTorzs(css, '.kc-services__title')).toContain('overflow-wrap: break-word')
    expect(szabalyTorzs(css, '.kc-services__row-title')).toContain('overflow-wrap: break-word')
    expect(szabalyTorzs(css, '.kc-services__body')).toContain('min-width: 0')
  })
})

describe('welcome.css — a keskeny nézet őre', () => {
  const css = cssFajl('welcome.css')

  it('az üdvözlő cím hosszú szava megtörik (320 px-en a lap nem görgethető oldalra)', () => {
    expect(szabalyTorzs(css, '.kc-welcome__title')).toContain('overflow-wrap: break-word')
  })
})

describe('Services — REV C sín + panel', () => {
  const railBlock = (): BlockServices =>
    block({
      elrendezes: 'sin',
      title: HOME_HELP_TITLE,
      lead: HOME_HELP_LEAD,
      eyebrow: '',
      image: {
        id: 9,
        url: '/tabla.webp',
        alt: 'Tábla-fotó, a sín nem mutatja',
        width: 800,
        height: 600,
      } as BlockServices['image'],
      rows: HOME_HELP_STATES.map((state, index) => ({
        id: `rail-${index}`,
        number: state.number,
        title: state.title,
        osszefoglalo: state.osszefoglalo,
        body: state.body,
        felirat: state.felirat,
        url: state.url,
        ujAblakban: state.ujAblakban,
      })),
    })

  it('sín-elrendezésnél nincs háromoszlopos tábla, a tábla-fotó kimarad', () => {
    const markup = render(railBlock())
    expect(markup).toContain('kc-services--sin')
    expect(markup).not.toContain('kc-services--choices')
    expect(markup).not.toContain('kc-services--photo')
    expect(markup).not.toContain('/tabla.webp')
    expect(markup).toContain(HOME_HELP_LEAD)
  })

  it('három natív rádió, három sín-címke és a jóváhagyott panel-szöveg', () => {
    const markup = render(railBlock())
    expect(markup.match(/type="radio"/g)).toHaveLength(3)
    expect(markup).toContain('name="kc-help-sz1"')
    expect(markup).toContain('Szolgáltatás')
    expect(markup).not.toContain('Kézállapot')
    expect(markup).not.toMatch(/>Zárt</)
    expect(markup).not.toMatch(/>Nyíló</)
    expect(markup).not.toMatch(/>Nyitott</)
    expect(markup).not.toMatch(/\b(Zárt|Nyíló|Nyitott)\b/)
    expect(markup).not.toContain('ÁLLAPOT')
    expect(markup).toContain('kc-visually-hidden')
    expect(markup).toContain('kc-section--tint')
    expect(markup).toContain('kc-services-sin__marker')
    expect(markup).toContain('kc-services-sin__rail-blurb')
    expect(markup).toContain('kc-services-sin__kicker')
    expect(markup).toContain('kc-services-sin__rule')
    expect(markup).toContain('kc-services-sin__cta-icon')
    expect(markup).toContain('kc-button--primary')
    expect(markup).toContain('kc-services-sin__col')
    const colIdx = markup.indexOf('kc-services-sin__col')
    const titleIdx = markup.indexOf(HOME_HELP_TITLE)
    const stageIdx = markup.indexOf('kc-services-sin__stage')
    expect(colIdx).toBeGreaterThan(-1)
    expect(titleIdx).toBeGreaterThan(colIdx)
    expect(stageIdx).toBeGreaterThan(titleIdx)
    expect(markup).toContain('kc-services-sin__hand--closed')
    expect(markup).toContain('kc-services-sin__hand--opening')
    expect(markup).toContain('kc-services-sin__hand--open')
    expect(markup).not.toContain('kc-services-sin__rail-index')
    expect(markup).toContain('1. ÚT')
    expect(markup).toContain('2. ÚT')
    expect(markup).toContain('3. ÚT')
    for (const state of HOME_HELP_STATES) {
      expect(markup).toContain(state.title)
      expect(markup).toContain(state.osszefoglalo)
      expect(markup).toContain(state.body)
      expect(markup).toContain(state.felirat)
      expect(markup).toContain(`href="${state.url}"`)
    }
    expect(markup).toContain('Tovább a kezelésekre')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('Fotó később: Rendelői kezelések')
    expect(markup).not.toContain('kc-services__row')
  })

  it('kitöltött panel-fotót mutat, a helykitöltőt nem', () => {
    const markup = render(
      block({
        elrendezes: 'sin',
        rows: [
          {
            title: 'Rendelői kezelések',
            osszefoglalo: 'Rövid.',
            body: 'Törzs.',
            felirat: 'Gomb',
            url: '/kurzusok',
            photo: {
              id: 41,
              url: '/help-zart-img-7541.webp',
              alt: 'Rendelői kezelés fotója',
              width: 876,
              height: 1400,
            } as BlockServices['image'],
          },
        ],
      }),
    )
    expect(markup).toContain('help-zart-img-7541.webp')
    expect(markup).toContain('kc-services-sin__photo')
    expect(markup).toContain('Rendelői kezelés fotója')
    expect(markup).not.toContain('Fotó később')
  })

  it('tiltott sémájú panel-URL: a felirat nem jelenik meg, a szöveg marad', () => {
    const markup = render(
      block({
        elrendezes: 'sin',
        rows: [
          {
            title: 'Rendelői kezelések',
            osszefoglalo: 'Rövid.',
            body: 'Hosszabb szöveg.',
            felirat: 'Tovább',
            url: 'javascript:alert(1)',
          },
        ],
      }),
    )
    expect(markup).toContain('Rendelői kezelések')
    expect(markup).toContain('Hosszabb szöveg.')
    expect(markup).not.toContain('Tovább')
    expect(markup).not.toContain('javascript:')
  })

  it('a /szolgaltatasok tábla marad tábla, sín nélkül', () => {
    const services = buildSzolgaltatasokLayout().find((b) => b.blockType === 'services')
    if (services?.blockType !== 'services') {
      throw new Error('A szolgáltatás-szekció hiányzik a szekciósorból.')
    }
    const markup = render(services as unknown as BlockServices)
    expect(markup).not.toContain('kc-services--sin')
    expect(markup).toContain('kc-services--choices')
  })
})

describe('services-sin.css — token-szerződés', () => {
  const css = cssFajl('services-sin.css')

  it('csak a három betűméret-tokent használja', () => {
    for (const sor of css.split('\n').filter((s) => s.includes('font-size:'))) {
      expect(sor).toMatch(/font-size:\s*var\(--kc-font-(l|m|s)\)/)
    }
  })

  it('a sín érintőcélja 44 px, a 320 px-es tördelés be van kötve', () => {
    expect(szabalyTorzs(css, '.kc-services-sin__rail-label')).toContain('min-height: 2.75rem')
    expect(szabalyTorzs(css, '.kc-services-sin__rail-label')).toContain('overflow-wrap: break-word')
    expect(szabalyTorzs(css, '.kc-services-sin__panel-title')).toContain(
      'overflow-wrap: break-word',
    )
  })

  it('a kiválasztást körjelölő és kiemelt panel jelzi, számozott lista nélkül, új hex nélkül', () => {
    expect(css).not.toContain('kc-services-sin__rail-index')
    expect(css).not.toContain('border-left-color:')
    expect(css).not.toMatch(/flex-wrap:\s*wrap\b/)
    expect(szabalyTorzs(css, '.kc-services-sin__rail')).toContain('flex-direction: column')
    expect(szabalyTorzs(css, '.kc-services-sin__marker')).toContain(
      'border-radius: var(--kc-radius-full)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__marker')).toContain(
      'background-color: var(--kc-services-fade)',
    )
    expect(css).toContain('background-color: var(--kc-color-surface-dark)')
    expect(css).toContain('color: var(--kc-color-on-dark)')
    expect(szabalyTorzs(css, '.kc-services-sin__rule')).toContain(
      'background-color: var(--kc-color-help-border)',
    )
    expect(szabalyTorzs(css, '.kc-section.kc-board.kc-board--edge.kc-services--sin')).toContain(
      'min-height: auto',
    )
    expect(szabalyTorzs(css, '.kc-section--tint.kc-services--sin')).toContain(
      'background-color: var(--kc-color-help-paper)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel')).toContain(
      'box-shadow: var(--kc-shadow-sm)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel')).toContain(
      'border-radius: var(--kc-radius-lg)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel')).toContain(
      'background-color: var(--kc-color-help-panel)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel')).toContain(
      'border: 1px solid var(--kc-color-help-border)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__marker')).toContain(
      'border: 1px solid var(--kc-color-help-chrome)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__marker')).toContain(
      'color: var(--kc-color-help-chrome)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel')).not.toContain('surface-raised')
    expect(szabalyTorzs(css, '.kc-services-sin__panel')).not.toContain('shadow-md')
    expect(szabalyTorzs(css, '.kc-services-sin__panel-title')).toContain(
      'font-family: var(--kc-font-heading)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel-title')).toContain(
      'font-weight: var(--kc-font-weight-normal)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__intro')).toContain(
      'font-family: var(--kc-font-body)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__cta')).toContain(
      'background-color: var(--kc-color-surface-dark)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__marker')).toContain(
      'width: var(--kc-services-marker-idle)',
    )
    expect(css).toContain('--kc-services-marker: 3rem')
    expect(css).toContain('--kc-services-marker-idle: var(--kc-services-marker)')
    expect(css).toContain('--kc-services-marker-active: var(--kc-services-marker)')
    expect(css).toContain('--kc-services-marker-slot: var(--kc-services-marker)')
    expect(css).not.toContain('width: var(--kc-services-marker-active)')
    expect(css).not.toContain('width: 0.95rem')
    expect(szabalyTorzs(css, '.kc-services-sin__marker svg')).toContain('width: 1.25rem')
    expect(szabalyTorzs(css, '.kc-services-sin__marker svg')).toContain('height: 1.25rem')
    expect(css).toContain('--kc-services-panel-pad: var(--kc-space-7)')
    expect(css).toContain('padding: var(--kc-services-panel-pad)')
    expect(css).toContain('minmax(16rem, 1fr) minmax(0, 2fr)')
    expect(szabalyTorzs(css, '.kc-services--sin .kc-services__title')).toContain('max-width: none')
    expect(css).not.toContain('justify-content: space-between')
    expect(css).toContain('align-items: start')
    expect(css).toContain('align-self: start')
    expect(szabalyTorzs(css, '.kc-services-sin__rail')).not.toContain('flex: none')
    expect(css).toMatch(
      /\.kc-services-sin__rail \{\s*justify-content: flex-start;\s*gap: var\(--kc-space-6\);\s*flex: none;/,
    )
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('a C drót pixelzár hexei a tokens.css help-tokenjein élnek', () => {
    const tokens = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/styles/tokens.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(tokens).toMatch(/--kc-color-help-paper:\s*#f4f8fd/)
    expect(tokens).toMatch(/--kc-color-help-panel:\s*#eef3fa/)
    expect(tokens).toMatch(/--kc-color-help-ink:\s*#122a4e/)
    expect(tokens).toMatch(/--kc-color-help-muted:\s*#516385/)
    expect(tokens).toMatch(/--kc-color-help-chrome:\s*#6a7d97/)
  })
})

/**
 * ŐR — szekcióhatár a sín előtt + a sín mozgás-rétege (tulajdonosi kör,
 * 2026-09-07). A tábla-fotó a sín előtt a saját sávjában marad (alsó
 * tábla-szegély csak ebben a szomszédságban), a sín panelváltása pedig
 * tokenből épített, reduce alatt kikapcsoló átmenet, JS nélkül.
 * https://www.nngroup.com/articles/gestalt-proximity/
 * https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
 * https://www.nngroup.com/articles/animation-duration/
 */
describe('services.css — a sín előtti tábla alsó szegélye', () => {
  const css = cssFajl('services.css')

  it('csak a sín közvetlen szomszédja kap alsó tábla-szegélyt, tokenből', () => {
    const torzs = szabalyTorzs(
      css,
      '.kc-section.kc-board.kc-board--edge.kc-services--photo:has(+ .kc-services--sin)',
    )
    expect(torzs).toContain('padding-bottom: var(--kc-board-y)')
    // A /szolgaltatasok fotós táblái érintetlenek: az általános --photo szabály nem ír alsó szegélyt.
    expect(szabalyTorzs(css, '.kc-section.kc-board.kc-services--photo')).not.toContain(
      'padding-bottom',
    )
  })

  it('a tábla eyebrow-ja renderelődik a kezdőlapi „Erre számíthatsz" táblán', () => {
    const markup = render(
      block({
        eyebrow: 'Miért mi',
        title: 'Erre számíthatsz velünk',
        rows: [{ title: 'Szakmai figyelem', body: 'Első.' }],
        sectionSettings: { visible: true, hatter: 'tint' },
      }),
    )
    expect(markup).toContain('kc-services__eyebrow')
    expect(markup).toContain('Miért mi')
    expect(markup).toContain('kc-section--tint')
  })
})

describe('services-sin.css — mozgás-réteg', () => {
  const css = cssFajl('services-sin.css')
  const tiszta = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('a panelek egy rácscellára rétegződnek, az inaktív láthatatlan és nem fókuszálható', () => {
    expect(szabalyTorzs(css, '.kc-services-sin__stage')).toContain('display: grid')
    const panel = szabalyTorzs(css, '.kc-services-sin__panel')
    expect(panel).toContain('grid-area: 1 / 1')
    expect(panel).toContain('visibility: hidden')
    expect(panel).toContain('pointer-events: none')
    expect(panel).not.toContain('display: none')
    expect(tiszta).not.toContain('display: none')
  })

  it('minden átmenet a mozgás-tokenekből áll (időtartam és görbe), nem kézi ms', () => {
    const transitions = tiszta.match(/transition:[^;]+;/g) ?? []
    expect(transitions.length).toBeGreaterThan(0)
    for (const t of transitions) {
      if (t.includes('none')) continue
      expect(t).toMatch(/var\(--kc-motion-(base|fast)\)/)
      expect(t).toMatch(/var\(--kc-ease-out\)/)
      expect(t).not.toMatch(/\d+ms/)
    }
    // A másolat felúszása a térköz-tokenről (8 px), nem kézi px.
    expect(szabalyTorzs(css, '.kc-services-sin__copy')).toContain(
      'transform: translateY(var(--kc-space-2))',
    )
  })

  it('csökkentett mozgásnál minden helyi átmenet és eltolás kikapcsol (SC 2.3.3)', () => {
    const reduce = tiszta.slice(tiszta.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toContain('transition: none')
    expect(reduce).toContain('transform: none')
    for (const osztaly of [
      '.kc-services-sin__panel',
      '.kc-services-sin__copy',
      '.kc-services-sin__marker',
      '.kc-services-sin__rail-label',
    ]) {
      expect(reduce).toContain(osztaly)
    }
  })

  it('hover és fókusz tónusa a help-panel token, a gyűrű help-ink; nincs új hex', () => {
    expect(szabalyTorzs(css, '.kc-services-sin__rail-label:hover')).toContain(
      'background-color: var(--kc-color-help-panel)',
    )
    expect(
      szabalyTorzs(css, '.kc-services-sin__rail-label:hover .kc-services-sin__marker'),
    ).toContain('border-color: var(--kc-color-help-ink)')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
