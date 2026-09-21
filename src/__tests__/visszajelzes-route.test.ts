import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ANALYTICS_EVENTS } from '../lib/analytics/posthog'
import {
  createPostHogCapture,
  POSTHOG_CAPTURE_PATH,
  POSTHOG_NINCS_BEALLITVA,
  type FetchLike,
  type PostHogCapture,
} from '../lib/feedback/posthog-capture'
import {
  ANONIM_AZONOSITO_ELOTAG,
  createVisszajelzesRouteHandler,
  VISSZAJELZES_TECHNIKAI_HIBA,
  VISSZAJELZES_TORZS_HIBA,
} from '../lib/feedback/route-handler'
import { ISMERETLEN_OLDAL, MI_TORTENT_HIANYZIK_HIBA } from '../lib/feedback/validation'
import type { Logger } from '../lib/logger'
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
} from '../lib/security/rate-limit'
import { SAME_ORIGIN_REJECTED_MESSAGE } from '../lib/security/same-origin'

/**
 * VISSZAJELZÉS-DOBOZ (WP65) — a végpont viselkedése.
 *
 * HÁLÓZAT NINCS: a capture mindenütt injektált. Ahol egy ágon capture-nek NEM
 * szabad futnia, ott hangosan dobó álkliens áll (15. üzemeltetési tanulság),
 * hogy a néma átcsúszás ne maradhasson észrevétlen.
 */

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

interface CaptureHivas {
  event: string
  distinctId: string
  properties: Record<string, unknown>
}

/** Rögzítő álkliens: minden hívást eltesz, és sikert jelent. */
function rogzitoCapture(): { capture: PostHogCapture; hivasok: CaptureHivas[] } {
  const hivasok: CaptureHivas[] = []
  const capture: PostHogCapture = async (event, distinctId, properties) => {
    hivasok.push({ event, distinctId, properties: { ...properties } })
    return { allapot: 'rogzitve' }
  }
  return { capture, hivasok }
}

/** Hangosan dobó álkliens azokra az ágakra, ahol capture-nek NEM szabad futnia. */
const tiltottCapture: PostHogCapture = async () => {
  throw new Error('ezen az ágon NEM szabad PostHog-capture-t hívni')
}

interface NaploFelvetel {
  szint: 'debug' | 'info' | 'warn' | 'error'
  uzenet: string
  context?: Record<string, unknown>
}

function naplo(): { log: Logger; felvetelek: NaploFelvetel[] } {
  const felvetelek: NaploFelvetel[] = []
  const keszit = (szint: NaploFelvetel['szint']) => (uzenet: string, context?: unknown) => {
    felvetelek.push({ szint, uzenet, context: context as Record<string, unknown> | undefined })
  }
  const log: Logger = {
    debug: keszit('debug'),
    info: keszit('info'),
    warn: keszit('warn'),
    error: keszit('error'),
    child: () => log,
  }
  return { log, felvetelek }
}

interface KeresOpciok {
  readonly body?: unknown
  readonly nyersTorzs?: string
  readonly ip?: string
  readonly requestId?: string
  readonly origin?: string
  readonly referer?: string
}

type Handler = ReturnType<typeof createVisszajelzesRouteHandler>

function keres(options: KeresOpciok = {}): Parameters<Handler>[0] {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.ip !== undefined) {
    headers['x-forwarded-for'] = options.ip
  }
  if (options.requestId !== undefined) {
    headers['x-request-id'] = options.requestId
  }
  if (options.origin !== undefined) {
    headers.origin = options.origin
  }
  if (options.referer !== undefined) {
    headers.referer = options.referer
  }
  return new Request('https://pelda.kineticare.hu/api/visszajelzes', {
    method: 'POST',
    headers,
    body: options.nyersTorzs ?? JSON.stringify(options.body ?? {}),
  }) as unknown as Parameters<Handler>[0]
}

/** Minden teszt SAJÁT számlálót kap — a közös vödör nem szennyeződhet. */
function ujHandler(deps: Partial<Parameters<typeof createVisszajelzesRouteHandler>[0]> = {}) {
  const { capture, hivasok } = rogzitoCapture()
  const { log, felvetelek } = naplo()
  const handler = createVisszajelzesRouteHandler({
    capture: deps.capture ?? capture,
    logger: deps.logger ?? log,
    randomId: deps.randomId,
    rateLimit: deps.rateLimit ?? { limiter: new SlidingWindowRateLimiter() },
  })
  return { handler, hivasok, felvetelek }
}

const ERVENYES = {
  miTortent: 'A lecke videója nem tölt be, csak pörög a jelző.',
  mitCsinaltal: 'Megnyitottam a harmadik leckét a Kurzusaim oldalról.',
  oldal: '/kurzusaim/otthoni-kezrehab-program',
}

// ---------------------------------------------------------------------------
// Boldog út
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — a bejelentés átmegy', () => {
  it('200-at ad, és PONTOSAN egyszer rögzít, a szerződés szerinti eseménnyel', async () => {
    const { handler, hivasok } = ujHandler()
    const response = await handler(keres({ body: { ...ERVENYES, analitikaAzonosito: '0199-abc' } }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(hivasok).toHaveLength(1)
    expect(hivasok[0].event).toBe(ANALYTICS_EVENTS.siteFeedback)
    expect(hivasok[0].event).toBe('site_feedback')
    expect(hivasok[0].distinctId).toBe('0199-abc')
    expect(hivasok[0].properties).toEqual({
      page: '/kurzusaim/otthoni-kezrehab-program',
      whatHappened: ERVENYES.miTortent,
      whatWereYouDoing: ERVENYES.mitCsinaltal,
      messageLength: ERVENYES.miTortent.length,
      hasAnalyticsConsent: true,
    })
  })

  it('a hozzájárulásos azonosító VÁLTOZATLANUL megy tovább (nem gyártunk újat)', async () => {
    const { handler, hivasok } = ujHandler({ randomId: () => 'visszajelzes:SOSEM' })
    await handler(keres({ body: { ...ERVENYES, analitikaAzonosito: '0199-kata' } }))
    expect(hivasok[0].distinctId).toBe('0199-kata')
    expect(hivasok[0].properties.hasAnalyticsConsent).toBe(true)
  })

  it('hozzájárulás nélkül ANONIM, előtagos azonosítót kap, és a jelző false', async () => {
    const { handler, hivasok } = ujHandler()
    await handler(keres({ body: ERVENYES }))

    const distinctId = hivasok[0].distinctId
    expect(distinctId.startsWith(ANONIM_AZONOSITO_ELOTAG)).toBe(true)
    expect(distinctId.length).toBeGreaterThan(ANONIM_AZONOSITO_ELOTAG.length)
    expect(hivasok[0].properties.hasAnalyticsConsent).toBe(false)
  })

  it('két hozzájárulás nélküli bejelentés KÜLÖN azonosítót kap (nem összeköthetők)', async () => {
    const { handler, hivasok } = ujHandler()
    await handler(keres({ body: ERVENYES, ip: '10.0.0.1' }))
    await handler(keres({ body: ERVENYES, ip: '10.0.0.1' }))
    expect(hivasok).toHaveLength(2)
    expect(hivasok[0].distinctId).not.toBe(hivasok[1].distinctId)
  })

  it('üres „mit csináltál" mezőből null megy ki, nem üres szöveg', async () => {
    const { handler, hivasok } = ujHandler()
    await handler(keres({ body: { miTortent: ERVENYES.miTortent, oldal: '/' } }))
    expect(hivasok[0].properties.whatWereYouDoing).toBeNull()
    expect(hivasok[0].properties.page).toBe('/')
  })

  it('a hibás `oldal` értékből ismeretlen lesz, de a bejelentés átmegy', async () => {
    const { handler, hivasok } = ujHandler()
    const response = await handler(
      keres({ body: { ...ERVENYES, oldal: '//idegen.hu/csempeszett' } }),
    )
    expect(response.status).toBe(200)
    expect(hivasok[0].properties.page).toBe(ISMERETLEN_OLDAL)
  })

  it('SEMMILYEN esemény-tulajdonság nem visz IP-t, e-mailt vagy nevet', async () => {
    const { handler, hivasok } = ujHandler()
    await handler(
      keres({
        body: { ...ERVENYES, email: 'teszt@pelda.hu', nev: 'Teszt Elek' },
        ip: '203.0.113.9',
      }),
    )
    const kulcsok = Object.keys(hivasok[0].properties)
    for (const tiltott of [
      'email',
      'name',
      'nev',
      'phone',
      'telefon',
      'ip',
      'ipAddress',
      'userId',
    ]) {
      expect(kulcsok).not.toContain(tiltott)
    }
    expect(JSON.stringify(hivasok[0].properties)).not.toContain('203.0.113.9')
    expect(JSON.stringify(hivasok[0].properties)).not.toContain('teszt@pelda.hu')
  })
})

// ---------------------------------------------------------------------------
// Napló
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — a napló a bejelentés második példánya', () => {
  it('info-szinten naplóz, a bejelentés szövegével együtt', async () => {
    const { handler, felvetelek } = ujHandler()
    await handler(keres({ body: ERVENYES, requestId: 'kc-teszt-1' }))

    const info = felvetelek.filter((felvetel) => felvetel.szint === 'info')
    expect(info).toHaveLength(1)
    expect(info[0].context).toEqual({
      oldal: ERVENYES.oldal,
      miTortent: ERVENYES.miTortent,
      mitCsinaltal: ERVENYES.mitCsinaltal,
      hossz: ERVENYES.miTortent.length,
      analitikaHozzajarulas: false,
    })
  })

  it('a request ID a gyermek-loggerre kötve megy (a bejelentés visszakereshető)', async () => {
    const kotesek: Array<Record<string, unknown>> = []
    const { log, felvetelek } = naplo()
    const gyokerLog: Logger = {
      ...log,
      child: (bindings) => {
        kotesek.push(bindings as Record<string, unknown>)
        return log
      },
    }
    const { capture } = rogzitoCapture()
    const handler = createVisszajelzesRouteHandler({
      capture,
      logger: gyokerLog,
      rateLimit: { limiter: new SlidingWindowRateLimiter() },
    })

    await handler(keres({ body: ERVENYES, requestId: 'kc-teszt-42' }))
    expect(kotesek).toEqual([{ requestId: 'kc-teszt-42', route: 'visszajelzes' }])
    expect(felvetelek.some((felvetel) => felvetel.szint === 'info')).toBe(true)
  })

  it('request ID fejléc nélkül is generálódik azonosító (nincs kötés nélküli napló)', async () => {
    const kotesek: Array<Record<string, unknown>> = []
    const { log } = naplo()
    const gyokerLog: Logger = {
      ...log,
      child: (bindings) => {
        kotesek.push(bindings as Record<string, unknown>)
        return log
      },
    }
    const { capture } = rogzitoCapture()
    const handler = createVisszajelzesRouteHandler({
      capture,
      logger: gyokerLog,
      rateLimit: { limiter: new SlidingWindowRateLimiter() },
    })

    await handler(keres({ body: ERVENYES }))
    expect(typeof kotesek[0].requestId).toBe('string')
    expect(String(kotesek[0].requestId).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Csapda
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — csapda (honeypot)', () => {
  it('200-at ad, de SEMMIT nem rögzít', async () => {
    const { handler, felvetelek } = ujHandler({ capture: tiltottCapture })
    const response = await handler(
      keres({ body: { ...ERVENYES, weboldal: 'http://spam.example' } }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(felvetelek.some((felvetel) => felvetel.szint === 'info')).toBe(false)
    expect(felvetelek.some((felvetel) => felvetel.szint === 'warn')).toBe(true)
  })

  it('a látszólagos siker a hibás törzsű bot-beküldésre is áll', async () => {
    const { handler } = ujHandler({ capture: tiltottCapture })
    const response = await handler(keres({ body: { weboldal: 'x' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// Hibás bemenet
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — hibás bemenet', () => {
  it('hiányzó leírásra 400 és magyar üzenet, rögzítés nélkül', async () => {
    const { handler } = ujHandler({ capture: tiltottCapture })
    const response = await handler(keres({ body: { oldal: '/' } }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, uzenet: MI_TORTENT_HIANYZIK_HIBA })
  })

  it('olvashatatlan törzsre 400, magyar üzenettel', async () => {
    const { handler } = ujHandler({ capture: tiltottCapture })
    const response = await handler(keres({ nyersTorzs: '{nem-json' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, uzenet: VISSZAJELZES_TORZS_HIBA })
  })

  it('a 400-as üzenetek magyarul, tegezve szólnak (nincs tiltott hibaszó)', async () => {
    for (const uzenet of [
      MI_TORTENT_HIANYZIK_HIBA,
      VISSZAJELZES_TORZS_HIBA,
      VISSZAJELZES_TECHNIKAI_HIBA,
    ]) {
      expect(uzenet).not.toMatch(/kérjük|sajnos|hopp|érvénytelen|hibakód/iu)
    }
  })
})

// ---------------------------------------------------------------------------
// A capture hibája nem a látogató hibája
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — a rögzítés hibája', () => {
  it('bukó capture mellett is 200 megy vissza, és a hiba naplóba kerül', async () => {
    const capture: PostHogCapture = async () => ({ allapot: 'hiba', ok: 'HTTP 503' })
    const { handler, felvetelek } = ujHandler({ capture })
    const response = await handler(keres({ body: ERVENYES }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const hibak = felvetelek.filter((felvetel) => felvetel.szint === 'error')
    expect(hibak).toHaveLength(1)
    expect(hibak[0].context).toEqual({ ok: 'HTTP 503' })
    // A bejelentés akkor is megvan a naplóban, ha a PostHog nem vette át.
    expect(felvetelek.some((felvetel) => felvetel.szint === 'info')).toBe(true)
  })

  it('beállítatlan PostHog mellett figyelmeztet, de a válasz 200', async () => {
    const capture: PostHogCapture = async () => ({
      allapot: 'kihagyva',
      ok: POSTHOG_NINCS_BEALLITVA,
    })
    const { handler, felvetelek } = ujHandler({ capture })
    const response = await handler(keres({ body: ERVENYES }))

    expect(response.status).toBe(200)
    expect(
      felvetelek.some(
        (felvetel) => felvetel.szint === 'warn' && felvetel.context?.ok === POSTHOG_NINCS_BEALLITVA,
      ),
    ).toBe(true)
  })

  it('DOBÓ capture esetén 500 és magyar üzenet (a bejelentés a naplóban megvan)', async () => {
    const capture: PostHogCapture = async () => {
      throw new Error('váratlan')
    }
    const { handler, felvetelek } = ujHandler({ capture })
    const response = await handler(keres({ body: ERVENYES }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, uzenet: VISSZAJELZES_TECHNIKAI_HIBA })
    expect(felvetelek.some((felvetel) => felvetel.szint === 'info')).toBe(true)
    expect(felvetelek.some((felvetel) => felvetel.szint === 'error')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Keret
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — kérés-korlátozás', () => {
  it('a hatodik beküldés 429-et kap ugyanarról az IP-ről, Retry-After fejléccel', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const { handler, hivasok } = ujHandler({ rateLimit: { limiter } })
    const keret = RATE_LIMIT_RULES.visszajelzes.limit
    expect(keret).toBe(5)

    for (let i = 0; i < keret; i += 1) {
      const ok = await handler(keres({ body: ERVENYES, ip: '198.51.100.7' }))
      expect(ok.status).toBe(200)
    }

    const response = await handler(keres({ body: ERVENYES, ip: '198.51.100.7' }))
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ ok: false, uzenet: RATE_LIMIT_MESSAGE })
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    // A 429-es kérés már NEM rögzít.
    expect(hivasok).toHaveLength(keret)
  })

  it('a keret IP-nként külön számol (egy zajos forrás nem némítja el a többit)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const { handler } = ujHandler({ rateLimit: { limiter } })
    for (let i = 0; i < RATE_LIMIT_RULES.visszajelzes.limit; i += 1) {
      await handler(keres({ body: ERVENYES, ip: '198.51.100.8' }))
    }
    expect((await handler(keres({ body: ERVENYES, ip: '198.51.100.8' }))).status).toBe(429)
    expect((await handler(keres({ body: ERVENYES, ip: '198.51.100.9' }))).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// A PostHog-kliens
// ---------------------------------------------------------------------------

describe('createPostHogCapture — szerver-szerver hívás', () => {
  it('a dokumentált végpontra POST-ol, a dokumentált törzzsel', async () => {
    const hivasok: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn: FetchLike = async (url, init) => {
      hivasok.push({ url, init })
      return new Response('{"status":1}', { status: 200 })
    }
    const capture = createPostHogCapture({
      fetchFn,
      apiKey: 'phc_teszt',
      host: 'https://eu.i.posthog.com/',
      now: () => new Date('2026-09-21T10:00:00.000Z'),
    })

    const eredmeny = await capture('site_feedback', 'visszajelzes:abc', { page: '/' })

    expect(eredmeny).toEqual({ allapot: 'rogzitve' })
    expect(hivasok).toHaveLength(1)
    expect(hivasok[0].url).toBe(`https://eu.i.posthog.com${POSTHOG_CAPTURE_PATH}`)
    expect(POSTHOG_CAPTURE_PATH).toBe('/i/v0/e/')
    expect(hivasok[0].init?.method).toBe('POST')
    expect(JSON.parse(String(hivasok[0].init?.body))).toEqual({
      api_key: 'phc_teszt',
      event: 'site_feedback',
      distinct_id: 'visszajelzes:abc',
      properties: { page: '/' },
      timestamp: '2026-09-21T10:00:00.000Z',
    })
  })

  it('kulcs nélkül NEM hív hálózatot, és üzemeltetési okot ad vissza', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('kulcs nélkül nem szabad hívni')
    }
    const capture = createPostHogCapture({ fetchFn, apiKey: '   ' })
    expect(await capture('site_feedback', 'x', {})).toEqual({
      allapot: 'kihagyva',
      ok: POSTHOG_NINCS_BEALLITVA,
    })
  })

  it('nem-2xx válaszra hiba-állapot jön vissza (dobás nélkül)', async () => {
    const capture = createPostHogCapture({
      fetchFn: async () => new Response('nem jó', { status: 503 }),
      apiKey: 'phc_teszt',
    })
    expect(await capture('site_feedback', 'x', {})).toEqual({ allapot: 'hiba', ok: 'HTTP 503' })
  })

  it('hálózati kivételt elnyel, és hiba-állapottal tér vissza', async () => {
    const capture = createPostHogCapture({
      fetchFn: async () => {
        throw new Error('ETIMEDOUT')
      },
      apiKey: 'phc_teszt',
    })
    expect(await capture('site_feedback', 'x', {})).toEqual({
      allapot: 'hiba',
      ok: 'ETIMEDOUT',
    })
  })

  it('időkorláttal megy ki (a látogató kérése nem várhat egy lassú PostHogra)', async () => {
    let jel: AbortSignal | undefined
    const capture = createPostHogCapture({
      fetchFn: async (_url, init) => {
        jel = init?.signal ?? undefined
        return new Response('{}', { status: 200 })
      },
      apiKey: 'phc_teszt',
      timeoutMs: 5_000,
    })
    await capture('site_feedback', 'x', {})
    expect(jel).toBeInstanceOf(AbortSignal)
  })

  it('a valódi `fetch` SOHA nem hívódik meg ebben a tesztfájlban', () => {
    // Őr-állítás: ha bárki injektálatlan capture-t vezetne be, ez bukik.
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    expect(globalFetch).not.toHaveBeenCalled()
    globalFetch.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Eredet-őr
// ---------------------------------------------------------------------------

describe('POST /api/visszajelzes — eredet-őr (same-origin)', () => {
  const SAJAT = 'https://pelda.kineticare.hu'

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', SAJAT)
    vi.stubEnv('EXTRA_ALLOWED_ORIGINS', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('idegen Origin → 403, a rögzítés EL SEM INDUL', async () => {
    const { handler, felvetelek } = ujHandler({ capture: tiltottCapture })
    const response = await handler(keres({ body: ERVENYES, origin: 'https://evil.example' }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, uzenet: SAME_ORIGIN_REJECTED_MESSAGE })
    // A bejelentés a naplóba sem kerül be: idegen oldalról nem fogadunk el semmit.
    expect(felvetelek.some((felvetel) => felvetel.szint === 'info')).toBe(false)
  })

  it('idegen Referer (Origin nélkül) → szintén 403', async () => {
    const { handler } = ujHandler({ capture: tiltottCapture })
    const response = await handler(keres({ body: ERVENYES, referer: 'https://evil.example/csali' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, uzenet: SAME_ORIGIN_REJECTED_MESSAGE })
  })

  it('saját Origin → a bejelentés a szokott módon átmegy', async () => {
    const { handler, hivasok } = ujHandler()
    const response = await handler(keres({ body: ERVENYES, origin: SAJAT }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(hivasok).toHaveLength(1)
  })

  it('saját Referer (Origin nélkül) → átmegy', async () => {
    const { handler, hivasok } = ujHandler()
    const response = await handler(keres({ body: ERVENYES, referer: `${SAJAT}/kurzusaim` }))
    expect(response.status).toBe(200)
    expect(hivasok).toHaveLength(1)
  })

  it('Origin ÉS Referer nélkül átmegy — a közös őr dokumentált viselkedése', async () => {
    // A `src/lib/security/same-origin.ts` szándékosan enged át fejléc nélküli
    // hívást (curl, üzemeltetői próba, egységteszt); böngészős POST-on a UA
    // mindig küld Origint, tehát a CSRF-út ettől még zárva van. A végpont NEM
    // épít saját, szigorúbb szabályt: a többi POST-handlerrel azonosan viselkedik.
    const { handler } = ujHandler()
    expect((await handler(keres({ body: ERVENYES }))).status).toBe(200)
  })

  it('az eredet-őr ELŐBB fut, mint a keret (idegen kérés nem fogyaszt vödröt)', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const { handler } = ujHandler({ capture: tiltottCapture, rateLimit: { limiter } })
    for (let i = 0; i < RATE_LIMIT_RULES.visszajelzes.limit + 3; i += 1) {
      const response = await handler(
        keres({ body: ERVENYES, origin: 'https://evil.example', ip: '198.51.100.11' }),
      )
      expect(response.status).toBe(403)
    }
    // A valódi látogató keretét az idegen zápor nem ette el.
    const jo = ujHandler({ rateLimit: { limiter } })
    expect(
      (await jo.handler(keres({ body: ERVENYES, origin: SAJAT, ip: '198.51.100.11' }))).status,
    ).toBe(200)
  })

  it('az eredet-üzenet magyar, és nincs benne tiltott hibaszó', () => {
    expect(SAME_ORIGIN_REJECTED_MESSAGE).not.toMatch(/kérjük|sajnos|hopp|érvénytelen|hibakód/iu)
  })
})
