import type { Payload, PayloadRequest, Where } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { Order } from '../payload-types'
import { resolveCourseAccessForUser } from '../lib/course-access-lookup'
import { ACCESS_LOOKUP_FAILED_MESSAGE, toCourseAccessView } from '../lib/course-access'

const now = new Date('2026-09-08T12:00:00.000Z')
const old = '2025-01-01T12:00:00.000Z'
const renewal = '2026-09-01T12:00:00.000Z'
const gift = '2026-09-07T12:00:00.000Z'
const grant = { product: 42, grantedAt: renewal, sourceKind: 'order', sourceOrder: 900 }

function makeOrder(id: number, createdAt: string, status: Order['status']): Order {
  return { id, customer: 7, createdAt, status, items: [{ product: 42 }] } as Order
}

function fixture(orders: Order[], rows: unknown[] = [grant]) {
  const find = vi.fn(async ({ where }: { where: Where }) => {
    const field = where.id
    const ids =
      field !== undefined && !Array.isArray(field) ? (field.in as number[] | undefined) : undefined
    const docs =
      ids === undefined
        ? orders.filter((order) => order.status === 'paid')
        : orders.filter((order) => ids.includes(order.id))
    return { docs, hasNextPage: false }
  })
  const findByID = vi.fn(async () => ({ id: 7, accessGrants: rows }))
  return { payload: { find, findByID } as unknown as Payload, find, findByID }
}

async function state(payload: Payload, duration: number | null = 30, req?: PayloadRequest) {
  return (
    await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [{ id: 42, accessDurationDays: duration }],
      now,
      req,
      denyOnLookupFailure: true,
    })
  ).get(42)
}

describe('renewal refund through the shared course authorization resolver', () => {
  it('expired original + fully refunded renewal is expired despite the retained new grant row', async () => {
    const { payload } = fixture([makeOrder(1, old, 'paid'), makeOrder(900, renewal, 'refunded')])
    expect(await state(payload)).toMatchObject({ hasAccess: false, reason: 'expired' })
  })

  it('the same renewal before full refund is active', async () => {
    const { payload } = fixture([makeOrder(1, old, 'paid'), makeOrder(900, renewal, 'paid')])
    expect(await state(payload)).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it('a separate later gift survives the full refund', async () => {
    const { payload } = fixture(
      [makeOrder(1, old, 'paid'), makeOrder(900, renewal, 'refunded')],
      [grant, { product: 42, grantedAt: gift, sourceKind: 'independent' }],
    )
    expect(await state(payload)).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it.each([30, null])(
    'a sole refunded source cannot fall through to unknown-date or unlimited (%s days)',
    async (duration) => {
      const { payload } = fixture([makeOrder(900, renewal, 'refunded')])
      expect(await state(payload, duration)).toMatchObject({ hasAccess: false })
    },
  )

  it('a different surviving paid origin still protects an unlimited course', async () => {
    const { payload } = fixture([makeOrder(1, old, 'paid'), makeOrder(900, renewal, 'refunded')])
    expect(await state(payload, null)).toMatchObject({ hasAccess: true, reason: 'unlimited' })
  })

  it('a missing linked source is uncertainty and never permission', async () => {
    const { payload } = fixture([])
    expect(await state(payload)).toMatchObject({
      hasAccess: false,
      reason: 'unknown-purchase-date',
    })
  })

  it.each([undefined, true])(
    'missing source stays unknown in list and private modes (%s)',
    async (denyOnLookupFailure) => {
      const { payload } = fixture([])
      const states = await resolveCourseAccessForUser({
        payload,
        userId: 7,
        products: [{ id: 42, accessDurationDays: 30 }],
        now,
        denyOnLookupFailure,
      })
      expect(states.get(42)).toEqual({
        hasAccess: denyOnLookupFailure !== true,
        reason: 'unknown-purchase-date',
        expiresAt: null,
      })
    },
  )

  it('a failed linked source read preserves the list link without asserting revocation', async () => {
    const { payload, find } = fixture([])
    find.mockRejectedValue(new Error('synthetic lookup outage'))
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [{ id: 42, accessDurationDays: 30 }],
      now,
    })
    expect(states.get(42)).toEqual({
      hasAccess: true,
      reason: 'unknown-purchase-date',
      expiresAt: null,
    })
  })

  it('a denied unknown state explains the lookup failure without claiming expiry', () => {
    const view = toCourseAccessView({
      hasAccess: false,
      reason: 'unknown-purchase-date',
      expiresAt: null,
    })
    expect(view.expiredMessage).toBe(ACCESS_LOOKUP_FAILED_MESSAGE)
  })

  it('a linked source belonging to another user cannot authorize the grant', async () => {
    const alien = { ...makeOrder(900, renewal, 'paid'), customer: 8 }
    const { payload, find } = fixture([alien])
    find.mockImplementation(async ({ where }) => ({
      docs: where.id ? [alien] : [],
      hasNextPage: false,
    }))
    expect(await state(payload)).toMatchObject({
      hasAccess: false,
      reason: 'unknown-purchase-date',
    })
  })

  it('legacy unclassified gift dates remain compatible and are not fabricated as an order source', async () => {
    const { payload } = fixture([makeOrder(1, old, 'paid')], [{ product: 42, grantedAt: gift }])
    expect(await state(payload)).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it('concurrent batches in the same request share the authoritative grant read', async () => {
    const { payload, findByID } = fixture([makeOrder(900, renewal, 'paid')])
    const req = { context: {} } as PayloadRequest
    const results = await Promise.all([state(payload, 30, req), state(payload, 30, req)])
    expect(results.every((result) => result?.hasAccess)).toBe(true)
    expect(findByID).toHaveBeenCalledTimes(1)
    await state(payload, 30, { context: {} } as PayloadRequest)
    expect(findByID).toHaveBeenCalledTimes(2)
  })

  it('a failed fresh grant lookup is kept denied within its request', async () => {
    const { payload, findByID } = fixture([])
    findByID.mockRejectedValueOnce(new Error('synthetic user lookup failure'))
    const req = { context: {} } as PayloadRequest
    expect(await state(payload, 30, req)).toMatchObject({ hasAccess: false })
    expect(await state(payload, 30, req)).toMatchObject({ hasAccess: false })
    expect(findByID).toHaveBeenCalledTimes(1)
  })
})
