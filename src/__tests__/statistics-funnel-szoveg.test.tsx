import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FunnelSection } from '../components/admin/statistics/FunnelSection'
import {
  BRUTTO_BEFIZETES_CIMKE,
  RESZLEGES_LEVONVA,
  RESZLEGES_NINCS_LEVONVA,
  TotalsCards,
} from '../components/admin/statistics/TotalsCards'
import type { OrderFunnelCounts, RevenueTotals } from '../lib/statistics/revenue'

/**
 * A tölcsér-szekció visszatérítés-megjegyzése — őr-teszt.
 *
 * A 2026-08-21-i kódvizsgálat F9 (MEDIUM) találata: a szöveg azt állította,
 * hogy „a visszatérített rendelések nem számítanak bevételnek", holott a
 * RÉSZLEGES visszatérítés a rendelést `paid` státuszban hagyja
 * (src/lib/refund/refund-order.ts), tehát a teljes összegével benne marad a
 * bevételben. Egy hamis magyarázat rosszabb, mint a hiányzó: a munkatárs
 * eszerint egyeztetné a könyvelést.
 *
 * r2-riasztas (a-egyeztetes-8): a részleges visszatérítést a tulajdonosi
 * lekérdezés a visszatérítés hónapjában levonja, a munkatársi nem (a `refunds`
 * tulajdonosi olvasású). Hogy melyik eset áll fenn, azt a felső kártyák alatti
 * mondat mondja ki (TotalsCards); a tölcsér csak a teljes visszatérítést írja.
 */

function funnel(overrides: Partial<OrderFunnelCounts> = {}): OrderFunnelCounts {
  return {
    paid: 10,
    created: 0,
    paymentPending: 0,
    paymentFailed: 0,
    cancelled: 0,
    refunded: 0,
    other: 0,
    total: 10,
    ...overrides,
  }
}

function render(counts: OrderFunnelCounts): string {
  return renderToStaticMarkup(createElement(FunnelSection, { funnel: counts }))
}

describe('FunnelSection — visszatérítés-megjegyzés', () => {
  it('nem állítja azt, hogy MINDEN visszatérített rendelés kiesik a bevételből', () => {
    const html = render(funnel({ created: 2 }))
    expect(html).not.toContain('A visszatérített rendelések nem számítanak bevételnek')
  })

  it('kimondja, hogy a teljesen visszatérített rendelés kimarad, a részlegesről a kártyák alá utal', () => {
    const html = render(funnel({ created: 2 }))
    expect(html).toContain('A teljesen visszatérített rendelés nem számít bele a befizetésekbe')
    expect(html).toContain(
      'A részleges visszatérítés kezelését a felső összesítő alatti mondat írja le',
    )
    // A tölcsér nem állít semmit a részlegesről, mert az a nézőtől függ.
    expect(html).not.toContain('a teljes összegével szerepel')
  })

  it('a megjegyzés akkor is látszik, ha nincs beavatkozást kérő rendelés', () => {
    // A bevétel értelmezéséhez kell, nem a teendőkhöz — korábban a mondat
    // csak a „van nyitott rendelés" ágon jelent meg.
    const html = render(funnel())
    expect(html).toContain('Nincs nyitott vagy sikertelen fizetés')
    expect(html).toContain('A teljesen visszatérített rendelés nem számít bele a befizetésekbe')
  })

  it('a beavatkozást kérő darabszám magyar ezres tagolással jelenik meg', () => {
    const html = render(funnel({ created: 1200, paymentPending: 34, paymentFailed: 6 }))
    expect(html).toContain((1240).toLocaleString('hu-HU'))
  })
})

describe('TotalsCards — tájékoztató bruttó befizetés és könyvelési forrás', () => {
  const totals = (overrides: Partial<RevenueTotals> = {}): RevenueTotals => ({
    laikusHuf: 79_500,
    szakemberHuf: 0,
    refundHuf: 20_000,
    totalHuf: 59_500,
    orderCount: 1,
    refundsDeducted: true,
    ...overrides,
  })
  const renderTotals = (value: RevenueTotals) =>
    renderToStaticMarkup(createElement(TotalsCards, { totals: value }))

  it('a fő szám címkéje tájékoztató bruttó befizetés, nem „bevétel"', () => {
    const html = renderTotals(totals())
    expect(html).toContain(BRUTTO_BEFIZETES_CIMKE)
    expect(html).not.toContain('Összes bevétel')
    expect(html).toContain('a Számlázz.hu számlái és a Barion havi kivonata az irányadó')
  })

  it('levonásnál a levont összeg és a levonás ténye látszik', () => {
    const html = renderTotals(totals())
    expect(html).toContain('Levont részleges visszatérítés')
    expect(html).toContain(RESZLEGES_LEVONVA)
    expect(html).toContain((59_500).toLocaleString('hu-HU'))
  })

  it('levonás nélkül (munkatársi nézet) kimondja, hogy a részleges a teljes összegével szerepel', () => {
    const html = renderTotals(totals({ refundsDeducted: false, refundHuf: 0, totalHuf: 79_500 }))
    expect(html).not.toContain('Levont részleges visszatérítés')
    expect(html).toContain(RESZLEGES_NINCS_LEVONVA)
  })
})
