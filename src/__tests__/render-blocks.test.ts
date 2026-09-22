import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { pageBlockSlugs } from '../blocks'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { HomeView } from '../components/content/HomeView'
import { DEFAULT_HEADING } from '../components/content/home/CourseCards'
import { FREE_SOS_COURSE_CTA_LABEL } from '../components/content/home/FreeSos'
import { HOW_IT_WORKS_STEP1_FIXED, HOW_IT_WORKS_STEP1_LEFTOVER } from '../lib/gondolatjel-leftover'
import { LEGACY_HOME_HELP_ROWS } from '../lib/home-help-states'
import { buildHomeLayout } from '../scripts/seed'
import type { Page, Post, Product, Testimonial } from '../payload-types'

/**
 * Szekció-rendszer render-tesztek (terv 5. pont, F3/F5) — fixture-adattal, DB
 * nélkül. Három szerződést rögzítenek:
 *  1. a HomeView elágazása: kitöltött `layout` → blokk-renderelés (a rögzített
 *     M1–M8 kezdőlap helyett), üres `layout` → a régi kezdőlap változatlanul;
 *  2. a RenderBlocks szabályai: visible=false kihagyás, anchorId → section id,
 *     háttér-leképezés, ismeretlen blokk néma kihagyása, adapter-felülírások;
 *  3. a seed alap-layoutja (buildHomeLayout) csak katalógusbeli blokkot használ,
 *     és egyben renderelhető — pontosan egy H1-gyel (UX-skill 4. pont).
 */

// ---------------------------------------------------------------------------
// Fixture factory-k (a home-cms.test.ts mintájára, a szükséges minimummal)
// ---------------------------------------------------------------------------

function page(overrides: Partial<Page> & { id: number }): Page {
  return {
    title: 'Teszt oldal',
    slug: `oldal-${overrides.id}`,
    excerpt: null,
    content: null,
    heroImage: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    status: 'published',
    publishedAt: null,
    order: null,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Page
}

function post(overrides: Partial<Post> & { id: number }): Post {
  return {
    title: `Teszt poszt ${overrides.id}`,
    slug: `poszt-${overrides.id}`,
    excerpt: 'Rövid kivonat.',
    content: null,
    heroImage: null,
    status: 'published',
    publishedAt: '2026-03-04T08:00:00.000Z',
    author: null,
    categories: [],
    relatedPosts: [],
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Post
}

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    shortDescription: 'Otthon végezhető program.',
    coverImage: null,
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

function testimonial(overrides: Partial<Testimonial> & { id: number }): Testimonial {
  return {
    quote: `Teljes vélemény ${overrides.id}.`,
    shortQuote: null,
    authorName: `Szerző ${overrides.id}`,
    authorTitle: null,
    featured: true,
    order: overrides.id,
    visible: true,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Testimonial
}

type Layout = NonNullable<Page['layout']>

/** Blokk-fixture-ök összefűzése layout-tömbbé (a generált unió-típusra szűkítve). */
function layoutOf(...blocks: Record<string, unknown>[]): Layout {
  return blocks as unknown as Layout
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

function renderBlocks(
  layout: Layout,
  data: { products?: Product[]; posts?: Post[]; testimonials?: Testimonial[] } = {},
): string {
  return render(
    createElement(RenderBlocks, {
      layout,
      products: data.products ?? [],
      posts: data.posts ?? [],
      testimonials: data.testimonials ?? [],
    }),
  )
}

// ---------------------------------------------------------------------------
// 1. HomeView elágazás
// ---------------------------------------------------------------------------

describe('HomeView layout-elágazás', () => {
  const welcomeLayout = layoutOf({
    blockType: 'welcome',
    id: 'w1',
    title: 'Szekciós üdvözlő cím',
    sectionSettings: { visible: true },
  })

  it('kitöltött layoutnál a szekciósor renderel, a rögzített kezdőlap nem', () => {
    const html = render(
      createElement(HomeView, {
        home: page({ id: 1, layout: welcomeLayout }),
        products: [product({ id: 1 })],
        posts: [post({ id: 1 })],
      }),
    )
    expect(html).toContain('Szekciós üdvözlő cím')
    // A rögzített kezdőlap jelölői nem jelenhetnek meg: statikus hitel-csík,
    // statikus GYIK-cím, kurzuskártya-szekció.
    expect(html).not.toContain('Gyógytornász és manuálterapeuta szakmai háttér')
    expect(html).not.toContain('Gyakran ismételt kérdések')
    expect(html).not.toContain(DEFAULT_HEADING)
  })

  it('kitöltött layoutnál a statikus FAQPage JSON-LD nem duplikálódik', () => {
    const html = render(
      createElement(HomeView, {
        home: page({ id: 1, layout: welcomeLayout }),
        products: [],
        posts: [],
      }),
    )
    // Az Organization séma oldalszintű és marad; FAQPage csak faq blokkból jöhet.
    expect(html).toContain('"@type":"Organization"')
    expect(html).not.toContain('"@type":"FAQPage"')
  })

  it('üres layoutnál a rögzített M1–M8 kezdőlap változatlanul renderel', () => {
    const html = render(
      createElement(HomeView, {
        home: page({ id: 1, layout: [] as unknown as Page['layout'] }),
        products: [product({ id: 1 })],
        posts: [],
      }),
    )
    expect(html).toContain('Gyógytornász és manuálterapeuta szakmai háttér')
    expect(html).toContain(DEFAULT_HEADING)
    expect(html).toContain('"@type":"FAQPage"')
  })

  it('az élő háromoszlopos „Így tudunk segíteni” táblát C-sínre cseréli, a Katák sorrendje marad', () => {
    const liveBody =
      'Otthoni videókurzusunkkal a saját tempódban gyakorolhatsz. A teljes program tartalmát és árát a kurzus oldalán találod.'
    const html = render(
      createElement(HomeView, {
        home: page({
          id: 1,
          layout: layoutOf(
            {
              blockType: 'filmHero',
              id: 'hero',
              title: 'Hero cím',
              sectionSettings: { visible: true },
            },
            {
              blockType: 'about',
              id: 'girls',
              title: 'A Kineticare alapítói',
              paragraphs: [{ text: 'Kiss Kata és Kocsis Kata a stúdióban.', emphasized: true }],
              sectionSettings: { visible: true },
            },
            {
              blockType: 'services',
              id: 'usps',
              title: 'Erre számíthatsz velünk',
              rows: [
                { title: 'Tudomány', body: 'Első kártya.' },
                { title: 'Személyre szabott', body: 'Második kártya.' },
              ],
              sectionSettings: { visible: true },
            },
            {
              blockType: 'services',
              id: 'help',
              title: 'Így tudunk segíteni',
              rows: LEGACY_HOME_HELP_ROWS.map((row, index) =>
                index === 1 ? { ...row, body: liveBody } : { ...row },
              ),
              sectionSettings: { visible: true },
            },
            {
              blockType: 'about',
              id: 'later-about',
              title: 'Kiss Kata és Kocsis Kata vagyunk',
              paragraphs: [{ text: 'Második bemutatkozó blokk.', emphasized: false }],
              sectionSettings: { visible: true },
            },
          ),
        }),
        products: [],
        posts: [],
      }),
    )
    expect(html).toContain('kc-services--sin')
    expect(html).not.toContain('kc-services--choices')
    expect(html).toContain('A Kineticare alapítói')
    expect(html).toContain('Személyes kezelés a stúdióban.')
    expect(html.indexOf('A Kineticare alapítói')).toBeLessThan(html.indexOf('Így tudunk segíteni'))
    expect(html.indexOf('Így tudunk segíteni')).toBeLessThan(
      html.indexOf('Kiss Kata és Kocsis Kata vagyunk'),
    )
    expect(html).toContain('Erre számíthatsz velünk')
    const helpStart = html.indexOf('aria-labelledby="services-cim-help"')
    const laterAbout = html.indexOf('id="about-cim-later-about"')
    expect(helpStart).toBeGreaterThan(-1)
    expect(laterAbout).toBeGreaterThan(helpStart)
    const helpHtml = html.slice(helpStart, laterAbout)
    expect(helpHtml).toContain('kc-services--sin')
    expect(helpHtml).not.toContain('kc-services__num')
    expect(helpHtml).toContain('help-zart-img-7541.jpg')
    // Tulajdonosi hibajelentés (2026-09-22): a sín a CMS-ben mentett szöveget
    // mutatja, nem a kódbeli kanonikusat. Az adminban „Akut sérülések…”
    // kezdetű törzs van, a lapon is ennek kell állnia, nem „Akut panasz…”-nak.
    expect(helpHtml).toContain('Akut sérülések, műtét utáni állapotok')
    expect(helpHtml).not.toContain('Akut panasz')
    expect(helpHtml).toContain(liveBody)
    expect(helpHtml).toContain('Nézd meg a kezeléseket')
  })
})

// ---------------------------------------------------------------------------
// 2. RenderBlocks szabályok és adapterek
// ---------------------------------------------------------------------------

describe('RenderBlocks', () => {
  it('visible=false blokk kimarad, a látható marad', () => {
    const html = renderBlocks(
      layoutOf(
        {
          blockType: 'welcome',
          id: 'w1',
          title: 'Látható cím',
          sectionSettings: { visible: true },
        },
        {
          blockType: 'welcome',
          id: 'w2',
          title: 'Rejtett cím',
          sectionSettings: { visible: false },
        },
      ),
    )
    expect(html).toContain('Látható cím')
    expect(html).not.toContain('Rejtett cím')
  })

  it('anchorId a szekció id-je, a hatter a háttérsáv', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'credsStrip',
        id: 'c1',
        items: [{ id: 'i1', text: 'Egyedi hitel-tétel' }],
        link: { felirat: 'Rólunk', url: '/rolunk' },
        sectionSettings: { visible: true, anchorId: 'hitel', hatter: 'tint' },
      }),
    )
    expect(html).toContain('Egyedi hitel-tétel')
    expect(html).toContain('id="hitel"')
    expect(html).toContain('kc-section--tint')
  })

  it('ismeretlen blokktípus némán kimarad (előre-kompatibilitás)', () => {
    const html = renderBlocks(
      layoutOf(
        { blockType: 'jovobeli-blokk', id: 'x1', title: 'Nem létező' },
        { blockType: 'welcome', id: 'w1', title: 'Létező cím', sectionSettings: {} },
      ),
    )
    expect(html).not.toContain('Nem létező')
    expect(html).toContain('Létező cím')
  })

  it('courseCards: cím-felülírás + a kurzuskártyák a published fizetős termékből', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'courseCards',
        id: 'cc1',
        heading: 'Saját kurzuscím',
        sectionSettings: {},
      }),
      { products: [product({ id: 1, sku: 'Kéztorna alapok' })] },
    )
    expect(html).toContain('Saját kurzuscím')
    expect(html).toContain('Kéztorna alapok')
    // Az alap-horgony megmarad (a sticky nav /#kurzusok linkje erre épül).
    expect(html).toContain('id="kurzusok"')
  })

  /**
   * Tulajdonosi kikötés (2026-08-15): a kurzus-szekcióban MINDEN szöveg
   * adminból szerkeszthető, a kódban maradó szöveg csak fallback lehet.
   */
  it('courseCards: a lead a blokkból írható felül, a vízjel a Kurzusaink', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'courseCards',
        id: 'cc2',
        heading: 'Saját kurzuscím',
        lead: 'Saját bevezető.',
        sectionSettings: {},
      }),
      { products: [product({ id: 1 })] },
    )
    expect(html).toContain('Saját kurzuscím')
    expect(html).toContain('Saját bevezető.')
    expect(html).toContain(DEFAULT_HEADING)
    expect(html).toContain('kc-course-showcase')
  })

  /**
   * WP12 (tulajdonosi kérés, 2026-09-07: „a kurzusaink részből hiányzik az
   * ingyenes”). A 2026-08-15-i K2-szabály („csak fizetős a rácsban”) itt
   * SZÁNDÉKOSAN megfordul: a rács a teljes kínálat, az igazolt ingyenes SOS
   * „Ingyenes” felirattal, a fizetős UTÁN. Indoklás és források a
   * `showcaseProducts` fejlécében (src/lib/course-showcase.ts). A P03-őr
   * (csak igazolt SOS kaphat „Ingyenes” címkét) a következő tesztben marad.
   */
  it('courseCards: az igazolt ingyenes SOS is a rácsban áll, a fizetős után, „Ingyenes” felirattal', () => {
    const html = renderBlocks(
      layoutOf({ blockType: 'courseCards', id: 'cc3', sectionSettings: {} }),
      {
        products: [
          product({
            id: 7,
            sku: 'Ingyenes SOS',
            slug: 'sos-kezrelax-villamkurzus',
            _status: 'published',
            priceInHUF: null,
            priceInHUFEnabled: false,
          }),
          product({ id: 1, sku: 'Fizetős kurzus' }),
        ],
      },
    )
    expect(html).toContain('Fizetős kurzus')
    expect(html).toContain('Ingyenes SOS')
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
    expect(html).toContain('class="kc-course-showcase__price">Ingyenes</span>')
    // Sorrend: a fizetős kártya elöl (M3 elsődleges), az ingyenes hátul (M4).
    expect(html.indexOf('Fizetős kurzus')).toBeLessThan(html.indexOf('Ingyenes SOS'))
    expect(html).toContain('class="kc-course-showcase__grid" data-count="2"')
    // Az örökölt „másodlagos” ProductCard-változat nem tér vissza.
    expect(html).not.toContain('kc-product-card--secondary')
  })

  it('courseCards P03-őr: nem igazolt ingyenes termék (más slug, piszkozat, hiányos ár) nem kerül a rácsba', () => {
    const html = renderBlocks(
      layoutOf({ blockType: 'courseCards', id: 'cc3b', sectionSettings: {} }),
      {
        products: [
          product({ id: 1, sku: 'Fizetős kurzus' }),
          product({
            id: 7,
            sku: 'Másik ingyenes',
            slug: 'masik-ingyenes-kurzus',
            _status: 'published',
            priceInHUF: null,
            priceInHUFEnabled: false,
          }),
          product({
            id: 8,
            sku: 'Piszkozat SOS',
            slug: 'sos-kezrelax-villamkurzus',
            _status: 'draft',
            priceInHUF: null,
            priceInHUFEnabled: false,
          }),
          product({ id: 9, sku: 'Beárazatlan', priceInHUF: null, priceInHUFEnabled: null }),
        ],
      },
    )
    expect(html).toContain('Fizetős kurzus')
    expect(html).not.toContain('Másik ingyenes')
    expect(html).not.toContain('Piszkozat SOS')
    expect(html).not.toContain('Beárazatlan')
    expect(html).not.toContain('>Ingyenes</span>')
  })

  it('howItWorks: a blokk lépései felülírják a beépítetteket', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'howItWorks',
        id: 'h1',
        title: 'Saját folyamatcím',
        steps: [
          { id: 's1', title: 'Első lépés blokkból', text: 'Leírás egy.' },
          { id: 's2', title: 'Második lépés blokkból', text: 'Leírás kettő.' },
        ],
        sectionSettings: {},
      }),
    )
    expect(html).toContain('Saját folyamatcím')
    expect(html).toContain('Első lépés blokkból')
    expect(html).not.toContain('Kiválasztod a kurzust')
  })

  it('howItWorks: a production leftover U+2014-et vesszőre cseréli', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'howItWorks',
        id: 'h-leftover',
        title: 'Így működik az online kurzus',
        steps: [{ id: 's1', title: 'Kiválasztod a kurzust', text: HOW_IT_WORKS_STEP1_LEFTOVER }],
        sectionSettings: {},
      }),
    )
    expect(html).toContain(HOW_IT_WORKS_STEP1_FIXED)
    expect(html).not.toContain('\u2014')
  })

  it('testimonials: eyebrow/cím-felülírás + maxItems korlát érvényesül', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'testimonials',
        id: 't1',
        eyebrow: 'Visszajelzések',
        heading: 'Ők mondták',
        maxItems: 1,
        sectionSettings: {},
      }),
      { testimonials: [testimonial({ id: 1 }), testimonial({ id: 2 })] },
    )
    expect(html).toContain('Visszajelzések')
    expect(html).toContain('Ők mondták')
    expect(html).toContain('Teljes vélemény 1.')
    expect(html).not.toContain('Teljes vélemény 2.')
  })

  it('knowledge: limit levágja a posztlistát', () => {
    const html = renderBlocks(
      layoutOf({ blockType: 'knowledge', id: 'k1', limit: 1, sectionSettings: {} }),
      { posts: [post({ id: 1 }), post({ id: 2 })] },
    )
    expect(html).toContain('Teszt poszt 1')
    expect(html).not.toContain('Teszt poszt 2')
  })

  it('ismételt adatvezérelt blokk nem duplikálja az alap-horgonyt', () => {
    const html = renderBlocks(
      layoutOf(
        { blockType: 'testimonials', id: 't1', sectionSettings: {} },
        { blockType: 'testimonials', id: 't2', sectionSettings: {} },
      ),
      { testimonials: [testimonial({ id: 1 })] },
    )
    // Az első példány kapja a beépített horgonyt, a második egyedit kap.
    expect(html.match(/id="velemenyek"/g)?.length ?? 0).toBe(1)
    expect(html).toContain('id="velemenyek-t2"')
  })

  /**
   * A HIÁNYOSAN konfigurált termék NEM lead-magnet (2026-08-16-i átvizsgálás).
   *
   * A régi szűrő (`!isPaidProduct`) minden nem-fizetős terméket ingyenesnek
   * vett: a beállítatlan ár-pipájú vagy a bepipált, de üres árú (hibás) rekord
   * kiesett a fizetős rácsból, ÉS a FreeSos „Ingyenes" sávjába került — a
   * szerkesztői hiba így némán ingyenes ajánlattá változott. Az új szűrő az
   * `isFreeCourse` (szigorú `=== false`).
   */
  it('freeSos: a HIÁNYOSAN konfigurált termék nem lesz ingyenes lead-magnet', () => {
    const html = renderBlocks(layoutOf({ blockType: 'freeSos', id: 'f0', sectionSettings: {} }), {
      products: [
        // ár-pipa BEÁLLÍTATLAN → sem fizetős, sem ingyenes
        product({ id: 8, sku: 'Beárazatlan kurzus', priceInHUF: null, priceInHUFEnabled: null }),
        // ár-pipa BE, ár ÜRES → szintén hibás konfiguráció
        product({
          id: 9,
          sku: 'Félrekonfigurált kurzus',
          priceInHUF: null,
          priceInHUFEnabled: true,
        }),
      ],
    })
    expect(html).not.toContain('Beárazatlan kurzus')
    expect(html).not.toContain('Félrekonfigurált kurzus')
    // A hibás termékadat nem válhat ingyenes ajánlattá: a teljes sáv semleges.
    expect(html).toContain('>Kurzusaink</h2>')
    expect(html).toContain('Ismerd meg a kurzusainkat, és válaszd ki a neked megfelelőt.')
    expect(html).toContain('Nézd meg a kurzusokat')
    expect(html).toContain('href="/kurzusok"')
    expect(html).not.toContain('SOS Kézrelax')
    expect(html).not.toContain('kc-free-sos__badge')
    expect(html).not.toContain('Ingyenes')
    expect(html).not.toContain(FREE_SOS_COURSE_CTA_LABEL)
  })

  it('freeSos: a kanonikus, TUDATOSAN ingyenes SOS változatlanul lead-magnet marad', () => {
    const html = renderBlocks(layoutOf({ blockType: 'freeSos', id: 'f0b', sectionSettings: {} }), {
      products: [
        product({
          id: 7,
          slug: 'sos-kezrelax-villamkurzus',
          _status: 'published',
          sku: 'Ingyenes SOS',
          priceInHUF: null,
          priceInHUFEnabled: false,
        }),
      ],
    })
    expect(html).toContain('Ingyenes SOS')
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
  })

  /**
   * A gomb felirata szótári. Ingyenes termék nélkül a gomb a listára visz,
   * a cím és a törzsszöveg pedig semlegesre vált: a CMS-ben maradt ingyenes
   * ajánlat sem ígérhet nem igazolt hozzáférést
   * (`resolveFreeSosCta`; a mért hiba: docs/gomb-inventar.md B7). A teljes
   * ág-mérés az `src/__tests__/kezdolap-cta-egyertelmuseg.test.tsx` őrben van.
   */
  it('freeSos: termék híján semleges ajánlat váltja a CMS ingyenes ígéretét', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'freeSos',
        id: 'f1',
        title: 'Ingyenes villámkurzus sáv',
        body: 'Rövid szöveg a sávban.',
        cta: { felirat: 'Kérem az ingyenes anyagot', url: '/kurzusok' },
        sectionSettings: {},
      }),
    )
    expect(html).toContain('>Kurzusaink</h2>')
    expect(html).toContain('Ismerd meg a kurzusainkat, és válaszd ki a neked megfelelőt.')
    expect(html).not.toContain('Ingyenes villámkurzus sáv')
    expect(html).not.toContain('Rövid szöveg a sávban.')
    expect(html).not.toContain('kc-free-sos__badge')
    expect(html).not.toContain('Ingyenes')
    expect(html).not.toContain(FREE_SOS_COURSE_CTA_LABEL)
    expect(html).toContain('Nézd meg a kurzusokat')
    expect(html).toContain('href="/kurzusok"')
    expect(html).not.toContain('Kérem az ingyenes anyagot')
  })

  it('freeSos: ingyenes termékkel a SZÓTÁRI felirat áll, a cél a kurzusoldal', () => {
    const html = renderBlocks(
      layoutOf({
        blockType: 'freeSos',
        id: 'f1',
        title: 'Ingyenes villámkurzus sáv',
        cta: { felirat: 'Kérem az ingyenes anyagot', url: '/kurzusok' },
        sectionSettings: {},
      }),
      {
        products: [
          product({
            id: 7,
            displayTitle: 'SOS Kézrelax villámkurzus',
            slug: 'sos-kezrelax-villamkurzus',
            _status: 'published',
            priceInHUF: null,
            priceInHUFEnabled: false,
          } as Partial<Product> & { id: number }),
        ],
      },
    )
    // 2026-08-18, tulajdonosi döntés: a szótári cselekvéseknél a KÓD nyer —
    // a szerkesztő felirata a `freeSos` gombján nem érvényesül.
    expect(html).not.toContain('Kérem az ingyenes anyagot')
    expect(html).toContain(FREE_SOS_COURSE_CTA_LABEL)
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
  })
})

// ---------------------------------------------------------------------------
// 3. A seed alap-layoutjának szerződése
// ---------------------------------------------------------------------------

describe('buildHomeLayout (seed alap-layout)', () => {
  it('csak katalógusbeli blokktípust használ', () => {
    const layout = buildHomeLayout()
    expect(layout.length).toBeGreaterThan(0)
    for (const block of layout) {
      expect(pageBlockSlugs).toContain(block.blockType)
    }
  })

  it('a filmHero az első blokk — a kezdőlap a filmsávval nyit', () => {
    expect(buildHomeLayout()[0]?.blockType).toBe('filmHero')
  })

  it('az értékesítési hierarchia (UX-skill M1–M8) sorrend-szabályai teljesülnek', () => {
    const order: string[] = buildHomeLayout().map((block) => block.blockType)
    const at = (type: string) => order.indexOf(type)
    // M2–M4: hitel-csík közvetlenül a hero után, a fizetős blokk előbb, mint az ingyenes.
    // A C-sín a régi háromoszlopos / states utáni services helyén áll — a Katák
    // about blokkját a seed nem mozdítja.
    expect(at('credsStrip')).toBe(1)
    expect(at('courseCards')).toBe(2)
    expect(at('services')).toBe(at('states') + 1)
    expect(at('freeSos')).toBeGreaterThan(at('courseCards'))
    // M6–M7: vélemények és tudástár csak a termékblokk UTÁN jöhetnek.
    expect(at('testimonials')).toBeGreaterThan(at('courseCards'))
    expect(at('knowledge')).toBeGreaterThan(at('courseCards'))
    // M8: a GYIK az utolsó ELLENÉRV-KEZELŐ szekció; utána már csak a záró
    // CTA-sáv állhat, hogy a lap cselekvéssel záruljon a fizetős irányba
    // (UX-skill 1. pont; ugyanez a minta zárja a /rolunk és /szolgaltatasok
    // oldalt is). Több CTA-sáv gyengítené egymást, ezért pontosan EGY van.
    expect(order[order.length - 2]).toBe('faq')
    expect(order[order.length - 1]).toBe('ctaBanner')
    expect(order.filter((type) => type === 'ctaBanner')).toHaveLength(1)
  })

  it('média nélkül is renderelhető, pontosan egy H1-gyel (UX-skill 4. pont)', () => {
    const html = renderBlocks(buildHomeLayout(), {
      products: [product({ id: 1 })],
      posts: [post({ id: 1 })],
      testimonials: [testimonial({ id: 1 })],
    })
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length
    expect(h1Count).toBe(1)
    // A faq blokk a saját tételeiből adja a FAQPage JSON-LD-t.
    expect(html).toContain('"@type":"FAQPage"')
  })
})

// ---------------------------------------------------------------------------
// WP11 — a filmsáv utáni első About az alapítók-alak (fotó-fríz), a többi nem
// ---------------------------------------------------------------------------

describe('RenderBlocks — alapítók-alak (fotó-fríz) a filmsáv után', () => {
  const film = {
    blockType: 'filmHero' as const,
    id: 'film',
    title: 'Film cím',
    sectionSettings: { visible: true },
  }
  const about = (id: string) => ({
    blockType: 'about' as const,
    id,
    title: 'Kiss Kata és Kocsis Kata vagyunk',
    paragraphs: [{ text: 'Gyógytornászok vagyunk.', emphasized: true }],
    sectionSettings: { visible: true },
  })

  it('a filmsáv után közvetlenül álló első About kapja a frízt, a későbbi nem', () => {
    const html = renderBlocks(layoutOf(film, about('elso'), about('masodik')))
    expect(html).not.toContain('kc-section kc-photo-frieze')
    const elso = html.indexOf('id="about-cim-elso"')
    const masodik = html.indexOf('id="about-cim-masodik"')
    expect(elso).toBeGreaterThan(-1)
    expect(masodik).toBeGreaterThan(elso)
    expect(html.slice(0, masodik)).toContain('kc-about--founders')
    expect(html.slice(0, masodik)).toContain('<figure class="kc-photo-frieze">')
    expect(html.slice(masodik)).not.toContain('kc-about--founders')
    expect(html.slice(masodik)).not.toContain('kc-photo-frieze')
    // A fríz a film záró </section>-je UTÁN, az About-szekción belül áll.
    const filmVege = html.indexOf('</section>')
    expect(html.indexOf('kc-photo-frieze')).toBeGreaterThan(filmVege)
  })

  it('filmsáv nélkül (pl. /rolunk) vagy ha más blokk áll közbe, az About nem kap frízt', () => {
    expect(renderBlocks(layoutOf(about('rolunk')))).not.toContain('kc-photo-frieze')
    const kozbe = renderBlocks(
      layoutOf(
        film,
        { blockType: 'welcome', id: 'w', title: 'Üdv', sectionSettings: { visible: true } },
        about('kesobb'),
      ),
    )
    expect(kozbe).not.toContain('kc-photo-frieze')
  })

  it('a filmsáv és az About közötti REJTETT blokk nem szakítja meg a párost', () => {
    const html = renderBlocks(
      layoutOf(
        film,
        { blockType: 'welcome', id: 'w', title: 'Üdv', sectionSettings: { visible: false } },
        about('kozvetlen'),
      ),
    )
    expect(html).toContain('kc-about--founders')
  })
})
