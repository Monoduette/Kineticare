import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { createRefundHandler } from '../lib/refund/route-handler'
import { readRefundEntries } from '../lib/refund/refund-order'
import type { Order, User } from '../payload-types'

/**
 * Owner-only refund egységtesztek — a VALÓDI route-handler (RBAC + JSON-kapcsolás)
 * + refundOrder szolgáltatás együtt, mockolt fetch-csel (Barion GetState v4 +
 * Refund v2) és mockolt Payload local API-val (barion-callback.test.ts /
 * checkout-start.test.ts minta).
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'

const PAYMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const TRANSACTION_ID = 'tx-1111-2222'
const ORDER_NUMBER = 'KH-2026-000777'
const TOTAL_HUF = 19990

const fetchMock = vi.fn()
// A globális fetch-stub nem maradhat át más tesztfájlra (CLAUDE.md 15. tanulság):
// beforeEach-ben állítjuk be, az afterEach pedig visszaállítja.
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

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
})

interface OrderFixture {
  status?: Order['status']
  totalHufSnapshot?: number | null
  refunds?: unknown
  barionPaymentId?: string | null
  customer?: number
  productIds?: number[]
}

function createOrder(fixture: OrderFixture = {}): Order {
  return {
    id: 555,
    orderNumber: ORDER_NUMBER,
    status: fixture.status ?? 'paid',
    totalHufSnapshot:
      fixture.totalHufSnapshot === undefined ? TOTAL_HUF : fixture.totalHufSnapshot,
    amount: fixture.totalHufSnapshot === undefined ? TOTAL_HUF : fixture.totalHufSnapshot,
    barionPaymentId: fixture.barionPaymentId === undefined ? PAYMENT_ID : fixture.barionPaymentId,
    customer: fixture.customer ?? 7,
    items: (fixture.productIds ?? [42]).map((productId) => ({ product: productId, quantity: 1 })),
    ...(fixture.refunds !== undefined ? { refunds: fixture.refunds } : {}),
  } as unknown as Order
}

interface MockPayloadOptions {
  order?: Order | null
  authUser?: { id: number; role: string } | null
  customerPurchases?: number[]
  /** true esetén a vevőnek van MÁS paid rendelése ugyanarra a termékre. */
  otherPaidOrderExists?: boolean
}

function createMockPayload(options: MockPayloadOptions = {}) {
  const order = options.order === undefined ? createOrder() : options.order
  const authUser =
    options.authUser === undefined ? { id: 1, role: 'owner' } : options.authUser
  const customer = {
    id: 7,
    email: 'vevo@example.test',
    purchases: options.customerPurchases ?? [42],
  } as unknown as User
  const calls = {
    update: [] as Array<{ collection: string; id: number | string; data: Record<string, unknown> }>,
    create: [] as Array<{ collection: string; data: Record<string, unknown> }>,
  }
  const payload = {
    auth: vi.fn(async () => ({ user: authUser })),
    find: vi.fn(async ({ where }: { collection: string; where?: unknown }) => {
      const json = JSON.stringify(where ?? {})
      if (json.includes('not_equals')) {
        // A revokePurchases „más paid rendelés" ellenőrzése.
        return options.otherPaidOrderExists ? { docs: [{}], totalDocs: 1 } : { docs: [], totalDocs: 0 }
      }
      if (!order) return { docs: [], totalDocs: 0 }
      if (order.orderNumber && json.includes(String(order.orderNumber))) {
        return { docs: [order], totalDocs: 1 }
      }
      return { docs: [], totalDocs: 0 }
    }),
    findByID: vi.fn(async () => customer),
    update: vi.fn(
      async (args: { collection: string; id: number | string; data: Record<string, unknown> }) => {
        calls.update.push(args)
        if (args.collection === 'orders' && order) {
          Object.assign(order, args.data)
        }
        if (args.collection === 'users') {
          Object.assign(customer, args.data)
        }
        return args.data
      },
    ),
    create: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      calls.create.push(args)
      return args.data
    }),
  }
  return { payload: payload as unknown as Payload, calls, order, customer }
}

/** Barion GetState v4 válasz. */
function getStateResponse(transactions?: Array<Record<string, unknown>>): Response {
  return new Response(
    JSON.stringify({
      PaymentId: PAYMENT_ID,
      PaymentRequestId: ORDER_NUMBER,
      Status: 'Succeeded',
      Total: TOTAL_HUF,
      Transactions: transactions ?? [
        {
          TransactionId: TRANSACTION_ID,
          POSTransactionId: `${ORDER_NUMBER}-1`,
          Total: TOTAL_HUF,
          Status: 'Succeeded',
          TransactionType: 'CardPayment',
        },
      ],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Barion Refund v2 válasz. */
function refundResponse(amount: number, status = 'Refunded'): Response {
  return new Response(
    JSON.stringify({
      PaymentId: PAYMENT_ID,
      RefundedTransactions: [{ TransactionId: TRANSACTION_ID, AmountToRefund: amount, Status: status }],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function barionProviderError(): Response {
  return new Response(
    JSON.stringify({
      Errors: [{ ErrorCode: 'RefundNotAllowed', Title: 'Refund not allowed', Description: 'x' }],
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}

function makeRequest(body?: unknown): Request {
  return new Request(`https://shop.example.test/api/admin/orders/${ORDER_NUMBER}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeContext(orderNumber = ORDER_NUMBER) {
  return { params: Promise.resolve({ orderNumber }) }
}

function setup(options: MockPayloadOptions = {}) {
  const mock = createMockPayload(options)
  const POST = createRefundHandler({ getPayload: async () => mock.payload })
  return { POST, ...mock }
}

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

describe('RBAC — owner-only művelet', () => {
  it('anon hívó → 401, Barion-hívás nélkül', async () => {
    const { POST } = setup({ authUser: null })
    const response = await POST(makeRequest({}), makeContext())
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('staff szerepkör → 403 (a teszt bizonyítja: staff NEM refundálhat), Barion-hívás nélkül', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, calls } = setup({ authUser: { id: 9, role: 'staff' } })

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(String(body.error)).toContain('owner')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
    expect(logOutput(logSpy)).toContain('jogosulatlan')
  })

  it('customer szerepkör → 403', async () => {
    const { POST } = setup({ authUser: { id: 5, role: 'customer' } })
    const response = await POST(makeRequest({}), makeContext())
    expect(response.status).toBe(403)
  })
})

describe('boldog út — owner teljes refund', () => {
  it('refundPayment a helyes TransactionId/összeggel, order refunded, purchases levéve, audit írva', async () => {
    const { POST, calls, order, customer } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse()).mockResolvedValueOnce(refundResponse(TOTAL_HUF))

    const response = await POST(makeRequest({ reason: 'Vevői reklamáció' }), makeContext())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      orderNumber: ORDER_NUMBER,
      type: 'full',
      amountHuf: TOTAL_HUF,
      transactionId: TRANSACTION_ID,
      refundedTransactionStatus: 'Refunded',
      totalRefundedHuf: TOTAL_HUF,
      orderStatus: 'refunded',
    })

    // 1. hívás: v4 GetState újralekérdezés (TransactionId-feloldás, repó-tény alapú).
    const stateUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(stateUrl).toBe(`https://api.test.barion.com/v4/Payment/${PAYMENT_ID}/PaymentState`)
    // 2. hívás: Refund v2, a v4-ből feloldott TransactionId-vel és a teljes összeggel.
    const [refundUrl, refundInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(refundUrl).toBe('https://api.test.barion.com/v2/Payment/Refund')
    const refundBody = JSON.parse(String(refundInit.body)) as {
      PaymentId: string
      TransactionsToRefund: Array<{ TransactionId: string; AmountToRefund: number }>
    }
    expect(refundBody.PaymentId).toBe(PAYMENT_ID)
    expect(refundBody.TransactionsToRefund).toEqual([
      { TransactionId: TRANSACTION_ID, AmountToRefund: TOTAL_HUF },
    ])

    // Rendelés: refunded státusz + refundedAt + refundReason + refunds-nyom (Barion-státusszal).
    const orderUpdates = calls.update.filter((call) => call.collection === 'orders')
    expect(orderUpdates).toHaveLength(1)
    expect(orderUpdates[0]?.data.status).toBe('refunded')
    expect(typeof orderUpdates[0]?.data.refundedAt).toBe('string')
    expect(orderUpdates[0]?.data.refundReason).toBe('Vevői reklamáció')
    expect(orderUpdates[0]?.data.refunds).toEqual([
      expect.objectContaining({
        transactionId: TRANSACTION_ID,
        amountHuf: TOTAL_HUF,
        status: 'Refunded',
        type: 'full',
      }),
    ])
    expect(order?.status).toBe('refunded')

    // Purchases idempotens levétele (egy users-update, a 42-es termék eltűnik).
    const userUpdates = calls.update.filter((call) => call.collection === 'users')
    expect(userUpdates).toHaveLength(1)
    expect(userUpdates[0]?.data.purchases).toEqual([])
    expect(customer.purchases).toEqual([])

    // Audit-logs bejegyzés (a collection létezik — writeAuditLog a create-et hívja).
    const auditCreates = calls.create.filter((call) => call.collection === 'audit-logs')
    expect(auditCreates).toHaveLength(1)
    expect(auditCreates[0]?.data.action).toBe('order-refund')
    expect(auditCreates[0]?.data.entityType).toBe('orders')
  })

  it('a vevő MÁS paid rendelésére vonatkozó jogosultság megmarad (védelem)', async () => {
    const { POST, customer } = setup({ otherPaidOrderExists: true })
    fetchMock.mockResolvedValueOnce(getStateResponse()).mockResolvedValueOnce(refundResponse(TOTAL_HUF))

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(200)
    // A 42-es termékhez más paid rendelés is tartozik → NINCS purchases-levétel.
    expect(customer.purchases).toEqual([42])
  })
})

describe('állapotgép-validáció — 409 magyar üzenettel', () => {
  it.each([
    ['payment_pending'],
    ['payment_failed'],
    ['cancelled'],
    ['created'],
  ])('%s státuszú rendelés → 409, Barion-hívás nélkül', async (status) => {
    const { POST, calls } = setup({ order: createOrder({ status: status as Order['status'] }) })

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(String(body.error)).toContain('paid')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
  })

  it('dupla refund (már refunded rendelés) → 409, Barion-hívás nélkül', async () => {
    const { POST, calls } = setup({ order: createOrder({ status: 'refunded' }) })

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(String(body.error)).toContain('visszatérítés')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
  })
})

describe('részrefund', () => {
  it('részösszeg → a státusz paid MARAD, refund-nyom keletkezik, purchases MARAD', async () => {
    const { POST, calls, order, customer } = setup()
    fetchMock
      .mockResolvedValueOnce(getStateResponse())
      .mockResolvedValueOnce(refundResponse(5000, 'PartiallyRefunded'))

    const response = await POST(makeRequest({ amountHuf: 5000, reason: 'Kedvezmény utólag' }), makeContext())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      type: 'partial',
      amountHuf: 5000,
      refundedTransactionStatus: 'PartiallyRefunded',
      totalRefundedHuf: 5000,
      orderStatus: 'paid',
    })

    // A Refund-kérés a kért részösszeggel ment ki.
    const [, refundInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const refundBody = JSON.parse(String(refundInit.body)) as {
      TransactionsToRefund: Array<{ TransactionId: string; AmountToRefund: number }>
    }
    expect(refundBody.TransactionsToRefund[0]).toEqual({
      TransactionId: TRANSACTION_ID,
      AmountToRefund: 5000,
    })

    // Rendelés: státusz NEM változik, csak refunds-nyom (Barion-státusszal).
    const orderUpdates = calls.update.filter((call) => call.collection === 'orders')
    expect(orderUpdates).toHaveLength(1)
    expect(orderUpdates[0]?.data.status).toBeUndefined()
    expect(orderUpdates[0]?.data.refunds).toEqual([
      expect.objectContaining({ amountHuf: 5000, status: 'PartiallyRefunded', type: 'partial' }),
    ])
    expect(order?.status).toBe('paid')

    // Purchases-levétel NINCS részrefundnál — a hozzáférés marad.
    expect(calls.update.filter((call) => call.collection === 'users')).toHaveLength(0)
    expect(customer.purchases).toEqual([42])
  })

  it('második részrefund a tárolt TransactionId-t használja (nincs új GetState), a maradékig teljesít', async () => {
    const existingEntry = {
      transactionId: TRANSACTION_ID,
      amountHuf: 5000,
      status: 'PartiallyRefunded',
      refundedAt: '2026-07-30T10:00:00.000Z',
      type: 'partial',
    }
    const { POST, calls, order } = setup({ order: createOrder({ refunds: [existingEntry] }) })
    fetchMock.mockResolvedValueOnce(refundResponse(TOTAL_HUF - 5000))

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(200)
    // Csak EGY fetch: a Refund — a GetState NEM fut újra (tárolt transactionId elsőbbsége).
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const refundUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(refundUrl).toBe('https://api.test.barion.com/v2/Payment/Refund')

    // A maradék (total − már visszatérített) térült vissza → teljes refund.
    const body = await response.json()
    expect(body).toMatchObject({
      type: 'full',
      amountHuf: TOTAL_HUF - 5000,
      alreadyRefundedHuf: 5000,
      totalRefundedHuf: TOTAL_HUF,
      orderStatus: 'refunded',
    })
    // A refunds-nyom MEGŐRZI a korábbi bejegyzést, és hozzáfűzi az újat.
    const entries = readRefundEntries(order as Order)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual(existingEntry)
    expect(entries[1]?.type).toBe('full')
    // Teljes refund → purchases-levétel lefutott.
    expect(calls.update.some((call) => call.collection === 'users')).toBe(true)
  })

  it('érvénytelen összeg → 400 (0, negatív, maradékot meghaladó)', async () => {
    const { POST, calls } = setup({ order: createOrder({ refunds: [
      { transactionId: TRANSACTION_ID, amountHuf: 10000, status: 'PartiallyRefunded', refundedAt: 'x', type: 'partial' },
    ] }) })

    for (const amountHuf of [0, -100, TOTAL_HUF - 10000 + 1, 'nem szám']) {
      const response = await POST(makeRequest({ amountHuf }), makeContext())
      expect(response.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
  })
})

describe('hibaágak', () => {
  it('ismeretlen orderNumber → 404, Barion-hívás nélkül', async () => {
    const { POST, calls } = setup({ order: null })

    const response = await POST(makeRequest({}), makeContext('KH-2026-999999'))

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(String(body.error)).toContain('nem található')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
  })

  it('Barion Refund-hiba → 502, a rendelés NEM változik, hiba naplózva', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, calls, order } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse()).mockResolvedValueOnce(barionProviderError())

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(502)
    const body = await response.json()
    expect(String(body.error)).toContain('nem változott')
    // A rendelésen SEMMI nem változott: nincs orders/users update, státusz paid marad.
    expect(calls.update).toHaveLength(0)
    expect(order?.status).toBe('paid')
    const logs = logOutput(logSpy)
    expect(logs).toContain('refund')
    expect(logs).toContain('provider')
  })

  it('GetState-hiba (hálózat) → 502, a rendelés érintetlen', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, calls, order } = setup()
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(502)
    expect(calls.update).toHaveLength(0)
    expect(order?.status).toBe('paid')
    expect(logOutput(logSpy)).toContain('GetState')
  })

  it('GetState-timeout → 504, a rendelés érintetlen', async () => {
    const { POST, calls, order } = setup()
    const abortError = new Error('The operation was aborted')
    abortError.name = 'TimeoutError'
    fetchMock.mockRejectedValueOnce(abortError)

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(504)
    expect(calls.update).toHaveLength(0)
    expect(order?.status).toBe('paid')
  })

  it('ÜRES TransactionId → 502, Refund-hívás nélkül (üres azonosító nem mehet ki a Barionnak)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST, calls, order } = setup()
    fetchMock.mockResolvedValueOnce(
      getStateResponse([
        { TransactionId: '', Total: TOTAL_HUF, Status: 'Succeeded', TransactionType: 'CardPayment' },
      ]),
    )

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(502)
    const body = await response.json()
    expect(String(body.error)).toContain('visszatéríthető tranzakció')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.update).toHaveLength(0)
    expect(order?.status).toBe('paid')
    expect(logOutput(logSpy)).toContain('visszatéríthető tranzakció')
  })

  it('nem kártyás, de SIKERES tranzakció élvez elsőbbséget a lista elsőjével szemben', async () => {
    const { POST } = setup()
    fetchMock
      .mockResolvedValueOnce(
        getStateResponse([
          { TransactionId: 'tx-elso-fuggo', Total: TOTAL_HUF, Status: 'Prepared' },
          { TransactionId: 'tx-sikeres', Total: TOTAL_HUF, Status: 'Succeeded' },
        ]),
      )
      .mockResolvedValueOnce(refundResponse(TOTAL_HUF))

    const response = await POST(makeRequest({}), makeContext())

    expect(response.status).toBe(200)
    const [, refundInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const refundBody = JSON.parse(String(refundInit.body)) as {
      TransactionsToRefund: Array<{ TransactionId: string }>
    }
    expect(refundBody.TransactionsToRefund[0]?.TransactionId).toBe('tx-sikeres')
  })

  it('a naplóban sosem szerepel a POSKey', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { POST } = setup()
    fetchMock.mockResolvedValueOnce(getStateResponse()).mockResolvedValueOnce(refundResponse(TOTAL_HUF))

    await POST(makeRequest({}), makeContext())

    expect(logOutput(logSpy)).not.toContain(DUMMY_POS_KEY)
  })
})
