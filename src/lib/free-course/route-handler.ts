import { type NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { maskEmail } from '../email/mask'
import { logger, type Logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  RATE_LIMIT_MESSAGE,
  SlidingWindowRateLimiter,
  resolveRateLimitIp,
  type RateLimitRule,
} from '../security/rate-limit'
import {
  requestFreeCourseAccess,
  type RequestFreeCourseAccessInput,
  type RequestFreeCourseAccessResult,
} from './request-access'
import { FREE_COURSE_GENERIC_ERROR } from './ui-text'
import { parseFreeCourseRequestBody } from './validation'

/**
 * POST /api/free-course/request — az ingyenes kurzus igénylésének route-handlere.
 *
 * A függőségek injektálva vannak (Payload-példány, kérés-korlátozó, Turnstile-
 * ellenőrző, maga a szolgáltatás), így a handler egységtesztelhető; a tényleges
 * route (`src/app/(frontend)/api/free-course/request/route.ts`) csak a valódi
 * configot köti be. Ugyanaz a minta, mint a `checkout/route-handler.ts`-nél.
 *
 * ═══ A SORREND, ÉS MIÉRT ═══
 *  1. JSON-parse és VALIDÁCIÓ — olcsó, helyi; a formailag hibás beküldésre
 *     felesleges bármit is indítani.
 *  2. HONEYPOT — hálózati és adatbázis-hívás nélkül, látszólagos sikerrel
 *     elszáll (a kapcsolat-űrlap ugyanezt teszi kliens-oldalon).
 *  3. IP-KERET — csak fejlécekből dolgozik, tehát a következő, drágább
 *     lépések előtt kell lefutnia.
 *  4. CÍM-KERET — a beküldött e-mail-címre kulcsolva. Enélkül IP-rotációval
 *     egy konkrét postaláda korlátlanul bombázható lenne, hiszen a végpont
 *     minden sikeres hívása levelet küld ki.
 *  5. TURNSTILE — külső HTTP-hívás, tehát a legutolsó kapu a szolgáltatás előtt.
 *  6. A szolgáltatás (fiók, hozzáférés, levél).
 *
 * ═══ MIÉRT SAJÁT SZÁMLÁLÓ ═══
 * A `checkRequestRateLimit` ÚTVONAL-térképből (`ROUTE_CLASS_BY_PATH`) osztályoz,
 * és abba a táblába új sort felvenni a megosztott biztonsági modul módosítása.
 * Ehelyett a modul EXPORTÁLT primitívjét (`SlidingWindowRateLimiter`) használjuk
 * a saját, itt kimondott szabályokkal: a csúszóablak-logika így NEM duplikálódik,
 * és a kulcstér is diszjunkt marad (`free-course-request:<alany>:<azonosító>`).
 *
 * ═══ FIÓK-FELDERÍTÉS ELLENI VÉDELEM ═══
 * A 200-as válasz `{ ok: true, emailSent }` — és PONTOSAN UGYANEZ megy ki
 * akkor is, ha a címhez már volt fiók, és akkor is, ha most jött létre. A
 * szolgáltatás `userCreated` mezője SZÁNDÉKOSAN nem kerül a válaszba; ha
 * bekerülne, egy címlista végigküldésével kiderülne, kik a vevőink (OWASP
 * user enumeration). Az `emailSent` NEM szivárogtat: az kizárólag a szerver
 * levelező-konfigurációjától függ, a címtől nem.
 */

/** Két külön keret-szabály. Az értékek a `RATE_LIMIT_RULES` táblájának logikáját követik. */
const TEN_MINUTES_MS = 10 * 60 * 1000

/**
 * IP-keret: 5 / 10 perc. Azonos a `form-submission` osztályéval — egy
 * háztartás vagy iroda mögül is elfér néhány valódi igénylés, gépi
 * fiók-gyártás viszont elakad.
 */
export const FREE_COURSE_IP_RULE: RateLimitRule = { limit: 5, windowMs: TEN_MINUTES_MS }

/**
 * CÍM-keret: 3 / 10 perc. Azonos a `password-forgot-email` osztályéval, mert a
 * kockázat is azonos: a végpont minden sikeres hívása levelet küld a MEGADOTT
 * címre, tehát mail-bombing eszköze lehetne. Valódi látogatónak 1-2
 * próbálkozás bőven elég.
 */
export const FREE_COURSE_EMAIL_RULE: RateLimitRule = { limit: 3, windowMs: TEN_MINUTES_MS }

/** Az alkalmazás közös számlálója ehhez a végponthoz (folyamaton belüli). */
const defaultLimiter = new SlidingWindowRateLimiter()

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Cloudflare Turnstile token ellenőrzése.
 *
 * MIÉRT ITT: a form-builder útján a `payload.config.ts` `verifyTurnstile`
 * hookja végzi ezt, de az a hook a `form-submissions` collectionhez van kötve
 * és nincs exportálva. A saját végpont ezért a saját kapuját hozza — azonos
 * szabállyal: SECRET NÉLKÜL nincs ellenőrzés (a kliens ilyenkor a widgetet sem
 * rendereli), secret mellett a token KÖTELEZŐ.
 *
 * A `fetch` injektálható, hogy a teszt SOHA ne indítson valódi hálózati hívást.
 */
export async function verifyTurnstileToken(input: {
  secret: string
  token: string | null
  fetchImpl?: FetchLike
}): Promise<boolean> {
  if (typeof input.token !== 'string' || input.token.length === 0) {
    return false
  }
  const fetchImpl = input.fetchImpl ?? fetch
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: input.secret, response: input.token }),
      signal: AbortSignal.timeout(10_000),
    })
    const result = (await response.json().catch(() => ({}))) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}

export interface FreeCourseRequestHandlerDeps {
  getPayload: () => Promise<Payload>
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös számláló. */
  limiter?: SlidingWindowRateLimiter
  /** Környezet (TURNSTILE_SECRET_KEY, NEXT_PUBLIC_SERVER_URL, e-mail-kulcsok). */
  env?: Readonly<Record<string, string | undefined>>
  /** Turnstile-ellenőrzés felülírása (teszthez). */
  verifyTurnstile?: (token: string | null) => Promise<boolean>
  /** A szolgáltatás felülírása (teszthez). */
  requestAccess?: (input: RequestFreeCourseAccessInput) => Promise<RequestFreeCourseAccessResult>
  logger?: Logger
}

/** A `NEXT_PUBLIC_SERVER_URL` normalizálása; hiány/üres → `null` (a levél elmarad). */
export function resolveServerUrlOrNull(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const raw = env.NEXT_PUBLIC_SERVER_URL
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null
  }
  return raw.trim().replace(/\/+$/, '')
}

/** Egy vödör fogyasztása; `null` = belefér a keretbe. */
function consume(input: {
  limiter: SlidingWindowRateLimiter
  subject: 'ip' | 'email'
  identifier: string
  logIdentifier: string
  rule: RateLimitRule
  log: Logger
}): { retryAfterSeconds: number } | null {
  const decision = input.limiter.check(
    `free-course-request:${input.subject}:${input.identifier}`,
    input.rule,
  )
  if (decision.allowed) {
    return null
  }
  input.log.warn('ingyenes kurzus igénylése: a kérés túllépte a keretet — 429', {
    subject: input.subject,
    identifier: input.logIdentifier,
    limit: input.rule.limit,
    windowMs: input.rule.windowMs,
    retryAfterSeconds: decision.retryAfterSeconds,
  })
  return { retryAfterSeconds: decision.retryAfterSeconds }
}

/**
 * A 429-válasz burkolata. A `Retry-After` másodpercben megy (RFC 9110), a
 * megosztott `rateLimitHeaders`-szel azonos alakban — azt itt azért nem
 * hívjuk, mert a típusa a teljes `RateLimitRejection`-t kéri (osztály + üzenet),
 * és kitalált osztálynevet nem adunk át csak azért, hogy a típus stimmeljen.
 */
function retryAfter(rejection: { retryAfterSeconds: number }): {
  status: number
  headers: Record<string, string>
} {
  return { status: 429, headers: { 'Retry-After': String(rejection.retryAfterSeconds) } }
}

/** Magyar üzenet a nem igényelhető kurzusra (a §3.2 #16 magyarázó mondatának rokona). */
export const FREE_COURSE_UNAVAILABLE_ERROR =
  'Ez a kurzus most nem igényelhető. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.'

/** Magyar üzenet a sikertelen spam-ellenőrzésre (a form-builder hookjával azonos hangon). */
export const FREE_COURSE_TURNSTILE_ERROR =
  'A spam-ellenőrzés nem sikerült. Töltsd újra az oldalt, és próbáld meg még egyszer.'

export function createFreeCourseRequestHandler(
  deps: FreeCourseRequestHandlerDeps,
): (request: NextRequest) => Promise<NextResponse> {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = (deps.logger ?? logger).child({ requestId, route: 'free-course-request' })
    const env = deps.env ?? process.env
    const limiter = deps.limiter ?? defaultLimiter

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json(
        {
          error:
            'Az igénylés nem küldhető el: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
        },
        { status: 400 },
      )
    }

    const parsed = parseFreeCourseRequestBody(raw)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.errors.join(' ') }, { status: 400 })
    }
    const body = parsed.body

    // HONEYPOT: emberi látogató sosem tölti ki (a mező vizuálisan és a
    // billentyű-navigációból is rejtett). Bot gyanúnál látszólagos siker megy
    // vissza — fiók, hozzáférés és levél NÉLKÜL. A látszólagos siker
    // szándékos: a botnak ne legyen visszajelzése arról, hogy lebukott.
    if (body.honeypot.length > 0) {
      log.warn('ingyenes kurzus igénylése: honeypot kitöltve — a beküldés eldobva', {
        cimzett: maskEmail(body.email),
      })
      return NextResponse.json({ ok: true, emailSent: true }, { status: 200 })
    }

    const ip = resolveRateLimitIp(request.headers)
    const ipRejection = consume({
      limiter,
      subject: 'ip',
      identifier: ip,
      logIdentifier: ip,
      rule: FREE_COURSE_IP_RULE,
      log,
    })
    if (ipRejection) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, retryAfter(ipRejection))
    }

    const emailRejection = consume({
      limiter,
      subject: 'email',
      identifier: body.email,
      logIdentifier: maskEmail(body.email),
      rule: FREE_COURSE_EMAIL_RULE,
      log,
    })
    if (emailRejection) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, retryAfter(emailRejection))
    }

    // SPAM-ELLENŐRZÉS. Secret nélkül kikapcsolt (ilyenkor a kliens a widgetet
    // sem rendereli) — ugyanaz a szabály, mint a form-builder útján, tehát
    // nincs hamis biztonságérzet, és a védelmet a fenti két keret adja.
    const secret = env.TURNSTILE_SECRET_KEY
    if (typeof secret === 'string' && secret.length > 0) {
      const verify =
        deps.verifyTurnstile ??
        ((token: string | null) => verifyTurnstileToken({ secret, token }))
      if (!(await verify(body.turnstileToken))) {
        log.warn('ingyenes kurzus igénylése: a spam-ellenőrzés elutasította a beküldést', {
          cimzett: maskEmail(body.email),
        })
        return NextResponse.json({ error: FREE_COURSE_TURNSTILE_ERROR }, { status: 400 })
      }
    }

    try {
      const payload = await deps.getPayload()
      const { user: actor } = await payload.auth({ headers: request.headers })
      const runRequest = deps.requestAccess ?? requestFreeCourseAccess
      const result = await runRequest({
        payload,
        productId: body.productId,
        name: body.name,
        email: body.email,
        serverUrl: resolveServerUrlOrNull(env),
        logger: log,
        env,
        actorUserId: typeof actor?.id === 'number' ? actor.id : null,
      })

      if (result.status === 'course-not-available') {
        return NextResponse.json({ error: FREE_COURSE_UNAVAILABLE_ERROR }, { status: 400 })
      }
      if (result.status !== 'ok') {
        // A hozzáférés nem jött létre — a látogató NEM kaphat sikerüzenetet.
        return NextResponse.json({ error: FREE_COURSE_GENERIC_ERROR }, { status: 500 })
      }

      // A válasz MINDEN sikeres ágon azonos alakú és tartalmú (a `userCreated`
      // szándékosan kimarad) — lásd a fájl fejlécében a fiók-felderítést.
      return NextResponse.json({ ok: true, emailSent: result.emailDelivered }, { status: 200 })
    } catch (error) {
      log.error('ingyenes kurzus igénylése: váratlan technikai hiba', {
        cimzett: maskEmail(body.email),
        error: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
      })
      return NextResponse.json({ error: FREE_COURSE_GENERIC_ERROR }, { status: 500 })
    }
  }
}
