import { type NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { shouldEmitThrottledAlert } from '../alert-throttle'
import { resolveClientIp } from '../audit'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { readJsonWithCap } from '../security/request-body'
import { assertSameOrigin } from '../security/same-origin'
import { verifyTurnstile } from '../security/turnstile-verify'
import { CheckoutError, startCheckout, type CheckoutStartInput } from './start-checkout'

/**
 * POST /api/checkout/start — same-origin, rate limit, törzs (felső korláttal),
 * Turnstile, auth (vendég is), startCheckout.
 */
export interface CheckoutStartHandlerDeps {
  getPayload: () => Promise<Payload>
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös, folyamaton belüli számláló. */
  rateLimit?: CheckRequestRateLimitOptions
  /** Környezet (TURNSTILE_SECRET_KEY); alapból a `process.env`. */
  env?: Readonly<Record<string, string | undefined>>
}

/**
 * Hiányzó token, miközben a szerveren az ellenőrzés be van kapcsolva. A kliens
 * token nélkül nem küld (form-submission.ts), tehát ide jellemzően egy régi,
 * a Turnstile előtti lapról vagy közvetlen API-hívásból jut kérés.
 */
export const CHECKOUT_TURNSTILE_MISSING_ERROR =
  'A fizetés előtti biztonsági ellenőrzés nem futott le. Frissítsd az oldalt, és próbáld újra.'

/**
 * A Cloudflare a tokent elutasította (lejárt, már felhasznált vagy hamis). A
 * kliens ilyenkor új ellenőrzést kér, tehát egy újabb nyomás elég.
 */
export const CHECKOUT_TURNSTILE_REJECTED_ERROR =
  'A biztonsági ellenőrzés lejárt vagy nem sikerült. Várj néhány másodpercet, és nyomd meg újra a gombot. Ha ismét ezt látod, frissítsd az oldalt.'

/**
 * A Cloudflare siteverify nem érhető el (a form-builder útjának 503-as
 * mintája, src/payload.config.ts). A vevő megtudja, hogy pénz nem mozdult, és
 * mit tegyen; az üzemeltető RIASZTÁS-t kap, tehát a kiesés nem néma.
 */
export const CHECKOUT_TURNSTILE_UNAVAILABLE_ERROR =
  'A fizetés előtti biztonsági ellenőrzés most nem érhető el, ezért a fizetés nem indult el. Pénzt nem vontunk le. Próbáld újra néhány perc múlva. ' +
  `Ha sürgős, írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`

/** A Turnstile-kiesés RIASZTÁS-ának fojtása: kiesés alatt ne minden vevő kattintása riasszon. */
export const TURNSTILE_OUTAGE_ALERT_COOLDOWN_MS = 30 * 60 * 1000

export function createCheckoutStartHandler(
  deps: CheckoutStartHandlerDeps,
): (request: NextRequest) => Promise<NextResponse> {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'checkout-start' })
    const env = deps.env ?? process.env

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

    // SEC-008: felső korláttal olvassuk a törzset a parse ELŐTT — az IP-keret
    // a kérések SZÁMÁT fogja, de egy kérés túlméretes törzse így sem
    // bufferelődik korlátlanul (memória-DoS). A törzs a Turnstile-token miatt
    // már a Payload-betöltés és az auth ELŐTT kell.
    const bodyResult = await readJsonWithCap(request)
    if (!bodyResult.ok) {
      return NextResponse.json(
        {
          error:
            'A fizetés nem indítható: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
        },
        { status: 400 },
      )
    }
    const body: unknown = bodyResult.value
    const record: Record<string, unknown> =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {}
    // A token CSAK az ellenőrzéshez kell: a szolgáltatás bemenetéből kimarad,
    // így sem a rendelésre, sem a naplóba nem kerülhet.
    const { turnstileToken, ...input } = record

    /**
     * LÁTHATATLAN TURNSTILE (a-checkout-9) — a Payload-betöltés, az auth, a
     * rendelés-létrehozás és a Barion Start ELŐTT: az IP-pool mögül érkező
     * gépi kérés így sem rendelést, sem Barion-fizetést nem gyárt. Ugyanaz a
     * kapcsoló, mint a form-builder és az ingyenes kurzus útján: secret nélkül
     * nincs ellenőrzés (a kliens ilyenkor a widgetet sem rendereli), élesben
     * az induláskori assert (`turnstileEnvPair`, src/env.ts) a kulcsPÁRT
     * követeli meg, tehát fél-lábas beállítás nem indulhat el.
     */
    const secret = env.TURNSTILE_SECRET_KEY
    if (typeof secret === 'string' && secret.length > 0) {
      if (typeof turnstileToken !== 'string' || turnstileToken.length === 0) {
        log.warn('checkout-start: hiányzó Turnstile-token — 400')
        return NextResponse.json({ error: CHECKOUT_TURNSTILE_MISSING_ERROR }, { status: 400 })
      }
      const verdict = await verifyTurnstile({
        secret,
        token: turnstileToken,
        remoteIp: resolveClientIp(request.headers),
      })
      if (verdict.kind === 'rejected') {
        log.warn('checkout-start: a Turnstile elutasította a tokent — 400', {
          errorCodes: verdict.errorCodes,
        })
        return NextResponse.json({ error: CHECKOUT_TURNSTILE_REJECTED_ERROR }, { status: 400 })
      }
      if (verdict.kind === 'unavailable') {
        const context = {
          reason: verdict.reason,
          status: verdict.status ?? null,
          errorCodes: verdict.errorCodes ?? [],
        }
        if (
          shouldEmitThrottledAlert(
            'turnstile-unavailable:checkout-start',
            TURNSTILE_OUTAGE_ALERT_COOLDOWN_MS,
          )
        ) {
          log.error(
            'RIASZTÁS: a pénztár Turnstile-ellenőrzése nem érhető el — a fizetés indítása 503-at ad, amíg a Cloudflare siteverify vissza nem tér (vagy a TURNSTILE_* kulcsok hibásak)',
            context,
          )
        } else {
          log.warn('checkout-start: a Turnstile-ellenőrzés továbbra sem érhető el — 503', context)
        }
        return NextResponse.json({ error: CHECKOUT_TURNSTILE_UNAVAILABLE_ERROR }, { status: 503 })
      }
    }

    try {
      const payload = await deps.getPayload()

      // A munkamenet feloldása. Bejelentkezve a felhasználó az igazság;
      // vendégként `null` megy tovább, és a szolgáltatás a törzs `guest`
      // blokkjából azonosítja a vevőt (hiánya → 400, magyar üzenettel).
      const { user } = await payload.auth({ headers: request.headers })

      const result = await startCheckout({
        payload,
        user: user ?? null,
        input: input as CheckoutStartInput,
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
