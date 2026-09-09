import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createHash, createHmac } from 'node:crypto'
import { logger } from '../lib/logger'
import { SlidingWindowRateLimiter } from '../lib/security/rate-limit'
import {
  createBunnyUploadHandler,
  createBunnyUploadSignHandler,
} from '../lib/stream/bunny-upload-handler'
import {
  createBunnyVideoDetailHandler,
  createBunnyVideoPreviewHandler,
} from '../lib/stream/bunny-video-detail-handler'
import type { BunnyUploadResponse } from '../lib/stream/bunny-upload-contract'

const guid = '12345678-1234-1234-1234-123456789abc'
const origin = 'https://example.test'
const input = { title: 'Teszt video', fileName: 'test.mp4', size: 1024, mimeType: 'video/mp4' }
const rawVideo = { guid, videoLibraryId: 123, title: 'Teszt', status: 4, length: 20 }
let user: { id: number; role: string } | null
let now: number
let currentSid: string | undefined
const fetchMock = vi.fn<typeof fetch>()
const auth = vi.fn(async () => ({ user: user ? { ...user, _sid: currentSid } : null }))
let limiter: SlidingWindowRateLimiter
const deps = () => ({
  getPayload: async () => ({ auth, secret: 'DUMMY_payload_test_secret' }) as unknown as Payload,
  fetchImpl: fetchMock,
  limiter,
  now: () => now,
})
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/admin/bunny-uploads`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
async function initialize() {
  fetchMock.mockResolvedValueOnce(Response.json(rawVideo))
  const response = await createBunnyUploadHandler(deps())(post(input))
  expect(response.status).toBe(200)
  return (await response.json()) as BunnyUploadResponse
}
beforeEach(() => {
  user = { id: 10, role: 'staff' }
  now = 1800000000000
  currentSid = 'DUMMY_authenticated_session_one'
  limiter = new SlidingWindowRateLimiter({ now: () => now })
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', origin)
  vi.stubEnv('EXTRA_ALLOWED_ORIGINS', '')
  vi.stubEnv('NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID', '123')
  vi.stubEnv('BUNNY_STREAM_LIBRARY_API_KEY', 'DUMMY_bunny_api_key')
  vi.stubEnv('BUNNY_STREAM_TOKEN_AUTH_KEY', 'DUMMY_bunny_token_key')
  vi.stubEnv('NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID', '456')
  vi.stubEnv('BUNNY_STREAM_PUBLIC_LIBRARY_API_KEY', 'DUMMY_public_api_key')
  fetchMock.mockReset().mockImplementation(async () => {
    throw new Error('Unexpected outbound request')
  })
  auth.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('admin video auth and request boundaries', () => {
  it.each([null, { id: 1, role: 'customer' }])(
    'blocks unauthorized access on every route: %j',
    async (identity) => {
      user = identity
      const d = deps()
      const responses = [
        await createBunnyUploadHandler(d)(post(input)),
        await createBunnyUploadSignHandler(d)(post({ uploadSession: 'invalid' })),
        await createBunnyVideoDetailHandler(d)(new Request(`${origin}/?library=protected`), guid),
        await createBunnyVideoPreviewHandler(d)(post({ library: 'protected' }), guid),
      ]
      for (const response of responses) {
        expect(response.status).toBe(identity ? 403 : 401)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('x-request-id')).toBeTruthy()
      }
      expect(auth).toHaveBeenCalledTimes(4)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
  it.each<Record<string, string>>([
    { Origin: '' },
    { Origin: 'null' },
    { Origin: 'https://evil.test' },
    { 'Content-Type': 'text/plain' },
  ])('rejects unsafe POST headers %j', async (headers) => {
    for (const handler of [
      createBunnyUploadHandler(deps()),
      createBunnyUploadSignHandler(deps()),
    ]) {
      expect((await handler(post(input, headers))).status).toBe(headers['Content-Type'] ? 415 : 403)
    }
    expect(
      (await createBunnyVideoPreviewHandler(deps())(post({ library: 'protected' }, headers), guid))
        .status,
    ).toBe(headers['Content-Type'] ? 415 : 403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    { size: 0 },
    { size: 2147483649 },
    { size: 1.2 },
    { mimeType: 'text/html' },
    { title: '' },
    { fileName: '../test.mp4' },
    { library: 'public' },
  ])('rejects metadata %j', async (change) => {
    expect((await createBunnyUploadHandler(deps())(post({ ...input, ...change }))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('limits create to five attempts per user per ten minutes', async () => {
    for (let i = 0; i < 5; i++) await initialize()
    const rejected = await createBunnyUploadHandler(deps())(post(input))
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBe('600')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    user = { id: 11, role: 'owner' }
    await initialize()
  })
})

describe('fixed upload capability', () => {
  it('rejects the same user after a new login session without storing the raw SID', async () => {
    const created = await initialize()
    const decoded = Buffer.from(created.uploadSession.split('.')[0]!, 'base64url').toString()
    expect(decoded).not.toContain(currentSid)
    currentSid = 'DUMMY_authenticated_session_two'
    const response = await createBunnyUploadSignHandler(deps())(
      post({ uploadSession: created.uploadSession }),
    )
    expect(response.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('fails closed without an authenticated Payload SID before creating a video', async () => {
    currentSid = undefined
    expect((await createBunnyUploadHandler(deps())(post(input))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('binds credentials to a single video and final expiry with no create on sign', async () => {
    const created = await initialize()
    expect(created.expiresAt).toBe(now / 1000 + 21600)
    expect(created.headers.AuthorizationExpire).toBe(String(created.expiresAt))
    expect(created.headers.VideoId).toBe(guid)
    expect(JSON.stringify(created)).not.toContain('DUMMY')
    now += 3600000
    const response = await createBunnyUploadSignHandler(deps())(
      post({ uploadSession: created.uploadSession }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(created)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
    })
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
  it('rejects another user, tampering, extra GUID and final expiration', async () => {
    const created = await initialize()
    const sign = createBunnyUploadSignHandler(deps())
    user = { id: 11, role: 'owner' }
    expect((await sign(post({ uploadSession: created.uploadSession }))).status).toBe(403)
    user = { id: 10, role: 'staff' }
    expect((await sign(post({ uploadSession: created.uploadSession + 'x' }))).status).toBe(403)
    expect((await sign(post({ uploadSession: created.uploadSession, videoId: guid }))).status).toBe(
      400,
    )
    now += 21600000
    expect((await sign(post({ uploadSession: created.uploadSession }))).status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('fails closed after library config changes', async () => {
    const created = await initialize()
    vi.stubEnv('NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID', '456')
    expect(
      (await createBunnyUploadSignHandler(deps())(post({ uploadSession: created.uploadSession })))
        .status,
    ).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([
    { purpose: 'other-purpose' },
    { version: 2 },
    { sessionId: 'invalid' },
    { videoId: '../escape' },
    { libraryId: '456' },
    { userId: 'number:11' },
    { issuedAt: 1800000001 },
    { expiresAt: 1800000000 + 21601 },
  ])('rejects invalid signed capability fields %j', async (change) => {
    const created = await initialize()
    const encoded = created.uploadSession.split('.')[0]!
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Record<string, unknown>
    const changed = Buffer.from(JSON.stringify({ ...data, ...change })).toString('base64url')
    const key = createHmac('sha256', 'DUMMY_payload_test_secret')
      .update('kineticare:bunny-upload:v1')
      .digest()
    const signature = createHmac('sha256', key).update(changed).digest('base64url')
    expect(
      (
        await createBunnyUploadSignHandler(deps())(
          post({ uploadSession: `${changed}.${signature}` }),
        )
      ).status,
    ).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('matches the documented TUS hash order', async () => {
    const created = await initialize()
    expect(created.headers.AuthorizationSignature).toBe(
      createHash('sha256')
        .update(`123DUMMY_bunny_api_key${created.expiresAt}${guid}`)
        .digest('hex'),
    )
  })
  it.each(['BUNNY_STREAM_LIBRARY_API_KEY', 'NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID'])(
    'fails closed with missing %s',
    async (name) => {
      vi.stubEnv(name, '')
      expect((await createBunnyUploadHandler(deps())(post(input))).status).toBe(503)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
  it('checks payload secret before creating an upstream object', async () => {
    const d = { ...deps(), getPayload: async () => ({ auth, secret: '' }) as unknown as Payload }
    expect((await createBunnyUploadHandler(d)(post(input))).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['', '0', '../123'])(
    'rejects invalid configured library %s without fetch',
    async (id) => {
      vi.stubEnv('NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID', id)
      expect((await createBunnyUploadHandler(deps())(post(input))).status).toBe(503)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
  it('does not retry ambiguous create or expose upstream errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('DUMMY_private_upstream'))
    const response = await createBunnyUploadHandler(deps())(post(input))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('DUMMY')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([400, 401, 403, 429, 500])(
    'never logs or forwards arbitrary upstream body on %s',
    async (status) => {
      const warn = vi.fn()
      vi.spyOn(logger, 'child').mockReturnValue({ ...logger, warn })
      fetchMock.mockResolvedValueOnce(new Response('DUMMY_private_upstream', { status }))
      const response = await createBunnyUploadHandler(deps())(post(input))
      expect(response.status).toBe(502)
      expect(await response.text()).not.toContain('DUMMY')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('DUMMY')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )
  it('rejects oversized body before fetch and returns no-store', async () => {
    const response = await createBunnyUploadHandler(deps())(
      post({ ...input, title: 'x'.repeat(9000) }),
    )
    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('authoritative detail and preview', () => {
  it.each(['../bad', 'not-guid'])('rejects malicious GUID %s', async (id) => {
    expect(
      (await createBunnyVideoDetailHandler(deps())(new Request(`${origin}/?library=protected`), id))
        .status,
    ).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects unknown library instead of defaulting it', async () => {
    expect(
      (
        await createBunnyVideoDetailHandler(deps())(
          new Request(`${origin}/?library=https://evil.test`),
          guid,
        )
      ).status,
    ).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('returns safe detail only and uses raw VideoModel status, not webhook status', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ ...rawVideo, status: 3, AccessKey: 'DUMMY_private' }),
    )
    const response = await createBunnyVideoDetailHandler(deps())(
      new Request(`${origin}/?library=protected`),
      guid,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ready: false, video: { status: 3 } })
  })
  it.each([0, 1, 2, 3, 5, 6, 7, 8])('denies preview for nonready status %s', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...rawVideo, status }))
    expect(
      (await createBunnyVideoPreviewHandler(deps())(post({ library: 'protected' }), guid)).status,
    ).toBe(409)
  })
  it('issues a five minute protected embed only after authoritative GET', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(rawVideo))
    const response = await createBunnyVideoPreviewHandler(deps())(
      post({ library: 'protected' }),
      guid,
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.expiresAt).toBe(now / 1000 + 300)
    expect(new URL(body.embedUrl).searchParams.get('token')).toBe(
      createHash('sha256').update(`DUMMY_bunny_token_key${guid}${body.expiresAt}`).digest('hex'),
    )
    expect(body.embedUrl).toContain(`https://iframe.mediadelivery.net/embed/123/${guid}?token=`)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://video.bunnycdn.com/library/123/videos/${guid}`,
    )
  })
  it('fails closed with absent preview signing key without fetch', async () => {
    vi.stubEnv('BUNNY_STREAM_TOKEN_AUTH_KEY', '')
    expect(
      (await createBunnyVideoPreviewHandler(deps())(post({ library: 'protected' }), guid)).status,
    ).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([404, 403, 500])(
    'handles raw detail upstream %s without leaking body',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response('DUMMY_private_body', { status }))
      const response = await createBunnyVideoDetailHandler(deps())(
        new Request(`${origin}/?library=protected`),
        guid,
      )
      expect(response.status).toBe(status === 404 ? 404 : 502)
      expect(await response.text()).not.toContain('DUMMY')
    },
  )
  it('uses a timeout signal and stops on a mocked timeout', async () => {
    fetchMock.mockImplementationOnce(async (_url, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      throw new DOMException('DUMMY_timeout', 'TimeoutError')
    })
    expect(
      (
        await createBunnyVideoDetailHandler(deps())(
          new Request(`${origin}/?library=protected`),
          guid,
        )
      ).status,
    ).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('reauthenticates after role revocation even with a valid session', async () => {
    const created = await initialize()
    user = { id: 10, role: 'customer' }
    expect(
      (await createBunnyUploadSignHandler(deps())(post({ uploadSession: created.uploadSession })))
        .status,
    ).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('rate limits detail polling per user before the 61st outbound fetch', async () => {
    fetchMock.mockImplementation(async () => Response.json(rawVideo))
    const handler = createBunnyVideoDetailHandler(deps())
    for (let i = 0; i < 60; i++)
      expect((await handler(new Request(`${origin}/?library=protected`), guid)).status).toBe(200)
    const response = await handler(new Request(`${origin}/?library=protected`), guid)
    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).toHaveBeenCalledTimes(60)
  })
  it('uses canonical unsigned public embed', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...rawVideo, videoLibraryId: 456 }))
    const response = await createBunnyVideoPreviewHandler(deps())(post({ library: 'public' }), guid)
    expect(await response.json()).toMatchObject({
      expiresAt: null,
      embedUrl: `https://iframe.mediadelivery.net/embed/456/${guid}`,
    })
  })
  it.each([
    { guid: '87654321-1234-1234-1234-123456789abc' },
    { videoLibraryId: 999 },
    { status: '4' },
  ])('rejects mismatched upstream response %j', async (change) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...rawVideo, ...change }))
    expect(
      (await createBunnyVideoPreviewHandler(deps())(post({ library: 'protected' }), guid)).status,
    ).toBe(502)
  })
})
