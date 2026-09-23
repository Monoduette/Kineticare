import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { Payload } from 'payload'

import teamManifest from '../../public/media/team/manifest.json'
import {
  HOME_HELP_PHOTOS,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_ROWS,
} from '../lib/home-help-states'
import { managedMediaAssets } from '../lib/media-recovery-provenance'
import {
  HAROM_AJTO_FOTO_FORRASOK,
  HAROM_AJTO_KORABBI_TORZSEK,
  KOCSIS_CV_FORRAS,
  KOCSIS_KATA_NEV,
  KOCSIS_PORTRE_PREFIX,
  alkalmazHaromAjtoFotok,
  alkalmazKocsisCvFoto,
  csereldLexicalKepeket,
  futtatFotoCsere,
  haromAjtoFotoAzonositok,
  kocsisFotoAzonositok,
  lexicalKepAzonositok,
  payloadMediaFuggosegek,
  type FotoCsere,
  type MediaBiztositasFuggosegek,
  type UjMediaAllapot,
} from '../scripts/apply-owner-content'
import type { Page } from '../payload-types'

/**
 * 2026-09-22, tulajdonosi kérés: az új fotók „mindenhol”. A tartalomjob két
 * új szabálya (src/scripts/apply-owner-content.ts), adatbázis és hálózat
 * NÉLKÜL: a Médiatár-hozzáférés injektált, a próbafutásban tiltott létrehozás
 * hangosan dobó hamisítványt kap.
 *
 *  - `harom-ajto-fotok`: a háromajtós sín mentett régi (seed) képét cseréli az
 *    ajtó új képére, az ajtó JELENTÉSE szerint; üres mezőt nem tölt ki,
 *    szerkesztői képet nem ír felül (hangos), második futásra „MÁR”.
 *  - `kocsis-cv-foto`: Kocsis Kata régi közeli portréját cseréli az új
 *    CV-fotóra a kártyáján, az önéletrajz-harmonika sorának képén és a
 *    lenyitott önéletrajz tartalmában is (egy lapon egy arc egy névhez); más
 *    tag, Kiss Kata sora és más kép érintetlen.
 */

type Szekciosor = NonNullable<Page['layout']>
type Blokk = Szekciosor[number]

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const sha256 = (file: string): string =>
  createHash('sha256')
    .update(readFileSync(join(REPO, file)))
    .digest('hex')

/** A mai élő /rolunk sín (mérve 2026-09-22, /api/pages): a három régi kép. */
const REGI = new Map<number, string>([
  [36, 'help-zart-img-7541.webp'],
  [37, 'help-nyilo-syl-9297.webp'],
  [38, 'help-nyitott-syl-9260.webp'],
])

/** Az új képek, még a Médiatáron kívül (a forrásfájl megvan). */
const UJ_NINCS: UjMediaAllapot[] = HAROM_AJTO_FOTO_FORRASOK.map((forras) => ({
  filename: forras.filename,
  id: null,
  forrasLetezik: true,
}))

/** Az új képek, már a Médiatárban (azonosító: 501, 502, 503). */
const UJ_MEGVAN: UjMediaAllapot[] = HAROM_AJTO_FOTO_FORRASOK.map((forras, index) => ({
  filename: forras.filename,
  id: 501 + index,
  forrasLetezik: true,
}))

const ISMERT = new Map<number, string>([
  ...REGI,
  [501, 'help-rendelo-szalag.webp'],
  [502, 'help-otthoni-video.webp'],
  [503, 'help-szakmai-tablet.webp'],
])

const sinSorok = (fotok: readonly (number | null)[]) =>
  HOME_HELP_STATES.map((state, index) => ({
    id: `sor-${index}`,
    number: String(index + 1),
    title: state.title,
    osszefoglalo: state.osszefoglalo,
    body: state.body,
    felirat: state.felirat,
    url: state.url,
    ujAblakban: state.ujAblakban,
    photo: fotok[index] ?? null,
  }))

const rolunkSin = (fotok: readonly (number | null)[] = [36, 37, 38]): Blokk =>
  ({
    id: 'rolunk-sin',
    blockType: 'services',
    eyebrow: '',
    title: HOME_HELP_TITLE,
    elrendezes: 'sin',
    rows: sinSorok(fotok),
    sectionSettings: { visible: true, anchorId: 'szolgaltatasaink', hatter: 'tint' },
  }) as unknown as Blokk

const tablaMasik: Blokk = {
  id: 'masik',
  blockType: 'services',
  title: 'Amiben mások vagyunk',
  elrendezes: 'tabla',
  rows: [
    { title: 'A kézre figyelünk', body: 'Szöveg.', photo: 36 },
    { title: 'Veled dolgozunk', body: 'Szöveg.', photo: null },
  ],
} as unknown as Blokk

const richText = { id: 'rt', blockType: 'richText', content: null } as unknown as Blokk

const sorFotok = (layout: Szekciosor | null, blokk: number): unknown[] => {
  const talalat = layout?.[blokk]
  return talalat?.blockType === 'services' ? (talalat.rows ?? []).map((sor) => sor.photo) : []
}

const haromAjto = (
  layout: Szekciosor,
  ujMediak: readonly UjMediaAllapot[] = UJ_MEGVAN,
  ismert: ReadonlyMap<number, string> = ISMERT,
): FotoCsere =>
  alkalmazHaromAjtoFotok({ layout, oldalCimke: 'Rólunk oldal', ismertFajlnevek: ismert, ujMediak })

describe('harom-ajto-fotok — a forrás és a régi képek', () => {
  it('az új képek a sín kódbeli tartalékáé: ugyanaz a fájl, alt és fókuszpont, .webp rekordnévvel', () => {
    expect(HAROM_AJTO_FOTO_FORRASOK.map((forras) => forras.filename)).toEqual([
      'help-rendelo-szalag.webp',
      'help-otthoni-video.webp',
      'help-szakmai-tablet.webp',
    ])
    for (const [index, forras] of HAROM_AJTO_FOTO_FORRASOK.entries()) {
      const foto = HOME_HELP_PHOTOS[index]
      expect(forras.filePath).toBe(`content/home-images/brand/${foto?.file}`)
      expect(forras.alt).toBe(foto?.alt)
      expect([forras.focalX, forras.focalY]).toEqual([foto?.focalX, foto?.focalY])
      expect(existsSync(join(REPO, forras.filePath)), forras.filePath).toBe(true)
      // A kódbeli tartalék (public) és a Médiatár-forrás (seed) bájtra azonos.
      expect(sha256(forras.filePath)).toBe(sha256(`public/media/help-rail/${foto?.file}`))
    }
  })

  it('csak a három régi seed-kép törzse cserélhető', () => {
    expect([...HAROM_AJTO_KORABBI_TORZSEK]).toEqual([
      'help-zart-img-7541',
      'help-nyilo-syl-9297',
      'help-nyitott-syl-9260',
    ])
  })

  it('a futtató a sín sorainak (és csak azoknak) a képeit olvassa', () => {
    expect(haromAjtoFotoAzonositok([richText, tablaMasik, rolunkSin([36, null, 38])])).toEqual([
      36, 38,
    ])
    expect(haromAjtoFotoAzonositok(null)).toEqual([])
  })
})

describe('alkalmazHaromAjtoFotok', () => {
  it('a mai /rolunk sínen mindhárom régi képet az ajtó új képére cseréli, a többi blokk érintetlen', () => {
    const layout: Szekciosor = [richText, tablaMasik, rolunkSin()]
    const eredmeny = haromAjto(layout)
    expect(eredmeny.modositasok).toHaveLength(3)
    expect(eredmeny.letrehozando).toEqual([])
    expect(sorFotok(eredmeny.layout, 2)).toEqual([501, 502, 503])
    // Nem sín-blokk (akkor sem, ha régi képet visel) és más típus: ugyanaz a referencia.
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    expect(eredmeny.layout?.[1]).toBe(layout[1])
    expect(eredmeny.modositasok[0]?.uzenet).toContain('„help-zart-img-7541.webp” (azonosító: 36)')
    expect(eredmeny.modositasok[0]?.uzenet).toContain('„help-rendelo-szalag.webp” (azonosító: 501)')
    // A sor többi mezője változatlan.
    const sin = eredmeny.layout?.[2]
    if (sin?.blockType !== 'services') throw new Error('nincs sín-blokk')
    expect(sin.rows?.map((sor) => [sor.title, sor.body, sor.url])).toEqual(
      HOME_HELP_STATES.map((state) => [state.title, state.body, state.url]),
    )
  })

  it('az új képet az ajtó JELENTÉSE választja, nem a sor pozíciója (átrendezett sorok)', () => {
    const blokk = rolunkSin([36, 37, 38])
    if (blokk.blockType !== 'services' || !blokk.rows) throw new Error('nincs sín-blokk')
    const [r0, r1, r2] = blokk.rows
    if (!r0 || !r1 || !r2) throw new Error('hiányzó sor')
    // Sorrend: Szakmai (régi 1. kép), Rendelői (régi 3. kép), Otthoni (régi 2. kép).
    const atrendezett = {
      ...blokk,
      rows: [
        { ...r2, photo: 36 },
        { ...r0, photo: 38 },
        { ...r1, photo: 37 },
      ],
    } as unknown as Blokk
    const eredmeny = haromAjto([atrendezett])
    expect(sorFotok(eredmeny.layout, 0)).toEqual([503, 501, 502])
  })

  it('második futásra „MÁR” kihagyás, nincs írás', () => {
    const elso = haromAjto([rolunkSin()])
    const masodik = haromAjto(elso.layout ?? [])
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(3)
    for (const lepes of masodik.kihagyasok) {
      expect(lepes.indok).toContain('MÁR')
      expect(lepes.hangos).not.toBe(true)
    }
  })

  it('üres fotó-mezőt NEM tölt ki (csendes, indokolt kihagyás): ott a kódbeli tartalék már az új kép', () => {
    const eredmeny = haromAjto([rolunkSin([null, null, null])])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(3)
    for (const lepes of eredmeny.kihagyasok) {
      expect(lepes.indok).toContain('üres')
      expect(lepes.hangos).not.toBe(true)
    }
  })

  it('szerkesztői képet nem ír felül: hangos kihagyás, a többi sor ettől még cserélődik', () => {
    const ismert = new Map([...ISMERT, [77, 'sajat-rendelo-foto.webp']])
    const eredmeny = haromAjto([rolunkSin([77, 37, 38])], UJ_MEGVAN, ismert)
    expect(sorFotok(eredmeny.layout, 0)).toEqual([77, 502, 503])
    const hangos = eredmeny.kihagyasok.filter((lepes) => lepes.hangos === true)
    expect(hangos).toHaveLength(1)
    expect(hangos[0]?.indok).toContain('sajat-rendelo-foto.webp')
    expect(hangos[0]?.indok).toContain('szerkesztői elsőbbség')
  })

  it('csak pontos törzs-egyezésnél cserél: a Payload `-N` utótag igen, a hasonló nevű saját kép nem', () => {
    const ismert = new Map([
      ...ISMERT,
      [81, 'help-zart-img-7541-1.webp'],
      [82, 'help-nyilo-syl-9297-sajat.webp'],
      [83, 'help-nyitott-syl-9260v2.jpg'],
    ])
    const eredmeny = haromAjto([rolunkSin([81, 82, 83])], UJ_MEGVAN, ismert)
    expect(sorFotok(eredmeny.layout, 0)).toEqual([501, 82, 83])
    expect(eredmeny.kihagyasok.filter((lepes) => lepes.hangos === true)).toHaveLength(2)
  })

  it('nem található média-rekordra mutató mező: hangos kihagyás, nem találgat', () => {
    const eredmeny = haromAjto([rolunkSin([999, 37, 38])])
    expect(sorFotok(eredmeny.layout, 0)).toEqual([999, 502, 503])
    const hangos = eredmeny.kihagyasok.find((lepes) => lepes.hangos === true)
    expect(hangos?.indok).toContain('nem található média-rekordra')
  })

  it('ha az új kép nincs a Médiatárban, de a forrás megvan: tervezett csere, a rekordot a futtató hozza létre', () => {
    const eredmeny = haromAjto([rolunkSin()], UJ_NINCS)
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(3)
    expect(eredmeny.letrehozando).toEqual([0, 1, 2])
    expect(eredmeny.modositasok[1]?.uzenet).toContain(
      'a rekordot a script a repó fájljából hozza létre',
    )
  })

  it('ha az új kép és a forrásfájl is hiányzik: hangos kihagyás, nincs írás', () => {
    const hianyzik = UJ_NINCS.map((allapot) => ({ ...allapot, forrasLetezik: false }))
    const eredmeny = haromAjto([rolunkSin()], hianyzik)
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.letrehozando).toEqual([])
    expect(eredmeny.kihagyasok.every((lepes) => lepes.hangos === true)).toBe(true)
  })

  it('a kezdőlap mentett táblás hármasát (sínné alakítható) is felismeri', () => {
    const kezdolapTabla = {
      id: 'kezdolap-segitseg',
      blockType: 'services',
      title: HOME_HELP_TITLE,
      elrendezes: 'tabla',
      rows: LEGACY_HOME_HELP_ROWS.map((sor, index) => ({ ...sor, photo: 36 + index })),
    } as unknown as Blokk
    const eredmeny = alkalmazHaromAjtoFotok({
      layout: [kezdolapTabla],
      oldalCimke: 'Kezdőlap',
      ismertFajlnevek: ISMERT,
      ujMediak: UJ_MEGVAN,
    })
    expect(sorFotok(eredmeny.layout, 0)).toEqual([501, 502, 503])
  })

  it('háromajtós sín nélküli lapon és üres szekciósornál csendes, indokolt kihagyás', () => {
    for (const layout of [[richText, tablaMasik], [], null] as const) {
      const eredmeny = alkalmazHaromAjtoFotok({
        layout: layout as Page['layout'],
        oldalCimke: 'Kapcsolat oldal',
        ismertFajlnevek: ISMERT,
        ujMediak: UJ_MEGVAN,
      })
      expect(eredmeny.layout).toBeNull()
      expect(eredmeny.kihagyasok).toHaveLength(1)
      expect(eredmeny.kihagyasok[0]?.hangos).not.toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// kocsis-cv-foto
// ---------------------------------------------------------------------------

const KOCSIS_REGI_ID = 5
const KISS_ID = 6
const CV_ID = 610

const ISMERT_PORTREK = new Map<number, string>([
  [KOCSIS_REGI_ID, '67b3c6e9e315f_KocsisKatakozeli.webp'],
  [KISS_ID, '67c07def59ac2_KissKataelegans.webp'],
  [CV_ID, 'kocsis-kata-cv-1500.webp'],
])

const CV_MEGVAN: UjMediaAllapot = {
  filename: KOCSIS_CV_FORRAS.filename,
  id: CV_ID,
  forrasLetezik: true,
}

const szakemberek = (kocsis: number | null, kiss: number | null = KISS_ID, nev = 'Kocsis Kata') =>
  ({
    id: 'szakemberek',
    blockType: 'teamMembers',
    title: 'Beszéljünk',
    members: [
      { id: 'k1', name: nev, titulus: 'gyógytornász', photo: kocsis, phone: '+36 30 000 0000' },
      {
        id: 'k2',
        name: 'Kiss Kata',
        titulus: 'gyógytornász',
        photo: kiss,
        phone: '+36 30 000 0001',
      },
    ],
  }) as unknown as Blokk

const tagFotok = (layout: Szekciosor | null, blokk: number): unknown[] => {
  const talalat = layout?.[blokk]
  return talalat?.blockType === 'teamMembers' ? (talalat.members ?? []).map((tag) => tag.photo) : []
}

const cvFoto = (
  layout: Page['layout'],
  ujMedia: UjMediaAllapot = CV_MEGVAN,
  ismert: ReadonlyMap<number, string> = ISMERT_PORTREK,
): FotoCsere =>
  alkalmazKocsisCvFoto({ layout, oldalCimke: 'Kapcsolat oldal', ismertFajlnevek: ismert, ujMedia })

describe('kocsis-cv-foto — a forrás', () => {
  it('a CV-fotó a manifest kezelt képe: a fájl megvan, a sha256 és az alt a manifesté, 3:4', async () => {
    const asset = teamManifest.assets.find((item) => item.file === KOCSIS_CV_FORRAS.filename)
    expect(asset?.role).toBe('cv-kocsis-kata')
    expect(KOCSIS_CV_FORRAS.filePath).toBe(`public/media/team/${KOCSIS_CV_FORRAS.filename}`)
    expect(KOCSIS_CV_FORRAS.alt).toBe(asset?.alt)
    expect(sha256(KOCSIS_CV_FORRAS.filePath)).toBe(asset?.sha256)
    const meta = await sharp(join(REPO, KOCSIS_CV_FORRAS.filePath)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1500, 2000])
    expect((meta.width ?? 0) / (meta.height ?? 1)).toBe(3 / 4)
    // Kezelt kép: létrehozáskor eredetigazolást kap (Volume-helyreállítás).
    expect(managedMediaAssets().some((item) => item.filename === KOCSIS_CV_FORRAS.filename)).toBe(
      true,
    )
    expect(KOCSIS_CV_FORRAS.alt).not.toMatch(/[–—]/)
  })

  it('a futtató csak Kocsis Kata kártyáinak képeit olvassa', () => {
    expect(kocsisFotoAzonositok([richText, szakemberek(5), szakemberek(null)])).toEqual([5])
  })
})

describe('alkalmazKocsisCvFoto', () => {
  it('a régi közeli portrét az új CV-fotóra cseréli, Kiss Kata kártyája érintetlen', () => {
    const layout: Szekciosor = [richText, szakemberek(KOCSIS_REGI_ID)]
    const eredmeny = cvFoto(layout)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(tagFotok(eredmeny.layout, 1)).toEqual([CV_ID, KISS_ID])
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    expect(eredmeny.modositasok[0]?.uzenet).toContain('67b3c6e9e315f_KocsisKatakozeli.webp')
    expect(eredmeny.modositasok[0]?.uzenet).toContain('kocsis-kata-cv-1500.webp')
  })

  it('minden Kocsis Kata-kártyát cserél a lapon (két szakember-szekció)', () => {
    const eredmeny = cvFoto([szakemberek(KOCSIS_REGI_ID), szakemberek(KOCSIS_REGI_ID)])
    expect(tagFotok(eredmeny.layout, 0)).toEqual([CV_ID, KISS_ID])
    expect(tagFotok(eredmeny.layout, 1)).toEqual([CV_ID, KISS_ID])
  })

  it('második futásra „MÁR” kihagyás, nincs írás', () => {
    const elso = cvFoto([szakemberek(KOCSIS_REGI_ID)])
    const masodik = cvFoto(elso.layout)
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0]?.indok).toContain('MÁR')
    expect(masodik.kihagyasok[0]?.hangos).not.toBe(true)
  })

  it('szerkesztői képet nem ír felül: hangos kihagyás', () => {
    const ismert = new Map([...ISMERT_PORTREK, [70, 'kocsis-sajat-portre.webp']])
    const eredmeny = cvFoto([szakemberek(70)], CV_MEGVAN, ismert)
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('kocsis-sajat-portre.webp')
  })

  it('üres fotó-mezőt nem tölt ki: hangos kihagyás (a kártya kép nélkül áll)', () => {
    const eredmeny = cvFoto([szakemberek(null)])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('üres')
  })

  it('csak prefix-egyezésnél cserél: a `-N` utótag igen, a hasonló nevű kép nem', () => {
    expect(KOCSIS_PORTRE_PREFIX).toBe('67b3c6e9e315f_KocsisKatakozeli')
    const ismert = new Map([
      ...ISMERT_PORTREK,
      [91, '67b3c6e9e315f_KocsisKatakozeli-1.webp'],
      [92, '67b3c6e9e315f_KocsisKatakozeli_v2.webp'],
    ])
    expect(tagFotok(cvFoto([szakemberek(91)], CV_MEGVAN, ismert).layout, 0)).toEqual([
      CV_ID,
      KISS_ID,
    ])
    const hasonlo = cvFoto([szakemberek(92)], CV_MEGVAN, ismert)
    expect(hasonlo.layout).toBeNull()
    expect(hasonlo.kihagyasok[0]?.hangos).toBe(true)
  })

  it('csak Kocsis Kata tagját nézi: Kiss Kata kártyáján a régi Kocsis-portré is érintetlen', () => {
    const eredmeny = cvFoto([szakemberek(KISS_ID, KOCSIS_REGI_ID)])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
  })

  it('a név szélső és ismételt szóközre, kis- és nagybetűre érzéketlen', () => {
    const eredmeny = cvFoto([szakemberek(KOCSIS_REGI_ID, KISS_ID, '  kocsis   KATA ')])
    expect(tagFotok(eredmeny.layout, 0)).toEqual([CV_ID, KISS_ID])
    expect(KOCSIS_KATA_NEV).toBe('Kocsis Kata')
  })

  it('Kocsis Kata kártyája nélküli lapon csendes, indokolt kihagyás', () => {
    const eredmeny = cvFoto([richText, rolunkSin()])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0]?.hangos).not.toBe(true)
  })

  it('ha a CV-fotó még nincs a Médiatárban: tervezett csere, létrehozandó; forrás nélkül hangos', () => {
    const nincs: UjMediaAllapot = { ...CV_MEGVAN, id: null }
    const terv = cvFoto([szakemberek(KOCSIS_REGI_ID)], nincs)
    expect(terv.layout).toBeNull()
    expect(terv.modositasok).toHaveLength(1)
    expect(terv.letrehozando).toEqual([0])
    const hianyzik = cvFoto([szakemberek(KOCSIS_REGI_ID)], { ...nincs, forrasLetezik: false })
    expect(hianyzik.modositasok).toHaveLength(0)
    expect(hianyzik.kihagyasok[0]?.hangos).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// kocsis-cv-foto — az önéletrajz-harmonika (a sor képe és a tartalom képe)
// ---------------------------------------------------------------------------

/** Egy Lexical upload-csomópont, ahogy élesben áll (mérve 2026-09-22, /api/pages?depth=0). */
const feltoltes = (value: number | null, id: string) => ({
  id,
  type: 'upload',
  value,
  fields: null,
  format: '',
  version: 3,
  relationTo: 'media',
})

const bekezdes = (text: string) => ({
  type: 'paragraph',
  version: 1,
  children: [{ type: 'text', version: 1, text }],
})

const oneletrajzTartalom = (kepek: readonly (number | null)[], nev: string) => ({
  root: {
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      ...kepek.map((kep, index) => feltoltes(kep, `${nev}-kep-${index}`)),
      bekezdes('Gyógytornász, manuálterapeuta'),
    ],
  },
})

const oneletrajzSor = (
  cim: string,
  kep: number | null,
  tartalomKepek: readonly (number | null)[],
) => ({
  id: `sor-${cim}`,
  cim,
  osszefoglalo: '39 tanfolyam',
  kep,
  tartalom: oneletrajzTartalom(tartalomKepek, cim),
})

/** A mai élő /rolunk „Részletes szakmai háttér” harmonikája (layout[6]). */
const harmonika = (
  opciok: {
    kocsisCim?: string
    kocsisKep?: number | null
    kocsisTartalom?: readonly (number | null)[]
    kissKep?: number | null
    kissTartalom?: readonly (number | null)[]
  } = {},
): Blokk =>
  ({
    id: 'szakmai-hatter',
    blockType: 'accordion',
    title: 'Részletes szakmai háttér',
    items: [
      oneletrajzSor(
        opciok.kocsisCim ?? 'Kocsis Kata szakmai önéletrajza',
        opciok.kocsisKep === undefined ? KOCSIS_REGI_ID : opciok.kocsisKep,
        opciok.kocsisTartalom ?? [KOCSIS_REGI_ID],
      ),
      oneletrajzSor(
        'Kiss Kata szakmai önéletrajza',
        opciok.kissKep === undefined ? KISS_ID : opciok.kissKep,
        opciok.kissTartalom ?? [KISS_ID],
      ),
    ],
    sectionSettings: { visible: true, anchorId: 'szakmai-hatter' },
  }) as unknown as Blokk

type HarmonikaSor = {
  cim: string
  kep: unknown
  tartalom: { root: { children: Record<string, unknown>[] } }
}

const harmonikaSorok = (layout: Szekciosor | null, blokk: number): HarmonikaSor[] => {
  const talalat = layout?.[blokk]
  return talalat?.blockType === 'accordion' ? (talalat.items as unknown as HarmonikaSor[]) : []
}

/** Egy harmonika-sor tartalmának képei, dokumentum-sorrendben. */
const tartalomKepek = (sor: HarmonikaSor | undefined): unknown[] =>
  (sor?.tartalom.root.children ?? [])
    .filter((csomopont) => csomopont.type === 'upload')
    .map((csomopont) => csomopont.value)

describe('alkalmazKocsisCvFoto — az önéletrajz-harmonika', () => {
  it('a mai /rolunk: a kártya, a harmonika-sor képe és a lenyitott önéletrajz képe is az új CV-fotóra vált', () => {
    const layout: Szekciosor = [richText, szakemberek(KOCSIS_REGI_ID), harmonika()]
    const eredmeny = cvFoto(layout)
    expect(eredmeny.modositasok).toHaveLength(3)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(tagFotok(eredmeny.layout, 1)).toEqual([CV_ID, KISS_ID])
    const [kocsis, kiss] = harmonikaSorok(eredmeny.layout, 2)
    expect(kocsis?.kep).toBe(CV_ID)
    expect(tartalomKepek(kocsis)).toEqual([CV_ID])
    // A csomópont minden más mezője marad (azonosító, fields, relationTo).
    expect(kocsis?.tartalom.root.children[0]).toEqual(
      feltoltes(CV_ID, 'Kocsis Kata szakmai önéletrajza-kep-0'),
    )
    // Az önéletrajz szövege érintetlen, és Kiss Kata sora ugyanaz az objektum.
    expect(kocsis?.tartalom.root.children[1]).toEqual(bekezdes('Gyógytornász, manuálterapeuta'))
    const eredetiKiss = harmonikaSorok(layout, 2)[1]
    expect(kiss).toBe(eredetiKiss)
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    const uzenetek = eredmeny.modositasok.map((lepes) => lepes.uzenet).join('\n')
    expect(uzenetek).toContain('szakemberkártyájának fotója')
    expect(uzenetek).toContain('önéletrajz-sorának képe')
    expect(uzenetek).toContain('önéletrajzának 1. tartalombeli képe')
  })

  it('második futásra minden helyen „MÁR”, nincs írás és nincs hangos sor', () => {
    const elso = cvFoto([szakemberek(KOCSIS_REGI_ID), harmonika()])
    const masodik = cvFoto(elso.layout)
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(3)
    for (const lepes of masodik.kihagyasok) {
      expect(lepes.indok).toContain('MÁR')
      expect(lepes.hangos).not.toBe(true)
    }
  })

  it('csak Kocsis Kata sorát nézi: Kiss Kata sora a régi Kocsis-portréval is érintetlen', () => {
    const layout: Szekciosor = [
      harmonika({ kissKep: KOCSIS_REGI_ID, kissTartalom: [KOCSIS_REGI_ID] }),
    ]
    const eredmeny = cvFoto(layout)
    const [kocsis, kiss] = harmonikaSorok(eredmeny.layout, 0)
    expect(kocsis?.kep).toBe(CV_ID)
    expect(kiss).toBe(harmonikaSorok(layout, 0)[1])
    expect(kiss?.kep).toBe(KOCSIS_REGI_ID)
    expect(tartalomKepek(kiss)).toEqual([KOCSIS_REGI_ID])
    expect(eredmeny.modositasok.every((lepes) => !lepes.uzenet.includes('Kiss Kata'))).toBe(true)
  })

  it('a sor kép-mezőjében álló szerkesztői kép hangos kihagyás; a tartalom régi portréja ettől még cserélődik', () => {
    const ismert = new Map([...ISMERT_PORTREK, [70, 'kocsis-sajat-portre.webp']])
    const eredmeny = cvFoto([harmonika({ kocsisKep: 70 })], CV_MEGVAN, ismert)
    const [kocsis] = harmonikaSorok(eredmeny.layout, 0)
    expect(kocsis?.kep).toBe(70)
    expect(tartalomKepek(kocsis)).toEqual([CV_ID])
    const hangos = eredmeny.kihagyasok.filter((lepes) => lepes.hangos === true)
    expect(hangos).toHaveLength(1)
    expect(hangos[0]?.indok).toContain('kocsis-sajat-portre.webp')
    expect(hangos[0]?.uzenet).toContain('önéletrajz-sorának képe')
  })

  it('a tartalomban álló más kép (pl. oklevél) érintetlen, csendes kihagyással', () => {
    const ismert = new Map([...ISMERT_PORTREK, [71, 'oklevel-2019.webp']])
    const eredmeny = cvFoto(
      [harmonika({ kocsisTartalom: [71, KOCSIS_REGI_ID] })],
      CV_MEGVAN,
      ismert,
    )
    const [kocsis] = harmonikaSorok(eredmeny.layout, 0)
    expect(kocsis?.kep).toBe(CV_ID)
    expect(tartalomKepek(kocsis)).toEqual([71, CV_ID])
    const oklevel = eredmeny.kihagyasok.find((lepes) => lepes.indok?.includes('oklevel-2019.webp'))
    expect(oklevel?.hangos).not.toBe(true)
    expect(oklevel?.uzenet).toContain('1. tartalombeli képe')
    expect(eredmeny.modositasok.map((lepes) => lepes.uzenet).join('\n')).toContain(
      '2. tartalombeli képe',
    )
  })

  it('nem található rekordra mutató tartalombeli kép: hangos kihagyás, a csomópont marad', () => {
    const eredmeny = cvFoto([harmonika({ kocsisTartalom: [999] })])
    const [kocsis] = harmonikaSorok(eredmeny.layout, 0)
    expect(tartalomKepek(kocsis)).toEqual([999])
    const hangos = eredmeny.kihagyasok.filter((lepes) => lepes.hangos === true)
    expect(hangos).toHaveLength(1)
    expect(hangos[0]?.indok).toContain('999')
  })

  it('üres mezőt nem tölt ki: az üres sor-kép csendes kihagyás, a tartalom régi portréja cserélődik', () => {
    const eredmeny = cvFoto([
      harmonika({ kocsisKep: null, kocsisTartalom: [null, KOCSIS_REGI_ID] }),
    ])
    const [kocsis] = harmonikaSorok(eredmeny.layout, 0)
    expect(kocsis?.kep).toBeNull()
    expect(tartalomKepek(kocsis)).toEqual([null, CV_ID])
    const ures = eredmeny.kihagyasok.find((lepes) => lepes.indok?.includes('üres'))
    expect(ures?.hangos).not.toBe(true)
    expect(eredmeny.kihagyasok.some((lepes) => lepes.hangos === true)).toBe(false)
  })

  it('csak prefix-egyezésnél cserél: a `-N` utótag igen, a hasonló nevű kép nem', () => {
    const ismert = new Map([
      ...ISMERT_PORTREK,
      [91, '67b3c6e9e315f_KocsisKatakozeli-1.webp'],
      [92, '67b3c6e9e315f_KocsisKatakozeli_v2.webp'],
    ])
    const eredmeny = cvFoto([harmonika({ kocsisKep: 91, kocsisTartalom: [92] })], CV_MEGVAN, ismert)
    const [kocsis] = harmonikaSorok(eredmeny.layout, 0)
    expect(kocsis?.kep).toBe(CV_ID)
    expect(tartalomKepek(kocsis)).toEqual([92])
  })

  it('a sort a nevével kezdődő cím azonosítja: a 2026-09-07 előtti cím igen, a hasonló név nem', () => {
    const regiCim = cvFoto([harmonika({ kocsisCim: 'Kocsis Kata — szakmai önéletrajz' })])
    expect(harmonikaSorok(regiCim.layout, 0)[0]?.kep).toBe(CV_ID)
    const kisbetus = cvFoto([harmonika({ kocsisCim: '  kocsis  KATA szakmai önéletrajza' })])
    expect(harmonikaSorok(kisbetus.layout, 0)[0]?.kep).toBe(CV_ID)
    const masNev = cvFoto([harmonika({ kocsisCim: 'Kocsis Katalin szakmai önéletrajza' })])
    expect(masNev.layout).toBeNull()
    expect(masNev.modositasok).toHaveLength(0)
    expect(masNev.kihagyasok[0]?.indok).toContain('nincs')
  })

  it('a kurzusfájl-feltöltés (nem Médiatár-kép) csomópontját nem nézi', () => {
    const layout = [harmonika()]
    const sor = harmonikaSorok(layout, 0)[0]
    const csomopont = sor?.tartalom.root.children[0]
    if (csomopont === undefined) throw new Error('hiányzó csomópont')
    csomopont.relationTo = 'course-files'
    const eredmeny = cvFoto(layout)
    expect(tartalomKepek(harmonikaSorok(eredmeny.layout, 0)[0])).toEqual([KOCSIS_REGI_ID])
    expect(eredmeny.modositasok).toHaveLength(1)
  })

  it('ha a CV-fotó még nincs a Médiatárban: mindhárom hely tervezett csere, egy létrehozandó rekorddal', () => {
    const nincs: UjMediaAllapot = { ...CV_MEGVAN, id: null }
    const terv = cvFoto([szakemberek(KOCSIS_REGI_ID), harmonika()], nincs)
    expect(terv.layout).toBeNull()
    expect(terv.modositasok).toHaveLength(3)
    expect(terv.letrehozando).toEqual([0])
  })

  it('a futtató a kártya, a sor-kép és a tartalom képeit olvassa, ismétlés nélkül, Kiss Kata sorát nem', () => {
    expect(
      kocsisFotoAzonositok([
        szakemberek(KOCSIS_REGI_ID),
        harmonika({ kocsisTartalom: [71, KOCSIS_REGI_ID], kissTartalom: [72] }),
      ]),
    ).toEqual([KOCSIS_REGI_ID, 71])
  })
})

describe('Lexical-képek bejárása és cseréje', () => {
  const melyTartalom = {
    root: {
      type: 'root',
      children: [
        bekezdes('Bevezető'),
        { type: 'oszlopok', children: [{ type: 'oszlop', children: [feltoltes(5, 'mely')] }] },
        { ...feltoltes(6, 'fajl'), relationTo: 'course-files' },
        feltoltes(null, 'ures'),
        { ...feltoltes(7, 'feloldott'), value: { id: 7, filename: 'feloldott.webp' } },
      ],
    },
  }

  it('a teljes fát bejárja, a feloldott `value`-t is felismeri, a kurzusfájlt és az üreset kihagyja', () => {
    expect(lexicalKepAzonositok(melyTartalom)).toEqual([5, 7])
    expect(lexicalKepAzonositok(null)).toEqual([])
    expect(lexicalKepAzonositok({ root: 'hibas' })).toEqual([])
  })

  it('változás nélkül ugyanazt a referenciát adja, cserénél csak az érintett ágat másolja', () => {
    expect(csereldLexicalKepeket(melyTartalom, () => null)).toBe(melyTartalom)
    const csere = csereldLexicalKepeket(melyTartalom, (id) =>
      id === 5 ? 50 : null,
    ) as typeof melyTartalom
    expect(csere).not.toBe(melyTartalom)
    expect(lexicalKepAzonositok(csere)).toEqual([50, 7])
    expect(csere.root.children[0]).toBe(melyTartalom.root.children[0])
    expect(csere.root.children[2]).toBe(melyTartalom.root.children[2])
    const lathato: (number | null)[] = []
    csereldLexicalKepeket(melyTartalom, (id) => {
      lathato.push(id)
      return null
    })
    expect(lathato).toEqual([5, null, 7])
  })
})

// ---------------------------------------------------------------------------
// futtatFotoCsere — a kétmenetes futtató (döntés → létrehozás → újradöntés)
// ---------------------------------------------------------------------------

describe('futtatFotoCsere', () => {
  /** Hamis Médiatár: a keresés a megadott névsorból dolgozik, a létrehozás számolt. */
  const tar = (meglevo: Record<string, number>, dobo = false) => {
    const letrehozott: string[] = []
    const fuggosegek: MediaBiztositasFuggosegek = {
      keres: async (filename) => meglevo[filename] ?? null,
      letezik: () => true,
      letrehoz: vi.fn(async (forras) => {
        if (dobo) throw new Error('TILOS: a próbafutásban nem hozható létre média')
        letrehozott.push(forras.filename)
        const id = 700 + letrehozott.length
        meglevo[forras.filename] = id
        return id
      }),
    }
    return { fuggosegek, letrehozott }
  }

  const dontes = (layout: Szekciosor) => (ujMediak: readonly UjMediaAllapot[]) =>
    alkalmazHaromAjtoFotok({
      layout,
      oldalCimke: 'Rólunk oldal',
      ismertFajlnevek: ISMERT,
      ujMediak,
    })

  it('próbafutásban semmit nem hoz létre és nem ír, de a tervet naplózza', async () => {
    const { fuggosegek } = tar({}, true)
    const eredmeny = await futtatFotoCsere({
      forrasok: HAROM_AJTO_FOTO_FORRASOK,
      szabaly: 'harom-ajto-fotok',
      dryRun: true,
      fuggosegek,
      dontes: dontes([rolunkSin()]),
    })
    expect(fuggosegek.letrehoz).not.toHaveBeenCalled()
    expect(eredmeny.layout).toBeNull()
    // 3 csere + 3 „létrehozná” sor.
    expect(eredmeny.modositasok).toHaveLength(6)
    expect(eredmeny.modositasok.some((lepes) => lepes.uzenet.includes('létrehozná'))).toBe(true)
  })

  it('élesben a hiányzó rekordokat létrehozza, majd az új azonosítókkal írja a szekciósort', async () => {
    const { fuggosegek, letrehozott } = tar({})
    const eredmeny = await futtatFotoCsere({
      forrasok: HAROM_AJTO_FOTO_FORRASOK,
      szabaly: 'harom-ajto-fotok',
      dryRun: false,
      fuggosegek,
      dontes: dontes([rolunkSin()]),
    })
    expect(letrehozott).toEqual([
      'help-rendelo-szalag.webp',
      'help-otthoni-video.webp',
      'help-szakmai-tablet.webp',
    ])
    expect(sorFotok(eredmeny.layout, 0)).toEqual([701, 702, 703])
  })

  it('csak a ténylegesen cserélendő ajtó képét hozza létre', async () => {
    const { fuggosegek, letrehozott } = tar({})
    const ismert = new Map([...ISMERT, [77, 'sajat.webp']])
    const eredmeny = await futtatFotoCsere({
      forrasok: HAROM_AJTO_FOTO_FORRASOK,
      szabaly: 'harom-ajto-fotok',
      dryRun: false,
      fuggosegek,
      dontes: (ujMediak) =>
        alkalmazHaromAjtoFotok({
          layout: [rolunkSin([77, null, 38])],
          oldalCimke: 'Rólunk oldal',
          ismertFajlnevek: ismert,
          ujMediak,
        }),
    })
    expect(letrehozott).toEqual(['help-szakmai-tablet.webp'])
    expect(sorFotok(eredmeny.layout, 0)).toEqual([77, null, 701])
  })

  it('meglévő rekordnál nem hoz létre semmit, és egy menetben ír', async () => {
    const { fuggosegek } = tar(
      Object.fromEntries(UJ_MEGVAN.map((allapot) => [allapot.filename, allapot.id ?? 0])),
      true,
    )
    const eredmeny = await futtatFotoCsere({
      forrasok: HAROM_AJTO_FOTO_FORRASOK,
      szabaly: 'harom-ajto-fotok',
      dryRun: false,
      fuggosegek,
      dontes: dontes([rolunkSin()]),
    })
    expect(fuggosegek.letrehoz).not.toHaveBeenCalled()
    expect(sorFotok(eredmeny.layout, 0)).toEqual([501, 502, 503])
    expect(eredmeny.modositasok).toHaveLength(3)
  })

  const kocsisDontes =
    (layout: Szekciosor) =>
    ([ujMedia]: readonly UjMediaAllapot[]): FotoCsere =>
      ujMedia === undefined
        ? { layout: null, modositasok: [], kihagyasok: [], letrehozando: [] }
        : alkalmazKocsisCvFoto({
            layout,
            oldalCimke: 'Rólunk oldal',
            ismertFajlnevek: ISMERT_PORTREK,
            ujMedia,
          })

  it('Kocsis Kata, próbafutás: a CV-rekordot nem hozza létre, a kártya és a harmonika érintetlen', async () => {
    const { fuggosegek } = tar({}, true)
    const eredmeny = await futtatFotoCsere({
      forrasok: [KOCSIS_CV_FORRAS],
      szabaly: 'kocsis-cv-foto',
      dryRun: true,
      fuggosegek,
      dontes: kocsisDontes([szakemberek(KOCSIS_REGI_ID), harmonika()]),
    })
    expect(fuggosegek.letrehoz).not.toHaveBeenCalled()
    expect(eredmeny.layout).toBeNull()
    // 3 csere (kártya, sor-kép, tartalom) + 1 „létrehozná” sor.
    expect(eredmeny.modositasok).toHaveLength(4)
  })

  it('Kocsis Kata, élesben: egyetlen CV-rekord jön létre, és mindhárom hely azt kapja', async () => {
    const { fuggosegek, letrehozott } = tar({})
    const eredmeny = await futtatFotoCsere({
      forrasok: [KOCSIS_CV_FORRAS],
      szabaly: 'kocsis-cv-foto',
      dryRun: false,
      fuggosegek,
      dontes: kocsisDontes([szakemberek(KOCSIS_REGI_ID), harmonika()]),
    })
    expect(letrehozott).toEqual([KOCSIS_CV_FORRAS.filename])
    expect(tagFotok(eredmeny.layout, 0)).toEqual([701, KISS_ID])
    const [kocsis, kiss] = harmonikaSorok(eredmeny.layout, 1)
    expect(kocsis?.kep).toBe(701)
    expect(tartalomKepek(kocsis)).toEqual([701])
    expect([kiss?.kep, ...tartalomKepek(kiss)]).toEqual([KISS_ID, KISS_ID])
  })
})

describe('payloadMediaFuggosegek — a létrehozás a fókuszpontot is átadja', () => {
  it('a sín-kép rekordja a mért fókuszponttal jön létre (a Payload ebből vág)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kc-media-'))
    try {
      const forras = HAROM_AJTO_FOTO_FORRASOK[1]
      if (forras === undefined) throw new Error('hiányzó forrás')
      const create = vi.fn(async () => ({ id: 42, filename: forras.filename }))
      const payload = {
        create,
        collections: { media: { config: { upload: { staticDir: dir } } } },
      } as unknown as Payload
      const id = await payloadMediaFuggosegek(payload, { dryRun: false }).letrehoz(forras)
      expect(id).toBe(42)
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'media',
          data: { alt: forras.alt, focalX: 50, focalY: 20 },
        }),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
