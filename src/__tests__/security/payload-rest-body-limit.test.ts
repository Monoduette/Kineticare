import { describe, expect, it, vi } from 'vitest'

import {
  PAYLOAD_REST_BODY_MAX_BYTES,
  PAYLOAD_REST_BODY_TOO_LARGE_MESSAGE,
  withPayloadRestBodyLimit,
} from '../../lib/security/payload-rest-body-limit'

/**
 * A Payload REST nem-multipart törzse korlátozott: a túl nagy kérés 413-at
 * kap, és el sem jut a Payloadig (memória-DoS ellen).
 */

const URL_BASE = 'https://kineticare.test/api/pages'

function streamOf(totalBytes: number, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkBytes, totalBytes - sent)
      sent += size
      controller.enqueue(new Uint8Array(size).fill(0x61))
    },
  })
}

describe('withPayloadRestBodyLimit', () => {
  it('a korlát alatti JSON-törzs változatlanul eljut a Payloadig', async () => {
    const inner = vi.fn(async (request: Request) => Response.json(await request.json()))
    const handler = withPayloadRestBodyLimit(inner)
    const response = await handler(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Árvíztűrő' }),
      }),
    )
    expect(inner).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({ title: 'Árvíztűrő' })
  })

  it('a deklaráltan túl nagy törzs 413, a Payload nem fut', async () => {
    const inner = vi.fn(async () => new Response('nem szabad'))
    const handler = withPayloadRestBodyLimit(inner)
    const response = await handler(
      new Request(URL_BASE, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'content-length': String(PAYLOAD_REST_BODY_MAX_BYTES + 1),
        },
        body: 'x',
      }),
    )
    expect(response.status).toBe(413)
    expect(inner).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({
      errors: [{ message: PAYLOAD_REST_BODY_TOO_LARGE_MESSAGE }],
    })
  })

  it('a content-length nélküli (chunked) túl nagy törzs is 413', async () => {
    const inner = vi.fn(async () => new Response('nem szabad'))
    const handler = withPayloadRestBodyLimit(inner, 1024)
    const response = await handler(
      new Request(URL_BASE, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: streamOf(10 * 1024, 512),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
    )
    expect(response.status).toBe(413)
    expect(inner).not.toHaveBeenCalled()
  })

  it('a nem JSON content-type sem kerüli meg a korlátot', async () => {
    const inner = vi.fn(async () => new Response('nem szabad'))
    const handler = withPayloadRestBodyLimit(inner, 1024)
    const response = await handler(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'Application/JSON; charset=utf-8' },
        body: 'x'.repeat(2048),
      }),
    )
    expect(response.status).toBe(413)
    expect(inner).not.toHaveBeenCalled()
  })

  it('a multipart törzset a Payload streamelő parsere kezeli, itt nem olvassuk be', async () => {
    const inner = vi.fn(async (request: Request) => {
      expect(request.bodyUsed).toBe(false)
      return new Response('ok')
    })
    const handler = withPayloadRestBodyLimit(inner, 16)
    const form = new FormData()
    form.set('_payload', JSON.stringify({ title: 'x'.repeat(1024) }))
    const response = await handler(new Request(URL_BASE, { method: 'POST', body: form }))
    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('a GET és a törzs nélküli kérés érintetlen', async () => {
    const inner = vi.fn(async () => new Response('ok'))
    const handler = withPayloadRestBodyLimit(inner, 1)
    await handler(new Request(URL_BASE))
    await handler(new Request(URL_BASE, { method: 'POST' }))
    expect(inner).toHaveBeenCalledTimes(2)
  })
})

describe('a Payload REST catch-all bekötése', () => {
  it('a POST, PATCH és PUT Payload-levele a törzsméret-korláton megy át', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      new URL('../../app/(payload)/api/[...slug]/route.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('payloadPost: withPayloadRestBodyLimit(REST_POST(config))')
    expect(source).toContain('withPayloadRestBodyLimit(REST_PATCH(config))')
    expect(source).toContain('withPayloadRestBodyLimit(REST_PUT(config))')
  })
})
