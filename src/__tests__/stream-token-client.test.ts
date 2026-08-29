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

  it('403 → forbidden, a szerver magyar üzenetével', async () => {
    const uzenet = 'A hozzáférésed ehhez a kurzushoz lejárt.'
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: uzenet }), { status: 403 }))
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'forbidden', message: uzenet })
  })

  /**
   * A 401 és a 403 KÉT KÜLÖNBÖZŐ helyzet, és két különböző teendő: a 401-nél
   * a munkamenet hiányzik (belépés a kiút), a 403-nál a jogosultság (a
   * belépés semmit nem old meg). A korábbi közös `forbidden` ág a lejárt
   * munkamenetű vevőnek azt mondta, hogy nincs hozzáférése — hamis ok.
   * NN/g, Error Message Guidelines: ne mondj hamis okot, és mondd meg a
   * következő lépést (https://www.nngroup.com/articles/error-message-guidelines/).
   */
  it('401 → unauthenticated (külön ág), a szerver magyar üzenetével', async () => {
    const uzenet = 'A videó lejátszásához bejelentkezés szükséges.'
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: uzenet }), { status: 401 }))
    const result = await fetchStreamToken({ productId: 1 }, mockFetch as never)
    expect(result).toEqual({ kind: 'unauthenticated', message: uzenet })
  })

  it('üzenet nélküli 401/403 törzs → message: null (a felület a saját tartalékát mutatja)', async () => {
    for (const [status, kind] of [
      [401, 'unauthenticated'],
      [403, 'forbidden'],
    ] as const) {
      expect(
        await fetchStreamToken(
          { productId: 1 },
          vi.fn().mockResolvedValue(new Response('{}', { status })) as never,
        ),
      ).toEqual({ kind, message: null })
      // Nem JSON törzs (üres válasz, proxy-hibalap): a json() dobása sem
      // ronthatja el az ágat.
      expect(
        await fetchStreamToken(
          { productId: 1 },
          vi.fn().mockResolvedValue(new Response('', { status })) as never,
        ),
      ).toEqual({ kind, message: null })
      // Nem-szöveg `error` mező szintén nem kerülhet a felületre.
      expect(
        await fetchStreamToken(
          { productId: 1 },
          vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify({ error: 42 }), { status })) as never,
        ),
      ).toEqual({ kind, message: null })
      // Csak szóközökből álló üzenet sem üzenet.
      expect(
        await fetchStreamToken(
          { productId: 1 },
          vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify({ error: '   ' }), { status })) as never,
        ),
      ).toEqual({ kind, message: null })
    }
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
