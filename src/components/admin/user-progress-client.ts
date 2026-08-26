'use client'

import {
  buildUserProgressQuery,
  USER_PROGRESS_MAX_USERS,
  type UserCourseProgressEntry,
} from '../../lib/admin/user-progress-contract'
import { normalizeProgressEntry, readEntityId } from './purchases-cell'

/**
 * A Felhasználók-lista kurzus-haladásának BATCHELŐ betöltője (kliens-oldal).
 * `null`-lal oldódnak fel, és NEM kerülnek a gyorsítótárba, tehát a következő
 */

/** A kérés felső időkorlátja; a `loadCourseTitles`-szel azonos. */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * A gyorsítótár-bejegyzések élettartama.
 * A gyorsítótár modul-szintű, tehát a Payload egyoldalas adminjában addig él,
 * amíg a fül nyitva van. Lejárat nélkül két baja volt. (1) A munkatárs
 * ÓRÁKIG a betöltéskori százalékot látta: a lista frissítése (rendezés,
 * szűrés, oldalváltás) nem indított új kérést, mert a bejegyzés megvolt.
 * (2) Ha a szerver a csonkolás-szabály miatt kihagyott egy felhasználót, arról
 */
const CACHE_TTL_MS = 60_000

type ProgressEntries = readonly UserCourseProgressEntry[]

/**
 * A „nincs egyetlen kurzus-haladása sem" válasz megosztott, üres tömbje.
 * Fagyasztott, hogy a gyorsítótárba került érték semmiképp ne legyen írható.
 */
const NO_ENTRIES: ProgressEntries = Object.freeze([])

/** Egy gyorsítótár-bejegyzés a hozzá tartozó időbélyeggel. */
interface CacheEntry {
  entries: ProgressEntries
  /** `Date.now()` a bejegyzés írásakor — ebből dől el a lejárat. */
  storedAt: number
}

/**
 * Feloldott sorok: felhasználó-azonosító → haladások.
 *
 * KIZÁRÓLAG sikeres, értelmezhető válaszból kerül ide bejegyzés — a hibás
 * kör nem mérgezi meg a gyorsítótárat. Az újrarenderelés (rendezés, oszlop-
 * átméretezés, szűrő) így a `CACHE_TTL_MS` ablakon belül nem indít új kérést,
 * utána viszont friss adatot kér.
 */
const cache = new Map<number, CacheEntry>()

/**
 * Az érvényes (le nem járt) bejegyzés, vagy `null`.
 *
 * A lejárt bejegyzést TÖRÖLJÜK, nem csak átugorjuk: így a térkép nem nő
 * korlátlanul egy hosszan nyitva hagyott admin-fülön.
 */
function readFreshEntries(userId: number): ProgressEntries | null {
  const cached = cache.get(userId)
  if (cached === undefined) {
    return null
  }
  if (Date.now() - cached.storedAt >= CACHE_TTL_MS) {
    cache.delete(userId)
    return null
  }
  return cached.entries
}

/** A már elindított, még be nem fejezett kérések ígéretei, azonosítónként. */
const inFlight = new Map<number, Promise<ProgressEntries | null>>()

/** Az ígéretek feloldói, amíg a csomag ki nem megy. */
const resolvers = new Map<number, (value: ProgressEntries | null) => void>()

/** A következő makrotaszkban elküldendő azonosítók. */
let queued: number[] = []

/** Igaz, ha a kiküldés már ütemezve van (egy hullámra egy ütemezés). */
let flushScheduled = false

/**
 * A `GET /api/admin/user-progress` válaszának ÉRTELMEZÉSE.
 * Két, egymástól különböző eset válik szét szándékosan:
 * - `null` = a válasz ALAKJA értelmezhetetlen (nem objektum, vagy a `users`
 * nem tömb). Ilyenkor semmit sem tudunk egyik kért felhasználóról sem,
 * tehát mind `null`-t kap, és nem kerül a gyorsítótárba.
 * - térkép, amelyből egy kért azonosító HIÁNYZIK = a szerver érvényesen
 */
export function readUserProgressRows(body: unknown): Map<number, ProgressEntries> | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const users = (body as Record<string, unknown>).users
  if (!Array.isArray(users)) {
    return null
  }
  const rows = new Map<number, ProgressEntries>()
  for (const row of users) {
    if (typeof row !== 'object' || row === null) {
      continue
    }
    const record = row as Record<string, unknown>
    const userId = readEntityId(record.userId)
    if (userId === null) {
      continue
    }
    const courses = record.courses
    const entries: UserCourseProgressEntry[] = []
    if (Array.isArray(courses)) {
      for (const course of courses) {
        const entry = normalizeProgressEntry(course)
        if (entry !== null) {
          entries.push(entry)
        }
      }
    }
    rows.set(userId, entries)
  }
  return rows
}

/**
 * Egy csomag lekérése. Hiba esetén `null` — a hívó ebből tudja, hogy a
 * csomag MINDEN azonosítója feloldatlan marad.
 */
async function fetchChunk(userIds: readonly number[]): Promise<Map<number, ProgressEntries> | null> {
  try {
    const response = await fetch(buildUserProgressQuery(userIds), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      return null
    }
    const body: unknown = await response.json()
    return readUserProgressRows(body)
  } catch {
    // Hálózati hiba, időtúllépés vagy értelmezhetetlen JSON. A felület
    // haladás nélkül, a mai alakjában marad — hibaképernyő nincs.
    return null
  }
}

/** Egy azonosító feloldása: a várakozók megkapják az eredményt. */
function settle(userId: number, value: ProgressEntries | null): void {
  const resolve = resolvers.get(userId)
  // A törlés a feloldás ELŐTT történik: mire a várakozók lefutnak, a
  // nyilvántartás már tiszta, tehát egy azonnali újrakérés friss kört indít
  // (és nem egy már lezárt ígéretet kapna vissza).
  resolvers.delete(userId)
  inFlight.delete(userId)
  resolve?.(value)
}

/**
 * Egy csomag kiküldése és feloldása.
 *
 * SOSEM dob: ha bármi váratlan történne, a csomag azonosítói `null`-lal
 * oldódnak fel. Enélkül a cellák ígéretei örökre függőben maradnának.
 */
async function requestChunk(userIds: readonly number[]): Promise<void> {
  let rows: Map<number, ProgressEntries> | null = null
  try {
    rows = await fetchChunk(userIds)
  } catch {
    rows = null
  }
  for (const userId of userIds) {
    if (rows === null) {
      settle(userId, null)
      continue
    }
    const entries = rows.get(userId) ?? NO_ENTRIES
    cache.set(userId, { entries, storedAt: Date.now() })
    settle(userId, entries)
  }
}

/**
 * A gyűjtött azonosítók kiküldése.
 *
 * A Payload lista `?limit=`-je kézzel nagyobbra állítható, mint a végpont
 * csomag-korlátja, ezért a sor CSOMAGOKRA bomlik. A csomagok párhuzamosan
 * mennek ki, és a részeredmények azonosítónként, egymástól függetlenül
 * oldódnak fel — egy bukó csomag nem viszi magával a többit.
 */
async function flushQueue(): Promise<void> {
  const userIds = queued
  queued = []
  flushScheduled = false
  if (userIds.length === 0) {
    return
  }
  const chunks: number[][] = []
  for (let index = 0; index < userIds.length; index += USER_PROGRESS_MAX_USERS) {
    chunks.push(userIds.slice(index, index + USER_PROGRESS_MAX_USERS))
  }
  await Promise.all(chunks.map((chunk) => requestChunk(chunk)))
}

function scheduleFlush(): void {
  if (flushScheduled) {
    return
  }
  flushScheduled = true
  setTimeout(() => {
    void flushQueue()
  }, 0)
}

/**
 * Egy felhasználó kurzus-haladásai.
 *
 * A hívás nem indít azonnal kérést: az azonosító a következő makrotaszkban
 * kimenő csomagba kerül. Ugyanarra a felhasználóra a második hívás nem
 * indít új kört (a folyamatban lévő ígéretet, majd a friss gyorsítótár-
 * bejegyzést kapja); a `CACHE_TTL_MS` letelte után viszont új kör indul.
 *
 * @returns a haladások, vagy `null`, ha az adat nem szerezhető meg — ilyenkor
 *          a cella haladás nélkül, a mai alakjában jelenik meg
 */
export function loadUserProgress(userId: number): Promise<ProgressEntries | null> {
  const id = readEntityId(userId)
  if (id === null) {
    return Promise.resolve(null)
  }
  const cached = readFreshEntries(id)
  if (cached !== null) {
    return Promise.resolve(cached)
  }
  const running = inFlight.get(id)
  if (running !== undefined) {
    return running
  }
  const promise = new Promise<ProgressEntries | null>((resolve) => {
    resolvers.set(id, resolve)
  })
  inFlight.set(id, promise)
  queued.push(id)
  scheduleFlush()
  return promise
}
