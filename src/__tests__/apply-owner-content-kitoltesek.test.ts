import { describe, expect, it } from 'vitest'

import { FILM_CAPTION_DEFAULTS, FILM_CAPTION_FIELDS } from '../lib/film-captions'
import type { Page } from '../payload-types'
import {
  alkalmazFilmFeliratok,
  alkalmazSosCim,
  kurzusCimLepesek,
} from '../scripts/apply-owner-content'
import { kitoltKurzusCimeket } from '../scripts/kurzus-cim-kitoltes'
import { SOS_CIM_REGI, SOS_CIM_UJ } from '../scripts/sos-cim-kitoltes'

/**
 * A három előtöltő szabály (SOS-cím, filmfeliratok, Kurzus címe) bekötése a
 * content job láncába: a döntés a modulokban van tesztelve, itt azt őrizzük,
 * hogy a futtató a helyes szekciósort kapja vissza, és hogy a második futás
 * nem ír.
 */

type Szekciosor = NonNullable<Page['layout']>

const szekciosor = (blokkok: unknown[]): Szekciosor => blokkok as Szekciosor

const film = (captions?: Record<string, unknown>) => ({
  id: 'film',
  blockType: 'filmHero',
  ...(captions === undefined ? {} : { captions }),
})
const sos = (title: unknown) => ({ id: 'sos', blockType: 'freeSos', title })

describe('alkalmazSosCim', () => {
  it('a régi, gondolatjeles címet „Ingyenes villámkurzus”-ra írja, a többi blokkot érintetlenül hagyja', () => {
    const filmBlokk = film()
    const eredmeny = alkalmazSosCim(szekciosor([filmBlokk, sos(SOS_CIM_REGI)]), 'Kezdőlap')
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0]?.szabaly).toBe('sos-cim')
    expect(eredmeny.layout?.[0]).toBe(filmBlokk)
    expect((eredmeny.layout?.[1] as { title?: unknown }).title).toBe(SOS_CIM_UJ)
  })

  it('a második futás nem ír (layout null, indokolt kihagyás)', () => {
    const eredmeny = alkalmazSosCim(szekciosor([sos(SOS_CIM_UJ)]), 'Kezdőlap')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toEqual([])
    expect(eredmeny.kihagyasok[0]?.indok).toBe('már javítva')
  })

  it('a szerkesztői címhez nem nyúl', () => {
    const eredmeny = alkalmazSosCim(szekciosor([sos('Próbáld ki ingyen')]), 'Kezdőlap')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0]?.indok).toBe('szerkesztői szöveg')
  })

  it('SOS-sáv nélkül indokolt kihagyás, írás nélkül', () => {
    const eredmeny = alkalmazSosCim(szekciosor([film()]), 'Kezdőlap')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(1)
  })
})

describe('alkalmazFilmFeliratok', () => {
  it('az üres feliratmezőkbe a beépített szöveget írja', () => {
    const eredmeny = alkalmazFilmFeliratok(szekciosor([film(), sos(SOS_CIM_UJ)]), 'Kezdőlap')
    expect(eredmeny.modositasok).toHaveLength(FILM_CAPTION_FIELDS.length)
    expect(eredmeny.modositasok.every((lepes) => lepes.szabaly === 'film-feliratok')).toBe(true)
    expect((eredmeny.layout?.[0] as { captions?: unknown }).captions).toEqual(FILM_CAPTION_DEFAULTS)
  })

  it('a kitöltött mezőt betűre megtartja', () => {
    const eredmeny = alkalmazFilmFeliratok(
      szekciosor([film({ midTitle: 'Saját cím' })]),
      'Kezdőlap',
    )
    expect(eredmeny.modositasok).toHaveLength(FILM_CAPTION_FIELDS.length - 1)
    expect((eredmeny.layout?.[0] as { captions: Record<string, unknown> }).captions.midTitle).toBe(
      'Saját cím',
    )
  })

  it('a második futás nem ír', () => {
    const elso = alkalmazFilmFeliratok(szekciosor([film()]), 'Kezdőlap')
    expect(elso.layout).not.toBeNull()
    const masodik = alkalmazFilmFeliratok(elso.layout as Szekciosor, 'Kezdőlap')
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toEqual([])
    expect(masodik.kihagyasok[0]?.indok).toBe('minden feliratmező ki van töltve')
  })

  it('nyitó videó nélkül indokolt kihagyás', () => {
    const eredmeny = alkalmazFilmFeliratok(szekciosor([sos(SOS_CIM_UJ)]), 'Kezdőlap')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0]?.indok).toBe('a szekciósorban nincs nyitó videó blokk')
  })
})

describe('kurzusCimLepesek', () => {
  it('a kitöltés módosításként, a többi kurzus kihagyásként naplózódik', () => {
    const eredmeny = kitoltKurzusCimeket([
      { id: 1, sku: 'Otthoni KézRehab Program', slug: 'otthoni', displayTitle: null },
      { id: 2, sku: 'SOS Kézrelax', slug: 'sos', displayTitle: 'SOS Kézrelax' },
      { id: 3, sku: 'Harmadik', slug: 'harmadik', displayTitle: 'Szerkesztői név' },
    ])
    const lepesek = kurzusCimLepesek(eredmeny)
    expect(lepesek.modositasok).toHaveLength(1)
    expect(lepesek.modositasok[0]?.szabaly).toBe('kurzus-cim')
    expect(lepesek.kihagyasok.map((lepes) => lepes.indok)).toEqual([
      'már kitöltve',
      'szerkesztői szöveg vagy hiányzó adat',
    ])
    expect(eredmeny.modositasok?.[0]?.data).toEqual({
      displayTitle: 'Otthoni KézRehab Program',
      slug: 'otthoni',
    })
  })

  it('kurzus nélkül egyetlen indokolt kihagyás', () => {
    const lepesek = kurzusCimLepesek(kitoltKurzusCimeket([]))
    expect(lepesek.modositasok).toEqual([])
    expect(lepesek.kihagyasok).toHaveLength(1)
  })
})
