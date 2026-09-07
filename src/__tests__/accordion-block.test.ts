import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { accordion, pageBlockSlugs } from '../blocks'
import { Accordion } from '../components/blocks/Accordion'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import type { BlockAccordion, Page } from '../payload-types'

/**
 * Nyitható szekció (accordion) — fókuszált tesztek, DB nélkül.
 *
 * Négy szerződést rögzítenek:
 *  1. a BLOKK-DEFINÍCIÓ: benne van a katalógusban, a sor CÍME és TARTALMA
 *     kötelező, a kivonat nem, és a szekció-beállítások ott vannak;
 *  2. a RENDERELÉS: natív `details`/`summary`, alapból zárva, a hiányos tétel
 *     kimarad, tétel nélkül a szekció is;
 *  3. a SZEKCIÓ-ADAPTER: a RenderBlocks switch ismeri a blokkot, a horgony és a
 *     háttérsáv átmegy, `visible: false` esetén a szekció kimarad;
 *  4. a TELJES CMS-VEZÉRELTSÉG: a látható szöveg KIZÁRÓLAG a mezők értéke —
 *     kódban nincs marketingszöveg és nincs helykitöltő (a teamMembers
 *     guard-tesztjének mintája).
 *
 * A stíluslap négy szabálya (akcent-korlát, érintési célfelület,
 * fókuszgyűrű, summary háttér nélkül hoveren és nyitva) fájl-szinten őrzött:
 * mind olyan, amit egy későbbi szerkesztés csendben elronthatna.
 */

// ---------------------------------------------------------------------------
// Fixture-ök
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** Egy accordion blokk renderelése önmagában (a szekció-adapteren kívül). */
function renderBlock(block: Record<string, unknown>): string {
  return render(createElement(Accordion, { block: block as unknown as BlockAccordion }))
}

/** Ugyanaz a blokk a RenderBlocks switchén keresztül (regisztráció-ellenőrzés). */
function renderViaSwitch(block: Record<string, unknown>): string {
  return render(
    createElement(RenderBlocks, {
      layout: [block] as unknown as Layout,
      products: [],
      posts: [],
      testimonials: [],
    }),
  )
}

/** Minimális, érvényes lexical richText a `tartalom` mezőhöz. */
function richText(...bekezdesek: string[]): unknown {
  return {
    root: {
      type: 'root',
      direction: null,
      format: '',
      indent: 0,
      version: 1,
      children: bekezdesek.map((text) => ({
        type: 'paragraph',
        direction: null,
        format: '',
        indent: 0,
        version: 1,
        children: [
          { type: 'text', text, detail: 0, format: 0, mode: 'normal', style: '', version: 1 },
        ],
      })),
    },
  }
}

/**
 * Tartalom nélküli mező — a REPÓ közös „van-e tartalom" előjele
 * (`hasLexicalContent`) szerint: a gyökérnek nincs gyereke. Ugyanaz a szabály
 * dönt, mint a richText blokknál a RenderBlocks-ban; szándékosan nem vezetünk
 * be másodikat, mert a kettő csendben szétcsúszhatna.
 */
const URES_TARTALOM = {
  root: { type: 'root', children: [], direction: null, format: '', indent: 0, version: 1 },
}

// ---------------------------------------------------------------------------
// 1. Blokk-definíció
// ---------------------------------------------------------------------------

describe('accordion blokk-definíció', () => {
  it('a katalógus része, és a slug/interfész a generált típussal egyezik', () => {
    expect(accordion.slug).toBe('accordion')
    expect(accordion.interfaceName).toBe('BlockAccordion')
    expect(pageBlockSlugs).toContain('accordion')
  })

  it('a sor CÍME és TARTALMA kötelező, a kivonat nem', () => {
    const items = accordion.fields.find(
      (field): field is Extract<typeof field, { fields: unknown[] }> =>
        'name' in field && field.name === 'items' && 'fields' in field,
    )
    expect(items, 'nincs `items` tömb a blokkban').toBeDefined()
    expect(items).toMatchObject({ type: 'array', minRows: 1 })

    const byName = new Map(
      (items?.fields ?? []).flatMap((field) =>
        'name' in field && typeof field.name === 'string' ? [[field.name, field] as const] : [],
      ),
    )
    expect(byName.get('cim')).toMatchObject({ type: 'text', required: true })
    expect(byName.get('tartalom')).toMatchObject({ type: 'richText', required: true })
    const kivonat = byName.get('osszefoglalo')
    expect(kivonat).toBeDefined()
    expect(kivonat && 'required' in kivonat ? kivonat.required === true : false).toBe(false)
  })

  it('a szekció-beállítások (elrejtés, horgony, háttér) ott vannak', () => {
    expect(
      accordion.fields.some((field) => 'name' in field && field.name === 'sectionSettings'),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Renderelés
// ---------------------------------------------------------------------------

describe('Accordion renderelés', () => {
  it('natív details/summary, alapból ZÁRVA, a cím és a kivonat a fejlécben', () => {
    const html = renderBlock({
      id: 'b1',
      blockType: 'accordion',
      title: 'Részletes szakmai háttér',
      items: [
        {
          id: 's1',
          cim: 'Kocsis Kata szakmai önéletrajza',
          osszefoglalo: '38 tanfolyam · 7 konferencia',
          tartalom: richText('Gyógytornász, sportrehabilitációs tréner'),
        },
      ],
      sectionSettings: {},
    })

    expect(html).toContain('<details class="kc-accordion__item">')
    expect(html).toContain('<summary class="kc-accordion__summary">')
    expect(html).toContain('Kocsis Kata szakmai önéletrajza')
    expect(html).toContain('38 tanfolyam · 7 konferencia')
    expect(html).toContain('Gyógytornász, sportrehabilitációs tréner')
    // Alapból zárva: az `open` attribútum nincs kiírva.
    expect(html).not.toContain('<details class="kc-accordion__item" open')
  })

  it('a lenyitott tartalom a közös richText-renderelőn megy át (lista, alcím is)', () => {
    const html = renderBlock({
      id: 'b2',
      blockType: 'accordion',
      items: [{ id: 's2', cim: 'Tanfolyamok', tartalom: richText('Egy tétel', 'Másik tétel') }],
      sectionSettings: {},
    })

    expect(html).toContain('kc-accordion__panel')
    expect(html).toContain('kc-richtext')
    expect(html).toContain('Egy tétel')
    expect(html).toContain('Másik tétel')
  })

  it('cím vagy tényleges tartalom nélküli sor kimarad; érvényes sor nélkül a szekció sem renderel', () => {
    const html = renderBlock({
      id: 'b3',
      blockType: 'accordion',
      title: 'Részletes szakmai háttér',
      items: [
        { id: 's3', cim: 'Van címe', tartalom: richText('Van tartalma is') },
        { id: 's4', cim: '   ', tartalom: richText('Cím nélküli sor tartalma') },
        { id: 's5', cim: 'Tartalom nélküli sor', tartalom: URES_TARTALOM },
      ],
      sectionSettings: {},
    })
    expect(html).toContain('Van címe')
    expect(html).not.toContain('Cím nélküli sor tartalma')
    expect(html).not.toContain('Tartalom nélküli sor')
    expect((html.match(/kc-accordion__item/g) ?? []).length).toBe(1)

    expect(renderBlock({ id: 'b4', blockType: 'accordion', title: 'Üres' })).toBe('')
    expect(
      renderBlock({
        id: 'b5',
        blockType: 'accordion',
        items: [{ id: 's6', cim: 'Csak cím', tartalom: URES_TARTALOM }],
      }),
    ).toBe('')
  })

  it('a sor portréja (kep) a summaryn BELÜL, kör-dobozban, a Médiatár alt-jával renderel (A05)', () => {
    const html = renderBlock({
      id: 'b-kep',
      blockType: 'accordion',
      items: [
        {
          id: 's-kep',
          kep: {
            id: 23,
            alt: 'Kocsis Kata portréja',
            url: '/media/kocsis.webp',
            width: 800,
            height: 1000,
            sizes: { sm: { url: '/media/kocsis-640.webp', width: 640, height: 800 } },
          },
          cim: 'Kocsis Kata szakmai önéletrajza',
          tartalom: richText('Gyógytornász'),
        },
      ],
      sectionSettings: {},
    })
    const summary = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))
    // A kép a summary tartalma: ugyanaz a kattintás nyitja a sort, nincs
    // külön link vagy gomb (érintőcél és fókusz változatlan).
    expect(summary).toContain('<span class="kc-accordion__portrait">')
    expect(summary).toContain('alt="Kocsis Kata portréja"')
    expect(summary).toContain('kocsis-640.webp')
    expect(summary).not.toMatch(/<a |<button/)
    // A portré a NÉV ELŐTT áll (a fejléc: arc + név + kivonat).
    expect(summary.indexOf('kc-accordion__portrait')).toBeLessThan(
      summary.indexOf('kc-accordion__heading'),
    )
    // Lenyitva a tartalom nem ismétli a képet.
    const panel = html.slice(html.indexOf('kc-accordion__panel'))
    expect(panel).not.toContain('kocsis')
  })

  it('kép nélkül, feloldatlan (depth 0, szám) vagy URL nélküli médiával nincs portré-doboz', () => {
    for (const kep of [undefined, null, 23, { id: 23, alt: 'Törölt', url: null }]) {
      const html = renderBlock({
        id: 'b-nokep',
        blockType: 'accordion',
        items: [{ id: 's-nokep', kep, cim: 'Sor', tartalom: richText('Tartalom') }],
        sectionSettings: {},
      })
      expect(html, `kep=${JSON.stringify(kep)}`).not.toContain('kc-accordion__portrait')
      expect(html).toContain('Sor')
    }
  })

  it('a 2026-09-07 előtti seed gondolatjeles címét és bevezetőjét natív alakra írja át, mást nem', () => {
    const html = renderBlock({
      id: 'b-dash',
      blockType: 'accordion',
      lead: 'A teljes szakmai életutunk — tanulmányok, továbbképzések, publikációk, előadások és médiamegjelenések. Nyisd ki, amelyik érdekel.',
      items: [
        { id: 'd1', cim: 'Kiss Kata — szakmai önéletrajz', tartalom: richText('Tartalom') },
        { id: 'd2', cim: 'Saját cím — szerkesztői', tartalom: richText('Tartalom') },
      ],
      sectionSettings: {},
    })
    expect(html).toContain('Kiss Kata szakmai önéletrajza')
    expect(html).toContain('A teljes szakmai életutunk: tanulmányok')
    expect(html).toContain('Saját cím — szerkesztői')
  })

  it('a kivonat elhagyható — nélküle nincs üres jelölő a fejlécben', () => {
    const html = renderBlock({
      id: 'b6',
      blockType: 'accordion',
      items: [{ id: 's7', cim: 'Kivonat nélkül', tartalom: richText('Tartalom') }],
      sectionSettings: {},
    })
    expect(html).toContain('Kivonat nélkül')
    expect(html).not.toContain('kc-accordion__summary-note')
  })

  it('cím nélküli szekció nem visz aria-labelledby-t (nincs név nélküli landmark-hivatkozás)', () => {
    const cimmel = renderBlock({
      id: 'b7',
      blockType: 'accordion',
      title: 'Van cím',
      items: [{ id: 's8', cim: 'Sor', tartalom: richText('Tartalom') }],
      sectionSettings: {},
    })
    expect(cimmel).toContain('aria-labelledby="accordion-cim-b7"')
    expect(cimmel).toContain('<h2 class="kc-accordion__title" id="accordion-cim-b7">')

    const cimNelkul = renderBlock({
      id: 'b8',
      blockType: 'accordion',
      items: [{ id: 's9', cim: 'Sor', tartalom: richText('Tartalom') }],
      sectionSettings: {},
    })
    expect(cimNelkul).not.toContain('aria-labelledby')
    expect(cimNelkul).not.toContain('kc-accordion__title')
  })
})

// ---------------------------------------------------------------------------
// 3. Szekció-adapter (RenderBlocks)
// ---------------------------------------------------------------------------

describe('Accordion a szekció-rendszerben', () => {
  it('a RenderBlocks switch ismeri a blokkot: horgony és háttérsáv átmegy', () => {
    const html = renderViaSwitch({
      blockType: 'accordion',
      id: 'b9',
      title: 'Részletes szakmai háttér',
      items: [{ id: 's10', cim: 'Sor', tartalom: richText('Tartalom') }],
      sectionSettings: { visible: true, anchorId: 'szakmai-hatter', hatter: 'tint' },
    })
    expect(html).toContain('id="szakmai-hatter"')
    expect(html).toContain('kc-section--tint')
    expect(html).toContain('kc-accordion')
  })

  it('sötét háttérsáv esetén a `dark` változat kerül a szekcióra', () => {
    const html = renderViaSwitch({
      blockType: 'accordion',
      id: 'b10',
      items: [{ id: 's11', cim: 'Sor', tartalom: richText('Tartalom') }],
      sectionSettings: { visible: true, hatter: 'sotet' },
    })
    expect(html).toContain('kc-section--dark')
  })

  it('visible=false esetén a szekció kimarad', () => {
    const html = renderViaSwitch({
      blockType: 'accordion',
      id: 'b11',
      title: 'Rejtett szekció',
      items: [{ id: 's12', cim: 'Sor', tartalom: richText('Tartalom') }],
      sectionSettings: { visible: false },
    })
    expect(html).toBe('')
  })

  it('a blokk NEM ad ki FAQPage JSON-LD-t (egy önéletrajz nem GYIK)', () => {
    const html = renderViaSwitch({
      blockType: 'accordion',
      id: 'b12',
      items: [{ id: 's13', cim: 'Publikációk', tartalom: richText('Egy', 'Kettő') }],
      sectionSettings: { visible: true },
    })
    expect(html).toContain('Publikációk')
    expect(html).not.toContain('FAQPage')
    expect(html).not.toContain('application/ld+json')
  })
})

// ---------------------------------------------------------------------------
// 4. Teljes CMS-vezéreltség
// ---------------------------------------------------------------------------

describe('Accordion — minden tartalom az adminból jön', () => {
  /** Látható szöveg a renderelt HTML-ből: tag-ek nélkül, összevont szóközökkel. */
  function visibleText(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  it('a látható szöveg KIZÁRÓLAG a mezők értéke — nincs beégetett szöveg', () => {
    // A jelzőértékek szándékosan NEM részhalmazai egymásnak: a kivonás egymás
    // után fut, egy közös részszó hamis maradékot hagyna.
    const sentinels = {
      eyebrow: 'Aa-jelzo',
      title: 'Bb-jelzo',
      lead: 'Cc-jelzo',
      cim: 'Dd-jelzo',
      osszefoglalo: 'Ee-jelzo',
      tartalom: 'Ff-jelzo',
    }
    const html = renderBlock({
      id: 'b13',
      blockType: 'accordion',
      eyebrow: sentinels.eyebrow,
      title: sentinels.title,
      lead: sentinels.lead,
      items: [
        {
          id: 's14',
          cim: sentinels.cim,
          osszefoglalo: sentinels.osszefoglalo,
          tartalom: richText(sentinels.tartalom),
        },
      ],
      sectionSettings: {},
    })

    let remaining = visibleText(html)
    for (const value of Object.values(sentinels)) {
      expect(remaining, `hiányzó mező-érték a kimenetből: ${value}`).toContain(value)
      remaining = remaining.split(value).join(' ')
    }
    // A +/− jelet CSS rajzolja, tehát a DOM-ban SEMMI nem marad a mezőkön kívül.
    expect(remaining.replace(/\s/g, '')).toBe('')
  })

  it('üres mezők nem kapnak helykitöltőt — a hiányzó rész egyszerűen kimarad', () => {
    const html = renderBlock({
      id: 'b14',
      blockType: 'accordion',
      items: [{ id: 's15', cim: 'Csak cím', tartalom: richText('Csak tartalom') }],
      sectionSettings: {},
    })
    expect(visibleText(html)).toBe('Csak cím Csak tartalom')
    expect(html).not.toContain('kc-accordion__eyebrow')
    expect(html).not.toContain('kc-accordion__title')
    expect(html).not.toContain('kc-accordion__lead')
    expect(html).not.toContain('kc-accordion__summary-note')
  })

  it('a sorok sorrendje a tömb sorrendje — az adminban átrendezhető', () => {
    const elso = renderBlock({
      id: 'b15',
      blockType: 'accordion',
      items: [
        { id: 's16', cim: 'Első sor', tartalom: richText('A') },
        { id: 's17', cim: 'Második sor', tartalom: richText('B') },
      ],
      sectionSettings: {},
    })
    const csereltek = renderBlock({
      id: 'b16',
      blockType: 'accordion',
      items: [
        { id: 's17', cim: 'Második sor', tartalom: richText('B') },
        { id: 's16', cim: 'Első sor', tartalom: richText('A') },
      ],
      sectionSettings: {},
    })
    expect(elso.indexOf('Első sor')).toBeLessThan(elso.indexOf('Második sor'))
    expect(csereltek.indexOf('Második sor')).toBeLessThan(csereltek.indexOf('Első sor'))
  })
})

// ---------------------------------------------------------------------------
// 5. Stíluslap-őrök
// ---------------------------------------------------------------------------

describe('accordion.css szabály-őrök', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../app/(frontend)/styles/blocks/accordion.css', import.meta.url)),
    'utf8',
  )

  it('a kiemelt szöveg accent-DEEP-et visz; a nyers `accent` sehol nem jelenik meg', () => {
    expect(css).toContain('--kc-accordion-accent-text: var(--kc-color-primary)')
    // A --kc-color-primary maga az accent-deep aliasa (tokens.css). A nyers
    // --kc-color-accent a hűvös felületeken 4,07:1 — AA alatt, ezért itt tilos.
    expect(css).not.toMatch(/var\(--kc-color-accent\)/)
  })

  it('a nyitható sor legalább 44px érintési célfelület (UX-skill 3. pont)', () => {
    const summary = css.slice(css.indexOf('.kc-accordion__summary {'))
    expect(summary.slice(0, summary.indexOf('}'))).toContain('min-height: 2.75rem')
  })

  it('a summary hoveren és nyitva sem fest hátteret (tint sávon se surface-raised)', () => {
    const kod = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kod).not.toContain('--kc-accordion-hover')
    expect(kod).not.toMatch(/\.kc-accordion__summary:hover/)
    expect(kod).not.toContain('--kc-color-surface-raised')
    const hatterek = [...kod.matchAll(/background(?:-color)?\s*:\s*[^;]+/g)].map((m) => m[0].trim())
    expect(hatterek).toEqual(['background-color: transparent'])
    expect(kod).toContain('.kc-accordion__summary:focus-visible')
  })

  it('a portré-doboz tokenekből áll: kör (radius-full), 40px mobilon, 48px 900px felett', () => {
    const kod = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const doboz = kod.slice(kod.indexOf('.kc-accordion__portrait {'))
    expect(doboz).toContain('border-radius: var(--kc-radius-full)')
    expect(doboz).toContain('width: 2.5rem')
    const desktop = kod.slice(kod.indexOf('@media (min-width: 900px)'))
    expect(desktop).toContain('.kc-accordion__portrait')
    expect(desktop).toContain('width: 3rem')
    expect(kod).toContain('.kc-accordion__portrait img')
    expect(kod).toContain('object-fit: cover')
  })

  it('a böngésző-alapértelmezett háromszög helyett saját jelet rajzol', () => {
    expect(css).toContain('list-style: none')
    expect(css).toContain('.kc-accordion__summary::-webkit-details-marker')
  })

  /**
   * WP27 (2026-09-07, tulajdonosi hibajelzés: „ahogy kinyitom a dobozt, nagyon
   * hirtelen"). A +/− jel két VONAL (border), a függőleges szár nyitva 90°-ot
   * fordul; karakter-csere (+ → −) nem animálható. A vonal nem háttér: a
   * summary-sor egyetlen háttér-deklarációja a transparent marad (fenti őr).
   */
  it('a +/− jel két vonal, a függőleges szár nyitva 90°-ot fordul (nem karakter-csere)', () => {
    const kod = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kod).not.toMatch(/content:\s*'\+'/)
    expect(kod).not.toMatch(/content:\s*'\\2212'/)
    const utan = kod.slice(kod.indexOf('.kc-accordion__summary::after {'))
    expect(utan.slice(0, utan.indexOf('}'))).toContain('border-top: 2px solid')
    const elott = kod.slice(kod.indexOf('.kc-accordion__summary::before {'))
    expect(elott.slice(0, elott.indexOf('}'))).toContain('border-left: 2px solid')
    expect(elott.slice(0, elott.indexOf('}'))).toContain(
      'transition: transform var(--kc-accordion-motion-open) var(--kc-ease-out)',
    )
    expect(kod).toMatch(
      /\.kc-accordion__item\[open\] \.kc-accordion__summary::before \{[^}]*rotate\(90deg\)/,
    )
  })

  /**
   * A NYITÓ irány a szekció saját szabálya: mérve a közös 200 ms-os ease-out
   * az első képkockában a nézetablaknyi tartalmat nyitotta (ugrás). Itt 280 ms
   * (--kc-motion-base × 1,4, a 240–320 ms-es sáv közepe), Material 3 standard
   * görbe a magasságon, áttűnés a tartalmon; a csukás marad 200 ms. A szabály
   * @supports mögött áll (natív tartalék), a nem támogató böngésző JS nélküli
   * áttűnést kap, és reduce alatt SEMMI nem animál (WCAG 2.2 SC 2.3.3).
   */
  it('a nyitás 280 ms-os saját átmenet, tartalékkal, reduce alatt kikapcsolva', () => {
    const kod = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kod).toContain('--kc-accordion-motion-open: calc(var(--kc-motion-base) * 1.4)')
    const tamogatas = kod.indexOf(
      '@supports (interpolate-size: allow-keywords) and selector(::details-content)',
    )
    expect(tamogatas).toBeGreaterThanOrEqual(0)
    const nyitva = kod.slice(
      kod.indexOf('.kc-accordion .kc-accordion__item[open]::details-content {'),
    )
    expect(nyitva.indexOf('{')).toBeGreaterThanOrEqual(0)
    const nyitvaTorzs = nyitva.slice(0, nyitva.indexOf('}'))
    expect(nyitvaTorzs).toContain('block-size: auto')
    expect(nyitvaTorzs).toContain('opacity: 1')
    expect(nyitvaTorzs).toContain(
      'block-size var(--kc-accordion-motion-open) cubic-bezier(0.4, 0, 0.2, 1)',
    )
    // A csukáshoz kötelező diszkrét átmenet mindkét állapoton ott van.
    expect(nyitvaTorzs).toContain(
      'content-visibility var(--kc-accordion-motion-open) allow-discrete',
    )
    expect(kod).toContain('content-visibility var(--kc-motion-base) allow-discrete')
    // Tartalék: nem támogató böngészőn egyirányú áttűnés, JS nélkül.
    const tartalek = kod.slice(kod.indexOf('@supports not (interpolate-size: allow-keywords)'))
    expect(tartalek).toContain('@keyframes kc-accordion-panel-in')
    expect(tartalek).toContain('.kc-accordion__item[open] .kc-accordion__panel')
    // Csökkentett mozgás: átmenet és animáció nélkül, a kezdőállapot is látható.
    const csokkentett = kod.slice(kod.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(csokkentett).toContain('transition: none')
    expect(csokkentett).toContain('animation: none')
    expect(csokkentett).toContain('opacity: 1')
    expect(csokkentett).toContain('.kc-accordion__summary::before')
  })
})
