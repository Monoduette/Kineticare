import { type NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'
import { maskEmail } from '../email/mask'
import { hatarozottNevelo } from '../email/templates/order'
import { verifyTurnstileToken } from '../free-course/route-handler'
import { logger, type Logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  RATE_LIMIT_MESSAGE,
  SlidingWindowRateLimiter,
  resolveRateLimitIp,
  type RateLimitRule,
} from '../security/rate-limit'
import { readJsonWithCap } from '../security/request-body'
import { assertSameOrigin } from '../security/same-origin'
import { submitWithdrawal, type SubmitWithdrawalDeps, type WithdrawalOutcome } from './service'
import { parseWithdrawalRequestBody } from './validation'

/**
 * POST /api/elallas: az elállási funkció végpontja.
 *
 * Sorrend: eredet-ellenőrzés → korlátos törzs → validáció → honeypot →
 * IP- és címkeret → Turnstile → feldolgozás (src/lib/withdrawal/service.ts).
 * Ugyanaz a kapu, mint az ingyenes kurzus igénylésén
 * (src/lib/free-course/route-handler.ts): a végpont minden sikeres hívása
 * levelet küld a MEGADOTT címre, tehát keret nélkül levélbombázásra lehetne
 * használni. Bejelentkezés nem kell (NKFH-tájékoztató, 2026. 07. 17.).
 *
 * Minden elutasító üzenet megmondja a másik utat is: az elállás e-mailben is
 * közölhető (22. § (1) b)), ezért egy spam-ellenőrzési vagy szerverhiba nem
 * zárhatja el a vevőt a jogától.
 */

const TEN_MINUTES_MS = 10 * 60 * 1000

/** IP-keret: 5 / 10 perc, a `form-submission` osztályéval azonos. */
export const WITHDRAWAL_IP_RULE: RateLimitRule = { limit: 5, windowMs: TEN_MINUTES_MS }
/** Címkeret: 3 / 10 perc, a jelszó-visszaállításéval azonos (levél a megadott címre). */
export const WITHDRAWAL_EMAIL_RULE: RateLimitRule = { limit: 3, windowMs: TEN_MINUTES_MS }

const defaultLimiter = new SlidingWindowRateLimiter()

const EMAIL_ALTERNATIVE = `írd meg az elállási szándékodat e-mailben ${hatarozottNevelo(
  KAPCSOLATI_EMAIL_TARTALEK,
)} ${KAPCSOLATI_EMAIL_TARTALEK} címre`

export const WITHDRAWAL_BODY_ERROR =
  'A nyilatkozat nem küldhető el: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.'
export const WITHDRAWAL_TURNSTILE_ERROR = `A spam-ellenőrzés nem sikerült. Töltsd újra az oldalt, és próbáld meg még egyszer, vagy ${EMAIL_ALTERNATIVE}.`
export const WITHDRAWAL_UNAVAILABLE_ERROR = `A nyilatkozatot most nem tudtuk fogadni. Próbáld újra néhány perc múlva, vagy ${EMAIL_ALTERNATIVE}.`

export interface WithdrawalHandlerDeps {
  getPayload: () => Promise<Payload>
  limiter?: SlidingWindowRateLimiter
  env?: Readonly<Record<string, string | undefined>>
  verifyTurnstile?: (token: string | null) => Promise<boolean>
  /** A feldolgozás felülírása (teszteléshez); alapból `submitWithdrawal`. */
  submit?: (deps: SubmitWithdrawalDeps) => Promise<WithdrawalOutcome>
  logger?: Logger
}

/** A sikeres válasz törzse (a felület ebből rajzolja a visszaigazolást). */
export interface WithdrawalSuccessBody {
  ok: true
  reference: string
  receivedAt: string
  receiptSent: boolean
}

export function createWithdrawalHandler(
  deps: WithdrawalHandlerDeps,
): (request: NextRequest) => Promise<NextResponse> {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = (deps.logger ?? logger).child({ requestId, route: 'elallas' })
    const env = deps.env ?? process.env
    const limiter = deps.limiter ?? defaultLimiter

    const originCheck = assertSameOrigin(request)
    if (!originCheck.ok) {
      log.warn('elállás: idegen eredet elutasítva')
      return NextResponse.json({ error: originCheck.message }, { status: originCheck.status })
    }

    const bodyResult = await readJsonWithCap(request)
    if (!bodyResult.ok) {
      return NextResponse.json({ error: WITHDRAWAL_BODY_ERROR }, { status: 400 })
    }
    const parsed = parseWithdrawalRequestBody(bodyResult.value)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.errors.join(' ') }, { status: 400 })
    }
    const body = parsed.body

    // Honeypot: botnál látszólagos siker, rögzítés és levél NÉLKÜL.
    if (body.honeypot.length > 0) {
      log.warn('elállás: honeypot kitöltve, a beküldés eldobva', { cimzett: maskEmail(body.email) })
      const fake: WithdrawalSuccessBody = {
        ok: true,
        reference: 'EL-0000000000',
        receivedAt: new Date().toISOString(),
        receiptSent: true,
      }
      return NextResponse.json(fake, { status: 200 })
    }

    const ip = resolveRateLimitIp(request.headers)
    for (const [subject, identifier, rule] of [
      ['ip', ip, WITHDRAWAL_IP_RULE],
      ['email', body.email.toLowerCase(), WITHDRAWAL_EMAIL_RULE],
    ] as const) {
      const decision = limiter.check(`elallas:${subject}:${identifier}`, rule)
      if (!decision.allowed) {
        log.warn('elállás: a kérés túllépte a keretet (429)', {
          subject,
          identifier: subject === 'email' ? maskEmail(identifier) : identifier,
          retryAfterSeconds: decision.retryAfterSeconds,
        })
        return NextResponse.json(
          { error: RATE_LIMIT_MESSAGE },
          { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
        )
      }
    }

    const secret = env.TURNSTILE_SECRET_KEY
    if (typeof secret === 'string' && secret.length > 0) {
      const verify =
        deps.verifyTurnstile ?? ((token: string | null) => verifyTurnstileToken({ secret, token }))
      if (!(await verify(body.turnstileToken))) {
        log.warn('elállás: a spam-ellenőrzés elutasította a beküldést', {
          cimzett: maskEmail(body.email),
        })
        return NextResponse.json({ error: WITHDRAWAL_TURNSTILE_ERROR }, { status: 400 })
      }
    }

    try {
      const payload = await deps.getPayload()
      const outcome = await (deps.submit ?? submitWithdrawal)({
        payload,
        values: { name: body.name, orderReference: body.orderReference, email: body.email },
        logger: log,
        env,
        headers: request.headers,
      })
      // A nyilatkozat akkor érkezett meg, ha BÁRMELY tartós nyoma megvan: a
      // műveletnapló, a stáb levele vagy a vevő elismervénye. Ha egyik sincs,
      // a vevő nem kaphat „megérkezett” választ.
      if (!outcome.recorded && !outcome.staffNotified && !outcome.receiptSent) {
        return NextResponse.json({ error: WITHDRAWAL_UNAVAILABLE_ERROR }, { status: 503 })
      }
      const success: WithdrawalSuccessBody = {
        ok: true,
        reference: outcome.reference,
        receivedAt: outcome.receivedAt,
        receiptSent: outcome.receiptSent,
      }
      return NextResponse.json(success, { status: 200 })
    } catch (error) {
      log.error(
        'RIASZTÁS: elállási nyilatkozat beküldése technikai hibával leállt, a vevő hibaüzenetet kapott',
        {
          cimzett: maskEmail(body.email),
          error: error instanceof Error ? error.message : String(error),
        },
      )
      return NextResponse.json({ error: WITHDRAWAL_UNAVAILABLE_ERROR }, { status: 503 })
    }
  }
}
