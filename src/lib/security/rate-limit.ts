/**
 * Csúszóablakos kérés-korlátozó a nyilvános, visszaélhető végpontokra.
 *
 * Három független alany, külön névtérrel (`ip:` / `email:` / `user:`): az IP a
 * kliens fejléceiből jön, előtag nélkül az e-mail-keret hamisítható lenne.
 * A számláló folyamaton belüli `Map` (újraindításkor nullázódik; replikánként
 * külön számol). A middleware edge-runtime-ja ezt a Map-et nem tartaná.
 *
 * A Barion-callback NINCS az útvonal-táblában — valódi fizetés értesítését
 * nem szabad globális IP-vödörbe tenni. Ismeretlen GUID-ra a handler hívja
 * a `barion-callback-unknown` keretet. IP-kinyerés: `resolveClientIp`
 * (`cf-connecting-ip` csak `TRUST_CF_CONNECTING_IP=true` mellett).
 */

import { resolveClientIp } from '../audit'
import { maskEmail } from '../email/mask'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { readBodyBytesWithCap, readBodyWithCap } from './request-body'

// ---------------------------------------------------------------------------
// Szabályok (keret + ablak)
// ---------------------------------------------------------------------------

export interface RateLimitRule {
  /** Hány kérés engedélyezett az ablakon belül, alanyonként (IP / e-mail / user). */
  readonly limit: number
  /** A csúszóablak hossza ezredmásodpercben. */
  readonly windowMs: number
}

const ONE_MINUTE_MS = 60 * 1000
const TEN_MINUTES_MS = 10 * 60 * 1000

/**
 * A hangolás egyetlen helye. Emberi használat fölött, gépi visszaélés alatt.
 * Az admin user-létrehozása a `registration` REST-keretet eszi (a seed local
 * API-t használ, azt nem). A Payload admin relationship-listázása viszont
 * POST `/api/users` + `X-Payload-HTTP-Method-Override: GET` — ez NEM
 * regisztráció, GET-ként kell kezelni, különben 5 megnyitás / 10 perc után
 * a „Szakmai ellenőrzést végezte" mező „Hiba történt." pirosat mutat.
 * A `*-email` szabályok IP-rotáció ellen védik a címzettet. A
 * `barion-callback-unknown` csak ismeretlen PaymentId-re megy.
 */
export const RATE_LIMIT_RULES = {
  registration: { limit: 5, windowMs: TEN_MINUTES_MS },
  'password-forgot': { limit: 3, windowMs: TEN_MINUTES_MS },
  'password-forgot-email': { limit: 3, windowMs: TEN_MINUTES_MS },
  'password-reset': { limit: 5, windowMs: TEN_MINUTES_MS },
  'checkout-start': { limit: 10, windowMs: TEN_MINUTES_MS },
  'form-submission': { limit: 5, windowMs: TEN_MINUTES_MS },
  'stream-token': { limit: 60, windowMs: ONE_MINUTE_MS },
  // A haladás-jelölés a stream-tokennel PÁROSÍTVA fut (leckénként legfeljebb
  // egyszer), de ÍR az adatbázisba, és az automatikus, nézettség-alapú jelölés
  // bevezetésével a hívásszám a felhasználói kattintásoktól függetlenné vált.
  // Ugyanaz a per-user keret, mint a jegykiadásé: egy belépett fiók így sem
  // tud korlátlanul haladás-sort létrehozni.
  'course-progress': { limit: 60, windowMs: ONE_MINUTE_MS },
  // A Bunny videótár-listázás EGY hívása akár öt kimenő kérést indít a Bunny
  // felé (MAX_PAGES). A végpont staff-only, tehát nem autentikálatlan
  // erősítő vektor, de a keret nélkül egy elszabadult kliens vagy egy nyitva
  // felejtett fül a saját Bunny-kvótánkat fogyasztaná. Húsz hívás percenként
  // bőven elég a kézi használatra (a panel egy kattintás = egy hívás), és a
  // kimenő kérést felhasználónként százra korlátozza.
  'bunny-videos': { limit: 20, windowMs: ONE_MINUTE_MS },
  // Ismeretlen Barion-PaymentId (nincs orders.barionPaymentId): véletlen
  // GUID-zápor ellen, IP-nként. A handler hívja (`checkIpRateLimit`) — az
  // útvonal NINCS a ROUTE_CLASS_BY_PATH-ban, különben a valódi Barion-retry
  // is ugyanabba a vödörbe esne. 20/10 perc: a ritka versenyhelyzet
  // (callback a barionPaymentId-írás előtt) egy helyet fogyaszt, de átmegy;
  // a gépi GUID-zápor (táblanövekedés + GetState) elakad.
  'barion-callback-unknown': { limit: 20, windowMs: TEN_MINUTES_MS },
  login: { limit: 10, windowMs: TEN_MINUTES_MS },
  'login-email': { limit: 10, windowMs: TEN_MINUTES_MS },
} as const satisfies Record<string, RateLimitRule>

/**
 * A keret-osztály azonosítója. Nem minden osztály jön ÚTVONALBÓL: a
 * `password-forgot-email`, a `login-email`, a `stream-token` és a
 * `barion-callback-unknown` keretét a hívó explicit
 * (`checkForgotPasswordEmailRateLimit`, `checkLoginEmailRateLimit`,
 * `checkUserRateLimit`, `checkIpRateLimit`) fogyasztja.
 */
export type RateLimitedRouteClass = keyof typeof RATE_LIMIT_RULES

/**
 * A keret ALANYA — a kulcstér névtere. Az azonos osztályon belüli, eltérő
 * alanyú vödrök így sosem eshetnek egybe (lásd a modul fejlécét: az IP a
 * kliens fejlécéből jön, tehát névtér nélkül más alany kulcsát hamisítaná).
 */
export type RateLimitSubject = 'ip' | 'email' | 'user'

export type RateLimitRules = Readonly<Record<RateLimitedRouteClass, RateLimitRule>>

/** A felhasználónak megjelenő üzenet — technikai részletet szándékosan nem árul el. */
export const RATE_LIMIT_MESSAGE = 'Túl sok próbálkozás. Próbáld újra pár perc múlva.'

// ---------------------------------------------------------------------------
// Útvonal-osztályozás
// ---------------------------------------------------------------------------

/**
 * PONTOS útvonal → osztály. Prefix-egyezés szándékosan nincs: a `/api/users`
 * (regisztráció) és a `/api/users/login` (IP+e-mail keret; a Payload
 * `maxLoginAttempts` fiókonként továbbra is él) így nem csúszhat össze, és új
 * Payload-végpont sem kerül véletlenül korlátozás alá.
 */
const ROUTE_CLASS_BY_PATH = new Map<string, RateLimitedRouteClass>([
  // Payload REST (a `(payload)/api/[...slug]` catch-all szolgálja ki):
  ['/api/users', 'registration'],
  ['/api/users/login', 'login'],
  ['/api/users/forgot-password', 'password-forgot'],
  ['/api/form-submissions', 'form-submission'],
  // Saját route-handlerek (maguk hívják a `checkRequestRateLimit`-et):
  ['/api/checkout/start', 'checkout-start'],
  // A jelszó-visszaállítást a Payload REST helyett a saját, jelszó-politikát
  // kikényszerítő végpont szolgálja ki (src/lib/security/reset-password-route.ts).
  ['/api/users/reset-password', 'password-reset'],
])

/**
 * Az útvonal normalizálása osztályozás előtt: percent-dekódolás (a router is a
 * dekódolt útra illeszt — különben a `/api/users/%66orgot-password`-féle alak
 * NÉMÁN kikerülné a keretet), kisbetűsítés és a záró perjel(ek) levágása.
 * Érvénytelen kódolásnál a nyers alak marad: az ilyen út a routerben sem
 * illeszkedik védett végpontra, tehát nincs mit megkerülni.
 */
function normalizePathname(pathname: string): string {
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // érvénytelen %-szekvencia — a nyers alakkal osztályozunk
  }
  const lowered = decoded.toLowerCase()
  const trimmed = lowered.replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : '/'
}

/**
 * A Payload admin a collection-listát POST-tal kéri, de ezzel a fejléccel
 * GET-té minősíti (`@payloadcms/ui` Relationship Input). A valódi
 * regisztráció (`POST /api/users` fejléc nélkül) ettől külön él.
 */
export const PAYLOAD_HTTP_METHOD_OVERRIDE_HEADER = 'X-Payload-HTTP-Method-Override'

const SAFE_METHOD_OVERRIDES = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * A rate-limit számára érvényes HTTP-módszer.
 *
 * Csak a Payload által GET/HEAD/OPTIONS-re fordított override számít:
 * egy `X-Payload-HTTP-Method-Override: POST` (vagy PUT) NEM minősíti át
 * a kérést, tehát a regisztrációs keret nem kerülhető meg hamis fejléccel.
 */
export function resolveEffectiveHttpMethod(method: string, headers?: Headers): string {
  const raw = headers?.get(PAYLOAD_HTTP_METHOD_OVERRIDE_HEADER)
  if (typeof raw === 'string') {
    const override = raw.trim().toUpperCase()
    if (SAFE_METHOD_OVERRIDES.has(override)) {
      return override
    }
  }
  return method.toUpperCase()
}

/**
 * Melyik korlátozott osztályba esik a kérés? `null` = nincs korlátozás.
 *
 * Csak a POST korlátozott: a GET/HEAD/OPTIONS olvasás és preflight (a Railway
 * healthcheckje is `GET /admin`), azokat sosem fékezzük. A `method` már
 * a `resolveEffectiveHttpMethod` kimenete legyen, ha a hívó kérésből jön.
 */
export function classifyRateLimitedRoute(
  method: string,
  pathname: string,
): RateLimitedRouteClass | null {
  if (method.toUpperCase() !== 'POST') {
    return null
  }
  return ROUTE_CLASS_BY_PATH.get(normalizePathname(pathname)) ?? null
}

// ---------------------------------------------------------------------------
// IP-kinyerés
// ---------------------------------------------------------------------------

/**
 * Kulcs-hossz plafon: a fejléc értékét a kliens adja, korlát nélkül egy
 * több kilobájtos `x-forwarded-for` közvetlenül memóriát foglalna a `Map`-ben.
 */
const MAX_IP_KEY_LENGTH = 64

/** Az az egyetlen gyűjtő-vödör, ahová az azonosíthatatlan forrású kérések esnek. */
export const UNKNOWN_IP_KEY = 'ismeretlen-ip'

/**
 * Kliens-IP a korlátozás kulcsához. Az extrakció a `resolveClientIp`-pel közös
 * (cf-connecting-ip → x-forwarded-for első eleme), itt csak a kulcsnak való
 * normalizálás történik: trim, kisbetűsítés, hosszvágás.
 *
 * Ha egyik fejléc sincs (pl. közvetlen, proxy nélküli hívás), az összes ilyen
 * kérés EGY közös vödörbe kerül. Éles környezetben a proxy mindig kitölti a
 * fejlécet, tehát ez a gyakorlatban a lokális/direkt hívásokat érinti.
 */
export function resolveRateLimitIp(headers: Headers | undefined): string {
  const raw = resolveClientIp(headers)
  if (!raw) {
    return UNKNOWN_IP_KEY
  }
  const normalized = raw.trim().toLowerCase().slice(0, MAX_IP_KEY_LENGTH)
  return normalized.length > 0 ? normalized : UNKNOWN_IP_KEY
}

// ---------------------------------------------------------------------------
// Csúszóablakos számláló
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  readonly allowed: boolean
  readonly limit: number
  /** Hány kérés fér még bele az ablakba (elutasításnál 0). */
  readonly remaining: number
  /** Hány másodperc múlva próbálkozhat újra (engedélyezésnél 0). */
  readonly retryAfterSeconds: number
}

interface WindowEntry {
  /** Az ablakon belüli találatok időbélyegei, növekvő sorrendben. */
  timestamps: number[]
  /** Ezen időpont után a bejegyzés biztosan elavult, a takarítás eldobhatja. */
  expiresAt: number
}

/** Legfeljebb ennyi kulcsot tartunk nyilván (memória-plafon, lásd `sweep`). */
export const DEFAULT_MAX_TRACKED_KEYS = 20_000

/** Ennél sűrűbben nem söprünk végig a teljes táblán. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000

export interface SlidingWindowRateLimiterOptions {
  /** Injektálható óra — a tesztek így valós várakozás nélkül léptetik az időt. */
  readonly now?: () => number
  readonly maxTrackedKeys?: number
  readonly sweepIntervalMs?: number
}

/**
 * Csúszóablakos (sliding window log) számláló: kulcsonként az ablakba eső
 * találatok időbélyegeit tartja. Pontosabb a fix ablaknál (nincs
 * ablakhatár-ugrás), és a tárigénye kulcsonként legfeljebb `limit` szám.
 */
export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>()
  private readonly now: () => number
  private readonly maxTrackedKeys: number
  private readonly sweepIntervalMs: number
  private lastSweepAt: number

  constructor(options: SlidingWindowRateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    this.lastSweepAt = this.now()
  }

  /** Hány kulcsot tart nyilván (memóriaszivárgás-ellenőrzéshez, teszthez). */
  get trackedKeyCount(): number {
    return this.entries.size
  }

  /** Teljes ürítés (teszt/diagnosztika). */
  reset(): void {
    this.entries.clear()
    this.lastSweepAt = this.now()
  }

  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.now()
    this.sweep(now)

    const windowStart = now - rule.windowMs
    const previous = this.entries.get(key)?.timestamps ?? []
    const recent = previous.filter((timestamp) => timestamp > windowStart)

    if (recent.length >= rule.limit) {
      // Az ELUTASÍTOTT kérést szándékosan NEM számoljuk bele: különben a
      // folyamatosan újrapróbálkozó kliens maga tolná maga előtt az ablakot,
      // és sosem szabadulna ki belőle.
      this.entries.set(key, { timestamps: recent, expiresAt: now + rule.windowMs })
      const oldest = recent[0] ?? now
      return {
        allowed: false,
        limit: rule.limit,
        remaining: 0,
        // Amikor a legrégebbi találat kicsúszik az ablakból, felszabadul egy hely.
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
      }
    }

    recent.push(now)
    this.entries.set(key, { timestamps: recent, expiresAt: now + rule.windowMs })
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - recent.length,
      retryAfterSeconds: 0,
    }
  }

  /**
   * Memória-takarítás, két külön ütemben.
   *
   * 1. TELJES söprés (a lejárt bejegyzések eldobása) — a teljes táblát bejárja,
   *    ezért legfeljebb `sweepIntervalMs`-onként fut. Nem külön időzítőn: az
   *    életben tartaná az event loopot, és a teszteket is megnehezítené.
   * 2. KAPACITÁS-VÁGÁS — minden híváskor lefut, de csak a felesleggel arányos
   *    számú törlést végez, tehát elárasztás alatt is O(1) hívásonként. (Ha ez
   *    is a teljes söpréshez lenne kötve, egy IP-rotációs támadás minden egyes
   *    kérésnél végigjáratná a teljes táblát — pont a támadót erősítené.)
   */
  private sweep(now: number): void {
    if (now - this.lastSweepAt >= this.sweepIntervalMs) {
      this.lastSweepAt = now
      for (const [key, entry] of this.entries) {
        if (entry.expiresAt <= now) {
          this.entries.delete(key)
        }
      }
    }

    // Végső védőháló IP-rotációs elárasztás ellen: a legrégebben felvett
    // kulcsokat ejtjük (a Map beszúrási sorrendet tart). A dobott kulcs
    // legfeljebb új keretet kap — memóriát viszont nem foglal tovább.
    let excess = this.entries.size - this.maxTrackedKeys
    if (excess <= 0) {
      return
    }
    for (const key of this.entries.keys()) {
      this.entries.delete(key)
      excess -= 1
      if (excess <= 0) {
        break
      }
    }
  }
}

/**
 * Az alkalmazás közös számlálója. Modul-szintű példány: a `next start`
 * szerverfolyamatban a route-handlerek ugyanezt látják. (Fejlesztői
 * hot-reloadkor újraépülhet — a számlálók ilyenkor nullázódnak, ami helyben
 * ártalmatlan.)
 */
const defaultRateLimiter = new SlidingWindowRateLimiter()

// ---------------------------------------------------------------------------
// Kérés-szintű ellenőrzés
// ---------------------------------------------------------------------------

export interface RateLimitRejection {
  readonly routeClass: RateLimitedRouteClass
  /** Magyar, felhasználónak megjeleníthető üzenet. */
  readonly message: string
  readonly retryAfterSeconds: number
}

export interface CheckRequestRateLimitOptions {
  readonly limiter?: SlidingWindowRateLimiter
  readonly rules?: RateLimitRules
}

/** A pathname kinyerése; érvénytelen URL esetén üres string (→ nincs korlátozás). */
function safePathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/**
 * Egy vödör fogyasztása. A kulcs `<osztály>:<alany>:<azonosító>` — az alany
 * névtere miatt az IP-, e-mail- és user-vödrök sosem eshetnek egybe.
 *
 * A naplóba a `logIdentifier` kerül, SOSEM a nyers azonosító: e-mail-nél ez a
 * maszkolt cím (`maskEmail`), a többi alanynál maga az azonosító (IP, user-id).
 */
function consumeRateLimit(input: {
  readonly routeClass: RateLimitedRouteClass
  readonly subject: RateLimitSubject
  readonly identifier: string
  readonly logIdentifier: string
  readonly request: Request
  readonly options: CheckRequestRateLimitOptions
}): RateLimitRejection | null {
  const rule = (input.options.rules ?? RATE_LIMIT_RULES)[input.routeClass]
  const limiter = input.options.limiter ?? defaultRateLimiter
  const decision = limiter.check(`${input.routeClass}:${input.subject}:${input.identifier}`, rule)

  if (decision.allowed) {
    return null
  }

  const requestId = getRequestId(input.request.headers) ?? generateRequestId()
  logger
    .child({ requestId, route: 'rate-limit' })
    .warn('rate-limit: a kérés túllépte az alanyonkénti keretet — 429', {
      routeClass: input.routeClass,
      subject: input.subject,
      identifier: input.logIdentifier,
      limit: rule.limit,
      windowMs: rule.windowMs,
      retryAfterSeconds: decision.retryAfterSeconds,
    })

  return {
    routeClass: input.routeClass,
    message: RATE_LIMIT_MESSAGE,
    retryAfterSeconds: decision.retryAfterSeconds,
  }
}

/**
 * A kérés ellenőrzése az IP-keret ellen. `null` = szabad az út (nem korlátozott
 * útvonal, vagy belefér a keretbe). Elutasításkor strukturált warn-log készül a
 * request ID-vel és az IP-vel, majd a hívó a saját válaszformátumában felel
 * 429-cel.
 */
export function checkRequestRateLimit(
  request: Request,
  options: CheckRequestRateLimitOptions = {},
): RateLimitRejection | null {
  const routeClass = classifyRateLimitedRoute(
    resolveEffectiveHttpMethod(request.method, request.headers),
    safePathname(request.url),
  )
  if (!routeClass) {
    return null
  }
  const ip = resolveRateLimitIp(request.headers)
  return consumeRateLimit({
    routeClass,
    subject: 'ip',
    identifier: ip,
    logIdentifier: ip,
    request,
    options,
  })
}

// ---------------------------------------------------------------------------
// Per-user keret (hitelesített végpontok)
// ---------------------------------------------------------------------------

/** Kulcs-hossz plafon a user-azonosítóra (a Payload id szám vagy uuid). */
const MAX_USER_KEY_LENGTH = 64

/**
 * A BEJELENTKEZETT felhasználó keretének fogyasztása. A hívó handler adja meg
 * az osztályt és a user-azonosítót — útvonal-besorolás itt nincs, mert ezek a
 * végpontok GET-ek is lehetnek (`GET /api/stream-token`), a `ROUTE_CLASS_BY_PATH`
 * pedig szándékosan csak POST-ot lát.
 *
 * A user-id NEM titok (a saját tokenjében is szerepel), ezért naplózható.
 */
export function checkUserRateLimit(input: {
  readonly request: Request
  readonly routeClass: RateLimitedRouteClass
  readonly userId: string | number
  readonly options?: CheckRequestRateLimitOptions
}): RateLimitRejection | null {
  const identifier = String(input.userId).trim().slice(0, MAX_USER_KEY_LENGTH)
  if (identifier.length === 0) {
    return null
  }
  return consumeRateLimit({
    routeClass: input.routeClass,
    subject: 'user',
    identifier,
    logIdentifier: identifier,
    request: input.request,
    options: input.options ?? {},
  })
}

// ---------------------------------------------------------------------------
// Explicit IP-keret (útvonal-besorolás nélkül)
// ---------------------------------------------------------------------------

/**
 * Explicit IP-keret fogyasztása — útvonal-besorolás NÉLKÜL.
 *
 * A `checkRequestRateLimit` a `ROUTE_CLASS_BY_PATH`-ból osztályoz; ami nincs
 * a térképen, az onnan mindig szabad. A Barion-callback szándékosan kimarad
 * onnan (egy valódi fizetési értesítés elvesztése pénzt jelent), ezért a
 * handler CSAK az ismeretlen PaymentId-kre hívja ezt, a
 * `barion-callback-unknown` osztállyal. Útvonal-alapú besorolás ide nem jó:
 * az minden POST-ot ugyanabba a vödörbe tenné, a valódi Barion-retry-t is.
 *
 * A hívó dönt a válaszról: a callback-handler 200 no-op-ot ad (a Barion
 * nem-200-ra újra kézbesít), más végpont 429-et építhet.
 */
export function checkIpRateLimit(input: {
  readonly request: Request
  readonly routeClass: RateLimitedRouteClass
  readonly options?: CheckRequestRateLimitOptions
}): RateLimitRejection | null {
  const ip = resolveRateLimitIp(input.request.headers)
  return consumeRateLimit({
    routeClass: input.routeClass,
    subject: 'ip',
    identifier: ip,
    logIdentifier: ip,
    request: input.request,
    options: input.options ?? {},
  })
}

// ---------------------------------------------------------------------------
// Per-email keret (jelszó-emlékeztető)
// ---------------------------------------------------------------------------

/** A cím-kulcs hosszplafonja (RFC 5321 szerinti maximális e-mail-hossz). */
const MAX_EMAIL_KEY_LENGTH = 254

/**
 * Ekkora törzsnél nagyobbat el sem olvasunk a cím kinyeréséhez: a keret-kulcs
 * nem érhet meg egy több megabájtos puffert. Ilyenkor az IP-keret marad az
 * egyetlen fék (a Payload maga úgyis elutasítja az értelmetlen törzset).
 */
export const MAX_FORGOT_BODY_BYTES = 64 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `null` = nincs használható cím a törzsben (a hívó ilyenkor kihagyja a keretet). */
function normalizeEmailKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase().slice(0, MAX_EMAIL_KEY_LENGTH)
  return normalized.length > 0 ? normalized : null
}

/**
 * JSON vagy multipart `_payload` törzsből az `email` mező.
 *
 * A törzset MINDIG a kérés KLÓNJÁBÓL olvassuk, hogy az eredeti kérés
 * változatlanul továbbadható maradjon a Payload-handlernek (ugyanaz a minta,
 * mint a reset-password handlerben). Két formátumot értünk:
 *  - `application/json` — a nyilvános űrlap (`src/lib/auth-client.ts`) és a
 *    közvetlen REST-hívók;
 *  - `multipart/form-data` — a Payload ADMIN űrlapjai, amelyek a mezőket
 *    egyetlen `_payload` nevű JSON-sztringbe csomagolják.
 *
 * Bármilyen hiba (olvashatatlan törzs, ismeretlen content-type) esetén `null`:
 * a cím-keret ilyenkor kimarad, de az IP-keret már lefutott — a bemenet-hiba
 * SOSEM nyithat rést és sosem dobhat a hívó felé.
 */
async function readJsonOrMultipartEmail(request: Request): Promise<string | null> {
  const rawContentType = request.headers.get('content-type') ?? ''
  const contentType = rawContentType.split(';', 1)[0].trim().toLowerCase()

  try {
    if (contentType.startsWith('multipart/')) {
      const bytes = await readBodyBytesWithCap(request.clone(), MAX_FORGOT_BODY_BYTES)
      if (bytes === null) {
        return null
      }
      const bounded = new Request('https://rate-limit.local/', {
        method: 'POST',
        headers: { 'content-type': rawContentType },
        body: bytes,
      })
      const raw = (await bounded.formData()).get('_payload')
      if (typeof raw !== 'string') {
        return null
      }
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? normalizeEmailKey(parsed.email) : null
    }
    if (contentType !== 'application/json') {
      return null
    }
    const body = await readBodyWithCap(request.clone(), MAX_FORGOT_BODY_BYTES)
    if (body === null) {
      return null
    }
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? normalizeEmailKey(parsed.email) : null
  } catch {
    return null
  }
}

/**
 * A jelszó-emlékeztető MÁSODIK kerete: a címzett e-mail-címére kulcsolva.
 *
 * Miért kell az IP-keret mellé: a `password-forgot` IP-keretét IP-rotációval
 * meg lehet kerülni (a fejléc-lánc eleje hamisítható, ha a kérés nem a
 * Cloudflare-en át jön), és onnantól EGY konkrét postaláda korlátlanul
 * bombázható — a végpont minden hívása levelet küld ki. A címre kulcsolt keret
 * ezt a támadást az IP-k számától függetlenül fogja.
 *
 * A nyers cím SOSEM kerül naplóba (maszkolva megy), és a kereten kívül
 * sehol nem tárolódik.
 *
 * `null` = szabad az út (nem ez az útvonal, nincs cím a törzsben, vagy belefér
 * a keretbe).
 */
export async function checkForgotPasswordEmailRateLimit(
  request: Request,
  options: CheckRequestRateLimitOptions = {},
): Promise<RateLimitRejection | null> {
  if (classifyRateLimitedRoute(request.method, safePathname(request.url)) !== 'password-forgot') {
    return null
  }
  const email = await readJsonOrMultipartEmail(request)
  if (!email) {
    return null
  }
  return consumeRateLimit({
    routeClass: 'password-forgot-email',
    subject: 'email',
    identifier: email,
    logIdentifier: maskEmail(email),
    request,
    options,
  })
}

/**
 * A belépés MÁSODIK kerete: a megadott e-mail-címre kulcsolva.
 *
 * Miért kell az IP-keret mellé: a `login` IP-keretét IP-rotációval meg lehet
 * kerülni, és onnantól EGY áldozat fiókját sok forrásról lehet próbálgatni —
 * a Payload `maxLoginAttempts` ilyenkor zárolja az áldozatot. A címre kulcsolt
 * keret ezt a támadást az IP-k számától függetlenül fogja. A
 * `maxLoginAttempts` ettől függetlenül megmarad.
 *
 * A nyers cím SOSEM kerül naplóba (maszkolva megy), és a kereten kívül
 * sehol nem tárolódik.
 *
 * `null` = szabad az út (nem ez az útvonal, nincs cím a törzsben, vagy belefér
 * a keretbe).
 */
export async function checkLoginEmailRateLimit(
  request: Request,
  options: CheckRequestRateLimitOptions = {},
): Promise<RateLimitRejection | null> {
  if (classifyRateLimitedRoute(request.method, safePathname(request.url)) !== 'login') {
    return null
  }
  const email = await readJsonOrMultipartEmail(request)
  if (!email) {
    return null
  }
  return consumeRateLimit({
    routeClass: 'login-email',
    subject: 'email',
    identifier: email,
    logIdentifier: maskEmail(email),
    request,
    options,
  })
}

/** A 429-válasz közös fejlécei (a `Retry-After` másodpercben, RFC 9110). */
export function rateLimitHeaders(rejection: RateLimitRejection): Record<string, string> {
  return { 'Retry-After': String(rejection.retryAfterSeconds) }
}

/**
 * 429-válasz PAYLOAD REST alakban (`{ errors: [{ message }] }`) — ezt olvassa
 * ki a repó két Payload-kliense (`src/lib/auth-client.ts` és a
 * kapcsolat-űrlap `submit.ts`-e). A saját route-handlerek ettől eltérő,
 * dokumentált `{ error }` alakot használnak, ezért ott a hívó építi a választ.
 */
export function payloadRestRateLimitResponse(rejection: RateLimitRejection): Response {
  return Response.json(
    { errors: [{ message: rejection.message }] },
    { status: 429, headers: rateLimitHeaders(rejection) },
  )
}

/**
 * A Payload REST POST-handler beburkolása a korlátozóval. A limit túllépésekor
 * a Payload-handler EL SEM INDUL (nincs DB-hívás, nincs e-mail-küldés).
 *
 * Két keret fut, ebben a sorrendben:
 *  1. IP-keret — olcsó (csak fejlécek), ezért mindig ez az első;
 *  2. a jelszó-emlékeztető VAGY a belépés ágon a CÍM-keret — ehhez a törzset
 *     (a kérés klónjából) el kell olvasni, ezért csak akkor fut le, ha az
 *     IP-keret átengedte a kérést. A két cím-keret útvonalonként kizárólagos.
 */
export function withPayloadRestRateLimit<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
  options: CheckRequestRateLimitOptions = {},
): (request: Request, ...args: Args) => Promise<Response> {
  return async function rateLimitedHandler(request: Request, ...args: Args): Promise<Response> {
    const ipRejection = checkRequestRateLimit(request, options)
    if (ipRejection) {
      return payloadRestRateLimitResponse(ipRejection)
    }
    const emailRejection =
      (await checkForgotPasswordEmailRateLimit(request, options)) ??
      (await checkLoginEmailRateLimit(request, options))
    if (emailRejection) {
      return payloadRestRateLimitResponse(emailRejection)
    }
    return handler(request, ...args)
  }
}
