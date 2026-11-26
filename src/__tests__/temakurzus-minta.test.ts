import { describe, expect, it } from 'vitest'

import { OTTHONI_COURSE_SKU, planForSku } from '../lib/curriculum/bunny-keszlet'
import {
  CSUKLO_MINTA_GARANCIA_CIM,
  CSUKLO_MINTA_GARANCIA_SZOVEG,
  CSUKLO_MINTA_KINEK_VALO,
  CSUKLO_MINTA_LECKEK,
  CSUKLO_MINTA_LEIRAS_BEKEZDESEK,
  CSUKLO_MINTA_NEM_JAVASOLT,
  CSUKLO_MINTA_ROVID_LEIRAS,
  csukloMintaModulok,
  tervezdCsukloMintat,
} from '../lib/temakurzus-minta'
import { lexicalPlainText, pricesInText } from '../lib/text-prices'
import type { Product } from '../payload-types'

/**
 * A csukló-minta szabálya (src/lib/temakurzus-minta.ts), tisztán.
 *
 * A program tananyaga a valódi importterv (bunny-keszlet.ts OTTHONI_PLAN),
 * így ha a programot átszervezik és egy átvett lecke kikerül belőle, itt
 * bukik, nem élesben, a próbafutásnál. A létrehozás, az idempotencia és a
 * láthatatlanság valódi adatbázison: temakurzus-minta-db.test.ts.
 */

function programModulok(): NonNullable<Product['modules']> {
  const plan = planForSku(OTTHONI_COURSE_SKU)
  if (plan === null) throw new Error('hiányzik a program importterve')
  return plan.modules.map((modul, m) => ({
    id: `modul-${m}`,
    title: modul.title,
    summary: modul.summary,
    lessons: modul.lessons.map((lecke, l) => ({
      ...lecke,
      id: `lecke-${m}-${l}`,
      attachments: [{ id: `melleklet-${m}-${l}`, file: 1 }],
    })),
  }))
}

function program(modules: Product['modules']): Product {
  return { id: 7, sku: OTTHONI_COURSE_SKU, category: 3, modules } as unknown as Product
}

describe('csukló-minta szabálya', () => {
  it('a program tervéből mind a 11 lecke átjön, programsorrendben, mellékletek és sorazonosítók nélkül', () => {
    const { modulok, hianyzo } = csukloMintaModulok(programModulok())

    expect(hianyzo).toEqual([])
    expect(modulok.flatMap((modul) => modul.lessons?.map((l) => l.streamAssetId))).toEqual([
      ...CSUKLO_MINTA_LECKEK,
    ])
    // Az összefoglaló csak a teljesen átvett modulnál marad: a részleges modul
    // összefoglalója a program más témáit (ujjak, könyök) ígérné.
    expect(modulok.map((modul) => [modul.title, modul.lessons?.length, modul.summary])).toEqual([
      ['1. Így kezdj neki', 4, 'A program felépítése, a kéz anatómiája, a gyakorlás módja.'],
      ['2. Mi okozza a fájdalmat', 2, null],
      ['3. Gyakorlatok', 2, null],
      ['4. Eszközök és mindennapok', 3, null],
    ])
    for (const lecke of modulok.flatMap((modul) => modul.lessons ?? [])) {
      expect(lecke.attachments).toEqual([])
      expect(lecke).not.toHaveProperty('id')
    }
  })

  it.each([
    [
      'a programból kikerült egy átveendő lecke',
      (): Product | null =>
        program(
          programModulok().map((modul) => ({
            ...modul,
            lessons: modul.lessons?.filter((l) => l.streamAssetId !== CSUKLO_MINTA_LECKEK[5]),
          })),
        ),
      false,
      'HIANYZO_LECKE',
    ],
    ['nincs program', (): Product | null => null, false, 'NINCS_PROGRAM'],
    ['a minta már létezik', (): Product | null => program(programModulok()), true, 'MAR_LETEZIK'],
  ] as const)('nem ír, ha %s', (_nev, programja, marLetezik, allapot) => {
    const terv = tervezdCsukloMintat({ program: programja(), marLetezik })
    expect([terv.allapot, terv.adat]).toEqual([allapot, null])
  })

  it('a minta vevői szövegeiben nincs gondolatjel és nincs kézzel írt ár', () => {
    const terv = tervezdCsukloMintat({ program: program(programModulok()), marLetezik: false })
    const adat = terv.adat
    if (adat === null) throw new Error(`a terv nem hozott adatot: ${terv.uzenet}`)
    const szovegek = [
      CSUKLO_MINTA_ROVID_LEIRAS,
      ...CSUKLO_MINTA_LEIRAS_BEKEZDESEK,
      ...CSUKLO_MINTA_KINEK_VALO,
      ...CSUKLO_MINTA_NEM_JAVASOLT,
      CSUKLO_MINTA_GARANCIA_CIM,
      CSUKLO_MINTA_GARANCIA_SZOVEG,
      lexicalPlainText(adat.longDescription),
      ...(adat.salesHighlights ?? []).map((sor) => sor.text),
    ]
    expect(szovegek.filter((szoveg) => /[–—]/u.test(szoveg))).toEqual([])
    expect(szovegek.flatMap(pricesInText)).toEqual([])
  })
})
