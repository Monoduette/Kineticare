import type { Payload } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  checkUserRateLimit,
  rateLimitHeaders,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import {
  listBunnyLibraryVideos,
  type BunnyLibraryErrorCode,
  type BunnyLibraryKind,
} from './bunny-library'

/**
 * GET /api/admin/bunny-videos?library=protected|public — Bunny Stream
 * library-lista a munkatársaknak.
 *
 * RBAC: staff/owner. Per-user rate limit (több Bunny-hívás/hívás); válasz `no-store`.
 */

export interface BunnyVideosHandlerDeps {
  getPayload: () => Promise<Payload>
  fetchImpl?: typeof fetch
  /** Kizárólag tesztből: saját limiter vagy szabálykészlet injektálása. */
  rateLimit?: CheckRequestRateLimitOptions
}

/**
 * Minden válasz `no-store`: a védett tár azonosítói nem kerülhetnek
 * gyorsítótárba (sem böngészőbe, sem köztes proxyba).
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

/**
 * A `?library=` paraméter feloldása.
 *
 * Kis- és nagybetűre NEM érzékeny, és a körülvevő szóközöket levágja: a
 * `?library=PUBLIC` korábban CSENDBEN a védett tárat adta vissza (a szigorú
 * `=== 'public'` miatt), vagyis a munkatárs a nyilvános tárat kérte, és a
 * fizetős leckék listáját kapta. Ismeretlen érték továbbra is a védett tárra
 * esik vissza: az a szűkebb, nem az a tár, ahonnan előzetes megy ki.
 */
function parseLibraryKind(value: string | null): BunnyLibraryKind {
  return typeof value === 'string' && value.trim().toLowerCase() === 'public'
    ? 'public'
    : 'protected'
}

function httpStatusForBunnyError(code: BunnyLibraryErrorCode): number {
  switch (code) {
    case 'not-configured':
    case 'invalid-library-id':
      return 503
    case 'invalid-search':
      return 400
    default:
      return 502
  }
}

export function createBunnyVideosHandler(
  deps: BunnyVideosHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'admin-bunny-videos' })

    try {
      const payload = await deps.getPayload()
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return Response.json(
          { error: 'A videótár megtekintéséhez bejelentkezés szükséges.' },
          { status: 401, headers: NO_STORE_HEADERS },
        )
      }
      if (!hasStaffOrOwnerRole(user)) {
        log.warn('bunny-videos: jogosulatlan kísérlet (nem staff/owner szerepkör)', {
          userId: user.id,
          role: user.role ?? null,
        })
        return Response.json(
          { error: 'A videótár megtekintéséhez munkatársi vagy tulajdonosi jogosultság kell.' },
          { status: 403, headers: NO_STORE_HEADERS },
        )
      }

      // Per-user keret az AUTH és a szerepkör-kapu UTÁN, a kimenő Bunny-hívás
      // ELŐTT: csak jogosult hívó fogyasztja a vödröt, és a keret a Bunny felé
      // menő kérésszámot fogja meg.
      const rejection = checkUserRateLimit({
        request,
        routeClass: 'bunny-videos',
        userId: user.id,
        ...(deps.rateLimit ? { options: deps.rateLimit } : {}),
      })
      if (rejection) {
        log.warn('bunny-videos: kérés-korlát elérve', { userId: user.id })
        return Response.json(
          { error: rejection.message },
          { status: 429, headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(rejection) } },
        )
      }

      const url = new URL(request.url)
      const kind = parseLibraryKind(url.searchParams.get('library'))
      const search = url.searchParams.get('search')
      const result = await listBunnyLibraryVideos({
        fetchImpl: deps.fetchImpl ?? fetch,
        kind,
        search: search ?? undefined,
        // A kérés-azonosítóhoz kötött naplózó: a GUID nélküli, kihagyott
        // tételek figyelmeztetése így ugyanahhoz a kéréshez rendelhető, mint
        // a route többi sora.
        log,
      })

      if (!result.ok) {
        // A Bunny-oldali hiba (502/503) eddig NYOM NÉLKÜL ment vissza: csak a
        // váratlan kivétel ága naplózott. Egy tartós upstream-kiesés így
        // láthatatlan maradt volna a naplóban, holott a munkatárs oldalán ez a
        // panel teljes használhatatlansága. A felhasználónak szóló magyar
        // üzenet helyett a gépi kódot naplózzuk.
        log.warn('bunny-videos: a Bunny videótár nem szolgálta ki a kérést', {
          kind,
          code: result.code,
        })
        return Response.json(
          { error: result.message, code: result.code },
          { status: httpStatusForBunnyError(result.code), headers: NO_STORE_HEADERS },
        )
      }

      return Response.json(
        {
          library: result.list.kind,
          libraryId: result.list.libraryId,
          totalItems: result.list.totalItems,
          truncated: result.list.truncated,
          videos: result.list.videos,
        },
        { headers: NO_STORE_HEADERS },
      )
    } catch (error) {
      log.error('bunny-videos: váratlan hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        { error: 'A videótár most nem tölthető be. Próbáld újra később.' },
        { status: 500, headers: NO_STORE_HEADERS },
      )
    }
  }
}
