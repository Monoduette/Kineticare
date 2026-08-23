import { describe, expect, it } from 'vitest'

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
  it('csak érvényes product + grantedAt sort ír, a nullosat kihagyja', () => {
    expect(
      accessGrantsForWrite([
        { product: 42, grantedAt: '2026-01-01T00:00:00.000Z' },
        { product: null, grantedAt: '2026-01-02T00:00:00.000Z' },
        { product: 7, grantedAt: null },
      ]),
    ).toEqual([{ product: 42, grantedAt: '2026-01-01T00:00:00.000Z' }])
  })
})

describe('durationDaysFromProduct', () => {
  it('csak pozitív véges számot fogad el', () => {
    expect(durationDaysFromProduct({ accessDurationDays: 365 })).toBe(365)
    expect(durationDaysFromProduct({ accessDurationDays: 0 })).toBeNull()
    expect(durationDaysFromProduct({ accessDurationDays: null })).toBeNull()
  })
})
