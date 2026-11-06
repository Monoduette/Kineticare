import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../lib/logger'

/**
 * A Webanalitika látogatói számai: PostHog Query API kliens.
 *
 * A gazdahatár a `loadPosthogWebStats`, ezt hívja a nézet. A hálózatot a
 * globális `fetch` stubja helyettesíti (CLAUDE.md 15.), a Next
 * `unstable_cache`-e itt átengedő: a gyorsítótár a Next futtatókörnyezet
 * része, a teszt a lekérdezést és az érvényesítést méri.
 *
 * A kulcs jelölt DUMMY érték (1. tilos zóna, kézikönyv 2.1).
 */

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

const {
  channelLabelHu,
  deviceLabelHu,
  formatDurationHu,
  formatFetchedAtHu,
  formatPercentHu,
  isWebStatsStale,
  loadPosthogWebStats,
} = await import('../lib/admin/posthog-web-stats')

const DUMMY_KEY = 'DUMMY-posthog-personal-key-for-tests'

/** A 2026-11-06-i minta (ugyanez a projekt, MCP-n lekérdezve). */
const OVERVIEW = {
  results: [
    { key: 'visitors', kind: 'unit', value: 56, previous: null, changeFromPreviousPct: null },
    { key: 'views', kind: 'unit', value: 183, previous: null, changeFromPreviousPct: null },
    { key: 'sessions', kind: 'unit', value: 78, previous: null, changeFromPreviousPct: null },
    { key: 'session duration', kind: 'duration_s', value: 166.73, previous: null },
    { key: 'bounce rate', kind: 'percentage', value: 39.74, isIncreaseBad: true },
  ],
}

const COLUMNS = [
  'context.columns.breakdown_value',
  'context.columns.visitors',
  'context.columns.views',
  'context.columns.ui_fill_fraction',
  'context.columns.cross_sell',
]

function table(results: unknown[][], columns: unknown[] = COLUMNS) {
  return { columns, results }
}

const TABLES: Record<string, unknown> = {
  Page: table([
    ['/', [30, null], [90, null], 0.5, ''],
    ['/kurzusok', [12, null], [40, null], 0.2, ''],
  ]),
  // Tuple és sima szám vegyesen: a REST-válasz eltérhet az MCP-s mintától.
  InitialChannelType: table([
    ['Direct', [26, null], [77, null], 0.448, ''],
    ['Organic Search', 18, 79, 0.31, ''],
    ['AI', [2, 0], [3, 0], 0.03, ''],
    ['Valami új csatorna', [1, null], [1, null], 0.01, ''],
  ]),
  DeviceType: table([
    ['Mobile', [40, null], [120, null], 0.7, ''],
    ['Desktop', [16, null], [63, null], 0.3, ''],
    ['Tablet', [1, null], [2, null], 0.01, ''],
  ]),
}

interface Bodies {
  overview?: unknown
  tables?: Record<string, unknown>
}

/** Fetch-stub: a kérés `kind`/`breakdownBy` mezője alapján válaszol. */
function stubPosthog({ overview = OVERVIEW, tables = TABLES }: Bodies = {}) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      query: { kind: string; breakdownBy?: string }
    }
    const payload =
      body.query.kind === 'WebOverviewQuery'
        ? overview
        : body.query.kind === 'HogQLQuery'
          ? tables.Page
          : tables[body.query.breakdownBy ?? '']
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let warnKem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnKem = vi.spyOn(logger, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('loadPosthogWebStats: kulcs nélkül nincs hálózat', () => {
  it.each([
    ['hiányzó', undefined],
    ['üres', ''],
    ['csak szóköz', '   '],
  ])('%s kulcs → not_configured, egyetlen fetch sem indul', async (_nev, value) => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', value)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('TILTOTT ÁG: kulcs nélkül hálózati hívás indult')
      }),
    )
    await expect(loadPosthogWebStats()).resolves.toEqual({ status: 'not_configured' })
  })
})

describe('loadPosthogWebStats: a kérés alakja', () => {
  it('a fix EU-végpontra megy, Bearer-kulccsal, a négy lekérdezéssel', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', ` ${DUMMY_KEY} `)
    const fetchMock = stubPosthog()
    await loadPosthogWebStats()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const queries = fetchMock.mock.calls.map(([url, init]) => {
      expect(url).toBe('https://eu.posthog.com/api/projects/253152/query/')
      expect(init.method).toBe('POST')
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${DUMMY_KEY}`)
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return (JSON.parse(String(init.body)) as { query: Record<string, unknown> }).query
    })
    for (const query of queries.filter((query) => query.kind !== 'HogQLQuery')) {
      expect(query.filterTestAccounts).toBe(true)
      expect(query.dateRange).toEqual({ date_from: '-7d' })
    }
    // Közös határidő: mind a négy kérés ugyanazt a jelzőt kapja.
    const signals = new Set(fetchMock.mock.calls.map(([, init]) => init.signal))
    expect(signals.size).toBe(1)
    expect(queries.map((query) => [query.kind, query.breakdownBy ?? null])).toEqual([
      ['WebOverviewQuery', null],
      ['HogQLQuery', null],
      ['WebStatsTableQuery', 'InitialChannelType'],
      ['WebStatsTableQuery', 'DeviceType'],
    ])
  })
})

describe('loadPosthogWebStats: a válasz érvényesítése', () => {
  it('a mintaválaszokból összesítő és magyarított táblák állnak össze', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    stubPosthog()
    const stats = await loadPosthogWebStats()
    expect(stats).toEqual({
      status: 'ok',
      fetchedAt: expect.any(String),
      overview: {
        visitors: 56,
        views: 183,
        sessions: 78,
        sessionDurationSeconds: 166.73,
        bounceRatePercent: 39.74,
      },
      pages: [
        { name: '/', visitors: 30, views: 90 },
        { name: '/kurzusok', visitors: 12, views: 40 },
      ],
      channels: [
        { name: 'Közvetlen', visitors: 26, views: 77 },
        { name: 'Organikus keresés', visitors: 18, views: 79 },
        { name: 'MI-asszisztens', visitors: 2, views: 3 },
        { name: 'Valami új csatorna', visitors: 1, views: 1 },
      ],
      devices: [
        { name: 'Telefon', visitors: 40, views: 120 },
        { name: 'Számítógép', visitors: 16, views: 63 },
        { name: 'Tablet', visitors: 1, views: 2 },
      ],
    })
    expect(warnKem).not.toHaveBeenCalled()
  })

  it('a Legnézettebb oldalak a PostHogban rendeződik megtekintés szerint, teszt-forgalom nélkül', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    // A HogQL-válasz oszlopai előtag nélküliek, a számok sima számok.
    const fetchMock = stubPosthog({
      tables: {
        ...TABLES,
        Page: table(
          [
            ['/sokat-olvasott', 5, 500],
            ['/', 37, 57],
          ],
          ['breakdown_value', 'visitors', 'views'],
        ),
      },
    })
    const stats = await loadPosthogWebStats()
    const pagesQuery = fetchMock.mock.calls
      .map(
        ([, init]) => (JSON.parse(String(init.body)) as { query: Record<string, unknown> }).query,
      )
      .find((query) => query.kind === 'HogQLQuery')
    expect(pagesQuery?.filters).toEqual({ filterTestAccounts: true })
    expect(String(pagesQuery?.query)).toMatch(/ORDER BY views DESC, visitors DESC LIMIT 5$/)
    expect(String(pagesQuery?.query)).toContain('{filters}')
    expect(String(pagesQuery?.query)).toContain('INTERVAL 7 DAY')
    expect(stats.status === 'ok' && stats.pages).toEqual([
      { name: '/sokat-olvasott', visitors: 5, views: 500 },
      { name: '/', visitors: 37, views: 57 },
    ])
  })

  it('az oszlopokat név szerint keresi: az eltolt sorrend is jó számot ad', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    stubPosthog({
      tables: {
        ...TABLES,
        Page: table(
          [[[9, null], 0.4, [5, null], '/ar']],
          [
            'context.columns.views',
            'context.columns.bounce_rate',
            'context.columns.visitors',
            'context.columns.breakdown_value',
          ],
        ),
      },
    })
    const stats = await loadPosthogWebStats()
    expect(stats.status === 'ok' && stats.pages).toEqual([{ name: '/ar', visitors: 5, views: 9 }])
  })

  it.each([
    ['szöveges darabszám', table([['/', ['30', null], [90, null], 0.5, '']])],
    ['hiányzó views-oszlop', table([['/', [30, null]]], COLUMNS.slice(0, 2))],
    ['nem tömb sor', { columns: COLUMNS, results: [{ value: '/' }] }],
    ['results hiányzik', { columns: COLUMNS }],
  ])('hibás táblablokk (%s) → csak az a blokk null, figyelmeztetéssel', async (_nev, rossz) => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    stubPosthog({ tables: { ...TABLES, Page: rossz } })
    const stats = await loadPosthogWebStats()
    expect(stats.status).toBe('ok')
    if (stats.status !== 'ok') return
    expect(stats.pages).toBeNull()
    expect(stats.channels).not.toBeNull()
    expect(stats.overview).not.toBeNull()
    expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a válasz alakja nem a várt', {
      block: 'pages',
    })
  })

  it('hibás összesítő (szöveges érték, hiányzó kulcs) → az összesítő null', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    for (const overview of [
      { results: [{ ...OVERVIEW.results[0], value: '56' }, ...OVERVIEW.results.slice(1)] },
      { results: OVERVIEW.results.slice(0, 4) },
    ]) {
      stubPosthog({ overview })
      const stats = await loadPosthogWebStats()
      expect(stats.status === 'ok' && stats.overview).toBeNull()
    }
  })

  it('HTTP 401 minden blokkra → unavailable, a napló nem tartalmazza a kulcsot', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: `rossz kulcs: ${DUMMY_KEY}` }), { status: 401 }),
      ),
    )
    await expect(loadPosthogWebStats()).resolves.toEqual({ status: 'unavailable' })
    expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a PostHog hibát adott', {
      block: 'overview',
      status: 401,
    })
    const naplo = JSON.stringify(warnKem.mock.calls)
    expect(naplo).not.toContain(DUMMY_KEY)
    expect(naplo).not.toContain('rossz kulcs')
  })

  it('időtúllépés és nem-JSON válasz → unavailable, a nézet felé nem dob', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      }),
    )
    await expect(loadPosthogWebStats()).resolves.toEqual({ status: 'unavailable' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>hiba</html>', { status: 200 })),
    )
    await expect(loadPosthogWebStats()).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('magyar címkék és formázás', () => {
  it('a lekérés időpontja: 15 percnél régebbi vagy olvashatatlan → elavult', () => {
    const now = Date.parse('2026-11-06T21:20:00Z')
    expect(isWebStatsStale('2026-11-06T21:10:00Z', now)).toBe(false)
    expect(isWebStatsStale('2026-11-06T21:04:00Z', now)).toBe(true)
    expect(isWebStatsStale('nem dátum', now)).toBe(true)
    expect(formatFetchedAtHu('2026-11-06T20:20:00Z')).toMatch(/21:20/)
    expect(formatFetchedAtHu('nem dátum')).toBe('ismeretlen időpont')
  })

  it('a csatorna- és eszközneveket magyarítja, az ismeretlent változatlanul hagyja', () => {
    expect(
      [
        'Direct',
        'Organic Search',
        'Paid Search',
        'Organic Social',
        'Paid Social',
        'Referral',
        'Email',
        'AI',
        'Unknown',
        'Display',
      ].map(channelLabelHu),
    ).toEqual([
      'Közvetlen',
      'Organikus keresés',
      'Fizetett keresés',
      'Közösségi média',
      'Fizetett közösségi',
      'Hivatkozó oldal',
      'E-mail',
      'MI-asszisztens',
      'Ismeretlen',
      'Display',
    ])
    expect(['Desktop', 'Mobile', 'Tablet', 'Console'].map(deviceLabelHu)).toEqual([
      'Számítógép',
      'Telefon',
      'Tablet',
      'Console',
    ])
  })

  it('munkamenet-hossz és százalék magyar alakban', () => {
    expect(formatDurationHu(166.73)).toBe('2 perc 47 mp')
    expect(formatDurationHu(47)).toBe('47 mp')
    expect(formatDurationHu(120)).toBe('2 perc')
    expect(formatDurationHu(3900)).toBe('1 óra 5 perc')
    expect(formatPercentHu(39.74)).toBe('39,7%')
    expect(formatPercentHu(40)).toBe('40,0%')
  })
})
