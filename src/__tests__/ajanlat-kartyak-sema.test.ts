import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { offerCards, pageBlocks, pageBlockSlugs } from '../blocks/index'
import { linkFields } from '../blocks/link-fields'
import { sectionSettings } from '../blocks/section-settings'

/**
 * H11: az „Ajánlat-kártyák” (offerCards) blokk sémája. A mezőnevek
 * SZERZŐDÉS: a megjelenítés (OfferCards.tsx, A7), a tartalom-job és a
 * sorcímke (section-row-label.ts) ezekre épít, ezért a teszt betűre
 * rögzíti a neveket, típusokat, a kötelezőséget, a sorkorlátokat, az
 * alapértékeket és a feltételes megjelenítést.
 */

type Nevesitett = Field & { name: string }

function nevesitett(fields: readonly Field[]): Nevesitett[] {
  return fields.filter((field): field is Nevesitett => 'name' in field)
}

function mezo(fields: readonly Field[], nev: string): Nevesitett {
  const talalat = nevesitett(fields).find((field) => field.name === nev)
  if (!talalat) throw new Error(`Hiányzó mező: ${nev}`)
  return talalat
}

function leiras(field: Field): string {
  const admin = 'admin' in field ? field.admin : undefined
  const description = admin && 'description' in admin ? admin.description : undefined
  return typeof description === 'string' ? description : ''
}

const kartyak = mezo(offerCards.fields, 'kartyak')
const kartyaMezok = kartyak.type === 'array' ? kartyak.fields : []

describe('offerCards: a blokk azonosítói', () => {
  it('slug, interfaceName, nevek és admin-csoport', () => {
    expect(offerCards.slug).toBe('offerCards')
    expect(offerCards.interfaceName).toBe('BlockOfferCards')
    expect(offerCards.labels).toEqual({ singular: 'Ajánlat-kártyák', plural: 'Ajánlat-kártyák' })
    expect(offerCards.admin?.group).toBe('Bárhol használható')
  })

  it('a katalógus VÉGÉN áll, a ctaBanner után, a közös admin-burokkal', () => {
    expect(pageBlockSlugs.at(-1)).toBe('offerCards')
    expect(pageBlockSlugs.at(-2)).toBe('ctaBanner')
    const burkolt = pageBlocks.at(-1)
    expect(burkolt?.admin?.disableBlockName).toBe(true)
    expect(burkolt?.admin?.components?.Label).toBeDefined()
  })
})

describe('offerCards: a felső mezők sorrendben', () => {
  it('eyebrow, title, lead, kartyak, majd utolsóként a sectionSettings', () => {
    expect(nevesitett(offerCards.fields).map((field) => field.name)).toEqual([
      'eyebrow',
      'title',
      'lead',
      'kartyak',
    ])
    expect(offerCards.fields).toHaveLength(5)
  })

  it('típusok és címkék; egyik sem kötelező', () => {
    expect(mezo(offerCards.fields, 'eyebrow')).toMatchObject({
      type: 'text',
      label: 'Felső kis felirat',
    })
    expect(mezo(offerCards.fields, 'title')).toMatchObject({ type: 'text', label: 'Szekció címe' })
    expect(mezo(offerCards.fields, 'lead')).toMatchObject({ type: 'textarea', label: 'Bevezető' })
    for (const nev of ['eyebrow', 'title', 'lead']) {
      const field = mezo(offerCards.fields, nev)
      expect('required' in field ? field.required : undefined, nev).toBeFalsy()
    }
    expect(leiras(mezo(offerCards.fields, 'title'))).toContain(
      'ha üresen hagyod, a szekció cím nélkül jelenik meg',
    )
  })

  it('a sectionSettings a közös, változatlan csoport', () => {
    const utolso = offerCards.fields.at(-1)
    expect(JSON.stringify(utolso)).toBe(JSON.stringify(sectionSettings()))
    expect(utolso?.type).toBe('collapsible')
  })
})

describe('offerCards: a Kártyák tömb', () => {
  it('array, 1–4 sor, Kártya/Kártyák, csukva nyílik', () => {
    expect(kartyak).toMatchObject({
      type: 'array',
      label: 'Kártyák',
      minRows: 1,
      maxRows: 4,
      labels: { singular: 'Kártya', plural: 'Kártyák' },
      admin: { initCollapsed: true },
    })
  })

  it('a sormezők sorrendje (a link-mezők a link-fields.ts nevein)', () => {
    const linkNevek = nevesitett(linkFields()).map((field) => field.name)
    expect(linkNevek).toEqual(['felirat', 'url', 'ujAblakban'])
    expect(nevesitett(kartyaMezok).map((field) => field.name)).toEqual([
      'ikon',
      'kicker',
      'cim',
      'szoveg',
      'tenyek',
      ...linkNevek,
      'gombSuly',
      'jegyzet',
      'hamarosan',
      'allapotSzoveg',
    ])
  })

  it('ikon: select, három érték, alapértéke „nincs”', () => {
    expect(mezo(kartyaMezok, 'ikon')).toMatchObject({
      type: 'select',
      label: 'Ikon',
      defaultValue: 'nincs',
      options: [
        { label: 'Képzés (tábla)', value: 'kepzes' },
        { label: 'Szakkönyv (nyitott könyv)', value: 'szakkonyv' },
        { label: 'Nincs ikon', value: 'nincs' },
      ],
    })
  })

  it('kicker nem kötelező text; cim kötelező text; szoveg kötelező textarea', () => {
    const kicker = mezo(kartyaMezok, 'kicker')
    expect(kicker).toMatchObject({ type: 'text', label: 'Kis felirat' })
    expect('required' in kicker ? kicker.required : undefined).toBeFalsy()
    expect(mezo(kartyaMezok, 'cim')).toMatchObject({ type: 'text', required: true, label: 'Cím' })
    expect(mezo(kartyaMezok, 'szoveg')).toMatchObject({
      type: 'textarea',
      required: true,
      label: 'Szöveg',
    })
  })

  it('tenyek: legfeljebb 4 sor, egyetlen kötelező „Tény” szövegmezővel', () => {
    const tenyek = mezo(kartyaMezok, 'tenyek')
    expect(tenyek).toMatchObject({ type: 'array', label: 'Tények (felsorolás)', maxRows: 4 })
    expect('minRows' in tenyek ? tenyek.minRows : undefined).toBeUndefined()
    const belso = tenyek.type === 'array' ? nevesitett(tenyek.fields) : []
    expect(belso).toHaveLength(1)
    expect(belso[0]).toMatchObject({ name: 'szoveg', type: 'text', required: true, label: 'Tény' })
  })

  it('a link-mezők a közös link-fields.ts-ből jönnek (url-ellenőrzéssel)', () => {
    expect(mezo(kartyaMezok, 'felirat')).toMatchObject({ type: 'text', label: 'Felirat' })
    const url = mezo(kartyaMezok, 'url')
    expect(url).toMatchObject({ type: 'text', label: 'Hová vigyen (webcím)' })
    expect(typeof ('validate' in url ? url.validate : undefined)).toBe('function')
    expect(mezo(kartyaMezok, 'ujAblakban')).toMatchObject({ type: 'checkbox', defaultValue: false })
  })

  it('gombSuly: select, alapértéke a másodlagos, a súgó egy elsődlegest kér', () => {
    const gombSuly = mezo(kartyaMezok, 'gombSuly')
    expect(gombSuly).toMatchObject({
      type: 'select',
      label: 'Gomb súlya',
      defaultValue: 'masodlagos',
      options: [
        { label: 'Elsődleges (kitöltött)', value: 'elsodleges' },
        { label: 'Másodlagos (keretes)', value: 'masodlagos' },
      ],
    })
    expect(leiras(gombSuly)).toContain('Egy lapon egy elsődleges gomb legyen')
  })

  it('jegyzet: text, a súgó kimondja az új lapos tartalékot', () => {
    const jegyzet = mezo(kartyaMezok, 'jegyzet')
    expect(jegyzet).toMatchObject({ type: 'text', label: 'Jegyzet a gomb alatt' })
    expect(leiras(jegyzet)).toContain(
      'Ha üresen hagyod és a gomb új lapon nyílik, a lap magától kiírja: „Külső oldal, új lapon nyílik.”',
    )
  })

  it('hamarosan: checkbox, alapértéke hamis', () => {
    expect(mezo(kartyaMezok, 'hamarosan')).toMatchObject({
      type: 'checkbox',
      label: 'Még nem elérhető',
      defaultValue: false,
    })
  })

  it('allapotSzoveg: textarea, csak bekapcsolt „Még nem elérhető” mellett látszik', () => {
    const allapot = mezo(kartyaMezok, 'allapotSzoveg')
    expect(allapot).toMatchObject({ type: 'textarea', label: 'Mikor lesz elérhető?' })
    const condition =
      allapot.admin && 'condition' in allapot.admin ? allapot.admin.condition : undefined
    expect(typeof condition).toBe('function')
    if (typeof condition !== 'function') return
    const futtat = (siblingData: Record<string, unknown>) =>
      condition({}, siblingData, { blockData: {}, operation: 'update', path: [], user: null })
    expect(futtat({ hamarosan: true })).toBe(true)
    expect(futtat({ hamarosan: false })).toBe(false)
    expect(futtat({})).toBe(false)
  })
})

describe('offerCards: a szerkesztői szövegek tipográfiája (ui-sztenderdek 8.3)', () => {
  /** Minden label, labels és description a blokk mezőfájában, rekurzívan. */
  function szovegek(fields: readonly Field[]): string[] {
    return fields.flatMap((field) => {
      const sajat: string[] = []
      if ('label' in field && typeof field.label === 'string') sajat.push(field.label)
      const desc = leiras(field)
      if (desc) sajat.push(desc)
      if ('labels' in field && field.labels) {
        for (const ertek of Object.values(field.labels)) {
          if (typeof ertek === 'string') sajat.push(ertek)
        }
      }
      if ('options' in field && Array.isArray(field.options)) {
        for (const opcio of field.options) {
          if (typeof opcio === 'object' && typeof opcio.label === 'string') sajat.push(opcio.label)
        }
      }
      const belso = 'fields' in field && Array.isArray(field.fields) ? szovegek(field.fields) : []
      return [...sajat, ...belso]
    })
  }

  const osszes = [String(offerCards.labels?.singular), ...szovegek(offerCards.fields.slice(0, -1))]

  it('nincs gondolatjel, egyenes vagy angol idézőjel, három pont és verzál szó', () => {
    const hibas = osszes.filter(
      (szoveg) =>
        /—|\s–\s|\s-\s|"|“|\.\.\./u.test(szoveg) ||
        /\b\p{Lu}{4,}\b/u.test(szoveg.replace(/SZTK/gu, '')),
    )
    expect(hibas).toEqual([])
  })

  it('a magyar idézőjelek párban állnak', () => {
    for (const szoveg of osszes) {
      const nyito = [...szoveg].filter((jel) => jel === '„').length
      const zaro = [...szoveg].filter((jel) => jel === '”').length
      expect(nyito, szoveg).toBe(zaro)
    }
  })

  it('minden nem kötelező szöveges mező súgója kimondja, mi történik üresen', () => {
    const uresMondat = /üresen|ha nem választasz|nem kötelező|legalább 1/iu
    const vizsgalt = [
      ...nevesitett(offerCards.fields).filter((field) =>
        ['eyebrow', 'title', 'lead', 'kartyak'].includes(field.name),
      ),
      ...nevesitett(kartyaMezok).filter((field) =>
        ['ikon', 'kicker', 'tenyek', 'felirat', 'gombSuly', 'jegyzet', 'allapotSzoveg'].includes(
          field.name,
        ),
      ),
    ]
    for (const field of vizsgalt) {
      const szoveg = leiras(field)
      const ikonNincs = field.name === 'ikon' && szoveg.includes('ikon nélkül jelenik meg')
      const gombNelkul = field.name === 'felirat' && szoveg.includes('gomb nélkül jelenik meg')
      expect(uresMondat.test(szoveg) || ikonNincs || gombNelkul, field.name).toBe(true)
    }
  })
})
