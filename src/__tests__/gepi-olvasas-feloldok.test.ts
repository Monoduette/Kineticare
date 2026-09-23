import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BlockFilmHero, BlockFreeSos, BlockServices, Page, Product } from '../payload-types'

/**
 * Őr (modul-térkép H46, terv 2. szakasz, „Egy mező, egy feloldó”): az
 * `/llms-full.txt` a kezdőlapról UGYANAZT mondja, amit a lap mutat.
 *
 * A mérés végponttól végpontig fut: a route `GET`-je a mockolt CMS-ből építi a
 * fájlt, a lapot pedig a HomeView rendereli ugyanabból az adatból (a `/`
 * route ugyanígy hívja). Így egy eltérés akár a feloldóban, akár a
 * „van-e ingyenes SOS” döntésben, akár a szekciósor megjelenítésében
 * (`presentHomeLayout`) buktatja.
 *
 * Források: llmstxt.org (https://llmstxt.org/); WCAG 2.2 SC 3.2.4
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html);
 * NN/g, Consistency and Standards
 * (https://www.nngroup.com/articles/consistency-and-standards/).
 */

const cms = vi.hoisted(() => ({
  pages: [] as unknown[],
  products: [] as unknown[],
}))

vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
vi.mock('@/lib/cms', () => ({
  getAllPublishedPages: async () => cms.pages,
  getPosts: async () => [],
  getPublishedPageSlugs: async () => new Set<string>(),
  getPublishedProducts: async (limit = 12) => cms.products.slice(0, limit),
}))

import { GET } from '../app/llms-full.txt/route'
import { HomeView } from '../components/content/HomeView'
import { CTA_TERMEK_LEKERDEZES_LIMIT } from '../lib/cta-banner-course'
import { FILM_CAPTION_DEFAULTS, resolveFilmCaptions } from '../lib/film-captions'
import {
  FREE_SOS_NEUTRAL_TITLE,
  FREE_SOS_STRIP_TITLE,
  freeSosStripTitle,
} from '../lib/free-sos-title'
import { HOME_HELP_LEAD, HOME_HELP_STATES, HOME_HELP_TITLE } from '../lib/home-help-states'
import { absoluteUrl } from '../lib/seo'

type Layout = NonNullable<Page['layout']>

const sos = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 3,
    slug: 'sos-kezrelax-villamkurzus',
    sku: 'SOS Kézrelax villámkurzus',
    status: 'published',
    _status: 'published',
    priceInHUFEnabled: false,
    updatedAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  }) as Product

const fizetos = (id: number): Product =>
  ({
    id,
    slug: `fizetos-${id}`,
    sku: `Fizetős kurzus ${id}`,
    status: 'published',
    _status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 10000,
    updatedAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-20T00:00:00.000Z',
  }) as Product

const film = (captions?: BlockFilmHero['captions']): BlockFilmHero => ({
  blockType: 'filmHero',
  id: 'film',
  title: 'Nyitó film',
  lead: 'A film bevezetője.',
  ...(captions ? { captions } : {}),
})

const sosSav = (title: string | null, rejtett = false): BlockFreeSos =>
  ({
    blockType: 'freeSos',
    id: 'sos-sav',
    title,
    ...(rejtett ? { sectionSettings: { visible: false } } : {}),
  }) as BlockFreeSos

const kezdolap = (layout: Layout): Page =>
  ({
    id: 1,
    title: 'Kezdőlap',
    slug: 'kezdolap',
    layout,
    updatedAt: '2026-09-22T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  }) as Page

/** Az /llms-full.txt a route-ból, a mockolt CMS-sel. */
async function llmsFull(home: Page, products: Product[]): Promise<string> {
  cms.pages = [home]
  cms.products = products
  const valasz = await GET()
  return valasz.text()
}

/** A kezdőlap szakasza az llms-full.txt-ben (a `---` elválasztók között). */
function kezdolapSzakasz(txt: string): string {
  const szakasz = txt
    .split('\n\n---\n\n')
    .find((resz) => resz.includes(`URL: ${absoluteUrl('/')}\n`))
  if (!szakasz) throw new Error('A kezdőlap szakasza nem található az llms-full.txt-ben')
  return szakasz
}

/** A szakasz H2-címei sorrendben. */
function h2k(szakasz: string): string[] {
  return szakasz
    .split('\n')
    .filter((sor) => sor.startsWith('## '))
    .map((sor) => sor.slice(3))
}

function szoveg(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** A lap: a HomeView a `/` route-tal azonos bemenettel (a route 50 terméket kér). */
function lap(home: Page, products: Product[]): string {
  return renderToStaticMarkup(
    createElement(HomeView, {
      home,
      products: products.slice(0, CTA_TERMEK_LEKERDEZES_LIMIT),
      posts: [],
    }),
  )
}

function lapSosCime(html: string): string | null {
  const talalat = /id="ingyenes-cim">([^<]*)<\/h2>/.exec(html)
  return talalat?.[1] === undefined ? null : szoveg(talalat[1])
}

/** A nyitó videó olvasási listája a lapon: [közép cím, közép leírás, vég cím, vég leírás]. */
function lapFeliratai(html: string): string[] {
  const lista = /<ul class="scroll-scrub__reading-captions">([\s\S]*?)<\/ul>/.exec(html)?.[1]
  if (lista === undefined) return []
  return [...lista.matchAll(/<p class="scroll-scrub__caption-(?:title|body)">([^<]*)<\/p>/g)].map(
    (talalat) => szoveg(talalat[1] ?? ''),
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Hálózat tiltva a gépi olvasás őr-tesztjében')
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  cms.pages = []
  cms.products = []
})

describe('llms-full.txt: az SOS-sáv címe = a lap h2-je', () => {
  const cimek: ReadonlyArray<string | null> = [
    'Saját SOS-cím',
    '  Ingyenes villámkurzus  ',
    'SOS Kézrelax — ingyenes villámkurzus',
    '',
    '   ',
    null,
  ]
  const termekkeszletek: ReadonlyArray<readonly [string, Product[], boolean]> = [
    ['elérhető SOS', [fizetos(1), sos()], true],
    ['nincs termék', [], false],
    ['csak fizetős', [fizetos(1)], false],
    ['piszkozat SOS', [sos({ _status: 'draft' })], false],
    ['archivált SOS', [sos({ status: 'archived' })], false],
    ['listán kívüli SOS', [sos({ unlisted: true })], false],
    ['hiányos ár', [sos({ priceInHUFEnabled: undefined })], false],
  ]

  it.each(termekkeszletek)('%s', async (_nev, products, vanSos) => {
    for (const title of cimek) {
      const home = kezdolap([film(), sosSav(title)])
      const txt = await llmsFull(home, products)
      const lapCim = lapSosCime(lap(home, products))
      const vart = freeSosStripTitle({ title }, vanSos)
      expect(lapCim).toBe(vart)
      expect(h2k(kezdolapSzakasz(txt))).toEqual(['Nyitó film', vart])
    }
  })

  it('a három ág kifejezetten: kitöltött cím, üres cím, SOS nélkül „Kurzusaink”', async () => {
    const kitoltott = kezdolap([sosSav('  Próbáld ki ingyen  ')])
    expect(h2k(kezdolapSzakasz(await llmsFull(kitoltott, [sos()])))).toEqual(['Próbáld ki ingyen'])
    const ures = kezdolap([sosSav('')])
    expect(h2k(kezdolapSzakasz(await llmsFull(ures, [sos()])))).toEqual([FREE_SOS_STRIP_TITLE])
    expect(h2k(kezdolapSzakasz(await llmsFull(kitoltott, [])))).toEqual([FREE_SOS_NEUTRAL_TITLE])
  })

  it('a döntés a lap terméklistájából jön: az 51. helyen álló SOS a lapon sem számít', async () => {
    const products = [
      ...Array.from({ length: CTA_TERMEK_LEKERDEZES_LIMIT }, (_, i) => fizetos(100 + i)),
      sos(),
    ]
    const home = kezdolap([sosSav('Saját SOS-cím')])
    expect(lapSosCime(lap(home, products))).toBe(FREE_SOS_NEUTRAL_TITLE)
    expect(h2k(kezdolapSzakasz(await llmsFull(home, products)))).toEqual([FREE_SOS_NEUTRAL_TITLE])
  })

  it('a rejtett SOS-sáv sem a lapon, sem az llms-full.txt-ben nincs', async () => {
    const home = kezdolap([film(), sosSav('Saját SOS-cím', true)])
    expect(lapSosCime(lap(home, [sos()]))).toBeNull()
    expect(h2k(kezdolapSzakasz(await llmsFull(home, [sos()])))).toEqual(['Nyitó film'])
  })
})

describe('llms-full.txt: a nyitó videó feliratai = a FilmHero feloldójáé', () => {
  const sajat: NonNullable<BlockFilmHero['captions']> = {
    midTitle: 'Saját közép cím',
    midBody: '  Saját közép leírás.  ',
    endTitle: 'Saját vég cím',
    endBody: 'Saját vég, lentebb az ingyenes gyakorlatok.',
    endBodyWithoutFreeSos: 'Saját vég, ingyenes gyakorlatok nélkül.',
  }
  const uresMezok: NonNullable<BlockFilmHero['captions']> = {
    midTitle: null,
    midBody: '',
    endTitle: '   ',
    endBody: null,
    endBodyWithoutFreeSos: null,
  }
  const esetek: ReadonlyArray<
    readonly [
      string,
      NonNullable<BlockFilmHero['captions']> | undefined,
      (f: BlockFilmHero) => Layout,
      Product[],
      boolean,
    ]
  > = [
    ['üres CMS, SOS-sáv lentebb', undefined, (f) => [f, sosSav('Cím')], [sos()], true],
    ['üres mezők, SOS-sáv lentebb', uresMezok, (f) => [f, sosSav('Cím')], [sos()], true],
    ['kitöltött CMS, SOS-sáv lentebb', sajat, (f) => [f, sosSav('Cím')], [sos()], true],
    ['kitöltött CMS, nincs elérhető SOS', sajat, (f) => [f, sosSav('Cím')], [fizetos(1)], false],
    ['kitöltött CMS, a sáv a film FÖLÖTT', sajat, (f) => [sosSav('Cím'), f], [sos()], false],
    ['kitöltött CMS, a sáv rejtett', sajat, (f) => [f, sosSav('Cím', true)], [sos()], false],
    ['üres CMS, nincs SOS-sáv', undefined, (f) => [f], [sos()], false],
  ]

  it.each(esetek)('%s', async (_nev, captions, elrendezes, products, sosCel) => {
    const blokk = film(captions)
    const home = kezdolap(elrendezes(blokk))
    const vart = resolveFilmCaptions(blokk, sosCel)
    const vartSorok = [vart.mid.title, vart.mid.body, vart.end.title, vart.end.body]
    expect(lapFeliratai(lap(home, products))).toEqual(vartSorok)
    expect(kezdolapSzakasz(await llmsFull(home, products))).toContain(vartSorok.join('\n\n'))
  })

  it('üres CMS-nél a beépített szöveg kerül az llms-full.txt-be', async () => {
    const txt = kezdolapSzakasz(await llmsFull(kezdolap([film(), sosSav('Cím')]), [sos()]))
    expect(txt).toContain(FILM_CAPTION_DEFAULTS.midTitle)
    expect(txt).toContain(FILM_CAPTION_DEFAULTS.endBody)
    expect(txt).not.toContain(FILM_CAPTION_DEFAULTS.endBodyWithoutFreeSos)
  })
})

describe('llms-full.txt: a kezdőlap szekciósora a lap presentHomeLayout-ja', () => {
  it('a segítség-sín üres címét, bevezetőjét és sor-szövegét a lappal azonos tartalék pótolja', async () => {
    const sin: BlockServices = {
      blockType: 'services',
      id: 'sin',
      title: '',
      lead: '',
      rows: [
        { title: 'Zárt', body: '' },
        { title: 'Nyíló', body: '' },
        { title: 'Nyitott', body: '' },
      ],
    }
    const home = kezdolap([sin])
    const oldal = szoveg(lap(home, []))
    const szakasz = kezdolapSzakasz(await llmsFull(home, []))
    for (const vart of [HOME_HELP_TITLE, HOME_HELP_LEAD, HOME_HELP_STATES[0].body]) {
      expect(oldal).toContain(vart)
      expect(szakasz).toContain(vart)
    }
    expect(h2k(szakasz)).toEqual([HOME_HELP_TITLE])
  })
})

describe('A route-környezet, amelyre a gépi olvasás épít', () => {
  it('a /kapcsolat üres terméklistával renderel, ezért az llms-full.txt ott SOS nélkül dönt', () => {
    const kod = readFileSync(
      new URL('../app/(frontend)/kapcsolat/page.tsx', import.meta.url),
      'utf8',
    )
    expect(kod).toContain('products={[]}')
  })
})
