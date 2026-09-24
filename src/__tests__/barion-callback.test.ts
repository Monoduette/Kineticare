import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'

import { emptyRefundLedger } from './empty-refund-ledger'
import { resetAlertThrottle } from '../lib/alert-throttle'
import { createBarionCallbackProcessor } from '../lib/barion-callback/process-callback'
import { createBarionCallbackHandler } from '../lib/barion-callback/route-handler'
import {
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  type WebhookEventDoc,
  type WebhookEventStore,
} from '../lib/idempotency'
import { onOrderPaid } from '../lib/order-paid'
import {
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
  type CheckRequestRateLimitOptions,
} from '../lib/security/rate-limit'
import type { Order, User } from '../payload-types'

/**
 * P1 — A PAID-MELLÉKHATÁS-LÁNC KÉME.
 *
 * Az `onOrderPaid` (számla-job + visszaigazoló/aktiváló e-mail) a processzor
 * KÖZVETLEN hívása, injektálni nem lehet — ezért a modul mockolt, a valódi
 * lánc pedig kémre cserélt. Két dolgot mérünk vele:
 *  - friss paid-átmenetnél PONTOSAN EGYSZER fut,
 *  - MÁR paid rendelésre érkező (duplikált / késői) callbacknél EGYSZER SEM.
 *
 * A mockolás mellékesen azt is garantálja, hogy a tesztből semmilyen valódi
 * e-mail- vagy job-mellékhatás nem indulhat (CLAUDE.md 15. tanulság).
 */
const orderPaidSpy = vi.hoisted(() => ({
  onOrderPaid: vi.fn<(deps: unknown) => Promise<void>>(async () => {}),
}))

vi.mock('../lib/order-paid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/order-paid')>()
  return { ...actual, onOrderPaid: orderPaidSpy.onOrderPaid }
})

/**
 * T-022 Barion-callback egységtesztek — mockolt fetch-csel (GetState), mockolt
 * Payload local API-val és állapottartó in-memory webhook-events tárhelylyel
 * (az idempotency.test.ts és checkout-start.test.ts mintáját követve).
 *
 * A tesztek a VALÓDI route-handlert + processWebhook státuszgépet + processzort
 * együtt futtatják; az aszinkron ütemező injektált (schedule-capture), így a
 * feldolgozás determinisztikusan, a HTTP-válasz után indítható.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'

const PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const ORDER_NUMBER = 'KH-2026-000123'
/**
 * A rendelés szerver-oldali végösszege. Az S2 összeg-assert miatt a
 * GetState-válasz Total/Currency mezőjének EGYEZNIE kell ezzel — enélkül a
 * paid-átmenet elutasított.
 */
const ORDER_TOTAL_HUF = 19990

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of ['BARION_API_URL', 'BARION_PAYEE_EMAIL', 'BARION_POSKEY_TEST']) {
    savedEnv[key] = process.env[key]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
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

afterEach(() => {
  fetchMock.mockReset()
  vi.restoreAllMocks()
  // A kém hívás-naplója NEM szivároghat át a következő tesztre, és a
  // restoreAllMocks után is működő (Promise-t adó) implementációval kell állnia.
  orderPaidSpy.onOrderPaid.mockReset()
  orderPaidSpy.onOrderPaid.mockImplementation(async () => {})
  // A riasztás-fojtás folyamat-szintű állapota nem szivároghat át tesztek között.
  resetAlertThrottle()
})

/** Állapottartó in-memory webhook-events tárhely (unique-kényszerrel) — idempotency.test.ts minta. */
function createWebhookStore(initial: WebhookEventDoc[] = []) {
  const docs = [...initial]
  let nextId = docs.length + 1

  const store: WebhookEventStore = {
    find: async ({ where }) => {
      const json = JSON.stringify(where ?? {})
      const provider = json.includes('"barion"') ? 'barion' : undefined
      const externalMatch = /"externalId":\{"equals":"([^"]+)"\}/.exec(json)
      const matched = docs.filter(
        (doc) =>
          (provider === undefined || doc.provider === provider) &&
          (!externalMatch || doc.externalId === externalMatch[1]),
      )
      return { docs: matched, totalDocs: matched.length }
    },
    create: async ({ data }) => {
      const duplicate = docs.some(
        (doc) => doc.provider === data.provider && doc.externalId === data.externalId,
      )
      if (duplicate) {
        const error = new Error(
          'duplicate key value violates unique constraint "webhook_events_provider_external_id"',
        ) as Error & { code: string }
        error.code = '23505'
        throw error
      }
      const doc: WebhookEventDoc = {
        id: nextId++,
        provider: data.provider as WebhookEventDoc['provider'],
        externalId: data.externalId as string,
        status: (data.status as WebhookEventDoc['status']) ?? 'received',
        attempts: (data.attempts as number) ?? 0,
        payload: data.payload,
        requestId: data.requestId as string | undefined,
      }
      docs.push(doc)
      return doc
    },
    update: async ({ id, data }) => {
      const doc = docs.find((candidate) => candidate.id === id)
      if (!doc) throw new Error(`nincs ilyen rekord: ${id}`)
      Object.assign(doc, data)
      return doc
    },
  }

  return { store, docs }
}

interface OrderFixture {
  status?: Order['status']
  barionPaymentId?: string | null
  customer?: number
  productIds?: number[]
  totalHufSnapshot?: number | null
}

function createOrder(fixture: OrderFixture = {}): Order {
  return {
    id: 101,
    orderNumber: ORDER_NUMBER,
    status: fixture.status ?? 'payment_pending',
    barionPaymentId: fixture.barionPaymentId === undefined ? PAYMENT_ID : fixture.barionPaymentId,
    customer: fixture.customer ?? 7,
    currency: 'HUF',
    totalHufSnapshot:
      fixture.totalHufSnapshot === undefined ? ORDER_TOTAL_HUF : fixture.totalHufSnapshot,
    items: (fixture.productIds ?? [42]).map((productId) => ({
      product: productId,
      quantity: 1,
    })),
  } as unknown as Order
}

function createUser(purchases: number[] = []): User {
  return { id: 7, email: 'vevo@example.test', purchases } as unknown as User
}

interface MockPayloadOptions {
  order?: Order | null
  user?: User
  /**
   * Ha true, bármely `barionPaymentId`-lekérdezés találatot ad — az „ismert
   * PaymentId korlátlan” tesztnek kell, hogy 20+ KÜLÖNBÖZŐ GUID is ismert legyen.
   */
  anyPaymentIdKnown?: boolean
}

function createMockPayload(options: MockPayloadOptions = {}) {
  const order = options.order === undefined ? createOrder() : options.order
  const user = options.user ?? createUser()
  const calls = {
    update: [] as Array<{ collection: string; id: number | string; data: Record<string, unknown> }>,
  }
  const payload = {
    db: { drizzle: emptyRefundLedger(order ? [order.id] : []) },
    find: vi.fn(async ({ where }: { collection: string; where?: unknown }) => {
      const json = JSON.stringify(where ?? {})
      if (!order) return { docs: [], totalDocs: 0 }
      if (json.includes('barionPaymentId')) {
        if (options.anyPaymentIdKnown) {
          return { docs: [order], totalDocs: 1 }
        }
        return order.barionPaymentId && json.includes(String(order.barionPaymentId))
          ? { docs: [order], totalDocs: 1 }
          : { docs: [], totalDocs: 0 }
      }
      if (json.includes('orderNumber')) {
        return order.orderNumber && json.includes(String(order.orderNumber))
          ? { docs: [order], totalDocs: 1 }
          : { docs: [], totalDocs: 0 }
      }
      return { docs: [], totalDocs: 0 }
    }),
    findByID: vi.fn(async ({ collection }: { collection: string }) => {
      // Az M5 zár a záron belül findByID-val OLVASSA ÚJRA a rendelést.
      if (collection === 'orders') {
        if (!order) {
          throw new Error('teszthiba: a rendelés-fixtúra null — ide nem futhat az átmenet')
        }
        return order
      }
      return user
    }),
    update: vi.fn(
      async (args: { collection: string; id: number | string; data: Record<string, unknown> }) => {
        calls.update.push(args)
        if (args.collection === 'orders' && order) {
          Object.assign(order, args.data)
        }
        if (args.collection === 'users') {
          Object.assign(user, args.data)
        }
        return args.data
      },
    ),
  }
  return { payload: payload as unknown as Payload, calls, order, user }
}

interface StateOverrides {
  paymentId?: string
  /** null = a mező teljesen hiányzik a válaszból (S2 összeg-assert bukása). */
  total?: number | null
  currency?: string | null
}

/** GetState-válasz a Bariontól (alapból a rendelés összegével/devizájával). */
function getStateResponse(status: string, overrides: StateOverrides = {}): Response {
  const { paymentId = PAYMENT_ID, total = ORDER_TOTAL_HUF, currency = 'HUF' } = overrides
  return new Response(
    JSON.stringify({
      PaymentId: paymentId,
      PaymentRequestId: ORDER_NUMBER,
      Status: status,
      ...(total === null ? {} : { Total: total }),
      ...(currency === null ? {} : { Currency: currency }),
      Transactions: [],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function barionProviderError(): Response {
  return new Response(
    JSON.stringify({
      Errors: [
        {
          ErrorCode: 'PaymentNotFound',
          Title: 'Payment not found',
          Description: 'There is no payment with this ID.',
        },
      ],
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Injektált aszinkron-ütemező: a taskot elkapja, a teszt indítja kézzel. */
function createScheduleCapture() {
  const tasks: Array<() => Promise<void>> = []
  return {
    tasks,
    schedule: (task: () => Promise<void>) => {
      tasks.push(task)
    },
    runAll: async () => {
      for (const task of tasks.splice(0)) {
        await task()
      }
    },
  }
}

const CALLBACK_URL = 'https://shop.example.test/api/barion/callback'

/** JSON-törzses kézbesítés (TARTALÉK csatorna — a Barion ma nem ilyet küld). */
function makeRequest(body: unknown, options: { ip?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.ip) {
    headers['x-forwarded-for'] = options.ip
  }
  return new Request(CALLBACK_URL, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/**
 * A VALÓDI Barion-kézbesítés alakja: a PaymentId a QUERY STRINGBEN érkezik
 * (`CallbackUrl?paymentId=<guid>`), a POST-törzs pedig ÜRES.
 */
function makeBarionRequest(
  paymentId: string,
  options: { queryKey?: 'paymentId' | 'PaymentId'; body?: string; ip?: string } = {},
): Request {
  const url = `${CALLBACK_URL}?${options.queryKey ?? 'paymentId'}=${encodeURIComponent(paymentId)}`
  const headers = new Headers()
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip)
  }
  return new Request(url, {
    method: 'POST',
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  })
}

/** Törzs és query nélküli POST — a Barion-callback „csupasz" változata. */
function makeEmptyRequest(): Request {
  return new Request(CALLBACK_URL, { method: 'POST' })
}

interface SetupOptions extends MockPayloadOptions {
  rateLimit?: CheckRequestRateLimitOptions
  initialEvents?: WebhookEventDoc[]
}

function setup(options: SetupOptions = {}) {
  const { store, docs } = createWebhookStore(options.initialEvents)
  const { payload, calls, order, user } = createMockPayload(options)
  const capture = createScheduleCapture()
  // Saját limiter: a tesztek ne a folyamat-alapértelmezett Map-et osszák.
  const rateLimit = options.rateLimit ?? { limiter: new SlidingWindowRateLimiter() }
  const POST = createBarionCallbackHandler({
    getPayload: async () => payload,
    schedule: capture.schedule,
    store,
    rateLimit,
  })
  return { POST, store, docs, payload, calls, order, user, capture, rateLimit }
}

/** Determinisztikus, alakilag érvényes GUID a W12 unknown-zápor tesztekhez. */
function guidFromIndex(index: number): string {
  const hex = index.toString(16).padStart(12, '0')
  return `aaaaaaaa-bbbb-cccc-dddd-${hex}`
}

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

describe('POST /api/barion/callback — bemenet-ellenőrzés', () => {
  it('hiányzó PaymentId → 400, naplózva', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs } = setup()

    const response = await POST(makeRequest({ Foo: 'bar' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false })
    expect(docs).toHaveLength(0)
    expect(logOutput(logSpy)).toContain('PaymentId')
  })

  it('üres PaymentId → 400', async () => {
    const { POST } = setup()
    const response = await POST(makeRequest({ PaymentId: '   ' }))
    expect(response.status).toBe(400)
  })

  it('nem JSON törzs → 400', async () => {
    const { POST } = setup()
    const response = await POST(makeRequest('ez nem json {'))
    expect(response.status).toBe(400)
  })

  it('SEC-008: a méret-plafont túllépő törzs elutasítva, akkor is, ha érvényes GUID van benne', async () => {
    const { POST, docs, capture } = setup()

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID, pad: 'x'.repeat(20_000) }))

    expect(response.status).toBe(400)
    expect(docs).toHaveLength(0)
    expect(capture.tasks).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a JSON-törzs tartalék-csatorna a méreten belül továbbra is működik', async () => {
    const { POST, docs } = setup()

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    expect(docs).toHaveLength(1)
  })

  /**
   * Az útvonal-osztályozó a callbacket szándékosan kihagyja (a fizetési
   * értesítés elvesztése pénzt jelent). Alak-ellenőrzés nélkül minden hívás
   * EGY webhook-events sort írna és EGY kimenő Barion GetState-hívást
   * indítana — ezért a nem GUID-alakú PaymentId már a dedup-írás ELŐTT elakad.
   * Az alakilag helyes, de ismeretlen GUID-ot a handler IP-kerete fogja (W12).
   */
  it('szemét (nem GUID) PaymentId → 400, DB-írás és ütemezés NÉLKÜL', async () => {
    const { POST, docs, capture } = setup()

    for (const garbage of [
      'nem-egy-guid',
      '../../etc/passwd',
      '11111111-2222-3333-4444-55555555555',
      '11111111-2222-3333-4444-5555555555555',
      // Kötőjel nélküli alak, de nem 32 hex (a 32 hexes alak ÉRVÉNYES, lásd lent).
      '1111111122223333444455555555555',
      '111111112222333344445555555555555',
      '1111111122223333444455555555555g',
      '11111111-2222-3333-4444-55555555555g',
      '<script>alert(1)</script>',
    ]) {
      const response = await POST(makeRequest({ PaymentId: garbage }))
      expect(response.status, garbage).toBe(400)
    }

    expect(docs).toHaveLength(0)
    expect(capture.tasks).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a hossz-plafon a mintaillesztés előtt fog (nagy törzs sem jut a DB-ig)', async () => {
    const { POST, docs } = setup()

    const response = await POST(makeRequest({ PaymentId: 'a'.repeat(100_000) }))

    expect(response.status).toBe(400)
    expect(docs).toHaveLength(0)
  })

  it('érvényes GUID átmegy (kis- és nagybetűs hex is) — a tárolt alak KANONIKUS kisbetűs', async () => {
    for (const validId of [PAYMENT_ID, '0A1B2C3D-4E5F-6789-ABCD-EF0123456789']) {
      const { POST, docs } = setup()

      const response = await POST(makeRequest({ PaymentId: validId }))

      expect(response.status, validId).toBe(200)
      expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
      expect(docs).toHaveLength(1)
      // A kis-nagybetűs alias nem nyithat két eseményt ugyanarra a fizetésre
      // (dedup, advisory-zár, orders-lookup) — lásd a (b2) csoportot.
      expect(docs[0]?.externalId).toBe(validId.toLowerCase())
    }
  })
})

/**
 * B1 — A BLOKKOLÓ, AMIT EZ A CSOPORT BIZONYÍT.
 *
 * A Barion a callbacket `CallbackUrl?paymentId=<guid>` alakban, ÜRES POST-
 * törzzsel küldi. A korábbi kód `await request.json()`-nel indult: üres törzsön
 * ez DOB, tehát MINDEN valódi callback 400-at kapott, a rendelés pedig sosem
 * zárult le a callback-úton. Az alábbi tesztek a RÉGI kódon megbuknának.
 */
describe('B1 — a PaymentId a QUERY STRINGBŐL is feloldódik (valódi Barion-alak)', () => {
  it('query stringes paymentId + ÜRES törzs → 200 accepted, és a fizetés le is zárul', async () => {
    const { POST, docs, order, user, capture } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    const response = await POST(makeBarionRequest(PAYMENT_ID))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    expect(docs).toHaveLength(1)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)

    await capture.runAll()

    expect(order?.status).toBe('paid')
    expect(user.purchases).toEqual([42])
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
  })

  it('a Barion kötőjel nélküli (32 hex) azonosítója: elfogadva, kanonikus alakban rögzül, a fizetés lezárul', async () => {
    const { POST, docs, order, user, capture } = setup()
    const compact = PAYMENT_ID.replace(/-/g, '')
    // A GetState is a kötőjel nélküli alakot adja vissza (docs.barion.com v4 példája).
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded', { paymentId: compact }))

    const response = await POST(makeBarionRequest(compact.toUpperCase()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    // A dedup-kulcs a kanonikus alak: ugyanaz, mint a kötőjeles kézbesítésé.
    expect(docs).toHaveLength(1)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)

    await capture.runAll()

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://api.test.barion.com/v4/Payment/${compact}/PaymentState`,
    )
    // A tárolt (kötőjeles) barionPaymentId-vel nincs hamis ütközés: a rendelés fizetett.
    expect(order?.status).toBe('paid')
    expect(user.purchases).toEqual([42])
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
  })

  it('ugyanaz a fizetés kötőjellel és anélkül: EGY esemény (dedup alaktól függetlenül)', async () => {
    const { POST, docs } = setup()

    const first = await POST(makeBarionRequest(PAYMENT_ID))
    const second = await POST(makeBarionRequest(PAYMENT_ID.replace(/-/g, '')))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)
  })

  it('a nagybetűs query-kulcs (PaymentId) is elfogadott', async () => {
    const { POST, docs } = setup()

    const response = await POST(makeBarionRequest(PAYMENT_ID, { queryKey: 'PaymentId' }))

    expect(response.status).toBe(200)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)
  })

  it('a NEM JSON törzs önmagában NEM hiba, ha a query-ben megvan az azonosító', async () => {
    const { POST, docs } = setup()

    const response = await POST(makeBarionRequest(PAYMENT_ID, { body: 'ez nem json {' }))

    expect(response.status).toBe(200)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)
  })

  it('a query ELSŐDLEGES: eltérő törzs mellett is a query-beli azonosító rögzül', async () => {
    const { POST, docs } = setup()
    const otherId = '99999999-8888-7777-6666-555555555555'

    const response = await POST(
      makeBarionRequest(PAYMENT_ID, { body: JSON.stringify({ PaymentId: otherId }) }),
    )

    expect(response.status).toBe(200)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)
  })

  it('sem query, sem törzs → 400, DB-írás és ütemezés nélkül', async () => {
    const { POST, docs, capture } = setup()

    const response = await POST(makeEmptyRequest())

    expect(response.status).toBe(400)
    expect(docs).toHaveLength(0)
    expect(capture.tasks).toHaveLength(0)
  })

  it('nem GUID-alakú query-paraméter → 400, DB-írás és kimenő hívás nélkül', async () => {
    const { POST, docs, capture } = setup()

    for (const garbage of ['nem-egy-guid', '../../etc/passwd', 'a'.repeat(100_000)]) {
      const response = await POST(makeBarionRequest(garbage))
      expect(response.status, garbage).toBe(400)
    }

    expect(docs).toHaveLength(0)
    expect(capture.tasks).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a napló megmondja, MELYIK forrásból jött az azonosító (éles próbavásárlás bizonyítéka)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST } = setup()

    await POST(makeBarionRequest(PAYMENT_ID))
    expect(logOutput(logSpy)).toContain('query')

    logSpy.mockClear()
    const { POST: POST2 } = setup()
    await POST2(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(logOutput(logSpy)).toContain('body')
  })
})

describe('(h) aszinkron viselkedés — a 200 NEM vár a GetState-re', () => {
  it('a handler azonnal 200-zal válaszol, miközben a GetState még függőben van', async () => {
    const { POST, capture, docs } = setup()
    // A fetch SZÁNDÉKOSAN sosem resolve-olódik a válasz előtt.
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}))

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    // A válasz pillanatában a GetState MÉG nem hívódott meg — a feldolgozás aszinkron.
    expect(fetchMock).not.toHaveBeenCalled()
    // A dedup-rekord viszont már létezik (azonnal rögzítve).
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      provider: 'barion',
      externalId: PAYMENT_ID,
      status: 'received',
    })
    // A nyers body nincs tárolva — csak a strukturált paymentId.
    expect(docs[0].payload).toEqual({ paymentId: PAYMENT_ID })

    // Az aszinkron task el van kapva; a teszt eldobja (a fetch sosem tér vissza).
    expect(capture.tasks).toHaveLength(1)
    capture.tasks.length = 0
  })
})

describe('(a) boldog út — paid', () => {
  it('GetState Succeeded → rendelés paid + purchases + processedAt/result', async () => {
    const { POST, docs, calls, order, user, capture } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(response.status).toBe(200)
    await capture.runAll()

    // GetState a v4-es útvonalon, szerver-szerver, KÖTŐJEL NÉLKÜLI azonosítóval
    // (kötőjelesre a Barion 404-et ad; lib/barion/guid.ts).
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toBe(
      `https://api.test.barion.com/v4/Payment/${PAYMENT_ID.replace(/-/g, '')}/PaymentState`,
    )

    // Rendelés: payment_pending → paid (pontosan egy átmenet).
    const orderUpdates = calls.update.filter((call) => call.collection === 'orders')
    expect(orderUpdates).toHaveLength(1)
    expect(orderUpdates[0]?.data.status).toBe('paid')
    expect(order?.status).toBe('paid')

    // A membership és az eredetóra külön, egyszeri írás; nem dupla grant.
    const userUpdates = calls.update.filter((call) => call.collection === 'users')
    expect(userUpdates).toHaveLength(2)
    const purchaseWrites = userUpdates.filter((call) => Object.hasOwn(call.data, 'purchases'))
    const originWrites = userUpdates.filter((call) => Object.hasOwn(call.data, 'accessGrants'))
    expect(purchaseWrites).toHaveLength(1)
    expect(purchaseWrites[0]?.data.purchases).toEqual([42])
    expect(originWrites).toHaveLength(1)
    expect(originWrites[0]?.data.accessGrants).toEqual([
      { product: 42, sourceKind: 'order', sourceOrder: 101, grantedAt: expect.any(String) },
    ])
    expect(user.purchases).toEqual([42])
    expect(user.accessGrants).toEqual(originWrites[0]?.data.accessGrants)

    // Webhook-events: processed + processedAt + result='paid'.
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid', attempts: 1 })
    expect(typeof docs[0]?.processedAt).toBe('string')

    // POZITÍV KONTROLL a mellékhatás-lánc kéméhez: friss paid-átmenetnél az
    // onOrderPaid PONTOSAN EGYSZER fut (enélkül a lentebbi „nem hívódott"
    // állítások vakon is teljesülnének).
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
    expect(orderPaidSpy.onOrderPaid.mock.calls[0]?.[0]).toMatchObject({
      order: expect.objectContaining({ id: 101 }),
    })
  })

  /**
   * VAKTESZT-VÉDELEM: ha a modul-mock elcsúszna (átnevezett fájl, elrontott
   * factory), a kém sosem kapna hívást — és MINDEN „nem hívódott" állítás
   * vakon teljesülne. Ez a sor köti a kémet a valódi modul-exporthoz.
   */
  it('a kém tényleg a `../lib/order-paid` modul-exportjára van kötve', () => {
    expect(onOrderPaid).toBe(orderPaidSpy.onOrderPaid)
  })
})

describe('(b) duplikált callback — EXACTLY ONCE', () => {
  it('második azonos PaymentId → 200 no-op; egy paid átmenet, egy purchases bejegyzés, egy GetState', async () => {
    const { POST, docs, calls, order, user, capture } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const first = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(first.status).toBe(200)
    await capture.runAll()

    const second = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, status: 'duplicate' })
    await capture.runAll()

    // EGY GetState-hívás, EGY paid átmenet, EGY purchases-írás, EGY webhook-rekord.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(1)
    const userWrites = calls.update.filter((call) => call.collection === 'users')
    expect(userWrites).toHaveLength(2)
    expect(userWrites.filter((call) => Object.hasOwn(call.data, 'purchases'))).toHaveLength(1)
    expect(userWrites.filter((call) => Object.hasOwn(call.data, 'accessGrants'))).toHaveLength(1)
    expect(user.accessGrants).toEqual([
      { product: 42, sourceKind: 'order', sourceOrder: 101, grantedAt: expect.any(String) },
    ])
    expect(order?.status).toBe('paid')
    expect(user.purchases).toEqual([42])
    expect(docs).toHaveLength(1)
    // A MELLÉKHATÁS-LÁNC is pontosan egyszer futott: nincs második számla-job
    // és nincs második visszaigazoló levél.
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
  })

  it('feldolgozás alatt érkező ismétlés (received) → 200, újabb ütemezés nélkül', async () => {
    const { POST, capture } = setup()
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))

    const first = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    const second = await POST(makeRequest({ PaymentId: PAYMENT_ID }))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, status: 'received' })
    // Csak az első kézbesítés ütemezett feldolgozást.
    expect(capture.tasks).toHaveLength(1)
    capture.tasks.length = 0
  })

  /**
   * P1 — A MELLÉKHATÁS-LÁNC ISMÉTLŐDÉS-VÉDELME.
   *
   * A már kifizetett rendelésre érkező (késői vagy más PaymentId-vel újra
   * kézbesített) callbackre az állapotgép `{ action: 'paid', duplicate: true,
   * transitionedToPaid: false }`-t ad. A processzor CSAK a `transitionedToPaid`
   * jelzőre futtathatja az onOrderPaid-et.
   *
   * MI A TÉT, ha mégis lefutna: ismételt visszaigazoló levél, ismételt
   * számla-job, vendégnél pedig ÚJ jelszó-beállító token
   * (`payload.forgotPassword`) — amitől a korábban kiküldött, még fel nem
   * használt aktiváló link ÉRVÉNYTELENNÉ válna, és a vevő kizárhatná magát a
   * kifizetett kurzusából.
   *
   * A DB-írások hiánya ezt NEM méri (az átmenet amúgy sem ír), ezért az őr a
   * mellékhatás-lánc kémjén áll.
   */
  it('már paid rendelésre érkező callback: átmenet no-op, és a mellékhatás-lánc SEM indul újra', async () => {
    const { POST, calls, order, user, capture } = setup({
      order: createOrder({ status: 'paid' }),
      user: createUser([42]),
    })
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(response.status).toBe(200)
    await capture.runAll()

    // Nincs státusz-átmenet és nincs purchases-írás (már mindkettő megvan).
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(0)
    expect(calls.update.filter((call) => call.collection === 'users')).toHaveLength(0)
    expect(order?.status).toBe('paid')
    expect(user.purchases).toEqual([42])

    // ÉS a mellékhatás-lánc egyszer sem indult el: se számla-job, se levél,
    // se új jelszó-beállító token.
    expect(orderPaidSpy.onOrderPaid).not.toHaveBeenCalled()
  })
})

describe('(b2) PaymentId-kanonizálás — a kis-nagybetűs alias nem kettőzi a fizetést', () => {
  /**
   * A Barion GUID kis-nagybetű-érzéketlen, a Postgres `equals` és a
   * (provider, externalId) unique kulcs viszont érzékeny. Kanonizálás nélkül a
   * NAGYBETŰS kézbesítés a kisbetűs rekord MELLÉ új eseményt nyitna: a dedup
   * nem fogná meg, az advisory-zár kulcsa szétválna, az orders-lookup nem
   * találná a rendelést, az orderNumber-fallback pedig hamis
   * `payment-id-conflict`-tal terminálisan elutasítaná az ÉRVÉNYES fizetést.
   */
  it('nagybetűs GUID a queryben → kisbetűs kanonikus externalId, a rendelés ismert, a fizetés lezárul', async () => {
    const { POST, docs, order, capture } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    const response = await POST(makeBarionRequest(PAYMENT_ID.toUpperCase()))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    await capture.runAll()

    expect(docs).toHaveLength(1)
    expect(docs[0]?.externalId).toBe(PAYMENT_ID)
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
    expect(order?.status).toBe('paid')
  })

  it('kisbetűs első + NAGYBETŰS második kézbesítés → duplikátum, nem második állapotgép', async () => {
    const { POST, docs, capture } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const first = await POST(makeBarionRequest(PAYMENT_ID))
    expect(first.status).toBe(200)
    await capture.runAll()

    const second = await POST(makeBarionRequest(PAYMENT_ID.toUpperCase()))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, status: 'duplicate' })

    // EGY rekord, EGY GetState — az alias nem nyitott második eseményt.
    expect(docs).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a processzor a KORÁBBAN (kanonizálás előtt) tárolt nagybetűs externalId-t is kanonizálja — nincs hamis payment-id-conflict', async () => {
    // Örökölt rekord: nagybetűs externalId, ahogy a kanonizálás előtti route
    // eltárolhatta. A rendelés barionPaymentId-je a kisbetűs alak.
    const legacyEvent: WebhookEventDoc = {
      id: 1,
      provider: 'barion',
      externalId: PAYMENT_ID.toUpperCase(),
      status: 'failed',
      attempts: 1,
    }
    const { store, docs } = createWebhookStore([legacyEvent])
    const { payload, order } = createMockPayload({})
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    const outcome = await processWebhook({
      store,
      provider: 'barion',
      externalId: legacyEvent.externalId,
      handler: createBarionCallbackProcessor({ payload, store }),
    })

    expect(outcome.kind).toBe('processed')
    // NEM 'rejected' (payment-id-conflict): a kanonizált lookup megtalálta a
    // rendelést a kisbetűs barionPaymentId-vel, és a fizetés paid-re zárult.
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
    expect(order?.status).toBe('paid')
  })
})

describe('(b3) elutasított eseményre érkező duplikált kézbesítés — felszínre hozás', () => {
  it('terminálisan rejected esemény ismételt kézbesítése → 200 duplicate, de WARN-szintű napló (nem néma info)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const rejectedEvent: WebhookEventDoc = {
      id: 1,
      provider: 'barion',
      externalId: PAYMENT_ID,
      status: 'processed',
      result: 'rejected',
      processedAt: new Date().toISOString(),
      attempts: 1,
    }
    const { POST, capture } = setup({ initialEvents: [rejectedEvent] })

    const response = await POST(makeBarionRequest(PAYMENT_ID))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'duplicate' })
    // Nincs újrafeldolgozás (terminális) — de a napló felszínre hozza, hogy egy
    // ELUTASÍTOTT (alias-/párosítási konfliktus vagy kézi ellenőrzés mögötti)
    // fizetésre még mindig érkezik callback.
    expect(capture.tasks).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logOutput(logSpy)).toContain('ELUTASÍTOTT')
  })

  it('terminálisan PAID esemény ismételt kézbesítése továbbra is csendes info-duplikátum', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const paidEvent: WebhookEventDoc = {
      id: 1,
      provider: 'barion',
      externalId: PAYMENT_ID,
      status: 'processed',
      result: 'paid',
      processedAt: new Date().toISOString(),
      attempts: 1,
    }
    const { POST } = setup({ initialEvents: [paidEvent] })

    const response = await POST(makeBarionRequest(PAYMENT_ID))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'duplicate' })
    expect(logOutput(logSpy)).not.toContain('ELUTASÍTOTT')
  })
})

describe('(c) cancelled — Canceled és Expired', () => {
  it.each([['Canceled'], ['Expired']])(
    '%s → payment_pending rendelés cancelled lesz',
    async (barionStatus) => {
      const { POST, docs, order, capture } = setup()
      fetchMock.mockResolvedValueOnce(getStateResponse(barionStatus))

      const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
      expect(response.status).toBe(200)
      await capture.runAll()

      expect(order?.status).toBe('cancelled')
      expect(docs[0]).toMatchObject({ status: 'processed', result: 'cancelled' })
    },
  )
})

describe('(d) függő státusz — Prepared/Started', () => {
  it.each([['Prepared'], ['Started']])(
    '%s → a rendelés payment_pending marad, repoll-jelzéssel',
    async (barionStatus) => {
      const { POST, docs, order, calls, capture } = setup()
      fetchMock.mockResolvedValueOnce(getStateResponse(barionStatus))

      const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
      expect(response.status).toBe(200)
      await capture.runAll()

      // Státusz VÁLTOZATLAN, purchases-beírás NINCS — a poll-job (külön ticket) dolgozza fel.
      expect(order?.status).toBe('payment_pending')
      expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(0)
      expect(calls.update.filter((call) => call.collection === 'users')).toHaveLength(0)
      // B4: a függő kimenetel NEM VÉGLEGES — a rekord újrafeldolgozható marad
      // (received + üres processedAt), különben a később érkező végleges státusz
      // duplikátumként veszne el.
      expect(docs[0]).toMatchObject({ status: 'received', result: 'pending_repoll' })
      expect(docs[0]?.processedAt ?? null).toBeNull()
    },
  )
})

/**
 * B4 — A BLOKKOLÓ, AMIT EZ A CSOPORT BIZONYÍT.
 *
 * A Barion MINDEN státuszváltásra UGYANAZZAL a PaymentId-vel küld callbacket.
 * Amíg a függő (Prepared/Started) kimenetel `processed`-re zárta az eseményt, a
 * dedup a KÖVETKEZŐ — épp a `Succeeded` — kézbesítést duplikátumként dobta el:
 * a rendelés sosem lett paid a callback-úton. A RÉGI kódon ez a csoport
 * megbukna (a második POST 'duplicate'-et adna, a rendelés payment_pending
 * maradna).
 */
describe('B4 — függő callback UTÁN a végleges callback is feldolgozódik', () => {
  it('#1 Prepared → #2 Succeeded (azonos PaymentId) → a rendelés paid lesz', async () => {
    const { POST, docs, order, user, capture } = setup()

    fetchMock.mockResolvedValueOnce(getStateResponse('Prepared'))
    const first = await POST(makeBarionRequest(PAYMENT_ID))
    expect(first.status).toBe(200)
    await capture.runAll()

    expect(order?.status).toBe('payment_pending')
    expect(docs[0]).toMatchObject({ status: 'received', result: 'pending_repoll', attempts: 1 })

    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))
    const second = await POST(makeBarionRequest(PAYMENT_ID))
    expect(second.status).toBe(200)
    // A rekord létezik, de NEM véglegesen lezárt → újrafeldolgozás indul.
    expect(await second.json()).toEqual({ ok: true, status: 'received' })
    await capture.runAll()

    expect(order?.status).toBe('paid')
    expect(user.purchases).toEqual([42])
    // Egyetlen webhook-rekord, most már VÉGLEGESEN lezárva.
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid', attempts: 2 })
    expect(typeof docs[0]?.processedAt).toBe('string')
  })

  it('a webhook-retry (processWebhook) is újra feldolgozza a függő eseményt — NEM already-processed', async () => {
    const { POST, docs, order, capture, store, payload } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse('Started'))

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()
    expect(docs[0]).toMatchObject({ status: 'received', result: 'pending_repoll' })

    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))
    const retry = await processWebhook({
      store,
      provider: 'barion',
      externalId: PAYMENT_ID,
      handler: createBarionCallbackProcessor({ payload, store }),
    })

    expect(retry.kind).toBe('processed')
    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
  })

  it('a TERMINÁLIS lezárás (paid) után a következő kézbesítés változatlanul duplikátum', async () => {
    const { POST, calls, capture } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    const second = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await second.json()).toEqual({ ok: true, status: 'duplicate' })
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(1)
  })
})

describe('(e) hamis/ismeretlen PaymentId — M6 terminális elutasítás', () => {
  it('400 + PaymentNotFound provider-hiba → TERMINÁLIS rejected (processedAt beírva), a retry NEM viszi újra', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs, capture, store, payload } = setup({ order: null })
    fetchMock.mockResolvedValueOnce(barionProviderError())

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    // A handler MÁR 200-at adott (a Barion retry-ja nem pörög feleslegesen).
    expect(response.status).toBe(200)

    await capture.runAll()

    // TERMINÁLIS lezárás: a processWebhook processed-re állította, result='rejected',
    // a processedAt beíródott — az esemény NEM újrapróbálható.
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'rejected', attempts: 1 })
    expect(typeof docs[0]?.processedAt).toBe('string')
    const logs = logOutput(logSpy)
    expect(logs).toContain('RIASZTÁS')
    expect(logs).toContain('terminálisan elutasítva')

    // Amit a webhook-retry tenne: semmit — a processed esemény no-op.
    const retry = await processWebhook({
      store,
      provider: 'barion',
      externalId: PAYMENT_ID,
      handler: createBarionCallbackProcessor({ payload, store }),
    })
    expect(retry.kind).toBe('already-processed')
    // Nem indult újabb kimenő Barion-hívás sem.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 404 + PaymentNotFound → szintén TERMINÁLIS rejected (hamis GUID = 1 hívás + 1 riasztás)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs, capture } = setup({ order: null })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Errors: [{ ErrorCode: 'PaymentNotFound', Title: 'DUMMY', Description: 'DUMMY' }],
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(response.status).toBe(200)
    await capture.runAll()

    expect(docs[0]).toMatchObject({ status: 'processed', result: 'rejected' })
    expect(typeof docs[0]?.processedAt).toBe('string')
    expect(logOutput(logSpy)).toContain('RIASZTÁS')
  })

  /**
   * fix-404 (H0): a NotExistingPaymentId a Barion egyetlen DOKUMENTÁLT
   * „ismeretlen fizetés" kódja (Error_codes_notifications; a go-barion
   * GetPaymentState-fixtúrája is ezt adja). Eddig csak a repo saját
   * PaymentNotFound-ja volt definitív, így ez a válasz sosem zárt: a
   * webhook-retry 404-nél minden percben újrahívta a Bariont, amíg ki nem merült.
   */
  it.each([404, 400, 200])(
    'HTTP %i + NotExistingPaymentId → TERMINÁLIS rejected, a rendelés érintetlen, a retry NEM viszi újra',
    async (httpStatus) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { POST, docs, capture, store, payload, order } = setup()
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Errors: [
              {
                ErrorCode: 'NotExistingPaymentId',
                Title: 'DUMMY The given payment id is invalid',
                Description: 'DUMMY',
              },
            ],
          }),
          { status: httpStatus, headers: { 'Content-Type': 'application/json' } },
        ),
      )

      const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
      expect(response.status).toBe(200)
      await capture.runAll()

      expect(docs[0]).toMatchObject({ status: 'processed', result: 'rejected', attempts: 1 })
      expect(typeof docs[0]?.processedAt).toBe('string')
      expect(order?.status).toBe('payment_pending')
      const logs = logOutput(logSpy)
      expect(logs).toContain('RIASZTÁS')
      expect(logs).toContain('terminálisan elutasítva')

      const retry = await processWebhook({
        store,
        provider: 'barion',
        externalId: PAYMENT_ID,
        handler: createBarionCallbackProcessor({ payload, store }),
      })
      expect(retry.kind).toBe('already-processed')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  /**
   * Cáfolható állítás (a-callback-5 / r-barion-11): a puszta 404 (útvonal-
   * eltérés: „No HTTP resource was found…", Errors tömb nélkül) eddig
   * terminálisan elutasította az eseményt, így a fizetett rendelés későbbi
   * Succeeded callbackjét a dedup eldobta. Most újrapróbálható + riasztás.
   */
  it.each([
    [
      'Errors tömb nélkül',
      JSON.stringify({ Message: 'No HTTP resource was found that matches the request URI' }),
    ],
    ['üres Errors tömbbel', JSON.stringify({ Errors: [] })],
    ['közbülső proxy HTML-oldalával', '<html><body>404 Not Found</body></html>'],
  ])(
    'puszta HTTP 404 (%s) → NEM terminális: failed + processedAt NULL + RIASZTÁS, a retry sikerül',
    async (_label, body) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { POST, docs, capture, store, payload, order } = setup()
      fetchMock.mockResolvedValueOnce(
        new Response(body, {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
      expect(response.status).toBe(200)
      await capture.runAll()

      expect(docs[0]).toMatchObject({ status: 'failed', result: 'failed', attempts: 1 })
      expect(docs[0]?.processedAt ?? null).toBeNull()
      expect(order?.status).toBe('payment_pending')
      const logs = logOutput(logSpy)
      expect(logs).toContain('RIASZTÁS')
      expect(logs).toContain('HTTP 404')

      // Az útvonal helyreállása után a retry-job ugyanezt az eseményt paid-re viszi.
      fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))
      const retry = await processWebhook({
        store,
        provider: 'barion',
        externalId: PAYMENT_ID,
        handler: createBarionCallbackProcessor({ payload, store }),
      })
      expect(retry.kind).toBe('processed')
      expect(order?.status).toBe('paid')
      expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid', attempts: 2 })
    },
  )

  /**
   * fix-404 rev1: az 5xx szerverhiba, akkor sem definitív, ha a törzsében
   * not-found kód áll. Az order-poll ezt eddig is átmeneti („transport")
   * hibának vette, a callback viszont terminálisan elutasította.
   * fix-404 rev2 (X4): ugyanez a hitelesítési hibára (HTTP 401/403): az
   * order-poll „auth"-nak veszi és megszakít, egy elutasított kulcs pedig
   * semmit nem mond arról, hogy a fizetés létezik-e.
   */
  const notExistingPaymentIdBody = [
    { ErrorCode: 'NotExistingPaymentId', Title: 'DUMMY', Description: 'DUMMY' },
  ]
  it.each([
    [503, 'üres Errors tömbbel', []],
    [503, 'NotExistingPaymentId-vel a törzsben', notExistingPaymentIdBody],
    [401, 'NotExistingPaymentId-vel a törzsben', notExistingPaymentIdBody],
    [403, 'NotExistingPaymentId-vel a törzsben', notExistingPaymentIdBody],
  ])(
    'HTTP %i GetState (%s) → NEM terminális: failed + processedAt NULL (a retry-job újrapróbálja)',
    async (httpStatus, _label, errors) => {
      const { POST, docs, capture } = setup({ order: null })
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ Errors: errors }), {
          status: httpStatus,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
      expect(response.status).toBe(200)
      await capture.runAll()

      expect(docs[0]).toMatchObject({ status: 'failed', result: 'failed', attempts: 1 })
      expect(docs[0]?.processedAt ?? null).toBeNull()
      expect(docs[0]?.lastError).toBeTruthy()
    },
  )
})

describe('(f) GetState-hiba — újrapróbálható', () => {
  it('hálózati hiba → failed + lastError, processedAt NULL; az újrapróbálás (retry-job) sikerül', async () => {
    const { POST, docs, order, capture, store, payload } = setup()
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(response.status).toBe(200)
    await capture.runAll()

    expect(docs[0]).toMatchObject({ status: 'failed', result: 'failed', attempts: 1 })
    expect(docs[0]?.lastError).toBeTruthy()
    // A processedAt SZÁNDÉKOSAN NULL — az esemény újrapróbálható marad.
    expect(docs[0]?.processedAt ?? null).toBeNull()
    expect(order?.status).toBe('payment_pending')

    // Újrapróbálás (a webhook-retry job ugyanezt hívja): sikeres GetState mellett paid lesz.
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))
    const retry = await processWebhook({
      store,
      provider: 'barion',
      externalId: PAYMENT_ID,
      handler: createBarionCallbackProcessor({ payload, store }),
    })

    expect(retry.kind).toBe('processed')
    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid', attempts: 2 })
    expect(typeof docs[0]?.processedAt).toBe('string')
  })
})

describe('(g) paid → cancelled visszaállítás TILOS (állapotgép-védelem)', () => {
  it('paid rendelésre Canceled callback → státusz marad paid, riasztás a naplóba, result=rejected', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs, order, capture } = setup({ order: createOrder({ status: 'paid' }) })
    fetchMock.mockResolvedValueOnce(getStateResponse('Canceled'))

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(response.status).toBe(200)
    await capture.runAll()

    // A visszaállítás NEM történt meg; az esemény lezárva (rejected), nem újrapróbálandó.
    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'rejected' })
    expect(logOutput(logSpy)).toContain('RIASZT')
    expect(logOutput(logSpy)).toContain('paid')
  })
})

describe('hiányzó rendelés — GetState rendben, de nincs order', () => {
  it('riasztás + failed (NEM csendes elnyelés), a handler ettől 200-at adott', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs, capture } = setup({ order: null })
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    const response = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(response.status).toBe(200)
    await capture.runAll()

    expect(docs[0]).toMatchObject({ status: 'failed', result: 'failed' })
    expect(docs[0]?.lastError).toContain('nem tartozik rendelés')
    const logs = logOutput(logSpy)
    expect(logs).toContain('RIASZT')
    expect(logs).toContain(ORDER_NUMBER)
  })
})

describe('orderNumber-fallback és titokvédelem', () => {
  it('hiányzó barionPaymentId esetén a PaymentRequestId (orderNumber) alapján azonosít és pótol', async () => {
    const { POST, calls, order, capture } = setup({
      order: createOrder({ barionPaymentId: null }),
    })
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    await capture.runAll()

    // A rendelés paid lett, és a barionPaymentId pótlódott.
    expect(order?.status).toBe('paid')
    expect(order?.barionPaymentId).toBe(PAYMENT_ID)
    expect(calls.update.some((call) => call.data.barionPaymentId === PAYMENT_ID)).toBe(true)
  })

  /**
   * S2 — a fallback-párosítás a LEGGYENGÉBB bizonyíték: nem a barionPaymentId
   * kötötte a fizetést a rendeléshez. Ha az összeg nem stimmel, SEMMIT nem
   * írunk a rendelésre (a barionPaymentId-t sem), és az esemény rejected.
   */
  it('orderNumber-fallback + eltérő Total → semmilyen írás, rejected + riasztás', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs, calls, order, capture } = setup({
      order: createOrder({ barionPaymentId: null }),
    })
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded', { total: 1 }))

    await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    await capture.runAll()

    expect(order?.status).toBe('payment_pending')
    expect(order?.barionPaymentId ?? null).toBeNull()
    expect(calls.update).toHaveLength(0)
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'rejected' })
    const logs = logOutput(logSpy)
    expect(logs).toContain('RIASZT')
    expect(logs).toContain('orderNumber-alapú párosítás')
  })

  /**
   * S2 — az elsődleges (barionPaymentId szerinti) ágon is kötelező az
   * összeg-egyezés: a Barion Succeeded önmagában NEM elég bizonyíték.
   */
  it('eltérő Total + hiányzó refund-tranzakcióbizonyíték → nincs paid vagy refund, az esemény retryable', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, docs, calls, order, capture } = setup()
    // Transactions: [] nem bizonyít refundolható összeget az üres ledger mellett sem.
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded', { total: 990 }))

    await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    await capture.runAll()

    expect(order?.status).toBe('payment_pending')
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(0)
    expect(calls.update.filter((call) => call.collection === 'users')).toHaveLength(0)
    expect(docs[0]).toMatchObject({ status: 'failed', result: 'failed' })
    expect(logOutput(logSpy)).toContain('source-transaction-unproven')
    expect(logOutput(logSpy)).toContain('RIASZT')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(orderPaidSpy.onOrderPaid).not.toHaveBeenCalled()
  })

  it('RF-4: Succeeded + paid-reject + recover failed → esemény failed, retryable, nem rejected', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { store, docs, payload, order } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded', { total: 990 }))
    const recoverRejectedPaid = vi.fn(async (input: { source?: string }) => {
      expect(input.source).toBe('callback')
      return { action: 'failed' as const, detail: 'barion-refund-error' }
    })

    const result = await processWebhook({
      store,
      provider: 'barion',
      externalId: PAYMENT_ID,
      handler: createBarionCallbackProcessor({ payload, store, recoverRejectedPaid }),
    })

    expect(result.kind).toBe('failed')
    expect(result).toMatchObject({ retryable: true })
    expect(order?.status).toBe('payment_pending')
    expect(docs[0]).toMatchObject({ status: 'failed' })
    expect(docs[0]?.result ?? null).not.toBe('rejected')
    expect(docs[0]?.processedAt ?? null).toBeNull()
    expect(recoverRejectedPaid).toHaveBeenCalledTimes(1)
    expect(logOutput(logSpy)).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('a naplóban sosem szerepel a POSKey', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse('Succeeded'))

    await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    await capture.runAll()

    expect(logOutput(logSpy)).not.toContain(DUMMY_POS_KEY)
  })
})

/**
 * W12 — ismeretlen PaymentId IP-kerete; ismert rendelés korlátlan.
 *
 * Az útvonal-osztályozó a callbacket kihagyja (a valódi Barion-retry nem
 * eshet globális vödörbe). A handler CSAK akkor fogyaszt, ha nincs
 * `orders.barionPaymentId` egyezés, és CSAK a `store.create` előtt.
 */
describe('W12 — ismeretlen PaymentId IP-kerete', () => {
  const unknownLimit = RATE_LIMIT_RULES['barion-callback-unknown'].limit
  const sharedIp = '203.0.113.80'

  it('ismert PaymentId: 20+ callback 200, ütemez, és NEM fogyasztja az unknown-keretet', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const { POST, docs, capture, store } = setup({
      anyPaymentIdKnown: true,
      rateLimit: { limiter },
    })
    const createSpy = vi.spyOn(store, 'create')

    for (let index = 0; index < unknownLimit + 5; index += 1) {
      const response = await POST(makeBarionRequest(guidFromIndex(index), { ip: sharedIp }))
      expect(response.status, `ismert #${index}`).toBe(200)
      expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    }

    expect(docs).toHaveLength(unknownLimit + 5)
    expect(createSpy).toHaveBeenCalledTimes(unknownLimit + 5)
    expect(capture.tasks).toHaveLength(unknownLimit + 5)

    // Az unknown-vödör érintetlen: egy ismeretlen GUID még mindig átmegy.
    const unknown = setup({
      order: null,
      rateLimit: { limiter },
    })
    const leftover = await unknown.POST(makeBarionRequest(guidFromIndex(900), { ip: sharedIp }))
    expect(leftover.status).toBe(200)
    expect(await leftover.json()).toEqual({ ok: true, status: 'accepted' })
    expect(unknown.docs).toHaveLength(1)
    expect(unknown.capture.tasks).toHaveLength(1)
  })

  it('ismeretlen GUID ugyanarról az IP-ről: a keretig insert+ütemez, felette 200 no-op', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const { POST, docs, capture, store } = setup({
      order: null,
      rateLimit: { limiter },
    })
    const createSpy = vi.spyOn(store, 'create')

    for (let index = 0; index < unknownLimit; index += 1) {
      const response = await POST(makeBarionRequest(guidFromIndex(index), { ip: sharedIp }))
      expect(response.status, `unknown #${index}`).toBe(200)
      expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    }

    expect(docs).toHaveLength(unknownLimit)
    expect(createSpy).toHaveBeenCalledTimes(unknownLimit)
    expect(capture.tasks).toHaveLength(unknownLimit)

    const over = await POST(makeBarionRequest(guidFromIndex(unknownLimit), { ip: sharedIp }))
    expect(over.status).toBe(200)
    expect(await over.json()).toEqual({ ok: true, status: 'ignored' })
    expect(createSpy).toHaveBeenCalledTimes(unknownLimit)
    expect(docs).toHaveLength(unknownLimit)
    expect(capture.tasks).toHaveLength(unknownLimit)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('különböző IP-k külön vödröt kapnak', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const { POST, docs, capture } = setup({
      order: null,
      rateLimit: { limiter },
    })

    for (let index = 0; index < unknownLimit; index += 1) {
      const response = await POST(makeBarionRequest(guidFromIndex(index), { ip: '198.51.100.10' }))
      expect(response.status).toBe(200)
    }
    const blocked = await POST(
      makeBarionRequest(guidFromIndex(unknownLimit), { ip: '198.51.100.10' }),
    )
    expect(await blocked.json()).toEqual({ ok: true, status: 'ignored' })

    const otherIp = await POST(
      makeBarionRequest(guidFromIndex(unknownLimit + 1), { ip: '198.51.100.11' }),
    )
    expect(otherIp.status).toBe(200)
    expect(await otherIp.json()).toEqual({ ok: true, status: 'accepted' })
    expect(docs).toHaveLength(unknownLimit + 1)
    expect(capture.tasks).toHaveLength(unknownLimit + 1)
  })

  it('kimerült ismeretlen esemény: 200 no-op, nincs ütemezés (nincs új GetState)', async () => {
    const { POST, docs, capture, store } = setup({
      order: null,
      initialEvents: [
        {
          id: 1,
          provider: 'barion',
          externalId: PAYMENT_ID,
          status: 'failed',
          attempts: MAX_WEBHOOK_ATTEMPTS,
          result: 'failed',
        },
      ],
    })
    const createSpy = vi.spyOn(store, 'create')

    const response = await POST(makeBarionRequest(PAYMENT_ID, { ip: sharedIp }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'received' })
    expect(createSpy).not.toHaveBeenCalled()
    expect(capture.tasks).toHaveLength(0)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      status: 'failed',
      attempts: MAX_WEBHOOK_ATTEMPTS,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kimerült ISMERT rendelés eseménye: továbbra is ütemez (W13)', async () => {
    const { POST, docs, capture } = setup({
      initialEvents: [
        {
          id: 1,
          provider: 'barion',
          externalId: PAYMENT_ID,
          status: 'failed',
          attempts: MAX_WEBHOOK_ATTEMPTS,
          result: 'failed',
        },
      ],
    })

    const response = await POST(makeBarionRequest(PAYMENT_ID, { ip: sharedIp }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'received' })
    expect(capture.tasks).toHaveLength(1)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      status: 'failed',
      attempts: MAX_WEBHOOK_ATTEMPTS,
    })
  })
})
