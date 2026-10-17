import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * A süti-sáv NEM takarhatja el a mobil menü alsó pontjait — WCAG 2.2 · 2.4.11.
 * A süti-sáv `z-index: 1000`, a mobil menü fiókja `z-index: 80`, tehát a
 * `<details>`-tartalékágon (popover nélküli böngésző) a sáv a fiók FÖLÉ kerül.
 * A `consent-banner.css` már véd a takarás ellen, DE a védelme
 * `body { padding-bottom }` és `scroll-padding-bottom` — a fiók viszont
 * `position: fixed`, ezért a body belső margója rá nem hat, a saját
 * görgetési dobozára pedig a lap `scroll-padding`-je nem vonatkozik.
 *
 * 2026-10-16 óta a fiók natív popover, nyitva a böngésző felső rétegében áll
 * (a sáv fölött), és maga a fiók görget, nem a lista. A takarásmentességet
 * böngészőben a tests/e2e/mobil-menu-suti-sav.e2e.mjs méri (elementFromPoint);
 * ez az őr a CSS-szerződést tartja.
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

/** A fiók ALAP-szabályának törzse (kommentek nélkül). */
function fiokAlapSzabaly(): string {
  const kommentNelkul = LAYOUT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  return kommentNelkul.match(/(?:^|\n)\.kc-nav-mobile__drawer\s*\{([^}]*)\}/)?.[1] ?? ''
}

describe('a süti-sáv és a mobil menü', () => {
  it('a menülista alsó margója a sáv MÉRT magasságával számol', () => {
    const szabalyok = menuListaSzabalyok().join('\n')
    expect(szabalyok).toContain('--kc-consent-offset')
    // A calc() BELSEJÉBEN további `var(…)` áll, tehát a zárójelre nem lehet
    // megállni — a nem mohó `[\s\S]*?` viszont átlép rajta.
    expect(szabalyok).toMatch(/padding-bottom:\s*calc\([\s\S]*?--kc-consent-offset/)
  })

  it('a lista alja az iPhone alsó biztonsági sávját is kihagyja', () => {
    expect(menuListaSzabalyok().join('\n')).toMatch(
      /padding-bottom:\s*calc\([\s\S]*?env\(safe-area-inset-bottom/,
    )
  })

  it('a fiók a görgetési doboz, és a sáv-magasság a saját görgetésére is jár', () => {
    // A fiók `overflow-y: auto`, tehát SAJÁT görgetési doboz: a lap
    // `scroll-padding-bottom`-ja rá nem vonatkozik, külön kell megadni. Az
    // `overscroll-behavior: contain` nélkül a fiók végén a lap görögne tovább.
    const fiok = fiokAlapSzabaly()
    expect(fiok).toMatch(/overflow-y:\s*auto/)
    expect(fiok).toMatch(/overscroll-behavior:\s*contain/)
    expect(fiok).toMatch(/scroll-padding-bottom:\s*var\(--kc-consent-offset\)/)
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
    // térköz, nem a rétegcsere — ezt rögzítjük. (A nyitott popovert a
    // böngésző teszi a felső rétegbe; a z-index a tartalékágnak szól.)
    expect(CONSENT_CSS).toMatch(/z-index:\s*1000/)
    expect(fiokAlapSzabaly()).toMatch(/z-index:\s*80/)
  })

  it('nyitott fióknál a sáv szövege vizuálisan rejtett, a gombok maradnak (popover és tartalék)', () => {
    const css = CONSENT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const nyitott of [
      'html:has(#kc-mobile-menu:popover-open)',
      'html:has(.kc-nav-mobile__fallback[open])',
    ]) {
      const szabaly = css.match(
        new RegExp(
          `${nyitott.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\.kc-consent-banner__text\\s*\\{([^}]*)\\}`,
        ),
      )
      expect(szabaly?.[1]).toMatch(/position:\s*absolute/)
      expect(szabaly?.[1]).toMatch(/clip:\s*rect\(0 0 0 0\)/)
      expect(szabaly?.[1]).not.toMatch(/display:\s*none/)
    }
  })

  it('a nyitott fiók lapszintű szabályai csak a fiók sávjában (900 px alatt) élnek', () => {
    // 900 px fölött a fiók rejtett (`.kc-nav-mobile { display: none }`), de egy
    // ott nyitva maradt popover `:popover-open` marad. Ha a görgetészár vagy a
    // sáv-csukás média-feltétel nélkül állna, az asztali lap nem görögne, és a
    // süti-sáv szövege eltűnne, látható menü nélkül.
    const nyitottSzabalyok: Rule[] = []
    for (const css of [LAYOUT_CSS, CONSENT_CSS]) {
      postcss.parse(css).walkRules((rule) => {
        if (
          /^html:has\((#kc-mobile-menu:popover-open|\.kc-nav-mobile__fallback\[open\])\)/.test(
            rule.selector,
          )
        ) {
          nyitottSzabalyok.push(rule)
        }
      })
    }
    // Görgetészár a popover- és a tartalékágon, sáv-csukás mindkettőn.
    expect(nyitottSzabalyok).toHaveLength(4)
    for (const rule of nyitottSzabalyok) {
      let szulo = rule.parent
      let mobilSavban = false
      while (szulo && szulo.type !== 'root') {
        if (szulo.type === 'atrule' && (szulo as AtRule).name === 'media') {
          mobilSavban ||= /max-width:\s*899px/.test((szulo as AtRule).params)
        }
        szulo = szulo.parent
      }
      expect(mobilSavban, rule.selector).toBe(true)
    }
  })
})
