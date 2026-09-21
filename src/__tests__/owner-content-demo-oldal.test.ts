import { describe, expect, it } from 'vitest'

import {
  DEMO_OLDAL_CIM,
  DEMO_OLDAL_SLUG,
  alkalmazDemoOldalVisszavonas,
} from '../scripts/apply-owner-content'
import type { Page } from '../payload-types'

/**
 * WP60/2026-09-20 — az egykori demólap közzétételének visszavonása
 * (src/scripts/apply-owner-content.ts, `demo-oldal-visszavonas`). Adatbázis és
 * hálózat nélkül.
 *
 * Mért tulajdonságok: (1) a közzétett demólapot visszavonja, (2) a már
 * visszavont lapon csendben kihagy (idempotencia), (3) hiányzó rekordnál
 * csendben kihagy, (4) más című oldalt HANGOSAN kihagy, nem ír.
 */

const GONDOLATJEL = /[–—]/u

const oldal = (
  felul: Partial<Pick<Page, 'id' | 'title' | 'slug' | '_status'>> = {},
): Pick<Page, 'id' | 'title' | 'slug' | '_status'> => ({
  id: 16,
  title: DEMO_OLDAL_CIM,
  slug: DEMO_OLDAL_SLUG,
  _status: 'published',
  ...felul,
})

describe('demo-oldal-visszavonas', () => {
  it('a közzétett demólapot piszkozatba teszi', () => {
    const eredmeny = alkalmazDemoOldalVisszavonas(oldal())
    expect(eredmeny.visszavon).toBe(true)
    expect(eredmeny.kihagyasok).toEqual([])
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0]?.szabaly).toBe('demo-oldal-visszavonas')
    expect(eredmeny.modositasok[0]?.indok).toBeNull()
    expect(eredmeny.modositasok[0]?.uzenet).toContain('#16')
  })

  it('idempotens: a már piszkozat lapon csendben kihagy', () => {
    const eredmeny = alkalmazDemoOldalVisszavonas(oldal({ _status: 'draft' }))
    expect(eredmeny.visszavon).toBe(false)
    expect(eredmeny.modositasok).toEqual([])
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(false)
  })

  it('nincs ilyen webcímű oldal: csendes kihagyás', () => {
    const eredmeny = alkalmazDemoOldalVisszavonas(undefined)
    expect(eredmeny.visszavon).toBe(false)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(false)
    expect(eredmeny.kihagyasok[0]?.indok).toContain(DEMO_OLDAL_SLUG)
  })

  it('más című oldalt ezen a webcímen HANGOSAN kihagy, nem von vissza', () => {
    const eredmeny = alkalmazDemoOldalVisszavonas(oldal({ title: 'Akciós ajánlatok' }))
    expect(eredmeny.visszavon).toBe(false)
    expect(eredmeny.modositasok).toEqual([])
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('Akciós ajánlatok')
  })

  it('a szélső szóköz a címben nem akadály (trimmelt egyezés)', () => {
    const eredmeny = alkalmazDemoOldalVisszavonas(oldal({ title: ` ${DEMO_OLDAL_CIM} ` }))
    expect(eredmeny.visszavon).toBe(true)
  })

  it('a naplósorok gondolatjel nélküliek', () => {
    for (const eset of [oldal(), oldal({ _status: 'draft' }), oldal({ title: 'Más' }), undefined]) {
      const eredmeny = alkalmazDemoOldalVisszavonas(eset)
      for (const lepes of [...eredmeny.modositasok, ...eredmeny.kihagyasok]) {
        expect(lepes.uzenet).not.toMatch(GONDOLATJEL)
        expect(lepes.indok ?? '').not.toMatch(GONDOLATJEL)
      }
    }
  })
})
