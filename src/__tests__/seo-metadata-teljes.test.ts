import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Metadata } from 'next'
import { describe, expect, it } from 'vitest'

import { FOOTER_CONTACT_EMAIL } from '../components/layout/Footer'
import {
  buildDocMetadata,
  buildHomeMetadata,
  buildPrivatePageMetadata,
  buildProductMetadata,
  buildStaticPageMetadata,
  CONTACT_EMAIL,
  COURSE_LISTING_DESCRIPTION,
  COURSE_LISTING_TITLE,
  DEFAULT_OG_IMAGE,
  DOCUMENT_TITLE_MAX,
  documentTitle,
  INDEX_ROBOTS,
  NOINDEX_ROBOTS,
  renderedDocumentTitle,
  SITE_DESCRIPTION,
} from '../lib/seo'
import { KURZUSLISTA_KULCSSZAVAK } from '../lib/tudastar/seo-kulcsszavak'
import type { Media } from '../payload-types'

/**
 * Őr: minden nyilvános lap metaadata teljes és mért korlátok közt marad.
 *
 * Korlátok és forrásuk:
 * - `<title>` ≤ 60 karakter, a márka PONTOSAN egyszer (Google *Influencing
 *   your title links*: https://developers.google.com/search/docs/appearance/title-link;
 *   NN/g *Page titles*: https://www.nngroup.com/articles/page-titles/).
 * - meta description 120–160 karakter, egyedi lapónként (Google *Control your
 *   snippets*: https://developers.google.com/search/docs/appearance/snippet;
 *   `docs/seo-geo-llm.md` 5.4).
 * - canonical, og:type/title/description/url/image(+alt)/locale/site_name
 *   (ogp.me: https://ogp.me/), twitter `summary_large_image`
 *   (https://developer.x.com/en/docs/x-for-websites/cards/markup).
 * - A vevői szövegben nincs töltelék gondolatjel (`docs/ui-sztenderdek.md` §3.1).
 */

const DESCRIPTION_MIN = 120
const DESCRIPTION_MAX = 160

function descriptionOf(metadata: Metadata): string {
  const description = metadata.description
  if (typeof description !== 'string') throw new Error('nincs description')
  return description
}

function ogImages(metadata: Metadata): Array<{ url: string; alt?: string }> {
  const images = metadata.openGraph?.images
  if (!Array.isArray(images)) throw new Error('nincs og:image')
  return images.map((image) => {
    if (typeof image === 'string' || image instanceof URL) {
      return { url: String(image) }
    }
    return { url: String(image.url), ...(image.alt ? { alt: image.alt } : {}) }
  })
}

const media = (url: string, alt: string): Media =>
  ({
    id: 1,
    alt,
    url,
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  }) as Media

/**
 * A CMS seoTitle mezői a mai seed szerint (Railway, 2026-09-07) és a hozzájuk
 * javasolt, 120–160 karakteres seoDescription. A /rolunk élő leírása ma 183
 * karakter (nyitott tétel a tulajdonosnak, a seed nem ennek a körnek a
 * fájlja); a többi élő érték a korláton belül van (kapcsolat 128,
 * szolgáltatások 154).
 */
const CMS_PAGES = {
  szolgaltatasok: {
    title: 'Szolgáltatások',
    seoTitle: 'Szolgáltatások',
    seoDescription:
      'Rendelői gyógytorna és manuálterápia Budapesten (50 perc 18 000 Ft, 20 perc 10 000 Ft), otthoni kézrehabilitációs program és akkreditált szakmai képzések.',
  },
  rolunk: {
    title: 'A kéz a mindenünk',
    seoTitle: 'Rólunk – Kineticare',
    seoDescription:
      'Kocsis Kata és Kiss Kata kézrehabilitációs gyógytornászok Budapesten: szakmai háttér, akkreditált képzés, vélemények és médiamegjelenések egy helyen.',
  },
  kapcsolat: {
    title: 'Kapcsolat',
    seoTitle: 'Kapcsolat – Kineticare',
    seoDescription:
      'Időpontkérés rendelői gyógytornára és manuálterápiára Budapesten (Nádorliget u. 7/b, Fadrusz utca 15.), telefonos egyeztetéssel.',
  },
} as const

/** Minden nyilvános, statikus leírású lap metaadata egy helyen az egyediség-őrhöz. */
function publicMetadataSet(): Record<string, Metadata> {
  return {
    '/': buildHomeMetadata(null),
    '/kurzusok': buildStaticPageMetadata({
      title: COURSE_LISTING_TITLE,
      description: COURSE_LISTING_DESCRIPTION,
      path: '/kurzusok',
      keywords: KURZUSLISTA_KULCSSZAVAK,
    }),
    '/szolgaltatasok': buildDocMetadata(CMS_PAGES.szolgaltatasok, '/szolgaltatasok'),
    '/rolunk': buildDocMetadata(CMS_PAGES.rolunk, '/rolunk'),
    '/kapcsolat': buildStaticPageMetadata({
      title: 'Kapcsolat',
      description: CMS_PAGES.kapcsolat.seoDescription,
      path: '/kapcsolat',
    }),
  }
}

describe('documentTitle — a márka pontosan egyszer', () => {
  it('a CMS-cím végéről levágja a márka-utótagot, hogy a sablon egyszer tegye vissza', () => {
    expect(documentTitle('Rólunk – Kineticare')).toBe('Rólunk')
    expect(documentTitle('Kapcsolat - Kineticare')).toBe('Kapcsolat')
    expect(documentTitle('Szolgáltatások | Kineticare')).toBe('Szolgáltatások')
    expect(renderedDocumentTitle(documentTitle('Rólunk – Kineticare'))).toBe('Rólunk | Kineticare')
  })

  it('a cím belsejében álló márkánál absolute (a sablon nem fut)', () => {
    expect(documentTitle('Kineticare | kézrehabilitáció gyógytornászoktól')).toEqual({
      absolute: 'Kineticare | kézrehabilitáció gyógytornászoktól',
    })
  })

  it('márka nélküli cím változatlanul a sablon alá megy', () => {
    expect(documentTitle('Kurzusok')).toBe('Kurzusok')
    expect(renderedDocumentTitle('Kurzusok')).toBe('Kurzusok | Kineticare')
  })

  it('a renderelt cím sosem tartalmazza kétszer a márkát', () => {
    for (const raw of [
      'Rólunk – Kineticare',
      'Kineticare | X',
      'Tudástár',
      'Kapcsolat | Kineticare',
    ]) {
      const rendered = renderedDocumentTitle(documentTitle(raw))
      expect(rendered.split('Kineticare').length - 1, rendered).toBe(1)
    }
  })
})

describe('nyilvános lapok metaadata — teljes és mért', () => {
  const set = publicMetadataSet()

  it.each(Object.entries(set))(
    '%s: title ≤ 60, márka egyszer, gondolatjel nélkül',
    (_path, metadata) => {
      const rendered = renderedDocumentTitle(metadata.title)
      expect(rendered.length, rendered).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
      expect(rendered.split('Kineticare').length - 1, rendered).toBe(1)
      expect(rendered).not.toMatch(/[–—]/)
    },
  )

  it.each(Object.entries(set))(
    '%s: description 120–160 karakter, gondolatjel nélkül',
    (_path, metadata) => {
      const description = descriptionOf(metadata)
      expect(description.length, description).toBeGreaterThanOrEqual(DESCRIPTION_MIN)
      expect(description.length, description).toBeLessThanOrEqual(DESCRIPTION_MAX)
      expect(description).not.toMatch(/[–—]/)
    },
  )

  it('minden description egyedi (duplikált snippet tilos)', () => {
    const descriptions = Object.values(set).map(descriptionOf)
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it.each(Object.entries(set))('%s: canonical, og és twitter blokk teljes', (path, metadata) => {
    expect(metadata.alternates?.canonical).toBe(path)
    const og = metadata.openGraph
    expect(og).toBeDefined()
    expect(og && 'type' in og ? og.type : undefined).toBe('website')
    expect(og?.locale).toBe('hu_HU')
    expect(og?.siteName).toBe('Kineticare')
    expect(String(og?.url)).toMatch(/^https?:\/\//)
    expect(typeof og?.title).toBe('string')
    expect(typeof og?.description).toBe('string')
    const images = ogImages(metadata)
    expect(images.length).toBeGreaterThanOrEqual(1)
    expect(images[0]!.url).toMatch(/^https?:\/\//)
    expect(images[0]!.alt, 'og:image:alt').toBeTruthy()
    const twitter = metadata.twitter
    expect(twitter && 'card' in twitter ? twitter.card : undefined).toBe('summary_large_image')
  })

  it('CMS-kép nélkül az alap 1200×630-as megosztási kép öröklődik', () => {
    const images = ogImages(set['/kurzusok']!)
    expect(images[0]!.url).toBe(DEFAULT_OG_IMAGE.url)
    expect(DEFAULT_OG_IMAGE.width).toBe(1200)
    expect(DEFAULT_OG_IMAGE.height).toBe(630)
    expect(DEFAULT_OG_IMAGE.url.endsWith('/opengraph-image')).toBe(true)
  })

  it('CMS-kép esetén a saját kép megy ki (alt-tal), nem az alap', () => {
    const metadata = buildDocMetadata(
      { ...CMS_PAGES.rolunk, ogImage: media('/media/csapat.webp', 'A két gyógytornász') },
      '/rolunk',
    )
    expect(ogImages(metadata)).toEqual([
      { url: expect.stringMatching(/\/media\/csapat\.webp$/), alt: 'A két gyógytornász' },
    ])
  })

  it('a kezdőlap tartalék leírása a márka-leírás (mért kifejezésekkel)', () => {
    expect(descriptionOf(buildHomeMetadata(null))).toBe(SITE_DESCRIPTION)
    for (const kifejezes of [
      'kéztőalagút szindróma',
      'ínhüvelygyulladás',
      'teniszkönyök',
      'csuklófájdalom',
    ]) {
      expect(SITE_DESCRIPTION.toLowerCase()).toContain(kifejezes)
    }
  })

  it('a /kurzusok leírása a Search-lockolt kifejezéseket viszi', () => {
    for (const kifejezes of ['otthoni gyógytorna', 'kéztorna gyakorlatok']) {
      expect(COURSE_LISTING_DESCRIPTION.toLowerCase()).toContain(kifejezes)
    }
  })
})

describe('cikk metaadata — og:type article', () => {
  it('published/modified time és szerző a byline nevével', () => {
    const metadata = buildDocMetadata(
      {
        title: 'Kéz zsibbadás: mi okozza, és mikor kell orvos?',
        excerpt: 'Éjjel elzsibbad a kezed, és reggelre elmúlik?',
        seoDescription:
          'Éjjel elzsibbad a kezed, és reggelre elmúlik? Végigvesszük, mi okozhatja a kéz zsibbadását, mit tehetsz otthon, és melyik jelnél kell azonnal orvoshoz fordulni.',
      },
      '/blog/miert-zsibbad-a-kezem',
      {
        article: {
          publishedTime: '2026-08-21T08:00:00.000Z',
          modifiedTime: '2026-09-01T09:00:00.000Z',
          authors: ['Kocsis Kata'],
        },
      },
    )
    const og = metadata.openGraph as Record<string, unknown>
    expect(og.type).toBe('article')
    expect(og.publishedTime).toBe('2026-08-21T08:00:00.000Z')
    expect(og.modifiedTime).toBe('2026-09-01T09:00:00.000Z')
    expect(og.authors).toEqual(['Kocsis Kata'])
    expect(renderedDocumentTitle(metadata.title).length).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
  })

  it('szerző nélkül nincs authors kulcs, üres dátum nem kerül ki', () => {
    const metadata = buildDocMetadata({ title: 'Cikk' }, '/blog/cikk', {
      article: { publishedTime: null, modifiedTime: undefined },
    })
    const og = metadata.openGraph as Record<string, unknown>
    expect('authors' in og).toBe(false)
    expect('publishedTime' in og).toBe(false)
  })
})

describe('privát lapok — noindex + canonical, megosztási kép nélkül', () => {
  const PRIVATE_PATHS = [
    '/elfelejtett-jelszo',
    '/jelszo-visszaallitas',
    '/kosar',
    '/penztar',
    '/fiok',
    '/kurzusaim',
    '/sikertelen',
    '/fizetes/koszonom',
    '/belepes-atallas',
  ]

  it.each(PRIVATE_PATHS)('%s: robots noindex, canonical, cím és leírás', (path) => {
    const metadata = buildPrivatePageMetadata({ title: 'Teszt', description: 'Leírás.', path })
    expect(metadata.robots).toEqual(NOINDEX_ROBOTS)
    expect(metadata.alternates?.canonical).toBe(path)
    expect(metadata.title).toBe('Teszt')
    expect(metadata.description).toBe('Leírás.')
    expect(metadata.openGraph?.images).toBeUndefined()
  })

  it('paraméteres privát lapnál (kurzusaim/[id]) nincs canonical', () => {
    const metadata = buildPrivatePageMetadata({ title: 'Lejátszás', description: 'x' })
    expect(metadata.alternates).toBeUndefined()
    expect(metadata.robots).toEqual(NOINDEX_ROBOTS)
  })

  it('a route-fájlok a közös építőt hívják (nem kézi metadata)', () => {
    for (const dir of [
      'elfelejtett-jelszo',
      'jelszo-visszaallitas',
      'kosar',
      'penztar',
      'fiok',
      'kurzusaim',
      'sikertelen',
      'fizetes/koszonom',
      'belepes-atallas',
      'kurzusaim/[id]',
    ]) {
      const src = readFileSync(
        fileURLToPath(new URL(`../app/(frontend)/${dir}/page.tsx`, import.meta.url)),
        'utf8',
      )
      expect(src, dir).toContain('buildPrivatePageMetadata(')
    }
  })
})

describe('belépés és regisztráció — INDEXELHETŐ (tulajdonosi döntés, 2026-09-07)', () => {
  it.each(['belepes', 'regisztracio'])(
    '%s: közös építő, canonical, leírás 120–160, og:image',
    (dir) => {
      const src = readFileSync(
        fileURLToPath(new URL(`../app/(frontend)/${dir}/page.tsx`, import.meta.url)),
        'utf8',
      )
      expect(src).toContain('buildStaticPageMetadata(')
      expect(src).not.toContain('buildPrivatePageMetadata')
      const description = /description:\s*\n?\s*'([^']+)'/.exec(src)?.[1] ?? ''
      expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN)
      expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
      const metadata = buildStaticPageMetadata({ title: 'x', description, path: `/${dir}` })
      expect(metadata.robots).toBeUndefined()
      expect(metadata.alternates?.canonical).toBe(`/${dir}`)
      expect(ogImages(metadata)[0]!.url).toBe(DEFAULT_OG_IMAGE.url)
    },
  )
})

describe('robots meta — indexelhető alapállapot a keretben', () => {
  it('max-image-preview:large, max-snippet:-1, max-video-preview:-1 a Google-nak is', () => {
    expect(INDEX_ROBOTS).toMatchObject({
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    })
    expect((INDEX_ROBOTS as Record<string, unknown>).googleBot).toMatchObject({
      index: true,
      'max-image-preview': 'large',
    })
    const layout = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/layout.tsx', import.meta.url)),
      'utf8',
    )
    expect(layout).toContain('robots: INDEX_ROBOTS')
    expect(layout).toContain("card: 'summary_large_image'")
    expect(layout).toContain('images: [DEFAULT_OG_IMAGE]')
    expect(layout).not.toMatch(/`\$\{SITE_NAME\} — /)
  })
})

describe('kapcsolati e-mail egy forrásból', () => {
  it('a lábléc és a séma ugyanazt a címet közli', () => {
    expect(CONTACT_EMAIL).toBe(FOOTER_CONTACT_EMAIL)
  })
})

describe('kurzus metaadata — a rövid leírás tartaléka is mért hosszú', () => {
  it('shortDescription nélkül a tartalék mondat 120–160 karakter', () => {
    const metadata = buildProductMetadata(
      {
        id: 7,
        sku: 'Otthoni KézRehab Program',
        displayTitle: null,
        shortDescription: null,
        seoTitle: null,
        seoDescription: null,
        seoKeywords: null,
        ogImage: null,
        coverImage: null,
      },
      '/kurzusok/otthoni-kezrehab-program',
    )
    const description = descriptionOf(metadata)
    expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN)
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(description).not.toMatch(/[–—]/)
  })
})
