import { describe, expect, it } from 'vitest'

import { earliestOrderGrantMoment, resolveOrderPaidMoment } from '../../lib/szamlazz/paid-date'
import type { Order } from '../../payload-types'

/**
 * A számla teljesítési dátumának forrása: a paid-átmenet által a vevő
 * `accessGrants` tömbjébe írt, a rendeléshez kötött hozzáférés-óra
 * (src/lib/order-status/apply-barion-state.ts, startAccessClock).
 */
describe('earliestOrderGrantMoment — a rendeléshez kötött legkorábbi hozzáférés-óra', () => {
  it('csak a sourceKind=order + sourceOrder=<rendelés> sorokat nézi, a legkorábbit adja', () => {
    const moment = earliestOrderGrantMoment(
      [
        // Ajándék (independent) — nem a fizetés ideje.
        { product: 1, grantedAt: '2026-01-01T00:00:00.000Z', sourceKind: 'independent' },
        // Történeti, eredet nélküli sor — nem bizonyítottan ehhez a rendeléshez tartozik.
        { product: 1, grantedAt: '2026-02-01T00:00:00.000Z' },
        // Másik rendelés.
        { product: 2, grantedAt: '2026-03-01T00:00:00.000Z', sourceKind: 'order', sourceOrder: 99 },
        // EZ a rendelés, két termékkel (azonos pillanat + egy későbbi).
        {
          product: 3,
          grantedAt: '2026-09-30T21:58:00.000Z',
          sourceKind: 'order',
          sourceOrder: 101,
        },
        {
          product: 4,
          grantedAt: '2026-10-01T08:00:00.000Z',
          sourceKind: 'order',
          sourceOrder: { id: 101 },
        },
      ],
      101,
    )
    expect(moment?.toISOString()).toBe('2026-09-30T21:58:00.000Z')
  })

  it('hiányzó, hibás vagy nem tömb bemenetre null', () => {
    expect(earliestOrderGrantMoment(null, 101)).toBeNull()
    expect(earliestOrderGrantMoment('nem tömb', 101)).toBeNull()
    expect(
      earliestOrderGrantMoment(
        [{ product: 3, grantedAt: 'nem dátum', sourceKind: 'order', sourceOrder: 101 }],
        101,
      ),
    ).toBeNull()
  })
})

describe('resolveOrderPaidMoment — a vevő beolvasása és a budapesti nap', () => {
  function payloadWithUser(user: unknown) {
    const reads: Array<{ collection: string; id: unknown }> = []
    const payload = {
      findByID: async ({ collection, id }: { collection: string; id: unknown }) => {
        reads.push({ collection, id })
        return user
      },
    }
    return { payload: payload as never, reads }
  }

  it('23:58-as budapesti fizetés: a teljesítés napja a fizetés napja (nem az UTC-s, nem a másnap)', async () => {
    const { payload, reads } = payloadWithUser({
      id: 7,
      accessGrants: [
        // 2026-12-31T23:58 Budapest (CET) = 2026-12-31T22:58Z
        {
          product: 3,
          grantedAt: '2026-12-31T22:58:00.000Z',
          sourceKind: 'order',
          sourceOrder: 101,
        },
      ],
    })
    const moment = await resolveOrderPaidMoment(payload, { id: 101, customer: 7 } as Order)
    expect(reads).toEqual([{ collection: 'users', id: 7 }])
    expect(moment?.paidDate).toBe('2026-12-31')
  })

  it('00:30-as budapesti fizetés (22:30Z előző nap): a MAGYAR nap', async () => {
    const { payload } = payloadWithUser({
      id: 7,
      accessGrants: [
        {
          product: 3,
          grantedAt: '2026-08-31T22:30:00.000Z',
          sourceKind: 'order',
          sourceOrder: 101,
        },
      ],
    })
    const moment = await resolveOrderPaidMoment(payload, { id: 101, customer: 7 } as Order)
    expect(moment?.paidDate).toBe('2026-09-01')
  })

  it('vevő nélküli rendelésnél nincs olvasás, az eredmény null', async () => {
    const { payload, reads } = payloadWithUser(null)
    await expect(resolveOrderPaidMoment(payload, { id: 101 } as Order)).resolves.toBeNull()
    expect(reads).toHaveLength(0)
  })

  it('nem található vevő, illetve a rendeléshez nem kötött sorok: null', async () => {
    const missing = payloadWithUser(null)
    await expect(
      resolveOrderPaidMoment(missing.payload, { id: 101, customer: 7 } as Order),
    ).resolves.toBeNull()
    const unrelated = payloadWithUser({
      id: 7,
      accessGrants: [
        { product: 3, grantedAt: '2026-09-01T10:00:00.000Z', sourceKind: 'independent' },
      ],
    })
    await expect(
      resolveOrderPaidMoment(unrelated.payload, { id: 101, customer: { id: 7 } } as Order),
    ).resolves.toBeNull()
  })

  it('olvasási hiba NEM nyelődik el (a hívó állapotírás nélkül dob, a job újrapróbál)', async () => {
    const payload = {
      findByID: async () => {
        throw new Error('kapcsolat megszakadt')
      },
    }
    await expect(
      resolveOrderPaidMoment(payload as never, { id: 101, customer: 7 } as Order),
    ).rejects.toThrow('kapcsolat megszakadt')
  })
})
