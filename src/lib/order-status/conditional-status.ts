import type { Payload } from 'payload'

import type { Order } from '@/payload-types'

/**
 * Feltételes (compare-and-set) rendelés-státusz írás: csak akkor ír, ha a sor
 * a DB-ben MÉG a várt státuszban van — a read-then-write versenyablak így az
 * adatbázisban záródik, nem az alkalmazásban.
 */
export async function updateOrderStatusIfCurrent(input: {
  payload: Payload
  orderId: number
  expected: NonNullable<Order['status']>
  next: NonNullable<Order['status']>
}): Promise<boolean> {
  const result = await input.payload.update({
    collection: 'orders',
    where: {
      and: [{ id: { equals: input.orderId } }, { status: { equals: input.expected } }],
    },
    data: { status: input.next },
    overrideAccess: true,
  })
  return Array.isArray(result.docs) && result.docs.length > 0
}
