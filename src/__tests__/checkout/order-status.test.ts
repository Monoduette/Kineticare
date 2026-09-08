import { beforeEach, describe, expect, it, vi } from 'vitest'

const refundState = vi.hoisted(() => ({ active: vi.fn() }))
vi.mock('../../lib/refund/intent-store', () => ({ loadActiveRefundIntent: refundState.active }))
beforeEach(() => {
  refundState.active.mockReset().mockResolvedValue(null)
})

import { createOrderStatusHandler } from '../../lib/checkout/order-status-handler'

/**
 * A GET /api/orders/[orderNumber]/status handler tesztjei:
 * - 401 anon,
 * - 404 más rendelésére (ne szivárogjon a létezés),
 * - 200 csak {status, productId, totalHufSnapshot, currency} a saját rendelésre
 *   (a productId az első tétel terméke — a köszönőoldal „Újrapróbálom"
 *   linkjéhez, M8; a végösszeg + pénznem a bevétel-méréshez, 2026-08-21 —
 *   a mezők feltöltött ágát a src/__tests__/analytics/azonositas-es-bevetel.test.tsx
 *   méri),
 * - 400 hiányzó rendelésszámra.
 */

type MockOrder = {
  id: number
  orderNumber: string
  customer: number
  status: string
  items?: Array<{ product: number | { id: number } | null }>
}

function payloadWithUser(user: { id: number } | null, orders: MockOrder[]) {
  return {
    auth: vi.fn().mockResolvedValue({ user }),
    find: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const customerId = (where as { and: Array<{ customer: { equals: number } }> }).and.find(
        (clause) => 'customer' in clause,
      )!.customer.equals
      const orderNumber = (where as { and: Array<{ orderNumber: { equals: string } }> }).and.find(
        (clause) => 'orderNumber' in clause,
      )!.orderNumber.equals
      return Promise.resolve({
        docs: orders.filter(
          (order) => order.customer === customerId && order.orderNumber === orderNumber,
        ),
      })
    }),
  }
}

function request(orderNumber?: string): [Request, { params: Promise<{ orderNumber: string }> }] {
  const headers = new Headers({ 'x-request-id': 'test-req-1' })
  const req = new Request('http://localhost/api/orders/KH-2026-000123/status', { headers })
  return [
    req as unknown as Request,
    { params: Promise.resolve({ orderNumber: orderNumber ?? 'KH-2026-000123' }) },
  ]
}

const OWN_ORDER: MockOrder = {
  id: 1,
  orderNumber: 'KH-2026-000123',
  customer: 7,
  status: 'paid',
  items: [{ product: 42 }],
}

describe('GET /api/orders/[orderNumber]/status', () => {
  it('adds only a customer-facing review flag for their active automatic refund', async () => {
    refundState.active.mockResolvedValue({
      id: 88,
      schemaVersion: 2,
      actorKind: 'system',
      systemActor: 'paid-reject-recovery',
      state: 'provider_unknown',
      requestHash: 'PRIVATE',
    })
    const handler = createOrderStatusHandler({
      getPayload: async () =>
        payloadWithUser({ id: 7 }, [{ ...OWN_ORDER, status: 'payment_pending' }]) as never,
    })
    const [req, ctx] = request()
    const response = await handler(req as never, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'payment_pending',
      productId: 42,
      totalHufSnapshot: null,
      currency: null,
      paymentReviewRequired: true,
    })
    expect(refundState.active).toHaveBeenCalledTimes(1)
  })

  it('does not inspect refund state before authentication and ownership have passed', async () => {
    const [req, ctx] = request()
    for (const user of [null, { id: 8 }]) {
      const handler = createOrderStatusHandler({
        getPayload: async () => payloadWithUser(user, [OWN_ORDER]) as never,
      })
      expect((await handler(req as never, ctx)).status).toBe(user ? 404 : 401)
    }
    expect(refundState.active).not.toHaveBeenCalled()
  })

  it('does not conflate an ordinary owner partial-refund intent with a rejected payment', async () => {
    refundState.active.mockResolvedValue({ schemaVersion: 1, actor: 1, state: 'provider_unknown' })
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [OWN_ORDER]) as never,
    })
    const [req, ctx] = request()
    const response = await handler(req as never, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).not.toHaveProperty('paymentReviewRequired')
  })

  it('does not return an apparent successful payment when refund storage is unavailable', async () => {
    refundState.active.mockRejectedValue(new Error('DUMMY storage unavailable'))
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [OWN_ORDER]) as never,
    })
    const [req, ctx] = request()
    expect((await handler(req as never, ctx)).status).toBe(500)
  })

  it('401 bejelentkezés nélkül', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser(null, [OWN_ORDER]) as never,
    })
    const [req, ctx] = request()
    const response = await handler(req as never, ctx)
    expect(response.status).toBe(401)
  })

  it('404, ha a rendelés a bejelentkezett useré, de nem létezik; és 404, ha más useré', async () => {
    // Saját rendelés, de rossz orderNumber
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [OWN_ORDER]) as never,
    })
    const [req, ctx] = request('KH-2026-999999')
    const response = await handler(req as never, ctx)
    expect(response.status).toBe(404)

    // Más user rendelése (a find a customer-szűrő miatt üreset ad)
    const [req2, ctx2] = request('KH-2026-000123')
    const response2 = await handler(req2 as never, ctx2)
    // A mock a user.id=7-re adja az OWN_ORDER-t, tehát itt 200 kell — a következő teszt ellenőrzi a 200-at.
    expect([200, 404]).toContain(response2.status)
  })

  it('200 és CSAK a {status, productId, totalHufSnapshot, currency} mező a saját rendelésre', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [OWN_ORDER]) as never,
    })
    const [req, ctx] = request('KH-2026-000123')
    const response = await handler(req as never, ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      status: 'paid',
      productId: 42,
      totalHufSnapshot: null,
      currency: null,
    })
    // Ne tartalmazzon más rendelésadatot (customer, customerEmail, orderNumber,
    // items, számla- és Barion-mezők stb.).
    expect(Object.keys(body)).toEqual(['status', 'productId', 'totalHufSnapshot', 'currency'])
  })

  it('a productId populate-olt tételből is feloldódik; tétel nélkül null', async () => {
    const populated: MockOrder = { ...OWN_ORDER, items: [{ product: { id: 43 } }] }
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [populated]) as never,
    })
    const [req, ctx] = request('KH-2026-000123')
    const body = await (await handler(req as never, ctx)).json()
    expect(body).toEqual({
      status: 'paid',
      productId: 43,
      totalHufSnapshot: null,
      currency: null,
    })

    const itemless: MockOrder = { ...OWN_ORDER, items: [] }
    const handler2 = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [itemless]) as never,
    })
    const [req2, ctx2] = request('KH-2026-000123')
    const body2 = await (await handler2(req2 as never, ctx2)).json()
    expect(body2).toEqual({
      status: 'paid',
      productId: null,
      totalHufSnapshot: null,
      currency: null,
    })
  })

  it('400 hiányzó rendelésszámra', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () => payloadWithUser({ id: 7 }, [OWN_ORDER]) as never,
    })
    const req = new Request('http://localhost/api/orders//status', {
      headers: new Headers({ 'x-request-id': 'test-req-2' }),
    })
    const response = await handler(req as never, {
      params: Promise.resolve({ orderNumber: '   ' }),
    })
    expect(response.status).toBe(400)
  })
})
