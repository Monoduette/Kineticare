import { createHash } from 'node:crypto'

import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { accessExpiredMessage } from '../lib/course-access'
import { fetchStreamToken, STREAM_SIGN_IN_REQUIRED_MESSAGE } from '../lib/stream-token-client'
import {
  parseStreamTokenResponseBody,
  playableStreamVideos,
  streamIframeSrc,
  streamVideoRef,
} from '../lib/stream/contract'
import { createStreamTokenHandler } from '../lib/stream/route-handler'
import type { Order, Product, User } from '../payload-types'

/**
 * A stream-token lánc SZERZŐDÉS-tesztje: a valódi kliens (fetchStreamToken)
 * a valódi szerverrel (route-handler + issueStreamToken) beszél, egy olyan
 * fetch-en keresztül, amely a kliens által épített URL-t adja át a
 * route-handlernek, és annak IGAZI válaszát adja vissza.
 *
 * Miért kell: a korábbi tesztek külön-külön mockolták a két oldalt (a
 * kliens-teszt számot mockolt `expiresAt`-nek, a szerver-teszt ISO-szöveget
 * várt), így két, egymásnak ELLENTMONDÓ feltevést rögzítettek, és a valós
 * lánc törése (a fizető vevő sem tudott lejátszani) átcsúszott rajtuk.
 *
 * A Bunny-átállás óta ez a teszt EGY FOKKAL többet is bizonyít: a jegy hash-e
 * a lejáratot is köti, ezért ha az `expiresAt` oda-vissza alakítása akár egy
 * másodpercet csúszna, a kliens által ismert számmal újraszámolt hash NEM
 * egyezne a szerver jegyével — ez a teszt pont ezt az elcsúszást fogja meg
 * (docs/video-platform-dontes.md 4.3).
 *
 * A paywall (vásárlás-ellenőrzés, lejárat) itt csak regresszió-őrként
 * szerepel — a szabályok forrása változatlanul az src/lib/course-access*.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Bunny token-hitelesítési kulcs.
const DUMMY_TOKEN_KEY = 'DUMMY-BUNNY-TOKEN-AUTH-KEY-NEM-VALODI-TITOK'

/** A jegy független újraszámítása (Bunny: SHA256_HEX(kulcs + guid + expires)). */
function expectedToken(videoId: string, expires: number): string {
  return createHash('sha256').update(`${DUMMY_TOKEN_KEY}${videoId}${expires}`).digest('hex')
}

const buyerUser = {
  id: 7,
  email: 'vevo@example.test',
  role: 'customer',
  purchases: [42],
} as unknown as User

const nonBuyerUser = { ...buyerUser, id: 8, purchases: [] } as unknown as User

type VideoRow = NonNullable<Product['videos']>[number]

const readyVideo = (id: string, streamAssetId: string, durationSec = 600): VideoRow => ({
  id,
  title: `${id} lecke`,
  streamAssetId,
  durationSec,
  status: 'ready',
})

function makeProduct(videos: VideoRow[], accessDurationDays: number | null = null): Product {
  return {
    id: 42,
    sku: 'KURZUS-ALAP',
    status: 'published',
    accessDurationDays,
    videos,
  } as unknown as Product
}

function makePaidOrder(createdAt: string): Order {
  return {
    id: 1,
    status: 'paid',
    createdAt,
    updatedAt: createdAt,
    items: [{ id: 'sor-1', product: 42, quantity: 1 }],
  } as unknown as Order
}

interface HarnessOptions {
  product?: Product
  user?: User | null
  orders?: Order[]
}

/**
 * A kliens és a szerver összekötése: a `fetchStreamToken` által épített
 * relatív URL-ből NextRequest lesz, a válasz pedig a route-handler valódi
 * NextResponse-a — semmit nem mockolunk a szerződésből.
 */
function createHarness(options: HarnessOptions = {}) {
  const requestedUrls: string[] = []
  const responseBodies: string[] = []
  const payload = {
    auth: vi.fn(async () => ({
      user: options.user === undefined ? buyerUser : options.user,
    })),
    findByID: vi.fn(
      async () => options.product ?? makeProduct([readyVideo('sor-1', 'elso-asset')]),
    ),
    find: vi.fn(async () => ({ docs: options.orders ?? [] })),
  } as unknown as Payload

  const GET = createStreamTokenHandler({ getPayload: async () => payload })

  const fetchImpl: typeof fetch = async (input) => {
    const requested =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requestedUrls.push(requested)
    const url = new URL(requested, 'https://shop.example.test')
    const response = await GET(new NextRequest(url.toString(), { method: 'GET' }))
    // A választörzs eredeti SZÖVEGE is kell (a szerializált `expiresAt` alakja
    // a round-trip bizonyíték része), ezért másolatot adunk vissza.
    responseBodies.push(await response.clone().text())
    return response
  }

  return { fetchImpl, payload, requestedUrls, responseBodies }
}

const savedTokenKey: { value: string | undefined } = { value: undefined }

beforeAll(() => {
  savedTokenKey.value = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
  process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = DUMMY_TOKEN_KEY
})

afterAll(() => {
  if (savedTokenKey.value === undefined) {
    delete process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
  } else {
    process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = savedTokenKey.value
  }
})

describe('stream-token szerződés — a kliens a szerver VALÓDI válaszát dolgozza fel', () => {
  it('a vevő jegyet kap, és a lejárat epoch másodpercként áll elő', async () => {
    const { fetchImpl } = createHarness()

    const result = await fetchStreamToken({ productId: 42 }, fetchImpl)

    expect(result.kind).toBe('token')
    if (result.kind !== 'token') {
      return
    }
    // A jegy a videóra ÉS a kliens által ismert lejáratra van kötve.
    expect(result.token).toBe(expectedToken('elso-asset', result.expiresAtEpochSec))
    // A kliens időaritmetikája (frissítés exp−5 percben) epoch MÁSODPERCET vár.
    expect(result.expiresAtEpochSec).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('a 2. epizód jegye a 2. epizód assetjére szól (stabil azonosító, nem sorszám)', async () => {
    const product = makeProduct([
      readyVideo('sor-1', 'elso-asset'),
      readyVideo('sor-2', 'masodik-asset', 900),
    ])
    const { fetchImpl, requestedUrls } = createHarness({ product })

    // Amit a lejátszó tesz: a KÖZÖS segédfüggvénnyel szűrt listából a 2. elem
    // stabil azonosítóját küldi.
    const episodes = playableStreamVideos(product.videos)
    const result = await fetchStreamToken(
      { productId: 42, videoId: streamVideoRef(episodes[1]) },
      fetchImpl,
    )

    expect(requestedUrls[0]).toContain('videoId=sor-2')
    expect(requestedUrls[0]).not.toContain('videoIndex')
    expect(result.kind).toBe('token')
    if (result.kind !== 'token') {
      return
    }
    expect(result.token).toBe(expectedToken('masodik-asset', result.expiresAtEpochSec))
  })

  it('feldolgozás alatti epizód nem csúsztatja el a jegyet (sorszám-független azonosítás)', async () => {
    const processing: VideoRow = {
      id: 'sor-0',
      title: 'Bevezető',
      streamAssetId: 'feldolgozas-alatti-asset',
      durationSec: 300,
      status: 'processing',
    }
    const product = makeProduct([
      processing,
      readyVideo('sor-1', 'elso-asset'),
      readyVideo('sor-2', 'masodik-asset', 900),
    ])
    const { fetchImpl } = createHarness({ product })

    const episodes = playableStreamVideos(product.videos)
    expect(episodes).toHaveLength(2)
    // A lejátszó listáján a 2. epizód a "masodik-asset"; a TELJES listában
    // ugyanez az 1-es index még az "elso-asset" lenne — a sorszám elcsúszik.
    const fullList = product.videos ?? []
    expect(fullList[1]?.streamAssetId).toBe('elso-asset')

    const result = await fetchStreamToken(
      { productId: 42, videoId: streamVideoRef(episodes[1]) },
      fetchImpl,
    )

    expect(result.kind).toBe('token')
    if (result.kind !== 'token') {
      return
    }
    expect(result.token).toBe(expectedToken('masodik-asset', result.expiresAtEpochSec))
  })

  it('a szerver a streamAssetId-t is elfogadja azonosítóként (sor-id nélküli sor)', async () => {
    const product = makeProduct([
      { title: 'Egyetlen lecke', streamAssetId: 'csak-asset', durationSec: 120, status: 'ready' },
    ])
    const { fetchImpl, requestedUrls } = createHarness({ product })

    const episodes = playableStreamVideos(product.videos)
    const result = await fetchStreamToken(
      { productId: 42, videoId: streamVideoRef(episodes[0]) },
      fetchImpl,
    )

    expect(requestedUrls[0]).toContain('videoId=csak-asset')
    expect(result.kind).toBe('token')
    if (result.kind !== 'token') {
      return
    }
    expect(result.token).toBe(expectedToken('csak-asset', result.expiresAtEpochSec))
  })

  it('ismeretlen videó-azonosító → a kliens általános hibaüzenetet ad (szerver 404)', async () => {
    const { fetchImpl } = createHarness()

    const result = await fetchStreamToken({ productId: 42, videoId: 'nincs-ilyen' }, fetchImpl)

    expect(result.kind).toBe('error')
  })

  it('nem-vevő → forbidden (a paywall változatlan), a szerver magyar üzenetével', async () => {
    const { fetchImpl, payload } = createHarness({ user: nonBuyerUser })

    const result = await fetchStreamToken({ productId: 42 }, fetchImpl)

    expect(result).toEqual({
      kind: 'forbidden',
      message: 'A videó megtekintéséhez a kurzus megvásárlása szükséges.',
    })
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('lejárt hozzáférésű vevő → forbidden, a lejárat NAPJÁVAL (nem általános szöveggel)', async () => {
    const { fetchImpl } = createHarness({
      product: makeProduct([readyVideo('sor-1', 'elso-asset')], 30),
      orders: [makePaidOrder('2020-01-01T10:00:00.000Z')],
    })

    const result = await fetchStreamToken({ productId: 42 }, fetchImpl)

    expect(result.kind).toBe('forbidden')
    if (result.kind !== 'forbidden') {
      return
    }
    // A szerver a lejárat napját is kiírja (accessExpiredMessage) — a lánc
    // 2026-08-29 óta ezt a mondatot a lejátszó felületére is átviszi, tehát a
    // vevő nem az általános „nincs hozzáférésed" szöveget kapja.
    expect(result.message).toBe(accessExpiredMessage(new Date('2020-01-31T10:00:00.000Z')))
    expect(result.message).toContain('2020. 01. 31.')
  })

  /**
   * BEJELENTKEZÉS NÉLKÜL a szerver 401-et ad, ami MÁS helyzet, mint a 403: a
   * kiút a belépés, nem a vásárlás. A kliens ezért külön `unauthenticated`
   * ágat ad vissza, és a szerver magyar mondatát is átviszi.
   */
  it('bejelentkezés nélkül → unauthenticated (nem forbidden), a szerver üzenetével', async () => {
    const { fetchImpl, payload } = createHarness({ user: null })

    const result = await fetchStreamToken({ productId: 42 }, fetchImpl)

    expect(result).toEqual({
      kind: 'unauthenticated',
      message: 'A videó lejátszásához bejelentkezés szükséges.',
    })
    // A kliens tartalék-szövege BITRE a szerver 401-es mondata: üzenet nélküli
    // törzsnél (üres válasz, proxy) a vevő ugyanazt olvassa.
    expect(STREAM_SIGN_IN_REQUIRED_MESSAGE).toBe(
      (result as { message: string | null }).message,
    )
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('hiányzó Bunny token-kulcs → unavailable (a szerver 503-a)', async () => {
    const original = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    delete process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
    try {
      const { fetchImpl } = createHarness()
      const result = await fetchStreamToken({ productId: 42 }, fetchImpl)
      expect(result).toEqual({ kind: 'unavailable' })
    } finally {
      process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = original
    }
  })
})

describe('lejárat oda-vissza (round-trip) — a néma, végzetes elcsúszás ellen', () => {
  it('exp (epoch mp) → ISO expiresAt → kliens-oldali epoch mp: BITRE ugyanaz az egész', () => {
    // Határesetek: a 32 bites előjeles határ, a jelenhez közeli érték, és egy
    // nagyon távoli lejárat. Ezredmásodperc SEHOL nem keletkezhet.
    for (const exp of [1, 1785600000, 2147483647, 2147483648, 253402300799]) {
      const expiresAt = new Date(exp * 1000).toISOString()
      expect(expiresAt).toMatch(/T\d{2}:\d{2}:\d{2}\.000Z$/)
      const parsed = parseStreamTokenResponseBody({ token: 'jegy', expiresAt })
      expect(parsed?.expiresAtEpochSec).toBe(exp)
      expect(Number.isInteger(parsed?.expiresAtEpochSec)).toBe(true)
    }
  })

  it('a VALÓDI láncon: a kliens számával újraszámolt hash egyezik a szerver jegyével', async () => {
    const { fetchImpl, responseBodies } = createHarness()

    const result = await fetchStreamToken({ productId: 42 }, fetchImpl)

    expect(result.kind).toBe('token')
    if (result.kind !== 'token') {
      return
    }
    // 1) A szerver ISO-alakja egész másodperc (nincs ezredmásodperc-rész).
    const body = JSON.parse(responseBodies[0]) as { token: string; expiresAt: string }
    expect(body.expiresAt).toMatch(/T\d{2}:\d{2}:\d{2}\.000Z$/)
    // 2) A kliens által visszaalakított szám ugyanaz, mint amit a szerver
    //    hashelt — ha bármelyik oldal elcsúszna, ez a hash NEM egyezne, és
    //    élesben MINDEN lejátszás elhalna (a hibaüzenet nélkül).
    expect(result.expiresAtEpochSec).toBe(Math.floor(Date.parse(body.expiresAt) / 1000))
    expect(result.token).toBe(expectedToken('elso-asset', result.expiresAtEpochSec))
  })

  it('az embed-URL expires paramétere ugyanaz a szám, amit a hash köt', async () => {
    const { fetchImpl } = createHarness()

    const result = await fetchStreamToken({ productId: 42 }, fetchImpl)
    expect(result.kind).toBe('token')
    if (result.kind !== 'token') {
      return
    }

    const src = streamIframeSrc({
      libraryId: '123456',
      streamAssetId: 'elso-asset',
      token: result.token,
      expiresAtEpochSec: result.expiresAtEpochSec,
    })
    const params = new URL(src as string).searchParams
    expect(params.get('expires')).toBe(String(result.expiresAtEpochSec))
    expect(params.get('token')).toBe(expectedToken('elso-asset', Number(params.get('expires'))))
  })
})

describe('parseStreamTokenResponseBody — a válasz-szerződés egyetlen olvasója', () => {
  it('ISO-8601 expiresAt → epoch másodperc', () => {
    const parsed = parseStreamTokenResponseBody({
      token: 'jegy-hex',
      expiresAt: '2026-08-01T12:10:00.000Z',
    })
    expect(parsed).toEqual({
      token: 'jegy-hex',
      expiresAtEpochSec: Math.floor(Date.parse('2026-08-01T12:10:00.000Z') / 1000),
    })
  })

  it('szám alakú expiresAt-et NEM fogad el (a régi, hibás kliens-feltevés)', () => {
    expect(parseStreamTokenResponseBody({ token: 'jegy-hex', expiresAt: 1785588000 })).toBeNull()
  })

  it('értelmezhetetlen vagy hiányzó mezők → null', () => {
    expect(parseStreamTokenResponseBody({ token: 'jegy-hex', expiresAt: 'tegnap' })).toBeNull()
    expect(parseStreamTokenResponseBody({ token: 'jegy-hex' })).toBeNull()
    expect(parseStreamTokenResponseBody({ expiresAt: '2026-08-01T12:10:00.000Z' })).toBeNull()
    expect(parseStreamTokenResponseBody(null)).toBeNull()
  })
})

describe('streamIframeSrc — a Bunny lejátszó beágyazási URL-je', () => {
  it('library-id + GUID + jegy + lejárat → pontos Bunny embed-URL', () => {
    const src = streamIframeSrc({
      libraryId: '123456',
      streamAssetId: 'elso-asset',
      token: 'abcdef0123456789',
      expiresAtEpochSec: 1785600000,
    })
    expect(src).toBe(
      'https://iframe.mediadelivery.net/embed/123456/elso-asset?token=abcdef0123456789&expires=1785600000',
    )
    expect(new URL(src as string).origin).toBe('https://iframe.mediadelivery.net')
  })

  it('hiányzó library-id / GUID / token esetén null (magyar üzenet, nem fekete iframe)', () => {
    const base = { streamAssetId: 'elso-asset', token: 'jegy', expiresAtEpochSec: 1785600000 }
    expect(streamIframeSrc({ ...base, libraryId: undefined })).toBeNull()
    expect(streamIframeSrc({ ...base, libraryId: null })).toBeNull()
    expect(streamIframeSrc({ ...base, libraryId: '   ' })).toBeNull()
    expect(streamIframeSrc({ ...base, libraryId: '123456', streamAssetId: '' })).toBeNull()
    expect(streamIframeSrc({ ...base, libraryId: '123456', streamAssetId: '  ' })).toBeNull()
    expect(streamIframeSrc({ ...base, libraryId: '123456', token: '' })).toBeNull()
    expect(streamIframeSrc({ ...base, libraryId: '123456', token: '   ' })).toBeNull()
  })

  it('értelmetlen lejárat (tört, nem véges, nem pozitív) → null, nem elrontott URL', () => {
    const base = { libraryId: '123456', streamAssetId: 'elso-asset', token: 'jegy' }
    // Ezredmásodperc/másodperc keverés jellemző jele a tört érték.
    expect(streamIframeSrc({ ...base, expiresAtEpochSec: 1785600000.5 })).toBeNull()
    expect(streamIframeSrc({ ...base, expiresAtEpochSec: Number.NaN })).toBeNull()
    expect(streamIframeSrc({ ...base, expiresAtEpochSec: Number.POSITIVE_INFINITY })).toBeNull()
    expect(streamIframeSrc({ ...base, expiresAtEpochSec: 0 })).toBeNull()
    expect(streamIframeSrc({ ...base, expiresAtEpochSec: -1 })).toBeNull()
  })

  it('MÚLTBELI lejárat esetén is URL épül (a lejárat-kezelés nem itt lakik)', () => {
    const src = streamIframeSrc({
      libraryId: '123456',
      streamAssetId: 'elso-asset',
      token: 'jegy',
      expiresAtEpochSec: 1,
    })
    // A Bunny utasítja el a lejárt jegyet, a lejátszó pedig a lejárat előtt 5
    // perccel amúgy is újat kér — itt új lejárat-logika nem keletkezhet.
    expect(src).toBe('https://iframe.mediadelivery.net/embed/123456/elso-asset?token=jegy&expires=1')
  })

  it('a hoszt nem tágítható idegen originre (a library-id, a GUID és a jegy kódolva megy)', () => {
    const src = streamIframeSrc({
      libraryId: '../evil',
      streamAssetId: '../szoke',
      token: 'a b&expires=999#',
      expiresAtEpochSec: 1785600000,
    })
    expect(src).toBe(
      'https://iframe.mediadelivery.net/embed/..%2Fevil/..%2Fszoke?token=a%20b%26expires%3D999%23&expires=1785600000',
    )
    const url = new URL(src as string)
    expect(url.origin).toBe('https://iframe.mediadelivery.net')
    // A jegybe csempészett paraméter nem lesz ÖNÁLLÓ query-paraméter, és a
    // valódi lejáratot sem írja felül.
    expect(url.searchParams.get('expires')).toBe('1785600000')
    expect(url.searchParams.get('token')).toBe('a b&expires=999#')
  })
})
