import { describe, expect, it } from 'vitest'

import { formatPriceHuf } from '../lib/format-price'

import {
  REFUND_IRREVERSIBLE_SENTENCE,
  refundBlockedReason,
  refundConfirmText,
  validateRefundAmount,
} from '../components/admin/refund-amount'

/**
 * A visszatérítés-panel kliensoldali összeg-validálása (tiszta függvény).
 *
 * A szabály maga a SZERVEREN dől el (src/lib/refund/refund-order.ts) — ez a
 * réteg csak kényelmi előszűrés; a teszt azt rögzíti, hogy a mező üresen
 * teljes visszatérítést jelent, és minden hibás bevitelre magyar üzenet jár.
 */

const TOTAL = 19990

describe('validateRefundAmount', () => {
  it('üres mező = teljes visszatérítés (nincs összeg a kérésben)', () => {
    expect(validateRefundAmount('', TOTAL)).toEqual({ ok: true, amountHuf: null })
    expect(validateRefundAmount('   ', TOTAL)).toEqual({ ok: true, amountHuf: null })
  })

  it('érvényes részösszeg átmegy', () => {
    expect(validateRefundAmount('5000', TOTAL)).toEqual({ ok: true, amountHuf: 5000 })
  })

  it('a teljes végösszeg is megadható', () => {
    expect(validateRefundAmount(String(TOTAL), TOTAL)).toEqual({ ok: true, amountHuf: TOTAL })
  })

  it('elfogadja a magyar ezres tagolást (szóköz)', () => {
    expect(validateRefundAmount('19 990', TOTAL)).toEqual({ ok: true, amountHuf: TOTAL })
  })

  it('0 → hibaüzenet', () => {
    const result = validateRefundAmount('0', TOTAL)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('nullánál nagyobb')
  })

  it('negatív → hibaüzenet', () => {
    const result = validateRefundAmount('-100', TOTAL)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('nullánál nagyobb')
  })

  it('nem egész (tizedes) → hibaüzenet', () => {
    const result = validateRefundAmount('100.5', TOTAL)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('egész forintösszeg')
  })

  it('nem szám → hibaüzenet', () => {
    const result = validateRefundAmount('sok', TOTAL)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('csak szám lehet')
  })

  it('a végösszegnél nagyobb → hibaüzenet a korláttal', () => {
    const result = validateRefundAmount('20000', TOTAL)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('nem haladhatja meg')
  })

  it('ismeretlen végösszegnél nincs felső korlát (a szerver dönt)', () => {
    expect(validateRefundAmount('20000', null)).toEqual({ ok: true, amountHuf: 20000 })
  })
})

describe('refundBlockedReason', () => {
  it('paid státusznál nincs akadály', () => {
    expect(refundBlockedReason('paid')).toBeNull()
  })

  it('minden más státuszra magyar magyarázat jár', () => {
    expect(refundBlockedReason('refunded')).toBe(
      'A rendelésen már teljes visszatérítés van rögzítve. Itt új visszatérítés nem indítható.',
    )
    expect(refundBlockedReason('created')).toBe(
      'A rendelés fizetése nem zárult le, ezért itt nem indítható visszatérítés.',
    )
    expect(refundBlockedReason('payment_pending')).toBe(
      'A rendelés fizetése nem zárult le, ezért itt nem indítható visszatérítés.',
    )
    expect(refundBlockedReason('payment_failed')).toBe(
      'A rendelés sikertelen fizetésként van rögzítve, ezért itt nem indítható visszatérítés.',
    )
    expect(refundBlockedReason('cancelled')).toBe(
      'A rendelés le lett mondva, ezért itt nem indítható visszatérítés.',
    )
    expect(refundBlockedReason(null)).toBe('Csak kifizetett rendelés téríthető vissza.')
    expect(refundBlockedReason('valami-uj-statusz')).not.toContain('paid')
  })

  it('nem kifizetett rendelésnél sem állítja, hogy nincs mit visszatéríteni (a Barion-fizetés sikerülhetett)', () => {
    // Dupla vásárlásnál vagy késői fizetésnél a pénz a boltnál van, és az
    // automatikus visszatérítés küldi vissza; a panel ennek nem mondhat ellent.
    for (const status of ['created', 'payment_pending', 'payment_failed', 'cancelled']) {
      const text = refundBlockedReason(status)
      expect(text).not.toMatch(/nincs mit visszatéríteni|nincs kifizetve/)
      expect(text).toContain('itt nem indítható visszatérítés')
      expect(text).not.toMatch(/[–—]/)
    }
  })
})

describe('refundConfirmText (a megerősítő ablak szövege)', () => {
  it('teljes visszatérítésnél a rendelésszám és a teljes összeg, verzál nélkül', () => {
    const text = refundConfirmText('KH-2026-000777', null)
    expect(text.heading).toBe('Visszatéríted az összeget?')
    expect(text.detail).toBe(
      'KH-2026-000777 rendelés: a még vissza nem térített teljes összeg visszajár a vásárlónak a Barionon keresztül.',
    )
    expect(text.warning).toBe(REFUND_IRREVERSIBLE_SENTENCE)
  })

  it('részösszegnél a formázott összeg szerepel benne', () => {
    const text = refundConfirmText('KH-2026-000777', 5000)
    expect(text.detail).toBe(
      `KH-2026-000777 rendelés: ${formatPriceHuf(5000)} jár vissza a vásárlónak a Barionon keresztül.`,
    )
  })

  it('nincs benne gondolatjel, ASCII idézőjel, verzál szó és „Biztosan” kérdés (NN/g)', () => {
    for (const amount of [null, 5000]) {
      const all = Object.values(refundConfirmText('KH-2026-000777', amount)).join(' ')
      expect(all).not.toMatch(/[–—"]|\b[A-ZÁÉÍÓÖŐÚÜŰ]{2,}\b(?!-)|Biztosan/u)
    }
  })
})
