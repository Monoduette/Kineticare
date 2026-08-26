import { type NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  checkUserRateLimit,
  rateLimitHeaders,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { STREAM_TOKEN_PRODUCT_PARAM, STREAM_TOKEN_VIDEO_PARAM } from './contract'
import { issueStreamToken, StreamTokenError } from './issue-stream-token'

/**
 * Minden válasz `no-store`: a lejátszási jegy (és a 401/403 ág ténye) nem
 * kerülhet böngésző- vagy köztes gyorsítótárba. A bunny-library és az
 * admin course-progress handlerek ugyanilyen fejlécet adnak.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

/**
 * GET /api/stream-token route-handler: auth → per-user rate limit → issueStreamToken.
 * Válasz `no-store`.
 */
export interface StreamTokenHandlerDeps {
  getPayload: () => Promise<Payload>
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös, folyamaton belüli számláló. */
  rateLimit?: CheckRequestRateLimitOptions
}

export function createStreamTokenHandler(
  deps: StreamTokenHandlerDeps,
): (request: NextRequest) => Promise<NextResponse> {
  return async function GET(request: NextRequest): Promise<NextResponse> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'stream-token' })

    try {
      const payload = await deps.getPayload()

      // Auth-kötelezett végpont: bejelentkezés nélkül nincs lejátszási token.
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return NextResponse.json(
          { error: 'A videó lejátszásához bejelentkezés szükséges.' },
          { status: 401, headers: NO_STORE_HEADERS },
        )
      }

      // Per-user keret: a jegy-kiállítás (és a mögötte lévő DB-lekérdezések)
      // ELŐTT. A végpont dokumentált hibaformátuma { error }, ezért a 429-et
      // itt építjük.
      const rejection = checkUserRateLimit({
        request,
        routeClass: 'stream-token',
        userId: user.id,
        ...(deps.rateLimit ? { options: deps.rateLimit } : {}),
      })
      if (rejection) {
        return NextResponse.json(
          { error: rejection.message },
          { status: 429, headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(rejection) } },
        )
      }

      // A query-paraméterek nevei a közös szerződés-modulból jönnek — a kliens
      // ugyanezekkel építi a kérést, így nem térhetnek el egymástól.
      const { searchParams } = new URL(request.url)
      const videoIdParam = searchParams.get(STREAM_TOKEN_VIDEO_PARAM)

      const result = await issueStreamToken({
        payload,
        user,
        productId: searchParams.get(STREAM_TOKEN_PRODUCT_PARAM),
        videoId: videoIdParam === null ? undefined : videoIdParam,
        logger: log,
      })

      return NextResponse.json(result, { status: 200, headers: NO_STORE_HEADERS })
    } catch (error) {
      if (error instanceof StreamTokenError) {
        log.warn('stream-token: üzleti hiba', {
          status: error.status,
          error: error.message,
        })
        return NextResponse.json(
          { error: error.message },
          { status: error.status, headers: NO_STORE_HEADERS },
        )
      }
      log.error('stream-token: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json(
        {
          error:
            'A videó most nem indítható el. Frissítsd az oldalt, és próbáld újra néhány perc múlva.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      )
    }
  }
}
