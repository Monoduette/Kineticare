import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

import {
  COURSE_HOME_REHAB,
  COURSE_SOS_KEZRELAX,
  LEGACY_GONE_HTML,
  LEGACY_GONE_PATHS,
  LEGACY_REDIRECTS,
  LEGACY_SEARCH_CONSOLE_PATHS,
  LEGACY_SITEMAP_PATHS,
  LEGACY_UNCHANGED_PATHS,
  SERVICES_RENDELOI_ANCHOR,
  isLegacyGonePath,
} from '../lib/legacy-redirects'
import { absoluteUrl } from '../lib/seo'
import nextConfig from '../../next.config'

/**
 * ÖRÖKÖLT URL-EK — a régi kineticare.hu címeinek megőrzése.
 *
 * Amit ez a fájl bizonyít:
 *  1. a `next.config.ts` `redirects()` KIMENETE (nem a forráskód szövege) minden
 *     örökölt forrásra pontosan egy, TARTÓS szabályt ad, mai kanonikus céllal;
 *  2. őr-teszt: a mért 25 régi sitemap-URL mindegyike kap sorsot, és a három
 *     sors kizárja egymást — egy kifelejtett URL itt bukik, nem élesben;
 *  3. a szabályok illeszkednek a záró perjeles és a nagybetűs alakra, és
 *     megőrzik a query stringet meg a horgonyt — a Next SAJÁT route-fordítójával
 *     mérve, nem újraimplementálva;
 *  4. az öt spam-poszt 410 Gone-t kap a middleware-ből;
 *  5. az örökölt címek NEM kerülnek be a sitemapba (átirányított URL-t nem
 *     hirdetünk), és egyetlen szabály sem nyel el valódi útvonalat.
 *
 * A mérés és a források a `src/lib/legacy-redirects.ts` fejlécében, a végleges
 * táblázat a `docs/orokolt-url-atiranyitasok.md`-ben van.
 */

// ---------------------------------------------------------------------------
// A Next.js SAJÁT route-fordítója — hogy a viselkedés mérve legyen, ne hitelv
// ---------------------------------------------------------------------------

/** A `getPathMatch` által visszaadott illesztő (a paramétereket nem használjuk). */
type PathMatcher = (pathname: string) => false | Record<string, unknown>

interface PathMatchModule {
  getPathMatch: (
    path: string,
    options?: {
      strict?: boolean
      sensitive?: boolean
      removeUnnamedParams?: boolean
      regexModifier?: (regex: string) => string
    },
  ) => PathMatcher
}

interface RedirectStatusModule {
  allowedStatusCodes: Set<number>
  getRedirectStatus: (route: { statusCode?: number; permanent?: boolean }) => number
  modifyRouteRegex: (regex: string, restrictedPaths?: string[]) => string
}

interface PrepareDestinationModule {
  prepareDestination: (args: {
    appendParamsToQuery: boolean
    destination: string
    params: Record<string, string>
    query: Record<string, string>
  }) => {
    newUrl: string
    parsedDestination: { hash?: string; query: Record<string, unknown> }
  }
}

const requireFromTest = createRequire(import.meta.url)

/**
 * A Next belső moduljai CJS-ben publikáltak, és a csomagnak nincs `exports`
 * térképe, ezért a mély import megengedett. Miért éri meg: így nem egy
 * ÚJRAÍRT illesztőt tesztelünk (ami hazudhat), hanem pontosan azt a kódot,
 * amelyik élesben eldönti, illeszkedik-e egy örökölt URL. Ha a Next egy
 * frissítéskor átalakítja ezeket, ez a teszt hangosan bukik — ami helyes:
 * a záró perjel és a kis-nagybetű kezelése akkor újramérendő.
 */
const { getPathMatch } = requireFromTest(
  'next/dist/shared/lib/router/utils/path-match.js',
) as PathMatchModule
const { allowedStatusCodes, getRedirectStatus, modifyRouteRegex } = requireFromTest(
  'next/dist/lib/redirect-status.js',
) as RedirectStatusModule
const { prepareDestination } = requireFromTest(
  'next/dist/shared/lib/router/utils/prepare-destination.js',
) as PrepareDestinationModule

/**
 * A `next/dist/server/lib/router-utils/filesystem.js` `buildCustomRoute`-jának
 * pontos beállításai (strict + `modifyRouteRegex`, `caseSensitiveRoutes: false`).
 */
function buildRouteMatcher(source: string): PathMatcher {
  return getPathMatch(source, {
    strict: true,
    removeUnnamedParams: true,
    regexModifier: (regex) => modifyRouteRegex(regex, ['/_next']),
    sensitive: false,
  })
}

/** A `next.config.ts` `redirects()` tényleges kimenete. */
async function configuredRedirects() {
  const redirects = nextConfig.redirects
  expect(typeof redirects, 'a next.config.ts-ben legyen redirects() függvény').toBe('function')
  return (await redirects!()) as Array<{
    source: string
    destination: string
    permanent?: boolean
    statusCode?: number
  }>
}

/** A ma élő, kanonikus célok — mindegyik mérve 200-zal az éles hoszton. */
const CANONICAL_DESTINATIONS = new Set([
  '/',
  '/kurzusok',
  '/rolunk',
  COURSE_HOME_REHAB,
  COURSE_SOS_KEZRELAX,
  SERVICES_RENDELOI_ANCHOR,
])

// ---------------------------------------------------------------------------
// 1. A redirects() kimenete
// ---------------------------------------------------------------------------

describe('next.config.ts redirects() — örökölt URL-ek', () => {
  it('minden örökölt forrás PONTOSAN egy szabályt kap', async () => {
    const rules = await configuredRedirects()

    const sources = rules.map((rule) => rule.source)
    expect(new Set(sources).size, `duplikált forrás: ${sources.join(', ')}`).toBe(sources.length)
    expect(sources.sort()).toEqual(LEGACY_REDIRECTS.map((rule) => rule.source).sort())
  })

  it('MIND tartós: permanent: true, és a Next ebből 308-at képez', async () => {
    const rules = await configuredRedirects()

    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.permanent, `${rule.source} nem tartós`).toBe(true)
      // Kézzel megadott statusCode felülírná a permanent-et — ne legyen.
      expect(rule.statusCode, `${rule.source} kézi statusCode-ot kapott`).toBeUndefined()
      expect(getRedirectStatus(rule), `${rule.source} nem 308-at ad`).toBe(308)
    }
    // A 410 SZÁNDÉKOSAN nem szerepelhet itt: a Next nem engedi átirányításként.
    expect(allowedStatusCodes.has(410)).toBe(false)
  })

  it('minden cél a MAI kanonikus URL, és sosem egy másik örökölt forrás (nincs lánc)', async () => {
    const rules = await configuredRedirects()
    const sources = new Set(rules.map((rule) => rule.source))

    for (const rule of rules) {
      expect(CANONICAL_DESTINATIONS.has(rule.destination), `ismeretlen cél: ${rule.destination}`).toBe(
        true,
      )
      const destinationPath = rule.destination.split('#')[0]
      expect(sources.has(destinationPath), `${rule.source} → ${rule.destination} láncot képez`).toBe(
        false,
      )
      expect(LEGACY_GONE_PATHS).not.toContain(destinationPath)
    }
  })

  it('a szórólap-QR célja: /kezrelax → az ingyenes SOS kurzus kanonikus címe', async () => {
    const rules = await configuredRedirects()
    const qr = rules.find((rule) => rule.source === '/kezrelax')

    expect(qr, 'a /kezrelax szabály hiányzik — a nyomtatott QR-kód 404-re futna').toBeDefined()
    expect(qr?.destination).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    expect(qr?.permanent).toBe(true)
  })

  it('a /kezrehab a fizetős fő program kanonikus címére megy', async () => {
    const rules = await configuredRedirects()

    expect(rules.find((rule) => rule.source === '/kezrehab')?.destination).toBe(
      '/kurzusok/otthoni-kezrehab-program',
    )
  })

  it('a rendelői kezelések a szolgáltatások oldal HORGONYÁRA mennek', async () => {
    const rules = await configuredRedirects()

    for (const source of ['/rendeloi-kezelesek', '/rendeloi-kezelesek-regi']) {
      expect(rules.find((rule) => rule.source === source)?.destination).toBe(
        '/szolgaltatasok#rendeloi',
      )
    }
  })

  it('a pénztár- és köszönőoldalak NEM a /penztar-ra mennek (robots-tiltott, üres)', async () => {
    const rules = await configuredRedirects()

    for (const rule of rules) {
      expect(rule.destination.startsWith('/penztar')).toBe(false)
      expect(rule.destination.startsWith('/kosar')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. ŐR-TESZT: egyetlen örökölt URL sem maradhat ki
// ---------------------------------------------------------------------------

describe('őr — a mért 25 régi sitemap-URL mindegyike kap sorsot', () => {
  const redirectSources = new Set(LEGACY_REDIRECTS.map((rule) => rule.source))
  const unchanged = new Set(LEGACY_UNCHANGED_PATHS)
  const gone = new Set(LEGACY_GONE_PATHS)

  it('a mérés 25 URL-t rögzített, duplikátum nélkül', () => {
    expect(LEGACY_SITEMAP_PATHS).toHaveLength(25)
    expect(new Set(LEGACY_SITEMAP_PATHS).size).toBe(25)
  })

  it('egyetlen örökölt URL sem marad sors nélkül', () => {
    const orphans = LEGACY_SITEMAP_PATHS.filter(
      (path) => !redirectSources.has(path) && !unchanged.has(path) && !gone.has(path),
    )
    expect(orphans, `sors nélküli örökölt URL(-ek): ${orphans.join(', ')}`).toEqual([])
  })

  it('a három sors kizárja egymást (egy URL nem kaphat két kezelést)', () => {
    for (const path of LEGACY_SITEMAP_PATHS) {
      const hits = [redirectSources.has(path), unchanged.has(path), gone.has(path)].filter(Boolean)
      expect(hits.length, `${path} egyszerre több kategóriában van`).toBe(1)
    }
  })

  it('a három lista együtt PONTOSAN a mért URL-halmazt fedi le (nincs kitalált sor)', () => {
    const covered = [...redirectSources, ...unchanged, ...gone].sort()
    expect(covered).toEqual([...LEGACY_SITEMAP_PATHS, ...LEGACY_SEARCH_CONSOLE_PATHS].sort())
  })

  it('a Search Console 404-címei: külön lista, mind 308-at kap, átfedés nélkül', () => {
    expect(new Set(LEGACY_SEARCH_CONSOLE_PATHS).size).toBe(LEGACY_SEARCH_CONSOLE_PATHS.length)
    for (const path of LEGACY_SEARCH_CONSOLE_PATHS) {
      expect(LEGACY_SITEMAP_PATHS, `${path} már a sitemap-mérésben is szerepel`).not.toContain(path)
      expect(redirectSources.has(path), `${path} nem kapott 308-at`).toBe(true)
      expect(unchanged.has(path) || gone.has(path), `${path} több sorsot kapott`).toBe(false)
    }
  })

  it('a Search Console 404-címeinek célja (mérve 2026-09-23)', async () => {
    const rules = await configuredRedirects()
    const target = (source: string) => rules.find((rule) => rule.source === source)?.destination

    expect(target('/kezrelax-penztar')).toBe(COURSE_SOS_KEZRELAX)
    expect(target('/kiss-kata')).toBe('/rolunk')
    expect(target('/home')).toBe('/')
    expect(target('/en')).toBe('/')
  })

  it('a változatlan slugok NEM kapnak szabályt (a redirects a fájlrendszer előtt fut)', async () => {
    const rules = await configuredRedirects()

    for (const rule of rules) {
      expect(
        unchanged.has(rule.source),
        `${rule.source} valódi oldal — a szabály elnyelné`,
      ).toBe(false)
    }
  })

  it('minden forrás gyökér-relatív, záró perjel és query nélkül', () => {
    for (const rule of LEGACY_REDIRECTS) {
      expect(rule.source.startsWith('/')).toBe(true)
      expect(rule.source.endsWith('/'), `${rule.source} záró perjelt tartalmaz`).toBe(
        rule.source === '/',
      )
      expect(rule.source).not.toContain('?')
      expect(rule.source).not.toContain('#')
      expect(rule.source).toBe(rule.source.toLowerCase())
    }
  })

  it('minden sor indoklást hordoz (a térkép magyarázat nélkül nem tartható karban)', () => {
    for (const rule of LEGACY_REDIRECTS) {
      expect(rule.reason.length, `${rule.source} indoklás nélkül`).toBeGreaterThan(20)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Illesztés: záró perjel, nagybetű, query, horgony
// ---------------------------------------------------------------------------

describe('illesztés — a skipTrailingSlashRedirect mellett is fog', () => {
  it('a Next fordított regexe opcionális záró perjelt enged (modifyRouteRegex)', async () => {
    const rules = await configuredRedirects()

    for (const rule of rules) {
      const match = buildRouteMatcher(rule.source)
      expect(match(rule.source), `${rule.source} nem illeszkedik önmagára`).not.toBe(false)
      expect(match(`${rule.source}/`), `${rule.source}/ (záró perjel) kimarad`).not.toBe(false)
    }
  })

  it('a nagybetűs örökölt alak is illeszkedik (caseSensitiveRoutes alapból false)', async () => {
    const rules = await configuredRedirects()

    for (const rule of rules) {
      const match = buildRouteMatcher(rule.source)
      expect(match(rule.source.toUpperCase()), `${rule.source} nagybetűs alakja kimarad`).not.toBe(
        false,
      )
    }
  })

  it('a szabály nem eszik meg mást: az előtag- és utótag-változatok NEM illeszkednek', () => {
    const match = buildRouteMatcher('/kezrehab')

    expect(match('/kezrehab-akcio')).toBe(false)
    expect(match('/kezrehab/valami')).toBe(false)
    expect(match('/valami/kezrehab')).toBe(false)
  })

  it('a query string átmegy a célra (utm/gclid nem vész el)', () => {
    const prepared = prepareDestination({
      appendParamsToQuery: false,
      destination: COURSE_SOS_KEZRELAX,
      params: {},
      query: { utm_source: 'szorolap', utm_medium: 'qr', gclid: 'teszt' },
    })

    expect(prepared.parsedDestination.query).toMatchObject({
      utm_source: 'szorolap',
      utm_medium: 'qr',
      gclid: 'teszt',
    })
  })

  it('a horgony megmarad a célban (#rendeloi), a query mellett is', () => {
    const prepared = prepareDestination({
      appendParamsToQuery: false,
      destination: SERVICES_RENDELOI_ANCHOR,
      params: {},
      query: { utm_source: 'regi-oldal' },
    })

    expect(prepared.newUrl).toBe('/szolgaltatasok#rendeloi')
    expect(prepared.parsedDestination.hash).toBe('#rendeloi')
    expect(prepared.parsedDestination.query).toMatchObject({ utm_source: 'regi-oldal' })
  })
})

// ---------------------------------------------------------------------------
// 4. 410 Gone — a spam-posztok
// ---------------------------------------------------------------------------

describe('410 Gone — a régi oldal spam-posztjai', () => {
  it('mind az öt spam-út gone, a változataikkal együtt', () => {
    expect(LEGACY_GONE_PATHS).toHaveLength(5)
    for (const path of LEGACY_GONE_PATHS) {
      expect(isLegacyGonePath(path), path).toBe(true)
      expect(isLegacyGonePath(`${path}/`), `${path}/`).toBe(true)
      expect(isLegacyGonePath(path.toUpperCase()), path.toUpperCase()).toBe(true)
    }
  })

  it('semmi mást nem minősít gone-nak — sem élő útvonalat, sem átirányított forrást', () => {
    for (const path of [
      '/',
      '/kurzusok',
      '/szolgaltatasok',
      COURSE_HOME_REHAB,
      COURSE_SOS_KEZRELAX,
      ...LEGACY_REDIRECTS.map((rule) => rule.source),
      ...LEGACY_UNCHANGED_PATHS,
    ]) {
      expect(isLegacyGonePath(path), path).toBe(false)
    }
  })

  it('a 410-es törzs magyar, lang="hu", és van belőle továbblépés (nem zsákutca)', () => {
    expect(LEGACY_GONE_HTML).toContain('lang="hu"')
    expect(LEGACY_GONE_HTML).toContain('Ez az oldal megszűnt')
    expect(LEGACY_GONE_HTML).toContain('href="/"')
  })

  it('a middleware 410-et ad a spam-úton, x-request-id fejléccel', async () => {
    const { NextRequest } = await import('next/server')
    const { middleware } = await import('../middleware')

    const response = middleware(new NextRequest('https://kineticare.hu/kathmandu-nepal'))

    expect(response.status).toBe(410)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.text()).resolves.toContain('Ez az oldal megszűnt')
  })

  it('a middleware minden MÁS kérést változatlanul enged tovább', async () => {
    const { NextRequest } = await import('next/server')
    const { middleware } = await import('../middleware')

    const response = middleware(new NextRequest('https://kineticare.hu/kurzusok'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    // A továbbengedett kérésre a Next belső jelzése kerül rá, nem 410-es törzs.
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// 5. A szabályok nem ütköznek valódi útvonallal, és nem szivárognak a sitemapba
// ---------------------------------------------------------------------------

describe('ütközés-mentesség', () => {
  it('egyetlen forrás sem egyezik létező app-router útvonallal', async () => {
    const rules = await configuredRedirects()

    // A storefront első szintű, statikus szegmensei — a route-csoportok,
    // a privát (`_`) mappák és a dinamikus szegmensek kimaradnak.
    const appRoutes = readdirSync(new URL('../app/(frontend)', import.meta.url), {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('(') &&
          !entry.name.startsWith('_') &&
          !entry.name.startsWith('['),
      )
      .map((entry) => `/${entry.name}`)

    expect(appRoutes.length, 'nem sikerült beolvasni az app-router útvonalakat').toBeGreaterThan(5)

    for (const rule of rules) {
      expect(appRoutes, `${rule.source} elnyelné a saját útvonalat`).not.toContain(rule.source)
    }
    for (const path of LEGACY_GONE_PATHS) {
      expect(appRoutes, `${path} 410-et adna egy valódi útvonalra`).not.toContain(path)
    }
  })
})

describe('sitemap — átirányított cím nem indexelendő', () => {
  it('sem az átirányított forrás, sem a 410-es út nem kerül a sitemapba', async () => {
    vi.doMock('@/lib/cms', () => ({
      HOME_PAGE_SLUG: 'kezdolap',
      // A ma élő CMS-oldalak (mérve az éles sitemapból).
      getAllPublishedPages: () =>
        Promise.resolve(
          [
            'kezdolap',
            'szolgaltatasok',
            'rolunk',
            'kapcsolat',
            'impresszum',
            'adatvedelem',
            'aszf',
          ].map((slug) => ({ slug, updatedAt: '2026-08-16T00:00:00.000Z' })),
        ),
      getSitemapPosts: () => Promise.resolve([]),
      getContentCategories: () => Promise.resolve([]),
      getSitemapProducts: () =>
        Promise.resolve([
          { id: 1, slug: 'otthoni-kezrehab-program', updatedAt: '2026-08-16T00:00:00.000Z' },
          { id: 2, slug: 'sos-kezrelax-villamkurzus', updatedAt: '2026-08-16T00:00:00.000Z' },
        ]),
    }))

    const { default: sitemap } = await import('../app/sitemap')
    const urls = (await sitemap()).map((entry) => entry.url)

    for (const rule of LEGACY_REDIRECTS) {
      expect(urls, `${rule.source} átirányított cím a sitemapban`).not.toContain(
        absoluteUrl(rule.source),
      )
    }
    for (const path of LEGACY_GONE_PATHS) {
      expect(urls, `${path} 410-es cím a sitemapban`).not.toContain(absoluteUrl(path))
    }

    // Kontroll: a kanonikus célok viszont BENNE vannak — különben a teszt akkor
    // is „átmenne", ha a sitemap üres lenne.
    expect(urls).toContain(absoluteUrl(COURSE_SOS_KEZRELAX))
    expect(urls).toContain(absoluteUrl(COURSE_HOME_REHAB))
    expect(urls).toContain(absoluteUrl('/szolgaltatasok'))

    vi.doUnmock('@/lib/cms')
  })
})
