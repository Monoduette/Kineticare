import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CheckoutForm } from '../components/checkout/CheckoutForm'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../lib/contact-email'

/**
 * A pénztár elállási blokkja — a RENDERELT felületen mérve (a korábbi
 * változat saját konstansait vetette össze önmagukkal, tehát semmit nem
 * bizonyított).
 *
 * Két szerződés:
 *  - a két nyilatkozat SZÓ SZERINT a 45/2014. Korm. rendelet 29. § (1) m)
 *    szerinti szöveg (a visszaigazoló levél ugyanezt idézi, őre az
 *    order-paid-visszaigazolas.test.ts);
 *  - a súgó nem ígérhet olyan utat, amit a rendszer nem ad (a-ux-7,
 *    r-legal-7): a „14 nap elteltével éred el" alternatíva nem létezett, a
 *    pénztár mindkét nyilatkozat nélkül nem indít fizetést. A tulajdonos és a
 *    jogász által választott, igaz szöveg: online a kurzus csak azonnali
 *    hozzáféréssel vehető meg, más kérés a kapcsolati címen.
 */
function renderPaidCheckout(): string {
  return renderToStaticMarkup(
    createElement(CheckoutForm, {
      product: { id: 42, sku: 'Kézrehab alapkurzus', priceHuf: 79500, isFree: false },
      user: null,
      alreadyPurchased: false,
      turnstileSiteKey: null,
    }),
  ).replace(/\s+/g, ' ')
}

describe('elállási blokk a pénztárban (45/2014. 29. § (1) m))', () => {
  it('a két nyilatkozat szó szerint a jogszabály szerinti, és egyik sincs előre bepipálva', () => {
    const html = renderPaidCheckout()
    expect(html).toContain(
      'Kifejezetten kérem, hogy a digitális tartalomhoz a hozzáférés azonnal megkezdődjön.',
    )
    expect(html).toContain(
      'Tudomásul veszem, hogy a teljesítés megkezdésével elveszítem a 14 napos elállási jogomat.',
    )
    expect(html).not.toMatch(/id="waiver-(start|loss)"[^>]*checked/)
  })

  it('a súgó nem ígér nem létező, késleltetett hozzáférést, hanem az igaz utat mondja', () => {
    const html = renderPaidCheckout()
    expect(html).not.toContain('14 nap elteltével')
    expect(html).toContain('Online vásárlásnál a kurzus csak azonnali hozzáféréssel vehető meg.')
    expect(html).toContain(`írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre`)
  })

  it('a bevezető az ÁSZF létező pontjára mutat, nem a 14 napos elállás „szabályaira"', () => {
    const html = renderPaidCheckout()
    expect(html).not.toContain('A 14 napos elállási jog szabályairól')
    expect(html).toContain('„Elállási jog kizárása” pontja szól')
    expect(html).toContain('href="/aszf"')
  })
})
