import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CtaBanner, ctaBannerCoverAlt } from '../components/blocks/CtaBanner'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { resolveCtaBannerCourseCover } from '../lib/cta-banner-course'
import type { BlockCtaBanner, Media, Page, Product } from '../payload-types'
import {
  hosszPx,
  sajatErtek,
  stilusLapNezetablakra,
  tokenek,
  varFeloldas,
  type Elem,
} from './helpers/css-geometria'

/**
 * CTA-sáv kurzus-borító (tulajdonosi kérés, 2026-09-19): a záró „Kezdd el még
 * ma" és a /rolunk „Kezdd el otthon, a saját tempódban" sávba a kurzus képe.
 *
 * A kép NEM új CMS-mező (az migrációt kívánna), hanem a gomb céljából
 * feloldott kurzus meglévő `coverImage`-e (src/lib/cta-banner-course.ts). Ez a
 * teszt a feloldás három ágát és a renderelés szerződését rögzíti, DB és
 * hálózat nélkül: a termékek fixture-ként érkeznek a RenderBlocks
 * `products` propján, ahogy élesben a route-tól. Egy esetleges `payload`
 * import hangosan bukik — a sávnak nincs saját lekérdezése.
 */

vi.mock('payload', () => {
  throw new Error('A CTA-sáv kurzus-borítója nem kérdezhet le: a lap termékeiből dolgozik.')
})

// ---------------------------------------------------------------------------
// Fixture-k
// ---------------------------------------------------------------------------

function media(overrides: Partial<Media> & { id: number }): Media {
  return {
    alt: '',
    url: `/media/kurzus-${overrides.id}.jpg`,
    width: 1600,
    height: 1200,
    sizes: {
      xs: { url: `/media/kurzus-${overrides.id}-320.jpg`, width: 320, height: 240 },
      sm: { url: `/media/kurzus-${overrides.id}-640.jpg`, width: 640, height: 480 },
      md: { url: `/media/kurzus-${overrides.id}-1280.jpg`, width: 1280, height: 960 },
    },
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Media
}

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    slug: `kurzus-${overrides.id}`,
    shortDescription: 'Otthon végezhető program.',
    coverImage: null,
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    _status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

const PROGRAM = product({
  id: 1,
  sku: 'Otthoni kézrehab program',
  slug: 'otthoni-kezrehab-program',
  coverImage: media({ id: 1, alt: 'Gyógytornász kézgyakorlatot mutat' }),
})
const MASIK_KURZUS = product({
  id: 2,
  sku: 'Szakmai kurzus',
  slug: 'szakmai-kurzus',
  coverImage: media({ id: 2, alt: '' }),
})
const BORITO_NELKUL = product({ id: 3, slug: 'borito-nelkul', coverImage: null })
const CSAK_ID = product({ id: 4, slug: null, coverImage: media({ id: 4 }) })

function ctaBlock(url: string | null, overrides: Partial<BlockCtaBanner> = {}): BlockCtaBanner {
  return {
    id: 'zaro',
    blockType: 'ctaBanner',
    title: 'Kezdd el még ma',
    text: 'Az otthoni programmal a saját tempódban indulhatsz.',
    cta: { felirat: 'Nézd meg a kurzusokat', url, ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'tint' },
    ...overrides,
  } as unknown as BlockCtaBanner
}

function renderLayout(layout: NonNullable<Page['layout']>, products: Product[]): string {
  return renderToStaticMarkup(
    createElement(RenderBlocks, { layout, products, posts: [], testimonials: [] }),
  )
}

const KEP = /<figure class="kc-cta-banner__figure">[\s\S]*?<img [^>]*>[\s\S]*?<\/figure>/

// ---------------------------------------------------------------------------
// 1. A feloldás szabálya (tiszta függvény)
// ---------------------------------------------------------------------------

describe('resolveCtaBannerCourseCover — a gomb céljából', () => {
  const kinalat = [PROGRAM, MASIK_KURZUS, BORITO_NELKUL, CSAK_ID]

  it('/kurzusok/<slug> → pontosan az a kurzus, query és horgony nélkül is', () => {
    expect(resolveCtaBannerCourseCover('/kurzusok/szakmai-kurzus', kinalat)?.href).toBe(
      '/kurzusok/szakmai-kurzus',
    )
    expect(
      resolveCtaBannerCourseCover(
        ' /kurzusok/otthoni-kezrehab-program/?utm_source=hirlevel#kurzus-vasarlas-gomb ',
        kinalat,
      )?.href,
    ).toBe('/kurzusok/otthoni-kezrehab-program')
  })

  it('a régi, id-alapú /kurzusok/<id> címet is felismeri', () => {
    expect(resolveCtaBannerCourseCover('/kurzusok/4', kinalat)?.href).toBe('/kurzusok/4')
  })

  it('/kurzusok (a lista) → a kínálat első fizetős kurzusa', () => {
    const cover = resolveCtaBannerCourseCover('/kurzusok/', kinalat)
    expect(cover?.href).toBe('/kurzusok/otthoni-kezrehab-program')
    expect(cover?.title).toBe('Otthoni kézrehab program')
    // Ingyenes kurzus sosem lehet a lista-hivatkozás képe.
    const ingyenes = product({ id: 9, priceInHUFEnabled: false, coverImage: media({ id: 9 }) })
    expect(resolveCtaBannerCourseCover('/kurzusok', [ingyenes])).toBeNull()
  })

  it('nem kurzus-cél → null (belső oldal, külső URL, üres, protokoll-relatív)', () => {
    for (const url of [
      '/kapcsolat',
      'https://kineticare.hu/kurzusok',
      '',
      null,
      undefined,
      '//x',
    ]) {
      expect(resolveCtaBannerCourseCover(url, kinalat), String(url)).toBeNull()
    }
    expect(resolveCtaBannerCourseCover('/kurzusok/nincs-ilyen', kinalat)).toBeNull()
    expect(resolveCtaBannerCourseCover('/kurzusokk', kinalat)).toBeNull()
  })

  it('borítókép nélküli kurzusnál null (tartalékképet nem találunk ki)', () => {
    expect(resolveCtaBannerCourseCover('/kurzusok/borito-nelkul', kinalat)).toBeNull()
    const idCsak = product({ id: 5, slug: 'id-csak', coverImage: 77 })
    expect(resolveCtaBannerCourseCover('/kurzusok/id-csak', [idCsak])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Renderelés a RenderBlocks-on át (a termékek a lap propjai, nem lekérdezés)
// ---------------------------------------------------------------------------

describe('CtaBanner — kurzus-borító a sávban', () => {
  it('kurzus-linkes CTA a borítóképpel renderel: lusta kép, alt, sizes, cím és gomb marad', () => {
    const html = renderLayout([ctaBlock('/kurzusok/otthoni-kezrehab-program')], [PROGRAM])
    expect(html).toMatch(KEP)
    expect(html).toContain('kc-cta-banner__inner--illustrated')
    expect(html).toContain('alt="Gyógytornász kézgyakorlatot mutat"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('sizes="(max-width: 599px) 40vw, 240px"')
    expect(html).toContain('kurzus-1-640.jpg')
    // A cím és a gomb hierarchiája változatlan: h2 + egyetlen link a gombra.
    expect(html).toContain('<h2 class="kc-cta-banner__title"')
    expect(html.match(/<a /g)?.length).toBe(1)
    expect(html).toContain('href="/kurzusok/otthoni-kezrehab-program"')
    // A kép nem interaktív: nincs link a figure körül.
    expect(html).not.toMatch(/<a [^>]*>\s*<figure/)
  })

  it('a /kurzusok listára mutató záró sáv az első fizetős kurzus borítóját kapja', () => {
    const html = renderLayout([ctaBlock('/kurzusok')], [MASIK_KURZUS, PROGRAM])
    expect(html).toMatch(KEP)
    expect(html).toContain('kurzus-2-640.jpg')
  })

  it('nem-kurzus link → nincs kép, a sáv változatlan', () => {
    const html = renderLayout([ctaBlock('/kapcsolat')], [PROGRAM])
    expect(html).not.toContain('kc-cta-banner__figure')
    expect(html).not.toContain('kc-cta-banner__inner--illustrated')
    expect(html).toContain('class="kc-cta-banner__inner"')
  })

  it('nincs coverImage → nincs kép', () => {
    const html = renderLayout([ctaBlock('/kurzusok/borito-nelkul')], [BORITO_NELKUL])
    expect(html).not.toContain('kc-cta-banner__figure')
  })

  it('csak publikált kurzus képe jöhet (piszkozat/archivált termék nem)', () => {
    const rejtett = product({ ...PROGRAM, status: 'draft' })
    const html = renderLayout([ctaBlock('/kurzusok/otthoni-kezrehab-program')], [rejtett])
    expect(html).not.toContain('kc-cta-banner__figure')
  })

  it('alt tartalék: a média üres alt-ja helyett „<kurzus címe> borítóképe"', () => {
    const cover = resolveCtaBannerCourseCover('/kurzusok/szakmai-kurzus', [MASIK_KURZUS])
    expect(cover).not.toBeNull()
    expect(ctaBannerCoverAlt(cover!)).toBe('Szakmai kurzus borítóképe')
    const html = renderToStaticMarkup(
      createElement(CtaBanner, { block: ctaBlock('/kurzusok/szakmai-kurzus'), courseCover: cover }),
    )
    expect(html).toContain('alt="Szakmai kurzus borítóképe"')
  })
})

// ---------------------------------------------------------------------------
// 3. Geometria-őr: a kép MÁSODLAGOS marad (a feladat mért korlátai)
// ---------------------------------------------------------------------------

const REPO = fileURLToPath(new URL('..', import.meta.url))
const LAPOK = [
  `${REPO}app/(frontend)/styles/tokens.css`,
  `${REPO}app/(frontend)/styles/blocks/cta-banner.css`,
]
const FIGURE: Elem = {
  elemnev: 'figure',
  szulo: null,
  osztaly: '.kc-cta-banner__figure',
  ostagOsztaly: null,
}
const RACS: Elem = {
  elemnev: 'div',
  szulo: null,
  osztaly: '.kc-cta-banner__inner--illustrated',
  ostagOsztaly: null,
}

describe('cta-banner.css — a borító mérete nézetablakonként', () => {
  it('320 px: egy hasáb, a kép legfeljebb a hasáb 40%-a', () => {
    const lap = stilusLapNezetablakra(LAPOK, 320, 640)
    const t = tokenek(lap)
    expect(sajatErtek(lap, RACS, 'grid-template-columns')).toBe('minmax(0, 1fr)')
    // A tartalom-hasáb: 320 − 2 × oldalmargó (--kc-container-gutter).
    const margo = hosszPx(varFeloldas(t.get('--kc-container-gutter')!, t), 320, 16)
    const hasab = 320 - 2 * margo
    const kepSzelesseg = sajatErtek(lap, FIGURE, 'width')!
    // A % a hasábra vonatkozik: min(40%, 9rem) → a kisebbik.
    const pxErtek = Math.min(hasab * 0.4, hosszPx('9rem', 320, 16))
    expect(kepSzelesseg).toBe('min(40%, 9rem)')
    expect(pxErtek).toBeLessThanOrEqual(hasab * 0.4)
  })

  it('768 px: két oszlop, a kép-oszlop 192 px (a 220 px-es asztali sáv alatt)', () => {
    const lap = stilusLapNezetablakra(LAPOK, 768, 1024)
    const oszlopok = sajatErtek(lap, RACS, 'grid-template-columns')!
    expect(oszlopok).toBe('minmax(0, 1fr) 12rem')
    expect(hosszPx('12rem', 768, 16)).toBe(192)
    expect(sajatErtek(lap, FIGURE, 'width')).toBe('100%')
  })

  it('1440 px: a kép-oszlop 240 px, a kért 220–260 px-es sávban', () => {
    const lap = stilusLapNezetablakra(LAPOK, 1440, 900)
    const oszlopok = sajatErtek(lap, RACS, 'grid-template-columns')!
    expect(oszlopok).toBe('minmax(0, 1fr) 15rem')
    const px = hosszPx('15rem', 1440, 16)
    expect(px).toBeGreaterThanOrEqual(220)
    expect(px).toBeLessThanOrEqual(260)
  })

  it('a keret a kártya-nyelv tokenjeit viseli (radius-lg, hairline-szegély, 4:3)', () => {
    const lap = stilusLapNezetablakra(LAPOK, 1440, 900)
    expect(sajatErtek(lap, FIGURE, 'border-radius')).toBe('var(--kc-radius-lg)')
    expect(sajatErtek(lap, FIGURE, 'border')).toBe('1px solid var(--kc-color-border)')
    const kep: Elem = {
      elemnev: 'img',
      szulo: null,
      osztaly: '.kc-cta-banner__image',
      ostagOsztaly: null,
    }
    expect(sajatErtek(lap, kep, 'aspect-ratio')).toBe('4 / 3')
  })
})
