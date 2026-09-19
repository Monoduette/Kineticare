import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PageHero } from '../components/content/PageHero'
import { PostArticle } from '../components/content/PostArticle'
import type { Media, Post } from '../payload-types'
import {
  hosszPx,
  sajatErtek,
  stilusLapNezetablakra,
  szabalyok,
  tokenek,
  varFeloldas,
  type Elem,
} from './helpers/css-geometria'
import { betuMetrika, szoSzelessegPx } from './helpers/font-metrics'

/**
 * WP57: A TUDÁSTÁR-CIKK OLVASÓHASÁBJA (tulajdonosi kérés, 2026-09-19).
 *
 * A tulajdonos: a cikkek „lehetnek szélesebbek, olyan szélesek, mint amit
 * kiemeltek a lányok, hogy túl keskeny". Mérve ELŐTTE élőben (Chromium,
 * /befagyott-vall, a bekezdés saját szövegén):
 *   1440 px: a fejléc 720 px-es sávja, a cím 672 px, a bevezető 544 px
 *            (64 karakter/sor); a törzs bekezdése 544 px (34rem), 19 px,
 *            66 karakter/sor, a 672 px-es hasáb jobb szélén 128 px üres;
 *   1024 px: bekezdés 544 px, 17,9 px, 70 karakter/sor;
 *    390 px: bekezdés 342 px, 16,2 px, 49 karakter/sor;
 *    320 px: bekezdés 272 px, 16 px, 39 karakter/sor;
 *   a /blog lista kártyái 1440-en 524 px, 390-en 342 px.
 *
 * Mit véd ez az őr:
 *  H1  A törzs sapkája 33em (a Rólunk WP51-es mértéke), és ez SZÉLESEBB a
 *      korábbi 34rem-nél, de belefér a 720 px-es hasábba, ahol az él.
 *  H2  A karakter/sor a VALÓDI betű-metrikából számolva 1440, 1024 és 768
 *      px-en a WCAG 2.2 SC 1.4.8 80-as plafonja alatt és 45 fölött marad;
 *      390 px-en a hasáb szab (nem a sapka), 320 px-en nincs túlcsordulás.
 *  H3  A hosszabb sort nagyobb sortáv hordozza: a törzs sortávja legalább
 *      1,5 (SC 1.4.8 negyedik feltétele).
 *  H4  A fejléc borítóképpel a PageHero páros alakja (széles konténer, a
 *      kép a cím mellett, 900 px alatt alatta), kép nélkül a szűk alak; a
 *      sorrend mindkét alakban morzsa, kategória, cím, bevezető, meta.
 *  H5  A lista-kártya rácsa VÁLTOZATLAN (524 px 1440-en, 342 px 390-en).
 *  H6  Kvirtmínusz (U+2014) sem a módosított forrásban, sem a kimeneten.
 *
 * Források: NN/g Line Length Readability (50–75 karakter,
 * https://www.nngroup.com/articles/line-length-readability/); Baymard, Line
 * Length Readability (50–75, https://baymard.com/blog/line-length-readability);
 * GOV.UK Design System, Layout (a szöveg legfeljebb kétharmad,
 * https://design-system.service.gov.uk/styles/layout/); W3C Understanding
 * SC 1.4.8 (≤ 80 karakter, sorköz ≥ 1,5,
 * https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html);
 * W3C Understanding SC 1.4.10 Reflow
 * (https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const GYOKER_UT = fileURLToPath(new URL('../..', import.meta.url))
const GYOKER_BETU = 16
const MERESI_MAGASSAG_PX = 1000

const LAPOK = [
  `${REPO}app/(frontend)/styles/tokens.css`,
  `${REPO}app/(frontend)/styles/base.css`,
  `${REPO}app/(frontend)/styles/ui.css`,
  `${REPO}app/(frontend)/styles/content.css`,
  `${REPO}app/(frontend)/styles/blocks/post-view.css`,
  `${REPO}app/(frontend)/styles/blocks/tudastar-lista.css`,
]

const NUNITO = [
  `${GYOKER_UT}public/fonts/nunito-sans-var-latin.woff2`,
  `${GYOKER_UT}public/fonts/nunito-sans-var-latin-ext.woff2`,
]

/** A cikk-törzs sapkája, ahogy a WP51 a Rólunk törzsére írta (about.css). */
const SAPKA_EM = 33

const lapNezetablakra = (nezetablak: number) =>
  stilusLapNezetablakra(LAPOK, nezetablak, MERESI_MAGASSAG_PX)

const osztalyElem = (osztaly: string, ostag: string | null = null): Elem => ({
  elemnev: '',
  szulo: null,
  osztaly,
  ostagOsztaly: ostag,
})

/** Egy CSS-érték feloldva és pixelre váltva adott nézetablakon és betűn. */
function px(nezetablak: number, ertek: string, szuloBetu = GYOKER_BETU): number {
  const lap = lapNezetablakra(nezetablak)
  return hosszPx(varFeloldas(ertek, tokenek(lap)), nezetablak, szuloBetu, GYOKER_BETU)
}

/** A cikkoldal stíluslapjának SAJÁT szabálya, a szelektor pontos alakjával. */
function cikkSzabaly(szelektor: string): ReadonlyMap<string, string> {
  const forras = readFileSync(`${REPO}app/(frontend)/styles/blocks/post-view.css`, 'utf8')
  const talalat = szabalyok(forras).find((szabaly) => szabaly.szelektorok.includes(szelektor))
  if (talalat === undefined) throw new Error(`nincs szabály: ${szelektor}`)
  return talalat.deklaraciok
}

/** A lista-lap stíluslapjának SAJÁT szabálya. */
function listaSzabaly(szelektor: string): ReadonlyMap<string, string> {
  const forras = readFileSync(`${REPO}app/(frontend)/styles/blocks/tudastar-lista.css`, 'utf8')
  const talalat = szabalyok(forras).find((szabaly) => szabaly.szelektorok.includes(szelektor))
  if (talalat === undefined) throw new Error(`nincs szabály: ${szelektor}`)
  return talalat.deklaraciok
}

/** A szűk (720 px-es) hasáb tartalomszélessége adott nézetablakon. */
function szukHasab(nezetablak: number): number {
  const gutter = px(nezetablak, 'var(--kc-container-gutter)')
  const max = px(nezetablak, 'var(--kc-container-narrow)')
  return Math.min(nezetablak, max) - 2 * gutter
}

/** A széles (1120 px-es) hasáb tartalomszélessége adott nézetablakon. */
function szelesHasab(nezetablak: number): number {
  const gutter = px(nezetablak, 'var(--kc-container-gutter)')
  const max = px(nezetablak, 'var(--kc-container-wide)')
  return Math.min(nezetablak, max) - 2 * gutter
}

/** A törzs betűmérete (M lépcső) adott nézetablakon. */
const torzsBetu = (nezetablak: number): number => px(nezetablak, 'var(--kc-font-m)')

/** A sapka pixelben: 33em a törzs saját betűjén. */
const sapkaPx = (nezetablak: number): number => SAPKA_EM * torzsBetu(nezetablak)

/**
 * Átlagos magyar karakterszélesség a VALÓDI metszetből, a cikk saját
 * mondatán (ékezetes, hosszú szavakkal), nem angol mintán, nem becslésből.
 */
const MINTA =
  'A befagyott váll gyulladásos szakaszában a fájdalom éjszaka erősödik, a mozgástartomány pedig hetek alatt szűkül be.'
const nunito = betuMetrika(NUNITO, 400)
function karakterPerSor(dobozPx: number, betumeret: number): number {
  const atlag = szoSzelessegPx(nunito, MINTA, betumeret) / [...MINTA].length
  return dobozPx / atlag
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function textNode(text: string): Record<string, unknown> {
  return { type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }
}

function paragraph(text: string): Record<string, unknown> {
  return {
    type: 'paragraph',
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
    children: [textNode(text)],
  }
}

function lexical(children: Record<string, unknown>[]): Record<string, unknown> {
  return {
    root: { type: 'root', children, direction: 'ltr', format: '', indent: 0, version: 1 },
  }
}

const borito: Media = {
  id: 9,
  alt: 'Gyógytornász a váll mozgástartományát vizsgálja.',
  url: '/api/media/file/vall-vizsgalat.webp',
  filename: 'vall-vizsgalat.webp',
  mimeType: 'image/webp',
  width: 1600,
  height: 1067,
  createdAt: '',
  updatedAt: '',
}

function post(overrides: Record<string, unknown> = {}): Post {
  const base: Record<string, unknown> = {
    id: 1,
    title: 'Befagyott váll: mit tehetsz, és mikor kérj segítséget',
    slug: 'befagyott-vall',
    excerpt: 'A befagyott váll szakaszai, az otthoni teendők és a szakemberhez fordulás jelei.',
    status: 'published',
    publishedAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
    createdAt: '2026-08-20T08:00:00.000Z',
    content: lexical([paragraph(MINTA)]),
    categories: [{ id: 7, title: 'Váll és könyök', slug: 'vall-es-konyok' }],
  }
  return { ...base, ...overrides } as unknown as Post
}

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

/** A lap fejléc-része: az első (fejléc-) szekció zárásáig tartó HTML. */
function fejlec(html: string): string {
  const eleje = html.indexOf('kc-page-hero')
  expect(eleje).toBeGreaterThan(-1)
  const vege = html.indexOf('</section>', eleje)
  expect(vege).toBeGreaterThan(eleje)
  return html.slice(0, vege)
}

// ---------------------------------------------------------------------------
// H1 — a sapka
// ---------------------------------------------------------------------------

describe('H1 — a törzs sapkája 33em, szélesebb a réginél, és a hasábba fér', () => {
  it('a cikk-törzs bekezdése, listája, idézete, a jegyzék és a szerző-blokk 33em-et kap', () => {
    for (const szelektor of [
      '.kc-post-body .kc-richtext p',
      '.kc-post-body .kc-richtext ul',
      '.kc-post-body .kc-richtext ol',
      '.kc-post-body .kc-richtext blockquote',
      '.kc-post-body .kc-post-toc',
      '.kc-post-body .kc-post-author__person',
    ]) {
      expect(cikkSzabaly(szelektor).get('max-width'), szelektor).toBe(`${SAPKA_EM}em`)
    }
    expect(cikkSzabaly('.kc-post-hero .kc-page-hero__lead').get('max-width')).toBe(`${SAPKA_EM}em`)
  })

  it('a sapka pixelben 1440-en 627, 1024-en 590, 768-on 568 (a hasábba fér, és szélesebb a 34rem-nél)', () => {
    const regi = px(1440, 'var(--kc-measure)')
    expect(regi).toBeCloseTo(544, 0)
    const vart: Record<number, number> = { 1440: 627, 1024: 590.2, 768: 567.6 }
    for (const nezetablak of [1440, 1024, 768]) {
      const sapka = sapkaPx(nezetablak)
      expect(sapka, `${nezetablak} px`).toBeCloseTo(vart[nezetablak]!, 0)
      expect(sapka, `${nezetablak} px: a sapka a hasábba fér`).toBeLessThan(szukHasab(nezetablak))
      expect(sapka, `${nezetablak} px: szélesebb a korábbi mértéknél`).toBeGreaterThan(
        px(nezetablak, 'var(--kc-measure)'),
      )
    }
  })

  it('a közös .kc-richtext (kurzus-leírás, jogi oldalak) mértéke marad a 34rem-es token', () => {
    const lap = lapNezetablakra(1440)
    expect(sajatErtek(lap, { elemnev: 'p', szulo: null, osztaly: null, ostagOsztaly: '.kc-richtext' }, 'max-width')).toBe(
      'var(--kc-measure)',
    )
  })
})

// ---------------------------------------------------------------------------
// H2 + H3 — karakter/sor a valódi metrikából, sortáv
// ---------------------------------------------------------------------------

describe('H2 — karakter/sor a valódi betű-metrikából', () => {
  it('1440, 1024 és 768 px-en a sapka szab: 45 és 80 karakter/sor között', () => {
    for (const nezetablak of [1440, 1024, 768]) {
      const doboz = Math.min(sapkaPx(nezetablak), szukHasab(nezetablak))
      expect(doboz).toBe(sapkaPx(nezetablak))
      const kps = karakterPerSor(doboz, torzsBetu(nezetablak))
      expect(kps, `${nezetablak} px: ${kps.toFixed(1)} karakter/sor`).toBeLessThanOrEqual(80)
      expect(kps, `${nezetablak} px: ${kps.toFixed(1)} karakter/sor`).toBeGreaterThanOrEqual(45)
    }
  })

  it('a mért sor ≈ 75 karakter (a Baymard-sáv teteje), és több a korábbi ~66-nál', () => {
    const uj = karakterPerSor(sapkaPx(1440), torzsBetu(1440))
    const regi = karakterPerSor(px(1440, 'var(--kc-measure)'), torzsBetu(1440))
    expect(uj).toBeGreaterThan(regi)
    expect(uj).toBeGreaterThanOrEqual(70)
    expect(uj).toBeLessThanOrEqual(78)
  })

  it('390 px-en a hasáb szab (nem a sapka), legalább 45 karakter/sor', () => {
    const hasab = szukHasab(390)
    expect(hasab).toBe(342)
    expect(sapkaPx(390)).toBeGreaterThan(hasab)
    expect(karakterPerSor(hasab, torzsBetu(390))).toBeGreaterThanOrEqual(45)
  })

  it('320 px-en nincs túlcsordulás: a sapka nagyobb a 272 px-es hasábnál, tehát a sor a hasáb (reflow)', () => {
    const hasab = szukHasab(320)
    expect(hasab).toBe(272)
    expect(sapkaPx(320)).toBeGreaterThan(hasab)
    // A `max-width` csak szűkít, sosem tágít: a bekezdés a hasábnál nem lehet
    // szélesebb, a dokumentum 320 px marad (WCAG 2.2 SC 1.4.10).
    expect(Math.min(sapkaPx(320), hasab)).toBe(hasab)
  })
})

describe('H3 — a hosszabb sort nagyobb sortáv hordozza', () => {
  it('a törzs sortávja a leading-body token, legalább 1,5 (SC 1.4.8)', () => {
    const lap = lapNezetablakra(1440)
    const sortav = sajatErtek(lap, osztalyElem('.kc-richtext'), 'line-height')
    expect(sortav).toBe('var(--kc-leading-body)')
    expect(Number.parseFloat(varFeloldas(sortav!, tokenek(lap)))).toBeGreaterThanOrEqual(1.5)
  })
})

// ---------------------------------------------------------------------------
// H4 — a fejléc
// ---------------------------------------------------------------------------

describe('H4 — a fejléc a PageHero mintáját követi', () => {
  it('borítóképpel: páros alak, széles konténer, a kép a szöveg UTÁN a DOM-ban', () => {
    const html = fejlec(render(createElement(PostArticle, { post: post({ heroImage: borito }) })))
    expect(html).toContain('kc-page-hero--paired')
    expect(html).toContain('kc-post-hero')
    expect(html).toContain('kc-page-hero__grid')
    expect(html).not.toContain('kc-container--narrow')
    expect(html).not.toContain('kc-page-hero__media')
    const morzsa = html.indexOf('kc-post-breadcrumb')
    const kategoria = html.indexOf('kc-post-hero__categories')
    const cim = html.indexOf('kc-page-hero__title')
    const lead = html.indexOf('kc-page-hero__lead')
    const meta = html.indexOf('kc-post-meta')
    const figure = html.indexOf('<figure class="kc-page-hero__figure">')
    expect(morzsa).toBeGreaterThan(-1)
    expect(kategoria).toBeGreaterThan(morzsa)
    expect(cim).toBeGreaterThan(kategoria)
    expect(lead).toBeGreaterThan(cim)
    expect(meta).toBeGreaterThan(lead)
    expect(figure).toBeGreaterThan(meta)
    // A borító a lap LCP-jelöltje: nem lusta, és a leírása a Media alt-ja.
    expect(html).not.toContain('loading="lazy"')
    expect(html).toContain(borito.alt)
  })

  it('borítókép nélkül: a szűk alak, páros osztály és figure nélkül, azonos sorrendben', () => {
    const html = fejlec(render(createElement(PostArticle, { post: post() })))
    expect(html).toContain('kc-container--narrow')
    expect(html).toContain('kc-post-hero')
    expect(html).not.toContain('kc-page-hero--paired')
    expect(html).not.toContain('<figure')
    const morzsa = html.indexOf('kc-post-breadcrumb')
    const kategoria = html.indexOf('kc-post-hero__categories')
    const cim = html.indexOf('kc-page-hero__title')
    const lead = html.indexOf('kc-page-hero__lead')
    const meta = html.indexOf('kc-post-meta')
    expect(morzsa).toBeGreaterThan(-1)
    expect(kategoria).toBeGreaterThan(morzsa)
    expect(cim).toBeGreaterThan(kategoria)
    expect(lead).toBeGreaterThan(cim)
    expect(meta).toBeGreaterThan(lead)
  })

  it('pontosan EGY h1 mindkét alakban', () => {
    for (const p of [post(), post({ heroImage: borito })]) {
      const html = render(createElement(PostArticle, { post: p }))
      expect(html.match(/<h1\b/g)?.length).toBe(1)
    }
  })

  it('a PageHero a CMS-oldalon változatlan: eyebrow és meta nélkül ugyanaz a kimenet', () => {
    const html = render(createElement(PageHero, { title: 'Bármely oldal', lead: 'Bevezető.', media: null }))
    expect(html).toContain('<h1 class="kc-page-hero__title">Bármely oldal</h1>')
    expect(html).toContain('kc-container--narrow')
    expect(html).not.toContain('kc-post-hero')
  })

  it('a páros rács 1440-en két egyenlő hasáb, 390-en egy; a fél hasáb 1440-en 512 px', () => {
    const szeles = sajatErtek(lapNezetablakra(1440), osztalyElem('.kc-page-hero__grid'), 'grid-template-columns')
    expect(szeles).toBe('minmax(0, 1fr) minmax(0, 1fr)')
    const keskeny = sajatErtek(lapNezetablakra(390), osztalyElem('.kc-page-hero__grid'), 'grid-template-columns')
    expect(keskeny).toBe('minmax(0, 1fr)')
    const gap = px(1440, sajatErtek(lapNezetablakra(1440), osztalyElem('.kc-page-hero__grid'), 'gap')!)
    const felHasab = (szelesHasab(1440) - gap) / 2
    expect(felHasab).toBe(512)
    // A fél hasábban a bevezető sapkája (627 px) nem lép be: a hasáb szab.
    expect(felHasab).toBeLessThan(sapkaPx(1440))
  })
})

// ---------------------------------------------------------------------------
// H5 — a lista-kártya változatlan
// ---------------------------------------------------------------------------

describe('H5 — a /blog lista kártyái nem mozdulnak', () => {
  it('a rács szabálya és a kártya sapkája a mai érték', () => {
    expect(listaSzabaly('.kc-card-grid.kc-card-grid--posts').get('grid-template-columns')).toBe(
      'repeat(auto-fill, minmax(min(100%, 28rem), 1fr))',
    )
    expect(listaSzabaly('.kc-card-grid.kc-card-grid--posts > *').get('max-width')).toBe('34rem')
  })

  it('számítva: 1440-en két 524 px-es hasáb, 390-en egy 342 px-es (az élő mérés értékei)', () => {
    const gap = px(1440, sajatErtek(lapNezetablakra(1440), osztalyElem('.kc-card-grid'), 'gap')!)
    const min = px(1440, '28rem')
    const hasab1440 = szelesHasab(1440)
    const oszlopok = Math.floor((hasab1440 + gap) / (min + gap))
    expect(oszlopok).toBe(2)
    expect((hasab1440 - gap * (oszlopok - 1)) / oszlopok).toBe(524)
    expect(szelesHasab(390)).toBe(342)
    expect(Math.min(szelesHasab(390), px(390, '34rem'))).toBe(342)
  })
})

// ---------------------------------------------------------------------------
// H6 — kvirtmínusz
// ---------------------------------------------------------------------------

describe('H6 — kvirtmínusz (U+2014) sehol', () => {
  it('a módosított komponensek kód-részében nincs, és a kimeneten sincs', () => {
    for (const relativ of ['components/content/PageHero.tsx', 'components/content/PostArticle.tsx']) {
      const forras = readFileSync(`${REPO}${relativ}`, 'utf8')
      const kodCsak = forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(kodCsak, relativ).not.toContain('—')
    }
    for (const p of [post(), post({ heroImage: borito })]) {
      expect(render(createElement(PostArticle, { post: p }))).not.toContain('—')
    }
  })
})
