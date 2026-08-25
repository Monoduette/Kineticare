import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertSameOrigin,
  assertSameOriginUnlessSafeMethod,
  SAME_ORIGIN_REJECTED_MESSAGE,
} from '../../lib/security/same-origin'

/**
 * Same-origin / CSRF-őr (src/lib/security/same-origin.ts).
 *
 * A handlerek unit-tesztjei NEM küldenek Origin/Referer fejlécet — a hiányzó
 * pár ÁTENGEDÉS, hogy a meglévő Request-konstruktorok ne törjenek el. Ez a
 * fájl méri magát a szabályt: engedélyezett eredet, idegen eredet, idegen
 * Referer, extra originek, útvonal-előtagos gyökér.
 */

const PRIMARY = 'https://shop.example.test'

function request(headers?: HeadersInit, method = 'POST'): Request {
  return new Request(`${PRIMARY}/api/pelda`, { method, headers })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', PRIMARY)
  vi.stubEnv('EXTRA_ALLOWED_ORIGINS', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assertSameOrigin', () => {
  it('engedélyezett Origin átmegy', () => {
    expect(assertSameOrigin(request({ origin: PRIMARY }))).toEqual({ ok: true })
  })

  it('idegen Origin 403, magyar üzenettel', () => {
    const result = assertSameOrigin(request({ origin: 'https://evil.example' }))

    expect(result).toEqual({
      ok: false,
      status: 403,
      message: SAME_ORIGIN_REJECTED_MESSAGE,
    })
    expect(SAME_ORIGIN_REJECTED_MESSAGE).toMatch(/idegen oldalról/)
  })

  it('engedélyezett Referer (Origin nélkül) átmegy', () => {
    expect(assertSameOrigin(request({ referer: `${PRIMARY}/penztar` }))).toEqual({ ok: true })
  })

  it('idegen Referer (Origin nélkül) 403', () => {
    expect(assertSameOrigin(request({ referer: 'https://evil.example/csapda' }))).toEqual({
      ok: false,
      status: 403,
      message: SAME_ORIGIN_REJECTED_MESSAGE,
    })
  })

  it('értelmezhetetlen Referer (Origin nélkül) 403', () => {
    expect(assertSameOrigin(request({ referer: 'nem-url' }))).toEqual({
      ok: false,
      status: 403,
      message: SAME_ORIGIN_REJECTED_MESSAGE,
    })
  })

  it('hiányzó Origin és Referer átmegy (unit teszt, curl, nem-böngésző)', () => {
    expect(assertSameOrigin(request())).toEqual({ ok: true })
  })

  it('jelen lévő Origin a Referer fölött dönt (engedett Origin + idegen Referer)', () => {
    expect(
      assertSameOrigin(
        request({
          origin: PRIMARY,
          referer: 'https://evil.example/csapda',
        }),
      ),
    ).toEqual({ ok: true })
  })

  it('útvonal-előtagos SERVER_URL esetén az eredet mégis illeszkedik', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', `${PRIMARY}/app`)

    expect(assertSameOrigin(request({ origin: PRIMARY }))).toEqual({ ok: true })
    expect(assertSameOrigin(request({ referer: `${PRIMARY}/app/penztar` }))).toEqual({ ok: true })
  })

  it('EXTRA_ALLOWED_ORIGINS-beli eredet átmegy', () => {
    vi.stubEnv('EXTRA_ALLOWED_ORIGINS', 'https://kineticare.hu,https://www.kineticare.hu')

    expect(assertSameOrigin(request({ origin: 'https://kineticare.hu' }))).toEqual({ ok: true })
    expect(assertSameOrigin(request({ origin: 'https://www.kineticare.hu' }))).toEqual({
      ok: true,
    })
    expect(assertSameOrigin(request({ origin: 'https://idegen.example' })).ok).toBe(false)
  })
})

describe('assertSameOriginUnlessSafeMethod', () => {
  it('GET/HEAD/OPTIONS idegen Origin mellett is átmegy', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        assertSameOriginUnlessSafeMethod(request({ origin: 'https://evil.example' }, method)),
        method,
      ).toEqual({ ok: true })
    }
  })

  it('POST-on idegen Origin 403', () => {
    expect(
      assertSameOriginUnlessSafeMethod(request({ origin: 'https://evil.example' }, 'POST')),
    ).toEqual({
      ok: false,
      status: 403,
      message: SAME_ORIGIN_REJECTED_MESSAGE,
    })
  })
})
