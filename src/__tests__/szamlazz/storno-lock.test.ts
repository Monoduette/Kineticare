import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import { issueStornoForOrder, stornoLockKey } from '../../lib/szamlazz/storno'
import type { Order } from '../../payload-types'

/**
 * SEC-011 — a stornó-kiállítás sorosítása. A refund utáni inline stornó és a
 * számla-kompenzáció ugyanazt az elavult állapotot láthatná, és MINDKETTŐ
 * POSTolna. A zárat mockoljuk (a valódi Postgres advisory-zár egységtesztje az
 * advisory-lock.test.ts): itt az a kérdés, hogy a szolgáltatás HELYESEN
 * használja-e — jó kulccsal, a rendelést a záron belül FRISSEN újraolvasva.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

const ENABLED_CONFIG = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY,
  SZAMLAZZ_AFAKULCS: '27',
})

const lockState = vi.hoisted(() => ({
  keys: [] as string[],
  beforeEnter: null as null | (() => void | Promise<void>),
}))

vi.mock('../../lib/advisory-lock', () => ({
  withAdvisoryLock: async <T>(
    _payload: unknown,
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    lockState.keys.push(lockKey)
    if (lockState.beforeEnter) {
      await lockState.beforeEnter()
    }
    return fn()
  },
}))

beforeEach(() => {
  lockState.keys = []
  lockState.beforeEnter = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

function createOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: 202,
    orderNumber: 'KH-2026-000202',
    status: 'refunded',
    invoiceStatus: 'issued',
    invoiceNumber: 'KIN-2026-9',
    customerEmail: 'anna@example.test',
    totalHufSnapshot: 19990,
    ...overrides,
  } as unknown as Order
}

function createLockingPayload(order: Order) {
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    findByID: vi.fn(async () => order),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      Object.assign(order, data)
      return order
    }),
  }
  return { payload: payload as unknown as Payload, updates, order }
}

describe('issueStornoForOrder — advisory-zár (SEC-011)', () => {
  it('a rendelésre szabott kulccsal zár, és a záron belül FRISSEN olvassa a rendelést', async () => {
    const order = createOrder()
    const { payload } = createLockingPayload(order)
    const postXml = vi.fn(async () => ({ szamlaszam: 'ST-1' }))

    const result = await issueStornoForOrder(order, {
      config: ENABLED_CONFIG,
      payload,
      postXml,
    })

    expect(lockState.keys).toEqual([stornoLockKey(order.id)])
    expect(stornoLockKey(order.id)).toBe('storno:202')
    expect((payload as unknown as { findByID: ReturnType<typeof vi.fn> }).findByID).toHaveBeenCalled()
    expect(postXml).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outcome: 'storned', stornoNumber: 'ST-1' })
  })

  it('párhuzamos stornó a zárra várakozás közben: a záron belüli friss olvasás no-opot ad, NEM POSTol másodszor', async () => {
    const order = createOrder()
    const { payload } = createLockingPayload(order)
    const postXml = vi.fn(async () => ({ szamlaszam: 'ST-KESO' }))

    // A zár megszerzése ELŐTT egy párhuzamos futás már kiállította a stornót.
    lockState.beforeEnter = () => {
      order.stornoStatus = 'storned'
      order.stornoNumber = 'ST-ELSO'
    }

    const result = await issueStornoForOrder(order, {
      config: ENABLED_CONFIG,
      payload,
      postXml,
    })

    expect(result).toMatchObject({ outcome: 'already-storned', stornoNumber: 'ST-ELSO' })
    expect(postXml).not.toHaveBeenCalled()
  })
})
