import { describe, expect, it } from 'vitest'
import * as grants from '../lib/access-grants'
import type { Order } from '../payload-types'

import {
  accessGrantsForWrite,
  durationDaysFromProduct,
  grantDatesFromRows,
  mergeAccessStartDates,
  withUpsertedAccessGrant,
} from '../lib/access-grants'

describe('grantDatesFromRows', () => {
  it('a későbbi grantedAt nyeri a termék kezdőpontját', () => {
    const dates = grantDatesFromRows([
      { product: 42, grantedAt: '2026-01-01T00:00:00.000Z' },
      { product: { id: 42 }, grantedAt: '2026-06-01T00:00:00.000Z' },
      { product: 7, grantedAt: '2026-03-01T00:00:00.000Z' },
    ])
    expect(dates.get(42)).toBe('2026-06-01T00:00:00.000Z')
    expect(dates.get(7)).toBe('2026-03-01T00:00:00.000Z')
  })

  it('üres vagy hibás sorokat kihagyja', () => {
    expect(grantDatesFromRows(null).size).toBe(0)
    expect(grantDatesFromRows([{ product: 42, grantedAt: 'nem-datum' }]).size).toBe(0)
  })
})

describe('mergeAccessStartDates', () => {
  it('a későbbi dátumot tartja paid és ajándék közül', () => {
    const paid = new Map([[42, '2026-01-01T00:00:00.000Z']])
    const grants = new Map([
      [42, '2026-04-01T00:00:00.000Z'],
      [9, '2026-02-01T00:00:00.000Z'],
    ])
    const merged = mergeAccessStartDates(paid, grants)
    expect(merged.get(42)).toBe('2026-04-01T00:00:00.000Z')
    expect(merged.get(9)).toBe('2026-02-01T00:00:00.000Z')
  })
})

describe('withUpsertedAccessGrant', () => {
  it('új sort fűz, meglévőt frissíti', () => {
    const first = withUpsertedAccessGrant([], 42, new Date('2026-01-01T00:00:00.000Z'))
    expect(first).toEqual([{ product: 42, grantedAt: '2026-01-01T00:00:00.000Z' }])
    const second = withUpsertedAccessGrant(first, 42, new Date('2026-08-01T00:00:00.000Z'))
    expect(second).toHaveLength(1)
    expect(second[0]?.grantedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('accessGrantsForWrite', () => {
  it('érvénytelen sort nem töröl csendben egy másik hozzáférés írásakor', () => {
    expect(() =>
      accessGrantsForWrite([
        { product: 42, grantedAt: '2026-01-01T00:00:00.000Z' },
        { product: null, grantedAt: '2026-01-02T00:00:00.000Z' },
        { product: 7, grantedAt: null },
      ]),
    ).toThrow()
  })
})

describe('durationDaysFromProduct', () => {
  it('csak pozitív véges számot fogad el', () => {
    expect(durationDaysFromProduct({ accessDurationDays: 365 })).toBe(365)
    expect(durationDaysFromProduct({ accessDurationDays: 0 })).toBeNull()
    expect(durationDaysFromProduct({ accessDurationDays: null })).toBeNull()
  })
})

describe('access grant provenance (PAY-RENEWAL-REFUND)', () => {
  const old = '2026-01-01T00:00:00.000Z'
  const renewal = '2026-09-05T00:00:00.000Z'
  const gift = '2026-09-08T00:00:00.000Z'
  const paid = (status: Order['status'] = 'paid', customer = 7, product = 42) =>
    ({
      id: 100,
      status,
      customer,
      items: [{ product }],
    }) as Pick<Order, 'id' | 'status' | 'customer' | 'items'>
  const source = { sourceKind: 'order' as const, sourceOrder: 100 }
  const row = { id: 'DUMMY-renewal-row', product: 42, grantedAt: renewal, ...source }

  it('a paid renewal a korábbi ajándék és legacy óra átírása nélkül kap saját sort', () => {
    const existing = [
      { id: 'DUMMY-gift', product: 42, grantedAt: old, sourceKind: 'independent' as const },
      { id: 'DUMMY-legacy', product: 42, grantedAt: old },
    ]
    const next = withUpsertedAccessGrant(existing, 42, new Date(renewal), source)
    expect(next).toHaveLength(3)
    expect(next.slice(0, 2)).toEqual(existing)
    expect(next[2]).toMatchObject({ product: 42, grantedAt: renewal, ...source })
  })

  it('ajándékozás megőrzi egy másik paid origin sorazonosítóját és eredetét', () => {
    const existing = [row]
    const next = withUpsertedAccessGrant(existing, 42, new Date(gift), {
      sourceKind: 'independent',
    })
    const saved = accessGrantsForWrite(next)
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual(row)
    expect(saved[1]).toMatchObject({ product: 42, grantedAt: gift, sourceKind: 'independent' })
  })

  it('csak azonos order origin óra frissül, a sor ID megmarad', () => {
    const other = { ...row, id: 'DUMMY-older-order', sourceOrder: 99, grantedAt: old }
    const next = withUpsertedAccessGrant([row, other], 42, new Date(gift), source)
    expect(next).toEqual([{ ...row, grantedAt: gift }, other])
  })

  it('az írás nem dobhat el csendben sérült eredetet vagy duplikált sorazonosítót', () => {
    expect(() => accessGrantsForWrite([{ ...row, sourceOrder: null }])).toThrow()
    expect(() => accessGrantsForWrite([{ ...row, product: null }])).toThrow()
    expect(() => accessGrantsForWrite([row, { ...row, product: 7 }])).toThrow()
  })

  it('csak a frissen paid, ugyanahhoz a vevőhöz és SKU-hoz tartozó origin jogosít', () => {
    const resolved = grants.resolveEligibleGrantDates({
      rows: [row],
      userId: 7,
      ordersById: new Map([[100, paid()]]),
    })
    expect(resolved.dates).toEqual(new Map([[42, renewal]]))
    expect(resolved.knownProductIds).toEqual(new Set([42]))
    expect(resolved.legacyDates.size).toBe(0)
    expect(resolved.unresolvedProductIds.size).toBe(0)
  })

  it.each(['refunded', 'cancelled', 'payment_pending'] as const)(
    '%s origin nem ad hozzáférést, és a tiltás nem válhat unknown-date engedéllyé',
    (status) => {
      const resolved = grants.resolveEligibleGrantDates({
        rows: [row],
        userId: 7,
        ordersById: new Map([[100, paid(status)]]),
      })
      expect(resolved.dates.size).toBe(0)
      expect(resolved.knownProductIds).toEqual(new Set([42]))
      expect(resolved.unresolvedProductIds.size).toBe(0)
    },
  )

  it('a refundolt renewal mellett a későbbi független ajándék megmarad', () => {
    const independent = {
      id: 'DUMMY-gift',
      product: 42,
      grantedAt: gift,
      sourceKind: 'independent',
    }
    const resolved = grants.resolveEligibleGrantDates({
      rows: [row, independent],
      userId: 7,
      ordersById: new Map([[100, paid('refunded')]]),
    })
    expect(resolved.dates).toEqual(new Map([[42, gift]]))
  })

  it.each([new Map(), new Map([[100, paid('paid', 8)]]), new Map([[100, paid('paid', 7, 9)]])])(
    'hiányzó/idegen/eltérő SKU-jú order bizonyíték nem engedély',
    (ordersById) => {
      const resolved = grants.resolveEligibleGrantDates({ rows: [row], userId: 7, ordersById })
      expect(resolved.dates.size).toBe(0)
      expect(resolved.unresolvedProductIds).toEqual(new Set([42]))
    },
  )

  it('legacy dátumot külön őriz meg, nem talál ki hozzá gift vagy order eredetet', () => {
    const resolved = grants.resolveEligibleGrantDates({
      rows: [{ product: 42, grantedAt: gift }],
      userId: 7,
      ordersById: new Map(),
    })
    expect(resolved.dates.size).toBe(0)
    expect(resolved.legacyDates).toEqual(new Map([[42, gift]]))
    expect(resolved.knownProductIds.size).toBe(0)
  })

  it('az order bizonyítékigény duplikátummentes és legacy/independent sorból nem talál ki FK-t', () => {
    expect(
      grants.orderIdsFromAccessGrantRows([
        row,
        row,
        { ...row, sourceOrder: { id: 101 } },
        { product: 9, grantedAt: old },
      ]),
    ).toEqual([100, 101])
  })
})
