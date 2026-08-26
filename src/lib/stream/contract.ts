/**
 * GET /api/stream-token közös szerződés (kliens + szerver). Wire: `{ token, expiresAt }`
 * — `expiresAt` ISO-8601 UTC.
 */

/** A végpont útvonala. */
export const STREAM_TOKEN_PATH = '/api/stream-token'

/** A termékazonosító query-paraméterének neve. */
export const STREAM_TOKEN_PRODUCT_PARAM = 'productId'

/**
 * A videó STABIL azonosítójának query-paramétere. Nem sorszám: a lejátszható
 * (ready) videók sorszáma a feldolgozási állapottól függően elcsúszik, a
 * stabil azonosító nem.
 */
export const STREAM_TOKEN_VIDEO_PARAM = 'videoId'

/**
 * A 200-as válasz törzse — a szerver ezt adja, a kliens ezt olvassa.
 *
 * A wire-formátum a videó-szolgáltató cseréjekor (Cloudflare → Bunny) NEM
 * változott: ugyanaz a két mező, ugyanazokkal a nevekkel és típusokkal. Csak a
 * `token` BELSŐ alakja más (JWT helyett SHA256-hex) — a kliens azt amúgy sem
 * értelmezi, csak továbbadja az embed-URL-nek.
 */
export interface StreamTokenResponseBody {
  /** A lejátszási jegy (Bunny Stream: SHA256-hex — lásd ./token.ts). */
  token: string
  /** A token lejárata ISO-8601 (UTC) alakban. */
  expiresAt: string
}

/**
 * A `products.videos` sor minimális alakja, amennyit a lejátszási lánc
 * mindkét oldala ismer (a generált `Product['videos'][number]` és a lejátszó
 * `CourseVideo` típusa is ráilleszkedik).
 */
export interface StreamVideoLike {
  id?: string | null
  streamAssetId?: string | null
  status?: 'processing' | 'ready' | 'error' | null
}

/** A kliens-oldalra parse-olt válasz — a mértékegység a névben. */
export interface ParsedStreamToken {
  token: string
  /** A lejárat Unix epoch MÁSODPERCBEN (nem ezredmásodperc). */
  expiresAtEpochSec: number
}

const trimmed = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * A videó stabil azonosítója a token-kéréshez. Elsődlegesen a CMS-sor saját
 * `id`-ja (ez az EPIZÓDOT azonosítja, és túléli a médiafájl újratöltését),
 * másodlagosan a `streamAssetId`. A szerver mindkettőt elfogadja.
 *
 * @returns az azonosító, vagy null, ha a sor egyikkel sem rendelkezik.
 */
export function streamVideoRef(video: StreamVideoLike): string | null {
  const rowId = trimmed(video.id)
  if (rowId.length > 0) {
    return rowId
  }
  const assetId = trimmed(video.streamAssetId)
  return assetId.length > 0 ? assetId : null
}

/**
 * Lejátszható-e a videó: kész (`ready`) ÉS van hozzárendelt videó-azonosítója
 * (Bunny GUID). Ez a feltétel EGY helyen van definiálva — a lejátszó
 * epizódlistája és a szerver alapértelmezett videóválasztása is ezt használja,
 * így nem térhetnek el.
 */
export function isPlayableStreamVideo(video: StreamVideoLike): boolean {
  return video.status === 'ready' && trimmed(video.streamAssetId).length > 0
}

/** A lejátszható videók a CMS-beli sorrendben (a lejátszó epizódlistája). */
export function playableStreamVideos<T extends StreamVideoLike>(
  videos: readonly T[] | null | undefined,
): T[] {
  return Array.isArray(videos) ? videos.filter((video) => isPlayableStreamVideo(video)) : []
}

/**
 * A Bunny Stream iframe forrása a védett lejátszóhoz:
 *
 *     https://iframe.mediadelivery.net/embed/<libraryId>/<guid>?token=<hex>&expires=<unix>
 *
 * A `libraryId` a védett library numerikus azonosítója
 * (NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID — lazy, nem induláskori kötelező ENV);
 * hiányában null, hogy a lejátszó a magyar „nem érhető el" üzenetet mutassa a
 * némán törött iframe helyett.
 *
 * Az `expiresAtEpochSec` NEM új wire-mező: a szerver ma is elküldi ISO-8601
 * `expiresAt` alakban, a `parseStreamTokenResponseBody` a határon egyszer
 * epoch másodperccé alakítja, és a lejátszó már tárolja is. Kritikus, hogy ez
 * a szám BITRE ugyanaz legyen, mint amivel a szerver a hasht számolta —
 * eltérés esetén a Bunny MINDEN lejátszást elutasít, és a hibaüzenet nem utal
 * az okra (a regressziót az src/__tests__/stream-token-contract.test.ts őrzi).
 *
 * A lejárt (múltbeli) `expires` szándékosan érvényes URL-t ad: a lejárat
 * kezelése a szerver TTL-jén és a lejátszó exp−5 perces token-frissítésén
 * múlik, nem ezen a tiszta URL-építőn.
 */
export function streamIframeSrc(input: {
  libraryId: string | null | undefined
  streamAssetId: string | null | undefined
  token: string
  expiresAtEpochSec: number
}): string | null {
  const libraryId = trimmed(input.libraryId)
  const streamAssetId = trimmed(input.streamAssetId)
  const token = trimmed(input.token)
  const expires = input.expiresAtEpochSec
  if (libraryId.length === 0 || streamAssetId.length === 0 || token.length === 0) {
    return null
  }
  // A tört vagy nem véges lejárat programozási hiba (ezredmásodperc/másodperc
  // keverés) — inkább a magyar „nem érhető el" üzenet, mint a Bunny által
  // némán elutasított URL.
  if (typeof expires !== 'number' || !Number.isInteger(expires) || expires <= 0) {
    return null
  }
  const path = `${encodeURIComponent(libraryId)}/${encodeURIComponent(streamAssetId)}`
  return `https://iframe.mediadelivery.net/embed/${path}?token=${encodeURIComponent(token)}&expires=${expires}`
}

/** A token-kérés relatív URL-je — a kliens EZZEL építi a kérést. */
export function buildStreamTokenRequestUrl(input: {
  productId: number
  videoId?: string | null
}): string {
  const params = new URLSearchParams({
    [STREAM_TOKEN_PRODUCT_PARAM]: String(input.productId),
  })
  const videoId = trimmed(input.videoId)
  if (videoId.length > 0) {
    params.set(STREAM_TOKEN_VIDEO_PARAM, videoId)
  }
  return `${STREAM_TOKEN_PATH}?${params.toString()}`
}

/**
 * A 200-as válasz törzsének ellenőrzése és parse-olása. A lejárat itt, a
 * határon egyszer válik epoch másodpercre.
 *
 * @returns a parse-olt token, vagy null, ha a törzs nem felel meg a
 *   szerződésnek (a hívó ilyenkor általános hibaüzenetet mutat).
 */
export function parseStreamTokenResponseBody(body: unknown): ParsedStreamToken | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const candidate = body as { token?: unknown; expiresAt?: unknown }
  if (typeof candidate.token !== 'string' || candidate.token.length === 0) {
    return null
  }
  if (typeof candidate.expiresAt !== 'string') {
    return null
  }
  const expiresAtMs = Date.parse(candidate.expiresAt)
  if (!Number.isFinite(expiresAtMs)) {
    return null
  }
  return { token: candidate.token, expiresAtEpochSec: Math.floor(expiresAtMs / 1000) }
}
