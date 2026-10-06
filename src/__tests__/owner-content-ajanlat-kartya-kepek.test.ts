import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import teamManifest from '../../public/media/team/manifest.json'
import { managedMediaAssets } from '../lib/media-recovery-provenance'
import {
  KEPZES_IGAZOLAS_KEP_FORRAS,
  SZAKKONYV_KEP_FORRAS,
  alkalmazAjanlatKartyaKepek,
  type FotoCsere,
  type MediaForras,
  type UjMediaAllapot,
} from '../scripts/apply-owner-content'
import type { Page } from '../payload-types'

/**
 * 2026-10-06, tulajdonosi kérés: a /szakembereknek ajánlat-kártyáinak
 * tetejére a képzés minta-igazolása és a szakkönyv fotója. A tartalomjob
 * `ajanlat-kartya-kepek` szabálya (src/scripts/apply-owner-content.ts)
 * adatbázis és hálózat NÉLKÜL: a döntés tiszta, a rekord-létrehozást a közös
 * `futtatFotoCsere` végzi (annak tesztje az owner-content-fotok.test.ts-ben).
 *
 * Üres mezőt tölt ki, minden kártyán a SAJÁT ikonjához tartozó képpel;
 * szerkesztői képet nem ír felül (hangos); második futásra „MÁR”.
 */

type Szekciosor = NonNullable<Page['layout']>
type Blokk = Szekciosor[number]

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const IGAZOLAS_ID = 710
const KONYV_ID = 720

const megvan = (forras: MediaForras, id: number): UjMediaAllapot => ({
  filename: forras.filename,
  id,
  forrasLetezik: true,
})
const MIND_MEGVAN: readonly UjMediaAllapot[] = [
  megvan(KEPZES_IGAZOLAS_KEP_FORRAS, IGAZOLAS_ID),
  megvan(SZAKKONYV_KEP_FORRAS, KONYV_ID),
]

const richText = { id: 'rt', blockType: 'richText', content: null } as unknown as Blokk

const ajanlatok = (kepzesKep: number | null, konyvKep: number | null) =>
  ({
    id: 'ajanlatok',
    blockType: 'offerCards',
    kartyak: [
      { id: 'k1', ikon: 'kepzes', kep: kepzesKep, cim: 'Képzés', szoveg: 'A képzés.' },
      { id: 'k2', ikon: 'szakkonyv', kep: konyvKep, cim: 'Szakkönyv', szoveg: 'A könyv.' },
      { id: 'k3', ikon: 'nincs', kep: null, cim: 'Más', szoveg: 'Más ajánlat.' },
    ],
  }) as unknown as Blokk

const kartyaKepek = (layout: Szekciosor | null, blokk: number): unknown[] => {
  const talalat = layout?.[blokk]
  return talalat?.blockType === 'offerCards' ? (talalat.kartyak ?? []).map((k) => k.kep) : []
}

const dontes = (
  layout: Page['layout'],
  ujMediak: readonly UjMediaAllapot[] = MIND_MEGVAN,
): FotoCsere => alkalmazAjanlatKartyaKepek({ layout, oldalCimke: 'Szakembereknek oldal', ujMediak })

describe('ajanlat-kartya-kepek — a források', () => {
  it.each([
    ['szakkonyv-borito', SZAKKONYV_KEP_FORRAS, 1600, 1200],
    ['kepzes-igazolas', KEPZES_IGAZOLAS_KEP_FORRAS, 1200, 900],
  ] as const)(
    '%s: a manifest kezelt képe, a fájl megvan, a sha256 és az alt a manifesté, 4:3 WebP',
    async (szerep, forras, szelesseg, magassag) => {
      const asset = teamManifest.assets.find((item) => item.file === forras.filename)
      expect(asset?.role).toBe(szerep)
      expect(forras.filePath).toBe(`public/media/team/${forras.filename}`)
      expect(forras.alt).toBe(asset?.alt)
      const hash = createHash('sha256')
        .update(readFileSync(join(REPO, forras.filePath)))
        .digest('hex')
      expect(hash).toBe(asset?.sha256)
      const meta = await sharp(join(REPO, forras.filePath)).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', szelesseg, magassag])
      // A kártya képdoboza 4:3, `cover`-rel: más arányú kép széle levágódna.
      expect(szelesseg / magassag).toBe(4 / 3)
      // Kezelt kép: létrehozáskor eredetigazolást kap (Volume-helyreállítás).
      expect(managedMediaAssets().some((item) => item.filename === forras.filename)).toBe(true)
      expect(forras.alt).not.toMatch(/[–—]/)
    },
  )
})

describe('alkalmazAjanlatKartyaKepek', () => {
  it('mindkét üres kártyát a saját képével tölti ki; más ikonú kártya és más blokk érintetlen', () => {
    const layout: Szekciosor = [richText, ajanlatok(null, null)]
    const eredmeny = dontes(layout)
    expect(eredmeny.modositasok).toHaveLength(2)
    expect(eredmeny.letrehozando).toEqual([])
    expect(kartyaKepek(eredmeny.layout, 1)).toEqual([IGAZOLAS_ID, KONYV_ID, null])
    expect(eredmeny.layout?.[0]).toBe(layout[0])
  })

  it('második futásra „MÁR” kihagyás, nincs írás', () => {
    const elso = dontes([ajanlatok(null, null)])
    const masodik = dontes(elso.layout)
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(2)
    for (const kihagyas of masodik.kihagyasok) {
      expect(kihagyas.indok).toContain('MÁR')
      expect(kihagyas.hangos).not.toBe(true)
    }
  })

  it('szerkesztői képet nem ír felül (hangos), a másik, üres kártyát kitölti', () => {
    const eredmeny = dontes([ajanlatok(55, null)])
    expect(kartyaKepek(eredmeny.layout, 0)).toEqual([55, KONYV_ID, null])
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('55')
  })

  it('a másik kártya képe sem számít „MÁR”-nak: a szakkönyv képe a képzés-kártyán szerkesztői kép', () => {
    const eredmeny = dontes([ajanlatok(KONYV_ID, KONYV_ID)])
    expect(eredmeny.kihagyasok.map((k) => k.hangos === true)).toEqual([true, false])
  })

  it('még nincs rekord, de a forrásfájl megvan: a hiányzó kép létrehozását kéri, addig nincs írás', () => {
    const eredmeny = dontes(
      [ajanlatok(null, null)],
      [{ ...MIND_MEGVAN[0]!, id: null }, MIND_MEGVAN[1]!],
    )
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.letrehozando).toEqual([0])
    expect(eredmeny.modositasok[0]?.uzenet).toContain('repó fájljából hozza létre')
  })

  it('se rekord, se forrásfájl: hangos kihagyás, nincs létrehozás', () => {
    const eredmeny = dontes(
      [ajanlatok(null, KONYV_ID)],
      [{ ...MIND_MEGVAN[0]!, id: null, forrasLetezik: false }, MIND_MEGVAN[1]!],
    )
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.letrehozando).toEqual([])
    expect(eredmeny.kihagyasok.find((k) => k.hangos === true)?.indok).toContain(
      KEPZES_IGAZOLAS_KEP_FORRAS.filePath,
    )
  })

  it.each([
    ['üres szekciósor', []],
    ['nincs ajánlat-kártya blokk', [richText]],
    [
      'az ajánlat-kártyák közt nincs képzés- vagy szakkönyv-ikonos',
      [
        {
          id: 'mas',
          blockType: 'offerCards',
          kartyak: [{ id: 'k1', ikon: 'nincs', kep: null, cim: 'Más', szoveg: 'Más.' }],
        },
      ],
    ],
  ])('%s: hangos kihagyás, nincs írás', (_nev, layout) => {
    const eredmeny = dontes(layout as Szekciosor)
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
  })
})
