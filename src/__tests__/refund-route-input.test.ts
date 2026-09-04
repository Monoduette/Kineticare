import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RefundOrderOptions, RefundOrderResult } from '../lib/refund/refund-order'
import { createRefundHandler } from '../lib/refund/route-handler'
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../lib/security/request-body'

const service = vi.hoisted(() => ({
  run: vi.fn<(options: RefundOrderOptions) => Promise<RefundOrderResult>>(),
}))

vi.mock('../lib/refund/refund-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/refund/refund-order')>()),
  refundOrder: service.run,
}))

const ORIGIN = 'https://shop.example.test'
const ORDER_NUMBER = 'SYNTHETIC-INPUT-001'
const LIMIT = DEFAULT_JSON_BODY_MAX_BYTES
const encoder = new TextEncoder()
const result = { type: 'full', refundStatusOutcome: 'succeeded' }

beforeEach(() => {
  service.run.mockReset().mockRejectedValue(new Error('Unexpected refund service invocation'))
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', ORIGIN)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected external call in refund input test')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function request(body?: string | ReadableStream<Uint8Array>, headers: HeadersInit = {}) {
  const requestHeaders = new Headers(headers)
  if (!requestHeaders.has('origin')) requestHeaders.set('origin', ORIGIN)
  requestHeaders.set('content-type', 'application/json')
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: requestHeaders,
    body,
    duplex: 'half',
  }
  return new Request(`${ORIGIN}/api/admin/orders/${ORDER_NUMBER}/refund`, init)
}

function fixture(role: string | null = 'owner') {
  const auth = vi.fn(async () => ({ user: role === null ? null : { id: 1, role } }))
  const payload = { auth } as unknown as Payload
  const getPayload = vi.fn(async () => payload)
  const handler = createRefundHandler({ getPayload })
  return {
    auth,
    getPayload,
    run: (req: Request, orderNumber = ORDER_NUMBER) =>
      handler(req, { params: Promise.resolve({ orderNumber }) }),
  }
}

async function expectRejected(req: Request, status: number) {
  const response = await fixture().run(req)
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error: expect.any(String) })
  expect(service.run).not.toHaveBeenCalled()
}

async function expectAccepted(req: Request, input: unknown) {
  service.run.mockResolvedValue(result as unknown as RefundOrderResult)
  const response = await fixture().run(req)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(result)
  expect(service.run).toHaveBeenCalledTimes(1)
  expect(service.run.mock.calls[0]?.[0].input).toEqual(input)
}

function bodyOfBytes(size: number, utf8 = false) {
  const remaining = size - encoder.encode(JSON.stringify({ pad: '' })).byteLength
  const pad = utf8
    ? '\u00e9'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2)
    : 'x'.repeat(remaining)
  const body = JSON.stringify({ pad })
  expect(encoder.encode(body).byteLength).toBe(size)
  return body
}

function chunked(chunks: Uint8Array[]) {
  let index = 0
  const cancel = vi.fn()
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const next = chunks[index++]
    if (next === undefined) controller.close()
    else controller.enqueue(next)
  })
  return { stream: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), pull, cancel }
}

describe('refund route bounded input contract', () => {
  it.each([undefined, '', ' \n\t\r ', '{}', 'null', ' \n null \t '])(
    'preserves empty and explicit JSON null compatibility: %j',
    async (body) => {
      await expectAccepted(request(body), {})
    },
  )

  it.each([
    { amountHuf: 1250, reason: 'synthetic' },
    { amountHuf: '1250', reason: 7, unknown: ['kept'] },
    { amountHuf: null, reason: null, extra: { nested: true } },
    { amountHuf: false, reason: ['kept'], extra: 1 },
  ])('passes fields and unknown keys unchanged: %j', async (input) => {
    await expectAccepted(request(JSON.stringify(input)), input)
  })

  it.each(['{', '{bad}', '{}{}', '{"amountHuf":}', 'undefined'])(
    'rejects malformed JSON before refund: %s',
    async (body) => {
      await expectRejected(request(body), 400)
    },
  )

  it.each(['[]', '[{}]', '[1,"x"]', 'true', 'false', '0', '-1.5', '1e3', '""', '"refund"'])(
    'rejects nonobject JSON except the explicit null compatibility: %s',
    async (body) => {
      await expectRejected(request(body), 400)
    },
  )

  it.each([
    ['missing', {}],
    ['understated', { 'content-length': '1' }],
    ['chunked', { 'transfer-encoding': 'chunked' }],
  ] as const)('enforces actual ASCII byte limit with %s length', async (_name, headers) => {
    await expectRejected(request(bodyOfBytes(LIMIT + 1), headers), 413)
  })

  it.each([false, true])('accepts exactly 64 KiB (UTF-8: %s)', async (utf8) => {
    const body = bodyOfBytes(LIMIT, utf8)
    await expectAccepted(request(body, { 'content-length': String(LIMIT) }), JSON.parse(body))
  })

  it('counts UTF-8 bytes rather than string length without Content-Length', async () => {
    const body = bodyOfBytes(LIMIT + 1, true)
    expect(body.length).toBeLessThan(LIMIT)
    await expectRejected(request(body), 413)
  })

  it('rejects an overdeclared size without reading the body', async () => {
    const req = request('{}', { 'content-length': String(LIMIT + 1) })
    const text = vi.spyOn(req, 'text')
    const body = vi.spyOn(req, 'body', 'get')
    await expectRejected(req, 413)
    expect(text).not.toHaveBeenCalled()
    expect(body).not.toHaveBeenCalled()
  })

  it('accepts chunked exact-limit UTF-8 split inside a multibyte character', async () => {
    const body = bodyOfBytes(LIMIT, true)
    const bytes = encoder.encode(body)
    const split = bytes.indexOf(0xc3) + 1
    const source = chunked([bytes.slice(0, split), bytes.slice(split, 20000), bytes.slice(20000)])
    await expectAccepted(request(source.stream, { 'transfer-encoding': 'chunked' }), JSON.parse(body))
    expect(source.cancel).not.toHaveBeenCalled()
  })

  it.each<Record<string, string>>([{}, { 'content-length': '1' }])(
    'cancels over-limit chunks before reading the tail with headers %j',
    async (headers) => {
      const bytes = encoder.encode(bodyOfBytes(LIMIT + 1, true))
      const source = chunked([bytes.slice(0, LIMIT), bytes.slice(LIMIT), encoder.encode('tail')])
      await expectRejected(request(source.stream, headers), 413)
      expect(source.cancel).toHaveBeenCalledTimes(1)
      expect(source.pull).toHaveBeenCalledTimes(2)
    },
  )

  it('rejects oversize whitespace instead of interpreting it as an empty full refund', async () => {
    await expectRejected(request(' '.repeat(LIMIT + 1)), 413)
  })

  it('keeps a mid-stream read failure private and requires manual review without refund', async () => {
    const bodyMarker = 'DUMMY-REFUND-INPUT-BODY-7B82C1'
    const errorMarker = 'DUMMY-REFUND-INPUT-STREAM-ERROR-9D43A6'
    const chunk = encoder.encode(JSON.stringify({ reason: bodyMarker }))
    expect(chunk.byteLength).toBeLessThan(LIMIT)
    const logs: unknown[][] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args)
      })
    }
    let sentChunk = false
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (sentChunk) controller.error(new Error(errorMarker))
      else {
        sentChunk = true
        controller.enqueue(chunk)
      }
    })
    const stream = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 })
    const response = await fixture().run(request(stream))
    expect(pull).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: expect.any(String), manualReviewRequired: true })
    expect(service.run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const capturedLogs = (await import('node:util')).inspect(logs, { depth: null })
    for (const marker of [bodyMarker, errorMarker]) {
      expect(JSON.stringify(body)).not.toContain(marker)
      expect(capturedLogs).not.toContain(marker)
    }
  })

  it('preserves foreign-origin denial before authentication or body access', async () => {
    const req = request(undefined, {
      origin: 'https://foreign.example.test',
      'content-length': String(LIMIT + 1),
    })
    const text = vi.spyOn(req, 'text')
    const body = vi.spyOn(req, 'body', 'get')
    const route = fixture()
    expect((await route.run(req)).status).toBe(403)
    expect(route.getPayload).not.toHaveBeenCalled()
    expect(route.auth).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect(body).not.toHaveBeenCalled()
    expect(service.run).not.toHaveBeenCalled()
  })

  it.each([
    [null, 401],
    ['staff', 403],
    ['customer', 403],
  ] as const)('preserves role %s denial %i before body access', async (role, status) => {
    const req = request(undefined, { 'content-length': String(LIMIT + 1) })
    const text = vi.spyOn(req, 'text')
    const body = vi.spyOn(req, 'body', 'get')
    const route = fixture(role)
    expect((await route.run(req)).status).toBe(status)
    expect(route.auth).toHaveBeenCalledTimes(1)
    expect(text).not.toHaveBeenCalled()
    expect(body).not.toHaveBeenCalled()
    expect(service.run).not.toHaveBeenCalled()
  })

  it('preserves missing order-number rejection before body access', async () => {
    const req = request(undefined, { 'content-length': String(LIMIT + 1) })
    const text = vi.spyOn(req, 'text')
    const body = vi.spyOn(req, 'body', 'get')
    expect((await fixture().run(req, ' ')).status).toBe(400)
    expect(text).not.toHaveBeenCalled()
    expect(body).not.toHaveBeenCalled()
    expect(service.run).not.toHaveBeenCalled()
  })
})
