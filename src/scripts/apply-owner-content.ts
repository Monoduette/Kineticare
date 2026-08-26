/**
 * Tulajdonos által jóváhagyott, egyszeri tartalom-javítások (19 pont).
 * Minden lépés pontos egyezésre / üres mezőre / hiányzó blokkra szűr (idempotens).
 * Oldalanként egy payload.update; a kezdőlap és a /szolgaltatasok javításai láncban futnak.
 *
 * Alapból próbafutás (dry-run); íráshoz OWNER_CONTENT_CONFIRM=igen kell:
 *   npm run content:owner
 *   OWNER_CONTENT_CONFIRM=igen npm run content:owner
 *
 * Értékek: home-seed.ts, restore-legacy-content.ts, legal-content.ts.
 * Jogi oldal create-only; meglévő jogi szöveget a script nem ír felül.
 */

import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { HOME_PAGE_SLUG } from '../lib/content-slugs'
// A kezdőlap alapállapotának builder-e: a 9–11. javítás ÚJ értékei innen
// jönnek, hogy a seed és a javítás ne két külön literálban éljen.
import { buildHomeLayout } from '../lib/home-seed'
import {
  JOGI_OLDALAK,
  jogiOldalTartalom,
  richTextSzoveg,
  type JogiOldalLeiras,
} from '../lib/legal-content'
import { logger } from '../lib/logger'
import { CLINIC_TREATMENTS_ANCHOR, SOS_COURSE_SKU } from '../lib/menu-seed'
import config from '../payload.config'
import type { Page, Product } from '../payload-types'
// Mellékhatás-mentes import (a legacy-script futtatás-kapuval védett): a
// szakmai-háttér csere és a /szolgaltatasok lap-tetejének cseréje a
// seed-builderből veszi az ÚJ blokkokat, és az örökölt tartalommal veti össze
// az élő blokkot.
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
  para,
  rolunkSzakmaiOrokoltTartalom,
  szolgaltatasokRegiBevezetoTartalom,
} from './restore-legacy-content'

// ---------------------------------------------------------------------------
// A jóváhagyott értékek — a három javítás igazságforrása.
// ---------------------------------------------------------------------------

/** A kurzus-szekció RÉGI címe; kizárólag pontosan ez az érték cserélhető. */
export const REGI_KURZUS_SZEKCIO_CIM = 'Így tudunk neked segíteni'

/** A kurzus-szekció jóváhagyott ÚJ címe. */
export const UJ_KURZUS_SZEKCIO_CIM = 'Kurzusaink'

/** A páciensszám RÉGI, nem igazolható értéke; kizárólag pontosan ez cserélhető. */
export const REGI_PACIENS_ERTEK = '5000+'

/** A páciensszám jóváhagyott ÚJ értéke (a régi oldal minden előfordulásában ez állt). */
export const UJ_PACIENS_ERTEK = '1000+'

/**
 * Az érintett kurzus azonosítója. Az `sku` ebben a repóban a VEVŐNEK MEGJELENŐ
 * terménév (a plugin `useAsTitle: 'sku'`-val fut) — lásd a legacy-visszaépítő
 * script fejkommentjét; a keresés ezért erre a pontos szövegre megy.
 */
export const KURZUS_SKU = 'Otthoni KézRehab Program'

/** A kurzuskártya jóváhagyott előny-sorai, EBBEN a sorrendben (maxRows 3). */
export const KURZUS_ELONYOK: readonly string[] = [
  '4 modulnyi videóanyag',
  '50+ videós gyakorlat',
  '5 perces miniblokkok',
]

/** A „Rólunk” oldal webcíme (Pages.slug). */
export const ROLUNK_SLUG = 'rolunk'

/**
 * A LECSERÉLENDŐ fejléc-kép fájlnév-prefixe (szóló portré — csak az egyik
 * gyógytornász látszik). Prefix, mert a Média collection webp-re konvertál, így
 * a kiterjesztés környezetenként eltér.
 */
export const REGI_ROLUNK_HERO_PREFIX = '682a121babe80_IMG_7573'

/** Az ÚJ fejléc-kép fájlnév-prefixe (páros csapatfotó — mindkét gyógytornász). */
export const UJ_ROLUNK_HERO_PREFIX = 'katak-team'

/**
 * Az SOS villámkurzus jóváhagyott webcíme (`products.slug`).
 *
 * A `sku`-ból a kurzus-slug szabályai szerint adódik (src/lib/course-url.ts
 * `buildCourseSlug`) — a konstans mellett ezt teszt is őrzi, hogy a beírt
 * érték soha ne csússzon el a mező saját slug-generátorától.
 */
export const SOS_KURZUS_SLUG = 'sos-kezrelax-villamkurzus'

/**
 * A FIZETŐS „Otthoni KézRehab Program” webcíme (`products.slug`).
 *
 * A 17. javítás (cross-sell) CÉLJA. Webcím alapján keressük, nem beégetett
 * azonosító alapján: az id környezetenként (éles, demo, helyi) más, a webcím
 * viszont a kurzus nyilvános, stabil azonosítója — a mért éles cím
 * `/kurzusok/otthoni-kezrehab-program` (`docs/regi-oldal-osszehasonlitas.md`
 * 3.2). A `sku`-ból is pontosan ez adódik (`buildCourseSlug`), ezért a mező
 * automatikus generátorától sem tud elcsúszni; teszt őrzi.
 */
export const OTTHONI_KURZUS_SLUG = 'otthoni-kezrehab-program'

/** A `/szolgaltatasok` oldal webcíme (Pages.slug). */
export const SZOLGALTATASOK_SLUG = 'szolgaltatasok'

/**
 * A rendelői szekció TARTALMI ismertetőjegye: a szekció ezzel a címsorral
 * kezdődik (src/scripts/restore-legacy-content.ts `rendeloiKezelesekNodes`).
 * A horgony-javítás EZ ALAPJÁN azonosítja a blokkot — nem sorszám alapján,
 * mert a szerkesztő átrendezheti a szekciókat.
 */
export const RENDELOI_SZEKCIO_CIMKEZDET = 'Rendelői kezelések'

/**
 * A sajtó-logósor RÉGI felirata; kizárólag pontosan ez az érték cserélhető.
 *
 * Az ÚJ felirat szándékosan NEM konstans itt: a kezdőlap seed-builderéből
 * (src/lib/home-seed.ts) jön futásidőben, hogy a kód-szintű alapállapot és a
 * javítás ne csúszhasson szét. A seed értéke pedig a komponens beépített
 * feliratával azonos — ezt a kezdőlap-teszt őrzi.
 */
export const REGI_PRESS_FEJLEC = 'Ismerhetsz minket innen'

/**
 * A „Három állapot” szekció RÉGI, seedelt bevezetője — élesben ez áll.
 *
 * A logó-metaforáról szólt, nem a terápia ívéről: ha a szerkesztő a szekció
 * címét átírja, a szöveg értelmezhetetlenné válik. Kizárólag PONTOSAN ez a
 * szöveg (vagy üres mező) cserélhető.
 */
export const REGI_ALLAPOTOK_BEVEZETO =
  'A logónkat a kezed ismeri fel: zárt, nyíló, majd teljesen nyitott. A három kép a filmünk kulcskockái, pontosan abban a sorrendben, ahogyan a terápia halad.'

/**
 * A „Nyitott” kártya RÉGI, seedelt szövege. A „munkázhatsz” nem magyar ige.
 * Kizárólag PONTOSAN ez a mondat cserélhető a seed „dolgozhatsz” alakjára.
 */
export const REGI_NYITOTT_KARTYA =
  'Újra a saját kezed. Munkázhatsz, sportolhatsz, önfeledten élhetsz.'

/**
 * A `/szolgaltatasok` fejléc-képének fájlnév-prefixe (rendelő-fotó).
 *
 * Prefix és futásidejű feloldás a 4. javítás mintájára: a Média collection
 * webp-re konvertál, ezért a kiterjesztés környezetenként eltér, fix
 * azonosítót pedig nem használhatunk.
 */
export const SZOLGALTATASOK_HERO_PREFIX = '67b3bd06f3936_Rendelo'

// ---------------------------------------------------------------------------
// Típusok
// ---------------------------------------------------------------------------

/** A kezdőlap szekciósora (Pages.layout). */
type Szekciosor = NonNullable<Page['layout']>

/** Egy adott típusú szekció-blokk pontos alakja (pl. a `ctaBanner` blokk mezői). */
type SzekcioTipus<T extends Szekciosor[number]['blockType']> = Extract<
  Szekciosor[number],
  { blockType: T }
>

/** A kurzuskártya előny-sorai (products.cardHighlights). */
type ElonySorok = NonNullable<Product['cardHighlights']>

/** Melyik jóváhagyott javítás adta a naplósort. */
export type JavitasSzabaly =
  | 'kurzus-szekcio-cim'
  | 'paciens-szam'
  | 'kurzus-elonyok'
  | 'rolunk-hero-kep'
  | 'szakmai-harmonika'
  | 'jogi-oldalak'
  | 'sos-kurzus-slug'
  | 'rendeloi-horgony'
  | 'presslogos-fejlec'
  | 'allapotok-bevezeto'
  | 'allapotok-nyitott-ige'
  | 'zaro-cta'
  | 'szolgaltatasok-hero-kep'
  | 'szolgaltatasok-bevezeto'
  | 'sos-ingyenes-jelolo'
  | 'kurzuslista-feliratok'
  | 'aszf-adatvedelem-link'
  | 'aszf-fizetesi-szolgaltato'
  | 'aszf-hozzaferes-idotartam'
  | 'aszf-barion-es-teljesites'
  | 'kapcsolat-szakemberek'
  | 'sos-kapcsolodo-kurzus'
  | 'szolgaltatas-blokk-kep'

/** Egy elvégzett módosítás vagy egy indokolt kihagyás gépileg is vizsgálható leírása. */
export interface JavitasLepes {
  /** Melyik szabály futott. */
  szabaly: JavitasSzabaly
  /** Magyar naplósor: mi történt (vagy mi történne a próbafutásban). */
  uzenet: string
  /** Kihagyásnál MINDIG kitöltött indok; módosításnál `null`. */
  indok: string | null
  /**
   * HANGOS kihagyás: nem a megszokott „már javítva / a szerkesztő átírta" eset,
   * hanem hiányzó előfeltétel, amit az üzemeltetőnek látnia kell. A naplózó
   * ezeket `error` szinten írja ki (a többi kihagyás `warn`).
   */
  hangos?: boolean
}

/** A szekciósor-átalakítás eredménye. */
export interface SzekciosorAtalakitas {
  /** Az ÚJ szekciósor — a nem érintett blokkok VÁLTOZATLAN referenciaként. */
  layout: Szekciosor
  /** Elvégzett (próbafutásban: elvégzendő) módosítások. */
  modositasok: JavitasLepes[]
  /** Kihagyások — mindegyik a maga indokával. */
  kihagyasok: JavitasLepes[]
}

/**
 * Szekciósor-szintű javítás eredménye (9., 10., 11. és 12b. javítás).
 *
 * A `layout` szándékosan `null`, ha nincs teendő: a futtató ebből tudja, hogy
 * NEM kell írnia — üres módosítás-listánál sosem megy ki `payload.update`.
 */
export interface SzekciosorCsere {
  /** Az ÚJ szekciósor, vagy `null`, ha nem szabad írni. */
  layout: Szekciosor | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/** A kurzus előny-sorainak átalakítási eredménye. */
export interface ElonyAtalakitas {
  /** A beírandó sorok, vagy `null`, ha nem szabad írni (a mező nem üres). */
  cardHighlights: ElonySorok | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/** A /rolunk fejléc-kép cseréjének eredménye. */
export interface HeroKepAtalakitas {
  /** A beírandó média-azonosító, vagy `null`, ha nem szabad írni. */
  heroImage: number | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/** Naplózható alak: `null`/`undefined` helyett beszédes jelölés. */
const ertekCimke = (ertek: string | null | undefined): string =>
  typeof ertek === 'string' ? `„${ertek}”` : '(nincs megadva)'

// ---------------------------------------------------------------------------
// 1–2. javítás — a kezdőlap szekciósorának tiszta átalakítása.
// ---------------------------------------------------------------------------

/**
 * A kezdőlap szekciósorára alkalmazza az 1. és 2. javítást.
 *
 * Tiszta függvény: nem olvas és nem ír adatbázist, nem naplóz — a naplósorokat
 * visszaadja, a futtató dönt róluk. Ezért közvetlenül tesztelhető.
 *
 * SZIGORÚ EGYEZÉS: a `courseCards.heading` csak akkor cserélődik, ha pontosan a
 * régi cím (trimmelés és kis/nagybetű-tűrés NÉLKÜL); az `about.stats[].value`
 * csak akkor, ha pontosan „5000+”. Minden más érték — üres, `null`, hasonló
 * szöveg, vagy ugyanez az érték MÁS mezőben (pl. `stats[].label`) — érintetlen
 * marad, és indokolt kihagyásként naplózódik.
 */
export const alkalmazKezdolapJavitasok = (
  layout: Szekciosor | null | undefined,
): SzekciosorAtalakitas => {
  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []

  if (!Array.isArray(layout) || layout.length === 0) {
    const indok = 'a kezdőlapnak nincs szekciósora (Pages → Szekciók üres), így nincs mit javítani'
    kihagyasok.push({ szabaly: 'kurzus-szekcio-cim', uzenet: 'Kurzus-szekció címe', indok })
    kihagyasok.push({ szabaly: 'paciens-szam', uzenet: 'Páciensszám', indok })
    return { layout: [], modositasok, kihagyasok }
  }

  let voltKurzusSzekcio = false
  let voltPaciensTalalat = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    const helye = `${index + 1}. szekció`

    if (blokk.blockType === 'courseCards') {
      voltKurzusSzekcio = true
      if (blokk.heading === REGI_KURZUS_SZEKCIO_CIM) {
        modositasok.push({
          szabaly: 'kurzus-szekcio-cim',
          uzenet: `Kurzus-szekció címe (${helye}): ${ertekCimke(blokk.heading)} → ${ertekCimke(
            UJ_KURZUS_SZEKCIO_CIM,
          )}`,
          indok: null,
        })
        return { ...blokk, heading: UJ_KURZUS_SZEKCIO_CIM }
      }
      kihagyasok.push({
        szabaly: 'kurzus-szekcio-cim',
        uzenet: `Kurzus-szekció címe (${helye})`,
        indok: `a jelenlegi cím ${ertekCimke(
          blokk.heading,
        )}, ami nem PONTOSAN a cserélendő ${ertekCimke(
          REGI_KURZUS_SZEKCIO_CIM,
        )} — a script csak pontos egyezésnél ír át`,
      })
      return blokk
    }

    if (blokk.blockType === 'about') {
      const statok = blokk.stats
      if (!Array.isArray(statok) || statok.length === 0) {
        return blokk
      }
      let valtozott = false
      const ujStatok = statok.map((sor, sorIndex) => {
        if (sor.value !== REGI_PACIENS_ERTEK) {
          return sor
        }
        valtozott = true
        voltPaciensTalalat = true
        modositasok.push({
          szabaly: 'paciens-szam',
          uzenet: `Statisztika-érték (${helye}, ${sorIndex + 1}. szám, „${
            sor.label
          }”): ${ertekCimke(REGI_PACIENS_ERTEK)} → ${ertekCimke(UJ_PACIENS_ERTEK)}`,
          indok: null,
        })
        return { ...sor, value: UJ_PACIENS_ERTEK }
      })
      return valtozott ? { ...blokk, stats: ujStatok } : blokk
    }

    return blokk
  })

  if (!voltKurzusSzekcio) {
    kihagyasok.push({
      szabaly: 'kurzus-szekcio-cim',
      uzenet: 'Kurzus-szekció címe',
      indok:
        'a kezdőlap szekciósorában nincs Kurzuskártyák (courseCards) szekció — a címet nincs hol átírni',
    })
  }
  if (!voltPaciensTalalat) {
    kihagyasok.push({
      szabaly: 'paciens-szam',
      uzenet: 'Páciensszám',
      indok: `a szekciósor egyetlen statisztika-értéke sem PONTOSAN ${ertekCimke(
        REGI_PACIENS_ERTEK,
      )} — vagy már javítva van, vagy a szerkesztő időközben átírta`,
    })
  }

  return { layout: modositasok.length > 0 ? ujLayout : layout, modositasok, kihagyasok }
}

// ---------------------------------------------------------------------------
// 3. javítás — a kurzuskártya előny-sorai.
// ---------------------------------------------------------------------------

/** Egy előny-sor akkor számít kitöltöttnek, ha a szövege nem csak whitespace. */
const kitoltottElony = (sor: ElonySorok[number]): boolean =>
  typeof sor.text === 'string' && sor.text.trim().length > 0

/**
 * A kurzus `cardHighlights` mezőjének tiszta átalakítása.
 *
 * KIZÁRÓLAG üres (hiányzó, `null`, üres tömb, vagy csak whitespace-sorokat
 * tartalmazó) mezőt tölt fel — bármilyen meglévő szerkesztői tartalom esetén
 * `null`-lal tér vissza, azaz a futtató NEM ír. A csak whitespace-ből álló sor
 * azért számít üresnek, mert a kártyán sem jelenik meg (`cardHighlightTexts`,
 * src/components/content/ProductCard.tsx).
 */
export const alkalmazKurzusElonyok = (
  jelenlegi: Product['cardHighlights'] | undefined,
): ElonyAtalakitas => {
  const meglevo = Array.isArray(jelenlegi) ? jelenlegi : []
  const kitoltott = meglevo.filter(kitoltottElony)

  if (kitoltott.length > 0) {
    return {
      cardHighlights: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'kurzus-elonyok',
          uzenet: `Kurzus előny-sorai („${KURZUS_SKU}”)`,
          indok: `a mezőben MÁR VAN ${kitoltott.length} kitöltött sor (${kitoltott
            .map((sor) => `„${sor.text.trim()}”`)
            .join(', ')}) — szerkesztői tartalmat a script sosem ír felül`,
        },
      ],
    }
  }

  return {
    cardHighlights: KURZUS_ELONYOK.map((text) => ({ text })),
    modositasok: [
      {
        szabaly: 'kurzus-elonyok',
        uzenet: `Kurzus előny-sorai („${KURZUS_SKU}”): ${KURZUS_ELONYOK.map(
          (text) => `„${text}”`,
        ).join(', ')}`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 4. javítás — a /rolunk oldal fejléc-képe.
// ---------------------------------------------------------------------------

/**
 * A `heroImage` mező jelenlegi értékéből a média-azonosító.
 *
 * A mező `depth: 0` mellett szám, mélyebb lekérdezésnél viszont a teljes Media
 * dokumentum — a script `depth: 0`-val olvas, de a függvény mindkét alakot
 * elfogadja, hogy tesztből és más hívóból is használható legyen.
 */
export const heroKepAzonosito = (ertek: Page['heroImage']): number | null => {
  if (typeof ertek === 'number') {
    return ertek
  }
  if (typeof ertek === 'object' && ertek !== null && typeof ertek.id === 'number') {
    return ertek.id
  }
  return null
}

/**
 * A /rolunk fejléc-képének tiszta átalakítása.
 *
 * A két média-azonosítót a HÍVÓ deríti ki fájlnév-prefix alapján (a Média
 * collection webp-re konvertál, ezért fix azonosító nem használható); ez a
 * függvény már csak a döntést hozza meg, adatbázis nélkül.
 *
 * Csere KIZÁRÓLAG akkor, ha a mező pontosan a szóló portréra mutat. Minden más
 * érték — üres, más kép, vagy már a páros fotó — érintetlen marad, indokolt
 * kihagyással. Ha a páros fotó nincs a Médiatárban, a lépés HANGOSAN kimarad.
 */
export const alkalmazRolunkHeroKep = (input: {
  /** A `rolunk` oldal jelenlegi `heroImage` értéke. */
  jelenlegi: Page['heroImage']
  /** A szóló portré média-azonosítója, vagy `null`, ha nincs ilyen rekord. */
  regiMediaId: number | null
  /** A páros csapatfotó média-azonosítója, vagy `null`, ha nincs ilyen rekord. */
  ujMediaId: number | null
}): HeroKepAtalakitas => {
  const { jelenlegi, regiMediaId, ujMediaId } = input
  const jelenlegiId = heroKepAzonosito(jelenlegi)
  const uzenet = 'A /rolunk oldal fejléc-képe'

  const kihagyas = (indok: string, hangos = false): HeroKepAtalakitas => ({
    heroImage: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'rolunk-hero-kep', uzenet, indok, hangos }],
  })

  // Idempotencia: ha már a páros fotó van beállítva, kész vagyunk.
  if (ujMediaId !== null && jelenlegiId === ujMediaId) {
    return kihagyas(
      `a fejléc-kép MÁR a páros csapatfotó („${UJ_ROLUNK_HERO_PREFIX}…”, azonosító: ${ujMediaId}) — nincs teendő`,
    )
  }

  if (ujMediaId === null) {
    return kihagyas(
      `a Médiatárban NINCS „${UJ_ROLUNK_HERO_PREFIX}” kezdetű fájlnevű kép — a páros csapatfotót előbb fel kell tölteni, addig a fejléc-kép érintetlen marad`,
      true,
    )
  }

  if (jelenlegiId === null) {
    return kihagyas(
      'az oldalnak jelenleg nincs fejléc-képe — a script csak a szóló portrét cseréli le, üres mezőt nem tölt ki',
    )
  }

  if (regiMediaId === null) {
    return kihagyas(
      `a Médiatárban nincs „${REGI_ROLUNK_HERO_PREFIX}” kezdetű fájlnevű kép, a mostani fejléc-kép (azonosító: ${jelenlegiId}) tehát nem a cserélendő szóló portré — érintetlen marad`,
      true,
    )
  }

  if (jelenlegiId !== regiMediaId) {
    return kihagyas(
      `a fejléc-kép nem a cserélendő szóló portréra mutat (mostani azonosító: ${jelenlegiId}, várt: ${regiMediaId}) — a script csak pontos egyezésnél ír át`,
    )
  }

  return {
    heroImage: ujMediaId,
    modositasok: [
      {
        szabaly: 'rolunk-hero-kep',
        uzenet: `${uzenet}: szóló portré („${REGI_ROLUNK_HERO_PREFIX}…”, azonosító: ${regiMediaId}) → páros csapatfotó („${UJ_ROLUNK_HERO_PREFIX}…”, azonosító: ${ujMediaId})`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 5. javítás — a /rolunk szakmai háttere: örökölt óriás-blokk → rövid rész +
// harmonika (`accordion` blokk).
// ---------------------------------------------------------------------------

/** A szakmai háttér szekció horgonya — a régi és az új blokk is ezt viseli. */
export const SZAKMAI_HATTER_HORGONY = 'szakmai-hatter'

/**
 * Kulcs-sorrendtől független JSON-alak mély összevetéshez.
 *
 * MIÉRT KELL: a rich-text tartalom Postgresben `jsonb` oszlopban él, ami a
 * kulcsok sorrendjét NEM őrzi meg — a visszaolvasott objektum ezért
 * `JSON.stringify`-jal hamisan különbözhetne a kódból generált változattól.
 * A tömbök sorrendje (a tényleges tartalom) változatlan marad, azt az
 * összevetés figyeli.
 */
export const stabilJson = (ertek: unknown): string => {
  if (Array.isArray(ertek)) {
    return `[${ertek.map(stabilJson).join(',')}]`
  }
  if (ertek !== null && typeof ertek === 'object') {
    const kulcsok = Object.keys(ertek as Record<string, unknown>).sort()
    return `{${kulcsok
      .map((kulcs) => `${JSON.stringify(kulcs)}:${stabilJson((ertek as Record<string, unknown>)[kulcs])}`)
      .join(',')}}`
  }
  return JSON.stringify(ertek) ?? 'null'
}

/** A szakmai háttér cseréjének eredménye. */
export interface SzakmaiHarmonikaAtalakitas {
  /** Az ÚJ szekciósor, vagy `null`, ha nem szabad írni. */
  layout: Szekciosor | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * Az ÚJ két blokk (rövid, mindig látható rész + harmonika) kinyerése a
 * seed-builderből — így a csere pontosan azt a szerkezetet hozza létre, amit
 * egy friss adatbázisban a seed építene. A builder alakjának megváltozása
 * esetén `null`-t adunk, és a futtató hangosan kihagy.
 */
export const rolunkSzakmaiUjBlokkok = (): {
  rovid: Szekciosor[number] | null
  harmonika: Szekciosor[number] | null
} => {
  const layout = buildRolunkLayout()
  const harmonikaIndex = layout.findIndex(
    (blokk) =>
      blokk.blockType === 'accordion' &&
      blokk.sectionSettings?.anchorId === SZAKMAI_HATTER_HORGONY,
  )
  if (harmonikaIndex < 1) {
    return { rovid: null, harmonika: null }
  }
  const elozo = layout[harmonikaIndex - 1]
  return {
    rovid: elozo.blockType === 'richText' ? elozo : null,
    harmonika: layout[harmonikaIndex],
  }
}

/**
 * A /rolunk szekciósorában az ÖRÖKÖLT szakmai-háttér blokk (egyetlen óriás
 * richText a `szakmai-hatter` horgonyon) cseréje a rövid richText + harmonika
 * párra.
 *
 * VÉDŐFELTÉTELEK:
 *  - csak a `szakmai-hatter` horgonyú, `richText` típusú blokkot cseréljük;
 *  - azt is CSAK akkor, ha a tartalma byte-ra a seedelt örökölt tartalom
 *    (kulcs-sorrendtől független összevetés, lásd `stabilJson`) — ha a
 *    szerkesztő időközben átírta, a blokk érintetlen marad;
 *  - ha a horgonyon már `accordion` blokk áll, nincs teendő (idempotencia);
 *  - minden más eset hangos kihagyás (hiányzó előfeltétel).
 */
export const alkalmazSzakmaiHarmonika = (input: {
  layout: Page['layout']
  /** A seedelt örökölt blokk elvárt rich-text tartalma. */
  orokoltTartalom: unknown
  ujRovidBlokk: Szekciosor[number] | null
  ujHarmonikaBlokk: Szekciosor[number] | null
}): SzakmaiHarmonikaAtalakitas => {
  const { layout, orokoltTartalom, ujRovidBlokk, ujHarmonikaBlokk } = input
  const uzenet = 'A /rolunk szakmai hátterének harmonikába szervezése'

  const kihagyas = (indok: string, hangos = false): SzakmaiHarmonikaAtalakitas => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'szakmai-harmonika', uzenet, indok, hangos }],
  })

  if (ujRovidBlokk === null || ujHarmonikaBlokk === null) {
    return kihagyas(
      'a seed-builder (buildRolunkLayout) nem a várt rövid richText + harmonika párt adta vissza — a kód és a csere-logika szétcsúszott, kézi átnézés kell',
      true,
    )
  }

  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a Rólunk oldalnak nincs szekciósora — nincs mit harmonikába szervezni', true)
  }

  const horgonyIndex = layout.findIndex(
    (blokk) => blokk.sectionSettings?.anchorId === SZAKMAI_HATTER_HORGONY,
  )
  if (horgonyIndex === -1) {
    return kihagyas(
      `a szekciósorban nincs „${SZAKMAI_HATTER_HORGONY}” horgonyú blokk — a szakmai háttér szekció hiányzik vagy más horgonyt kapott`,
      true,
    )
  }

  const regiBlokk = layout[horgonyIndex]
  if (regiBlokk.blockType === 'accordion') {
    return kihagyas('a szakmai háttér MÁR harmonika (accordion) blokk — nincs teendő')
  }
  if (regiBlokk.blockType !== 'richText') {
    return kihagyas(
      `a „${SZAKMAI_HATTER_HORGONY}” horgonyú blokk típusa „${regiBlokk.blockType}”, nem a cserélendő richText — kézi átnézés kell`,
      true,
    )
  }

  if (stabilJson(regiBlokk.content) !== stabilJson(orokoltTartalom)) {
    return kihagyas(
      'a szakmai-háttér blokk tartalma eltér a seedelt örökölttől — a szerkesztő időközben átírta, a script nem nyúl hozzá (a harmonikát az adminban, kézzel érdemes bevezetni)',
    )
  }

  const ujLayout: Szekciosor = [
    ...layout.slice(0, horgonyIndex),
    ujRovidBlokk,
    ujHarmonikaBlokk,
    ...layout.slice(horgonyIndex + 1),
  ]

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly: 'szakmai-harmonika',
        uzenet: `${uzenet}: az örökölt óriás richText blokk (${horgonyIndex + 1}. szekció) → rövid, mindig látható rész (elérhetőség + partnerek) + nyitható-csukható önéletrajz-harmonika`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 6. javítás — a három jogi oldal LÉTREHOZÁSA (felülírás soha).
// ---------------------------------------------------------------------------

/** Egy létrehozandó jogi oldal teljes Pages-adata. */
export interface JogiOldalAdat {
  title: string
  slug: string
  content: Page['content']
  seoDescription: string
  /** A storefront a saját `status` mezőre szűr, a verziózás a `_status`-ra. */
  status: 'published'
  _status: 'published'
}

/** A jogi oldalak létrehozásának eredménye. */
export interface JogiOldalAtalakitas {
  /** A LÉTREHOZANDÓ oldalak — a már létező webcímek nincsenek benne. */
  letrehozando: JogiOldalAdat[]
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * A három jogi oldal (ÁSZF, adatkezelés, impresszum) CREATE-ONLY átalakítása.
 *
 * Tiszta függvény: a hívó adja meg, mely webcímek léteznek már; a függvény a
 * hiányzókhoz felépíti a teljes Pages-adatot (a szó szerinti jogi szövegből
 * generált Lexical tartalommal), a meglévőket pedig CSENDBEN kihagyja.
 *
 * MIÉRT CSAK LÉTREHOZÁS: a jogi szöveg felelőse a tulajdonos és az ügyvédje.
 * Ha az oldal már létezik — akár a lányok szerkesztették, akár egy korábbi
 * futás hozta létre —, a script hozzá sem nyúl; a szöveg frissítése tudatos,
 * emberi döntés (admin vagy külön, jóváhagyott lépés).
 */
export const alkalmazJogiOldalak = (input: {
  /** A `pages` collectionben MÁR LÉTEZŐ webcímek (bármelyik státuszban). */
  letezoSlugok: readonly string[]
  /** A létrehozandó oldalak leírásai — alapból mind a három. */
  oldalak?: readonly JogiOldalLeiras[]
}): JogiOldalAtalakitas => {
  const oldalak = input.oldalak ?? JOGI_OLDALAK
  const letezo = new Set(input.letezoSlugok)
  const letrehozando: JogiOldalAdat[] = []
  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []

  for (const oldal of oldalak) {
    const uzenet = `Jogi oldal („${oldal.cim}”, webcím: „/${oldal.slug}”)`
    if (letezo.has(oldal.slug)) {
      kihagyasok.push({
        szabaly: 'jogi-oldalak',
        uzenet,
        indok:
          'a webcím MÁR LÉTEZIK — a script jogi oldalt sosem ír felül, a szöveg frissítése emberi döntés (admin)',
      })
      continue
    }
    const content = jogiOldalTartalom(oldal)
    letrehozando.push({
      title: oldal.cim,
      slug: oldal.slug,
      content,
      seoDescription: oldal.seoLeiras,
      status: 'published',
      _status: 'published',
    })
    modositasok.push({
      szabaly: 'jogi-oldalak',
      uzenet: `${uzenet}: LÉTREHOZÁS közzétett állapotban, ${content.root.children.length} bekezdés/címsor a jogász szó szerinti szövegéből`,
      indok: null,
    })
  }

  return { letrehozando, modositasok, kihagyasok }
}

// ---------------------------------------------------------------------------
// 7. javítás — az SOS villámkurzus webcíme.
// ---------------------------------------------------------------------------

/** A kurzus-slug átalakításának eredménye. */
export interface SlugAtalakitas {
  /** A beírandó webcím, vagy `null`, ha nem szabad írni. */
  slug: string | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * Az SOS villámkurzus `slug` mezőjének tiszta átalakítása.
 *
 * KIZÁRÓLAG ÜRES mezőt tölt ki (hiányzó, `null`, vagy csak whitespace). Bármi
 * más — akár már a jóváhagyott slug, akár a szerkesztő saját webcíme —
 * érintetlen marad: a közzétett kurzus webcímének megváltoztatása élő URL-t
 * törne el, amiről nincs átirányítás.
 */
export const alkalmazSosKurzusSlug = (jelenlegi: Product['slug']): SlugAtalakitas => {
  const uzenet = `Az SOS kurzus webcíme („${SOS_COURSE_SKU}”)`
  const meglevo = typeof jelenlegi === 'string' ? jelenlegi.trim() : ''

  if (meglevo === SOS_KURZUS_SLUG) {
    return {
      slug: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'sos-kurzus-slug',
          uzenet,
          indok: `a webcím MÁR „${SOS_KURZUS_SLUG}” — nincs teendő`,
        },
      ],
    }
  }

  if (meglevo.length > 0) {
    return {
      slug: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'sos-kurzus-slug',
          uzenet,
          indok: `a kurzusnak MÁR VAN webcíme („${meglevo}”) — a script csak ÜRES mezőt tölt ki, meglévő webcímet sosem ír át (az élő URL törne el alatta)`,
        },
      ],
    }
  }

  return {
    slug: SOS_KURZUS_SLUG,
    modositasok: [
      {
        szabaly: 'sos-kurzus-slug',
        uzenet: `${uzenet}: (üres) → „${SOS_KURZUS_SLUG}”. A régi, id-alapú URL tovább él: a kurzus-route a numerikus szegmenst a kanonikus címre irányítja.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 14. javítás — az ÁSZF-ben bennmaradt `[xxx]` helykitöltő link.
// ---------------------------------------------------------------------------

/** A helykitöltő szövege, ahogy az ügyvédi forrásban állt. */
export const ASZF_HELYKITOLTO_BEKEZDES =
  'Adatkezelési tájékoztatónkat az alábbi linken érheti el: [xxx]'

/** A javított bekezdés — a `legal-source/aszf.txt` mai tartalmával AZONOS. */
export const ASZF_JAVITOTT_BEKEZDES =
  'Adatkezelési tájékoztatónkat az alábbi linken érheti el: https://www.kineticare.hu/adatvedelem'

/** Az ÁSZF-javítás eredménye. */
export interface AszfLinkAtalakitas {
  /** A visszaírandó rich-text, vagy `null`, ha nem szabad írni. */
  content: unknown | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * ÁSZF: [xxx] helykitöltő → adatvédelmi link címe. Csak betűre egyező bekezdés, egy találat.
 */
export const alkalmazAszfAdatvedelemLink = (content: unknown): AszfLinkAtalakitas => {
  const uzenet = 'Az ÁSZF adatkezelési hivatkozása'
  const gyoker =
    typeof content === 'object' && content !== null
      ? (content as { root?: { children?: unknown[] } }).root
      : undefined
  const gyerekek = Array.isArray(gyoker?.children) ? gyoker.children : null

  if (gyerekek === null) {
    return {
      content: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'aszf-adatvedelem-link',
          uzenet,
          indok: 'az ÁSZF tartalma nem a várt rich-text szerkezet — a script nem nyúl hozzá',
          hangos: true,
        },
      ],
    }
  }

  const talalatok = gyerekek
    .map((csomopont, index) => ({ csomopont, index }))
    .filter(({ csomopont }) => bekezdesSzovege(csomopont) === ASZF_HELYKITOLTO_BEKEZDES)

  if (talalatok.length === 0) {
    const marJavitva = gyerekek.some(
      (csomopont) => bekezdesSzovege(csomopont) === ASZF_JAVITOTT_BEKEZDES,
    )
    return {
      content: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'aszf-adatvedelem-link',
          uzenet,
          indok: marJavitva
            ? 'a hivatkozás MÁR a helyén van — nincs teendő'
            : 'a helykitöltős mondat nem található betűre egyezően — a szöveget azóta szerkesztették, a script nem tippel',
          hangos: !marJavitva,
        },
      ],
    }
  }

  if (talalatok.length > 1) {
    return {
      content: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'aszf-adatvedelem-link',
          uzenet,
          indok: `${talalatok.length} egyforma helykitöltős bekezdés van — nem egyértelmű, melyiket kellene javítani; emberi döntés kell`,
          hangos: true,
        },
      ],
    }
  }

  const { index } = talalatok[0]
  const ujGyerekek = gyerekek.map((csomopont, i) =>
    i === index ? bekezdesSzovegCsere(csomopont, ASZF_JAVITOTT_BEKEZDES) : csomopont,
  )

  return {
    content: { ...(content as object), root: { ...gyoker, children: ujGyerekek } },
    modositasok: [
      {
        szabaly: 'aszf-adatvedelem-link',
        uzenet: `${uzenet}: „[xxx]" helykitöltő → https://www.kineticare.hu/adatvedelem. A mondat állítása változatlan, csak a hivatkozás címe kerül a helyére; a jogi szöveg többi részéhez a script nem nyúl.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/** Egy bekezdés-csomópont teljes szövege, vagy `null`, ha nem bekezdés. */
const bekezdesSzovege = (csomopont: unknown): string | null => {
  if (typeof csomopont !== 'object' || csomopont === null) {
    return null
  }
  const node = csomopont as { type?: unknown; children?: unknown }
  if (node.type !== 'paragraph' || !Array.isArray(node.children)) {
    return null
  }
  return node.children
    .map((gyerek) =>
      typeof gyerek === 'object' && gyerek !== null && typeof (gyerek as { text?: unknown }).text === 'string'
        ? ((gyerek as { text: string }).text)
        : '',
    )
    .join('')
}

/**
 * Egy bekezdés szövegének cseréje EGYETLEN szöveg-gyerekre.
 *
 * A helykitöltős mondat a generált tartalomban egyetlen, formázatlan
 * szöveg-csomópont (`jogiRichText` → `para`), ezért a csere biztonságos: nem
 * veszik el félkövér vagy dőlt szakasz, mert nincs ilyen benne.
 */
const bekezdesSzovegCsere = (csomopont: unknown, ujSzoveg: string): unknown => {
  const node = csomopont as { children?: unknown[] }
  const elsoGyerek = Array.isArray(node.children) ? node.children[0] : undefined
  const alap =
    typeof elsoGyerek === 'object' && elsoGyerek !== null ? (elsoGyerek as object) : {}
  return { ...(csomopont as object), children: [{ ...alap, text: ujSzoveg }] }
}

// ---------------------------------------------------------------------------
// 18. javítás — az élő ÁSZF két ténybeli hibája (fizetési szolgáltató neve,
// a hozzáférés időtartama).
// ---------------------------------------------------------------------------

/**
 * A fizetési szolgáltatót megnevező bekezdés RÉGI kezdete (élesben ma ez áll).
 *
 * A mondat egy MÁSIK szolgáltatót (STRIPE) nevez meg, holott a fizetés a
 * Barion Smart Gateway-en megy. A Barion elfogadóhely-jóváhagyás bírálója az
 * ÉLŐ ÁSZF-et nézi át, tehát ez közvetlen elutasítási ok.
 */
export const ASZF_FIZETO_REGI_KEZDET =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a STRIPE fizetési felületén.'

/** A fizetési szolgáltatót megnevező bekezdés jóváhagyott ÚJ kezdete. */
export const ASZF_FIZETO_UJ_KEZDET =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a Barion Payment Zrt. által üzemeltetett Barion Smart Gateway fizetési felületén.'

/**
 * A hozzáférés időtartamáról szóló bekezdés RÉGI kezdete — KÉT mondat.
 *
 * Az első a hozzáférést három hónapra korlátozza, a második kimondja a
 * KINETICARE lezárási jogát. A tulajdonos döntése szerint a megvásárolt
 * tartalom véglegesen a vevőé, ezért MINDKÉT mondat helyére EGYETLEN új mondat
 * kerül. A bekezdés maradéka (a másolás tilalmáról szóló mondat) érintetlen.
 */
export const ASZF_HOZZAFERES_REGI_KEZDET =
  'A szolgáltatás egyszeri fizetéssel jár, a hozzáférés három hónap időtartamra garantált, azt követően addig tart, amíg a tartalomhoz történő hozzáférést a KINETICARE biztosítja. A KINETICARE bármikor jogosult a harmadik hónap letelte után a felvétel elérését korlátozni, véglegesen lezárni, vagy a felvételt magát a KINETICARE weboldaláról törölni.'

/** A hozzáférés időtartamáról szóló bekezdés jóváhagyott ÚJ, egyetlen mondata. */
export const ASZF_HOZZAFERES_UJ_KEZDET =
  'A szolgáltatás egyszeri fizetéssel jár, a megvásárolt tartalom pedig időbeli korlátozás nélkül, véglegesen elérhető marad a Vásárló számára a felhasználói fiókjában.'

/** Egy jóváhagyott bekezdés-eleji (prefix) csere leírása. */
export interface AszfBekezdesCsere {
  /** Melyik szabály naplózza — javításonként külön, hogy külön is elbírálható legyen. */
  szabaly: JavitasSzabaly
  /** Napló-címke (magyar, a naplósor eleje). */
  cimke: string
  /** A cserélendő bekezdés-kezdet — BETŰRE ennek kell állnia a bekezdés elején. */
  regiKezdet: string
  /** A helyére kerülő szöveg. */
  ujKezdet: string
  /**
   * Rövid, jellemző szófordulat a bekezdés AZONOSÍTÁSÁHOZ, ha se a régi, se az
   * új alak nem található. Csak a HANGOS kihagyás naplósorába kerül, hogy az
   * üzemeltető lássa, mi áll ma a helyén — döntést sosem alapozunk rá.
   */
  nyom: string
}

/** A 18. javítás két, egymástól függetlenül elbírált bekezdés-cseréje. */
export const ASZF_BEKEZDES_CSEREK: readonly AszfBekezdesCsere[] = [
  {
    szabaly: 'aszf-fizetesi-szolgaltato',
    cimke: 'Az ÁSZF fizetési szolgáltatója',
    regiKezdet: ASZF_FIZETO_REGI_KEZDET,
    ujKezdet: ASZF_FIZETO_UJ_KEZDET,
    nyom: 'A fizetés titkosított csatornán megy végbe',
  },
  {
    szabaly: 'aszf-hozzaferes-idotartam',
    cimke: 'Az ÁSZF hozzáférési időtartama',
    regiKezdet: ASZF_HOZZAFERES_REGI_KEZDET,
    ujKezdet: ASZF_HOZZAFERES_UJ_KEZDET,
    nyom: 'A szolgáltatás egyszeri fizetéssel jár',
  },
]

/** Naplóba írható, rövidített idézet egy élő bekezdésből. */
const roviditettIdezet = (szoveg: string, hossz = 160): string => {
  const egysoros = szoveg.replace(/\s+/g, ' ').trim()
  return egysoros.length <= hossz ? `„${egysoros}”` : `„${egysoros.slice(0, hossz)}…”`
}

/**
 * ÁSZF: Stripe→Barion és hozzáférési mondat prefix-csere. Forrás: legal-source/aszf.txt.
 * Bekezdés-eleji illesztés; szerkesztett szövegnél hangos kihagyás.
 */
export const alkalmazAszfBekezdesCserek = (
  content: unknown,
  cserek: readonly AszfBekezdesCsere[] = ASZF_BEKEZDES_CSEREK,
): AszfLinkAtalakitas => {
  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []

  const gyoker =
    typeof content === 'object' && content !== null
      ? (content as { root?: { children?: unknown[] } }).root
      : undefined
  const gyerekek = Array.isArray(gyoker?.children) ? gyoker.children : null

  if (gyerekek === null) {
    for (const csere of cserek) {
      kihagyasok.push({
        szabaly: csere.szabaly,
        uzenet: csere.cimke,
        indok: 'az ÁSZF tartalma nem a várt rich-text szerkezet — a script nem nyúl hozzá',
        hangos: true,
      })
    }
    return { content: null, modositasok, kihagyasok }
  }

  let aktualisGyerekek = gyerekek
  let voltIras = false

  for (const csere of cserek) {
    const szovegek = aktualisGyerekek.map(bekezdesSzovege)
    const talalatok = szovegek
      .map((szoveg, index) => ({ szoveg, index }))
      .filter(
        (elem): elem is { szoveg: string; index: number } =>
          elem.szoveg !== null && elem.szoveg.startsWith(csere.regiKezdet),
      )

    if (talalatok.length > 1) {
      kihagyasok.push({
        szabaly: csere.szabaly,
        uzenet: csere.cimke,
        indok: `${talalatok.length} bekezdés is a cserélendő mondattal kezdődik — nem egyértelmű, melyiket kellene javítani; emberi döntés kell`,
        hangos: true,
      })
      continue
    }

    if (talalatok.length === 0) {
      const marJavitva = szovegek.some(
        (szoveg) => szoveg !== null && szoveg.startsWith(csere.ujKezdet),
      )
      if (marJavitva) {
        kihagyasok.push({
          szabaly: csere.szabaly,
          uzenet: csere.cimke,
          indok: 'a bekezdés MÁR a javított szöveggel kezdődik — nincs teendő',
        })
        continue
      }
      const nyomok = szovegek.filter(
        (szoveg): szoveg is string => szoveg !== null && szoveg.includes(csere.nyom),
      )
      kihagyasok.push({
        szabaly: csere.szabaly,
        uzenet: csere.cimke,
        indok:
          nyomok.length === 0
            ? `a bekezdés se a régi, se a javított alakjában nem található, és „${csere.nyom}…” kezdetű bekezdés sincs a lapon — a szöveget azóta átírták, a script nem tippel`
            : `a bekezdés se a régi, se a javított alakjában nem található; a helyén ez áll: ${nyomok
                .map((szoveg) => roviditettIdezet(szoveg))
                .join(' | ')} — szerkesztői szöveget a script sosem ír felül`,
        hangos: true,
      })
      continue
    }

    const { index, szoveg } = talalatok[0]
    const maradek = szoveg.slice(csere.regiKezdet.length)
    aktualisGyerekek = aktualisGyerekek.map((csomopont, i) =>
      i === index ? bekezdesSzovegCsere(csomopont, `${csere.ujKezdet}${maradek}`) : csomopont,
    )
    voltIras = true
    modositasok.push({
      szabaly: csere.szabaly,
      uzenet: `${csere.cimke}: ${roviditettIdezet(csere.regiKezdet)} → ${roviditettIdezet(
        csere.ujKezdet,
      )}. A bekezdés maradéka (${
        maradek.trim().length === 0 ? 'nincs ilyen' : roviditettIdezet(maradek, 60)
      }) változatlan.`,
      indok: null,
    })
  }

  return {
    content: voltIras
      ? { ...(content as object), root: { ...gyoker, children: aktualisGyerekek } }
      : null,
    modositasok,
    kihagyasok,
  }
}

// ---------------------------------------------------------------------------
// 19. javítás — a Barion elfogadóhely-jóváhagyás két HIÁNYZÓ ÁSZF-eleme:
// a Barion fizetési módról szóló leírás és a teljesítés átlagos ideje.
// ---------------------------------------------------------------------------

/**
 * A HORGONY-bekezdés kezdete, ami UTÁN az új bekezdések beszúródnak.
 *
 * Szándékosan a 18. javítás ÚJ (Barion-os) mondata: az élő szövegben ez a
 * fizetési felületet megnevező bekezdés, tehát a Barion-leírás pontosan ide
 * kívánkozik. A lánc emiatt sorrendfüggő: a 18. javítás ELŐBB fut, így a
 * horgony akkor is megvan, ha az élő oldalon még a STRIPE-os mondat állt.
 */
export const ASZF_BARION_HORGONY_KEZDET = ASZF_FIZETO_UJ_KEZDET

/** Barion jóváhagyáshoz szükséges három bekezdés (forrás: legal-source/aszf.txt). */
export const ASZF_BARION_UJ_BEKEZDESEK: readonly string[] = [
  'Az online bankkártyás fizetések a Barion rendszerén keresztül valósulnak meg. A bankkártya adatok a kereskedőhöz nem jutnak el. A szolgáltatást nyújtó Barion Payment Zrt. a Magyar Nemzeti Bank felügyelete alatt álló intézmény, engedélyének száma: H-EN-I-1064/2013.',
  'A Barion fizetési felületén bankkártyával és a Barion-egyenleg terhére is lehet fizetni. Bankkártyás fizetéshez nem kell Barion-fiókot létrehozni: elég megadni a kártya számát, a lejárati dátumot, a kártya hátoldalán található ellenőrző kódot és egy működő e-mail címet. A KINETICARE a fizetésről kizárólag a tranzakció eredményét kapja meg, a kártyaadatokat nem ismeri meg és nem tárolja. A bankkártyás fizetésnek a Vásárló felé nincs felára.',
  'A megrendelés teljesítésének, azaz a hozzáférés megnyitásának átlagos ideje: az Ismeretterjesztő Videó digitális tartalom, ezért postai kiszállítás nincs. A KINETICARE a sikeres fizetés Barion-visszaigazolása után azonnal, átlagosan néhány másodperc, legfeljebb néhány perc alatt megnyitja a hozzáférést, és a megvásárolt Ismeretterjesztő Videó ettől kezdve a Vásárló felhasználói fiókjában, bejelentkezés után bármikor megtekinthető. A fizetésről szóló visszaigazolást és a számlát a Vásárló ugyanekkor, a megadott e-mail címre kapja meg. Ha a hozzáférés technikai okból a fizetéstől számított 24 órán belül sem válna elérhetővé, kérjük, jelezze a fenti elérhetőségeink valamelyikén: a KINETICARE legkésőbb a következő munkanapon manuálisan megnyitja a hozzáférést.',
]

/**
 * ÁSZF: Barion-leírás + teljesítési idő beszúrása a fizetési bekezdés után (csak insert).
 * Részleges állapotnál hangos kihagyás.
 */
export const alkalmazAszfBarionKiegeszites = (
  content: unknown,
  ujBekezdesek: readonly string[] = ASZF_BARION_UJ_BEKEZDESEK,
  horgonyKezdet: string = ASZF_BARION_HORGONY_KEZDET,
): AszfLinkAtalakitas => {
  const uzenet = 'Az ÁSZF Barion-leírása és teljesítési ideje'

  const kihagyas = (indok: string, hangos = false): AszfLinkAtalakitas => ({
    content: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'aszf-barion-es-teljesites', uzenet, indok, hangos }],
  })

  const gyoker =
    typeof content === 'object' && content !== null
      ? (content as { root?: { children?: unknown[] } }).root
      : undefined
  const gyerekek = Array.isArray(gyoker?.children) ? gyoker.children : null

  if (gyerekek === null) {
    return kihagyas(
      'az ÁSZF tartalma nem a várt rich-text szerkezet — a script nem nyúl hozzá',
      true,
    )
  }

  const szovegek = gyerekek.map(bekezdesSzovege)
  const meglevok = ujBekezdesek.filter((uj) => szovegek.includes(uj))

  if (meglevok.length === ujBekezdesek.length) {
    return kihagyas(
      `mind a ${ujBekezdesek.length} bekezdés MÁR az ÁSZF-ben van (Barion-leírás és teljesítési idő) — nincs teendő`,
    )
  }
  if (meglevok.length > 0) {
    return kihagyas(
      `a ${ujBekezdesek.length} bekezdésből ${meglevok.length} MÁR az ÁSZF-ben van, ${
        ujBekezdesek.length - meglevok.length
      } viszont hiányzik — részleges állapotban a script nem szúr be, mert duplikált jogi bekezdést gyártana; emberi átnézés kell`,
      true,
    )
  }

  const horgonyok = szovegek
    .map((szoveg, index) => ({ szoveg, index }))
    .filter(
      (elem): elem is { szoveg: string; index: number } =>
        elem.szoveg !== null && elem.szoveg.startsWith(horgonyKezdet),
    )

  if (horgonyok.length === 0) {
    return kihagyas(
      `a beszúrás horgonya (a ${roviditettIdezet(
        horgonyKezdet,
        80,
      )} kezdetű bekezdés) nem található — a fizetési bekezdést azóta átírták, a script nem tippel, hova tegye a Barion-leírást`,
      true,
    )
  }
  if (horgonyok.length > 1) {
    return kihagyas(
      `${horgonyok.length} bekezdés is a horgony mondattal kezdődik — nem egyértelmű, melyik után kellene beszúrni; emberi döntés kell`,
      true,
    )
  }

  const { index } = horgonyok[0]
  const ujCsomopontok = ujBekezdesek.map((szoveg) => para(szoveg))
  const ujGyerekek = [
    ...gyerekek.slice(0, index + 1),
    ...ujCsomopontok,
    ...gyerekek.slice(index + 1),
  ]

  return {
    content: { ...(content as object), root: { ...gyoker, children: ujGyerekek } },
    modositasok: [
      {
        szabaly: 'aszf-barion-es-teljesites',
        uzenet: `${uzenet}: ${ujBekezdesek.length} ÚJ bekezdés beszúrása a ${
          index + 1
        }. bekezdés után (Barion-tájékoztató az MNB-engedélyszámmal, a fizetési mód gyakorlati leírása, és a teljesítés átlagos ideje). Meglévő bekezdés NEM módosul.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 13. javítás — az SOS villámkurzus INGYENES jelölője.
// ---------------------------------------------------------------------------

/** Az ingyenes-jelölő átalakításának eredménye. */
export interface IngyenesJeloloAtalakitas {
  /** A beírandó érték, vagy `null`, ha nem szabad írni. */
  priceInHUFEnabled: false | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * SOS kurzus priceInHUFEnabled=false, ha nincs pozitív ár. Beárazott termékhez nem nyúl.
 */
export const alkalmazSosIngyenesJelolo = (
  termek: Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>,
): IngyenesJeloloAtalakitas => {
  const uzenet = `Az SOS kurzus ingyenes-jelölője („${SOS_COURSE_SKU}”)`

  if (termek.priceInHUFEnabled === false) {
    return {
      priceInHUFEnabled: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'sos-ingyenes-jelolo',
          uzenet,
          indok: 'a kurzus MÁR ingyenesként van jelölve — nincs teendő',
        },
      ],
    }
  }

  const ar = typeof termek.priceInHUF === 'number' ? termek.priceInHUF : null
  if (ar !== null && ar > 0) {
    return {
      priceInHUFEnabled: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'sos-ingyenes-jelolo',
          uzenet,
          indok: `a kurzusnak ÉRVÉNYES ára van (${ar} Ft) — a script beárazott terméket sosem tesz ingyenessé; ha mégis ingyenes kell, az adminban kell kivenni az árat`,
        },
      ],
    }
  }

  return {
    priceInHUFEnabled: false,
    modositasok: [
      {
        szabaly: 'sos-ingyenes-jelolo',
        uzenet: `${uzenet}: (nincs kimondva) → INGYENES. Enélkül a kurzusoldal „Megveszem" gombot mutat, a pénztár viszont elutasítja („A termékhez nem tartozik érvényes ár…") — pontosan ezt a hibát jelentette a tulajdonos.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 17. javítás — az SOS villámkurzus KAPCSOLÓDÓ kurzusa (cross-sell).
// ---------------------------------------------------------------------------

/** A kapcsolódó-kurzus javítás eredménye. */
export interface KapcsolodoKurzusAtalakitas {
  /** A beírandó kapcsolat-lista, vagy `null`, ha nem szabad írni. */
  relatedProducts: number[] | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * A `relatedProducts` mező azonosítói. A mező típusa `(number | Product)[]`:
 * `depth: 0` mellett szám, mélyebb lekérdezésnél objektum — mindkettőt
 * kezeljük, hogy a függvény a hívó lekérdezési mélységétől független legyen.
 */
export const kapcsolodoAzonositok = (ertek: Product['relatedProducts']): number[] => {
  if (!Array.isArray(ertek)) {
    return []
  }
  const azonositok: number[] = []
  for (const elem of ertek) {
    if (typeof elem === 'number') {
      azonositok.push(elem)
      continue
    }
    if (typeof elem === 'object' && elem !== null && typeof elem.id === 'number') {
      azonositok.push(elem.id)
    }
  }
  return azonositok
}

/**
 * SOS relatedProducts → fizetős Otthoni KézRehab (slug alapján). Meglévő kapcsolatnál kihagyás.
 */
export const alkalmazSosKapcsolodoKurzus = (input: {
  jelenlegi: Product['relatedProducts']
  /** Az SOS kurzus azonosítója — az önhivatkozás kizárásához. */
  sosId: number
  /** A fizetős program azonosítója, vagy `null`, ha a webcím nem található. */
  celId: number | null
}): KapcsolodoKurzusAtalakitas => {
  const uzenet = `Az SOS kurzus kapcsolódó kurzusa („${SOS_COURSE_SKU}” → „${KURZUS_SKU}”)`
  const nincsIras = (indok: string, hangos: boolean): KapcsolodoKurzusAtalakitas => ({
    relatedProducts: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'sos-kapcsolodo-kurzus', uzenet, indok, hangos }],
  })

  if (input.celId === null) {
    return nincsIras(
      `a fizetős program nem található a „${OTTHONI_KURZUS_SLUG}” webcímen — a cross-sell sáv így üres marad; a kurzus webcímét az adminban kell beállítani`,
      true,
    )
  }

  if (input.celId === input.sosId) {
    return nincsIras(
      'a keresett webcím MAGÁRA az SOS kurzusra mutat — önhivatkozást nem írunk be (a sáv a saját oldalát ajánlaná)',
      true,
    )
  }

  const jelenlegiAzonositok = kapcsolodoAzonositok(input.jelenlegi)

  if (jelenlegiAzonositok.includes(input.celId)) {
    // NEM hangos (vezetői javítás, 2026-08-17, éles napló alapján). Ez a
    // MÁSODIK futás normális kimenete: a mező már a helyén van, tehát a script
    // dolga elkészült. A `hangos: true` `logger.error`-t ír, amitől minden
    // további tartalom-job futás HIBÁSNAK látszik — élesben pontosan ez
    // történt: egyetlen `error` sor állt a 21 `warn` mellett, holott ez volt a
    // legjobb lehetséges kimenet. A hangos ág azoknak az eseteknek marad,
    // ahol EMBERI TEENDŐ van (a cél nincs meg, önhivatkozás, vagy a szerkesztő
    // mást állított be).
    return nincsIras('a kapcsolódó kurzus MÁR be van állítva — nincs teendő', false)
  }

  if (jelenlegiAzonositok.length > 0) {
    return nincsIras(
      `a mezőben már ${jelenlegiAzonositok.length} másik kurzus áll (azonosító: ${jelenlegiAzonositok.join(', ')}) — a szerkesztő beállítását a script sosem írja felül; ha kell, az adminban vedd fel mellé`,
      true,
    )
  }

  return {
    relatedProducts: [input.celId],
    modositasok: [
      {
        szabaly: 'sos-kapcsolodo-kurzus',
        uzenet: `${uzenet}: (üres) → a fizetős program. Enélkül az ingyenes kurzus után SEMMILYEN továbblépés nincs a lapon (a régi oldal ezen a ponton ajánlatra irányított át).`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 8. javítás — a rendelői szekció horgonya a /szolgaltatasok oldalon.
// ---------------------------------------------------------------------------

/** A horgony-javítás eredménye. */
export interface HorgonyAtalakitas {
  /** Az ÚJ szekciósor, vagy `null`, ha nem szabad írni. */
  layout: Szekciosor | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * A rendelői szekció megkeresése a szekciósorban, TARTALMI jegy alapján.
 *
 * A szekció rich-text blokk, és a `Rendelői kezelések…` címsorral kezdődik. A
 * keresés a blokk TELJES szövegében néz sor-elejei egyezést (a
 * `richTextSzoveg` blokkonként új sorral tagol), így akkor is talál, ha a
 * szerkesztő a szekció elé bekezdést szúrt.
 */
const rendeloiSzekcioIndexek = (layout: Szekciosor): number[] => {
  const talalatok: number[] = []
  layout.forEach((blokk, index) => {
    if (blokk.blockType !== 'richText') {
      return
    }
    const sorok = richTextSzoveg(blokk.content).split('\n')
    if (sorok.some((sor) => sor.trimStart().startsWith(RENDELOI_SZEKCIO_CIMKEZDET))) {
      talalatok.push(index)
    }
  })
  return talalatok
}

/**
 * `/szolgaltatasok` rendelői szekció horgony → `rendeloi` (menü egyezés).
 * Pontosan egy tartalmi találat; ütköző horgony → kihagyás.
 */
export const alkalmazRendeloiHorgony = (layout: Page['layout']): HorgonyAtalakitas => {
  const uzenet = 'A rendelői kezelések szekció horgonya (/szolgaltatasok)'

  const kihagyas = (indok: string, hangos = false): HorgonyAtalakitas => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'rendeloi-horgony', uzenet, indok, hangos }],
  })

  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas(
      'a Szolgáltatások oldalnak nincs szekciósora — a horgonyt nincs mire tenni',
      true,
    )
  }

  const talalatok = rendeloiSzekcioIndexek(layout)
  if (talalatok.length === 0) {
    return kihagyas(
      `a szekciósorban nincs olyan szövegblokk, amely a „${RENDELOI_SZEKCIO_CIMKEZDET}…” címsorral kezdődne — a szekció hiányzik vagy átírták, kézi átnézés kell`,
      true,
    )
  }
  if (talalatok.length > 1) {
    return kihagyas(
      `a tartalmi jegyre („${RENDELOI_SZEKCIO_CIMKEZDET}…”) ${talalatok.length} szekció is illeszkedik (${talalatok
        .map((index) => `${index + 1}.`)
        .join(', ')}) — nem egyértelmű, melyik a menüpont célja, ezért a script nem ír`,
      true,
    )
  }

  const index = talalatok[0]
  const blokk = layout[index]
  const jelenlegiHorgony = blokk.sectionSettings?.anchorId ?? null

  if (jelenlegiHorgony === CLINIC_TREATMENTS_ANCHOR) {
    return kihagyas(
      `a szekció horgonya MÁR „${CLINIC_TREATMENTS_ANCHOR}” — a menüpont célba ér, nincs teendő`,
    )
  }

  const utkozo = layout.findIndex(
    (masik, masikIndex) =>
      masikIndex !== index && masik.sectionSettings?.anchorId === CLINIC_TREATMENTS_ANCHOR,
  )
  if (utkozo !== -1) {
    return kihagyas(
      `a „${CLINIC_TREATMENTS_ANCHOR}” horgonyt MÁR a(z) ${utkozo + 1}. szekció viseli — két azonos horgony ütközne, ezért a script nem ír; nézd át az adminban`,
      true,
    )
  }

  const ujLayout: Szekciosor = layout.map((elem, elemIndex) =>
    elemIndex === index
      ? { ...elem, sectionSettings: { ...elem.sectionSettings, anchorId: CLINIC_TREATMENTS_ANCHOR } }
      : elem,
  )

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly: 'rendeloi-horgony',
        uzenet: `${uzenet}: ${ertekCimke(jelenlegiHorgony)} → ${ertekCimke(
          CLINIC_TREATMENTS_ANCHOR,
        )} (${index + 1}. szekció) — a fejléc-menü „Rendelői kezelések” pontja ezután ide ugrik`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 9–11. javítás — a kezdőlap további szövegei. Az ÚJ értékek MIND a
// seed-builderből (src/lib/home-seed.ts `buildHomeLayout`) jönnek.
// ---------------------------------------------------------------------------

/**
 * Egy adott típusú, PONTOSAN EGY példányban álló blokk a kezdőlap
 * seed-builderéből.
 *
 * MIÉRT ÍGY: a 9–11. javítás ÚJ értékeit a kód-szintű alapállapotból vesszük,
 * nem külön literálból — így a seed és a javítás nem csúszhat szét (ugyanaz az
 * elv, mint a szakmai harmonikánál, `rolunkSzakmaiUjBlokkok`). Ha a builder
 * alakja megváltozik (nulla vagy több ilyen blokk), `null` jön vissza, és a
 * hívó HANGOSAN kihagy — vaktában sosem írunk.
 */
export const kezdolapSeedBlokk = <T extends Szekciosor[number]['blockType']>(
  blockType: T,
): SzekcioTipus<T> | null => {
  const talalatok = buildHomeLayout().filter((blokk) => blokk.blockType === blockType)
  return talalatok.length === 1 ? (talalatok[0] as SzekcioTipus<T>) : null
}

/** A sajtó-logósor jóváhagyott ÚJ felirata (a seed-builderből). */
export const pressLogosUjFejlec = (): string | null => {
  const fejlec = kezdolapSeedBlokk('pressLogos')?.heading
  return typeof fejlec === 'string' && fejlec.trim().length > 0 ? fejlec : null
}

/** A „Három állapot” szekció jóváhagyott ÚJ bevezetője (a seed-builderből). */
export const allapotokUjBevezeto = (): string | null => {
  const lead = kezdolapSeedBlokk('states')?.lead
  return typeof lead === 'string' && lead.trim().length > 0 ? lead : null
}

/** A „Nyitott” kártya jóváhagyott ÚJ szövege (a seed-builderből). */
export const allapotokUjNyitottSzoveg = (): string | null => {
  const kartyak = kezdolapSeedBlokk('states')?.cards ?? []
  const nyitott = kartyak.find((kartya) => kartya.title === 'Nyitott')
  const szoveg = nyitott?.text
  return typeof szoveg === 'string' && szoveg.trim().length > 0 ? szoveg : null
}

/** A záró CTA-sáv blokkja a seed-builderből (a 11. javítás ezt fűzi a lap végére). */
export const zaroCtaSeedBlokk = (): SzekcioTipus<'ctaBanner'> | null =>
  kezdolapSeedBlokk('ctaBanner')

/**
 * 9. javítás — a kezdőlapi sajtó-logósor feliratának cseréje.
 *
 * VÉDŐFELTÉTELEK:
 *  - csere KIZÁRÓLAG akkor, ha a felirat PONTOSAN a régi szöveg;
 *  - ÜRES (hiányzó, `null`, csak whitespace) feliratba a script NEM ír: a
 *    komponens beépített felirata (PressLogos `DEFAULT_HEADING`) már az új
 *    szöveget hozza, tehát az üres mező kitöltése fölösleges írás lenne — és a
 *    szerkesztő szándékos üresen hagyását is felülírná;
 *  - minden más felirat a szerkesztőé: érintetlen marad;
 *  - több logósor esetén mindegyiket külön bírálja el (ugyanaz a minta, mint a
 *    páciensszámnál).
 */
export const alkalmazPressLogosFejlec = (input: {
  layout: Page['layout']
  /** A seed-builderből vett ÚJ felirat, vagy `null`, ha a builder alakja elcsúszott. */
  ujFejlec: string | null
  /** Napló-címke — a /rolunk láncában futtatva ezzel különbözik a kezdőlapitól. */
  uzenetCimke?: string
}): SzekciosorCsere => {
  const { layout, ujFejlec } = input
  const uzenet = input.uzenetCimke ?? 'A kezdőlap sajtó-logósorának felirata'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'presslogos-fejlec', uzenet, indok, hangos }],
  })

  if (ujFejlec === null) {
    return kihagyas(
      'a kezdőlap seed-buildere (buildHomeLayout) nem ad pontosan egy, feliratos sajtó-logósort — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a kezdőlapnak nincs szekciósora — a feliratot nincs hol átírni')
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltLogosor = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'pressLogos') {
      return blokk
    }
    voltLogosor = true
    const helye = `${index + 1}. szekció`
    const jelenlegi = blokk.heading

    if (jelenlegi === REGI_PRESS_FEJLEC) {
      modositasok.push({
        szabaly: 'presslogos-fejlec',
        uzenet: `${uzenet} (${helye}): ${ertekCimke(jelenlegi)} → ${ertekCimke(ujFejlec)}`,
        indok: null,
      })
      return { ...blokk, heading: ujFejlec }
    }

    if (typeof jelenlegi !== 'string' || jelenlegi.trim().length === 0) {
      kihagyasok.push({
        szabaly: 'presslogos-fejlec',
        uzenet: `${uzenet} (${helye})`,
        indok: `a felirat ÜRES, a script pedig üres mezőt nem tölt ki: a komponens beépített felirata már ${ertekCimke(
          ujFejlec,
        )}, tehát a látogató MÁR az új szöveget látja`,
      })
      return blokk
    }

    if (jelenlegi === ujFejlec) {
      kihagyasok.push({
        szabaly: 'presslogos-fejlec',
        uzenet: `${uzenet} (${helye})`,
        indok: `a felirat MÁR ${ertekCimke(ujFejlec)} — nincs teendő`,
      })
      return blokk
    }

    kihagyasok.push({
      szabaly: 'presslogos-fejlec',
      uzenet: `${uzenet} (${helye})`,
      indok: `a jelenlegi felirat ${ertekCimke(
        jelenlegi,
      )}, ami nem PONTOSAN a cserélendő ${ertekCimke(
        REGI_PRESS_FEJLEC,
      )} — a script csak pontos egyezésnél ír át`,
    })
    return blokk
  })

  if (!voltLogosor) {
    kihagyasok.push({
      szabaly: 'presslogos-fejlec',
      uzenet,
      indok:
        'a kezdőlap szekciósorában nincs Sajtó-logósor (pressLogos) szekció — a feliratot nincs hol átírni',
    })
  }

  return { layout: modositasok.length > 0 ? ujLayout : null, modositasok, kihagyasok }
}

/**
 * 10. javítás — a „Három állapot” szekció bevezetőjének cseréje.
 *
 * VÉDŐFELTÉTELEK:
 *  - csere akkor, ha a bevezető PONTOSAN a régi seedelt szöveg, VAGY ha a mező
 *    üres (a szekció ilyenkor magyarázat nélkül áll: három kép, és a
 *    látogatónak kell kitalálnia, mit lát);
 *  - ha már az új szöveg áll benne, nincs teendő (idempotencia);
 *  - bármilyen MÁS szöveg a szerkesztőé — érintetlen marad.
 */
export const alkalmazAllapotokBevezeto = (input: {
  layout: Page['layout']
  /** A seed-builderből vett ÚJ bevezető, vagy `null`, ha a builder alakja elcsúszott. */
  ujBevezeto: string | null
}): SzekciosorCsere => {
  const { layout, ujBevezeto } = input
  const uzenet = 'A kezdőlap „Három állapot” szekciójának bevezetője'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'allapotok-bevezeto', uzenet, indok, hangos }],
  })

  if (ujBevezeto === null) {
    return kihagyas(
      'a kezdőlap seed-buildere (buildHomeLayout) nem ad pontosan egy, bevezetővel ellátott „Három állapot” szekciót — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a kezdőlapnak nincs szekciósora — a bevezetőt nincs hova írni')
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltAllapotSzekcio = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'states') {
      return blokk
    }
    voltAllapotSzekcio = true
    const helye = `${index + 1}. szekció`
    const jelenlegi = blokk.lead
    const ures = typeof jelenlegi !== 'string' || jelenlegi.trim().length === 0

    if (jelenlegi === REGI_ALLAPOTOK_BEVEZETO || ures) {
      modositasok.push({
        szabaly: 'allapotok-bevezeto',
        uzenet: `${uzenet} (${helye}): ${
          ures ? '(üres)' : 'a régi, logó-metaforás szöveg'
        } → ${ertekCimke(ujBevezeto)}`,
        indok: null,
      })
      return { ...blokk, lead: ujBevezeto }
    }

    if (jelenlegi === ujBevezeto) {
      kihagyasok.push({
        szabaly: 'allapotok-bevezeto',
        uzenet: `${uzenet} (${helye})`,
        indok: 'a bevezető MÁR a jóváhagyott új szöveg — nincs teendő',
      })
      return blokk
    }

    kihagyasok.push({
      szabaly: 'allapotok-bevezeto',
      uzenet: `${uzenet} (${helye})`,
      indok: `a jelenlegi bevezető ${ertekCimke(
        jelenlegi,
      )}, ami sem a régi seedelt szöveg, sem az új — a szerkesztő időközben átírta, a script nem nyúl hozzá`,
    })
    return blokk
  })

  if (!voltAllapotSzekcio) {
    kihagyasok.push({
      szabaly: 'allapotok-bevezeto',
      uzenet,
      indok:
        'a kezdőlap szekciósorában nincs „Három állapot” (states) szekció — a bevezetőt nincs hova írni',
    })
  }

  return { layout: modositasok.length > 0 ? ujLayout : null, modositasok, kihagyasok }
}

/**
 * 10b. javítás — a „Nyitott” kártya hibás igéje (munkázhatsz → dolgozhatsz).
 *
 * VÉDŐFELTÉTELEK:
 *  - csere KIZÁRÓLAG a pontosan régi seedelt mondatra;
 *  - ha már az új szöveg áll, nincs teendő;
 *  - bármilyen MÁS kártyaszöveg a szerkesztőé — érintetlen.
 */
export const alkalmazAllapotokNyitottIge = (input: {
  layout: Page['layout']
  ujSzoveg: string | null
}): SzekciosorCsere => {
  const { layout, ujSzoveg } = input
  const uzenet = 'A kezdőlap „Nyitott” kártyájának igéje'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'allapotok-nyitott-ige', uzenet, indok, hangos }],
  })

  if (ujSzoveg === null) {
    return kihagyas(
      'a kezdőlap seed-buildere (buildHomeLayout) nem ad Nyitott kártyát szöveggel — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a kezdőlapnak nincs szekciósora — a kártyaszöveget nincs hol átírni')
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltAllapotSzekcio = false
  let voltRegiIge = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'states') {
      return blokk
    }
    voltAllapotSzekcio = true
    const helye = `${index + 1}. szekció`
    const kartyak = blokk.cards ?? []
    const ujKartyak = kartyak.map((kartya) => {
      if (kartya.text === REGI_NYITOTT_KARTYA) {
        voltRegiIge = true
        modositasok.push({
          szabaly: 'allapotok-nyitott-ige',
          uzenet: `${uzenet} (${helye}, „${kartya.title}”): munkázhatsz → dolgozhatsz`,
          indok: null,
        })
        return { ...kartya, text: ujSzoveg }
      }
      if (kartya.text === ujSzoveg) {
        kihagyasok.push({
          szabaly: 'allapotok-nyitott-ige',
          uzenet: `${uzenet} (${helye}, „${kartya.title}”)`,
          indok: 'a kártyaszöveg MÁR a jóváhagyott új ige — nincs teendő',
        })
        return kartya
      }
      return kartya
    })
    return { ...blokk, cards: ujKartyak }
  })

  if (!voltAllapotSzekcio) {
    kihagyasok.push({
      szabaly: 'allapotok-nyitott-ige',
      uzenet,
      indok:
        'a kezdőlap szekciósorában nincs „Három állapot” (states) szekció — a kártyaszöveget nincs hol átírni',
    })
  } else if (!voltRegiIge && modositasok.length === 0 && kihagyasok.length === 0) {
    kihagyasok.push({
      szabaly: 'allapotok-nyitott-ige',
      uzenet,
      indok:
        'egyetlen kártya sem a régi, hibás igés mondat — a szerkesztő időközben átírta, a script nem nyúl hozzá',
    })
  }

  return { layout: modositasok.length > 0 ? ujLayout : null, modositasok, kihagyasok }
}

/**
 * 11. javítás — a kezdőlap záró CTA-sávja.
 *
 * HÁROM ESET:
 *  - nincs CTA-sáv a lapon → a seed-builder záró sávja a szekciósor VÉGÉRE
 *    kerül (a lap ma a GYIK-kal, cselekvésre hívás nélkül ér véget);
 *  - van, de a szövege üres → CSAK a szöveg íródik be (a cím, a gomb és a
 *    sávbeállítás a szerkesztőé marad);
 *  - van és van szövege → nincs teendő.
 *
 * Kétes esetben (több CTA-sáv, hiányzó seed-blokk, üres szekciósor) HANGOS
 * kihagyás, írás nélkül.
 */
/** Kezdőlap: /kurzusok CTA-k egységes felirata — csak ismert régi szövegek, pontos url. */
export const KURZUSLISTA_JOVAHAGYOTT_FELIRAT = 'Nézd meg a kurzusokat'

/** A cserélendő, korábban élő feliratok — betűre egyező illesztéshez. */
export const KURZUSLISTA_REGI_FELIRATOK = [
  'Kurzusok megtekintése',
  'Megnézem a kurzusokat',
  'Összes kurzus megtekintése',
  'Megnézem a programot',
  'Tovább a programra',
] as const

/** A `/kurzusok` cím, amelyre a csere korlátozódik. */
const KURZUSLISTA_URL = '/kurzusok'

/**
 * Egy tetszőleges mélységű szekciósorban minden `{ felirat, url }` alakú
 * objektumot bejár, és a `/kurzusok`-ra mutató, ismert régi feliratút
 * lecseréli. A bejárás azért általános, mert a CTA-k blokktípusonként más
 * mezőben ülnek (hero `ctas` tömb, services `rows`, ctaBanner `cta`).
 */
export const alkalmazKurzuslistaFeliratok = (layout: Page['layout']): SzekciosorCsere => {
  const uzenet = 'A kurzuslistára vivő gombok felirata'
  const regi = new Set<string>(KURZUSLISTA_REGI_FELIRATOK)
  const cserek: string[] = []
  let mariJoVolt = 0

  const bejar = (ertek: unknown): unknown => {
    if (Array.isArray(ertek)) {
      return ertek.map(bejar)
    }
    if (typeof ertek !== 'object' || ertek === null) {
      return ertek
    }
    const rekord = ertek as Record<string, unknown>
    if (rekord.url === KURZUSLISTA_URL && typeof rekord.felirat === 'string') {
      if (rekord.felirat === KURZUSLISTA_JOVAHAGYOTT_FELIRAT) {
        mariJoVolt += 1
        return ertek
      }
      if (regi.has(rekord.felirat)) {
        cserek.push(rekord.felirat)
        return { ...rekord, felirat: KURZUSLISTA_JOVAHAGYOTT_FELIRAT }
      }
    }
    const uj: Record<string, unknown> = {}
    for (const [kulcs, ertekBelso] of Object.entries(rekord)) {
      uj[kulcs] = bejar(ertekBelso)
    }
    return uj
  }

  if (!Array.isArray(layout) || layout.length === 0) {
    return {
      layout: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'kurzuslista-feliratok',
          uzenet,
          indok: 'a kezdőlapnak nincs szekciósora — nincs mit egységesíteni',
          hangos: true,
        },
      ],
    }
  }

  const ujLayout = bejar(layout) as NonNullable<Page['layout']>

  if (cserek.length === 0) {
    return {
      layout: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'kurzuslista-feliratok',
          uzenet,
          indok:
            mariJoVolt > 0
              ? `mind a ${mariJoVolt} kurzuslista-gomb MÁR a jóváhagyott feliratot viseli — nincs teendő`
              : 'nincs ismert régi feliratú kurzuslista-gomb; a szerkesztő saját szövegeit a script sosem írja át',
        },
      ],
    }
  }

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly: 'kurzuslista-feliratok',
        uzenet: `${uzenet}: ${cserek.length} gomb egységesítve „${KURZUSLISTA_JOVAHAGYOTT_FELIRAT}"-ra (cserélt feliratok: ${cserek.map((f) => `„${f}"`).join(', ')}). Ugyanaz a cselekvés mostantól ugyanazzal a szóval jelenik meg.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

export const alkalmazZaroCta = (input: {
  layout: Page['layout']
  /** A seed-builder záró CTA-sávja, vagy `null`, ha a builder alakja elcsúszott. */
  seedBlokk: SzekcioTipus<'ctaBanner'> | null
}): SzekciosorCsere => {
  const { layout, seedBlokk } = input
  const uzenet = 'A kezdőlap záró CTA-sávja'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'zaro-cta', uzenet, indok, hangos }],
  })

  if (seedBlokk === null) {
    return kihagyas(
      'a kezdőlap seed-buildere (buildHomeLayout) nem ad pontosan egy záró CTA-sávot — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  const seedSzoveg = typeof seedBlokk.text === 'string' ? seedBlokk.text.trim() : ''
  if (seedSzoveg.length === 0) {
    return kihagyas(
      'a seed-builder záró CTA-sávjának nincs szövege — a cím önmagában indoklás nélküli felszólítás lenne, ezért a script nem ír',
      true,
    )
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas(
      'a kezdőlapnak nincs szekciósora — magában álló CTA-sávot a script nem tesz ki',
      true,
    )
  }

  const indexek = layout.flatMap((blokk, index) => (blokk.blockType === 'ctaBanner' ? [index] : []))

  if (indexek.length === 0) {
    return {
      layout: [...layout, seedBlokk],
      modositasok: [
        {
          szabaly: 'zaro-cta',
          uzenet: `${uzenet}: HOZZÁFŰZÉS a szekciósor végére (${
            layout.length + 1
          }. szekció), ${ertekCimke(seedBlokk.title)} címmel — a lap eddig cselekvésre hívás nélkül, a GYIK-kal ért véget`,
          indok: null,
        },
      ],
      kihagyasok: [],
    }
  }

  if (indexek.length > 1) {
    return kihagyas(
      `a szekciósorban ${indexek.length} CTA-sáv áll (${indexek
        .map((index) => `${index + 1}.`)
        .join(', ')}) — nem egyértelmű, melyik a lap lezárása, ezért a script nem ír`,
      true,
    )
  }

  const index = indexek[0]
  const blokk = layout[index]
  if (blokk.blockType !== 'ctaBanner') {
    return kihagyas('a megtalált blokk mégsem CTA-sáv — kézi átnézés kell', true)
  }

  const jelenlegiSzoveg = typeof blokk.text === 'string' ? blokk.text.trim() : ''
  if (jelenlegiSzoveg.length > 0) {
    return kihagyas(
      `a záró CTA-sávnak (${index + 1}. szekció) MÁR van szövege (${ertekCimke(
        jelenlegiSzoveg,
      )}) — szerkesztői tartalmat a script sosem ír felül`,
    )
  }

  const ujLayout: Szekciosor = layout.map((elem, elemIndex) =>
    elemIndex === index ? { ...blokk, text: seedBlokk.text } : elem,
  )

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly: 'zaro-cta',
        uzenet: `${uzenet} (${index + 1}. szekció): a hiányzó szöveg pótlása — ${ertekCimke(
          seedSzoveg,
        )}`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 12. javítás — a /szolgaltatasok oldal teteje: fejléc-kép ürítése + az örökölt
// bevezető blokk cseréje üdvözlő (welcome) blokkra.
// ---------------------------------------------------------------------------

/** A fejléc-kép ürítésének eredménye. */
export interface HeroKepUritesAtalakitas {
  /** `true` → a `heroImage` mezőt ÜRÍTENI kell (null-ra írni); `false` → nincs írás. */
  uritendo: boolean
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * 12a. javítás — a `/szolgaltatasok` fejléc-képének ürítése.
 *
 * A rendelő-fotó a lap tetején csak lejjebb tolta a tartalmat, állítás nélkül
 * (mért redesign). Ürítés KIZÁRÓLAG akkor, ha a mező tényleg a rendelő-fotóra
 * mutat — a média-azonosítót a HÍVÓ deríti ki fájlnév-prefix alapján (a Média
 * collection webp-re konvertál, ezért fix azonosító nem használható).
 */
export const alkalmazSzolgaltatasokHeroKep = (input: {
  /** A `szolgaltatasok` oldal jelenlegi `heroImage` értéke. */
  jelenlegi: Page['heroImage']
  /** A rendelő-fotó média-azonosítója, vagy `null`, ha nincs ilyen rekord. */
  regiMediaId: number | null
}): HeroKepUritesAtalakitas => {
  const { jelenlegi, regiMediaId } = input
  const jelenlegiId = heroKepAzonosito(jelenlegi)
  const uzenet = 'A /szolgaltatasok oldal fejléc-képe'

  const kihagyas = (indok: string, hangos = false): HeroKepUritesAtalakitas => ({
    uritendo: false,
    modositasok: [],
    kihagyasok: [{ szabaly: 'szolgaltatasok-hero-kep', uzenet, indok, hangos }],
  })

  // Idempotencia: üres mezőn nincs mit üríteni.
  if (jelenlegiId === null) {
    return kihagyas('az oldalnak MÁR nincs fejléc-képe — nincs teendő')
  }

  if (regiMediaId === null) {
    return kihagyas(
      `a Médiatárban nincs „${SZOLGALTATASOK_HERO_PREFIX}” kezdetű fájlnevű kép, a mostani fejléc-kép (azonosító: ${jelenlegiId}) tehát nem az ürítendő rendelő-fotó — érintetlen marad`,
      true,
    )
  }

  if (jelenlegiId !== regiMediaId) {
    return kihagyas(
      `a fejléc-kép nem a rendelő-fotóra mutat (mostani azonosító: ${jelenlegiId}, várt: ${regiMediaId}) — a script csak pontos egyezésnél üríti a mezőt`,
    )
  }

  return {
    uritendo: true,
    modositasok: [
      {
        szabaly: 'szolgaltatasok-hero-kep',
        uzenet: `${uzenet}: a rendelő-fotó („${SZOLGALTATASOK_HERO_PREFIX}…”, azonosító: ${regiMediaId}) LEVÉTELE — a lap a tartalommal kezdődik. A kép a Médiatárban marad, bármikor visszatehető.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/**
 * A `/szolgaltatasok` szekciósorának ÚJ első blokkja (üdvözlő blokk) a
 * seed-builderből — a szakmai-harmonika `rolunkSzakmaiUjBlokkok` mintájára.
 * Ha a builder alakja megváltozik (az első blokk nem `welcome`), `null`.
 */
export const szolgaltatasokUjBevezetoBlokk = (): SzekcioTipus<'welcome'> | null => {
  const elso = buildSzolgaltatasokLayout()[0]
  return elso !== undefined && elso.blockType === 'welcome' ? elso : null
}

/**
 * 12b. javítás — a `/szolgaltatasok` első szekciójának cseréje üdvözlő blokkra.
 *
 * VÉDŐFELTÉTELEK:
 *  - ha az 1. blokk MÁR `welcome`, nincs teendő (idempotencia);
 *  - csere CSAK akkor, ha az 1. blokk `richText`, ÉS a tartalma byte-ra a
 *    seedelt örökölt bevezető (kulcs-sorrendtől független összevetés, lásd
 *    `stabilJson`) — ha a szerkesztő átírta, a blokk érintetlen marad;
 *  - minden más eset hangos kihagyás (hiányzó előfeltétel).
 */
export const alkalmazSzolgaltatasokBevezeto = (input: {
  layout: Page['layout']
  /** A seedelt örökölt első blokk elvárt rich-text tartalma. */
  orokoltTartalom: unknown
  /** A seed-builderből vett ÚJ üdvözlő blokk. */
  ujBlokk: SzekcioTipus<'welcome'> | null
}): SzekciosorCsere => {
  const { layout, orokoltTartalom, ujBlokk } = input
  const uzenet = 'A /szolgaltatasok oldal bevezető szekciója'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'szolgaltatasok-bevezeto', uzenet, indok, hangos }],
  })

  if (ujBlokk === null) {
    return kihagyas(
      'a seed-builder (buildSzolgaltatasokLayout) első blokkja nem a várt üdvözlő (welcome) blokk — a kód és a csere-logika szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a Szolgáltatások oldalnak nincs szekciósora — nincs mit lecserélni', true)
  }

  const regiBlokk = layout[0]

  if (regiBlokk.blockType === 'welcome') {
    return kihagyas('a lap első szekciója MÁR üdvözlő (welcome) blokk — nincs teendő')
  }
  if (regiBlokk.blockType !== 'richText') {
    return kihagyas(
      `a lap első szekciójának típusa „${regiBlokk.blockType}”, nem a cserélendő richText — a szerkesztő átrendezte a lapot, kézi átnézés kell`,
      true,
    )
  }
  if (stabilJson(regiBlokk.content) !== stabilJson(orokoltTartalom)) {
    return kihagyas(
      'a bevezető blokk tartalma eltér a seedelt örökölttől — a szerkesztő időközben átírta, a script nem nyúl hozzá (az új szerkezetet az adminban, kézzel érdemes bevezetni)',
    )
  }

  const ujLayout: Szekciosor = [ujBlokk, ...layout.slice(1)]

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly: 'szolgaltatasok-bevezeto',
        uzenet: `${uzenet}: az örökölt, folyó szöveges richText blokk → üdvözlő (welcome) blokk (${ertekCimke(
          ujBlokk.title,
        )}) — ugyanaz a szöveg, tagolt szerkezetben`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// 16. javítás — a /kapcsolat lap HIÁNYZÓ szekciói: a szakember-elérhetőség
// (tulajdonosi kérés) és — ha az is hiányzik — az időpontkérő.
// ---------------------------------------------------------------------------

/** A `/kapcsolat` oldal webcíme (Pages.slug) — a route innen olvassa a szekciósorát. */
export const KAPCSOLAT_SLUG = 'kapcsolat'

/**
 * A két portré fájlnév-prefixe.
 *
 * Prefix és futásidejű feloldás a 4. és a 12a. javítás mintájára: a Média
 * collection webp-re konvertál, ezért a kiterjesztés környezetenként eltér, fix
 * azonosítót pedig nem használhatunk.
 */
export const KOCSIS_PORTRE_PREFIX = '67b3c6e9e315f_KocsisKatakozeli'
export const KISS_PORTRE_PREFIX = '67c07def59ac2_KissKataelegans'

/**
 * A /kapcsolat seedelt szekciósorának két blokkja, típus szerint szétszedve.
 *
 * MIÉRT A BUILDERBŐL: ugyanaz az elv, mint a szakmai harmonikánál
 * (`rolunkSzakmaiUjBlokkok`) és a záró CTA-sávnál — a beszúrt blokk pontosan az
 * legyen, amit egy friss adatbázisban a seed építene, hogy a kód-szintű
 * alapállapot és az élő javítás ne csúszhasson szét. Ha a builder alakja
 * megváltozik (nem pontosan egy-egy ilyen blokkot ad), `null` jön vissza, és a
 * hívó HANGOSAN kihagy — vaktában sosem írunk.
 */
export const kapcsolatSeedBlokkok = (
  portrek: { kocsisPortre?: number; kissPortre?: number } = {},
): {
  idopontkeres: SzekcioTipus<'appointment'> | null
  szakemberek: SzekcioTipus<'teamMembers'> | null
} => {
  const layout = buildKapcsolatLayout(portrek)
  const egyetlen = <T extends Szekciosor[number]['blockType']>(
    blockType: T,
  ): SzekcioTipus<T> | null => {
    const talalatok = layout.filter((blokk) => blokk.blockType === blockType)
    return talalatok.length === 1 ? (talalatok[0] as SzekcioTipus<T>) : null
  }
  return { idopontkeres: egyetlen('appointment'), szakemberek: egyetlen('teamMembers') }
}

/**
 * Egy szakember-szekció NÉV-halmaza — ebből dől el, hogy a lapon álló blokk a
 * miénk-e, vagy a szerkesztő sajátja.
 *
 * MIÉRT A NEVEK, ÉS NEM A TELJES BLOKK ÖSSZEVETÉSE: a Payload a mentéskor
 * minden blokkhoz és tömb-sorhoz saját `id`-t generál, a visszaolvasott blokk
 * tehát SOSEM egyezik byte-ra a kódból épített változattal — a mély összevetés
 * (`stabilJson`) itt minden második futáson hamis „a szerkesztő átírta"
 * eredményt adna, és elbukna az idempotencia. A nevek viszont a szerkesztés
 * után is a helyükön maradnak, és pontosan azt a kérdést döntik el, ami számít:
 * ugyanazt a két embert mutatja-e a szekció.
 */
const szakemberNevek = (blokk: SzekcioTipus<'teamMembers'>): string[] =>
  (blokk.members ?? [])
    .map((tag) => (tag.name ?? '').trim())
    .filter((nev) => nev.length > 0)
    .sort()

/**
 * /kapcsolat: hiányzó időpontkérő + szakember-szekció a seed-builderből. Meglévőt nem duplikál.
 */
export const alkalmazKapcsolatSzakemberek = (input: {
  layout: Page['layout']
  idopontkeresBlokk: SzekcioTipus<'appointment'> | null
  szakemberBlokk: SzekcioTipus<'teamMembers'> | null
}): SzekciosorCsere => {
  const { layout, idopontkeresBlokk, szakemberBlokk } = input
  const uzenet = 'A /kapcsolat lap szekciói'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'kapcsolat-szakemberek', uzenet, indok, hangos }],
  })

  if (idopontkeresBlokk === null || szakemberBlokk === null) {
    return kihagyas(
      'a seed-builder (buildKapcsolatLayout) nem pontosan egy időpontkérő és egy szakember-szekciót ad — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }

  const jelenlegi: Szekciosor = Array.isArray(layout) ? layout : []
  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  const ujLayout: Szekciosor = [...jelenlegi]

  // --- Időpontkérő -----------------------------------------------------------
  if (ujLayout.some((blokk) => blokk.blockType === 'appointment')) {
    kihagyasok.push({
      szabaly: 'kapcsolat-szakemberek',
      uzenet: `${uzenet}: az időpontkérő szekció`,
      indok: 'MÁR ott van a szekciósorban — nincs teendő',
    })
  } else {
    ujLayout.push(idopontkeresBlokk)
    modositasok.push({
      szabaly: 'kapcsolat-szakemberek',
      uzenet: `${uzenet}: az időpontkérő szekció BESZÚRVA (${
        ujLayout.length
      }. szekció), ${ertekCimke(idopontkeresBlokk.title)} címmel — a lapon eddig egyetlen szekció sem volt, csak az üzenetküldő űrlap`,
      indok: null,
    })
  }

  // --- Szakember-elérhetőség -------------------------------------------------
  const meglevoSzakember = ujLayout.find((blokk) => blokk.blockType === 'teamMembers')

  if (meglevoSzakember !== undefined && meglevoSzakember.blockType === 'teamMembers') {
    const ottNevek = szakemberNevek(meglevoSzakember)
    const seedNevek = szakemberNevek(szakemberBlokk)
    const azonos =
      ottNevek.length === seedNevek.length && ottNevek.every((nev, i) => nev === seedNevek[i])

    kihagyasok.push({
      szabaly: 'kapcsolat-szakemberek',
      uzenet: `${uzenet}: a szakember-elérhetőség`,
      indok: azonos
        ? `MÁR ott van a szekciósorban (${seedNevek.join(', ')}) — nincs teendő`
        : `a lapon MÁR áll egy szakember-szekció, de MÁS nevekkel (ott: ${
            ottNevek.length > 0 ? ottNevek.join(', ') : '(nincs név)'
          }; a seedelt: ${seedNevek.join(
            ', ',
          )}) — a szerkesztő sajátját nem duplikáljuk, nézd át az adminban`,
      hangos: !azonos,
    })
  } else {
    // Az időpontkérő fölött van: a telefonlistája veti fel a kérdést, amire ez a
    // szekció válaszol. A `findIndex` az ESETLEG MOST beszúrt blokkot is
    // megtalálja, tehát a sorrend üres szekciósorból indulva is helyes.
    const idopontIndex = ujLayout.findIndex((blokk) => blokk.blockType === 'appointment')
    const hova = idopontIndex === -1 ? ujLayout.length : idopontIndex + 1
    ujLayout.splice(hova, 0, szakemberBlokk)
    modositasok.push({
      szabaly: 'kapcsolat-szakemberek',
      uzenet: `${uzenet}: a szakember-elérhetőség BESZÚRVA (${
        hova + 1
      }. szekció), ${ertekCimke(szakemberBlokk.title)} címmel — a két gyógytornász neve, titulusa, portréja és kattintható telefonszáma`,
      indok: null,
    })
  }

  return {
    layout: modositasok.length > 0 ? ujLayout : null,
    modositasok,
    kihagyasok,
  }
}

// ---------------------------------------------------------------------------
// 19. javítás — fotó a „Miben segíthetünk?" / „Válaszd ki…" szolgáltatás-
// szekciókba, a tulajdonos által kiválogatott anyagból.
// ---------------------------------------------------------------------------

/** A két új fotó fájlnév-prefixe (a Média webp-re konvertál, ezért prefix). */
export const KEZELES_FOTO_PREFIX = 'kezeles-kezen'
export const KATAK_LABDAVAL_PREFIX = 'katak-labdaval'

/**
 * services szekció kép cseréje prefix-feloldással. /rolunk üres hely; /szolgaltatasok örökölt kép.
 */
export const alkalmazSzolgaltatasBlokkKep = (input: {
  layout: Page['layout']
  /** Az új kép média-azonosítója, vagy `null`, ha nincs ilyen rekord. */
  mediaId: number | null
  /** Naplócímke (pl. „/rolunk"). */
  oldalCimke: string
  /** `false` = csak ÜRES mezőt tölt ki; `true` = meglévő képet is lecserél. */
  cserelheto: boolean
}): SzekciosorCsere => {
  const { layout, mediaId, oldalCimke, cserelheto } = input
  const uzenet = `A ${oldalCimke} szolgáltatás-szekciójának képe`
  const szabaly: JavitasSzabaly = 'szolgaltatas-blokk-kep'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok, hangos }],
  })

  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('az oldalnak nincs szekciósora', true)
  }
  if (mediaId === null) {
    return kihagyas('a Médiatárban nincs meg a kép — előbb az appnak fel kell töltenie', true)
  }

  const indexek = layout
    .map((blokk, index) => (blokk.blockType === 'services' ? index : -1))
    .filter((index) => index !== -1)
  if (indexek.length === 0) {
    return kihagyas('a lapon nincs szolgáltatás-szekció', true)
  }
  if (indexek.length > 1) {
    return kihagyas(
      `a lapon ${indexek.length} szolgáltatás-szekció áll — nem egyértelmű, melyikbe való a kép`,
      true,
    )
  }

  const index = indexek[0]
  const blokk = layout[index]
  if (blokk.blockType !== 'services') {
    return kihagyas('a talált szekció típusa nem szolgáltatás-szekció', true)
  }
  const jelenlegiId = heroKepAzonosito(blokk.image ?? null)

  if (jelenlegiId === mediaId) {
    return kihagyas('a szekció MÁR ezt a képet viseli — nincs teendő')
  }
  if (jelenlegiId !== null && !cserelheto) {
    return kihagyas(
      `a szekciónak MÁR van képe (azonosító: ${jelenlegiId}) — a script csak üres mezőt tölt ki`,
    )
  }

  const ujLayout: Szekciosor = layout.map((elem, elemIndex) =>
    elemIndex === index ? { ...elem, image: mediaId } : elem,
  )

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly,
        uzenet:
          jelenlegiId === null
            ? `${uzenet}: az üres képhely kitöltve (azonosító: ${mediaId})`
            : `${uzenet}: az örökölt kép (azonosító: ${jelenlegiId}) helyére a rendelői kezelést mutató fotó került (azonosító: ${mediaId}). A régi kép a Médiatárban marad.`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// Futtatás — a tiszta átalakításokat köti az adatbázishoz.
// ---------------------------------------------------------------------------

/** Egy kapu akkor nyitott, ha a környezeti változó pontosan „igen” (kis/nagybetű mindegy). */
const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

/** A módosítás- és kihagyás-sorok naplózása (a próbafutás csak a szóhasználatban tér el). */
const naplozdLepeseket = (
  lepesek: { modositasok: JavitasLepes[]; kihagyasok: JavitasLepes[] },
  dryRun: boolean,
): void => {
  for (const lepes of lepesek.modositasok) {
    logger.info(`Tartalom-javítás — ${dryRun ? 'MÓDOSÍTANÁ' : 'MÓDOSÍTVA'}: ${lepes.uzenet}`)
  }
  for (const lepes of lepesek.kihagyasok) {
    const sor = `Tartalom-javítás — ${dryRun ? 'KIHAGYNÁ' : 'KIHAGYVA'}: ${lepes.uzenet} (${
      lepes.indok
    })`
    if (lepes.hangos === true) {
      logger.error(sor)
      continue
    }
    logger.warn(sor)
  }
}

/**
 * Média-rekord keresése FÁJLNÉV-PREFIX alapján.
 *
 * A `like` szűrő a lekérdezést szűkíti (SQL-mintaként az `_` egy tetszőleges
 * karakterre is illeszkedne), a tényleges prefix-egyezést ezért kódban
 * ellenőrizzük — így a találat biztosan a keresett fájl. Fix azonosítót
 * szándékosan nem használunk: a Média collection webp-re konvertál, a
 * kiterjesztés környezetenként eltér.
 */
const keresdMediat = async (
  payload: Payload,
  prefix: string,
): Promise<{ id: number; filename: string } | null> => {
  const talalat = await payload.find({
    collection: 'media',
    where: { filename: { like: `${prefix}%` } },
    limit: 25,
    depth: 0,
    overrideAccess: true,
  })
  const sor = talalat.docs.find(
    (doc) => typeof doc.filename === 'string' && doc.filename.startsWith(prefix),
  )
  if (sor === undefined || typeof sor.filename !== 'string') {
    return null
  }
  return { id: sor.id, filename: sor.filename }
}

/**
 * Figyelmeztetés, ha a dokumentumnak a publikáltnál FRISSEBB, még nem publikált
 * piszkozata van.
 *
 * A pages és a products collection is autosave-es piszkozatokkal fut, ezért a
 * szerkesztő mentetlen munkája a publikált változatból nem látszik. A script
 * szándékosan a PUBLIKÁLT változatot javítja (az a látogató által látott
 * tartalom), de ilyenkor a piszkozat későbbi közzététele visszahozná a régi
 * szöveget — ezt jelezni kell, nem elhallgatni. (Ugyanez a csapda:
 * src/scripts/videok-modulba.ts.)
 */
const figyelmeztessPiszkozatra = (
  cimke: string,
  publikaltFrissitve: unknown,
  piszkozatFrissitve: unknown,
): void => {
  if (
    typeof publikaltFrissitve === 'string' &&
    typeof piszkozatFrissitve === 'string' &&
    piszkozatFrissitve > publikaltFrissitve
  ) {
    logger.warn(
      `Tartalom-javítás: a(z) ${cimke} dokumentumnak a publikáltnál FRISSEBB, még nem publikált piszkozata van. A javítás a PUBLIKÁLT változatba került (ez látszik a látogatónak), de a piszkozat későbbi közzététele visszahozhatja a régi szöveget — nézd át az adminban.`,
      { publikalt: publikaltFrissitve, piszkozat: piszkozatFrissitve },
    )
  }
}

async function futtat(): Promise<void> {
  const dryRun = !kapuNyitva('OWNER_CONTENT_CONFIRM')
  const payload: Payload = await getPayload({ config })

  logger.info(
    dryRun
      ? 'Tartalom-javítás: PRÓBAFUTÁS indul (OWNER_CONTENT_CONFIRM=igen nélkül semmi nem íródik).'
      : 'Tartalom-javítás: ÉLES futás indul (OWNER_CONTENT_CONFIRM=igen).',
  )

  let modositasokSzama = 0
  let kihagyasokSzama = 0
  let hiba = false

  // --- 1–2. javítás: a kezdőlap szekciósora ---------------------------------
  const oldalTalalat = await payload.find({
    collection: 'pages',
    where: { slug: { equals: HOME_PAGE_SLUG } },
    limit: 1,
    // depth: 0 — a kapcsolt mezők (képek) azonosítóként jönnek vissza, így a
    // teljes szekciósor visszaírása nem alakítja át a hivatkozásokat.
    depth: 0,
    overrideAccess: true,
  })
  const kezdolap = oldalTalalat.docs[0]

  if (kezdolap === undefined) {
    logger.error(
      `Tartalom-javítás: nem található a kezdőlap (Pages, webcím: „${HOME_PAGE_SLUG}”) — a kezdőlapi javítások kimaradtak.`,
    )
    hiba = true
  } else {
    // A négy kezdőlapi javítás (1–2., 9., 10., 11.) LÁNCBAN fut: mindegyik az
    // előző eredményén dolgozik, és a végén EGYETLEN frissítés megy ki — a
    // Payload blokk-mezője részlegesen úgysem frissíthető.
    const alap = alkalmazKezdolapJavitasok(kezdolap.layout)
    naplozdLepeseket(alap, dryRun)
    modositasokSzama += alap.modositasok.length
    kihagyasokSzama += alap.kihagyasok.length

    let kezdolapLayout: Szekciosor = alap.layout
    let kezdolapValtozott = alap.modositasok.length > 0

    const kezdolapLepes = (eredmeny: SzekciosorCsere): void => {
      naplozdLepeseket(eredmeny, dryRun)
      modositasokSzama += eredmeny.modositasok.length
      kihagyasokSzama += eredmeny.kihagyasok.length
      if (eredmeny.layout !== null) {
        kezdolapLayout = eredmeny.layout
        kezdolapValtozott = true
      }
    }

    // --- 9. javítás: a sajtó-logósor felirata --------------------------------
    kezdolapLepes(
      alkalmazPressLogosFejlec({ layout: kezdolapLayout, ujFejlec: pressLogosUjFejlec() }),
    )
    // --- 10. javítás: a „Három állapot” szekció bevezetője -------------------
    kezdolapLepes(
      alkalmazAllapotokBevezeto({ layout: kezdolapLayout, ujBevezeto: allapotokUjBevezeto() }),
    )
    // --- 10b. javítás: a „Nyitott” kártya hibás igéje -------------------------
    kezdolapLepes(
      alkalmazAllapotokNyitottIge({
        layout: kezdolapLayout,
        ujSzoveg: allapotokUjNyitottSzoveg(),
      }),
    )
    // --- 11. javítás: a záró CTA-sáv -----------------------------------------
    kezdolapLepes(alkalmazZaroCta({ layout: kezdolapLayout, seedBlokk: zaroCtaSeedBlokk() }))
    // --- 15. javítás: a kurzuslista-gombok egységes felirata -----------------
    // A LÁNC VÉGÉN fut, hogy a 11. javítás által ÚJONNAN beszúrt záró CTA-sáv
    // feliratát is elérje — a beszúrás után az is a szekciósor része.
    kezdolapLepes(alkalmazKurzuslistaFeliratok(kezdolapLayout))

    if (kezdolapValtozott && !dryRun) {
      await payload.update({
        collection: 'pages',
        id: kezdolap.id,
        // A blokk-mező részlegesen nem frissíthető: a TELJES szekciósor megy
        // vissza, de a nem érintett blokkok objektumai változatlanok.
        data: { layout: kezdolapLayout },
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'pages',
          id: kezdolap.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra('kezdőlap', kezdolap.updatedAt, piszkozat?.updatedAt)
    }
  }

  // --- 3. javítás: a kurzus előny-sorai -------------------------------------
  const termekTalalat = await payload.find({
    collection: 'products',
    where: { sku: { equals: KURZUS_SKU } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const termek = termekTalalat.docs[0]

  if (termek === undefined) {
    logger.error(
      `Tartalom-javítás: nem található a kurzus (Kurzusok, azonosító: „${KURZUS_SKU}”) — az előny-sorok kimaradtak.`,
    )
    hiba = true
  } else {
    const eredmeny = alkalmazKurzusElonyok(termek.cardHighlights)
    naplozdLepeseket(eredmeny, dryRun)
    modositasokSzama += eredmeny.modositasok.length
    kihagyasokSzama += eredmeny.kihagyasok.length

    if (eredmeny.cardHighlights !== null && !dryRun) {
      await payload.update({
        collection: 'products',
        id: termek.id,
        data: { cardHighlights: eredmeny.cardHighlights },
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'products',
          id: termek.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra(`kurzus („${KURZUS_SKU}”)`, termek.updatedAt, piszkozat?.updatedAt)
    }
  }

  // --- 4–5. javítás: a /rolunk fejléc-képe és szakmai háttere ---------------
  const rolunkTalalat = await payload.find({
    collection: 'pages',
    where: { slug: { equals: ROLUNK_SLUG } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const rolunk = rolunkTalalat.docs[0]

  if (rolunk === undefined) {
    logger.error(
      `Tartalom-javítás: nem található a Rólunk oldal (Pages, webcím: „${ROLUNK_SLUG}”) — a fejléc-kép cseréje és a szakmai háttér harmonikába szervezése kimaradt.`,
    )
    hiba = true
  } else {
    const regiKep = await keresdMediat(payload, REGI_ROLUNK_HERO_PREFIX)
    const ujKep = await keresdMediat(payload, UJ_ROLUNK_HERO_PREFIX)
    logger.info('Tartalom-javítás: a fejléc-képhez tartozó média-rekordok', {
      regi: regiKep?.filename ?? '(nem található)',
      uj: ujKep?.filename ?? '(nem található)',
    })

    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: rolunk.heroImage,
      regiMediaId: regiKep?.id ?? null,
      ujMediaId: ujKep?.id ?? null,
    })
    naplozdLepeseket(eredmeny, dryRun)
    modositasokSzama += eredmeny.modositasok.length
    kihagyasokSzama += eredmeny.kihagyasok.length

    // --- 5. javítás: a szakmai háttér harmonikába -----------------------------
    const ujBlokkok = rolunkSzakmaiUjBlokkok()
    const harmonika = alkalmazSzakmaiHarmonika({
      layout: rolunk.layout,
      orokoltTartalom: rolunkSzakmaiOrokoltTartalom(),
      ujRovidBlokk: ujBlokkok.rovid,
      ujHarmonikaBlokk: ujBlokkok.harmonika,
    })
    naplozdLepeseket(harmonika, dryRun)
    modositasokSzama += harmonika.modositasok.length
    kihagyasokSzama += harmonika.kihagyasok.length

    // 9b. javítás — a /rolunk sajtó-logósor felirata (láncban: a harmonika
    // eredmény-layoutján fut, hogy az egyetlen írás mindkettőt vigye).
    const rolunkPressAlap = harmonika.layout ?? rolunk.layout
    const rolunkPress = alkalmazPressLogosFejlec({
      layout: rolunkPressAlap,
      ujFejlec: pressLogosUjFejlec(),
      uzenetCimke: 'A Rólunk oldal sajtó-logósorának felirata',
    })
    naplozdLepeseket(rolunkPress, dryRun)
    modositasokSzama += rolunkPress.modositasok.length
    kihagyasokSzama += rolunkPress.kihagyasok.length

    // --- 19a. javítás: fotó a „Miben segíthetünk?" szekcióba ------------------
    // A lánc VÉGÉN, hogy a korábbi lépések eredmény-layoutján dolgozzon.
    const rolunkKep = await keresdMediat(payload, KATAK_LABDAVAL_PREFIX)
    const rolunkKepLepes = alkalmazSzolgaltatasBlokkKep({
      layout: rolunkPress.layout ?? rolunkPressAlap,
      mediaId: rolunkKep?.id ?? null,
      oldalCimke: '/rolunk',
      // Üres képhely: meglévő képet NEM írunk felül.
      cserelheto: false,
    })
    naplozdLepeseket(rolunkKepLepes, dryRun)
    modositasokSzama += rolunkKepLepes.modositasok.length
    kihagyasokSzama += rolunkKepLepes.kihagyasok.length

    // A javítások EGY frissítésben mennek ki (a heroImage és a layout külön
    // mező, nem ütköznek), így egyetlen piszkozat-ellenőrzés elég.
    const irando: { heroImage?: number; layout?: Szekciosor } = {}
    if (eredmeny.heroImage !== null) {
      irando.heroImage = eredmeny.heroImage
    }
    const rolunkVegsoLayout = rolunkKepLepes.layout ?? rolunkPress.layout ?? harmonika.layout
    if (rolunkVegsoLayout !== null) {
      irando.layout = rolunkVegsoLayout
    }

    if (Object.keys(irando).length > 0 && !dryRun) {
      await payload.update({
        collection: 'pages',
        id: rolunk.id,
        data: irando,
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'pages',
          id: rolunk.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra('Rólunk oldal', rolunk.updatedAt, piszkozat?.updatedAt)
    }
  }

  // --- 6. javítás: a három jogi oldal létrehozása ---------------------------
  // A meglévő webcímeket EGY lekérdezés deríti ki (draft-ot is beleértve: a
  // publikálatlan piszkozat is „létező" oldal — ha ilyet találunk, a script
  // hozzá sem nyúl, nehogy párhuzamos, második jogi oldal keletkezzen).
  const jogiSlugok = JOGI_OLDALAK.map((oldal) => oldal.slug)
  const jogiTalalat = await payload.find({
    collection: 'pages',
    where: { slug: { in: jogiSlugok } },
    limit: jogiSlugok.length,
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  const jogiEredmeny = alkalmazJogiOldalak({
    letezoSlugok: jogiTalalat.docs
      .map((doc) => doc.slug)
      .filter((slug): slug is string => typeof slug === 'string'),
  })
  naplozdLepeseket(jogiEredmeny, dryRun)
  modositasokSzama += jogiEredmeny.modositasok.length
  kihagyasokSzama += jogiEredmeny.kihagyasok.length

  if (!dryRun) {
    for (const adat of jogiEredmeny.letrehozando) {
      await payload.create({
        collection: 'pages',
        data: { ...adat, publishedAt: new Date().toISOString() },
        depth: 0,
        overrideAccess: true,
      })
    }
  }

  // --- 14. + 18. + 19. javítás: az ÁSZF élő szövegének javításai ------------
  // Csak a MÁR LÉTEZŐ ÁSZF-oldalra vonatkoznak: ha a lapot ez a futás hozta
  // létre, a szöveg a forrásfájlból már javítva érkezett.
  //
  // A három javítás LÁNCBAN fut (mindegyik az előző eredményén dolgozik), és
  // EGYETLEN `payload.update` megy ki — külön írások külön verzió-bejegyzést
  // hoznának létre ugyanarra a jogi oldalra.
  //
  // A SORREND KÖTÖTT: a 19. javítás horgonya a 18. javítás ÚJ, Barion-os
  // mondata, ezért a 18. javításnak előbb kell lefutnia — különben egy még
  // javítatlan (STRIPE-os) élő oldalon a beszúrásnak nem lenne horgonya.
  const aszfOldal = jogiTalalat.docs.find((doc) => doc.slug === 'aszf')
  if (aszfOldal !== undefined) {
    const aszfEredmeny = alkalmazAszfAdatvedelemLink(aszfOldal.content)
    naplozdLepeseket(aszfEredmeny, dryRun)
    modositasokSzama += aszfEredmeny.modositasok.length
    kihagyasokSzama += aszfEredmeny.kihagyasok.length

    const aszfTenyek = alkalmazAszfBekezdesCserek(aszfEredmeny.content ?? aszfOldal.content)
    naplozdLepeseket(aszfTenyek, dryRun)
    modositasokSzama += aszfTenyek.modositasok.length
    kihagyasokSzama += aszfTenyek.kihagyasok.length

    const aszfBarion = alkalmazAszfBarionKiegeszites(
      aszfTenyek.content ?? aszfEredmeny.content ?? aszfOldal.content,
    )
    naplozdLepeseket(aszfBarion, dryRun)
    modositasokSzama += aszfBarion.modositasok.length
    kihagyasokSzama += aszfBarion.kihagyasok.length

    const aszfVegsoTartalom = aszfBarion.content ?? aszfTenyek.content ?? aszfEredmeny.content

    if (aszfVegsoTartalom !== null && !dryRun) {
      await payload.update({
        collection: 'pages',
        id: aszfOldal.id,
        data: { content: aszfVegsoTartalom as typeof aszfOldal.content },
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'pages',
          id: aszfOldal.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra('ÁSZF', aszfOldal.updatedAt, piszkozat?.updatedAt)
    }
  }

  // --- 7. javítás: az SOS kurzus webcíme ------------------------------------
  const sosTalalat = await payload.find({
    collection: 'products',
    where: { sku: { equals: SOS_COURSE_SKU } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const sosKurzus = sosTalalat.docs[0]

  if (sosKurzus === undefined) {
    logger.error(
      `Tartalom-javítás: nem található az SOS kurzus (Kurzusok, azonosító: „${SOS_COURSE_SKU}”) — a webcím javítása kimaradt.`,
    )
    hiba = true
  } else {
    const eredmeny = alkalmazSosKurzusSlug(sosKurzus.slug)
    naplozdLepeseket(eredmeny, dryRun)
    modositasokSzama += eredmeny.modositasok.length
    kihagyasokSzama += eredmeny.kihagyasok.length

    // --- 13. javítás: az SOS kurzus ingyenes-jelölője -----------------------
    // Ugyanazon a rekordon dolgozik, ezért EGYETLEN update-be fut össze a
    // slug-javítással: két külön írás két verzió-bejegyzést hozna létre.
    const ingyenes = alkalmazSosIngyenesJelolo(sosKurzus)
    naplozdLepeseket(ingyenes, dryRun)
    modositasokSzama += ingyenes.modositasok.length
    kihagyasokSzama += ingyenes.kihagyasok.length

    // --- 17. javítás: az SOS kurzus kapcsolódó (cross-sell) kurzusa ---------
    // A cél kurzust WEBCÍM alapján keressük: az azonosító környezetenként más,
    // a webcím a kurzus stabil, nyilvános azonosítója. A `draft: true` azért
    // kell, mert a még nem publikált program is LÉTEZŐ kurzus — ilyenkor a
    // kapcsolat helyes adat, csak a sáv nem jelenik meg, amíg publikálatlan
    // (RelatedCourses csak published terméket renderel), és ezt hangosan
    // kiírjuk, hogy ne tűnjön néma hibának.
    const celTalalat = await payload.find({
      collection: 'products',
      where: { slug: { equals: OTTHONI_KURZUS_SLUG } },
      limit: 1,
      depth: 0,
      draft: true,
      overrideAccess: true,
    })
    const celKurzus = celTalalat.docs[0]
    if (celKurzus !== undefined && celKurzus.status !== 'published') {
      logger.error(
        `Tartalom-javítás: a cross-sell cél kurzus („${OTTHONI_KURZUS_SLUG}”) állapota „${
          celKurzus.status ?? '(nincs)'
        }”, nem „published” — a kapcsolat beíródik, de a sáv addig NEM jelenik meg a látogatónak, amíg a kurzust nem teszed közzé.`,
      )
    }
    const kapcsolodo = alkalmazSosKapcsolodoKurzus({
      jelenlegi: sosKurzus.relatedProducts,
      sosId: sosKurzus.id,
      celId: celKurzus?.id ?? null,
    })
    naplozdLepeseket(kapcsolodo, dryRun)
    modositasokSzama += kapcsolodo.modositasok.length
    kihagyasokSzama += kapcsolodo.kihagyasok.length

    const sosAdat: Partial<Pick<Product, 'slug' | 'priceInHUFEnabled' | 'relatedProducts'>> = {}
    if (eredmeny.slug !== null) {
      sosAdat.slug = eredmeny.slug
    }
    if (ingyenes.priceInHUFEnabled !== null) {
      sosAdat.priceInHUFEnabled = ingyenes.priceInHUFEnabled
    }
    if (kapcsolodo.relatedProducts !== null) {
      sosAdat.relatedProducts = kapcsolodo.relatedProducts
    }

    if (Object.keys(sosAdat).length > 0 && !dryRun) {
      await payload.update({
        collection: 'products',
        id: sosKurzus.id,
        data: sosAdat,
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'products',
          id: sosKurzus.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra(
        `SOS kurzus („${SOS_COURSE_SKU}”)`,
        sosKurzus.updatedAt,
        piszkozat?.updatedAt,
      )
    }
  }

  // --- 8. és 12. javítás: a /szolgaltatasok oldal --------------------------
  const szolgaltatasokTalalat = await payload.find({
    collection: 'pages',
    where: { slug: { equals: SZOLGALTATASOK_SLUG } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const szolgaltatasok = szolgaltatasokTalalat.docs[0]

  if (szolgaltatasok === undefined) {
    logger.error(
      `Tartalom-javítás: nem található a Szolgáltatások oldal (Pages, webcím: „${SZOLGALTATASOK_SLUG}”) — a rendelői horgony javítása és a lap-tető redesignja kimaradt.`,
    )
    hiba = true
  } else {
    // A két szekciósor-javítás (8. horgony, 12b. bevezető blokk) LÁNCBAN fut, a
    // fejléc-kép ürítése (12a) pedig külön mező — mindhárom EGYETLEN
    // frissítésben megy ki.
    let szolgaltatasokLayout: Szekciosor = Array.isArray(szolgaltatasok.layout)
      ? szolgaltatasok.layout
      : []
    let layoutValtozott = false

    const szolgaltatasokLepes = (eredmeny: SzekciosorCsere): void => {
      naplozdLepeseket(eredmeny, dryRun)
      modositasokSzama += eredmeny.modositasok.length
      kihagyasokSzama += eredmeny.kihagyasok.length
      if (eredmeny.layout !== null) {
        szolgaltatasokLayout = eredmeny.layout
        layoutValtozott = true
      }
    }

    // --- 8. javítás: a rendelői szekció horgonya -----------------------------
    szolgaltatasokLepes(alkalmazRendeloiHorgony(szolgaltatasokLayout))
    // --- 12b. javítás: az örökölt bevezető → üdvözlő blokk -------------------
    szolgaltatasokLepes(
      alkalmazSzolgaltatasokBevezeto({
        layout: szolgaltatasokLayout,
        orokoltTartalom: szolgaltatasokRegiBevezetoTartalom(),
        ujBlokk: szolgaltatasokUjBevezetoBlokk(),
      }),
    )

    // --- 19b. javítás: a rendelői kezelést mutató fotó a szolgáltatás-szekcióba
    const kezelesKep = await keresdMediat(payload, KEZELES_FOTO_PREFIX)
    szolgaltatasokLepes(
      alkalmazSzolgaltatasBlokkKep({
        layout: szolgaltatasokLayout,
        mediaId: kezelesKep?.id ?? null,
        oldalCimke: '/szolgaltatasok',
        // Itt SZÁNDÉKOS a csere: az örökölt 940×788-as kép helyére valódi
        // kezelés-fotó kerül. A régi a Médiatárban marad.
        cserelheto: true,
      }),
    )

    // --- 12a. javítás: a fejléc-kép ürítése ----------------------------------
    const rendeloKep = await keresdMediat(payload, SZOLGALTATASOK_HERO_PREFIX)
    logger.info('Tartalom-javítás: a /szolgaltatasok fejléc-képéhez tartozó média-rekord', {
      rendelo: rendeloKep?.filename ?? '(nem található)',
    })
    const heroUrites = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: szolgaltatasok.heroImage,
      regiMediaId: rendeloKep?.id ?? null,
    })
    naplozdLepeseket(heroUrites, dryRun)
    modositasokSzama += heroUrites.modositasok.length
    kihagyasokSzama += heroUrites.kihagyasok.length

    const irandoSzolgaltatasok: { layout?: Szekciosor; heroImage?: null } = {}
    if (layoutValtozott) {
      irandoSzolgaltatasok.layout = szolgaltatasokLayout
    }
    if (heroUrites.uritendo) {
      irandoSzolgaltatasok.heroImage = null
    }

    if (Object.keys(irandoSzolgaltatasok).length > 0 && !dryRun) {
      await payload.update({
        collection: 'pages',
        id: szolgaltatasok.id,
        data: irandoSzolgaltatasok,
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'pages',
          id: szolgaltatasok.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra(
        'Szolgáltatások oldal',
        szolgaltatasok.updatedAt,
        piszkozat?.updatedAt,
      )
    }
  }

  // --- 16. javítás: a /kapcsolat lap szekciói -------------------------------
  const kapcsolatTalalat = await payload.find({
    collection: 'pages',
    where: { slug: { equals: KAPCSOLAT_SLUG } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const kapcsolat = kapcsolatTalalat.docs[0]

  if (kapcsolat === undefined) {
    logger.error(
      `Tartalom-javítás: nem található a Kapcsolat oldal (Pages, webcím: „${KAPCSOLAT_SLUG}”) — a /kapcsolat szekcióinak beszúrása kimaradt. Ezt az oldalt a legacy-visszaépítő hozza létre: npm run seed:legacy`,
    )
    hiba = true
  } else {
    const kocsisPortre = await keresdMediat(payload, KOCSIS_PORTRE_PREFIX)
    const kissPortre = await keresdMediat(payload, KISS_PORTRE_PREFIX)
    logger.info('Tartalom-javítás: a /kapcsolat szakember-portréi', {
      kocsis: kocsisPortre?.filename ?? '(nem található)',
      kiss: kissPortre?.filename ?? '(nem található)',
    })
    // A portré HIÁNYA nem blokkolja a beszúrást: a szekció név, titulus, rövid
    // bemutatkozás és kattintható telefonszám nélkül is értéktelen lenne, kép
    // nélkül viszont csak szegényebb (a renderelő a hiányzó képet kihagyja).
    // Hangosan naplózzuk, mert a portré a szekció fele — az NN/g fotó-kutatása
    // szerint a valódi munkatárs arcát a látogatók hosszabban nézik, mint a
    // mellette álló életrajzot (https://www.nngroup.com/articles/photos-as-web-content/).
    if (kocsisPortre === null || kissPortre === null) {
      logger.error(
        `Tartalom-javítás: a /kapcsolat szakember-szekciójához hiányzik portré (${KOCSIS_PORTRE_PREFIX}: ${
          kocsisPortre === null ? 'NINCS' : 'megvan'
        }, ${KISS_PORTRE_PREFIX}: ${
          kissPortre === null ? 'NINCS' : 'megvan'
        }). A szekció ettől még kikerül, de arc nélkül — a képeket a legacy-visszaépítő tölti fel: npm run seed:legacy`,
      )
    }

    const seedBlokkok = kapcsolatSeedBlokkok({
      kocsisPortre: kocsisPortre?.id,
      kissPortre: kissPortre?.id,
    })
    const kapcsolatEredmeny = alkalmazKapcsolatSzakemberek({
      layout: kapcsolat.layout,
      idopontkeresBlokk: seedBlokkok.idopontkeres,
      szakemberBlokk: seedBlokkok.szakemberek,
    })
    naplozdLepeseket(kapcsolatEredmeny, dryRun)
    modositasokSzama += kapcsolatEredmeny.modositasok.length
    kihagyasokSzama += kapcsolatEredmeny.kihagyasok.length

    if (kapcsolatEredmeny.layout !== null && !dryRun) {
      await payload.update({
        collection: 'pages',
        id: kapcsolat.id,
        data: { layout: kapcsolatEredmeny.layout },
        depth: 0,
        overrideAccess: true,
      })
      const piszkozat = await payload
        .findByID({
          collection: 'pages',
          id: kapcsolat.id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        .catch(() => null)
      figyelmeztessPiszkozatra('Kapcsolat oldal', kapcsolat.updatedAt, piszkozat?.updatedAt)
    }
  }

  // --- Összesítés -----------------------------------------------------------
  const osszesites = `${modositasokSzama} módosítás, ${kihagyasokSzama} indokolt kihagyás`

  if (dryRun) {
    logger.info(
      `Tartalom-javítás PRÓBAFUTÁS kész — összesítés: ${osszesites}. Az adatbázisba SEMMI nem íródott. Tényleges futtatás: OWNER_CONTENT_CONFIRM=igen npm run content:owner`,
    )
    if (hiba) {
      process.exitCode = 1
    }
    return
  }

  if (hiba) {
    logger.error(
      `Tartalom-javítás HIÁNYOSAN futott le — összesítés: ${osszesites}. A hiányzó dokumentum(ok) miatt nem minden javítás történt meg; nézd át a fenti hibasorokat.`,
    )
    process.exitCode = 1
    return
  }

  logger.info(`Tartalom-javítás kész — összesítés: ${osszesites}.`)
  logger.info('OWNER_CONTENT_OK')
}

// A modul mellékhatás nélkül importálható (a tiszta átalakítások így
// tesztelhetők); a futtatás csak közvetlen indításkor indul el.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      logger.error('Tartalom-javítás: hiba történt.', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
