import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Upload, type HttpStack } from 'tus-js-client'
import {
  resumeBunnyUpload,
  uploadCredentials,
  videoDetail,
  videoRequest,
} from '../components/admin/bunny-video-client'

const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No real network in tests')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['invalid-session', 'invalid-session'],
  ['forbidden', null],
  ['DUMMY-untrusted-code', null],
  [{ code: 'invalid-session' }, null],
])('retains only the allowlisted machine code from a 403 response: %s', async (code, retained) => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ code, error: 'DUMMY-private-upstream-message' }, { status: 403 }),
  )
  await expect(videoRequest('/api/admin/bunny-uploads/sign', {})).rejects.toMatchObject({
    status: 403,
    code: retained,
    message: 'A videótár nem érhető el. Próbáld újra.',
  })
})

it.each([503, 404, 410, 200])(
  'real tus engine: resumed HEAD %s never falls back to a new POST',
  async (headStatus) => {
    const methods: string[] = []
    const existingURL = `https://video.bunnycdn.com/tusupload/${guid}`
    const headers = {
      AuthorizationSignature: 'DUMMY-signature',
      AuthorizationExpire: '2000000000',
      VideoId: guid,
      LibraryId: '123',
    }
    const httpStack: HttpStack = {
      getName: () => 'DUMMY-memory-only-http',
      createRequest(method, url) {
        const requestHeaders = new Map<string, string>()
        return {
          getMethod: () => method,
          getURL: () => url,
          setHeader: (key, value) => {
            requestHeaders.set(key, value)
          },
          getHeader: (key) => requestHeaders.get(key),
          setProgressHandler: () => {},
          abort: async () => {},
          getUnderlyingObject: () => null,
          async send() {
            methods.push(method)
            const responseHeaders: Record<string, string> = {
              'Upload-Offset': method === 'HEAD' ? '2' : '4',
              'Upload-Length': '4',
              Location: 'https://video.bunnycdn.com/tusupload/DUMMY-new-upload',
            }
            return {
              getStatus: () => (method === 'HEAD' ? headStatus : method === 'POST' ? 201 : 204),
              getHeader: (key) => responseHeaders[key],
              getBody: () => '',
              getUnderlyingObject: () => null,
            }
          },
        }
      },
    }
    let finish: (outcome: string) => void = () => {}
    const ended = new Promise<string>((resolve) => {
      finish = resolve
    })
    const upload = new Upload(Buffer.from('DUMY'), {
      endpoint: 'https://video.bunnycdn.com/tusupload',
      httpStack,
      headers,
      retryDelays: null,
      onShouldRetry: () => false,
      storeFingerprintForResuming: false,
      onError: () => finish('error'),
      onSuccess: () => finish('success'),
    })
    upload.url = existingURL
    await upload.abort(false)
    resumeBunnyUpload(upload, headers)
    const outcome = await ended
    expect(methods).toEqual(headStatus === 200 ? ['HEAD', 'PATCH'] : ['HEAD'])
    expect(outcome).toBe(headStatus === 200 ? 'success' : 'error')
    expect(upload.url).toBe(existingURL)
    expect(fetch).not.toHaveBeenCalled()
  },
)

it('requires the exact detail wrapper/library and BOTH authoritative ready and provider status 4', async () => {
  const response = (status: number, ready: boolean, library = 'protected') => ({
    library,
    libraryId: '123',
    video: { guid, title: 'Fixture', lengthSec: 90, status },
    ready,
  })
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response(4, false)))
  expect((await videoDetail(guid, 'protected')).status).toBe('processing')
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response(3, true)))
  expect((await videoDetail(guid, 'protected')).status).toBe('processing')
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response(4, true)))
  expect((await videoDetail(guid, 'protected')).status).toBe('ready')
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response(4, true, 'public')))
  await expect(videoDetail(guid, 'protected')).rejects.toThrow()
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response(4, true).video))
  await expect(videoDetail(guid, 'protected')).rejects.toThrow()
})

it('never reflects an API response or upload header into error messages', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'DUMMY-sensitive-response' }, { status: 503 }),
  )
  await expect(videoRequest('/api/admin/bunny-uploads', {})).rejects.toThrow(
    'A videótár nem érhető el. Próbáld újra.',
  )
  expect(fetch).toHaveBeenCalledOnce()
})

it('validates the exact four scoped upload headers and final Unix expiry', () => {
  const fixture = {
    uploadSession: 'DUMMY-session',
    videoId: guid,
    libraryId: '123',
    tusEndpoint: 'https://video.bunnycdn.com/tusupload',
    headers: {
      AuthorizationSignature: 'DUMMY-signature',
      AuthorizationExpire: '2000000000',
      VideoId: guid,
      LibraryId: '123',
    },
    expiresAt: 2000000000,
  }
  expect(uploadCredentials(fixture)).toEqual(fixture)
  expect(() =>
    uploadCredentials({ ...fixture, tusEndpoint: 'https://untrusted.invalid/upload' }),
  ).toThrow()
  expect(() =>
    uploadCredentials({ ...fixture, headers: { ...fixture.headers, VideoId: 'other' } }),
  ).toThrow()
})
