import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hu } from '@payloadcms/translations/languages/hu'
import { describe, expect, it } from 'vitest'

import * as aboutModul from '../blocks/about'
import * as accordionModul from '../blocks/accordion'
import * as appointmentModul from '../blocks/appointment'
import * as courseCardsModul from '../blocks/course-cards'
import * as coursePackageModul from '../blocks/CoursePackage'
import * as credsStripModul from '../blocks/creds-strip'
import * as ctaBannerModul from '../blocks/cta-banner'
import * as faqModul from '../blocks/faq'
import * as filmHeroModul from '../blocks/film-hero'
import * as freeSosModul from '../blocks/free-sos'
import * as howItWorksModul from '../blocks/how-it-works'
import * as indexModul from '../blocks/index'
import * as kepCsereModul from '../blocks/kep-csere'
import * as knowledgeModul from '../blocks/knowledge'
import * as linkFieldsModul from '../blocks/link-fields'
import * as pressLogosModul from '../blocks/press-logos'
import * as richTextModul from '../blocks/rich-text'
import * as sectionSettingsModul from '../blocks/section-settings'
import * as servicesModul from '../blocks/services'
import * as statesModul from '../blocks/states'
import * as teamMembersModul from '../blocks/team-members'
import * as testimonialsModul from '../blocks/testimonials'
import * as uspsModul from '../blocks/usps'
import * as welcomeModul from '../blocks/welcome'
import { HU_ADMIN_FORDITAS } from '../lib/admin/hu-forditas'

/**
 * Őr a blokknevekre és a blokkok hibaútvonalba kerülő címkéire
 * (docs/ui-sztenderdek.md 8.4 és 8.5).
 *
 * Kiinduló, mért hiba (2026-09-23, eldobható próbaoldal): a „Rólunk,
 * számokkal” blokknév vesszője a Payload közzétételi hibaértesítőjében két
 * értelmetlen tételre törte a szekció hibáját, és a számláló 5-öt mutatott a
 * valódi 4 helyett. Ok: @payloadcms/ui/dist/elements/Toasts/fieldErrors.js:37
 * a hibaútvonalak listáját vesszőnél vágja (`errorsString.split(',')`). Az
 * útvonalba a blokknév, a mezőcímke, a tömb, a collapsible és a fül címkéje
 * kerül, ezért egyikben sem lehet vessző.
 *
 * A blokkokat a src/blocks mappa MINDEN .ts fájljából gyűjti (a film-hero, a
 * free-sos és a knowledge exportjait is, csak olvasva). Új blokkfájlnál a
 * lefedettségi teszt bukik, amíg ide fel nem kerül.
 */

type Hiba = { hely: string; szoveg: string; ok: string }

/** A kezdőlap látható szekciócíme, amelyet egy blokknév sem utánozhat (modul-térkép, K27). */
const LATHATO_SZEKCIOCIM = 'Erre számíthatsz velünk'

/**
 * A sorcímke („NN · név: cím”, K27) miatt megengedett felső határ. A választóban
 * 1280 px-nél ennél kevesebb, nagyjából 22 karakter fér ki (ui-sztenderdek.md 8.4,
 * 2. szabály); azt a felirat sortörése oldja meg, nem ez az őr.
 */
const NEV_MAX_HOSSZ = 32

const MODULOK: Readonly<Record<string, Record<string, unknown>>> = {
  'about.ts': aboutModul,
  'accordion.ts': accordionModul,
  'appointment.ts': appointmentModul,
  'course-cards.ts': courseCardsModul,
  'CoursePackage.ts': coursePackageModul,
  'creds-strip.ts': credsStripModul,
  'cta-banner.ts': ctaBannerModul,
  'faq.ts': faqModul,
  'film-hero.ts': filmHeroModul,
  'free-sos.ts': freeSosModul,
  'how-it-works.ts': howItWorksModul,
  'index.ts': indexModul,
  'kep-csere.ts': kepCsereModul,
  'knowledge.ts': knowledgeModul,
  'link-fields.ts': linkFieldsModul,
  'press-logos.ts': pressLogosModul,
  'rich-text.ts': richTextModul,
  'section-settings.ts': sectionSettingsModul,
  'services.ts': servicesModul,
  'states.ts': statesModul,
  'team-members.ts': teamMembersModul,
  'testimonials.ts': testimonialsModul,
  'usps.ts': uspsModul,
  'welcome.ts': welcomeModul,
}

function objektum(ertek: unknown): ertek is Record<string, unknown> {
  return typeof ertek === 'object' && ertek !== null && !Array.isArray(ertek)
}

/** Blokk alakú érték: `slug` szöveg és `fields` tömb. */
function blokkAlaku(ertek: unknown): ertek is Record<string, unknown> & {
  slug: string
  fields: unknown[]
} {
  return objektum(ertek) && typeof ertek.slug === 'string' && Array.isArray(ertek.fields)
}

/**
 * Egy címke szövegei. A Payload címkéje lehet szöveg, nyelvenkénti objektum,
 * függvény vagy `false`; a függvény kimenete futásidejű, azt itt nem látjuk.
 */
function cimkeSzovegek(cimke: unknown): string[] {
  if (typeof cimke === 'string') return [cimke]
  if (objektum(cimke)) {
    return Object.values(cimke).filter((ertek): ertek is string => typeof ertek === 'string')
  }
  return []
}

/**
 * Gondolatjel a névben: nagy gondolatjel (—), vagy szóközök közti nagykötőjel
 * és kötőjel. A szóköz nélküli nagykötőjel (pl. „Kérdés–válasz”) szabályos.
 */
const GONDOLATJEL = /—|\s–\s|\s-\s/u

/**
 * Idézőjel-hiba: egyenes (") vagy angol (“) idézőjel, vagy pár nélküli „ és ”.
 * A magyar alak „…”: nyitó U+201E, záró U+201D (AkH. 240. j).
 */
function idezojelHiba(szoveg: string): boolean {
  if (/["“]/u.test(szoveg)) return true
  let nyitva = false
  for (const jel of szoveg) {
    if (jel === '„') {
      if (nyitva) return true
      nyitva = true
    } else if (jel === '”') {
      if (!nyitva) return true
      nyitva = false
    }
  }
  return nyitva
}

/** A blokknév (labels.singular) szabályai: 8.4, 2. és 5. szabály, 8.3 tipográfia. */
function nevHibak(nev: string, hely: string): Hiba[] {
  const hibak: Hiba[] = []
  if (nev.includes(',')) hibak.push({ hely, szoveg: nev, ok: 'vessző a blokknévben' })
  if (GONDOLATJEL.test(nev)) hibak.push({ hely, szoveg: nev, ok: 'gondolatjel a blokknévben' })
  if (idezojelHiba(nev)) hibak.push({ hely, szoveg: nev, ok: 'hibás idézőjel a blokknévben' })
  if ([...nev].length > NEV_MAX_HOSSZ) {
    hibak.push({ hely, szoveg: nev, ok: `hosszabb ${NEV_MAX_HOSSZ} karakternél` })
  }
  if (nev.trim().length === 0) hibak.push({ hely, szoveg: nev, ok: 'üres blokknév' })
  return hibak
}

function vesszo(szovegek: string[], hely: string, mi: string): Hiba[] {
  return szovegek
    .filter((szoveg) => szoveg.includes(','))
    .map((szoveg) => ({ hely, szoveg, ok: `vessző: ${mi}` }))
}

/** A `labels` objektum (tömb vagy blokk) egyes és többes száma. */
function labelsSzovegek(labels: unknown): { egyes: string[]; tobbes: string[] } {
  if (!objektum(labels)) return { egyes: [], tobbes: [] }
  return { egyes: cimkeSzovegek(labels.singular), tobbes: cimkeSzovegek(labels.plural) }
}

/**
 * A mezőfa minden hibaútvonalba kerülő címkéje, rekurzívan: mezőcímke,
 * tömbcímke (labels), collapsible-, row-, group- és fülcímke, valamint a
 * beágyazott blokkmezők blokkjai.
 */
function mezoCimkeHibak(mezok: unknown, utvonal: string): Hiba[] {
  if (!Array.isArray(mezok)) return []
  const hibak: Hiba[] = []
  mezok.forEach((mezo, index) => {
    if (!objektum(mezo)) return
    const nev = typeof mezo.name === 'string' ? mezo.name : `[${index}:${String(mezo.type)}]`
    const hely = `${utvonal}.${nev}`
    hibak.push(...vesszo(cimkeSzovegek(mezo.label), hely, `${String(mezo.type)} címkéje`))
    const { egyes, tobbes } = labelsSzovegek(mezo.labels)
    hibak.push(...vesszo(egyes, hely, 'labels.singular'), ...vesszo(tobbes, hely, 'labels.plural'))
    if (Array.isArray(mezo.fields)) hibak.push(...mezoCimkeHibak(mezo.fields, hely))
    if (mezo.type === 'tabs' && Array.isArray(mezo.tabs)) {
      mezo.tabs.forEach((ful, fulIndex) => {
        if (!objektum(ful)) return
        const fulHely = `${hely}.tab[${fulIndex}]`
        hibak.push(...vesszo(cimkeSzovegek(ful.label), fulHely, 'fül címkéje'))
        hibak.push(...mezoCimkeHibak(ful.fields, fulHely))
      })
    }
    if (mezo.type === 'blocks' && Array.isArray(mezo.blocks)) {
      for (const belso of mezo.blocks) hibak.push(...blokkHibak(belso, hely))
    }
  })
  return hibak
}

/** Egy blokk minden hibája: a neve (labels.singular) és a teljes mezőfája. */
function blokkHibak(blokk: unknown, szulo = ''): Hiba[] {
  if (!blokkAlaku(blokk)) return [{ hely: szulo, szoveg: '', ok: 'nem blokk alakú' }]
  const hely = szulo ? `${szulo}/${blokk.slug}` : blokk.slug
  const { egyes, tobbes } = labelsSzovegek(blokk.labels)
  const hibak: Hiba[] = []
  if (egyes.length === 0) hibak.push({ hely, szoveg: '', ok: 'hiányzó labels.singular' })
  for (const nev of egyes) hibak.push(...nevHibak(nev, `${hely} (név)`))
  hibak.push(...vesszo(tobbes, `${hely} (többes név)`, 'labels.plural'))
  hibak.push(...mezoCimkeHibak(blokk.fields, hely))
  return hibak
}

/**
 * A blokknevek együttes szabályai: különböző blokk nem viselheti ugyanazt a
 * nevet, és egyik név sem utánozhatja a kezdőlap látható szekciócímét
 * (a korábbi „„Erre számíthatsz” kártyák” pont ezért tévesztett típust).
 */
function nevUtkozesek(nevek: ReadonlyMap<string, string>): Hiba[] {
  const hibak: Hiba[] = []
  const latott = new Map<string, string>()
  const kulcs = (szoveg: string) => szoveg.trim().toLocaleLowerCase('hu')
  const tiltott = kulcs(LATHATO_SZEKCIOCIM)
  const tiltottTorzs = kulcs('Erre számíthatsz')
  for (const [slug, nev] of nevek) {
    const k = kulcs(nev)
    const masik = latott.get(k)
    if (masik !== undefined) {
      hibak.push({ hely: `${masik} és ${slug}`, szoveg: nev, ok: 'két blokk ugyanazzal a névvel' })
    }
    latott.set(k, slug)
    if (k === tiltott || k.includes(tiltottTorzs)) {
      hibak.push({ hely: slug, szoveg: nev, ok: 'a kezdőlap látható szekciócímét utánozza' })
    }
  }
  return hibak
}

/** A modulok exportjaiból (tömbökből is) minden blokk alakú érték. */
function osszesBlokk(): Array<{
  forras: string
  blokk: Record<string, unknown> & { slug: string }
}> {
  const talalatok: Array<{ forras: string; blokk: Record<string, unknown> & { slug: string } }> = []
  for (const [fajl, modul] of Object.entries(MODULOK)) {
    for (const [exportNev, ertek] of Object.entries(modul)) {
      const jeloltek = Array.isArray(ertek) ? ertek : [ertek]
      for (const jelolt of jeloltek) {
        if (blokkAlaku(jelolt)) talalatok.push({ forras: `${fajl}#${exportNev}`, blokk: jelolt })
      }
    }
  }
  return talalatok
}

/** Blokk-azonosító → név; ugyanaz a slug (nyers és burkolt) csak azonos névvel állhat. */
function nevekSlugSzerint(): { nevek: Map<string, string>; eltero: string[] } {
  const nevek = new Map<string, string>()
  const eltero: string[] = []
  for (const { forras, blokk } of osszesBlokk()) {
    const nev = labelsSzovegek(blokk.labels).egyes.join(' | ')
    const eddigi = nevek.get(blokk.slug)
    if (eddigi !== undefined && eddigi !== nev) eltero.push(`${forras}: „${nev}” ≠ „${eddigi}”`)
    if (eddigi === undefined) nevek.set(blokk.slug, nev)
  }
  return { nevek, eltero }
}

describe('blokknevek és hibaútvonal-címkék: lefedettség', () => {
  it('a src/blocks mappa minden .ts fájlja be van olvasva', () => {
    const mappa = fileURLToPath(new URL('../blocks', import.meta.url))
    const fajlok = readdirSync(mappa)
      .filter((fajl) => fajl.endsWith('.ts'))
      .sort()
    expect(Object.keys(MODULOK).sort()).toEqual(fajlok)
  })

  it('a szekció-katalógus minden blokkja és a kurzuscsomag is sorra kerül', () => {
    const { nevek } = nevekSlugSzerint()
    for (const slug of indexModul.pageBlockSlugs) expect(nevek.has(slug), slug).toBe(true)
    expect(nevek.has('coursePackage')).toBe(true)
    expect(nevek.has('filmHero')).toBe(true)
    expect(nevek.has('freeSos')).toBe(true)
    expect(nevek.has('knowledge')).toBe(true)
    expect(nevek.size).toBeGreaterThanOrEqual(20)
  })

  it('a nyers és a burkolt (pageBlocks) blokk ugyanazt a nevet viseli', () => {
    expect(nevekSlugSzerint().eltero).toEqual([])
  })
})

describe('blokknevek és hibaútvonal-címkék: a valódi blokkok', () => {
  it('minden blokknév rövid, vessző, gondolatjel és hibás idézőjel nélküli', () => {
    const hibak = osszesBlokk().flatMap(({ blokk }) =>
      nevHibak(labelsSzovegek(blokk.labels).egyes.join(' | '), `${blokk.slug} (név)`),
    )
    expect(hibak).toEqual([])
  })

  it('minden blokknév egyedi, és egyik sem a látható „Erre számíthatsz velünk” szekciócím', () => {
    expect(nevUtkozesek(nevekSlugSzerint().nevek)).toEqual([])
  })

  it('a blokkok mezőfájában (collapsible, row, tabs, group, array, blocks) nincs vesszős címke', () => {
    const hibak = osszesBlokk().flatMap(({ blokk }) => blokkHibak(blokk))
    expect(hibak).toEqual([])
  })

  it('az about neve „Bemutatkozás és számok”, a korábbi vesszős név nem tér vissza', () => {
    const { nevek } = nevekSlugSzerint()
    expect(nevek.get('about')).toBe('Bemutatkozás és számok')
    expect(labelsSzovegek(aboutModul.about.labels).tobbes).toEqual(['Bemutatkozó szekciók'])
    expect(labelsSzovegek(accordionModul.accordion.labels).tobbes).toEqual([
      'Nyitható soros szekciók',
    ])
  })
})

describe('az ellenőrző maga elkapja a hibát (szintetikus, hibás blokk)', () => {
  const hibasBlokk: unknown = {
    slug: 'probaBlokk',
    labels: { singular: 'Rólunk, számokkal', plural: 'Próbák, tesztek' },
    fields: [
      {
        type: 'collapsible',
        label: 'Megjelenés, elrejtés',
        fields: [{ name: 'utca', type: 'text', label: 'Utca, házszám' }],
      },
      {
        type: 'tabs',
        tabs: [{ label: 'Első, második', fields: [{ name: 'a', type: 'text', label: 'Rendben' }] }],
      },
      {
        name: 'sorok',
        type: 'array',
        label: 'Sorok',
        labels: { singular: 'Sor, elem', plural: 'Sorok, elemek' },
        fields: [
          {
            type: 'row',
            fields: [{ name: 'titulus', type: 'text', label: { hu: 'Titulus, foglalkozás' } }],
          },
        ],
      },
      {
        name: 'csoport',
        type: 'group',
        label: 'Csoport, név',
        fields: [],
      },
      {
        name: 'belso',
        type: 'blocks',
        blocks: [
          {
            slug: 'belsoBlokk',
            labels: { singular: 'Belső — blokk', plural: 'Belsők' },
            fields: [{ name: 'b', type: 'text', label: 'Videók (régi, fejezet nélküli lista)' }],
          },
        ],
      },
    ],
  }

  it('minden vesszős helyet megtalál, a blokknévtől a beágyazott blokk mezőjéig', () => {
    const hibak = blokkHibak(hibasBlokk)
    const helyek = hibak.map((hiba) => `${hiba.hely} :: ${hiba.ok}`)
    expect(helyek).toEqual(
      expect.arrayContaining([
        'probaBlokk (név) :: vessző a blokknévben',
        'probaBlokk (többes név) :: vessző: labels.plural',
        'probaBlokk.[0:collapsible] :: vessző: collapsible címkéje',
        'probaBlokk.[0:collapsible].utca :: vessző: text címkéje',
        'probaBlokk.[1:tabs].tab[0] :: vessző: fül címkéje',
        'probaBlokk.sorok :: vessző: labels.singular',
        'probaBlokk.sorok :: vessző: labels.plural',
        'probaBlokk.sorok.[0:row].titulus :: vessző: text címkéje',
        'probaBlokk.csoport :: vessző: group címkéje',
        'probaBlokk.belso/belsoBlokk (név) :: gondolatjel a blokknévben',
        'probaBlokk.belso/belsoBlokk.b :: vessző: text címkéje',
      ]),
    )
    expect(hibak).toHaveLength(11)
  })

  it('a vessző nélküli változatot átengedi (nincs hamis riasztás)', () => {
    const javitott = JSON.parse(
      JSON.stringify(hibasBlokk)
        .replaceAll('Rólunk, számokkal', 'Bemutatkozás és számok')
        .replaceAll('Próbák, tesztek', 'Próbák')
        .replaceAll('Megjelenés, elrejtés', 'Megjelenés és elrejtés')
        .replaceAll('Utca, házszám', 'Utca és házszám')
        .replaceAll('Első, második', 'Első')
        .replaceAll('Sor, elem', 'Sor')
        .replaceAll('Sorok, elemek', 'Sorok')
        .replaceAll('Titulus, foglalkozás', 'Titulus vagy foglalkozás')
        .replaceAll('Csoport, név', 'Csoport')
        .replaceAll('Belső — blokk', 'Belső blokk')
        .replaceAll('Videók (régi, fejezet nélküli lista)', 'Régi videólista'),
    ) as unknown
    expect(blokkHibak(javitott)).toEqual([])
  })

  it.each([
    ['vessző', 'Rólunk, számokkal', 'vessző a blokknévben'],
    ['gondolatjel', 'Film — nyitó', 'gondolatjel a blokknévben'],
    ['szóközös nagykötőjel', 'Film – nyitó', 'gondolatjel a blokknévben'],
    ['egyenes záró idézőjel', '„Erre számíthatsz" kártyák', 'hibás idézőjel a blokknévben'],
    ['angol idézőjel', '“Ígéretek” kártyákon', 'hibás idézőjel a blokknévben'],
    ['pár nélküli „', '„Ígéretek kártyákon', 'hibás idézőjel a blokknévben'],
    ['hossz', 'Nagyon hosszú blokknév amely nem fér ki', `hosszabb ${NEV_MAX_HOSSZ} karakternél`],
  ])('a névszabály elkapja: %s', (_eset, nev, ok) => {
    expect(nevHibak(nev, 'x').map((hiba) => hiba.ok)).toContain(ok)
  })

  it('a szóköz nélküli nagykötőjel és a helyes „…” idézőjel nem hiba', () => {
    expect(nevHibak('Kérdés–válasz párok', 'x')).toEqual([])
    expect(nevHibak('„Ígéretek” kártyákon', 'x')).toEqual([])
  })

  it('az ütközés-ellenőrző elkapja az ismétlődő nevet és a szekciócím utánzását', () => {
    const okok = nevUtkozesek(
      new Map([
        ['elso', 'Logósor'],
        ['masodik', 'logósor'],
        ['harmadik', LATHATO_SZEKCIOCIM],
        ['negyedik', '„Erre számíthatsz” kártyák'],
      ]),
    ).map((hiba) => `${hiba.hely} :: ${hiba.ok}`)
    expect(okok).toEqual([
      'elso és masodik :: két blokk ugyanazzal a névvel',
      'harmadik :: a kezdőlap látható szekciócímét utánozza',
      'negyedik :: a kezdőlap látható szekciócímét utánozza',
    ])
  })
})

describe('képmező-súgó: a felület tényleges gombnevei (K36, 8.5)', () => {
  const general: Record<string, unknown> = HU_ADMIN_FORDITAS.general
  const fields: Record<string, unknown> = HU_ADMIN_FORDITAS.fields
  const sajatUj = general.createNew
  const sajatValaszt = fields.chooseFromExisting
  const ujLetrehozasa = typeof sajatUj === 'string' ? sajatUj : hu.translations.general.createNew
  const valasszMeglevok =
    typeof sajatValaszt === 'string' ? sajatValaszt : hu.translations.fields.chooseFromExisting

  it('a gombnevek ma „Új létrehozása” és „Válassz a meglévők közül”', () => {
    expect(ujLetrehozasa).toBe('Új létrehozása')
    expect(valasszMeglevok).toBe('Válassz a meglévők közül')
  })

  it('a súgó az „Új létrehozása” gombot idézőjelben, szó szerint nevezi meg', () => {
    expect(kepCsereModul.KEP_CSERE_SUGO).toContain(`„${ujLetrehozasa}”`)
  })

  it('a súgó a „Válassz a meglévők közül” gombot kis kezdőbetűvel, szó szerint mondja', () => {
    const kisbetus = `${valasszMeglevok.charAt(0).toLocaleLowerCase('hu')}${valasszMeglevok.slice(1)}`
    expect(kepCsereModul.KEP_CSERE_SUGO).toContain(kisbetus)
  })

  it('a súgó maga is tipográfiailag helyes (idézőjel-pár, gondolatjel nélkül)', () => {
    expect(idezojelHiba(kepCsereModul.KEP_CSERE_SUGO)).toBe(false)
    expect(GONDOLATJEL.test(kepCsereModul.KEP_CSERE_SUGO)).toBe(false)
  })
})

describe('a Szabad szöveg Tartalom-súgója (B2-2-4)', () => {
  it('betűre az előnézeti árlista-szabályt mondja, a rendelői ugrópont nevével', async () => {
    const { RICH_TEXT_TARTALOM_SUGO, richText } = await import('../blocks/rich-text')
    const { ARLISTA_TEENDO } = await import('../components/editor/frontend/szerkeszto-szalag')
    expect(RICH_TEXT_TARTALOM_SUGO).toContain(ARLISTA_TEENDO)
    expect(RICH_TEXT_TARTALOM_SUGO).toContain('„rendeloi”')
    const tartalom = richText.fields.find((mezo) => 'name' in mezo && mezo.name === 'content')
    expect(tartalom?.type).toBe('richText')
    if (tartalom?.type !== 'richText') return
    expect(tartalom.admin?.description).toBe(RICH_TEXT_TARTALOM_SUGO)
  })
})
