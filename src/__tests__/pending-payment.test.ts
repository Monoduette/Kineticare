import { describe, expect, it } from 'vitest'

import {
  barionPayUrl,
  checkoutPaymentInProgressMessage,
  checkoutStartRejectedWaitMessage,
  checkoutStartUncertainMessage,
  decidePendingCheckout,
  minutesLeftInWindow,
} from '../lib/checkout/pending-payment'

const WINDOW_MS = 30 * 60 * 1000
const NOW = Date.parse('2026-08-23T12:00:00.000Z')

describe('barionPayUrl', () => {
  it('teszt és éles Pay-URL a PaymentId-ből', () => {
    expect(barionPayUrl('abc', 'test')).toBe('https://secure.test.barion.com/Pay?id=abc')
    expect(barionPayUrl('abc', 'prod')).toBe('https://secure.barion.com/Pay?id=abc')
  })
})

describe('decidePendingCheckout', () => {
  it('PaymentId nélkül, ablakon belül → várakozás a hátralévő percekkel, nincs második Start', () => {
    expect(
      decidePendingCheckout({
        barionPaymentId: null,
        createdAt: '2026-08-23T11:50:00.000Z',
        mappedState: null,
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'wait-no-payment-id', minutesLeft: 20 })
  })

  it('PaymentId nélkül, ablakon kívül → helyi lezárás és új Start', () => {
    expect(
      decidePendingCheckout({
        barionPaymentId: '',
        createdAt: '2026-08-23T10:00:00.000Z',
        mappedState: null,
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'cancel-and-restart' })
  })

  it('GetPaymentState hiba PaymentId mellett → fail-closed', () => {
    expect(
      decidePendingCheckout({
        barionPaymentId: 'pay-1',
        createdAt: '2026-08-23T11:00:00.000Z',
        mappedState: 'unavailable',
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'barion-unavailable' })
  })

  it('a Barion kifejezetten nem ismeri a PaymentId-t, az ablak lejárt → helyi lezárás és új Start', () => {
    // Cáfolható állítás: eddig minden GetState-hiba „unavailable" volt, így a
    // más Barion-környezetben indított függő rendelés örökre 503-at adott.
    expect(
      decidePendingCheckout({
        barionPaymentId: 'pay-1',
        createdAt: '2026-08-23T11:00:00.000Z',
        mappedState: 'not-found',
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'cancel-and-restart' })
  })

  /**
   * Cáfolható állítás (a-callback-5): eddig a „nem ismerem" válasz életkortól
   * függetlenül azonnal lezárta a függő sort, és második fizetés indult egy
   * frissen indított (akár élő) fizetés mellé.
   */
  it('a Barion kifejezetten nem ismeri a PaymentId-t, de az ablakon belül vagyunk → várakozás', () => {
    expect(
      decidePendingCheckout({
        barionPaymentId: 'pay-1',
        createdAt: '2026-08-23T11:55:00.000Z',
        mappedState: 'not-found',
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'wait-not-found', minutesLeft: 25 })
  })

  it('Succeeded → already-paid, payment_pending → resume, Failed → új Start', () => {
    expect(
      decidePendingCheckout({
        barionPaymentId: 'pay-1',
        createdAt: '2026-08-23T11:00:00.000Z',
        mappedState: 'paid',
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'already-paid' })
    expect(
      decidePendingCheckout({
        barionPaymentId: 'pay-1',
        createdAt: '2026-08-23T11:00:00.000Z',
        mappedState: 'payment_pending',
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'resume', paymentId: 'pay-1' })
    expect(
      decidePendingCheckout({
        barionPaymentId: 'pay-1',
        createdAt: '2026-08-23T11:00:00.000Z',
        mappedState: 'cancelled',
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'cancel-and-restart' })
  })
})

describe('minutesLeftInWindow', () => {
  it('felfelé kerekít, és 1 és az ablak hossza közé szorít', () => {
    expect(minutesLeftInWindow('2026-08-23T11:50:00.000Z', NOW, WINDOW_MS)).toBe(20)
    expect(minutesLeftInWindow('2026-08-23T11:50:30.000Z', NOW, WINDOW_MS)).toBe(21)
    expect(minutesLeftInWindow('2026-08-23T11:29:59.000Z', NOW, WINDOW_MS)).toBe(1)
    expect(minutesLeftInWindow('2026-08-23T10:00:00.000Z', NOW, WINDOW_MS)).toBe(1)
    // Óraeltérés (jövőbeli createdAt) sem ígérhet az ablaknál hosszabb várakozást.
    expect(minutesLeftInWindow('2026-08-23T12:10:00.000Z', NOW, WINDOW_MS)).toBe(30)
  })

  it('ismeretlen létrehozási időnél a teljes ablak', () => {
    expect(minutesLeftInWindow(null, NOW, WINDOW_MS)).toBe(30)
    expect(minutesLeftInWindow('nem dátum', NOW, WINDOW_MS)).toBe(30)
  })
})

describe('a várakoztató üzenetek', () => {
  const messages = [
    checkoutPaymentInProgressMessage(17),
    checkoutStartUncertainMessage(17),
    checkoutStartRejectedWaitMessage(17),
  ]

  it('megmondják, hány perc múlva indítható új fizetés', () => {
    for (const message of messages) {
      expect(message).toContain('17 perc múlva')
    }
  })

  it('a bizonytalan Start nem állít „folyamatban lévő" fizetést, és kimondja, hogy nem volt levonás', () => {
    expect(checkoutStartUncertainMessage(30)).toContain('pénzt nem vontunk le')
    expect(checkoutStartUncertainMessage(30)).not.toContain('folyamatban')
  })

  it('magyar mikroszöveg-szabály: nincs töltelék gondolatjel, „Kérjük", „Sajnos"', () => {
    for (const message of messages) {
      expect(message).not.toMatch(/[–—]/)
      expect(message).not.toContain('Kérjük')
      expect(message).not.toContain('Sajnos')
    }
  })
})
