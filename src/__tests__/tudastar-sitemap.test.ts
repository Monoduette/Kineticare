import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { absoluteUrl } from '../lib/seo'
import { categoriesWithPosts } from '../lib/tudastar'

/**
 * ŐR — sitemap.xml teljessége és tisztasága.
 *
 * Mit véd. A sitemap hibái CSENDESEK: nincs futásidejű hiba, csak hetekre
 * eltűnik (vagy be sem kerül) egy lap a találatok közé. Élesben mérve a
 * sitemap 11 URL-t adott, benne NULLA blogposzttal és NULLA kategóriával
 * (docs/informacios-architektura.md 6.2). Ez a teszt azt rögzíti, hogy
 *  - MINDEN nyilvános lap bekerül (jogi lapok, posztok, kurzusok),
 *  - és csak KANONIKUS, indexelendő cím kerül be (nincs átirányított cím,
 *    nincs üres kategória-lap).
 *
 * Forrás a szabályhoz: „Include the URLs in your sitemap that you want to see
 * in Google's search results… If you have the same content accessible under
 * different URLs, choose the URL you prefer and include that in the sitemap"
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
 *
 * A CMS-réteg mockolt: a teszt az URL-építés SZABÁLYAIT ellenőrzi, nem az
 * adatbázist.
 */

vi.mock('@/lib/cms', () => ({
  HOME_PAGE_SLUG: 'kezdolap',
  getAllPublishedPages: () =>
    Promise.resolve([
      // A kezdőlap külön, a `/` címen él — nem lehet `/kezdolap` a sitemapben.
      { slug: 'kezdolap', updatedAt: '2026-08-01T10:00:00.000Z' },
      { slug: 'szolgaltatasok', updatedAt: '2026-08-02T10:00:00.000Z' },
      { slug: 'rolunk', updatedAt: '2026-08-03T10:00:00.000Z' },
      { slug: 'aszf', updatedAt: '2026-08-04T10:00:00.000Z' },
      { slug: 'adatvedelem', updatedAt: '2026-08-05T10:00:00.000Z' },
      { slug: 'impresszum', updatedAt: '2026-08-06T10:00:00.000Z' },
      // Ütköző slug: a valódi `/kapcsolat` route elfedi ezt a CMS-oldalt.
      { slug: 'kapcsolat', updatedAt: '2026-08-07T10:00:00.000Z' },
    ]),
  getSitemapPosts: () =>
    Promise.resolve([
      {
        id: 11,
        slug: 'gipsz-utan-mit-csinalj',
        updatedAt: '2026-08-10T10:00:00.000Z',
        categories: [{ id: 1, slug: 'kezrehabilitacio', title: 'Kézrehabilitáció' }],
      },
    ]),
  getContentCategories: () =>
    Promise.resolve([
      { id: 1, slug: 'kezrehabilitacio', title: 'Kézrehabilitáció' },
      // ÜRES kategória: egyetlen poszt sem tartozik hozzá.
      { id: 2, slug: 'ures-tema', title: 'Üres téma' },
    ]),
  getSitemapProducts: () =>
    Promise.resolve([
      { id: 2, slug: 'sos-kezrelax-villamkurzus', updatedAt: '2026-08-11T10:00:00.000Z' },
      // Slug nélküli, régi kurzus: marad az id-alapú (kanonikus) cím.
      { id: 9, slug: null, updatedAt: '2026-08-12T10:00:00.000Z' },
    ]),
}))

import sitemap from '../app/sitemap'
import robots from '../app/robots'

const urls = async (): Promise<string[]> => (await sitemap()).map((entry) => entry.url)

describe('a generátorok HELYE (CLAUDE.md 11. üzemeltetési tanulság)', () => {
  const van = (relativ: string): boolean =>
    existsSync(fileURLToPath(new URL(relativ, import.meta.url)))

  it('a robots.ts és a sitemap.ts a GYÖKÉR src/app/ mappában él', () => {
    // A `(frontend)` route-groupból a robots.ts NÉMÁN kimarad a buildből —
    // ez élesben már megtörtént. A fájl elmozdítása ezért hangosan bukjon.
    expect(van('../app/robots.ts')).toBe(true)
    expect(van('../app/sitemap.ts')).toBe(true)
  })

  it('nincs párhuzamos példány a (frontend) route-groupban', () => {
    expect(van('../app/(frontend)/robots.ts')).toBe(false)
    expect(van('../app/(frontend)/sitemap.ts')).toBe(false)
  })
})

describe('sitemap — minden nyilvános lap benne van', () => {
  it('a négy állandó útvonal', async () => {
    const list = await urls()
    for (const path of ['/', '/kurzusok', '/blog', '/kapcsolat']) {
      expect(list).toContain(absoluteUrl(path))
    }
  })

  it('a JOGI lapok is (ezek CMS-oldalak, nem külön route-ok)', async () => {
    const list = await urls()
    for (const path of ['/aszf', '/adatvedelem', '/impresszum']) {
      expect(list).toContain(absoluteUrl(path))
    }
  })

  it('a tartalmi CMS-lapok (szolgáltatások, rólunk)', async () => {
    const list = await urls()
    expect(list).toContain(absoluteUrl('/szolgaltatasok'))
    expect(list).toContain(absoluteUrl('/rolunk'))
  })

  it('a blogposztok', async () => {
    expect(await urls()).toContain(absoluteUrl('/blog/gipsz-utan-mit-csinalj'))
  })

  it('a kurzusok a beszédes, KANONIKUS címükön', async () => {
    const list = await urls()
    expect(list).toContain(absoluteUrl('/kurzusok/sos-kezrelax-villamkurzus'))
    // A régi, id-alapú cím 308-cal átirányít — sitemapbe nem való.
    expect(list).not.toContain(absoluteUrl('/kurzusok/2'))
    // Slug nélküli kurzusnál viszont az id-s cím MAGA a kanonikus.
    expect(list).toContain(absoluteUrl('/kurzusok/9'))
  })
})

describe('sitemap — ami szándékosan kimarad', () => {
  it('a kezdőlap CMS-slugja (/kezdolap) nem duplikálja a `/` címet', async () => {
    expect(await urls()).not.toContain(absoluteUrl('/kezdolap'))
  })

  it('az ÜRES kategória-lap nem kerül be (soft 404 lenne)', async () => {
    const list = await urls()
    expect(list).toContain(absoluteUrl('/blog/kategoria/kezrehabilitacio'))
    expect(list).not.toContain(absoluteUrl('/blog/kategoria/ures-tema'))
  })

  it('tranzakciós és bejelentkezés mögötti útvonal nincs benne', async () => {
    const list = await urls()
    for (const path of [
      '/kosar',
      '/penztar',
      '/belepes',
      '/regisztracio',
      '/fiok',
      '/kurzusaim',
      '/sikertelen',
      '/admin',
    ]) {
      expect(list).not.toContain(absoluteUrl(path))
    }
  })

  it('a statikus útvonallal ÜTKÖZŐ CMS-slug nem duplikálja a címet', async () => {
    // A `/kapcsolat` valódi route; egy azonos slugú CMS-oldal a sitemapben
    // ugyanarra a címre adna egy második sort.
    const list = await urls()
    expect(list.filter((url) => url === absoluteUrl('/kapcsolat'))).toHaveLength(1)
  })

  it('minden bejegyzés abszolút URL, és egyik sem szerepel kétszer', async () => {
    const list = await urls()
    for (const url of list) {
      expect(url).toMatch(/^https?:\/\//)
    }
    expect(new Set(list).size).toBe(list.length)
  })
})

describe('categoriesWithPosts — a szűrés szabálya', () => {
  const categories = [
    { id: 1, slug: 'a' },
    { id: 2, slug: 'b' },
    { id: 3, slug: '' },
  ]

  it('csak azt a kategóriát tartja meg, amelyhez van poszt', () => {
    expect(categoriesWithPosts(categories, [{ categories: [{ id: 1 } as never] }])).toEqual([
      { id: 1, slug: 'a' },
    ])
  })

  it('a nyers id-s (nem populate-olt) hivatkozást is érti', () => {
    expect(categoriesWithPosts(categories, [{ categories: [2] }])).toEqual([{ id: 2, slug: 'b' }])
  })

  it('poszt nélkül üres a lista', () => {
    expect(categoriesWithPosts(categories, [])).toEqual([])
  })

  it('a slug nélküli kategória sosem kerül be (értelmezhetetlen cím lenne)', () => {
    expect(categoriesWithPosts(categories, [{ categories: [3] }])).toEqual([])
  })
})

describe('robots.txt — a Tudástár bejárható marad', () => {
  const result = robots()
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  const disallowOf = (rule: (typeof rules)[number]): string[] => {
    const value = rule.disallow
    return Array.isArray(value) ? value : value ? [value] : []
  }

  it('a /blog és a kategória-oldalak NINCSENEK tiltva', () => {
    // Robots-tiltás esetén a Google az ÜRES kategória-lap `noindex` jelzését
    // sem látná meg — a kettő együtt nem működik.
    for (const rule of rules) {
      const list = disallowOf(rule)
      expect(list).not.toContain('/blog')
      expect(list).not.toContain('/blog/')
      expect(list).not.toContain('/blog/kategoria/')
    }
  })

  it('az analitikai proxy (/ingest/) tiltva van — nem a mi tartalmunk', () => {
    for (const rule of rules) {
      expect(disallowOf(rule)).toContain('/ingest/')
    }
  })

  it('a sitemap-hivatkozás abszolút és a helyes címre mutat', () => {
    expect(String(result.sitemap)).toBe(absoluteUrl('/sitemap.xml'))
  })
})
