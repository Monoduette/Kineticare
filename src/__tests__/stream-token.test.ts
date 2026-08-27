import { createHash } from 'node:crypto'

import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Order, Product, User } from '../payload-types'
import { ACCESS_EXPIRED_TITLE } from '../lib/course-access'
import { optionalBunnyStreamEnvVars, requiredEnvVars } from '../env'
import {
  issueStreamToken,
  StreamTokenError,
  type StreamTokenServiceResult,
} from '../lib/stream/issue-stream-token'
import { createStreamTokenHandler } from '../lib/stream/route-handler'
import {
  createStreamPlaybackToken,
  durationSecForPlaybackToken,
  STREAM_TOKEN_GRACE_SECONDS,
  STREAM_TOKEN_MAX_TTL_SECONDS,
  STREAM_TOKEN_MIN_TTL_SECONDS,
} from '../lib/stream/token'
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
} from '../lib/security/rate-limit'

/**
 * /api/stream-token egységtesztek — mockolt Payload local API-val, az
 * src/__tests__/checkout-start.test.ts mintáját követve.
 *
 * A jegy a Bunny Stream sémája szerint SHA256_HEX(kulcs + guid + expires);
 * a hash egyszerre köti a videót ÉS a lejáratot, ezért az „erre a videóra,
 * eddig" állítás egyetlen független újraszámítással ellenőrizhető.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Bunny token-hitelesítési kulcs.
const DUMMY_TOKEN_KEY = 'DUMMY-BUNNY-TOKEN-AUTH-KEY-NEM-VALODI-TITOK'
const DUMMY_ASSET_ID = 'bunny-video-guid-abc123'

/**
 * ISMERT VEKTOR — a hash-séma rögzítése.
 *
 * A várt értéket FÜGGETLEN implementációval állítottuk elő, nem ezzel a
 * kóddal (a repóban futtatva):
 *
 *   printf '%s' 'DUMMY-BUNNY-TOKEN-AUTH-KEY-NEM-VALODI-TITOK00000000-1111-2222-3333-4444444444441785600000' | sha256sum
 *
 * A kulcs DUMMY, a GUID és a lejárat szintetikus — sem éles, sem a
 * szolgáltató dokumentációjából másolt érték nincs a repóban (CLAUDE.md #1).
 */
const KNOWN_VECTOR = {
  key: DUMMY_TOKEN_KEY,
  guid: '00000000-1111-2222-3333-444444444444',
  expires: 1785600000,
  token: 'd40de210bdaf1f1d96bc40eb63fb9801b9e654361f2f2e13ba7b5b5b98a83ae2',
  /** Ugyanez FELCSERÉLT sorrenddel (guid + kulcs + expires) — ezt NEM adhatja. */
  tokenIfOrderSwapped: 'b77168b08e9edf17def57f68753be1dfe14ac748b0b49423f652b0c5cac40b60',
} as const

/** A jegy független újraszámítása a DUMMY kulccsal. */
function expectedToken(videoId: string, expires: number): string {
  return createHash('sha256').update(`${DUMMY_TOKEN_KEY}${videoId}${expires}`).digest('hex')
}

/**
 * A kiállított jegy ellenőrzése: a hash újraszámítása bizonyítja, MELYIK
 * videóra és MELYIK lejáratra szól, a TTL pedig a videóhossz + 10 perc
 * türelem (max. 24 óra) szabályt.
 */
function expectTokenFor(
  result: StreamTokenServiceResult,
  videoId: string,
  durationSec: number | null,
): void {
  const expires = Math.floor(Date.parse(result.expiresAt) / 1000)
  expect(result.token).toBe(expectedToken(videoId, expires))
  const effective = durationSecForPlaybackToken(durationSec)
  const ttl = Math.min(effective + STREAM_TOKEN_GRACE_SECONDS, STREAM_TOKEN_MAX_TTL_SECONDS)
  const remaining = expires - Math.floor(Date.now() / 1000)
  expect(remaining).toBeLessThanOrEqual(ttl)
  expect(remaining).toBeGreaterThan(ttl - 5)
}

const buyerUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  role: 'customer',
  purchases: [42],
} as unknown as User

const nonBuyerUser = {
  ...buyerUser,
  id: 8,
  purchases: [],
} as unknown as User

interface ProductOverrides {
  status?: 'draft' | 'published' | 'archived'
  videos?: Product['videos']
  /** A1: a hozzáférés hossza napokban (üres = korlátlan). */
  accessDurationDays?: number | null
}

function makeProduct(overrides: ProductOverrides = {}): Product {
  return {
    id: 42,
    sku: 'KURZUS-ALAP',
    status: overrides.status ?? 'published',
    accessDurationDays: overrides.accessDurationDays ?? null,
    videos:
      overrides.videos !== undefined
        ? overrides.videos
        : [
            {
              id: 'sor-1',
              title: '1. lecke',
              streamAssetId: DUMMY_ASSET_ID,
              durationSec: 1800,
              status: 'ready',
            },
          ],
  } as unknown as Product
}

/** Paid rendelés-fixtúra a vásárlás időpontjához (az orders sémában nincs paidAt). */
function makePaidOrder(createdAt: string, productId = 42): Order {
  return {
    id: 1,
    status: 'paid',
    createdAt,
    updatedAt: createdAt,
    items: [{ id: 'sor-1', product: productId, quantity: 1 }],
  } as unknown as Order
}

interface MockPayloadOptions {
  authUser?: User | null
  product?: Product | null
  /** A vevő paid rendelései (A1 — a hozzáférés kezdőpontjának forrása). */
  orders?: Order[]
}

function createMockPayload(options: MockPayloadOptions = {}) {
  const payload = {
    auth: vi.fn(async () => ({
      user: options.authUser === undefined ? buyerUser : options.authUser,
    })),
    findByID: vi.fn(async () => {
      if (options.product === null) {
        throw new Error('Not Found')
      }
      return options.product ?? makeProduct()
    }),
    find: vi.fn(async () => ({ docs: options.orders ?? [] })),
  }
  return { payload: payload as unknown as Payload }
}

const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  savedEnv.BUNNY_STREAM_TOKEN_AUTH_KEY = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
  process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = DUMMY_TOKEN_KEY
})

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('Bunny-ENV — a videó-kulcsok egyike sem induláskori kötelező', () => {
  it('a kulcsok hiánya NEM dönti el az appot (nincsenek a requiredEnvVars között)', () => {
    for (const key of optionalBunnyStreamEnvVars) {
      expect(requiredEnvVars as readonly string[]).not.toContain(key)
    }
  })

  it('a titok NEM NEXT_PUBLIC_ (sosem kerülhet a böngészőbe)', () => {
    expect(optionalBunnyStreamEnvVars).toContain('BUNNY_STREAM_TOKEN_AUTH_KEY')
    expect('BUNNY_STREAM_TOKEN_AUTH_KEY'.startsWith('NEXT_PUBLIC_')).toBe(false)
  })
})

describe('createStreamPlaybackToken — Bunny hash-séma és élettartam', () => {
  it('ISMERT VEKTOR: token = SHA256_HEX(kulcs + guid + expires), kisbetűs hex', () => {
    // A lejáratot úgy állítjuk be, hogy a TTL-szabály pontosan a vektor
    // `expires` értékét adja: kiállítás + 0 mp videóhossz + 600 mp türelem.
    const now = new Date((KNOWN_VECTOR.expires - STREAM_TOKEN_GRACE_SECONDS) * 1000)
    const result = createStreamPlaybackToken({
      videoId: KNOWN_VECTOR.guid,
      durationSec: 0,
      signingKey: KNOWN_VECTOR.key,
      now,
    })

    expect(result.expires).toBe(KNOWN_VECTOR.expires)
    expect(result.token).toBe(KNOWN_VECTOR.token)
    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    // A fűzési SORREND kötött: a felcserélt sorrend hash-ét sosem adhatja.
    expect(result.token).not.toBe(KNOWN_VECTOR.tokenIfOrderSwapped)
  })

  it('expires = most + videóhossz + 10 perc; a hash ezt az expires-t köti', () => {
    const now = new Date('2026-08-01T12:00:00.000Z')
    const result = createStreamPlaybackToken({
      videoId: DUMMY_ASSET_ID,
      durationSec: 1800,
      signingKey: DUMMY_TOKEN_KEY,
      now,
    })

    expect(result.issuedAt).toBe(Math.floor(now.getTime() / 1000))
    expect(result.expires - result.issuedAt).toBe(1800 + STREAM_TOKEN_GRACE_SECONDS)
    expect(STREAM_TOKEN_GRACE_SECONDS).toBe(600)
    expect(result.token).toBe(expectedToken(DUMMY_ASSET_ID, result.expires))
  })

  it('24 órás clamp: nagyon hosszú videó esetén az élettartam max. 24 óra', () => {
    const result = createStreamPlaybackToken({
      videoId: DUMMY_ASSET_ID,
      durationSec: 48 * 60 * 60,
      signingKey: DUMMY_TOKEN_KEY,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })

    expect(result.expires - result.issuedAt).toBe(STREAM_TOKEN_MAX_TTL_SECONDS)
    expect(STREAM_TOKEN_MAX_TTL_SECONDS).toBe(24 * 60 * 60)
  })

  it('0 másodperces videóhossz esetén is megmarad a 10 perces türelem', () => {
    const result = createStreamPlaybackToken({
      videoId: DUMMY_ASSET_ID,
      durationSec: 0,
      signingKey: DUMMY_TOKEN_KEY,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    expect(result.expires - result.issuedAt).toBe(STREAM_TOKEN_GRACE_SECONDS)
  })

  it('más videó vagy más lejárat → más jegy (a hash mindkettőt köti)', () => {
    const base = {
      durationSec: 600,
      signingKey: DUMMY_TOKEN_KEY,
      now: new Date('2026-08-01T12:00:00.000Z'),
    }
    const first = createStreamPlaybackToken({ ...base, videoId: 'elso-guid' })
    const second = createStreamPlaybackToken({ ...base, videoId: 'masodik-guid' })
    const later = createStreamPlaybackToken({
      ...base,
      videoId: 'elso-guid',
      now: new Date('2026-08-01T12:00:01.000Z'),
    })

    expect(first.token).not.toBe(second.token)
    expect(first.token).not.toBe(later.token)
  })

  it('a kulcs körüli whitespace nem változtatja meg a jegyet (Railway-beillesztés)', () => {
    const now = new Date('2026-08-01T12:00:00.000Z')
    const clean = createStreamPlaybackToken({
      videoId: DUMMY_ASSET_ID,
      durationSec: 60,
      signingKey: DUMMY_TOKEN_KEY,
      now,
    })
    const padded = createStreamPlaybackToken({
      videoId: `  ${DUMMY_ASSET_ID}  `,
      durationSec: 60,
      signingKey: `  ${DUMMY_TOKEN_KEY}\n`,
      now,
    })
    expect(padded.token).toBe(clean.token)
  })

  it('hibás bemenetre (üres videoId / negatív hossz / üres kulcs) hibát dob', () => {
    expect(() =>
      createStreamPlaybackToken({ videoId: '', durationSec: 60, signingKey: DUMMY_TOKEN_KEY }),
    ).toThrowError(/videoId/)
    expect(() =>
      createStreamPlaybackToken({ videoId: '   ', durationSec: 60, signingKey: DUMMY_TOKEN_KEY }),
    ).toThrowError(/videoId/)
    expect(() =>
      createStreamPlaybackToken({
        videoId: DUMMY_ASSET_ID,
        durationSec: -1,
        signingKey: DUMMY_TOKEN_KEY,
      }),
    ).toThrowError(/durationSec/)
    expect(() =>
      createStreamPlaybackToken({ videoId: DUMMY_ASSET_ID, durationSec: 60, signingKey: ' ' }),
    ).toThrowError(/signingKey/)
  })
})

describe('durationSecForPlaybackToken — hiányzó vagy rövid videóhossz', () => {
  it('hiányzó hossz → 24 órás plafon (grace levonva, hogy a TTL a max legyen)', () => {
    expect(durationSecForPlaybackToken(null)).toBe(
      STREAM_TOKEN_MAX_TTL_SECONDS - STREAM_TOKEN_GRACE_SECONDS,
    )
  })

  it('rövid lecke → legalább a 2 órás alsó küszöb', () => {
    expect(durationSecForPlaybackToken(60)).toBe(
      STREAM_TOKEN_MIN_TTL_SECONDS - STREAM_TOKEN_GRACE_SECONDS,
    )
    expect(durationSecForPlaybackToken(10_000)).toBe(10_000)
  })
})

describe('issueStreamToken — paywall és token-kiállítás', () => {
  it('vevő + published termék → érvényes jegy (a videóra és a lejáratra kötve)', async () => {
    const { payload } = createMockPayload()

    const result = await issueStreamToken({ payload, user: buyerUser, productId: 42 })

    expectTokenFor(result, DUMMY_ASSET_ID, 1800)
  })

  it('vevő + archived termék → tovább nézheti (200-szerű token)', async () => {
    const { payload } = createMockPayload({ product: makeProduct({ status: 'archived' }) })

    const result = await issueStreamToken({ payload, user: buyerUser, productId: 42 })

    expectTokenFor(result, DUMMY_ASSET_ID, 1800)
  })

  it('vevő + draft termék → 403 (draftot senki sem nézhet)', async () => {
    const { payload } = createMockPayload({ product: makeProduct({ status: 'draft' }) })

    const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
    await expect(promise).rejects.toBeInstanceOf(StreamTokenError)
    await expect(promise).rejects.toMatchObject({ status: 403 })
    await expect(promise).rejects.toThrowError(/megvásárlása szükséges/)
  })

  it('A1 — időkorlát nélküli terméknél nem indul rendelés-lekérdezés (mai viselkedés)', async () => {
    const { payload } = createMockPayload()

    await issueStreamToken({ payload, user: buyerUser, productId: 42 })

    expect(payload.find).not.toHaveBeenCalled()
  })

  it('A1 — érvényes időkorlátos hozzáférés (a vásárlás óta még nem telt le) → token', async () => {
    const { payload } = createMockPayload({
      product: makeProduct({ accessDurationDays: 365 }),
      orders: [makePaidOrder(new Date().toISOString())],
    })

    const result = await issueStreamToken({ payload, user: buyerUser, productId: 42 })

    expectTokenFor(result, DUMMY_ASSET_ID, 1800)
    expect(payload.find).toHaveBeenCalledTimes(1)
  })

  it('A1 — LEJÁRT hozzáférés → 403, magyar üzenettel és a lejárat napjával', async () => {
    const { payload } = createMockPayload({
      product: makeProduct({ accessDurationDays: 30 }),
      orders: [makePaidOrder('2020-01-01T10:00:00.000Z')],
    })

    const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
    await expect(promise).rejects.toBeInstanceOf(StreamTokenError)
    await expect(promise).rejects.toMatchObject({ status: 403 })
    await expect(promise).rejects.toThrowError(new RegExp(ACCESS_EXPIRED_TITLE))
    // 2020-01-01 + 30 nap — a vevő megtudja, mikor járt le a hozzáférése.
    await expect(promise).rejects.toThrowError(/2020\. 01\. 31\./)
  })

  it('A1 — időkorlátos termék paid rendelés nélkül (kézzel adott hozzáférés) → nem esik ki', async () => {
    const { payload } = createMockPayload({
      product: makeProduct({ accessDurationDays: 30 }),
      orders: [],
    })

    const result = await issueStreamToken({ payload, user: buyerUser, productId: 42 })

    expectTokenFor(result, DUMMY_ASSET_ID, 1800)
  })

  it('A1 — a lejárt hozzáférés a vásárlás-ellenőrzés UTÁN dől el (nem-vevő nem kap más üzenetet)', async () => {
    const { payload } = createMockPayload({
      authUser: nonBuyerUser,
      product: makeProduct({ accessDurationDays: 30 }),
      orders: [makePaidOrder('2020-01-01T10:00:00.000Z')],
    })

    const promise = issueStreamToken({ payload, user: nonBuyerUser, productId: 42 })
    await expect(promise).rejects.toThrowError(/megvásárlása szükséges/)
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('nem-vevő → 403, és a termék lekérdezése MEG SEM történik (nincs létezés-szivárgás)', async () => {
    const { payload } = createMockPayload({ authUser: nonBuyerUser })

    const promise = issueStreamToken({ payload, user: nonBuyerUser, productId: 42 })
    await expect(promise).rejects.toMatchObject({ status: 403 })
    await expect(promise).rejects.toThrowError(/megvásárlása szükséges/)
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('populate-olt purchases (Product-objektum) is érvényes vásárlásnak számít', async () => {
    const populatedBuyer = {
      ...buyerUser,
      purchases: [{ id: 42 } as Product],
    } as unknown as User
    const { payload } = createMockPayload()

    const result = await issueStreamToken({ payload, user: populatedBuyer, productId: '42' })
    expectTokenFor(result, DUMMY_ASSET_ID, 1800)
  })

  it('videoId-val a terméken belüli videó célozható (streamAssetId egyezés)', async () => {
    const product = makeProduct({
      videos: [
        {
          id: 'sor-1',
          title: '1. lecke',
          streamAssetId: 'elso-asset',
          durationSec: 600,
          status: 'ready',
        },
        {
          id: 'sor-2',
          title: '2. lecke',
          streamAssetId: 'masodik-asset',
          durationSec: 900,
          status: 'ready',
        },
      ],
    })
    const { payload } = createMockPayload({ product })

    const result = await issueStreamToken({
      payload,
      user: buyerUser,
      productId: 42,
      videoId: 'masodik-asset',
    })

    expectTokenFor(result, 'masodik-asset', 900)
  })

  it('ismeretlen videoId → 404 magyar üzenettel', async () => {
    const { payload } = createMockPayload()
    const promise = issueStreamToken({
      payload,
      user: buyerUser,
      productId: 42,
      videoId: 'nincs-ilyen',
    })
    await expect(promise).rejects.toMatchObject({ status: 404 })
    await expect(promise).rejects.toThrowError(/videó nem található/)
  })

  it('feldolgozás alatti (nem ready) videó → 409 magyar üzenettel', async () => {
    const product = makeProduct({
      videos: [
        {
          id: 'sor-1',
          title: '1. lecke',
          streamAssetId: DUMMY_ASSET_ID,
          durationSec: 1800,
          status: 'processing',
        },
      ],
    })
    const { payload } = createMockPayload({ product })
    const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(/feldolgozása még folyamatban/)
  })

  it('üres/whitespace videó-GUID az adminban → 503 magyar üzenettel (nem fekete lejátszó)', async () => {
    const product = makeProduct({
      videos: [
        {
          id: 'sor-1',
          title: '1. lecke',
          streamAssetId: '   ',
          durationSec: 1800,
          status: 'ready',
        },
      ],
    })
    const { payload } = createMockPayload({ product })
    const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
    await expect(promise).rejects.toMatchObject({ status: 503 })
    await expect(promise).rejects.toThrowError(/ideiglenesen nem érhető el/)
  })

  it('hiányzó durationSec → jegy a max TTL-lel, nem 503', async () => {
    const product = makeProduct({
      videos: [
        {
          id: 'sor-1',
          title: '1. lecke',
          streamAssetId: DUMMY_ASSET_ID,
          durationSec: null,
          status: 'ready',
        },
      ],
    })
    const { payload } = createMockPayload({ product })
    const result = await issueStreamToken({ payload, user: buyerUser, productId: 42 })
    expectTokenFor(result, DUMMY_ASSET_ID, null)
  })

  it('érvénytelen productId → 400', async () => {
    const { payload } = createMockPayload()
    const promise = issueStreamToken({ payload, user: buyerUser, productId: 'abc' })
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/kurzus azonosítója/)
  })

  it('hiányzó BUNNY_STREAM_TOKEN_AUTH_KEY → 503 magyar üzenettel (lazy ENV-ellenőrzés)', async () => {
    const original = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    delete process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    try {
      const { payload } = createMockPayload()
      const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
      await expect(promise).rejects.toMatchObject({ status: 503 })
      await expect(promise).rejects.toThrowError(/ideiglenesen nem érhető el/)
    } finally {
      process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = original
    }
  })

  it('csak whitespace-t tartalmazó token-kulcs → ugyanaz az 503-as út', async () => {
    const original = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = '   '
    try {
      const { payload } = createMockPayload()
      const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
      await expect(promise).rejects.toMatchObject({ status: 503 })
    } finally {
      process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = original
    }
  })

  it('a megvásárolt, de törölt/nem létező termék → 404 (csak a vevő felé)', async () => {
    const { payload } = createMockPayload({ product: null })
    const promise = issueStreamToken({ payload, user: buyerUser, productId: 42 })
    await expect(promise).rejects.toMatchObject({ status: 404 })
    await expect(promise).rejects.toThrowError(/kurzus nem található/)
  })
})

describe('GET /api/stream-token route-handler', () => {
  const makeRequest = (query: string, headers: Record<string, string> = {}): NextRequest =>
    new NextRequest(`https://shop.example.test/api/stream-token${query}`, {
      method: 'GET',
      headers,
    })

  it('bejelentkezés nélkül → 401, magyar üzenettel', async () => {
    const { payload } = createMockPayload({ authUser: null })
    const GET = createStreamTokenHandler({ getPayload: async () => payload })

    const response = await GET(makeRequest('?productId=42'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'A videó lejátszásához bejelentkezés szükséges.',
    })
  })

  it('vevő + published termék → 200 { token, expiresAt }; a wire-formátum változatlan', async () => {
    const { payload } = createMockPayload()
    const GET = createStreamTokenHandler({ getPayload: async () => payload })

    const response = await GET(makeRequest('?productId=42'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as StreamTokenServiceResult
    // A szerződés két mezője, se többel, se kevesebbel — a kliens erre épül.
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'token'])
    expect(typeof body.token).toBe('string')
    expect(typeof body.expiresAt).toBe('string')
    expectTokenFor(body, DUMMY_ASSET_ID, 1800)
  })

  it('nem-vevő → 403; a válasz nem árulja el, hogy a termék létezik-e', async () => {
    const { payload } = createMockPayload({ authUser: nonBuyerUser })
    const GET = createStreamTokenHandler({ getPayload: async () => payload })

    const response = await GET(makeRequest('?productId=42'))

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('A videó megtekintéséhez a kurzus megvásárlása szükséges.')
    // Minimális információ: a 403-as törzs csak az egységes üzenetet tartalmazza.
    expect(Object.keys(body)).toEqual(['error'])
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('A1 — lejárt hozzáférésű vevő → 403, a lejárat napját is tartalmazó magyar üzenettel', async () => {
    const { payload } = createMockPayload({
      product: makeProduct({ accessDurationDays: 30 }),
      orders: [makePaidOrder('2020-01-01T10:00:00.000Z')],
    })
    const GET = createStreamTokenHandler({ getPayload: async () => payload })

    const response = await GET(makeRequest('?productId=42', { 'x-request-id': 'teszt-keres-1' }))

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain(ACCESS_EXPIRED_TITLE)
    expect(body.error).toContain('2020. 01. 31.')
    // A válasz továbbra is csak a felhasználói üzenetet hordozza.
    expect(Object.keys(body)).toEqual(['error'])
  })

  it('A1 — érvényes időkorlátos hozzáférésű vevő → 200', async () => {
    const { payload } = createMockPayload({
      product: makeProduct({ accessDurationDays: 365 }),
      orders: [makePaidOrder(new Date().toISOString())],
    })
    const GET = createStreamTokenHandler({ getPayload: async () => payload })

    const response = await GET(makeRequest('?productId=42'))

    expect(response.status).toBe(200)
  })

  it('hiányzó productId → 400', async () => {
    const { payload } = createMockPayload()
    const GET = createStreamTokenHandler({ getPayload: async () => payload })

    const response = await GET(makeRequest(''))

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('kurzus azonosítója')
  })

  it('hiányzó token-kulcs → 503 magyar üzenettel', async () => {
    const original = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    delete process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    try {
      const { payload } = createMockPayload()
      const GET = createStreamTokenHandler({ getPayload: async () => payload })

      const response = await GET(makeRequest('?productId=42'))

      expect(response.status).toBe(503)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('ideiglenesen nem érhető el')
    } finally {
      process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = original
    }
  })

  it('váratlan technikai hiba → 500, általános magyar üzenettel (a részletek csak a naplóba)', async () => {
    const GET = createStreamTokenHandler({
      getPayload: async () => {
        throw new Error('DB-kapcsolat megszakadt')
      },
    })

    const response = await GET(makeRequest('?productId=42'))

    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('A videó most nem indítható el')
    expect(body.error).not.toContain('DB-kapcsolat')
  })

  it('minden válasz no-store, a 200-as és a tiltó ágon is', async () => {
    const expectNoStore = (response: Response): void => {
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }

    const { payload } = createMockPayload()
    const GET = createStreamTokenHandler({ getPayload: async () => payload })
    const ok = await GET(makeRequest('?productId=42'))
    expect(ok.status).toBe(200)
    expectNoStore(ok)

    const { payload: anonPayload } = createMockPayload({ authUser: null })
    const ANON = createStreamTokenHandler({ getPayload: async () => anonPayload })
    const unauthorized = await ANON(makeRequest('?productId=42'))
    expect(unauthorized.status).toBe(401)
    expectNoStore(unauthorized)

    const { payload: nonBuyerPayload } = createMockPayload({ authUser: nonBuyerUser })
    const FORBIDDEN = createStreamTokenHandler({ getPayload: async () => nonBuyerPayload })
    const forbidden = await FORBIDDEN(makeRequest('?productId=42'))
    expect(forbidden.status).toBe(403)
    expectNoStore(forbidden)

    const badRequest = await GET(makeRequest(''))
    expect(badRequest.status).toBe(400)
    expectNoStore(badRequest)

    const limiter = new SlidingWindowRateLimiter()
    const limitedRules = { ...RATE_LIMIT_RULES, 'stream-token': { limit: 1, windowMs: 60_000 } }
    const LIMITED = createStreamTokenHandler({
      getPayload: async () => payload,
      rateLimit: { limiter, rules: limitedRules },
    })
    expect((await LIMITED(makeRequest('?productId=42'))).status).toBe(200)
    const throttled = await LIMITED(makeRequest('?productId=42'))
    expect(throttled.status).toBe(429)
    expectNoStore(throttled)

    const FAIL = createStreamTokenHandler({
      getPayload: async () => {
        throw new Error('DB-kapcsolat megszakadt')
      },
    })
    const failed = await FAIL(makeRequest('?productId=42'))
    expect(failed.status).toBe(500)
    expectNoStore(failed)
  })

  /**
   * Per-user kérés-korlát: a végpont hitelesített, és minden hívása
   * Bunny-lejátszási jegyet állít ki — fék nélkül egy belépett fiók
   * korlátlanul farmolhatna jegyet. A keret alanya ezért a FELHASZNÁLÓ, nem
   * az IP (egy user IP-t vált, több user oszthat NAT-IP-t).
   */
  describe('per-user kérés-korlát (A2 kiterjesztés)', () => {
    const rules = { ...RATE_LIMIT_RULES, 'stream-token': { limit: 2, windowMs: 60_000 } }

    it('a keret felett 429, magyar üzenettel és Retry-After fejléccel', async () => {
      const limiter = new SlidingWindowRateLimiter()
      const { payload } = createMockPayload()
      const GET = createStreamTokenHandler({
        getPayload: async () => payload,
        rateLimit: { limiter, rules },
      })

      expect((await GET(makeRequest('?productId=42'))).status).toBe(200)
      expect((await GET(makeRequest('?productId=42'))).status).toBe(200)

      const throttled = await GET(makeRequest('?productId=42'))
      expect(throttled.status).toBe(429)
      expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0)
      const body = (await throttled.json()) as { error: string }
      expect(body.error).toBe(RATE_LIMIT_MESSAGE)
      expect(Object.keys(body)).toEqual(['error'])
    })

    it('a keret a BEJELENTKEZETT userhez tartozik, nem a kéréshez/IP-hez', async () => {
      const limiter = new SlidingWindowRateLimiter()
      const masikVevo = { ...buyerUser, id: 99 } as unknown as User
      const { payload } = createMockPayload()
      const { payload: masikPayload } = createMockPayload({ authUser: masikVevo })

      const GET = createStreamTokenHandler({
        getPayload: async () => payload,
        rateLimit: { limiter, rules },
      })
      const MASIK_GET = createStreamTokenHandler({
        getPayload: async () => masikPayload,
        rateLimit: { limiter, rules },
      })

      await GET(makeRequest('?productId=42'))
      await GET(makeRequest('?productId=42'))
      expect((await GET(makeRequest('?productId=42'))).status).toBe(429)

      // A másik vevő kerete érintetlen (ugyanaz a kérés, más session).
      expect((await MASIK_GET(makeRequest('?productId=42'))).status).toBe(200)
    })

    it('bejelentkezés nélkül a keret nem fogy (a 401 az AUTH-on dől el)', async () => {
      const limiter = new SlidingWindowRateLimiter()
      const { payload } = createMockPayload({ authUser: null })
      const GET = createStreamTokenHandler({
        getPayload: async () => payload,
        rateLimit: { limiter, rules },
      })

      for (let index = 0; index < 10; index += 1) {
        expect((await GET(makeRequest('?productId=42'))).status).toBe(401)
      }
      expect(limiter.trackedKeyCount).toBe(0)
    })
  })
})
