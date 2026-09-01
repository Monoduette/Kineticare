import { describe, expect, it } from 'vitest'

import { DEFAULT_JSON_BODY_MAX_BYTES, readJsonWithCap } from '../../lib/security/request-body'

/**
 * SEC-008 — a JSON-törzs beolvasása FELSŐ KORLÁTTAL. A túl nagy törzs
 * `too-large`, a hibás/üres `invalid`; a korlát alatti érvényes JSON parse-olva
 * jön vissza. A cap a korlátlan `request.json()` bufferelést zárja.
 */
function jsonRequest(body: string): Request {
  return new Request('https://pelda.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('readJsonWithCap', () => {
  it('a korlát alatti érvényes JSON parse-olva jön vissza', async () => {
    const result = await readJsonWithCap(jsonRequest(JSON.stringify({ a: 1 })), 1024)
    expect(result).toEqual({ ok: true, value: { a: 1 } })
  })

  it('a korlátot túllépő törzs → too-large (nem parse-olódik)', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(5000) })
    const result = await readJsonWithCap(jsonRequest(big), 1024)
    expect(result).toEqual({ ok: false, reason: 'too-large' })
  })

  it('hibás JSON → invalid', async () => {
    const result = await readJsonWithCap(jsonRequest('nem json {'), 1024)
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('üres törzs → invalid', async () => {
    const result = await readJsonWithCap(jsonRequest(''), 1024)
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('alapértelmezett korlát 64 KiB', () => {
    expect(DEFAULT_JSON_BODY_MAX_BYTES).toBe(64 * 1024)
  })
})
