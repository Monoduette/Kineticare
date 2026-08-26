/**
 * Bunny Stream library-lista — parser + injektálható HTTP-kliens. Csak listáz (feltöltés a Bunny UI-n).
 * Library-szintű AccessKey (nem lejátszási token). Parser: PascalCase és camelCase mezők.
 */

import { logger, type Logger } from '../logger'

export const BUNNY_STREAM_API_ORIGIN = 'https://video.bunnycdn.com'

export const BUNNY_LIBRARY_API_KEY_ENV = 'BUNNY_STREAM_LIBRARY_API_KEY'
export const BUNNY_PUBLIC_LIBRARY_API_KEY_ENV = 'BUNNY_STREAM_PUBLIC_LIBRARY_API_KEY'

export type BunnyLibraryKind = 'protected' | 'public'

export interface BunnyLibraryVideo {
  guid: string
  title: string
  lengthSec: number | null
  status: number | null
  statusLabel: string
  dateUploaded: string | null
}

export interface BunnyLibraryList {
  kind: BunnyLibraryKind
  libraryId: string
  videos: BunnyLibraryVideo[]
  totalItems: number | null
  truncated: boolean
  /**
   * Ahány nyers tételt a parser GUID híján eldobott. Nulla a normál eset;
   * pozitív érték néma adatvesztést jelentene, ezért számláljuk és naplózzuk.
   */
  droppedItems: number
}

export type BunnyLibraryListResult =
  { ok: true; list: BunnyLibraryList } | { ok: false; code: BunnyLibraryErrorCode; message: string }

export type BunnyLibraryErrorCode =
  | 'not-configured'
  | 'unauthorized'
  | 'upstream'
  | 'invalid-response'
  | 'invalid-library-id'
  | 'invalid-search'

/** Bunny Stream library-azonosító: pozitív egész, path-injekció nélkül. */
export const BUNNY_LIBRARY_ID_PATTERN = /^\d{1,12}$/
/** A keresőmező felső hossza: a query-string ne legyen tetszőlegesen hosszú. */
export const BUNNY_SEARCH_MAX_LENGTH = 200

export function isBunnyLibraryId(value: string): boolean {
  return BUNNY_LIBRARY_ID_PATTERN.test(value)
}

/** A Bunny Stream videó-státusz kódjai (VideoModel.status). */
const STATUS_LABELS: Record<number, string> = {
  0: 'Létrehozva',
  1: 'Feltöltve',
  2: 'Feldolgozás',
  3: 'Kódolás',
  4: 'Kész',
  5: 'Hiba',
  6: 'Feltöltés sikertelen',
}

export function bunnyVideoStatusLabel(status: number | null): string {
  if (status === null) {
    return 'Ismeretlen'
  }
  return STATUS_LABELS[status] ?? `Állapot ${String(status)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return null
}

function readItems(payload: Record<string, unknown>): unknown[] {
  const items = payload.items ?? payload.Items
  return Array.isArray(items) ? items : []
}

export function parseBunnyLibraryVideo(value: unknown): BunnyLibraryVideo | null {
  const record = asRecord(value)
  if (record === null) {
    return null
  }
  const guid = readString(record, 'guid', 'Guid')
  if (guid === null) {
    return null
  }
  const status = readNumber(record, 'status', 'Status')
  const lengthSec = readNumber(record, 'length', 'Length')
  return {
    guid,
    title: readString(record, 'title', 'Title') ?? guid,
    lengthSec,
    status,
    statusLabel: bunnyVideoStatusLabel(status),
    dateUploaded: readString(record, 'dateUploaded', 'DateUploaded'),
  }
}

/**
 * Lapozás a NYERS items.length alapján — a GUID nélküli eldobott sorok ne állítsák meg a lapozást.
 */
export interface BunnyLibraryListPage {
  list: BunnyLibraryList
  /** A válasz `items` tömbjének hossza — szűrés ELŐTT. */
  rawItemCount: number
  /** Ahány nyers tételt GUID híján el kellett dobni. */
  droppedItemCount: number
  /** A válasz által jelentett oldalméret (`itemsPerPage`), ha pozitív egész. */
  pageSize: number | null
}

export function parseBunnyLibraryListPage(
  payload: unknown,
  meta: { kind: BunnyLibraryKind; libraryId: string; truncated?: boolean },
): BunnyLibraryListPage | null {
  const record = asRecord(payload)
  if (record === null) {
    return null
  }
  const items = readItems(record)
  const videos: BunnyLibraryVideo[] = []
  for (const item of items) {
    const video = parseBunnyLibraryVideo(item)
    if (video !== null) {
      videos.push(video)
    }
  }
  const droppedItemCount = items.length - videos.length
  const reportedPageSize = readNumber(record, 'itemsPerPage', 'ItemsPerPage')
  return {
    list: {
      kind: meta.kind,
      libraryId: meta.libraryId,
      videos,
      totalItems: readNumber(record, 'totalItems', 'TotalItems'),
      truncated: meta.truncated === true,
      droppedItems: droppedItemCount,
    },
    rawItemCount: items.length,
    droppedItemCount,
    pageSize:
      reportedPageSize !== null && Number.isInteger(reportedPageSize) && reportedPageSize > 0
        ? reportedPageSize
        : null,
  }
}

/** Kényelmi alak: csak a lista kell, a lapozás nyers számai nélkül. */
export function parseBunnyLibraryListPayload(
  payload: unknown,
  meta: { kind: BunnyLibraryKind; libraryId: string; truncated?: boolean },
): BunnyLibraryList | null {
  return parseBunnyLibraryListPage(payload, meta)?.list ?? null
}

function readEnv(name: string): string | null {
  const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : ''
  return raw.length > 0 ? raw : null
}

export function readBunnyLibraryConfig(kind: BunnyLibraryKind): {
  libraryId: string
  apiKey: string
} | null {
  if (kind === 'protected') {
    const libraryId = readEnv('NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID')
    const apiKey = readEnv(BUNNY_LIBRARY_API_KEY_ENV)
    if (libraryId === null || apiKey === null) {
      return null
    }
    return { libraryId, apiKey }
  }
  const libraryId = readEnv('NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID')
  const apiKey = readEnv(BUNNY_PUBLIC_LIBRARY_API_KEY_ENV)
  if (libraryId === null || apiKey === null) {
    return null
  }
  return { libraryId, apiKey }
}

export interface ListBunnyLibraryVideosDeps {
  fetchImpl: typeof fetch
  kind: BunnyLibraryKind
  page?: number
  itemsPerPage?: number
  search?: string
  /**
   * Naplózó az eldobott tételekhez. A route-handler a kérés-azonosítóval
   * kötött child loggerét adhatja át; enélkül a modul-szintű logger megy.
   */
  log?: Pick<Logger, 'warn'>
}

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGES = 5

export async function listBunnyLibraryVideos(
  deps: ListBunnyLibraryVideosDeps,
): Promise<BunnyLibraryListResult> {
  const config = readBunnyLibraryConfig(deps.kind)
  if (config === null) {
    return {
      ok: false,
      code: 'not-configured',
      message:
        deps.kind === 'protected'
          ? 'A védett videótár nincs bekötve. A Bunny library API-kulcsát és a library azonosítóját a szerver környezetében kell beállítani.'
          : 'A nyilvános videótár nincs bekötve. A publikus library API-kulcsát és a library azonosítóját a szerver környezetében kell beállítani.',
    }
  }

  if (!isBunnyLibraryId(config.libraryId)) {
    return {
      ok: false,
      code: 'invalid-library-id',
      message: 'A videótár azonosítója érvénytelen. A Bunny library azonosító csak szám lehet.',
    }
  }

  const search = deps.search?.trim() ?? ''
  if (search.length > BUNNY_SEARCH_MAX_LENGTH) {
    return {
      ok: false,
      code: 'invalid-search',
      message: 'A keresés túl hosszú. Rövidítsd a kifejezést.',
    }
  }

  const itemsPerPage = deps.itemsPerPage ?? DEFAULT_PAGE_SIZE
  const log = deps.log ?? logger.child({ module: 'bunny-library' })
  const collected: BunnyLibraryVideo[] = []
  let totalItems: number | null = null
  let truncated = false
  /** Nyers (szűrés előtti) tételszám összesen — ezen áll a lapozás döntése. */
  let rawSeen = 0
  let droppedItems = 0
  const startPage = deps.page ?? 1
  const pagesToRead = deps.page !== undefined ? 1 : MAX_PAGES

  for (let offset = 0; offset < pagesToRead; offset += 1) {
    const page = startPage + offset
    const url = new URL(
      `/library/${encodeURIComponent(config.libraryId)}/videos`,
      BUNNY_STREAM_API_ORIGIN,
    )
    url.searchParams.set('page', String(page))
    url.searchParams.set('itemsPerPage', String(itemsPerPage))
    url.searchParams.set('orderBy', 'date')
    if (search.length > 0) {
      url.searchParams.set('search', search)
    }

    let response: Response
    try {
      response = await deps.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          AccessKey: config.apiKey,
          Accept: 'application/json',
        },
      })
    } catch {
      return {
        ok: false,
        code: 'upstream',
        message: 'A Bunny videótár most nem érhető el. Próbáld újra később.',
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'unauthorized',
        message:
          'A Bunny videótár kulcsa érvénytelen, vagy nem ehhez a libraryhez tartozik. Ellenőrizd a library API-kulcsát (nem a lejátszási tokent).',
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        code: 'upstream',
        message: 'A Bunny videótár most nem érhető el. Próbáld újra később.',
      }
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return {
        ok: false,
        code: 'invalid-response',
        message: 'A Bunny videótár válasza nem értelmezhető.',
      }
    }

    const parsed = parseBunnyLibraryListPage(payload, {
      kind: deps.kind,
      libraryId: config.libraryId,
    })
    if (parsed === null) {
      return {
        ok: false,
        code: 'invalid-response',
        message: 'A Bunny videótár válasza nem értelmezhető.',
      }
    }
    collected.push(...parsed.list.videos)
    rawSeen += parsed.rawItemCount
    if (parsed.list.totalItems !== null) {
      totalItems = parsed.list.totalItems
    }
    if (parsed.droppedItemCount > 0) {
      droppedItems += parsed.droppedItemCount
      log.warn('bunny-library: GUID nélküli tétel maradt ki a listából', {
        kind: deps.kind,
        libraryId: config.libraryId,
        page,
        rawItemCount: parsed.rawItemCount,
        droppedItemCount: parsed.droppedItemCount,
      })
    }

    /**
     * Tele volt-e az oldal? A viszonyítási alap a válasz által jelentett
     * oldalméret, de sosem több a kértnél: ha a Bunny lejjebb szabja a
     * lapméretet, a kisebb szám a helyes küszöb, ha viszont nagyobbat
     * jelentene, a kért méret marad — így a ciklus inkább tovább lapoz, mint
     * hogy némán elhagyjon egy oldalt.
     */
    const effectivePageSize =
      parsed.pageSize === null ? itemsPerPage : Math.min(itemsPerPage, parsed.pageSize)
    if (parsed.rawItemCount < effectivePageSize) {
      break
    }
    if (totalItems !== null && rawSeen >= totalItems) {
      break
    }
    if (offset === pagesToRead - 1) {
      truncated = true
    }
  }

  return {
    ok: true,
    list: {
      kind: deps.kind,
      libraryId: config.libraryId,
      videos: collected,
      totalItems,
      // Az eldobott tétel is hiány a listában: a felület ilyenkor is a
      // „keresd a Bunny felületén” figyelmeztetést mutassa.
      truncated: truncated || droppedItems > 0,
      droppedItems,
    },
  }
}
