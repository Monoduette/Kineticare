import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { orderIntegrityBeforeChange } from '../lib/order-integrity'

/**
 * a-checkout-4: az orders create-hookjának lekérdezései (rendelésszám,
 * termékár) a create SAJÁT tranzakciójában futnak, a kérés `req`-jével.
 * Nélküle mindegyik újabb pool-kapcsolatot kért, miközben a checkout-zár és a
 * create tranzakciója már fogott egyet-egyet; egyidejű pénztáraknál ez a pool
 * kimerüléséhez vezetett. Mockolt Payload mellett a tranzakció-kötés egyetlen
 * megfigyelhető jele, hogy a hook a kapott `req`-et adja tovább.
 */
describe('orderIntegrityBeforeChange — a lekérdezések a create tranzakciójában futnak', () => {
  it('a rendelésszám- és az ár-lekérdezés is a hívó req-jét kapja', async () => {
    const seenReqs: unknown[] = []
    const req = {
      transactionID: 'tx-1',
      payload: {
        find: async (args: { req?: unknown }) => {
          seenReqs.push(args.req)
          return { docs: [], totalDocs: 0 }
        },
        findByID: async (args: { req?: unknown }) => {
          seenReqs.push(args.req)
          return { id: 42, sku: 'KURZUS-ALAP', priceInHUF: 5000, priceInHUFEnabled: true }
        },
      },
    } as unknown as PayloadRequest

    const data = (await orderIntegrityBeforeChange({
      data: { items: [{ product: 42, quantity: 1 }] },
      operation: 'create',
      req,
    } as unknown as Parameters<CollectionBeforeChangeHook>[0])) as Record<string, unknown>

    expect(seenReqs).toEqual([req, req])
    expect(data.totalHufSnapshot).toBe(5000)
    expect(data.orderNumber).toMatch(/^KH-\d{4}-000001$/)
  })
})
