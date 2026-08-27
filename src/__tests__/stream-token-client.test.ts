import { describe, expect, it, vi } from 'vitest'

import {
  fetchStreamToken,
  GENERIC_STREAM_ERROR,
  STREAM_PROCESSING_MESSAGE,
} from '../lib/stream-token-client'

/**
 * A kliens egységtesztje. A válasz-fixtúrák a VALÓDI szerver-szerződést
 * követik (`expiresAt` ISO-8601 szöveg, a videó azonosítója `videoId`) — a
 * két oldal együttes ellenőrzése az src/__tests__/stream-token-contract.test.ts.
 */

const EXPIRES_AT_ISO = '2026-08-01T12:10:00.000Z'
const EXPIRES_AT_EPOCH_SEC = Math.floor(Date.parse(EXPIRES_AT_ISO) / 1000)

describe('fetchStreamToken', () => {
  it('200 {token, expiresAt} → token-kind, epoch másodpercre váltott lejárattal', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'jwt.abc', expiresAt: EXPIRES_AT_ISO }), {
        status: 200,
      }),
    )
    const result = await fetchStreamToken({ productId: 1, videoId: 'sor-1' }, mockFetch as never)
    expect(result).toEqual({
      kind: 'token',
      token: 'jwt.abc',
      expiresAtEpochSec: EXPIRES_AT_EPOCH_SEC,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream-token?productId=1&videoId=sor-1',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('videoId nélkül csak a productId kerül a query-be', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'jwt.abc', expiresAt: EXPIRES_AT_ISO }), {
        status: 200,
      }),
    )
    await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream-token?productId=1',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('szám alakú expiresAt (a régi, hibás feltevés) → error, nem token', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ token: 'jwt.abc', expiresAt: 1785588000 }), { status: 200 }),
      )
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'error', message: GENERIC_STREAM_ERROR })
  })

  it('401/403 → forbidden (nem-vevő)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }))
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'forbidden' })
  })

  it('503 → unavailable (hiányzó CF-kulcs)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('500 → error általános üzenettel', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'error', message: GENERIC_STREAM_ERROR })
  })

  it('409 → error a feldolgozás üzenetével, nem az általános hibával', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 409 }))
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'error', message: STREAM_PROCESSING_MESSAGE })
    expect(STREAM_PROCESSING_MESSAGE).not.toBe(GENERIC_STREAM_ERROR)
  })
})
