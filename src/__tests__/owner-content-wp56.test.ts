import { describe, expect, it, vi } from 'vitest'

import { LEGACY_IMAGES } from '../lib/legacy-images'
import { managedMediaAssets } from '../lib/media-recovery-provenance'
import {
  alkalmazMediaAltSzoveg,
  futtatMediaAltLefedettseg,
  illeszkedikMediaFajlnev,
  LEGACY_MEDIA_ALT,
  MEDIA_ALT_SZOVEGEK,
  mediaAltJeloltek,
  uresAltOsszesites,
  URES_ALT_LISTA_LIMIT,
  type MediaAltRekord,
  type MediaAltTar,
} from '../scripts/apply-owner-content'

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

/**
 * WP57 — alt-lefedettség a teljes Médiatárra: a manifest-alapú feloldás, a
 * régi oldal táblája, a gondolatjel-tilalom, az idempotencia és a
 * próbafutás írás-tilalma.
 */
describe('WP57 — a régi oldal alt-táblája', () => {
  it('MINDEN legacy-images tételt lefed, és nincs fölösleges kulcs', () => {
    const fajlok = LEGACY_IMAGES.map((kep) => kep.file).sort()
    expect(Object.keys(LEGACY_MEDIA_ALT).sort()).toEqual(fajlok)
  })

  it('minden alt rövid, tárgyszerű magyar mondat, gondolatjel nélkül', () => {
    for (const [file, alt] of Object.entries(LEGACY_MEDIA_ALT)) {
      expect(alt, file).not.toMatch(/[–—]/)
      expect(alt.trim(), file).toBe(alt)
      expect(alt.length, file).toBeGreaterThan(15)
      expect(alt.length, file).toBeLessThan(120)
      expect(alt, file).toMatch(/[.)]$/)
    }
  })

  it('a szóló portrén (IMG_7573) csak Kocsis Kata szerepel (a lista javított alt-ja)', () => {
    const alt = LEGACY_MEDIA_ALT['682a121babe80_IMG_7573.jpeg']
    expect(alt).toContain('Kocsis Kata')
    expect(alt).not.toContain('Kiss Kata')
  })
})

describe('WP57 — a jelölt-lista', () => {
  const jeloltek = mediaAltJeloltek()

  it('a kurzusborító, a három manifest és a régi oldal MINDEN tétele szerepel, törzsenként egyszer', () => {
    const prefixek = jeloltek.map((j) => j.prefix)
    expect(new Set(prefixek).size).toBe(prefixek.length)
    for (const tetel of MEDIA_ALT_SZOVEGEK) expect(prefixek).toContain(tetel.prefix)
    for (const asset of managedMediaAssets()) {
      expect(prefixek).toContain(asset.file.replace(/\.[^.]+$/, ''))
    }
    for (const kep of LEGACY_IMAGES) expect(prefixek).toContain(kep.file.replace(/\.[^.]+$/, ''))
  })

  it('a manifest alt-ja a manifestből jön (team, press, sos)', () => {
    for (const asset of managedMediaAssets()) {
      const jelolt = jeloltek.find((j) => j.prefix === asset.file.replace(/\.[^.]+$/, ''))
      expect(jelolt?.alt, asset.file).toBe(asset.alt)
      expect(jelolt?.forras, asset.file).toBe('manifest')
    }
    expect(jeloltek.filter((j) => j.forras === 'manifest').length).toBe(managedMediaAssets().length)
  })

  it('a két packshoton a WP56 bővebb szövege nyer, nem a legacy-tábla', () => {
    for (const tetel of MEDIA_ALT_SZOVEGEK) {
      const jelolt = jeloltek.find((j) => j.prefix === tetel.prefix)
      expect(jelolt?.alt).toBe(tetel.alt)
      expect(jelolt?.forras).toBe('kurzusborito')
    }
  })

  it('egyetlen jelölt alt-jában sincs gondolatjel, és mind nem üres', () => {
    for (const jelolt of jeloltek) {
      expect(jelolt.alt, jelolt.prefix).not.toMatch(/[–—]/)
      expect(jelolt.alt.trim().length, jelolt.prefix).toBeGreaterThan(0)
    }
  })
})

describe('WP57 — fájlnév-illesztés', () => {
  it('a törzs, a webp-változat és a Payload -1 utótagos változata illeszkedik', () => {
    expect(illeszkedikMediaFajlnev('founders-intro-white-1600', 'founders-intro-white-1600.webp')).toBe(true)
    expect(illeszkedikMediaFajlnev('founders-intro-white-1600', 'founders-intro-white-1600-1.webp')).toBe(true)
    expect(illeszkedikMediaFajlnev('founders-intro-white-1600', 'founders-intro-white-1600-12.webp')).toBe(true)
    expect(illeszkedikMediaFajlnev('kossuth-radio', 'kossuth-radio.png')).toBe(true)
    expect(illeszkedikMediaFajlnev('67b3c6e9e315f_KocsisKatakozeli', '67b3c6e9e315f_KocsisKatakozeli.webp')).toBe(true)
  })

  it('idegen fájl nem illeszkedik (toldalék, más törzs, regex-karakter)', () => {
    expect(illeszkedikMediaFajlnev('founders-intro-white-1600', 'founders-intro-white-1600-v2.webp')).toBe(false)
    expect(illeszkedikMediaFajlnev('founders-intro-white-1600', 'founders-intro-white-16000.webp')).toBe(false)
    expect(illeszkedikMediaFajlnev('kep', 'kepek.webp')).toBe(false)
    expect(illeszkedikMediaFajlnev('kep.v1', 'kepXv1.webp')).toBe(false)
  })
})

describe('WP57 — üres-alt összesítés', () => {
  const rekord = (id: number, filename: string, alt: string | null | undefined): MediaAltRekord => ({
    id,
    filename,
    alt,
  })

  it('csak az üres és a kitöltetlen marad, fájlnév szerint rendezve', () => {
    const o = uresAltOsszesites(
      [
        rekord(1, 'b.webp', ''),
        rekord(2, 'a.webp', '   '),
        rekord(3, 'c.webp', null),
        rekord(4, 'd.webp', 'Van leírás.'),
        rekord(5, 'e.webp', undefined),
      ],
      new Set([3]),
    )
    expect(o.darab).toBe(3)
    expect(o.fajlnevek).toEqual(['a.webp', 'b.webp', 'e.webp'])
  })

  it('a lista legfeljebb 50 fájlnév, a darab a teljes szám', () => {
    const sok = Array.from({ length: 70 }, (_, i) => rekord(i + 1, `kep-${String(i + 1).padStart(3, '0')}.webp`, ''))
    const o = uresAltOsszesites(sok, new Set())
    expect(o.darab).toBe(70)
    expect(o.fajlnevek).toHaveLength(URES_ALT_LISTA_LIMIT)
    expect(URES_ALT_LISTA_LIMIT).toBe(50)
  })
})

describe('WP57 — a futtató', () => {
  /** Mock-Médiatár: néhány üres, egy szerkesztői és egy már kitöltött rekord. */
  const tar = (irAlt: MediaAltTar['irAlt']): { tar: MediaAltTar; rekordok: MediaAltRekord[] } => {
    const rekordok: MediaAltRekord[] = [
      { id: 1, filename: '688b93e6ab76f_Programpackshot.webp', alt: '' },
      { id: 2, filename: 'founders-intro-white-1600.webp', alt: '' },
      { id: 3, filename: 'founders-intro-white-1600-1.webp', alt: '' },
      { id: 4, filename: '67b3c6e9e315f_KocsisKatakozeli.webp', alt: 'Saját szerkesztői leírás' },
      { id: 5, filename: 'kossuth-radio.webp', alt: 'A Kossuth Rádió logója' },
      { id: 6, filename: 'ismeretlen-kep.webp', alt: '' },
      { id: 7, filename: 'founders-intro-white-1600-v2.webp', alt: '' },
    ]
    return {
      rekordok,
      tar: {
        keres: async (prefix) => rekordok.filter((r) => r.filename.startsWith(prefix)),
        osszes: async () => rekordok,
        irAlt,
      },
    }
  }

  it('PRÓBAFUTÁS: semmi nem íródik (hangosan dobó írás-mock), a számok mégis pontosak', async () => {
    const irAlt = vi.fn(async () => {
      throw new Error('próbafutásban az irAlt NEM hívható')
    })
    const { tar: t } = tar(irAlt)
    const e = await futtatMediaAltLefedettseg(t, true)
    expect(irAlt).not.toHaveBeenCalled()
    // 1 (packshot) + 2 (founders-intro és a -1 változat) módosítandó.
    expect(e.modositasok).toBe(3)
    // Az üres alt-ok közül a három kitöltendő nem, a nem illeszkedő -v2 és az
    // ismeretlen kép igen: kettő maradna.
    expect(e.uresMaradt.darab).toBe(2)
    expect(e.uresMaradt.fajlnevek).toEqual(['founders-intro-white-1600-v2.webp', 'ismeretlen-kep.webp'])
    expect(e.kihagyasok).toBeGreaterThan(0)
  })

  it('ÉLES futás: csak az üres, illeszkedő rekordok kapják meg az alt-ot, a szerkesztői és a már kész nem', async () => {
    const irt: [number, string][] = []
    const irAlt = vi.fn(async (id: number, alt: string) => {
      irt.push([id, alt])
    })
    const { tar: t } = tar(irAlt)
    const e = await futtatMediaAltLefedettseg(t, false)
    expect(e.modositasok).toBe(3)
    expect(irt.map(([id]) => id).sort()).toEqual([1, 2, 3])
    const alapitok = managedMediaAssets().find((a) => a.file === 'founders-intro-white-1600.webp')
    expect(irt.find(([id]) => id === 2)?.[1]).toBe(alapitok?.alt)
    expect(irt.find(([id]) => id === 3)?.[1]).toBe(alapitok?.alt)
    expect(irt.find(([id]) => id === 1)?.[1]).toBe(MEDIA_ALT_SZOVEGEK[0].alt)
    expect(irt.some(([id]) => id === 4 || id === 5 || id === 6 || id === 7)).toBe(false)
  })

  it('idempotens: a második futás semmit nem módosít', async () => {
    const { tar: t, rekordok } = tar(async (id, alt) => {
      const i = rekordok.findIndex((r) => r.id === id)
      rekordok[i] = { ...rekordok[i]!, alt }
    })
    const elso = await futtatMediaAltLefedettseg(t, false)
    expect(elso.modositasok).toBe(3)
    const irAltMasodik = vi.fn(async () => {
      throw new Error('a második futásnak nincs mit írnia')
    })
    const masodik = await futtatMediaAltLefedettseg({ ...t, irAlt: irAltMasodik }, false)
    expect(masodik.modositasok).toBe(0)
    expect(irAltMasodik).not.toHaveBeenCalled()
    expect(masodik.uresMaradt.darab).toBe(2)
  })
})
