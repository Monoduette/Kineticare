/**
 * mark-watched API szerződés — kérés/válasz alakok, HTTP-státuszok. Kliens és
 * szerver egy forrásból.
 */
export const MARK_WATCHED_PATH = '/api/course-progress/mark-watched'

/** A kérés törzse. A `productId` szövegként utazik (a szerver számot is elfogad). */
export interface MarkWatchedRequestBody {
  productId: string
  videoRef: string
}

/** A 200-as válasz törzse — a szerver ezt adja, a kliens ezt olvassa. */
export interface MarkWatchedResponseBody {
  productId: number
  videoRef: string
  /** A megjelölés időpontja ISO-8601 (UTC) alakban. */
  watchedAt: string
  /** true, ha a videó MÁR korábban meg volt jelölve (idempotens ismétlés). */
  alreadyWatched: boolean
}

export function buildMarkWatchedRequestBody(input: {
  productId: number
  videoRef: string
}): MarkWatchedRequestBody {
  return { productId: String(input.productId), videoRef: input.videoRef }
}

/**
 * A 200-as válasz törzsének ellenőrzése és parse-olása.
 *
 * @returns a parse-olt válasz, vagy null, ha a törzs nem felel meg a
 *   szerződésnek (a hívó ilyenkor általános hibaüzenetet mutat).
 */
export function parseMarkWatchedResponseBody(body: unknown): MarkWatchedResponseBody | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const candidate = body as {
    productId?: unknown
    videoRef?: unknown
    watchedAt?: unknown
    alreadyWatched?: unknown
  }
  if (typeof candidate.productId !== 'number' || !Number.isFinite(candidate.productId)) {
    return null
  }
  if (typeof candidate.videoRef !== 'string' || candidate.videoRef.length === 0) {
    return null
  }
  if (typeof candidate.watchedAt !== 'string' || !Number.isFinite(Date.parse(candidate.watchedAt))) {
    return null
  }
  if (typeof candidate.alreadyWatched !== 'boolean') {
    return null
  }
  return {
    productId: candidate.productId,
    videoRef: candidate.videoRef,
    watchedAt: candidate.watchedAt,
    alreadyWatched: candidate.alreadyWatched,
  }
}
