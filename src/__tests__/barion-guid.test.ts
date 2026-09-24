import { describe, expect, it } from 'vitest'

import {
  barionGuidForPath,
  canonicalBarionGuid,
  canonicalizeBarionGuid,
  sameBarionGuid,
} from '../lib/barion/guid'

/**
 * A Barion ugyanazt a GUID-ot kötőjellel és kötőjel nélkül is használja
 * (lib/barion/guid.ts). A v4 PaymentState útvonal csak a kötőjel nélküli
 * alakot illeszti (mérve 2026-09-24: kötőjelesre 404), a belső tárolás pedig
 * a kisbetűs, kötőjeles alakot használja.
 */
const DASHED = '64157032-d3dc-4296-aeda-fd4b0994c64e'
const COMPACT = '64157032d3dc4296aedafd4b0994c64e'

describe('canonicalBarionGuid', () => {
  it('a kötőjeles és a kötőjel nélküli alakot is a kisbetűs, kötőjeles alakra hozza', () => {
    expect(canonicalBarionGuid(DASHED)).toBe(DASHED)
    expect(canonicalBarionGuid(COMPACT)).toBe(DASHED)
    expect(canonicalBarionGuid(COMPACT.toUpperCase())).toBe(DASHED)
    expect(canonicalBarionGuid(` ${DASHED.toUpperCase()} `)).toBe(DASHED)
  })

  it.each([
    '',
    'nem-guid',
    COMPACT.slice(1),
    `${COMPACT}0`,
    `${COMPACT.slice(1)}g`,
    DASHED.replace('-', ''),
    `{${DASHED}}`,
    '../../etc/passwd',
  ])('nem GUID-alakú értékre null: %s', (value) => {
    expect(canonicalBarionGuid(value)).toBeNull()
  })

  it('nem szöveges értékre null', () => {
    expect(canonicalBarionGuid(undefined)).toBeNull()
    expect(canonicalBarionGuid(null)).toBeNull()
    expect(canonicalBarionGuid(42)).toBeNull()
  })
})

describe('barionGuidForPath', () => {
  it('a v4 útvonalba mindig a kötőjel nélküli, kisbetűs alak kerül', () => {
    expect(barionGuidForPath(DASHED)).toBe(COMPACT)
    expect(barionGuidForPath(COMPACT.toUpperCase())).toBe(COMPACT)
  })

  it('nem GUID-alakú értéket változatlanul hagy (a Barion arra 404-et ad)', () => {
    expect(barionGuidForPath('nem-guid')).toBe('nem-guid')
  })
})

describe('canonicalizeBarionGuid és sameBarionGuid', () => {
  it('GUID-ot kanonizál, minden mást változatlanul ad vissza', () => {
    expect(canonicalizeBarionGuid(COMPACT)).toBe(DASHED)
    expect(canonicalizeBarionGuid('nem-guid')).toBe('nem-guid')
  })

  it('ugyanaz a GUID alaktól és kis-nagybetűtől függetlenül', () => {
    expect(sameBarionGuid(DASHED, COMPACT.toUpperCase())).toBe(true)
    expect(sameBarionGuid(DASHED, DASHED.replace('6', '7'))).toBe(false)
    expect(sameBarionGuid('nem-guid', 'nem-guid')).toBe(false)
  })
})
