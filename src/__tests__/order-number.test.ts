import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import {
  formatOrderNumber,
  generateOrderNumber,
  ORDER_NUMBER_PATTERN,
  parseOrderNumberSequence,
} from '../lib/order-number'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'

/**
 * T-017: rendelésszám-generátor tesztek.
 * Az egységtesztek env nélkül futnak; a DB-részek csak DATABASE_URI +
 * PAYLOAD_SECRET mellett (helyi validáció / jövőbeli CI), egyébként kihagyva.
 */

describe('orderNumber formátum (egység)', () => {
  it('KH-<év>-<6 jegyű> formátumot állít elő, nullákkal paddingelve', () => {
    expect(formatOrderNumber(2026, 123)).toBe('KH-2026-000123')
    expect(formatOrderNumber(2026, 1)).toBe('KH-2026-000001')
    expect(formatOrderNumber(2030, 999999)).toBe('KH-2030-999999')
  })

  it('a generált érték illeszkedik a ORDER_NUMBER_PATTERN-re', () => {
    expect(ORDER_NUMBER_PATTERN.test(formatOrderNumber(2026, 42))).toBe(true)
    expect(ORDER_NUMBER_PATTERN.test('KH-2026-123')).toBe(false)
    expect(ORDER_NUMBER_PATTERN.test('XX-2026-000123')).toBe(false)
  })

  it('parseOrderNumberSequence visszafejti a sorszámot, érvénytelenre null', () => {
    expect(parseOrderNumberSequence('KH-2026-000123')).toBe(123)
    expect(parseOrderNumberSequence('KH-2026-000001')).toBe(1)
    expect(parseOrderNumberSequence('nem-rendelésszám')).toBeNull()
    expect(parseOrderNumberSequence('KH-2026-123')).toBeNull()
  })

  it('format → parse round-trip', () => {
    expect(parseOrderNumberSequence(formatOrderNumber(2027, 654321))).toBe(654321)
  })
})

/**
 * a-checkout-16: az évszám a magyar naptár szerinti. Az éles szerver UTC-ben
 * fut, és a `getFullYear()` (a folyamat helyi ideje) szilveszter éjjel 00:00
 * és 01:00 (CET) között még az előző évet adta. A folyamat időzónáját a
 * blokk UTC-re állítja (mint élesben és a CI-ben), hogy a teszt gépfüggetlen
 * legyen; a lekérdezett évet a generátor `like` feltétele mutatja.
 */
describe('orderNumber év — Europe/Budapest (egység)', () => {
  const originalTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'UTC'
  })
  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTz
    }
  })

  function yearProbe(): { payload: Payload; likes: string[] } {
    const likes: string[] = []
    const payload = {
      find: async (args: { where?: { orderNumber?: { like?: string } } }) => {
        likes.push(String(args.where?.orderNumber?.like))
        return { docs: [], totalDocs: 0 }
      },
    } as unknown as Payload
    return { payload, likes }
  }

  it.each([
    [
      'szilveszter éjjel, 00:30 Budapesten (23:30 UTC)',
      '2026-12-31T23:30:00.000Z',
      'KH-2027-000001',
    ],
    ['január 1., 00:59:59 Budapesten', '2026-12-31T23:59:59.000Z', 'KH-2027-000001'],
    ['szilveszter 23:59 Budapesten (22:59 UTC)', '2026-12-31T22:59:00.000Z', 'KH-2026-000001'],
  ])('%s', async (_label, instant, expected) => {
    const { payload, likes } = yearProbe()
    expect(await generateOrderNumber(payload, new Date(instant))).toBe(expected)
    expect(likes).toEqual([expected.slice(0, 8)])
  })
})

// A DB-kapcsoló tényleges TCP-elérhetőséget néz — a CI álértékű DATABASE_URI-ja
// mellett az env-alapú feltétel hamis pozitívot adna (helpers/db-available.ts).
const hasDb = await isDatabaseAvailable()

describe.skipIf(!hasDb)('orderNumber generálás (DB)', () => {
  let payload: Payload
  const createdOrderIds: number[] = []

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })
  })

  afterAll(async () => {
    for (const id of createdOrderIds) {
      await payload.delete({ collection: 'orders', id, overrideAccess: true })
    }
    await payload.db?.destroy?.()
  })

  const createOrder = async () => {
    const order = await payload.create({
      collection: 'orders',
      data: {},
      overrideAccess: true,
    })
    createdOrderIds.push(order.id)
    return order as unknown as { id: number; orderNumber?: string | null }
  }

  it('create-kor a hook tölti, formátuma és egyedisége adott', async () => {
    const first = await createOrder()
    const second = await createOrder()

    expect(first.orderNumber).toMatch(ORDER_NUMBER_PATTERN)
    expect(second.orderNumber).toMatch(ORDER_NUMBER_PATTERN)
    expect(second.orderNumber).not.toBe(first.orderNumber)

    // Ugyanabban az évben egymást követő sorszámok.
    const firstSeq = parseOrderNumberSequence(first.orderNumber as string)
    const secondSeq = parseOrderNumberSequence(second.orderNumber as string)
    expect(secondSeq).toBe((firstSeq as number) + 1)
  })

  it('a kliens által küldött orderNumber figyelmen kívül marad', async () => {
    const order = await payload.create({
      collection: 'orders',
      data: { orderNumber: 'KH-1999-999999' } as Record<string, unknown>,
      overrideAccess: true,
    })
    createdOrderIds.push(order.id)

    const cast = order as unknown as { orderNumber?: string | null }
    expect(cast.orderNumber).toMatch(ORDER_NUMBER_PATTERN)
    expect(cast.orderNumber).not.toBe('KH-1999-999999')
  })

  it('update-kor nem számolódik újra', async () => {
    const order = await createOrder()
    const original = order.orderNumber

    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      // A saját Barion-állapotgép enumjának érvényes értéke (a plugin gyári
      // 'completed' státusza nálunk nem létezik — az order-status modul enumja
      // a forrás-igazság).
      data: { status: 'paid' } as Record<string, unknown>,
      overrideAccess: true,
    })

    expect((updated as unknown as { orderNumber?: string | null }).orderNumber).toBe(original)
  })

  it('generateOrderNumber a meglévő legnagyobb sorszámból lép tovább', async () => {
    const order = await createOrder()
    const next = await generateOrderNumber(payload)

    expect(parseOrderNumberSequence(next)).toBe(
      (parseOrderNumberSequence(order.orderNumber as string) as number) + 1,
    )
  })
})
