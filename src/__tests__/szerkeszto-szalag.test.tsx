import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page } from '../payload-types'

/**
 * A frontend „Szerkesztem” réteg őre (modul-térkép A3; H09, H02, H29).
 *
 * 1. A szalag címkéje BETŰRE az admin sorcímkéje (WCAG 2.2 SC 3.2.4): az élő
 *    adat (scratchpad modul-terkep/live-pages.json, 2026-09-22) négy lapjának
 *    MINDEN során a valódi SectionRowLabel komponenst rendereljük (a Payload-
 *    hookok mockolva, az űrlapállapot a Payload alakjában), és összevetjük a
 *    RenderBlocks piszkozat-kimenetének szalagjaival.
 * 2. Nem-draft módban (a réteg hiányzik vagy null) 0 szalag és 0 `szekcio-` id,
 *    a kimenet bájtra azonos.
 * 3. A mélylink = `szekcioMelylink(...)`, az akadálymentes név „Szerkesztem”-mel kezdődik.
 * 4. A rejtett szekció csak szalagot kap; a H29 árlista-hiba kimondva.
 * 5. A szekciók közé kerülő szalag nem ronthatja el a szomszéd-szelektorokat.
 *
 * A fixture (fixtures/elo-szekciosorok-2026-09-22.json) az élő szekciósor: a
 * képek azonosítóként (ahogy az admin űrlapállapota is adja), a hosszú
 * szövegszerkesztő-tartalom az első nem üres blokkjára rövidítve (a címke
 * csak azt olvassa, `lexicalFirstText`), kivéve a rendelői árlistát, amelyet
 * a felismerő egészben olvas. A rövidített fixtúra szalag-rétege a teljes élő
 * adatéval mind a 34 soron egyezik (mérve a scratchpadben, 2026-09-23).
 */

// ---------------------------------------------------------------------------
// Payload-hookok (a valódi admin sorcímkéhez)
// ---------------------------------------------------------------------------

let urlapAllapot: Record<string, unknown> = {}
let sorCimke: { data: Record<string, unknown> | undefined; path: string; rowNumber?: number } = {
  data: undefined,
  path: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A Payload lapos űrlapállapota (`FormState`) a beágyazott adatból, ahogy a
 * @payloadcms/ui addFieldStatePromise.js építi: a tömb és a blokk mező értéke
 * a sorok száma `rows`-szal (nem üresnél `disableFormData: true`), a levél
 * `{ value }`, a csoportnak nincs saját bejegyzése. A szövegszerkesztő
 * (Lexical, `root`) értéke EGY levél, ahogy a richText mezőé.
 */
function formStateOf(value: unknown, path = '', out: Record<string, unknown> = {}) {
  if (Array.isArray(value)) {
    out[path] = {
      value: value.length,
      rows: value.map(() => ({})),
      ...(value.length > 0 ? { disableFormData: true } : {}),
    }
    value.forEach((item, index) => formStateOf(item, `${path}.${String(index)}`, out))
  } else if (isRecord(value) && !isRecord(value.root)) {
    for (const [key, child] of Object.entries(value)) {
      formStateOf(child, path ? `${path}.${key}` : key, out)
    }
  } else if (path) {
    out[path] = { value }
  }
  return out
}

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { serverURL: '', routes: { admin: '/admin', api: '/api' } } }),
  useWatchForm: () => ({ fields: urlapAllapot }),
  useRowLabel: () => sorCimke,
}))

// A route-teszt (5.) bemenetei; a RenderBlocks és a szalag VALÓDI.
const route = vi.hoisted(() => ({
  draft: false,
  page: null as unknown,
}))
vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: route.draft }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  usePathname: () => '/',
}))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: async () => route.page,
  getPostBySlug: async () => null,
  getPublishedProducts: async () => [],
  getLatestPosts: async () => [],
  getTestimonials: async () => [],
  getPublishedPageSlugs: async () => new Set<string>(),
  getRelatedPosts: async () => [],
  getFreeProduct: async () => null,
}))
vi.mock('@/lib/appointment/section', () => ({
  getAppointmentSectionContext: async () => ({ formId: null, turnstileSiteKey: null }),
}))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
// A kapcsolati e-mail feloldója (src/lib/contact-email-server.ts) itt a
// kódtartalékot adja: tesztből valódi Payload-indítás és adatbázis-hívás nem
// mehet ki (CLAUDE.md 15). Az eltérő CMS-címet a kapcsolati-email-feloldo.test.ts méri.
vi.mock('@/lib/contact-email-server', async () => {
  const { KAPCSOLATI_EMAIL_TARTALEK: tartalek } = await import('../lib/contact-email')
  return { getContactEmail: async () => tartalek }
})
vi.mock('@/components/content/PageEeat', () => ({ PageEeat: () => null }))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  route.draft = false
  route.page = null
})

const { pageBlocks } = await import('../blocks')
const { SectionRowLabel } = await import('../components/admin/SectionRowLabel')
const { RenderBlocks } = await import('../components/blocks/RenderBlocks')
const { presentHomeLayout, presentSzolgaltatasokLayout } = await import('../lib/home-help-states')
const { szekcioMelylink } = await import('../components/editor/szekcio-melylink')
const {
  ARLISTA_NEM_ISMERHETO,
  HORGONY_ELOTAG,
  HUB_BEJEGYZES_FELIRAT,
  HUB_OLDAL_FELIRAT,
  SZERKESZTEM_FELIRAT,
  cimkeForrasok,
  hubSzalag,
  szerkesztoReteg,
} = await import('../components/editor/frontend/szerkeszto-szalag')
const { SzerkesztoOldalSzalag } = await import('../components/editor/frontend/SzerkesztoSzalag')
const { REJTETT_CIM, REJTETT_MAGYARAZAT, hiddenHint } = await import('../lib/section-row-label')
const CmsPage = (await import('../app/(frontend)/[slug]/page')).default

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

interface EloLap {
  id: number
  slug: string
  title: string
  layout: Layout
}

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const ELO: Readonly<Record<string, EloLap>> = JSON.parse(
  readFileSync(join(REPO, 'src/__tests__/fixtures/elo-szekciosorok-2026-09-22.json'), 'utf8'),
) as Record<string, EloLap>
const LAPOK = ['kezdolap', 'rolunk', 'szolgaltatasok', 'kapcsolat'] as const

function elo(slug: (typeof LAPOK)[number]): EloLap {
  const lap = ELO[slug]
  if (!lap) {
    throw new Error(`Hiányzik a fixture-ből: ${slug}`)
  }
  return lap
}

/** A HTML-entitások visszaalakítása (a renderToStaticMarkup ezeket kódolja). */
function dekodol(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const szovegbe = (html: string): string => dekodol(html.replace(/<[^>]+>/g, ''))

/** Az admin sorcímke szövege a VALÓDI SectionRowLabel-lel, a lap űrlapállapotából. */
function adminCimke(lap: EloLap, index: number): string {
  const sor = lap.layout[index] as unknown as Record<string, unknown>
  const blokk = pageBlocks.find((jelolt) => jelolt.slug === sor.blockType)
  const label = blokk?.admin?.components?.Label
  const props =
    typeof label === 'object' &&
    label !== null &&
    'clientProps' in label &&
    isRecord(label.clientProps)
      ? label.clientProps
      : {}
  urlapAllapot = formStateOf({ slug: lap.slug, layout: lap.layout })
  sorCimke = { data: sor, path: `layout.${String(index)}`, rowNumber: index }
  return szovegbe(renderToStaticMarkup(createElement(SectionRowLabel, props)))
}

/** A lap megjelenített szekciósora, ahogy a route adja a RenderBlocks-nak. */
function megjelenitett(lap: EloLap): Layout {
  return lap.slug === 'kezdolap'
    ? presentHomeLayout(lap.layout)
    : lap.slug === 'szolgaltatasok'
      ? presentSzolgaltatasokLayout(lap.layout)
      : lap.layout
}

function renderLap(lap: EloLap, draft: boolean): string {
  return renderToStaticMarkup(
    createElement(RenderBlocks, {
      layout: megjelenitett(lap),
      posts: [],
      products: [],
      testimonials: [],
      szerkesztes: draft ? szerkesztoReteg({ lap, blokkok: pageBlocks }) : null,
    }),
  )
}

/** A szalagok a DOM sorrendjében: horgony-id, címke, első link (href + teljes szöveg). */
function szalagok(html: string) {
  const blokkok = html.split('<div class="kc-szerkeszto-szalag').slice(1)
  return blokkok.map((resz) => {
    const id = /id="([^"]*)"/.exec(resz)?.[1] ?? null
    const cimke = /<p class="kc-szerkeszto-szalag__cimke">([\s\S]*?)<\/p>/.exec(resz)?.[1] ?? ''
    const link = /<a class="kc-szerkeszto-szalag__link" href="([^"]*)">([\s\S]*?)<\/a>/.exec(resz)
    return {
      id,
      osztaly: resz.slice(0, resz.indexOf('"')),
      cimke: szovegbe(cimke),
      href: link ? dekodol(link[1] ?? '') : null,
      linkSzoveg: link ? szovegbe(link[2] ?? '') : null,
      html: resz,
    }
  })
}

// ---------------------------------------------------------------------------
// 1. A címke betűre az admin sorcímkéje (élő adat, minden sor)
// ---------------------------------------------------------------------------

describe('a szalag címkéje = az admin sorcímkéje (élő adat, N/N)', () => {
  const eredmeny: Record<string, string> = {}

  for (const slug of LAPOK) {
    it(`${slug}: minden sor szalagja betűre egyezik a SectionRowLabel szövegével`, () => {
      const lap = elo(slug)
      const html = renderLap(lap, true)
      const talalt = szalagok(html)
      const admin = lap.layout.map((_, index) => adminCimke(lap, index))
      expect(talalt.map((szalag) => szalag.cimke)).toEqual(admin)
      expect(talalt).toHaveLength(lap.layout.length)
      eredmeny[slug] = `${String(talalt.length)}/${String(lap.layout.length)}`
    })
  }

  it('az összes lap: 34/34 sor (15 + 10 + 7 + 2)', () => {
    expect(eredmeny).toEqual({
      kezdolap: '15/15',
      rolunk: '10/10',
      szolgaltatasok: '7/7',
      kapcsolat: '2/2',
    })
  })

  it('a címke-forrás a pageBlocks Label clientProps-a, minden blokktípusra', () => {
    const forrasok = cimkeForrasok(pageBlocks)
    expect([...forrasok.keys()].sort()).toEqual(pageBlocks.map((blokk) => blokk.slug).sort())
    for (const [, forras] of forrasok) {
      expect(forras.blockLabel.length).toBeGreaterThan(0)
    }
  })

  it('a címke a MENTETT sorból és az eredeti indexből jön, nem a megjelenített sorból', () => {
    const lap = elo('kezdolap')
    const reteg = szerkesztoReteg({ lap, blokkok: pageBlocks })
    lap.layout.forEach((sor, index) => {
      const szalag = sor.id ? reteg.szekciok[sor.id] : undefined
      expect(szalag?.sorIndex).toBe(index)
      expect(szalag?.cimke.startsWith(String(index + 1).padStart(2, '0'))).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Nem-draft: semmi nem kerül a látogató kimenetébe
// ---------------------------------------------------------------------------

describe('nem-draft módban nincs réteg', () => {
  for (const slug of LAPOK) {
    it(`${slug}: 0 szalag, 0 szekcio- id, és a null/hiányzó réteg bájtra azonos`, () => {
      const lap = elo(slug)
      const nelkul = renderLap(lap, false)
      expect(nelkul).not.toContain('kc-szerkeszto')
      expect(nelkul).not.toContain(`id="${HORGONY_ELOTAG}`)
      const hianyzo = renderToStaticMarkup(
        createElement(RenderBlocks, {
          layout: megjelenitett(lap),
          posts: [],
          products: [],
          testimonials: [],
        }),
      )
      expect(nelkul).toBe(hianyzo)
    })
  }

  it('draftban minden sornak van horgonya: szekcio-<blokk-azonosító>', () => {
    const lap = elo('rolunk')
    const ids = szalagok(renderLap(lap, true)).map((szalag) => szalag.id)
    expect(ids).toEqual(lap.layout.map((sor) => `${HORGONY_ELOTAG}${String(sor.id)}`))
  })
})

// ---------------------------------------------------------------------------
// 3. Mélylink és akadálymentes név
// ---------------------------------------------------------------------------

describe('a „Szerkesztem” link', () => {
  for (const slug of LAPOK) {
    it(`${slug}: href = szekcioMelylink({ collection: 'pages', id, blokkId })`, () => {
      const lap = elo(slug)
      const talalt = szalagok(renderLap(lap, true))
      expect(talalt.map((szalag) => szalag.href)).toEqual(
        lap.layout.map((sor) =>
          szekcioMelylink({ collection: 'pages', id: lap.id, blokkId: sor.id ?? null }),
        ),
      )
    })
  }

  it('az akadálymentes név a látható „Szerkesztem” szóval kezdődik, utána a szekció (SC 2.5.3, 2.4.4)', () => {
    const lap = elo('kezdolap')
    const talalt = szalagok(renderLap(lap, true))
    for (const [index, szalag] of talalt.entries()) {
      expect(szalag.linkSzoveg?.startsWith(`${SZERKESZTEM_FELIRAT}: `)).toBe(true)
      expect(szalag.linkSzoveg).toContain(`${String(index + 1).padStart(2, '0')}. szekció`)
      expect(szalag.html).toContain(`>${SZERKESZTEM_FELIRAT}<span class="kc-visually-hidden">: `)
    }
    const tipus = cimkeForrasok(pageBlocks).get('services')?.blockLabel ?? ''
    expect(tipus.length).toBeGreaterThan(0)
    expect(talalt[4]?.linkSzoveg).toBe(`Szerkesztem: 05. szekció, ${tipus}, Így tudunk segíteni`)
  })

  it('más gyűjteményből töltött szekció második linkje az admin forrás-jelzésével egyezik', () => {
    const lap = elo('kezdolap')
    const kurzusok = szalagok(renderLap(lap, true))[5]
    expect(kurzusok?.html).toContain(
      '<a class="kc-szerkeszto-szalag__link kc-szerkeszto-szalag__link--masodlagos" href="/admin/collections/products">Ugrás oda, ahol szerkeszted: Kurzusok</a>',
    )
  })

  it('az oldal-szintű szalag a szerkesztő tetejére visz (blokk nélkül)', () => {
    const lap = elo('kapcsolat')
    const html = renderToStaticMarkup(
      createElement(SzerkesztoOldalSzalag, {
        szalag: szerkesztoReteg({ lap, blokkok: pageBlocks }).oldal,
      }),
    )
    expect(html).toContain(`href="${szekcioMelylink({ collection: 'pages', id: lap.id })}"`)
    expect(html).toContain('Az egész oldal: Kapcsolat')
    expect(szovegbe(html)).toContain('Szerkesztem: az egész oldal, Kapcsolat')
  })

  it('a hub két külön feliratú linket kap: a blogbejegyzés és az oldal szerkesztőjét', () => {
    const szalag = hubSzalag({
      lap: { id: 21, slug: 'keztoalagut-szindroma', title: 'Kéztőalagút-szindróma' },
      bejegyzes: { id: 44, title: 'Kéztőalagút-szindróma: mit tehetsz?' },
    })
    expect(szalag.linkek.map((link) => [link.felirat, link.href])).toEqual([
      [HUB_BEJEGYZES_FELIRAT, '/admin/collections/posts/44'],
      [HUB_OLDAL_FELIRAT, '/admin/collections/pages/21'],
    ])
    const html = renderToStaticMarkup(createElement(SzerkesztoOldalSzalag, { szalag }))
    expect(html.match(/<a /g)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 4. Rejtett szekció és a H29 árlista-hiba
// ---------------------------------------------------------------------------

describe('rejtett szekció (H02)', () => {
  it('a rejtett 11. sor helyén csak a „rejtett szekció” szalag áll, a látható ikerre utalva', () => {
    const lap = elo('kezdolap')
    const rejtett = lap.layout[10]
    expect(rejtett?.sectionSettings?.visible).toBe(false)
    const talalt = szalagok(renderLap(lap, true))[10]
    expect(talalt?.osztaly).toContain('kc-szerkeszto-szalag--rejtett')
    expect(talalt?.cimke.startsWith('11 · Rejtve · ')).toBe(true)
    expect(talalt?.html).toContain(REJTETT_CIM)
    expect(talalt?.html).toContain(REJTETT_MAGYARAZAT)
    expect(szovegbe(talalt?.html ?? '')).toContain(hiddenHint('02'))
  })

  it('a rejtett szekció tartalma nem renderelődik: a szekciók száma draftban és anélkül egyezik', () => {
    const lap = elo('kezdolap')
    const szamol = (html: string) => (html.match(/<section\b/g) ?? []).length
    expect(szamol(renderLap(lap, true))).toBe(szamol(renderLap(lap, false)))
  })
})

describe('H29: az árlista-felismerés kudarca', () => {
  const rendeloi = (content: unknown): Layout =>
    [
      {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        blockType: 'richText',
        content,
        sectionSettings: { visible: true, anchorId: 'rendeloi' },
      },
    ] as unknown as Layout

  const lexical = (...gyerekek: unknown[]) => ({ root: { type: 'root', children: gyerekek } })
  const bekezdes = (text: string) => ({ type: 'paragraph', children: [{ type: 'text', text }] })
  const cimsor = (tag: string, text: string) => ({
    type: 'heading',
    tag,
    children: [{ type: 'text', text }],
  })
  const lista = (...tetelek: string[]) => ({
    type: 'list',
    children: tetelek.map((text) => ({ type: 'listitem', children: [{ type: 'text', text }] })),
  })

  const render = (layout: Layout) =>
    renderToStaticMarkup(
      createElement(RenderBlocks, {
        layout,
        posts: [],
        products: [],
        testimonials: [],
        szerkesztes: szerkesztoReteg({
          lap: { id: 3, slug: 'szolgaltatasok', layout },
          blokkok: pageBlocks,
        }),
      }),
    )

  it('felismerhetetlen szerkezetnél a szalag kimondja, és a formát is leírja', () => {
    const html = render(rendeloi(lexical(bekezdes('Rendelői kezelések, árak kérésre.'))))
    expect(html).toContain(ARLISTA_NEM_ISMERHETO)
    expect(html).toContain('kc-szerkeszto-szalag--figyelem')
    expect(html).not.toMatch(/[–—]/)
  })

  it('felismert árlistánál nincs figyelmeztetés', () => {
    const html = render(
      rendeloi(
        lexical(
          cimsor('h2', 'Rendelői kezelések'),
          bekezdes('Személyesen, a stúdióban.'),
          cimsor('h3', 'Árlista'),
          lista('50 perces alkalom: 18 000 Ft', '80 perces alkalom: 26 000 Ft'),
          bekezdes('Helyszíneink: Buda • Pest'),
        ),
      ),
    )
    expect(html).toContain('kc-arlista')
    expect(html).not.toContain(ARLISTA_NEM_ISMERHETO)
  })

  it('az élő /szolgaltatasok árlistája felismerhető: nincs figyelmeztetés', () => {
    expect(renderLap(elo('szolgaltatasok'), true)).not.toContain(ARLISTA_NEM_ISMERHETO)
  })
})

// ---------------------------------------------------------------------------
// 5. A route: csak piszkozat-előnézetben
// ---------------------------------------------------------------------------

describe('a [slug] route rétege', () => {
  const lap = () => ({ ...elo('rolunk'), status: 'published' }) as unknown as Page

  it('publikált nézetben 0 szalag és 0 szekcio- id', async () => {
    route.page = lap()
    const html = renderToStaticMarkup(
      (await CmsPage({ params: Promise.resolve({ slug: 'rolunk' }) })) as ReactNode,
    )
    expect(html).not.toContain('kc-szerkeszto')
    expect(html).not.toContain(`id="${HORGONY_ELOTAG}`)
    expect(html).not.toContain('kc-preview-bar')
  })

  it('piszkozatban: előnézet-sáv „Vissza a szerkesztőbe” linkkel, oldal-szalag és minden szekció szalagja', async () => {
    route.draft = true
    route.page = lap()
    const html = renderToStaticMarkup(
      (await CmsPage({ params: Promise.resolve({ slug: 'rolunk' }) })) as ReactNode,
    )
    expect(html).toContain('href="/admin/collections/pages/2">Vissza a szerkesztőbe</a>')
    expect(html).toContain('kc-szerkeszto-szalag--oldal')
    expect((html.match(new RegExp(`id="${HORGONY_ELOTAG}`, 'g')) ?? []).length).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// 6. Szomszéd-szelektorok: a szalag nem bontja meg a szekciók közti szabályt
// ---------------------------------------------------------------------------

describe('a szekciók közé kerülő szalag és a CSS szomszéd-szelektorai', () => {
  const STILUSOK = join(REPO, 'src/app/(frontend)')
  const cssFajlok = (konyvtar: string): string[] =>
    readdirSync(konyvtar).flatMap((nev) => {
      const teljes = join(konyvtar, nev)
      return statSync(teljes).isDirectory()
        ? cssFajlok(teljes)
        : nev.endsWith('.css')
          ? [teljes]
          : []
    })
  const kommentNelkul = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const reteg = kommentNelkul(
    readFileSync(join(STILUSOK, 'styles/szerkeszto-reteg.css'), 'utf8'),
  ).replace(/\s+/g, ' ')

  it('minden szekció-szintű `:has(+ …)` szabálynak van szalagos tükre, azonos törzzsel', () => {
    const szabalyok: { szelektor: string; cel: string; torzs: string }[] = []
    for (const fajl of cssFajlok(STILUSOK)) {
      if (fajl.endsWith('szerkeszto-reteg.css')) continue
      const css = kommentNelkul(readFileSync(fajl, 'utf8'))
      for (const talalat of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const szelektor = (talalat[1] ?? '').trim().replace(/\s+/g, ' ')
        const has = /^(\.kc-section[^:]*):has\(\+ (\.kc-[\w-]+)\)$/.exec(szelektor)
        if (has) {
          szabalyok.push({
            szelektor: has[1] ?? '',
            cel: has[2] ?? '',
            torzs: (talalat[2] ?? '').trim().replace(/\s+/g, ' '),
          })
        }
      }
    }
    expect(szabalyok.map((szabaly) => szabaly.cel)).toEqual(['.kc-services--sin'])
    for (const { szelektor, cel, torzs } of szabalyok) {
      expect(reteg).toContain(`${szelektor}:has( + .kc-szerkeszto-szalag + ${cel} )`)
      expect(reteg).toContain(
        `${szelektor}:has( + .kc-szerkeszto-szalag + .kc-szerkeszto-szalag + ${cel} ) { ${torzs} }`,
      )
    }
  })

  it('a szalag div, így a filmsáv `main > .kc-film-hero:first-of-type` szabálya érvényes marad', () => {
    // A React a képek előtöltő <link>-jét a kimenet elejére teszi (élesben a
    // <head>-be kerül), ezt levágjuk: utána az első elem a filmsáv szalagja.
    const html = renderLap(elo('kezdolap'), true).replace(/^(<link\b[^>]*\/>)+/, '')
    expect(html.startsWith('<div class="kc-szerkeszto-szalag" id="szekcio-')).toBe(true)
    expect(html).not.toMatch(/<section class="kc-szerkeszto/)
    expect(html.indexOf('<div class="kc-szerkeszto-szalag"')).toBeLessThan(html.indexOf('<section'))
  })
})
