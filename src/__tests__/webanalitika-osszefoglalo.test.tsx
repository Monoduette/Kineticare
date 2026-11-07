import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerender } from 'react-dom/static'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PosthogWebStats,
  WebStatsBreakdownKey,
  WebStatsPeriodDays,
  WebStatsRow,
} from '../lib/admin/posthog-web-stats'
import type { CourseEngagementReport, CourseEngagementRow } from '../lib/statistics/engagement'
import type { RevenueReport } from '../lib/statistics/revenue'

/**
 * A Webanalitika-nézet eladás- és haladás-összefoglalója — POZITÍV ág.
 *
 * A kapu-kötés őre (admin-nezet-kapu-kotes.test.tsx) dobó kémekkel bizonyítja,
 * hogy a lekérdezések a kapu MÖGÖTT futnak; ez a teszt a másik felét méri:
 * sikeres jelentésből a hat kiemelt szám HELYESEN áll össze — a hónap-sor az
 * utolsó (aktuális) hónapból jön, a haladás-oszlopok pedig kurzusonként
 * összegződnek (ugyanúgy, ahogy a Statisztika kurzus-táblája).
 */

vi.mock('../components/admin/AdminChrome', () => ({
  AdminChrome: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'chrome' }, children),
  AdminViewFrame: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'frame' }, children),
}))

const REPORT: RevenueReport = {
  months: [
    {
      month: '2026-07',
      laikusHuf: 10000,
      szakemberHuf: 0,
      totalHuf: 10000,
      orderCount: 1,
    },
    {
      month: '2026-08',
      laikusHuf: 149800,
      szakemberHuf: 89900,
      totalHuf: 239700,
      orderCount: 7,
    },
  ],
  totals: { laikusHuf: 159800, szakemberHuf: 89900, totalHuf: 249700, orderCount: 8 },
  courses: [],
  funnel: {
    created: 0,
    paymentPending: 0,
    paid: 8,
    paymentFailed: 0,
    cancelled: 0,
    refunded: 0,
    other: 0,
    total: 8,
  },
  truncated: false,
}

function sor(reszlet: Partial<CourseEngagementRow>): CourseEngagementRow {
  return {
    productId: 1,
    title: 'Kurzus',
    audience: 'laikus',
    enrolled: 0,
    started: 0,
    completed: 0,
    notStarted: 0,
    totalLessons: 5,
    averagePercent: 0,
    completionRateOfEnrolled: 0,
    omitted: 0,
    ...reszlet,
  } as CourseEngagementRow
}

const ENGAGEMENT: CourseEngagementReport = {
  courses: [
    sor({ productId: 1, enrolled: 12, started: 9, completed: 4 }),
    sor({ productId: 2, enrolled: 5, started: 2, completed: 1 }),
  ],
  truncated: false,
  skipped: 0,
  omitted: 0,
}

vi.mock('../lib/statistics/query', () => ({
  queryRevenueReport: vi.fn(async () => REPORT),
}))

vi.mock('../lib/statistics/engagement-query', () => ({
  queryCourseEngagement: vi.fn(async () => ENGAGEMENT),
}))

const loadPosthogWebStats = vi.fn<(days?: WebStatsPeriodDays) => Promise<PosthogWebStats>>(
  async () => ({ status: 'not_configured' }),
)

vi.mock('../lib/admin/posthog-web-stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/admin/posthog-web-stats')>()),
  loadPosthogWebStats: (days?: WebStatsPeriodDays) => loadPosthogWebStats(days),
}))

const {
  POSTHOG_EMBED_HEADING,
  POSTHOG_EMBED_MISSING_STAFF_MESSAGE,
  VISITOR_STATS_LOADING_MESSAGE,
  VISITOR_STATS_MISSING_STAFF_MESSAGE,
  VISITOR_STATS_NOTE,
  VISITOR_STATS_STALE_MESSAGE,
  VISITOR_STATS_UNAVAILABLE_MESSAGE,
  WebAnalyticsView,
  visitorStatsHeading,
} = await import('../components/admin/WebAnalyticsView')
const { VISITOR_STATS_BLOCK_MISSING_MESSAGE, VISITOR_TABLE_EMPTY_MESSAGE } =
  await import('../components/admin/webanalitika/BreakdownTables')

/**
 * A teljes lap HTML-je, a Suspense-határ mögötti látogatói törzzsel együtt.
 * A renderToStaticMarkup a függő határ helyén csak a betöltés-szöveget adja,
 * a prerender viszont megvárja (ahogy a Next.js streamje is kiírja).
 */
async function renderFull(searchParams: Record<string, string> = {}, role = 'staff') {
  // A progressiveChunkSize nélkül a React a nagy határ tartalmát a dokumentum
  // végére tenné (rejtett div + csere-szkript); így a helyén marad.
  const { prelude } = await prerender(await WebAnalyticsView(props(role, searchParams)), {
    progressiveChunkSize: Number.POSITIVE_INFINITY,
  })
  return new Response(prelude).text()
}

function props(role = 'staff', searchParams: Record<string, string> = {}) {
  return {
    initPageResult: { req: { user: { role }, payload: {} } },
    params: {},
    searchParams,
  } as unknown as Parameters<typeof WebAnalyticsView>[0]
}

describe('Webanalitika: eladás- és haladás-összefoglaló sikeres lekérdezésből', () => {
  it('a hónap-számok az UTOLSÓ (aktuális) hónapból jönnek, az összesen a totals-ból', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props()))
    // formatHuf ezres tagolással ír (nem törhető szóközzel) — a konkrét
    // elválasztóra nem kötünk ki, a számjegy-sorrendre igen.
    expect(html.replace(/[  \s]/g, '')).toContain('239700')
    expect(html).toContain('Bevétel ebben a hónapban')
    expect(html).toContain('Fizetett rendelés ebben a hónapban')
    expect(html).toContain('Fizetett rendelés összesen')
    // A júliusi 10 000 Ft NEM szerepelhet kiemelt számként.
    expect(html.replace(/[  \s]/g, '')).not.toContain('>10000<')
  })

  it('a haladás-oszlopok kurzusonként összegződnek', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props()))
    expect(html).toContain('Kurzus-hozzáférések száma')
    expect(html).toContain('>17<')
    expect(html).toContain('Elkezdte a kurzust')
    expect(html).toContain('>11<')
    expect(html).toContain('Be is fejezte')
    expect(html).toContain('>5<')
  })
})

function row(name: string, visitors: number, views: number): WebStatsRow[] {
  return [{ name, visitors, views }]
}

/** Egy sikeres, 7 napos PostHog-válasz, ahogy a betöltő adja (magyarított nevekkel). */
const BREAKDOWNS: Record<WebStatsBreakdownKey, WebStatsRow[] | null> = {
  pages: row('/kurzusok', 30, 90),
  entryPages: row('/', 21, 25),
  exitPages: row('/kosar', 8, 9),
  channels: row('Közvetlen', 26, 77),
  referrers: row('google.com', 14, 30),
  utmSources: row('facebook', 6, 11),
  utmMediums: row('cpc', 5, 10),
  utmCampaigns: row('oszi-akcio', 4, 7),
  devices: row('Telefon', 40, 120),
  browsers: row('Chrome', 33, 100),
  os: row('Android', 22, 60),
  countries: row('Magyarország', 50, 160),
  cities: row('Budapest', 31, 95),
  languages: row('magyar', 49, 158),
}

const DAILY = [
  { date: '2026-11-01', visitors: 5, views: 12 },
  { date: '2026-11-02', visitors: 9, views: 20 },
  { date: '2026-11-03', visitors: 12, views: 41 },
  { date: '2026-11-04', visitors: 7, views: 18 },
  { date: '2026-11-05', visitors: 4, views: 9 },
  { date: '2026-11-06', visitors: 6, views: 15 },
  { date: '2026-11-07', visitors: 8, views: 22 },
]

const VISITOR_STATS: PosthogWebStats = {
  status: 'ok',
  periodDays: 7,
  fetchedAt: new Date().toISOString(),
  overview: {
    visitors: 12560,
    views: 183,
    sessions: 78,
    sessionDurationSeconds: 166.73,
    bounceRatePercent: 39.74,
  },
  daily: DAILY,
  breakdowns: BREAKDOWNS,
}

const { readEmbedHeight, POSTHOG_EMBED_FRAME_NAME } =
  await import('../components/admin/webanalitika/PosthogDashboardEmbed')

describe('Webanalitika: a PostHog saját grafikonjai beágyazva (2026-11-07)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('beállított megosztási linkkel a dashboard a látogatói szekció UTÁN, tint-sávon, embedded alakban jelenik meg', async () => {
    vi.stubEnv('POSTHOG_SHARED_DASHBOARD_URL', 'https://eu.posthog.com/shared/abcDEF123_tokenXYZ')
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const html = await renderFull({}, 'staff')
    const visitors = html.indexOf(`aria-label="${visitorStatsHeading(7)}"`)
    const embed = html.indexOf(`aria-label="${POSTHOG_EMBED_HEADING}"`)
    expect(visitors).toBeGreaterThan(-1)
    expect(embed).toBeGreaterThan(visitors)
    const section = html.slice(embed, html.indexOf('</section>', embed))
    expect(section).toContain('background:var(--kc-as-surface-tint')
    // A szerver src nélkül rendereli: a címet a kliens a figyelő után adja
    // (posthog-dashboard-embed.test.tsx).
    expect(section).toContain('<iframe')
    expect(section).not.toContain('src="https://eu.posthog.com')
    expect(section).toContain(`name="${POSTHOG_EMBED_FRAME_NAME}"`)
    expect(section).toContain('title="Folyamatok és grafikonok a PostHogból"')
  })

  it('link nélkül nincs iframe: a tulajdonos a teendőt, a munkatárs egy rövid üzenetet kap', async () => {
    vi.stubEnv('POSTHOG_SHARED_DASHBOARD_URL', '')
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const owner = await renderFull({}, 'owner')
    expect(owner).not.toContain('<iframe')
    expect(owner).toContain('<code>POSTHOG_SHARED_DASHBOARD_URL</code>')
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const staff = await renderFull({}, 'staff')
    expect(staff).not.toContain('<iframe')
    expect(staff).toContain(POSTHOG_EMBED_MISSING_STAFF_MESSAGE)
    expect(staff).not.toContain('POSTHOG_SHARED_DASHBOARD_URL')
  })

  it('a keret magassága csak a saját nevű posthog:dimensions üzenetből jön, ésszerű határok között', () => {
    const name = POSTHOG_EMBED_FRAME_NAME
    expect(readEmbedHeight({ event: 'posthog:dimensions', name, height: 2345.2 }, name)).toBe(2346)
    expect(readEmbedHeight({ event: 'posthog:dimensions', name, height: 10 }, name)).toBe(400)
    expect(readEmbedHeight({ event: 'posthog:dimensions', name, height: 1e9 }, name)).toBe(20000)
    expect(
      readEmbedHeight({ event: 'posthog:dimensions', name: 'mas', height: 900 }, name),
    ).toBeNull()
    expect(readEmbedHeight({ event: 'mas', name, height: 900 }, name)).toBeNull()
    expect(readEmbedHeight({ event: 'posthog:dimensions', name, height: '900' }, name)).toBeNull()
    expect(readEmbedHeight(null, name)).toBeNull()
  })

  it('se link-sor, se új lapra nyíló link, és a látogatói szekció tint-hátteret kap', async () => {
    for (const role of ['staff', 'owner']) {
      loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
      const html = await renderFull({}, role)
      expect(html, role).not.toContain('Külső elemző-felületek')
      expect(html, role).not.toContain('új lapon nyílik')
      expect(html, role).not.toContain('target="_blank"')
      expect(html, role).not.toContain('Látogatói viselkedés')
      const sectionTag = new RegExp(
        `<section aria-label="${visitorStatsHeading(7)}"[^>]* style="([^"]*)"`,
      ).exec(html)
      expect(sectionTag, `${role}: a látogatói szekció hiányzik`).not.toBeNull()
      expect(sectionTag![1], role).toContain('background:var(--kc-as-surface-tint')
    }
  })

  it('a felületi szövegekben nincs gondolatjel és „dashboard” szó', async () => {
    // Kulcs nélküli és sikeres PostHog-állapotban is: a diagram és a 14 tábla
    // szövege is felületi szöveg.
    for (const stats of [{ status: 'not_configured' } as const, VISITOR_STATS]) {
      loadPosthogWebStats.mockResolvedValueOnce(stats)
      const html = await renderFull({}, 'owner')
      // A környezeti változó neve kód, nem felületi szöveg.
      const text = html.replace(/<code>[^<]*<\/code>/g, ' ').replace(/<[^>]+>/g, ' ')
      expect(text, stats.status).not.toMatch(/[–—]/)
      expect(text, stats.status).not.toMatch(/dashboard/i)
    }
  })
})

/** A PostHog Web analytics bontásai a nézet csoportjaiban, a várt sorrendben. */
const EXPECTED_GROUPS: Array<[string, string[]]> = [
  ['Oldalak', ['Legnézettebb oldalak', 'Belépő oldalak', 'Kilépő oldalak']],
  [
    'Források',
    ['Érkezési csatorna', 'Hivatkozó oldalak', 'UTM forrás', 'UTM közeg', 'UTM kampány'],
  ],
  ['Eszközök', ['Eszköztípus', 'Böngésző', 'Operációs rendszer']],
  ['Földrajz', ['Ország', 'Város', 'Nyelv']],
]

/** A látogatói szekció HTML-je (a szekció végéig). */
function visitorSection(html: string, days: WebStatsPeriodDays = 7): string {
  const start = html.indexOf(`aria-label="${visitorStatsHeading(days)}"`)
  expect(start, 'a látogatói szekció hiányzik').toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

/** Egy felirattal megnevezett tábla HTML-je. */
function tableByCaption(html: string, caption: string): string {
  const match = new RegExp(`<table[^>]*><caption[^>]*>${caption}</caption>.*?</table>`).exec(html)
  expect(match, `hiányzik a(z) „${caption}” tábla`).not.toBeNull()
  return match![0]
}

function cellText(html: string): string {
  return html.replace(/<[^>]+>/g, '|').replace(/[\u00a0\u202f]/g, ' ')
}

/** Az időszak-linkek (`href` → a teljes `<a>` tag). */
function periodLinks(html: string): Map<string, string> {
  const links = html.match(/<a [^>]*href="\/admin\/webanalitika\?idoszak=[^"]*"[^>]*>[^<]*<\/a>/g)
  return new Map((links ?? []).map((link) => [/idoszak=(\d+)/.exec(link)![1], link]))
}

describe('Webanalitika: időszak-választó (7 vagy 30 nap)', () => {
  beforeEach(() => {
    loadPosthogWebStats.mockClear()
  })

  it('paraméter nélkül 7 nap: a betöltő 7-et kap, a cím és a kijelölt link is 7', async () => {
    const section = visitorSection(await renderFull({}), 7)
    expect(loadPosthogWebStats).toHaveBeenCalledExactlyOnceWith(7)
    expect(section).toContain('>Látogatók az elmúlt 7 napban</h2>')
    expect(section).toContain('Időszak:')
    const links = periodLinks(section)
    expect([...links.keys()]).toEqual(['7', '30'])
    expect(links.get('7')).toContain('aria-current="page"')
    expect(links.get('7')).toContain('>7 nap</a>')
    expect(links.get('30')).not.toContain('aria-current')
    expect(links.get('30')).toContain('>30 nap</a>')
  })

  it('?idoszak=30: a betöltő 30-at kap, a cím 30 napot mond, a 30-as link a kijelölt', async () => {
    loadPosthogWebStats.mockResolvedValueOnce({ ...VISITOR_STATS, periodDays: 30 })
    const html = await renderFull({ idoszak: '30' })
    expect(loadPosthogWebStats).toHaveBeenCalledExactlyOnceWith(30)
    const section = visitorSection(html, 30)
    expect(section).toContain('>Látogatók az elmúlt 30 napban</h2>')
    expect(html).not.toContain('Látogatók az elmúlt 7 napban')
    const links = periodLinks(section)
    expect(links.get('30')).toContain('aria-current="page"')
    expect(links.get('7')).not.toContain('aria-current')
  })

  it('az időszak-linkek legalább 44 px magas célfelületek', async () => {
    for (const link of periodLinks(visitorSection(await renderFull({}))).values()) {
      expect(link).toContain('min-height:44px')
      expect(link).toContain('min-width:44px')
    }
  })
})

describe('Webanalitika: látogatói számok a PostHogból', () => {
  it('az eladás-szekció UTÁN áll', async () => {
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const html = await renderFull()
    const sales = html.indexOf('aria-label="Eladások és kurzushaladás"')
    const visitors = html.indexOf(`aria-label="${visitorStatsHeading(7)}"`)
    expect(sales).toBeGreaterThan(-1)
    expect(visitors).toBeGreaterThan(sales)
  })

  it('lassú PostHog mellett a lap többi része azonnal megjelenik, a számok helyén betöltés-szöveg', async () => {
    loadPosthogWebStats.mockReturnValueOnce(new Promise<PosthogWebStats>(() => {}))
    const html = renderToStaticMarkup(await WebAnalyticsView(props()))
    expect(html).toContain('Bevétel ebben a hónapban')
    const section = visitorSection(html)
    expect(section).toContain('Időszak:')
    expect(section).toMatch(
      new RegExp(`<p role="status"[^>]*>${VISITOR_STATS_LOADING_MESSAGE}</p>`),
    )
    expect(section).not.toContain('kc-as-card')
  })

  it('öt kártya magyar formázással', async () => {
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const section = visitorSection(await renderFull())
    const text = cellText(section)
    for (const [label, value] of [
      ['Látogatók', '12 560'],
      ['Oldalmegtekintések', '183'],
      ['Munkamenetek', '78'],
      ['Átlagos munkamenet-hossz', '2 perc 47 mp'],
      ['Visszafordulási arány', '39,7%'],
    ]) {
      expect(text, label).toContain(`|${value}||${label}|`)
    }
    expect(section).toContain(VISITOR_STATS_NOTE)
    expect(section).toContain('Utolsó frissítés:')
    expect(section).not.toContain(VISITOR_STATS_STALE_MESSAGE)
  })

  it('napi diagram: akadálymentes név, pontonként egy-egy jelölő, és táblázatos változat', async () => {
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const section = visitorSection(await renderFull())
    const svg = /<svg [^>]*role="img"[^>]*>.*?<\/svg>/.exec(section)?.[0]
    expect(svg, 'a napi diagram hiányzik').toBeDefined()
    const name = /aria-label="([^"]*)"/.exec(svg!)![1]
    expect(name).toBe(
      'Napi látogatók és oldalmegtekintések vonaldiagramja, nov. 1. és nov. 7. között. A legtöbb látogató egy napon: 12 (nov. 3.). A legtöbb megtekintés egy napon: 41 (nov. 3.).',
    )
    expect(svg).toContain(`<title>${name}</title>`)
    expect(svg!.match(/data-sor="latogato"/g)).toHaveLength(DAILY.length)
    expect(svg!.match(/data-sor="megtekintes"/g)).toHaveLength(DAILY.length)
    // A jelölőnél szélesebb egérsáv napi címkéje mindkét számot kimondja.
    expect(svg).toContain('<title>nov. 3.: 12 látogató, 41 megtekintés</title>')
    // Jelmagyarázat (két sor, nem csak szín) és lenyitható adattábla.
    expect(section).toMatch(/<\/svg>Látogatók<\/span>.*<\/svg>Megtekintések<\/span>/)
    const table = tableByCaption(section, 'Napi látogatók és megtekintések')
    expect(table.match(/<tr>/g)).toHaveLength(DAILY.length + 1)
    expect(cellText(table)).toContain('|nov. 3.||12||41|')
  })

  it('mind a 14 bontás saját feliratú táblában, a PostHog csoportjai szerint', async () => {
    loadPosthogWebStats.mockResolvedValueOnce(VISITOR_STATS)
    const section = visitorSection(await renderFull())
    const groups = [...section.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1])
    expect(groups).toEqual(['Napi látogatók és megtekintések', ...EXPECTED_GROUPS.map(([g]) => g)])
    const captions = [...section.matchAll(/<caption[^>]*>([^<]*)<\/caption>/g)].map((m) => m[1])
    expect(captions).toEqual([
      'Napi látogatók és megtekintések',
      ...EXPECTED_GROUPS.flatMap(([, list]) => list),
    ])
    expect(cellText(tableByCaption(section, 'Legnézettebb oldalak'))).toContain(
      '|/kurzusok||30||90|',
    )
    expect(cellText(tableByCaption(section, 'Hivatkozó oldalak'))).toContain('|google.com||14||30|')
    expect(cellText(tableByCaption(section, 'UTM kampány'))).toContain('|oszi-akcio||4||7|')
    expect(cellText(tableByCaption(section, 'Operációs rendszer'))).toContain('|Android||22||60|')
    expect(cellText(tableByCaption(section, 'Nyelv'))).toContain('|magyar||49||158|')
    for (const table of section.match(/<table[^>]*>.*?<\/table>/g) ?? []) {
      expect(table).toMatch(
        /<th scope="col"[^>]*>Látogatók<\/th><th scope="col"[^>]*>Megtekintések<\/th>/,
      )
    }
  })

  it('a hiányzó blokk és az üres blokk külön üzenetet kap, a többi tábla megmarad', async () => {
    loadPosthogWebStats.mockResolvedValueOnce({
      ...VISITOR_STATS,
      daily: null,
      breakdowns: { ...BREAKDOWNS, cities: null, languages: [] },
    })
    const section = visitorSection(await renderFull())
    expect(section).not.toContain('role="img"')
    expect(section).toMatch(
      new RegExp(
        `>Napi látogatók és megtekintések</h3><p [^>]*>${VISITOR_STATS_BLOCK_MISSING_MESSAGE}</p>`,
      ),
    )
    const cities = tableByCaption(section, 'Város')
    expect(cities).toContain(VISITOR_STATS_BLOCK_MISSING_MESSAGE)
    expect(cities).not.toContain(VISITOR_TABLE_EMPTY_MESSAGE)
    const languages = tableByCaption(section, 'Nyelv')
    expect(languages).toContain(VISITOR_TABLE_EMPTY_MESSAGE)
    expect(languages).not.toContain(VISITOR_STATS_BLOCK_MISSING_MESSAGE)
    expect(cellText(tableByCaption(section, 'Ország'))).toContain('|Magyarország||50||160|')
  })

  it('üres napi sorból nem rajzol diagramot, az üres-üzenet áll a helyén', async () => {
    loadPosthogWebStats.mockResolvedValueOnce({ ...VISITOR_STATS, daily: [] })
    const section = visitorSection(await renderFull())
    expect(section).not.toContain('role="img"')
    expect(section).toMatch(
      new RegExp(
        `>Napi látogatók és megtekintések</h3><p [^>]*>${VISITOR_TABLE_EMPTY_MESSAGE}</p>`,
      ),
    )
  })

  it('a gyorsítótárban ragadt régi adatot nem mutatja frissnek', async () => {
    loadPosthogWebStats.mockResolvedValueOnce({
      ...VISITOR_STATS,
      fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    } as PosthogWebStats)
    const section = visitorSection(await renderFull())
    expect(section).toContain(VISITOR_STATS_STALE_MESSAGE)
    expect(section.match(/<caption/g)).toHaveLength(15)
  })

  it('kulcs nélkül a tulajdonos a beállítás módját kapja, a munkatárs a teendőt', async () => {
    const owner = visitorSection(await renderFull({}, 'owner'))
    expect(owner).toContain('<code>POSTHOG_PERSONAL_API_KEY</code>')
    expect(owner).toContain('Query read')
    expect(owner).not.toContain(VISITOR_STATS_MISSING_STAFF_MESSAGE)

    const staff = visitorSection(await renderFull({}, 'staff'))
    expect(staff).toContain(VISITOR_STATS_MISSING_STAFF_MESSAGE)
    expect(staff).not.toContain('POSTHOG_PERSONAL_API_KEY')
    expect(staff).not.toContain('<table')
  })

  it('elérhetetlen PostHognál magyar magyarázat áll, kártya, diagram és tábla nélkül', async () => {
    loadPosthogWebStats.mockResolvedValueOnce({ status: 'unavailable' })
    const section = visitorSection(await renderFull({}, 'owner'))
    expect(section).toContain(VISITOR_STATS_UNAVAILABLE_MESSAGE)
    expect(section).not.toContain('kc-as-card')
    expect(section).not.toContain('<svg')
    expect(section).not.toContain('<table')
  })
})
