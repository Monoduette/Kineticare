import { describe, expect, it, vi } from 'vitest'

import { absoluteUrl, DEFAULT_OG_IMAGE, NOINDEX_ROBOTS } from '../lib/seo'

/**
 * Őr: a sitemap, a robots.txt, a noindex-lapok és a manifest egymással
 * konzisztensek.
 * - A sitemap CSAK indexelhető, kanonikus URL-t tartalmaz: a robots.txt-ben
 *   tiltott és a `NOINDEX_ROBOTS`-os lapok egyike sincs benne (Google *Build
 *   and submit a sitemap*:
 *   https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
 * - `lastModified` a statikus utakon a mögöttes CMS-tartalom valós dátuma.
 * - A kurzus borítóképe képbejegyzésként megy ki (Image sitemaps).
 * - A manifest a W3C Web App Manifest mezőit adja a meglévő ikonokkal
 *   (https://www.w3.org/TR/appmanifest/).
 */

vi.mock('@/lib/cms', () => ({
  HOME_PAGE_SLUG: 'kezdolap',
  getAllPublishedPages: () =>
    Promise.resolve([
      { slug: 'kezdolap', updatedAt: '2026-08-01T10:00:00.000Z' },
      { slug: 'kapcsolat', updatedAt: '2026-08-07T10:00:00.000Z' },
      { slug: 'rolunk', updatedAt: '2026-08-03T10:00:00.000Z' },
      { slug: 'aszf', updatedAt: '2026-08-04T10:00:00.000Z' },
      { slug: 'adatvedelem', updatedAt: '2026-08-05T10:00:00.000Z' },
      { slug: 'impresszum', updatedAt: '2026-08-06T10:00:00.000Z' },
    ]),
  getSitemapPosts: () =>
    Promise.resolve([
      { id: 11, slug: 'cikk-egy', updatedAt: '2026-08-10T10:00:00.000Z', categories: [] },
      { id: 12, slug: 'cikk-ketto', updatedAt: '2026-08-20T10:00:00.000Z', categories: [] },
    ]),
  getContentCategories: () => Promise.resolve([]),
  getSitemapProducts: () =>
    Promise.resolve([
      {
        id: 7,
        slug: 'otthoni-kezrehab-program',
        updatedAt: '2026-08-15T10:00:00.000Z',
        coverImage: { id: 3, alt: 'Borító', url: '/media/borito.webp' },
      },
      {
        id: 8,
        slug: 'sos-kezrelax-villamkurzus',
        updatedAt: '2026-08-12T10:00:00.000Z',
        coverImage: 4,
      },
    ]),
}))

import manifest from '../app/manifest'
import robots from '../app/robots'
import sitemap from '../app/sitemap'

/** Sitemapból kimaradó utak: a noindex-lapok ÉS a vékony, de indexelhető belépés/regisztráció. */
const PRIVATE_PATHS = [
  '/belepes',
  '/regisztracio',
  '/belepes-atallas',
  '/elfelejtett-jelszo',
  '/jelszo-visszaallitas',
  '/kosar',
  '/penztar',
  '/fiok',
  '/kurzusaim',
  '/sikertelen',
  '/fizetes/koszonom',
  '/belepes-atallas',
  '/admin',
]

describe('sitemap — csak indexelhető, kanonikus URL', () => {
  it('egyetlen noindex / tiltott út sincs benne', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    for (const path of PRIVATE_PATHS) {
      expect(
        urls.some((url) => url.startsWith(absoluteUrl(path))),
        path,
      ).toBe(false)
    }
  })

  it('a robots.txt a belépést és a regisztrációt NEM tiltja, a fizetős lejátszót igen (tulajdonosi döntés)', () => {
    const rules = robots().rules
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
    )
    expect(disallowed).not.toContain('/belepes')
    expect(disallowed).not.toContain('/regisztracio')
    for (const path of [
      '/kurzusaim',
      '/fiok',
      '/kosar',
      '/penztar',
      '/fizetes/',
      '/sikertelen',
      '/jelszo-visszaallitas',
      '/elfelejtett-jelszo',
      '/belepes-atallas',
      '/admin',
      '/api/',
      '/next/',
      '/ingest/',
    ]) {
      expect(disallowed, path).toContain(path)
    }
  })

  it('a robots.txt tiltó listája és a sitemap diszjunkt', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    const rules = robots().rules
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
    )
    for (const prefix of disallowed) {
      expect(
        urls.some((url) => url.startsWith(absoluteUrl(prefix))),
        prefix,
      ).toBe(false)
    }
    expect(robots().sitemap).toBe(absoluteUrl('/sitemap.xml'))
  })

  it('a statikus utak lastModified-ja a mögöttes CMS-tartalom dátuma', async () => {
    const entries = await sitemap()
    const byUrl = new Map(entries.map((entry) => [entry.url, entry]))
    expect(byUrl.get(absoluteUrl('/'))?.lastModified).toEqual(new Date('2026-08-01T10:00:00.000Z'))
    expect(byUrl.get(absoluteUrl('/kapcsolat'))?.lastModified).toEqual(
      new Date('2026-08-07T10:00:00.000Z'),
    )
    expect(byUrl.get(absoluteUrl('/kurzusok'))?.lastModified).toEqual(
      new Date('2026-08-15T10:00:00.000Z'),
    )
    expect(byUrl.get(absoluteUrl('/blog'))?.lastModified).toEqual(
      new Date('2026-08-20T10:00:00.000Z'),
    )
  })

  it('a kurzus borítóképe képbejegyzés; populálatlan (id) képnél nincs images', async () => {
    const entries = await sitemap()
    const otthoni = entries.find(
      (entry) => entry.url === absoluteUrl('/kurzusok/otthoni-kezrehab-program'),
    )
    const sos = entries.find(
      (entry) => entry.url === absoluteUrl('/kurzusok/sos-kezrelax-villamkurzus'),
    )
    expect(otthoni?.images).toEqual([absoluteUrl('/media/borito.webp')])
    expect(sos?.images).toBeUndefined()
  })

  it('minden URL abszolút, egyedi, és nincs benne lekérdezés vagy horgony', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
    for (const url of urls) {
      expect(url).toMatch(/^https?:\/\//)
      expect(url).not.toMatch(/[?#]/)
    }
  })
})

describe('noindex robots-meta', () => {
  it('index false, de follow true (a fejléc/lábléc nyilvános linkjei bejárhatók)', () => {
    expect(NOINDEX_ROBOTS).toEqual({
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    })
  })
})

describe('manifest.webmanifest', () => {
  const data = manifest()

  it('név, rövid név, nyelv, start_url, színek a tokenekből', () => {
    expect(data.name).toContain('Kineticare')
    expect(data.short_name).toBe('Kineticare')
    expect(data.lang).toBe('hu')
    expect(data.start_url).toBe('/')
    expect(data.theme_color).toBe('#f6f9fc')
    expect(data.background_color).toBe('#f6f9fc')
    expect(typeof data.description).toBe('string')
  })

  it('ikonok CSAK a meglévő fájlokból (icon.svg, apple-icon.png)', () => {
    expect(data.icons?.map((icon) => icon.src)).toEqual(['/icon.svg', '/apple-icon.png'])
  })

  it('az alap megosztási kép útja és a manifest route létezik a gyökér app-mappában', async () => {
    const { existsSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    expect(existsSync(fileURLToPath(new URL('../app/opengraph-image.tsx', import.meta.url)))).toBe(
      true,
    )
    expect(existsSync(fileURLToPath(new URL('../app/manifest.ts', import.meta.url)))).toBe(true)
    expect(existsSync(fileURLToPath(new URL('../app/llms.txt/route.ts', import.meta.url)))).toBe(
      true,
    )
    expect(
      existsSync(fileURLToPath(new URL('../app/llms-full.txt/route.ts', import.meta.url))),
    ).toBe(true)
    expect(DEFAULT_OG_IMAGE.url).toBe(absoluteUrl('/opengraph-image'))
  })
})
