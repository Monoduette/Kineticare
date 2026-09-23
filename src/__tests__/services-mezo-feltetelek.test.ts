import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Block, Field, PayloadRequest } from 'payload'
import { beforeChangeTraverseFields } from 'payload'
import { reduceFieldsToValues } from 'payload/shared'
import { describe, expect, it } from 'vitest'

import { sectionSettings } from '../blocks/section-settings'
import {
  SERVICES_SUGO,
  services,
  sinSorMezoLatszik,
  tablaBlokkMezoLatszik,
  tablaSorMezoLatszik,
} from '../blocks/services'
import {
  HOME_HELP_LEAD,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  HOME_USPS_EYEBROW,
} from '../lib/home-help-states'

/**
 * H15 (B9) és H14 (B8): a services blokk mező-feltételei és súgói
 * (src/blocks/services.ts). A feltételek a Payload 3.88 `Condition`
 * aláírását követik: (data, siblingData, { blockData, operation, path, user }).
 */

type NevesMezo = Field & { name: string }

const nevesMezo = (fields: readonly Field[], nev: string): NevesMezo => {
  const talalat = fields.find((mezo): mezo is NevesMezo => 'name' in mezo && mezo.name === nev)
  if (!talalat) throw new Error(`Nincs ilyen mező: ${nev}`)
  return talalat
}

const alMezok = (mezo: Field): Field[] => ('fields' in mezo ? mezo.fields : [])

const leiras = (mezo: Field): string => {
  const admin: unknown = 'admin' in mezo ? mezo.admin : undefined
  if (typeof admin !== 'object' || admin === null || !('description' in admin)) return ''
  return typeof admin.description === 'string' ? admin.description : ''
}

type Feltetel = (data: unknown, siblingData: unknown, kornyezet: unknown) => boolean

const feltetel = (mezo: Field): Feltetel => {
  const admin: unknown = 'admin' in mezo ? mezo.admin : undefined
  if (typeof admin !== 'object' || admin === null || !('condition' in admin)) {
    throw new Error('A mezőnek nincs feltétele.')
  }
  const condition: unknown = admin.condition
  if (typeof condition !== 'function') throw new Error('A feltétel nem függvény.')
  return (data, siblingData, kornyezet) => Boolean(condition(data, siblingData, kornyezet))
}

const sorok = nevesMezo(services.fields, 'rows')
const kep = nevesMezo(services.fields, 'image')
const sorszam = nevesMezo(alMezok(sorok), 'number')
const osszegzes = nevesMezo(alMezok(sorok), 'osszefoglalo')
const panelFoto = nevesMezo(alMezok(sorok), 'photo')

const kornyezet = (elrendezes: unknown) => ({
  blockData: { blockType: 'services', elrendezes },
  operation: 'update',
  path: ['layout', 0, 'rows', 0, 'x'],
  user: null,
})

describe('services: a négy mező-feltétel', () => {
  it('a Kép és a Sorszám csak Táblánál, a Rövid összegzés és a Panel fotója csak Sínnél látszik', () => {
    const esetek: ReadonlyArray<[unknown, boolean, boolean]> = [
      // [elrendezes, táblás mező látszik, sínes mező látszik]
      ['tabla', true, false],
      ['sin', false, true],
      [null, true, false],
      [undefined, true, false],
    ]
    for (const [elrendezes, tablas, sines] of esetek) {
      expect(feltetel(kep)({}, { elrendezes }, { blockData: undefined })).toBe(tablas)
      expect(feltetel(sorszam)({}, { title: 'Sor' }, kornyezet(elrendezes))).toBe(tablas)
      expect(feltetel(osszegzes)({}, { title: 'Sor' }, kornyezet(elrendezes))).toBe(sines)
      expect(feltetel(panelFoto)({}, { title: 'Sor' }, kornyezet(elrendezes))).toBe(sines)
    }
  })

  it('a sor-mező a BLOKK elrendezését nézi, nem a sorét (a sorban nincs ilyen mező)', () => {
    expect(sinSorMezoLatszik({}, { elrendezes: 'sin' }, kornyezet('tabla'))).toBe(false)
    expect(tablaSorMezoLatszik({}, { elrendezes: 'sin' }, kornyezet('tabla'))).toBe(true)
    expect(sinSorMezoLatszik({}, {}, undefined)).toBe(false)
    expect(tablaBlokkMezoLatszik({}, undefined)).toBe(true)
  })

  it('a feltételes mezők nem kötelezők (a generált típus nem változik)', () => {
    for (const mezo of [kep, sorszam, osszegzes, panelFoto]) {
      expect('required' in mezo ? mezo.required : undefined).not.toBe(true)
    }
  })
})

/**
 * ADATMEGŐRZÉS: az elrejtett mező értéke mentéskor NEM vész el. Két oldalt
 * mérünk: a szerver `beforeChange` bejárását (a Payload saját függvénye,
 * DB és hálózat nélkül), és a kliens-űrlap beküldött adatát
 * (`reduceFieldsToValues`, amelyből az admin a mentést építi). A
 * forrás-őrök a Payload-frissítésnél jeleznek, ha a viselkedés változna.
 */
describe('services: az elrejtett mező adata mentéskor megmarad', () => {
  const layoutMezo: Field = { name: 'layout', type: 'blocks', blocks: [services as Block] }

  const mentes = async (elrendezes: 'sin' | 'tabla') => {
    const blokk = {
      id: 'b1',
      blockType: 'services',
      elrendezes,
      image: 31,
      rows: [
        {
          id: 'r1',
          number: '07',
          title: 'Rendelői kezelések',
          osszefoglalo: 'Megőrzött összegzés.',
          body: 'Törzs.',
          photo: 41,
        },
      ],
      sectionSettings: { visible: true, hatter: 'tint' },
    }
    const data: Record<string, unknown> = { layout: [structuredClone(blokk)] }
    const req = {
      payload: { config: { localization: false }, blocks: {} },
      i18n: { language: 'hu', fallbackLanguage: 'hu', translations: {} },
      locale: undefined,
      user: null,
      t: (kulcs: string) => kulcs,
    } as unknown as PayloadRequest
    await beforeChangeTraverseFields({
      id: 1,
      collection: null,
      context: {},
      data,
      doc: {},
      docWithLocales: {},
      errors: [],
      fieldLabelPath: '',
      fields: [layoutMezo],
      global: null,
      mergeLocaleActions: [],
      operation: 'update',
      overrideAccess: true,
      parentIndexPath: '',
      parentIsLocalized: false,
      parentPath: '',
      parentSchemaPath: '',
      req,
      siblingData: data,
      siblingDoc: {},
      siblingDocWithLocales: {},
      skipValidation: false,
    })
    return { elotte: blokk, utana: (data.layout as unknown[])[0] }
  }

  it('szerver: Sínnél a rejtett Kép és Sorszám, Táblánál a rejtett összegzés és fotó megmarad', async () => {
    for (const elrendezes of ['sin', 'tabla'] as const) {
      const { elotte, utana } = await mentes(elrendezes)
      expect(utana).toMatchObject({
        image: elotte.image,
        rows: [{ number: '07', osszefoglalo: 'Megőrzött összegzés.', photo: 41 }],
      })
    }
  })

  it('kliens: a feltételen elbukó mező értéke is a beküldött adatba kerül', () => {
    const adat = reduceFieldsToValues(
      {
        elrendezes: { value: 'sin', initialValue: 'sin', valid: true },
        image: { value: 31, initialValue: 31, valid: true, passesCondition: false },
        'rows.0.number': { value: '07', initialValue: '07', valid: true, passesCondition: false },
      },
      true,
    )
    expect(adat).toEqual({ elrendezes: 'sin', image: 31, rows: [{ number: '07' }] })
  })

  it('forrás-őr: a Payload 3.88 a feltételt csak validáció-kihagyásra használja, és a rejtett mező értékét a form-state-ben tartja', () => {
    const forras = (relativ: string): string =>
      readFileSync(fileURLToPath(new URL(`../../node_modules/${relativ}`, import.meta.url)), 'utf8')
    expect(forras('payload/dist/fields/hooks/beforeChange/promise.js')).toContain(
      'let skipValidationFromHere = skipValidation || !passesCondition;',
    )
    expect(forras('payload/dist/utilities/reduceFieldsToValues.js')).not.toContain(
      'passesCondition',
    )
    const formState = forras(
      '@payloadcms/ui/dist/forms/fieldSchemasToFormState/addFieldStatePromise.js',
    )
    expect(formState).toMatch(
      /if \(passesCondition === false && field\.type !== 'tab' && !isPresentationalWithSubFields\) \{\s*if \(fieldAffectsData\(field\) && data\?\.\[field\.name\] !== undefined\) \{\s*fieldState\.value = data\[field\.name\];/,
    )
  })
})

describe('services: a súgók a kód tényleges tartalékát mondják', () => {
  const mezo = (nev: string): NevesMezo => nevesMezo(services.fields, nev)

  it('a tartalék-szöveg a konstansokból jön (import, nem másolat)', () => {
    expect(leiras(mezo('lead'))).toContain(`„${HOME_HELP_LEAD}”`)
    expect(leiras(mezo('title'))).toContain(`„${HOME_HELP_TITLE}”`)
    expect(leiras(mezo('eyebrow'))).toContain(`„${HOME_USPS_EYEBROW}”`)
    for (const state of HOME_HELP_STATES) {
      expect(leiras(osszegzes)).toContain(`${state.title}: „${state.osszefoglalo}”`)
    }
  })

  it('a Panel fotója súgója nem ígér helyőrzőt, a beépített fotót mondja lapra pontosan', () => {
    const foto = leiras(panelFoto)
    expect(foto).not.toMatch(/helyőrző/i)
    expect(foto).toContain(
      'Ha üresen hagyod, a kezdőlapon és a Szolgáltatások oldalon az ajtó beépített fotója látszik',
    )
    expect(foto).toContain('„Fotó később”')
  })

  it('a lapfüggő szöveg-pótlás pontos: a /szolgaltatasok sínje nem pótol szöveget', () => {
    expect(leiras(osszegzes)).toContain('Más oldalon ilyenkor a sor összegzés nélkül jelenik meg.')
    expect(leiras(mezo('lead'))).toContain('Más oldalon ilyenkor nincs bevezető.')
  })

  it('a feltétel miatt fölöslegessé vált „nem jelenik meg” mondatok kikerültek', () => {
    expect(leiras(kep)).not.toMatch(/Sín-elrendezésnél nem jelenik meg/)
    expect(leiras(osszegzes)).not.toMatch(/Táblánál nem jelenik meg/)
    expect(leiras(panelFoto)).not.toMatch(/Táblánál nem jelenik meg/)
    expect(leiras(mezo('elrendezes'))).toContain('Az elrejtett mező tartalma megmarad')
  })

  it('nincs töltelék-gondolatjel (– —) a services saját szövegeiben (számtartomány kivételével)', () => {
    // A közös Szekció-beállítások csoport-súgója (section-settings.ts) nem a
    // services blokké, azt ez az őr nem nézi; a Háttér kiegészítése igen.
    const sajatMezok = services.fields.filter(
      (mezo) => !('name' in mezo) || mezo.name !== 'sectionSettings',
    )
    const osszes = [
      ...Object.values(SERVICES_SUGO),
      ...sajatMezok.map(leiras),
      ...alMezok(sorok).map(leiras),
    ].join('\n')
    expect(osszes.replace(/\d–\d/g, '')).not.toMatch(/[–—]/)
  })

  it('a Háttér súgója a services blokkban kiegészült, a közös szekció-beállításokban változatlan', () => {
    // A `sectionSettings` csoport a „Megjelenés és elrejtés” collapsible alatt
    // áll (#292): a blokk utolsó mezője a keret, benne a csoport.
    const kozosKeret = sectionSettings()
    const sajatKeret = services.fields[services.fields.length - 1]
    expect(sajatKeret.type).toBe('collapsible')
    const kozosCsoport = nevesMezo(alMezok(kozosKeret), 'sectionSettings')
    const sajatCsoport = nevesMezo(alMezok(sajatKeret), 'sectionSettings')
    const kozos = nevesMezo(alMezok(kozosCsoport), 'hatter')
    const sajat = nevesMezo(alMezok(sajatCsoport), 'hatter')
    expect(leiras(kozos)).not.toContain(SERVICES_SUGO.hatterKiegeszites)
    expect(leiras(sajat)).toBe(`${leiras(kozos)} ${SERVICES_SUGO.hatterKiegeszites}`)
    expect(leiras(sajat)).toContain('Sín-elrendezésnél a Fehér helyett is világoskék látszik')
    // A mező minden más tulajdonsága a közös változaté (séma nem változik, G2).
    expect({ ...sajat, admin: undefined }).toEqual({ ...kozos, admin: undefined })
    expect({ ...sajatKeret, fields: undefined }).toEqual({ ...kozosKeret, fields: undefined })
    expect({ ...sajatCsoport, fields: undefined }).toEqual({ ...kozosCsoport, fields: undefined })
    expect(alMezok(sajatCsoport).map((m) => ('name' in m ? m.name : ''))).toEqual(
      alMezok(kozosCsoport).map((m) => ('name' in m ? m.name : '')),
    )
  })
})
