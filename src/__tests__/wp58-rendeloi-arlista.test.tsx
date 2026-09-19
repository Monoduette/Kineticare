import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { ctaLabel } from '../lib/cta-vocabulary'
import { CLINIC_TREATMENTS_ANCHOR } from '../lib/menu-seed'
import { felismerRendeloiArlista, labjegyzetMondat } from '../lib/rendeloi-arlista'
import type { Page } from '../payload-types'
import {
  buildSzolgaltatasokLayout,
  bulletList,
  heading,
  para,
  paragraph,
  richText,
  textNode,
} from '../scripts/restore-legacy-content'
import {
  hosszPx,
  sajatErtek,
  stilusLapNezetablakra,
  tokenek,
  varFeloldas,
  type Elem,
} from './helpers/css-geometria'
import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * WP58: A RENDELŐI ÁRLISTA SZERKEZETES ALAKJA (tulajdonosi kérés, 2026-09-19).
 *
 * A tulajdonos: a /szolgaltatasok „Rendelői kezelések" része „nem annyira
 * esztétikus … egymás mellé kellene rendezni a dolgokat … az időpontot kérek
 * link az legyen egy gomb ugyanebben a szekcióban". Mérve ELŐTTE élőben
 * (Chromium): 1440 px-en a szekció 938 px magas, 720 px-es szűk hasábban,
 * a két ár-tétel 127 px magas, azonos zárójeles magyarázattal; az időpontkérés
 * 133×26 px-es szöveglink. UTÁNA (fixture-render, valódi CSS és betűk):
 * 1440 px: 691 px, két hasáb (427 / 597 px), két 291 px-es kártya egymás
 * mellett, a gomb 281×55 px; 768 px: egy hasáb, a kártyák 352 px-en egymás
 * mellett; 390 és 320 px: a kártyák egymás alatt (342 / 272 px), a gomb
 * teljes szélességű, a dokumentum nem szélesebb a nézetablaknál.
 *
 * Mit véd ez az őr:
 *  H1  A felismerés az ÉLŐ (2026-09-19) és a SEED-beli alakon egyaránt
 *      szerkezetet ad: cím, bevezető, két tétel, közös megjegyzés, tények,
 *      helyszínek, CTA-link.
 *  H2  A RenderBlocks a `rendeloi` horgonyú blokkot a szerkezetes alakban
 *      rendereli: egy gomb (§3.2 #24 felirat, másodlagos, a CMS-link célja),
 *      két kártya, a megjegyzés EGYSZER.
 *  H3  Visszaesés: más horgonyon vagy fel nem ismerhető szerkezeten a sima
 *      `.kc-richtext` marad, a szöveg hiánytalanul.
 *  H4  Reflow-geometria a stíluslapból: 320 px-en egyetlen oszlop, a
 *      kártyarács padlója a hasábnál nem szélesebb; 900 px-től két hasáb.
 *  H5  Gondolatjel (U+2013, U+2014) sem a módosított forrásban, sem a
 *      renderelt kimeneten (a CMS-ből érkező „–" a felismerésben elválasztó,
 *      a kimenetre nem jut).
 *
 * Források: NN/g Comparison Tables (≤ 5 alternatíva egymás mellett, azonos
 * attribútum-sorrend, https://www.nngroup.com/articles/comparison-tables/);
 * NN/g Proximity Principle (https://www.nngroup.com/articles/gestalt-proximity/);
 * Baymard Plan Matrix (https://baymard.com/ecommerce-design-examples/plan-matrix);
 * GOV.UK Summary list (https://design-system.service.gov.uk/components/summary-list/);
 * GOV.UK Button (egy fő cselekvés laponként,
 * https://design-system.service.gov.uk/components/button/); WCAG 2.2 SC 2.5.8
 * (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
 * SC 1.4.10 (https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
 * SC 3.2.4 (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const GYOKER_BETU = 16
const MERESI_MAGASSAG_PX = 1000

const LAPOK = [
  `${REPO}app/(frontend)/styles/tokens.css`,
  `${REPO}app/(frontend)/styles/base.css`,
  `${REPO}app/(frontend)/styles/ui.css`,
  `${REPO}app/(frontend)/styles/content.css`,
  `${REPO}app/(frontend)/styles/blocks/rendeloi-arlista.css`,
]

const MODOSITOTT_FORRASOK = [
  `${REPO}lib/rendeloi-arlista.ts`,
  `${REPO}components/blocks/RendeloiArlista.tsx`,
  `${REPO}app/(frontend)/styles/blocks/rendeloi-arlista.css`,
]

// ---------------------------------------------------------------------------
// Fixture: az élő blokk 2026-09-19-i alakja (a szerkesztők által gondozott
// szöveg, gondolatjeles elválasztókkal), és a seed alakja.
// ---------------------------------------------------------------------------

const link = (url: string, label: string) =>
  ({
    type: 'link',
    fields: { linkType: 'custom', url, newTab: false },
    children: [textNode(label)],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  }) as unknown as ReturnType<typeof textNode>

const MEGJEGYZES =
  'tartalmazza a szükség szerinti Kinesio Tape vagy Dynamic Tape® felhelyezését, flossing-, köpöly- és/vagy eszközös lágyrész-manuálterápiás kezeléseket'

const eloTartalom = () =>
  richText([
    heading('h2', 'Rendelői kezelések'),
    para(
      'Személyes vizsgálat után gyógytornával, manuálterápiával és szükség szerint kiegészítő technikákkal dolgozunk. A kezelési tervet a panaszaidhoz és a terhelhetőségedhez igazítjuk.',
    ),
    heading('h3', `Árlista ${EN_DASH} gyógytorna / manuálterápia`),
    bulletList([
      `50 perces alkalom ${EN_DASH} 18 000 Ft (${MEGJEGYZES})`,
      `20 perces alkalom ${EN_DASH} 10 000 Ft (${MEGJEGYZES})`,
    ]),
    para(
      'Az első alkalom minden esetben 50 perces vizsgálatot foglal magába. Rendelőinkben készpénzes és átutalásos fizetésre van lehetőség.',
    ),
    para('Helyszíneink: 1117 Budapest, Nádorliget u. 7/b • 1114 Budapest, Fadrusz utca 15.'),
    paragraph([
      textNode('Személyes kezelésre a kapcsolat oldalon tudsz jelentkezni: '),
      link('/kapcsolat', 'időpontot kérek'),
      textNode('.'),
    ]),
  ])

type Layout = NonNullable<Page['layout']>

const richTextBlokk = (content: unknown, anchorId: string): Layout[number] =>
  ({
    id: 'wp58',
    blockType: 'richText',
    content,
    sectionSettings: { visible: true, anchorId, hatter: 'feher' },
  }) as unknown as Layout[number]

const render = (layout: Layout) =>
  renderToStaticMarkup(
    createElement(RenderBlocks, { layout, products: [], posts: [], testimonials: [] }),
  )

/** A seed rendelői blokkja (a horgony CLINIC_TREATMENTS_ANCHOR). */
const seedRendeloiBlokk = (): Layout[number] => {
  const blokk = buildSzolgaltatasokLayout().find(
    (candidate) =>
      candidate.blockType === 'richText' &&
      candidate.sectionSettings?.anchorId === CLINIC_TREATMENTS_ANCHOR,
  )
  if (!blokk) throw new Error('a seedben nincs rendelői richText blokk')
  return blokk
}

// ---------------------------------------------------------------------------
// H1 — felismerés
// ---------------------------------------------------------------------------

describe('WP58 H1: a rendelői árlista felismerése', () => {
  it('az élő alakból címet, bevezetőt, két tételt, közös megjegyzést, tényeket, helyszíneket és CTA-t ad', () => {
    const modell = felismerRendeloiArlista(eloTartalom())
    expect(modell).not.toBeNull()
    if (!modell) return
    expect(modell.cim).toBe('Rendelői kezelések')
    expect(modell.cimTag).toBe('h2')
    expect(modell.bevezeto).toHaveLength(1)
    expect(modell.arlistaCim).toBe('Árlista')
    expect(modell.arlistaAlcim).toBe('gyógytorna / manuálterápia')
    expect(
      modell.tetelek.map((tetel) => [tetel.idotartam, tetel.ar.replace(/\u00a0/gu, ' ')]),
    ).toEqual([
      ['50 perces alkalom', '18 000 Ft'],
      ['20 perces alkalom', '10 000 Ft'],
    ])
    expect(modell.tetelek.every((tetel) => tetel.megjegyzes === null)).toBe(true)
    expect(modell.kozosMegjegyzes).toBe(MEGJEGYZES)
    expect(modell.tenyek).toEqual([
      'Az első alkalom minden esetben 50 perces vizsgálatot foglal magába.',
      'Rendelőinkben készpénzes és átutalásos fizetésre van lehetőség.',
    ])
    expect(modell.helyszinek).toEqual({
      cimke: 'Helyszíneink',
      cimek: ['1117 Budapest, Nádorliget u. 7/b', '1114 Budapest, Fadrusz utca 15'],
    })
    expect(modell.cta?.type).toBe('link')
  })

  it('a seed alakját is felismeri (h3-as cím, bevezető lista, kettőspontos árlista-cím)', () => {
    const blokk = seedRendeloiBlokk()
    const modell = felismerRendeloiArlista((blokk as { content?: unknown }).content)
    expect(modell).not.toBeNull()
    if (!modell) return
    expect(modell.cimTag).toBe('h3')
    expect(modell.bevezeto.length).toBeGreaterThan(1)
    expect(modell.tetelek).toHaveLength(2)
    expect(modell.kozosMegjegyzes).not.toBeNull()
    expect(modell.helyszinek?.cimek).toHaveLength(2)
    expect(modell.cta).not.toBeNull()
  })

  it('eltérő megjegyzéseknél a megjegyzés a tételen marad, közös nincs', () => {
    const modell = felismerRendeloiArlista(
      richText([
        heading('h2', 'Rendelői kezelések'),
        heading('h3', 'Árlista'),
        bulletList(['50 perces alkalom: 18 000 Ft (első alkalom)', '20 perces alkalom: 10 000 Ft']),
      ]),
    )
    expect(modell?.kozosMegjegyzes).toBeNull()
    expect(modell?.tetelek.map((tetel) => tetel.megjegyzes)).toEqual(['első alkalom', null])
  })

  it('nem ismer fel: hiányzó árlista-címsor, nem ár-alakú tétel, két link, üres tartalom', () => {
    expect(felismerRendeloiArlista(null)).toBeNull()
    expect(felismerRendeloiArlista({ root: { children: [] } })).toBeNull()
    expect(
      felismerRendeloiArlista(
        richText([heading('h2', 'Rendelői kezelések'), para('Csak szöveg.')]),
      ),
    ).toBeNull()
    expect(
      felismerRendeloiArlista(
        richText([heading('h2', 'Cím'), heading('h3', 'Árlista'), bulletList(['Gyógytorna'])]),
      ),
    ).toBeNull()
    expect(
      felismerRendeloiArlista(
        richText([
          heading('h2', 'Cím'),
          heading('h3', 'Árlista'),
          bulletList(['50 perces alkalom: 18 000 Ft']),
          paragraph([link('/kapcsolat', 'egy')]),
          paragraph([link('/kapcsolat', 'kettő')]),
        ]),
      ),
    ).toBeNull()
  })

  it('a lábjegyzet mondat: nagy kezdőbetű és záró pont, a szöveg többi része változatlan', () => {
    expect(labjegyzetMondat(MEGJEGYZES)).toBe(`T${MEGJEGYZES.slice(1)}.`)
    expect(labjegyzetMondat('Már mondat.')).toBe('Már mondat.')
  })
})

// ---------------------------------------------------------------------------
// H2 — renderelés
// ---------------------------------------------------------------------------

describe('WP58 H2: a szerkezetes alak renderelése', () => {
  const html = render([richTextBlokk(eloTartalom(), CLINIC_TREATMENTS_ANCHOR)])

  it('a szekció a horgonyt viseli és a szerkezetes alakban áll', () => {
    expect(html).toContain(`id="${CLINIC_TREATMENTS_ANCHOR}"`)
    expect(html).toContain('class="kc-section kc-arlista"')
    expect(html).toContain('aria-labelledby="rendeloi-cim-wp58"')
    expect(html).toContain(
      '<h2 class="kc-section-title kc-arlista__title" id="rendeloi-cim-wp58">Rendelői kezelések</h2>',
    )
  })

  it('PONTOSAN EGY gomb: a §3.2 #24 felirat, másodlagos súly, a CMS-link célja', () => {
    const gombok = html.match(/<a class="kc-button[^"]*"[^>]*>[^<]*<\/a>/gu) ?? []
    expect(gombok).toHaveLength(1)
    expect(gombok[0]).toContain('kc-button--secondary')
    expect(gombok[0]).toContain('href="/kapcsolat"')
    expect(gombok[0]).toContain(`>${ctaLabel('appointment-request-link')}<`)
    // A régi mondatba ágyazott szöveglink nem marad meg mellette.
    expect(html).not.toContain('időpontot kérek')
    expect(html).not.toContain('kapcsolat oldalon tudsz jelentkezni')
  })

  it('két árkártya időtartammal és árral, a megjegyzés egyszer, a tények és a két helyszín', () => {
    expect(html.match(/kc-arlista__card"/gu)).toHaveLength(2)
    expect(html).toContain('<span class="kc-arlista__duration">50 perces alkalom</span>')
    expect(html).toContain('<span class="kc-arlista__price">18\u00a0000\u00a0Ft</span>')
    expect(html).toContain('<span class="kc-arlista__price">10\u00a0000\u00a0Ft</span>')
    expect(html.match(/Kinesio Tape/gu)).toHaveLength(1)
    expect(html).toContain('<p class="kc-arlista__note">Tartalmazza a szükség szerinti')
    expect(html).toContain('Az első alkalom minden esetben 50 perces vizsgálatot foglal magába.')
    expect(html).toContain('Rendelőinkben készpénzes és átutalásos fizetésre van lehetőség.')
    expect(html).toContain('<span class="kc-arlista__fact-key">Helyszíneink</span>')
    expect(html.match(/kc-arlista__place"/gu)).toHaveLength(2)
    expect(html).toContain(
      'Árlista<span class="kc-arlista__panel-sub">gyógytorna / manuálterápia</span>',
    )
  })

  it('a seed rendelői blokkja ugyanígy a szerkezetes alakot kapja, a címsor szintje h3 marad', () => {
    const seedHtml = render([seedRendeloiBlokk()])
    expect(seedHtml).toContain('kc-arlista__card')
    expect(seedHtml).toContain('<h3 class="kc-section-title kc-arlista__title"')
    expect(seedHtml).toContain(`>${ctaLabel('appointment-request-link')}<`)
  })
})

// ---------------------------------------------------------------------------
// H3 — visszaesés
// ---------------------------------------------------------------------------

describe('WP58 H3: visszaesés sima folyószövegre', () => {
  it('más horgonyon a blokk a sima richText marad, a szöveglinkkel', () => {
    const html = render([richTextBlokk(eloTartalom(), 'masik')])
    expect(html).not.toContain('kc-arlista')
    expect(html).toContain('class="kc-richtext"')
    expect(html).toContain('<a href="/kapcsolat">időpontot kérek</a>')
  })

  it('a rendelői horgonyon, fel nem ismerhető szerkezetnél is a sima richText marad, semmi nem vész el', () => {
    const html = render([
      richTextBlokk(
        richText([heading('h2', 'Rendelői kezelések'), para('Átírt, árlista nélküli szöveg.')]),
        CLINIC_TREATMENTS_ANCHOR,
      ),
    ])
    expect(html).not.toContain('kc-arlista')
    expect(html).toContain('<h2>Rendelői kezelések</h2>')
    expect(html).toContain('Átírt, árlista nélküli szöveg.')
  })
})

// ---------------------------------------------------------------------------
// H4 — reflow-geometria a stíluslapból
// ---------------------------------------------------------------------------

const lapNezetablakra = (nezetablak: number) =>
  stilusLapNezetablakra(LAPOK, nezetablak, MERESI_MAGASSAG_PX)

const osztalyElem = (osztaly: string): Elem => ({
  elemnev: '',
  szulo: null,
  osztaly,
  ostagOsztaly: null,
})

describe('WP58 H4: reflow-geometria', () => {
  it('320 px-en a fő rács egyetlen oszlop, 900 px-től két hasáb', () => {
    const keskeny = sajatErtek(
      lapNezetablakra(320),
      osztalyElem('.kc-arlista__grid'),
      'grid-template-columns',
    )
    expect(keskeny).toBe('minmax(0, 1fr)')
    const szeles = sajatErtek(
      lapNezetablakra(1440),
      osztalyElem('.kc-arlista__grid'),
      'grid-template-columns',
    )
    expect(szeles).toBe('minmax(0, 5fr) minmax(0, 7fr)')
  })

  it('a kártyarács padlója a 320 px-es hasábban sem szélesebb a hasábnál (min(100%, 12rem))', () => {
    const lap = lapNezetablakra(320)
    const oszlopok = sajatErtek(lap, osztalyElem('.kc-arlista__cards'), 'grid-template-columns')
    expect(oszlopok).toBe('repeat(auto-fit, minmax(min(100%, 12rem), 1fr))')
    const gutter = hosszPx(
      varFeloldas('var(--kc-container-gutter)', tokenek(lap)),
      320,
      GYOKER_BETU,
      GYOKER_BETU,
    )
    const hasab = 320 - 2 * gutter
    // 12rem = 192 px < 272 px: a min() a 12rem-et választja, a kártya belefér;
    // két kártya + köz (192 + 16 + 192 = 400) nem fér el → egymás alá kerülnek.
    expect(12 * GYOKER_BETU).toBeLessThan(hasab)
    expect(2 * 12 * GYOKER_BETU + 16).toBeGreaterThan(hasab)
  })

  it('a gomb a közös kc-button: legalább 44 px-es érintőcél (SC 2.5.8 fölött)', () => {
    const minMagassag = sajatErtek(lapNezetablakra(390), osztalyElem('.kc-button'), 'min-height')
    expect(minMagassag).toBe('2.75rem')
    expect(hosszPx('2.75rem', 390, GYOKER_BETU, GYOKER_BETU)).toBeGreaterThanOrEqual(44)
  })

  it('minden betűméret a három tokenről jön, nyers px nincs a stíluslapban', () => {
    const forras = readFileSync(`${REPO}app/(frontend)/styles/blocks/rendeloi-arlista.css`, 'utf8')
    const meretek = forras.match(/font-size:\s*[^;]+;/gu) ?? []
    expect(meretek.length).toBeGreaterThan(0)
    for (const meret of meretek) expect(meret).toMatch(/var\(--kc-font-(l|m|s)\)/u)
    expect(forras.replace(/\/\*[\s\S]*?\*\//gu, '')).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
  })
})

// ---------------------------------------------------------------------------
// H5 — gondolatjel-tilalom
// ---------------------------------------------------------------------------

describe('WP58 H5: gondolatjel sem a forrásban, sem a kimeneten', () => {
  it('a módosított forrásfájlok kódsoraiban nincs U+2014', () => {
    for (const fajl of MODOSITOTT_FORRASOK) {
      const kod = readFileSync(fajl, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
      const kodsorok = kod.split('\n').filter((sor) => !sor.trim().startsWith('//'))
      expect(kodsorok.join('\n'), fajl).not.toContain(EM_DASH)
    }
  })

  it('a szerkezetes kimeneten a CMS gondolatjelei nem jelennek meg', () => {
    const html = render([richTextBlokk(eloTartalom(), CLINIC_TREATMENTS_ANCHOR)])
    expect(html).not.toContain(EN_DASH)
    expect(html).not.toContain(EM_DASH)
  })
})
