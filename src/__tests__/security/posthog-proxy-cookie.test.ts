import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { middleware } from '../../middleware'

/**
 * A `/ingest` PostHog-proxy nem viheti tovább a munkamenet-sütit.
 *
 * A Next a middleware által felülírt kérés-fejléceket az
 * `x-middleware-override-headers` listában és az `x-middleware-request-*`
 * fejlécekben adja át a routernek; a listából hiányzó fejlécet a rewrite
 * előtt törli. Ezt a szerződést ellenőrizzük.
 */

function overriddenHeaders(response: Response): string[] {
  return (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .map((header) => header.trim())
    .filter((header) => header.length > 0)
}

function requestWith(pathname: string): NextRequest {
  return new NextRequest(`https://kineticare.test${pathname}`, {
    method: 'POST',
    headers: {
      cookie: 'payload-token=titkos.jwt.ertek; ph_distinct=1',
      authorization: 'Bearer titkos',
      'content-type': 'application/json',
      'user-agent': 'vitest',
    },
  })
}

describe('middleware — PostHog-proxy fejlécszűrés', () => {
  it.each(['/ingest', '/ingest/e/', '/ingest/flags', '/ingest/static/array.js'])(
    '%s: a Cookie és az Authorization nem megy tovább',
    (pathname) => {
      const response = middleware(requestWith(pathname))
      const headers = overriddenHeaders(response)
      expect(headers).not.toContain('cookie')
      expect(headers).not.toContain('authorization')
      expect(response.headers.get('x-middleware-request-cookie')).toBeNull()
      expect(response.headers.get('x-middleware-request-authorization')).toBeNull()
      // A többi fejléc változatlanul továbbmegy.
      expect(headers).toContain('content-type')
      expect(headers).toContain('user-agent')
    },
  )

  it.each(['/', '/kurzusok/valami', '/api/users/me', '/ingestx', '/admin'])(
    '%s: a munkamenet-süti megmarad',
    (pathname) => {
      const response = middleware(requestWith(pathname))
      expect(overriddenHeaders(response)).toContain('cookie')
      expect(response.headers.get('x-middleware-request-cookie')).toContain('payload-token=')
    },
  )
})
