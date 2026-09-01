import { describe, expect, it, vi } from 'vitest'

import { absoluteUrl } from '../lib/seo'

/**
 * sitemap.xml — a kurzus-URL-ek (C3).
 *
 * A sitemapbe KIZÁRÓLAG kanonikus cím kerülhet: ha a régi, id-alapú URL
 * maradna benne, minden kurzussor egy 301-es átirányításra mutatna, és a
 * kereső a saját sitemapünkből tanulná meg a rossz címet.
 *
 * A CMS-réteg mockolt: a teszt az URL-építést ellenőrzi, nem az adatbázist.
 */

vi.mock('@/lib/cms', () => ({
  HOME_PAGE_SLUG: 'kezdolap',
  getAllPublishedPages: () => Promise.resolve([]),
  getSitemapPosts: () => Promise.resolve([]),
  getContentCategories: () => Promise.resolve([]),
  getSitemapProducts: () =>
    Promise.resolve([
      { id: 7, slug: 'kezrehabilitacio-otthon', updatedAt: '2026-02-01T10:00:00.000Z' },
      // Slug nélküli, régi kurzus: marad az id-alapú cím.
      { id: 9, slug: null, updatedAt: '2026-02-02T10:00:00.000Z' },
    ]),
}))

import sitemap from '../app/sitemap'

describe('sitemap kurzus-bejegyzések', () => {
  it('a slugos, kanonikus URL kerül be — nem a régi id-alapú', async () => {
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)

    expect(urls).toContain(absoluteUrl('/kurzusok/kezrehabilitacio-otthon'))
    expect(urls).not.toContain(absoluteUrl('/kurzusok/7'))
  })

  it('slug nélküli kurzusnál az id-alapú cím marad (az sem átirányított)', async () => {
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)

    expect(urls).toContain(absoluteUrl('/kurzusok/9'))
  })

  it('a kurzuslista statikus útvonala változatlanul benne van', async () => {
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)

    expect(urls).toContain(absoluteUrl('/kurzusok'))
  })
})
