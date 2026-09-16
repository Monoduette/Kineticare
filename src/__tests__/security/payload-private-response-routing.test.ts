import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ rest: vi.fn(), getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../payload.config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: fake.getPayload }))
vi.mock('@payloadcms/next/routes', () =>
  Object.fromEntries(
    ['GET', 'POST', 'DELETE', 'PATCH', 'PUT', 'OPTIONS'].map((method) => [
      `REST_${method}`,
      () => fake.rest,
    ]),
  ),
)

import * as route from '../../app/(payload)/api/[...slug]/route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('a tényleges Next route exportok a private API teljes válaszát védik', () => {
  it.each(['GET', 'POST', 'DELETE', 'PATCH', 'PUT', 'OPTIONS', 'HEAD'] as const)(
    '%s private meta/error soha nem shared-cache',
    async (method) => {
      fake.rest.mockResolvedValue(
        Response.json(
          { error: 'Fixture forbidden' },
          {
            status: 403,
            headers: { 'Cache-Control': 'public, max-age=1000', Vary: 'Accept-Encoding' },
          },
        ),
      )
      const response = await route[method](
        new Request('https://example.test/api/course-files/71', { method }),
        { params: Promise.resolve({ slug: ['course-files', '71'] }) },
      )
      expect(response.status).toBe(403)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Vary')).toBe('Accept-Encoding, Cookie, Authorization')
      expect(fake.rest.mock.calls[0]?.[0].method).toBe(method === 'HEAD' ? 'GET' : method)
      if (method === 'HEAD') expect(await response.text()).toBe('')
    },
  )
  it('a public Media response identitása/cache fejléce változatlan', async () => {
    const original = new Response('Public image', {
      headers: { 'Cache-Control': 'public, max-age=600' },
    })
    fake.rest.mockResolvedValue(original)
    const response = await route.GET(
      new Request('https://example.test/api/media/file/public.png'),
      { params: Promise.resolve({ slug: ['media', 'file', 'public.png'] }) },
    )
    expect(response).toBe(original)
  })
})
