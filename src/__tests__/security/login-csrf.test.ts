import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOGIN_CSRF_REJECTED_MESSAGE,
  withPayloadLoginCsrfProtection,
} from '../../lib/security/login-csrf'
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
  withPayloadRestRateLimit,
} from '../../lib/security/rate-limit'

const routeCompositionMocks = vi.hoisted(() => {
  const restPostLeaf = vi.fn(async () => Response.json({ ok: true }, { status: 201 }))
  return {
    payloadConfig: Object.freeze({}),
    restPostFactory: vi.fn(() => restPostLeaf),
    restPostLeaf,
  }
})

vi.mock('@payload-config', () => ({ default: routeCompositionMocks.payloadConfig }))

vi.mock('@payloadcms/next/routes', async (importOriginal) => {
  const original = await importOriginal<typeof import('@payloadcms/next/routes')>()
  return {
    ...original,
    REST_POST: routeCompositionMocks.restPostFactory,
  }
})

const APP_ORIGIN = 'https://app.example.test'
const STOREFRONT_ORIGIN = 'https://storefront.example.test'
const LOGIN_PATH = '/api/users/login'

interface RouteContext {
  params: Promise<{ slug: string[] }>
}

function loginContext(): RouteContext {
  return { params: Promise.resolve({ slug: ['users', 'login'] }) }
}

function jsonRequest(
  path = LOGIN_PATH,
  headers: HeadersInit = {},
  method = 'POST',
): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...Object.fromEntries(new Headers(headers)),
    },
    body:
      method === 'GET'
        ? undefined
        : JSON.stringify({ email: 'DUMMY@example.test', password: 'DUMMY_PASSWORD' }),
  })
}

function multipartRequest(headers: HeadersInit = {}): Request {
  const body = new FormData()
  body.set(
    '_payload',
    JSON.stringify({ email: 'DUMMY@example.test', password: 'DUMMY_PASSWORD' }),
  )
  return new Request(`${APP_ORIGIN}${LOGIN_PATH}`, {
    method: 'POST',
    headers,
    body,
  })
}

function passthroughHandler() {
  return vi.fn(async (request: Request, context: RouteContext) => {
    void context
    return Response.json({ body: await request.text() }, { status: 201 })
  })
}

describe('Payload login CSRF pre-handler', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', APP_ORIGIN)
    vi.stubEnv('EXTRA_ALLOWED_ORIGINS', STOREFRONT_ORIGIN)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('a production POST kompozicio a CSRF-ort a limiter es a REST leaf ele teszi', async () => {
    routeCompositionMocks.restPostFactory.mockClear()
    routeCompositionMocks.restPostLeaf.mockClear()

    const { POST } = await import('../../app/(payload)/api/[...slug]/route')

    expect(routeCompositionMocks.restPostFactory).toHaveBeenCalledOnce()
    expect(routeCompositionMocks.restPostFactory).toHaveBeenCalledWith(
      routeCompositionMocks.payloadConfig,
    )

    const ip = '198.51.100.210'
    const rejectedHeaders: HeadersInit[] = [
      { origin: 'https://evil.example.test', 'x-forwarded-for': ip },
      {
        origin: STOREFRONT_ORIGIN,
        'sec-fetch-site': 'cross-site',
        'x-forwarded-for': ip,
      },
    ]

    for (const headers of rejectedHeaders) {
      const request = jsonRequest(LOGIN_PATH, headers)
      const clone = vi.fn(() => {
        throw new Error('A production kompozicio CSRF elutasitas elott nem klonozhat')
      })
      Object.defineProperty(request, 'clone', { value: clone })

      const response = await POST(request, loginContext())

      expect(response.status).toBe(403)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(request.bodyUsed).toBe(false)
      expect(clone).not.toHaveBeenCalled()
    }

    expect(routeCompositionMocks.restPostLeaf).not.toHaveBeenCalled()

    const sendLegitimateLogin = () =>
      POST(
        jsonRequest(LOGIN_PATH, {
          origin: APP_ORIGIN,
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': ip,
        }),
        loginContext(),
      )

    // Ugyanaz az IP: ha a ket 403 fogyasztotta volna a limitert, ez a tiz keres nem menne at.
    for (let index = 0; index < RATE_LIMIT_RULES.login.limit; index += 1) {
      expect((await sendLegitimateLogin()).status).toBe(201)
    }
    expect(routeCompositionMocks.restPostLeaf).toHaveBeenCalledTimes(RATE_LIMIT_RULES.login.limit)

    const throttled = await sendLegitimateLogin()
    expect(throttled.status).toBe(429)
    expect(routeCompositionMocks.restPostLeaf).toHaveBeenCalledTimes(RATE_LIMIT_RULES.login.limit)
    await expect(throttled.json()).resolves.toEqual({
      errors: [{ message: RATE_LIMIT_MESSAGE }],
    })
  })

  it('a cross-site fetch metadata minden más jel fölött 403-at ad cookie nélkül', async () => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(
      jsonRequest(LOGIN_PATH, {
        origin: STOREFRONT_ORIGIN,
        'sec-fetch-site': 'cross-site',
      }),
      loginContext(),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      errors: [{ message: LOGIN_CSRF_REJECTED_MESSAGE }],
    })
    expect(inner).not.toHaveBeenCalled()
  })

  it.each([
    ['idegen Origin', 'https://evil.example.test'],
    ['opaque Origin', 'null'],
    ['ures Origin', ''],
    ['hibas Origin', 'not a valid origin'],
  ])('%s eseten 403-at ad', async (_label, origin) => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(jsonRequest(LOGIN_PATH, { origin }), loginContext())

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(inner).not.toHaveBeenCalled()
  })

  it.each([
    ['idegen Referer', 'https://evil.example.test/sign-in'],
    ['hibas Referer', 'not a valid URL'],
  ])('%s eseten 403-at ad', async (_label, referer) => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(jsonRequest(LOGIN_PATH, { referer }), loginContext())

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(inner).not.toHaveBeenCalled()
  })

  it.each([
    ['hianyzo Content-Type', undefined],
    ['urlencoded', 'application/x-www-form-urlencoded'],
    ['text/plain', 'text/plain'],
  ])('eredetjel nelkuli %s keres 403-at ad', async (_label, contentType) => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)
    const headers = new Headers()
    if (contentType) {
      headers.set('content-type', contentType)
    }
    const request = new Request(`${APP_ORIGIN}${LOGIN_PATH}`, {
      method: 'POST',
      headers,
      body: 'DUMMY_BODY',
    })

    const response = await handler(request, loginContext())

    expect(response.status).toBe(403)
    expect(inner).not.toHaveBeenCalled()
  })

  it('eredetjel nelkuli browser multipart keres 403-at ad', async () => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(multipartRequest(), loginContext())

    expect(response.status).toBe(403)
    expect(inner).not.toHaveBeenCalled()
  })

  it('a visszautasitas megelozi a clone-t, a limitert es a Payload handlert', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const limiterCheck = vi.spyOn(limiter, 'check')
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(
      withPayloadRestRateLimit(inner, { limiter }),
    )
    const request = jsonRequest(LOGIN_PATH, { origin: 'https://evil.example.test' })
    const clone = vi.fn(() => {
      throw new Error('A CSRF guard utan a request.clone nem futhat le')
    })
    Object.defineProperty(request, 'clone', { value: clone })

    const response = await handler(request, loginContext())

    expect(response.status).toBe(403)
    expect(request.bodyUsed).toBe(false)
    expect(clone).not.toHaveBeenCalled()
    expect(limiterCheck).not.toHaveBeenCalled()
    expect(inner).not.toHaveBeenCalled()
  })

  it.each([APP_ORIGIN, STOREFRONT_ORIGIN])(
    'az engedelyezett %s Origin JSON-nal atmegy es a torzs olvashato marad',
    async (origin) => {
      const inner = passthroughHandler()
      const handler = withPayloadLoginCsrfProtection(inner)
      const request = jsonRequest(LOGIN_PATH, {
        origin,
        'sec-fetch-site': origin === APP_ORIGIN ? 'same-origin' : 'same-site',
      })

      const response = await handler(request, loginContext())

      expect(response.status).toBe(201)
      expect(inner).toHaveBeenCalledOnce()
      await expect(response.json()).resolves.toEqual({
        body: JSON.stringify({ email: 'DUMMY@example.test', password: 'DUMMY_PASSWORD' }),
      })
    },
  )

  it.each([APP_ORIGIN, STOREFRONT_ORIGIN])(
    'az engedelyezett %s Origin browser multiparttal atmegy',
    async (origin) => {
      const inner = vi.fn(async (request: Request, context: RouteContext) => {
        void context
        const form = await request.formData()
        return Response.json({ payload: form.get('_payload') }, { status: 201 })
      })
      const handler = withPayloadLoginCsrfProtection(inner)
      const response = await handler(
        multipartRequest({
          origin,
          'sec-fetch-site': origin === APP_ORIGIN ? 'same-origin' : 'same-site',
        }),
        loginContext(),
      )

      expect(response.status).toBe(201)
      expect(inner).toHaveBeenCalledOnce()
      await expect(response.json()).resolves.toEqual({
        payload: JSON.stringify({ email: 'DUMMY@example.test', password: 'DUMMY_PASSWORD' }),
      })
    },
  )

  it('az engedelyezett Referer Origin alapjan atmegy', async () => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(
      jsonRequest(LOGIN_PATH, { referer: `${STOREFRONT_ORIGIN}/belepes?from=checkout` }),
      loginContext(),
    )

    expect(response.status).toBe(201)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('az eredetjel nelkuli application/json a dokumentalt nem-browser kompatibilitasi ut', async () => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(jsonRequest(), loginContext())

    expect(response.status).toBe(201)
    expect(inner).toHaveBeenCalledOnce()
  })

  it.each(['same-origin', 'none'])(
    'a Sec-Fetch-Site: %s nem potolja a hianyzo Origint browser multipartnal',
    async (fetchSite) => {
      const inner = passthroughHandler()
      const handler = withPayloadLoginCsrfProtection(inner)

      const response = await handler(
        multipartRequest({ 'sec-fetch-site': fetchSite }),
        loginContext(),
      )

      expect(response.status).toBe(403)
      expect(inner).not.toHaveBeenCalled()
    },
  )

  it.each(['same-site', 'unexpected-value'])(
    'a csak Sec-Fetch-Site: %s jelzes nem eleg idegen Origin kizarasara',
    async (fetchSite) => {
      const inner = passthroughHandler()
      const handler = withPayloadLoginCsrfProtection(inner)

      const response = await handler(
        multipartRequest({ 'sec-fetch-site': fetchSite }),
        loginContext(),
      )

      expect(response.status).toBe(403)
      expect(inner).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['POST /api/users', '/api/users', 'POST'],
    ['POST /api/users/logout', '/api/users/logout', 'POST'],
    ['POST /api/orders', '/api/orders', 'POST'],
    ['GET /api/users/login', LOGIN_PATH, 'GET'],
  ])('csak a login POST vedett: %s valtozatlanul atmegy', async (_label, path, method) => {
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(inner)

    const response = await handler(
      jsonRequest(path, { origin: 'https://evil.example.test' }, method),
      loginContext(),
    )

    expect(response.status).toBe(201)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('a 11. szabalyos login tovabbra is a meglevo limiter 429 valasza', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const inner = passthroughHandler()
    const handler = withPayloadLoginCsrfProtection(
      withPayloadRestRateLimit(inner, { limiter }),
    )
    const send = () =>
      handler(
        jsonRequest(LOGIN_PATH, {
          origin: APP_ORIGIN,
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': '203.0.113.40',
        }),
        loginContext(),
      )

    for (let index = 0; index < RATE_LIMIT_RULES.login.limit; index += 1) {
      expect((await send()).status).toBe(201)
    }

    const response = await send()
    expect(response.status).toBe(429)
    expect(inner).toHaveBeenCalledTimes(RATE_LIMIT_RULES.login.limit)
    await expect(response.json()).resolves.toEqual({
      errors: [{ message: RATE_LIMIT_MESSAGE }],
    })
  })
})
