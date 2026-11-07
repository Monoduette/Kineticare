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
 * A kulcs jelölt DUMMY érték (1. tilos zóna, kézikönyv 2.1). A mintaválaszok
 * alakja a PostHog MCP `query-web-stats` 2026-11-07-i élő válaszaié.
 */

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

const {
  WEB_STATS_BREAKDOWN_KEYS,
  channelLabelHu,
  deviceLabelHu,
  formatDurationHu,
  formatFetchedAtHu,
  formatPercentHu,
  isWebStatsStale,
  loadPosthogWebStats,
  parseWebStatsPeriod,
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

/** A tábla-lekérdezések mintái `breakdownBy` szerint; a HogQL-oldallista a `Page` kulcson. */
const TABLES: Record<string, unknown> = {
  Page: table([
    ['/', [30, null], [90, null], 0.5, ''],
    ['/kurzusok', [12, null], [40, null], 0.2, ''],
  ]),
  InitialPage: table([
    ['/', [144, null], [579, null], 0.61, ''],
    ['', [1, null], [1, null], 0.01, ''],
  ]),
  ExitPage: table([['/kapcsolat', [36, null], [126, null], 0.14, '']]),
  // Tuple és sima szám vegyesen: a REST-válasz eltérhet az MCP-s mintától.
  InitialChannelType: table([
    ['Direct', [26, null], [77, null], 0.448, ''],
    ['Organic Search', 18, 79, 0.31, ''],
    ['AI', [2, 0], [3, 0], 0.03, ''],
    ['Valami új csatorna', [1, null], [1, null], 0.01, ''],
  ]),
  InitialReferringDomain: table([
    ['www.google.com', [84, null], [316, null], 0.38, ''],
    ['$direct', [83, null], [395, null], 0.38, ''],
  ]),
  InitialUTMSource: table([
    [null, [201, null], [853, null], 0.99, ''],
    ['ig', [1, null], [2, null], 0.004, ''],
  ]),
  InitialUTMMedium: table([['social', [1, null], [2, null], 0.004, '']]),
  InitialUTMCampaign: table([]),
  DeviceType: table([
    ['Mobile', [40, null], [120, null], 0.7, ''],
    ['Desktop', [16, null], [63, null], 0.3, ''],
    ['Tablet', [1, null], [2, null], 0.01, ''],
  ]),
  Browser: table([['Mobile Safari', [72, null], [336, null], 0.35, '']]),
  OS: table([['iOS', [100, null], [424, null], 0.49, '']]),
  Country: table([
    ['HU', [194, null], [829, null], 0.95, ''],
    ['SK', [3, null], [10, null], 0.01, ''],
    ['Atlantisz', [1, null], [1, null], 0.001, ''],
  ]),
  // Élő alak: a név `[országkód, város]` pár, a város lehet null.
  City: table([
    [['HU', 'Budapest'], [141, null], [586, null], 0.63, ''],
    [['HU', null], [21, null], [76, null], 0.09, ''],
  ]),
  // Élő alak: a `ui_fill_fraction` cella hiányzik, és van csonka kód (`de-`).
  Language: table([
    ['hu-HU', [161, null], [681, null], ''],
    ['de-', [1, null], [4, null], ''],
    ['nem-nyelvkod!', [1, null], [1, null], ''],
  ]),
}

/** A napi HogQL-válasz alakja: előtag nélküli oszlopok, sima számok. */
function dailyBody(rows: unknown[][]) {
  return { columns: ['day', 'visitors', 'views'], results: rows }
}

const DAILY = dailyBody([
  ['2026-11-01', 5, 8],
  ['2026-11-03', 11, 57],
  ['2026-11-07', 2, 3],
])

interface PosthogQuery {
  kind: string
  breakdownBy?: string
  query?: string
  [key: string]: unknown
}

interface Bodies {
  overview?: unknown
  daily?: unknown
  tables?: Record<string, unknown>
  /** Válaszkésleltetés ms-ban (a párhuzamosság méréséhez). */
  delayMs?: number
}

function queryOf(init: RequestInit): PosthogQuery {
  return (JSON.parse(String(init.body)) as { query: PosthogQuery }).query
}

/** Fetch-stub: a kérés `kind`/`breakdownBy`/HogQL-szövege alapján válaszol, és méri a párhuzamosságot. */
function stubPosthog({
  overview = OVERVIEW,
  daily = DAILY,
  tables = TABLES,
  delayMs = 0,
}: Bodies = {}) {
  const stats = { inFlight: 0, maxInFlight: 0 }
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    stats.inFlight += 1
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
    try {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      const query = queryOf(init)
      const payload =
        query.kind === 'WebOverviewQuery'
          ? overview
          : query.kind === 'HogQLQuery'
            ? String(query.query).includes(' AS day')
              ? daily
              : tables.Page
            : tables[query.breakdownBy ?? '']
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } finally {
      stats.inFlight -= 1
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, stats }
}

let warnKem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnKem = vi.spyOn(logger, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('parseWebStatsPeriod: az idoszak keresési paraméter', () => {
  it.each([
    ['30', 30],
    [['30', '7'], 30],
    ['7', 7],
    [undefined, 7],
    [['7', '30'], 7],
    [[], 7],
    ['x', 7],
    ['365', 7],
    [' 30', 7],
    [30, 7],
  ])('%j → %i nap', (raw, expected) => {
    expect(parseWebStatsPeriod(raw)).toBe(expected)
  })
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

const EXPECTED_TABLE_BREAKDOWNS = [
  'InitialPage',
  'ExitPage',
  'InitialChannelType',
  'InitialReferringDomain',
  'InitialUTMSource',
  'InitialUTMMedium',
  'InitialUTMCampaign',
  'DeviceType',
  'Browser',
  'OS',
  'Country',
  'City',
  'Language',
]

describe('loadPosthogWebStats: a kérés alakja', () => {
  it.each([
    ['alapértelmezés', undefined, 7],
    ['7 nap', 7, 7],
    ['30 nap', 30, 30],
  ] as const)(
    '%s: a fix EU-végpontra megy, Bearer-kulccsal, az időszak minden lekérdezésben',
    async (_nev, period, days) => {
      vi.stubEnv('POSTHOG_PERSONAL_API_KEY', ` ${DUMMY_KEY} `)
      const { fetchMock } = stubPosthog()
      const stats = await loadPosthogWebStats(period)
      expect(stats.status === 'ok' && stats.periodDays).toBe(days)

      expect(fetchMock).toHaveBeenCalledTimes(16)
      const queries = fetchMock.mock.calls.map(([url, init]) => {
        expect(url).toBe('https://eu.posthog.com/api/projects/253152/query/')
        expect(init.method).toBe('POST')
        expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${DUMMY_KEY}`)
        expect(init.signal).toBeInstanceOf(AbortSignal)
        return queryOf(init)
      })
      // Közös határidő: minden kérés ugyanazt a jelzőt kapja.
      expect(new Set(fetchMock.mock.calls.map(([, init]) => init.signal)).size).toBe(1)

      expect(queries.map((query) => [query.kind, query.breakdownBy ?? null])).toEqual([
        ['WebOverviewQuery', null],
        ['HogQLQuery', null],
        ['HogQLQuery', null],
        ...EXPECTED_TABLE_BREAKDOWNS.map((breakdownBy) => ['WebStatsTableQuery', breakdownBy]),
      ])
      for (const query of queries) {
        if (query.kind === 'HogQLQuery') {
          expect(query.filters).toEqual({ filterTestAccounts: true })
          expect(String(query.query)).toContain('{filters}')
        } else {
          expect(query.filterTestAccounts).toBe(true)
          expect(query.dateRange).toEqual({ date_from: `-${days}d` })
        }
        if (query.kind === 'WebStatsTableQuery') {
          expect(query.limit).toBe(10)
        }
      }
      const [daily, pages] = queries.filter((query) => query.kind === 'HogQLQuery')
      // A napi bontás a mai nappal együtt pontosan `days` budapesti nap.
      expect(String(daily.query)).toContain(
        `timestamp >= toStartOfDay(toTimeZone(now(), 'Europe/Budapest')) - INTERVAL ${days - 1} DAY`,
      )
      expect(String(daily.query)).toContain(
        "toDate(toTimeZone(timestamp, 'Europe/Budapest')) AS day",
      )
      expect(String(pages.query)).toContain(`INTERVAL ${days} DAY`)
      expect(String(pages.query)).toMatch(/ORDER BY views DESC, visitors DESC LIMIT 10$/)
    },
  )

  it('egyszerre legfeljebb 3 lekérdezés fut (a PostHog projekt-korlátja), de párhuzamosan', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    const { fetchMock, stats } = stubPosthog({ delayMs: 5 })
    const result = await loadPosthogWebStats(30)
    expect(fetchMock).toHaveBeenCalledTimes(16)
    expect(stats.maxInFlight).toBe(3)
    expect(result.status).toBe('ok')
  })
})

describe('loadPosthogWebStats: a válasz érvényesítése', () => {
  it('a mintaválaszokból összesítő, napi bontás és magyarított táblák állnak össze', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    stubPosthog()
    const stats = await loadPosthogWebStats()
    expect(stats).toEqual({
      status: 'ok',
      periodDays: 7,
      fetchedAt: '2026-11-07T10:00:00.000Z',
      overview: {
        visitors: 56,
        views: 183,
        sessions: 78,
        sessionDurationSeconds: 166.73,
        bounceRatePercent: 39.74,
      },
      daily: [
        { date: '2026-11-01', visitors: 5, views: 8 },
        { date: '2026-11-02', visitors: 0, views: 0 },
        { date: '2026-11-03', visitors: 11, views: 57 },
        { date: '2026-11-04', visitors: 0, views: 0 },
        { date: '2026-11-05', visitors: 0, views: 0 },
        { date: '2026-11-06', visitors: 0, views: 0 },
        { date: '2026-11-07', visitors: 2, views: 3 },
      ],
      breakdowns: {
        pages: [
          { name: '/', visitors: 30, views: 90 },
          { name: '/kurzusok', visitors: 12, views: 40 },
        ],
        entryPages: [
          { name: '/', visitors: 144, views: 579 },
          { name: 'Ismeretlen', visitors: 1, views: 1 },
        ],
        exitPages: [{ name: '/kapcsolat', visitors: 36, views: 126 }],
        channels: [
          { name: 'Közvetlen', visitors: 26, views: 77 },
          { name: 'Organikus keresés', visitors: 18, views: 79 },
          { name: 'MI-asszisztens', visitors: 2, views: 3 },
          { name: 'Valami új csatorna', visitors: 1, views: 1 },
        ],
        referrers: [
          { name: 'www.google.com', visitors: 84, views: 316 },
          { name: 'Közvetlen', visitors: 83, views: 395 },
        ],
        utmSources: [
          // Az üres UTM-érték címke nélküli látogatás, nem ismeretlen forrás.
          { name: 'Nincs UTM-címke', visitors: 201, views: 853 },
          { name: 'ig', visitors: 1, views: 2 },
        ],
        utmMediums: [{ name: 'social', visitors: 1, views: 2 }],
        utmCampaigns: [],
        devices: [
          { name: 'Telefon', visitors: 40, views: 120 },
          { name: 'Számítógép', visitors: 16, views: 63 },
          { name: 'Tablet', visitors: 1, views: 2 },
        ],
        browsers: [{ name: 'Mobile Safari', visitors: 72, views: 336 }],
        os: [{ name: 'iOS', visitors: 100, views: 424 }],
        countries: [
          { name: 'Magyarország', visitors: 194, views: 829 },
          { name: 'Szlovákia', visitors: 3, views: 10 },
          { name: 'Atlantisz', visitors: 1, views: 1 },
        ],
        cities: [
          { name: 'Budapest (Magyarország)', visitors: 141, views: 586 },
          { name: 'Ismeretlen (Magyarország)', visitors: 21, views: 76 },
        ],
        languages: [
          { name: 'magyar (Magyarország)', visitors: 161, views: 681 },
          { name: 'német', visitors: 1, views: 4 },
          { name: 'nem-nyelvkod!', visitors: 1, views: 1 },
        ],
      },
    })
    expect(Object.keys(stats.status === 'ok' ? stats.breakdowns : {})).toEqual(
      WEB_STATS_BREAKDOWN_KEYS,
    )
    expect(warnKem).not.toHaveBeenCalled()
  })

  it('napi bontás: 30 napnál 30 pont, a nap budapesti (UTC 23:30 már másnap)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // UTC szerint még 11-06, Budapesten (CET, +1) már 11-07 00:30.
    vi.setSystemTime(new Date('2026-11-06T23:30:00Z'))
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    stubPosthog({
      daily: dailyBody([
        ['2026-10-09', 4, 6],
        ['2026-11-07', 1, 1],
        // Az időszakon kívüli sor (órák eltérése) nem kerül a sorozatba.
        ['2026-10-01', 99, 99],
      ]),
    })
    const stats = await loadPosthogWebStats(30)
    if (stats.status !== 'ok' || stats.daily === null) {
      throw new Error(`váratlan állapot: ${JSON.stringify(stats)}`)
    }
    expect(stats.daily).toHaveLength(30)
    expect(stats.daily[0]).toEqual({ date: '2026-10-09', visitors: 4, views: 6 })
    expect(stats.daily[29]).toEqual({ date: '2026-11-07', visitors: 1, views: 1 })
    expect(
      stats.daily.slice(1, 29).every((point) => point.visitors === 0 && point.views === 0),
    ).toBe(true)
  })

  it('a Legnézettebb oldalak a PostHog rendezését tartja meg (megtekintés szerint)', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    // A HogQL-válasz oszlopai előtag nélküliek, a számok sima számok.
    stubPosthog({
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
    expect(stats.status === 'ok' && stats.breakdowns.pages).toEqual([
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
    expect(stats.status === 'ok' && stats.breakdowns.pages).toEqual([
      { name: '/ar', visitors: 5, views: 9 },
    ])
  })

  it.each([
    ['pages', 'Page', 'szöveges darabszám', table([['/', ['30', null], [90, null], 0.5, '']])],
    ['pages', 'Page', 'hiányzó views-oszlop', table([['/', [30, null]]], COLUMNS.slice(0, 2))],
    ['pages', 'Page', 'nem tömb sor', { columns: COLUMNS, results: [{ value: '/' }] }],
    ['pages', 'Page', 'results hiányzik', { columns: COLUMNS }],
    ['cities', 'City', 'szám a városnévben', table([[['HU', 7], [1, null], [1, null], 0, '']])],
    [
      'countries',
      'Country',
      'objektum név',
      table([[{ code: 'HU' }, [1, null], [1, null], 0, '']]),
    ],
  ] as const)(
    'hibás %s blokk (%s, %s) → csak az a blokk null, figyelmeztetéssel',
    async (block, breakdownBy, _nev, rossz) => {
      vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
      stubPosthog({ tables: { ...TABLES, [breakdownBy]: rossz } })
      const stats = await loadPosthogWebStats()
      if (stats.status !== 'ok') {
        throw new Error(`váratlan állapot: ${stats.status}`)
      }
      for (const key of WEB_STATS_BREAKDOWN_KEYS) {
        expect(stats.breakdowns[key] === null, key).toBe(key === block)
      }
      expect(stats.overview).not.toBeNull()
      expect(stats.daily).not.toBeNull()
      expect(warnKem).toHaveBeenCalledTimes(1)
      expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a válasz alakja nem a várt', {
        block,
      })
    },
  )

  it('hibás napi bontás (nem dátum a nap oszlopban) → csak a napi bontás null', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', DUMMY_KEY)
    stubPosthog({ daily: dailyBody([[1730937600, 5, 8]]) })
    const stats = await loadPosthogWebStats()
    expect(stats.status === 'ok' && stats.daily).toBeNull()
    expect(stats.status === 'ok' && stats.breakdowns.pages).not.toBeNull()
    expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a válasz alakja nem a várt', {
      block: 'daily',
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
    await expect(loadPosthogWebStats(30)).resolves.toEqual({ status: 'unavailable' })
    expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a PostHog hibát adott', {
      block: 'overview',
      status: 401,
    })
    expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a PostHog hibát adott', {
      block: 'languages',
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
    expect(warnKem).toHaveBeenCalledWith('posthog-webstat: a lekérdezés nem futott le', {
      block: 'daily',
      reason: 'TimeoutError',
    })

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
