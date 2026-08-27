import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { loadPurchasedProducts } from '../lib/purchased-products'
import type { Product } from '../payload-types'

/**
 * Kurzusaim lista: a session `purchases` ID-only és populate-olt alakját
 * egyaránt terméklistává kell tenni. A paywall a nyers id-t elfogadja;
 * a lista korábban eldobta, és üresnek látszott a fiók.
 */

function product(id: number, status: Product['status'] = 'published'): Product {
  return { id, status, sku: `SKU-${id}` } as Product
}

function mockPayload(docs: Product[]) {
  return {
    find: vi.fn(async () => ({ docs, totalDocs: docs.length })),
  } as unknown as Payload
}

describe('loadPurchasedProducts', () => {
  it('üres vagy hiányzó purchases → üres lista, nincs lekérdezés', async () => {
    const payload = mockPayload([])
    expect(await loadPurchasedProducts({ payload, purchases: null })).toEqual([])
    expect(await loadPurchasedProducts({ payload, purchases: [] })).toEqual([])
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('nyers id-ket is felold, a vásárlás sorrendjét megtartja', async () => {
    const payload = mockPayload([product(3), product(1), product(2)])
    const result = await loadPurchasedProducts({
      payload,
      purchases: [1, { id: 2 } as Product, 3],
    })
    expect(result.map((row) => row.id)).toEqual([1, 2, 3])
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        overrideAccess: true,
      }),
    )
  })

  it('draft kiesik, archived megmarad', async () => {
    const payload = mockPayload([product(2, 'archived')])
    const result = await loadPurchasedProducts({
      payload,
      purchases: [1, 2],
    })
    expect(result.map((row) => row.id)).toEqual([2])
  })
})
