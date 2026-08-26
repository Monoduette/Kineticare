import { afterEach, describe, expect, it } from 'vitest'

import {
  PAYLOAD_HTTP_METHOD_OVERRIDE_HEADER,
  checkForgotPasswordEmailRateLimit,
  checkIpRateLimit,
  checkUserRateLimit,
  classifyRateLimitedRoute,
  checkRequestRateLimit,
  payloadRestRateLimitResponse,
  rateLimitHeaders,
  resolveEffectiveHttpMethod,
  resolveRateLimitIp,
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
  UNKNOWN_IP_KEY,
  withPayloadRestRateLimit,
  type RateLimitRule,
} from '../../lib/security/rate-limit'

/**
 * A2 — IP-alapú kérés-korlátozás egységtesztjei.
 *
 * Az idő MINDENHOL injektált órán mozog (`now`), így a csúszóablak viselkedése
 * valós várakozás nélkül, determinisztikusan ellenőrizhető.
 */

const MINUTE = 60_000
const TEN_MINUTES = 10 * MINUTE

/** Léptethető óra a csúszóablak teszteléséhez. */
function createClock(startAt = 1_700_000_000_000) {
  let current = startAt
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

function makeRequest(
  url: string,
  init: { method?: string; ip?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers ?? {})
  if (init.ip) {
    headers.set('x-forwarded-for', init.ip)
  }
  return new Request(url, { method: init.method ?? 'POST', headers })
}

/**
 * Régen: a `cf-connecting-ip` feltétel nélkül nyert, utána az `x-forwarded-for`
 * ELSŐ eleme számított. Az éles kiszolgálás előtt viszont nincs Cloudflare —
 * mindkét érték a KLIENSTŐL jött, tehát kérésenként hamisítható volt, és az
 * IP-alapú keret nem ért célt.
 * Most: a `cf-connecting-ip` csak `TRUST_CF_CONNECTING_IP=true` mellett
 */
describe('resolveRateLimitIp — IP-kinyerés proxy mögül', () => {
  afterEach(() => {
    delete process.env.TRUST_CF_CONNECTING_IP
    delete process.env.TRUSTED_PROXY_HOP_COUNT
  })

  it('több-IP-s x-forwarded-for lánc: a MEGBÍZHATÓ (jobbról első) elem számít', () => {
    // A lánc elejét a kliens küldi, a végét a saját edge-proxynk fűzi hozzá.
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178',
    })
    expect(resolveRateLimitIp(headers)).toBe('150.172.238.178')
  })

  it('a kliens által hamisított lánc-eleje NEM befolyásolja a keret kulcsát', () => {
    // Két kérés, két KÜLÖNBÖZŐ hamisított előtaggal, ugyanarról a valódi IP-ről:
    // a kulcsnak azonosnak kell lennie, különben a korlát megkerülhető.
    const first = resolveRateLimitIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 198.51.100.5' }))
    const second = resolveRateLimitIp(new Headers({ 'x-forwarded-for': '2.2.2.2, 198.51.100.5' }))
    expect(first).toBe('198.51.100.5')
    expect(second).toBe(first)
  })

  it('a hop-szám állítható (TRUSTED_PROXY_HOP_COUNT)', () => {
    process.env.TRUSTED_PROXY_HOP_COUNT = '2'
    const headers = new Headers({ 'x-forwarded-for': '1.1.1.1, 198.51.100.5, 10.0.0.9' })
    expect(resolveRateLimitIp(headers)).toBe('198.51.100.5')
  })

  it('érvénytelen hop-szám → alapértelmezés (1 hop), nem dob', () => {
    for (const value of ['0', '-3', 'sok', '', '99']) {
      process.env.TRUSTED_PROXY_HOP_COUNT = value
      expect(
        resolveRateLimitIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 198.51.100.5' })),
        value,
      ).toBe('198.51.100.5')
    }
  })

  it('a lánc rövidebb a hop-számnál → a legkorábbi elérhető elem (nem dob)', () => {
    process.env.TRUSTED_PROXY_HOP_COUNT = '3'
    expect(resolveRateLimitIp(new Headers({ 'x-forwarded-for': '198.51.100.5' }))).toBe(
      '198.51.100.5',
    )
  })

  it('x-real-ip a végső tartalék, ha nincs x-forwarded-for', () => {
    expect(resolveRateLimitIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('egyelemű lánc körüli whitespace-t levágja', () => {
    expect(resolveRateLimitIp(new Headers({ 'x-forwarded-for': '  198.51.100.5  ' }))).toBe(
      '198.51.100.5',
    )
  })

  it('hiányzó fejléc → közös „ismeretlen" vödör', () => {
    expect(resolveRateLimitIp(new Headers())).toBe(UNKNOWN_IP_KEY)
  })

  it('üres/csak whitespace fejléc → közös „ismeretlen" vödör', () => {
    expect(resolveRateLimitIp(new Headers({ 'x-forwarded-for': '   ' }))).toBe(UNKNOWN_IP_KEY)
  })

  it('undefined fejléc-objektum → közös „ismeretlen" vödör (nem dob)', () => {
    expect(resolveRateLimitIp(undefined)).toBe(UNKNOWN_IP_KEY)
  })

  it('a cf-connecting-ip fejléc ALAPBÓL FIGYELMEN KÍVÜL marad (nincs Cloudflare az éles előtt)', () => {
    // A régi kódon ez a teszt '203.0.113.9'-et várt: a kliens által ráírt
    // fejléc nyert, tehát kérésenként új keretet lehetett szerezni.
    const headers = new Headers({
      'cf-connecting-ip': '9.9.9.9',
      'x-forwarded-for': '10.0.0.1, 203.0.113.9',
    })
    expect(resolveRateLimitIp(headers)).toBe('203.0.113.9')
  })

  it('a cf-connecting-ip CSAK kifejezett kapcsolóval (TRUST_CF_CONNECTING_IP=true) számít', () => {
    process.env.TRUST_CF_CONNECTING_IP = 'true'
    const headers = new Headers({
      'cf-connecting-ip': '9.9.9.9',
      'x-forwarded-for': '10.0.0.1, 203.0.113.9',
    })
    expect(resolveRateLimitIp(headers)).toBe('9.9.9.9')
  })

  it('a kapcsoló bármely más értéke nem bizalom („truthy" vizsgálat nincs)', () => {
    for (const value of ['1', 'igen', 'yes', 'TRUE ', '']) {
      process.env.TRUST_CF_CONNECTING_IP = value
      const headers = new Headers({
        'cf-connecting-ip': '9.9.9.9',
        'x-forwarded-for': '203.0.113.9',
      })
      const expected = value.trim().toLowerCase() === 'true' ? '9.9.9.9' : '203.0.113.9'
      expect(resolveRateLimitIp(headers), value).toBe(expected)
    }
  })

  it('IPv6-cím kisbetűsítve, egységes kulcsként', () => {
    const headers = new Headers({ 'x-forwarded-for': '2001:DB8::CAFE' })
    expect(resolveRateLimitIp(headers)).toBe('2001:db8::cafe')
  })

  it('túlhosszú fejlécérték levágva (memória-visszaélés ellen)', () => {
    const headers = new Headers({ 'x-forwarded-for': 'a'.repeat(5000) })
    expect(resolveRateLimitIp(headers).length).toBeLessThanOrEqual(64)
  })
})

describe('classifyRateLimitedRoute — mit korlátozunk', () => {
  it('a védett POST-végpontok a saját osztályukba esnek', () => {
    expect(classifyRateLimitedRoute('POST', '/api/users')).toBe('registration')
    expect(classifyRateLimitedRoute('POST', '/api/users/login')).toBe('login')
    expect(classifyRateLimitedRoute('POST', '/api/users/forgot-password')).toBe('password-forgot')
    expect(classifyRateLimitedRoute('POST', '/api/users/reset-password')).toBe('password-reset')
    expect(classifyRateLimitedRoute('POST', '/api/checkout/start')).toBe('checkout-start')
    expect(classifyRateLimitedRoute('POST', '/api/form-submissions')).toBe('form-submission')
  })

  it('a Barion-callbacket ÚTVONALON SOSEM korlátozzuk (fizetési értesítés)', () => {
    expect(classifyRateLimitedRoute('POST', '/api/barion/callback')).toBeNull()
  })

  it('az ismeretlen-callback osztály a szabálytáblában van, de NEM útvonal-besorolt', () => {
    expect(RATE_LIMIT_RULES['barion-callback-unknown']).toEqual({
      limit: 20,
      windowMs: TEN_MINUTES,
    })
    expect(classifyRateLimitedRoute('POST', '/api/barion/callback')).toBeNull()
  })

  it('a healthcheck (GET /admin) nem korlátozott', () => {
    expect(classifyRateLimitedRoute('GET', '/admin')).toBeNull()
  })

  it('GET/HEAD/OPTIONS sosem korlátozott, még védett útvonalon sem', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(classifyRateLimitedRoute(method, '/api/users')).toBeNull()
    }
  })

  it('a Payload admin listázó override-ja GET-nek számít, a hamis POST override nem', () => {
    const overrideGet = new Headers({ [PAYLOAD_HTTP_METHOD_OVERRIDE_HEADER]: 'GET' })
    expect(resolveEffectiveHttpMethod('POST', overrideGet)).toBe('GET')
    expect(
      classifyRateLimitedRoute(resolveEffectiveHttpMethod('POST', overrideGet), '/api/users'),
    ).toBeNull()

    const overridePost = new Headers({ [PAYLOAD_HTTP_METHOD_OVERRIDE_HEADER]: 'POST' })
    expect(resolveEffectiveHttpMethod('POST', overridePost)).toBe('POST')
    expect(classifyRateLimitedRoute('POST', '/api/users')).toBe('registration')
  })

  it('a belépés IP-kerete a login osztály — a maxLoginAttempts fiókonként megmarad', () => {
    expect(classifyRateLimitedRoute('POST', '/api/users/login')).toBe('login')
    expect(RATE_LIMIT_RULES.login).toEqual({ limit: 10, windowMs: TEN_MINUTES })
    expect(RATE_LIMIT_RULES['login-email']).toEqual({ limit: 10, windowMs: TEN_MINUTES })
  })

  it('nem felsorolt Payload-végpont érintetlen (nincs prefix-egyezés)', () => {
    expect(classifyRateLimitedRoute('POST', '/api/users/logout')).toBeNull()
    expect(classifyRateLimitedRoute('POST', '/api/orders')).toBeNull()
    expect(classifyRateLimitedRoute('POST', '/api/stream-token')).toBeNull()
  })

  it('a záró perjel és a kisbetűsítés nem kerülő út', () => {
    expect(classifyRateLimitedRoute('POST', '/api/users/')).toBe('registration')
    expect(classifyRateLimitedRoute('post', '/API/Users')).toBe('registration')
    expect(classifyRateLimitedRoute('POST', '/api/form-submissions//')).toBe('form-submission')
  })

  it('a percent-kódolt alak NEM kerülheti meg az osztályozást (M3)', () => {
    // A router a dekódolt útra illeszt — az osztályozónak is azt kell látnia.
    expect(classifyRateLimitedRoute('POST', '/api/users/%66orgot-password')).toBe('password-forgot')
    expect(classifyRateLimitedRoute('POST', '/api/users/%72eset-password')).toBe('password-reset')
    expect(classifyRateLimitedRoute('POST', '/api/%75sers')).toBe('registration')
    expect(classifyRateLimitedRoute('POST', '/api/checkout/%73tart')).toBe('checkout-start')
    expect(classifyRateLimitedRoute('POST', '/api/%66orm-submissions')).toBe('form-submission')
  })

  it('érvénytelen kódolás és dupla-kódolás sem dob, és nem nyit kiskaput', () => {
    // Érvénytelen %-szekvencia: nyers alak marad → nincs osztály (a router sem illeszti).
    expect(classifyRateLimitedRoute('POST', '/api/users/%6')).toBeNull()
    // Dupla-kódolás: egy dekódolás után sem nem lesz védett út (a router is egyszer dekódol).
    expect(classifyRateLimitedRoute('POST', '/api/users/%2566orgot-password')).toBeNull()
  })
})

describe('SlidingWindowRateLimiter — csúszóablak', () => {
  const rule: RateLimitRule = { limit: 3, windowMs: TEN_MINUTES }

  it('a keretig enged, utána elutasít', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now })

    expect(limiter.check('a', rule).allowed).toBe(true)
    expect(limiter.check('a', rule).allowed).toBe(true)
    const third = limiter.check('a', rule)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)

    const fourth = limiter.check('a', rule)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
    expect(fourth.retryAfterSeconds).toBe(TEN_MINUTES / 1000)
  })

  it('a retryAfter a LEGRÉGEBBI találat kicsúszásáig hátralévő idő', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now })

    limiter.check('a', rule)
    clock.advance(4 * MINUTE)
    limiter.check('a', rule)
    limiter.check('a', rule)

    // Az első találat 4 perce volt → még 6 perc az ablakból.
    expect(limiter.check('a', rule).retryAfterSeconds).toBe(6 * 60)
  })

  it('az ablak elcsúszásával újra enged (részlegesen is)', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now })

    limiter.check('a', rule)
    clock.advance(MINUTE)
    limiter.check('a', rule)
    limiter.check('a', rule)
    expect(limiter.check('a', rule).allowed).toBe(false)

    // Az első találat kicsúszik → PONTOSAN egy hely szabadul fel.
    clock.advance(TEN_MINUTES - MINUTE + 1)
    expect(limiter.check('a', rule).allowed).toBe(true)
    expect(limiter.check('a', rule).allowed).toBe(false)
  })

  it('az elutasított kérés NEM tolja tovább az ablakot (nincs örök zárolás)', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now })

    limiter.check('a', rule)
    limiter.check('a', rule)
    limiter.check('a', rule)

    // A kliens az ablak alatt végig hiába dörömböl…
    for (let elapsed = 0; elapsed < TEN_MINUTES; elapsed += MINUTE) {
      expect(limiter.check('a', rule).allowed).toBe(false)
      clock.advance(MINUTE)
    }

    // …az eredeti ablak leteltével mégis felszabadul.
    clock.advance(1)
    expect(limiter.check('a', rule).allowed).toBe(true)
  })

  it('a kulcsok függetlenek (IP + útvonal-osztály)', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now })

    limiter.check('registration:1.1.1.1', rule)
    limiter.check('registration:1.1.1.1', rule)
    limiter.check('registration:1.1.1.1', rule)

    expect(limiter.check('registration:1.1.1.1', rule).allowed).toBe(false)
    expect(limiter.check('registration:2.2.2.2', rule).allowed).toBe(true)
    expect(limiter.check('checkout-start:1.1.1.1', rule).allowed).toBe(true)
  })
})

describe('SlidingWindowRateLimiter — memória-takarítás', () => {
  const rule: RateLimitRule = { limit: 3, windowMs: TEN_MINUTES }

  it('a lejárt bejegyzések eltűnnek (nem szivárog a memória)', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now, sweepIntervalMs: MINUTE })

    for (let index = 0; index < 500; index += 1) {
      limiter.check(`registration:10.0.0.${index}`, rule)
    }
    expect(limiter.trackedKeyCount).toBe(500)

    // Az ablak letelte után az első ellenőrzés söpör: minden régi kulcs eldobva.
    clock.advance(TEN_MINUTES + MINUTE)
    limiter.check('registration:198.51.100.1', rule)

    expect(limiter.trackedKeyCount).toBe(1)
  })

  it('a takarítás nem sűrűbb a sweepIntervalMs-nél, de a friss kulcsot megtartja', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now, sweepIntervalMs: MINUTE })

    limiter.check('registration:10.0.0.1', rule)
    clock.advance(30_000)
    limiter.check('registration:10.0.0.2', rule)

    expect(limiter.trackedKeyCount).toBe(2)
  })

  it('a kulcs-plafon IP-rotációs elárasztásnál is tartja a memóriát', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({
      now: clock.now,
      maxTrackedKeys: 50,
      sweepIntervalMs: MINUTE,
    })

    // 5000 hamisított IP EGY ablakon belül — a plafon fölé sosem megy.
    for (let index = 0; index < 5000; index += 1) {
      limiter.check(`registration:203.0.113.${index}`, rule)
    }

    expect(limiter.trackedKeyCount).toBeLessThanOrEqual(51)
  })

  it('a reset() üríti a számlálót', () => {
    const limiter = new SlidingWindowRateLimiter()
    limiter.check('a', rule)
    expect(limiter.trackedKeyCount).toBe(1)
    limiter.reset()
    expect(limiter.trackedKeyCount).toBe(0)
  })
})

describe('checkRequestRateLimit — kérés-szintű döntés', () => {
  it('a kereten belül null (szabad az út)', () => {
    const limiter = new SlidingWindowRateLimiter()
    const request = makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.1' })
    expect(checkRequestRateLimit(request, { limiter })).toBeNull()
  })

  it('a keret túllépésekor 429-döntés magyar üzenettel és Retry-After-rel', () => {
    const clock = createClock()
    const limiter = new SlidingWindowRateLimiter({ now: clock.now })
    const request = () => makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.2' })

    for (let index = 0; index < RATE_LIMIT_RULES.registration.limit; index += 1) {
      expect(checkRequestRateLimit(request(), { limiter })).toBeNull()
    }

    const rejection = checkRequestRateLimit(request(), { limiter })
    expect(rejection).not.toBeNull()
    expect(rejection?.routeClass).toBe('registration')
    expect(rejection?.message).toBe(RATE_LIMIT_MESSAGE)
    expect(rejection?.message).toContain('Túl sok próbálkozás')
    expect(rejection?.retryAfterSeconds).toBeGreaterThan(0)
    expect(rateLimitHeaders(rejection!)).toEqual({
      'Retry-After': String(rejection!.retryAfterSeconds),
    })
  })

  it('a különböző IP-k nem fogyasztják egymás keretét', () => {
    const limiter = new SlidingWindowRateLimiter()

    for (let index = 0; index < RATE_LIMIT_RULES.registration.limit; index += 1) {
      checkRequestRateLimit(
        makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.3' }),
        { limiter },
      )
    }

    expect(
      checkRequestRateLimit(
        makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.3' }),
        { limiter },
      ),
    ).not.toBeNull()
    expect(
      checkRequestRateLimit(
        makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.4' }),
        { limiter },
      ),
    ).toBeNull()
  })

  it('a védett osztályok külön keretet fogyasztanak ugyanarról az IP-ről', () => {
    const limiter = new SlidingWindowRateLimiter()
    const ip = '203.0.113.5'

    for (let index = 0; index < RATE_LIMIT_RULES['password-forgot'].limit; index += 1) {
      expect(
        checkRequestRateLimit(
          makeRequest('https://kineticare.test/api/users/forgot-password', { ip }),
          { limiter },
        ),
      ).toBeNull()
    }
    expect(
      checkRequestRateLimit(
        makeRequest('https://kineticare.test/api/users/forgot-password', { ip }),
        { limiter },
      ),
    ).not.toBeNull()

    // A regisztráció kerete ettől érintetlen.
    expect(
      checkRequestRateLimit(makeRequest('https://kineticare.test/api/users', { ip }), { limiter }),
    ).toBeNull()
  })

  it('a Barion-callback korlátlanul hívható (a fizetési értesítés sosem eshet ki)', () => {
    const limiter = new SlidingWindowRateLimiter()
    for (let index = 0; index < 200; index += 1) {
      const rejection = checkRequestRateLimit(
        makeRequest('https://kineticare.test/api/barion/callback', { ip: '203.0.113.6' }),
        { limiter },
      )
      expect(rejection).toBeNull()
    }
    expect(limiter.trackedKeyCount).toBe(0)
  })

  it('az admin relationship-listázás (POST + Method-Override GET) nem eszi a regisztrációs keretet', () => {
    const limiter = new SlidingWindowRateLimiter()
    const adminList = () =>
      makeRequest('https://kineticare.test/api/users', {
        ip: '203.0.113.77',
        headers: { [PAYLOAD_HTTP_METHOD_OVERRIDE_HEADER]: 'GET' },
      })

    for (let index = 0; index < 40; index += 1) {
      expect(checkRequestRateLimit(adminList(), { limiter })).toBeNull()
    }

    const register = () => makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.77' })
    for (let index = 0; index < RATE_LIMIT_RULES.registration.limit; index += 1) {
      expect(checkRequestRateLimit(register(), { limiter })).toBeNull()
    }
    expect(checkRequestRateLimit(register(), { limiter })).not.toBeNull()
  })

  it('a GET-eket nem korlátozzuk (healthcheck, olvasás)', () => {
    const limiter = new SlidingWindowRateLimiter()
    for (let index = 0; index < 100; index += 1) {
      expect(
        checkRequestRateLimit(
          makeRequest('https://kineticare.test/admin', { method: 'GET', ip: '203.0.113.8' }),
          { limiter },
        ),
      ).toBeNull()
      expect(
        checkRequestRateLimit(
          makeRequest('https://kineticare.test/api/users', { method: 'GET', ip: '203.0.113.8' }),
          { limiter },
        ),
      ).toBeNull()
    }
    expect(limiter.trackedKeyCount).toBe(0)
  })

  it('IP-fejléc nélkül is korlátoz (közös vödör), nem dob hibát', () => {
    const limiter = new SlidingWindowRateLimiter()
    const request = () => makeRequest('https://kineticare.test/api/users')

    for (let index = 0; index < RATE_LIMIT_RULES.registration.limit; index += 1) {
      expect(checkRequestRateLimit(request(), { limiter })).toBeNull()
    }
    expect(checkRequestRateLimit(request(), { limiter })).not.toBeNull()
  })

  it('a szabályok felülírhatók (hangolhatóság)', () => {
    const limiter = new SlidingWindowRateLimiter()
    const rules = { ...RATE_LIMIT_RULES, registration: { limit: 1, windowMs: TEN_MINUTES } }
    const request = () => makeRequest('https://kineticare.test/api/users', { ip: '203.0.113.10' })

    expect(checkRequestRateLimit(request(), { limiter, rules })).toBeNull()
    expect(checkRequestRateLimit(request(), { limiter, rules })).not.toBeNull()
  })
})

describe('withPayloadRestRateLimit — Payload REST POST beburkolása', () => {
  const rules = { ...RATE_LIMIT_RULES, 'form-submission': { limit: 2, windowMs: TEN_MINUTES } }

  /** A Payload REST-handlerek szignatúrája (@payloadcms/next/routes). */
  type PayloadRestArgs = { params: Promise<{ slug?: string[] }> }
  type PayloadRestHandler = (request: Request, args: PayloadRestArgs) => Promise<Response>

  it('a kereten belül a becsomagolt handler fut, változatlan argumentumokkal', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const seen: unknown[] = []
    const handler = withPayloadRestRateLimit(
      async (request: Request, args: PayloadRestArgs) => {
        seen.push(await args.params)
        return Response.json({ ok: true, method: request.method }, { status: 201 })
      },
      { limiter, rules },
    )

    const response = await handler(
      makeRequest('https://kineticare.test/api/form-submissions', { ip: '203.0.113.11' }),
      { params: Promise.resolve({ slug: ['form-submissions'] }) },
    )

    expect(response.status).toBe(201)
    expect(seen).toEqual([{ slug: ['form-submissions'] }])
  })

  it('a keret felett 429 — a becsomagolt handler EL SEM INDUL', async () => {
    const limiter = new SlidingWindowRateLimiter()
    let calls = 0
    const inner: PayloadRestHandler = async () => {
      calls += 1
      return Response.json({ ok: true }, { status: 201 })
    }
    const handler = withPayloadRestRateLimit(inner, { limiter, rules })
    const send = () =>
      handler(makeRequest('https://kineticare.test/api/form-submissions', { ip: '203.0.113.12' }), {
        params: Promise.resolve({ slug: ['form-submissions'] }),
      })

    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(201)

    const throttled = await send()
    expect(throttled.status).toBe(429)
    expect(calls).toBe(2)
    expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0)

    // Payload-alakú hibatörzs — ezt olvassa ki az auth-client és a kapcsolat-űrlap.
    const body = (await throttled.json()) as { errors: Array<{ message: string }> }
    expect(body.errors[0]?.message).toBe(RATE_LIMIT_MESSAGE)
  })

  it('a nem korlátozott POST-ok érintetlenül haladnak át', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const inner: PayloadRestHandler = async () => Response.json({ ok: true }, { status: 200 })
    const handler = withPayloadRestRateLimit(inner, { limiter, rules })

    for (let index = 0; index < 50; index += 1) {
      const response = await handler(
        makeRequest('https://kineticare.test/api/users/logout', { ip: '203.0.113.13' }),
        { params: Promise.resolve({ slug: ['users', 'logout'] }) },
      )
      expect(response.status).toBe(200)
    }
  })

  it('a 11. azonos-IP-s belépés 429, magyar üzenet, a handler el sem indul', async () => {
    const limiter = new SlidingWindowRateLimiter()
    let calls = 0
    const inner: PayloadRestHandler = async () => {
      calls += 1
      return Response.json({ ok: true }, { status: 200 })
    }
    const handler = withPayloadRestRateLimit(inner, { limiter })
    const send = () =>
      handler(makeRequest('https://kineticare.test/api/users/login', { ip: '203.0.113.40' }), {
        params: Promise.resolve({ slug: ['users', 'login'] }),
      })

    for (let index = 0; index < RATE_LIMIT_RULES.login.limit; index += 1) {
      expect((await send()).status).toBe(200)
    }

    const throttled = await send()
    expect(throttled.status).toBe(429)
    expect(calls).toBe(RATE_LIMIT_RULES.login.limit)
    const body = (await throttled.json()) as { errors: Array<{ message: string }> }
    expect(body.errors[0]?.message).toBe(RATE_LIMIT_MESSAGE)
    expect(body.errors[0]?.message).toContain('Túl sok próbálkozás')
  })

  it('belépés cím-keret: azonos e-mail, más IP — a 10. átmegy, a 11. 429', async () => {
    const limiter = new SlidingWindowRateLimiter()
    let calls = 0
    const inner: PayloadRestHandler = async () => {
      calls += 1
      return Response.json({ ok: true }, { status: 200 })
    }
    const handler = withPayloadRestRateLimit(inner, { limiter })
    const send = (ip: string) =>
      handler(
        new Request('https://kineticare.test/api/users/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ email: 'aldozat@example.test', password: 'x' }),
        }),
        { params: Promise.resolve({ slug: ['users', 'login'] }) },
      )

    for (let index = 0; index < RATE_LIMIT_RULES['login-email'].limit; index += 1) {
      expect((await send(`198.51.100.${index}`)).status).toBe(200)
    }

    const throttled = await send('203.0.113.99')
    expect(throttled.status).toBe(429)
    expect(calls).toBe(RATE_LIMIT_RULES['login-email'].limit)
    const body = (await throttled.json()) as { errors: Array<{ message: string }> }
    expect(body.errors[0]?.message).toBe(RATE_LIMIT_MESSAGE)
  })

  it('a jelszó-emlékeztetőn a CÍM-keret is fog: más IP, azonos cím → 429, e-mail sem megy ki', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const emailRules = {
      ...RATE_LIMIT_RULES,
      'password-forgot-email': { limit: 1, windowMs: TEN_MINUTES },
    }
    let calls = 0
    const inner: PayloadRestHandler = async () => {
      calls += 1
      return Response.json({ message: 'Success' }, { status: 200 })
    }
    const handler = withPayloadRestRateLimit(inner, { limiter, rules: emailRules })
    const send = (ip: string) =>
      handler(
        new Request('https://kineticare.test/api/users/forgot-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ email: 'aldozat@example.test' }),
        }),
        { params: Promise.resolve({ slug: ['users', 'forgot-password'] }) },
      )

    expect((await send('203.0.113.30')).status).toBe(200)

    const throttled = await send('198.51.100.30')
    expect(throttled.status).toBe(429)
    // A Payload-handler EL SEM INDUL — tehát levél sem megy ki.
    expect(calls).toBe(1)
    expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0)
    const body = (await throttled.json()) as { errors: Array<{ message: string }> }
    expect(body.errors[0]?.message).toBe(RATE_LIMIT_MESSAGE)
  })

  it('a becsomagolt handler a törzset VÁLTOZATLANUL megkapja (a keret csak klónt olvas)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const seen: string[] = []
    const inner: PayloadRestHandler = async (request) => {
      seen.push(await request.text())
      return Response.json({ message: 'Success' }, { status: 200 })
    }
    const handler = withPayloadRestRateLimit(inner, { limiter, rules })

    const response = await handler(
      new Request('https://kineticare.test/api/users/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.31' },
        body: JSON.stringify({ email: 'vevo@example.test' }),
      }),
      { params: Promise.resolve({ slug: ['users', 'forgot-password'] }) },
    )

    expect(response.status).toBe(200)
    expect(seen).toEqual([JSON.stringify({ email: 'vevo@example.test' })])
  })
})

/**
 * A jelszó-emlékeztető MÁSODIK, e-mail-címre kulcsolt kerete.
 *
 * Az IP-keret önmagában megkerülhető IP-rotációval (a fejléc-lánc eleje
 * hamisítható) — a cím-keret ezt fogja: EGY postaláda 10 percen belül
 * legfeljebb a keretnyi emlékeztetőt kaphat, bárhonnan is kérték.
 */
describe('checkForgotPasswordEmailRateLimit — per-cím keret', () => {
  /** A cím-keretet 1-re szűkítjük, hogy a MÁSODIK kérés már ütközzön. */
  const rules = {
    ...RATE_LIMIT_RULES,
    'password-forgot-email': { limit: 1, windowMs: TEN_MINUTES },
  }

  const forgotRequest = (email: unknown, ip: string): Request =>
    new Request('https://kineticare.test/api/users/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email }),
    })

  it('KÉT KÜLÖNBÖZŐ IP, AZONOS cím → a második kérés limitálódik', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const cim = 'aldozat@example.test'

    // Mindkét kérés más IP-ről jön, tehát az IP-keret egyiket sem fogja.
    expect(checkRequestRateLimit(forgotRequest(cim, '203.0.113.20'), { limiter, rules })).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(forgotRequest(cim, '203.0.113.20'), {
        limiter,
        rules,
      }),
    ).toBeNull()

    expect(
      checkRequestRateLimit(forgotRequest(cim, '198.51.100.20'), { limiter, rules }),
    ).toBeNull()
    const rejection = await checkForgotPasswordEmailRateLimit(forgotRequest(cim, '198.51.100.20'), {
      limiter,
      rules,
    })

    expect(rejection).not.toBeNull()
    expect(rejection?.routeClass).toBe('password-forgot-email')
    expect(rejection?.message).toBe(RATE_LIMIT_MESSAGE)
    expect(rejection?.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('ugyanarról az IP-ről MÁS cím szabadon kérhető (a keret a címhez tartozik)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const ip = '203.0.113.21'

    expect(
      await checkForgotPasswordEmailRateLimit(forgotRequest('egyik@example.test', ip), {
        limiter,
        rules,
      }),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(forgotRequest('masik@example.test', ip), {
        limiter,
        rules,
      }),
    ).toBeNull()
  })

  it('a cím normalizált: kisbetűsítés és whitespace nem kerülő út', async () => {
    const limiter = new SlidingWindowRateLimiter()

    expect(
      await checkForgotPasswordEmailRateLimit(
        forgotRequest('Aldozat@Example.Test', '203.0.113.22'),
        {
          limiter,
          rules,
        },
      ),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(
        forgotRequest('  aldozat@example.test  ', '198.51.100.22'),
        { limiter, rules },
      ),
    ).not.toBeNull()
  })

  it('a nyers e-mail-cím SOSEM kerül a keret-elutasítás naplójába', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const cim = 'aldozat@example.test'
    const logLines: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      logLines.push(args.map((arg) => String(arg)).join(' '))
    }
    try {
      await checkForgotPasswordEmailRateLimit(forgotRequest(cim, '203.0.113.23'), {
        limiter,
        rules,
      })
      await checkForgotPasswordEmailRateLimit(forgotRequest(cim, '198.51.100.23'), {
        limiter,
        rules,
      })
    } finally {
      console.log = originalLog
    }

    const output = logLines.join('\n')
    expect(output).toContain('rate-limit')
    expect(output).not.toContain(cim)
    // Maszkolt alak: az első betű és a domain marad meg.
    expect(output).toContain('a***@example.test')
  })

  it('a Payload ADMIN multipart űrlapját (_payload) is érti', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const cim = 'admin-uton@example.test'
    const multipart = (ip: string): Request => {
      const form = new FormData()
      form.set('_payload', JSON.stringify({ email: cim }))
      return new Request('https://kineticare.test/api/users/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
        body: form,
      })
    }

    expect(
      await checkForgotPasswordEmailRateLimit(multipart('203.0.113.24'), { limiter, rules }),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(multipart('198.51.100.24'), { limiter, rules }),
    ).not.toBeNull()
  })

  it('cím nélküli / értelmezhetetlen törzs → nincs cím-keret (nem dob, nem is fogyaszt)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const raw = (body: string, contentType = 'application/json'): Request =>
      new Request('https://kineticare.test/api/users/forgot-password', {
        method: 'POST',
        headers: { 'content-type': contentType, 'x-forwarded-for': '203.0.113.25' },
        body,
      })

    expect(
      await checkForgotPasswordEmailRateLimit(raw('ez nem json {'), { limiter, rules }),
    ).toBeNull()
    expect(await checkForgotPasswordEmailRateLimit(raw('{}'), { limiter, rules })).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(raw(JSON.stringify({ email: 42 })), {
        limiter,
        rules,
      }),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(raw('valami', 'text/plain'), { limiter, rules }),
    ).toBeNull()
    expect(limiter.trackedKeyCount).toBe(0)
  })

  it('más útvonalon nem fut (csak a jelszó-emlékeztető POST-ján)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const request = new Request('https://kineticare.test/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'aldozat@example.test' }),
    })

    expect(await checkForgotPasswordEmailRateLimit(request, { limiter, rules })).toBeNull()
    expect(limiter.trackedKeyCount).toBe(0)
  })

  it('a hamisított x-forwarded-for NEM eshet egybe a cím-vödörrel (osztály + névtér)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const cim = 'aldozat@example.test'

    // A támadó IP-nek magát a cím-kulcsot adja meg — az IP-vödör névtere más.
    checkRequestRateLimit(forgotRequest('sajat@example.test', `email:${cim}`), { limiter, rules })

    expect(
      await checkForgotPasswordEmailRateLimit(forgotRequest(cim, '203.0.113.26'), {
        limiter,
        rules,
      }),
    ).toBeNull()
  })
})

/**
 * Per-user keret a hitelesített végpontokra (GET /api/stream-token). Az IP itt
 * nem alkalmas kulcs: egy user IP-t vált, több user oszthat egy NAT-IP-t.
 */
describe('checkIpRateLimit — explicit IP-keret (útvonal-besorolás nélkül)', () => {
  const rules = {
    ...RATE_LIMIT_RULES,
    'barion-callback-unknown': { limit: 2, windowMs: TEN_MINUTES },
  }
  const callbackRequest = (ip: string): Request =>
    makeRequest('https://kineticare.test/api/barion/callback', { ip })

  it('a keretig enged, felette elutasít — az útvonal ettől még null osztályú', () => {
    const limiter = new SlidingWindowRateLimiter()
    const check = () =>
      checkIpRateLimit({
        request: callbackRequest('203.0.113.70'),
        routeClass: 'barion-callback-unknown',
        options: { limiter, rules },
      })

    expect(classifyRateLimitedRoute('POST', '/api/barion/callback')).toBeNull()
    expect(check()).toBeNull()
    expect(check()).toBeNull()
    const rejection = check()
    expect(rejection?.routeClass).toBe('barion-callback-unknown')
    expect(rejection?.message).toBe(RATE_LIMIT_MESSAGE)
    expect(rejection?.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('a különböző IP-k nem fogyasztják egymás keretét', () => {
    const limiter = new SlidingWindowRateLimiter()
    const check = (ip: string) =>
      checkIpRateLimit({
        request: callbackRequest(ip),
        routeClass: 'barion-callback-unknown',
        options: { limiter, rules },
      })

    expect(check('203.0.113.71')).toBeNull()
    expect(check('203.0.113.71')).toBeNull()
    expect(check('203.0.113.71')).not.toBeNull()
    expect(check('203.0.113.72')).toBeNull()
  })

  it('a checkRequestRateLimit a callback úton továbbra sem fogyaszt (útvonal-térkép)', () => {
    const limiter = new SlidingWindowRateLimiter()
    for (let index = 0; index < 50; index += 1) {
      expect(
        checkRequestRateLimit(
          makeRequest('https://kineticare.test/api/barion/callback', { ip: '203.0.113.73' }),
          { limiter },
        ),
      ).toBeNull()
    }
    expect(limiter.trackedKeyCount).toBe(0)
  })
})

describe('checkUserRateLimit — per-user keret', () => {
  const rules = { ...RATE_LIMIT_RULES, 'stream-token': { limit: 2, windowMs: MINUTE } }
  const streamRequest = (): Request =>
    new Request('https://kineticare.test/api/stream-token?productId=42', { method: 'GET' })

  it('a keretig enged, felette 429-döntést ad', () => {
    const limiter = new SlidingWindowRateLimiter()
    const check = () =>
      checkUserRateLimit({
        request: streamRequest(),
        routeClass: 'stream-token',
        userId: 7,
        options: { limiter, rules },
      })

    expect(check()).toBeNull()
    expect(check()).toBeNull()
    const rejection = check()
    expect(rejection?.routeClass).toBe('stream-token')
    expect(rejection?.message).toBe(RATE_LIMIT_MESSAGE)
    expect(rejection?.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('a userek nem fogyasztják egymás keretét (közös IP mögül sem)', () => {
    const limiter = new SlidingWindowRateLimiter()
    const check = (userId: number | string) =>
      checkUserRateLimit({
        request: streamRequest(),
        routeClass: 'stream-token',
        userId,
        options: { limiter, rules },
      })

    expect(check(7)).toBeNull()
    expect(check(7)).toBeNull()
    expect(check(7)).not.toBeNull()
    expect(check(8)).toBeNull()
  })

  it('a valós keret percenkénti (a lejátszó token-frissítését bőven elbírja)', () => {
    expect(RATE_LIMIT_RULES['stream-token']).toEqual({ limit: 60, windowMs: MINUTE })
  })
})

describe('payloadRestRateLimitResponse — a 429 válasz alakja', () => {
  it('429, magyar üzenet, Retry-After fejléc', async () => {
    const response = payloadRestRateLimitResponse({
      routeClass: 'registration',
      message: RATE_LIMIT_MESSAGE,
      retryAfterSeconds: 120,
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(await response.json()).toEqual({ errors: [{ message: RATE_LIMIT_MESSAGE }] })
  })
})
