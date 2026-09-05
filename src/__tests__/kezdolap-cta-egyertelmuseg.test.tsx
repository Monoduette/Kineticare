import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { HomeView } from '../components/content/HomeView'
import {
  COURSE_LIST_PATH,
  FREE_SOS_COURSE_CTA_LABEL,
  FREE_SOS_LIST_CTA_LABEL,
  isCourseDetailHref,
  resolveFreeSosCta,
} from '../components/content/home/FreeSos'
import { buildHomeLayout } from '../lib/home-seed'
import type { Page, Product } from '../payload-types'

/**
 * KEZDŐLAPI CTA-ŐR — a „hat felirat, egy cél" hiba és a hazug gomb ellen.
 * Az élő kezdőlap `<main>`-jében HAT hivatkozás vitt a `/kurzusok` listára, öt
 * különböző felirattal („Kurzusok megtekintése", „Összes kurzus megtekintése",
 * „Elindítom az ingyenes kurzust", „Tovább a programra", „Megnézem a
 * kurzusokat"), plusz a fejléc „Kurzusok" gombja. A harmadik ráadásul az
 */

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
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

/** Ingyenes termék: nincs (érvényes) ár, ezért a `isPaidProduct` false-ot ad. */
function freeProduct(overrides: Partial<Product> = {}): Product {
  return product({
    id: 2,
    sku: 'SOS Kézrelax villámkurzus',
    displayTitle: 'SOS Kézrelax villámkurzus',
    slug: 'sos-kezrelax-villamkurzus',
    _status: 'published',
    priceInHUF: null,
    priceInHUFEnabled: false,
    ...overrides,
  } as Partial<Product> & { id: number })
}

interface RenderedLink {
  href: string
  label: string
}

/** A renderelt HTML összes hivatkozása (felirat: szövegre csupaszítva, összevont szóközzel). */
function links(html: string): RenderedLink[] {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)).flatMap(([, attrs, inner]) => {
    const href = /href="([^"]*)"/.exec(attrs)?.[1]
    if (href === undefined) {
      return []
    }
    const label = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/→/g, '')
      .trim()
    return [{ href, label }]
  })
}

/** Cél → a hozzá tartozó KÜLÖNBÖZŐ feliratok halmaza. */
function labelsByHref(html: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const { href, label } of links(html)) {
    if (label.length === 0) {
      // Kép-linkek (kártyaborító) — a felirat a kártya szövegében van.
      continue
    }
    const set = map.get(href) ?? new Set<string>()
    set.add(label)
    map.set(href, set)
  }
  return map
}

function homePage(layout: NonNullable<Page['layout']>): Page {
  return {
    id: 1,
    title: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
    slug: 'kezdolap',
    excerpt: 'Bevezető.',
    content: null,
    layout,
    heroImage: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    status: 'published',
    publishedAt: null,
    order: null,
    updatedAt: '',
    createdAt: '',
  } as unknown as Page
}

// ---------------------------------------------------------------------------
// 1. Egy cél = egy felirat
// ---------------------------------------------------------------------------

describe('Kezdőlap: egy cél = egy felirat (WCAG 2.2 SC 3.2.4)', () => {
  it('a rögzített (CMS-szekciósor nélküli) kezdőlapon egyetlen célhoz sem tartozik két felirat', () => {
    const html = render(
      createElement(HomeView, {
        home: null,
        products: [product({ id: 1 }), freeProduct()],
        posts: [],
      }),
    )

    for (const [href, labels] of labelsByHref(html)) {
      expect(
        Array.from(labels),
        `A(z) ${href} célra több felirat él ugyanazon a lapon: ${Array.from(labels).join(' | ')}`,
      ).toHaveLength(1)
    }
  })

  it('a seed-szekciósorral renderelt kezdőlapon sem tartozik két felirat egy célhoz', () => {
    const html = render(
      createElement(RenderBlocks, {
        layout: buildHomeLayout(),
        products: [product({ id: 1 }), freeProduct()],
        posts: [],
        testimonials: [],
      }),
    )

    for (const [href, labels] of labelsByHref(html)) {
      expect(
        Array.from(labels),
        `A(z) ${href} célra több felirat él ugyanazon a lapon: ${Array.from(labels).join(' | ')}`,
      ).toHaveLength(1)
    }
  })

  it('a kurzuslistára mutató hivatkozások mind a jóváhagyott feliratot használják', () => {
    const html = render(
      createElement(RenderBlocks, {
        layout: buildHomeLayout(),
        products: [product({ id: 1 }), freeProduct()],
        posts: [],
        testimonials: [],
      }),
    )

    const listLabels = labelsByHref(html).get(COURSE_LIST_PATH)
    expect(listLabels).toBeDefined()
    expect(Array.from(listLabels ?? [])).toEqual([FREE_SOS_LIST_CTA_LABEL])
  })

  it('a mért, félrevezető feliratok egyike sem él tovább a seed-adatban', () => {
    const serialized = JSON.stringify(buildHomeLayout())
    for (const banned of [
      'Elindítom az ingyenes kurzust',
      'Kurzusok megtekintése',
      'Összes kurzus megtekintése',
      'Tovább a programra',
      'Megnézem a kurzusokat',
    ]) {
      expect(serialized, `A seed még tartalmazza a lecserélt feliratot: ${banned}`).not.toContain(
        banned,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Az ingyenes CTA: a felirat és a cél sosem mond ellent egymásnak
// ---------------------------------------------------------------------------

describe('Ingyenes SOS-sáv: a gomb felirata és célja együtt mozog', () => {
  it('van ingyenes termék: a gomb a kurzus oldalára visz, indítást ígérve', () => {
    const cta = resolveFreeSosCta(freeProduct())
    expect(cta.href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    expect(cta.label).toBe(FREE_SOS_COURSE_CTA_LABEL)
    expect(isCourseDetailHref(cta.href)).toBe(true)
  })

  it('a CMS-ből örökölt „/kurzusok" felülírás NEM téríti el a gombot a kurzusról (B7)', () => {
    const cta = resolveFreeSosCta(freeProduct(), {
      label: 'Elindítom az ingyenes kurzust',
      href: COURSE_LIST_PATH,
      newTab: false,
    })
    expect(cta.href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    // 2026-08-18, tulajdonosi döntés: a SZÓTÁRI cselekvéseknél a KÓD nyer. Ez
    // az az adatbázisban őrzött érték, ami élesben legyőzte a §3.2 #3/#4-et —
    // innentől nem érvényesül.
    expect(cta.label).toBe(FREE_SOS_COURSE_CTA_LABEL)
    expect(cta.label).not.toBe('Elindítom az ingyenes kurzust')
  })

  it('a szűrt lista sem fogadható el célként (a `?kategoria=` sem)', () => {
    const cta = resolveFreeSosCta(freeProduct(), {
      href: '/kurzusok?kategoria=kezrehabilitacios-kurzusok',
    })
    expect(cta.href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
  })

  it('nincs ingyenes termék: a gomb a listára visz, és NEM ígér indítást', () => {
    const cta = resolveFreeSosCta(null, { label: 'Elindítom az ingyenes kurzust' })
    expect(cta.href).toBe(COURSE_LIST_PATH)
    expect(cta.label).toBe(FREE_SOS_LIST_CTA_LABEL)
    expect(cta.newTab).toBe(false)
  })

  it('slug nélküli ingyenes termék nem igazolja a nevesített SOS-ajánlatot', () => {
    const cta = resolveFreeSosCta(freeProduct({ slug: null }))
    expect(cta.href).toBe(COURSE_LIST_PATH)
    expect(cta.label).toBe(FREE_SOS_LIST_CTA_LABEL)
  })

  it('a kanonikus SOS id-alapú felülírása továbbra is azonos termékre visz', () => {
    const cta = resolveFreeSosCta(freeProduct(), { href: '/kurzusok/2' })
    expect(cta.href).toBe('/kurzusok/2')
    expect(cta.label).toBe(FREE_SOS_COURSE_CTA_LABEL)
  })

  it('másik kurzus felülírása nem téríti el az ingyenes ajánlatot', () => {
    const cta = resolveFreeSosCta(freeProduct(), { href: '/kurzusok/masik-ingyenes-kurzus' })
    expect(cta.href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    expect(cta.label).toBe(FREE_SOS_COURSE_CTA_LABEL)
  })

  it('a kurzus-aloldal felismerése: csak a valódi aloldal számít annak', () => {
    expect(isCourseDetailHref('/kurzusok/sos')).toBe(true)
    expect(isCourseDetailHref('/kurzusok/2?utm_source=hirlevel')).toBe(true)
    expect(isCourseDetailHref('/kurzusok')).toBe(false)
    expect(isCourseDetailHref('/kurzusok/')).toBe(false)
    expect(isCourseDetailHref('/kurzusok?kategoria=x')).toBe(false)
    expect(isCourseDetailHref('/kurzusokrol')).toBe(false)
    expect(isCourseDetailHref('')).toBe(false)
  })

  it('renderelve is a kurzusoldalra visz, a seed-blokk gombjával együtt', () => {
    const html = render(
      createElement(RenderBlocks, {
        layout: buildHomeLayout(),
        products: [product({ id: 1 }), freeProduct()],
        posts: [],
        testimonials: [],
      }),
    )
    const sosLink = links(html).find((link) => link.label === FREE_SOS_COURSE_CTA_LABEL)
    expect(sosLink).toBeDefined()
    expect(sosLink?.href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
  })
})

// ---------------------------------------------------------------------------
// 3. A CMS-felülírhatóság megmarad
// ---------------------------------------------------------------------------

describe('A szekciónkénti CTA-k és szövegek CMS-ből felülírhatók maradnak', () => {
  it('a freeSos blokk SZÖVEGEI a szerkesztőé, a szótári CTA-felirat a kódé', () => {
    const layout = [
      {
        blockType: 'freeSos' as const,
        title: 'Saját cím a szerkesztőtől',
        body: 'Saját szöveg.',
        cta: { felirat: 'Kipróbálom ingyen', ujAblakban: false },
        sectionSettings: { visible: true, anchorId: 'ingyenes', hatter: 'tint' as const },
      },
    ] as unknown as NonNullable<Page['layout']>

    const html = render(
      createElement(RenderBlocks, {
        layout,
        products: [freeProduct()],
        posts: [],
        testimonials: [],
      }),
    )
    expect(html).toContain('Saját cím a szerkesztőtől')
    expect(html).toContain('Saját szöveg.')
    // 2026-08-18: a szerkesztő a TARTALMAT írja, a szótári CTA-feliratot nem.
    expect(html).not.toContain('Kipróbálom ingyen')
    expect(html).toContain(FREE_SOS_COURSE_CTA_LABEL)
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
  })

  it('a courseCards blokk felvezetői és a kártya-CTA felirata is felülírható', () => {
    const layout = [
      {
        blockType: 'courseCards' as const,
        eyebrow: 'Saját felvezető',
        heading: 'Saját szekciócím',
        lead: 'Saját bevezető.',
        ctaLabel: 'Saját kártya-felirat',
        sectionSettings: { visible: true, anchorId: 'kurzusok', hatter: 'feher' as const },
      },
    ] as unknown as NonNullable<Page['layout']>

    const html = render(
      createElement(RenderBlocks, {
        layout,
        products: [product({ id: 1 })],
        posts: [],
        testimonials: [],
      }),
    )
    expect(html).toContain('Saját felvezető')
    expect(html).toContain('Saját szekciócím')
    expect(html).toContain('Saját bevezető.')
    expect(html).toContain('Saját kártya-felirat')
  })

  it('a filmHero gombjai a CMS-blokkból jönnek (a seed csak alapállapot)', () => {
    const layout = [
      {
        blockType: 'filmHero' as const,
        title: 'Saját hero cím',
        lead: 'Saját hero bevezető.',
        tags: [],
        ctas: [{ felirat: 'Saját gombfelirat', url: '/kurzusok', ujAblakban: false }],
        sectionSettings: { visible: true },
      },
    ] as unknown as NonNullable<Page['layout']>

    const html = render(
      createElement(RenderBlocks, { layout, products: [], posts: [], testimonials: [] }),
    )
    expect(html).toContain('Saját gombfelirat')
  })

  it('a kezdőlap CMS-szekciósora továbbra is felülírja a rögzített kezdőlapot', () => {
    const html = render(
      createElement(HomeView, {
        home: homePage([
          {
            blockType: 'freeSos',
            title: 'Csak ez a szekció legyen',
            sectionSettings: { visible: true },
          },
        ] as unknown as NonNullable<Page['layout']>),
        products: [freeProduct()],
        posts: [],
      }),
    )
    expect(html).toContain('Csak ez a szekció legyen')
    expect(html).not.toContain('Így működik az online kurzus')
  })
})

// ---------------------------------------------------------------------------
// 4. Mikroszöveg: gombfeliratban nincs gondolatjel
// ---------------------------------------------------------------------------

describe('Kezdőlapi mikroszöveg', () => {
  /** U+2014 kvirtmínusz és U+2013 nagykötőjel — gombfeliratban tiltott (§3.1.2). */
  const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)]

  it('a kezdőlapi hivatkozások feliratában nincs gondolatjel', () => {
    const html = render(
      createElement(RenderBlocks, {
        layout: buildHomeLayout(),
        products: [product({ id: 1 }), freeProduct()],
        posts: [],
        testimonials: [],
      }),
    )
    for (const { label, href } of links(html)) {
      for (const dash of DASHES) {
        expect(label, `Gondolatjel a(z) ${href} felirátában: ${label}`).not.toContain(dash)
      }
    }
  })

  it('az ingyenes sáv beépített címe kettőspontot használ, nem gondolatjelet', () => {
    const html = render(
      createElement(HomeView, {
        home: null,
        products: [freeProduct({ displayTitle: '', sku: '' })],
        posts: [],
      }),
    )
    expect(html).toContain('SOS Kézrelax: ingyenes villámkurzus')
  })
})
