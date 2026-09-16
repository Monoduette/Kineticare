import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createBunnyVideosHandler } from '../lib/stream/bunny-library-handler'
import { SlidingWindowRateLimiter } from '../lib/security/rate-limit'

const fetchMock = vi.fn<typeof fetch>()
function handler() {
  return createBunnyVideosHandler({
    getPayload: async () =>
      ({ auth: async () => ({ user: { id: 1, role: 'staff' } }) }) as unknown as Payload,
    fetchImpl: fetchMock,
    rateLimit: { limiter: new SlidingWindowRateLimiter() },
  })
}
beforeEach(() => {
  vi.stubEnv('BUNNY_STREAM_LIBRARY_API_KEY', 'DUMMY_library_key')
  vi.stubEnv('NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID', '123')
  fetchMock.mockReset().mockImplementation(async () => {
    throw new Error('Unexpected network')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('bounded single-page admin list', () => {
  it.each([
    { page: 2, requested: 100, effective: 50, count: 50, totalItems: 120, truncated: true },
    { page: 3, requested: 100, effective: 50, count: 50, totalItems: 151, truncated: true },
    { page: 3, requested: 100, effective: 50, count: 20, totalItems: 120, truncated: false },
    { page: 3, requested: 100, effective: 50, count: 50, totalItems: 150, truncated: false },
    { page: 2, requested: 24, effective: 12, count: 12, totalItems: 25, truncated: true },
    { page: 3, requested: 24, effective: 12, count: 1, totalItems: 25, truncated: false },
  ])(
    'uses provider-clamped page size for offsets and response metadata: %j',
    async ({ page, requested, effective, count, totalItems, truncated }) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          items: Array.from({ length: count }, (_, index) => ({
            guid: `video-${index}`,
            status: 4,
          })),
          itemsPerPage: effective,
          totalItems,
        }),
      )
      const response = await handler()(
        new Request(`https://example.test/?library=protected&page=${page}&pageSize=${requested}`),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        page,
        pageSize: effective,
        totalItems,
        truncated,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )
  it('forwards search and exactly one bounded page; last page is not truncated', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        items: [
          { guid: 'test', status: 4 },
          { guid: 'test2', status: 4 },
        ],
        totalItems: 4,
      }),
    )
    const response = await handler()(
      new Request('https://example.test/?library=protected&page=2&pageSize=2&search=teszt'),
    )
    expect(response.status).toBe(200)
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('itemsPerPage')).toBe('2')
    expect(url.searchParams.get('search')).toBe('teszt')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({ page: 2, pageSize: 2, truncated: false })
  })
  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=10001',
    'pageSize=101',
    'pageSize=0',
    'page=x',
    'page=1&page=2',
    'pageSize=1&pageSize=2',
  ])('rejects invalid pagination %s without network', async (query) => {
    expect((await handler()(new Request(`https://example.test/?${query}`))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
