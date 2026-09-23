import { NextRequest } from 'next/server'
import { types } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withPrivateCourseFileResponse } from '../../access/privateResponse'
import { withPayloadRestBodyLimit } from '../../lib/security/payload-rest-body-limit'

/**
 * A Next 16 app-route a route handlernek nem magát a NextRequest-et adja,
 * hanem egy Proxyt (next/dist/server/route-modules/app-route/module.js,
 * `proxyNextRequest`). A get-trap a gettereket a targeten futtatja, a
 * függvényeket a targethez köti, így `request.method`, `request.headers` és
 * `request.text()` működik. A Node 24 (undici 7) `Request` konstruktora
 * viszont az `input`-ként kapott Request privát `#state` mezőjét olvassa, ami
 * Proxyn TypeError. A #289 így élesben minden nem-multipart POST/PATCH/PUT
 * kérést 500-ra futtatott.
 *
 * A szabály: a bejövő kérést egyetlen wrapper sem adhatja `new Request()`
 * inputjaként, csak a mezőit másolhatja.
 */

const ORIGIN = 'https://kineticare.test'

/** A Next 16 `proxyNextRequest` get-trapjének másolata (receiver = target). */
function nextRouteRequest(
  url: string,
  init: ConstructorParameters<typeof NextRequest>[1],
): Request {
  const target = new NextRequest(url, init)
  return new Proxy(target, {
    get(proxied, prop) {
      const value: unknown = Reflect.get(proxied, prop, proxied)
      return typeof value === 'function' ? value.bind(proxied) : value
    },
  })
}

/**
 * Az undici 7 viselkedése Node-verziótól függetlenül: a Node 22-es helyi futás
 * is ugyanazt lássa, mint a Node 24-es CI és az éles szerver.
 */
const NativeRequest = globalThis.Request
class Undici7Request extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (types.isProxy(input)) {
      throw new TypeError(
        'Cannot read private member #state from an object whose class did not declare it',
      )
    }
    super(input, init)
  }
}

beforeEach(() => {
  vi.stubGlobal('Request', Undici7Request)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('withPayloadRestBodyLimit a Next route-handler Proxyjával', () => {
  it('a JSON POST (vevői belépés) URL-lel, fejlécekkel és törzzsel jut el a Payloadig', async () => {
    const inner = vi.fn(async (request: Request) =>
      Response.json({
        body: await request.json(),
        contentType: request.headers.get('content-type'),
        cookie: request.headers.get('cookie'),
        method: request.method,
        url: request.url,
      }),
    )
    const response = await withPayloadRestBodyLimit(inner)(
      nextRouteRequest(`${ORIGIN}/api/users/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'payload-token=abc' },
        body: JSON.stringify({ email: 'vevo@example.test', password: 'titkos' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({
      body: { email: 'vevo@example.test', password: 'titkos' },
      contentType: 'application/json',
      cookie: 'payload-token=abc',
      method: 'POST',
      url: `${ORIGIN}/api/users/login`,
    })
  })

  it('a method-override urlencoded POST (admin kapcsolatmező-listázás) is átmegy', async () => {
    const inner = vi.fn(async (request: Request) =>
      Response.json({
        body: await request.text(),
        override: request.headers.get('x-payload-http-method-override'),
      }),
    )
    const response = await withPayloadRestBodyLimit(inner)(
      nextRouteRequest(`${ORIGIN}/api/media`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-payload-http-method-override': 'GET',
        },
        body: 'limit=10&page=1',
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ body: 'limit=10&page=1', override: 'GET' })
  })

  it('a JSON PATCH (profilmentés) is átmegy, a metódus megmarad', async () => {
    const inner = vi.fn(async (request: Request) =>
      Response.json({ body: await request.json(), method: request.method }),
    )
    const response = await withPayloadRestBodyLimit(inner)(
      nextRouteRequest(`${ORIGIN}/api/users/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Árvíztűrő' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ body: { name: 'Árvíztűrő' }, method: 'PATCH' })
  })

  it('a kliens megszakítása a továbbított kérésen is látszik', async () => {
    const controller = new AbortController()
    const inner = vi.fn(async (request: Request) => {
      controller.abort()
      return Response.json({ aborted: request.signal.aborted })
    })
    const response = await withPayloadRestBodyLimit(inner)(
      nextRouteRequest(`${ORIGIN}/api/form-submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"form":1}',
        signal: controller.signal,
      }),
    )
    expect(await response.json()).toEqual({ aborted: true })
  })
})

describe('withPrivateCourseFileResponse a Next route-handler Proxyjával', () => {
  it('a HEAD kérés GET-ként, a fejlécekkel együtt jut el a fájlkezelőig, törzs nélkül válaszol', async () => {
    const inner = vi.fn(async (request: Request) =>
      Response.json({
        cookie: request.headers.get('cookie'),
        method: request.method,
        range: request.headers.get('range'),
        url: request.url,
      }),
    )
    const route = withPrivateCourseFileResponse(inner)
    const response = await route(
      nextRouteRequest(`${ORIGIN}/api/course-files/file/lecke.pdf`, {
        method: 'HEAD',
        headers: { cookie: 'payload-token=abc', range: 'bytes=0-9' },
      }),
      { params: Promise.resolve({ slug: ['course-files', 'file', 'lecke.pdf'] }) },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('')
    const forwarded = inner.mock.calls[0]?.[0]
    expect(forwarded?.method).toBe('GET')
    expect(forwarded?.url).toBe(`${ORIGIN}/api/course-files/file/lecke.pdf`)
    expect(forwarded?.headers.get('cookie')).toBe('payload-token=abc')
    expect(forwarded?.headers.get('range')).toBe('bytes=0-9')
  })
})
