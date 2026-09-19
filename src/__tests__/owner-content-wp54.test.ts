import { describe, expect, it, vi } from 'vitest'

import type { Payload } from 'payload'

import {
  alkalmazRolunkHeroKep,
  alkalmazSosGaleria,
  alkalmazSzolgaltatasokTechnikakTabla,
  biztositMediaFajlbol,
  dontsMediaBiztositas,
  payloadMediaFuggosegek,
  ROLUNK_HERO_FORRAS,
  ROLUNK_HERO_KORABBI_PREFIXEK,
  SOS_GALERIA_FORRASOK,
  TECHNIKAK_TABLA_CIM,
  TECHNIKAK_TABLA_HORGONY,
  TECHNIKAK_TABLA_KEP_FORRAS,
  TECHNIKAK_TABLA_SOROK,
  technikakTablaBlokk,
  ujMediaAllapot,
  type MediaBiztositasFuggosegek,
  type MediaForras,
  type UjMediaAllapot,
} from '../scripts/apply-owner-content'
import { isSzolgaltatasokAjtoBlock } from '../lib/home-help-states'
import { validateAnchorId } from '../blocks/section-settings'
import { buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'
import type { Page, Product } from '../payload-types'

/**
 * WP54 — a tulajdonosi kör 2026-09-19 fotós része, a TISZTA szabályok
 * (src/scripts/apply-owner-content.ts): média a repó fájljából, a /rolunk
 * stúdiófotó, az SOS galéria, a /szolgaltatasok technikák-táblája.
 *
 * Adatbázis, fájlrendszer és hálózat NÉLKÜL: a Médiatár-hozzáférés injektált
 * (`MediaBiztositasFuggosegek`), a próbafutásban tiltott ágak HANGOSAN dobó
 * hamisítványt kapnak. A tesztek nem függenek attól, hogy a jóváhagyott
 * fotófájlok léteznek-e a repóban (a `forrasLetezik` bemenet).
 */

type Szekciosor = NonNullable<Page['layout']>

const forras: MediaForras = {
  filename: 'proba-kep-1600.webp',
  filePath: 'public/media/proba/proba-kep-1600.webp',
  alt: 'Próbakép',
}

/** Hamis függőségek: a létrehozás alapból HANGOSAN dob (próbafutás-őr). */
const fuggosegek = (
  felul: Partial<MediaBiztositasFuggosegek> = {},
): MediaBiztositasFuggosegek & { letrehoz: ReturnType<typeof vi.fn> } => {
  const letrehoz = vi.fn(async () => {
    throw new Error('TILOS: a próbafutásban nem hozható létre média')
  })
  return {
    keres: async () => null,
    letezik: () => true,
    letrehoz,
    ...felul,
  } as MediaBiztositasFuggosegek & { letrehoz: ReturnType<typeof vi.fn> }
}

const allapot = (
  filename: string,
  id: number | null,
  forrasLetezik = true,
): UjMediaAllapot => ({ filename, id, forrasLetezik })

// ===========================================================================
// WP54/1 — média a repó fájljából, idempotensen
// ===========================================================================

describe('dontsMediaBiztositas', () => {
  it('meglévő rekordnál mindig „megvan”, a forrásfájltól és a módtól függetlenül', () => {
    for (const dryRun of [true, false]) {
      for (const forrasLetezik of [true, false]) {
        expect(dontsMediaBiztositas({ meglevoId: 5, forrasLetezik, dryRun })).toBe('megvan')
      }
    }
  })

  it('rekord és forrás nélkül „hianyzik”; forrással próbafutásban „letrehozna”, élesben „letrehoz”', () => {
    expect(dontsMediaBiztositas({ meglevoId: null, forrasLetezik: false, dryRun: true })).toBe(
      'hianyzik',
    )
    expect(dontsMediaBiztositas({ meglevoId: null, forrasLetezik: false, dryRun: false })).toBe(
      'hianyzik',
    )
    expect(dontsMediaBiztositas({ meglevoId: null, forrasLetezik: true, dryRun: true })).toBe(
      'letrehozna',
    )
    expect(dontsMediaBiztositas({ meglevoId: null, forrasLetezik: true, dryRun: false })).toBe(
      'letrehoz',
    )
  })
})

describe('biztositMediaFajlbol', () => {
  it('próbafutásban NEM hoz létre semmit, csak naplózza, mit hozna létre', async () => {
    const deps = fuggosegek()
    const eredmeny = await biztositMediaFajlbol({
      forras,
      szabaly: 'rolunk-hero-kep',
      dryRun: true,
      fuggosegek: deps,
    })

    expect(deps.letrehoz).not.toHaveBeenCalled()
    expect(eredmeny.teendo).toBe('letrehozna')
    expect(eredmeny.id).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('rolunk-hero-kep')
    expect(eredmeny.modositasok[0].uzenet).toContain(forras.filename)
    expect(eredmeny.modositasok[0].uzenet).toContain(forras.alt)
    expect(eredmeny.modositasok[0].uzenet).toContain('létrehozná')
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('idempotens: meglévő rekordnál azt adja vissza, és élesben sem duplikál', async () => {
    const deps = fuggosegek({ keres: async () => 42 })
    for (const dryRun of [true, false]) {
      const eredmeny = await biztositMediaFajlbol({
        forras,
        szabaly: 'sos-galeria',
        dryRun,
        fuggosegek: deps,
      })
      expect(eredmeny.teendo).toBe('megvan')
      expect(eredmeny.id).toBe(42)
      expect(eredmeny.modositasok).toHaveLength(0)
      expect(eredmeny.kihagyasok).toHaveLength(0)
    }
    expect(deps.letrehoz).not.toHaveBeenCalled()
  })

  it('hiányzó forrásfájlnál HANGOSAN kihagy, élesben is, létrehozás nélkül', async () => {
    const deps = fuggosegek({ letezik: () => false })
    const eredmeny = await biztositMediaFajlbol({
      forras,
      szabaly: 'sos-galeria',
      dryRun: false,
      fuggosegek: deps,
    })

    expect(deps.letrehoz).not.toHaveBeenCalled()
    expect(eredmeny.teendo).toBe('hianyzik')
    expect(eredmeny.id).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain(forras.filePath)
  })

  it('élesben a forrásból létrehozza, és az új azonosítót adja vissza', async () => {
    const letrehoz = vi.fn(async (f: MediaForras) => (f.filename === forras.filename ? 77 : -1))
    const deps = fuggosegek({ letrehoz })
    const eredmeny = await biztositMediaFajlbol({
      forras,
      szabaly: 'rolunk-hero-kep',
      dryRun: false,
      fuggosegek: deps,
    })

    expect(letrehoz).toHaveBeenCalledTimes(1)
    expect(letrehoz).toHaveBeenCalledWith(forras)
    expect(eredmeny.teendo).toBe('letrehoz')
    expect(eredmeny.id).toBe(77)
    expect(eredmeny.modositasok[0].uzenet).toContain('77')
  })
})

describe('ujMediaAllapot', () => {
  it('csak olvas: azonosító + forrás-létezés, létrehozás nélkül', async () => {
    const deps = fuggosegek({ keres: async (nev) => (nev === forras.filename ? 9 : null) })
    expect(await ujMediaAllapot(forras, deps)).toEqual({
      filename: forras.filename,
      id: 9,
      forrasLetezik: true,
    })
    expect(deps.letrehoz).not.toHaveBeenCalled()
  })
})

describe('payloadMediaFuggosegek — a valódi Médiatár-hozzáférés a próbafutásban', () => {
  /** Hamis Payload: az ÍRÓ hívások hangosan dobnak, a keresés üres. */
  const hamisPayload = () => {
    const create = vi.fn(async () => {
      throw new Error('TILOS: payload.create a próbafutásban')
    })
    const update = vi.fn(async () => {
      throw new Error('TILOS: payload.update a próbafutásban')
    })
    const find = vi.fn(async (args: { where?: { filename?: { equals?: string } } }) => ({
      docs:
        args.where?.filename?.equals === 'megvan.webp'
          ? [{ id: 12, filename: 'megvan.webp' }]
          : [],
    }))
    return { payload: { create, update, find } as unknown as Payload, create, update, find }
  }

  it('OWNER_CONTENT_CONFIRM nélkül (dryRun) egyetlen create/update sem hívódik', async () => {
    const { payload, create, update, find } = hamisPayload()
    const deps = payloadMediaFuggosegek(payload)
    // Létező repó-fájl, hogy a döntés biztosan a „létrehozná” ágra fusson.
    const letezoForras: MediaForras = {
      filename: 'founders-intro-white-1600.webp',
      filePath: 'public/media/team/founders-intro-white-1600.webp',
      alt: 'A Kineticare két alapítója.',
    }
    const eredmeny = await biztositMediaFajlbol({
      forras: letezoForras,
      szabaly: 'rolunk-hero-kep',
      dryRun: true,
      fuggosegek: deps,
    })

    expect(eredmeny.teendo).toBe('letrehozna')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('a keresés PONTOS fájlnév-egyezésre ad azonosítót', async () => {
    const { payload } = hamisPayload()
    const deps = payloadMediaFuggosegek(payload)
    expect(await deps.keres('megvan.webp')).toBe(12)
    expect(await deps.keres('nincs.webp')).toBeNull()
  })
})

// ===========================================================================
// WP54/2 — a /rolunk fejléc-képe: a stúdiófotó (egyetlen szabály a mezőre)
// ===========================================================================

describe('alkalmazRolunkHeroKep — WP54 kiegészítések', () => {
  it('a jóváhagyott forrás: pontos webp fájlnév, a megadott alt, a team mappából', () => {
    expect(ROLUNK_HERO_FORRAS.filename).toBe('founders-studio-pair-1600.webp')
    expect(ROLUNK_HERO_FORRAS.filePath).toBe('public/media/team/founders-studio-pair-1600.webp')
    expect(ROLUNK_HERO_FORRAS.alt).toBe('Kocsis Kata és Kiss Kata a stúdióban')
    expect(ROLUNK_HERO_KORABBI_PREFIXEK).toContain('katak-team')
  })

  it('ha a fotó még nincs a Médiatárban, de a forrás megvan: módosít, az azonosítót a futtató tölti ki', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 41,
      jelenlegiFajlnev: 'katak-team.webp',
      ujMedia: allapot(ROLUNK_HERO_FORRAS.filename, null, true),
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].uzenet).toContain('a repó fájljából hozza létre')
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('a stúdiófotó fájlnevét viselő képnél akkor is idempotens, ha az azonosító nem ismert', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 5,
      jelenlegiFajlnev: ROLUNK_HERO_FORRAS.filename,
      ujMedia: allapot(ROLUNK_HERO_FORRAS.filename, null, true),
    })

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(false)
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR')
  })
})

// ===========================================================================
// WP54/3 — az SOS kurzus galériája
// ===========================================================================

describe('alkalmazSosGaleria', () => {
  const ujMediak = (ids: readonly (number | null)[], forrasLetezik = true): UjMediaAllapot[] =>
    SOS_GALERIA_FORRASOK.map((f, index) => allapot(f.filename, ids[index] ?? null, forrasLetezik))

  it('a három jóváhagyott kép a megadott sorrendben és alt-tal', () => {
    expect(SOS_GALERIA_FORRASOK.map((f) => f.filename)).toEqual([
      'sos-band-stretch-1600.webp',
      'sos-ball-squeeze-1600.webp',
      'sos-spiky-ball-forearm-1600.webp',
    ])
    expect(SOS_GALERIA_FORRASOK.map((f) => f.alt)).toEqual([
      'Gumiszalagos csuklónyújtás az asztal szélén',
      'Puha labda szorítása a tenyérben',
      'Tüskés labdás alkarlazítás',
    ])
    for (const f of SOS_GALERIA_FORRASOK) {
      expect(f.filePath).toBe(`public/media/sos/${f.filename}`)
    }
  })

  it('ÜRES galériába (null, undefined, [], kép nélküli sorok) a három képet írja, sorrendben', () => {
    for (const jelenlegi of [null, undefined, [], [{ image: null }, { image: undefined }]]) {
      const eredmeny = alkalmazSosGaleria({ jelenlegi, ujMediak: ujMediak([1, 2, 3]) })

      expect(eredmeny.gallery).toEqual([{ image: 1 }, { image: 2 }, { image: 3 }])
      expect(eredmeny.modositasok).toHaveLength(1)
      expect(eredmeny.modositasok[0].szabaly).toBe('sos-galeria')
      expect(eredmeny.kihagyasok).toHaveLength(0)
    }
  })

  it('ha a képek még nincsenek a Médiatárban, de a forrás megvan: módosít, a sorokat a futtató építi', () => {
    const eredmeny = alkalmazSosGaleria({ jelenlegi: [], ujMediak: ujMediak([null, 2, null]) })

    expect(eredmeny.gallery).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].uzenet).toContain('a repó fájljaiból hozza létre')
  })

  it('idempotens: a pontosan ezt a hármast (sorrendben) tartalmazó galériát csendben kihagyja', () => {
    const elso = alkalmazSosGaleria({ jelenlegi: [], ujMediak: ujMediak([1, 2, 3]) })
    const masodik = alkalmazSosGaleria({ jelenlegi: elso.gallery, ujMediak: ujMediak([1, 2, 3]) })

    expect(masodik.gallery).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
    expect(masodik.kihagyasok[0].hangos).toBe(false)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
  })

  it('csak a jóváhagyott képek, de más sorrendben vagy hiányosan: indokolt, nem hangos kihagyás', () => {
    for (const jelenlegi of [
      [{ image: 3 }, { image: 1 }, { image: 2 }],
      [{ image: 1 }, { image: 2 }],
    ]) {
      const eredmeny = alkalmazSosGaleria({ jelenlegi, ujMediak: ujMediak([1, 2, 3]) })
      expect(eredmeny.gallery).toBeNull()
      expect(eredmeny.modositasok).toHaveLength(0)
      expect(eredmeny.kihagyasok[0].hangos).toBe(false)
      expect(eredmeny.kihagyasok[0].indok).toContain('nem rendez át')
    }
  })

  it('a szerkesztő képét NEM írja felül: hangos kihagyás a fájlnévvel', () => {
    const eredmeny = alkalmazSosGaleria({
      jelenlegi: [{ image: 1 }, { image: 99, id: 'sor-99' }],
      ujMediak: ujMediak([1, 2, 3]),
      ismertFajlnevek: new Map([[99, 'sajat-foto.webp']]),
    })

    expect(eredmeny.gallery).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('sajat-foto.webp')
    expect(eredmeny.kihagyasok[0].indok).toContain('szerkesztői elsőbbség')
  })

  it('a szerkesztő képénél akkor is hangos, ha a jóváhagyott képek még nem léteznek', () => {
    const eredmeny = alkalmazSosGaleria({
      jelenlegi: [{ image: 99 }],
      ujMediak: ujMediak([null, null, null]),
    })
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
  })

  it('üres galériánál hiányzó forrásfájl: hangos kihagyás, a galéria csak a teljes hármassal kerül be', () => {
    const mediak = ujMediak([1, null, null])
    mediak[2] = allapot(mediak[2].filename, null, false)
    const eredmeny = alkalmazSosGaleria({ jelenlegi: [], ujMediak: mediak })

    expect(eredmeny.gallery).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain(mediak[2].filename)
    expect(eredmeny.kihagyasok[0].indok).not.toContain(mediak[0].filename)
  })

  it('a bemenetet nem módosítja helyben', () => {
    const jelenlegi: Product['gallery'] = [{ image: 99 }]
    const masolat = structuredClone(jelenlegi)
    alkalmazSosGaleria({ jelenlegi, ujMediak: ujMediak([1, 2, 3]) })
    expect(jelenlegi).toEqual(masolat)
  })
})

// ===========================================================================
// WP54/4 — a /szolgaltatasok technikák-táblája
// ===========================================================================

describe('alkalmazSzolgaltatasokTechnikakTabla', () => {
  const seed = (): Szekciosor => buildSzolgaltatasokLayout()
  const ajtoIndex = (layout: Szekciosor): number => layout.findIndex(isSzolgaltatasokAjtoBlock)
  const kep = (id: number | null, forrasLetezik = true): UjMediaAllapot =>
    allapot(TECHNIKAK_TABLA_KEP_FORRAS.filename, id, forrasLetezik)

  it('a seed pontosan egy ajtó-blokkot tartalmaz (a fixtúra érvényes)', () => {
    expect(seed().filter(isSzolgaltatasokAjtoBlock)).toHaveLength(1)
  })

  it('a blokk: tábla-elrendezés, 5 sor „1”–„5” számozással, CTA és fotó nélkül, horgonnyal', () => {
    const blokk = technikakTablaBlokk(7)

    expect(blokk.blockType).toBe('services')
    expect(blokk.elrendezes).toBe('tabla')
    expect(blokk.eyebrow).toBe('Rendelői kezelések')
    expect(blokk.title).toBe(TECHNIKAK_TABLA_CIM)
    expect(blokk.lead).toBe(
      'Vizsgálat után ezekből állítjuk össze a kezelési tervedet. Minden alkalom a te panaszodhoz igazodik.',
    )
    expect(blokk.image).toBe(7)
    expect(blokk.rows).toHaveLength(5)
    expect(blokk.rows?.map((sor) => sor.number)).toEqual(['1', '2', '3', '4', '5'])
    expect(blokk.rows?.map((sor) => sor.title)).toEqual([
      'Gyógytorna',
      'Manuálterápia',
      'Kinesio Tape és Dynamic Tape',
      'Flossing és köpölyterápia',
      'Hegkezelés, fasciakés, NRX bandázs',
    ])
    for (const sor of blokk.rows ?? []) {
      expect(sor.felirat).toBe('')
      expect(sor.url).toBe('')
      expect(sor.photo).toBeNull()
      expect(sor.body.length).toBeGreaterThan(0)
    }
    expect(isSzolgaltatasokAjtoBlock(blokk)).toBe(false)
    expect(blokk.sectionSettings).toEqual({
      visible: true,
      hatter: 'feher',
      anchorId: TECHNIKAK_TABLA_HORGONY,
    })
    expect(validateAnchorId(TECHNIKAK_TABLA_HORGONY)).toBe(true)
    expect(TECHNIKAK_TABLA_SOROK).toHaveLength(5)
  })

  it('a vevői szövegekben nincs gondolatjel-halmozás', () => {
    const szovegek = [
      TECHNIKAK_TABLA_CIM,
      ...TECHNIKAK_TABLA_SOROK.flatMap((sor) => [sor.title, sor.body]),
      TECHNIKAK_TABLA_KEP_FORRAS.alt,
    ]
    for (const szoveg of szovegek) {
      expect(szoveg).not.toContain('—')
      expect(szoveg).not.toContain(' - ')
    }
  })

  it('KÖZVETLENÜL az ajtó-blokk után szúrja be; a többi blokk referenciája változatlan', () => {
    const layout = seed()
    const masolat = structuredClone(layout)
    const ajto = ajtoIndex(layout)
    const eredmeny = alkalmazSzolgaltatasokTechnikakTabla({ layout, kep: kep(7) })

    expect(eredmeny.layout).not.toBeNull()
    expect(eredmeny.beszurasIndex).toBe(ajto + 1)
    expect(eredmeny.layout).toHaveLength(layout.length + 1)
    expect(eredmeny.layout?.[ajto]).toBe(layout[ajto])
    expect(eredmeny.layout?.[ajto + 1]).toEqual(technikakTablaBlokk(7))
    expect(eredmeny.layout?.[ajto + 2]).toBe(layout[ajto + 1])
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('szolgaltatasok-technikak-tabla')
    expect(eredmeny.modositasok[0].uzenet).toContain(TECHNIKAK_TABLA_KEP_FORRAS.filename)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(layout).toEqual(masolat)
  })

  it('idempotens: a beszúrt (akár rejtett) táblát másodszor csendben kihagyja', () => {
    const elso = alkalmazSzolgaltatasokTechnikakTabla({ layout: seed(), kep: kep(7) })
    const beszurt = elso.layout ?? []
    const rejtett: Szekciosor = beszurt.map((blokk) =>
      blokk.blockType === 'services' && blokk.title === TECHNIKAK_TABLA_CIM
        ? { ...blokk, sectionSettings: { ...blokk.sectionSettings, visible: false } }
        : blokk,
    )
    for (const layout of [beszurt, rejtett]) {
      const masodik = alkalmazSzolgaltatasokTechnikakTabla({ layout, kep: kep(7) })
      expect(masodik.layout).toBeNull()
      expect(masodik.modositasok).toHaveLength(0)
      expect(masodik.kihagyasok[0].hangos).not.toBe(true)
      expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    }
  })

  it('ha a kép még nincs a Médiatárban, de a forrás megvan: módosít, a layoutot a futtató építi az indexre', () => {
    const layout = seed()
    const eredmeny = alkalmazSzolgaltatasokTechnikakTabla({ layout, kep: kep(null, true) })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.beszurasIndex).toBe(ajtoIndex(layout) + 1)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].uzenet).toContain('a repó fájljából hozza létre')
  })

  it('kép és forrásfájl nélkül NEM szúr be: hangos kihagyás', () => {
    const eredmeny = alkalmazSzolgaltatasokTechnikakTabla({ layout: seed(), kep: kep(null, false) })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.beszurasIndex).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain(TECHNIKAK_TABLA_KEP_FORRAS.filePath)
  })

  it('hiányzó, rejtett vagy duplikált ajtó-blokknál indokolt kihagyás', () => {
    const layout = seed()
    const ajto = ajtoIndex(layout)
    const nelkule = layout.filter((_, index) => index !== ajto)
    const rejtve: Szekciosor = layout.map((blokk, index) =>
      index === ajto
        ? { ...blokk, sectionSettings: { ...blokk.sectionSettings, visible: false } }
        : blokk,
    )
    const duplan: Szekciosor = [...layout, layout[ajto]]
    for (const [eset, jelolt] of [
      ['nincs', nelkule],
      ['rejtett', rejtve],
      ['dupla', duplan],
    ] as const) {
      const eredmeny = alkalmazSzolgaltatasokTechnikakTabla({ layout: jelolt, kep: kep(7) })
      expect(eredmeny.layout, eset).toBeNull()
      expect(eredmeny.modositasok, eset).toHaveLength(0)
      expect(eredmeny.kihagyasok[0].hangos, eset).not.toBe(true)
      expect(eredmeny.kihagyasok[0].indok, eset).toContain('ajtós')
    }
    const ures = alkalmazSzolgaltatasokTechnikakTabla({ layout: [], kep: kep(7) })
    expect(ures.layout).toBeNull()
    expect(ures.kihagyasok).toHaveLength(1)
  })
})
