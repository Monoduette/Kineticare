import type { ArrayField, Block, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  about,
  courseCards,
  faq,
  knowledge,
  pageBlocks,
  pageBlockSlugs,
  pressLogos,
  SECTION_SOURCE_FIELD_NAME,
  services,
} from '../blocks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SECTION_SETTINGS_LABEL } from '../blocks/section-settings'
import { HORGONY_ELOTAG } from '../components/editor/frontend/szerkeszto-szalag'
import { BLOKK_ID_MINTA } from '../components/editor/szekcio-melylink'
import {
  FREE_SOS_NEUTRAL_TITLE,
  FREE_SOS_STRIP_TITLE,
  freeSosStripTitle,
} from '../lib/free-sos-title'
import {
  arrayRowLabel,
  BEEPITETT_CIM,
  describeSection,
  encodeTextFragment,
  isCourseTarget,
  kapcsolatiUresLista,
  KAPCSOLAT_OLDAL_SLUG,
  kotottUgropont,
  lexicalFirstText,
  LAP_TETEJE_MAGYARAZAT,
  NINCS_CIME,
  REJTETT_CIM,
  REJTETT_MAGYARAZAT,
  REJTETT_TEENDO,
  REJTVE_JEL,
  SECTION_TITLE_MAX_LENGTH,
  SECTION_TITLE_SOURCES,
  sectionLabel,
  sectionNoticeModel,
  sectionRepeatOrdinals,
  sectionRowLabelText,
  sectionSource,
  sectionTitle,
  sectionViewLink,
  SOS_KURZUS_SLUG,
  SZEKCIO_HORGONY_ELOTAG,
  truncateAtWord,
  hiddenHint,
  nevelo,
  visibleTwin,
} from '../lib/section-row-label'
import type { Page } from '../payload-types'

/**
 * A szekciósor-címkék és forrás-jelzések őre (K26, modul-térkép H01–H03, H13,
 * H30, H36).
 *
 * A fixture-ök az ÉLŐ adat alakját követik (az éles /api/pages válasza,
 * 2026-09-22; az élőben nem használt usps és states blokk a helyi
 * kezdőlapról), a hosszú szövegek rövidítve, a képek azonosítóként: az admin
 * űrlapállapota is így adja őket.
 */

const lexical = (...blocks: { type: string; tag?: string; text: string }[]): unknown => ({
  root: {
    type: 'root',
    children: blocks.map((block) => ({
      type: block.type,
      ...(block.tag ? { tag: block.tag } : {}),
      children: [{ type: 'text', text: block.text }],
    })),
  },
})

const settings = (extra: Record<string, unknown> = {}) => ({
  visible: true,
  anchorId: null,
  hatter: 'feher',
  ...extra,
})

interface EloLap {
  id: number
  slug: string
  title: string
  layout: NonNullable<Page['layout']>
}

/** Az élő szekciósor (2026-09-22), a szerkeszto-szalag.test.tsx-szel közös fixture. */
const ELO: Readonly<Record<string, EloLap>> = JSON.parse(
  readFileSync(
    join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/elo-szekciosorok-2026-09-22.json'),
    'utf8',
  ),
) as Record<string, EloLap>

/** Mind a 19 blokktípus élő alakja, a várt címmel. */
const FIXTURES: readonly { data: Record<string, unknown>; label: string; cim: string }[] = [
  {
    label: 'Film-hero (kéznyitás)',
    // 64 karakter: a sorcímke 60-nál szóhatáron vág.
    cim: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai…',
    data: {
      blockType: 'filmHero',
      title: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
      lead: 'Professzionális, mégis emberközeli terápiás megoldásokkal kezeljük…',
      blockName: null,
      tags: [{ label: 'Kéz' }, { label: 'Csukló' }],
      ctas: [{ felirat: 'Nézd meg a kurzusokat', url: '/kurzusok', ujAblakban: false }],
      sectionSettings: { visible: true, anchorId: null },
    },
  },
  {
    label: 'Hitel-csík (szöveges)',
    cim: 'Gyógytornász és manuálterapeuta szakmai háttér',
    data: {
      blockType: 'credsStrip',
      blockName: null,
      items: [
        { text: 'Gyógytornász és manuálterapeuta szakmai háttér' },
        { text: 'Sportolók és olimpikonok is fordulnak hozzánk' },
      ],
      link: { felirat: 'Bővebben a szakmai hátterünkről', url: '/rolunk', ujAblakban: false },
      sectionSettings: settings(),
    },
  },
  {
    label: 'Kurzuskártyák (automatikus)',
    cim: 'Kurzusaink',
    data: {
      blockType: 'courseCards',
      eyebrow: null,
      heading: 'Kurzusaink',
      lead: 'Online kézrehabilitációs kurzusaink lépésről lépésre vezetnek…',
      ctaLabel: null,
      blockName: null,
      sectionSettings: settings({ anchorId: 'kurzusok' }),
    },
  },
  {
    label: 'Ingyenes SOS-sáv',
    cim: 'SOS Kézrelax — ingyenes villámkurzus',
    data: {
      blockType: 'freeSos',
      title: 'SOS Kézrelax — ingyenes villámkurzus',
      body: 'Ha előbb kipróbálnád a módszert…',
      backgroundImage: 31,
      blockName: null,
      cta: { felirat: 'Elindítom az ingyenes kurzust', url: '/kurzusok', ujAblakban: false },
      sectionSettings: settings({ anchorId: 'ingyenes', hatter: 'tint' }),
    },
  },
  {
    label: 'Sajtó-logósor',
    cim: 'Partnereink',
    data: {
      blockType: 'pressLogos',
      heading: 'Partnereink',
      blockName: null,
      logos: [{ image: 34, alt: null, url: null, ujAblakban: false }],
      sectionSettings: settings({ anchorId: 'partnereink' }),
    },
  },
  {
    label: 'Üdvözlő / probléma-blokk',
    cim: 'Fáj a kezed, a csuklód, a könyököd vagy a vállad?',
    data: {
      blockType: 'welcome',
      title: 'Fáj a kezed, a csuklód, a könyököd vagy a vállad?',
      lead: 'Segítünk megtalálni a következő lépést.',
      blockName: null,
      checklist: [{ text: 'Személyes kezelésen megvizsgálunk…' }],
      sideParagraphs: [{ text: 'Tudjuk, mennyire megnehezíthetik…', emphasized: false }],
      sectionSettings: settings(),
    },
  },
  {
    label: '„Erre számíthatsz" kártyák',
    cim: 'Erre számíthatsz velünk',
    data: {
      blockType: 'usps',
      title: 'Erre számíthatsz velünk',
      blockName: null,
      cards: [{ title: 'A legújabb, tudományosan megalapozott módszereket alkalmazzuk' }],
      sectionSettings: settings(),
    },
  },
  {
    label: 'Három állapot',
    cim: 'Három állapot, egy folyamat',
    data: {
      blockType: 'states',
      title: 'Három állapot, egy folyamat',
      lead: 'A terápia íve három képben…',
      blockName: null,
      cards: [{ image: 1, number: null, title: 'Zárt', text: 'Fájdalom, bizonytalanság…' }],
      sectionSettings: settings(),
    },
  },
  {
    label: 'Szolgáltatás-sorok',
    cim: 'Így segítünk',
    data: {
      blockType: 'services',
      eyebrow: 'Szolgáltatásaink',
      title: 'Így segítünk',
      lead: null,
      elrendezes: 'tabla',
      image: 12,
      blockName: null,
      rows: [
        {
          number: '01',
          title: 'Rendelői kezelések',
          osszefoglalo: null,
          body: 'Akut sérülés, műtét utáni állapot…',
          photo: null,
          felirat: 'Időpontot kérek',
          url: '/kapcsolat',
          ujAblakban: false,
        },
      ],
      sectionSettings: settings({ anchorId: 'szolgaltatasaink' }),
    },
  },
  {
    label: 'Rólunk + statisztikák',
    cim: 'Így lett a kéz a szakterületünk',
    data: {
      blockType: 'about',
      eyebrow: 'Rólunk',
      title: 'Így lett a kéz a szakterületünk',
      photo: 12,
      blockName: null,
      paragraphs: [{ text: 'A Kineticare két gyógytornász közös praxisa…', emphasized: true }],
      stats: [{ value: '10+', label: 'év szakmai tapasztalat' }],
      feature: { label: 'Szakmai egyesületi tagság', note: 'A Magyar Sportrehabilitációs…' },
      sectionSettings: settings({ anchorId: 'rolunk' }),
    },
  },
  {
    label: 'Így működik (lépések)',
    cim: 'Így működik az online kurzus',
    data: {
      blockType: 'howItWorks',
      title: 'Így működik az online kurzus',
      blockName: null,
      steps: [{ title: 'Kiválasztod a kurzust', text: 'A panaszodhoz illő programot…' }],
      sectionSettings: settings(),
    },
  },
  {
    label: 'Vélemények (automatikus)',
    cim: 'Pácienseink mondták',
    data: {
      blockType: 'testimonials',
      eyebrow: 'Vélemények',
      heading: 'Pácienseink mondták',
      maxItems: 3,
      blockName: null,
      sectionSettings: settings({ anchorId: 'velemenyek' }),
    },
  },
  {
    label: 'Tudástár-ajánló (automatikus)',
    cim: 'Legfrissebb a tudástárból',
    data: {
      blockType: 'knowledge',
      heading: 'Legfrissebb a tudástárból',
      limit: 3,
      blockName: null,
      sectionSettings: settings(),
    },
  },
  {
    label: 'GYIK (gyakori kérdések)',
    cim: 'Gyakori kérdések',
    data: {
      blockType: 'faq',
      heading: 'Gyakori kérdések',
      blockName: null,
      items: [
        {
          question: 'Online kurzust vagy személyes kezelést válasszak?',
          answer: 'A kurzus előre összeállított gyakorlatsorokat ad…',
        },
      ],
      sectionSettings: settings(),
    },
  },
  {
    label: 'Szakértő-kártyák',
    cim: 'Beszéljünk',
    data: {
      blockType: 'teamMembers',
      eyebrow: 'Közvetlen elérhetőség',
      title: 'Beszéljünk',
      lead: 'Az időpontkérésre két munkanapon belül telefonálunk…',
      blockName: null,
      members: [{ photo: 5, name: 'Kocsis Kata', role: 'Gyógytornász…', cvSections: [] }],
      sectionSettings: settings({ anchorId: 'elerhetoseg' }),
    },
  },
  {
    label: 'Nyitható szekció',
    cim: 'Részletes szakmai háttér',
    data: {
      blockType: 'accordion',
      eyebrow: 'Szakmai háttér',
      title: 'Részletes szakmai háttér',
      lead: 'A teljes szakmai életutunk…',
      blockName: null,
      items: [{ kep: 5, cim: 'Kocsis Kata szakmai önéletrajza', osszefoglalo: '38 tanfolyam' }],
      sectionSettings: settings({ anchorId: 'szakmai-hatter' }),
    },
  },
  {
    label: 'Időpontkérő szekció',
    cim: 'Kérj időpontot a rendelőbe',
    data: {
      blockType: 'appointment',
      eyebrow: 'Rendelői kezelés',
      title: 'Kérj időpontot a rendelőbe',
      urlapMutatasa: true,
      urlapCim: 'Időpontkérés',
      blockName: null,
      idopontSavok: [{ felirat: 'Hétköznap délelőtt' }],
      sectionSettings: settings({ anchorId: 'idopontkeres', hatter: 'tint' }),
    },
  },
  {
    label: 'Szabad szöveg',
    cim: 'Rendelői kezelések',
    data: {
      blockType: 'richText',
      content: lexical(
        { type: 'heading', tag: 'h2', text: 'Rendelői kezelések' },
        { type: 'paragraph', text: 'Személyes vizsgálat után gyógytornával…' },
      ),
      blockName: null,
      sectionSettings: settings({ anchorId: 'rendeloi' }),
    },
  },
  {
    label: 'CTA-sáv (gombos kiemelés)',
    cim: 'Kezdd el otthon, a saját tempódban',
    data: {
      blockType: 'ctaBanner',
      title: 'Kezdd el otthon, a saját tempódban',
      text: 'Az otthoni programunkkal a saját tempódban haladhatsz…',
      blockName: null,
      cta: { felirat: 'Megnézem a kurzusokat', url: '/kurzusok', ujAblakban: false },
      sectionSettings: settings({ hatter: 'tint' }),
    },
  },
]

describe('sorcímke: mind a 19 blokktípus az élő adat alakjával', () => {
  it('a fixture-ök lefedik a teljes katalógust, és a cím-térkép is', () => {
    const tipusok = FIXTURES.map((fixture) => fixture.data.blockType)
    expect([...tipusok].sort()).toEqual([...pageBlockSlugs].sort())
    expect(Object.keys(SECTION_TITLE_SOURCES).sort()).toEqual([...pageBlockSlugs].sort())
  })

  it.each(FIXTURES.map((fixture, index) => [fixture.data.blockType, fixture, index] as const))(
    '%s: „NN · típus: cím” alakú, a szekció saját címével',
    (_tipus, fixture, index) => {
      const leiras = describeSection(fixture.data, index, fixture.label)
      expect(leiras.cim).toBe(fixture.cim)
      const szoveg = sectionRowLabelText(leiras)
      expect(szoveg).toBe(
        `${String(index + 1).padStart(2, '0')} · ${fixture.label}: ${fixture.cim}`,
      )
      expect(szoveg).not.toContain('Névtelen')
    },
  )
})

describe('az élő kezdőlap összetéveszthető sorai', () => {
  const rolunk = FIXTURES.find((fixture) => fixture.data.blockType === 'about')!
  const masodik = {
    ...rolunk.data,
    title: 'Megérdemled a profi törődést',
    blockName: 'Rövid bemutatkozás',
  }
  const tizenegyedik = {
    ...rolunk.data,
    title: 'Megérdemled a profi törődést',
    blockName: null,
    sectionSettings: settings({ visible: false }),
  }

  it('a rejtett 11. sor SZÖVEGES „Rejtve” jelet visel, a 2. a régi blokknevét', () => {
    expect(sectionRowLabelText(describeSection(masodik, 1, rolunk.label))).toBe(
      '02 · Rólunk + statisztikák: Megérdemled a profi törődést (Rövid bemutatkozás)',
    )
    const rejtett = describeSection(tizenegyedik, 10, rolunk.label)
    expect(rejtett.rejtett).toBe(true)
    expect(sectionRowLabelText(rejtett)).toBe(
      `11 · ${REJTVE_JEL} · Rólunk + statisztikák: Megérdemled a profi törődést`,
    )
  })

  it('az azonos típusú, című és nevű sorok „(1. ilyen)”, „(2. ilyen)” jelet kapnak', () => {
    const iker = { ...masodik, blockName: null }
    const sorok = [FIXTURES[0]!.data, iker, FIXTURES[1]!.data, tizenegyedik]
    expect(sectionRepeatOrdinals(sorok)).toEqual([null, 1, null, 2])
    const leiras = { ...describeSection(tizenegyedik, 3, rolunk.label), ismetles: 2 }
    expect(sectionRowLabelText(leiras)).toBe(
      `04 · ${REJTVE_JEL} · Rólunk + statisztikák: Megérdemled a profi törődést (2. ilyen)`,
    )
  })

  it('a blokknév különbsége már elég: nincs ismétlés-jel', () => {
    expect(sectionRepeatOrdinals([masodik, tizenegyedik])).toEqual([null, null])
  })

  it('a két Szolgáltatás-sor a címéről különbözik', () => {
    const sin = { ...FIXTURES[8]!.data, title: 'Így tudunk segíteni' }
    const tabla = { ...FIXTURES[8]!.data, title: 'Erre számíthatsz velünk' }
    const a = sectionRowLabelText(describeSection(sin, 4, 'Szolgáltatás-sorok'))
    const b = sectionRowLabelText(describeSection(tabla, 9, 'Szolgáltatás-sorok'))
    expect(a.slice(5)).not.toBe(b.slice(5))
    expect(sectionRepeatOrdinals([sin, tabla])).toEqual([null, null])
  })
})

describe('cím-tartalékok', () => {
  it('cím nélküli sor: „(még nincs címe)”; beépített címes adatvezérelt sor: „(beépített cím)”', () => {
    expect(describeSection({ blockType: 'ctaBanner', title: '  ' }, 0, 'CTA-sáv').cimSzoveg).toBe(
      NINCS_CIME,
    )
    expect(
      describeSection({ blockType: 'testimonials', heading: null, eyebrow: 'Vélemények' }, 0, 'X')
        .cimSzoveg,
    ).toBe(BEEPITETT_CIM)
  })

  it('SOS-sáv: a címke a lap feloldóját mondja (freeSosStripTitle(data, true)), sosem a Szöveget', () => {
    const sos = FIXTURES.find((fixture) => fixture.data.blockType === 'freeSos')!.data
    for (const title of ['Ingyenes villámkurzus', '  Ingyenes villámkurzus  ', 'Saját SOS-cím']) {
      const adat = { ...sos, title }
      expect(sectionTitle(adat)).toBe(freeSosStripTitle(adat, true))
      expect(sectionRowLabelText(describeSection(adat, 4, 'Ingyenes villámkurzus sáv'))).toBe(
        `05 · Ingyenes villámkurzus sáv: ${freeSosStripTitle(adat, true)}`,
      )
    }
    // A Szöveg sosem lesz a címke, üres Címnél sem (a lap sem mutatja a Cím helyén).
    expect(sectionTitle({ ...sos, title: '' })).not.toContain(String(sos.body))
  })

  it.each([
    ['üres', ''],
    ['csak szóközös', '   '],
    ['hiányzó', undefined],
    ['null', null],
  ])(
    'SOS-sáv %s Címmel: „NN · Ingyenes villámkurzus sáv: Ingyenes villámkurzus (beépített cím)”',
    (_eset, title) => {
      const sos = FIXTURES.find((fixture) => fixture.data.blockType === 'freeSos')!.data
      const adat = { ...sos, title }
      expect(freeSosStripTitle(adat, true)).toBe(FREE_SOS_STRIP_TITLE)
      const leiras = describeSection(adat, 4, 'Ingyenes villámkurzus sáv', ['title', 'body'])
      expect(leiras.cim).toBe(FREE_SOS_STRIP_TITLE)
      expect(leiras.cimSzoveg).toBe(`${FREE_SOS_STRIP_TITLE} ${BEEPITETT_CIM}`)
      expect(sectionRowLabelText(leiras)).toBe(
        '05 · Ingyenes villámkurzus sáv: Ingyenes villámkurzus (beépített cím)',
      )
    },
  )

  it('SOS-sáv, élő szekciósor (fixtures/elo-szekciosorok-2026-09-22.json): a címke a feloldó eredménye', () => {
    const lap = ELO.kezdolap!
    const index = lap.layout.findIndex((sor) => sor.blockType === 'freeSos')
    const sor = lap.layout[index]!
    expect(index).toBe(7)
    const leiras = describeSection(sor, index, 'Ingyenes villámkurzus sáv')
    expect(leiras.cimSzoveg).toBe(freeSosStripTitle(sor, true))
    expect(sectionRowLabelText(leiras)).toBe(
      `08 · Ingyenes villámkurzus sáv: ${freeSosStripTitle(sor, true)}`,
    )
    // Az élő cím nem üres, ezért nincs „(beépített cím)” jel; a gondolatjelet
    // az adatban a kitöltő szabály javítja, a címke a mentett szöveget mondja.
    expect(sectionRowLabelText(leiras)).not.toContain(BEEPITETT_CIM)
  })

  it('a térkép sorrendje: üres cím után a felső kis felirat, majd az első tömbsor', () => {
    expect(sectionTitle({ blockType: 'services', title: '', eyebrow: 'Szolgáltatásaink' })).toBe(
      'Szolgáltatásaink',
    )
    expect(
      sectionTitle({ blockType: 'faq', heading: null, items: [{ question: 'Mennyi?' }] }),
    ).toBe('Mennyi?')
  })

  it('ismeretlen típus: a config text/textarea mezői, majd az első tartalmi szöveg', () => {
    expect(sectionTitle({ blockType: 'uj', alcim: 'Alcím', cim: 'Cím' }, ['cim'])).toBe('Cím')
    expect(sectionTitle({ blockType: 'uj', url: '/x', szoveg: 'Első szöveg' })).toBe('Első szöveg')
  })

  it('csonkítás: legfeljebb 60 karakter, szóhatáron, „…” jellel', () => {
    const hosszu =
      'És igazából neked is. Akinek nem fáj a keze, talán bele sem gondol, hogy szinte minden percben használja'
    const vagott = truncateAtWord(hosszu)
    expect(vagott.length).toBeLessThanOrEqual(SECTION_TITLE_MAX_LENGTH)
    expect(vagott.endsWith('…')).toBe(true)
    expect(hosszu.startsWith(vagott.slice(0, -1))).toBe(true)
    expect(vagott).toBe('És igazából neked is. Akinek nem fáj a keze, talán bele…')
    expect(truncateAtWord('Rövid cím')).toBe('Rövid cím')
  })

  it('Lexical: az első nem üres blokk szövege, sortöréssel és üres blokkal is', () => {
    expect(
      lexicalFirstText({
        root: {
          children: [
            { type: 'paragraph', children: [] },
            {
              type: 'paragraph',
              children: [
                { type: 'text', text: 'Első sor' },
                { type: 'linebreak' },
                { type: 'text', text: 'második' },
              ],
            },
          ],
        },
      }),
    ).toBe('Első sor második')
    expect(lexicalFirstText(null)).toBeNull()
    expect(lexicalFirstText({ root: { children: 'hibás' } })).toBeNull()
  })

  it('a közös címke-API (modul-térkép A3) ugyanazt adja, mint az admin', () => {
    expect(sectionLabel(FIXTURES[11]!.data, 11, { testimonials: 'Vélemények' })).toEqual({
      sorszam: '12',
      tipus: 'Vélemények',
      cim: 'Pácienseink mondták',
      rejtett: false,
      horgony: 'velemenyek',
    })
  })
})

describe('tömbsor-címkék', () => {
  it('a tartalmat mutatja: „1. Rendelői kezelések”, „2. Online kurzust…”', () => {
    expect(
      arrayRowLabel({ number: '01', title: 'Rendelői kezelések' }, 0, 'Sor', ['title', 'body']),
    ).toBe('1. Rendelői kezelések')
    expect(
      arrayRowLabel({ question: 'Online kurzust vagy személyes kezelést?' }, 1, 'Kérdés', [
        'question',
      ]),
    ).toBe('2. Online kurzust vagy személyes kezelést?')
  })

  it('üres sornál marad az általános alak, kisbetűs típussal', () => {
    expect(arrayRowLabel({ question: '' }, 2, 'Kérdés', ['question'])).toBe('3. kérdés (még üres)')
    expect(arrayRowLabel(undefined, 0, 'SOS-tétel', ['text'])).toBe('1. SOS-tétel (még üres)')
  })

  it('képes sor: a kép leírása, amíg töltődik „(kép)”', () => {
    expect(arrayRowLabel({ image: 34 }, 1, 'Logó', ['alt'], { hasImage: true })).toBe(
      '2. logó (kép)',
    )
    expect(
      arrayRowLabel({ image: 34 }, 1, 'Logó', ['alt'], {
        hasImage: true,
        imageTitle: 'A Magyar Sportrehabilitációs Egyesület logója',
      }),
    ).toBe('2. A Magyar Sportrehabilitációs Egyesület logója')
  })

  it('összefűzés: a Számok sora „10+ év szakmai tapasztalat”', () => {
    expect(
      arrayRowLabel(
        { value: '10+', label: 'év szakmai tapasztalat' },
        0,
        'Szám',
        ['value', 'label'],
        {
          separator: ' ',
        },
      ),
    ).toBe('1. 10+ év szakmai tapasztalat')
  })
})

describe('„Megnézem az oldalon”: a piszkozat-előnézet a szekció ugrópontjával', () => {
  const services = FIXTURES[8]!.data

  it('az előtag betűre a frontend szalag horgonyáé (szerkeszto-szalag.ts HORGONY_ELOTAG)', () => {
    expect(SZEKCIO_HORGONY_ELOTAG).toBe(HORGONY_ELOTAG)
    expect(SZEKCIO_HORGONY_ELOTAG).toBe('szekcio-')
  })

  it('érvényes blokk-azonosítónál mindig #szekcio-<azonosító>, a szerkesztő ugrópontja előtt is', () => {
    const id = '6ab2d223d49542402eac4fe9'
    expect(sectionViewLink('pages', 'szolgaltatasok', { ...services, id })).toEqual({
      href: `/next/preview?collection=pages&slug=szolgaltatasok#szekcio-${id}`,
      mode: 'szekcio',
    })
    const welcome: Record<string, unknown> = { ...FIXTURES[5]!.data, id }
    expect(sectionViewLink('pages', 'kezdolap', welcome, [String(welcome.title)])?.mode).toBe(
      'szekcio',
    )
    const sos = { ...FIXTURES[3]!.data, id, sectionSettings: settings() }
    expect(sectionViewLink('pages', 'kezdolap', sos)?.href).toBe(
      `/next/preview?collection=pages&slug=kezdolap#szekcio-${id}`,
    )
  })

  it('az élő szekciósor minden azonosítója 24 hexa jegy, és mind #szekcio-<azonosító> linket kap', () => {
    let db = 0
    for (const lap of Object.values(ELO)) {
      for (const sor of lap.layout) {
        expect(sor.id, `${lap.slug}`).toMatch(BLOKK_ID_MINTA)
        const link = sectionViewLink('pages', lap.slug, sor)
        expect(link?.mode).toBe('szekcio')
        expect(link?.href.endsWith(`#${SZEKCIO_HORGONY_ELOTAG}${String(sor.id)}`)).toBe(true)
        db += 1
      }
    }
    expect(db).toBe(34)
  })

  it('hibás alakú azonosítónál (nem 24 hexa jegy) a régi sorrend marad', () => {
    for (const id of ['f0', 'ABCDEF0123456789ABCDEF01', '6ab2d223d49542402eac4fe', null, 17]) {
      expect(sectionViewLink('pages', 'szolgaltatasok', { ...services, id })?.mode).toBe('horgony')
    }
  })

  it('horgony esetén #horgony', () => {
    expect(sectionViewLink('pages', 'szolgaltatasok', services)).toEqual({
      href: '/next/preview?collection=pages&slug=szolgaltatasok#szolgaltatasaink',
      mode: 'horgony',
    })
  })

  it('horgony nélkül szöveges ugrópont a címre (a „-” és a „,” kódolva)', () => {
    const welcome = FIXTURES[5]!.data
    const link = sectionViewLink('pages', 'kezdolap', welcome)
    expect(link?.mode).toBe('szoveg')
    expect(link?.href).toBe(
      `/next/preview?collection=pages&slug=kezdolap#:~:text=${encodeTextFragment('Fáj a kezed, a csuklód, a könyököd vagy a vállad?')}`,
    )
    expect(encodeTextFragment('Sajtó-logósor, és')).toBe('Sajt%C3%B3%2Dlog%C3%B3sor%2C%20%C3%A9s')
    expect(encodeTextFragment('Kéz & kar')).toBe('K%C3%A9z%20%26%20kar')
  })

  it('ha a cím a lapon korábban már előfordul, őszintén a lap tetejére visz', () => {
    const welcome = FIXTURES[5]!.data
    expect(
      sectionViewLink('pages', 'kezdolap', welcome, [
        'Fáj a kezed, a csuklód, a könyököd vagy a vállad?',
      ]),
    ).toEqual({ href: '/next/preview?collection=pages&slug=kezdolap', mode: 'lap' })
  })

  it('azonosító nélkül a SOS-sáv címe nem ígérhető (termék nélkül „Kurzusaink”), ezért a lap teteje', () => {
    const sos = { ...FIXTURES[3]!.data, sectionSettings: settings() }
    expect(sectionViewLink('pages', 'kezdolap', sos)?.mode).toBe('lap')
  })

  it('érvénytelen vagy hiányzó webcímnél nincs link', () => {
    expect(sectionViewLink('pages', '', services)).toBeNull()
    expect(sectionViewLink('pages', '//evil.example', services)).toBeNull()
    expect(sectionViewLink('pages', undefined, services)).toBeNull()
  })
})

describe('forrás-jelzés: a más gyűjteményből vagy automatikusan töltődő szekciók', () => {
  it.each([
    ['courseCards', 2, '/collections/products', 'Kurzusok'],
    ['testimonials', 11, '/collections/testimonials', 'Vélemények'],
    ['knowledge', 12, '/collections/posts', 'Blogbejegyzések'],
  ] as const)('%s → %s', (_tipus, index, adminPath, nev) => {
    expect(sectionSource(FIXTURES[index]!.data, 'kezdolap')?.hova).toEqual({ nev, adminPath })
  })

  it('Vélemények: a hármas korlát, a blokk darabszáma és az idézet forrása, „minden oldal” nélkül (H43)', () => {
    const szoveg = sectionSource(FIXTURES[11]!.data, 'rolunk')?.szoveg ?? ''
    expect(szoveg).toBe(
      'A Kiemelt és Látható pipás vélemények közül a Sorrend szerinti első legfeljebb három látszik, a „Hány vélemény jelenjen meg” mezőben kevesebbet is kérhetsz. Ha a Rövid idézet ki van töltve, az látszik, különben a Teljes szöveg.',
    )
    for (const szo of [
      'Kiemelt',
      'Látható',
      'Sorrend',
      '„Hány vélemény jelenjen meg”',
      'Rövid idézet',
      'Teljes szöveg',
    ]) {
      expect(szoveg, szo).toContain(szo)
    }
    expect(szoveg).not.toMatch(/minden oldal/i)
    // A „Hány vélemény jelenjen meg” a blokk valódi mezőcímkéje (SC 3.2.4).
    const blokk = pageBlocks.find((block) => block.slug === 'testimonials')!
    const darab = adatMezo(blokk.fields, ['maxItems'])
    expect(darab && 'label' in darab ? darab.label : undefined).toBe('Hány vélemény jelenjen meg')
  })

  it('SOS-sáv: a kurzus neve, a gomb célja és a „Kurzusaink” ág, a free-sos.ts szavaival (H30)', () => {
    const forras = sectionSource(FIXTURES[3]!.data, 'kezdolap')
    expect(forras?.cim).toBe('A kurzus neve és a gomb célja a Kurzusokból jön')
    expect(forras?.szoveg).toBe(
      'A cím fölötti kis sor a kurzus neve (a „Kurzus címe”, üresen a „Belső azonosító”), a gomb az ingyenes kurzus oldalára visz, és ha a Szöveget üresen hagyod, a kurzus „Rövid leírás” mezője látszik. Ha éppen nincs elérhető ingyenes kurzus, a sáv ehelyett a „Kurzusaink” címet, egy beépített mondatot és a kurzuslistára vivő gombot mutatja.',
    )
    expect(forras?.szoveg).toContain(`„${FREE_SOS_NEUTRAL_TITLE}”`)
    expect(forras?.hova).toEqual({
      nev: 'Kurzusok',
      adminPath: `/collections/products?where[slug][equals]=${SOS_KURZUS_SLUG}`,
    })
    expect(forras?.szoveg).not.toMatch(/(?<!\p{L})(csak|minden)(?!\p{L})|a többi/iu)
    // A free-sos.ts mezőleírásainak szavai (SC 3.2.4): ugyanazt a helyzetet
    // ugyanazzal a szóval mondja a doboz és a mező.
    const blokk = pageBlocks.find((block) => block.slug === 'freeSos')!
    const leiras = (nev: string): string => {
      const mezo = adatMezo(blokk.fields, [nev])
      const admin: unknown = mezo && 'admin' in mezo ? mezo.admin : undefined
      const d =
        typeof admin === 'object' && admin !== null && 'description' in admin
          ? admin.description
          : undefined
      return typeof d === 'string' ? d : ''
    }
    for (const [mezo, kozos] of [
      ['title', 'a kurzus neve'],
      ['title', '„Kurzus címe”'],
      ['title', 'Ha éppen nincs elérhető ingyenes kurzus, a sáv ehelyett a „Kurzusaink” címet'],
      ['body', 'a kurzus „Rövid leírás” mezője látszik'],
      ['cta', 'az ingyenes kurzus oldalára visz'],
    ] as const) {
      expect(leiras(mezo), `${mezo}: ${kozos}`).toContain(kozos)
      expect(forras?.szoveg, kozos).toContain(kozos)
    }
  })

  it('a filmHero szövege az A csapaté: nincs forrás-jelzés', () => {
    expect(sectionSource(FIXTURES[0]!.data, 'kezdolap')).toBeNull()
  })

  it('CTA-sáv: kurzusra vivő gombnál a kép a Kurzusokból, a Rólunk oldalon beépített montázs', () => {
    const cta = FIXTURES[18]!.data
    expect(sectionSource(cta, 'kezdolap')?.hova?.adminPath).toBe('/collections/products')
    expect(sectionSource(cta, 'rolunk')?.hova).toBeNull()
    expect(sectionSource({ ...cta, cta: { url: '/kapcsolat' } }, 'kezdolap')).toBeNull()
    expect(isCourseTarget('/kurzusok/otthoni-kezrehab-program?x=1')).toBe(true)
    expect(isCourseTarget('/kurzusokat')).toBe(false)
    expect(isCourseTarget('https://kineticare.hu/kurzusok')).toBe(false)
  })

  it('szabad szöveg „rendeloi” horgonnyal: árlista a szövegből, ugrás nélkül', () => {
    expect(sectionSource(FIXTURES[17]!.data, 'szolgaltatasok')?.cim).toBe('Árlista a szövegből')
    const masHorgony = { ...FIXTURES[17]!.data, sectionSettings: settings() }
    expect(sectionSource(masHorgony, 'szolgaltatasok')).toBeNull()
  })

  it('a doboz legfeljebb két rövid mondat, gondolatjel nélkül', () => {
    for (const fixture of FIXTURES) {
      for (const slug of ['kezdolap', 'rolunk', 'szolgaltatasok', 'kapcsolat']) {
        const forras = sectionSource(fixture.data, slug)
        if (forras) {
          expect(
            forras.szoveg.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 0).length,
          ).toBeLessThanOrEqual(2)
          expect(forras.szoveg).not.toMatch(/[–—]/)
        }
      }
    }
  })

  it('Tudástár-ajánló: kimondja a Tudástár kapcsolóját, a knowledge.ts és a Menüpontok szavaival (SC 3.2.4)', () => {
    const szoveg = sectionSource(FIXTURES[12]!.data, 'kezdolap')?.szoveg ?? ''
    expect(szoveg).toBe(
      'A legfrissebb közzétett blogbejegyzések közül legfeljebb annyi látszik, amennyit a „Hány blogbejegyzés jelenjen meg” mezőben beállítasz, a szövegüket a Blogbejegyzéseknél írod át. Ha a Tudástár ki van kapcsolva (a Menüpontok között a /blog webcímű menüpontnál nincs pipa a „Látható” mezőben, vagy be van jelölve a „Rejtett link”), ez a szekció nem jelenik meg az oldalon.',
    )
    const heading = knowledge.fields.find((field) => 'name' in field && field.name === 'heading')
    const leiras = heading?.type === 'text' ? heading.admin?.description : undefined
    expect(typeof leiras).toBe('string')
    // A kapcsoló feltétele betűre a knowledge.ts `heading`-leírásáé (A-2).
    const feltetel =
      /Ha a Tudástár ki van kapcsolva \([^)]*\), ez a szekció nem jelenik meg az oldalon/u
    expect(szoveg.match(feltetel)?.[0]).toBe(String(leiras).match(feltetel)?.[0])
    for (const kozos of [
      'a /blog webcímű menüpont',
      '„Látható”',
      '„Rejtett link”',
      'legfrissebb közzétett blogbejegyzés',
    ]) {
      expect(szoveg, kozos).toContain(kozos)
      expect(leiras, kozos).toContain(kozos)
    }
    const limit = knowledge.fields.find((field) => 'name' in field && field.name === 'limit')
    expect(limit && 'label' in limit ? limit.label : undefined).toBe(
      'Hány blogbejegyzés jelenjen meg',
    )
    expect(szoveg).toContain(`„${String(limit && 'label' in limit ? limit.label : '')}”`)
  })

  it('szabad szöveg „rendeloi” horgonnyal: a szabályt nem ismétli, a Tartalom mező leírására utal', () => {
    const forras = sectionSource(FIXTURES[17]!.data, 'szolgaltatasok')
    expect(forras?.szoveg).toBe(
      'Ennél a szekciónál a lap a szövegből árkártyákat épít, ha a szerkezete felismerhető, különben sima szövegként látszik. A felismerés szabályát a Tartalom mező leírása mondja el.',
    )
    expect(forras?.szoveg).not.toMatch(/Árlista kezdetű|perces alkalom/u)
    const blokk = pageBlocks.find((block) => block.slug === 'richText')!
    const tartalom = adatMezo(blokk.fields, ['content'])
    expect(tartalom && 'label' in tartalom ? tartalom.label : undefined).toBe('Tartalom')
  })

  it('Kurzuskártyák: a blokk minden tartalmi mezőjét megnevezi, „csak” nélkül', () => {
    const szoveg = sectionSource(FIXTURES[2]!.data, 'kezdolap')?.szoveg ?? ''
    expect(szoveg).toBe(
      'A kurzus nevét, árát és borítóképét a Kurzusoknál írod át. Itt a szekció felső kis feliratát, címét, bevezetőjét és a kártyák gombfeliratát szerkeszted.',
    )
    // Ha a course-cards.ts új tartalmi mezőt kap, a felsorolás hiányos lenne:
    // ez a teszt akkor bukik, és a szöveget bővíteni kell.
    const megnevezes: Record<string, string> = {
      eyebrow: 'felső kis feliratát',
      heading: 'címét',
      lead: 'bevezetőjét',
      ctaLabel: 'gombfeliratát',
    }
    const tartalmiMezok = courseCards.fields
      .filter((field) => 'name' in field && field.type !== 'ui')
      .map((field) => ('name' in field ? field.name : ''))
    expect(tartalmiMezok.sort()).toEqual(Object.keys(megnevezes).sort())
    for (const [mezo, szo] of Object.entries(megnevezes)) {
      expect(szoveg, mezo).toContain(szo)
    }
  })

  it('a forrás-jelzések és a rejtett doboz egyik szövegében sem áll a „csak” szó', () => {
    const csak = /(?<!\p{L})csak(?!\p{L})/iu
    const valtozatok: unknown[] = [
      ...FIXTURES.map((fixture) => fixture.data),
      { ...FIXTURES[18]!.data, cta: { url: '/kurzusok/otthoni-kezrehab-program' } },
    ]
    const szovegek = new Set<string>()
    for (const data of valtozatok) {
      for (const slug of ['kezdolap', 'rolunk', 'szolgaltatasok', 'kapcsolat']) {
        const forras = sectionSource(data, slug)
        if (forras) {
          szovegek.add(forras.cim)
          szovegek.add(forras.szoveg)
        }
      }
    }
    // Minden ág lefedve (cím + szöveg ágonként): courseCards, freeSos,
    // testimonials, knowledge, ctaBanner (kurzus és Rólunk), richText
    // „rendeloi” = 14; a Kapcsolat oldalon a Vélemények és a Tudástár-ajánló
    // (közös cím, két szöveg), a Kurzuskártyák, a kurzusra vivő sáv és az
    // SOS-sáv = 9.
    expect(szovegek.size).toBe(23)
    for (const szoveg of [
      ...szovegek,
      REJTETT_CIM,
      REJTETT_MAGYARAZAT,
      REJTETT_TEENDO,
      hiddenHint('02'),
      LAP_TETEJE_MAGYARAZAT,
      ...ELO_KOTOTT_MONDATOK(),
    ]) {
      expect(szoveg, szoveg).not.toMatch(csak)
      expect(szoveg, szoveg).not.toMatch(/(?<!\p{L})minden(?!\p{L})|a többi/iu)
    }
  })

  it('a rejtett doboz is legfeljebb két mondat, iker nélkül és ikerrel', () => {
    const mondatok = (szoveg: string): number =>
      szoveg.split(/(?<=[.!?])\s+(?=\p{Lu})/u).filter((s) => s.trim().length > 0).length
    expect(mondatok(`${REJTETT_MAGYARAZAT} ${hiddenHint(null)}`)).toBe(2)
    expect(mondatok(`${REJTETT_MAGYARAZAT} ${hiddenHint('02')}`)).toBe(2)
  })

  it('modell: a Kapcsolat oldalon az üres listás szekcióknál nincs „Megnézem”, máshol van', () => {
    const id = '6ab2d223d49542402eac4ffb'
    for (const [data, vart] of [
      [FIXTURES[11]!.data, true],
      [FIXTURES[12]!.data, true],
      [FIXTURES[2]!.data, true],
      [FIXTURES[18]!.data, true],
      [{ ...FIXTURES[18]!.data, cta: { url: '/kapcsolat' } }, false],
      [FIXTURES[3]!.data, false],
      [FIXTURES[16]!.data, false],
    ] as const) {
      const sor: Record<string, unknown> = { ...data, id }
      expect(kapcsolatiUresLista(sor, KAPCSOLAT_OLDAL_SLUG), String(sor.blockType)).toBe(vart)
      expect(kapcsolatiUresLista(sor, 'kezdolap')).toBe(false)
      const model = sectionNoticeModel({
        data: sor,
        pageSlug: KAPCSOLAT_OLDAL_SLUG,
        rowIndex: 0,
        siblings: [sor],
        adminRoute: '/admin',
      })
      expect(model.megnezem === null, String(sor.blockType)).toBe(vart)
      const masutt = sectionNoticeModel({
        data: sor,
        pageSlug: 'rolunk',
        rowIndex: 0,
        siblings: [sor],
        adminRoute: '/admin',
      })
      expect(masutt.megnezem?.mode).toBe('szekcio')
    }
  })

  it('modell: rejtett szekciónál nincs „Megnézem”, az ugrás az admin gyökeréhez igazodik', () => {
    const kurzus = FIXTURES[2]!.data
    const rejtett = { ...kurzus, sectionSettings: settings({ visible: false }) }
    const model = sectionNoticeModel({
      data: rejtett,
      pageSlug: 'kezdolap',
      rowIndex: 3,
      siblings: [],
      adminRoute: '/admin/',
    })
    expect(model.rejtett).toBe(true)
    expect(model.megnezem).toBeNull()
    expect(model.ugras).toEqual({
      felirat: 'Ugrás oda, ahol szerkeszted: Kurzusok',
      href: '/admin/collections/products',
    })
  })
})

describe('a Kapcsolat oldal: a route üres listáinál a mért látvány (a B vezető döntése)', () => {
  const kapcsolati = (data: Record<string, unknown>) => sectionSource(data, KAPCSOLAT_OLDAL_SLUG)

  it('Vélemények és Tudástár-ajánló: nem jelenik meg, és megmondja, miért; admin-link nélkül', () => {
    expect(kapcsolati(FIXTURES[11]!.data)).toEqual({
      cim: 'A Kapcsolat oldalon ez a szekció nem jelenik meg',
      szoveg:
        'Ez az oldal nem tölti be a véleményeket, ezért a szekcióból itt semmi nem látszik, a címe sem.',
      hova: null,
    })
    expect(kapcsolati(FIXTURES[12]!.data)).toEqual({
      cim: 'A Kapcsolat oldalon ez a szekció nem jelenik meg',
      szoveg:
        'Ez az oldal nem tölti be a blogbejegyzéseket, ezért a szekcióból itt semmi nem látszik, a címe sem.',
      hova: null,
    })
  })

  it('Kurzuskártyák: üres sáv marad, a blokk minden tartalmi mezőjét megnevezi', () => {
    const forras = kapcsolati(FIXTURES[2]!.data)
    expect(forras?.szoveg).toBe(
      'Ez az oldal nem tölti be a kurzusokat, ezért itt a felső kis felirat, a cím, a bevezető és a kártyák sem látszanak. A szekció helyén egy üres sáv marad.',
    )
    expect(forras?.hova).toBeNull()
    // A gombfelirat a kártyán áll, a kártyák elmaradnak: a felsorolás teljes.
    const tartalmiMezok = courseCards.fields
      .filter((field) => 'name' in field && field.type !== 'ui')
      .map((field) => ('name' in field ? field.name : ''))
    expect(tartalmiMezok.sort()).toEqual(['ctaLabel', 'eyebrow', 'heading', 'lead'])
  })

  it('kurzusra vivő gombos sáv: kép nélkül; más célú gombnál nincs Kapcsolat-mondat', () => {
    expect(kapcsolati(FIXTURES[18]!.data)).toEqual({
      cim: 'A Kapcsolat oldalon a sáv kép nélkül jelenik meg',
      szoveg:
        'Ez az oldal nem tölti be a kurzusokat, ezért a kurzus borítóképe itt nem látszik. A sáv címe, szövege és gombja megjelenik.',
      hova: null,
    })
    expect(kapcsolati({ ...FIXTURES[18]!.data, cta: { url: '/kapcsolat' } })).toBeNull()
  })

  it('SOS-sáv: a Kapcsolat oldalon mindig a semleges ág látszik', () => {
    const forras = kapcsolati(FIXTURES[3]!.data)
    expect(forras?.szoveg).toBe(
      `Ez az oldal nem tölti be a kurzusokat, ezért itt a sáv a „${FREE_SOS_NEUTRAL_TITLE}” címet, egy beépített mondatot és a kurzuslistára vivő gombot mutatja. A nagy címe és a Szövege itt nem látszik.`,
    )
    expect(forras?.hova).toBeNull()
  })

  it('a többi szekció a Kapcsolat oldalon ugyanazt kapja, mint máshol', () => {
    for (const fixture of FIXTURES) {
      const tipus = String(fixture.data.blockType)
      if (['testimonials', 'knowledge', 'courseCards', 'ctaBanner', 'freeSos'].includes(tipus)) {
        continue
      }
      expect(kapcsolati(fixture.data), tipus).toEqual(sectionSource(fixture.data, 'rolunk'))
    }
  })
})

/** Az élő szekciósor összes kötött-ugrópont mondata (oldalonként, soronként). */
function ELO_KOTOTT_MONDATOK(): string[] {
  return Object.values(ELO).flatMap((lap) =>
    lap.layout
      .map((sor) => kotottUgropont(sor, lap.slug))
      .filter((mondat): mondat is string => mondat !== null),
  )
}

describe('kódhoz kötött ugrópontok (modul-térkép H48)', () => {
  it('az élő szekciósorban a Szolgáltatások „rendeloi” és a Kapcsolat „idopontkeres” sora kapja, más nem', () => {
    const talalat: string[] = []
    for (const lap of Object.values(ELO)) {
      lap.layout.forEach((sor, index) => {
        if (kotottUgropont(sor, lap.slug) !== null) {
          talalat.push(`${lap.slug} ${String(index + 1).padStart(2, '0')} ${sor.blockType}`)
        }
      })
    }
    expect(talalat.sort()).toEqual(['kapcsolat 01 appointment', 'szolgaltatasok 04 richText'])
  })

  it('a mondat kimondja, mi visz ide, és mi történik átnevezéskor', () => {
    const szolg = ELO.szolgaltatasok!.layout[3]
    expect(kotottUgropont(szolg, 'szolgaltatasok')).toBe(
      'Erre az ugrópontra („rendeloi”) visz a menü „Rendelői kezelések” pontja és két régi webcím átirányítása, ezért ha átnevezed vagy törlöd, ezek már nem ide visznek, és a szövegből árkártyák sem lesznek.',
    )
    const kapcs = ELO.kapcsolat!.layout[0]
    expect(kotottUgropont(kapcs, 'kapcsolat')).toBe(
      'Erre az ugrópontra („idopontkeres”) visz a blogbejegyzések végén álló „Kérj időpontot üzenetben” gomb, ezért ha átnevezed vagy törlöd, már nem ide visz.',
    )
  })

  it('ugyanaz a név más oldalon vagy más szekciótípusnál nem ígér árkártyát és menüt', () => {
    const rendeloiMashol = { blockType: 'services', sectionSettings: { anchorId: 'rendeloi' } }
    expect(kotottUgropont(rendeloiMashol, 'rolunk')).toBeNull()
    expect(kotottUgropont(rendeloiMashol, 'szolgaltatasok')).not.toContain('árkártya')
    expect(
      kotottUgropont(
        { blockType: 'appointment', sectionSettings: { anchorId: 'idopontkeres' } },
        'szolgaltatasok',
      ),
    ).toBeNull()
    expect(
      kotottUgropont(
        { blockType: 'accordion', sectionSettings: { anchorId: 'szakmai-hatter' } },
        'rolunk',
      ),
    ).toBeNull()
  })

  it('a modell és a rejtett sor is viszi a mondatot; a sorcímke alakja nem változik', () => {
    const lap = ELO.kapcsolat!
    const sor = { ...lap.layout[0]!, sectionSettings: { visible: false, anchorId: 'idopontkeres' } }
    const model = sectionNoticeModel({
      data: sor,
      pageSlug: 'kapcsolat',
      rowIndex: 0,
      siblings: [sor],
      adminRoute: '/admin',
    })
    expect(model.kotott).toBe(kotottUgropont(sor, 'kapcsolat'))
    expect(model.rejtett).toBe(true)
    expect(sectionRowLabelText(describeSection(lap.layout[0], 0, 'Időpontkérő szekció'))).toBe(
      '01 · Időpontkérő szekció: Kérj időpontot a rendelőbe',
    )
  })
})

/* ------------------------------------------------------------------------ */
/* A blocks/index.ts burkolója                                               */
/* ------------------------------------------------------------------------ */

function allArrays(fields: readonly Field[]): ArrayField[] {
  return fields.flatMap((field): ArrayField[] => {
    if (field.type === 'array') {
      return [field, ...allArrays(field.fields)]
    }
    if (field.type === 'group' || field.type === 'row' || field.type === 'collapsible') {
      return allArrays(field.fields)
    }
    if (field.type === 'tabs') {
      return field.tabs.flatMap((tab) => allArrays(tab.fields))
    }
    return []
  })
}

/**
 * Adatszintű mezőkereső: a név nélküli collapsible, row és tab átlátszó, a
 * nevesített group és tab egy útvonal-lépés (a B vezető tanítása szerint a
 * mezőt rekurzívan keressük, nem a legfelső szinten).
 */
function adatMezo(fields: readonly Field[], utvonal: readonly string[]): Field | undefined {
  const [elso, ...maradek] = utvonal
  if (elso === undefined) {
    return undefined
  }
  for (const field of fields) {
    if ('name' in field && field.name) {
      if (field.name !== elso) {
        continue
      }
      if (maradek.length === 0) {
        return field
      }
      if (field.type === 'group' || field.type === 'array') {
        return adatMezo(field.fields, maradek)
      }
      return undefined
    }
    if (field.type === 'collapsible' || field.type === 'row') {
      const talalt = adatMezo(field.fields, utvonal)
      if (talalt) {
        return talalt
      }
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const talalt =
          'name' in tab && tab.name
            ? tab.name === elso
              ? adatMezo(tab.fields, maradek)
              : undefined
            : adatMezo(tab.fields, utvonal)
        if (talalt) {
          return talalt
        }
      }
    }
  }
  return undefined
}

type ComponentRef = { path?: string; clientProps?: Record<string, unknown> }
const asRef = (value: unknown): ComponentRef => (value ?? {}) as ComponentRef

describe('a szekció-katalógus burkolója (séma-semleges admin-tulajdonságok)', () => {
  it('minden blokk sorcímkét kap, a blockName-input eltűnik, a slugok változatlanok', () => {
    expect(pageBlockSlugs).toHaveLength(19)
    for (const block of pageBlocks) {
      expect(block.admin?.disableBlockName).toBe(true)
      const label = asRef(block.admin?.components?.Label)
      expect(label.path).toBe('/components/admin/SectionRowLabel#SectionRowLabel')
      expect(label.clientProps?.blockLabel).toBe(block.labels?.singular)
    }
  })

  it('az első mező a forrás-jelzés UI-mezője (adatbázis-oszlop nélkül)', () => {
    for (const block of pageBlocks) {
      const [elso] = block.fields
      expect(elso?.type).toBe('ui')
      expect(elso && 'name' in elso ? elso.name : null).toBe(SECTION_SOURCE_FIELD_NAME)
      expect(
        block.fields.filter((f) => 'name' in f && f.name === SECTION_SOURCE_FIELD_NAME),
      ).toHaveLength(1)
    }
  })

  it('minden tömb tartalmas sorcímkét kap; a nyers blokk-exportok érintetlenek', () => {
    for (const block of pageBlocks) {
      for (const array of allArrays(block.fields)) {
        const rowLabel = asRef(array.admin?.components?.RowLabel)
        expect(rowLabel.path, `${block.slug}.${array.name}`).toBe(
          '/components/admin/SectionRowLabel#ArrayRowLabel',
        )
      }
    }
    const nyers: Block[] = [services, faq, about, pressLogos]
    for (const block of nyers) {
      expect(block.admin?.components?.Label).toBeUndefined()
      expect(block.admin?.disableBlockName).toBeUndefined()
      expect(allArrays(block.fields).every((array) => !array.admin?.components?.RowLabel)).toBe(
        true,
      )
    }
  })

  it('a tömbsor cím-mezői: a cím elöl, a sorszám és a webcím soha', () => {
    const wrapped = (slug: string) => pageBlocks.find((block) => block.slug === slug)!
    const props = (slug: string, name: string) =>
      asRef(
        allArrays(wrapped(slug).fields).find((array) => array.name === name)?.admin?.components
          ?.RowLabel,
      ).clientProps ?? {}
    const sorok = props('services', 'rows')
    expect(sorok.singular).toBe('Sor')
    expect((sorok.titleFields as string[])[0]).toBe('title')
    expect(sorok.titleFields).not.toContain('number')
    expect(sorok.titleFields).not.toContain('url')
    expect(props('about', 'stats')).toMatchObject({
      titleFields: ['value', 'label'],
      separator: ' ',
    })
    expect(props('pressLogos', 'logos')).toMatchObject({
      imageField: 'image',
      titleFields: ['alt'],
    })
    expect((props('faq', 'items').titleFields as string[])[0]).toBe('question')
  })

  it('a rejtett sor teendője igaz: mind a 19 blokk alján a „Megjelenés és elrejtés” rész áll, benne a Látható pipával', () => {
    expect(pageBlocks).toHaveLength(19)
    for (const block of pageBlocks) {
      const utolso = block.fields[block.fields.length - 1]
      expect(utolso?.type, block.slug).toBe('collapsible')
      if (utolso?.type !== 'collapsible') {
        continue
      }
      expect('name' in utolso ? utolso.name : undefined, block.slug).toBeUndefined()
      expect(utolso.label, block.slug).toBe(SECTION_SETTINGS_LABEL)
      const lathato = adatMezo(utolso.fields, ['sectionSettings', 'visible'])
      expect(lathato?.type, block.slug).toBe('checkbox')
      const cimke = lathato && 'label' in lathato ? lathato.label : undefined
      expect(cimke, block.slug).toBe('Látható')
      expect(REJTETT_TEENDO).toContain(`${String(cimke)} pipával`)
    }
    expect(REJTETT_TEENDO).toBe(
      `A blokk alján, a „${SECTION_SETTINGS_LABEL}” részben a Látható pipával kapcsolod vissza.`,
    )
  })

  it('a blokk mezőinek eredeti sorrendje és száma a UI-mező után változatlan', () => {
    for (const block of pageBlocks) {
      const nyers = [services, faq, about, pressLogos].find((raw) => raw.slug === block.slug)
      if (nyers) {
        expect(block.fields.slice(1).map((f) => ('name' in f ? f.name : f.type))).toEqual(
          nyers.fields.map((f) => ('name' in f ? f.name : f.type)),
        )
      }
    }
  })
})

describe('rejtett iker (modul-térkép H02)', () => {
  const rolunk = {
    blockType: 'about',
    title: 'Megérdemled a profi törődést',
    sectionSettings: { visible: true },
  }
  const rejtett = { ...rolunk, blockName: null, sectionSettings: { visible: false } }
  const sorok = [
    { blockType: 'filmHero', title: 'Film' },
    { ...rolunk, blockName: 'Rövid bemutatkozás' },
    rejtett,
  ]

  it('a rejtett sor megnevezi a látható, azonos típusú és című párját', () => {
    expect(visibleTwin(rejtett, 2, sorok)).toBe('02')
    expect(hiddenHint('02')).toBe(
      'Ugyanezzel a címmel a 2. sor látszik a lapon, a látható szöveget ott írod át.',
    )
    expect(hiddenHint('05')).toBe(
      'Ugyanezzel a címmel az 5. sor látszik a lapon, a látható szöveget ott írod át.',
    )
    expect(
      sectionNoticeModel({
        data: rejtett,
        pageSlug: 'kezdolap',
        rowIndex: 2,
        siblings: sorok,
        adminRoute: '/admin',
      }).iker,
    ).toBe('02')
  })

  it('iker nélkül a visszakapcsolás módját mondja; látható sornak nincs ikre', () => {
    expect(visibleTwin(rejtett, 0, [rejtett])).toBeNull()
    expect(visibleTwin(rolunk, 1, sorok)).toBeNull()
    expect(hiddenHint(null)).toBe(
      `A blokk alján, a „${SECTION_SETTINGS_LABEL}” részben a Látható pipával kapcsolod vissza.`,
    )
  })

  it('a névelő a kiejtéshez igazodik', () => {
    expect([1, 2, 5, 10, 11, 15, 50, 59, 60].map(nevelo)).toEqual([
      'az',
      'a',
      'az',
      'a',
      'a',
      'a',
      'az',
      'az',
      'a',
    ])
  })
})
