import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ŐR — a Tudástár kategória-oldalának META-viselkedése.
 *
 * Két csendes hibát fog meg:
 *  1. az ÜRES témalap indexelhetővé válik (tartalom nélküli, „soft 404" lap
 *     kerül a találatok közé),
 *  2. a canonical elcsúszik a dedikált címről.
 *
 * Egyik sem ad futásidejű hibát: a lap 200-zal válaszol, minden „működik".
 */

// A lap 2026-09-08 (WP35) óta a TELJES listát kéri le, és a téma cikkeit a
// `categories` mező alapján maga szűri: a fixtúra ezért hordozza a
// kategória-id-t (1 = kezrehabilitacio).
const posts = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }))

// Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): alapból bekapcsolt, a
// fájl végi blokk kapcsolja ki.
const kapcsolo = vi.hoisted(() => ({ lathato: true }))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => kapcsolo.lathato }))

vi.mock('@/lib/cms', () => ({
  getCategoryBySlug: (slug: string) =>
    Promise.resolve(
      slug === 'kezrehabilitacio'
        ? { id: 1, slug: 'kezrehabilitacio', title: 'Kézrehabilitáció' }
        : null,
    ),
  getPosts: () => Promise.resolve(posts.current),
  getContentCategories: () => Promise.resolve([]),
  getPublishedProducts: () => Promise.resolve([]),
}))

import { generateMetadata } from '../app/(frontend)/blog/kategoria/[slug]/page'
import { generateMetadata as listMetadata } from '../app/(frontend)/blog/page'

const meta = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) })

describe('kategória-oldal metaadata', () => {
  it('ÜRES témánál noindex, de a linkek bejárhatók maradnak (follow)', async () => {
    posts.current = []
    const result = await meta('kezrehabilitacio')
    expect(result.robots).toEqual({ index: false, follow: true })
  })

  it('cikkekkel a lap NORMÁLISAN indexelhető (nincs robots-korlát)', async () => {
    posts.current = [{ id: 11, slug: 'gipsz-utan', categories: [1] }]
    const result = await meta('kezrehabilitacio')
    expect(result.robots).toBeUndefined()
  })

  it('a canonical a dedikált kategória-cím', async () => {
    posts.current = [{ id: 11, slug: 'gipsz-utan', categories: [1] }]
    const result = await meta('kezrehabilitacio')
    expect(result.alternates?.canonical).toBe('/blog/kategoria/kezrehabilitacio')
  })

  it('a cím magyar és kvirtmínusz nélküli', async () => {
    posts.current = []
    const result = await meta('kezrehabilitacio')
    expect(result.title).toBe('Kézrehabilitáció a Tudástárban')
    expect(String(result.title)).not.toContain('—')
  })

  it('ismeretlen témára üres metaadat jön (a lap 404-et ad)', async () => {
    expect(await meta('nincs-ilyen-tema')).toEqual({})
  })
})

describe('bloglista metaadata — a duplikált cím kanonizálása', () => {
  const listaMeta = (kategoria?: string) =>
    listMetadata({ searchParams: Promise.resolve(kategoria === undefined ? {} : { kategoria }) })

  it('szűretlen listán a canonical a /blog', async () => {
    expect((await listaMeta()).alternates?.canonical).toBe('/blog')
  })

  it('a `?kategoria=` szűrés a DEDIKÁLT kategória-címre kanonizál', async () => {
    // Ugyanaz a tartalom két címen: a kereső a preferált címet kapja meg.
    expect((await listaMeta('kezrehabilitacio')).alternates?.canonical).toBe(
      '/blog/kategoria/kezrehabilitacio',
    )
  })

  it('ismeretlen kategória-értéknél a canonical a szűretlen lista', async () => {
    expect((await listaMeta('nincs-ilyen-tema')).alternates?.canonical).toBe('/blog')
  })
})

describe('Tudástár-kapcsoló: kikapcsolva a lista és a téma-lap noindex, follow', () => {
  afterEach(() => {
    kapcsolo.lathato = true
  })
  const NOINDEX_FOLLOW = { index: false, follow: true, googleBot: { index: false, follow: true } }

  it('a /blog lista noindex, follow, a canonical marad', async () => {
    kapcsolo.lathato = false
    const result = await listMetadata({ searchParams: Promise.resolve({}) })
    expect(result.robots).toEqual(NOINDEX_FOLLOW)
    expect(result.alternates?.canonical).toBe('/blog')
  })

  it('a cikkekkel teli téma-lap is noindex, follow', async () => {
    kapcsolo.lathato = false
    posts.current = [{ id: 11, slug: 'gipsz-utan', categories: [1] }]
    const result = await meta('kezrehabilitacio')
    expect(result.robots).toEqual(NOINDEX_FOLLOW)
    expect(result.alternates?.canonical).toBe('/blog/kategoria/kezrehabilitacio')
  })

  it('bekapcsolva a lista robots-a változatlan (a keret indexelhető alapja)', async () => {
    expect((await listMetadata({ searchParams: Promise.resolve({}) })).robots).toBeUndefined()
  })
})
