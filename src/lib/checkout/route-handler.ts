import { type NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { resolveClientIp } from '../audit'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { assertSameOrigin } from '../security/same-origin'
import { CheckoutError, startCheckout, type CheckoutStartInput } from './start-checkout'

/** POST /api/checkout/start — same-origin, rate limit, auth (vendég is), startCheckout. */
export interface CheckoutStartHandlerDeps {
  getPayload: () => Promise<Payload>
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös, folyamaton belüli számláló. */
  rateLimit?: CheckRequestRateLimitOptions
}

export function createCheckoutStartHandler(
  deps: CheckoutStartHandlerDeps,
): (request: NextRequest) => Promise<NextResponse> {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'checkout-start' })

    const originCheck = assertSameOrigin(request)
    if (!originCheck.ok) {
      log.warn('checkout-start: idegen eredet elutasítva')
      return NextResponse.json({ error: originCheck.message }, { status: originCheck.status })
    }

    // IP-alapú throttle (A2) — MINDEN drága lépés (Payload-betöltés, auth,
    // rendelés-létrehozás, Barion Start) ELŐTT. A végpont dokumentált
    // hibaformátuma { error }, ezért a 429-et itt építjük.
    const rejection = checkRequestRateLimit(request, deps.rateLimit)
    if (rejection) {
      return NextResponse.json(
        { error: rejection.message },
        { status: 429, headers: rateLimitHeaders(rejection) },
      )
    }

    try {
      const payload = await deps.getPayload()

      // A munkamenet feloldása. Bejelentkezve a felhasználó az igazság;
      // vendégként `null` megy tovább, és a szolgáltatás a törzs `guest`
      // blokkjából azonosítja a vevőt (hiánya → 400, magyar üzenettel).
      const { user } = await payload.auth({ headers: request.headers })

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json(
          {
            error:
              'A fizetés nem indítható: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
          },
          { status: 400 },
        )
      }

      const result = await startCheckout({
        payload,
        user: user ?? null,
        input: (body ?? {}) as CheckoutStartInput,
        ipAddress: resolveClientIp(request.headers),
        logger: log,
      })

      return NextResponse.json(result, { status: 200 })
    } catch (error) {
      if (error instanceof CheckoutError) {
        log.warn('checkout-start: üzleti hiba', {
          status: error.status,
          error: error.message,
        })
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      log.error('checkout-start: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json(
        { error: 'A fizetés indítása most nem sikerült. Próbáld újra néhány perc múlva.' },
        { status: 500 },
      )
    }
  }
}
