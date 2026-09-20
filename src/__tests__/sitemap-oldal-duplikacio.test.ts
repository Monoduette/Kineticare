import { describe, expect, it, vi } from 'vitest'

import { absoluteUrl } from '../lib/seo'

/**
 * sitemap.xml — a CMS-oldalak nem duplikálhatják a STATIKUS útvonalakat.
 *
 * MIÉRT KELL: a /kapcsolat dedikált route, de a szekciósorát egy azonos slugú
 * CMS-oldal hordozza (lásd src/app/(frontend)/kapcsolat/page.tsx). Az oldal
 * publikált, tehát a `getAllPublishedPages` visszaadja — dedup nélkül a
 * /kapcsolat cím KÉTSZER kerülne a sitemapbe, ami a keresőnek duplikált URL.
 *
 * A kezdőlap kivétele (HOME_PAGE_SLUG) korábbról is védett; itt az általános
 * szabályt rögzítjük: ami a statikus listában szerepel, azt a CMS-kör nem
 * ismételheti meg.
 *
 * A CMS-réteg mockolt: a teszt az URL-építést ellenőrzi, nem az adatbázist.
 */

vi.mock('@/lib/cms', () => ({
  HOME_PAGE_SLUG: 'kezdolap',
  getAllPublishedPages: () =>
    Promise.resolve([
      { id: 1, slug: 'kezdolap', updatedAt: '2026-02-01T10:00:00.000Z' },
      { id: 2, slug: 'kapcsolat', updatedAt: '2026-02-01T10:00:00.000Z' },
      { id: 3, slug: 'szolgaltatasok', updatedAt: '2026-02-01T10:00:00.000Z' },
      {
        id: 16,
        slug: 'akcios-kurzus',
        title: 'Képzeletbeli akciós kurzus',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
    ]),
  getSitemapPosts: () => Promise.resolve([]),
  getContentCategories: () => Promise.resolve([]),
  getSitemapProducts: () => Promise.resolve([]),
}))

import sitemap from '../app/sitemap'

describe('sitemap — statikus útvonal és CMS-oldal nem duplikálódik', () => {
  it('a /kapcsolat PONTOSAN egyszer szerepel', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls.filter((url) => url === absoluteUrl('/kapcsolat'))).toHaveLength(1)
  })

  it('a kezdőlap CMS-oldala továbbra sem kap külön /kezdolap címet', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).not.toContain(absoluteUrl('/kezdolap'))
    expect(urls).toContain(absoluteUrl('/'))
  })

  it('az örökölt demólap (akcios-kurzus) közzétéve sem kerül a sitemapbe (legacy-noindex)', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).not.toContain(absoluteUrl('/akcios-kurzus'))
  })

  it('a saját route nélküli CMS-oldal változatlanul bekerül', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).toContain(absoluteUrl('/szolgaltatasok'))
  })
})
