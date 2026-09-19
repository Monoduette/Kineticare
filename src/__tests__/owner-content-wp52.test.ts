import { describe, expect, it } from 'vitest'

import {
  alkalmazAllapotokBevezeto,
  alkalmazAllapotokNyitottIge,
  alkalmazBemutatkozasSzetvalasztas,
  alkalmazHowItWorksGondolatjel,
  alkalmazKezdolapBemutatkozasRovidites,
  alkalmazKezdolapJavitasok,
  alkalmazKezdolapRolunkSzoveg,
  alkalmazKezdolapSajtologoSorrend,
  alkalmazKezdolapSegitsegSorrend,
  alkalmazKurzuslistaFeliratok,
  alkalmazPressLogosFejlec,
  alkalmazRolunkLogosavokSorrend,
  alkalmazRolunkPartnerMondat,
  alkalmazSzakmaiMenupont,
  alkalmazZaroCta,
  allapotokUjBevezeto,
  allapotokUjNyitottSzoveg,
  kezdolapRolunkUjSzoveg,
  pressLogosUjFejlec,
  richTextBekezdesek,
  SZAKEMBEREKNEK_UTVONAL,
  SZAKMAI_MENUPONT_REGI_FELIRATOK,
  SZAKMAI_MENUPONT_UJ_FELIRAT,
  stabilJson,
  UJ_KURZUS_SZEKCIO_CIM,
  zaroCtaSeedBlokk,
  type JavitasLepes,
} from '../scripts/apply-owner-content'
import { HOME_HELP_TITLE } from '../lib/home-help-states'
import { buildHomeLayout } from '../lib/home-seed'
import { PROFESSIONAL_TRAINING_URL } from '../lib/menu-seed'
import {
  KEZDOLAP_BEMUTATKOZAS,
  KEZDOLAP_BEMUTATKOZAS_CIM,
  KEZDOLAP_BEMUTATKOZAS_KIEMELES,
  KEZDOLAP_BEMUTATKOZAS_ROVID,
  ROLUNK_BEMUTATKOZAS,
  ROLUNK_BEMUTATKOZAS_CIM,
} from '../lib/rolunk-bemutatkozas'
import {
  buildRolunkLayout,
  para,
  richText,
  ROLUNK_PARTNER_FELIRAT,
  ROLUNK_TOVABBI_PARTNEREK,
} from '../scripts/restore-legacy-content'
import type { Menu, Page } from '../payload-types'

/**
 * WP52 — a tulajdonosi kérések CMS-adat oldalának TISZTA szabályai
 * (src/scripts/apply-owner-content.ts). Adatbázis és hálózat nélkül: minden
 * fixtúra memóriabeli, a seed-builderekből (home-seed, restore-legacy-content).
 *
 * A mért tulajdonságok szabályonként: (1) a várt állapoton módosít, (2) a már
 * elvégzett állapoton csendben kihagy (idempotencia), (3) minden más állapoton
 * indokolt kihagyás, a szerkesztő adatához nem nyúl, (4) a bemenetet nem
 * módosítja helyben.
 */

type Szekciosor = NonNullable<Page['layout']>
type Szekcio = Szekciosor[number]

const tipusok = (layout: Szekciosor | null | undefined): string[] =>
  (layout ?? []).map((blokk) => blokk.blockType)

const indexe = (layout: Szekciosor, feltetel: (blokk: Szekcio) => boolean): number =>
  layout.findIndex(feltetel)

const services = (blokk: Szekcio): boolean =>
  blokk.blockType === 'services' && blokk.title === HOME_HELP_TITLE
const courseCards = (blokk: Szekcio): boolean =>
  blokk.blockType === 'courseCards' && blokk.heading === UJ_KURZUS_SZEKCIO_CIM
const about = (blokk: Szekcio): boolean =>
  blokk.blockType === 'about' && blokk.title === KEZDOLAP_BEMUTATKOZAS_CIM
const sajto = (blokk: Szekcio): boolean =>
  blokk.blockType === 'pressLogos' && blokk.heading === pressLogosUjFejlec()
const partner = (blokk: Szekcio): boolean =>
  blokk.blockType === 'pressLogos' && blokk.heading === ROLUNK_PARTNER_FELIRAT
const partnerMondat = (blokk: Szekcio): boolean =>
  richTextBekezdesek(blokk)?.[0] === ROLUNK_TOVABBI_PARTNEREK

const rejtve = (blokk: Szekcio): Szekcio => ({
  ...blokk,
  sectionSettings: { ...blokk.sectionSettings, visible: false },
})

// ===========================================================================
// WP52/1 — a „Szakmai képzés” menüpont
// ===========================================================================

describe('alkalmazSzakmaiMenupont', () => {
  const menupont = (
    felul: Partial<Pick<Menu, 'label' | 'type' | 'url' | 'openInNewTab'>> = {},
  ): Pick<Menu, 'id' | 'label' | 'type' | 'url' | 'openInNewTab'> => ({
    id: 7,
    label: 'Szakmai képzés',
    type: 'url',
    url: PROFESSIONAL_TRAINING_URL,
    openInNewTab: true,
    ...felul,
  })

  it.each(SZAKMAI_MENUPONT_REGI_FELIRATOK.map((felirat) => [felirat]))(
    'a régi feliratú (%s), ProBody-célú menüpontot átírja „Szakembereknek”-re, belső céllal, nem új lapon',
    (label) => {
      const eredmeny = alkalmazSzakmaiMenupont(menupont({ label }))

      expect(eredmeny.adat).toEqual({
        label: SZAKMAI_MENUPONT_UJ_FELIRAT,
        type: 'url',
        url: SZAKEMBEREKNEK_UTVONAL,
        openInNewTab: false,
      })
      expect(eredmeny.modositasok).toHaveLength(1)
      expect(eredmeny.modositasok[0].szabaly).toBe('szakmai-menupont')
      expect(eredmeny.modositasok[0].indok).toBeNull()
      expect(eredmeny.modositasok[0].uzenet).toContain(PROFESSIONAL_TRAINING_URL)
      expect(eredmeny.modositasok[0].uzenet).toContain(SZAKEMBEREKNEK_UTVONAL)
      expect(eredmeny.kihagyasok).toHaveLength(0)
    },
  )

  it('az új felirat és cél belső útvonal, nem a ProBody-cím', () => {
    expect(SZAKMAI_MENUPONT_UJ_FELIRAT).toBe('Szakembereknek')
    expect(SZAKEMBEREKNEK_UTVONAL).toBe('/szakembereknek')
    expect(SZAKEMBEREKNEK_UTVONAL.startsWith('/')).toBe(true)
    expect(SZAKEMBEREKNEK_UTVONAL.startsWith('//')).toBe(false)
  })

  it('idempotens: a már átírt menüpontot csendben kihagyja', () => {
    const elso = alkalmazSzakmaiMenupont(menupont())
    const masodik = alkalmazSzakmaiMenupont(menupont({ ...elso.adat }))

    expect(masodik.adat).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it.each([
    ['más felirat', { label: 'Képzés kollégáknak' }],
    ['körbeírt whitespace', { label: ' Szakmai képzés ' }],
    ['kisbetűs változat', { label: 'szakmai képzés' }],
  ])('a szerkesztett felirathoz (%s) nem nyúl', (_eset, felul) => {
    const eredmeny = alkalmazSzakmaiMenupont(menupont(felul))

    expect(eredmeny.adat).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('pontos egyezésnél')
  })

  it.each([
    ['más külső cél', { url: 'https://probodystudio.hu/' }],
    ['üres cél', { url: null }],
    ['oldal-típus', { type: 'page' as const, url: null }],
  ])('a nem ProBody-célú menüponthoz (%s) nem nyúl', (_eset, felul) => {
    const eredmeny = alkalmazSzakmaiMenupont(menupont(felul))

    expect(eredmeny.adat).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('ProBody')
  })
})

// ===========================================================================
// WP52/2a — „Így tudunk segíteni” a „Kurzusaink” elé
// ===========================================================================

describe('alkalmazKezdolapSegitsegSorrend', () => {
  it('a seed-sorrendben a sín a kártyák UTÁN áll — a szabály a kártyák elé viszi', () => {
    const kiindulas = buildHomeLayout()
    expect(indexe(kiindulas, services)).toBeGreaterThan(indexe(kiindulas, courseCards))

    const eredmeny = alkalmazKezdolapSegitsegSorrend(kiindulas)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('kezdolap-segitseg-sorrend')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    const uj = eredmeny.layout ?? []
    expect(uj).toHaveLength(kiindulas.length)
    expect(indexe(uj, services) + 1).toBe(indexe(uj, courseCards))
    // A többi blokk sorrendje és referenciája változatlan.
    const sinNelkul = (layout: Szekciosor) => layout.filter((blokk) => !services(blokk))
    expect(sinNelkul(uj)).toEqual(sinNelkul(kiindulas))
    for (const blokk of uj) expect(kiindulas).toContain(blokk)
  })

  it('idempotens: második futásban nincs módosítás, a kihagyás nem hangos', () => {
    const elso = alkalmazKezdolapSegitsegSorrend(buildHomeLayout())
    const masodik = alkalmazKezdolapSegitsegSorrend(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a kártyák előtti REJTETT blokk nem számít: a sín „már a helyén”, ha csak rejtett áll közte', () => {
    const elso = alkalmazKezdolapSegitsegSorrend(buildHomeLayout()).layout ?? []
    const rejtettKozte = [...elso]
    const cel = indexe(rejtettKozte, courseCards)
    rejtettKozte.splice(cel, 0, rejtve(buildHomeLayout()[0]))

    const eredmeny = alkalmazKezdolapSegitsegSorrend(rejtettKozte)
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR')
  })

  it.each([
    [
      'nincs sín',
      (layout: Szekciosor) => layout.filter((blokk) => !services(blokk)),
      'nincs látható',
    ],
    [
      'a sín címe más',
      (layout: Szekciosor) =>
        layout.map((blokk) =>
          blokk.blockType === 'services' ? { ...blokk, title: 'Miben segíthetünk?' } : blokk,
        ),
      'nincs látható',
    ],
    [
      'a sín rejtett',
      (layout: Szekciosor) => layout.map((b) => (services(b) ? rejtve(b) : b)),
      'nincs látható',
    ],
    [
      'nincs Kurzusaink',
      (layout: Szekciosor) =>
        layout.map((blokk) =>
          blokk.blockType === 'courseCards' ? { ...blokk, heading: 'Kurzusok' } : blokk,
        ),
      'nincs látható',
    ],
    [
      'két sín',
      (layout: Szekciosor) => [...layout, layout.find(services) as Szekcio],
      'több látható',
    ],
  ])('%s: indokolt kihagyás, nem találgat', (_eset, atalakit, indok) => {
    const eredmeny = alkalmazKezdolapSegitsegSorrend(atalakit(buildHomeLayout()))

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain(indok)
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('üres szekciósornál indokolt kihagyás; a bemenetet nem módosítja helyben', () => {
    for (const layout of [undefined, null, [] as Szekciosor]) {
      const ures = alkalmazKezdolapSegitsegSorrend(layout)
      expect(ures.layout).toBeNull()
      expect(ures.kihagyasok[0].indok).toContain('nincs szekciósora')
    }
    const bemenet = buildHomeLayout()
    const lenyomat = stabilJson(bemenet)
    alkalmazKezdolapSegitsegSorrend(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// WP52/2b — a sajtó-logósor a bemutatkozás alá
// ===========================================================================

describe('alkalmazKezdolapSajtologoSorrend', () => {
  it('a sajtó-logósor ÖNÁLLÓ pressLogos blokk a seedben (nem az About mezője)', () => {
    const layout = buildHomeLayout()
    expect(layout.filter((blokk) => blokk.blockType === 'pressLogos')).toHaveLength(1)
    const rolunk = layout.find(about)
    expect(rolunk !== undefined && 'logos' in rolunk).toBe(false)
  })

  it('a seed-sorrendben a logósor az About ELŐTT áll — a szabály közvetlenül mögé viszi', () => {
    const kiindulas = buildHomeLayout()
    expect(indexe(kiindulas, sajto)).toBeLessThan(indexe(kiindulas, about))

    const eredmeny = alkalmazKezdolapSajtologoSorrend(kiindulas)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('kezdolap-sajtologo-sorrend')
    const uj = eredmeny.layout ?? []
    expect(uj).toHaveLength(kiindulas.length)
    expect(indexe(uj, about) + 1).toBe(indexe(uj, sajto))
    // A logók (média-id-k) változatlanul, ugyanabban a blokk-objektumban mennek tovább.
    expect(uj[indexe(uj, sajto)]).toBe(kiindulas[indexe(kiindulas, sajto)])
  })

  it('ÜRES feliratú logósort is felismer (a komponens beépített felirata ugyanaz)', () => {
    const kiindulas = buildHomeLayout().map((blokk) =>
      blokk.blockType === 'pressLogos' ? { ...blokk, heading: '' } : blokk,
    )
    const eredmeny = alkalmazKezdolapSajtologoSorrend(kiindulas)
    const uj = eredmeny.layout ?? []
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(uj[indexe(uj, about) + 1]?.blockType).toBe('pressLogos')
  })

  it('idempotens: második futásban nincs módosítás', () => {
    const elso = alkalmazKezdolapSajtologoSorrend(buildHomeLayout())
    const masodik = alkalmazKezdolapSajtologoSorrend(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a REJTETT (WP18-as duplikált) About nem horgony; a szerkesztői feliratú logósorhoz nem nyúl', () => {
    const alap = buildHomeLayout()
    const rejtettDuplikatum: Szekciosor = [rejtve(alap.find(about) as Szekcio), ...alap]
    const eredmeny = alkalmazKezdolapSajtologoSorrend(rejtettDuplikatum)
    const uj = eredmeny.layout ?? []
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(uj[0]?.sectionSettings?.visible).toBe(false)
    const lathatoAbout = indexe(
      uj,
      (blokk) => about(blokk) && blokk.sectionSettings?.visible !== false,
    )
    expect(lathatoAbout).toBeGreaterThan(0)
    expect(uj[lathatoAbout + 1]?.blockType).toBe('pressLogos')

    const sajat = alap.map((blokk) =>
      blokk.blockType === 'pressLogos' ? { ...blokk, heading: 'Rólunk írták' } : blokk,
    )
    const kihagyas = alkalmazKezdolapSajtologoSorrend(sajat)
    expect(kihagyas.layout).toBeNull()
    expect(kihagyas.kihagyasok[0].indok).toContain('nincs látható')
  })
})

// ===========================================================================
// WP52/3 — a bemutatkozás rövidítése
// ===========================================================================

describe('KEZDOLAP_BEMUTATKOZAS_ROVID — a rövidített szöveg mért tulajdonságai', () => {
  const szavak = (szoveg: string): string[] => szoveg.split(/\s+/).filter(Boolean)
  const mondatok = (szoveg: string): string[] => szoveg.split(/(?<=[.!?])\s+/).filter(Boolean)
  const normalizalt = (szoveg: string): string[] =>
    szoveg
      .toLowerCase()
      .replace(/[.,:;!?()„”"]/g, '')
      .split(/\s+/)
      .filter(Boolean)
  const nGramok = (szoveg: string, n: number): Set<string> => {
    const w = normalizalt(szoveg)
    const halmaz = new Set<string>()
    for (let i = 0; i + n <= w.length; i += 1) halmaz.add(w.slice(i, i + n).join(' '))
    return halmaz
  }
  const regi = KEZDOLAP_BEMUTATKOZAS.join(' ')
  const uj = KEZDOLAP_BEMUTATKOZAS_ROVID.join(' ')

  it('legalább 33 %-kal rövidebb karakterben, és rövidebb szóban is', () => {
    expect(uj.length).toBeLessThanOrEqual(regi.length * 0.67)
    expect(szavak(uj).length).toBeLessThan(szavak(regi).length)
  })

  it('megtartja a tényeket: nevek, kézre szakosodás, tíz év, Budapest, Pécs, Semmelweis, képzés, otthoni kurzus', () => {
    for (const teny of [
      'Kocsis Kata',
      'Kiss Kata',
      'gyógytornász',
      'kéz',
      'tíz éve',
      'budapesti',
      'Pécsi Tudományegyetem',
      'Semmelweis Egyetem',
      'képzésünk oktatója',
      'videókurzus',
    ]) {
      expect(uj).toContain(teny)
    }
  })

  it('natív magyar: nincs gondolatjel, minden mondat 25 szó alatt, bekezdésenként legfeljebb 5 mondat', () => {
    expect(uj).not.toMatch(/[–—]/)
    for (const bekezdes of KEZDOLAP_BEMUTATKOZAS_ROVID) {
      expect(mondatok(bekezdes).length).toBeLessThanOrEqual(5)
      for (const mondat of mondatok(bekezdes)) {
        expect(szavak(mondat).length).toBeLessThan(25)
      }
    }
  })

  it('a Rólunk-bemutatkozással nincs közös hatszavas szókapcsolat (WP37 őr)', () => {
    const rolunk = [ROLUNK_BEMUTATKOZAS_CIM, ...ROLUNK_BEMUTATKOZAS].join(' ')
    const kozos = [...nGramok(uj, 6)].filter((g) => nGramok(rolunk, 6).has(g))
    expect(kozos).toEqual([])
  })
})

describe('alkalmazKezdolapBemutatkozasRovidites', () => {
  it('a mai (KEZDOLAP_BEMUTATKOZAS) bekezdéseket cseréli; cím, kiemelés, számok, fotó változatlan', () => {
    const kiindulas = buildHomeLayout()
    const regi = kiindulas.find(about)
    expect(regi?.blockType === 'about' ? regi.paragraphs?.map((p) => p.text) : null).toEqual(
      KEZDOLAP_BEMUTATKOZAS,
    )

    const eredmeny = alkalmazKezdolapBemutatkozasRovidites(kiindulas)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('kezdolap-bemutatkozas-rovid')
    const uj = (eredmeny.layout ?? []).find(about)
    if (uj?.blockType !== 'about' || regi?.blockType !== 'about') throw new Error('nincs About')
    expect(uj.paragraphs?.map((p) => p.text)).toEqual(KEZDOLAP_BEMUTATKOZAS_ROVID)
    expect(uj.paragraphs?.map((p) => p.emphasized)).toEqual([true, false, false])
    expect(uj.title).toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    expect(uj.feature).toEqual(KEZDOLAP_BEMUTATKOZAS_KIEMELES)
    expect(uj.stats).toBe(regi.stats)
    expect(uj.photo).toBe(regi.photo)
    expect(uj.sectionSettings).toBe(regi.sectionSettings)
  })

  it('idempotens: a rövid szöveget csendben kihagyja', () => {
    const elso = alkalmazKezdolapBemutatkozasRovidites(buildHomeLayout())
    const masodik = alkalmazKezdolapBemutatkozasRovidites(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  const szerkesztettEsetek: [string, (blokk: Szekcio) => Szekcio, string][] = [
    [
      'egy bekezdés szerkesztve',
      (blokk) =>
        blokk.blockType === 'about'
          ? {
              ...blokk,
              paragraphs: (blokk.paragraphs ?? []).map((p, i) =>
                i === 1 ? { ...p, text: `${p.text} Saját mondat.` } : p,
              ),
            }
          : blokk,
      'nem PONTOSAN',
    ],
    [
      'más cím',
      (blokk) => (blokk.blockType === 'about' ? { ...blokk, title: 'Rólunk' } : blokk),
      'nem PONTOSAN',
    ],
  ]

  it.each(szerkesztettEsetek)('a szerkesztő szövegéhez (%s) nem nyúl', (_eset, atalakit, indok) => {
    const eredmeny = alkalmazKezdolapBemutatkozasRovidites(buildHomeLayout().map(atalakit))

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain(indok)
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('rejtett About-blokkhoz nem nyúl; About nélkül és üres szekciósornál indokolt kihagyás', () => {
    const rejtett = buildHomeLayout().map((blokk) => (about(blokk) ? rejtve(blokk) : blokk))
    expect(alkalmazKezdolapBemutatkozasRovidites(rejtett).layout).toBeNull()
    const nelkule = buildHomeLayout().filter((blokk) => !about(blokk))
    expect(alkalmazKezdolapBemutatkozasRovidites(nelkule).kihagyasok[0].indok).toContain(
      'nincs látható',
    )
    for (const layout of [undefined, null, [] as Szekciosor]) {
      expect(alkalmazKezdolapBemutatkozasRovidites(layout).kihagyasok[0].indok).toContain(
        'nincs szekciósora',
      )
    }
  })
})

// ===========================================================================
// WP52/4 — a /rolunk partner-mondat és a két logósáv
// ===========================================================================

/** A /rolunk seed-szekciósora mindkét logósávval (a logók futásidejű média-id-k). */
const rolunkLayout = (): Szekciosor =>
  buildRolunkLayout({ sajtoLogok: [11, 12], partnerLogok: [21, 22, 23] })

describe('richTextBekezdesek', () => {
  it('csak a tisztán szöveges bekezdésekből álló tartalmat értelmezi', () => {
    const csakSzoveg: Szekcio = {
      blockType: 'richText',
      content: richText([para('Első.'), para('Második.')]),
    }
    expect(richTextBekezdesek(csakSzoveg)).toEqual(['Első.', 'Második.'])
    const cimsorral: Szekcio = {
      blockType: 'richText',
      content: richText([
        {
          type: 'heading',
          tag: 'h2',
          children: [{ type: 'text', text: 'Cím', version: 1 }],
          version: 1,
        },
        para('Szöveg.'),
      ]),
    }
    expect(richTextBekezdesek(cimsorral)).toBeNull()
    expect(richTextBekezdesek(rolunkLayout()[0])).toBeNull()
  })
})

describe('alkalmazRolunkPartnerMondat', () => {
  it('a „Partnereink” alatti mondat blokkját törli, és a törölt szöveget betűhíven naplózza', () => {
    const kiindulas = rolunkLayout()
    const partnerIndex = indexe(kiindulas, partner)
    expect(partnerMondat(kiindulas[partnerIndex + 1])).toBe(true)

    const eredmeny = alkalmazRolunkPartnerMondat(kiindulas)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('rolunk-partner-mondat')
    expect(eredmeny.modositasok[0].uzenet).toContain(ROLUNK_TOVABBI_PARTNEREK)
    const uj = eredmeny.layout ?? []
    expect(uj).toHaveLength(kiindulas.length - 1)
    expect(uj.some(partnerMondat)).toBe(false)
    expect(uj).toEqual(kiindulas.filter((blokk) => !partnerMondat(blokk)))
  })

  it('idempotens: törlés után indokolt, nem hangos kihagyás', () => {
    const elso = alkalmazRolunkPartnerMondat(rolunkLayout())
    const masodik = alkalmazRolunkPartnerMondat(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('már törölve')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a szerkesztett vagy bővített mondathoz nem nyúl', () => {
    const szerkesztett = rolunkLayout().map((blokk) =>
      partnerMondat(blokk)
        ? { ...blokk, content: richText([para(`${ROLUNK_TOVABBI_PARTNEREK} És még valaki.`)]) }
        : blokk,
    )
    expect(alkalmazRolunkPartnerMondat(szerkesztett).layout).toBeNull()

    const bovitett = rolunkLayout().map((blokk) =>
      partnerMondat(blokk)
        ? { ...blokk, content: richText([para(ROLUNK_TOVABBI_PARTNEREK), para('Új sor.')]) }
        : blokk,
    )
    expect(alkalmazRolunkPartnerMondat(bovitett).layout).toBeNull()
  })
})

describe('alkalmazRolunkLogosavokSorrend', () => {
  const mondatNelkul = (): Szekciosor => alkalmazRolunkPartnerMondat(rolunkLayout()).layout ?? []

  it('a mondat törlése után a két sáv helyet cserél: „Partnereink” előre, a sajtó-logósor a helyére', () => {
    const kiindulas = mondatNelkul()
    const sajtoIndex = indexe(kiindulas, sajto)
    const partnerIndex = indexe(kiindulas, partner)
    expect(sajtoIndex).toBeLessThan(partnerIndex)

    const eredmeny = alkalmazRolunkLogosavokSorrend(kiindulas)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('rolunk-logosavok-sorrend')
    const uj = eredmeny.layout ?? []
    expect(uj).toHaveLength(kiindulas.length)
    expect(uj[sajtoIndex]).toBe(kiindulas[partnerIndex])
    expect(uj[partnerIndex]).toBe(kiindulas[sajtoIndex])
    uj.forEach((blokk, index) => {
      if (index !== sajtoIndex && index !== partnerIndex) expect(blokk).toBe(kiindulas[index])
    })
  })

  it('idempotens: a csere után nem forgatja vissza', () => {
    const elso = alkalmazRolunkLogosavokSorrend(mondatNelkul())
    const masodik = alkalmazRolunkLogosavokSorrend(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('amíg a partner-mondat a sáv alatt áll, a csere HANGOSAN kimarad', () => {
    const eredmeny = alkalmazRolunkLogosavokSorrend(rolunkLayout())

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('partner-mondat')
  })

  it('hiányzó vagy duplikált sáv esetén indokolt kihagyás', () => {
    const partnerNelkul = mondatNelkul().filter((blokk) => !partner(blokk))
    expect(alkalmazRolunkLogosavokSorrend(partnerNelkul).kihagyasok[0].indok).toContain(
      'nincs látható',
    )
    const sajtoNelkul = buildRolunkLayout({ partnerLogok: [21] })
    const mondatNelkulSajtoNelkul = alkalmazRolunkPartnerMondat(sajtoNelkul).layout ?? []
    expect(alkalmazRolunkLogosavokSorrend(mondatNelkulSajtoNelkul).kihagyasok[0].indok).toContain(
      'nincs látható',
    )
    const ketPartner = [...mondatNelkul(), mondatNelkul().find(partner) as Szekcio]
    expect(alkalmazRolunkLogosavokSorrend(ketPartner).kihagyasok[0].indok).toContain('több látható')
    for (const layout of [undefined, null, [] as Szekciosor]) {
      expect(alkalmazRolunkLogosavokSorrend(layout).kihagyasok[0].indok).toContain(
        'nincs szekciósora',
      )
    }
  })
})

// ===========================================================================
// Láncok — a futtató sorrendjében, adatbázis nélkül
// ===========================================================================

describe('a kezdőlapi lánc a WP52-es szabályokkal', () => {
  const lanc = (
    kiindulas: Szekciosor,
  ): { layout: Szekciosor; modositasok: JavitasLepes[]; kihagyasok: JavitasLepes[] } => {
    const modositasok: JavitasLepes[] = []
    const kihagyasok: JavitasLepes[] = []
    const alap = alkalmazKezdolapJavitasok(kiindulas)
    modositasok.push(...alap.modositasok)
    kihagyasok.push(...alap.kihagyasok)
    let layout = alap.layout
    const lepes = (eredmeny: {
      layout: Szekciosor | null
      modositasok: JavitasLepes[]
      kihagyasok: JavitasLepes[]
    }) => {
      modositasok.push(...eredmeny.modositasok)
      kihagyasok.push(...eredmeny.kihagyasok)
      if (eredmeny.layout !== null) layout = eredmeny.layout
    }
    // A futtató (futtat) sorrendje.
    lepes(alkalmazPressLogosFejlec({ layout, ujFejlec: pressLogosUjFejlec() }))
    lepes(alkalmazAllapotokBevezeto({ layout, ujBevezeto: allapotokUjBevezeto() }))
    lepes(alkalmazAllapotokNyitottIge({ layout, ujSzoveg: allapotokUjNyitottSzoveg() }))
    lepes(alkalmazKezdolapRolunkSzoveg({ layout, ujSzoveg: kezdolapRolunkUjSzoveg() }))
    lepes(alkalmazBemutatkozasSzetvalasztas({ lap: 'kezdolap', layout }))
    lepes(alkalmazZaroCta({ layout, seedBlokk: zaroCtaSeedBlokk() }))
    lepes(alkalmazKurzuslistaFeliratok(layout))
    lepes(alkalmazHowItWorksGondolatjel(layout))
    lepes(alkalmazKezdolapBemutatkozasRovidites(layout))
    lepes(alkalmazKezdolapSegitsegSorrend(layout))
    lepes(alkalmazKezdolapSajtologoSorrend(layout))
    return { layout, modositasok, kihagyasok }
  }

  it('a seed-alakból egy futásban: rövid bemutatkozás, sín a kártyák előtt, logósor az About alatt', () => {
    const elso = lanc(buildHomeLayout())

    expect(elso.modositasok.map((lepes) => lepes.szabaly)).toEqual([
      'kezdolap-bemutatkozas-rovid',
      'kezdolap-segitseg-sorrend',
      'kezdolap-sajtologo-sorrend',
    ])
    const uj = elso.layout
    expect(indexe(uj, services) + 1).toBe(indexe(uj, courseCards))
    expect(indexe(uj, about) + 1).toBe(indexe(uj, sajto))
    const rolunk = uj.find(about)
    expect(rolunk?.blockType === 'about' ? rolunk.paragraphs?.map((p) => p.text) : null).toEqual(
      KEZDOLAP_BEMUTATKOZAS_ROVID,
    )
    expect(tipusok(uj).sort()).toEqual(tipusok(buildHomeLayout()).sort())
  })

  it('a MÁSODIK futás semmit nem módosít, és egyetlen hangos kihagyás sincs', () => {
    const elso = lanc(buildHomeLayout())
    const masodik = lanc(elso.layout)

    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.layout).toEqual(elso.layout)
    for (const kihagyas of masodik.kihagyasok) {
      expect(kihagyas.indok).not.toBeNull()
      expect(kihagyas.hangos).not.toBe(true)
    }
  })
})

describe('a /rolunk lánc a WP52-es szabályokkal', () => {
  const lanc = (kiindulas: Szekciosor) => {
    const mondat = alkalmazRolunkPartnerMondat(kiindulas)
    const sorrend = alkalmazRolunkLogosavokSorrend(mondat.layout ?? kiindulas)
    return {
      layout: sorrend.layout ?? mondat.layout ?? kiindulas,
      modositasok: [...mondat.modositasok, ...sorrend.modositasok],
      kihagyasok: [...mondat.kihagyasok, ...sorrend.kihagyasok],
    }
  }

  it('előbb a mondat törlése, aztán a csere — egy futásban mindkettő', () => {
    const kiindulas = rolunkLayout()
    const elso = lanc(kiindulas)

    expect(elso.modositasok.map((lepes) => lepes.szabaly)).toEqual([
      'rolunk-partner-mondat',
      'rolunk-logosavok-sorrend',
    ])
    expect(elso.layout.some(partnerMondat)).toBe(false)
    expect(indexe(elso.layout, partner)).toBe(indexe(kiindulas, sajto))
    expect(indexe(elso.layout, sajto)).toBe(indexe(kiindulas, partner))
  })

  it('a MÁSODIK futás semmit nem módosít, hangos kihagyás nélkül', () => {
    const elso = lanc(rolunkLayout())
    const masodik = lanc(elso.layout)

    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.layout).toEqual(elso.layout)
    for (const kihagyas of masodik.kihagyasok) expect(kihagyas.hangos).not.toBe(true)
  })
})
