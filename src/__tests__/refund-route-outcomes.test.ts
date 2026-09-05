import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Register the shared storage/transport mocks before importing the real service graph.
import { fixture as durableFixture, provider, documents, store, access } from './refund-fixture'
import { BarionApiError, type BarionErrorKind } from '../lib/barion'
import {
  RefundError,
  type RefundOrderOptions,
  type RefundOrderResult,
} from '../lib/refund/refund-order'
import { createRefundHandler } from '../lib/refund/route-handler'

const service = vi.hoisted(() => ({
  run: vi.fn<(options: RefundOrderOptions) => Promise<RefundOrderResult>>(),
}))

vi.mock('../lib/refund/refund-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/refund/refund-order')>()),
  refundOrder: service.run,
}))

const DUMMY_RAW_ERROR = 'DUMMY-RAW-STORAGE-OR-PROVIDER-ERROR-NOT-A-SECRET'
const ORIGIN = 'https://shop.example.test'
const ORDER_NUMBER = 'SYNTHETIC-OUTCOME-001'
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
  const f = durableFixture()
  f.order.orderNumber = ORDER_NUMBER
  const effects = { providerRefunds: 0 }
  const originalRefund = provider.refund.getMockImplementation()!
  provider.refund.mockImplementation(async (input) => {
    // The shared fixture proves the durable claim and baseline precede submission.
    const response = await originalRefund(input)
    effects.providerRefunds += 1
    if (failure.startsWith('provider-')) {
      throw new BarionApiError({
        kind: failure === 'provider-timeout' ? 'timeout' : 'network',
        message: DUMMY_RAW_ERROR,
        endpoint: '/v2/Payment/Refund',
      })
    }
    return response
  })
  const originalUpdate = vi.mocked(f.payload.update).getMockImplementation()!
  const update = vi.fn(async (write: Parameters<Payload['update']>[0]) => {
    const result = await originalUpdate(write)
    if (failure === 'order' && write.collection === 'orders') throw new Error(DUMMY_RAW_ERROR)
    return result
  })
  Object.assign(f.payload, { update })
  const originalCleanup = access.apply.getMockImplementation()!
  access.apply.mockImplementation(async (...args) => {
    const result = await originalCleanup(...args)
    if (failure === 'user') throw new Error(DUMMY_RAW_ERROR)
    return result
  })
  return { ...f, effects, update, POST: createRefundHandler({ getPayload: async () => f.payload }) }
}

describe('actual service and route with durable claims and modeled lost acknowledgements', () => {
  it.each(['provider-network', 'provider-timeout', 'order', 'user'] as const)(
    '%s after possible effects returns 503 and retains the claim against a second monetary attempt',
    async (failure) => {
      const actual = await vi.importActual<typeof import('../lib/refund/refund-order')>(
        '../lib/refund/refund-order',
      )
      service.run.mockImplementation(actual.refundOrder)
      const f = lostAcknowledgementFixture(failure)
      const operationKey = 'A'.repeat(43)
      const response = await f.POST(request(JSON.stringify({ operationKey })), context())
      const failureResult: unknown = await service.run.mock.results
        .at(-1)
        ?.value.catch((error: unknown) => error)
      expect(
        failureResult,
        failureResult instanceof Error ? failureResult.stack : undefined,
      ).toMatchObject({ status: 503 })
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body).toEqual({ error: expect.any(String), manualReviewRequired: true })
      expect(body.error).toContain('Ne indíts új pénzvisszatérítést')
      expect(body.error).not.toContain(DUMMY_RAW_ERROR)
      expect(logs.join('\n')).not.toContain(DUMMY_RAW_ERROR)
      expect(f.effects.providerRefunds).toBe(1)
      expect(provider.refund).toHaveBeenCalledTimes(1)
      expect(provider.state).toHaveBeenCalledTimes(1)
      expect(f.audits.some((audit) => audit.action === 'refund-prepared')).toBe(true)
      expect(store.intents.get(f.payload)?.activeOrderKey).toBeTruthy()
      expect(store.intents.get(f.payload)?.state).not.toBe('committed')
      expect(fetch).not.toHaveBeenCalled()
      // Recovery phases are independent: a lost cleanup acknowledgement does not skip invoices.
      expect(documents.storno).toHaveBeenCalledTimes(failure === 'user' ? 1 : 0)
      if (failure === 'user') {
        expect(f.order.stornoNumber).toBe('SYNTHETIC-ST')
        expect(f.audits.some((audit) => audit.action === 'refund-cleanup-done')).toBe(true)
        expect(f.audits.some((audit) => audit.action === 'refund-invoice-done')).toBe(true)
      }
      expect(documents.corrective).not.toHaveBeenCalled()
      expect(documents.queue).not.toHaveBeenCalled()
      if (failure.startsWith('provider-')) {
        expect(f.order.status).toBe('paid')
        expect(f.update).not.toHaveBeenCalled()
        expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
      } else {
        // These mocks commit the order/user write and then lose its acknowledgement.
        expect(f.order.status).toBe('refunded')
        expect(f.order.refunds).toHaveLength(1)
      }
      expect(f.user.purchases).toEqual(failure === 'user' ? [99] : [42, 99])
      const retry = await f.POST(request(JSON.stringify({ operationKey })), context())
      expect(retry.status).toBe(503)
      expect(provider.refund).toHaveBeenCalledTimes(1)
      expect(provider.state).toHaveBeenCalledTimes(1)
      expect(f.effects.providerRefunds).toBe(1)
      expect(documents.storno).toHaveBeenCalledTimes(failure === 'user' ? 1 : 0)
    },
  )

  it('rejects a keyless direct API call before any lookup, claim, or provider request', async () => {
    const actual = await vi.importActual<typeof import('../lib/refund/refund-order')>(
      '../lib/refund/refund-order',
    )
    service.run.mockImplementation(actual.refundOrder)
    const f = durableFixture()
    const POST = createRefundHandler({ getPayload: async () => f.payload })
    expect((await POST(request(), context())).status).toBe(400)
    expect(f.payload.find).not.toHaveBeenCalled()
    expect(store.intents.size).toBe(0)
    expect(f.audits).toEqual([])
    expect(provider.state).not.toHaveBeenCalled()
    expect(provider.refund).not.toHaveBeenCalled()
  })
})
