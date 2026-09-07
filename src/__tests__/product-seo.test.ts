import { describe, expect, it } from 'vitest'

import { courseHref } from '../lib/course-url'
import { courseCover, coursePriceHuf, coursePriceLabel, courseTitle } from '../lib/courses'
import { formatPriceHuf } from '../lib/format-price'
import {
  absoluteUrl,
  buildProductMetadata,
  courseJsonLd,
  productSeoDoc,
  resolveOgImageUrl,
  resolveSeoDescription,
  resolveSeoTitle,
} from '../lib/seo'
import type { Media, Product } from '../payload-types'

/**
 * Kurzus (products) SEO — a fő értékesítési céloldal meta-adatai és
 * strukturált adata.
 *
 * Miért teszteljük: a kurzusoldal SEO-ja csendben tud elromlani (nincs
 * futásidejű hiba, csak eltűnik a láthatóság), és két szabály könnyen sérül:
 * (1) a fallback-lánc a pages/posts-tól ELTÉRŐ mezőneveken fut
 *     (`sku` / `shortDescription` / `coverImage`), ezért az adapter elcsúszása
 *     észrevétlen marad;
 * (2) a JSON-LD-nek a LÁTHATÓ tartalommal kell egyeznie — ha a séma a
 *     `seoDescription`-re vagy kitalált értékelésre csúszna át, a Google elveti.
 */

// ---------------------------------------------------------------------------
// Fixture factory-k
// ---------------------------------------------------------------------------

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: 1,
    alt: 'Kézgyakorlat egy rehabilitációs labdával',
    url: '/media/borito.webp',
    updatedAt: '2026-01-02T10:00:00.000Z',
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 7,
    sku: 'Kéz-rehab alapprogram',
    shortDescription: 'Nyolc hetes otthoni kézrehabilitációs program.',
    category: 1,
    status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 19990,
    updatedAt: '2026-02-01T10:00:00.000Z',
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  }
}

const COURSE_PATH = '/kurzusok/7'

// ---------------------------------------------------------------------------
// Fallback-lánc
// ---------------------------------------------------------------------------

describe('kurzus SEO-fallbacklánc (products → SeoDoc)', () => {
  it('title: seoTitle → kurzusnév (sku)', () => {
    expect(
      resolveSeoTitle(productSeoDoc(product({ seoTitle: 'Kéztorna otthon — 8 hetes program' }))),
    ).toBe('Kéztorna otthon — 8 hetes program')
    // Üres/hiányzó SEO-cím esetén a megjelenített kurzusnév (a H1 szövege).
    expect(resolveSeoTitle(productSeoDoc(product({ seoTitle: null })))).toBe(
      'Kéz-rehab alapprogram',
    )
    expect(resolveSeoTitle(productSeoDoc(product({ seoTitle: '   ' })))).toBe(
      'Kéz-rehab alapprogram',
    )
    expect(resolveSeoTitle(productSeoDoc(product({ seoTitle: null, sku: null })))).toBe('Kurzus #7')
  })

  it('description: seoDescription → rövid leírás → általános kurzus-mondat', () => {
    expect(
      resolveSeoDescription(
        productSeoDoc(product({ seoDescription: 'Kézsérülés utáni otthoni gyógytorna.' })),
      ),
    ).toBe('Kézsérülés utáni otthoni gyógytorna.')
    expect(resolveSeoDescription(productSeoDoc(product({ seoDescription: null })))).toBe(
      'Nyolc hetes otthoni kézrehabilitációs program.',
    )
    expect(resolveSeoDescription(productSeoDoc(product({ seoDescription: '  ' })))).toBe(
      'Nyolc hetes otthoni kézrehabilitációs program.',
    )
    // Rövid leírás nélkül sem maradhat meta-description nélkül a fő céloldal.
    expect(
      resolveSeoDescription(
        productSeoDoc(product({ seoDescription: null, shortDescription: null })),
      ),
    ).toBe(
      'Kéz-rehab alapprogram: online kézrehabilitációs kurzus a Kineticare kínálatából, gyógytornászoktól, otthon, a saját tempódban.',
    )
  })

  it('og:image: ogImage (og-méret) → ogImage (eredeti) → borítókép (og-méret) → borítókép (eredeti) → nincs', () => {
    const ogSized = media({
      sizes: { og: { url: '/media/og-1200.webp', width: 1200, height: 630 } },
    })
    const coverSized = media({
      url: '/media/borito.webp',
      sizes: { og: { url: '/media/borito-og.webp', width: 1200, height: 630 } },
    })

    expect(resolveOgImageUrl(productSeoDoc(product({ ogImage: ogSized })))).toBe(
      absoluteUrl('/media/og-1200.webp'),
    )
    expect(
      resolveOgImageUrl(
        productSeoDoc(product({ ogImage: media({ url: '/media/og-eredeti.webp' }) })),
      ),
    ).toBe(absoluteUrl('/media/og-eredeti.webp'))
    expect(
      resolveOgImageUrl(productSeoDoc(product({ ogImage: null, coverImage: coverSized }))),
    ).toBe(absoluteUrl('/media/borito-og.webp'))
    expect(
      resolveOgImageUrl(
        productSeoDoc(
          product({ ogImage: null, coverImage: media({ url: '/media/csak-eredeti.webp' }) }),
        ),
      ),
    ).toBe(absoluteUrl('/media/csak-eredeti.webp'))
    expect(
      resolveOgImageUrl(productSeoDoc(product({ ogImage: null, coverImage: null }))),
    ).toBeUndefined()
    // Nem populate-olt (nyers id) kép nem használható og:image-nek.
    expect(
      resolveOgImageUrl(productSeoDoc(product({ ogImage: 42, coverImage: 43 }))),
    ).toBeUndefined()
  })

  it('buildProductMetadata: canonical + openGraph a kurzus fallback-láncával', () => {
    const doc = product({
      seoTitle: 'SEO kurzuscím',
      seoDescription: 'SEO kurzusleírás',
      ogImage: media({ url: '/media/megosztas.webp', alt: 'Megosztási kép' }),
    })
    const metadata = buildProductMetadata(doc, COURSE_PATH)

    expect(metadata.title).toBe('SEO kurzuscím')
    expect(metadata.description).toBe('SEO kurzusleírás')
    expect(metadata.alternates?.canonical).toBe(COURSE_PATH)
    expect(metadata.openGraph?.title).toBe('SEO kurzuscím')
    expect(metadata.openGraph?.url).toBe(absoluteUrl(COURSE_PATH))
    expect(metadata.openGraph?.images).toEqual([
      { url: absoluteUrl('/media/megosztas.webp'), alt: 'Megosztási kép' },
    ])
  })

  it('buildProductMetadata: kitöltetlen SEO-mezők mellett a kurzus saját adataira esik vissza', () => {
    const doc = product({ coverImage: media({ url: '/media/borito.webp', alt: 'Borítókép' }) })
    const metadata = buildProductMetadata(doc, COURSE_PATH)

    expect(metadata.title).toBe('Kéz-rehab alapprogram')
    expect(metadata.description).toBe('Nyolc hetes otthoni kézrehabilitációs program.')
    expect(metadata.openGraph?.images).toEqual([
      { url: absoluteUrl('/media/borito.webp'), alt: 'Borítókép' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Course + Product JSON-LD
// ---------------------------------------------------------------------------

/** A kurzusoldal pontosan így hívja a séma-építőt (a látható értékekkel). */
function jsonLdFor(doc: Product): Record<string, unknown> {
  const cover = courseCover(doc)
  return courseJsonLd({
    product: doc,
    name: courseTitle(doc),
    // A kurzusoldal a KANONIKUS címet adja át (courseHref) — a strukturált adat
    // URL-je és a canonical meta így nem tud kettéválni.
    path: courseHref(doc),
    priceHuf: coursePriceHuf(doc),
    ...(cover ? { imageUrl: absoluteUrl(cover.url) } : {}),
  })
}

describe('Product + Offer JSON-LD a kurzusoldalon', () => {
  const doc = product({ coverImage: media({ url: '/media/borito.webp' }) })
  const jsonLd = jsonLdFor(doc)
  const offers = jsonLd.offers as Record<string, unknown>

  it('egyetlen entitás, kettős @type-pal: Course ÉS Product', () => {
    // Két külön JSON-LD node ugyanarról az oldalról két entitásnak látszana.
    expect(jsonLd['@type']).toEqual(['Course', 'Product'])
    expect(jsonLd['@context']).toBe('https://schema.org')
  })

  it('a Product kötelező/ajánlott mezői megvannak', () => {
    expect(jsonLd.name).toBe('Kéz-rehab alapprogram')
    expect(jsonLd.description).toBe('Nyolc hetes otthoni kézrehabilitációs program.')
    expect(jsonLd.image).toEqual([absoluteUrl('/media/borito.webp')])
    expect(jsonLd.sku).toBe('Kéz-rehab alapprogram')
    expect(jsonLd.brand).toEqual({ '@type': 'Brand', name: 'Kineticare' })
    expect(jsonLd.url).toBe(absoluteUrl('/kurzusok/7'))
    expect(jsonLd.inLanguage).toBe('hu-HU')
  })

  it('az Offer forintban közli az árat, elérhetőséggel és eladóval', () => {
    expect(offers['@type']).toBe('Offer')
    expect(offers.price).toBe(19990)
    expect(offers.priceCurrency).toBe('HUF')
    expect(offers.availability).toBe('https://schema.org/InStock')
    expect(offers.url).toBe(absoluteUrl('/kurzusok/7'))
    expect((offers.seller as Record<string, unknown>)['@type']).toBe('Organization')
  })

  it('archivált kurzusnál az elérhetőség Discontinued', () => {
    const archived = jsonLdFor(product({ status: 'archived' }))
    expect((archived.offers as Record<string, unknown>).availability).toBe(
      'https://schema.org/Discontinued',
    )
  })

  it('ingyenes kurzusnál (nincs ár) NEM közöl offers-t', () => {
    // A 0 Ft-os vagy hiányzó ár félrevezető strukturált adat lenne.
    const free = jsonLdFor(product({ priceInHUFEnabled: false, priceInHUF: null }))
    expect(free.offers).toBeUndefined()
  })

  it('kitalált értékelést SOSEM közöl (nincs értékelés-adat a kurzusokon)', () => {
    expect(jsonLd.aggregateRating).toBeUndefined()
    expect(jsonLd.review).toBeUndefined()
  })
})

describe('a kurzus JSON-LD a LÁTHATÓ tartalommal egyezik', () => {
  const doc = product({
    seoTitle: 'Csak a meta-tagben látszó SEO-cím',
    seoDescription: 'Csak a meta-tagben látszó SEO-leírás',
    coverImage: media({ url: '/media/borito.webp' }),
  })
  const jsonLd = jsonLdFor(doc)
  const offers = jsonLd.offers as Record<string, unknown>

  it('a név a H1 szövege (courseTitle), NEM a seoTitle', () => {
    expect(jsonLd.name).toBe(courseTitle(doc))
    expect(jsonLd.name).not.toBe(doc.seoTitle)
  })

  it('a leírás a hero lead bekezdése (shortDescription), NEM a seoDescription', () => {
    expect(jsonLd.description).toBe(doc.shortDescription)
    expect(jsonLd.description).not.toBe(doc.seoDescription)
  })

  it('a kép a buyboxban megjelenített borítókép', () => {
    const cover = courseCover(doc)
    expect(cover).not.toBeNull()
    expect(jsonLd.image).toEqual([absoluteUrl(cover!.url)])
  })

  it('az ár a kiírt ár-címkével egyezik (ugyanaz a forrás és formázó)', () => {
    expect(offers.price).toBe(coursePriceHuf(doc))
    expect(formatPriceHuf(offers.price as number)).toBe(coursePriceLabel(doc))
  })

  it('a meta-adat viszont a SEO-mezőket használja — a két réteg nem keveredik', () => {
    const metadata = buildProductMetadata(doc, COURSE_PATH)
    expect(metadata.title).toBe('Csak a meta-tagben látszó SEO-cím')
    expect(metadata.description).toBe('Csak a meta-tagben látszó SEO-leírás')
  })
})

describe('kurzus seoKeywords a meta-tagben és a JSON-LD-ben', () => {
  it('kitöltött mező → keywords a metadatokban és a JSON-LD-ben', () => {
    const doc = product({
      seoKeywords: [{ phrase: 'otthoni gyógytorna' }, { phrase: 'kéztorna' }],
    })
    const metadata = buildProductMetadata(doc, COURSE_PATH)
    expect(metadata.keywords).toEqual(['otthoni gyógytorna', 'kéztorna'])
    expect(jsonLdFor(doc).keywords).toBe('otthoni gyógytorna, kéztorna')
  })

  it('üres mezőnél nincs keywords kulcs, a sku-t nem tölti bele', () => {
    const doc = product({ sku: 'Kéztorna otthon — 8 hetes program', seoKeywords: [] })
    const metadata = buildProductMetadata(doc, COURSE_PATH)
    expect('keywords' in metadata).toBe(false)
    expect('keywords' in jsonLdFor(doc)).toBe(false)
    expect(metadata.title).toBe('Kéztorna otthon — 8 hetes program')
  })
})

// ---------------------------------------------------------------------------
// Slugos kurzus-URL (C3)
// ---------------------------------------------------------------------------

describe('slugos kurzus-URL a SEO-rétegben', () => {
  const doc = product({ slug: 'kez-rehab-alapprogram', displayTitle: 'Kéz-rehab alapprogram' })

  it('a canonical és a JSON-LD is a slugos címet használja', () => {
    const path = courseHref(doc)
    expect(path).toBe('/kurzusok/kez-rehab-alapprogram')

    const metadata = buildProductMetadata(doc, path)
    expect(metadata.alternates?.canonical).toBe(path)
    expect(metadata.openGraph?.url).toBe(absoluteUrl(path))

    const jsonLd = jsonLdFor(doc)
    expect(jsonLd.url).toBe(absoluteUrl(path))
    expect((jsonLd.offers as Record<string, unknown>).url).toBe(absoluteUrl(path))
  })

  it('a megjelenő név a kurzuscím, a sku viszont marad azonosító', () => {
    const named = product({
      slug: 'kez-rehab-alapprogram',
      sku: 'KURZUS-001',
      displayTitle: 'Kéztorna otthon — 8 hetes program',
    })
    const jsonLd = jsonLdFor(named)
    expect(jsonLd.name).toBe('Kéztorna otthon — 8 hetes program')
    expect(jsonLd.sku).toBe('KURZUS-001')
    expect(resolveSeoTitle(productSeoDoc(named))).toBe('Kéztorna otthon — 8 hetes program')
  })
})
