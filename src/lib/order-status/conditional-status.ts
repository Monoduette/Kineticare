import type { Payload } from 'payload'

import type { Order } from '@/payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { orderTransitionLockKey } from './apply-barion-state'

/**
 * Feltételes státuszírás a fizetés/refund közös order:mutate zárával.
 * A Payload bulk where NEM SQL CAS: előbb kiválaszt, majd ID alapján ír.
 * Ezért a friss olvasás és a hookokat megtartó ID-írás együtt sorosított.
 * A hívó nem tarthatja már ugyanezt a zárat; külső HTTP itt nem futhat.
 */
export async function updateOrderStatusIfCurrent(input: {
  payload: Payload
  orderId: number
  expected: NonNullable<Order['status']>
  next: NonNullable<Order['status']>
}): Promise<boolean> {
  return withAdvisoryLock(input.payload, orderTransitionLockKey(input.orderId), async () => {
    const current = await input.payload.findByID({
      collection: 'orders',
      id: input.orderId,
      depth: 0,
      overrideAccess: true,
    })
    if (current.status !== input.expected) return false
    await input.payload.update({
      collection: 'orders',
      id: input.orderId,
      data: { status: input.next },
      overrideAccess: true,
    })
    return true
  })
}
