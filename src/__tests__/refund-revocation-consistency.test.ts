import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RefundError, readRefundEntries, refundOrder } from '../lib/refund/refund-order'
import { createRefundHandler } from '../lib/refund/route-handler'
import type { Order, User } from '../payload-types'

const invoices = vi.hoisted(() => ({
  storno: vi.fn(async () => ({ outcome: 'storned', stornoNumber: 'SYNTHETIC-ST-1' })),
  corrective: vi.fn(async () => ({ outcome: 'issued', correctiveInvoiceNumber: 'SYNTHETIC-HE-1' })),
  queue: vi.fn(async () => true),
}))

vi.mock('../lib/szamlazz', () => ({
  issueStornoForOrder: invoices.storno,
  issueCorrectiveInvoiceForOrder: invoices.corrective,
  queueCorrectiveInvoiceJob: invoices.queue,
  isRetryableStornoError: () => false,
  isRetryableCorrectiveError: () => false,
}))

const ORDER_NUMBER = 'SYNTHETIC-REFUND-001'
const PAYMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const TRANSACTION_ID = 'synthetic-refund-transaction'
const TOTAL_HUF = 20000
const DUMMY_RAW_ERROR = 'DUMMY-SECRET-IN-STORAGE-ERROR-NOT-A-REAL-SECRET'
const logLines: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  logLines.length = 0
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(' '))
  })
  vi.stubEnv('BARION_API_URL', 'https://api.test.barion.com')
  vi.stubEnv('BARION_PAYEE_EMAIL', 'synthetic@example.test')
  vi.stubEnv('BARION_POSKEY_TEST', 'DUMMY-POSKEY-NOT-A-REAL-SECRET')
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://shop.example.test')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

interface Write {
  collection: string
  id: number | string
  data: Record<string, unknown>
}

function fixture(partialAlreadyRefunded = 0) {
  const previousEntries =
    partialAlreadyRefunded === 0
      ? []
      : [
          {
            transactionId: TRANSACTION_ID,
            amountHuf: partialAlreadyRefunded,
            status: 'PartiallyRefunded',
            refundedAt: '2026-08-01T10:00:00.000Z',
            type: 'partial',
          },
        ]
  const order = {
    id: 555,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    totalHufSnapshot: TOTAL_HUF,
    amount: TOTAL_HUF,
    barionPaymentId: PAYMENT_ID,
    customer: 7,
    items: [{ product: 42, quantity: 1 }],
    refunds: previousEntries,
    invoiceNumber: 'SYNTHETIC-INVOICE-1',
    invoiceStatus: 'issued',
  } as unknown as Order
  const customer = {
    id: 7,
    role: 'customer',
    purchases: [42, 99],
    accessGrants: [],
  } as unknown as User
  const state = {
    userWriteError: undefined as unknown,
    orderWriteError: undefined as unknown,
    providerStatus: 'Refunded',
    blockProvider: false,
    acknowledgedOrderWrites: 0,
    writes: [] as Write[],
  }
  const payload = {
    // Inert transaction callbacks model lock use, not database rollback or serialization.
    db: {
      drizzle: {
        transaction: async (run: (tx: unknown) => Promise<unknown>) =>
          run({ execute: async () => [] }),
      },
    },
    auth: vi.fn(async () => ({ user: { id: 1, role: 'owner' } })),
    find: vi.fn(async ({ where }: { where?: { orderNumber?: { equals?: string } } }) =>
      where?.orderNumber?.equals === ORDER_NUMBER
        ? { docs: [structuredClone(order)], totalDocs: 1 }
        : { docs: [], totalDocs: 0 },
    ),
    findByID: vi.fn(async () => structuredClone(customer)),
    update: vi.fn(async (write: Write) => {
      state.writes.push(structuredClone(write))
      if (write.collection === 'orders') {
        if (state.orderWriteError !== undefined) throw state.orderWriteError
        Object.assign(order, structuredClone(write.data))
        state.acknowledgedOrderWrites += 1
      } else if (write.collection === 'users') {
        if (state.userWriteError !== undefined) throw state.userWriteError
        Object.assign(customer, structuredClone(write.data))
      } else {
        throw new Error('Unexpected collection update in refund fixture')
      }
      return structuredClone(write.data)
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data })),
    jobs: { queue: vi.fn(async () => ({ id: 1 })) },
  }
  const provider = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (state.blockProvider) throw new Error('Unexpected provider call on terminal retry')
    const endpoint = String(url)
    if (endpoint.endsWith(`/v4/Payment/${PAYMENT_ID}/PaymentState`)) {
      return Response.json({
        PaymentId: PAYMENT_ID,
        Status: 'Succeeded',
        Total: TOTAL_HUF,
        Transactions: [
          {
            TransactionId: TRANSACTION_ID,
            Total: TOTAL_HUF,
            Status: 'Succeeded',
            TransactionType: 'CardPayment',
          },
        ],
        Errors: [],
      })
    }
    if (!endpoint.endsWith('/v2/Payment/Refund')) throw new Error('Unexpected provider endpoint')
    const request = JSON.parse(String(init?.body)) as {
      TransactionsToRefund: Array<{ AmountToRefund: number }>
    }
    return Response.json({
      PaymentId: PAYMENT_ID,
      RefundedTransactions: [
        {
          TransactionId: TRANSACTION_ID,
          AmountToRefund: request.TransactionsToRefund[0]?.AmountToRefund,
          Status: state.providerStatus,
        },
      ],
      Errors: [],
    })
  })
  vi.stubGlobal('fetch', provider)
  const localPayload = payload as unknown as Payload
  const run = (input: { amountHuf?: number; reason?: string } = {}) =>
    refundOrder({
      payload: localPayload,
      orderNumber: ORDER_NUMBER,
      input,
      actor: { id: 1, role: 'owner' } as User,
    })
  const handler = createRefundHandler({ getPayload: async () => localPayload })
  const route = () =>
    handler(
      new Request(`https://shop.example.test/api/admin/orders/${ORDER_NUMBER}/refund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://shop.example.test' },
        body: JSON.stringify({ reason: 'Vevői reklamáció' }),
      }),
      { params: Promise.resolve({ orderNumber: ORDER_NUMBER }) },
    )
  return { order, customer, state, provider, payload, run, route, previousEntries }
}

function expectNoDocuments() {
  expect(invoices.storno).not.toHaveBeenCalled()
  expect(invoices.corrective).not.toHaveBeenCalled()
  expect(invoices.queue).not.toHaveBeenCalled()
}

function expectRecordedCleanupMessage(message: string) {
  expect(message).toContain('visszatérítés már rögzítve van')
  expect(message).toContain('hozzáférések rendezésének eredménye nem igazolt')
  expect(message).toContain('Ne indíts új pénzvisszatérítést')
  expect(message).toContain('Kézi ellenőrzés és rendezés szükséges')
  expect(message).not.toContain(DUMMY_RAW_ERROR)
}

describe('acknowledged refund with failed cleanup: reporting only, recovery remains unresolved', () => {
  it.each([0, 5000])(
    'reports 503 after a durable closing refund (previous partial: %i)',
    async (partial) => {
      const f = fixture(partial)
      f.state.userWriteError = new Error(DUMMY_RAW_ERROR)

      const error = await f.run({ reason: 'Vevői reklamáció' }).catch((caught: unknown) => caught)

      expect(f.state.acknowledgedOrderWrites).toBe(1)
      expect(f.order.status).toBe('refunded')
      expect(f.order.refundReason).toBe('Vevői reklamáció')
      expect(f.customer.purchases).toEqual([42, 99])
      const entries = readRefundEntries(f.order)
      expect(entries).toHaveLength(partial === 0 ? 1 : 2)
      expect(entries.slice(0, -1)).toEqual(f.previousEntries)
      expect(entries.at(-1)).toMatchObject({
        transactionId: TRANSACTION_ID,
        amountHuf: TOTAL_HUF - partial,
        status: 'Refunded',
        type: 'full',
        refundedAt: f.order.refundedAt,
      })
      const savedOrder = structuredClone(f.order)
      const providerCalls = f.provider.mock.calls.length
      const attemptedWrites = structuredClone(f.state.writes)
      f.state.userWriteError = undefined
      f.state.blockProvider = true

      // Ordinary retry remains a terminal rejection, NOT an entitlement repair.
      await expect(f.run()).rejects.toMatchObject({ name: 'RefundError', status: 409 })
      expect(f.provider).toHaveBeenCalledTimes(providerCalls)
      expect(f.state.writes).toEqual(attemptedWrites)
      expect(f.order).toEqual(savedOrder)
      expect(f.customer.purchases).toEqual([42, 99])
      expect(f.payload.create).not.toHaveBeenCalled()
      expect(f.payload.jobs.queue).not.toHaveBeenCalled()
      expectNoDocuments()
      expect(error).toBeInstanceOf(RefundError)
      expect(error).toMatchObject({ status: 503 })
      expectRecordedCleanupMessage((error as RefundError).message)
    },
  )

  it('the actual route returns truthful 503, then no-op 409, without exposing the storage error', async () => {
    const f = fixture()
    const storageError = new Error(DUMMY_RAW_ERROR)
    storageError.name = DUMMY_RAW_ERROR
    f.state.userWriteError = storageError

    const response = await f.route()
    const body = (await response.json()) as { error: string }
    const savedOrder = structuredClone(f.order)
    const writes = structuredClone(f.state.writes)
    const calls = f.provider.mock.calls.length
    f.state.userWriteError = undefined
    f.state.blockProvider = true
    const repeat = await f.route()

    expect(repeat.status).toBe(409)
    expect(f.provider).toHaveBeenCalledTimes(calls)
    expect(f.state.writes).toEqual(writes)
    expect(f.order).toEqual(savedOrder)
    expect(f.customer.purchases).toEqual([42, 99])
    expectNoDocuments()
    expect(response.status).toBe(503)
    expectRecordedCleanupMessage(body.error)
    const logs = logLines.join('\n')
    expect(logs).not.toContain(DUMMY_RAW_ERROR)
    expect(logs).not.toContain('DUMMY-POSKEY-NOT-A-REAL-SECRET')
    expect(logLines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        level: 'error',
        orderId: 555,
        orderNumber: ORDER_NUMBER,
        context: expect.objectContaining({
          phase: 'purchase-revocation',
          financialRecordPersisted: true,
          refundStatusOutcome: 'succeeded',
          errorKind: 'error',
        }),
      }),
    )
  })

  it('sanitizes non-Error cleanup failures too', async () => {
    const f = fixture()
    f.state.userWriteError = DUMMY_RAW_ERROR
    await expect(f.run()).rejects.toMatchObject({ name: 'RefundError', status: 503 })
    expect(logLines.join('\n')).not.toContain(DUMMY_RAW_ERROR)
    expect(logLines.join('\n')).toContain('"errorKind":"non-error"')
  })

  it('does not call an unknown provider outcome a successful refund when cleanup fails', async () => {
    const f = fixture()
    f.state.providerStatus = 'UnknownFutureStatus'
    f.state.userWriteError = new Error(DUMMY_RAW_ERROR)

    const response = await f.route()
    const body = (await response.json()) as { error: string }

    expect(f.state.acknowledgedOrderWrites).toBe(1)
    expect(readRefundEntries(f.order)[0]?.status).toBe('UnknownFutureStatus')
    expect(f.customer.purchases).toEqual([42, 99])
    expectNoDocuments()
    expect(response.status).toBe(503)
    expect(body.error).toContain('visszatérítési kísérlet már rögzítve van')
    expect(body.error).toContain('Barion nem igazolta a sikerét')
    expect(body.error).toContain('Ne indíts új pénzvisszatérítést')
    expect(body.error).not.toContain('visszatérítés már rögzítve van')
    expect(logLines.join('\n')).not.toContain(DUMMY_RAW_ERROR)
    expect(logLines.join('\n')).toContain('"refundStatusOutcome":"unknown"')
  })
})

describe('unchanged monetary, purchase and document behavior', () => {
  it('happy full refund still succeeds, removes only its purchase and selects storno', async () => {
    const f = fixture()
    const response = await f.route()
    expect(response.status).toBe(200)
    expect(f.order.status).toBe('refunded')
    expect(f.customer.purchases).toEqual([99])
    expect(f.provider).toHaveBeenCalledTimes(2)
    expect(f.payload.create).toHaveBeenCalledTimes(1)
    expect(invoices.storno).toHaveBeenCalledTimes(1)
    expect(invoices.corrective).not.toHaveBeenCalled()
  })

  it('partial refund still leaves purchases untouched and selects corrective', async () => {
    const f = fixture()
    f.state.providerStatus = 'PartiallyRefunded'
    f.state.userWriteError = new Error('Partial refund must not attempt a user write')
    const result = await f.run({ amountHuf: 5000 })
    expect(result).toMatchObject({ type: 'partial', orderStatus: 'paid', amountHuf: 5000 })
    expect(f.order.status).toBe('paid')
    expect(f.customer.purchases).toEqual([42, 99])
    expect(f.state.writes.map((write) => write.collection)).toEqual(['orders'])
    expect(invoices.corrective).toHaveBeenCalledTimes(1)
    expect(invoices.storno).not.toHaveBeenCalled()
  })

  it('a happy closing partial still removes access and selects corrective, not storno', async () => {
    const f = fixture(5000)
    const result = await f.run()
    expect(result).toMatchObject({ type: 'full', amountHuf: 15000, alreadyRefundedHuf: 5000 })
    expect(readRefundEntries(f.order)).toHaveLength(2)
    expect(f.customer.purchases).toEqual([99])
    expect(f.provider).toHaveBeenCalledTimes(1)
    expect(invoices.corrective).toHaveBeenCalledTimes(1)
    expect(invoices.storno).not.toHaveBeenCalled()
  })

  it('unknown full outcome with successful cleanup retains its existing unknown result', async () => {
    const f = fixture()
    f.state.providerStatus = 'UnknownFutureStatus'
    const result = await f.run()
    expect(result).toMatchObject({ orderStatus: 'refunded', refundStatusOutcome: 'unknown' })
    expect(f.customer.purchases).toEqual([99])
    expectNoDocuments()
  })

  it('unacknowledged order-write failure is not wrapped as persisted cleanup failure', async () => {
    const f = fixture()
    const error = new Error('synthetic-order-write-failure')
    f.state.orderWriteError = error
    await expect(f.run()).rejects.toBe(error)
    expect(f.state.acknowledgedOrderWrites).toBe(0)
    expect(f.order.status).toBe('paid')
    expect(readRefundEntries(f.order)).toEqual([])
    expect(f.customer.purchases).toEqual([42, 99])
    expect(f.state.writes.map((write) => write.collection)).toEqual(['orders'])
    expect(f.payload.findByID).not.toHaveBeenCalled()
    expectNoDocuments()
    expect(logLines.join('\n')).not.toContain('"financialRecordPersisted":true')
  })

  it('the actual route keeps generic 500 for an unacknowledged order write', async () => {
    const f = fixture()
    f.state.orderWriteError = new Error('synthetic-order-write-failure')
    const response = await f.route()
    const body = (await response.json()) as { error: string }
    expect(response.status).toBe(500)
    expect(body.error).not.toContain('már rögzítve van')
    expect(body.error).not.toContain('synthetic-order-write-failure')
    expect(f.state.acknowledgedOrderWrites).toBe(0)
    expect(f.payload.findByID).not.toHaveBeenCalled()
    expectNoDocuments()
  })
})
