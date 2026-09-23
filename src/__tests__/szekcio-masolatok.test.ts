import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { pageBlocks, SZEKCIO_CIMKE_FORRASOK } from '../blocks'
import { szekcioMelylink } from '../components/editor/szekcio-melylink'
import {
  EMAIL_MEZOK,
  HASONLO_KIHAGYOTT_TIPUSOK,
  KEP_MEZOK,
  MAX_HELY,
  TELEFON_MEZOK,
  csoportBevezeto,
  csoportTeendo,
  esMeg,
  oldalNev,
  szekcioMasolatok,
  telefonKulcs,
  type MasolatOldal,
  type SzekcioMasolatBemenet,
} from '../lib/admin/szekcio-masolatok'
import { LEGACY_HOME_HELP_TITLES, LEGACY_HOME_HELP_URLS } from '../lib/home-help-states'
import {
  BEEPITETT_CIM,
  describeSectionOnPage,
  ELRENDEZES_JEL,
  ELVALASZTO,
  sectionRepeatOrdinals,
  sectionRowLabelText,
} from '../lib/section-row-label'

/**
 * Az „ugyanaz máshol” jelzés tiszta modulja (src/lib/admin/szekcio-masolatok.ts,
 * modul-térkép H10, H49).
 *
 * 1. KATALÓGUS-ŐR: a modul fejkommentje ígéri, hogy a közös adat mezői a
 *    blokkok tényleges sémájából jönnek. A teszt a TELJES pageBlocks-katalógust
 *    bejárja (tömbben `*`, csoportban és nevesített fülön pont, név nélküli
 *    row/collapsible/fül kilapítva), és minden `upload` mezőt, minden
 *    „Telefonszám” és minden „E-mail-cím” címkéjű `text` mezőt összevet a
 *    KEP_MEZOK, TELEFON_MEZOK, EMAIL_MEZOK térképpel: pontosan ezek, semmi más.
 *    Ha egy blokk új képmezőt kap (mint a fríz és a Kurzusaink fotói, vagy az
 *    A1-ben a gombos sáv Kép mezője), ez a teszt bukik, amíg a térkép nem
 *    követi.
 * 2. MODELL: a telefonkulcs, a hasonló szekció, a kihagyott típusok, az
 *    ugyanazon oldali egyezés, az arckép, a hibajelzés és a lista levágása.
 */

/** A címkék pontos szövege, ahogy a blokkfájlokban áll (appointment.ts, team-members.ts). */
const TELEFON_CIMKE = 'Telefonszám'
const EMAIL_CIMKE = 'E-mail-cím'

type Terkep = Record<string, string[]>

function felvesz(terkep: Terkep, slug: string, utvonal: string): void {
  terkep[slug] = [...(terkep[slug] ?? []), utvonal]
}

function bejar(
  slug: string,
  fields: readonly Field[],
  elotag: string,
  eredmeny: { kep: Terkep; telefon: Terkep; email: Terkep },
): void {
  for (const field of fields) {
    switch (field.type) {
      case 'row':
      case 'collapsible':
        bejar(slug, field.fields, elotag, eredmeny)
        break
      case 'tabs':
        for (const tab of field.tabs) {
          const nev = 'name' in tab && tab.name ? `${elotag}${tab.name}.` : elotag
          bejar(slug, tab.fields, nev, eredmeny)
        }
        break
      case 'group':
        bejar(
          slug,
          field.fields,
          'name' in field && field.name ? `${elotag}${field.name}.` : elotag,
          eredmeny,
        )
        break
      case 'array':
        bejar(slug, field.fields, `${elotag}${field.name}.*.`, eredmeny)
        break
      case 'blocks':
        throw new Error(`Beágyazott blocks mező (${slug}.${field.name}): a bejárást bővíteni kell.`)
      case 'upload':
        felvesz(eredmeny.kep, slug, `${elotag}${field.name}`)
        break
      case 'text':
        if (field.label === TELEFON_CIMKE) {
          felvesz(eredmeny.telefon, slug, `${elotag}${field.name}`)
        }
        if (field.label === EMAIL_CIMKE) {
          felvesz(eredmeny.email, slug, `${elotag}${field.name}`)
        }
        break
      default:
        break
    }
  }
}

function rendezett(terkep: Readonly<Record<string, readonly string[]>>): Terkep {
  return Object.fromEntries(
    Object.entries(terkep)
      .filter(([, utak]) => utak.length > 0)
      .map(([slug, utak]) => [slug, [...utak].sort()])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  )
}

describe('szekcio-masolatok: a közös adat mezői pontosan a séma szerint', () => {
  const eredmeny = { kep: {} as Terkep, telefon: {} as Terkep, email: {} as Terkep }
  for (const block of pageBlocks) {
    bejar(block.slug, block.fields, '', eredmeny)
  }

  it('a bejárás tényleg talál mezőt (az őr nem üresen zöld)', () => {
    expect(Object.keys(eredmeny.kep).length).toBeGreaterThan(5)
    expect(Object.keys(eredmeny.telefon)).toEqual(expect.arrayContaining(['appointment']))
    expect(Object.keys(eredmeny.email)).toEqual(expect.arrayContaining(['appointment']))
  })

  it('KEP_MEZOK: minden upload mező, és semmi más', () => {
    expect(rendezett(KEP_MEZOK)).toEqual(rendezett(eredmeny.kep))
  })

  it('TELEFON_MEZOK: minden „Telefonszám” címkéjű szövegmező, és semmi más', () => {
    expect(rendezett(TELEFON_MEZOK)).toEqual(rendezett(eredmeny.telefon))
  })

  it('EMAIL_MEZOK: minden „E-mail-cím” címkéjű szövegmező, és semmi más', () => {
    expect(rendezett(EMAIL_MEZOK)).toEqual(rendezett(eredmeny.email))
  })

  it('a térképek csak létező blokktípusra hivatkoznak', () => {
    const slugok = new Set(pageBlocks.map((block) => block.slug))
    for (const terkep of [KEP_MEZOK, TELEFON_MEZOK, EMAIL_MEZOK]) {
      for (const slug of Object.keys(terkep)) {
        expect(slugok.has(slug)).toBe(true)
      }
    }
    for (const tipus of HASONLO_KIHAGYOTT_TIPUSOK) {
      expect(slugok.has(tipus)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------------ */
/* Modell                                                                    */
/* ------------------------------------------------------------------------ */

const ADMIN = '/admin'
const cimkek = SZEKCIO_CIMKE_FORRASOK

/** 24 jegyű hexa blokk-azonosító (a Payload ObjectId-szerű sorazonosítója). */
function blokkId(n: number): string {
  return n.toString(16).padStart(24, '0')
}

function oldal(id: number, slug: string, title: string, layout: unknown[]): MasolatOldal {
  return { id, slug, title, layout }
}

/**
 * A cél sorcímkéje, ahogy a SectionRowLabel rajzolja: oldalfüggő leírás a cél
 * oldal webcímével (describeSectionOnPage), beégetett szöveg nélkül.
 */
function sorcimke(cel: MasolatOldal, index: number): string {
  const szekcio = cel.layout[index] as { blockType: string }
  const forras = cimkek[szekcio.blockType]
  const leiras = describeSectionOnPage(
    szekcio,
    index,
    forras?.blockLabel ?? szekcio.blockType,
    forras?.textFields ?? [],
    cel.slug,
  )
  return sectionRowLabelText({
    ...leiras,
    ismetles: sectionRepeatOrdinals(cel.layout)[index] ?? null,
  })
}

function bemenet(reszek: Partial<SzekcioMasolatBemenet> & Pick<SzekcioMasolatBemenet, 'oldal'>) {
  return szekcioMasolatok({
    sorIndex: 0,
    masOldalak: [],
    munkatarsak: [],
    cimkek,
    adminRoute: ADMIN,
    ...reszek,
  })
}

const szolgaltatas = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
  id: blokkId(n),
  blockType: 'services',
  title,
  sectionSettings: { visible: true },
  ...extra,
})

describe('telefonKulcs', () => {
  it('a +36, a 06 és a 0036 előtag ugyanazt a kulcsot adja', () => {
    expect(telefonKulcs('+36 30 169 2263')).toBe('36301692263')
    expect(telefonKulcs('06 30 169 2263')).toBe('36301692263')
    expect(telefonKulcs('06-30/169-2263')).toBe('36301692263')
    expect(telefonKulcs('0036 30 169 2263')).toBe('36301692263')
  })

  it('a rövid (félig beírt) számnak és a nem szövegnek nincs kulcsa', () => {
    expect(telefonKulcs('06 30 1')).toBeNull()
    expect(telefonKulcs('1234567')).toBeNull()
    expect(telefonKulcs(36301692263)).toBeNull()
    expect(telefonKulcs(undefined)).toBeNull()
  })
})

describe('szekcioMasolatok: hasonló szekció más oldalon', () => {
  const kezdolap = oldal(1, 'kezdolap', 'Mozdulj velünk', [szolgaltatas(1, 'Így tudunk segíteni')])
  const szolgaltatasok = oldal(2, 'szolgaltatasok', 'Szolgáltatások', [
    { id: blokkId(2), blockType: 'richText', sectionSettings: { visible: true } },
    szolgaltatas(3, 'Rendelői kezelések'),
  ])

  it('két oldal azonos services-típussal hasonló-csoportot ad, a cél sorcímkéjével', () => {
    const modell = bemenet({ oldal: kezdolap, masOldalak: [kezdolap, szolgaltatasok] })
    expect(modell.oldalHiba).toBe(false)
    expect(modell.csoportok).toHaveLength(1)
    const [hasonlo] = modell.csoportok
    expect(hasonlo?.fajta).toBe('hasonlo')
    expect(hasonlo?.helyek).toEqual([
      {
        kulcs: 'oldal:2:1',
        felirat: `Szolgáltatások${ELVALASZTO}${sorcimke(szolgaltatasok, 1)}`,
        href: szekcioMelylink({
          adminRoute: ADMIN,
          collection: 'pages',
          id: 2,
          blokkId: blokkId(3),
        }),
        ugyanitt: false,
      },
    ])
    expect(hasonlo?.helyek[0]?.href).toBe(`/admin/collections/pages/2?szekcio=${blokkId(3)}`)
    expect(csoportBevezeto(hasonlo ?? { fajta: 'hasonlo', ertekek: [] })).toBe(
      'Hasonló szekció más oldalon:',
    )
    expect(csoportTeendo('hasonlo')).toContain('csak ezt az oldalt érinti')
  })

  it('a Szolgáltatások oldal services-sora a sorcímke „(tábla)” jelét viszi', () => {
    const modell = bemenet({ oldal: kezdolap, masOldalak: [kezdolap, szolgaltatasok] })
    const felirat = modell.csoportok[0]?.helyek[0]?.felirat
    expect(felirat).toBe(`Szolgáltatások${ELVALASZTO}${sorcimke(szolgaltatasok, 1)}`)
    expect(felirat).toContain(ELRENDEZES_JEL.tabla)
  })

  it('a kezdőlapi sín üres Címmel a sorcímke beépített címét viszi', () => {
    const sin = {
      id: blokkId(5),
      blockType: 'services',
      title: '',
      eyebrow: '',
      rows: LEGACY_HOME_HELP_TITLES.map((title, i) => ({ title, url: LEGACY_HOME_HELP_URLS[i] })),
      sectionSettings: { visible: true },
    }
    const kezdolapSinnel = oldal(1, 'kezdolap', 'Mozdulj velünk', [sin])
    const modell = bemenet({ oldal: szolgaltatasok, sorIndex: 1, masOldalak: [kezdolapSinnel] })
    const felirat = modell.csoportok[0]?.helyek[0]?.felirat
    expect(felirat).toBe(`Kezdőlap${ELVALASZTO}${sorcimke(kezdolapSinnel, 0)}`)
    expect(felirat).toContain(BEEPITETT_CIM)
    expect(felirat).toContain(ELRENDEZES_JEL.sin)
  })

  it('a rejtett szekció más oldalon nem számít hasonlónak', () => {
    const rejtett = oldal(3, 'rolunk', 'Rólunk', [
      szolgaltatas(4, 'Rejtett', { sectionSettings: { visible: false } }),
    ])
    const modell = bemenet({ oldal: kezdolap, masOldalak: [rejtett] })
    expect(modell.csoportok).toEqual([])
  })

  it('a kezdőlap neve „Kezdőlap”, a cím nélküli oldalé a webcím', () => {
    expect(oldalNev({ slug: 'kezdolap', title: 'Mozdulj velünk' })).toBe('Kezdőlap')
    expect(oldalNev({ slug: 'kapcsolat', title: '' })).toBe('/kapcsolat')
  })

  it('a HASONLO_KIHAGYOTT_TIPUSOK típusai nem adnak hasonló-csoportot', () => {
    expect([...HASONLO_KIHAGYOTT_TIPUSOK].sort()).toEqual(
      ['courseCards', 'knowledge', 'richText', 'testimonials'].sort(),
    )
    for (const tipus of HASONLO_KIHAGYOTT_TIPUSOK) {
      const sor = (n: number) => ({
        id: blokkId(n),
        blockType: tipus,
        sectionSettings: { visible: true },
      })
      const itt = oldal(1, 'kezdolap', 'Kezdő', [sor(10)])
      const ott = oldal(2, 'rolunk', 'Rólunk', [sor(11)])
      const modell = bemenet({ oldal: itt, masOldalak: [ott], munkatarsak: null })
      expect(modell.csoportok.filter((cs) => cs.fajta === 'hasonlo')).toEqual([])
      expect(modell.oldalHiba).toBe(false)
    }
  })

  it('MAX_HELY felett a lista levágva, a maradék „és még N”', () => {
    const tobbi = Array.from({ length: MAX_HELY + 2 }, (_, i) =>
      oldal(10 + i, `oldal-${String(i)}`, `Oldal ${String(i)}`, [
        szolgaltatas(20 + i, `Sor ${String(i)}`),
      ]),
    )
    const modell = bemenet({ oldal: kezdolap, masOldalak: tobbi })
    const [hasonlo] = modell.csoportok
    expect(hasonlo?.helyek).toHaveLength(MAX_HELY)
    expect(hasonlo?.tobbi).toBe(2)
    expect(esMeg(hasonlo?.tobbi ?? 0)).toBe('és még 2')
  })

  it('masOldalak: null esetén oldalHiba, és nincs hasonló-csoport', () => {
    const modell = bemenet({ oldal: kezdolap, masOldalak: null })
    expect(modell.oldalHiba).toBe(true)
    expect(modell.csoportok).toEqual([])
  })
})

describe('szekcioMasolatok: közös telefonszám, e-mail-cím és kép', () => {
  const idopont = {
    id: blokkId(30),
    blockType: 'appointment',
    title: 'Időpontkérés',
    telefonszamok: [{ id: 'a1', nev: 'Kocsis Kata', szam: '+36 30 169 2263' }],
    email: 'Info@Kineticare.hu ',
    sectionSettings: { visible: true },
  }
  const szakemberek = {
    id: blokkId(31),
    blockType: 'teamMembers',
    title: 'Szakembereink',
    members: [
      {
        id: 'm1',
        name: 'Kocsis Kata',
        phone: '06 30 169 2263',
        email: 'info@kineticare.hu',
        photo: 7,
      },
    ],
    sectionSettings: { visible: true },
  }
  const kapcsolat = oldal(5, 'kapcsolat', 'Kapcsolat', [idopont, szakemberek])

  it('a Kapcsolat oldalon az időpontkérő és a szakember azonos száma `ugyanitt: true`', () => {
    const modell = bemenet({ oldal: kapcsolat, sorIndex: 0 })
    const telefon = modell.csoportok.find((cs) => cs.fajta === 'telefon')
    expect(telefon?.ertekek).toEqual(['+36 30 169 2263'])
    expect(telefon?.helyek).toEqual([
      {
        kulcs: 'oldal:5:1',
        felirat: `Kapcsolat${ELVALASZTO}${sorcimke(kapcsolat, 1)}`,
        href: `/admin/collections/pages/5?szekcio=${blokkId(31)}`,
        ugyanitt: true,
      },
    ])
    expect(csoportBevezeto(telefon ?? { fajta: 'telefon', ertekek: [] })).toBe(
      'Ugyanez a telefonszám (+36 30 169 2263) máshol is szerepel:',
    )
    const email = modell.csoportok.find((cs) => cs.fajta === 'email')
    expect(email?.helyek.map((hely) => hely.ugyanitt)).toEqual([true])
    expect(csoportTeendo('telefon')).toBe('Ha itt cseréled, ott is cseréld.')
  })

  it('az arckép-egyezés a Felhasználók adatlapjára visz', () => {
    const modell = bemenet({
      oldal: kapcsolat,
      sorIndex: 1,
      munkatarsak: [
        { id: 3, nev: 'Kocsis Kata', arckep: 7 },
        { id: 4, nev: 'Kiss Kata', arckep: { id: 8 } },
      ],
    })
    const kep = modell.csoportok.find((cs) => cs.fajta === 'kep')
    expect(kep?.helyek).toEqual([
      {
        kulcs: 'felhasznalo:3',
        felirat: 'Felhasználók · Kocsis Kata · Arckép',
        href: '/admin/collections/users/3',
        ugyanitt: false,
      },
    ])
    expect(modell.munkatarsHiba).toBe(false)
  })

  it('a közös kép más oldalon is megtalálható (Képek-azonosító szerint)', () => {
    const rolunk = oldal(6, 'rolunk', 'Rólunk', [
      { id: blokkId(40), blockType: 'about', title: 'Rólunk', photo: { id: 7 } },
    ])
    const modell = bemenet({ oldal: kapcsolat, sorIndex: 1, masOldalak: [rolunk] })
    const kep = modell.csoportok.find((cs) => cs.fajta === 'kep')
    expect(kep?.helyek.map((hely) => hely.href)).toEqual([
      `/admin/collections/pages/6?szekcio=${blokkId(40)}`,
    ])
  })

  it('munkatarsak: null esetén képes szekciónál munkatarsHiba', () => {
    const modell = bemenet({ oldal: kapcsolat, sorIndex: 1, munkatarsak: null })
    expect(modell.munkatarsHiba).toBe(true)
    const kepNelkul = bemenet({ oldal: kapcsolat, sorIndex: 0, munkatarsak: null })
    expect(kepNelkul.munkatarsHiba).toBe(false)
  })

  it('új, mentetlen oldalnál a saját sorra mutató hely link nélküli', () => {
    const uj: MasolatOldal = { ...kapcsolat, id: null }
    const modell = bemenet({ oldal: uj, sorIndex: 0 })
    const telefon = modell.csoportok.find((cs) => cs.fajta === 'telefon')
    expect(telefon?.helyek[0]?.href).toBeNull()
  })
})
