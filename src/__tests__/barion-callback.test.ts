import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'

import { emptyRefundLedger } from './empty-refund-ledger'
import { resetAlertThrottle } from '../lib/alert-throttle'
import { createBarionCallbackProcessor } from '../lib/barion-callback/process-callback'
import { compareRefundsWithPaymentState } from '../lib/barion-callback/refund-reconciliation'
import {
  CANCELLED_RECHECK_COOLDOWN_MS,
  CANCELLED_RECHECK_MAX_ORDER_AGE_MS,
  createBarionCallbackHandler,
} from '../lib/barion-callback/route-handler'
import { webhookRetryTask } from '../jobs/tasks/webhook-retry'
import {
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  registerWebhookProcessor,
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
 * A saját (admin) visszatérítési szándék DB-olvasása. Alapból a valódi
 * loadActiveRefundIntent fut (a fixtúra üres refund-nyilvántartásán át); a
 * BRK-R2-2 teszt a szándék-tároló válaszát lépteti, hogy a refundOrder
 * rögzítés közbeni állapotát a GetState ideje alatt modellezze.
 */
const intentOverride = vi.hoisted(() => ({ active: null as null | (() => boolean) }))

vi.mock('../lib/refund/intent-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/refund/intent-store')>()
  return {
    ...actual,
    loadActiveRefundIntent: async (
      ...args: Parameters<typeof actual.loadActiveRefundIntent>
    ): ReturnType<typeof actual.loadActiveRefundIntent> => {
      const override = intentOverride.active
      if (override === null) return actual.loadActiveRefundIntent(...args)
      return override()
        ? ({ id: 1 } as unknown as Awaited<ReturnType<typeof actual.loadActiveRefundIntent>>)
        : null
    },
  }
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

/**
 * A PaymentState-kapu (lib/barion/state.ts) ugyanarra a PaymentId-re két hívás
 * közt 5,5 s-ot vár; a kaput a barion.test.ts a saját határán bizonyítja. Itt
 * a fájl egészére hamis óra (Date + setTimeout) szól, és a feldolgozást a
 * `settle` az órát léptetve várja meg — a folyamat-tesztek így is a valódi
 * kapun mennek át, valós várakozás nélkül.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false
  const tracked = promise.finally(() => {
    done = true
  })
  while (!done) {
    await vi.advanceTimersByTimeAsync(1_000)
  }
  return tracked
}
/** A Barion teszt-környezetének dokumentált callback-címe (Callback_mechanism). */
const BARION_SANDBOX_CALLBACK_IP = '20.223.214.216'

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

// A hamis óra a fájl egészére szól, hogy tesztről tesztre csak előre haladjon
// (a kapu utolsó időbélyege a modulban él).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
})
afterAll(() => {
  vi.useRealTimers()
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
  intentOverride.active = null
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
        await settle(task())
      }
    },
  }
}

const CALLBACK_URL = 'https://shop.example.test/api/barion/callback'

/**
 * A kérés forrás-IP-je: alapból a Barion teszt-környezetének callback-címe az
 * `X-Real-IP`-ben (a Railway éle ide írja a kliens címét). Az `ip` opció a
 * rate-limit vödör kulcsát adó `X-Forwarded-For`-t állítja, a `realIp` a
 * forrás-ellenőrzését (null: a fejléc hiányzik).
 */
interface SourceOptions {
  ip?: string
  realIp?: string | null
}

function applySource(headers: Headers, options: SourceOptions): void {
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip)
  }
  const realIp = options.realIp === undefined ? BARION_SANDBOX_CALLBACK_IP : options.realIp
  if (realIp !== null) {
    headers.set('x-real-ip', realIp)
  }
}

/** JSON-törzses kézbesítés (TARTALÉK csatorna — a Barion ma nem ilyet küld). */
function makeRequest(body: unknown, options: SourceOptions = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  applySource(headers, options)
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
  options: { queryKey?: 'paymentId' | 'PaymentId'; body?: string } & SourceOptions = {},
): Request {
  const url = `${CALLBACK_URL}?${options.queryKey ?? 'paymentId'}=${encodeURIComponent(paymentId)}`
  const headers = new Headers()
  applySource(headers, options)
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

/** A strukturált logger JSON-sorai (egy sor = egy console.log-hívás). */
function logEntries(spy: MockInstance<(...args: unknown[]) => void>): Record<string, unknown>[] {
  return spy.mock.calls.flatMap((call) => {
    try {
      return [JSON.parse(String(call[0])) as Record<string, unknown>]
    } catch {
      return []
    }
  })
}

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
  // a-callback-6: a második kézbesítés egy CSAK OLVASÓ visszatérítés-egyeztetést
  // indít (második GetState), átmenetet és mellékhatást nem.
  it('második azonos PaymentId → 200 no-op; egy paid átmenet, egy purchases bejegyzés, a második GetState csak egyeztetés', async () => {
    const { POST, docs, calls, order, user, capture } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const first = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(first.status).toBe(200)
    await capture.runAll()

    const second = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, status: 'duplicate' })
    await capture.runAll()

    // Két GetState (feldolgozás + egyeztetés), EGY paid átmenet, EGY
    // purchases-írás, EGY webhook-rekord.
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  // a-callback-8: a még futó (received) eseményre érkező kézbesítés is
  // feldolgozást kér, PaymentId-nként összevonva: a kör előtt érkezettet a kör
  // GetState-je már látja, így nem indul párhuzamos, zárra váró futás.
  it('feldolgozás előtt érkező ismétlés (received) → 200, összevonva: egy futás, egy GetState', async () => {
    const { POST, capture, calls, docs } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const first = await POST(makeRequest({ PaymentId: PAYMENT_ID }))
    const second = await POST(makeRequest({ PaymentId: PAYMENT_ID }))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, status: 'received' })
    expect(capture.tasks).toHaveLength(1)

    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(1)
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid', attempts: 1 })
  })

  // Hibavadászat (W1): az ismert, nem lezárt eseményre érkező kézbesítés-áradat
  // korábban kézbesítésenként külön feldolgozást ütemezett. A GetState-kapu
  // közös ígérete után mind egyszerre ért a callback-zárhoz, és mindegyik egy
  // pool-kapcsolatot fogott, amíg a zárra várt.
  it('a futó feldolgozás közbeni kézbesítés-áradat nem ütemez új futást: egy további kör, legalább 60 s múlva', async () => {
    const { POST, capture } = setup()
    const hivasok: number[] = []
    fetchMock.mockImplementation(async () => {
      hivasok.push(Date.now())
      if (hivasok.length === 1) {
        for (let i = 0; i < 30; i += 1) {
          await POST(makeBarionRequest(PAYMENT_ID))
        }
      }
      return getStateResponse('Prepared')
    })

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(capture.tasks).toHaveLength(0)
    expect(hivasok).toHaveLength(2)
    expect((hivasok[1] ?? 0) - (hivasok[0] ?? 0)).toBeGreaterThanOrEqual(60_000)
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

    const outcome = await settle(
      processWebhook({
        store,
        provider: 'barion',
        externalId: legacyEvent.externalId,
        handler: createBarionCallbackProcessor({ payload, store }),
      }),
    )

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
    const retry = await settle(
      processWebhook({
        store,
        provider: 'barion',
        externalId: PAYMENT_ID,
        handler: createBarionCallbackProcessor({ payload, store }),
      }),
    )

    expect(retry.kind).toBe('processed')
    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
  })

  it('a TERMINÁLIS lezárás (paid) után a következő kézbesítés duplikátum: új átmenet nincs, csak egyeztető GetState', async () => {
    const { POST, calls, capture } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    const second = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await second.json()).toEqual({ ok: true, status: 'duplicate' })
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(1)
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
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
    const retry = await settle(
      processWebhook({
        store,
        provider: 'barion',
        externalId: PAYMENT_ID,
        handler: createBarionCallbackProcessor({ payload, store }),
      }),
    )
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

      const retry = await settle(
        processWebhook({
          store,
          provider: 'barion',
          externalId: PAYMENT_ID,
          handler: createBarionCallbackProcessor({ payload, store }),
        }),
      )
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
      const retry = await settle(
        processWebhook({
          store,
          provider: 'barion',
          externalId: PAYMENT_ID,
          handler: createBarionCallbackProcessor({ payload, store }),
        }),
      )
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
    const retry = await settle(
      processWebhook({
        store,
        provider: 'barion',
        externalId: PAYMENT_ID,
        handler: createBarionCallbackProcessor({ payload, store }),
      }),
    )

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

    const result = await settle(
      processWebhook({
        store,
        provider: 'barion',
        externalId: PAYMENT_ID,
        handler: createBarionCallbackProcessor({ payload, store, recoverRejectedPaid }),
      }),
    )

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

// ---------------------------------------------------------------------------
// w1-barion-platform: zár-sorrend, egyeztetés, újraellenőrzés, forrás-IP
// ---------------------------------------------------------------------------

/**
 * Session-zár a Payload pooljára akasztva: minden lépést egy közös
 * eseménynaplóba ír, hogy a GetState / zár / mellékhatás SORRENDJE
 * ellenőrizhető legyen (a-callback-7).
 */
function attachLockPool(payload: Payload, events: string[]) {
  const listeners = new Set<(error: Error) => void>()
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('pg_try_advisory_lock')) {
        events.push(`lock:${String(values?.[0])}`)
        return { rows: [{ locked: true }] }
      }
      events.push(`unlock:${String(values?.[0])}`)
      return { rows: [{ unlocked: true }] }
    }),
    on: (_event: 'error', listener: (error: Error) => void) => listeners.add(listener),
    removeListener: (_event: 'error', listener: (error: Error) => void) =>
      listeners.delete(listener),
    release: vi.fn(),
  }
  Object.assign((payload as unknown as { db: Record<string, unknown> }).db, {
    pool: { connect: async () => client },
  })
  return client
}

describe('a-callback-7 — kimenő HTTP a callback-záron KÍVÜL', () => {
  it('a GetState a zár ELŐTT, az onOrderPaid a zár elengedése UTÁN fut', async () => {
    const events: string[] = []
    const { POST, payload, capture, order } = setup()
    attachLockPool(payload, events)
    fetchMock.mockImplementation(async () => {
      events.push('getstate')
      return getStateResponse('Succeeded')
    })
    orderPaidSpy.onOrderPaid.mockImplementation(async () => {
      events.push('onOrderPaid')
    })

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(order?.status).toBe('paid')
    const key = `barion-callback:${PAYMENT_ID}`
    expect(events).toEqual(['getstate', `lock:${key}`, `unlock:${key}`, 'onOrderPaid'])
  })

  it('a webhook-retry a Barion-eseményt ugyanazon a callback-záron futtatja', async () => {
    const events: string[] = []
    const { payload, store, docs } = setup({
      initialEvents: [
        {
          id: 1,
          provider: 'barion',
          externalId: PAYMENT_ID,
          status: 'failed',
          attempts: 1,
          updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        },
      ],
    })
    attachLockPool(payload, events)
    registerWebhookProcessor('barion', async (event) => {
      events.push('processor')
      return createBarionCallbackProcessor({ payload, store })(event)
    })
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))
    // A retry-task a Payload-példányt használja tárként: a webhook-events hívások
    // az in-memory tárhoz, a többi a mockolt Payloadhoz megy.
    const base = payload as unknown as Record<
      'find' | 'update',
      (args: { collection: string }) => Promise<unknown>
    >
    const baseFind = base.find
    const baseUpdate = base.update
    Object.assign(payload, {
      find: async (args: { collection: string }) =>
        args.collection === 'webhook-events'
          ? store.find(args as Parameters<WebhookEventStore['find']>[0])
          : baseFind(args),
      update: async (args: { collection: string }) =>
        args.collection === 'webhook-events'
          ? store.update(args as Parameters<WebhookEventStore['update']>[0])
          : baseUpdate(args),
    })
    const { handler } = webhookRetryTask
    if (typeof handler !== 'function') {
      throw new Error('a webhook-retry handlere nem függvény')
    }

    await settle((handler as (args: unknown) => Promise<unknown>)({ req: { payload } }))

    const key = `barion-callback:${PAYMENT_ID}`
    expect(events).toEqual([`lock:${key}`, 'processor', `unlock:${key}`])
    expect(docs[0]?.attempts).toBe(2)
  })
})

describe('a-callback-6 / a-egyeztetes-2 — visszatérítés-egyeztetés paid eseményre érkező callbacknél', () => {
  const PAID_EVENT: WebhookEventDoc = {
    id: 1,
    provider: 'barion',
    externalId: PAYMENT_ID,
    status: 'processed',
    result: 'paid',
    processedAt: '2026-09-20T10:00:00.000Z',
    attempts: 1,
  }

  function stateWithTransactions(transactions: unknown[], total = ORDER_TOTAL_HUF): Response {
    return new Response(
      JSON.stringify({
        PaymentId: PAYMENT_ID,
        PaymentRequestId: ORDER_NUMBER,
        Status: 'Succeeded',
        Total: total,
        Currency: 'HUF',
        Transactions: transactions,
        Errors: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const SOURCE_TX = {
    TransactionId: 'aaaaaaaa-0000-4000-8000-000000000001',
    POSTransactionId: `${ORDER_NUMBER}-1`,
    TransactionType: 'CardPayment',
    Status: 'Succeeded',
    Total: ORDER_TOTAL_HUF,
  }
  /** A Barion felületén indított, nálunk nem rögzített visszatérítés. */
  const FOREIGN_REFUND_TX = {
    TransactionId: 'aaaaaaaa-0000-4000-8000-000000000002',
    TransactionType: 'RefundToBankCard',
    Status: 'Succeeded',
    Total: -5000,
    RelatedId: SOURCE_TX.TransactionId,
  }

  it('a Barion felületén indított (nálunk nem rögzített) visszatérítés: RIASZTÁS, írás és pénzmozgás nélkül', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture, calls } = setup({
      order: createOrder({ status: 'paid' }),
      initialEvents: [PAID_EVENT],
    })
    fetchMock.mockResolvedValue(
      stateWithTransactions([
        SOURCE_TX,
        {
          TransactionId: 'aaaaaaaa-0000-4000-8000-000000000002',
          TransactionType: 'RefundToBankCard',
          Status: 'Succeeded',
          Total: -5000,
          RelatedId: SOURCE_TX.TransactionId,
        },
      ]),
    )

    const response = await POST(makeBarionRequest(PAYMENT_ID, { realIp: '198.51.100.7' }))
    expect(await response.json()).toEqual({ ok: true, status: 'duplicate' })
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.update).toHaveLength(0)
    expect(orderPaidSpy.onOrderPaid).not.toHaveBeenCalled()
    const alert = logEntries(logSpy).find((entry) =>
      String(entry.msg).startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({
      findings: ['foreign-refund'],
      barionRefundedHuf: 5000,
      recordedRefundedHuf: 0,
    })
  })

  // Hibavadászat (W1): a paid eseményre érkező kézbesítés-áradat korábban
  // 5,5 s-onként új GetState-et váltott ki (a Barion elárasztásnak veheti,
  // Troubleshooting); most az egyeztetés körei között legalább egy perc telik el.
  it('paid eseményre érkező kézbesítés-áradat: az egyeztetés körei között legalább 60 s telik el', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup({
      order: createOrder({ status: 'paid' }),
      initialEvents: [PAID_EVENT],
    })
    const hivasok: number[] = []
    fetchMock.mockImplementation(async () => {
      hivasok.push(Date.now())
      if (hivasok.length === 1) {
        for (let i = 0; i < 10; i += 1) {
          await POST(makeBarionRequest(PAYMENT_ID, { realIp: '198.51.100.7' }))
        }
      }
      return stateWithTransactions([SOURCE_TX])
    })

    await POST(makeBarionRequest(PAYMENT_ID, { realIp: '198.51.100.7' }))
    await capture.runAll()

    expect(capture.tasks).toHaveLength(0)
    expect(hivasok).toHaveLength(2)
    expect((hivasok[1] ?? 0) - (hivasok[0] ?? 0)).toBeGreaterThanOrEqual(60_000)
  })

  it('sztornózott kártyás visszatérítés (StornoUnSuccessfulRefundToBankCard): RIASZTÁS a rögzített visszatérítés mellett is', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder({ status: 'refunded' })
    Object.assign(order, {
      refunds: [
        {
          transactionId: SOURCE_TX.TransactionId,
          amountHuf: ORDER_TOTAL_HUF,
          status: 'Succeeded',
          refundedAt: '2026-09-20T10:00:00.000Z',
          type: 'full',
        },
      ],
    })
    const { POST, capture, calls } = setup({ order, initialEvents: [PAID_EVENT] })
    fetchMock.mockResolvedValue(
      stateWithTransactions(
        [
          SOURCE_TX,
          {
            TransactionId: 'aaaaaaaa-0000-4000-8000-000000000003',
            TransactionType: 'RefundToBankCard',
            Status: 'Succeeded',
            Total: ORDER_TOTAL_HUF,
            RelatedId: SOURCE_TX.TransactionId,
          },
          {
            TransactionId: 'aaaaaaaa-0000-4000-8000-000000000004',
            TransactionType: 'StornoUnSuccessfulRefundToBankCard',
            Status: 'Succeeded',
            Total: ORDER_TOTAL_HUF,
            RelatedId: SOURCE_TX.TransactionId,
          },
        ],
        0,
      ),
    )

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(calls.update).toHaveLength(0)
    const alert = logEntries(logSpy).find((entry) =>
      String(entry.msg).startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({ findings: ['refund-reversal'] })
    expect(String(alert?.msg)).toContain('StornoUnSuccessfulRefundToBankCard')
  })

  it('egyező adatok: nincs riasztás; a futás előtt érkezett két kézbesítés egy egyeztetésbe (egy GetState) vonódik össze', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup({
      order: createOrder({ status: 'paid' }),
      initialEvents: [PAID_EVENT],
    })
    fetchMock.mockResolvedValue(stateWithTransactions([SOURCE_TX]))

    await POST(makeBarionRequest(PAYMENT_ID))
    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logOutput(logSpy)).not.toContain('RIASZTÁS')
  })

  // Breaker BRK-2: a korábbi 10 perces PaymentId-fojtás a pár perccel későbbi,
  // a Barion felületén indított visszatérítés callbackjét nyomtalanul eldobta.
  it('egy korábbi kézbesítés után 2 perccel érkező idegen visszatérítés-callback is egyeztetődik (RIASZTÁS)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup({
      order: createOrder({ status: 'paid' }),
      initialEvents: [PAID_EVENT],
    })
    fetchMock.mockResolvedValueOnce(stateWithTransactions([SOURCE_TX]))
    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    vi.advanceTimersByTime(2 * 60 * 1000)
    fetchMock.mockResolvedValue(stateWithTransactions([SOURCE_TX, FOREIGN_REFUND_TX]))
    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const alert = logEntries(logSpy).find((entry) =>
      String(entry.msg).startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({ findings: ['foreign-refund'] })
  })

  it('futó egyeztetés KÖZBEN érkező kézbesítés nem vész el: a futás végén még egy kör fut a kapun át', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup({
      order: createOrder({ status: 'paid' }),
      initialEvents: [PAID_EVENT],
    })
    let releaseFirst: (response: Response) => void = () => {}
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          releaseFirst = resolve
        }),
    )
    fetchMock.mockResolvedValueOnce(stateWithTransactions([SOURCE_TX, FOREIGN_REFUND_TX]))

    await POST(makeBarionRequest(PAYMENT_ID))
    const running = capture.runAll()
    while (fetchMock.mock.calls.length === 0) {
      await vi.advanceTimersByTimeAsync(0)
    }
    // Az első GetState még függ: a most érkező kézbesítés csak megjelöli a futót.
    const second = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await second.json()).toEqual({ ok: true, status: 'duplicate' })
    expect(capture.tasks).toHaveLength(0)
    releaseFirst(stateWithTransactions([SOURCE_TX]))
    await running

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const alert = logEntries(logSpy).find((entry) =>
      String(entry.msg).startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({ findings: ['foreign-refund'] })
  })

  // Breaker BRK-R2-2: a saját admin-visszatérítésre is jön callback. Ha az
  // egyeztetés a rögzítés KÖZBEN olvasta a rendelést (a szándék még aktív, a
  // refunds-nyom még üres), a GetState pedig a kapu miatt várt, a refundOrder
  // közben rögzített és elengedte a szándékot: a régi pillanatkép + a GetState
  // UTÁNI szándék-olvasás hamis „idegen visszatérítés” RIASZTÁS-t adott.
  // A második eset: a teljes saját visszatérítés a GetState várakozása alatt
  // indul és zárul, így aktív szándékot egyik olvasás sem lát; csak a friss
  // rendelés-olvasás mutatja a rögzített összeget. Mindkét esetet a GetState
  // utáni friss rendelés-olvasás védi; a GetState előtti szándék-olvasást
  // egyik eset sem bizonyítja külön (az mélységi védelem).
  it.each([
    ['elavult pillanatkép: a szándék a GetState előtt aktív, a rögzítés közben lezárul', true],
    ['a visszatérítés a GetState várakozása alatt indul és zárul', false],
  ] as const)(
    'a rögzítés közben érkező saját admin-visszatérítés callbackje nem ad hamis „idegen visszatérítés” RIASZTÁS-t (%s)',
    async (_label, intentActiveBefore) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      // Az „adatbázis” egyetlen rendelése; minden olvasás friss másolatot kap.
      const dbOrder = createOrder({ status: 'paid' })
      Object.assign(dbOrder, { refunds: [] })
      let intentActive: boolean = intentActiveBefore
      intentOverride.active = () => intentActive
      const payload = {
        find: vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
          const json = JSON.stringify(where ?? {})
          const matches =
            collection === 'orders' &&
            (json.includes(PAYMENT_ID) || json.includes(`"id":{"equals":${dbOrder.id}}`))
          return matches
            ? { docs: [structuredClone(dbOrder)], totalDocs: 1 }
            : { docs: [], totalDocs: 0 }
        }),
      } as unknown as Payload
      const { store } = createWebhookStore([PAID_EVENT])
      const capture = createScheduleCapture()
      const POST = createBarionCallbackHandler({
        getPayload: async () => payload,
        schedule: capture.schedule,
        store,
        rateLimit: { limiter: new SlidingWindowRateLimiter() },
      })
      // A GetState ideje alatt (kapu-várakozás + HTTP) a refundOrder rögzíti a
      // visszatérítést, majd elengedi a szándékot (committed).
      fetchMock.mockImplementation(async () => {
        Object.assign(dbOrder, {
          refunds: [
            {
              transactionId: SOURCE_TX.TransactionId,
              amountHuf: 5000,
              status: 'Succeeded',
              refundedAt: new Date().toISOString(),
              type: 'partial',
            },
          ],
        })
        intentActive = false
        return stateWithTransactions([SOURCE_TX, FOREIGN_REFUND_TX], ORDER_TOTAL_HUF - 5000)
      })

      const response = await POST(makeBarionRequest(PAYMENT_ID))
      expect(await response.json()).toEqual({ ok: true, status: 'duplicate' })
      await capture.runAll()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(logOutput(logSpy)).not.toContain('RIASZTÁS')
      // Az egyeztetés lefutott, és a friss rendeléssel egyezést talált.
      const matched = logEntries(logSpy).find(
        (entry) => entry.msg === 'visszatérítés-egyeztetés: a Barion és a rendelés adatai egyeznek',
      )
      expect(matched?.context).toMatchObject({ barionRefundedHuf: 5000, recordedRefundedHuf: 5000 })
    },
  )
})

describe('r-barion-7 — lezárt (cancelled) fizetésre érkező callback', () => {
  const CANCELLED_EVENT: WebhookEventDoc = {
    id: 1,
    provider: 'barion',
    externalId: PAYMENT_ID,
    status: 'processed',
    result: 'cancelled',
    processedAt: '2026-09-24T10:00:00.000Z',
    attempts: 1,
  }

  function cancelledOrder(ageMs: number): Order {
    const order = createOrder({ status: 'cancelled' })
    Object.assign(order, { createdAt: new Date(Date.now() - ageMs).toISOString() })
    return order
  }

  it('24 óránál fiatalabb rendelés: a GetState újra fut, a késői Succeeded paid-re viszi', async () => {
    const { POST, capture, order, docs } = setup({
      order: cancelledOrder(2 * 60 * 60 * 1000),
      initialEvents: [{ ...CANCELLED_EVENT }],
    })
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const response = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await response.json()).toEqual({ ok: true, status: 'received' })
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
  })

  // Breaker BRK-1 + lead (major): egy átmeneti GetState-hiba korábban a lezárt
  // esemény result-ját failed-re írta; a rekord processed+failed alakban
  // „kész duplikátum” lett, így a késői Succeeded callback sosem futott le.
  it('az újraellenőrzés átmeneti GetState-hibája (503) nem írja át a lezárt eseményt; a 60 s utáni Succeeded callback paid-re viszi', async () => {
    const { POST, capture, order, docs } = setup({
      order: cancelledOrder(2 * 60 * 60 * 1000),
      initialEvents: [{ ...CANCELLED_EVENT }],
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ Errors: [] }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const first = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await first.json()).toEqual({ ok: true, status: 'received' })
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalled()
    expect(docs[0]).toMatchObject({
      status: 'processed',
      result: 'cancelled',
      processedAt: CANCELLED_EVENT.processedAt,
    })
    expect(order?.status).toBe('cancelled')

    vi.advanceTimersByTime(CANCELLED_RECHECK_COOLDOWN_MS + 1_000)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))
    const second = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await second.json()).toEqual({ ok: true, status: 'received' })
    await capture.runAll()

    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
  })

  // Codex (PR #307): két átfedő callback a késői siker körül. Mindkettő még
  // nem lezárt eseményre ütemeződik (normál futás). Az első Canceled-et kér le,
  // és lezárja az eseményt, mielőtt a második a zárhoz ér; a második friss
  // Succeeded-je nem veszhet el duplikátumként a késői-siker ellenőrzésig.
  it('az átfedő második futás a zár alatt már lezárt (cancelled) eseményt talál: a friss Succeeded paid-re viszi', async () => {
    const { POST, capture, order, docs } = setup()
    const masodik: { valasz: Response | null } = { valasz: null }
    fetchMock
      .mockImplementationOnce(async () => {
        // A második callback az első kör GetState-je közben érkezik.
        masodik.valasz = await POST(makeBarionRequest(PAYMENT_ID))
        return getStateResponse('Canceled')
      })
      .mockResolvedValueOnce(getStateResponse('Succeeded'))

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(await masodik.valasz?.json()).toEqual({ ok: true, status: 'received' })
    expect(capture.tasks).toHaveLength(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(order?.status).toBe('paid')
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'paid' })
    expect(orderPaidSpy.onOrderPaid).toHaveBeenCalledTimes(1)
  })

  it('24 óránál régebbi rendelés: duplikátum, GetState nélkül', async () => {
    const { POST, capture, order } = setup({
      order: cancelledOrder(CANCELLED_RECHECK_MAX_ORDER_AGE_MS + 60_000),
      initialEvents: [{ ...CANCELLED_EVENT }],
    })

    const response = await POST(makeBarionRequest(PAYMENT_ID))
    expect(await response.json()).toEqual({ ok: true, status: 'duplicate' })
    await capture.runAll()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(order?.status).toBe('cancelled')
  })
})

describe('a-callback-7 — ismeretlen PaymentId csak a Barion callback-címéről', () => {
  const UNKNOWN_ID = '99999999-8888-4777-8666-555555555555'

  it('idegen X-Real-IP: 200 ignored, rekord és GetState nélkül', async () => {
    const { POST, docs, capture } = setup({ order: null })

    const response = await POST(makeBarionRequest(UNKNOWN_ID, { realIp: '198.51.100.7' }))

    expect(await response.json()).toEqual({ ok: true, status: 'ignored' })
    expect(docs).toHaveLength(0)
    expect(capture.tasks).toHaveLength(0)
  })

  it('a kliens által írt X-Forwarded-For nem hamisíthatja a Barion címét', async () => {
    const { POST, docs } = setup({ order: null })

    const response = await POST(
      makeBarionRequest(UNKNOWN_ID, {
        ip: `${BARION_SANDBOX_CALLBACK_IP}, 198.51.100.7`,
        realIp: '198.51.100.7',
      }),
    )
    const noRealIp = await POST(
      makeBarionRequest(UNKNOWN_ID, { ip: BARION_SANDBOX_CALLBACK_IP, realIp: null }),
    )

    expect(await response.json()).toEqual({ ok: true, status: 'ignored' })
    expect(await noRealIp.json()).toEqual({ ok: true, status: 'ignored' })
    expect(docs).toHaveLength(0)
  })

  it('a Barion (teszt-környezeti) címéről az ismeretlen PaymentId feldolgozásra kerül', async () => {
    const { POST, docs, capture } = setup({ order: null })

    const response = await POST(
      makeBarionRequest(UNKNOWN_ID, { realIp: BARION_SANDBOX_CALLBACK_IP }),
    )

    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    expect(docs).toHaveLength(1)
    expect(capture.tasks).toHaveLength(1)
    capture.tasks.length = 0
  })

  it('éles Barion-környezetben a teszt-környezet címe nem elég', async () => {
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')
    vi.stubEnv('BARION_API_URL', 'https://api.barion.com')
    vi.stubEnv('BARION_POSKEY_PROD', '00000000-0000-0000-0000-000000000000')
    try {
      const { POST, docs } = setup({ order: null })
      const fromSandbox = await POST(
        makeBarionRequest(UNKNOWN_ID, { realIp: BARION_SANDBOX_CALLBACK_IP }),
      )
      expect(await fromSandbox.json()).toEqual({ ok: true, status: 'ignored' })
      const fromProd = await POST(makeBarionRequest(UNKNOWN_ID, { realIp: '40.113.73.229' }))
      expect(await fromProd.json()).toEqual({ ok: true, status: 'accepted' })
      expect(docs).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ISMERT PaymentId bármely IP-ről feldolgozásra kerül', async () => {
    const { POST, docs, capture } = setup()

    const response = await POST(makeBarionRequest(PAYMENT_ID, { realIp: '198.51.100.7' }))

    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    expect(docs).toHaveLength(1)
    expect(capture.tasks).toHaveLength(1)
    capture.tasks.length = 0
  })
})

describe('a-callback-13 / a-riasztas-8 — napló és hibakezelés a háttérfeldolgozásban', () => {
  it('a feldolgozó sorai a kérés requestId-jét viszik', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const request = makeBarionRequest(PAYMENT_ID)
    request.headers.set('x-request-id', 'req-callback-proc-1')
    await POST(request)
    await capture.runAll()

    const verified = logEntries(logSpy).find(
      (entry) => entry.msg === 'barion-callback: fizetésállapot verifikálva',
    )
    expect(verified?.requestId).toBe('req-callback-proc-1')
  })

  it('a háttérfeldolgozás váratlan hibája strukturált, requestId-s error-sor, a task nem dob', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture, store } = setup()
    fetchMock.mockResolvedValue(getStateResponse('Succeeded'))

    const request = makeBarionRequest(PAYMENT_ID)
    request.headers.set('x-request-id', 'req-callback-proc-2')
    await POST(request)
    store.find = async () => {
      throw new Error('DB elérhetetlen')
    }
    await expect(capture.runAll()).resolves.toBeUndefined()

    const failure = logEntries(logSpy).find((entry) =>
      String(entry.msg).includes('háttér-feldolgozás'),
    )
    expect(failure).toMatchObject({ level: 'error', requestId: 'req-callback-proc-2' })
    expect(JSON.stringify(failure?.context)).toContain('DB elérhetetlen')
  })

  it('a kimerülés RIASZTÁS-előtaggal naplózódik', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture } = setup({
      initialEvents: [
        {
          id: 1,
          provider: 'barion',
          externalId: PAYMENT_ID,
          status: 'failed',
          attempts: MAX_WEBHOOK_ATTEMPTS - 1,
        },
      ],
    })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(
      logEntries(logSpy).some(
        (entry) =>
          entry.msg ===
          'RIASZTÁS: webhook-esemény újrapróbálásai kimerültek — owner beavatkozás szükséges',
      ),
    ).toBe(true)
  })

  it('HTTP 429 (a kapu újrapróbálása után is): újrapróbálható failed, RIASZTÁS nélkül', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, capture, docs } = setup()
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))

    await POST(makeBarionRequest(PAYMENT_ID))
    await capture.runAll()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(docs[0]).toMatchObject({ status: 'failed', attempts: 1 })
    expect(docs[0]?.processedAt ?? null).toBeNull()
    expect(logOutput(logSpy)).not.toContain('RIASZTÁS')
    expect(logOutput(logSpy)).toContain('HTTP 429')
  })
})

describe('visszatérítés-egyeztetés: saját, folyamatban lévő visszatérítés mellett', () => {
  const source = {
    TransactionId: 'bbbbbbbb-0000-4000-8000-000000000001',
    POSTransactionId: `${ORDER_NUMBER}-1`,
    TransactionType: 'CardPayment',
    Status: 'Succeeded',
    Total: ORDER_TOTAL_HUF,
  }
  const refund = {
    TransactionId: 'bbbbbbbb-0000-4000-8000-000000000002',
    TransactionType: 'RefundToBankCard',
    Status: 'Succeeded',
    Total: 5000,
    RelatedId: source.TransactionId,
  }
  const order = { orderNumber: ORDER_NUMBER, refunds: [], totalHufSnapshot: ORDER_TOTAL_HUF }
  const state = {
    PaymentId: PAYMENT_ID,
    Status: 'Succeeded' as const,
    Total: ORDER_TOTAL_HUF - 5000,
    Transactions: [source, refund],
  }

  it('aktív visszatérítési szándéknál a még nem rögzített összeg NEM riaszt, szándék nélkül igen', () => {
    expect(
      compareRefundsWithPaymentState(order, state, { activeRefundIntent: true }).findings,
    ).toEqual([])
    expect(
      compareRefundsWithPaymentState(order, state, { activeRefundIntent: false }).findings,
    ).toEqual(['foreign-refund'])
  })

  // Codex (PR #307): a folyamatban lévő visszatérítés-tranzakció nem számít
  // visszatérítettnek. Szándék nélkül nyitott ügy (az egy héttel későbbi
  // újraellenőrzés különben „egyezik”-kel zárná le), a saját, épp futó
  // visszatérítésünk mellett viszont várható.
  it.each<[string, number, boolean, string[]]>([
    [
      'nálunk sikeresként rögzített, szándék nélkül',
      5000,
      false,
      ['refund-in-progress', 'recorded-refund-missing'],
    ],
    [
      'nálunk nem rögzített (a Barion felületén indított), szándék nélkül',
      0,
      false,
      ['refund-in-progress'],
    ],
    ['nálunk nem rögzített, a saját futó visszatérítésünk mellett', 0, true, []],
  ])(
    'a Barionban folyamatban lévő (Started) visszatérítés nem számít visszatérítettnek: %s',
    (_eset, recordedHuf, activeRefundIntent, findings) => {
      const recorded = {
        ...order,
        refunds:
          recordedHuf > 0
            ? [
                {
                  transactionId: source.TransactionId,
                  amountHuf: recordedHuf,
                  status: 'Succeeded' as const,
                  refundedAt: '2026-09-18T10:00:00.000Z',
                  type: 'partial' as const,
                },
              ]
            : [],
      }
      const pending = { ...state, Transactions: [source, { ...refund, Status: 'Started' }] }
      const comparison = compareRefundsWithPaymentState(recorded, pending, { activeRefundIntent })
      expect(comparison.findings).toEqual(findings)
      expect(comparison.barionRefundedHuf).toBe(0)
    },
  )

  it('aktív szándék mellett is riaszt a sikertelen és a sztornózott visszatérítésre', () => {
    const failing = {
      ...state,
      Transactions: [
        source,
        { ...refund, Status: 'Failed' },
        {
          TransactionId: 'bbbbbbbb-0000-4000-8000-000000000003',
          TransactionType: 'StornoUnSuccessfulRefundToBankCard',
          Status: 'Succeeded',
          Total: 5000,
          RelatedId: source.TransactionId,
        },
      ],
    }
    expect(
      compareRefundsWithPaymentState(order, failing, { activeRefundIntent: true }).findings,
    ).toEqual(['refund-reversal', 'failed-refund'])
  })
})
