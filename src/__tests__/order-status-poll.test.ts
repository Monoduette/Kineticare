import { describe, expect, it, vi } from 'vitest'

import { ORDER_STATUSES, pollOrderStatus } from '../lib/order-status-poll'

/**
 * A köszönőoldal kliens-oldali státusz-pollerének tesztjei.
 *
 * A 12.2-es incidens óta a köszönőoldal hitelesítése KLIENS-OLDALI (a Barionról
 * érkező cross-site navigáción a szerver nem látja a sütit) — ez a függvény a
 * lánc utolsó láncszeme: a 401-ből „unauthorized" nézet lesz, a 404-ből
 * „nem található", a hálózati hibából „error". A fetch itt INJEKTÁLT
 * (fetchImpl paraméter) — a tesztből valódi hálózati hívás sosem mehet.
 */

function fetchReturning(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('pollOrderStatus', () => {
  it('keeps required payment review separate from success or refund confirmation', async () => {
    expect(
      await pollOrderStatus(
        'X',
        fetchReturning(200, { status: 'refunded', paymentReviewRequired: true }),
      ),
    ).toEqual({ kind: 'review' })
    expect(
      await pollOrderStatus(
        'X',
        fetchReturning(200, { status: 'paid', paymentReviewRequired: true }),
      ),
    ).toEqual({ kind: 'review' })
  })
  it('200 + érvényes törzs → status (a productId-val együtt, #70-es szerződés)', async () => {
    const fetchImpl = fetchReturning(200, { status: 'paid', productId: 42 })
    const result = await pollOrderStatus('KH-2026-000123', fetchImpl)
    // A `value`/`currency` a bevétel-méréshez került a szerződésbe (2026-08-21);
    // e törzsben nincs benne, tehát null — a pozitív ágat a
    // src/__tests__/analytics/azonositas-es-bevetel.test.tsx méri.
    expect(result).toEqual({
      kind: 'status',
      status: 'paid',
      productId: 42,
      value: null,
      currency: null,
    })
    // A hívás ugyanazon az originen, sütivel megy (a csrf-szűrő átengedi):
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/orders/KH-2026-000123/status')
    expect(init.credentials).toBe('include')
  })

  it('a productId hiányzik vagy érvénytelen → null (a státusz attól még status)', async () => {
    expect(await pollOrderStatus('X', fetchReturning(200, { status: 'paid' }))).toEqual({
      kind: 'status',
      status: 'paid',
      productId: null,
      value: null,
      currency: null,
    })
    expect(
      await pollOrderStatus('X', fetchReturning(200, { status: 'paid', productId: 'abc' })),
    ).toEqual({ kind: 'status', status: 'paid', productId: null, value: null, currency: null })
    expect(
      await pollOrderStatus('X', fetchReturning(200, { status: 'paid', productId: -3 })),
    ).toEqual({ kind: 'status', status: 'paid', productId: null, value: null, currency: null })
  })

  it('a rendelésszám URL-kódolva megy ki', async () => {
    const fetchImpl = fetchReturning(200, { status: 'created' })
    await pollOrderStatus('KH 2026/#1', fetchImpl)
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toBe(`/api/orders/${encodeURIComponent('KH 2026/#1')}/status`)
  })

  it('401 → unauthorized (a csrf-szűrő elutasítása is ide fut)', async () => {
    expect(await pollOrderStatus('X', fetchReturning(401))).toEqual({ kind: 'unauthorized' })
  })

  it('404 → not-found', async () => {
    expect(await pollOrderStatus('X', fetchReturning(404))).toEqual({ kind: 'not-found' })
  })

  it('egyéb nem-ok státusz → error', async () => {
    expect(await pollOrderStatus('X', fetchReturning(500))).toEqual({ kind: 'error' })
    expect(await pollOrderStatus('X', fetchReturning(400))).toEqual({ kind: 'error' })
  })

  it('200, de status nélküli törzs → error', async () => {
    expect(await pollOrderStatus('X', fetchReturning(200, {}))).toEqual({ kind: 'error' })
    expect(await pollOrderStatus('X', fetchReturning(200, { status: 42 }))).toEqual({
      kind: 'error',
    })
  })

  it('a hat ismert státusz mind átmegy a szűrésen', async () => {
    for (const status of ORDER_STATUSES) {
      const result = await pollOrderStatus('X', fetchReturning(200, { status }))
      expect(result).toEqual({
        kind: 'status',
        status,
        productId: null,
        value: null,
        currency: null,
      })
    }
  })

  /**
   * A `body.status as OrderStatus` cast helyére fehérlista került: az unión
   * kívüli érték (elgépelt, jövőbeli vagy támadó által küldött) korábban
   * VÉGIGFOLYT a nézet-állapotgépen `OrderStatus`-ként, holott a
   * ThankYouView `paid`/`cancelled`/`payment_failed`/`refunded` ágai
   * pontos egyezésre épülnek. Az ismeretlen érték most a `created` sorsát
   * kapja: a poll tovább fut, a 2 perces időkorlát pedig véd.
   */
  it('ismeretlen státusz → a created sorsa (tovább-pollozás, nincs hamis végállapot)', async () => {
    for (const ismeretlen of ['', 'PAID', 'refund', 'sikeres', 'paid ']) {
      expect(await pollOrderStatus('X', fetchReturning(200, { status: ismeretlen }))).toEqual({
        kind: 'status',
        status: 'created',
        productId: null,
        value: null,
        currency: null,
      })
    }
  })

  it('az ismeretlen státusz sem veszíti el a többi mezőt', async () => {
    expect(
      await pollOrderStatus(
        'X',
        fetchReturning(200, {
          status: 'ismeretlen',
          productId: 42,
          totalHufSnapshot: 19990,
          currency: 'huf',
        }),
      ),
    ).toEqual({
      kind: 'status',
      status: 'created',
      productId: 42,
      value: 19990,
      currency: 'HUF',
    })
  })

  it('hálózati hiba (fetch dob) → error, NEM kivétel', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await pollOrderStatus('X', fetchImpl)).toEqual({ kind: 'error' })
  })
})
