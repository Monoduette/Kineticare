import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * ŐR: a fejlécben és a mobil fiókban NINCS „Időpontfoglalás” belépő.
 *
 * WP10, 2026-09-07, tulajdonosi döntés. A 2026-09-06-i kör egy külön
 * sáv-gombot (szöveglink 900 px-től, körvonalas gomb a fiók alján) adott a
 * `/kapcsolat#idopontkeres` célra. A „Kapcsolat” menüpont ugyanoda visz, és
 * az időpontkérő űrlap a /kapcsolat oldalon él, tehát a második belépő
 * duplikált utat és zsúfoltabb sávot adott. A komponens, a lock és a CSS
 * kikerült; ez az őr azt méri, hogy ne szivárogjon vissza.
 *
 * Források:
 * - NN/g, Menu-Design Checklist: kevesebb, egyértelmű menüpont, ugyanarra a
 *   célra ne álljon két elem. https://www.nngroup.com/articles/menu-design/
 * - W3C, Understanding SC 3.2.3 Consistent Navigation.
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html
 */

const olvas = (relativ: string): string =>
  readFileSync(fileURLToPath(new URL(relativ, import.meta.url)), 'utf8')

const kommentNelkul = (forras: string): string =>
  forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('fejléc — nincs Időpontfoglalás belépő (WP10 őr)', () => {
  it('a sáv-gomb komponense és a lockja nem létezik', () => {
    for (const fajl of ['../components/layout/HeaderAppointmentCta.tsx', '../lib/header-appointment.ts']) {
      expect(existsSync(fileURLToPath(new URL(fajl, import.meta.url))), fajl).toBe(false)
    }
  })

  it('a Header és a MobileNav kódja nem hivatkozik rá', () => {
    for (const fajl of ['../components/layout/Header.tsx', '../components/layout/MobileNav.tsx']) {
      const kod = kommentNelkul(olvas(fajl))
      expect(kod, fajl).not.toContain('HeaderAppointmentCta')
      expect(kod, fajl).not.toContain('header-appointment')
      expect(kod, fajl).not.toContain('idopontkeres')
      expect(kod, fajl).not.toContain('Időpontfoglalás')
      expect(kod, fajl).not.toContain('Időpontkérés')
    }
  })

  it('a layout.css-ben nincs halott időpont-szabály', () => {
    const css = kommentNelkul(olvas('../app/(frontend)/styles/layout.css'))
    expect(css).not.toContain('appointment')
  })

  it('a menülink 900 px-től az alap 8 px-es oldaltérközét használja (mért tartalék)', () => {
    // A felszabadult sáv-tartalék (900 px, bejelentkezve: 26,6 → 118,9 px a
    // WP10 mérése szerint) fedezi a 8 px-es lépcsőt; a 4 px-es WP8-as
    // felülírás nem térhet vissza csendben.
    const css = kommentNelkul(olvas('../app/(frontend)/styles/layout.css'))
    expect(css).not.toMatch(/\.kc-nav-desktop__link\s*\{[^}]*padding:\s*var\(--kc-space-2\)\s+var\(--kc-space-1\)/)
  })
})
