import { describe, expect, it } from 'vitest'

import {
  ASZF_HELYKITOLTO_BEKEZDES,
  ASZF_JAVITOTT_BEKEZDES,
  KURZUSLISTA_JOVAHAGYOTT_FELIRAT,
  KURZUS_ELONYOK,
  REGI_ALLAPOTOK_BEVEZETO,
  REGI_NYITOTT_KARTYA,
  REGI_KEZDOLAP_ROLUNK_CIM,
  REGI_KURZUS_SZEKCIO_CIM,
  REGI_PACIENS_ERTEK,
  REGI_PRESS_FEJLEC,
  SOS_KURZUS_SLUG,
  SZAKMAI_HATTER_HORGONY,
  SZOLGALTATASOK_HERO_FORRAS,
  SZOLGALTATASOK_HERO_PREFIX,
  UJ_KURZUS_SZEKCIO_CIM,
  UJ_PACIENS_ERTEK,
  alkalmazAllapotokBevezeto,
  alkalmazAllapotokNyitottIge,
  alkalmazAszfAdatvedelemLink,
  alkalmazJogiOldalak,
  alkalmazKapcsolatSzakemberek,
  alkalmazKezdolapJavitasok,
  alkalmazBemutatkozasSzetvalasztas,
  alkalmazKezdolapRolunkSzoveg,
  alkalmazKurzuslistaFeliratok,
  alkalmazKurzusElonyok,
  alkalmazHowItWorksGondolatjel,
  alkalmazKurzusLeadGondolatjel,
  alkalmazPressLogosFejlec,
  alkalmazRendeloiHorgony,
  alkalmazRolunkHeroKep,
  ROLUNK_HERO_FORRAS,
  alkalmazSosIngyenesJelolo,
  alkalmazSosKurzusSlug,
  alkalmazSosPublikalas,
  alkalmazSzakmaiHarmonika,
  alkalmazSzolgaltatasokBevezeto,
  alkalmazSzolgaltatasokHeroKep,
  alkalmazZaroCta,
  allapotokUjBevezeto,
  allapotokUjNyitottSzoveg,
  heroKepAzonosito,
  kapcsolatSeedBlokkok,
  kezdolapRolunkUjSzoveg,
  pressLogosUjFejlec,
  rolunkSzakmaiUjBlokkok,
  stabilJson,
  szolgaltatasokUjBevezetoBlokk,
  zaroCtaSeedBlokk,
  type JavitasLepes,
} from '../scripts/apply-owner-content'
import { buildHomeLayout } from '../lib/home-seed'
import {
  KEZDOLAP_BEMUTATKOZAS,
  KEZDOLAP_BEMUTATKOZAS_CIM,
  ROLUNK_BEMUTATKOZAS,
  ROLUNK_BEMUTATKOZAS_CIM,
  ROLUNK_BEMUTATKOZAS_KIEMELES,
  WP18_KOZOS_BEMUTATKOZAS,
  ROLUNK_BEMUTATKOZAS_V1,
} from '../lib/rolunk-bemutatkozas'
import {
  COURSE_SHORT_DESCRIPTION_FIXED,
  COURSE_SHORT_DESCRIPTION_LEFTOVER,
  HOW_IT_WORKS_STEP1_FIXED,
  HOW_IT_WORKS_STEP1_LEFTOVER,
} from '../lib/gondolatjel-leftover'
import {
  buildKapcsolatLayout,
  buildSzolgaltatasokLayout,
  heading,
  para,
  richText,
  rolunkSzakmaiOrokoltTartalom,
  SZAKMAI_HATTER_URL,
  szolgaltatasokRegiBevezetoTartalom,
} from '../scripts/restore-legacy-content'
import { DEFAULT_HEADING as PRESS_ALAPFELIRAT } from '../components/blocks/PressLogos'
import { buildCourseSlug } from '../lib/course-url'
import { coursePriceBadgeKind } from '../lib/courses'
import { CTA_VOCABULARY } from '../lib/cta-vocabulary'
import { JOGI_OLDALAK, jogiOldalTartalom, richTextSzoveg } from '../lib/legal-content'
import { buildRolunkLayout } from '../scripts/restore-legacy-content'
import { CLINIC_TREATMENTS_ANCHOR, CLINIC_TREATMENTS_PATH, SOS_COURSE_SKU } from '../lib/menu-seed'
import type { Media, Page, Product } from '../payload-types'

/**
 * A tulajdonos által jóváhagyott, egyszeri tartalom-javítások TISZTA
 * átalakításai (src/scripts/apply-owner-content.ts).
 *
 * A teszt kizárólag memóriabeli fixtúrákon dolgozik: sem adatbázis-, sem
 * hálózati hívás nincs benne (CLAUDE.md 15. üzemeltetési tanulság) — a script
 * futtató része szándékosan csak közvetlen indításkor fut le, az importálás
 * mellékhatásmentes.
 *
 * A mért tulajdonságok:
 *  (a) a szekció-cím CSAK pontos egyezésnél cserélődik,
 *  (b) az „5000+” CSAK pontos egyezésnél és CSAK a statisztika-értékben,
 *  (c) az előny-sorok CSAK üres mezőbe kerülnek be,
 *  (d) a /rolunk fejléc-képe CSAK a szóló portréról cserélődik, és a páros
 *      csapatfotó hiányában hangosan kimarad,
 *  (e) idempotencia: kétszer futtatva ugyanaz a tartalom jön ki,
 *  (f) a 9–12. javítás ÚJ értékei a seed-builderekből jönnek (nem külön
 *      literálból), és minden „szerkesztő átírta” eset csendes kihagyás.
 */

type Szekciosor = NonNullable<Page['layout']>
type Szekcio = Szekciosor[number]

/** Kurzuskártya-szekció a megadott címmel (a `heading` szándékosan felülírható `null`-ra). */
const kurzusSzekcio = (heading: string | null): Szekcio => ({
  blockType: 'courseCards',
  id: 'cc-1',
  heading,
  lead: 'Online kézrehabilitációs kurzusaink lépésről lépésre vezetnek végig.',
  sectionSettings: { visible: true, anchorId: 'kurzusok', hatter: 'feher' },
})

/** Rólunk-szekció a megadott statisztika-sorokkal. */
const rolunkSzekcio = (stats: { value: string; label: string }[]): Szekcio => ({
  blockType: 'about',
  id: 'ab-1',
  eyebrow: 'Rólunk',
  title: 'Kiss Kata és Kocsis Kata vagyunk',
  stats,
  sectionSettings: { visible: true, hatter: 'feher' },
})

/** Így működik-szekció a megadott első lépésszöveggel. */
const howItWorksSzekcio = (elsoLepes: string): Szekcio => ({
  blockType: 'howItWorks',
  id: 'hiw-1',
  title: 'Így működik az online kurzus',
  steps: [
    { id: 's1', title: 'Kiválasztod a kurzust', text: elsoLepes },
    { id: 's2', title: 'Azonnal hozzáférsz', text: 'A videós anyagokat a fiókodban éred el.' },
  ],
  sectionSettings: { visible: true, hatter: 'feher' },
})

/** Érintetlenül hagyandó szekció — a fixtúrákban a „többi blokk” képviselője. */
const heroSzekcio = (): Szekcio => ({
  blockType: 'filmHero',
  id: 'fh-1',
  // Az „5000+” itt SZÁNDÉKOSAN benne van: más mezőben állva sem cserélhető.
  title: `Hatékony módszerek ${REGI_PACIENS_ERTEK} elégedett páciens tapasztalatából`,
  lead: 'Professzionális, mégis emberközeli terápiás megoldások.',
  sectionSettings: { visible: true },
})

// ---------------------------------------------------------------------------
// (a) Kurzus-szekció címe — csak pontos egyezésnél
// ---------------------------------------------------------------------------

describe('alkalmazKezdolapJavitasok — kurzus-szekció címe', () => {
  it('pontos egyezésnél átírja a címet, és csak azt az egy blokkot cseréli le', () => {
    const hero = heroSzekcio()
    const layout: Szekciosor = [hero, kurzusSzekcio(REGI_KURZUS_SZEKCIO_CIM)]

    const eredmeny = alkalmazKezdolapJavitasok(layout)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('kurzus-szekcio-cim')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    const ujSzekcio = eredmeny.layout[1]
    expect(ujSzekcio.blockType === 'courseCards' ? ujSzekcio.heading : null).toBe(
      UJ_KURZUS_SZEKCIO_CIM,
    )
    // A többi szekció BITRE változatlan: ugyanaz az objektum-referencia.
    expect(eredmeny.layout[0]).toBe(hero)
    // A cserélt blokk minden más mezője is megmarad.
    expect(ujSzekcio.blockType === 'courseCards' ? ujSzekcio.sectionSettings : null).toEqual({
      visible: true,
      anchorId: 'kurzusok',
      hatter: 'feher',
    })
  })

  it.each([
    ['más cím', 'Kurzusaink'],
    ['üres szöveg', ''],
    ['körbeírt whitespace', ` ${REGI_KURZUS_SZEKCIO_CIM} `],
    ['kisbetűs változat', REGI_KURZUS_SZEKCIO_CIM.toLowerCase()],
    ['részlet', 'Így tudunk segíteni'],
  ])('nem nyúl hozzá (%s), és indokkal naplózza a kihagyást', (_eset, heading) => {
    const layout: Szekciosor = [kurzusSzekcio(heading)]

    const eredmeny = alkalmazKezdolapJavitasok(layout)

    expect(eredmeny.modositasok).toHaveLength(0)
    // A layout referenciája is változatlan, ha semmi nem módosult.
    expect(eredmeny.layout).toBe(layout)
    const kihagyas = eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'kurzus-szekcio-cim')
    expect(kihagyas?.indok).toContain('pontos egyezésnél')
  })

  it('hiányzó (null) címet sem tölt ki — az a beépített cím fallbackje', () => {
    const eredmeny = alkalmazKezdolapJavitasok([kurzusSzekcio(null)])

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(
      eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'kurzus-szekcio-cim')?.indok,
    ).toContain('nincs megadva')
  })

  it('kurzus-szekció nélküli szekciósornál indokolt kihagyást ad', () => {
    const eredmeny = alkalmazKezdolapJavitasok([heroSzekcio()])

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(
      eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'kurzus-szekcio-cim')?.indok,
    ).toContain('nincs Kurzuskártyák')
  })

  it('üres vagy hiányzó szekciósornál mindkét kezdőlapi javítást indokkal hagyja ki', () => {
    for (const layout of [undefined, null, [] as Szekciosor]) {
      const eredmeny = alkalmazKezdolapJavitasok(layout)

      expect(eredmeny.modositasok).toHaveLength(0)
      expect(eredmeny.layout).toEqual([])
      expect(eredmeny.kihagyasok.map((lepes) => lepes.szabaly)).toEqual([
        'kurzus-szekcio-cim',
        'paciens-szam',
      ])
      for (const kihagyas of eredmeny.kihagyasok) {
        expect(kihagyas.indok).toContain('nincs szekciósora')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Gondolatjel-maradék — „Így működik" + kurzuskártya-lead, csak pontos egyezés
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WP18 — a kezdőlapi Rólunk-blokk szövege a /rolunk lappal közös forrásra
// ---------------------------------------------------------------------------

describe('kezdolapRolunkUjSzoveg — a seed-builderből', () => {
  it('a kezdőlap seedje a KEZDŐLAPI, a /rolunk builder a RÓLUNK-bemutatkozást adja (WP37: két külön szöveg)', () => {
    const uj = kezdolapRolunkUjSzoveg()
    expect(uj).not.toBeNull()
    expect(uj?.title).toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    expect(uj?.paragraphs?.map((p) => p.text)).toEqual([...KEZDOLAP_BEMUTATKOZAS])
    expect(uj?.paragraphs?.map((p) => p.emphasized)).toEqual(
      KEZDOLAP_BEMUTATKOZAS.map((_, index) => index === 0),
    )
    const rolunk = buildRolunkLayout().find((blokk) => blokk.blockType === 'about')
    expect(rolunk?.blockType).toBe('about')
    if (rolunk?.blockType !== 'about') return
    expect(rolunk.title).toBe(ROLUNK_BEMUTATKOZAS_CIM)
    expect(rolunk.paragraphs?.map((p) => p.text)).toEqual([...ROLUNK_BEMUTATKOZAS])
    expect(rolunk.feature).toEqual({ ...ROLUNK_BEMUTATKOZAS_KIEMELES })
    // A két lap szövege nem ugyanaz, a kiemelés címkéje viszont közös.
    expect(rolunk.title).not.toBe(uj?.title)
    expect(rolunk.paragraphs).not.toEqual(uj?.paragraphs)
    expect(rolunk.feature?.label).toBe(uj?.feature?.label)
    // A régi cím már sehol nem seedelt (különben a csere önmagát ismételné).
    expect(uj?.title).not.toBe(REGI_KEZDOLAP_ROLUNK_CIM)
  })

  it('a bekezdésekben nincs töltelék gondolatjel (natív magyar)', () => {
    for (const text of [...KEZDOLAP_BEMUTATKOZAS, ...ROLUNK_BEMUTATKOZAS]) {
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe('alkalmazKezdolapRolunkSzoveg', () => {
  it('az élő „A Kineticare alapítói” című (fríz-es) blokkot is cseréli, és a későbbi, közös című duplikátumot elrejti', () => {
    const alapitok = { ...regiBlokk(), id: 'ab-founders', title: 'A Kineticare alapítói' }
    const kesobbi = { ...regiBlokk(), id: 'ab-late', title: REGI_KEZDOLAP_ROLUNK_CIM }
    const layout: Szekcio[] = [heroSzekcio(), alapitok, kurzusSzekcio('Kurzusaink'), kesobbi]
    const eredmeny = alkalmazKezdolapRolunkSzoveg({ layout, ujSzoveg: kezdolapRolunkUjSzoveg() })
    expect(eredmeny.modositasok).toHaveLength(3)
    const elso = eredmeny.layout?.[1]
    const masodik = eredmeny.layout?.[3]
    if (elso?.blockType !== 'about' || masodik?.blockType !== 'about') throw new Error('about')
    expect(elso.title).toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    expect(elso.sectionSettings?.visible).toBe(true)
    expect(masodik.title).toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    expect(masodik.sectionSettings?.visible).toBe(false)
    expect(masodik.sectionSettings?.hatter).toBe('feher')
    // Idempotens: második futásban nincs több módosítás.
    const ujra = alkalmazKezdolapRolunkSzoveg({
      layout: eredmeny.layout ?? [],
      ujSzoveg: kezdolapRolunkUjSzoveg(),
    })
    expect(ujra.modositasok).toHaveLength(0)
    expect(ujra.layout).toBeNull()
  })

  const regiBlokk = (): Extract<Szekcio, { blockType: 'about' }> => ({
    blockType: 'about',
    id: 'ab-1',
    eyebrow: 'Rólunk',
    title: REGI_KEZDOLAP_ROLUNK_CIM,
    sectionSettings: { visible: true, hatter: 'feher' },
    stats: [
      { value: '10+', label: 'év szakmai tapasztalat' },
      { value: '1000+', label: 'elégedett páciens' },
    ],
    paragraphs: [
      { id: 'p1', text: 'Kiss Kata és Kocsis Kata vagyunk, gyógytornászok.', emphasized: true },
      { id: 'p2', text: 'A kéz rehabilitációjával foglalkozunk.', emphasized: false },
    ],
    feature: { label: 'Személyre szabott kezelések', note: 'Minden terápiát személyre szabunk.' },
    photo: 42,
  })

  it('pontos címegyezésnél a címet, a bekezdéseket és a kiemelést cseréli; a számok, a fotó, az eyebrow és a beállítás marad', () => {
    const layout: Szekcio[] = [heroSzekcio(), regiBlokk(), kurzusSzekcio('Kurzusaink')]
    const eredmeny = alkalmazKezdolapRolunkSzoveg({ layout, ujSzoveg: kezdolapRolunkUjSzoveg() })
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0]?.szabaly).toBe('kezdolap-rolunk-szoveg')
    expect(eredmeny.layout).not.toBeNull()
    const about = eredmeny.layout?.[1]
    expect(about?.blockType).toBe('about')
    if (about?.blockType !== 'about') return
    expect(about.title).toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    expect(about.paragraphs?.map((p) => p.text)).toEqual([...KEZDOLAP_BEMUTATKOZAS])
    expect(about.paragraphs?.[0]?.emphasized).toBe(true)
    expect(about.paragraphs?.every((p) => !('id' in p))).toBe(true)
    expect(about.feature?.label).toBe('Szakmai egyesületi tagság')
    expect(about.stats).toEqual(regiBlokk().stats)
    expect(about.photo).toBe(42)
    expect(about.eyebrow).toBe('Rólunk')
    expect(about.id).toBe('ab-1')
    expect(about.sectionSettings).toEqual(regiBlokk().sectionSettings)
    // A többi blokk referencia-azonos.
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    expect(eredmeny.layout?.[2]).toBe(layout[2])
    // A bemenet érintetlen.
    expect((layout[1] as { title?: string | null }).title).toBe(REGI_KEZDOLAP_ROLUNK_CIM)
  })

  it('idempotens: a már cserélt blokkot csendben kihagyja', () => {
    const elso = alkalmazKezdolapRolunkSzoveg({
      layout: [regiBlokk()],
      ujSzoveg: kezdolapRolunkUjSzoveg(),
    })
    const masodik = alkalmazKezdolapRolunkSzoveg({
      layout: elso.layout,
      ujSzoveg: kezdolapRolunkUjSzoveg(),
    })
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
    expect(masodik.kihagyasok[0]?.hangos).toBeUndefined()
    expect(masodik.kihagyasok[0]?.indok).toContain('MÁR')
  })

  it('szerkesztett címnél nem ír, és indokkal naplóz', () => {
    const eredmeny = alkalmazKezdolapRolunkSzoveg({
      layout: [{ ...regiBlokk(), title: 'Mi vagyunk a Katák' }],
      ujSzoveg: kezdolapRolunkUjSzoveg(),
    })
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0]?.indok).toContain('nem PONTOSAN')
  })

  it('hiányzó seed-alak: hangos kihagyás; Rólunk nélküli vagy üres szekciósor: indokolt kihagyás', () => {
    const hangos = alkalmazKezdolapRolunkSzoveg({ layout: [regiBlokk()], ujSzoveg: null })
    expect(hangos.layout).toBeNull()
    expect(hangos.kihagyasok[0]?.hangos).toBe(true)
    const nincs = alkalmazKezdolapRolunkSzoveg({
      layout: [heroSzekcio()],
      ujSzoveg: kezdolapRolunkUjSzoveg(),
    })
    expect(nincs.layout).toBeNull()
    expect(nincs.kihagyasok[0]?.indok).toContain('nincs Rólunk')
    const ures = alkalmazKezdolapRolunkSzoveg({ layout: [], ujSzoveg: kezdolapRolunkUjSzoveg() })
    expect(ures.layout).toBeNull()
    expect(ures.modositasok).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// WP37 — a kezdőlapi és a /rolunk bemutatkozás szétválasztása
// ---------------------------------------------------------------------------

describe('alkalmazBemutatkozasSzetvalasztas', () => {
  const wp18Blokk = (extra: Partial<Extract<Szekcio, { blockType: 'about' }>> = {}) =>
    ({
      blockType: 'about',
      id: 'ab-wp18',
      eyebrow: 'Rólunk',
      title: WP18_KOZOS_BEMUTATKOZAS.title,
      sectionSettings: { visible: true, hatter: 'tint', anchorId: 'rolunk' },
      stats: [{ value: '2', label: 'szakmai egyesületi tagság' }],
      paragraphs: WP18_KOZOS_BEMUTATKOZAS.paragraphs.map((text, index) => ({
        id: `p${index}`,
        text,
        emphasized: index === 0,
      })),
      feature: {
        label: 'Szakmai egyesületi tagság',
        note: 'A Magyar Sportrehabilitációs Egyesület és a Magyar Gyógytornász-Fizioterapeuták Társaságának munkájában is részt veszünk.',
      },
      photo: 42,
      ...extra,
    }) satisfies Szekcio

  it('a mai élő (WP18) szöveggel PONTOSAN egyező blokkot a kezdőlapon a kezdőlapi szövegre cseréli, a cím marad', () => {
    const layout: Szekcio[] = [heroSzekcio(), wp18Blokk(), kurzusSzekcio('Kurzusaink')]
    const eredmeny = alkalmazBemutatkozasSzetvalasztas({ lap: 'kezdolap', layout })
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0]?.szabaly).toBe('bemutatkozas-szetvalasztas')
    const about = eredmeny.layout?.[1]
    if (about?.blockType !== 'about') throw new Error('about')
    expect(about.title).toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    expect(about.title).toBe(WP18_KOZOS_BEMUTATKOZAS.title)
    expect(about.paragraphs?.map((p) => p.text)).toEqual([...KEZDOLAP_BEMUTATKOZAS])
    expect(about.paragraphs?.[0]?.emphasized).toBe(true)
    expect(about.paragraphs?.every((p) => !('id' in p))).toBe(true)
    expect(about.feature?.label).toBe('Szakmai egyesületi tagság')
    expect(about.stats).toEqual(wp18Blokk().stats)
    expect(about.photo).toBe(42)
    expect(about.id).toBe('ab-wp18')
    expect(about.sectionSettings).toEqual(wp18Blokk().sectionSettings)
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    expect(eredmeny.layout?.[2]).toBe(layout[2])
    expect((layout[1] as { paragraphs?: unknown[] }).paragraphs).toHaveLength(2)
  })

  it('a /rolunk lapon a Rólunk-szövegre ÉS az új címre cseréli, a bővebb egyesületi jegyzettel', () => {
    const eredmeny = alkalmazBemutatkozasSzetvalasztas({ lap: 'rolunk', layout: [wp18Blokk()] })
    expect(eredmeny.modositasok).toHaveLength(1)
    const about = eredmeny.layout?.[0]
    if (about?.blockType !== 'about') throw new Error('about')
    expect(about.title).toBe(ROLUNK_BEMUTATKOZAS_CIM)
    expect(about.paragraphs?.map((p) => p.text)).toEqual([...ROLUNK_BEMUTATKOZAS])
    expect(about.feature).toEqual({ ...ROLUNK_BEMUTATKOZAS_KIEMELES })
    expect(about.sectionSettings?.anchorId).toBe('rolunk')
  })

  it('a /rolunk első éles változatát (V1, Semmelweis-mondat nélkül) is a mai Rólunk-szövegre cseréli; a kezdőlapon nem', () => {
    const v1Blokk = wp18Blokk({
      title: ROLUNK_BEMUTATKOZAS_V1.title,
      paragraphs: ROLUNK_BEMUTATKOZAS_V1.paragraphs.map((text, index) => ({
        id: `v${index}`,
        text,
        emphasized: index === 0,
      })),
    })
    const rolunk = alkalmazBemutatkozasSzetvalasztas({ lap: 'rolunk', layout: [v1Blokk] })
    expect(rolunk.modositasok).toHaveLength(1)
    const about = rolunk.layout?.[0]
    if (about?.blockType !== 'about') throw new Error('about')
    expect(about.paragraphs?.map((p) => p.text)).toEqual([...ROLUNK_BEMUTATKOZAS])
    expect(about.paragraphs?.[1]?.text).toContain('a jövő gyógytornászai')
    const kezdolap = alkalmazBemutatkozasSzetvalasztas({ lap: 'kezdolap', layout: [v1Blokk] })
    expect(kezdolap.modositasok).toHaveLength(0)
    expect(kezdolap.layout).toBeNull()
  })

  it('idempotens: a második futásban nincs módosítás, és nem ír', () => {
    for (const lap of ['kezdolap', 'rolunk'] as const) {
      const elso = alkalmazBemutatkozasSzetvalasztas({ lap, layout: [wp18Blokk()] })
      const masodik = alkalmazBemutatkozasSzetvalasztas({ lap, layout: elso.layout ?? [] })
      expect(masodik.modositasok).toHaveLength(0)
      expect(masodik.layout).toBeNull()
      expect(masodik.kihagyasok[0]?.indok).toContain('MÁR')
    }
  })

  it('szerkesztett címnél vagy bekezdésnél nem ír, és indokkal naplóz', () => {
    const cim = alkalmazBemutatkozasSzetvalasztas({
      lap: 'rolunk',
      layout: [wp18Blokk({ title: 'Saját cím' })],
    })
    expect(cim.layout).toBeNull()
    expect(cim.kihagyasok[0]?.indok).toContain('nem PONTOSAN')
    const bekezdes = alkalmazBemutatkozasSzetvalasztas({
      lap: 'kezdolap',
      layout: [
        wp18Blokk({
          paragraphs: [{ text: WP18_KOZOS_BEMUTATKOZAS.paragraphs[0] ?? '', emphasized: true }],
        }),
      ],
    })
    expect(bekezdes.layout).toBeNull()
    expect(bekezdes.modositasok).toHaveLength(0)
  })

  it('a kezdőlapi címmel, de a kezdőlapi szöveggel álló blokkot a /rolunk lapon sem cseréli', () => {
    const kezdolapi = alkalmazBemutatkozasSzetvalasztas({ lap: 'kezdolap', layout: [wp18Blokk()] })
    const rolunkon = alkalmazBemutatkozasSzetvalasztas({
      lap: 'rolunk',
      layout: kezdolapi.layout ?? [],
    })
    expect(rolunkon.layout).toBeNull()
  })

  it('rejtett About-blokkhoz nem nyúl; About nélküli vagy üres szekciósor indokolt kihagyás', () => {
    const rejtett = alkalmazBemutatkozasSzetvalasztas({
      lap: 'kezdolap',
      layout: [wp18Blokk({ sectionSettings: { visible: false, hatter: 'feher' } })],
    })
    expect(rejtett.layout).toBeNull()
    expect(rejtett.kihagyasok[0]?.indok).toContain('nincs látható')
    for (const layout of [undefined, null, [] as Szekciosor]) {
      const ures = alkalmazBemutatkozasSzetvalasztas({ lap: 'rolunk', layout })
      expect(ures.layout).toBeNull()
      expect(ures.kihagyasok[0]?.indok).toContain('nincs szekciósora')
    }
    const nincs = alkalmazBemutatkozasSzetvalasztas({ lap: 'rolunk', layout: [heroSzekcio()] })
    expect(nincs.kihagyasok[0]?.indok).toContain('nincs látható')
  })
})

describe('alkalmazHowItWorksGondolatjel', () => {
  it('pontos egyezésnél a vásárlás-lépés U+2014-ét vesszőre cseréli, a többi lépést nem', () => {
    const masodik = {
      id: 's2',
      title: 'Azonnal hozzáférsz',
      text: 'A videós anyagokat a fiókodban éred el.',
    }
    const layout: Szekciosor = [
      heroSzekcio(),
      {
        blockType: 'howItWorks',
        id: 'hiw-1',
        title: 'Így működik az online kurzus',
        steps: [
          { id: 's1', title: 'Kiválasztod a kurzust', text: HOW_IT_WORKS_STEP1_LEFTOVER },
          masodik,
        ],
        sectionSettings: { visible: true, hatter: 'feher' },
      },
    ]

    const eredmeny = alkalmazHowItWorksGondolatjel(layout)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('howitworks-vasarlas-gondolatjel')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    const how = eredmeny.layout?.[1]
    expect(how?.blockType === 'howItWorks' ? how.steps?.[0]?.text : null).toBe(
      HOW_IT_WORKS_STEP1_FIXED,
    )
    expect(how?.blockType === 'howItWorks' ? how.steps?.[1] : null).toBe(masodik)
  })

  it('a már javított mondatot és a más szöveget nem nyúlja', () => {
    const javitott = alkalmazHowItWorksGondolatjel([howItWorksSzekcio(HOW_IT_WORKS_STEP1_FIXED)])
    expect(javitott.layout).toBeNull()
    expect(javitott.modositasok).toHaveLength(0)
    expect(javitott.kihagyasok[0]?.indok).toContain('MÁR')

    const idegen = alkalmazHowItWorksGondolatjel([howItWorksSzekcio('Saját szerkesztői szöveg.')])
    expect(idegen.layout).toBeNull()
    expect(idegen.kihagyasok[0]?.indok).toContain('pontos egyezésnél')
  })

  it('hiányzó howItWorks szekciónál indokolt kihagyást ad', () => {
    const eredmeny = alkalmazHowItWorksGondolatjel([heroSzekcio()])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0]?.indok).toContain('howItWorks')
  })
})

describe('alkalmazKurzusLeadGondolatjel', () => {
  it('pontos egyezésnél az U+2013-at vesszőre cseréli, a csukló- kötőjelet meghagyja', () => {
    const eredmeny = alkalmazKurzusLeadGondolatjel(COURSE_SHORT_DESCRIPTION_LEFTOVER)

    expect(eredmeny.shortDescription).toBe(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(eredmeny.shortDescription).toContain('csukló-, ujj-')
    expect(eredmeny.shortDescription).not.toMatch(/[–—]/)
    expect(eredmeny.modositasok[0]?.szabaly).toBe('kurzus-lead-gondolatjel')
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('a már javított és a más leírást nem nyúlja', () => {
    const mar = alkalmazKurzusLeadGondolatjel(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(mar.shortDescription).toBeNull()
    expect(mar.kihagyasok[0]?.indok).toContain('MÁR')

    const idegen = alkalmazKurzusLeadGondolatjel('Otthon végezhető program.')
    expect(idegen.shortDescription).toBeNull()
    expect(idegen.kihagyasok[0]?.indok).toContain('pontos egyezésnél')
  })
})

// ---------------------------------------------------------------------------
// (b) Páciensszám — csak pontos egyezésnél és csak a megfelelő mezőben
// ---------------------------------------------------------------------------

describe('alkalmazKezdolapJavitasok — páciensszám', () => {
  it('a statisztika ÉRTÉKÉT cseréli, a többi statisztika-sort érintetlenül hagyja', () => {
    const layout: Szekciosor = [
      rolunkSzekcio([
        { value: '10+', label: 'év szakmai tapasztalat' },
        { value: REGI_PACIENS_ERTEK, label: 'elégedett páciens' },
        { value: '1', label: 'közös cél: az Ön mozgásszabadsága' },
      ]),
    ]

    const eredmeny = alkalmazKezdolapJavitasok(layout)

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('paciens-szam')
    const blokk = eredmeny.layout[0]
    expect(blokk.blockType === 'about' ? blokk.stats : null).toEqual([
      { value: '10+', label: 'év szakmai tapasztalat' },
      { value: UJ_PACIENS_ERTEK, label: 'elégedett páciens' },
      { value: '1', label: 'közös cél: az Ön mozgásszabadsága' },
    ])
  })

  it('mind a két előfordulást javítja, ha a szekciósorban két Rólunk-blokk áll', () => {
    const layout: Szekciosor = [
      rolunkSzekcio([{ value: REGI_PACIENS_ERTEK, label: 'elégedett páciens' }]),
      heroSzekcio(),
      rolunkSzekcio([{ value: REGI_PACIENS_ERTEK, label: 'elégedett páciens' }]),
    ]

    const eredmeny = alkalmazKezdolapJavitasok(layout)

    expect(eredmeny.modositasok).toHaveLength(2)
    const ertekek = eredmeny.layout.flatMap((blokk) =>
      blokk.blockType === 'about' ? (blokk.stats ?? []).map((sor) => sor.value) : [],
    )
    expect(ertekek).toEqual([UJ_PACIENS_ERTEK, UJ_PACIENS_ERTEK])
  })

  it('NEM cseréli a „Mit jelent” (label) mezőben álló azonos szöveget', () => {
    const layout: Szekciosor = [rolunkSzekcio([{ value: '1000+', label: REGI_PACIENS_ERTEK }])]

    const eredmeny = alkalmazKezdolapJavitasok(layout)

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.layout).toBe(layout)
    expect(eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'paciens-szam')?.indok).toContain(
      'egyetlen statisztika-értéke sem',
    )
  })

  it('NEM cseréli más blokk szövegmezőjében álló „5000+”-t', () => {
    const hero = heroSzekcio()

    const eredmeny = alkalmazKezdolapJavitasok([hero])

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.layout[0]).toBe(hero)
  })

  it.each([
    ['szám a plusz nélkül', '5000'],
    ['szóközzel', '5000 +'],
    ['körbeírt whitespace', ` ${REGI_PACIENS_ERTEK} `],
    ['ezres tagolás', '5 000+'],
    ['már javított érték', UJ_PACIENS_ERTEK],
  ])('nem cseréli a nem pontos egyezést (%s)', (_eset, value) => {
    const layout: Szekciosor = [rolunkSzekcio([{ value, label: 'elégedett páciens' }])]

    const eredmeny = alkalmazKezdolapJavitasok(layout)

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.layout).toBe(layout)
  })

  it('statisztika nélküli Rólunk-blokkot érintetlenül továbbad', () => {
    const blokk = rolunkSzekcio([])

    const eredmeny = alkalmazKezdolapJavitasok([blokk])

    expect(eredmeny.layout[0]).toBe(blokk)
    expect(eredmeny.modositasok).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (c) Kurzus előny-sorai — csak üres mezőbe
// ---------------------------------------------------------------------------

describe('alkalmazKurzusElonyok', () => {
  it.each([
    ['hiányzó mező', undefined],
    ['null érték', null],
    ['üres tömb', []],
    ['csak whitespace-sorok', [{ text: '   ' }, { text: '' }]],
  ])(
    'üres mezőt (%s) tölti fel a három jóváhagyott sorral, sorrendhelyesen',
    (_eset, jelenlegi) => {
      const eredmeny = alkalmazKurzusElonyok(jelenlegi as Product['cardHighlights'])

      expect(eredmeny.cardHighlights).toEqual([
        { text: '4 modulnyi videóanyag' },
        { text: '50+ videós gyakorlat' },
        { text: '5 perces miniblokkok' },
      ])
      expect(eredmeny.cardHighlights?.map((sor) => sor.text)).toEqual([...KURZUS_ELONYOK])
      expect(eredmeny.modositasok).toHaveLength(1)
      expect(eredmeny.kihagyasok).toHaveLength(0)
    },
  )

  it('a mező maxRows plafonját (3) nem lépi túl', () => {
    expect(KURZUS_ELONYOK).toHaveLength(3)
  })

  it('meglévő tartalomhoz nem nyúl, és indokkal naplózza a kihagyást', () => {
    const eredmeny = alkalmazKurzusElonyok([{ text: 'Saját szerkesztői sor', id: 'x1' }])

    expect(eredmeny.cardHighlights).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].szabaly).toBe('kurzus-elonyok')
    expect(eredmeny.kihagyasok[0].indok).toContain('Saját szerkesztői sor')
    expect(eredmeny.kihagyasok[0].indok).toContain('sosem ír felül')
  })

  it('egyetlen kitöltött sor is elég a kihagyáshoz (részleges tartalom sem egészül ki)', () => {
    const eredmeny = alkalmazKurzusElonyok([{ text: '  ' }, { text: '50+ videós gyakorlat' }])

    expect(eredmeny.cardHighlights).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// (d) A /rolunk fejléc-képe — csak a szóló portréról
// ---------------------------------------------------------------------------

/** A `heroImage` populált alakja (mélyebb lekérdezésnél a teljes Media dokumentum). */
const mediaDokumentum = (id: number, filename: string): Media => ({
  id,
  alt: 'Kiss Kata és Kocsis Kata, a KinetiCare gyógytornászai',
  filename,
  updatedAt: '2026-08-16T00:00:00.000Z',
  createdAt: '2026-08-16T00:00:00.000Z',
})

describe('heroKepAzonosito', () => {
  it('mindkét alakból (azonosító és populált dokumentum) az azonosítót adja', () => {
    expect(heroKepAzonosito(41)).toBe(41)
    expect(heroKepAzonosito(mediaDokumentum(41, 'katak-team.webp'))).toBe(41)
  })

  it('üres mezőre null-t ad', () => {
    expect(heroKepAzonosito(null)).toBeNull()
    expect(heroKepAzonosito(undefined)).toBeNull()
  })
})

describe('alkalmazRolunkHeroKep', () => {
  const studio = (id: number | null, forrasLetezik = true) => ({
    filename: ROLUNK_HERO_FORRAS.filename,
    id,
    forrasLetezik,
  })

  it('a korábbi páros csapatfotóról (katak-team) a stúdiófotóra cserél', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 41,
      jelenlegiFajlnev: 'katak-team.webp',
      ujMedia: studio(77),
    })

    expect(eredmeny.heroImage).toBe(77)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('rolunk-hero-kep')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('a szóló portréról (a régi oldal öröksége) is a stúdiófotóra cserél, populált heroImage-nél is', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: mediaDokumentum(41, '682a121babe80_IMG_7573.webp'),
      jelenlegiFajlnev: '682a121babe80_IMG_7573.webp',
      ujMedia: studio(77),
    })

    expect(eredmeny.heroImage).toBe(77)
  })

  it('a szerkesztő által választott képhez nem nyúl, és HANGOSAN naplózza', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 99,
      jelenlegiFajlnev: 'sajat-feltoltes.webp',
      ujMedia: studio(77),
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('sajat-feltoltes.webp')
    expect(eredmeny.kihagyasok[0].indok).toContain('szerkesztői elsőbbség')
  })

  // Tulajdonosi döntés (2026-09-23): a /rolunk fejléc-képe élesben üres lett
  // (a szerkesztő kivette), és üres marad. A script nem teszi vissza.
  it('ÜRES fejléc-kép mezőt nem tölt ki, HANGOSAN kihagyja (szerkesztői döntés)', () => {
    for (const jelenlegi of [null, undefined]) {
      const eredmeny = alkalmazRolunkHeroKep({
        jelenlegi,
        jelenlegiFajlnev: null,
        ujMedia: studio(77),
      })

      expect(eredmeny.heroImage).toBeNull()
      expect(eredmeny.modositasok).toHaveLength(0)
      expect(eredmeny.kihagyasok).toHaveLength(1)
      expect(eredmeny.kihagyasok[0].hangos).toBe(true)
      expect(eredmeny.kihagyasok[0].indok).toContain('szerkesztői döntés')
    }
  })

  it('a stúdiófotó és a forrásfájl hiányában HANGOSAN hagyja ki a lépést', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 41,
      jelenlegiFajlnev: 'katak-team.webp',
      ujMedia: studio(null, false),
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain(ROLUNK_HERO_FORRAS.filename)
  })

  it('nem található média-rekordra mutató mezőnél hangosan kimarad', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 99,
      jelenlegiFajlnev: null,
      ujMedia: studio(77),
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('99')
  })
})

// ---------------------------------------------------------------------------
// (e) Idempotencia
// ---------------------------------------------------------------------------

describe('idempotencia — kétszer futtatva ugyanaz jön ki', () => {
  it('a szekciósor a második futásra már nem változik', () => {
    const layout: Szekciosor = [
      heroSzekcio(),
      kurzusSzekcio(REGI_KURZUS_SZEKCIO_CIM),
      rolunkSzekcio([
        { value: '10+', label: 'év szakmai tapasztalat' },
        { value: REGI_PACIENS_ERTEK, label: 'elégedett páciens' },
      ]),
    ]

    const elso = alkalmazKezdolapJavitasok(layout)
    expect(elso.modositasok).toHaveLength(2)

    const masodik = alkalmazKezdolapJavitasok(elso.layout)

    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.layout).toBe(elso.layout)
    expect(masodik.layout).toEqual(elso.layout)
    // A második futás minden kihagyást megindokol.
    expect(masodik.kihagyasok.length).toBeGreaterThan(0)
    for (const kihagyas of masodik.kihagyasok) {
      expect(kihagyas.indok).not.toBeNull()
    }
  })

  it('a bemeneti szekciósort nem módosítja helyben (a hívó adata érintetlen)', () => {
    const layout: Szekciosor = [
      kurzusSzekcio(REGI_KURZUS_SZEKCIO_CIM),
      rolunkSzekcio([{ value: REGI_PACIENS_ERTEK, label: 'elégedett páciens' }]),
    ]
    const masolat = structuredClone(layout)

    alkalmazKezdolapJavitasok(layout)

    expect(layout).toEqual(masolat)
  })

  it('az előny-sorok a második futásra már nem íródnak be újra', () => {
    const elso = alkalmazKurzusElonyok(undefined)
    expect(elso.cardHighlights).not.toBeNull()

    const masodik = alkalmazKurzusElonyok(elso.cardHighlights)

    expect(masodik.cardHighlights).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
  })

  it('a /rolunk fejléc-képe a második futásra már nem cserélődik', () => {
    const studio = { filename: ROLUNK_HERO_FORRAS.filename, id: 77, forrasLetezik: true }
    const elso = alkalmazRolunkHeroKep({
      jelenlegi: 41,
      jelenlegiFajlnev: 'katak-team.webp',
      ujMedia: studio,
    })
    expect(elso.heroImage).toBe(77)

    const masodik = alkalmazRolunkHeroKep({
      jelenlegi: elso.heroImage,
      jelenlegiFajlnev: ROLUNK_HERO_FORRAS.filename,
      ujMedia: studio,
    })

    expect(masodik.heroImage).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
    expect(masodik.kihagyasok[0].hangos).toBe(false)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR a stúdiófotó')
  })
})

// ---------------------------------------------------------------------------
// 5. javítás — a szakmai háttér harmonikába szervezése
// ---------------------------------------------------------------------------

/** Kulcs-sorrend megfordítása rekurzívan — a jsonb-átrendezés szimulálása. */
const forditottKulcsrend = (ertek: unknown): unknown => {
  if (Array.isArray(ertek)) {
    return ertek.map(forditottKulcsrend)
  }
  if (ertek !== null && typeof ertek === 'object') {
    const forras = ertek as Record<string, unknown>
    const eredmeny: Record<string, unknown> = {}
    for (const kulcs of Object.keys(forras).reverse()) {
      eredmeny[kulcs] = forditottKulcsrend(forras[kulcs])
    }
    return eredmeny
  }
  return ertek
}

/** Az örökölt (harmonika előtti) szakmai-háttér blokk, ahogy a seed tárolta. */
const orokoltSzakmaiBlokk = (): Szekcio =>
  ({
    blockType: 'richText',
    id: 'szakmai-regi',
    content: rolunkSzakmaiOrokoltTartalom(),
    sectionSettings: { visible: true, anchorId: SZAKMAI_HATTER_HORGONY, hatter: 'feher' },
  }) as Szekcio

describe('stabilJson — kulcs-sorrendtől független összevetés', () => {
  it('a kulcssorrend átrendezése nem változtat az alakon', () => {
    const tartalom = rolunkSzakmaiOrokoltTartalom()
    expect(stabilJson(forditottKulcsrend(tartalom))).toBe(stabilJson(tartalom))
  })

  it('a tényleges tartalom (tömbsorrend, szöveg) különbsége kimutatható', () => {
    expect(stabilJson([1, 2])).not.toBe(stabilJson([2, 1]))
    expect(stabilJson({ a: 'x' })).not.toBe(stabilJson({ a: 'y' }))
  })
})

describe('rolunkSzakmaiUjBlokkok — az új blokkpár a seed-builderből', () => {
  it('visszaadja a rövid richText + harmonika párt', () => {
    const { rovid, harmonika } = rolunkSzakmaiUjBlokkok()
    expect(rovid?.blockType).toBe('richText')
    expect(harmonika?.blockType).toBe('accordion')
    expect(harmonika?.sectionSettings?.anchorId).toBe(SZAKMAI_HATTER_HORGONY)
  })
})

describe('alkalmazSzakmaiHarmonika — az örökölt óriás-blokk cseréje', () => {
  const ujak = rolunkSzakmaiUjBlokkok()

  const csere = (layout: Page['layout']) =>
    alkalmazSzakmaiHarmonika({
      layout,
      orokoltTartalom: rolunkSzakmaiOrokoltTartalom(),
      ujRovidBlokk: ujak.rovid,
      ujHarmonikaBlokk: ujak.harmonika,
    })

  it('a seedelt örökölt blokkot a rövid + harmonika párra cseréli, a többi blokk referencia-azonos marad', () => {
    const elotte: Szekcio = kurzusSzekcio('Valami más cím')
    const utana: Szekcio = { blockType: 'ctaBanner', id: 'cta-1', title: 'Zárás' } as Szekcio
    const eredmeny = csere([elotte, orokoltSzakmaiBlokk(), utana])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(eredmeny.layout).not.toBeNull()
    expect(eredmeny.layout).toHaveLength(4)
    expect(eredmeny.layout?.[0]).toBe(elotte)
    expect(eredmeny.layout?.[1].blockType).toBe('richText')
    expect(eredmeny.layout?.[2].blockType).toBe('accordion')
    expect(eredmeny.layout?.[2].sectionSettings?.anchorId).toBe(SZAKMAI_HATTER_HORGONY)
    expect(eredmeny.layout?.[3]).toBe(utana)
  })

  it('a jsonb-féle kulcs-átrendezés NEM akadályozza a cserét', () => {
    const atrendezett = {
      ...orokoltSzakmaiBlokk(),
      content: forditottKulcsrend(rolunkSzakmaiOrokoltTartalom()),
    } as Szekcio
    const eredmeny = csere([atrendezett])
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.layout).toHaveLength(2)
  })

  it('szerkesztő által átírt tartalomnál csendes, indokolt kihagyás', () => {
    const tartalom = structuredClone(rolunkSzakmaiOrokoltTartalom()) as {
      root: { children: unknown[] }
    }
    tartalom.root.children.pop()
    const modositott = { ...orokoltSzakmaiBlokk(), content: tartalom } as Szekcio
    const eredmeny = csere([modositott])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('a szerkesztő időközben átírta')
  })

  it('idempotencia: ha a horgonyon már accordion áll, csendes kihagyás', () => {
    const elsoKor = csere([orokoltSzakmaiBlokk()])
    expect(elsoKor.layout).not.toBeNull()
    const masodikKor = csere(elsoKor.layout)

    expect(masodikKor.layout).toBeNull()
    expect(masodikKor.modositasok).toHaveLength(0)
    expect(masodikKor.kihagyasok).toHaveLength(1)
    expect(masodikKor.kihagyasok[0].hangos).not.toBe(true)
    expect(masodikKor.kihagyasok[0].indok).toContain('MÁR harmonika')
  })

  it('hiányzó horgony és nem-richText blokk: hangos kihagyás', () => {
    const horgonyNelkul = csere([kurzusSzekcio('Cím')])
    expect(horgonyNelkul.layout).toBeNull()
    expect(horgonyNelkul.kihagyasok[0].hangos).toBe(true)

    const masTipus = {
      blockType: 'ctaBanner',
      id: 'cta-x',
      title: 'X',
      sectionSettings: { visible: true, anchorId: SZAKMAI_HATTER_HORGONY },
    } as Szekcio
    const rosszTipus = csere([masTipus])
    expect(rosszTipus.layout).toBeNull()
    expect(rosszTipus.kihagyasok[0].hangos).toBe(true)
  })

  it('hiányzó új blokkpár (builder-alak változás): hangos kihagyás', () => {
    const eredmeny = alkalmazSzakmaiHarmonika({
      layout: [orokoltSzakmaiBlokk()],
      orokoltTartalom: rolunkSzakmaiOrokoltTartalom(),
      ujRovidBlokk: null,
      ujHarmonikaBlokk: ujak.harmonika,
    })
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('buildRolunkLayout')
  })

  it('a bemeneti szekciósort nem módosítja helyben', () => {
    const bemenet = [orokoltSzakmaiBlokk()]
    const lenyomat = stabilJson(bemenet)
    csere(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// 6. javítás — a három jogi oldal LÉTREHOZÁSA (felülírás soha).
// ===========================================================================

describe('alkalmazJogiOldalak', () => {
  it('üres adatbázisban MIND A HÁROM oldalt létrehozza, közzétett állapotban', () => {
    const eredmeny = alkalmazJogiOldalak({ letezoSlugok: [] })

    expect(eredmeny.letrehozando.map((oldal) => oldal.slug)).toEqual([
      'aszf',
      'adatvedelem',
      'impresszum',
    ])
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(eredmeny.modositasok).toHaveLength(3)

    for (const oldal of eredmeny.letrehozando) {
      expect(oldal.status).toBe('published')
      expect(oldal._status).toBe('published')
      expect(oldal.title.length).toBeGreaterThan(0)
      expect(oldal.seoDescription.length).toBeGreaterThan(0)
      // A tartalom a jogász szó szerinti szövege — nem üres, és a
      // szó szerintiséget a legal-content.test.ts bizonyítja karakterre.
      expect(oldal.content.root.children.length).toBeGreaterThan(10)
    }
  })

  it('LÉTEZŐ webcímet SOHA nem ír felül — csendben kihagyja', () => {
    const eredmeny = alkalmazJogiOldalak({ letezoSlugok: ['aszf', 'impresszum'] })

    expect(eredmeny.letrehozando.map((oldal) => oldal.slug)).toEqual(['adatvedelem'])
    expect(eredmeny.kihagyasok).toHaveLength(2)
    for (const kihagyas of eredmeny.kihagyasok) {
      expect(kihagyas.szabaly).toBe('jogi-oldalak')
      expect(kihagyas.indok).toContain('MÁR LÉTEZIK')
      // A jogi oldal hiánya nem üzemeltetési hiba: nem hangos kihagyás.
      expect(kihagyas.hangos).not.toBe(true)
    }
  })

  it('idempotens: másodszor futtatva egyetlen létrehozás sem marad', () => {
    const elso = alkalmazJogiOldalak({ letezoSlugok: [] })
    const masodik = alkalmazJogiOldalak({
      letezoSlugok: elso.letrehozando.map((oldal) => oldal.slug),
    })

    expect(masodik.letrehozando).toHaveLength(0)
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(3)
  })

  it('a jogi oldalak tartalma a legal-content modulból jön (nem másolat)', () => {
    const eredmeny = alkalmazJogiOldalak({ letezoSlugok: [] })
    for (const [index, oldal] of eredmeny.letrehozando.entries()) {
      expect(richTextSzoveg(oldal.content)).toBe(
        richTextSzoveg(jogiOldalTartalom(JOGI_OLDALAK[index])),
      )
    }
  })
})

// ===========================================================================
// 7. javítás — az SOS villámkurzus webcíme.
// ===========================================================================

describe('alkalmazSosKurzusSlug', () => {
  it('a jóváhagyott slug PONTOSAN az, amit a mező slug-generátora adna', () => {
    // Ha a kurzus nevéből más slug adódna, a kézzel beírt érték és a mező
    // hookja (src/fields/course-slug.ts) szétcsúszna.
    expect(buildCourseSlug(SOS_COURSE_SKU)).toBe(SOS_KURZUS_SLUG)
  })

  it.each([undefined, null, '', '   '])('üres mezőt (%p) kitölti', (jelenlegi) => {
    const eredmeny = alkalmazSosKurzusSlug(jelenlegi)
    expect(eredmeny.slug).toBe(SOS_KURZUS_SLUG)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('MEGLÉVŐ webcímet sosem ír át', () => {
    const eredmeny = alkalmazSosKurzusSlug('sajat-webcim')
    expect(eredmeny.slug).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR VAN webcíme')
  })

  it('idempotens: a már beírt slugot csendben kihagyja', () => {
    const eredmeny = alkalmazSosKurzusSlug(SOS_KURZUS_SLUG)
    expect(eredmeny.slug).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })
})

// ===========================================================================
// 14. javítás — az ÁSZF `[xxx]` helykitöltője.
// ===========================================================================

describe('alkalmazSosPublikalas — a piszkozat publikálása a publikált fölött', () => {
  const alap = { status: 'published' as const, priceInHUFEnabled: false, _status: 'draft' as const }

  it('published saját státusz + ingyenes + piszkozat fölötte: publikál', () => {
    const eredmeny = alkalmazSosPublikalas(alap)
    expect(eredmeny.publikal).toBe(true)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0]?.szabaly).toBe('sos-publikalas')
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('hiányzó _status (verziózás nélkül mentett rekord) is publikálható', () => {
    expect(alkalmazSosPublikalas({ ...alap, _status: null }).publikal).toBe(true)
    expect(alkalmazSosPublikalas({ ...alap, _status: undefined }).publikal).toBe(true)
  })

  it('idempotens: már publikált legutóbbi verziónál csendben kihagy', () => {
    const eredmeny = alkalmazSosPublikalas({ ...alap, _status: 'published' })
    expect(eredmeny.publikal).toBe(false)
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('MÁR publikált')
    expect(eredmeny.kihagyasok[0]?.hangos).toBeUndefined()
  })

  it.each([
    [{ ...alap, status: 'draft' as const }, 'saját státusza'],
    [{ ...alap, status: 'archived' as const }, 'saját státusza'],
    [{ ...alap, priceInHUFEnabled: true }, 'ingyenesként'],
    [{ ...alap, priceInHUFEnabled: null }, 'ingyenesként'],
    [{ ...alap, priceInHUFEnabled: undefined }, 'ingyenesként'],
  ])('nem publikál, ha az előfeltétel hiányzik: %o', (termek, indokReszlet) => {
    const eredmeny = alkalmazSosPublikalas(termek)
    expect(eredmeny.publikal).toBe(false)
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.indok).toContain(indokReszlet)
  })
})

describe('alkalmazAszfAdatvedelemLink', () => {
  const aszfTartalom = (bekezdesek: string[]): unknown =>
    richText(bekezdesek.map((szoveg) => para(szoveg)))

  it('a helykitöltős bekezdést a valódi hivatkozásra cseréli', () => {
    const eredmeny = alkalmazAszfAdatvedelemLink(
      aszfTartalom(['Bevezető mondat.', ASZF_HELYKITOLTO_BEKEZDES, 'Záró mondat.']),
    )
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(richTextSzoveg(eredmeny.content)).toBe(
      ['Bevezető mondat.', ASZF_JAVITOTT_BEKEZDES, 'Záró mondat.'].join('\n'),
    )
  })

  it('a jogi szöveg TÖBBI bekezdését érintetlenül hagyja', () => {
    const eredeti = aszfTartalom(['Első.', ASZF_HELYKITOLTO_BEKEZDES, 'Harmadik.'])
    const eredmeny = alkalmazAszfAdatvedelemLink(eredeti)
    const eredetiGyerekek = (eredeti as { root: { children: unknown[] } }).root.children
    const ujGyerekek = (eredmeny.content as { root: { children: unknown[] } }).root.children
    // Referencia-azonosság: a nem érintett csomópontok UGYANAZOK az objektumok.
    expect(ujGyerekek[0]).toBe(eredetiGyerekek[0])
    expect(ujGyerekek[2]).toBe(eredetiGyerekek[2])
    expect(ujGyerekek[1]).not.toBe(eredetiGyerekek[1])
  })

  it('idempotens: a már javított szövegen nem ír és nem is kiabál', () => {
    const eredmeny = alkalmazAszfAdatvedelemLink(aszfTartalom([ASZF_JAVITOTT_BEKEZDES]))
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR a helyén')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('SZERKESZTETT mondatot nem ír át, és hangosan jelzi', () => {
    const eredmeny = alkalmazAszfAdatvedelemLink(
      aszfTartalom(['Adatkezelési tájékoztatónkat itt éred el: [xxx] (frissítés alatt)']),
    )
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nem tippel')
  })

  it('TÖBB egyforma helykitöltőnél nem dönt maga', () => {
    const eredmeny = alkalmazAszfAdatvedelemLink(
      aszfTartalom([ASZF_HELYKITOLTO_BEKEZDES, ASZF_HELYKITOLTO_BEKEZDES]),
    )
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
  })

  it('idegen szerkezetnél hangosan kihagy', () => {
    const eredmeny = alkalmazAszfAdatvedelemLink({ nem: 'richtext' })
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
  })

  it('a FORRÁSFÁJLBÓL generált ÁSZF már a javított hivatkozást hozza', () => {
    // Ez köti össze a két felet: az újonnan létrehozott oldalon nincs mit
    // javítani, a régin viszont van. Ha valaki visszaírná a `[xxx]`-et a
    // forrásba, ez a teszt bukik.
    const aszf = JOGI_OLDALAK.find((oldal) => oldal.slug === 'aszf')
    expect(aszf).toBeDefined()
    const szoveg = richTextSzoveg(jogiOldalTartalom(aszf!))
    expect(szoveg).toContain(ASZF_JAVITOTT_BEKEZDES)
    expect(szoveg).not.toContain('[xxx]')
  })
})

// ===========================================================================
// 15. javítás — a kurzuslista-gombok egységes felirata.
// ===========================================================================

describe('alkalmazKurzuslistaFeliratok', () => {
  const layoutTobbGombbal = (feliratok: string[]): Page['layout'] =>
    [
      {
        blockType: 'filmHero',
        id: 'h',
        ctas: [
          { felirat: feliratok[0], url: '/kurzusok', ujAblakban: false },
          { felirat: 'Ingyenes SOS gyakorlatok', url: '#ingyenes', ujAblakban: false },
        ],
      },
      {
        blockType: 'ctaBanner',
        id: 'c',
        cta: { felirat: feliratok[1], url: '/kurzusok', ujAblakban: false },
      },
    ] as unknown as Page['layout']

  it('a HÁROM élőben mért feliratot egyetlen jóváhagyottra hozza', () => {
    const eredmeny = alkalmazKurzuslistaFeliratok(
      layoutTobbGombbal(['Kurzusok megtekintése', 'Megnézem a kurzusokat']),
    )
    expect(eredmeny.modositasok).toHaveLength(1)
    const szoveg = JSON.stringify(eredmeny.layout)
    expect(szoveg).not.toContain('Kurzusok megtekintése')
    expect(szoveg).not.toContain('Megnézem a kurzusokat')
    expect(szoveg.match(/Nézd meg a kurzusokat/g)).toHaveLength(2)
  })

  it('a MÁS célra mutató gombhoz nem nyúl', () => {
    const eredmeny = alkalmazKurzuslistaFeliratok(
      layoutTobbGombbal(['Kurzusok megtekintése', 'Megnézem a kurzusokat']),
    )
    // Az ingyenes sáv horgonya (#ingyenes) érintetlen marad.
    expect(JSON.stringify(eredmeny.layout)).toContain('Ingyenes SOS gyakorlatok')
  })

  it('a SZERKESZTŐ saját feliratát sosem írja át', () => {
    const eredmeny = alkalmazKurzuslistaFeliratok(
      layoutTobbGombbal(['Irány a kurzusaink', 'Kattints ide']),
    )
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('saját szövegeit')
  })

  it('idempotens: a már egységes lapon nem ír, és nem is kiabál', () => {
    const eredmeny = alkalmazKurzuslistaFeliratok(
      layoutTobbGombbal([KURZUSLISTA_JOVAHAGYOTT_FELIRAT, KURZUSLISTA_JOVAHAGYOTT_FELIRAT]),
    )
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR a jóváhagyott')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a jóváhagyott felirat AZONOS a kódba öntött szótár §3.2 #10 sorával', () => {
    // Ha valaki a szótárban átírja a feliratot, ez a teszt buktatja a
    // tartalom-scriptet is — a kettő nem csúszhat szét.
    const szotarSor = CTA_VOCABULARY.find((sor) => sor.action === 'course-list-open')
    expect(szotarSor?.label).toBe(KURZUSLISTA_JOVAHAGYOTT_FELIRAT)
  })
})

// ===========================================================================
// 13. javítás — az SOS villámkurzus ingyenes-jelölője.
// ===========================================================================

describe('alkalmazSosIngyenesJelolo', () => {
  it.each([
    ['beállítatlan pipa', { priceInHUF: null, priceInHUFEnabled: null }],
    ['bepipálva, de üres ár', { priceInHUF: null, priceInHUFEnabled: true }],
    ['bepipálva, 0 Ft', { priceInHUF: 0, priceInHUFEnabled: true }],
  ])('%s → INGYENESRE állítja', (_nev, termek) => {
    const eredmeny = alkalmazSosIngyenesJelolo(termek)
    expect(eredmeny.priceInHUFEnabled).toBe(false)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('BEÁRAZOTT terméket sosem tesz ingyenessé', () => {
    const eredmeny = alkalmazSosIngyenesJelolo({ priceInHUF: 4900, priceInHUFEnabled: true })
    expect(eredmeny.priceInHUFEnabled).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('ÉRVÉNYES ára van')
  })

  it('idempotens: a már ingyenesként jelölt terméket csendben kihagyja', () => {
    const eredmeny = alkalmazSosIngyenesJelolo({ priceInHUF: null, priceInHUFEnabled: false })
    expect(eredmeny.priceInHUFEnabled).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a javított rekordot a kurzus-logika INGYENESNEK látja (a hurok bezárul)', () => {
    // Ez a teszt köti össze a tartalom-javítást a felülettel: hiába állítja be
    // a script a mezőt, ha az ár-címke logikája mást mondana. A tulajdonos
    // hibája pontosan a kettő szétcsúszásából állt elő — a terméken nem volt
    // kimondva az ingyenesség, ezért a felület fizetősnek mutatta.
    const elotte = { priceInHUF: null, priceInHUFEnabled: null }
    expect(coursePriceBadgeKind(elotte)).not.toBe('free')

    const eredmeny = alkalmazSosIngyenesJelolo(elotte)
    expect(
      coursePriceBadgeKind({ priceInHUF: null, priceInHUFEnabled: eredmeny.priceInHUFEnabled }),
    ).toBe('free')
  })
})

// ===========================================================================
// 8. javítás — a rendelői szekció horgonya.
// ===========================================================================

describe('alkalmazRendeloiHorgony', () => {
  /** Szövegblokk a megadott címsorral és horgonnyal. */
  const szovegSzekcio = (cimsor: string, anchorId?: string | null): Szekcio =>
    ({
      blockType: 'richText',
      id: `rt-${cimsor.slice(0, 6)}`,
      content: richText([
        heading('h3', cimsor),
        para('Gyógytorna, manuálterápia és kiegészítő technikák.'),
      ]),
      sectionSettings: { visible: true, hatter: 'feher', ...(anchorId ? { anchorId } : {}) },
    }) as Szekcio

  /** A ténylegesen élő állapot: a rendelői szekció `arlista` horgonnyal. */
  const eloSzekciosor = (): Szekciosor => [
    kurzusSzekcio('Kurzusaink'),
    szovegSzekcio('Rendelői kezelések – személyes terápiás megoldások', 'arlista'),
  ]

  it('az „arlista" horgonyt a menüponthoz igazítja', () => {
    const eredmeny = alkalmazRendeloiHorgony(eloSzekciosor())

    expect(eredmeny.layout).not.toBeNull()
    expect(eredmeny.layout?.[1].sectionSettings?.anchorId).toBe(CLINIC_TREATMENTS_ANCHOR)
    // A menü célja ezután tényleg létező horgonyra mutat.
    expect(CLINIC_TREATMENTS_PATH.endsWith(`#${CLINIC_TREATMENTS_ANCHOR}`)).toBe(true)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    // A szekció többi beállítása változatlan.
    const rendeloi = eredmeny.layout?.[1]
    expect(rendeloi?.blockType).toBe('richText')
    if (rendeloi?.blockType === 'richText') {
      expect(rendeloi.sectionSettings?.hatter).toBe('feher')
    }
  })

  it('horgony nélküli szekciót is felcímkéz', () => {
    const eredmeny = alkalmazRendeloiHorgony([
      szovegSzekcio('Rendelői kezelések – személyes terápiás megoldások'),
    ])
    expect(eredmeny.layout?.[0].sectionSettings?.anchorId).toBe(CLINIC_TREATMENTS_ANCHOR)
  })

  it('idempotens: a már helyes horgonyt csendben kihagyja', () => {
    const elso = alkalmazRendeloiHorgony(eloSzekciosor())
    const masodik = alkalmazRendeloiHorgony(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
  })

  it('a seed-builder alapállapota már helyes (nincs teendő)', () => {
    const eredmeny = alkalmazRendeloiHorgony(buildSzolgaltatasokLayout())
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR')
  })

  it('üres szekciósor: hangos kihagyás', () => {
    expect(alkalmazRendeloiHorgony(null).kihagyasok[0].hangos).toBe(true)
    expect(alkalmazRendeloiHorgony([]).kihagyasok[0].hangos).toBe(true)
  })

  it('nem azonosítható szekció: hangos kihagyás, írás nélkül', () => {
    const eredmeny = alkalmazRendeloiHorgony([kurzusSzekcio('Kurzusaink')])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nincs olyan szövegblokk')
  })

  it('TÖBB illeszkedő szekció: hangos kihagyás, írás nélkül', () => {
    const eredmeny = alkalmazRendeloiHorgony([
      szovegSzekcio('Rendelői kezelések – személyes terápiás megoldások'),
      szovegSzekcio('Rendelői kezelések – árlista'),
    ])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nem egyértelmű')
  })

  it('a horgonyt MÁS blokk viseli: hangos kihagyás (ütközés-védelem)', () => {
    const eredmeny = alkalmazRendeloiHorgony([
      kurzusSzekcio('Kurzusaink'),
      szovegSzekcio('Rendelői kezelések – személyes terápiás megoldások', 'arlista'),
      szovegSzekcio('Valami más szekció', CLINIC_TREATMENTS_ANCHOR),
    ])
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('ütközne')
  })

  it('a bemeneti szekciósort nem módosítja helyben', () => {
    const bemenet = eloSzekciosor()
    const lenyomat = stabilJson(bemenet)
    alkalmazRendeloiHorgony(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// 9. javítás — a kezdőlapi sajtó-logósor felirata.
// ===========================================================================

describe('alkalmazPressLogosFejlec', () => {
  /** Sajtó-logósor a megadott felirattal (a `heading` szándékosan lehet null). */
  const sajtoSzekcio = (heading: string | null): Szekcio => ({
    blockType: 'pressLogos',
    id: 'pl-1',
    heading,
    logos: [{ id: 'l1', image: 12 }],
    sectionSettings: { visible: true, hatter: 'feher' },
  })

  const ujFejlec = pressLogosUjFejlec()
  const csere = (layout: Page['layout']) => alkalmazPressLogosFejlec({ layout, ujFejlec })

  it('az ÚJ felirat a kezdőlap seed-builderéből jön, és a komponens beépített feliratával azonos', () => {
    // Ez a lépés 3. védőfeltételének alapja: üres mezőbe azért NEM írunk, mert
    // a látogató a komponens fallbackjétől már az új szöveget látja.
    expect(ujFejlec).toBe(PRESS_ALAPFELIRAT)
    expect(ujFejlec).not.toBe(REGI_PRESS_FEJLEC)
  })

  it('pontos egyezésnél átírja a feliratot, a többi szekciót érintetlenül hagyja', () => {
    const hero = heroSzekcio()
    const eredmeny = csere([hero, sajtoSzekcio(REGI_PRESS_FEJLEC)])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('presslogos-fejlec')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    const blokk = eredmeny.layout?.[1]
    expect(blokk?.blockType === 'pressLogos' ? blokk.heading : null).toBe(ujFejlec)
    // A logók és a sávbeállítás változatlanok.
    expect(blokk?.blockType === 'pressLogos' ? blokk.logos : null).toEqual([
      { id: 'l1', image: 12 },
    ])
    expect(eredmeny.layout?.[0]).toBe(hero)
  })

  it.each([
    ['üres szöveg', ''],
    ['csak whitespace', '   '],
    ['hiányzó felirat', null],
  ])(
    'ÜRES feliratot (%s) NEM tölt ki — a komponens fallbackje már az új szöveg',
    (_eset, heading) => {
      const eredmeny = csere([sajtoSzekcio(heading)])

      expect(eredmeny.layout).toBeNull()
      expect(eredmeny.modositasok).toHaveLength(0)
      expect(eredmeny.kihagyasok[0].indok).toContain('ÜRES')
      expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
    },
  )

  it.each([
    ['más felirat', 'Rólunk írták'],
    ['körbeírt whitespace', ` ${REGI_PRESS_FEJLEC} `],
    ['kisbetűs változat', REGI_PRESS_FEJLEC.toLowerCase()],
  ])('nem nyúl a szerkesztői felirathoz (%s)', (_eset, heading) => {
    const eredmeny = csere([sajtoSzekcio(heading)])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('pontos egyezésnél')
  })

  it('idempotens: a már átírt feliratot csendben kihagyja', () => {
    const elso = csere([sajtoSzekcio(REGI_PRESS_FEJLEC)])
    const masodik = csere(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('több logósornál mindegyiket külön bírálja el', () => {
    const eredmeny = csere([
      sajtoSzekcio(REGI_PRESS_FEJLEC),
      sajtoSzekcio('Saját felirat'),
      sajtoSzekcio(REGI_PRESS_FEJLEC),
    ])

    expect(eredmeny.modositasok).toHaveLength(2)
    expect(eredmeny.kihagyasok).toHaveLength(1)
    const feliratok = (eredmeny.layout ?? []).map((blokk) =>
      blokk.blockType === 'pressLogos' ? blokk.heading : null,
    )
    expect(feliratok).toEqual([ujFejlec, 'Saját felirat', ujFejlec])
  })

  it('logósor nélküli és üres szekciósornál indokolt (nem hangos) kihagyás', () => {
    const nincsLogosor = csere([heroSzekcio()])
    expect(nincsLogosor.layout).toBeNull()
    expect(nincsLogosor.kihagyasok[0].indok).toContain('nincs Sajtó-logósor')
    expect(nincsLogosor.kihagyasok[0].hangos).not.toBe(true)

    for (const layout of [undefined, null, [] as Szekciosor]) {
      const ures = csere(layout)
      expect(ures.layout).toBeNull()
      expect(ures.kihagyasok[0].indok).toContain('nincs szekciósora')
      expect(ures.kihagyasok[0].hangos).not.toBe(true)
    }
  })

  it('hiányzó seed-érték (builder-alak változás): HANGOS kihagyás', () => {
    const eredmeny = alkalmazPressLogosFejlec({
      layout: [sajtoSzekcio(REGI_PRESS_FEJLEC)],
      ujFejlec: null,
    })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('buildHomeLayout')
  })

  it('a bemeneti szekciósort nem módosítja helyben', () => {
    const bemenet: Szekciosor = [sajtoSzekcio(REGI_PRESS_FEJLEC)]
    const lenyomat = stabilJson(bemenet)
    csere(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// 10. javítás — a „Három állapot” szekció bevezetője.
// ===========================================================================

describe('alkalmazAllapotokBevezeto', () => {
  /** Három állapot szekció a megadott bevezetővel. */
  const allapotSzekcio = (lead: string | null): Szekcio => ({
    blockType: 'states',
    id: 'st-1',
    title: 'Három állapot, egy folyamat',
    lead,
    cards: [{ id: 'k1', title: 'Zárt', text: 'Fájdalom, bizonytalanság.' }],
    sectionSettings: { visible: true, hatter: 'feher' },
  })

  const ujBevezeto = allapotokUjBevezeto()
  const csere = (layout: Page['layout']) => alkalmazAllapotokBevezeto({ layout, ujBevezeto })

  it('az ÚJ bevezető a kezdőlap seed-builderéből jön, és nem a régi szöveg', () => {
    expect(ujBevezeto).not.toBeNull()
    expect(ujBevezeto).not.toBe(REGI_ALLAPOTOK_BEVEZETO)
    // A szekció valódi állítása a TERÁPIA íve — így a szöveg akkor is helyes,
    // ha a szerkesztő a címet átírja.
    expect((ujBevezeto ?? '').toLowerCase()).toContain('terápia')
  })

  it('a régi seedelt szöveget lecseréli, a szekció többi mezőjét érintetlenül hagyja', () => {
    const hero = heroSzekcio()
    const eredmeny = csere([hero, allapotSzekcio(REGI_ALLAPOTOK_BEVEZETO)])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('allapotok-bevezeto')
    const blokk = eredmeny.layout?.[1]
    expect(blokk?.blockType === 'states' ? blokk.lead : null).toBe(ujBevezeto)
    expect(blokk?.blockType === 'states' ? blokk.title : null).toBe('Három állapot, egy folyamat')
    expect(blokk?.blockType === 'states' ? blokk.cards : null).toEqual([
      { id: 'k1', title: 'Zárt', text: 'Fájdalom, bizonytalanság.' },
    ])
    expect(eredmeny.layout?.[0]).toBe(hero)
  })

  it.each([
    ['üres szöveg', ''],
    ['csak whitespace', '   '],
    ['hiányzó bevezető', null],
  ])('ÜRES bevezetőt (%s) is kitölt — a három kép magyarázat nélkül érthetetlen', (_eset, lead) => {
    const eredmeny = csere([allapotSzekcio(lead)])

    expect(eredmeny.modositasok).toHaveLength(1)
    const blokk = eredmeny.layout?.[0]
    expect(blokk?.blockType === 'states' ? blokk.lead : null).toBe(ujBevezeto)
  })

  it('a szerkesztő saját bevezetőjéhez nem nyúl (csendes kihagyás)', () => {
    const eredmeny = csere([allapotSzekcio('Saját bevezető a szekcióhoz.')])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('a szerkesztő időközben átírta')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('idempotens: a már beírt új szöveget csendben kihagyja', () => {
    const elso = csere([allapotSzekcio(REGI_ALLAPOTOK_BEVEZETO)])
    const masodik = csere(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('állapot-szekció nélküli és üres szekciósornál indokolt (nem hangos) kihagyás', () => {
    const nincsSzekcio = csere([heroSzekcio()])
    expect(nincsSzekcio.layout).toBeNull()
    expect(nincsSzekcio.kihagyasok[0].indok).toContain('nincs „Három állapot”')
    expect(nincsSzekcio.kihagyasok[0].hangos).not.toBe(true)

    const ures = csere([])
    expect(ures.layout).toBeNull()
    expect(ures.kihagyasok[0].indok).toContain('nincs szekciósora')
  })

  it('hiányzó seed-érték (builder-alak változás): HANGOS kihagyás', () => {
    const eredmeny = alkalmazAllapotokBevezeto({
      layout: [allapotSzekcio(REGI_ALLAPOTOK_BEVEZETO)],
      ujBevezeto: null,
    })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('buildHomeLayout')
  })

  it('a bemeneti szekciósort nem módosítja helyben', () => {
    const bemenet: Szekciosor = [allapotSzekcio(REGI_ALLAPOTOK_BEVEZETO)]
    const lenyomat = stabilJson(bemenet)
    csere(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// 10b. javítás — a „Nyitott” kártya hibás igéje.
// ===========================================================================

describe('alkalmazAllapotokNyitottIge', () => {
  const allapotSzekcio = (nyitottSzoveg: string): Szekcio => ({
    blockType: 'states',
    id: 'st-ny',
    title: 'Három állapot, egy folyamat',
    lead: 'Bevezető.',
    cards: [
      { id: 'k1', title: 'Zárt', text: 'Fájdalom, bizonytalanság.' },
      { id: 'k3', title: 'Nyitott', text: nyitottSzoveg },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  })

  const ujSzoveg = allapotokUjNyitottSzoveg()
  const csere = (layout: Page['layout']) => alkalmazAllapotokNyitottIge({ layout, ujSzoveg })

  it('az ÚJ szöveg a seed-builderből jön, és dolgozhatsz, nem munkázhatsz', () => {
    expect(ujSzoveg).not.toBeNull()
    expect(ujSzoveg).toContain('Újra dolgozhatsz')
    expect((ujSzoveg ?? '').toLowerCase()).not.toContain('munkáz')
    expect(ujSzoveg).not.toBe(REGI_NYITOTT_KARTYA)
  })

  it('a régi, hibás igés mondatot lecseréli, a többi kártyát érintetlenül hagyja', () => {
    const eredmeny = csere([allapotSzekcio(REGI_NYITOTT_KARTYA)])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('allapotok-nyitott-ige')
    const blokk = eredmeny.layout?.[0]
    const kartyak = blokk?.blockType === 'states' ? blokk.cards : null
    expect(kartyak?.[0]?.text).toBe('Fájdalom, bizonytalanság.')
    expect(kartyak?.[1]?.text).toBe(ujSzoveg)
  })

  it('a szerkesztő saját kártyaszövegéhez nem nyúl', () => {
    const eredmeny = csere([allapotSzekcio('Saját, már átírt kártyaszöveg.')])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('a szerkesztő időközben átírta')
  })

  it('idempotens: a már beírt új szöveget csendben kihagyja', () => {
    const elso = csere([allapotSzekcio(REGI_NYITOTT_KARTYA)])
    const masodik = csere(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR')
  })

  it('hiányzó seed-érték: HANGOS kihagyás', () => {
    const eredmeny = alkalmazAllapotokNyitottIge({
      layout: [allapotSzekcio(REGI_NYITOTT_KARTYA)],
      ujSzoveg: null,
    })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('buildHomeLayout')
  })
})

// ===========================================================================
// 11. javítás — a kezdőlap záró CTA-sávja.
// ===========================================================================

describe('alkalmazZaroCta', () => {
  const seedBlokk = zaroCtaSeedBlokk()

  /** CTA-sáv a megadott szöveggel (a `text` szándékosan lehet üres vagy null). */
  const ctaSzekcio = (text: string | null): Szekcio => ({
    blockType: 'ctaBanner',
    id: 'cta-elo',
    title: 'Saját záró cím',
    text,
    cta: { felirat: 'Saját gomb', url: '/kurzusok', ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'tint' },
  })

  const csere = (layout: Page['layout']) => alkalmazZaroCta({ layout, seedBlokk })

  it('a záró sáv a seed-builderből jön, tartalmas szöveggel és belső CTA-val', () => {
    expect(seedBlokk).not.toBeNull()
    expect(seedBlokk?.title).toBe('Kezdd el még ma')
    expect((seedBlokk?.text ?? '').length).toBeGreaterThan(80)
    expect(seedBlokk?.cta?.url).toBe('/kurzusok')
  })

  it('CTA-sáv nélküli lapnál a szekciósor VÉGÉRE fűzi a seed-blokkot', () => {
    const hero = heroSzekcio()
    const kurzusok = kurzusSzekcio('Kurzusaink')
    const eredmeny = csere([hero, kurzusok])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('zaro-cta')
    expect(eredmeny.layout).toHaveLength(3)
    // A meglévő szekciók BITRE változatlanok (referencia-azonosak).
    expect(eredmeny.layout?.[0]).toBe(hero)
    expect(eredmeny.layout?.[1]).toBe(kurzusok)
    expect(eredmeny.layout?.[2]).toBe(seedBlokk)
  })

  it('idempotens: a hozzáfűzött sávot a második futás már nem duplázza', () => {
    const elso = csere([heroSzekcio()])
    const masodik = csere(elso.layout)

    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR van szövege')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it.each([
    ['üres szöveg', ''],
    ['csak whitespace', '   '],
    ['hiányzó szöveg', null],
  ])('meglévő, szöveg nélküli sávnál (%s) CSAK a szöveget írja be', (_eset, text) => {
    const eredmeny = csere([heroSzekcio(), ctaSzekcio(text)])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.layout).toHaveLength(2)
    const blokk = eredmeny.layout?.[1]
    if (blokk?.blockType !== 'ctaBanner') {
      throw new Error('A CTA-sáv eltűnt a szekciósorból.')
    }
    expect(blokk.text).toBe(seedBlokk?.text)
    // A cím, a gomb és a sávbeállítás a SZERKESZTŐÉ marad.
    expect(blokk.title).toBe('Saját záró cím')
    expect(blokk.cta).toEqual({ felirat: 'Saját gomb', url: '/kurzusok', ujAblakban: false })
    expect(blokk.sectionSettings).toEqual({ visible: true, hatter: 'tint' })
  })

  it('meglévő, SZÖVEGES sávhoz nem nyúl', () => {
    const eredmeny = csere([ctaSzekcio('Saját záró szöveg.')])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('sosem ír felül')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('TÖBB CTA-sávnál nem dönt: hangos kihagyás, írás nélkül', () => {
    const eredmeny = csere([ctaSzekcio(null), heroSzekcio(), ctaSzekcio(null)])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nem egyértelmű')
  })

  it('üres szekciósor és hiányzó seed-blokk: hangos kihagyás', () => {
    for (const layout of [undefined, null, [] as Szekciosor]) {
      const ures = csere(layout)
      expect(ures.layout).toBeNull()
      expect(ures.kihagyasok[0].hangos).toBe(true)
      expect(ures.kihagyasok[0].indok).toContain('nincs szekciósora')
    }

    const nincsSeed = alkalmazZaroCta({ layout: [heroSzekcio()], seedBlokk: null })
    expect(nincsSeed.layout).toBeNull()
    expect(nincsSeed.kihagyasok[0].hangos).toBe(true)
    expect(nincsSeed.kihagyasok[0].indok).toContain('buildHomeLayout')
  })

  it('szöveg nélküli seed-blokk: hangos kihagyás (indoklás nélküli felszólítás nem megy ki)', () => {
    if (seedBlokk === null) {
      throw new Error('A seed záró CTA-sávja hiányzik.')
    }
    const eredmeny = alkalmazZaroCta({
      layout: [heroSzekcio()],
      seedBlokk: { ...seedBlokk, text: '  ' },
    })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nincs szövege')
  })

  it('a bemeneti szekciósort nem módosítja helyben', () => {
    const bemenet: Szekciosor = [heroSzekcio(), ctaSzekcio(null)]
    const lenyomat = stabilJson(bemenet)
    csere(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// 12a. javítás (WP55) — a /szolgaltatasok fejléc-képe: a kezelőasztalos fotó.
// Egyetlen szabály a mezőre, az alkalmazRolunkHeroKep szemantikájával.
// ===========================================================================

describe('alkalmazSzolgaltatasokHeroKep', () => {
  const kezeloasztal = (id: number | null, forrasLetezik = true) => ({
    filename: SZOLGALTATASOK_HERO_FORRAS.filename,
    id,
    forrasLetezik,
  })

  it('a jóváhagyott forrás: pontos webp fájlnév, a megadott alt, a team mappából', () => {
    expect(SZOLGALTATASOK_HERO_FORRAS.filename).toBe('treatment-table-hands-1600.webp')
    expect(SZOLGALTATASOK_HERO_FORRAS.filePath).toBe(
      'public/media/team/treatment-table-hands-1600.webp',
    )
    expect(SZOLGALTATASOK_HERO_FORRAS.alt).toBe(
      'Csuklókezelés a kezelőasztalon a Kineticare rendelőjében.',
    )
  })

  it('a régi rendelő-fotóról a kezelőasztalos fotóra cserél, populált heroImage-nél is', () => {
    for (const jelenlegi of [55, mediaDokumentum(55, `${SZOLGALTATASOK_HERO_PREFIX}.webp`)]) {
      const eredmeny = alkalmazSzolgaltatasokHeroKep({
        jelenlegi,
        jelenlegiFajlnev: `${SZOLGALTATASOK_HERO_PREFIX}.webp`,
        ujMedia: kezeloasztal(77),
      })

      expect(eredmeny.heroImage).toBe(77)
      expect(eredmeny.modositasok).toHaveLength(1)
      expect(eredmeny.modositasok[0].szabaly).toBe('szolgaltatasok-hero-kep')
      expect(eredmeny.modositasok[0].indok).toBeNull()
      expect(eredmeny.modositasok[0].uzenet).toContain('/szolgaltatasok')
      expect(eredmeny.kihagyasok).toHaveLength(0)
    }
  })

  it('ÜRES fejléc-kép mezőt (a korábbi ürítés után is) a kezelőasztalos fotóval tölt ki', () => {
    for (const jelenlegi of [null, undefined]) {
      const eredmeny = alkalmazSzolgaltatasokHeroKep({
        jelenlegi,
        jelenlegiFajlnev: null,
        ujMedia: kezeloasztal(77),
      })

      expect(eredmeny.heroImage).toBe(77)
      expect(eredmeny.modositasok[0].uzenet).toContain('üres mező')
    }
  })

  it('idempotens: a kezelőasztalos fotót csendben kihagyja (azonosító vagy fájlnév alapján)', () => {
    const elso = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: 55,
      jelenlegiFajlnev: `${SZOLGALTATASOK_HERO_PREFIX}.webp`,
      ujMedia: kezeloasztal(77),
    })
    for (const bemenet of [
      { jelenlegi: elso.heroImage, jelenlegiFajlnev: SZOLGALTATASOK_HERO_FORRAS.filename },
      { jelenlegi: 5, jelenlegiFajlnev: SZOLGALTATASOK_HERO_FORRAS.filename },
    ]) {
      const masodik = alkalmazSzolgaltatasokHeroKep({ ...bemenet, ujMedia: kezeloasztal(77) })
      expect(masodik.heroImage).toBeNull()
      expect(masodik.modositasok).toHaveLength(0)
      expect(masodik.kihagyasok[0].hangos).toBe(false)
      expect(masodik.kihagyasok[0].indok).toContain('MÁR a kezelőasztalos fotó')
    }
  })

  it('a szerkesztő által választott képhez nem nyúl, és HANGOSAN naplózza', () => {
    const eredmeny = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: 99,
      jelenlegiFajlnev: 'sajat-rendelo-foto.webp',
      ujMedia: kezeloasztal(77),
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('sajat-rendelo-foto.webp')
    expect(eredmeny.kihagyasok[0].indok).toContain(SZOLGALTATASOK_HERO_PREFIX)
  })

  it('ha a fotó nincs a Médiatárban, de a forrás megvan: módosít, az azonosítót a futtató tölti ki', () => {
    const eredmeny = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: null,
      jelenlegiFajlnev: null,
      ujMedia: kezeloasztal(null, true),
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].uzenet).toContain('a repó fájljából hozza létre')
  })

  it('rekord és forrásfájl hiányában HANGOSAN kimarad; nem található rekordra mutató mező is hangos', () => {
    const hianyzo = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: 55,
      jelenlegiFajlnev: `${SZOLGALTATASOK_HERO_PREFIX}.webp`,
      ujMedia: kezeloasztal(null, false),
    })
    expect(hianyzo.heroImage).toBeNull()
    expect(hianyzo.modositasok).toHaveLength(0)
    expect(hianyzo.kihagyasok[0].hangos).toBe(true)
    expect(hianyzo.kihagyasok[0].indok).toContain(SZOLGALTATASOK_HERO_FORRAS.filePath)

    const szakadt = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: 99,
      jelenlegiFajlnev: null,
      ujMedia: kezeloasztal(77),
    })
    expect(szakadt.heroImage).toBeNull()
    expect(szakadt.kihagyasok[0].hangos).toBe(true)
    expect(szakadt.kihagyasok[0].indok).toContain('99')
  })
})

// ===========================================================================
// 12b. javítás — a /szolgaltatasok bevezető szekciója → üdvözlő blokk.
// ===========================================================================

describe('szolgaltatasokUjBevezetoBlokk — a régi bevezető BETŰHÍVEN az új blokkban', () => {
  const ujBlokk = szolgaltatasokUjBevezetoBlokk()
  const sorok = richTextSzoveg(szolgaltatasokRegiBevezetoTartalom()).split('\n')

  it('a seed-builder első blokkja üdvözlő (welcome) blokk', () => {
    expect(ujBlokk).not.toBeNull()
    expect(buildSzolgaltatasokLayout()[0].blockType).toBe('welcome')
  })

  it('a régi bevezető MINDEN szövege megvan az új blokkban, változtatás nélkül', () => {
    if (ujBlokk === null) {
      throw new Error('Az üdvözlő blokk hiányzik a seed-builderből.')
    }
    // Az örökölt tartalom: két címsor + öt bekezdés.
    expect(sorok).toHaveLength(7)

    const felsorolas = (ujBlokk.checklist ?? []).map((tetel) => tetel.text)
    const oldalso = (ujBlokk.sideParagraphs ?? []).map((tetel) => tetel.text)

    expect(ujBlokk.title).toBe(sorok[0])
    expect(oldalso[0]).toBe(sorok[1])
    expect(oldalso[1]).toBe(sorok[2])
    expect(ujBlokk.lead).toBe(sorok[3])
    expect(felsorolas[0]).toBe(sorok[4])
    expect(felsorolas[1]).toBe(sorok[5])
    // A régi ZÁRÓ bekezdés két tételre bomlik (elvi rész + módszertani rész) —
    // összefűzve byte-ra ugyanaz a mondatpár.
    expect(`${felsorolas[2]} ${oldalso[2]}`).toBe(sorok[6])
  })

  it('a tipográfia (magyar idézőjelek megmaradnak, töltelék gondolatjel nincs)', () => {
    if (ujBlokk === null) {
      throw new Error('Az üdvözlő blokk hiányzik a seed-builderből.')
    }
    const felsorolas = (ujBlokk.checklist ?? []).map((tetel) => tetel.text)
    const oldalso = (ujBlokk.sideParagraphs ?? []).map((tetel) => tetel.text)
    expect(ujBlokk.lead).toBe('Van megoldás, ha tudod, merre indulj')
    expect(felsorolas[0]).toContain(', és akár a műtét is elkerülhető')
    expect(felsorolas[1]).toContain('„szerkezet”')
    expect(oldalso[1]).toContain('mozgását, hosszú távú')
    expect(`${ujBlokk.lead} ${felsorolas.join(' ')} ${oldalso.join(' ')}`).not.toMatch(/[–—]/)
    expect(ujBlokk.lead).not.toContain(' - ')
  })

  it('pontosan EGY kiemelt oldalsó bekezdés van (a blokk admin-leírása szerint)', () => {
    const kiemelt = (ujBlokk?.sideParagraphs ?? []).filter((tetel) => tetel.emphasized === true)
    expect(kiemelt).toHaveLength(1)
    expect(kiemelt[0].text).toContain('professzionális kezeléseinkkel')
  })

  it('a szekció látható, fehér sávon áll', () => {
    expect(ujBlokk?.sectionSettings).toEqual({ visible: true, hatter: 'feher' })
  })
})

describe('alkalmazSzolgaltatasokBevezeto', () => {
  const ujBlokk = szolgaltatasokUjBevezetoBlokk()

  /** Az örökölt (welcome előtti) bevezető blokk, ahogy a seed tárolta. */
  const orokoltBevezeto = (): Szekcio =>
    ({
      blockType: 'richText',
      id: 'bevezeto-regi',
      content: szolgaltatasokRegiBevezetoTartalom(),
      sectionSettings: { visible: true, hatter: 'feher' },
    }) as Szekcio

  const csere = (layout: Page['layout']) =>
    alkalmazSzolgaltatasokBevezeto({
      layout,
      orokoltTartalom: szolgaltatasokRegiBevezetoTartalom(),
      ujBlokk,
    })

  it('a seedelt örökölt blokkot üdvözlő blokkra cseréli, a többi szekciót érintetlenül hagyva', () => {
    const utana = kurzusSzekcio('Kurzusaink')
    const eredmeny = csere([orokoltBevezeto(), utana])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('szolgaltatasok-bevezeto')
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(eredmeny.layout).toHaveLength(2)
    expect(eredmeny.layout?.[0]).toBe(ujBlokk)
    expect(eredmeny.layout?.[1]).toBe(utana)
  })

  it('a jsonb-féle kulcs-átrendezés NEM akadályozza a cserét', () => {
    const atrendezett = {
      ...orokoltBevezeto(),
      content: forditottKulcsrend(szolgaltatasokRegiBevezetoTartalom()),
    } as Szekcio
    const eredmeny = csere([atrendezett])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.layout?.[0].blockType).toBe('welcome')
  })

  it('szerkesztő által átírt bevezetőnél csendes, indokolt kihagyás', () => {
    const tartalom = structuredClone(szolgaltatasokRegiBevezetoTartalom()) as {
      root: { children: unknown[] }
    }
    tartalom.root.children.pop()
    const modositott = { ...orokoltBevezeto(), content: tartalom } as Szekcio
    const eredmeny = csere([modositott])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('a szerkesztő időközben átírta')
  })

  it('idempotens: ha az első blokk már üdvözlő blokk, csendes kihagyás', () => {
    const elsoKor = csere([orokoltBevezeto(), kurzusSzekcio('Kurzusaink')])
    expect(elsoKor.layout).not.toBeNull()
    const masodikKor = csere(elsoKor.layout)

    expect(masodikKor.layout).toBeNull()
    expect(masodikKor.modositasok).toHaveLength(0)
    expect(masodikKor.kihagyasok[0].hangos).not.toBe(true)
    expect(masodikKor.kihagyasok[0].indok).toContain('MÁR üdvözlő')
  })

  it('a seed-builder alapállapotán nincs teendő (a kód-szintű alap már helyes)', () => {
    const eredmeny = csere(buildSzolgaltatasokLayout())

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].indok).toContain('MÁR üdvözlő')
  })

  it('más típusú első blokk és üres szekciósor: hangos kihagyás, írás nélkül', () => {
    const masTipus = csere([kurzusSzekcio('Kurzusaink'), orokoltBevezeto()])
    expect(masTipus.layout).toBeNull()
    expect(masTipus.kihagyasok[0].hangos).toBe(true)
    expect(masTipus.kihagyasok[0].indok).toContain('nem a cserélendő richText')

    for (const layout of [undefined, null, [] as Szekciosor]) {
      const ures = csere(layout)
      expect(ures.layout).toBeNull()
      expect(ures.kihagyasok[0].hangos).toBe(true)
      expect(ures.kihagyasok[0].indok).toContain('nincs szekciósora')
    }
  })

  it('hiányzó új blokk (builder-alak változás): hangos kihagyás', () => {
    const eredmeny = alkalmazSzolgaltatasokBevezeto({
      layout: [orokoltBevezeto()],
      orokoltTartalom: szolgaltatasokRegiBevezetoTartalom(),
      ujBlokk: null,
    })

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('buildSzolgaltatasokLayout')
  })

  it('a bemeneti szekciósort nem módosítja helyben', () => {
    const bemenet: Szekciosor = [orokoltBevezeto()]
    const lenyomat = stabilJson(bemenet)
    csere(bemenet)
    expect(stabilJson(bemenet)).toBe(lenyomat)
  })
})

// ===========================================================================
// Lánc — a futtató EGY oldalra több javítást egymás után alkalmaz.
//
// A script a kezdőlap szekciósorát egyetlen frissítésben írja vissza, ezért a
// javítások LÁNCBAN futnak: mindegyik az előző eredményén dolgozik. Ez a két
// teszt azt méri, hogy a lánc (a) mind a négy javítást elvégzi egy élő-alakú
// szekciósoron, és (b) a MÁSODIK futásra már semmit nem módosít.
// ===========================================================================

describe('a kezdőlapi javítások lánca (1–2., 9., 10., 11.)', () => {
  /** Az ÉLES állapot alakja: a seed-layout a javítások ELŐTTI értékekkel. */
  const eloKezdolap = (): Szekciosor =>
    buildHomeLayout()
      .filter((blokk) => blokk.blockType !== 'ctaBanner')
      .map((blokk) => {
        if (blokk.blockType === 'courseCards') {
          return { ...blokk, heading: REGI_KURZUS_SZEKCIO_CIM }
        }
        if (blokk.blockType === 'about') {
          return {
            ...blokk,
            stats: (blokk.stats ?? []).map((sor) =>
              sor.value === UJ_PACIENS_ERTEK ? { ...sor, value: REGI_PACIENS_ERTEK } : sor,
            ),
          }
        }
        if (blokk.blockType === 'pressLogos') {
          return { ...blokk, heading: REGI_PRESS_FEJLEC }
        }
        if (blokk.blockType === 'states') {
          return {
            ...blokk,
            lead: REGI_ALLAPOTOK_BEVEZETO,
            cards: (blokk.cards ?? []).map((kartya) =>
              kartya.title === 'Nyitott' ? { ...kartya, text: REGI_NYITOTT_KARTYA } : kartya,
            ),
          }
        }
        if (blokk.blockType === 'howItWorks') {
          return {
            ...blokk,
            steps: (blokk.steps ?? []).map((lepes, index) =>
              index === 0 ? { ...lepes, text: HOW_IT_WORKS_STEP1_LEFTOVER } : lepes,
            ),
          }
        }
        return blokk
      })

  /** A futtató láncolása, adatbázis nélkül: layout + a lépések naplósorai. */
  const lanc = (
    kiindulas: Szekciosor,
  ): { layout: Szekciosor; modositasok: JavitasLepes[]; kihagyasok: JavitasLepes[] } => {
    const modositasok: JavitasLepes[] = []
    const kihagyasok: JavitasLepes[] = []
    let layout = kiindulas

    const alap = alkalmazKezdolapJavitasok(layout)
    modositasok.push(...alap.modositasok)
    kihagyasok.push(...alap.kihagyasok)
    layout = alap.layout

    const sajto = alkalmazPressLogosFejlec({ layout, ujFejlec: pressLogosUjFejlec() })
    modositasok.push(...sajto.modositasok)
    kihagyasok.push(...sajto.kihagyasok)
    if (sajto.layout !== null) {
      layout = sajto.layout
    }

    const allapotok = alkalmazAllapotokBevezeto({ layout, ujBevezeto: allapotokUjBevezeto() })
    modositasok.push(...allapotok.modositasok)
    kihagyasok.push(...allapotok.kihagyasok)
    if (allapotok.layout !== null) {
      layout = allapotok.layout
    }
    const nyitott = alkalmazAllapotokNyitottIge({
      layout,
      ujSzoveg: allapotokUjNyitottSzoveg(),
    })
    modositasok.push(...nyitott.modositasok)
    kihagyasok.push(...nyitott.kihagyasok)
    if (nyitott.layout !== null) {
      layout = nyitott.layout
    }
    const zaro = alkalmazZaroCta({ layout, seedBlokk: zaroCtaSeedBlokk() })
    modositasok.push(...zaro.modositasok)
    kihagyasok.push(...zaro.kihagyasok)
    if (zaro.layout !== null) {
      layout = zaro.layout
    }
    const how = alkalmazHowItWorksGondolatjel(layout)
    modositasok.push(...how.modositasok)
    kihagyasok.push(...how.kihagyasok)
    if (how.layout !== null) {
      layout = how.layout
    }

    return { layout, modositasok, kihagyasok }
  }

  it('egy futásban mind a HÉT javítást elvégzi, egymást nem ejtve el', () => {
    const elso = lanc(eloKezdolap())

    expect(elso.modositasok.map((lepes) => lepes.szabaly).sort()).toEqual([
      'allapotok-bevezeto',
      'allapotok-nyitott-ige',
      'howitworks-vasarlas-gondolatjel',
      'kurzus-szekcio-cim',
      'paciens-szam',
      'presslogos-fejlec',
      'zaro-cta',
    ])

    const kurzusok = elso.layout.find((blokk) => blokk.blockType === 'courseCards')
    expect(kurzusok?.blockType === 'courseCards' ? kurzusok.heading : null).toBe(
      UJ_KURZUS_SZEKCIO_CIM,
    )
    const howItWorks = elso.layout.find((blokk) => blokk.blockType === 'howItWorks')
    expect(howItWorks?.blockType === 'howItWorks' ? howItWorks.steps?.[0]?.text : null).toBe(
      HOW_IT_WORKS_STEP1_FIXED,
    )
    const sajto = elso.layout.find((blokk) => blokk.blockType === 'pressLogos')
    expect(sajto?.blockType === 'pressLogos' ? sajto.heading : null).toBe(pressLogosUjFejlec())
    const allapotok = elso.layout.find((blokk) => blokk.blockType === 'states')
    expect(allapotok?.blockType === 'states' ? allapotok.lead : null).toBe(allapotokUjBevezeto())
    const nyitottKartya =
      allapotok?.blockType === 'states'
        ? (allapotok.cards ?? []).find((kartya) => kartya.title === 'Nyitott')
        : null
    expect(nyitottKartya?.text).toBe(allapotokUjNyitottSzoveg())
    expect(elso.layout[elso.layout.length - 1].blockType).toBe('ctaBanner')
  })

  it('a MÁSODIK futás semmit nem módosít, és minden kihagyást megindokol', () => {
    const elso = lanc(eloKezdolap())
    const masodik = lanc(elso.layout)

    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.layout).toEqual(elso.layout)
    expect(masodik.kihagyasok.length).toBeGreaterThan(0)
    for (const kihagyas of masodik.kihagyasok) {
      expect(kihagyas.indok).not.toBeNull()
      // A második futásban egyetlen HANGOS (hiányzó előfeltétel) sor sincs.
      expect(kihagyas.hangos).not.toBe(true)
    }
  })
})

describe('a /szolgaltatasok javításainak lánca (8., 12b.)', () => {
  /** Az ÉLES állapot alakja: a seed-layout a javítások ELŐTTI értékekkel. */
  const eloSzolgaltatasok = (): Szekciosor =>
    buildSzolgaltatasokLayout().map((blokk, index) => {
      if (index === 0) {
        return {
          blockType: 'richText',
          id: 'bevezeto-regi',
          content: szolgaltatasokRegiBevezetoTartalom(),
          sectionSettings: { visible: true, hatter: 'feher' },
        } as Szekcio
      }
      if (blokk.sectionSettings?.anchorId === CLINIC_TREATMENTS_ANCHOR) {
        return { ...blokk, sectionSettings: { ...blokk.sectionSettings, anchorId: 'arlista' } }
      }
      return blokk
    })

  const lanc = (kiindulas: Szekciosor): { layout: Szekciosor; modositasok: JavitasLepes[] } => {
    const modositasok: JavitasLepes[] = []
    let layout = kiindulas

    const horgony = alkalmazRendeloiHorgony(layout)
    modositasok.push(...horgony.modositasok)
    if (horgony.layout !== null) {
      layout = horgony.layout
    }
    const bevezeto = alkalmazSzolgaltatasokBevezeto({
      layout,
      orokoltTartalom: szolgaltatasokRegiBevezetoTartalom(),
      ujBlokk: szolgaltatasokUjBevezetoBlokk(),
    })
    modositasok.push(...bevezeto.modositasok)
    if (bevezeto.layout !== null) {
      layout = bevezeto.layout
    }

    return { layout, modositasok }
  }

  it('a horgony-javítás és a bevezető cseréje egy futásban, egymást nem ejtve el', () => {
    const elso = lanc(eloSzolgaltatasok())

    expect(elso.modositasok.map((lepes) => lepes.szabaly).sort()).toEqual([
      'rendeloi-horgony',
      'szolgaltatasok-bevezeto',
    ])
    expect(elso.layout[0].blockType).toBe('welcome')
    expect(
      elso.layout.some((blokk) => blokk.sectionSettings?.anchorId === CLINIC_TREATMENTS_ANCHOR),
    ).toBe(true)
    // A lánc eredménye a kód-szintű alapállapottal egyezik (a seed-builder és a
    // javítás nem csúszhat szét).
    expect(stabilJson(elso.layout)).toBe(stabilJson(buildSzolgaltatasokLayout()))
  })

  it('a MÁSODIK futás semmit nem módosít', () => {
    const elso = lanc(eloSzolgaltatasok())
    const masodik = lanc(elso.layout)

    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.layout).toEqual(elso.layout)
  })
})

/**
 * 16. javítás — a /kapcsolat lap HIÁNYZÓ szekciói.
 * A /kapcsolat dedikált Next.js-route, de a szekciósorát az ilyen slugú
 * CMS-oldalról olvassa. A seed (`ensurePageLayout`) MEGLÉVŐ szekciósort sosem
 * ír felül, ezért az élő lapon ma egyetlen szekció sincs — a tulajdonos kérése
 * („lányok elérhetősége kell a kapcsolat menüpontba is") kód-szinten teljesül,
 */
describe('alkalmazKapcsolatSzakemberek — a /kapcsolat hiányzó szekciói', () => {
  const seed = () => kapcsolatSeedBlokkok({ kocsisPortre: 31, kissPortre: 32 })

  const futtat = (layout: Page['layout']) => {
    const blokkok = seed()
    return alkalmazKapcsolatSzakemberek({
      layout,
      idopontkeresBlokk: blokkok.idopontkeres,
      szakemberBlokk: blokkok.szakemberek,
    })
  }

  it('a seed-builderből pontosan egy időpontkérő és egy szakember-szekció jön', () => {
    const blokkok = seed()
    expect(blokkok.idopontkeres?.blockType).toBe('appointment')
    expect(blokkok.szakemberek?.blockType).toBe('teamMembers')
    // A portrék tényleg átmennek a builderen (a javítás futásidőben oldja fel).
    if (blokkok.szakemberek?.blockType !== 'teamMembers') {
      throw new Error('A seed-builder nem adott szakember-szekciót.')
    }
    expect((blokkok.szakemberek.members ?? []).map((tag) => tag.photo)).toEqual([31, 32])
  })

  it('(a) ÜRES szekciósorba beszúrja mindkét szekciót, időpontkérő → szakemberek sorrendben', () => {
    const eredmeny = futtat([])

    expect(eredmeny.modositasok).toHaveLength(2)
    expect(eredmeny.modositasok.every((lepes) => lepes.szabaly === 'kapcsolat-szakemberek')).toBe(
      true,
    )
    expect(eredmeny.layout?.map((blokk) => blokk.blockType)).toEqual(['appointment', 'teamMembers'])
    // A beszúrt sor a kód-szintű alapállapottal egyezik.
    expect(stabilJson(eredmeny.layout)).toBe(
      stabilJson(buildKapcsolatLayout({ kocsisPortre: 31, kissPortre: 32 })),
    )
  })

  it('(a) hiányzó szekciósor (null/undefined) ugyanígy viselkedik', () => {
    for (const ures of [null, undefined]) {
      const eredmeny = futtat(ures)
      expect(eredmeny.modositasok).toHaveLength(2)
      expect(eredmeny.layout?.map((blokk) => blokk.blockType)).toEqual([
        'appointment',
        'teamMembers',
      ])
    }
  })

  it('(b) IDEMPOTENS: a második futás nulla módosítást ad, és nem ír', () => {
    const elso = futtat([])
    // A Payload a mentéskor minden blokkhoz és tömb-sorhoz `id`-t generál — az
    // élő visszaolvasás ezért SOSEM byte-azonos a kódból épített blokkal. A
    // második futás EZT az alakot kapja, mégsem szabad módosítania.
    const mentettAlak: Szekciosor = (elso.layout ?? []).map((blokk, index) => ({
      ...blokk,
      id: `blokk-${index}`,
      ...(blokk.blockType === 'teamMembers'
        ? {
            members: (blokk.members ?? []).map((tag, tagIndex) => ({
              ...tag,
              id: `tag-${tagIndex}`,
            })),
          }
        : {}),
    })) as Szekciosor

    const masodik = futtat(mentettAlak)

    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.layout).toBeNull()
    expect(masodik.kihagyasok).toHaveLength(2)
    expect(masodik.kihagyasok.every((lepes) => lepes.hangos !== true)).toBe(true)
    expect(masodik.kihagyasok.map((lepes) => lepes.indok).join(' ')).toContain('MÁR ott van')
  })

  it('(c) a szerkesztő SAJÁT szakember-szekcióját nem duplikálja — hangos kihagyás', () => {
    const sajat: Szekcio = {
      blockType: 'teamMembers',
      id: 'szerkesztoi',
      title: 'A rendelő csapata',
      members: [{ id: 'x1', name: 'Nagy Anna' }],
      sectionSettings: { visible: true, hatter: 'feher' },
    } as Szekcio
    const idopont = seed().idopontkeres
    if (idopont === null) {
      throw new Error('A seed-builder nem adott időpontkérő szekciót.')
    }

    const eredmeny = futtat([idopont, sajat])

    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.layout).toBeNull()
    const hangos = eredmeny.kihagyasok.filter((lepes) => lepes.hangos === true)
    expect(hangos).toHaveLength(1)
    expect(hangos[0].indok).toContain('Nagy Anna')
    expect(hangos[0].indok).toContain('nem duplikáljuk')
  })

  it('(d) csak a szakember-szekció hiányzik → csak azt szúrja be, az időpontkérő UTÁN', () => {
    const idopont = seed().idopontkeres
    if (idopont === null) {
      throw new Error('A seed-builder nem adott időpontkérő szekciót.')
    }
    const idegen: Szekcio = {
      blockType: 'richText',
      id: 'szerkesztoi-szoveg',
      content: richText([para('A szerkesztő saját szakasza.')]),
      sectionSettings: { visible: true, hatter: 'feher' },
    } as Szekcio

    const eredmeny = futtat([idegen, idopont])

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.layout?.map((blokk) => blokk.blockType)).toEqual([
      'richText',
      'appointment',
      'teamMembers',
    ])
    // A szerkesztő blokkja VÁLTOZATLAN objektum-referenciaként megy tovább.
    expect(eredmeny.layout?.[0]).toBe(idegen)
  })

  it('a seed-builder alakjának elcsúszása HANGOS kihagyás, írás nélkül', () => {
    const eredmeny = alkalmazKapcsolatSzakemberek({
      layout: [],
      idopontkeresBlokk: null,
      szakemberBlokk: null,
    })
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
  })

  it('a szakmai háttér horgonya egyezik a 5. javításéval (nem csúszhatnak szét)', () => {
    // A seed-builder a /rolunk harmonikájára mutat; a horgony nevét az 5.
    // javítás konstansa (SZAKMAI_HATTER_HORGONY) is ismeri.
    expect(SZAKMAI_HATTER_URL).toBe(`/rolunk#${SZAKMAI_HATTER_HORGONY}`)
    const szakemberek = seed().szakemberek
    if (szakemberek?.blockType !== 'teamMembers') {
      throw new Error('A seed-builder nem adott szakember-szekciót.')
    }
    for (const tag of szakemberek.members ?? []) {
      expect(tag.link?.url).toBe(SZAKMAI_HATTER_URL)
    }
  })
})
