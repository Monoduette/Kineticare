import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A süti-sáv NEM takarhatja el a mobil menü alsó pontjait — WCAG 2.2 · 2.4.11.
 * A süti-sáv `z-index: 1000`, a mobil menü fiókja `z-index: 80`, tehát a sáv a
 * fiók FÖLÉ kerül. A `consent-banner.css` már véd a takarás ellen, DE a védelme
 * `body { padding-bottom }` és `scroll-padding-bottom` — a fiók viszont
 * `position: fixed`, ezért a body belső margója rá nem hat, a saját
 */

const LAYOUT_CSS = readFileSync(
  fileURLToPath(new URL('../app/(frontend)/styles/layout.css', import.meta.url)),
  'utf8',
)

const CONSENT_CSS = readFileSync(
  fileURLToPath(new URL('../app/(frontend)/styles/consent-banner.css', import.meta.url)),
  'utf8',
)

/**
 * A `.kc-nav-mobile__list` szabályblokkjai (selector → törzs).
 *
 * A KOMMENTEKET ELŐBB KIVESSZÜK. A mutációs próba megmutatta, hogy enélkül az
 * őr VAKON ZÖLD: a szabály fölé írt magyarázó komment maga is tartalmazza az
 * `overflow-y: auto` szöveget, tehát a keresés akkor is talált volna, ha a
 * tényleges deklaráció eltűnik a szabályból. Egy kommentre épülő őr nem őr.
 */
function menuListaSzabalyok(): string[] {
  const kommentNelkul = LAYOUT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  return kommentNelkul.match(/[^{}]*\.kc-nav-mobile__list[^{}]*\{[^}]*\}/g) ?? []
}

describe('a süti-sáv és a mobil menü', () => {
  it('a menülista alsó margója a sáv MÉRT magasságával számol', () => {
    const szabalyok = menuListaSzabalyok().join('\n')
    expect(szabalyok).toContain('--kc-consent-offset')
    // A calc() BELSEJÉBEN további `var(…)` áll, tehát a zárójelre nem lehet
    // megállni — a nem mohó `[\s\S]*?` viszont átlép rajta.
    expect(szabalyok).toMatch(/padding-bottom:\s*calc\([\s\S]*?--kc-consent-offset/)
  })

  it('a lista saját görgetéséhez is jár a sáv-magasság', () => {
    // A fiók listája `overflow-y: auto`, tehát SAJÁT görgetési doboz: a lap
    // `scroll-padding-bottom`-ja rá nem vonatkozik, külön kell megadni.
    const szabalyok = menuListaSzabalyok().join('\n')
    expect(szabalyok).toMatch(/scroll-padding-bottom:\s*var\(--kc-consent-offset\)/)
  })

  it('a lista MARADJON saját görgetési doboz (különben a margó értelmét veszti)', () => {
    expect(menuListaSzabalyok().join('\n')).toContain('overflow-y: auto')
  })

  it('a védelem nem írható felül némán: pontosan KÉT lista-szabály van', () => {
    /**
     * MIÉRT SZÁMLÁLUNK: a puszta „szerepel-e" vizsgálat vakon zöld marad, ha
     * valaki később egy harmadik, erősebb vagy hátrébb álló szabállyal
     * visszaállítja a `padding-bottom`-ot (a repóban ez pontosan megtörtént a
     * cross-sell hatókör-őrénél). Kettő a helyes szám: az alap-szabály és a
     * 2.4.11-es kiegészítés.
     */
    expect(menuListaSzabalyok()).toHaveLength(2)
  })

  it('a változó alapértéke 0px, tehát süti-sáv nélkül nincs fölösleges térköz', () => {
    const tokens = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/styles/tokens.css', import.meta.url)),
      'utf8',
    )
    expect(tokens).toMatch(/--kc-consent-offset:\s*0px/)
  })

  it('a sáv továbbra is a lap fölött áll (a rétegsorrend nem változott)', () => {
    // Ha valaki a z-indexszel „oldaná meg" a takarást, a sáv a menü ALÁ
    // kerülne, és a süti-döntés válna elérhetetlenné. A helyes megoldás a
    // térköz, nem a rétegcsere — ezt rögzítjük.
    expect(CONSENT_CSS).toMatch(/z-index:\s*1000/)
    expect(LAYOUT_CSS).toMatch(/\.kc-nav-mobile__drawer\s*\{[^}]*z-index:\s*80/)
  })
})
