import type { RouteKind } from 'next/dist/server/route-kind'
import { RouteMatcher } from 'next/dist/server/route-matchers/route-matcher'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RATE_LIMIT_RULES } from '../../lib/security/rate-limit'
import { RESET_PASSWORD_BODY_MAX_BYTES } from '../../lib/security/reset-password-route'
import { isPasswordResetRequest } from '../../lib/security/revoke-other-sessions'

const fake = vi.hoisted(() => ({
  getPayload: vi.fn(),
  find: vi.fn(),
  restPost: vi.fn(),
}))

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../payload.config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: fake.getPayload }))
vi.mock('@payloadcms/next/routes', () => ({
  REST_POST: () => fake.restPost,
  REST_GET: () => vi.fn(),
  REST_DELETE: () => vi.fn(),
  REST_PATCH: () => vi.fn(),
  REST_PUT: () => vi.fn(),
  REST_OPTIONS: () => vi.fn(),
}))

import { POST as catchAllPost } from '../../app/(payload)/api/[...slug]/route'
import { POST as concretePost } from '../../app/(frontend)/api/users/reset-password/route'

const origin = 'http://localhost:3000'
const token = 'DUMMY-RESET-ROUTING-TOKEN'
const password = 'DUMMY-Eros-Teszt-Jelszo-42'
let testIp = 0

const catchAllMatcher = new RouteMatcher({
  kind: 'APP_ROUTE' as RouteKind,
  pathname: '/api/[...slug]',
  page: '/api/[...slug]/route',
  bundlePath: '',
  filename: '',
})

const concreteMatcher = new RouteMatcher({
  kind: 'APP_ROUTE' as RouteKind,
  pathname: '/api/users/reset-password',
  page: '/api/users/reset-password/route',
  bundlePath: '',
  filename: '',
})

function request(pathname: string, data: unknown = { token, password }, headers: HeadersInit = {}) {
  return new Request(origin + pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `192.0.2.${testIp}`,
      ...headers,
    },
    body: JSON.stringify(data),
  })
}

async function dispatch(input: Request): Promise<Response> {
  const pathname = new URL(input.url).pathname
  if (concreteMatcher.test(pathname)) {
    return concretePost(input)
  }
  const result = catchAllMatcher.test(pathname)
  const slug = result?.params?.slug
  if (!Array.isArray(slug)) {
    throw new Error('A tesztkérés nem Next catch-all útvonal.')
  }
  return catchAllPost(input, { params: Promise.resolve({ slug }) })
}

beforeEach(() => {
  testIp += 1
  vi.clearAllMocks()
  fake.find.mockResolvedValue({ docs: [{ id: 7, email: 'vevo@example.test' }] })
  fake.getPayload.mockResolvedValue({ find: fake.find })
  fake.restPost.mockImplementation(async () => Response.json({ ok: true }))
})

describe('Payload reset routing — minden tényleges reset ugyanazt a védelmet kapja', () => {
  it.each([
    '/api/users/reset-password',
    '/api/users/RESET-PASSWORD',
    '/api/users/Reset-Password',
    '/api/users/%72eset-password',
    '/api/users/RESET-PASSWORD/',
  ])('%s: gyenge jelszó nem érheti el a reset műveletet', async (pathname) => {
    const response = await dispatch(request(pathname, { token, password: 'abc' }))
    expect(response.status).toBe(400)
    expect(fake.restPost).not.toHaveBeenCalled()
  })

  it.each(['/api/users/RESET-PASSWORD', '/api/users/%72eset-password'])(
    '%s: idegen Origin elutasítva törzsolvasás és Payload előtt',
    async (pathname) => {
      const input = request(
        pathname,
        { token, password },
        { origin: 'https://foreign.example.test' },
      )
      const response = await dispatch(input)
      expect(response.status).toBe(403)
      expect(input.bodyUsed).toBe(false)
      expect(fake.getPayload).not.toHaveBeenCalled()
      expect(fake.restPost).not.toHaveBeenCalled()
    },
  )

  it('az alias sikeres válaszának session sütije és Response identitása változatlan', async () => {
    const sessionResponse = Response.json(
      { user: { id: 7 } },
      {
        headers: { 'set-cookie': 'payload-token=DUMMY-SESSION; Path=/; HttpOnly' },
      },
    )
    fake.restPost.mockResolvedValue(sessionResponse)
    const input = request('/api/users/RESET-PASSWORD')
    expect(await dispatch(input)).toBe(sessionResponse)
    expect(fake.getPayload).toHaveBeenCalledTimes(1)
    expect(fake.restPost).toHaveBeenCalledTimes(1)
    const [forwarded, context] = fake.restPost.mock.calls[0] as [
      Request,
      { params: Promise<{ slug?: string[] }> },
    ]
    expect(await context.params).toEqual({ slug: ['users', 'reset-password'] })
    expect(forwarded.url).toBe(origin + '/api/users/reset-password')
    expect(await forwarded.json()).toEqual({ token, password })
    expect(sessionResponse.headers.get('set-cookie')).toContain('DUMMY-SESSION')
  })

  it('a kódolt alias a session-visszavonó hook számára is kanonikus útvonalat ad', async () => {
    await dispatch(request('/api/users/%72eset-password?locale=hu'))
    const [forwarded] = fake.restPost.mock.calls[0] as [Request]
    expect(forwarded.url).toBe(origin + '/api/users/reset-password?locale=hu')
    expect(
      isPasswordResetRequest({
        url: forwarded.url,
        pathname: new URL(forwarded.url).pathname,
      }),
    ).toBe(true)
  })

  it('alias multipart admin reset a bounded eredeti törzzsel jut Payloadhoz', async () => {
    const body = new FormData()
    body.set('_payload', JSON.stringify({ token, password }))
    const input = new Request(origin + '/api/users/RESET-PASSWORD', {
      method: 'POST',
      headers: { 'x-forwarded-for': `192.0.2.${testIp}` },
      body,
    })
    expect((await dispatch(input)).status).toBe(200)
    expect(fake.getPayload).toHaveBeenCalledTimes(1)
    const [forwarded] = fake.restPost.mock.calls[0] as [Request]
    expect(JSON.parse(String((await forwarded.formData()).get('_payload')))).toEqual({
      token,
      password,
    })
  })

  it('az alias túl nagy törzse sem kerül a Payloadhoz', async () => {
    const response = await dispatch(
      request('/api/users/RESET-PASSWORD', {
        token,
        password,
        extra: 'x'.repeat(RESET_PASSWORD_BODY_MAX_BYTES),
      }),
    )
    expect(response.status).toBe(413)
    expect(fake.getPayload).not.toHaveBeenCalled()
    expect(fake.restPost).not.toHaveBeenCalled()
  })

  it('az alias kérésenként pontosan egy reset kerethelyet fogyaszt', async () => {
    for (let attempt = 0; attempt <= RATE_LIMIT_RULES['password-reset'].limit; attempt += 1) {
      const response = await dispatch(request('/api/users/RESET-PASSWORD'))
      expect(response.status).toBe(attempt < RATE_LIMIT_RULES['password-reset'].limit ? 200 : 429)
    }
    expect(fake.getPayload).toHaveBeenCalledTimes(RATE_LIMIT_RULES['password-reset'].limit)
    expect(fake.restPost).toHaveBeenCalledTimes(RATE_LIMIT_RULES['password-reset'].limit)
  })

  it.each([
    '/api/Users/reset-password',
    '/api/users/%2572eset-password',
    '/api/users/reset-password/extra',
    '/api/posts/reset-password',
  ])('%s nem lesz új reset alias', async (pathname) => {
    const input = request(pathname, { token, password: 'abc' })
    expect((await dispatch(input)).status).toBe(200)
    expect(fake.getPayload).not.toHaveBeenCalled()
    expect(fake.restPost).toHaveBeenCalledTimes(1)
  })

  it('a normál login idegen Origin védelme megmarad', async () => {
    const response = await dispatch(
      request(
        '/api/users/login',
        {
          email: 'vevo@example.test',
          password,
        },
        { origin: 'https://foreign.example.test' },
      ),
    )
    expect(response.status).toBe(403)
    expect(fake.restPost).not.toHaveBeenCalled()
  })
})
