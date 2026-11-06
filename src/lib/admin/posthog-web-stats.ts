import { unstable_cache } from 'next/cache'

import { logger } from '../logger'
import { POSTHOG_EMBED_ORIGIN, POSTHOG_PROJECT_ID } from './web-analytics-config'

/**
 * A Webanalitika admin-nézet látogatói számai a PostHog Query API-ból.
 *
 * A tulajdonos kérése (2026-11-06): a PostHog webanalitika-számai az adminban,
 * saját kártyákon és táblákon, magyar címkékkel jelenjenek meg, ne csak a
 * megosztott kimutatás iframe-jében. Ez a modul tiszta szerveroldali kód,
 * React nélkül: lekérdez, ellenőriz, és a nézetnek kész adatot ad.
 *
 * ═══ HITELESÍTÉS ═══
 * `POSTHOG_PERSONAL_API_KEY`: PostHog személyes API-kulcs, kizárólag
 * `query:read` jogosultsággal, a KinetiCare projektre szűkítve. TITOK: csak a
 * Railway változói között él, a naplóba, a válaszba és a gyorsítótár
 * kulcsába sem kerülhet. Hiányában nincs hálózati hívás, a nézet a
 * beüzemelési útmutatót mutatja (`not_configured`).
 *
 * ═══ VÉGPONT ═══
 * `POST https://eu.posthog.com/api/projects/253152/query/`,
 * `Authorization: Bearer <kulcs>`, törzs: `{ "query": {...}, "name": "..." }`
 * (PostHog, Query API: https://posthog.com/docs/api/query és
 * https://posthog.com/docs/api/queries). A host és a projekt FIX, nem env-ből
 * jön: a kulcs így más hostra nem szivároghat.
 *
 * ═══ GYORSÍTÓTÁR ═══
 * A Next a POST-kérést nem teszi a fetch-adatgyorsítótárba, a repóban pedig
 * nincs bekapcsolva a Cache Components (`'use cache'`), ezért az út a
 * `unstable_cache` 300 mp-es `revalidate`-tel (Next 16 dokumentáció,
 * „Caching without Cache Components”:
 * https://nextjs.org/docs/app/guides/caching-without-cache-components).
 * Így az admin-betöltések legfeljebb ötpercenként érik el a PostHogot (a
 * projekt-szintű korlát 240 kérés percenként és 3 párhuzamos lekérdezés).
 * A teljes kudarc DOB a gyorsítótárazott függvényben: a dobott hibát a Next
 * nem tárolja, így egy kimaradás nem ragad be öt percre.
 *
 * ═══ HIBATŰRÉS ═══
 * Minden blokk (összesítő, oldalak, csatornák, eszközök) külön érvényesül:
 * a hibás vagy váratlan alakú blokk `null` lesz, a többi megjelenik. A
 * válaszok minden értékét típusőr ellenőrzi; a hiba `logger.warn`-ba megy, a
 * kulcs és a válasz törzse nélkül.
 */

/** A PostHog Query API végpontja (EU-cloud, KinetiCare projekt). */
function posthogQueryUrl(): string {
  return `${POSTHOG_EMBED_ORIGIN}/api/projects/${POSTHOG_PROJECT_ID}/query/`
}

/**
 * A négy lekérdezés KÖZÖS határideje. A PostHog maga 10 mp végrehajtási időt
 * enged. Közös, nem kérésenkénti: hideg gyorsítótárnál lassú PostHog mellett
 * sem tarthatja fel a nézetet (és vele az adatbázis-számokat) 8 mp-nél tovább.
 */
const REQUEST_DEADLINE_MS = 8_000

/** A gyorsítótár frissessége másodpercben (a nézet megjegyzése: 5 perc). */
export const POSTHOG_WEB_STATS_REVALIDATE_SECONDS = 300

/** A táblák sorainak száma. */
const TABLE_LIMIT = 5

/**
 * Az oldal-táblához ennyi sort kérünk, és helyben rendezzük megtekintés
 * szerint. A PostHog a WebStatsTableQuery-t alapból látogatószám szerint
 * rendezi, így 5-ös limitnél kieshetne a legnézettebb oldal. Az `orderBy`
 * mezőt az API itt elérhető sémája nem mutatja, ezért nem küldjük.
 */
const PAGES_FETCH_LIMIT = 20

/**
 * Ennél régebbi gyorsítótár-adatnál a nézet jelzi, hogy a frissítés elakadt.
 * Az `unstable_cache` sikertelen újraérvényesítésnél a régi értéket adja
 * tovább (stale-while-revalidate), ezt a lekérés időpontja teszi láthatóvá.
 */
export const POSTHOG_WEB_STATS_STALE_AFTER_MS = 15 * 60 * 1000

const DATE_RANGE = { date_from: '-7d' } as const

export interface WebOverview {
  visitors: number | null
  views: number | null
  sessions: number | null
  /** Átlagos munkamenet-hossz másodpercben. */
  sessionDurationSeconds: number | null
  /** Visszafordulási arány százalékban (0–100). */
  bounceRatePercent: number | null
}

export interface WebStatsRow {
  name: string
  visitors: number
  views: number
}

export interface WebStatsData {
  /** A PostHog-lekérés időpontja (ISO 8601). */
  fetchedAt: string
  overview: WebOverview | null
  pages: WebStatsRow[] | null
  channels: WebStatsRow[] | null
  devices: WebStatsRow[] | null
}

export type PosthogWebStats =
  { status: 'not_configured' } | { status: 'unavailable' } | ({ status: 'ok' } & WebStatsData)

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  Direct: 'Közvetlen',
  'Organic Search': 'Organikus keresés',
  'Paid Search': 'Fizetett keresés',
  'Organic Social': 'Közösségi média',
  'Paid Social': 'Fizetett közösségi',
  Referral: 'Hivatkozó oldal',
  Email: 'E-mail',
  AI: 'MI-asszisztens',
  Unknown: 'Ismeretlen',
}

const DEVICE_LABELS: Readonly<Record<string, string>> = {
  Desktop: 'Számítógép',
  Mobile: 'Telefon',
  Tablet: 'Tablet',
}

/** A PostHog csatornanevének magyar alakja; az ismeretlen név változatlan marad. */
export function channelLabelHu(value: string): string {
  return CHANNEL_LABELS[value] ?? value
}

/** A PostHog eszköztípusának magyar alakja; az ismeretlen név változatlan marad. */
export function deviceLabelHu(value: string): string {
  return DEVICE_LABELS[value] ?? value
}

/** Munkamenet-hossz magyarul: „47 mp”, „2 perc 47 mp”, „1 óra 5 perc”. */
export function formatDurationHu(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return minutes > 0 ? `${hours} óra ${minutes} perc` : `${hours} óra`
  }
  if (minutes > 0) {
    return secs > 0 ? `${minutes} perc ${secs} mp` : `${minutes} perc`
  }
  return `${secs} mp`
}

/** Százalék egy tizedesre, magyar tizedesvesszővel: 39.74 → „39,7%”. */
export function formatPercentHu(percent: number): string {
  return `${percent.toLocaleString('hu-HU', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
}

/** Darabszám magyar ezres tagolással. */
export function formatCountHu(value: number): string {
  return value.toLocaleString('hu-HU')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Egy cella száma: szám, vagy `[aktuális, előző]` pár (az előzőt figyelmen kívül hagyjuk). */
function countCell(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value
  }
  if (Array.isArray(value) && value.length >= 1 && isFiniteNumber(value[0])) {
    return value[0]
  }
  return null
}

/** WebOverviewQuery válasz → összesítő, vagy null, ha az alak nem a várt. */
export function parseWebOverview(body: unknown): WebOverview | null {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return null
  }
  const values = new Map<string, number | null>()
  for (const item of body.results) {
    if (!isRecord(item) || typeof item.key !== 'string') {
      return null
    }
    const value = item.value
    if (value !== null && !isFiniteNumber(value)) {
      return null
    }
    values.set(item.key.replace(/_/g, ' ').toLowerCase(), value)
  }
  const required = ['visitors', 'views', 'sessions', 'session duration', 'bounce rate']
  if (!required.every((key) => values.has(key))) {
    return null
  }
  return {
    visitors: values.get('visitors') ?? null,
    views: values.get('views') ?? null,
    sessions: values.get('sessions') ?? null,
    sessionDurationSeconds: values.get('session duration') ?? null,
    bounceRatePercent: values.get('bounce rate') ?? null,
  }
}

function columnIndex(columns: unknown[], name: string): number {
  const pattern = new RegExp(`(^|\\.)${name}$`)
  return columns.findIndex((column) => typeof column === 'string' && pattern.test(column))
}

/**
 * WebStatsTableQuery válasz → sorok, vagy null, ha az alak nem a várt.
 * Az oszlopokat NÉV szerint keressük, mert a választható oszlopok (pl.
 * visszafordulási arány) eltolják a pozíciókat.
 */
export function parseWebStatsTable(
  body: unknown,
  translate: (value: string) => string = (value) => value,
): WebStatsRow[] | null {
  if (!isRecord(body) || !Array.isArray(body.columns) || !Array.isArray(body.results)) {
    return null
  }
  const nameIndex = columnIndex(body.columns, 'breakdown_value')
  const visitorsIndex = columnIndex(body.columns, 'visitors')
  const viewsIndex = columnIndex(body.columns, 'views')
  if (nameIndex < 0 || visitorsIndex < 0 || viewsIndex < 0) {
    return null
  }
  const rows: WebStatsRow[] = []
  for (const row of body.results) {
    if (!Array.isArray(row)) {
      return null
    }
    const rawName = row[nameIndex]
    if (rawName !== null && typeof rawName !== 'string') {
      return null
    }
    const visitors = countCell(row[visitorsIndex])
    const views = countCell(row[viewsIndex])
    if (visitors === null || views === null) {
      return null
    }
    const name = rawName === null || rawName.trim() === '' ? 'Unknown' : rawName
    rows.push({ name: translate(name), visitors, views })
  }
  return rows
}

function readApiKey(): string | null {
  const raw = process.env.POSTHOG_PERSONAL_API_KEY
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value.length > 0 ? value : null
}

type Block = 'overview' | 'pages' | 'channels' | 'devices'

/** Egy lekérdezés futtatása; hibánál null + figyelmeztetés (kulcs és törzs nélkül). */
async function runQuery(
  apiKey: string,
  block: Block,
  query: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(posthogQueryUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, name: `kineticare-admin-webanalitika-${block}` }),
      signal,
    })
  } catch (error) {
    logger.warn('posthog-webstat: a lekérdezés nem futott le', {
      block,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return null
  }
  if (!response.ok) {
    logger.warn('posthog-webstat: a PostHog hibát adott', { block, status: response.status })
    return null
  }
  try {
    return (await response.json()) as unknown
  } catch {
    logger.warn('posthog-webstat: a válasz nem JSON', { block })
    return null
  }
}

function warnIfMalformed<T>(block: Block, body: unknown, parsed: T | null): T | null {
  if (body !== null && parsed === null) {
    logger.warn('posthog-webstat: a válasz alakja nem a várt', { block })
  }
  return parsed
}

/** Megtekintés szerint csökkenő sorrend (holtversenyben látogató szerint), az első 5. */
function mostViewedFirst(rows: WebStatsRow[]): WebStatsRow[] {
  return [...rows]
    .sort((a, b) => b.views - a.views || b.visitors - a.visitors)
    .slice(0, TABLE_LIMIT)
}

/** Igaz, ha a lekérés régebbi a frissességi küszöbnél (vagy az időpont olvashatatlan). */
export function isWebStatsStale(fetchedAt: string, now: number = Date.now()): boolean {
  const time = Date.parse(fetchedAt)
  return Number.isNaN(time) || now - time > POSTHOG_WEB_STATS_STALE_AFTER_MS
}

/** A lekérés időpontja budapesti idő szerint, pl. „nov. 6. 21:20”. */
export function formatFetchedAtHu(fetchedAt: string): string {
  const time = Date.parse(fetchedAt)
  if (Number.isNaN(time)) {
    return 'ismeretlen időpont'
  }
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time)
}

function tableQuery(breakdownBy: string, limit: number = TABLE_LIMIT) {
  return {
    kind: 'WebStatsTableQuery',
    breakdownBy,
    dateRange: DATE_RANGE,
    filterTestAccounts: true,
    limit,
    properties: [],
  }
}

async function fetchWebStats(apiKey: string): Promise<WebStatsData> {
  // Előbb az összesítő, utána a három tábla együtt: így egyszerre legfeljebb
  // három lekérdezés fut, a PostHog projekt-szintű párhuzamossági korlátja.
  const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS)
  const overviewBody = await runQuery(
    apiKey,
    'overview',
    {
      kind: 'WebOverviewQuery',
      dateRange: DATE_RANGE,
      filterTestAccounts: true,
      properties: [],
    },
    signal,
  )
  const [pagesBody, channelsBody, devicesBody] = await Promise.all([
    runQuery(apiKey, 'pages', tableQuery('Page', PAGES_FETCH_LIMIT), signal),
    runQuery(apiKey, 'channels', tableQuery('InitialChannelType'), signal),
    runQuery(apiKey, 'devices', tableQuery('DeviceType'), signal),
  ])
  const pages = warnIfMalformed('pages', pagesBody, parseWebStatsTable(pagesBody))
  return {
    fetchedAt: new Date().toISOString(),
    overview: warnIfMalformed('overview', overviewBody, parseWebOverview(overviewBody)),
    pages: pages === null ? null : mostViewedFirst(pages),
    channels: warnIfMalformed(
      'channels',
      channelsBody,
      parseWebStatsTable(channelsBody, channelLabelHu),
    ),
    devices: warnIfMalformed(
      'devices',
      devicesBody,
      parseWebStatsTable(devicesBody, deviceLabelHu),
    ),
  }
}

/**
 * A gyorsítótárazott lekérdezés. A kulcsot a függvény MAGA olvassa: argumentum
 * a gyorsítótár kulcsába kerülne. Ha egyik blokk sem sikerült, dob, hogy a
 * kudarc ne kerüljön a gyorsítótárba.
 */
const cachedWebStats = unstable_cache(
  async (): Promise<WebStatsData> => {
    const apiKey = readApiKey()
    if (apiKey === null) {
      throw new Error('POSTHOG_PERSONAL_API_KEY hiányzik')
    }
    const data = await fetchWebStats(apiKey)
    if (
      data.overview === null &&
      data.pages === null &&
      data.channels === null &&
      data.devices === null
    ) {
      throw new Error('a PostHog egyik blokkot sem adta vissza')
    }
    return data
  },
  ['admin-posthog-web-stats-v2'],
  { revalidate: POSTHOG_WEB_STATS_REVALIDATE_SECONDS },
)

/** A nézet belépési pontja: soha nem dob. */
export async function loadPosthogWebStats(): Promise<PosthogWebStats> {
  if (readApiKey() === null) {
    return { status: 'not_configured' }
  }
  try {
    return { status: 'ok', ...(await cachedWebStats()) }
  } catch (error) {
    logger.warn('posthog-webstat: a látogatói számok nem érhetők el', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return { status: 'unavailable' }
  }
}
