import { describe, expect, it } from 'vitest'

import {
  ASZF_HELYKITOLTO_BEKEZDES,
  ASZF_JAVITOTT_BEKEZDES,
  KURZUSLISTA_JOVAHAGYOTT_FELIRAT,
  KURZUS_ELONYOK,
  REGI_ALLAPOTOK_BEVEZETO,
  REGI_KURZUS_SZEKCIO_CIM,
  REGI_PACIENS_ERTEK,
  REGI_PRESS_FEJLEC,
  SOS_KURZUS_SLUG,
  SZAKMAI_HATTER_HORGONY,
  SZOLGALTATASOK_HERO_PREFIX,
  UJ_KURZUS_SZEKCIO_CIM,
  UJ_PACIENS_ERTEK,
  alkalmazAllapotokBevezeto,
  alkalmazAszfAdatvedelemLink,
  alkalmazJogiOldalak,
  alkalmazKapcsolatSzakemberek,
  alkalmazKezdolapJavitasok,
  alkalmazKurzuslistaFeliratok,
  alkalmazKurzusElonyok,
  alkalmazPressLogosFejlec,
  alkalmazRendeloiHorgony,
  alkalmazRolunkHeroKep,
  alkalmazSosIngyenesJelolo,
  alkalmazSosKurzusSlug,
  alkalmazSzakmaiHarmonika,
  alkalmazSzolgaltatasokBevezeto,
  alkalmazSzolgaltatasokHeroKep,
  alkalmazZaroCta,
  allapotokUjBevezeto,
  heroKepAzonosito,
  kapcsolatSeedBlokkok,
  pressLogosUjFejlec,
  rolunkSzakmaiUjBlokkok,
  stabilJson,
  szolgaltatasokUjBevezetoBlokk,
  zaroCtaSeedBlokk,
  type JavitasLepes,
} from '../scripts/apply-owner-content'
import { buildHomeLayout } from '../lib/home-seed'
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
import {
  CLINIC_TREATMENTS_ANCHOR,
  CLINIC_TREATMENTS_PATH,
  SOS_COURSE_SKU,
} from '../lib/menu-seed'
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
  it('a szóló portréról a páros csapatfotóra cserél', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 41,
      regiMediaId: 41,
      ujMediaId: 77,
    })

    expect(eredmeny.heroImage).toBe(77)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('rolunk-hero-kep')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('populált (depth > 0) heroImage esetén is felismeri a szóló portrét', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: mediaDokumentum(41, '682a121babe80_IMG_7573.webp'),
      regiMediaId: 41,
      ujMediaId: 77,
    })

    expect(eredmeny.heroImage).toBe(77)
  })

  it('MÁS képre mutató fejléc-képhez nem nyúl, és indokkal naplózza', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 99,
      regiMediaId: 41,
      ujMediaId: 77,
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('csak pontos egyezésnél')
    expect(eredmeny.kihagyasok[0].hangos).toBe(false)
  })

  it('ÜRES fejléc-kép mezőt nem tölt ki', () => {
    for (const jelenlegi of [null, undefined]) {
      const eredmeny = alkalmazRolunkHeroKep({ jelenlegi, regiMediaId: 41, ujMediaId: 77 })

      expect(eredmeny.heroImage).toBeNull()
      expect(eredmeny.kihagyasok[0].indok).toContain('nincs fejléc-képe')
    }
  })

  it('a páros csapatfotó hiányában HANGOSAN hagyja ki a lépést', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 41,
      regiMediaId: 41,
      ujMediaId: null,
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('katak-team')
  })

  it('a szóló portré média-rekordjának hiányában is hangosan kimarad', () => {
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: 99,
      regiMediaId: null,
      ujMediaId: 77,
    })

    expect(eredmeny.heroImage).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('682a121babe80_IMG_7573')
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
    const elso = alkalmazRolunkHeroKep({ jelenlegi: 41, regiMediaId: 41, ujMediaId: 77 })
    expect(elso.heroImage).toBe(77)

    const masodik = alkalmazRolunkHeroKep({
      jelenlegi: elso.heroImage,
      regiMediaId: 41,
      ujMediaId: 77,
    })

    expect(masodik.heroImage).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
    expect(masodik.kihagyasok[0].hangos).toBe(false)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR a páros csapatfotó')
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
    const tartalom = structuredClone(rolunkSzakmaiOrokoltTartalom()) as { root: { children: unknown[] } }
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
  ])('ÜRES feliratot (%s) NEM tölt ki — a komponens fallbackje már az új szöveg', (_eset, heading) => {
    const eredmeny = csere([sajtoSzekcio(heading)])

    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('ÜRES')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

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
// 12a. javítás — a /szolgaltatasok fejléc-képének ürítése.
// ===========================================================================

describe('alkalmazSzolgaltatasokHeroKep', () => {
  it('a rendelő-fotóra mutató mezőt üríti', () => {
    const eredmeny = alkalmazSzolgaltatasokHeroKep({ jelenlegi: 55, regiMediaId: 55 })

    expect(eredmeny.uritendo).toBe(true)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('szolgaltatasok-hero-kep')
    expect(eredmeny.modositasok[0].indok).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('populált (depth > 0) heroImage esetén is felismeri a rendelő-fotót', () => {
    const eredmeny = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: mediaDokumentum(55, `${SZOLGALTATASOK_HERO_PREFIX}.webp`),
      regiMediaId: 55,
    })

    expect(eredmeny.uritendo).toBe(true)
  })

  it('MÁS képhez nem nyúl (csendes kihagyás)', () => {
    const eredmeny = alkalmazSzolgaltatasokHeroKep({ jelenlegi: 99, regiMediaId: 55 })

    expect(eredmeny.uritendo).toBe(false)
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].indok).toContain('csak pontos egyezésnél')
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('idempotens: üres mezőn nincs mit üríteni', () => {
    for (const jelenlegi of [null, undefined]) {
      const eredmeny = alkalmazSzolgaltatasokHeroKep({ jelenlegi, regiMediaId: 55 })

      expect(eredmeny.uritendo).toBe(false)
      expect(eredmeny.kihagyasok[0].indok).toContain('MÁR nincs fejléc-képe')
      expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
    }
  })

  it('a rendelő-fotó média-rekordjának hiányában HANGOSAN hagyja ki', () => {
    const eredmeny = alkalmazSzolgaltatasokHeroKep({ jelenlegi: 99, regiMediaId: null })

    expect(eredmeny.uritendo).toBe(false)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain(SZOLGALTATASOK_HERO_PREFIX)
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

  it('a tipográfia (félkvirtmínusz és magyar idézőjelek) betűhíven marad', () => {
    if (ujBlokk === null) {
      throw new Error('Az üdvözlő blokk hiányzik a seed-builderből.')
    }
    const felsorolas = (ujBlokk.checklist ?? []).map((tetel) => tetel.text)
    expect(ujBlokk.lead).toContain('–')
    expect(felsorolas[0]).toContain('–')
    expect(felsorolas[1]).toContain('„szerkezet”')
    // Kötőjeles pótlás sehol nem csúszott be a félkvirtmínusz helyére.
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
          return { ...blokk, lead: REGI_ALLAPOTOK_BEVEZETO }
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
    const zaro = alkalmazZaroCta({ layout, seedBlokk: zaroCtaSeedBlokk() })
    modositasok.push(...zaro.modositasok)
    kihagyasok.push(...zaro.kihagyasok)
    if (zaro.layout !== null) {
      layout = zaro.layout
    }

    return { layout, modositasok, kihagyasok }
  }

  it('egy futásban mind az ÖT javítást elvégzi, egymást nem ejtve el', () => {
    const elso = lanc(eloKezdolap())

    expect(elso.modositasok.map((lepes) => lepes.szabaly).sort()).toEqual([
      'allapotok-bevezeto',
      'kurzus-szekcio-cim',
      'paciens-szam',
      'presslogos-fejlec',
      'zaro-cta',
    ])

    const kurzusok = elso.layout.find((blokk) => blokk.blockType === 'courseCards')
    expect(kurzusok?.blockType === 'courseCards' ? kurzusok.heading : null).toBe(
      UJ_KURZUS_SZEKCIO_CIM,
    )
    const sajto = elso.layout.find((blokk) => blokk.blockType === 'pressLogos')
    expect(sajto?.blockType === 'pressLogos' ? sajto.heading : null).toBe(pressLogosUjFejlec())
    const allapotok = elso.layout.find((blokk) => blokk.blockType === 'states')
    expect(allapotok?.blockType === 'states' ? allapotok.lead : null).toBe(allapotokUjBevezeto())
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
    expect(eredmeny.layout?.map((blokk) => blokk.blockType)).toEqual([
      'appointment',
      'teamMembers',
    ])
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
