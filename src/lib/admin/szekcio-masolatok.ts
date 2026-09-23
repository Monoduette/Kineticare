import { szekcioMelylink } from '../../components/editor/szekcio-melylink'
import { HOME_PAGE_SLUG } from '../content-slugs'
import {
  describeSection,
  ELVALASZTO,
  isSectionHidden,
  nevelo,
  nonEmptyText,
  SECTION_TITLE_MAX_LENGTH,
  sectionRepeatOrdinals,
  sectionRowLabelText,
  truncateAtWord,
} from '../section-row-label'

/**
 * „Ugyanaz máshol”: a szekció elején álló jelzés adatai (modul-térkép H10,
 * H49). Tiszta modul, React és Payload nélkül; az admin kliens-komponense
 * (src/components/admin/SectionCopies.tsx) hívja, a teszt közvetlenül.
 *
 * MIT MOND KI, és csak ha igaz:
 * (a) más oldalon azonos típusú, nem rejtett szekció áll. Ezek FÜGGETLEN
 *     példányok, az itteni módosítás csak ezt az oldalt érinti;
 * (b) ugyanaz a telefonszám, e-mail-cím vagy kép ezen az oldalon egy MÁSIK
 *     sorban, más oldalon, vagy (képnél) egy tulajdonos vagy munkatárs
 *     Felhasználók → Arckép mezőjében is szerepel.
 * Minden hely link: az oldal szerkesztője a sorral (`szekcioMelylink`,
 * `?szekcio=<blokk-azonosító>`, a mélylink-nyitó kinyitja és az első beviteli
 * mezőre fókuszál), munkatársnál a Felhasználók adatlapja.
 *
 * MIÉRT. A tulajdonos szavaival: „amit szerkeszteni akart, hasonlóan kinéző
 * modul, de más tartalom volt benne”. Mérve 2026-09-22 (modul-térkép): a
 * háromajtós sín, a logósor, a gombos sáv és a szakember-kártyák több oldalon
 * külön példányként élnek, a két szakember telefonszáma a Kapcsolat oldalon két
 * mezőben, a portré négy-öt helyen, és ezt semmi nem jelezte.
 * Források (megnyitva, 2026-09-23):
 * - NN/g, Maintain Consistency and Adhere to Standards (Usability Heuristic
 *   #4): „Users should not have to wonder whether different words,
 *   situations, or actions mean the same thing.”
 *   https://www.nngroup.com/articles/consistency-and-standards/
 * - WordPress, Synced Patterns: a szinkronizált minta „Editing the synced
 *   pattern will update it anywhere it is used.”, a leválasztott példányt
 *   viszont „without affecting your already saved synced pattern” lehet
 *   szerkeszteni. A mi szekcióink a második fajták: ezt mondjuk ki.
 *   https://wordpress.org/documentation/article/reusable-blocks/
 * - Sanity Studio, View incoming references: „The incoming references
 *   interface displays documents that reference the active document.”, és
 *   „Select a document to open the referencing document in a new pane.”
 *   Nálunk nincs hivatkozás, csak egyező érték, ezért a hely felsorolása
 *   és a link a minta. https://www.sanity.io/docs/studio/incoming-references
 * - WCAG 2.2 SC 3.2.4 Consistent Identification: „Components that have the
 *   same functionality within a set of web pages are identified
 *   consistently.” A hely neve ezért BETŰRE a cél sorcímkéje
 *   (`describeSection`, `sectionRowLabelText`, a SectionRowLabel ugyanezt
 *   rajzolja). https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 *
 * A (b) MEZŐI a blokkok tényleges sémájából (src/blocks/*.ts), a
 * szekcio-masolatok.test.ts a teljes pageBlocks-katalógus bejárásával köti
 * össze: minden képmező (`type: 'upload'`), minden „Telefonszám” és minden
 * „E-mail-cím” címkéjű szövegmező itt szerepel, és semmi más. A
 * szövegszerkesztőbe ágyazott kép (Lexical upload-csomópont) szándékosan
 * kimarad: a súgó a képmező ceruzájáról és X-éről szól, és mérve (élő adat,
 * 2026-09-22) az egyetlen beágyazott kép a Rólunk harmonikájában a saját sora
 * „Kis portré a sor elején” mezőjében is ott van, így a sort ez a szabály is
 * megtalálja.
 */

type Adat = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Adat {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/* ------------------------------------------------------------------------ */
/* Bemenetek                                                                 */
/* ------------------------------------------------------------------------ */

/** Egy oldal a jelzéshez: azonosító, webcím, cím és a szekciósor. */
export interface MasolatOldal {
  id: number | string | null
  slug: unknown
  title: unknown
  layout: readonly unknown[]
}

/** Tulajdonos vagy munkatárs a Felhasználók közül (név és az Arckép azonosítója). */
export interface MasolatMunkatars {
  id: number | string
  nev: string
  arckep: unknown
}

/** A sorcímke forrása blokktípusonként: ugyanaz, amit a SectionRowLabel kap. */
export interface BlokkCimkeForras {
  blockLabel: string
  textFields: readonly string[]
}

export interface SzekcioMasolatBemenet {
  /** A szerkesztett oldal, a szekciósor a form-állapotból (mentés nélkül is friss). */
  oldal: MasolatOldal
  /** A szekció 0-alapú sorindexe. */
  sorIndex: number
  /** A többi oldal (REST, `draft=true`), vagy null, ha nem sikerült betölteni. */
  masOldalak: readonly MasolatOldal[] | null
  /** A tulajdonosok és munkatársak, vagy null, ha nem sikerült betölteni. */
  munkatarsak: readonly MasolatMunkatars[] | null
  /** Blokktípus → sorcímke-forrás (a blocks/index.ts adja). */
  cimkek: Readonly<Record<string, BlokkCimkeForras>>
  /** Az admin gyökere (`config.routes.admin`). */
  adminRoute: string
}

/* ------------------------------------------------------------------------ */
/* Szabályok                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Az (a) szabályból kimaradó típusok.
 * - courseCards, testimonials, knowledge: automatikusan töltődnek, a közös
 *   forrást a szekció-tájékoztató már kimondja (sectionSource), a „külön
 *   példány” itt félrevezető volna.
 * - richText (Szabad szöveg): általános szövegtartó, két példánya nem
 *   „hasonlóan kinéző modul”, hanem két különböző szöveg. Mérve 2026-09-23
 *   (helyi adat, 18 oldal): a két valódi példány a Rólunk bevezetője és a
 *   Szolgáltatások árlistája, egymást jeleznék (és a két eldobható próbaoldal
 *   négy sora mellettük), vagyis minden szabad szövegnél zaj. A faq marad:
 *   ma egy oldalon áll (0 tétel), de ha egy második oldalra is kerül, két
 *   hasonló kérdéslista valódi összetévesztési eset.
 */
export const HASONLO_KIHAGYOTT_TIPUSOK: ReadonlySet<string> = new Set([
  'courseCards',
  'testimonials',
  'knowledge',
  'richText',
])

/** Csoportonként legfeljebb ennyi hely látszik, utána „és még N”. */
export const MAX_HELY = 4

/** A telefonszám-mezők blokktípusonként (`*` = a tömb minden sora). */
export const TELEFON_MEZOK: Readonly<Record<string, readonly string[]>> = {
  appointment: ['telefonszamok.*.szam'],
  teamMembers: ['members.*.phone'],
}

/** Az e-mail-cím-mezők blokktípusonként. */
export const EMAIL_MEZOK: Readonly<Record<string, readonly string[]>> = {
  appointment: ['email'],
  teamMembers: ['members.*.email'],
}

/** A képmezők (upload, Képek) blokktípusonként, tömbökben is. */
export const KEP_MEZOK: Readonly<Record<string, readonly string[]>> = {
  about: ['photo'],
  accordion: ['items.*.kep'],
  freeSos: ['backgroundImage'],
  pressLogos: ['logos.*.image'],
  services: ['image', 'rows.*.photo'],
  states: ['cards.*.image'],
  teamMembers: ['members.*.photo'],
}

export type KozosAdatFajta = 'telefon' | 'email' | 'kep'

const MEZOK: Readonly<Record<KozosAdatFajta, Readonly<Record<string, readonly string[]>>>> = {
  telefon: TELEFON_MEZOK,
  email: EMAIL_MEZOK,
  kep: KEP_MEZOK,
}

const FAJTAK: readonly KozosAdatFajta[] = ['telefon', 'email', 'kep']

/**
 * A telefonszám összevetési kulcsa: csak a számjegyek, a belföldi „06” és a
 * nemzetközi „0036” előtag a „36”-tal egyenértékű (a „+36” pluszjele eleve
 * kimarad). Nyolc számjegy alatt nincs kulcs: a félig beírt szám ne adjon
 * hamis egyezést.
 */
export function telefonKulcs(ertek: unknown): string | null {
  if (typeof ertek !== 'string') {
    return null
  }
  let szamjegyek = ertek.replace(/\D/g, '')
  if (szamjegyek.startsWith('0036')) {
    szamjegyek = szamjegyek.slice(2)
  } else if (szamjegyek.startsWith('06')) {
    szamjegyek = `36${szamjegyek.slice(2)}`
  }
  return szamjegyek.length >= 8 ? szamjegyek : null
}

/** Az e-mail-cím kulcsa: szóközök nélkül, kisbetűvel; „@” nélkül nincs kulcs. */
export function emailKulcs(ertek: unknown): string | null {
  if (typeof ertek !== 'string') {
    return null
  }
  const kulcs = ertek.trim().toLowerCase()
  return kulcs.includes('@') ? kulcs : null
}

/** A kép kulcsa: a Képek-dokumentum azonosítója (szám, szöveg vagy `{ id }`). */
export function kepKulcs(ertek: unknown): string | null {
  if (typeof ertek === 'number' && Number.isFinite(ertek)) {
    return String(ertek)
  }
  if (typeof ertek === 'string') {
    const kulcs = ertek.trim()
    return /^[\w-]+$/.test(kulcs) ? kulcs : null
  }
  if (isRecord(ertek)) {
    return kepKulcs(ertek.id ?? ertek.value)
  }
  return null
}

const KULCSOLO: Readonly<Record<KozosAdatFajta, (ertek: unknown) => string | null>> = {
  telefon: telefonKulcs,
  email: emailKulcs,
  kep: kepKulcs,
}

/** Az útvonal minden értéke; a `*` a tömb (vagy számkulcsos objektum) minden elemét adja. */
export function ertekekUtvonalon(adat: unknown, utvonal: string): unknown[] {
  let jelenlegi: unknown[] = [adat]
  for (const resz of utvonal.split('.')) {
    const kovetkezo: unknown[] = []
    for (const elem of jelenlegi) {
      if (resz === '*') {
        if (Array.isArray(elem)) {
          kovetkezo.push(...(elem as unknown[]))
        } else if (isRecord(elem)) {
          kovetkezo.push(...Object.values(elem))
        }
      } else if (isRecord(elem) && resz in elem) {
        kovetkezo.push(elem[resz])
      }
    }
    jelenlegi = kovetkezo
  }
  return jelenlegi
}

/**
 * A szekciók közös adatai, szekció-objektumonként egyszer számolva: a többi
 * oldal sorai a betöltés után változatlanok, a szerkesztett oldal sorai
 * minden form-változásnál új objektumok (a régi bejegyzést a WeakMap elengedi).
 */
const adatTar = new WeakMap<object, Map<KozosAdatFajta, Map<string, string>>>()

/** Egy szekció közös adatai fajtánként: kulcs → az első előfordulás szövege. */
function kozosAdatok(szekcio: unknown, fajta: KozosAdatFajta): Map<string, string> {
  const tar = isRecord(szekcio) ? adatTar.get(szekcio) : undefined
  const meglevo = tar?.get(fajta)
  if (meglevo) {
    return meglevo
  }
  const eredmeny = new Map<string, string>()
  const blockType =
    isRecord(szekcio) && typeof szekcio.blockType === 'string' ? szekcio.blockType : ''
  for (const utvonal of MEZOK[fajta][blockType] ?? []) {
    for (const ertek of ertekekUtvonalon(szekcio, utvonal)) {
      const kulcs = KULCSOLO[fajta](ertek)
      if (kulcs !== null && !eredmeny.has(kulcs)) {
        eredmeny.set(kulcs, typeof ertek === 'string' ? ertek.trim() : kulcs)
      }
    }
  }
  if (isRecord(szekcio)) {
    const ujTar = tar ?? new Map<KozosAdatFajta, Map<string, string>>()
    ujTar.set(fajta, eredmeny)
    adatTar.set(szekcio, ujTar)
  }
  return eredmeny
}

/* ------------------------------------------------------------------------ */
/* Helyek és feliratok                                                       */
/* ------------------------------------------------------------------------ */

/** A kezdőlap neve a jelzésben (a lista címe helyett, amely a nyitómondat). */
export const KEZDOLAP_NEV = 'Kezdőlap'

/** Cím és webcím nélküli oldal neve. */
export const NEVTELEN_OLDAL = 'Cím nélküli oldal'

/** A Felhasználók gyűjtemény és az Arckép mező neve, ahogy az adminban áll. */
export const FELHASZNALOK_NEV = 'Felhasználók'
export const ARCKEP_MEZO_NEV = 'Arckép'

/**
 * Az oldal neve: a kezdolap webcímnél „Kezdőlap” (a lista címe ott a
 * nyitómondat, amelyről a szerkesztő nem ismeri fel), különben a Cím, amely az
 * Oldalak listájának első oszlopa (useAsTitle), a sorcímke címéhez hasonlóan
 * 60 karakternél szóhatáron vágva.
 */
export function oldalNev(oldal: Pick<MasolatOldal, 'slug' | 'title'>): string {
  const slug = nonEmptyText(oldal.slug)
  if (slug === HOME_PAGE_SLUG) {
    return KEZDOLAP_NEV
  }
  const cim = nonEmptyText(oldal.title)
  if (cim) {
    return truncateAtWord(cim, SECTION_TITLE_MAX_LENGTH)
  }
  return slug ? `/${slug}` : NEVTELEN_OLDAL
}

/** Egy hely a listában. */
export interface MasolatHely {
  /** Egyedi kulcs (React-kulcs és halmazkulcs). */
  kulcs: string
  /** A link szövege: „<oldal neve> · <sorcímke>”, munkatársnál „Felhasználók · <név> · Arckép”. */
  felirat: string
  /** A cél; null, ha még nincs hova vinni (új, mentetlen oldal). */
  href: string | null
  /** Ugyanennek a dokumentumnak egy másik sora (a link a lapot nem tölti újra). */
  ugyanitt: boolean
}

interface IndexeltHely extends MasolatHely {
  /** Rendezés: 0 = ugyanez az oldal, 1 = kezdőlap, 2 = más oldal, 3 = munkatárs. */
  csoport: number
  nev: string
  sor: number
}

/**
 * A sorok sorcímkéi egy szekciósorra és címke-katalógusra, egyszer számolva: a
 * szerkesztő minden sora ugyanazt a sorlistát kapja (useSiblingRows), így a 15
 * jelzés egy számolást használ.
 */
const cimkeTar = new WeakMap<readonly unknown[], WeakMap<object, string[]>>()

function sorCimkek(
  layout: readonly unknown[],
  cimkek: Readonly<Record<string, BlokkCimkeForras>>,
): string[] {
  let tar = cimkeTar.get(layout)
  if (!tar) {
    tar = new WeakMap()
    cimkeTar.set(layout, tar)
  }
  const meglevo = tar.get(cimkek)
  if (meglevo) {
    return meglevo
  }
  const ismetlesek = sectionRepeatOrdinals(layout)
  const eredmeny = layout.map((szekcio, index) => {
    const blockType =
      isRecord(szekcio) && typeof szekcio.blockType === 'string' ? szekcio.blockType : ''
    const forras = cimkek[blockType]
    const leiras = describeSection(
      szekcio,
      index,
      forras?.blockLabel ?? blockType,
      forras?.textFields ?? [],
    )
    return sectionRowLabelText({ ...leiras, ismetles: ismetlesek[index] ?? null })
  })
  tar.set(cimkek, eredmeny)
  return eredmeny
}

function oldalHref(
  adminRoute: string,
  id: number | string | null,
  blokkId: unknown,
): string | null {
  if (id === null) {
    return null
  }
  try {
    return szekcioMelylink({
      adminRoute,
      collection: 'pages',
      id,
      blokkId: typeof blokkId === 'string' ? blokkId : null,
    })
  } catch {
    // Hibás dokumentum-azonosító (programhiba): a hely link nélkül marad.
    return null
  }
}

function oldalKulcs(oldal: MasolatOldal): string {
  return oldal.id === null ? 'uj' : String(oldal.id)
}

function szekcioHely(
  oldal: MasolatOldal,
  index: number,
  cimkek: Readonly<Record<string, BlokkCimkeForras>>,
  adminRoute: string,
  ugyanitt: boolean,
): IndexeltHely {
  const nev = oldalNev(oldal)
  const szekcio = oldal.layout[index]
  const cimke = sorCimkek(oldal.layout, cimkek)[index] ?? ''
  return {
    kulcs: `oldal:${oldalKulcs(oldal)}:${String(index)}`,
    felirat: `${nev}${ELVALASZTO}${cimke}`,
    href: oldalHref(adminRoute, oldal.id, isRecord(szekcio) ? szekcio.id : undefined),
    ugyanitt,
    csoport: ugyanitt ? 0 : nonEmptyText(oldal.slug) === HOME_PAGE_SLUG ? 1 : 2,
    nev,
    sor: index,
  }
}

function munkatarsHely(munkatars: MasolatMunkatars, adminRoute: string): IndexeltHely {
  const nev = nonEmptyText(munkatars.nev) ?? `#${String(munkatars.id)}`
  const admin = adminRoute.replace(/\/+$/, '')
  return {
    kulcs: `felhasznalo:${String(munkatars.id)}`,
    felirat: `${FELHASZNALOK_NEV}${ELVALASZTO}${nev}${ELVALASZTO}${ARCKEP_MEZO_NEV}`,
    href: `${admin}/collections/users/${encodeURIComponent(String(munkatars.id))}`,
    ugyanitt: false,
    csoport: 3,
    nev,
    sor: 0,
  }
}

function helyRendezes(a: IndexeltHely, b: IndexeltHely): number {
  return a.csoport - b.csoport || a.nev.localeCompare(b.nev, 'hu') || a.sor - b.sor
}

function kiad(hely: IndexeltHely): MasolatHely {
  return { kulcs: hely.kulcs, felirat: hely.felirat, href: hely.href, ugyanitt: hely.ugyanitt }
}

/* ------------------------------------------------------------------------ */
/* A modell                                                                  */
/* ------------------------------------------------------------------------ */

export type MasolatCsoportFajta = 'hasonlo' | KozosAdatFajta

export interface MasolatCsoport {
  fajta: MasolatCsoportFajta
  /** Közös adatnál az egyező értékek (a szerkesztett sorban írt alakjukban), egyébként üres. */
  ertekek: readonly string[]
  /** Legfeljebb MAX_HELY hely. */
  helyek: readonly MasolatHely[]
  /** Ennyi további hely van („és még N”). */
  tobbi: number
}

export interface SzekcioMasolatModell {
  csoportok: readonly MasolatCsoport[]
  /** A többi oldal nem töltődött be, pedig a szekciónál számítana. */
  oldalHiba: boolean
  /** A Felhasználók nem töltődtek be, pedig a szekcióban kép van. */
  munkatarsHiba: boolean
}

function csoport(
  fajta: MasolatCsoportFajta,
  ertekek: readonly string[],
  helyek: readonly IndexeltHely[],
): MasolatCsoport {
  const rendezett = [...helyek].sort(helyRendezes)
  return {
    fajta,
    ertekek,
    helyek: rendezett.slice(0, MAX_HELY).map(kiad),
    tobbi: Math.max(0, rendezett.length - MAX_HELY),
  }
}

/**
 * A szekció jelzésének modellje. Üres csoportlista és hamis hibajelzők esetén
 * a komponens semmit nem rajzol.
 */
export function szekcioMasolatok(bemenet: SzekcioMasolatBemenet): SzekcioMasolatModell {
  const { oldal, sorIndex, masOldalak, munkatarsak, cimkek, adminRoute } = bemenet
  const szekcio = oldal.layout[sorIndex]
  const blockType =
    isRecord(szekcio) && typeof szekcio.blockType === 'string' ? szekcio.blockType : ''
  const tobbiOldal = (masOldalak ?? []).filter(
    (masik) => oldal.id === null || String(masik.id) !== String(oldal.id),
  )
  const csoportok: MasolatCsoport[] = []

  // (a) Hasonló szekció más oldalon: azonos típus, nem rejtett.
  const hasonloSzamit = blockType !== '' && !HASONLO_KIHAGYOTT_TIPUSOK.has(blockType)
  if (hasonloSzamit) {
    const helyek: IndexeltHely[] = []
    for (const masik of tobbiOldal) {
      masik.layout.forEach((masikSzekcio, index) => {
        if (
          isRecord(masikSzekcio) &&
          masikSzekcio.blockType === blockType &&
          !isSectionHidden(masikSzekcio)
        ) {
          helyek.push(szekcioHely(masik, index, cimkek, adminRoute, false))
        }
      })
    }
    if (helyek.length > 0) {
      csoportok.push(csoport('hasonlo', [], helyek))
    }
  }

  // (b) Közös adat: ugyanezen az oldalon egy másik sorban, más oldalon, arcképben.
  let vanKep = false
  let vanErtek = false
  for (const fajta of FAJTAK) {
    const sajat = kozosAdatok(szekcio, fajta)
    if (sajat.size === 0) {
      continue
    }
    vanErtek = true
    if (fajta === 'kep') {
      vanKep = true
    }
    const ertekHelyei = new Map<string, Map<string, IndexeltHely>>()
    const jelol = (kulcs: string, hely: () => IndexeltHely) => {
      if (!sajat.has(kulcs)) {
        return
      }
      const helyek = ertekHelyei.get(kulcs) ?? new Map<string, IndexeltHely>()
      const uj = hely()
      helyek.set(uj.kulcs, uj)
      ertekHelyei.set(kulcs, helyek)
    }
    oldal.layout.forEach((masikSzekcio, index) => {
      if (index === sorIndex) {
        return
      }
      for (const kulcs of kozosAdatok(masikSzekcio, fajta).keys()) {
        jelol(kulcs, () => szekcioHely(oldal, index, cimkek, adminRoute, true))
      }
    })
    for (const masik of tobbiOldal) {
      masik.layout.forEach((masikSzekcio, index) => {
        for (const kulcs of kozosAdatok(masikSzekcio, fajta).keys()) {
          jelol(kulcs, () => szekcioHely(masik, index, cimkek, adminRoute, false))
        }
      })
    }
    if (fajta === 'kep') {
      for (const munkatars of munkatarsak ?? []) {
        const kulcs = kepKulcs(munkatars.arckep)
        if (kulcs !== null) {
          jelol(kulcs, () => munkatarsHely(munkatars, adminRoute))
        }
      }
    }
    // Az azonos helyhalmazú értékek egy csoportba kerülnek (a sorrend az első előfordulásé).
    const csoportonkent = new Map<string, { ertekek: string[]; helyek: IndexeltHely[] }>()
    for (const [kulcs, szoveg] of sajat) {
      const helyek = ertekHelyei.get(kulcs)
      if (!helyek || helyek.size === 0) {
        continue
      }
      const halmaz = [...helyek.keys()].sort().join('|')
      const meglevo = csoportonkent.get(halmaz)
      if (meglevo) {
        meglevo.ertekek.push(szoveg)
      } else {
        csoportonkent.set(halmaz, { ertekek: [szoveg], helyek: [...helyek.values()] })
      }
    }
    for (const { ertekek, helyek } of csoportonkent.values()) {
      csoportok.push(csoport(fajta, ertekek, helyek))
    }
  }

  return {
    csoportok,
    oldalHiba: masOldalak === null && (hasonloSzamit || vanErtek),
    munkatarsHiba: munkatarsak === null && vanKep,
  }
}

/* ------------------------------------------------------------------------ */
/* Szövegek                                                                  */
/* ------------------------------------------------------------------------ */

/** Az (a) csoport bevezetője; utána a lista áll. */
export const HASONLO_BEVEZETO = 'Hasonló szekció más oldalon:'

/**
 * Az (a) csoport következménye. A WordPress „Detach” (leválasztott) mintájának
 * magyar megfelelője: a példányok külön élnek.
 */
export const HASONLO_TEENDO = 'Ezek külön példányok: az itteni módosítás csak ezt az oldalt érinti.'

/** Telefonszám és e-mail-cím: a csere teendője. */
export const SZOVEG_TEENDO = 'Ha itt cseréled, ott is cseréld.'

/**
 * Kép: összhangban a képmezők súgójával (src/blocks/kep-csere.ts
 * KEP_CSERE_SUGO): a kép kártyáján az X csak ebből a mezőből veszi ki, a
 * ceruza a Képek közös dokumentumát nyitja meg, és ott a kép adatai
 * mindenhol változnak (@payloadcms/ui/dist/fields/Upload/RelationshipContent).
 */
export const KEP_TEENDO =
  'Ha itt az X-szel kiveszed, és másik képet választasz, ott a régi marad. A ceruza viszont a kép adatait mindenhol módosítja.'

/** A többi oldal lekérésének hibája (SC 4.1.3: a doboz hiánya azt sugallná, hogy nincs másolat). */
export const OLDAL_HIBA =
  'A többi oldal szekcióit most nem sikerült betölteni, ezért nem látod, szerepel-e ott is ez a tartalom.'

/** A Felhasználók lekérésének hibája, csak képes szekciónál. */
export const MUNKATARS_HIBA = `A Felhasználók arcképeit most nem sikerült betölteni, ezért nem látod, szerepel-e ez a kép valamelyik ${ARCKEP_MEZO_NEV} mezőben.`

/** A levágott lista vége. */
export function esMeg(n: number): string {
  return `és még ${String(n)}`
}

const SZAMNEVEK: Readonly<Record<number, string>> = {
  2: 'két',
  3: 'három',
  4: 'négy',
  5: 'öt',
  6: 'hat',
  7: 'hét',
  8: 'nyolc',
  9: 'kilenc',
  10: 'tíz',
}

/** „a két”, „az öt”, „a 12”: névelő és számnév (tízig betűvel). */
function nevelosSzam(n: number): string {
  const szo = SZAMNEVEK[n]
  if (szo) {
    return `${szo.startsWith('ö') ? 'az' : 'a'} ${szo}`
  }
  return `${nevelo(n)} ${String(n)}`
}

const FAJTA_NEV: Readonly<Record<KozosAdatFajta, { egy: string; nevelo: 'a' | 'az' }>> = {
  telefon: { egy: 'telefonszám', nevelo: 'a' },
  email: { egy: 'e-mail-cím', nevelo: 'az' },
  kep: { egy: 'kép', nevelo: 'a' },
}

/**
 * A csoport bevezetője, pl. „Ugyanez a telefonszám (+36 30 169 2263) máshol is
 * szerepel:” vagy „Ugyanez a két kép máshol is szerepel:”. A számnév után
 * egyes szám áll („két kép szerepel”), ahogy a magyarban.
 */
export function csoportBevezeto(csoportAdat: Pick<MasolatCsoport, 'fajta' | 'ertekek'>): string {
  if (csoportAdat.fajta === 'hasonlo') {
    return HASONLO_BEVEZETO
  }
  const nev = FAJTA_NEV[csoportAdat.fajta]
  const darab = Math.max(1, csoportAdat.ertekek.length)
  const alany = darab === 1 ? `${nev.nevelo} ${nev.egy}` : `${nevelosSzam(darab)} ${nev.egy}`
  const ertekek =
    csoportAdat.fajta === 'kep' || csoportAdat.ertekek.length === 0
      ? ''
      : ` (${csoportAdat.ertekek.join(', ')})`
  return `Ugyanez ${alany}${ertekek} máshol is szerepel:`
}

/** A csoport teendője a lista után. */
export function csoportTeendo(fajta: MasolatCsoportFajta): string {
  switch (fajta) {
    case 'hasonlo':
      return HASONLO_TEENDO
    case 'kep':
      return KEP_TEENDO
    default:
      return SZOVEG_TEENDO
  }
}
