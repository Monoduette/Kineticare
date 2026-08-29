import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { updateOrderStatusIfCurrent } from '../../lib/order-status/conditional-status'

function fakePayload(matched: boolean) {
  const update = vi.fn(async () => ({ docs: matched ? [{ id: 5 }] : [], errors: [] }))
  return { payload: { update } as unknown as Payload, update }
}

describe('updateOrderStatusIfCurrent — feltételes státusz-írás', () => {
  it('a where a sor-azonosítót ÉS a várt státuszt együtt köti ki', async () => {
    const { payload, update } = fakePayload(true)

    const written = await updateOrderStatusIfCurrent({
      payload,
      orderId: 5,
      expected: 'payment_pending',
      next: 'cancelled',
    })

    expect(written).toBe(true)
    expect(update).toHaveBeenCalledWith({
      collection: 'orders',
      where: { and: [{ id: { equals: 5 } }, { status: { equals: 'payment_pending' } }] },
      data: { status: 'cancelled' },
      overrideAccess: true,
    })
  })

  it('ha a sor már nem a várt státuszban van, nem történik írás és false jön vissza', async () => {
    const { payload } = fakePayload(false)

    const written = await updateOrderStatusIfCurrent({
      payload,
      orderId: 5,
      expected: 'payment_pending',
      next: 'cancelled',
    })

    expect(written).toBe(false)
  })
})
