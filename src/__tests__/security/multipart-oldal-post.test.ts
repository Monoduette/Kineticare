import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { MULTIPART_PAGE_POST_MESSAGE, middleware } from '../../middleware'

/**
 * Oldal-útvonalra küldött, `Next-Action` fejléc nélküli multipart POST: 400 a
 * middleware-ben, mielőtt a Next server-action ága `formData()`-val
 * dekódolni próbálná (2026-09-25: szkenner-kérések `/RSC/*.txt` útvonalakra,
 * kezeletlen `Failed to parse body as FormData` az `onRequestError`-ban).
 *
 * A törzs szándékosan csonka multipart: a lezáró határoló hiányzik, ahogy a
 * szkenner-kéréseknél.
 */

const BOUNDARY = '----KineticareProbaHatarolo'
const MALFORMED_MULTIPART = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="0"\r\n\r\n{"a":`

function multipartPost(pathname: string, extraHeaders: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://kineticare.test${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'x-request-id': 'proba-keres-azonosito-1234',
      ...extraHeaders,
    },
    body: MALFORMED_MULTIPART,
  })
}

function passedThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1'
}

describe('middleware — multipart POST oldal-útvonalra', () => {
  it.each(['/RSC/3fnlafo3lfpsuya.txt', '/', '/kurzusok/valami', '/apix', '/adminx'])(
    '%s: Next-Action nélkül 400, a kérés nem jut el a renderelésig',
    async (pathname) => {
      const response = middleware(multipartPost(pathname))
      expect(response.status).toBe(400)
      expect(passedThrough(response)).toBe(false)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-request-id')).toBe('proba-keres-azonosito-1234')
      expect(await response.text()).toBe(MULTIPART_PAGE_POST_MESSAGE)
    },
  )

  it('a Next-Action fejléces (fetch) server action továbbmegy', () => {
    const response = middleware(
      multipartPost('/admin/collections/pages', { 'Next-Action': 'abc123' }),
    )
    expect(passedThrough(response)).toBe(true)
    const onPage = middleware(multipartPost('/kurzusok', { 'next-action': 'abc123' }))
    expect(passedThrough(onPage)).toBe(true)
  })

  it.each(['/api/media', '/api', '/admin', '/admin/collections/media/create', '/ingest/e/'])(
    '%s: a multipart POST továbbmegy',
    (pathname) => {
      expect(passedThrough(middleware(multipartPost(pathname)))).toBe(true)
    },
  )

  it('a nem multipart POST és a multipart GET oldal-útvonalon is továbbmegy', () => {
    const json = new NextRequest('https://kineticare.test/kurzusok', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(passedThrough(middleware(json))).toBe(true)
    const get = new NextRequest('https://kineticare.test/kurzusok', {
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    })
    expect(passedThrough(middleware(get))).toBe(true)
  })
})
