import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { CoursePlayer } from '../components/account/CoursePlayer'
import { ACCESS_EXPIRED_TITLE } from '../lib/course-access'
import {
  GENERIC_MARK_WATCHED_ERROR,
  markVideoWatched as markVideoWatchedFromClient,
} from '../lib/course-progress/client'
import { MARK_WATCHED_PATH, parseMarkWatchedResponseBody } from '../lib/course-progress/contract'
import { MAX_BODY_BYTES } from '../lib/course-progress/route-handler'
import {
  COURSE_NOT_FOUND_MESSAGE,
  INVALID_BODY_MESSAGE,
  NOT_PURCHASED_MESSAGE,
  UNKNOWN_VIDEO_MESSAGE,
} from '../lib/course-progress/mark-watched'
import {
  NO_VIDEOS_LABEL,
  summarizeCourseProgress,
  toWatchedRefSet,
  watchedRefsByProduct,
} from '../lib/course-progress/progress'
import { createMarkWatchedHandler } from '../lib/course-progress/route-handler'
import { buildCurriculum } from '../lib/curriculum/curriculum'
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
} from '../lib/security/rate-limit'
import type { CourseProgress, Order, Product, User } from '../payload-types'

/**
 * E1 — kurzus-haladás: a POST /api/course-progress/mark-watched végpont
 * auth-mátrixa (mockolt Payload local API-val, az src/__tests__/refund.test.ts
 * és stream-token.test.ts mintája szerint) + a haladás-számító tiszta
 * függvényeinek szélsőséges esetei.
 */

const PRODUCT_ID = 42
const VIDEO_REF_1 = 'sor-1'
const VIDEO_REF_2 = 'sor-2'
const ASSET_1 = 'cf-stream-asset-1'
const ASSET_2 = 'cf-stream-asset-2'

const buyerUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  role: 'customer',
  purchases: [PRODUCT_ID],
} as unknown as User

const nonBuyerUser = { ...buyerUser, id: 8, purchases: [] } as unknown as User

interface ProductOverrides {
  status?: 'draft' | 'published' | 'archived'
  videos?: Product['videos']
  accessDurationDays?: number | null
}

function makeProduct(overrides: ProductOverrides = {}): Product {
  return {
    id: PRODUCT_ID,
    sku: 'Kézrehab alapkurzus',
    status: overrides.status ?? 'published',
    accessDurationDays: overrides.accessDurationDays ?? null,
    videos:
      overrides.videos !== undefined
        ? overrides.videos
        : [
            {
              id: VIDEO_REF_1,
              title: '1. lecke',
              streamAssetId: ASSET_1,
              durationSec: 600,
              status: 'ready',
            },
            {
              id: VIDEO_REF_2,
              title: '2. lecke',
              streamAssetId: ASSET_2,
              durationSec: 900,
              status: 'ready',
            },
          ],
  } as unknown as Product
}

/** Paid rendelés a hozzáférés kezdőpontjához (az orders sémában nincs paidAt). */
function makePaidOrder(createdAt: string): Order {
  return {
    id: 1,
    status: 'paid',
    createdAt,
    updatedAt: createdAt,
    items: [{ id: 'tetel-1', product: PRODUCT_ID, quantity: 1 }],
  } as unknown as Order
}

function makeProgressRow(overrides: Partial<CourseProgress> = {}): CourseProgress {
  return {
    id: 1,
    user: buyerUser.id,
    product: PRODUCT_ID,
    videoRef: VIDEO_REF_1,
    watchedAt: '2026-08-01T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  } as unknown as CourseProgress
}

interface MockPayloadOptions {
  authUser?: User | null
  product?: Product | null
  /** A vevő paid rendelései (a lejárat kezdőpontja). */
  orders?: Order[]
  /** A már meglévő haladás-sorok (find-then-create). */
  progressRows?: CourseProgress[]
  /** true esetén a create hibát dob (párhuzamos kérés / unique index). */
  createThrows?: boolean
  /** A create utáni újraolvasáskor talált sor (verseny-ág). */
  progressRowsAfterCreate?: CourseProgress[]
}

function createMockPayload(options: MockPayloadOptions = {}) {
  let progressReads = 0
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    if (options.createThrows === true) {
      throw new Error('duplicate key value violates unique constraint')
    }
    return makeProgressRow({
      videoRef: String(args.data.videoRef),
      watchedAt: String(args.data.watchedAt),
    })
  })
  const find = vi.fn(async (args: { collection: string }) => {
    if (args.collection === 'course-progress') {
      progressReads += 1
      const docs =
        progressReads > 1 && options.progressRowsAfterCreate !== undefined
          ? options.progressRowsAfterCreate
          : (options.progressRows ?? [])
      return { docs }
    }
    return { docs: options.orders ?? [] }
  })
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
    find,
    create,
  }
  return { payload: payload as unknown as Payload, create, find }
}

function makeRequest(body?: unknown): Request {
  return new Request('https://shop.example.test/api/course-progress/mark-watched', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function setup(options: MockPayloadOptions = {}) {
  const mock = createMockPayload(options)
  const POST = createMarkWatchedHandler({ getPayload: async () => mock.payload })
  return { ...mock, POST }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

const VALID_BODY = { productId: String(PRODUCT_ID), videoRef: VIDEO_REF_1 }

/** A Payload `where` fából a `user.equals` érték — a hostile userId-teszthez. */
function userEqualsFromWhere(where: unknown): unknown {
  if (typeof where !== 'object' || where === null) {
    return undefined
  }
  const record = where as Record<string, unknown>
  if (record.user && typeof record.user === 'object' && record.user !== null) {
    return (record.user as { equals?: unknown }).equals
  }
  if (Array.isArray(record.and)) {
    for (const clause of record.and) {
      const found = userEqualsFromWhere(clause)
      if (found !== undefined) {
        return found
      }
    }
  }
  return undefined
}

describe('POST /api/course-progress/mark-watched — auth- és hibamátrix', () => {
  it('401: bejelentkezés nélkül nem rögzíthető haladás', async () => {
    const { POST, create } = setup({ authUser: null })

    const response = await POST(makeRequest(VALID_BODY))

    expect(response.status).toBe(401)
    expect(await readJson(response)).toEqual({
      error: 'A haladás rögzítéséhez bejelentkezés szükséges.',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('403: nincs megvásárolva — a termék lekérdezése el sem indul', async () => {
    const { POST, create, find } = setup({ authUser: nonBuyerUser })

    const response = await POST(makeRequest(VALID_BODY))

    expect(response.status).toBe(403)
    expect(await readJson(response)).toEqual({ error: NOT_PURCHASED_MESSAGE })
    expect(create).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
  })

  it('403: lejárt hozzáférés — a course-access modul üzenetével', async () => {
    const { POST, create } = setup({
      product: makeProduct({ accessDurationDays: 30 }),
      orders: [makePaidOrder('2020-01-01T00:00:00.000Z')],
    })

    const response = await POST(makeRequest(VALID_BODY))
    const body = await readJson(response)

    expect(response.status).toBe(403)
    expect(String(body.error)).toContain(ACCESS_EXPIRED_TITLE)
    expect(create).not.toHaveBeenCalled()
  })

  it('404: a termék nem létezik', async () => {
    const { POST, create } = setup({ product: null })

    const response = await POST(makeRequest(VALID_BODY))

    expect(response.status).toBe(404)
    expect(await readJson(response)).toEqual({ error: COURSE_NOT_FOUND_MESSAGE })
    expect(create).not.toHaveBeenCalled()
  })

  it('404: draft (nem published) termék', async () => {
    const { POST, create } = setup({ product: makeProduct({ status: 'draft' }) })

    const response = await POST(makeRequest(VALID_BODY))

    expect(response.status).toBe(404)
    expect(await readJson(response)).toEqual({ error: COURSE_NOT_FOUND_MESSAGE })
    expect(create).not.toHaveBeenCalled()
  })

  it('archived termék: a MEGLÉVŐ vevő haladása rögzülhet (a lejátszással azonos szabály)', async () => {
    const { POST, create } = setup({ product: makeProduct({ status: 'archived' }) })

    const response = await POST(makeRequest(VALID_BODY))

    expect(response.status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('400: a videoRef nem ehhez a kurzushoz tartozik', async () => {
    const { POST, create } = setup()

    const response = await POST(makeRequest({ productId: String(PRODUCT_ID), videoRef: 'idegen' }))

    expect(response.status).toBe(400)
    expect(await readJson(response)).toEqual({ error: UNKNOWN_VIDEO_MESSAGE })
    expect(create).not.toHaveBeenCalled()
  })

  it('400: hiányzó vagy nem szöveg típusú mező', async () => {
    for (const body of [
      {},
      { productId: String(PRODUCT_ID) },
      { videoRef: VIDEO_REF_1 },
      { productId: String(PRODUCT_ID), videoRef: 3 },
      { productId: String(PRODUCT_ID), videoRef: '   ' },
      { productId: { id: PRODUCT_ID }, videoRef: VIDEO_REF_1 },
      { productId: 'nem-szam', videoRef: VIDEO_REF_1 },
    ]) {
      const { POST, create } = setup()
      const response = await POST(makeRequest(body))
      expect(response.status).toBe(400)
      expect(await readJson(response)).toEqual({ error: INVALID_BODY_MESSAGE })
      expect(create).not.toHaveBeenCalled()
    }
  })

  it('400: nem JSON törzs', async () => {
    const { POST } = setup()
    const request = new Request('https://shop.example.test/api/course-progress/mark-watched', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'nem-json',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(await readJson(response)).toEqual({
      error:
        'A haladás nem menthető: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
    })
  })

  it('200: sikeres jelölés — a sor a szerveroldali watchedAt-tel jön létre', async () => {
    const { POST, create } = setup()

    const response = await POST(makeRequest(VALID_BODY))
    const body = parseMarkWatchedResponseBody(await response.json())

    expect(response.status).toBe(200)
    expect(body).not.toBeNull()
    expect(body?.productId).toBe(PRODUCT_ID)
    expect(body?.videoRef).toBe(VIDEO_REF_1)
    expect(body?.alreadyWatched).toBe(false)
    expect(Number.isFinite(Date.parse(body?.watchedAt ?? ''))).toBe(true)

    expect(create).toHaveBeenCalledTimes(1)
    const createArgs = create.mock.calls[0]?.[0] as unknown as {
      collection: string
      data: Record<string, unknown>
      overrideAccess: boolean
    }
    expect(createArgs.collection).toBe('course-progress')
    expect(createArgs.overrideAccess).toBe(true)
    expect(createArgs.data.user).toBe(buyerUser.id)
    expect(createArgs.data.product).toBe(PRODUCT_ID)
    expect(createArgs.data.videoRef).toBe(VIDEO_REF_1)
  })

  it('a törzs userId mezőjét FIGYELMEN KÍVÜL hagyja: a haladás a bejelentkezett useré', async () => {
    const { POST, create, find } = setup()

    const response = await POST(
      makeRequest({
        productId: String(PRODUCT_ID),
        videoRef: VIDEO_REF_1,
        userId: 999,
      }),
    )

    expect(response.status).toBe(200)

    const progressFinds = find.mock.calls.filter((call) => {
      const args = call[0] as { collection?: string }
      return args.collection === 'course-progress'
    })
    expect(progressFinds.length).toBeGreaterThan(0)
    for (const call of progressFinds) {
      const args = call[0] as { where?: unknown }
      expect(userEqualsFromWhere(args.where)).toBe(buyerUser.id)
      expect(userEqualsFromWhere(args.where)).not.toBe(999)
    }

    expect(create).toHaveBeenCalledTimes(1)
    const createArgs = create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>
    }
    expect(createArgs.data.user).toBe(buyerUser.id)
    expect(createArgs.data.user).not.toBe(999)
  })

  it('200 idempotens: a már megnézett videó { alreadyWatched: true }, új sor nélkül', async () => {
    const { POST, create } = setup({ progressRows: [makeProgressRow()] })

    const response = await POST(makeRequest(VALID_BODY))
    const body = parseMarkWatchedResponseBody(await response.json())

    expect(response.status).toBe(200)
    expect(body?.alreadyWatched).toBe(true)
    expect(body?.watchedAt).toBe('2026-08-01T10:00:00.000Z')
    expect(create).not.toHaveBeenCalled()
  })

  it('200: párhuzamos kérés (unique index) — a create hibája után a meglévő sor jön vissza', async () => {
    const { POST, create } = setup({
      createThrows: true,
      progressRows: [],
      progressRowsAfterCreate: [makeProgressRow()],
    })

    const response = await POST(makeRequest(VALID_BODY))
    const body = parseMarkWatchedResponseBody(await response.json())

    expect(response.status).toBe(200)
    expect(body?.alreadyWatched).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('500: ha az írás valóban elbukik (nem verseny), a hiba nem szivárog ki a vevőhöz', async () => {
    const { POST } = setup({ createThrows: true, progressRows: [] })

    const response = await POST(makeRequest(VALID_BODY))
    const body = await readJson(response)

    expect(response.status).toBe(500)
    expect(String(body.error)).toContain('A haladás mentése most nem sikerült')
    expect(String(body.error)).not.toContain('unique constraint')
  })

  it('a productId számként is elfogadott (a JSON természetes alakja)', async () => {
    const { POST, create } = setup()

    const response = await POST(makeRequest({ productId: PRODUCT_ID, videoRef: VIDEO_REF_1 }))

    expect(response.status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a streamAssetId is elfogadott ref (a sor-id hiányában ez a stabil azonosító)', async () => {
    const { POST, create } = setup({
      product: makeProduct({
        videos: [
          { streamAssetId: ASSET_1, durationSec: 600, status: 'ready' },
        ] as unknown as Product['videos'],
      }),
    })

    const response = await POST(makeRequest({ productId: PRODUCT_ID, videoRef: ASSET_1 }))

    expect(response.status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })
})

/**
 * Per-user kérés-korlát a haladás-jelölésen. A végpont ÍR az adatbázisba, és az
 * automatikus, nézettség-alapú jelölés bevezetésével a hívásszám függetlenné
 * vált a felhasználói kattintásoktól — korlát nélkül egy belépett fiók
 * korlátlanul hozhatna létre haladás-sort. A keret az AUTH UTÁN, de a
 * törzs-feldolgozás és az írás ELŐTT fut (a stream-token mintája).
 */
describe('POST /api/course-progress/mark-watched — per-user kérés-korlát', () => {
  const rules = {
    ...RATE_LIMIT_RULES,
    'course-progress': { limit: 2, windowMs: 60_000 },
  }

  function setupWithLimiter(options: MockPayloadOptions = {}) {
    const mock = createMockPayload(options)
    const limiter = new SlidingWindowRateLimiter()
    const POST = createMarkWatchedHandler({
      getPayload: async () => mock.payload,
      rateLimit: { limiter, rules },
    })
    // A limiter is kimegy: a per-user vödrözés teszteléséhez egy MÁSIK
    // felhasználó handlerének UGYANEZT a limiter-példányt kell kapnia.
    return { ...mock, POST, limiter }
  }

  it('a keret felett 429-et ad, magyar üzenettel és Retry-After fejléccel', async () => {
    const { POST, create } = setupWithLimiter()

    expect((await POST(makeRequest(VALID_BODY))).status).toBe(200)
    expect((await POST(makeRequest(VALID_BODY))).status).toBe(200)

    const rejected = await POST(makeRequest(VALID_BODY))
    expect(rejected.status).toBe(429)
    expect(await readJson(rejected)).toEqual({ error: RATE_LIMIT_MESSAGE })
    expect(rejected.headers.get('Retry-After')).not.toBeNull()
    // A harmadik kérés már NEM jutott el az írásig.
    expect(create).toHaveBeenCalledTimes(2)
  })

  /**
   * A code review fogta meg: a teszt korábbi változata SOSEM küldött kérést a
   * második felhasználóként (a mock-payloadjához nem készült handler), tehát a
   * per-user vödrözést egyáltalán nem ellenőrizte — a záró assert triviálisan
   * igaz volt. Most a KÖZÖS limiter-példányon két külön felhasználó fut:
   * az első kimeríti a keretét, a másodiknak érintetlen keretének kell lennie.
   */
  it('a keret a BEJELENTKEZETT felhasználóhoz kötődik, nem az IP-hez', async () => {
    const masikVevo = { ...buyerUser, id: buyerUser.id + 1 } as User
    const elso = setupWithLimiter()
    const masikMock = createMockPayload({ authUser: masikVevo })
    const masikPOST = createMarkWatchedHandler({
      getPayload: async () => masikMock.payload,
      rateLimit: { limiter: elso.limiter, rules },
    })

    // Az első vevő kimeríti a saját keretét (2/perc) — AZONOS IP-fejlécekkel.
    expect((await elso.POST(makeRequest(VALID_BODY))).status).toBe(200)
    expect((await elso.POST(makeRequest(VALID_BODY))).status).toBe(200)
    expect((await elso.POST(makeRequest(VALID_BODY))).status).toBe(429)

    // A MÁSIK felhasználó UGYANAZON a limiteren, ugyanarról az „IP-ről" indul:
    // ha a kulcs az IP volna, itt azonnal 429-et kapna. A felhasználói kulcs
    // miatt érintetlen a kerete.
    expect((await masikPOST(makeRequest(VALID_BODY))).status).toBe(200)
    expect((await masikPOST(makeRequest(VALID_BODY))).status).toBe(200)
    expect((await masikPOST(makeRequest(VALID_BODY))).status).toBe(429)
  })

  it('bejelentkezés nélkül a keret NEM fogy (a 401 előbb fut le)', async () => {
    const { POST } = setupWithLimiter({ authUser: null })

    for (let index = 0; index < 5; index += 1) {
      expect((await POST(makeRequest(VALID_BODY))).status).toBe(401)
    }
  })

  it('az éles keret percenkénti, és elbírja egy hosszú kurzus végigjelölését', () => {
    expect(RATE_LIMIT_RULES['course-progress']).toEqual({ limit: 60, windowMs: 60_000 })
  })
})

describe('summarizeCourseProgress — a haladás-számítás szélsőséges esetei', () => {
  const videos = [
    { id: VIDEO_REF_1, streamAssetId: ASSET_1, status: 'ready' as const },
    { id: VIDEO_REF_2, streamAssetId: ASSET_2, status: 'ready' as const },
  ]

  it('alapeset: a megnézett videók száma és a százalék', () => {
    const summary = summarizeCourseProgress(videos, [VIDEO_REF_1])

    expect(summary).toMatchObject({ total: 2, watched: 1, percent: 50, complete: false })
    expect(summary.label).toBe('1/2 videó megnézve')
    expect(summary.shortLabel).toBe('1/2 megnézve')
  })

  it('orphan ref: a kurzusból időközben törölt videó nem számít bele és nem hibázik', () => {
    const summary = summarizeCourseProgress(videos, [VIDEO_REF_1, 'mar-torolt-video', 'masik'])

    expect(summary.total).toBe(2)
    expect(summary.watched).toBe(1)
    expect(summary.label).toBe('1/2 videó megnézve')
  })

  it('0 videós kurzus: „Még nincs videó", 0 százalék, nincs osztás nullával', () => {
    for (const empty of [[], null, undefined]) {
      const summary = summarizeCourseProgress(empty, [VIDEO_REF_1])
      expect(summary.total).toBe(0)
      expect(summary.watched).toBe(0)
      expect(summary.percent).toBe(0)
      expect(Number.isFinite(summary.percent)).toBe(true)
      expect(summary.complete).toBe(false)
      expect(summary.label).toBe(NO_VIDEOS_LABEL)
      expect(summary.shortLabel).toBe(NO_VIDEOS_LABEL)
    }
  })

  it('duplikált ref (hiányzó unique index esetén) csak egyszer számít', () => {
    const summary = summarizeCourseProgress(videos, [
      VIDEO_REF_1,
      VIDEO_REF_1,
      VIDEO_REF_1,
      VIDEO_REF_2,
    ])

    expect(summary.watched).toBe(2)
    expect(summary.percent).toBe(100)
    expect(summary.complete).toBe(true)
  })

  it('a feldolgozás alatti videó nem számít bele az összesbe (a lejátszóval azonos szűrés)', () => {
    const summary = summarizeCourseProgress(
      [
        { id: VIDEO_REF_1, streamAssetId: ASSET_1, status: 'ready' as const },
        { id: VIDEO_REF_2, streamAssetId: ASSET_2, status: 'processing' as const },
      ],
      [VIDEO_REF_1],
    )

    expect(summary.total).toBe(1)
    expect(summary.watched).toBe(1)
    expect(summary.complete).toBe(true)
  })

  it('a százalék egészre kerekít (1/3 → 33%)', () => {
    const summary = summarizeCourseProgress(
      [
        { id: 'a', streamAssetId: 'asset-a', status: 'ready' as const },
        { id: 'b', streamAssetId: 'asset-b', status: 'ready' as const },
        { id: 'c', streamAssetId: 'asset-c', status: 'ready' as const },
      ],
      ['a'],
    )

    expect(summary.percent).toBe(33)
  })
})

describe('toWatchedRefSet / watchedRefsByProduct — dedupe és hiányos sorok', () => {
  it('az üres és a csak whitespace ref kimarad, a duplikátum egyszer szerepel', () => {
    const set = toWatchedRefSet([VIDEO_REF_1, VIDEO_REF_1, '  ', '', null, undefined, ' sor-2 '])

    expect([...set].sort()).toEqual([VIDEO_REF_1, VIDEO_REF_2])
  })

  it('nyers id és populate-olt kapcsolat is ugyanabba a kurzusba esik, deduplikálva', () => {
    const byProduct = watchedRefsByProduct([
      { product: PRODUCT_ID, videoRef: VIDEO_REF_1 },
      { product: { id: PRODUCT_ID }, videoRef: VIDEO_REF_1 },
      { product: { id: PRODUCT_ID }, videoRef: VIDEO_REF_2 },
      { product: 99, videoRef: 'masik-kurzus' },
      { product: null, videoRef: VIDEO_REF_1 },
      { product: PRODUCT_ID, videoRef: null },
    ])

    expect([...(byProduct.get(PRODUCT_ID) ?? [])].sort()).toEqual([VIDEO_REF_1, VIDEO_REF_2])
    expect([...(byProduct.get(99) ?? [])]).toEqual(['masik-kurzus'])
    expect(byProduct.size).toBe(2)
  })
})

describe('markVideoWatched (kliens) — a szerződés kliens-oldala', () => {
  function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('200: a szerződés szerinti törzset küldi a végpontra, és parse-olja a választ', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          productId: PRODUCT_ID,
          videoRef: VIDEO_REF_1,
          watchedAt: '2026-08-01T10:00:00.000Z',
          alreadyWatched: false,
        },
        200,
      ),
    )

    const result = await markVideoWatchedFromClient(
      { productId: PRODUCT_ID, videoRef: VIDEO_REF_1 },
      fetchMock as unknown as typeof fetch,
    )

    expect(result).toEqual({
      kind: 'ok',
      watchedAt: '2026-08-01T10:00:00.000Z',
      alreadyWatched: false,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(MARK_WATCHED_PATH)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      productId: String(PRODUCT_ID),
      videoRef: VIDEO_REF_1,
    })
  })

  it('403: a szerver magyar üzenetét adja tovább (forbidden ág)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: NOT_PURCHASED_MESSAGE }, 403))

    const result = await markVideoWatchedFromClient(
      { productId: PRODUCT_ID, videoRef: VIDEO_REF_1 },
      fetchMock as unknown as typeof fetch,
    )

    expect(result).toEqual({ kind: 'forbidden', message: NOT_PURCHASED_MESSAGE })
  })

  it('hálózati hiba: általános magyar üzenet, kivétel nélkül', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })

    const result = await markVideoWatchedFromClient(
      { productId: PRODUCT_ID, videoRef: VIDEO_REF_1 },
      fetchMock as unknown as typeof fetch,
    )

    expect(result).toEqual({ kind: 'error', message: GENERIC_MARK_WATCHED_ERROR })
  })

  it('szerződésszegő 200-as törzs: általános hibaüzenet, nem hamis siker', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ productId: 'nem-szam' }, 200))

    const result = await markVideoWatchedFromClient(
      { productId: PRODUCT_ID, videoRef: VIDEO_REF_1 },
      fetchMock as unknown as typeof fetch,
    )

    expect(result).toEqual({ kind: 'error', message: GENERIC_MARK_WATCHED_ERROR })
  })
})

describe('Kurzus-haladás a felületen', () => {
  /**
   * A lejátszó bemenete a TANANYAG-MODELL lett (`buildCurriculum`) a nyers
   * `videos` tömb helyett, és a felirat is a modell közös szövegét használja
   * („X/Y lecke kész"), hogy a listán, a lejátszóban és az adminban definíció
   * szerint ugyanaz a szám álljon. A haladás SZABÁLYAI (orphan ref, nevező)
   * változatlanok — ezt őrzi az alábbi két eset.
   */
  const playerCurriculum = buildCurriculum(
    {
      modules: [],
      videos: [
        { id: VIDEO_REF_1, title: '1. lecke', streamAssetId: ASSET_1, status: 'ready' },
        { id: VIDEO_REF_2, title: '2. lecke', streamAssetId: ASSET_2, status: 'ready' },
      ],
    },
    true,
  )

  it('a lejátszó fejlécében látszik az „X/Y lecke kész", és a kész lecke jelölve van', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: PRODUCT_ID, title: 'Kézrehab alapkurzus' },
        curriculum: playerCurriculum,
        hasAccess: true,
        watchedRefs: [VIDEO_REF_1],
      }),
    )

    expect(html).toContain('1/2 lecke kész')
    // A rail sorai SZÍNTŐL FÜGGETLENÜL is közlik az állapotot (WCAG 1.4.1).
    expect(html).toContain('Befejezve')
    expect(html).toContain('Nem kezdett')
  })

  it('orphan ref a lejátszóban sem torzít (a törölt videóra mutató jelölés nem számít)', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: PRODUCT_ID, title: 'Kézrehab alapkurzus' },
        curriculum: playerCurriculum,
        hasAccess: true,
        watchedRefs: [VIDEO_REF_1, 'mar-torolt-video'],
      }),
    )

    expect(html).toContain('1/2 lecke kész')
    expect(html).not.toContain('2/2')
  })

  /**
   * A KURZUSAIM-LISTA két korábbi őre (haladás-sor a kártyán, illetve lejárt
   * hozzáférésnél a lejárat-üzenet haladás-sor helyett) átköltözött a
   * src/__tests__/course-list-ui.test.ts fájlba. Ok: a lista haladás-forrása a
   * `summarizeCourseProgress` (nyers `videos` tömb) helyett a TANANYAG-MODELL
   * lett (`buildCurriculum` + `summarizeCurriculum`), hogy a listán és a
   * lejátszóban definíció szerint ugyanaz a szám álljon. Az itt maradt blokk a
   * lejátszó felületét őrzi.
   */
})

/**
 * A code review mérte: a handler korábban korlát nélkül olvasta be a teljes
 * törzset (`request.text()`), még a vásárlás-ellenőrzés előtt. A jogos törzs
 * két rövid mező — minden, ami a 4 KiB fölé megy, visszaélés vagy hiba, és
 * 413-mal fordul vissza anélkül, hogy a memóriába kerülne.
 */
describe('POST mark-watched — a törzs méretkorlátja', () => {
  it('a korlát fölötti törzs 413-at kap, és az írásig el sem jut', async () => {
    const { POST, create } = setup()
    const response = await POST(
      makeRequest({
        productId: String(PRODUCT_ID),
        videoRef: VIDEO_REF_1,
        szemet: 'x'.repeat(MAX_BODY_BYTES * 4),
      }),
    )

    expect(response.status).toBe(413)
    expect(await readJson(response)).toEqual({ error: 'A kérés törzse túl nagy.' })
    expect(create).not.toHaveBeenCalled()
  })

  it('a HAZUG content-length fejléc sem véd: a tényleges méret dönt', async () => {
    const { POST, create } = setup()
    const oriasi = JSON.stringify({
      productId: String(PRODUCT_ID),
      videoRef: VIDEO_REF_1,
      szemet: 'x'.repeat(MAX_BODY_BYTES * 4),
    })
    // Az undici a Request-konstruktornál a tényleges törzsből számol, ezért a
    // hamis fejléces esethez kézzel gyártott streamet adunk.
    const request = new Request('http://localhost:3000/api/course-progress/mark-watched', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '10' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oriasi))
          controller.close()
        },
      }),
      // @ts-expect-error -- a duplex az undici stream-body követelménye, a lib
      // típusaiból viszont hiányzik.
      duplex: 'half',
    })
    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(create).not.toHaveBeenCalled()
  })

  it('a normál (rövid) törzs változatlanul 200-at kap', async () => {
    const { POST } = setup()
    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(200)
  })
})
