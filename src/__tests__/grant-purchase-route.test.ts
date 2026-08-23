import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { createGrantPurchaseHandler } from '../lib/grant-purchase-route'

/**
 * POST /api/admin/grant-purchase — jogosultság-mátrix és validálás.
 *
 * A VALÓDI route-handler fut (RBAC + JSON-kapcsolás + a grant-szolgáltatás),
 * mockolt Payload local API-val — a refund.test.ts mintája.
 *
 * Jogosultság: staff VAGY owner (src/access/roles.ts hasStaffOrOwnerRole);
 * anon → 401, customer → 403.
 */

const EMAIL = 'vevo@example.test'
const SKU = 'DEMO-KEZREHAB-001'
const URL = 'http://localhost:3000/api/admin/grant-purchase'

interface PaidOrderSeed {
  createdAt: string
  productId?: number
}

interface MockOptions {
  authUser?: { id: number; email?: string; role: string } | null
  userExists?: boolean
  productExists?: boolean
  purchases?: number[]
  accessDurationDays?: number | null
  paidOrders?: PaidOrderSeed[]
}

function createMockPayload(options: MockOptions = {}) {
  const user = {
    id: 7,
    email: EMAIL,
    purchases: options.purchases ?? [],
    accessGrants: [] as Array<{ product: number; grantedAt: string }>,
  }
  const product = {
    id: 42,
    sku: SKU,
    accessDurationDays: options.accessDurationDays ?? null,
  }
  const updates: Array<{ collection: string; data: Record<string, unknown> }> = []

  const payload = {
    auth: vi.fn(async () => ({
      user:
        options.authUser === undefined
          ? { id: 1, email: 'owner@example.test', role: 'owner' }
          : options.authUser,
    })),
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'users') {
        return (options.userExists ?? true)
          ? { docs: [user], totalDocs: 1 }
          : { docs: [], totalDocs: 0 }
      }
      if (collection === 'products') {
        return (options.productExists ?? true)
          ? { docs: [product], totalDocs: 1 }
          : { docs: [], totalDocs: 0 }
      }
      if (collection === 'orders') {
        const docs = (options.paidOrders ?? []).map((order, index) => ({
          id: 1000 + index,
          status: 'paid' as const,
          createdAt: order.createdAt,
          items: [{ product: order.productId ?? product.id }],
        }))
        return { docs, totalDocs: docs.length }
      }
      return { docs: [], totalDocs: 0 }
    }),
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: number | string }) => {
      if (collection === 'users' && (options.userExists ?? true) && Number(id) === user.id) {
        return { ...user, purchases: [...user.purchases], accessGrants: [...user.accessGrants] }
      }
      throw new Error('Not Found')
    }),
    update: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      updates.push(args)
      if (args.collection === 'users') {
        Object.assign(user, args.data)
      }
      return args.data
    }),
  }

  return { payload: payload as unknown as Payload, updates }
}

function handlerFor(options: MockOptions = {}) {
  const { payload, updates } = createMockPayload(options)
  return {
    handler: createGrantPurchaseHandler({ getPayload: async () => payload }),
    updates,
  }
}

function postRequest(body: unknown, raw?: string): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  })
}

const VALID_BODY = { email: EMAIL, productIdOrSku: SKU, reason: 'elhibázott fizetés jóváírása' }

describe('grant-purchase route — jogosultság-mátrix', () => {
  it('401, ha nincs bejelentkezett felhasználó', async () => {
    const { handler, updates } = handlerFor({ authUser: null })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toContain('bejelentkezés')
    expect(updates).toHaveLength(0)
  })

  it('403 customer szerepkörrel', async () => {
    const { handler, updates } = handlerFor({ authUser: { id: 9, role: 'customer' } })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(403)
    expect(body.error).toContain('jogosultság')
    expect(updates).toHaveLength(0)
  })

  it('200 staff szerepkörrel — a hozzáférés bekerül', async () => {
    const { handler, updates } = handlerFor({
      authUser: { id: 5, email: 'staff@example.test', role: 'staff' },
    })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { status: string; message: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe('granted')
    expect(body.message).toBe('A kurzust ajándékoztam.')
    expect(updates).toHaveLength(1)
    expect(updates[0].data).toEqual({ purchases: [42] })
  })

  it('200 owner szerepkörrel', async () => {
    const { handler, updates } = handlerFor()

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe('granted')
    expect(updates).toHaveLength(1)
  })

  it('200 already-had, ha a vevőnél már megvan a kurzus (nem hiba, nincs írás)', async () => {
    const { handler, updates } = handlerFor({ purchases: [42] })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { status: string; message: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe('already-had')
    expect(body.message).toBe('Már hozzáfér ehhez a kurzushoz.')
    expect(updates).toHaveLength(0)
  })

  it('200 granted: lejárt hozzáférést az ajándékozás megújítja', async () => {
    const { handler, updates } = handlerFor({
      purchases: [42],
      accessDurationDays: 30,
      paidOrders: [{ createdAt: '2020-01-01T00:00:00.000Z' }],
    })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { status: string; message: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe('granted')
    expect(body.message).toBe('A kurzust ajándékoztam.')
    expect(updates.length).toBeGreaterThanOrEqual(1)
  })
})

describe('grant-purchase route — validálás és 404-ágak', () => {
  it('400, ha hiányzik az e-mail-cím', async () => {
    const { handler } = handlerFor()

    const response = await handler(postRequest({ productIdOrSku: SKU, reason: 'ok' }))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('e-mail')
  })

  it('400, ha nincs kiválasztott kurzus', async () => {
    const { handler } = handlerFor()

    const response = await handler(postRequest({ email: EMAIL, reason: 'ok' }))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('kurzust')
  })

  it('400, ha az indok üres', async () => {
    const { handler } = handlerFor()

    const response = await handler(
      postRequest({ email: EMAIL, productIdOrSku: SKU, reason: '   ' }),
    )
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('indok')
  })

  it('400, ha a törzs nem JSON', async () => {
    const { handler } = handlerFor()

    const response = await handler(postRequest(null, 'nem-json'))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    // §2.7: a látogatói üzenetben nincs technikai zsargon („JSON"), a teendő viszont ott van.
    expect(body.error).toContain('a kérés adatai nem értelmezhetők')
    expect(body.error).toContain('Frissítsd az oldalt')
  })

  it('404 ismeretlen felhasználónál', async () => {
    const { handler, updates } = handlerFor({ userExists: false })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toContain('Nincs ilyen felhasználó')
    expect(updates).toHaveLength(0)
  })

  it('404 ismeretlen kurzusnál (külön üzenet)', async () => {
    const { handler, updates } = handlerFor({ productExists: false })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toContain('Nincs ilyen kurzus')
    expect(updates).toHaveLength(0)
  })

  it('500 váratlan technikai hibánál (magyar üzenet)', async () => {
    const handler = createGrantPurchaseHandler({
      getPayload: async () => {
        throw new Error('adatbázis nem elérhető')
      },
    })

    const response = await handler(postRequest(VALID_BODY))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(500)
    expect(body.error).toContain('A kurzus ajándékozása most nem sikerült')
  })
})
