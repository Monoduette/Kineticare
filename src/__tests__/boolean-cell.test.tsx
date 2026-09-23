import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BooleanCell,
  IGEN_FELIRAT,
  MenuLathatoCell,
  MenuRejtettLinkCell,
  NEM_FELIRAT,
  booleanCellFelirat,
} from '../components/admin/BooleanCell'
import { buildNavTree } from '../lib/menu-tree'
import type { Menu } from '../payload-types'

/**
 * A Menüpontok lista jelölőnégyzet-celláinak őre (K41): „Látható”, „Rejtett
 * link” és „Új lapon nyíljon”.
 *
 * - A cella szöveget ír, nem csak színt (WCAG 2.2 SC 1.4.1), és nem a gyári
 *   „igaz” / „hamis” kódot.
 * - A hiányzó érték a mező alapértékét kapja, UGYANÚGY, ahogy a navigáció
 *   (buildNavTree) értelmezi: a lista nem mondhat mást, mint a weboldal.
 */

function cella(Component: typeof BooleanCell, cellData: unknown): string {
  return renderToStaticMarkup(createElement(Component, { cellData }))
}

describe('booleanCellFelirat', () => {
  it('logikai értéknél a pipa állását mondja ki', () => {
    expect(booleanCellFelirat(true, false)).toBe(IGEN_FELIRAT)
    expect(booleanCellFelirat(false, true)).toBe(NEM_FELIRAT)
  })

  it('hiányzó vagy nem logikai értéknél az alapértéket', () => {
    for (const value of [undefined, null, '', 'true', 0, 1]) {
      expect(booleanCellFelirat(value, true)).toBe(IGEN_FELIRAT)
      expect(booleanCellFelirat(value, false)).toBe(NEM_FELIRAT)
    }
  })

  it('a feliratok magyar szavak, nem kódok', () => {
    expect([IGEN_FELIRAT, NEM_FELIRAT]).toEqual(['Igen', 'Nem'])
  })
})

describe('a cellák kimenete', () => {
  it('csak szöveg: nincs szín, nincs „igaz” / „hamis”, nincs kódbetű', () => {
    for (const Component of [BooleanCell, MenuLathatoCell, MenuRejtettLinkCell]) {
      for (const value of [true, false, null, undefined]) {
        const html = cella(Component, value)
        expect(html).toMatch(/^<span>(Igen|Nem)<\/span>$/)
        expect(html).not.toMatch(/igaz|hamis|true|false|<code|style=/)
      }
    }
  })

  it('a „Látható” oszlop a hiányzó értéket látszónak veszi, a „Rejtett link” nem rejtettnek', () => {
    expect(cella(MenuLathatoCell, undefined)).toBe('<span>Igen</span>')
    expect(cella(MenuLathatoCell, null)).toBe('<span>Igen</span>')
    expect(cella(MenuRejtettLinkCell, undefined)).toBe('<span>Nem</span>')
    expect(cella(MenuRejtettLinkCell, null)).toBe('<span>Nem</span>')
  })

  it('a cella ugyanazt mondja, mint a navigáció szűrője (buildNavTree)', () => {
    const esetek: Array<{ visible: boolean | null; unlisted: boolean | null }> = [
      { visible: true, unlisted: false },
      { visible: null, unlisted: null },
      { visible: false, unlisted: false },
      { visible: true, unlisted: true },
      { visible: false, unlisted: true },
    ]
    for (const eset of esetek) {
      const menu = {
        id: 1,
        label: 'Próba',
        type: 'url',
        url: '/proba',
        ...eset,
        updatedAt: '',
        createdAt: '',
      } as Menu
      const menuben = buildNavTree([menu]).length === 1
      const lathato = cella(MenuLathatoCell, eset.visible) === '<span>Igen</span>'
      const rejtett = cella(MenuRejtettLinkCell, eset.unlisted) === '<span>Igen</span>'
      expect(menuben).toBe(lathato && !rejtett)
    }
  })

  it('az „Új lapon nyíljon” oszlop (általános BooleanCell) ugyanazt mondja, mint a navigáció', () => {
    for (const openInNewTab of [true, false, null, undefined]) {
      const menu = {
        id: 1,
        label: 'Próba',
        type: 'url',
        url: '/proba',
        visible: true,
        unlisted: false,
        openInNewTab,
        updatedAt: '',
        createdAt: '',
      } as Menu
      const ujLapon = buildNavTree([menu])[0]?.openInNewTab === true
      expect(cella(BooleanCell, openInNewTab)).toBe(
        ujLapon ? '<span>Igen</span>' : '<span>Nem</span>',
      )
    }
  })
})
