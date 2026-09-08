import type { Payload, PayloadRequest, Where } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { Order } from '../payload-types'
import { lookupPurchaseDates, resolveCourseAccessForUser } from '../lib/course-access-lookup'

const now = new Date('2026-09-08T12:00:00.000Z')
const old = '2025-01-01T12:00:00.000Z'
const recent = '2026-09-01T12:00:00.000Z'

function order(id: number, product: number, createdAt: string): Order {
  return { id, customer: 7, status: 'paid', createdAt, items: [{ product }] } as Order
}

function fixture(orders: Order[], grantRows: unknown[] = []) {
  const find = vi.fn(async ({ where, limit }: { where: Where; limit: number }) => {
    const clause = where.and?.find((item) => 'items.product' in item)
    const field = clause?.['items.product']
    const ids =
      field !== undefined && !Array.isArray(field) ? (field.in as number[] | undefined) : undefined
    const matching = orders
      .filter(
        (row) =>
          ids === undefined || row.items?.some((item) => ids.includes(item.product as number)),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { docs: matching.slice(0, limit), hasNextPage: matching.length > limit }
  })
  const findByID = vi.fn(async () => ({ id: 7, accessGrants: grantRows }))
  return { payload: { find, findByID } as unknown as Payload, find, findByID }
}

describe('complete multi-product entitlement history', () => {
  it('250 newer purchases of A cannot hide an expired purchase of B', async () => {
    const { payload, find } = fixture([
      ...Array.from({ length: 250 }, (_, index) => order(index + 1, 1, recent)),
      order(251, 2, old),
    ])
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [
        { id: 1, accessDurationDays: 30 },
        { id: 2, accessDurationDays: 30 },
      ],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(1)).toMatchObject({ hasAccess: true, reason: 'active' })
    expect(states.get(2)).toMatchObject({ hasAccess: false, reason: 'expired' })
    expect(find).toHaveBeenCalledTimes(2)
    expect(find.mock.calls[1]?.[0].where).toEqual({
      and: [
        { customer: { equals: 7 } },
        { status: { equals: 'paid' } },
        { 'items.product': { in: [2] } },
      ],
    })
  })

  it('a later independent gift still extends B after its old paid order is found', async () => {
    const { payload } = fixture(
      [
        ...Array.from({ length: 250 }, (_, index) => order(index + 1, 1, recent)),
        order(251, 2, old),
      ],
      [{ product: 2, grantedAt: recent }],
    )
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [
        { id: 1, accessDurationDays: 30 },
        { id: 2, accessDurationDays: 30 },
      ],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(2)).toMatchObject({ hasAccess: true, reason: 'active' })
  })

  it('a failed second round denies only B while preserving the proven current purchase of A', async () => {
    const { payload, find } = fixture([
      ...Array.from({ length: 250 }, (_, index) => order(index + 1, 1, recent)),
      order(251, 2, old),
    ])
    const implementation = find.getMockImplementation()!
    find
      .mockImplementationOnce(implementation)
      .mockRejectedValueOnce(new Error('fixture lookup failure'))
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [
        { id: 1, accessDurationDays: 30 },
        { id: 2, accessDurationDays: 30 },
      ],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(1)).toMatchObject({ hasAccess: true, reason: 'active' })
    expect(states.get(2)).toMatchObject({ hasAccess: false, reason: 'unknown-purchase-date' })
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('a truncated no-progress response denies and stops rather than treating absence as a gift', async () => {
    const find = vi.fn(async () => ({ docs: [], hasNextPage: true }))
    const payload = {
      find,
      findByID: vi.fn(async () => ({ accessGrants: [] })),
    } as unknown as Payload
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [{ id: 2, accessDurationDays: 30 }],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(2)).toMatchObject({ hasAccess: false, reason: 'unknown-purchase-date' })
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('a full response without pagination evidence is incomplete', async () => {
    const find = vi.fn(async () => ({
      docs: Array.from({ length: 250 }, (_, i) => order(i + 1, 1, recent)),
    }))
    const payload = { find } as unknown as Payload
    const result = await lookupPurchaseDates({ payload, userId: 7, productIds: [1, 2] })
    expect(result.failed).toBe(true)
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('missing pagination evidence cannot open B or close the proven purchase of A', async () => {
    const find = vi.fn(async () => ({
      docs: Array.from({ length: 250 }, (_, i) => order(i + 1, 1, recent)),
    }))
    const payload = {
      find,
      findByID: vi.fn(async () => ({ accessGrants: [] })),
    } as unknown as Payload
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [
        { id: 1, accessDurationDays: 30 },
        { id: 2, accessDurationDays: 30 },
      ],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(1)).toMatchObject({ hasAccess: true, reason: 'active' })
    expect(states.get(2)).toMatchObject({ hasAccess: false, reason: 'unknown-purchase-date' })
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('a malformed date denies its product rather than falling through to unknown-date access', async () => {
    const { payload } = fixture([order(1, 2, 'invalid-date')])
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [{ id: 2, accessDurationDays: 30 }],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(2)).toMatchObject({ hasAccess: false, reason: 'unknown-purchase-date' })
  })

  it('a complete empty lookup preserves the documented legacy unknown-date behavior', async () => {
    const { payload } = fixture([])
    const states = await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [{ id: 2, accessDurationDays: 30 }],
      now,
      denyOnLookupFailure: true,
    })
    expect(states.get(2)).toMatchObject({ hasAccess: true, reason: 'unknown-purchase-date' })
  })

  it('all reads retain the caller request and transaction context', async () => {
    const { payload, find, findByID } = fixture([order(1, 2, recent)])
    const req = { context: {}, transactionID: 'local-fixture' } as PayloadRequest
    await resolveCourseAccessForUser({
      payload,
      userId: 7,
      products: [{ id: 2, accessDurationDays: 30 }],
      now,
      req,
    } as Parameters<typeof resolveCourseAccessForUser>[0])
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ req }))
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ req }))
  })
})
