import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRefundHandler, createRefundRecoveryStatusHandler } from '../lib/refund/route-handler'

const service = vi.hoisted(() => ({ refund: vi.fn(), status: vi.fn(), recover: vi.fn() }))
vi.mock('../lib/refund/refund-order', async (original) => ({
  ...(await original<typeof import('../lib/refund/refund-order')>()),
  refundOrder: service.refund,
}))
vi.mock('../lib/refund/refund-recovery', () => ({
  getRefundRecoveryStatus: service.status,
  recoverRefundOrder: service.recover,
}))

const ORIGIN = 'https://synthetic.example.test'
const ORDER = 'SYNTHETIC-RECOVERY-001'
const context = (orderNumber = ORDER) => ({ params: Promise.resolve({ orderNumber }) })

function fixture(role: string | null = 'owner') {
  const actor = role ? { id: 1, role } : null
  const auth = vi.fn(async () => ({ user: actor }))
  const payload = { auth } as unknown as Payload
  const getPayload = vi.fn(async () => payload)
  return {
    payload,
    actor,
    auth,
    getPayload,
    GET: createRefundRecoveryStatusHandler({ getPayload }),
    POST: createRefundHandler({ getPayload }),
  }
}

function request(method = 'GET', body?: unknown, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/admin/orders/${ORDER}/refund`, {
    method,
    headers: { origin, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', ORIGIN)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External transport forbidden')
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('persisted refund recovery route', () => {
  it('forwards a keyed GET only through authenticated service arguments', async () => {
    const key = 'A'.repeat(43)
    const f = fixture()
    const req = request()
    req.headers.set('X-Refund-Operation-Key', key)
    service.status.mockResolvedValue({
      orderNumber: ORDER,
      state: 'clear',
      operationState: 'completed',
      message: 'Synthetic status',
    })
    const response = await f.GET(req, context())
    expect(service.status).toHaveBeenCalledExactlyOnceWith({
      payload: f.payload,
      orderNumber: ORDER,
      operationKey: key,
    })
    expect(req.url).not.toContain(key)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ operationState: 'completed' })
  })
  it.each(['clear', 'manual_review', 'recoverable'])(
    'returns owner-only %s status without mutations',
    async (state) => {
      const f = fixture()
      const result = { orderNumber: ORDER, state, message: 'Synthetic status' }
      service.status.mockResolvedValue(result)
      const response = await f.GET(request(), context())
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual(result)
      expect(service.status).toHaveBeenCalledWith({ payload: f.payload, orderNumber: ORDER })
      expect(f.auth.mock.invocationCallOrder[0]).toBeLessThan(
        service.status.mock.invocationCallOrder[0]!,
      )
      expect(service.refund).not.toHaveBeenCalled()
      expect(service.recover).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each([
    [null, 401],
    ['staff', 403],
    ['customer', 403],
  ] as const)('rejects %s before status lookup and recovery', async (role, code) => {
    const f = fixture(role)
    const get = await f.GET(request(), context())
    expect(get.status).toBe(code)
    expect(get.headers.get('cache-control')).toBe('no-store')
    expect((await f.POST(request('POST', { action: 'recover' }), context())).status).toBe(code)
    expect(service.status).not.toHaveBeenCalled()
    expect(service.recover).not.toHaveBeenCalled()
    expect(service.refund).not.toHaveBeenCalled()
  })

  it('rejects foreign origin before authentication or recovery effects', async () => {
    const f = fixture()
    expect(
      (
        await f.POST(
          request('POST', { action: 'recover' }, 'https://foreign.example.test'),
          context(),
        )
      ).status,
    ).toBe(403)
    expect(f.getPayload).not.toHaveBeenCalled()
    expect(service.recover).not.toHaveBeenCalled()
  })

  it.each(['completed', 'manual_review'])(
    'dispatches explicit recovery and preserves %s',
    async (recoveryStatus) => {
      const f = fixture()
      const result = { orderNumber: ORDER, recoveryStatus, message: 'Synthetic recovery' }
      service.recover.mockResolvedValue(result)
      const response = await f.POST(request('POST', { action: 'recover' }), context())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(result)
      expect(service.recover).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: f.payload,
          actor: f.actor,
          orderNumber: ORDER,
          headers: expect.any(Headers),
        }),
      )
      expect(f.auth.mock.invocationCallOrder[0]).toBeLessThan(
        service.recover.mock.invocationCallOrder[0]!,
      )
      expect(service.refund).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each([
    { action: 'refund' },
    { action: '' },
    { action: null },
    { action: false },
    { action: 'recover', amountHuf: 1 },
    { action: 'recover', amountHuf: null },
    { action: 'recover', reason: 'synthetic' },
    { action: 'recover', unknown: 1 },
  ])('rejects unsupported or mixed action: %j', async (body) => {
    expect((await fixture().POST(request('POST', body), context())).status).toBe(400)
    expect(service.refund).not.toHaveBeenCalled()
    expect(service.recover).not.toHaveBeenCalled()
  })

  it('does not look up blank order status', async () => {
    const response = await fixture().GET(request(), context(' '))
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(service.status).not.toHaveBeenCalled()
  })

  it('fails closed without leaking storage error details', async () => {
    service.status.mockRejectedValue(new Error('SYNTHETIC-PRIVATE-DETAIL'))
    const response = await fixture().GET(request(), context())
    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('SYNTHETIC-PRIVATE-DETAIL')
  })
})
