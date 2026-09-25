import { DynamicServerError } from 'next/dist/client/components/hooks-server-context'
import { BailoutToCSRError } from 'next/dist/shared/lib/lazy-dynamic/bailout-to-csr'
import { notFound, redirect } from 'next/navigation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PostHogCapture, PostHogCaptureEredmeny } from '../lib/feedback/posthog-capture'
import { createLogger } from '../lib/logger'
import {
  createRequestErrorReporter,
  parseStackFrames,
  pathWithoutQuery,
  POSTHOG_EXCEPTION_EVENT,
  REQUEST_ERROR_IGNORED_LOG_MSG,
  REQUEST_ERROR_LOG_MSG,
  throttleKey,
  type RequestErrorContext,
  type RequestErrorRequest,
} from '../lib/request-error'

/**
 * Szerveroldali kérés-hibák (Next `onRequestError`) jelentése.
 *
 * Élő előzmény (2026-09-22, 18:53–19:55 UTC): 28 db 500 a Payload REST-útvonalain,
 * a naplóban csak a Next nyers „⨯ TypeError: Cannot read private member #state …”
 * sorával, request ID és útvonal nélkül; a PostHog hibakövetésben egy sem.
 *
 * HÁLÓZAT NINCS: a PostHog-capture mindenütt injektált; ahol nem szabad futnia,
 * ott hangosan dobó álkliens áll (15. üzemeltetési tanulság).
 */

interface CaptureHivas {
  readonly event: string
  readonly distinctId: string
  readonly properties: Record<string, unknown>
}

function rogzitoCapture(eredmeny: PostHogCaptureEredmeny = { allapot: 'rogzitve' }): {
  capture: PostHogCapture
  hivasok: CaptureHivas[]
} {
  const hivasok: CaptureHivas[] = []
  const capture: PostHogCapture = async (event, distinctId, properties) => {
    hivasok.push({ event, distinctId, properties: { ...properties } })
    return eredmeny
  }
  return { capture, hivasok }
}

const tiltottCapture: PostHogCapture = () => {
  throw new Error('ezen az ágon NEM szabad PostHog-capture-t hívni')
}

const REQUEST_ID = '0f0e6f5e-2b7c-4d3a-9f59-1c2d3e4f5a6b'

function keres(overrides: Partial<RequestErrorRequest> = {}): RequestErrorRequest {
  return {
    path: '/api/payload-preferences/collection-pages-2',
    method: 'POST',
    headers: {
      'x-request-id': REQUEST_ID,
      cookie: 'payload-token=titkos-munkamenet-jwt',
      authorization: 'JWT titkos-fejlec-token',
    },
    ...overrides,
  }
}

const ROUTE_KORNYEZET: RequestErrorContext = {
  routerKind: 'App Router',
  routePath: '/api/[...slug]',
  routeType: 'route',
  revalidateReason: undefined,
}

/** Az élesben látott hiba, V8-veremmel (a hibázó keret elöl). */
function stateHiba(): TypeError {
  const error = new TypeError(
    'Cannot read private member #state from an object whose class did not declare it',
  )
  error.stack = [
    'TypeError: Cannot read private member #state from an object whose class did not declare it',
    '    at new Request (node:internal/deps/undici/undici:9875:25)',
    '    at withBodyLimit (/app/.next/server/chunks/payload-rest-body-limit.js:58:12)',
    '    at async Promise.all (index 0)',
    '    at async POST (/app/node_modules/@payloadcms/next/dist/routes/rest/index.js:40:9)',
  ].join('\n')
  return error
}

function spyLog() {
  return vi.spyOn(console, 'log').mockImplementation(() => undefined)
}

let logSpy: ReturnType<typeof spyLog>

function naplosorok(): Record<string, unknown>[] {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
}

function nyersKimenet(): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
  logSpy = spyLog()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createRequestErrorReporter — strukturált napló', () => {
  it('error szintű JSON-sort ír request ID-vel, metódussal, úttal és route-mintával', () => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: tiltottCapture,
      shouldSend: () => false,
    })

    report(stateHiba(), keres(), ROUTE_KORNYEZET)

    const sorok = naplosorok()
    expect(sorok).toHaveLength(1)
    const [sor] = sorok
    expect(sor.level).toBe('error')
    expect(sor.msg).toBe(REQUEST_ERROR_LOG_MSG)
    expect(sor.requestId).toBe(REQUEST_ID)
    expect(sor.context).toMatchObject({
      method: 'POST',
      path: '/api/payload-preferences/collection-pages-2',
      routePath: '/api/[...slug]',
      routeType: 'route',
      routerKind: 'App Router',
      errorName: 'TypeError',
      errorMessage:
        'Cannot read private member #state from an object whose class did not declare it',
    })
    expect(String((sor.context as Record<string, unknown>).stack)).toContain('withBodyLimit')
  })

  it('fejlécet, sütit és query-t soha nem ír a naplóba; az e-mail-címet maszkolja', () => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: tiltottCapture,
      shouldSend: () => false,
    })

    report(
      new Error('duplicate key: Key (email)=(kiss.anna@example.com) already exists'),
      keres({
        path: '/api/users/reset-password?token=titkos-visszaallito-jegy&email=kiss.anna@example.com',
      }),
      ROUTE_KORNYEZET,
    )

    const kimenet = nyersKimenet()
    expect(kimenet).not.toContain('titkos-munkamenet-jwt')
    expect(kimenet).not.toContain('titkos-fejlec-token')
    expect(kimenet).not.toContain('titkos-visszaallito-jegy')
    expect(kimenet).not.toContain('kiss.anna@example.com')
    const [sor] = naplosorok()
    expect((sor.context as Record<string, unknown>).path).toBe('/api/users/reset-password')
    expect((sor.context as Record<string, unknown>).errorMessage).toContain('k***@example.com')
  })

  it('érvénytelen vagy hiányzó x-request-id esetén nem köt hamis azonosítót', () => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: tiltottCapture,
      shouldSend: () => false,
    })

    report(
      new Error('hiba'),
      keres({ headers: { 'x-request-id': 'rossz id\nhamis-sor' } }),
      ROUTE_KORNYEZET,
    )
    report(new Error('hiba'), keres({ headers: {} }), ROUTE_KORNYEZET)

    for (const sor of naplosorok()) {
      expect(sor).not.toHaveProperty('requestId')
    }
    expect(nyersKimenet()).not.toContain('hamis-sor')
  })

  it('nem Error típusú dobott értéket is naplóz', () => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: tiltottCapture,
      shouldSend: () => false,
    })

    report('valami elromlott', keres(), ROUTE_KORNYEZET)

    const [sor] = naplosorok()
    expect(sor.context).toMatchObject({ errorName: 'NonError', errorMessage: 'valami elromlott' })
  })
})

describe('createRequestErrorReporter — PostHog $exception', () => {
  it('$exception eseményt küld a kézi hibakövetési formátumban, személyes adat nélkül', () => {
    const { capture, hivasok } = rogzitoCapture()
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture,
      shouldSend: () => true,
    })

    report(stateHiba(), keres({ path: '/api/media?depth=0' }), ROUTE_KORNYEZET)

    expect(hivasok).toHaveLength(1)
    const [hivas] = hivasok
    expect(hivas.event).toBe(POSTHOG_EXCEPTION_EVENT)
    expect(hivas.distinctId).toBe(REQUEST_ID)
    expect(hivas.properties).toMatchObject({
      $exception_level: 'error',
      $process_person_profile: false,
      requestId: REQUEST_ID,
      method: 'POST',
      path: '/api/media',
      routePath: '/api/[...slug]',
    })
    const [kivetel] = hivas.properties.$exception_list as Record<string, unknown>[]
    expect(kivetel).toMatchObject({
      type: 'TypeError',
      value: 'Cannot read private member #state from an object whose class did not declare it',
      mechanism: { handled: false, synthetic: false },
    })
    const keretek = (kivetel.stacktrace as { frames: { function: string }[] }).frames
    expect(keretek.at(-1)?.function).toBe('new Request')
    const szoveg = JSON.stringify(hivas.properties)
    expect(szoveg).not.toContain('titkos-munkamenet-jwt')
    expect(szoveg).not.toContain('titkos-fejlec-token')
  })

  it('nem várja meg a PostHogot: a jelentés azonnal visszatér, a napló már kész', () => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: () => new Promise<PostHogCaptureEredmeny>(() => undefined),
      shouldSend: () => true,
    })

    expect(report(stateHiba(), keres(), ROUTE_KORNYEZET)).toBeUndefined()
    expect(naplosorok()).toHaveLength(1)
  })

  it('fojtott kulcsnál nem küld, a naplósor viszont megmarad', () => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: tiltottCapture,
      shouldSend: () => false,
    })

    report(stateHiba(), keres(), ROUTE_KORNYEZET)

    expect(naplosorok()).toHaveLength(1)
    expect(naplosorok()[0].level).toBe('error')
  })

  it('sikertelen vagy elutasított capture-nél warn sort ír, és nem dob', async () => {
    const hibas = createRequestErrorReporter({
      logger: createLogger(),
      capture: rogzitoCapture({ allapot: 'hiba', ok: 'HTTP 503' }).capture,
      shouldSend: () => true,
    })
    const elutasito = createRequestErrorReporter({
      logger: createLogger(),
      capture: () => Promise.reject(new Error('hálózati hiba')),
      shouldSend: () => true,
    })

    expect(() => hibas(stateHiba(), keres(), ROUTE_KORNYEZET)).not.toThrow()
    expect(() => elutasito(stateHiba(), keres(), ROUTE_KORNYEZET)).not.toThrow()

    await vi.waitFor(() => {
      expect(naplosorok().filter((sor) => sor.level === 'warn')).toHaveLength(2)
    })
  })

  it('request ID nélkül véletlen azonosítóval küld', () => {
    const { capture, hivasok } = rogzitoCapture()
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture,
      shouldSend: () => true,
      randomId: () => 'veletlen-azonosito',
    })

    report(new Error('hiba'), keres({ headers: {} }), ROUTE_KORNYEZET)

    expect(hivasok[0].distinctId).toBe('veletlen-azonosito')
  })
})

/** A Next saját függvénye dobja a jelzést; a dobott értéket adjuk vissza. */
function elkapott(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('a Next-függvény nem dobott')
}

const REVALIDATE_KORNYEZET: RequestErrorContext = {
  routerKind: 'App Router',
  routePath: '/sitemap.xml',
  routeType: 'render',
  revalidateReason: 'stale',
}

describe('createRequestErrorReporter — a Next vezérlési jelzései', () => {
  /**
   * Élő előzmény (2026-09): a `force-dynamic` route revalidate-kori statikus
   * renderének megszakítása (DynamicServerError) `$exception`-ként, kezeletlen
   * hibaként jelent meg a hibakövetésben, pedig a Next kiszolgálta az oldalt.
   * A valódi Next-konstruktorok miatt egy Next-frissítés digest-átnevezése
   * ezt a tesztet buktatja.
   */
  it.each([
    ['DynamicServerError (force-dynamic)', () => new DynamicServerError('headers')],
    ['redirect()', () => elkapott(() => redirect('/uj-jelszo?token=titkos-visszaallito-jegy'))],
    ['notFound()', () => elkapott(() => notFound())],
    ['BailoutToCSRError', () => new BailoutToCSRError('useSearchParams()')],
  ])('%s: nincs error szintű sor és nincs $exception', (_nev, jelzes) => {
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture: tiltottCapture,
      shouldSend: () => true,
    })

    report(jelzes(), keres({ method: 'GET', path: '/sitemap.xml' }), REVALIDATE_KORNYEZET)

    const sorok = naplosorok()
    expect(sorok.filter((sor) => sor.level === 'error')).toEqual([])
    expect(sorok.map((sor) => sor.msg)).toEqual([REQUEST_ERROR_IGNORED_LOG_MSG])
    expect(nyersKimenet()).not.toContain('titkos-visszaallito-jegy')
  })

  it('a valódi render-hiba (Next hash-digesttel) továbbra is error sor és $exception', () => {
    const { capture, hivasok } = rogzitoCapture()
    const report = createRequestErrorReporter({
      logger: createLogger(),
      capture,
      shouldSend: () => true,
    })
    const hiba = Object.assign(stateHiba(), { digest: '2317843120' })

    report(hiba, keres(), REVALIDATE_KORNYEZET)

    expect(naplosorok().map((sor) => sor.level)).toEqual(['error'])
    expect(hivasok).toHaveLength(1)
    expect(hivasok[0].properties.digest).toBe('2317843120')
  })
})

describe('segédek', () => {
  it('pathWithoutQuery: a query és a hash lemarad', () => {
    expect(pathWithoutQuery('/reset?token=abc#x')).toBe('/reset')
    expect(pathWithoutQuery('/api/posts/10')).toBe('/api/posts/10')
  })

  it('parseStackFrames: a legrégebbi keret elöl, a hibázó a végén; a nem értelmezhető sor kimarad', () => {
    const keretek = parseStackFrames(stateHiba().stack)
    expect(keretek.map((keret) => keret.function)).toEqual([
      'async POST',
      'withBodyLimit',
      'new Request',
    ])
    expect(keretek.find((keret) => keret.function === 'withBodyLimit')).toMatchObject({
      filename: '/app/.next/server/chunks/payload-rest-body-limit.js',
      lineno: 58,
      colno: 12,
      in_app: true,
    })
    expect(keretek.find((keret) => keret.function === 'new Request')?.in_app).toBe(false)
  })

  it('throttleKey: az azonosítót hordozó üzenetek egy kulcsra esnek', () => {
    expect(throttleKey('PATCH', '/api/[...slug]', 'Error', 'order 123 failed')).toBe(
      throttleKey('PATCH', '/api/[...slug]', 'Error', 'order 456 failed'),
    )
  })
})
