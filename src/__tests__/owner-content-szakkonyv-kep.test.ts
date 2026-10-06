import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import teamManifest from '../../public/media/team/manifest.json'
import { managedMediaAssets } from '../lib/media-recovery-provenance'
import {
  SZAKKONYV_KEP_FORRAS,
  alkalmazSzakkonyvKep,
  type FotoCsere,
  type UjMediaAllapot,
} from '../scripts/apply-owner-content'
import type { Page } from '../payload-types'

/**
 * 2026-10-06, tulajdonosi kérés: a szakkönyv fotója a /szakembereknek
 * szakkönyv-kártyájának tetejére. A tartalomjob `szakkonyv-kep` szabálya
 * (src/scripts/apply-owner-content.ts) adatbázis és hálózat NÉLKÜL: a döntés
 * tiszta, a rekord-létrehozást a közös `futtatFotoCsere` végzi (annak tesztje
 * az owner-content-fotok.test.ts-ben).
 *
 * Üres mezőt tölt ki, csak a szakkönyv-ikonos kártyán; szerkesztői képet nem
 * ír felül (hangos); második futásra „MÁR”.
 */

type Szekciosor = NonNullable<Page['layout']>
type Blokk = Szekciosor[number]

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const KONYV_ID = 720

const KONYV_MEGVAN: UjMediaAllapot = {
  filename: SZAKKONYV_KEP_FORRAS.filename,
  id: KONYV_ID,
  forrasLetezik: true,
}

const richText = { id: 'rt', blockType: 'richText', content: null } as unknown as Blokk

const ajanlatok = (konyvKep: number | null, kepzesKep: number | null = null) =>
  ({
    id: 'ajanlatok',
    blockType: 'offerCards',
    kartyak: [
      { id: 'k1', ikon: 'kepzes', kep: kepzesKep, cim: 'Képzés', szoveg: 'A képzés.' },
      { id: 'k2', ikon: 'szakkonyv', kep: konyvKep, cim: 'Szakkönyv', szoveg: 'A könyv.' },
    ],
  }) as unknown as Blokk

const kartyaKepek = (layout: Szekciosor | null, blokk: number): unknown[] => {
  const talalat = layout?.[blokk]
  return talalat?.blockType === 'offerCards' ? (talalat.kartyak ?? []).map((k) => k.kep) : []
}

const dontes = (layout: Page['layout'], ujMedia: UjMediaAllapot = KONYV_MEGVAN): FotoCsere =>
  alkalmazSzakkonyvKep({ layout, oldalCimke: 'Szakembereknek oldal', ujMedia })

describe('szakkonyv-kep — a forrás', () => {
  it('a manifest kezelt képe: a fájl megvan, a sha256 és az alt a manifesté, 4:3 WebP', async () => {
    const asset = teamManifest.assets.find((item) => item.file === SZAKKONYV_KEP_FORRAS.filename)
    expect(asset?.role).toBe('szakkonyv-borito')
    expect(SZAKKONYV_KEP_FORRAS.filePath).toBe(`public/media/team/${SZAKKONYV_KEP_FORRAS.filename}`)
    expect(SZAKKONYV_KEP_FORRAS.alt).toBe(asset?.alt)
    const hash = createHash('sha256')
      .update(readFileSync(join(REPO, SZAKKONYV_KEP_FORRAS.filePath)))
      .digest('hex')
    expect(hash).toBe(asset?.sha256)
    const meta = await sharp(join(REPO, SZAKKONYV_KEP_FORRAS.filePath)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1600, 1200])
    // Kezelt kép: létrehozáskor eredetigazolást kap (Volume-helyreállítás).
    expect(
      managedMediaAssets().some((item) => item.filename === SZAKKONYV_KEP_FORRAS.filename),
    ).toBe(true)
    expect(SZAKKONYV_KEP_FORRAS.alt).not.toMatch(/[–—]/)
  })
})

describe('alkalmazSzakkonyvKep', () => {
  it('a szakkönyv-kártya üres képmezőjét kitölti, a képzés kártyája és a többi blokk érintetlen', () => {
    const layout: Szekciosor = [richText, ajanlatok(null)]
    const eredmeny = dontes(layout)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.letrehozando).toEqual([])
    expect(kartyaKepek(eredmeny.layout, 1)).toEqual([null, KONYV_ID])
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    expect(eredmeny.modositasok[0]?.uzenet).toContain(SZAKKONYV_KEP_FORRAS.filename)
  })

  it('második futásra „MÁR” kihagyás, nincs írás', () => {
    const elso = dontes([ajanlatok(null)])
    const masodik = dontes(elso.layout)
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0]?.indok).toContain('MÁR')
    expect(masodik.kihagyasok[0]?.hangos).not.toBe(true)
  })

  it('szerkesztői képet nem ír felül: hangos kihagyás', () => {
    const eredmeny = dontes([ajanlatok(55)])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('55')
  })

  it('még nincs rekord, de a forrásfájl megvan: létrehozást kér, a szekciósor addig nem íródik', () => {
    const eredmeny = dontes([ajanlatok(null)], { ...KONYV_MEGVAN, id: null })
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.letrehozando).toEqual([0])
    expect(eredmeny.modositasok[0]?.uzenet).toContain('repó fájljából hozza létre')
  })

  it('se rekord, se forrásfájl: hangos kihagyás, nincs létrehozás', () => {
    const eredmeny = dontes([ajanlatok(null)], { ...KONYV_MEGVAN, id: null, forrasLetezik: false })
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.letrehozando).toEqual([])
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
  })

  it.each([
    ['üres szekciósor', []],
    ['nincs ajánlat-kártya blokk', [richText]],
    [
      'az ajánlat-kártyák közt nincs szakkönyv-ikonos',
      [
        {
          id: 'csak-kepzes',
          blockType: 'offerCards',
          kartyak: [{ id: 'k1', ikon: 'kepzes', kep: null, cim: 'Képzés', szoveg: 'A képzés.' }],
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
