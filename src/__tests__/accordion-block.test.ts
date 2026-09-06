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
          cim: 'Kocsis Kata — szakmai önéletrajz',
          osszefoglalo: '38 tanfolyam · 7 konferencia',
          tartalom: richText('Gyógytornász, sportrehabilitációs tréner'),
        },
      ],
      sectionSettings: {},
    })

    expect(html).toContain('<details class="kc-accordion__item">')
    expect(html).toContain('<summary class="kc-accordion__summary">')
    expect(html).toContain('Kocsis Kata — szakmai önéletrajz')
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

  it('a böngésző-alapértelmezett háromszög helyett saját jelet rajzol', () => {
    expect(css).toContain('list-style: none')
    expect(css).toContain('.kc-accordion__summary::-webkit-details-marker')
  })
})
