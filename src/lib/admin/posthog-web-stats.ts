import { unstable_cache } from 'next/cache'

import { logger } from '../logger'
import { POSTHOG_EMBED_ORIGIN, POSTHOG_PROJECT_ID } from './web-analytics-config'

/**
 * A Webanalitika admin-nézet látogatói számai a PostHog Query API-ból.
 *
 * A tulajdonos kérése (2026-11-06): a PostHog webanalitika-számai az adminban,
 * saját kártyákon és táblákon, magyar címkékkel jelenjenek meg, ne csak a
 * megosztott kimutatás iframe-jében. Bővítés (2026-11-07): „Lehessen
 * választani 7 és 30 nap között. Minden adatot meg akarnék itt jeleníteni
 * arról az analitikus boardról ami van PostHognak”. Ezért a modul a PostHog
 * Web analytics tábláinak mindegyikét lekéri (oldalak, belépő és kilépő
 * oldalak, csatornák, hivatkozók, UTM-ek, eszközök, böngészők, rendszerek,
 * országok, városok, nyelvek), napi bontással együtt, 7 vagy 30 napra. Tiszta
 * szerveroldali kód, React nélkül: lekérdez, ellenőriz, és a nézetnek kész
 * adatot ad.
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
 * ═══ PÁRHUZAMOSSÁG ÉS HATÁRIDŐ ═══
 * A PostHog projektenként legfeljebb 3 párhuzamos lekérdezést enged (és 240
 * kérést percenként). A 16 lekérdezés ezért egy 3 helyes sorból indul, és
 * egyetlen, közös 15 mp-es határidő alatt fut: lassú PostHog mellett sem
 * tarthatja fel a nézetet (és vele az adatbázis-számokat) ennél tovább. A
 * határidő után induló kérések azonnal megszakadnak, a blokkjuk `null`.
 *
 * ═══ GYORSÍTÓTÁR ═══
 * A Next a POST-kérést nem teszi a fetch-adatgyorsítótárba, a repóban pedig
 * nincs bekapcsolva a Cache Components (`'use cache'`), ezért az út a
 * `unstable_cache` 300 mp-es `revalidate`-tel (Next 16 dokumentáció,
 * „Caching without Cache Components”:
 * https://nextjs.org/docs/app/guides/caching-without-cache-components).
 * Az időszak (7 vagy 30) a gyorsítótárazott függvény ARGUMENTUMA, így a
 * kulcs része: a két időszak külön bejegyzés. Ez nem titok; a kulcsot a
 * függvény maga olvassa, sosem argumentum. Így az admin-betöltések
 * időszakonként legfeljebb ötpercenként érik el a PostHogot. A teljes
 * kudarc DOB a gyorsítótárazott függvényben: a dobott hibát a Next nem
 * tárolja, így egy kimaradás nem ragad be öt percre.
 *
 * ═══ HIBATŰRÉS ═══
 * Minden blokk (összesítő, napi bontás, minden tábla) külön érvényesül: a
 * hibás vagy váratlan alakú blokk `null` lesz, a többi megjelenik. A
 * válaszok minden értékét típusőr ellenőrzi; a hiba `logger.warn`-ba megy, a
 * blokk nevével és a státusszal vagy hibanévvel, a kulcs és a válasz törzse
 * nélkül.
 */

/** A PostHog Query API végpontja (EU-cloud, KinetiCare projekt). */
function posthogQueryUrl(): string {
  return `${POSTHOG_EMBED_ORIGIN}/api/projects/${POSTHOG_PROJECT_ID}/query/`
}

/**
 * Az összes lekérdezés KÖZÖS határideje. A PostHog maga 10 mp végrehajtási
 * időt enged egy lekérdezésnek; 16 lekérdezés 3-asával kb. hat kör.
 */
const REQUEST_DEADLINE_MS = 15_000

/** Egyszerre ennyi lekérdezés fut (a PostHog projekt-szintű korlátja). */
const MAX_CONCURRENT_QUERIES = 3

/** A gyorsítótár frissessége másodpercben (a nézet megjegyzése: 5 perc). */
export const POSTHOG_WEB_STATS_REVALIDATE_SECONDS = 300

/**
 * Ennél régebbi gyorsítótár-adatnál a nézet jelzi, hogy a frissítés elakadt.
 * Az `unstable_cache` sikertelen újraérvényesítésnél a régi értéket adja
 * tovább (stale-while-revalidate), ezt a lekérés időpontja teszi láthatóvá.
 */
export const POSTHOG_WEB_STATS_STALE_AFTER_MS = 15 * 60 * 1000

/** A táblák sorainak száma. */
export const WEB_STATS_TABLE_LIMIT = 10

/** A naptári napok időzónája (a napi bontás és a nézet dátumai). */
const BUDAPEST_TZ = 'Europe/Budapest'

/** A választható időszak napokban. */
export type WebStatsPeriodDays = 7 | 30

export const WEB_STATS_PERIODS: readonly WebStatsPeriodDays[] = [7, 30]

/**
 * Az `idoszak` keresési paraméter értelmezése. Csak a pontos `'30'` ad 30
 * napot; minden más (hiány, `'7'`, `'365'`, szemét) 7 nap. Tömbnél (ismételt
 * paraméter) az ELSŐ elem számít, ahogy az `URLSearchParams.get` is az elsőt
 * adja.
 */
export function parseWebStatsPeriod(raw: unknown): WebStatsPeriodDays {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw
  return value === '30' ? 30 : 7
}

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

/** Egy budapesti naptári nap látogatói és oldalmegtekintései. */
export interface WebStatsDailyPoint {
  /** `YYYY-MM-DD`, Europe/Budapest. */
  date: string
  visitors: number
  views: number
}

export type WebStatsBreakdownKey =
  | 'pages'
  | 'entryPages'
  | 'exitPages'
  | 'channels'
  | 'referrers'
  | 'utmSources'
  | 'utmMediums'
  | 'utmCampaigns'
  | 'devices'
  | 'browsers'
  | 'os'
  | 'countries'
  | 'cities'
  | 'languages'

export const WEB_STATS_BREAKDOWN_KEYS: readonly WebStatsBreakdownKey[] = [
  'pages',
  'entryPages',
  'exitPages',
  'channels',
  'referrers',
  'utmSources',
  'utmMediums',
  'utmCampaigns',
  'devices',
  'browsers',
  'os',
  'countries',
  'cities',
  'languages',
]

export interface WebStatsData {
  periodDays: WebStatsPeriodDays
  /** A PostHog-lekérés időpontja (ISO 8601). */
  fetchedAt: string
  overview: WebOverview | null
  daily: WebStatsDailyPoint[] | null
  breakdowns: Record<WebStatsBreakdownKey, WebStatsRow[] | null>
}

export type PosthogWebStats =
  { status: 'not_configured' } | { status: 'unavailable' } | ({ status: 'ok' } & WebStatsData)

const UNKNOWN_LABEL = 'Ismeretlen'

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  Direct: 'Közvetlen',
  'Organic Search': 'Organikus keresés',
  'Paid Search': 'Fizetett keresés',
  'Organic Social': 'Közösségi média',
  'Paid Social': 'Fizetett közösségi',
  Referral: 'Hivatkozó oldal',
  Email: 'E-mail',
  AI: 'MI-asszisztens',
  Unknown: UNKNOWN_LABEL,
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

/** A hivatkozó domain: a PostHog `$direct` jelölése „Közvetlen”. */
function referrerLabelHu(value: string): string {
  return value === '$direct' ? 'Közvetlen' : value
}

function displayName(type: 'region' | 'language', code: string): string | null {
  try {
    const name = new Intl.DisplayNames(['hu'], { type, fallback: 'none' }).of(code)
    return typeof name === 'string' && name.length > 0 ? name : null
  } catch {
    // Érvénytelen kód (RangeError): a nyers értéket mutatjuk.
    return null
  }
}

/** Kétbetűs országkód magyar neve („HU” → „Magyarország”); más érték változatlan. */
function countryLabelHu(value: string): string {
  return /^[A-Za-z]{2}$/.test(value) ? (displayName('region', value.toUpperCase()) ?? value) : value
}

/**
 * Nyelvkód magyar neve („hu-HU” → „magyar (Magyarország)”). A PostHog élő
 * adatában csonka kód is van (`de-`, 2026-11-07), a záró kötőjelet levágjuk.
 */
function languageLabelHu(value: string): string {
  const code = value.replace(/-+$/, '')
  return code.length > 0 ? (displayName('language', code) ?? value) : value
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
function parseWebOverview(body: unknown): WebOverview | null {
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

/** Üres vagy hiányzó szöveg → null (a címke ilyenkor „Ismeretlen”). */
function blankToNull(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value
}

/**
 * Egy táblasor nevének értelmezése: `undefined`, ha a cella alakja váratlan
 * (az egész blokk elvetendő), különben a megjelenítendő név.
 */
type NameCell = (raw: unknown) => string | undefined

/**
 * A UTM-tábláknál az üres érték nem ismeretlen forrás, hanem címke nélküli
 * látogatás (élesben a sorok kb. 99%-a), ezért külön felirat jár neki.
 */
export const NO_UTM_LABEL = 'Nincs UTM-címke'

/** Szöveges név (vagy null) magyar címkével; az üres név alapból „Ismeretlen”. */
function textName(
  label: (value: string) => string = (value) => value,
  emptyLabel: string = UNKNOWN_LABEL,
): NameCell {
  return (raw) => {
    if (raw !== null && typeof raw !== 'string') {
      return undefined
    }
    const value = blankToNull(raw)
    return value === null ? emptyLabel : label(value)
  }
}

/**
 * A `City` bontás neve az élő válaszban `[országkód, város]` pár (a város
 * lehet null, 2026-11-07-i minta: `["HU", "Budapest"]`, `["HU", null]`).
 * Megjelenítés: „Budapest (Magyarország)”, „Ismeretlen (Magyarország)”.
 * Sima szöveget is elfogadunk, ha a PostHog egyszer egyszerűsítené.
 */
const cityName: NameCell = (raw) => {
  if (raw === null || typeof raw === 'string') {
    return blankToNull(raw) ?? UNKNOWN_LABEL
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined
  }
  const parts = raw as unknown[]
  if (!parts.every((part) => part === null || typeof part === 'string')) {
    return undefined
  }
  const country = parts.length > 1 ? blankToNull(parts[0] as string | null) : null
  const city = blankToNull(parts[parts.length - 1] as string | null) ?? UNKNOWN_LABEL
  return country === null ? city : `${city} (${countryLabelHu(country)})`
}

/**
 * Táblaválasz (WebStatsTableQuery vagy a HogQL-oldallista) → sorok, vagy
 * null, ha az alak nem a várt. Az oszlopokat NÉV szerint keressük, mert a
 * választható oszlopok eltolják a pozíciókat, és a `Language` bontás élő
 * válaszából a `ui_fill_fraction` cella hiányzik (2026-11-07).
 */
function parseTable(body: unknown, name: NameCell): WebStatsRow[] | null {
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
    const label = name(row[nameIndex])
    const visitors = countCell(row[visitorsIndex])
    const views = countCell(row[viewsIndex])
    if (label === undefined || visitors === null || views === null) {
      return null
    }
    rows.push({ name: label, visitors, views })
  }
  return rows
}

const DAY_PATTERN = /^(\d{4}-\d{2}-\d{2})/

/** A mai budapesti naptári nap `YYYY-MM-DD` alakban. */
function budapestToday(now: number): string {
  // Az en-CA területi beállítás ISO-sorrendű dátumot ad: 2026-11-07.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUDAPEST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Az időszak napjai a legrégebbitől a maiig (a mai nap is benne, részlegesen). */
function periodDays(periodDays: WebStatsPeriodDays, now: number): string[] {
  const [year, month, day] = budapestToday(now).split('-').map(Number)
  return Array.from({ length: periodDays }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day - (periodDays - 1 - index))).toISOString().slice(0, 10),
  )
}

/**
 * A napi HogQL-válasz → pontosan `periodDays` pont, a hiányzó napok nullával.
 * Az időszakon kívüli sort (óraeltérés éjfélkor) figyelmen kívül hagyjuk.
 */
function parseDaily(
  body: unknown,
  days: WebStatsPeriodDays,
  now: number,
): WebStatsDailyPoint[] | null {
  if (!isRecord(body) || !Array.isArray(body.columns) || !Array.isArray(body.results)) {
    return null
  }
  const dayIndex = columnIndex(body.columns, 'day')
  const visitorsIndex = columnIndex(body.columns, 'visitors')
  const viewsIndex = columnIndex(body.columns, 'views')
  if (dayIndex < 0 || visitorsIndex < 0 || viewsIndex < 0) {
    return null
  }
  const byDay = new Map<string, { visitors: number; views: number }>()
  for (const row of body.results) {
    if (!Array.isArray(row)) {
      return null
    }
    const rawDay = row[dayIndex]
    const match = typeof rawDay === 'string' ? DAY_PATTERN.exec(rawDay) : null
    const visitors = countCell(row[visitorsIndex])
    const views = countCell(row[viewsIndex])
    if (match === null || visitors === null || views === null) {
      return null
    }
    byDay.set(match[1], { visitors, views })
  }
  return periodDays(days, now).map((date) => ({
    date,
    visitors: byDay.get(date)?.visitors ?? 0,
    views: byDay.get(date)?.views ?? 0,
  }))
}

function readApiKey(): string | null {
  const raw = process.env.POSTHOG_PERSONAL_API_KEY
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value.length > 0 ? value : null
}

type Block = 'overview' | 'daily' | WebStatsBreakdownKey

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
    timeZone: BUDAPEST_TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time)
}

/**
 * A „Legnézettebb oldalak” HogQL-lekérdezése. A WebStatsTableQuery a sorokat
 * látogatószám szerint rendezi és vágja le, így bármilyen helyi rendezés
 * előtt kieshetne egy kevés látogatójú, de sokszor megnyitott oldal. Itt a
 * PostHog maga rendez megtekintés szerint. A `{filters}` helyőrzőt a
 * `filters.filterTestAccounts` tölti ki (belső és teszt-forgalom nélkül).
 * Az oszlopnevek a WebStatsTableQuery-éval egyeznek, így ugyanaz az
 * értelmező olvassa.
 */
/**
 * Az időszak KÖZÖS kezdete: az első budapesti nap éjfele. Minden blokk
 * (összesítő, napi sor, oldalak, bontások) ugyanettől a ponttól számol, így a
 * számok egymással összeegyeztethetők (Codex-review, 2026-11-07). A
 * WebOverview/WebStatsTable lekérdezések dátum-alakú `date_from`-ja a
 * projekt időzónájában (Europe/Budapest) a nap elejét jelenti.
 */
function periodStartSql(startDate: string): string {
  return `toDateTime('${startDate} 00:00:00', '${BUDAPEST_TZ}')`
}

function topPagesHogql(startDate: string): string {
  return `SELECT properties.$pathname AS breakdown_value, uniq(person_id) AS visitors, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= ${periodStartSql(startDate)} AND {filters} GROUP BY breakdown_value ORDER BY views DESC, visitors DESC LIMIT ${WEB_STATS_TABLE_LIMIT}`
}

/**
 * A napi bontás HogQL-lekérdezése: budapesti naptári napok, a mai nappal
 * (részlegesen) együtt pontosan `days` nap, azaz a ma kezdete − (days − 1)
 * naptól. A PostHog MCP-n 2026-11-07-én ellenőrizve (7 sor, 11-01…11-07).
 */
function dailyHogql(startDate: string): string {
  return `SELECT toDate(toTimeZone(timestamp, '${BUDAPEST_TZ}')) AS day, uniq(person_id) AS visitors, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= ${periodStartSql(startDate)} AND {filters} GROUP BY day ORDER BY day`
}

function hogqlQuery(query: string) {
  return { kind: 'HogQLQuery', query, filters: { filterTestAccounts: true } }
}

/**
 * A WebStatsTableQuery bontásai. Minden `breakdownBy` értéket 2026-11-07-én a
 * PostHog MCP `query-web-stats` eszközével, élesben ellenőriztünk.
 */
const TABLE_BREAKDOWNS: Readonly<
  Record<Exclude<WebStatsBreakdownKey, 'pages'>, { breakdownBy: string; name: NameCell }>
> = {
  entryPages: { breakdownBy: 'InitialPage', name: textName() },
  exitPages: { breakdownBy: 'ExitPage', name: textName() },
  channels: { breakdownBy: 'InitialChannelType', name: textName(channelLabelHu) },
  referrers: { breakdownBy: 'InitialReferringDomain', name: textName(referrerLabelHu) },
  utmSources: { breakdownBy: 'InitialUTMSource', name: textName(undefined, NO_UTM_LABEL) },
  utmMediums: { breakdownBy: 'InitialUTMMedium', name: textName(undefined, NO_UTM_LABEL) },
  utmCampaigns: { breakdownBy: 'InitialUTMCampaign', name: textName(undefined, NO_UTM_LABEL) },
  devices: { breakdownBy: 'DeviceType', name: textName(deviceLabelHu) },
  browsers: { breakdownBy: 'Browser', name: textName() },
  os: { breakdownBy: 'OS', name: textName() },
  countries: { breakdownBy: 'Country', name: textName(countryLabelHu) },
  cities: { breakdownBy: 'City', name: cityName },
  languages: { breakdownBy: 'Language', name: textName(languageLabelHu) },
}

/** Legfeljebb `limit` feladat fut egyszerre; az eredmények a feladatok sorrendjében. */
async function runLimited<T>(tasks: ReadonlyArray<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return results
}

async function fetchWebStats(apiKey: string, days: WebStatsPeriodDays): Promise<WebStatsData> {
  const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS)
  const now = Date.now()
  const startDate = periodDays(days, now)[0]
  const dateRange = { date_from: startDate }
  const queries: Array<[Block, unknown]> = [
    ['overview', { kind: 'WebOverviewQuery', dateRange, filterTestAccounts: true, properties: [] }],
    ['daily', hogqlQuery(dailyHogql(startDate))],
    ['pages', hogqlQuery(topPagesHogql(startDate))],
    ...Object.entries(TABLE_BREAKDOWNS).map(([block, { breakdownBy }]): [Block, unknown] => [
      block as Block,
      {
        kind: 'WebStatsTableQuery',
        breakdownBy,
        dateRange,
        filterTestAccounts: true,
        limit: WEB_STATS_TABLE_LIMIT,
        properties: [],
      },
    ]),
  ]
  const bodies = await runLimited(
    queries.map(
      ([block, query]) =>
        () =>
          runQuery(apiKey, block, query, signal),
    ),
    MAX_CONCURRENT_QUERIES,
  )
  const bodyOf = new Map<Block, unknown>(queries.map(([block], index) => [block, bodies[index]]))

  const breakdowns = {} as Record<WebStatsBreakdownKey, WebStatsRow[] | null>
  for (const key of WEB_STATS_BREAKDOWN_KEYS) {
    const body = bodyOf.get(key) ?? null
    const name = key === 'pages' ? textName() : TABLE_BREAKDOWNS[key].name
    breakdowns[key] = warnIfMalformed(key, body, parseTable(body, name))
  }
  const overviewBody = bodyOf.get('overview') ?? null
  const dailyBody = bodyOf.get('daily') ?? null
  return {
    periodDays: days,
    fetchedAt: new Date(now).toISOString(),
    overview: warnIfMalformed('overview', overviewBody, parseWebOverview(overviewBody)),
    daily: warnIfMalformed('daily', dailyBody, parseDaily(dailyBody, days, now)),
    breakdowns,
  }
}

function hasAnyBlock(data: WebStatsData): boolean {
  return (
    data.overview !== null ||
    data.daily !== null ||
    Object.values(data.breakdowns).some((rows) => rows !== null)
  )
}

/**
 * A gyorsítótárazott lekérdezés. Az időszak argumentum (a kulcs része, nem
 * titok); a PostHog-kulcsot a függvény MAGA olvassa, argumentumként a
 * gyorsítótár kulcsába kerülne. Ha egyik blokk sem sikerült, dob, hogy a
 * kudarc ne kerüljön a gyorsítótárba.
 */
const cachedWebStats = unstable_cache(
  async (days: WebStatsPeriodDays): Promise<WebStatsData> => {
    const apiKey = readApiKey()
    if (apiKey === null) {
      throw new Error('POSTHOG_PERSONAL_API_KEY hiányzik')
    }
    const data = await fetchWebStats(apiKey, days === 30 ? 30 : 7)
    if (!hasAnyBlock(data)) {
      throw new Error('a PostHog egyik blokkot sem adta vissza')
    }
    return data
  },
  ['admin-posthog-web-stats-v3'],
  { revalidate: POSTHOG_WEB_STATS_REVALIDATE_SECONDS },
)

/** A nézet belépési pontja: soha nem dob. Alapból 7 nap. */
export async function loadPosthogWebStats(
  periodDays: WebStatsPeriodDays = 7,
): Promise<PosthogWebStats> {
  if (readApiKey() === null) {
    return { status: 'not_configured' }
  }
  try {
    return { status: 'ok', ...(await cachedWebStats(periodDays === 30 ? 30 : 7)) }
  } catch (error) {
    logger.warn('posthog-webstat: a látogatói számok nem érhetők el', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return { status: 'unavailable' }
  }
}
