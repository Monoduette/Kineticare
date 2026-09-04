import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BarionApiError, type BarionErrorKind } from '../lib/barion'
import {
  RefundError,
  type RefundOrderOptions,
  type RefundOrderResult,
} from '../lib/refund/refund-order'
import { createRefundHandler } from '../lib/refund/route-handler'
import type { Order, User } from '../payload-types'

const service = vi.hoisted(() => ({
  run: vi.fn<(options: RefundOrderOptions) => Promise<RefundOrderResult>>(),
}))
const documents = vi.hoisted(() => ({
  storno: vi.fn(),
  corrective: vi.fn(),
  queue: vi.fn(),
}))

vi.mock('../lib/refund/refund-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/refund/refund-order')>()),
  refundOrder: service.run,
}))
vi.mock('../lib/szamlazz', () => ({
  issueStornoForOrder: documents.storno,
  issueCorrectiveInvoiceForOrder: documents.corrective,
  queueCorrectiveInvoiceJob: documents.queue,
  isRetryableStornoError: () => false,
  isRetryableCorrectiveError: () => false,
}))

const DUMMY_RAW_ERROR = 'DUMMY-RAW-STORAGE-OR-PROVIDER-ERROR-NOT-A-SECRET'
const ORIGIN = 'https://shop.example.test'
const ORDER_NUMBER = 'SYNTHETIC-OUTCOME-001'
const PAYMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const logs: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  service.run.mockReset()
  logs.length = 0
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', ORIGIN)
  vi.stubEnv('BARION_API_URL', 'https://api.test.barion.com')
  vi.stubEnv('BARION_PAYEE_EMAIL', 'synthetic@example.test')
  vi.stubEnv('BARION_POSKEY_TEST', 'DUMMY-POSKEY-NOT-A-REAL-SECRET')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected external call in route contract test')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function request(body = '{}', origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/admin/orders/${ORDER_NUMBER}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body,
  })
}

const context = () => ({ params: Promise.resolve({ orderNumber: ORDER_NUMBER }) })

function handler(role: string | null = 'owner') {
  const payload = {
    auth: vi.fn(async () => ({ user: role === null ? null : { id: 1, role } })),
  } as unknown as Payload
  return createRefundHandler({ getPayload: async () => payload })
}

async function expectManualReview(response: Response, status: number) {
  expect(response.status).toBe(status)
  const body = (await response.json()) as { error: string; manualReviewRequired?: boolean }
  expect(body.manualReviewRequired).toBe(true)
  expect(body.error).toContain('Ne ind\u00edts \u00faj p\u00e9nzvisszat\u00e9r\u00edt\u00e9st')
  expect(body.error).toMatch(/k\u00e9zi/i)
  expect(body.error).not.toMatch(/nem v\u00e1ltozott|v\u00e1ltozatlan|pr\u00f3b\u00e1ld \u00fajra/i)
  expect(body.error).not.toContain(DUMMY_RAW_ERROR)
  return body
}

describe('refund route manual-review contract', () => {
  it.each<BarionErrorKind>(['timeout', 'network', 'http', 'provider', 'invalid_response'])(
    'Barion %s preserves status without claiming no effect or logging raw details',
    async (kind) => {
      service.run.mockRejectedValue(
        new BarionApiError({
          kind,
          message: DUMMY_RAW_ERROR,
          endpoint: DUMMY_RAW_ERROR,
          httpStatus: 400,
          providerErrors: [
            { ErrorCode: DUMMY_RAW_ERROR, Title: DUMMY_RAW_ERROR, Description: DUMMY_RAW_ERROR },
          ],
        }),
      )
      await expectManualReview(
        await handler()(request(), context()),
        kind === 'timeout' ? 504 : 502,
      )
      expect(logs.join('\n')).not.toContain(DUMMY_RAW_ERROR)
      expect(logs.join('\n')).not.toContain('v\u00e1ltozatlan')
    },
  )

  it.each([500, 502, 504, 599])(
    'normalizes service RefundError %i as manual review',
    async (status) => {
      service.run.mockRejectedValue(new RefundError(status, DUMMY_RAW_ERROR))
      await expectManualReview(await handler()(request(), context()), status)
      expect(logs.join('\n')).not.toContain(DUMMY_RAW_ERROR)
    },
  )

  it.each([
    new Error(DUMMY_RAW_ERROR),
    DUMMY_RAW_ERROR,
    {
      toString: () => {
        throw new Error('Do not serialize unknown errors')
      },
    },
  ])(
    'generic failures remain conservative 500 without inspecting raw errors: %#',
    async (error) => {
      service.run.mockRejectedValue(error)
      const body = await expectManualReview(await handler()(request(), context()), 500)
      expect(body.error).not.toContain('m\u00e1r r\u00f6gz\u00edtve van')
      expect(logs.join('\n')).not.toContain(DUMMY_RAW_ERROR)
    },
  )

  it.each([400, 401, 403, 404, 409])('preserves service %i JSON exactly', async (status) => {
    service.run.mockRejectedValue(new RefundError(status, 'synthetic-business-error'))
    const response = await handler()(request(), context())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'synthetic-business-error' })
  })

  it.each([
    [null, 401],
    ['staff', 403],
    ['customer', 403],
  ] as const)('preserves role %s rejection %i before service execution', async (role, status) => {
    const response = await handler(role)(request(), context())
    expect(response.status).toBe(status)
    expect(await response.json()).not.toHaveProperty('manualReviewRequired')
    expect(service.run).not.toHaveBeenCalled()
  })

  it('preserves foreign-origin rejection before service execution', async () => {
    const response = await handler()(request('{}', 'https://foreign.example.test'), context())
    expect(response.status).toBe(403)
    expect(await response.json()).not.toHaveProperty('manualReviewRequired')
    expect(service.run).not.toHaveBeenCalled()
  })

  it('preserves malformed JSON 400 before service execution', async () => {
    const response = await handler()(request('{'), context())
    expect(response.status).toBe(400)
    expect(await response.json()).not.toHaveProperty('manualReviewRequired')
    expect(service.run).not.toHaveBeenCalled()
  })

  it('preserves successful service JSON without the manual-review flag', async () => {
    const result = { type: 'full', refundStatusOutcome: 'succeeded' }
    service.run.mockResolvedValue(result as unknown as RefundOrderResult)
    const response = await handler()(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
  })
})

type LostAcknowledgement = 'provider-network' | 'provider-timeout' | 'order' | 'user'

function lostAcknowledgementFixture(failure: LostAcknowledgement) {
  const order = {
    id: 555,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    totalHufSnapshot: 20000,
    amount: 20000,
    barionPaymentId: PAYMENT_ID,
    customer: 7,
    items: [{ product: 42, quantity: 1 }],
    refunds: [],
  } as unknown as Order
  const customer = { id: 7, purchases: [42, 99] } as unknown as User
  const effects = { providerRefunds: 0 }
  const payload = {
    // Synthetic committed writes followed by rejection; not real DB transaction evidence.
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
    update: vi.fn(async (write: { collection: string; data: Record<string, unknown> }) => {
      if (write.collection === 'orders') {
        Object.assign(order, structuredClone(write.data))
        if (failure === 'order') throw new Error(DUMMY_RAW_ERROR)
      } else if (write.collection === 'users') {
        Object.assign(customer, structuredClone(write.data))
        if (failure === 'user') throw new Error(DUMMY_RAW_ERROR)
      } else {
        throw new Error('Unexpected collection')
      }
      return structuredClone(write.data)
    }),
    create: vi.fn(),
    jobs: { queue: vi.fn() },
  }
  const provider = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/PaymentState')) {
      return Response.json({
        PaymentId: PAYMENT_ID,
        Status: 'Succeeded',
        Total: 20000,
        Transactions: [
          {
            TransactionId: 'synthetic-transaction',
            Total: 20000,
            Status: 'Succeeded',
            TransactionType: 'CardPayment',
          },
        ],
        Errors: [],
      })
    }
    if (!String(url).endsWith('/v2/Payment/Refund')) throw new Error('Unexpected endpoint')
    effects.providerRefunds += 1
    if (failure.startsWith('provider-')) {
      const error = new Error(DUMMY_RAW_ERROR)
      error.name = failure === 'provider-timeout' ? 'TimeoutError' : 'TypeError'
      throw error
    }
    return Response.json({
      PaymentId: PAYMENT_ID,
      RefundedTransactions: [
        { TransactionId: 'synthetic-transaction', AmountToRefund: 20000, Status: 'Refunded' },
      ],
      Errors: [],
    })
  })
  vi.stubGlobal('fetch', provider)
  return {
    order,
    customer,
    effects,
    payload,
    provider,
    POST: createRefundHandler({ getPayload: async () => payload as unknown as Payload }),
  }
}

describe('actual service and route with modeled lost acknowledgements', () => {
  it.each([
    ['provider-network', 502],
    ['provider-timeout', 504],
    ['order', 500],
    ['user', 503],
  ] as const)('%s outcome is unverified, not proof of no effect', async (failure, status) => {
    const actual = await vi.importActual<typeof import('../lib/refund/refund-order')>(
      '../lib/refund/refund-order',
    )
    service.run.mockImplementation(actual.refundOrder)
    const f = lostAcknowledgementFixture(failure)
    const body = await expectManualReview(await f.POST(request(), context()), status)
    expect(f.effects.providerRefunds).toBe(1)
    expect(f.provider).toHaveBeenCalledTimes(2)
    expect(f.payload.create).not.toHaveBeenCalled()
    expect(f.payload.jobs.queue).not.toHaveBeenCalled()
    expect(documents.storno).not.toHaveBeenCalled()
    expect(documents.corrective).not.toHaveBeenCalled()
    expect(documents.queue).not.toHaveBeenCalled()
    if (failure.startsWith('provider-')) {
      expect(f.order.status).toBe('paid')
      expect(f.payload.update).not.toHaveBeenCalled()
    } else {
      expect(f.order.status).toBe('refunded')
      expect(f.order.refunds).toHaveLength(1)
    }
    expect(f.customer.purchases).toEqual(failure === 'user' ? [99] : [42, 99])
    if (failure === 'user') {
      expect(body.error).toContain('m\u00e1r r\u00f6gz\u00edtve van')
      expect(body.error).toContain('eredm\u00e9nye nem igazolt')
      expect(body.error).not.toContain('nem fejez\u0151d\u00f6tt be')
    } else {
      expect(body.error).not.toContain('m\u00e1r r\u00f6gz\u00edtve van')
    }
  })
})
