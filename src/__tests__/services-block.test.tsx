import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Services } from '../components/blocks/Services'
import {
  HOME_HELP_LEAD,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  presentSzolgaltatasokLayout,
} from '../lib/home-help-states'
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
    expect(hosszu).toContain('max-width: 24ch')
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
    // WP17: a kéz-ikon MINDEN állapotban a tétel jele — nincs ikoncsere,
    // nincs aktív nyíl a körben; a nyíl csak a CTA gombon marad.
    expect(markup).not.toContain('kc-services-sin__marker-idle')
    expect(markup).not.toContain('kc-services-sin__marker-active')
    expect(markup.match(/kc-services-sin__hand--/g)).toHaveLength(3)
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

  it('a /szolgaltatasok seed-blokkja `elrendezes` nélkül tábla; a sínt a lap prezentere adja (WP25)', () => {
    const services = buildSzolgaltatasokLayout().find((b) => b.blockType === 'services')
    if (services?.blockType !== 'services') {
      throw new Error('A szolgáltatás-szekció hiányzik a szekciósorból.')
    }
    const markup = render(services as unknown as BlockServices)
    expect(markup).not.toContain('kc-services--sin')
    expect(markup).toContain('kc-services--choices')
    // Ugyanez a blokk a lap prezenterén át: sín, a lap SAJÁT soraival.
    const presented = presentSzolgaltatasokLayout([services]).find(
      (b) => b.blockType === 'services',
    )
    if (presented?.blockType !== 'services') throw new Error('A prezentált blokk hiányzik.')
    const sinMarkup = render(presented as unknown as BlockServices)
    expect(sinMarkup).toContain('kc-services--sin')
    expect(sinMarkup).not.toContain('kc-services--choices')
    for (const row of services.rows ?? []) {
      expect(sinMarkup).toContain(row.title)
      expect(sinMarkup).toContain(row.felirat ?? '')
      expect(sinMarkup).toContain(`href="${row.url}"`)
    }
  })

  /**
   * WP25 kéz-ikonok: Phosphor Icons (MIT), `hand-fist` / `hand-grabbing` /
   * `hand-palm`, regular súly, 256-os rács, currentColor kitöltés. A régi,
   * kézzel rajzolt 24-es stroke-glifák kimentek (a tulajdonos: „csúnyák").
   * https://phosphoricons.com · https://github.com/phosphor-icons/core/blob/main/LICENSE
   */
  it('a három kéz-ikon a Phosphor-készlet (MIT) 256-os rácsú, currentColor-kitöltésű glifája, forrás-megjelöléssel', () => {
    const markup = render(railBlock())
    const svgs = markup.match(/<svg[^>]*kc-services-sin__hand[^>]*>/g) ?? []
    expect(svgs).toHaveLength(3)
    for (const svg of svgs) {
      expect(svg).toContain('viewBox="0 0 256 256"')
      expect(svg).toContain('fill="currentColor"')
      expect(svg).not.toContain('stroke=')
    }
    const forras = readFileSync(
      fileURLToPath(new URL('../components/blocks/Services.tsx', import.meta.url)),
      'utf8',
    )
    expect(forras).toContain('@phosphor-icons/core')
    expect(forras).toContain('https://github.com/phosphor-icons/core/blob/main/LICENSE')
    for (const nev of ['hand-fist', 'hand-grabbing', 'hand-palm']) expect(forras).toContain(nev)
    // A betűhív Phosphor path-ok kezdete (regular súly, 2.1.1).
    expect(forras).toContain('M200,80H184V64a32,32,0,0,0-56-21.13')
    expect(forras).toContain('M188,80a27.79,27.79,0,0,0-13.36,3.4')
    expect(forras).toContain('M188,88a27.75,27.75,0,0,0-12,2.71V60')
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
    // Audit P2-8: a panel címe a szekció fő tartalmi címe (L, Tenor 400 marad),
    // a sín-tétel címei M + 600 (közepes), nem 700.
    expect(szabalyTorzs(css, '.kc-services-sin__panel-title')).toContain(
      'font-family: var(--kc-font-heading)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__panel-title')).toContain(
      'font-weight: var(--kc-font-weight-normal)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__rail-title')).toContain(
      'font-size: var(--kc-font-m)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__rail-title')).toContain(
      'font-weight: var(--kc-font-weight-medium)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__intro')).toContain(
      'font-family: var(--kc-font-body)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__cta')).toContain(
      'background-color: var(--kc-color-surface-dark)',
    )
    // WP17 (tulajdonosi drótváz): a kör mobilon 3.5rem, asztalon 5rem (80 px),
    // a slot ugyanaz — a :checked NEM nagyít; az ikon a slothoz mért token.
    expect(szabalyTorzs(css, '.kc-services-sin__marker')).toContain(
      'width: var(--kc-services-marker)',
    )
    expect(css).toContain('--kc-services-marker: 3.5rem')
    expect(css).toContain('--kc-services-marker: 5rem')
    expect(css).toContain('--kc-services-marker-slot: var(--kc-services-marker)')
    expect(css).toContain('--kc-services-marker-icon: 1.75rem')
    expect(css).toContain('--kc-services-marker-icon: 2.5rem')
    expect(css).not.toContain('--kc-services-marker-icon: 1.5rem')
    expect(css).not.toContain('kc-services-marker-active')
    expect(css).not.toContain('kc-services-marker-idle')
    expect(css).not.toContain('width: 0.95rem')
    expect(szabalyTorzs(css, '.kc-services-sin__marker svg')).toContain(
      'width: var(--kc-services-marker-icon)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__marker svg')).toContain(
      'height: var(--kc-services-marker-icon)',
    )
    // Panel belső térköz: asztalon space-7, 1200-tól a drót 72 px-e (space-8).
    expect(css).toContain('--kc-services-panel-pad: var(--kc-space-7)')
    expect(css).toContain('--kc-services-panel-pad: var(--kc-space-8)')
    expect(css).toContain('padding: var(--kc-services-panel-pad)')
    // Hasáb-arány 1 : 2,6 (a drót 345 / 1090 px-e 1440-en).
    expect(css).toContain('minmax(16rem, 1fr) minmax(0, 2.6fr)')
    expect(szabalyTorzs(css, '.kc-services--sin .kc-services__title')).toContain('max-width: none')
    // WP25 (tulajdonos: „a bal oldala olyan magas legyen, mint a rendelői
    // kezelések doboz: nagyobb legyen a távolság a három tétel között"):
    // asztalon a bal hasáb a rács sorát kitölti, a sín a fejléc alatti
    // maradékot kapja, a tételek space-between-nel oszlanak el; a space-7
    // gap az alsó korlát. Mérve 1024/1440 px-en: a sín alja a panel aljától
    // 0 px-re (WP25 jegyzőkönyv).
    expect(css).toMatch(
      /\.kc-services-sin__rail \{\s*justify-content: space-between;\s*gap: var\(--kc-space-7\);\s*flex: 1 1 auto;/,
    )
    expect(szabalyTorzs(css, '.kc-services-sin__rail')).not.toContain('flex: none')
    const asztaliLayout = szabalyTorzsek(css, '.kc-services-sin__layout')
    expect(asztaliLayout.some((t) => t.includes('align-items: stretch'))).toBe(true)
    expect(
      szabalyTorzsek(css, '.kc-services-sin__col').some((t) => t.includes('align-self: stretch')),
    ).toBe(true)
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
      // A globális token vagy a belőle SZÁRMAZTATOTT helyi sín-token (lent).
      expect(t).toMatch(/var\(--kc-(motion-(base|fast)|services-motion-(cross|stagger))\)/)
      expect(t).toMatch(/var\(--kc-ease-out\)/)
      expect(t).not.toMatch(/\d+ms/)
    }
    // A másolat felúszása a térköz-tokenről (8 px), nem kézi px.
    expect(szabalyTorzs(css, '.kc-services-sin__copy')).toContain(
      'transform: translateY(var(--kc-space-2))',
    )
  })

  /**
   * WP25 (tulajdonos: „túl direkt az animáció/váltás … finomabb átmenet
   * kell"): keresztúsztatás 350 ms (base × 1,75, M3 medium3), a kilépő panel
   * is kiúszik, a belépő másolat 40 ms (fast ÷ 3), a fotó 80 ms késleltetéssel
   * (staggered). Mérve Chromiumban (WP25 jegyzőkönyv): transitionDuration
   * 0.35s a panelen, a másolaton és a fotón; delay 0.04s / 0.08s a belépőn,
   * 0s a kilépőn; reduce alatt minden 0s.
   * https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
   * https://www.nngroup.com/articles/animation-duration/
   * https://developer.apple.com/design/human-interface-guidelines/motion
   */
  it('a keresztúsztatás és a stagger a globális tokenekből SZÁRMAZTATOTT helyi token (nincs kézi ms)', () => {
    const sin = szabalyTorzs(css, '.kc-services-sin')
    expect(sin).toContain('--kc-services-motion-cross: calc(var(--kc-motion-base) * 1.75)')
    expect(sin).toContain('--kc-services-motion-stagger: calc(var(--kc-motion-fast) / 3)')
    expect(tiszta).not.toMatch(/\d+ms/)
  })

  it('a kilépő panel is úszik: a panel, a másolat és a fotó a keresztúsztatás-időt viszi, a visibility a végén vált', () => {
    const panel = szabalyTorzs(css, '.kc-services-sin__panel')
    expect(panel).toContain('opacity var(--kc-services-motion-cross) var(--kc-ease-out)')
    expect(panel).toContain('visibility 0s linear var(--kc-services-motion-cross)')
    const copy = szabalyTorzs(css, '.kc-services-sin__copy')
    expect(copy).toContain('opacity: 0')
    expect(copy).toContain('transform var(--kc-services-motion-cross) var(--kc-ease-out)')
    expect(copy).toContain('opacity var(--kc-services-motion-cross) var(--kc-ease-out)')
    const foto = szabalyTorzs(css, '.kc-services-sin__photo,\n.kc-services-sin__placeholder')
    expect(foto).toContain('opacity: 0')
    expect(foto).toContain('transform: translateY(var(--kc-space-2))')
    expect(foto).toContain('opacity var(--kc-services-motion-cross) var(--kc-ease-out)')
  })

  it('a belépő másolat és fotó eltérő késleltetéssel indul (40 / 80 ms), a kilépő azonnal', () => {
    expect(tiszta).toMatch(
      /\.kc-services-sin__panel:nth-of-type\(5\)\s+\.kc-services-sin__copy \{\s*opacity: 1;\s*transform: translateY\(0\);\s*transition-delay: var\(--kc-services-motion-stagger\);/,
    )
    expect(tiszta).toMatch(
      /:is\(\.kc-services-sin__photo, \.kc-services-sin__placeholder\) \{\s*opacity: 1;\s*transform: translateY\(0\);\s*transition-delay: calc\(var\(--kc-services-motion-stagger\) \* 2\);/,
    )
    // Az inaktív (kilépő) állapot nem hord késleltetést: a kiúszás azonnal indul.
    expect(szabalyTorzs(css, '.kc-services-sin__copy')).not.toContain('transition-delay')
  })

  it('csökkentett mozgásnál minden helyi átmenet és eltolás kikapcsol (SC 2.3.3)', () => {
    const reduce = tiszta.slice(tiszta.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toContain('transition: none')
    expect(reduce).toContain('transform: none')
    for (const osztaly of [
      '.kc-services-sin__panel',
      '.kc-services-sin__copy',
      '.kc-services-sin__photo',
      '.kc-services-sin__placeholder',
      '.kc-services-sin__marker',
      '.kc-services-sin__rail-label',
    ]) {
      expect(reduce).toContain(osztaly)
    }
    // A stagger-késleltetés is nullázódik, különben a váltás 40–80 ms-ot késne.
    expect(reduce).toContain('transition-delay: 0s')
  })

  it('a fókusz-gyűrű szabálya a :checked ELŐTT áll (a kiválasztott körön a kéz-ikon fehér marad)', () => {
    const fokusz = tiszta.indexOf(
      ':focus-visible\n  ~ .kc-services-sin__layout\n  .kc-services-sin__rail-label:nth-of-type(1)\n  .kc-services-sin__marker',
    )
    const checked = tiszta.indexOf(
      ':checked\n  ~ .kc-services-sin__layout\n  .kc-services-sin__rail-label:nth-of-type(1)\n  .kc-services-sin__marker',
    )
    expect(fokusz).toBeGreaterThan(-1)
    expect(checked).toBeGreaterThan(fokusz)
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

/**
 * ŐR — WP17 mobil accordion (tulajdonosi drótváz, 2026-09-07). 900 px alatt a
 * panel a nyitott sor ALÁ fésülődik: a burkolók display: contents-szel adják
 * át a gyermekeiket a layout-rácsnak, a sorrendet `order` adja, az inaktív
 * panel 0 magas (nem display: none — az átúszás marad). A + / − jel tisztán
 * CSS (::after), a rádió-mechanika változatlan.
 * https://www.nngroup.com/articles/mobile-accordions/
 * https://design-system.service.gov.uk/components/accordion/
 */
describe('services-sin.css — mobil accordion (< 900 px)', () => {
  const css = cssFajl('services-sin.css')
  const tiszta = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const mobil = tiszta.slice(
    tiszta.indexOf('@media (max-width: 899px)'),
    tiszta.indexOf('@media (prefers-reduced-motion: reduce)'),
  )
  const asztal = tiszta.slice(tiszta.indexOf('@media (min-width: 900px)'))

  it('a burkolók átadják a gyermekeiket, a címkék és panelek összefésülődnek', () => {
    expect(mobil).toMatch(
      /\.kc-services-sin__col,\s*\.kc-services-sin__rail,\s*\.kc-services-sin__stage \{\s*display: contents;/,
    )
    for (let n = 1; n <= 3; n += 1) {
      expect(mobil).toMatch(
        new RegExp(
          `\\.kc-services-sin__rail-label:nth-of-type\\(${n}\\) \\{\\s*order: ${2 * n - 1};`,
        ),
      )
      expect(mobil).toMatch(
        new RegExp(`\\.kc-services-sin__panel:nth-of-type\\(${n}\\) \\{\\s*order: ${2 * n};`),
      )
    }
  })

  it('az inaktív panel 0 magas, keret és árnyék nélkül; az aktív a tartalmára nyílik', () => {
    const panel = mobil.slice(mobil.indexOf('.kc-services-sin__panel {'))
    expect(panel).toContain('grid-area: auto')
    expect(panel).toContain('height: 0')
    expect(panel).toContain('border-width: 0')
    expect(panel).toContain('overflow: hidden')
    expect(mobil).toContain('height: auto')
    expect(mobil).toContain('padding: var(--kc-services-panel-pad)')
    expect(mobil).not.toContain('display: none')
  })

  it('a + / − jel gradientből áll, a nyitott sor a vízszintes vonalat viszi; asztalon nincs', () => {
    const jel = szabalyTorzs(css, '.kc-services-sin__rail-label::after')
    expect(jel).toContain("content: ''")
    expect(jel).toContain('linear-gradient(var(--kc-color-help-ink), var(--kc-color-help-ink))')
    expect(jel).toMatch(/background-size:\s*100% 2px,\s*2px 100%/)
    expect(tiszta).toMatch(
      /rail-label:nth-of-type\(1\)::after[\s\S]*?background-size:\s*100% 2px,\s*0 0/,
    )
    expect(asztal).toMatch(/\.kc-services-sin__rail-label::after \{\s*content: none;/)
  })

  it('a sorok közt hajszál-elválasztó fut, a nyitott sor és a panelje közt nem', () => {
    expect(szabalyTorzs(css, '.kc-services-sin__rail-label:not(:first-of-type)')).toContain(
      'border-top: 1px solid var(--kc-services-rail-line)',
    )
    expect(szabalyTorzs(css, '.kc-services-sin__rail-label')).not.toContain('border-bottom')
  })

  it('a rács köze 0 mobilon (a rejtett panel nem hagy üres rést)', () => {
    expect(mobil).toMatch(/\.kc-services-sin__layout \{\s*gap: 0;/)
  })
})

/**
 * WP30 (2026-09-07, tulajdonosi kör: „az ezért fogod imádni bal oldala kicsit
 * üres nekem, lehetne kicsit olyan mint a megérdemled a törődést"). A kétsoros
 * fotós tábla bal hasábja a Rólunk-blokk (About) képnyelvét kapja: teljes
 * hasáb-széles fotó, ugyanaz a hullám-maszk és ugyanaz a hover, a cím alatt
 * akcent-vonal, a séma `lead` mezője a cím alatt. Az őr a KÉT stíluslap
 * tokenjeinek betű szerinti egyezését is méri: a tábla és az About egy nyelvet
 * beszél (NN/g common region; WCAG 2.2 SC 2.3.3 a reduce-ágra).
 */
describe('Services — WP30 hullámos tábla (a Rólunk-blokk képnyelve)', () => {
  const photo = {
    id: 41,
    url: '/tablet.webp',
    alt: 'Tablettel a kanapén',
    width: 1600,
    height: 2400,
    focalX: 30,
    focalY: 70,
  } as BlockServices['image']
  const twoRows = [
    { title: 'A kéz a szakterületünk', body: 'Szöveg.' },
    { title: 'A hétköznapokra készülünk', body: 'Szöveg.' },
  ]

  it('kétsoros, fotós tábla kapja a hullám-módosítót; a háromutas és a fotótlan nem', () => {
    expect(render(block({ image: photo, rows: twoRows }))).toContain('kc-services--hullam')
    expect(
      render(block({ image: photo, rows: [...twoRows, { title: 'Harmadik', body: '' }] })),
    ).not.toContain('kc-services--hullam')
    expect(render(block({ image: null, rows: twoRows }))).not.toContain('kc-services--hullam')
  })

  it('a séma `lead` mezője a tábla címe alatt is megjelenik (üresen nem)', () => {
    const withLead = render(block({ image: photo, rows: twoRows, lead: 'Bevezető a cím alatt.' }))
    expect(withLead).toContain('class="kc-services__intro"')
    expect(withLead).toContain('Bevezető a cím alatt.')
    const titleIdx = withLead.indexOf('kc-services__title')
    const introIdx = withLead.indexOf('kc-services__intro')
    const mediaIdx = withLead.indexOf('kc-services__media')
    expect(titleIdx).toBeLessThan(introIdx)
    expect(introIdx).toBeLessThan(mediaIdx)
    expect(render(block({ image: photo, rows: twoRows, lead: '   ' }))).not.toContain(
      'kc-services__intro',
    )
  })

  it('a vágás középpontja a Media fókuszpontja; hiányában 50% 50%', () => {
    expect(render(block({ image: photo, rows: twoRows }))).toContain(
      '--kc-services-image-focus:30% 70%',
    )
    const noFocal = { ...(photo as object), focalX: null, focalY: null } as BlockServices['image']
    expect(render(block({ image: noFocal, rows: twoRows }))).toContain(
      '--kc-services-image-focus:50% 50%',
    )
  })

  describe('services.css ↔ about.css: azonos maszk-tokenek, azonos hover, azonos akcent-vonal', () => {
    const services = cssFajl('services.css')
    const about = cssFajl('about.css')
    const token = (css: string, nev: string): string => {
      const m = css.match(new RegExp(`${nev}:\\s*([^;]+);`))
      if (!m) throw new Error(`Nincs ilyen token: ${nev}`)
      return m[1].replace(/\s+/g, ' ').trim()
    }

    it('a hullám SVG-je és a rest/hover maszk-méretek betűre egyeznek', () => {
      expect(token(services, '--kc-services-wave')).toBe(token(about, '--kc-about-wave'))
      expect(token(services, '--kc-services-wave-rest')).toBe(token(about, '--kc-about-wave-rest'))
      expect(token(services, '--kc-services-wave-hover')).toBe(
        token(about, '--kc-about-wave-hover'),
      )
    })

    it('a fotó a tokenes maszkot viszi, hover csak hover-eszközön, reduce alatt áll', () => {
      const media = szabalyTorzs(services, '.kc-services--hullam .kc-services__media')
      expect(media).toContain('mask-image: linear-gradient(#000 0 0), var(--kc-services-wave)')
      expect(media).toContain('mask-size: var(--kc-services-wave-rest)')
      const hoverBlokk = services.slice(services.indexOf('@media (hover: hover)'))
      expect(hoverBlokk).toContain('.kc-services--hullam .kc-services__media:hover')
      expect(hoverBlokk).toContain('mask-size: var(--kc-services-wave-hover)')
      expect(hoverBlokk).toContain('transition-duration: calc(var(--kc-motion-base) * 1.2)')
      const reduceBlokk = services.slice(
        services.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
      )
      expect(reduceBlokk).toContain('.kc-services--hullam .kc-services__media:hover')
      expect(reduceBlokk).toContain('transition: none')
      expect(reduceBlokk).toContain('mask-size: var(--kc-services-wave-rest)')
      // Az About hover-időzítése ugyanez (egy nyelv, egy tempó).
      expect(about).toContain('transition-duration: calc(var(--kc-motion-base) * 1.2)')
    })

    it('a cím alatti akcent-vonal az About vonalának mérete', () => {
      const tabla = szabalyTorzs(services, '.kc-services--hullam .kc-services__title::after')
      const rolunk = szabalyTorzs(about, '.kc-about__title::after')
      for (const prop of ['width: 2.5rem', 'height: 1.5px', 'margin-top: var(--kc-space-4)']) {
        expect(tabla).toContain(prop)
        expect(rolunk).toContain(prop)
      }
    })

    it('asztalon a fotó a hasáb maradékát tölti ki, a vágás a fókuszpontból indul', () => {
      const asztal = services.slice(
        services.indexOf(
          '.kc-services--hullam .kc-services__media {',
          services.indexOf('@media (min-width: 900px)', services.indexOf('WP30')),
        ),
      )
      expect(asztal).toContain('flex: 1 1 auto')
      expect(asztal).toContain('aspect-ratio: 4 / 3')
      expect(szabalyTorzs(services, '.kc-services--hullam .kc-services__media img')).toContain(
        'object-position: var(--kc-services-image-focus, 50% 50%)',
      )
    })
  })
})
