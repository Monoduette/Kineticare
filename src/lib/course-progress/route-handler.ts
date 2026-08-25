import type { Payload } from 'payload'

import type { User } from '../../payload-types'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  checkUserRateLimit,
  rateLimitHeaders,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { assertSameOrigin } from '../security/same-origin'
import { CourseProgressError, markVideoWatched } from './mark-watched'

/**
 * POST /api/course-progress/mark-watched route-handler factory.
 *
 * A függőségek (Payload-példány) injektálva vannak, így a handler maga is
 * egységtesztelhető; a tényleges route az
 * src/app/(frontend)/api/course-progress/mark-watched/route.ts köti be a valódi
 * configgal (a src/lib/refund/route-handler.ts és a stream-token mintája).
 *
 * Folyamat: same-origin őr → auth (payload.auth) → JSON-törzs → üzleti logika
 * (markVideoWatched) → { productId, videoRef, watchedAt, alreadyWatched }.
 *
 * Válasz-szerződés (a részletek: src/lib/course-progress/contract.ts):
 * - 200: sikeres jelölés VAGY idempotens ismétlés (`alreadyWatched: true`)
 * - 400: hibás törzs / a videoRef nem ehhez a kurzushoz tartozik
 * - 401: nincs bejelentkezve
 * - 403: nincs megvásárolva VAGY lejárt a hozzáférés
 * - 404: nincs ilyen elérhető kurzus
 * - 500: váratlan technikai hiba
 *
 * A felhasználónak MINDIG magyar üzenet megy; a technikai részlet kizárólag a
 * strukturált naplóba kerül, requestId-vel.
 */
export interface CourseProgressHandlerDeps {
  getPayload: () => Promise<Payload>
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös, folyamaton belüli számláló. */
  rateLimit?: CheckRequestRateLimitOptions
}

/**
 * A kérés-törzs felső korlátja. A jogos törzs két rövid mező
 * (`{"productId":123,"videoRef":"24 hex"}`, jóval 200 bájt alatt) — a 4 KiB
 * bőséges ráhagyás, minden e fölött visszaélés vagy hiba.
 */
export const MAX_BODY_BYTES = 4096

/**
 * A törzs beolvasása felső korláttal. `null`, ha a törzs túllépi a korlátot.
 *
 * A deklarált `content-length` önmagában nem elég (hiányozhat, hazudhat is
 * kifelé kisebbet chunked átvitelnél), ezért a TÉNYLEGES beolvasott mennyiséget
 * mérjük: a stream darabonként jön, és a korlát átlépésekor azonnal megállunk —
 * a maradék be sem kerül a memóriába.
 */
async function readBodyWithCap(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null
  }
  const stream = request.body
  if (stream === null) {
    return ''
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value !== undefined) {
      total += value.byteLength
      if (total > maxBytes) {
        // A maradékot nem olvassuk tovább — a kapcsolat a hívó dolga.
        try {
          await reader.cancel()
        } catch {
          // A megszakítás hibája nem érdekes: a döntés már megszületett.
        }
        return null
      }
      chunks.push(value)
    }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export function createMarkWatchedHandler(
  deps: CourseProgressHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'course-progress-mark-watched' })

    const originCheck = assertSameOrigin(request)
    if (!originCheck.ok) {
      log.warn('kurzus-haladás: idegen eredet elutasítva')
      return Response.json({ error: originCheck.message }, { status: originCheck.status })
    }

    try {
      const payload = await deps.getPayload()

      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return Response.json(
          { error: 'A haladás rögzítéséhez bejelentkezés szükséges.' },
          { status: 401 },
        )
      }

      // Per-user keret az AUTH UTÁN, de a törzs-feldolgozás és a DB-írás ELŐTT
      // (a stream-token mintája). Az alany a bejelentkezett felhasználó, nem az
      // IP: a végpont hitelesített, és minden hívása haladás-sort hozhat létre.
      const rejection = checkUserRateLimit({
        request,
        routeClass: 'course-progress',
        userId: user.id,
        ...(deps.rateLimit ? { options: deps.rateLimit } : {}),
      })
      if (rejection) {
        log.warn('kurzus-haladás: kérés-korlát elérve', { userId: user.id })
        return Response.json(
          { error: rejection.message },
          { status: 429, headers: rateLimitHeaders(rejection) },
        )
      }

      // A content-length fejléc hiányozhat (chunked átvitel, illetve a
      // tesztekben konstruált Requesteknél az undici nem tölti ki), ezért a
      // törzs beolvasása NEM függhet a fejléctől — a refund-handler mintája.
      // A MÉRET viszont korlátos: a jogos törzs két rövid mező (productId,
      // videoRef), a korlátlan `request.text()` pedig a vásárlás-ellenőrzés
      // ELŐTT olvasna be akármekkora törzset a memóriába (code review-találat).
      const rawBody = await readBodyWithCap(request, MAX_BODY_BYTES)
      if (rawBody === null) {
        log.warn('kurzus-haladás: túl nagy kérés-törzs', { userId: user.id })
        return Response.json({ error: 'A kérés törzse túl nagy.' }, { status: 413 })
      }
      let body: unknown = {}
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody)
        } catch {
          return Response.json(
            {
              error:
                'A haladás nem menthető: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
            },
            { status: 400 },
          )
        }
      }
      const parsed = (body ?? {}) as { productId?: unknown; videoRef?: unknown }

      const result = await markVideoWatched({
        payload,
        user: user as User,
        productId: parsed.productId,
        videoRef: parsed.videoRef,
        logger: log,
      })

      return Response.json(result, { status: 200 })
    } catch (error) {
      if (error instanceof CourseProgressError) {
        log.warn('kurzus-haladás: üzleti hiba', { status: error.status, error: error.message })
        return Response.json({ error: error.message }, { status: error.status })
      }
      log.error('kurzus-haladás: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        { error: 'A haladás mentése most nem sikerült. Próbáld újra néhány perc múlva.' },
        { status: 500 },
      )
    }
  }
}
