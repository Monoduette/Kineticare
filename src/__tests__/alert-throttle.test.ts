import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_ALERT_COOLDOWN_MS,
  MAX_TRACKED_KEYS,
  resetAlertThrottle,
  shouldEmitThrottledAlert,
} from '../lib/alert-throttle'

/**
 * Riasztás-fojtás (alert-throttle) — a percenkénti/5 percenkénti scanek által
 * ISMÉTELT owner-riasztások cooldown-os elnyomása. A szerződés: az első
 * előfordulás mindig átmegy, a cooldown-on belüli ismétlés elnyelődik, a
 * cooldown után újra riaszt; kulcsok egymástól függetlenek; a memória-plafon
 * legfeljebb KORAI újra-riasztást okozhat, elnyelést soha.
 */

const NOW = Date.parse('2026-08-04T12:00:00Z')

afterEach(() => {
  resetAlertThrottle()
})

describe('shouldEmitThrottledAlert', () => {
  it('első előfordulás → true; azonos kulcs a cooldown-on belül → false', () => {
    expect(shouldEmitThrottledAlert('stuck-order:101', undefined, NOW)).toBe(true)
    expect(shouldEmitThrottledAlert('stuck-order:101', undefined, NOW)).toBe(false)
    expect(shouldEmitThrottledAlert('stuck-order:101', undefined, NOW + 5 * 60_000)).toBe(false)
  })

  it('a cooldown lejárta után ugyanaz a kulcs ÚJRA riaszt (a nyitott ügy nem tűnik el)', () => {
    expect(shouldEmitThrottledAlert('stuck-order:101', undefined, NOW)).toBe(true)
    expect(
      shouldEmitThrottledAlert('stuck-order:101', undefined, NOW + DEFAULT_ALERT_COOLDOWN_MS - 1),
    ).toBe(false)
    expect(
      shouldEmitThrottledAlert('stuck-order:101', undefined, NOW + DEFAULT_ALERT_COOLDOWN_MS),
    ).toBe(true)
  })

  it('különböző kulcsok függetlenek — egy rendelés fojtása nem nyel el másik riasztást', () => {
    expect(shouldEmitThrottledAlert('stuck-order:101', undefined, NOW)).toBe(true)
    expect(shouldEmitThrottledAlert('stuck-order:102', undefined, NOW)).toBe(true)
    expect(shouldEmitThrottledAlert('webhook-exhausted:barion:guid', undefined, NOW)).toBe(true)
  })

  it('egyedi cooldown paraméterrel a rövidebb ablak is működik', () => {
    expect(shouldEmitThrottledAlert('k', 1000, NOW)).toBe(true)
    expect(shouldEmitThrottledAlert('k', 1000, NOW + 999)).toBe(false)
    expect(shouldEmitThrottledAlert('k', 1000, NOW + 1000)).toBe(true)
  })

  it('memória-plafon: túlcsordulásnál a legrégebbi kulcs esik ki — KORAI újra-riasztás, sosem elnyelés', () => {
    expect(shouldEmitThrottledAlert('legregebbi', undefined, NOW)).toBe(true)
    for (let index = 1; index < MAX_TRACKED_KEYS; index += 1) {
      expect(shouldEmitThrottledAlert(`kulcs-${index}`, undefined, NOW)).toBe(true)
    }
    // A plafon betelt; egy ÚJ kulcs a legrégebbit sepri ki.
    expect(shouldEmitThrottledAlert('tulcsordulo-uj', undefined, NOW)).toBe(true)
    // A kiseprett legrégebbi kulcs újra riaszthat (korai, de nem elnyelt).
    // (Ez az újra-beszúrás a MOST legrégebbi 'kulcs-1'-et sepri ki.)
    expect(shouldEmitThrottledAlert('legregebbi', undefined, NOW)).toBe(true)
    // Egy plafonon belül maradt kulcs fojtása viszont érintetlen.
    expect(shouldEmitThrottledAlert('kulcs-2', undefined, NOW)).toBe(false)
  })
})
