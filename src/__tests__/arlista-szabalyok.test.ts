import type { Field, UIField } from 'payload'
import { describe, expect, it } from 'vitest'

import { pageBlocks } from '../blocks'
import { RICH_TEXT_TARTALOM_SUGO, richText } from '../blocks/rich-text'
import { ARLISTA_TEENDO } from '../components/editor/frontend/szerkeszto-szalag'
import {
  ARLISTA_FORMAI_SZABALYOK,
  arlistaSzabalySzoveg,
  rendeloiHorgonyu,
} from '../lib/admin/arlista-szabalyok'
import { CLINIC_TREATMENTS_ANCHOR } from '../lib/menu-seed'
import { felismerRendeloiArlista } from '../lib/rendeloi-arlista'
import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * A rendelői árlista formai szabályainak őre (modul-térkép H29). Egy minden
 * szabályt követő Lexical-dokumentumot a felismerő elfogad, és szabályonként
 * legalább egy sértő változatot elutasít; a szerkesztőnek szóló szöveg minden
 * szabályt kimond, gondolatjel nélkül.
 */

type Csomopont = Readonly<Record<string, unknown>>

const szoveg = (text: string): Csomopont => ({ type: 'text', text, format: 0, version: 1 })

const cimsor = (tag: string, text: string): Csomopont => ({
  type: 'heading',
  tag,
  children: [szoveg(text)],
})

const bekezdes = (...children: Csomopont[]): Csomopont => ({ type: 'paragraph', children })

const lista = (...tetelek: string[]): Csomopont => ({
  type: 'list',
  listType: 'bullet',
  tag: 'ul',
  children: tetelek.map((text, index) => ({
    type: 'listitem',
    value: index + 1,
    children: [szoveg(text)],
  })),
})

const link = (url: string, text: string): Csomopont => ({
  type: 'link',
  fields: { linkType: 'custom', url, newTab: false },
  children: [szoveg(text)],
})

const dokumentum = (...children: Csomopont[]): unknown => ({
  root: { type: 'root', children },
})

const CIM = cimsor('h2', 'Rendelői kezelések')
const ARLISTA = cimsor('h3', 'Árlista: gyógytorna és manuálterápia')
const TETELEK = lista(
  '50 perces alkalom: 18 000 Ft',
  '20 perces alkalom - 10 000 Ft (rövid kezelés)',
)
const TENY = bekezdes(szoveg('Az első alkalom minden esetben 50 perces vizsgálat.'))
const HELYSZIN = bekezdes(szoveg('Helyszíneink: 1117 Budapest, Nádorliget u. 7/b • 1114 Budapest'))
const CTA = bekezdes(szoveg('Jelentkezés: '), link('/kapcsolat', 'időpontot kérek'))

const helyes = (): unknown =>
  dokumentum(CIM, bekezdes(szoveg('Bevezető mondat.')), ARLISTA, TETELEK, TENY, HELYSZIN, CTA)

describe('a minden szabályt követő dokumentum', () => {
  it('a felismerő szerkezetet ad', () => {
    const modell = felismerRendeloiArlista(helyes())
    expect(modell).not.toBeNull()
    expect(modell?.tetelek).toHaveLength(2)
    expect(modell?.helyszinek?.cimek).toHaveLength(2)
    expect(modell?.cta).not.toBeNull()
  })

  it('Címsor 1, négy tétel és link nélküli változat is elfogadott', () => {
    const negyTetel = lista(
      '50 perces alkalom: 18 000 Ft',
      '30 perces alkalom: 12 000 Ft',
      '20 perces alkalom: 10 000 Ft',
      '90 perces alkalom: 30 000 Ft',
    )
    expect(
      felismerRendeloiArlista(
        dokumentum(cimsor('h1', 'Rendelő'), cimsor('h1', 'Árlista'), negyTetel),
      ),
    ).not.toBeNull()
  })
})

describe('szabályonként egy sértő változat', () => {
  const esetek: [string, unknown][] = [
    [
      '1. szabály: Címsor 4 az első elem',
      dokumentum(cimsor('h4', 'Rendelői kezelések'), ARLISTA, TETELEK),
    ],
    ['1. szabály: az első elem bekezdés', dokumentum(TENY, ARLISTA, TETELEK)],
    ['1. szabály: üres első címsor', dokumentum(cimsor('h2', '  '), ARLISTA, TETELEK)],
    ['2. szabály: nincs Árlista-címsor', dokumentum(CIM, TETELEK, TENY)],
    ['2. szabály: az Árlista-címsor Címsor 4', dokumentum(CIM, cimsor('h4', 'Árlista'), TETELEK)],
    ['3. szabály: a lista nem közvetlenül a címsor alatt', dokumentum(CIM, ARLISTA, TENY, TETELEK)],
    ['3. szabály: rossz tételalak', dokumentum(CIM, ARLISTA, lista('50 perc, 18 000 forint'))],
    [
      '3. szabály: öt tétel',
      dokumentum(
        CIM,
        ARLISTA,
        lista(
          '10 perces alkalom: 5 000 Ft',
          '20 perces alkalom: 10 000 Ft',
          '30 perces alkalom: 12 000 Ft',
          '50 perces alkalom: 18 000 Ft',
          '90 perces alkalom: 30 000 Ft',
        ),
      ),
    ],
    ['3. szabály: üres felsorolás', dokumentum(CIM, ARLISTA, lista())],
    [
      '4. szabály: címsor a lista után',
      dokumentum(CIM, ARLISTA, TETELEK, cimsor('h3', 'Tudnivalók')),
    ],
    ['4. szabály: újabb lista a lista után', dokumentum(CIM, ARLISTA, TETELEK, TENY, lista('egy'))],
    [
      '5. szabály: térkép-link',
      dokumentum(
        CIM,
        ARLISTA,
        TETELEK,
        bekezdes(link('https://maps.google.com/?q=Budapest', 'térkép')),
      ),
    ],
    ['5. szabály: két link', dokumentum(CIM, ARLISTA, TETELEK, CTA, CTA)],
    [
      '5. szabály: két Helyszíneink-bekezdés',
      dokumentum(CIM, ARLISTA, TETELEK, HELYSZIN, HELYSZIN),
    ],
  ]

  it.each(esetek)('%s: a felismerő null', (_nev, content) => {
    expect(felismerRendeloiArlista(content)).toBeNull()
  })

  it('minden szabálynak van sértő változata', () => {
    for (let index = 1; index <= ARLISTA_FORMAI_SZABALYOK.length; index += 1) {
      expect(esetek.some(([nev]) => nev.startsWith(`${index}. szabály`))).toBe(true)
    }
  })
})

describe('a szerkesztőnek szóló szöveg', () => {
  const teljes = arlistaSzabalySzoveg()

  it('öt szabály, számozott mondatokként, egy bekezdésben', () => {
    expect(ARLISTA_FORMAI_SZABALYOK).toHaveLength(5)
    ARLISTA_FORMAI_SZABALYOK.forEach((mondat, index) => {
      expect(teljes).toContain(`${index + 1}. ${mondat}`)
    })
    expect(teljes).not.toContain('\n')
    expect(teljes).toContain(`„${CLINIC_TREATMENTS_ANCHOR}”`)
    expect(teljes).toContain('sima szövegként látszik')
  })

  it('minden szabály kulcsa benne van', () => {
    const kulcsok = [
      'első elem',
      'Címsor 1, 2 vagy 3',
      'kisebb címsor nem számít',
      '„Árlista”',
      'Közvetlenül',
      'legalább egy, legfeljebb négy',
      '„50 perces alkalom: 18 000 Ft”',
      'kötőjel',
      'zárójeles megjegyzés',
      'csak bekezdés következhet',
      'újabb felsorolás vagy címsor nem',
      'legfeljebb egy link',
      '/kapcsolat',
      '„Helyszíneink:”',
      'legfeljebb egyszer',
    ]
    for (const kulcs of kulcsok) expect(teljes).toContain(kulcs)
  })

  it('nincs benne gondolatjel (U+2013, U+2014)', () => {
    expect(teljes).not.toContain(EN_DASH)
    expect(teljes).not.toContain(EM_DASH)
  })

  it('a példa-tétel alakját a felismerő elfogadja', () => {
    expect(
      felismerRendeloiArlista(dokumentum(CIM, ARLISTA, lista('50 perces alkalom: 18 000 Ft'))),
    ).not.toBeNull()
  })
})

function uiMezo(fields: readonly Field[], name: string): UIField {
  const mezo = fields.find((field) => 'name' in field && field.name === name)
  if (!mezo || mezo.type !== 'ui') throw new Error(`nincs ${name} UI-mező`)
  return mezo
}

function feltetel(mezo: UIField, siblingData: unknown): boolean {
  const condition = mezo.admin?.condition
  if (!condition) throw new Error(`${mezo.name}: nincs condition`)
  return Boolean(
    condition({}, siblingData as Record<string, unknown>, {
      blockData: {},
      operation: 'update',
      path: 'layout.2.arlistaSzabalyJelzes'.split('.'),
      user: null,
    }),
  )
}

describe('a Szabad szöveg blokk árlista-jelzése', () => {
  it('a Tartalom előtt áll, a Payload FieldDescription-komponensével', () => {
    const nevek = richText.fields.map((field) => ('name' in field ? field.name : null))
    expect(nevek.indexOf('arlistaSzabalyJelzes')).toBe(nevek.indexOf('content') - 1)
    const komponens = uiMezo(richText.fields, 'arlistaSzabalyJelzes').admin?.components?.Field
    expect(typeof komponens === 'object' && komponens !== null ? komponens.path : null).toBe(
      '@payloadcms/ui#FieldDescription',
    )
  })

  it('a burkolt katalógusban nem az első mező', () => {
    const burkolt = pageBlocks.find((block) => block.slug === 'richText')
    const [elso] = burkolt?.fields ?? []
    expect(elso && 'name' in elso ? elso.name : null).not.toBe('arlistaSzabalyJelzes')
  })

  it('csak a rendeloi ugrópontnál látszik (szóközök nélkül)', () => {
    const mezo = uiMezo(richText.fields, 'arlistaSzabalyJelzes')
    const horgony = (anchorId: unknown) => ({ sectionSettings: { anchorId } })
    expect(feltetel(mezo, horgony(CLINIC_TREATMENTS_ANCHOR))).toBe(true)
    expect(feltetel(mezo, horgony(`  ${CLINIC_TREATMENTS_ANCHOR} `))).toBe(true)
    expect(feltetel(mezo, horgony('kurzusok'))).toBe(false)
    expect(feltetel(mezo, horgony(null))).toBe(false)
    expect(feltetel(mezo, {})).toBe(false)
    expect(rendeloiHorgonyu(undefined)).toBe(false)
  })

  it('a Tartalom-súgó változatlan', () => {
    expect(RICH_TEXT_TARTALOM_SUGO).toContain(ARLISTA_TEENDO)
  })
})
