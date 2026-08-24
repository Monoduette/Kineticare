import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { absoluteUrl } from '../lib/seo'
import {
  LEGACY_GONE_PATHS,
  LEGACY_REDIRECTS,
  LEGACY_SITEMAP_PATHS,
  buildLegacyRedirects,
} from '../lib/legacy-redirects'
import { UJ_TUDASTAR_SLUGOK } from '../lib/tudastar/eeat-kapu'
import { extractArticleBody } from '../lib/tudastar/markdown-to-lexical'

/**
 * URL-LOCK: a két új cikk csak `/blog/<slug>` poszt. Gyökér pages, seedelt
 * published 200 és örökölt átirányítás tilos (a hub később 308).
 */

vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({ isEnabled: false })),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

vi.mock('@/lib/cms', () => ({
  HOME_PAGE_SLUG: 'kezdolap',
  getAllPublishedPages: async () => [
    { slug: 'inhuvelygyulladas', updatedAt: '2026-08-24T00:00:00.000Z' },
    { slug: 'befagyott-vall', updatedAt: '2026-08-24T00:00:00.000Z' },
    { slug: 'szolgaltatasok', updatedAt: '2026-08-24T00:00:00.000Z' },
  ],
  getPosts: async () => [
    { slug: 'inhuvelygyulladas', updatedAt: '2026-08-24T00:00:00.000Z' },
    { slug: 'befagyott-vall', updatedAt: '2026-08-24T00:00:00.000Z' },
  ],
  getContentCategories: async () => [],
  getPublishedProducts: async () => [],
  getPageBySlug: async (slug: string) => ({
    id: 99,
    slug,
    title: 'Tilos gyökér hub',
    excerpt: null,
    content: null,
    layout: null,
    heroImage: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    status: 'published',
    publishedAt: null,
    order: null,
    updatedAt: '',
    createdAt: '',
  }),
  getLatestPosts: async () => [],
  getTestimonials: async () => [],
}))

const GYOKER = UJ_TUDASTAR_SLUGOK.map((slug) => `/${slug}`)
const CIKK_FAJL: Record<(typeof UJ_TUDASTAR_SLUGOK)[number], string> = {
  inhuvelygyulladas: '7-inhuvelygyulladas.md',
  'befagyott-vall': '8-befagyott-vall.md',
}

const importer = readFileSync(
  path.join(process.cwd(), 'src/scripts/import-tudastar-cikkek.ts'),
  'utf8',
)
const seed = readFileSync(path.join(process.cwd(), 'src/scripts/seed.ts'), 'utf8')
const cmsPageRoute = readFileSync(
  path.join(process.cwd(), 'src/app/(frontend)/[slug]/page.tsx'),
  'utf8',
)

const PAGES_IRAS_FAJLOK = [
  'src/scripts/seed.ts',
  'src/scripts/restore-legacy-content.ts',
  'src/scripts/apply-owner-content.ts',
  'src/lib/home-seed.ts',
  'src/lib/menu-seed.ts',
] as const

describe('a két új cikk csak posts, gyökér hub nélkül', () => {
  it('az importer a két slugot posts-ra írja, pages collectionre nem', () => {
    expect(importer).toContain("slug: 'inhuvelygyulladas'")
    expect(importer).toContain("slug: 'befagyott-vall'")
    expect(importer).toContain("collection: 'posts'")
    expect(importer).not.toMatch(/collection:\s*'pages'/)
    const collections = [...importer.matchAll(/collection:\s*'([^']+)'/g)].map((m) => m[1])
    expect(collections).not.toContain('pages')
    expect(collections).toContain('posts')
  })

  it('a seed nem hoz létre gyökér pages rekordot a két slugra', () => {
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      expect(seed).not.toContain(`slug: '${slug}'`)
      expect(seed).not.toContain(`slug: "${slug}"`)
    }
  })

  it('a pages-író scriptek nem tartalmazzák a két slugot', () => {
    for (const fajl of PAGES_IRAS_FAJLOK) {
      const src = readFileSync(path.join(process.cwd(), fajl), 'utf8')
      for (const slug of UJ_TUDASTAR_SLUGOK) {
        expect(src, fajl).not.toContain(slug)
      }
    }
  })

  it('nincs dedikált App Router útvonal a gyökér slugokra', () => {
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      expect(existsSync(path.join(process.cwd(), 'src/app/(frontend)', slug))).toBe(false)
      expect(existsSync(path.join(process.cwd(), 'src/app', slug))).toBe(false)
    }
  })

  it('LEGACY_REDIRECTS / GONE / sitemap-örökség nem nyúl a gyökér címekhez', () => {
    const sources = LEGACY_REDIRECTS.map((rule) => rule.source)
    const destinations = LEGACY_REDIRECTS.map((rule) => rule.destination)
    const built = buildLegacyRedirects()
    for (const gyoker of GYOKER) {
      expect(sources, gyoker).not.toContain(gyoker)
      expect(destinations, gyoker).not.toContain(gyoker)
      expect(LEGACY_GONE_PATHS, gyoker).not.toContain(gyoker)
      expect(LEGACY_SITEMAP_PATHS, gyoker).not.toContain(gyoker)
      expect(
        built.some((rule) => rule.source === gyoker || rule.destination === gyoker),
        gyoker,
      ).toBe(false)
    }
  })

  it('a CMS catch-all a két slugra notFound()-ot hív, pages rekord előtt', () => {
    expect(cmsPageRoute).toContain('ujTudastarSlug')
    expect(cmsPageRoute).toMatch(/if \(ujTudastarSlug\(slug\)\) notFound\(\)/)
  })

  it('a törzsben nincs Források szakasz', () => {
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      const nyers = readFileSync(path.join(process.cwd(), 'docs/cikkek', CIKK_FAJL[slug]), 'utf8')
      const { lines } = extractArticleBody(nyers)
      const torzs = lines.join('\n')
      expect(torzs, slug).not.toMatch(/^## Források?\s*$/m)
      expect(torzs, slug).not.toContain('Forrásjegyzék')
    }
  })
})

describe('URL-LOCK futásidő: gyökér pages nem 200, sitemapben nincs gyökér', () => {
  it('a catch-all CMS-oldal a két slugra notFound, még ha a pages rekord létezik is', async () => {
    const { default: CmsPage, generateMetadata } = await import('../app/(frontend)/[slug]/page')
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      await expect(CmsPage({ params: Promise.resolve({ slug }) })).rejects.toThrow('NOT_FOUND')
      await expect(generateMetadata({ params: Promise.resolve({ slug }) })).rejects.toThrow(
        'NOT_FOUND',
      )
    }
  })

  it('a sitemap a gyökér pages címet kihagyja, a /blog/<slug> posztot bent tartja', async () => {
    const sitemap = (await import('../app/sitemap')).default
    const urls = (await sitemap()).map((entry) => entry.url)
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      expect(urls).not.toContain(absoluteUrl(`/${slug}`))
      expect(urls).toContain(absoluteUrl(`/blog/${slug}`))
    }
    expect(urls).toContain(absoluteUrl('/szolgaltatasok'))
  })
})
