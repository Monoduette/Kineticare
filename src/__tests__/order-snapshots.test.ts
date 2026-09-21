import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { ORDER_NUMBER_PATTERN } from '../lib/order-number'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'

/**
 * T-017: snapshot-populálás DB-tesztek — az item- és order-szintű snapshotok
 * mindig a products adatbázisbeli (szerver-oldali) értékeiből töltődnek,
 * a kliens által küldött ár/név sosem forrás; update-kor nem számolódnak újra.
 *
 * Csak DATABASE_URI + PAYLOAD_SECRET mellett fut (lásd products-status.test.ts).
 */

interface OrderItemSnapshot {
  product?: number | null
  quantity: number
  titleSnapshot?: string | null
  priceHufSnapshot?: number | null
}

interface OrderWithSnapshots {
  id: number
  orderNumber?: string | null
  totalHufSnapshot?: number | null
  amount?: number | null
  items?: OrderItemSnapshot[] | null
}

// A DB-kapcsoló tényleges TCP-elérhetőséget néz — a CI álértékű DATABASE_URI-ja
// mellett az env-alapú feltétel hamis pozitívot adna (helpers/db-available.ts).
const hasDb = await isDatabaseAvailable()

/**
 * A DB-s hookok (Payload-init + kategória/termék létrehozás, majd takarítás)
 * a CI párhuzamos suite-jai alatt túlléphetik a vitest 10 s-os alapértékét
 * (2026-09-16, CI 764: „Hook timed out in 10000ms”, miközben minden teszt
 * zöld volt). A többi DB-s suite (refund-*-db) is explicit korlátot ad.
 */
const DB_HOOK_TIMEOUT_MS = 60_000

describe.skipIf(!hasDb)('orders snapshot-hookok (DB)', () => {
  let payload: Payload
  let categoryId: number
  let productId: number
  let productSku: string
  const createdOrderIds: number[] = []

  const readOrder = async (id: number): Promise<OrderWithSnapshots> =>
    (await payload.findByID({
      collection: 'orders',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as OrderWithSnapshots

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })

    const categorySlug = 'test-order-snapshots'
    const existingCategory = await payload.find({
      collection: 'categories',
      where: { slug: { equals: categorySlug } },
      limit: 1,
      overrideAccess: true,
    })
    categoryId =
      existingCategory.docs[0]?.id ??
      (
        await payload.create({
          collection: 'categories',
          data: { title: 'Teszt kategória (order snapshots)', slug: categorySlug, type: 'product' },
          overrideAccess: true,
        })
      ).id

    productSku = `TEST-SNAPSHOT-${Date.now()}`
    const product = await payload.create({
      collection: 'products',
      data: {
        sku: productSku,
        category: categoryId,
        priceInHUFEnabled: true,
        priceInHUF: 5000,
      },
      overrideAccess: true,
    })
    productId = product.id
  }, DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    for (const id of createdOrderIds) {
      await payload.delete({ collection: 'orders', id, overrideAccess: true })
    }
    if (productId) {
      await payload.delete({ collection: 'products', id: productId, overrideAccess: true })
    }
    await payload.db?.destroy?.()
  }, DB_HOOK_TIMEOUT_MS)

  it('item-snapshotok a products DB-értékeiből töltődnek, a kliens ára nem forrás', async () => {
    const order = await payload.create({
      collection: 'orders',
      data: {
        items: [
          {
            product: productId,
            quantity: 2,
            // Szándékosan hamis, kliens-oldali értékek — a hooknak felül kell írnia.
            titleSnapshot: 'HAMIS CÍM',
            priceHufSnapshot: 1,
          },
        ],
        totalHufSnapshot: 1,
        amount: 1,
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    createdOrderIds.push(order.id)

    const readBack = await readOrder(order.id)
    const item = readBack.items?.[0]

    expect(item?.titleSnapshot).toBe(productSku)
    expect(item?.priceHufSnapshot).toBe(5000)
    // Order-szint: 2 × 5000; az amount a snapshotot tükrözi.
    expect(readBack.totalHufSnapshot).toBe(10000)
    expect(readBack.amount).toBe(10000)
    expect(readBack.orderNumber).toMatch(ORDER_NUMBER_PATTERN)
  })

  it('több item esetén a totalHufSnapshot az összegük', async () => {
    const otherProduct = await payload.create({
      collection: 'products',
      data: {
        sku: `TEST-SNAPSHOT-2-${Date.now()}`,
        category: categoryId,
        priceInHUFEnabled: true,
        priceInHUF: 1500,
      },
      overrideAccess: true,
    })

    const order = await payload.create({
      collection: 'orders',
      data: {
        items: [
          { product: productId, quantity: 1 },
          { product: otherProduct.id, quantity: 3 },
        ],
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    createdOrderIds.push(order.id)

    const readBack = await readOrder(order.id)
    expect(readBack.totalHufSnapshot).toBe(5000 * 1 + 1500 * 3)
    expect(readBack.amount).toBe(readBack.totalHufSnapshot)

    await payload.delete({ collection: 'products', id: otherProduct.id, overrideAccess: true })
  })

  it('élő akcióban a priceHufSnapshot az akciós ár, lejárt akciónál a rendes ár (WP63)', async () => {
    const promoProduct = await payload.create({
      collection: 'products',
      data: {
        sku: `TEST-SNAPSHOT-PROMO-${Date.now()}`,
        category: categoryId,
        priceInHUFEnabled: true,
        priceInHUF: 79500,
        promoEnabled: true,
        promoStart: '2020-01-01T12:00:00.000Z',
        promoEnd: '2099-12-31T12:00:00.000Z',
        promoPriceHuf: 39500,
      },
      overrideAccess: true,
    })

    const promoOrder = await payload.create({
      collection: 'orders',
      data: {
        items: [{ product: promoProduct.id, quantity: 2, priceHufSnapshot: 1 }],
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    createdOrderIds.push(promoOrder.id)
    const promoReadBack = await readOrder(promoOrder.id)
    expect(promoReadBack.items?.[0]?.priceHufSnapshot).toBe(39500)
    expect(promoReadBack.totalHufSnapshot).toBe(39500 * 2)
    expect(promoReadBack.amount).toBe(39500 * 2)

    // Az akció lejár: a következő rendelés már a rendes árat rögzíti, a
    // korábbi rendelés snapshotja változatlan.
    await payload.update({
      collection: 'products',
      id: promoProduct.id,
      data: { promoEnd: '2020-01-02T12:00:00.000Z' },
      overrideAccess: true,
    })
    const regularOrder = await payload.create({
      collection: 'orders',
      data: {
        items: [{ product: promoProduct.id, quantity: 1 }],
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    createdOrderIds.push(regularOrder.id)
    const regularReadBack = await readOrder(regularOrder.id)
    expect(regularReadBack.items?.[0]?.priceHufSnapshot).toBe(79500)
    expect(regularReadBack.totalHufSnapshot).toBe(79500)
    expect((await readOrder(promoOrder.id)).items?.[0]?.priceHufSnapshot).toBe(39500)

    await payload.delete({ collection: 'products', id: promoProduct.id, overrideAccess: true })
  })

  it('update-kor a snapshotok nem számolódnak újra (megrendeléskori igazság)', async () => {
    const order = await payload.create({
      collection: 'orders',
      data: {
        items: [{ product: productId, quantity: 1 }],
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    createdOrderIds.push(order.id)

    // A termék ára megváltozik a rendelés UTÁN.
    await payload.update({
      collection: 'products',
      id: productId,
      data: { priceInHUF: 7000 },
      overrideAccess: true,
    })

    await payload.update({
      collection: 'orders',
      id: order.id,
      data: { status: 'paid' } as Record<string, unknown>,
      overrideAccess: true,
    })

    const readBack = await readOrder(order.id)
    const item = readBack.items?.[0]

    expect(item?.priceHufSnapshot).toBe(5000)
    expect(readBack.totalHufSnapshot).toBe(5000)
  })
})
