import { describe, expect, it } from 'vitest'

import { alkalmazMediaAltSzoveg, MEDIA_ALT_SZOVEGEK } from '../scripts/apply-owner-content'

/**
 * WP56 — a kurzusborítók alt-szövege: csak az üres alt-ot tölti ki, a
 * szerkesztői szöveget nem írja felül, idempotens.
 */
describe('alkalmazMediaAltSzoveg', () => {
  const ujAlt = MEDIA_ALT_SZOVEGEK[0].alt

  it('a jóváhagyott szövegek magyarok, gondolatjel nélkül, és a két packshotra mutatnak', () => {
    expect(MEDIA_ALT_SZOVEGEK.map((t) => t.prefix)).toEqual([
      '688b93e6ab76f_Programpackshot',
      '688b873ad2a80_belepotermekpackshot1',
    ])
    for (const tetel of MEDIA_ALT_SZOVEGEK) {
      expect(tetel.alt).not.toMatch(/[–—]/)
      expect(tetel.alt.length).toBeGreaterThan(20)
      expect(tetel.alt.length).toBeLessThan(150)
    }
  })

  it('üres vagy csupa szóköz alt → a jóváhagyott szöveg', () => {
    for (const jelenlegiAlt of ['', '   ', null, undefined]) {
      const e = alkalmazMediaAltSzoveg({ cimke: 'Borító', jelenlegiAlt, ujAlt })
      expect(e.alt).toBe(ujAlt)
      expect(e.modositasok).toHaveLength(1)
      expect(e.modositasok[0].szabaly).toBe('media-alt-szoveg')
      expect(e.kihagyasok).toHaveLength(0)
    }
  })

  it('idempotens: a már beállított szöveg csendes kihagyás', () => {
    const e = alkalmazMediaAltSzoveg({ cimke: 'Borító', jelenlegiAlt: ujAlt, ujAlt })
    expect(e.alt).toBeNull()
    expect(e.modositasok).toHaveLength(0)
    expect(e.kihagyasok[0].indok).toContain('MÁR')
    expect(e.kihagyasok[0].hangos).not.toBe(true)
  })

  it('szerkesztői alt-ot nem ír felül', () => {
    const e = alkalmazMediaAltSzoveg({ cimke: 'Borító', jelenlegiAlt: 'Saját leírás', ujAlt })
    expect(e.alt).toBeNull()
    expect(e.modositasok).toHaveLength(0)
    expect(e.kihagyasok[0].indok).toContain('szerkesztői')
  })
})
