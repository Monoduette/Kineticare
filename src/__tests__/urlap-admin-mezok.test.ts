import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import type { Config, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { appointment } from '../blocks/appointment'
import {
  ATIRANYITAS_SUGO,
  CIM_SUGO,
  FORM_BINDING_NOTICE_PATH,
  GOMB_SUGO,
  IDOPONT_KOSZONO_CIM_MEZO,
  IDOPONT_KOSZONO_MEZO,
  IDOPONT_SZEKCIO_NEV,
  KOSZONO_SZOVEG_SUGO,
  MEGEROSITES_TIPUS_SUGO,
  MEZOK_SUGO,
  URLAP_GYUJTEMENY_LEIRAS,
  URLAP_KOTES_MEZO_NEV,
  urlapCimMasolatNeve,
  urlapMezokAdminnal,
  validateUrlapCim,
} from '../lib/admin/urlap-admin'
import { ctaLabel } from '../lib/cta-vocabulary'
import { NEWSLETTER_SUCCESS_MESSAGE } from '../lib/newsletter/submit'

/**
 * Az Űrlapok gyűjtemény admin-mezői (modul-térkép H17, H45).
 *
 * Séma-semleges: a plugin VALÓDI alapmezőihez (formBuilderPlugin, ugyanazokkal
 * a beállításokkal, mint a src/payload.config.ts) képest csak az admin-kulcsok,
 * a cím validátora és a cím `hooks.beforeDuplicate`-je térhet el; a nevek,
 * típusok, a kötelezőség és a fa szerkezete azonos. Az `emails` rejtett, readOnly csak nem kötelező mezőn
 * van, és a súgók igazak (a hivatkozott mezőnév a blokk configjából jön, a
 * „nem olvassa” állítást forrás-söprés őrzi).
 */

type Rekord = Record<string, unknown>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function formsMezok(): Promise<{ alap: Field[]; uj: Field[] }> {
  let alap: Field[] = []
  const config = await formBuilderPlugin({
    formOverrides: {
      fields: ({ defaultFields }) => {
        alap = defaultFields
        return urlapMezokAdminnal(defaultFields)
      },
    },
  })({ collections: [], i18n: {} } as unknown as Config)
  const forms = config.collections?.find((gyujtemeny) => gyujtemeny.slug === 'forms')
  return { alap, uj: forms?.fields ?? [] }
}

/** Mélymásolat az `admin` kulcsok nélkül (a függvények referenciája marad). */
function adminNelkul(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(adminNelkul)
  }
  if (!isRekord(value)) {
    return value
  }
  const masolat: Rekord = {}
  for (const [kulcs, ertek] of Object.entries(value)) {
    if (kulcs !== 'admin') {
      masolat[kulcs] = adminNelkul(ertek)
    }
  }
  return masolat
}

function melyenFagyaszt<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const ertek of Object.values(value)) {
      melyenFagyaszt(ertek)
    }
  }
  return value
}

function mezo(mezok: readonly Field[], nev: string): Rekord {
  const talalat = mezok.find((elem) => 'name' in elem && elem.name === nev)
  if (!isRekord(talalat)) {
    throw new Error(`nincs ilyen mező: ${nev}`)
  }
  return talalat
}

function admin(elem: Rekord): Rekord {
  return isRekord(elem.admin) ? elem.admin : {}
}

describe('séma-semlegesség: a mezőfa a plugin alapmezőivel azonos', () => {
  it('az adatmezők neve, típusa, kötelezősége és fája azonos, csak az admin-kulcs más', async () => {
    const { alap, uj } = await formsMezok()
    expect(alap.length).toBeGreaterThan(0)
    const adatmezok = uj.filter((elem) => elem.type !== 'ui')
    // A cím validátora és duplikálási hookja az egyetlen nem-admin eltérés
    // (H17, a feladat része); a plugin a címre nem tesz saját hookot.
    const ujFa = adminNelkul(adatmezok) as Rekord[]
    const cim = ujFa.find((elem) => elem.name === 'title')
    expect(mezo(alap, 'title').hooks).toBeUndefined()
    expect(cim?.validate).toBe(validateUrlapCim)
    expect(cim?.hooks).toEqual({ beforeDuplicate: [urlapCimMasolatNeve] })
    delete cim?.validate
    delete cim?.hooks
    expect(ujFa).toEqual(adminNelkul(alap))
    expect(adatmezok.map((elem) => ('name' in elem ? elem.name : null))).toEqual([
      'title',
      'fields',
      'submitButtonLabel',
      'confirmationType',
      'confirmationMessage',
      'redirect',
      'emails',
    ])
  })

  it('legelöl egyetlen UI-mező áll, a FormBindingNotice (adatbázis-oszlop nélkül)', async () => {
    const { uj } = await formsMezok()
    const ui = uj.filter((elem) => elem.type === 'ui')
    expect(ui).toHaveLength(1)
    expect(uj[0]).toBe(ui[0])
    expect(uj[0]).toMatchObject({
      name: URLAP_KOTES_MEZO_NEV,
      type: 'ui',
      admin: { disableListColumn: true, components: { Field: FORM_BINDING_NOTICE_PATH } },
    })
    expect(FORM_BINDING_NOTICE_PATH).toBe('/components/admin/FormBindingNotice#FormBindingNotice')
  })

  it('a bemenetet nem módosítja (mélyen fagyasztott alapmezőkön is lefut)', async () => {
    let pillanatkep = ''
    let alap: Field[] = []
    await formBuilderPlugin({
      formOverrides: {
        fields: ({ defaultFields }) => {
          alap = defaultFields
          pillanatkep = JSON.stringify(defaultFields)
          // Ha a függvény a bemenetbe írna, a fagyasztott objektumon a szigorú
          // módú ESM-kód TypeError-t dobna.
          const eredmeny = urlapMezokAdminnal(melyenFagyaszt(defaultFields))
          expect(eredmeny).not.toBe(defaultFields)
          return eredmeny
        },
      },
    })({ collections: [], i18n: {} } as unknown as Config)
    expect(JSON.stringify(alap)).toBe(pillanatkep)
    expect(alap.every((elem) => Object.isFrozen(elem))).toBe(true)
  })
})

describe('a cím duplikálási hookja a plugin saját hookjai mellé kerül', () => {
  it('a meglévő hookok megmaradnak, a miénk a beforeDuplicate végén áll', () => {
    const sajatDuplikalas = () => 'plugin'
    const sajatOlvasas = () => 'olvas'
    const alap: Field[] = [
      {
        name: 'title',
        type: 'text',
        required: true,
        hooks: { beforeDuplicate: [sajatDuplikalas], afterRead: [sajatOlvasas] },
      },
    ]
    const cim = mezo(urlapMezokAdminnal(melyenFagyaszt(alap)), 'title')
    expect(cim.hooks).toEqual({
      beforeDuplicate: [sajatDuplikalas, urlapCimMasolatNeve],
      afterRead: [sajatOlvasas],
    })
    expect(cim.required).toBe(true)
  })
})

describe('H45: az E-mailek lista rejtett, a hozzáférése változatlan', () => {
  it('admin.hidden, és a plugin mező-szintű access-e ugyanaz a függvény', async () => {
    const { alap, uj } = await formsMezok()
    const emails = mezo(uj, 'emails')
    expect(emails.type).toBe('array')
    expect(admin(emails).hidden).toBe(true)
    expect(emails.access).toBe(mezo(alap, 'emails').access)
    expect(emails.fields).toBe(mezo(alap, 'emails').fields)
  })
})

describe('readOnly csak nem kötelező mezőn, a többi csak súgót kap', () => {
  it('a plugin forrása szerint a megerősítő üzenet és az átirányítás címe kötelező', async () => {
    const { alap } = await formsMezok()
    expect(mezo(alap, 'confirmationMessage').required).toBe(true)
    const atiranyitas = mezo(alap, 'redirect')
    const url = (atiranyitas.fields as Rekord[]).find((elem) => elem.name === 'url')
    expect(url?.required).toBe(true)
  })

  it('pontosan a három nem kötelező megjelenítési mező readOnly', async () => {
    const { uj } = await formsMezok()
    const readOnly = uj
      .filter((elem) => admin(elem as unknown as Rekord).readOnly === true)
      .map((elem) => ('name' in elem ? elem.name : ''))
    expect(readOnly).toEqual(['fields', 'submitButtonLabel', 'confirmationType'])
    for (const nev of readOnly) {
      const elem = mezo(uj, nev)
      expect(elem.required).not.toBe(true)
      expect(elem.minRows).toBeUndefined()
    }
    // A confirmationType új űrlapon is kap értéket (alapérték), így a zárt mező
    // nem akadályozza a mentést.
    expect(mezo(uj, 'confirmationType').defaultValue).toBe('message')
    expect(admin(mezo(uj, 'confirmationMessage')).readOnly).toBeUndefined()
    expect(admin(mezo(uj, 'redirect')).readOnly).toBeUndefined()
    expect(admin(mezo(uj, 'title')).readOnly).toBeUndefined()
  })

  it('a megjelenítési mezők súgója a mi szövegünk, a plugin admin-kulcsai megmaradnak', async () => {
    const { alap, uj } = await formsMezok()
    expect(admin(mezo(uj, 'title')).description).toBe(CIM_SUGO)
    expect(CIM_SUGO).toBe(
      'Az Időpontkérés és a Hírlevél űrlapot a weboldal erről a névről találja meg, a Kapcsolat űrlapot a rendszer induláskor erről ellenőrzi. Ezt a hármat nem nevezheted át, és más űrlap nem kaphatja meg a nevüket.',
    )
    expect(admin(mezo(uj, 'fields')).description).toBe(MEZOK_SUGO)
    expect(admin(mezo(uj, 'submitButtonLabel')).description).toBe(GOMB_SUGO)
    expect(admin(mezo(uj, 'confirmationType')).description).toBe(MEGEROSITES_TIPUS_SUGO)
    expect(admin(mezo(uj, 'confirmationType')).layout).toBe('horizontal')
    expect(admin(mezo(uj, 'confirmationMessage')).description).toBe(KOSZONO_SZOVEG_SUGO)
    expect(admin(mezo(uj, 'confirmationMessage')).condition).toBe(
      admin(mezo(alap, 'confirmationMessage')).condition,
    )
    expect(admin(mezo(uj, 'redirect')).description).toBe(ATIRANYITAS_SUGO)
    expect(admin(mezo(uj, 'redirect')).condition).toBe(admin(mezo(alap, 'redirect')).condition)
    expect(admin(mezo(uj, 'redirect')).hideGutter).toBe(true)
  })
})

describe('a súgók igazak', () => {
  it('a köszönő szöveg útja a valódi szekció- és mezőnevet mondja', () => {
    const cimke = (nev: string) => {
      const elem = appointment.fields.find((mezo) => 'name' in mezo && mezo.name === nev)
      return elem && 'label' in elem ? elem.label : null
    }
    expect(cimke('sikerSzoveg')).toBe(IDOPONT_KOSZONO_MEZO)
    expect(cimke('sikerCim')).toBe(IDOPONT_KOSZONO_CIM_MEZO)
    expect(appointment.labels?.singular).toBe(IDOPONT_SZEKCIO_NEV)
    expect(KOSZONO_SZOVEG_SUGO).toContain(
      `az ${IDOPONT_SZEKCIO_NEV} szekció „${IDOPONT_KOSZONO_CIM_MEZO}” és „${IDOPONT_KOSZONO_MEZO}” mezőjében`,
    )
  })

  it('a gombok és a hírlevél köszönő szövege a kódban van', () => {
    expect(ctaLabel('appointment-submit')).toBe('Időpontot kérek')
    expect(NEWSLETTER_SUCCESS_MESSAGE.length).toBeGreaterThan(0)
    const hirlevelUrlap = readFileSync(
      fileURLToPath(new URL('../components/layout/NewsletterForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(hirlevelUrlap).toContain("'Feliratkozom'")
    expect(hirlevelUrlap).toContain('NEWSLETTER_SUCCESS_MESSAGE')
    // Az időpontkérés beküldés utáni címe és szövege a szekció két mezőjéből jön.
    const idopontUrlap = readFileSync(
      fileURLToPath(new URL('../components/blocks/AppointmentForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(idopontUrlap).toContain('sikerCim?.trim()')
    expect(idopontUrlap).toContain('sikerSzoveg?.trim()')
    expect(idopontUrlap).toContain("ctaLabel('appointment-submit')")
  })

  it('a weboldal kódja nem olvassa a plugin megjelenítési mezőit (forrás-söprés)', () => {
    const gyoker = fileURLToPath(new URL('..', import.meta.url))
    // Az adat-seedek (a három űrlap létrehozása) és ez a modul írja, nem olvassa őket.
    const engedett = new Set([
      'lib/admin/urlap-admin.ts',
      'lib/appointment/form.ts',
      'lib/newsletter/form.ts',
      'payload.config.ts',
      'payload-types.ts',
    ])
    const talalatok: string[] = []
    const bejar = (konyvtar: string): void => {
      for (const nev of readdirSync(konyvtar)) {
        const teljes = path.join(konyvtar, nev)
        const relativ = path.relative(gyoker, teljes).split(path.sep).join('/')
        if (statSync(teljes).isDirectory()) {
          if (nev !== '__tests__' && nev !== 'migrations') bejar(teljes)
          continue
        }
        if (!/\.(ts|tsx)$/.test(nev) || engedett.has(relativ)) continue
        if (
          /\b(submitButtonLabel|confirmationMessage|confirmationType)\b/.test(
            readFileSync(teljes, 'utf8'),
          )
        ) {
          talalatok.push(relativ)
        }
      }
    }
    bejar(gyoker)
    expect(talalatok).toEqual([])
  })

  it('a gyűjtemény leírása igaz, és nem ígér beküldés-listát az Űrlapokban', () => {
    expect(URLAP_GYUJTEMENY_LEIRAS).toBe(
      'Az Időpontkérés űrlap az Időpontkérés szekcióban (most a Kapcsolat oldalon), a Hírlevél minden oldal láblécében látszik. A Kapcsolat nevű űrlapot a weboldal most nem használja. A kérdéseket és a gombfeliratokat a weboldal kódja adja, a beküldéseket az Űrlapbeküldések között találod.',
    )
    // A 404-es lapok is a teljes láblécet hozzák (mérve böngészőben), ezért
    // kivételt nem mond.
    expect(URLAP_GYUJTEMENY_LEIRAS).not.toMatch(/hibaoldal|kivételével/)
    expect(URLAP_GYUJTEMENY_LEIRAS).not.toMatch(/beküldések itt/i)
  })

  it('a szövegekben nincs gondolatjel és tiltott szó', () => {
    for (const szoveg of [
      URLAP_GYUJTEMENY_LEIRAS,
      CIM_SUGO,
      MEZOK_SUGO,
      GOMB_SUGO,
      MEGEROSITES_TIPUS_SUGO,
      KOSZONO_SZOVEG_SUGO,
      ATIRANYITAS_SUGO,
    ]) {
      expect(szoveg).not.toMatch(/[–—]/)
      expect(szoveg).not.toMatch(/kérjük|kérlek|érvénytelen/i)
      expect(szoveg).not.toContain('"')
    }
  })
})
