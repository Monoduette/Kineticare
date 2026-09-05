import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Intent-managed concurrency is covered separately with the real helper guard.
vi.mock('../../lib/refund/intent-store', () => ({ loadRefundIntentsForOrder: async () => [] }))

import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import {
  correctiveLockKey,
  issueCorrectiveInvoiceForOrder,
} from '../../lib/szamlazz/corrective'
import type { Order } from '../../payload-types'

/**
 * SEC-012 — a helyesbítő kiállítás sorosítása. Két azonos (orderId, refundSeq)
 * futás a POST előtti lekérdezés és a beküldés közti ablakban duplán POSTolhatna.
 * A zárat mockoljuk (a valódi advisory-zár egységtesztje az advisory-lock.test.ts):
 * itt az a kérdés, hogy a szolgáltatás HELYESEN használja-e — jó kulccsal, a
 * rendelést a záron belül FRISSEN újraolvasva.
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
    id: 303,
    orderNumber: 'KH-2026-000303',
    status: 'paid',
    invoiceStatus: 'issued',
    invoiceNumber: 'KIN-2026-11',
    invoiceCompletionDate: '2026-08-01',
    customerSnapshot: {
      name: 'Teszt Anna',
      billingName: 'Teszt Anna',
      billingZip: '1111',
      billingCity: 'Budapest',
      billingStreet: 'Példa utca 1.',
    },
    ...overrides,
  } as unknown as Order
}

function createLockingPayload(order: Order) {
  const payload = {
    findByID: vi.fn(async () => order),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(order, data)
      return order
    }),
  }
  return { payload: payload as unknown as Payload, order }
}

describe('issueCorrectiveInvoiceForOrder — advisory-zár (SEC-012)', () => {
  it('a rendelés + refund-sorszám kulccsal zár, és a záron belül FRISSEN olvas', async () => {
    const order = createOrder()
    const { payload } = createLockingPayload(order)
    const postXml = vi.fn(async () => ({ szamlaszam: 'HELY-1' }))
    const queryByKulsoAzon = vi.fn(async () => null)

    const result = await issueCorrectiveInvoiceForOrder(order, {
      config: ENABLED_CONFIG,
      payload,
      refundSeq: 1,
      amountHuf: 5000,
      postXml,
      queryByKulsoAzon,
    })

    expect(lockState.keys).toEqual([correctiveLockKey(order.id, 1)])
    expect(correctiveLockKey(order.id, 1)).toBe('corrective:303:1')
    expect(postXml).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outcome: 'issued', correctiveInvoiceNumber: 'HELY-1' })
  })

  it('párhuzamos helyesbítő a zárra várakozás közben: a friss olvasás no-opot ad, NEM POSTol másodszor', async () => {
    const order = createOrder()
    const { payload } = createLockingPayload(order)
    const postXml = vi.fn(async () => ({ szamlaszam: 'HELY-KESO' }))
    const queryByKulsoAzon = vi.fn(async () => null)

    // A zár megszerzése ELŐTT egy párhuzamos futás már kiállította ugyanerre a
    // refund-sorszámra a helyesbítőt.
    lockState.beforeEnter = () => {
      order.correctiveInvoiceNumber = 'HELY-ELSO'
      order.correctiveInvoiceSeq = 1
    }

    const result = await issueCorrectiveInvoiceForOrder(order, {
      config: ENABLED_CONFIG,
      payload,
      refundSeq: 1,
      amountHuf: 5000,
      postXml,
      queryByKulsoAzon,
    })

    expect(result).toMatchObject({ outcome: 'already-issued', correctiveInvoiceNumber: 'HELY-ELSO' })
    expect(postXml).not.toHaveBeenCalled()
  })
})
