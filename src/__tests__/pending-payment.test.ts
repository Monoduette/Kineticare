import { describe, expect, it } from 'vitest'

import {
  barionPayUrl,
  decidePendingCheckout,
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
  it('PaymentId nélkül, ablakon belül → várakozás, nincs második Start', () => {
    expect(
      decidePendingCheckout({
        barionPaymentId: null,
        createdAt: '2026-08-23T11:50:00.000Z',
        mappedState: null,
        nowMs: NOW,
        windowMs: WINDOW_MS,
      }),
    ).toEqual({ kind: 'wait-no-payment-id' })
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
