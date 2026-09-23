import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A fejléc „Szerkesztő nézet” belépője (modul-térkép A3, 2. fázis).
 *
 * 1. Útvonal → (collection, slug) leképezés: tiszta függvény, a `/next/preview`
 *    route leképezésének oda-vissza ellenőrzött fordítottja; a kódbeli
 *    útvonalak listáját a teszt a src/app/(frontend) könyvtáraival veti össze.
 * 2. A fejléc a MÁR meglévő `payload.auth` hívásból dönt (header-user.ts):
 *    anonim látogató és vásárló (customer) NEM kap belépőt, staff és owner igen,
 *    piszkozat-előnézetben senki. Új hitelesítési hívás nincs (1 hívás/kérés).
 */

const h = vi.hoisted(() => ({
  user: null as { id: number; role: string } | null,
  draft: false,
  pathname: '/rolunk',
  authHivasok: 0,
  draftHivasok: 0,
}))

vi.mock('payload', () => ({
  getPayload: async () => ({
    auth: async () => {
      h.authHivasok += 1
      return { user: h.user }
    },
  }),
}))
vi.mock('@/payload.config', () => ({ default: {} }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  draftMode: async () => {
    h.draftHivasok += 1
    return { isEnabled: h.draft }
  },
}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => h.pathname,
}))
vi.mock('@/lib/menus', () => ({ getNavTree: async () => [] }))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  h.user = null
  h.draft = false
  h.pathname = '/rolunk'
  h.authHivasok = 0
  h.draftHivasok = 0
})

const {
  CMS_KODBELI_UTVONALAK,
  ELONEZET_UTVONAL,
  KODBELI_UTVONALAK,
  szerkesztoNezetCel,
  szerkesztoNezetHref,
} = await import('../components/editor/frontend/szerkeszto-nezet-cel')
const { PREVIEW_PATH, previewTargetPath } = await import('../lib/preview/preview-target')
const { SZERKESZTO_NEZET_FELIRAT, SzerkesztoNezetBelepo } =
  await import('../components/editor/frontend/SzerkesztoNezetBelepo')
const { getHeaderAuthState } = await import('../components/layout/header-user')
const { Header } = await import('../components/layout/Header')

// ---------------------------------------------------------------------------
// 1. Útvonal-leképezés
// ---------------------------------------------------------------------------

describe('szerkesztoNezetCel: útvonal → előnézeti cél', () => {
  it.each([
    ['/', { collection: 'pages', slug: 'kezdolap' }],
    ['/rolunk', { collection: 'pages', slug: 'rolunk' }],
    ['/rolunk/', { collection: 'pages', slug: 'rolunk' }],
    ['/szolgaltatasok', { collection: 'pages', slug: 'szolgaltatasok' }],
    ['/kapcsolat', { collection: 'pages', slug: 'kapcsolat' }],
    // H11 (A7): a /szakembereknek a „szakembereknek” Oldalak-rekordból renderel,
    // piszkozat-előnézettel, ezért a belépő ott is megjelenik.
    ['/szakembereknek', { collection: 'pages', slug: 'szakembereknek' }],
    ['/keztoalagut-szindroma', { collection: 'pages', slug: 'keztoalagut-szindroma' }],
    ['/blog/gipszben-a-kezed', { collection: 'posts', slug: 'gipszben-a-kezed' }],
    [
      '/kurzusok/otthoni-kezrehab-program',
      { collection: 'products', slug: 'otthoni-kezrehab-program' },
    ],
    ['/rolunk?x=1#szakmai-hatter', { collection: 'pages', slug: 'rolunk' }],
  ])('%s → %o', (pathname, cel) => {
    expect(szerkesztoNezetCel(pathname)).toEqual(cel)
  })

  it.each([
    '/kezdolap',
    '/blog',
    '/blog/kategoria',
    '/blog/kategoria/kez',
    '/kurzusok',
    '/kurzusok/123',
    '/kurzusok/Nagybetus',
    '/kurzusaim',
    '/kurzusaim/5',
    '/fiok',
    '/belepes',
    '/penztar',
    '/next/preview',
    '/rolunk/valami',
    '/a%2Fb',
    '/%E0%A4%A',
    '//evil.example',
    '',
    'rolunk',
  ])('%s → nincs belépő', (pathname) => {
    expect(szerkesztoNezetCel(pathname)).toBeNull()
  })

  it('a cél a /next/preview route paraméterei', () => {
    expect(szerkesztoNezetHref({ collection: 'pages', slug: 'kezdolap' })).toBe(
      '/next/preview?collection=pages&slug=kezdolap',
    )
    expect(szerkesztoNezetHref({ collection: 'posts', slug: 'gipszben-a-kezed' })).toBe(
      '/next/preview?collection=posts&slug=gipszben-a-kezed',
    )
  })

  it('oda-vissza: a cél a /next/preview route-on PONTOSAN ugyanerre az útvonalra irányít vissza', () => {
    expect(ELONEZET_UTVONAL).toBe(PREVIEW_PATH)
    const jeloltek = [
      '/',
      '/kezdolap',
      '/rolunk',
      '/rolunk/',
      '/szakembereknek',
      '/ árlista',
      '/%20rolunk',
      '/%3Arolunk',
      '/a%5Cb',
      '/a%09b',
      '/a%7Fb',
      '/%C2%85',
      '/%C3%A1rlista',
      '/blog/%20cikk',
      '/blog/cikk',
      '/blog/%C3%A9kezet',
      '/kurzusok/sos-kezrelax-villamkurzus',
      '/kurzusok/-rossz',
      '/kurzusok/42',
      '/kurzusok/%C3%A1',
    ]
    for (const ut of jeloltek) {
      const cel = szerkesztoNezetCel(ut)
      const normalizalt =
        ut.replace(/\/+$/, '') === ''
          ? '/'
          : `/${ut
              .replace(/\/+$/, '')
              .split('/')
              .slice(1)
              .map((resz) => decodeURIComponent(resz))
              .join('/')}`
      if (cel !== null) {
        expect(previewTargetPath(cel.collection, cel.slug), ut).toBe(normalizalt)
      }
    }
    expect(szerkesztoNezetCel('/%C3%A1rlista')).toEqual({ collection: 'pages', slug: 'árlista' })
    expect(szerkesztoNezetCel('/%C2%85')).toEqual({ collection: 'pages', slug: '\u0085' })
    expect(szerkesztoNezetCel('/a%7Fb')).toBeNull()
    expect(szerkesztoNezetCel('/%20rolunk')).toBeNull()
  })

  it('a belépő kliens-kódja kicsi marad: csak a content-slugs-t és a next/navigation-t húzza be', () => {
    // A fejléc kliens-komponensei egy csomagba kerülnek, amelyet minden látogató
    // letölt (mérve, turbopack): ide nem kerülhet a preview-target.ts és a
    // return-url.ts, sem szerver-modul.
    const importok = (fajl: string): string[] =>
      [
        ...readFileSync(fileURLToPath(new URL(fajl, import.meta.url)), 'utf8').matchAll(
          /^import[^'"]*['"]([^'"]+)['"]/gm,
        ),
      ].map((talalat) => talalat[1] ?? '')
    expect(importok('../components/editor/frontend/SzerkesztoNezetBelepo.tsx')).toEqual([
      'next/navigation',
      './szerkeszto-nezet-cel',
    ])
    expect(importok('../components/editor/frontend/szerkeszto-nezet-cel.ts')).toEqual([
      '../../../lib/content-slugs',
    ])
  })

  it('a kódbeli útvonalak listája pontosan a src/app/(frontend) statikus könyvtárai', () => {
    const gyoker = fileURLToPath(new URL('../app/(frontend)', import.meta.url))
    const konyvtarak = readdirSync(gyoker)
      .filter((nev) => statSync(join(gyoker, nev)).isDirectory())
      .filter((nev) => !/^[[(_]/.test(nev))
      .sort()
    expect([...KODBELI_UTVONALAK, ...CMS_KODBELI_UTVONALAK].sort()).toEqual(konyvtarak)
  })
})

// ---------------------------------------------------------------------------
// 2. A fejléc döntése a meglévő auth-hívásból
// ---------------------------------------------------------------------------

/**
 * A fejléc szerver-kimenete. A logó képének előtöltő <link>-jét a React a
 * kimenet elejére teszi (élesben a <head>-be kerül), ezt levágjuk.
 */
async function fejlec(): Promise<string> {
  return renderToStaticMarkup((await Header()) as ReactNode).replace(/^(<link\b[^>]*\/>)+/, '')
}

describe('a fejléc-belépő csak staff/owner-nek, publikált nézetben', () => {
  it('anonim látogató: nincs belépő, és a draft-sütit sem olvassuk', async () => {
    const html = await fejlec()
    expect(html).not.toContain('kc-szerkeszto-nezet')
    expect(html).not.toContain(SZERKESZTO_NEZET_FELIRAT)
    expect(html.startsWith('<header class="kc-site-header">')).toBe(true)
    expect(h.authHivasok).toBe(1)
    expect(h.draftHivasok).toBe(0)
  })

  it('vásárló (customer): nincs belépő', async () => {
    h.user = { id: 7, role: 'customer' }
    const html = await fejlec()
    expect(html).not.toContain('kc-szerkeszto-nezet')
    expect(html.startsWith('<header class="kc-site-header">')).toBe(true)
    expect(h.authHivasok).toBe(1)
  })

  it.each(['staff', 'owner'])(
    '%s: a belépő a fejléc előtt áll, a lap előnézetére visz',
    async (role) => {
      h.user = { id: 1, role }
      const html = await fejlec()
      expect(html.startsWith('<div class="kc-szerkeszto-nezet">')).toBe(true)
      expect(html.indexOf('kc-szerkeszto-nezet')).toBeLessThan(html.indexOf('<header'))
      expect(html).toContain(
        `<a class="kc-szerkeszto-nezet__link" href="/next/preview?collection=pages&amp;slug=rolunk">${SZERKESZTO_NEZET_FELIRAT}<span class="kc-visually-hidden">`,
      )
      expect(h.authHivasok).toBe(1)
    },
  )

  it('staff piszkozat-előnézetben: nincs belépő (az előnézet-sáv visz vissza)', async () => {
    h.user = { id: 1, role: 'staff' }
    h.draft = true
    expect(await fejlec()).not.toContain('kc-szerkeszto-nezet')
  })

  it('staff kódbeli útvonalon (pl. /kurzusaim): nincs belépő', async () => {
    h.user = { id: 1, role: 'staff' }
    h.pathname = '/kurzusaim'
    expect(await fejlec()).not.toContain('kc-szerkeszto-nezet')
  })

  it('getHeaderAuthState: a szerkesztő-bit a szerepkörből, egyetlen auth-hívásból', async () => {
    for (const [user, vart] of [
      [null, { signedIn: false, szerkeszto: false, elonezet: false }],
      [
        { id: 2, role: 'customer' },
        { signedIn: true, szerkeszto: false, elonezet: false },
      ],
      [
        { id: 3, role: 'staff' },
        { signedIn: true, szerkeszto: true, elonezet: false },
      ],
      [
        { id: 4, role: 'owner' },
        { signedIn: true, szerkeszto: true, elonezet: false },
      ],
    ] as const) {
      h.user = user
      h.authHivasok = 0
      expect(await getHeaderAuthState()).toEqual(vart)
      expect(h.authHivasok).toBe(1)
    }
  })

  it('a belépő komponens a kódbeli útvonalon semmit nem renderel', () => {
    h.pathname = '/fiok'
    expect(renderToStaticMarkup(createElement(SzerkesztoNezetBelepo))).toBe('')
    h.pathname = '/'
    expect(renderToStaticMarkup(createElement(SzerkesztoNezetBelepo))).toContain(
      'href="/next/preview?collection=pages&amp;slug=kezdolap"',
    )
  })
})
