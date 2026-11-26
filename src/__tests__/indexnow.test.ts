import type { CollectionAfterChangeHook } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET as keyFileGet } from '../app/indexnow-key.txt/route'
import { Pages } from '../collections/Pages'
import { Posts } from '../collections/Posts'
import { indexNowAfterChange } from '../lib/indexnow'
import { absoluteUrl } from '../lib/seo'

/**
 * IndexNow (src/lib/indexnow.ts): közzétételkor a saját sitemapből a friss
 * címek egyetlen kérésben mennek az IndexNow-végpontra. Tesztből valódi
 * hálózati hívás nem mehet ki (CLAUDE.md 15.): a `fetch` stubolt.
 */

const DUMMY_KEY = 'DUMMY-indexnow-key-0001'
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const PUBLISHED_AT = new Date('2026-11-26T18:00:00.000Z')

function hookArgs(doc: Record<string, unknown>): Parameters<CollectionAfterChangeHook>[0] {
  return { doc } as unknown as Parameters<CollectionAfterChangeHook>[0]
}

function sitemapXml(entries: ReadonlyArray<{ loc: string; lastmod?: string }>): string {
  const urls = entries
    .map(
      (entry) =>
        `<url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  // A modul függő időzítője ne lógjon át a következő tesztbe.
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('IndexNow beküldés közzétételkor', () => {
  it('az ablakon belüli közzétételeket egyetlen kérésben küldi be, csak a friss, saját hostú címekkel', async () => {
    vi.stubEnv('INDEXNOW_KEY', DUMMY_KEY)
    const home = absoluteUrl('/')
    const courses = absoluteUrl('/kurzusok')
    const course = absoluteUrl('/kurzusok/otthoni-kezrehab-program')
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === absoluteUrl('/sitemap.xml')) {
        return new Response(
          sitemapXml([
            { loc: home, lastmod: PUBLISHED_AT.toISOString() },
            { loc: courses, lastmod: new Date(PUBLISHED_AT.getTime() + 2_000).toISOString() },
            { loc: course, lastmod: new Date(PUBLISHED_AT.getTime() + 2_000).toISOString() },
            // Régi módosítás: nem friss.
            { loc: absoluteUrl('/aszf'), lastmod: '2026-10-01T10:00:00.000Z' },
            // lastmod nélküli (pl. kategórialap): nem tudjuk, változott-e.
            { loc: absoluteUrl('/blog/kategoria/kez') },
            // Idegen host: a kulcsunkkal nem küldhető.
            { loc: 'https://pelda.invalid/', lastmod: PUBLISHED_AT.toISOString() },
          ]),
          { status: 200 },
        )
      }
      return new Response(null, { status: 202 })
    })

    // Oldal-, majd kurzus-közzététel 2 mp különbséggel: egy szerkesztési hullám.
    indexNowAfterChange(hookArgs({ _status: 'published', updatedAt: PUBLISHED_AT.toISOString() }))
    await vi.advanceTimersByTimeAsync(2_000)
    indexNowAfterChange(
      hookArgs({
        _status: 'published',
        updatedAt: new Date(PUBLISHED_AT.getTime() + 2_000).toISOString(),
      }),
    )
    // A commit előtt (az afterChange még a tranzakción belül fut) semmi sem mehet ki.
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const [postInput, postInit] = fetchMock.mock.calls[1] ?? []
    expect(String(postInput)).toBe(ENDPOINT)
    expect(postInit?.method).toBe('POST')
    expect(JSON.parse(String(postInit?.body))).toEqual({
      host: new URL(home).host,
      key: DUMMY_KEY,
      keyLocation: absoluteUrl('/indexnow-key.txt'),
      urlList: [new URL(home).toString(), courses, course],
    })
  })

  it.each([
    {
      name: 'piszkozat (autosave) mentés kulccsal',
      key: DUMMY_KEY,
      doc: { _status: 'draft', updatedAt: PUBLISHED_AT.toISOString() },
    },
    {
      name: 'közzététel kulcs nélkül',
      key: '',
      doc: { _status: 'published', updatedAt: PUBLISHED_AT.toISOString() },
    },
    {
      name: 'közzététel formailag hibás kulccsal',
      key: 'rossz kulcs!',
      doc: { _status: 'published', updatedAt: PUBLISHED_AT.toISOString() },
    },
  ])('$name: nincs hálózati hívás', async ({ key, doc }) => {
    vi.stubEnv('INDEXNOW_KEY', key)
    fetchMock.mockRejectedValue(new Error('ide nem szabad hálózati hívásnak futnia'))

    indexNowAfterChange(hookArgs(doc))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a sitemap olvasási hibája nem dob kezeletlen hibát, és nem küld be semmit', async () => {
    // Egy kezeletlen elutasítás a hook késleltetett ágán uncaughtException-ként
    // vinné el a szerverfolyamatot; a vitest is elbuktatná a futást.
    vi.stubEnv('INDEXNOW_KEY', DUMMY_KEY)
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))

    indexNowAfterChange(hookArgs({ _status: 'published', updatedAt: PUBLISHED_AT.toISOString() }))
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(absoluteUrl('/sitemap.xml'))
  })
})

describe('/indexnow-key.txt kulcsfájl', () => {
  it('kulccsal a kulcsot adja vissza szövegként', async () => {
    vi.stubEnv('INDEXNOW_KEY', DUMMY_KEY)

    const response = keyFileGet()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toBe(DUMMY_KEY)
  })

  it('kulcs nélkül 404, és a válasz nem tartalmaz kulcsot', async () => {
    vi.stubEnv('INDEXNOW_KEY', '')

    const response = keyFileGet()

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(DUMMY_KEY)
  })
})

describe('regisztráció', () => {
  // A kurzusokét a product-menu-cache-invalidation teszt őrzi (ecommerce-override).
  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ])('a(z) %s közzététele IndexNow-jelzést indít', (_, collection) => {
    expect(collection.hooks?.afterChange).toContain(indexNowAfterChange)
  })
})
