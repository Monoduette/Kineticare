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

import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { HOME_PAGE_SLUG } from '../lib/content-slugs'
// A kezdőlap alapállapotának builder-e: a 9–11. javítás ÚJ értékei innen
// jönnek, hogy a seed és a javítás ne két külön literálban éljen.
import {
  COURSE_SHORT_DESCRIPTION_FIXED,
  COURSE_SHORT_DESCRIPTION_LEFTOVER,
  HOW_IT_WORKS_STEP1_FIXED,
  HOW_IT_WORKS_STEP1_LEFTOVER,
} from '../lib/gondolatjel-leftover'
import { buildHomeLayout } from '../lib/home-seed'
import {
  JOGI_OLDALAK,
  jogiOldalTartalom,
  richTextSzoveg,
  type JogiOldalLeiras,
} from '../lib/legal-content'
import { logger } from '../lib/logger'
import { HOME_HELP_TITLE, isSzolgaltatasokAjtoBlock } from '../lib/home-help-states'
import { enrollMediaRecovery, managedMediaAssets } from '../lib/media-recovery-provenance'
import { resolveUploadDir } from '../lib/media-restore'
import {
  CLINIC_TREATMENTS_ANCHOR,
  LEGACY_PROFESSIONAL_TRAINING_MENU_LABELS,
  PROFESSIONAL_TRAINING_URL,
  SOS_COURSE_SKU,
} from '../lib/menu-seed'
import {
  KEZDOLAP_BEMUTATKOZAS,
  KEZDOLAP_BEMUTATKOZAS_CIM,
  kezdolapBemutatkozasRovidSzoveg,
  kezdolapBemutatkozasSzoveg,
  rolunkBemutatkozasSzoveg,
  WP18_KOZOS_BEMUTATKOZAS,
  ROLUNK_BEMUTATKOZAS_V1,
} from '../lib/rolunk-bemutatkozas'
import config from '../payload.config'
import type { Media, Menu, Page, Product } from '../payload-types'
// Mellékhatás-mentes import (a legacy-script futtatás-kapuval védett): a
// szakmai-háttér csere és a /szolgaltatasok lap-tetejének cseréje a
// seed-builderből veszi az ÚJ blokkokat, és az örökölt tartalommal veti össze
// az élő blokkot.
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
  para,
  ROLUNK_PARTNER_FELIRAT,
  ROLUNK_TOVABBI_PARTNEREK,
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
 * A /rolunk fejléc-képének KORÁBBI, a script vagy a seed által beállított
 * képei, fájlnév-prefixként (a Média collection webp-re konvertál, ezért a
 * kiterjesztés környezetenként eltér). KIZÁRÓLAG ezeket (vagy az üres mezőt)
 * cseréli le a script a stúdiófotóra: a szóló portrét (`682a121babe80_IMG_7573`,
 * a régi oldal öröksége) és a páros csapatfotót (`katak-team`, a 4. javítás
 * korábbi célja). Minden más kép a szerkesztőé, a script hangosan kihagyja.
 */
export const ROLUNK_HERO_KORABBI_PREFIXEK: readonly string[] = [
  '682a121babe80_IMG_7573',
  'katak-team',
]

/**
 * A /rolunk fejléc-képének jóváhagyott célja (WP54, tulajdonosi kör
 * 2026-09-19): a stúdióban készült páros alapítói fotó. PONTOS fájlnév, nem
 * prefix: a forrás már webp, a Payload a nevet változatlanul tartja meg, a
 * script pedig a repó fájljából maga hozza létre a média-rekordot, ha még
 * nincs (`biztositMediaFajlbol`).
 */
export const ROLUNK_HERO_FORRAS: MediaForras = {
  filename: 'founders-studio-pair-1600.webp',
  filePath: 'public/media/team/founders-studio-pair-1600.webp',
  alt: 'Kocsis Kata és Kiss Kata a stúdióban.',
}

/**
 * Az ingyenes SOS villámkurzus galériájának jóváhagyott három képe, EBBEN a
 * sorrendben (WP54). A kurzusoldal a galéria ELSŐ képét rendereli a leírás
 * után (src/components/courses/CourseGalleryFigure.tsx); a további képek
 * megjelenítése külön döntés, a sorrend ezért a gumiszalagos nyújtással
 * kezdődik.
 */
export const SOS_GALERIA_FORRASOK: readonly MediaForras[] = [
  {
    filename: 'sos-band-stretch-1600.webp',
    filePath: 'public/media/sos/sos-band-stretch-1600.webp',
    alt: 'Gumiszalagos csuklónyújtás az asztal szélén.',
  },
  {
    filename: 'sos-ball-squeeze-1600.webp',
    filePath: 'public/media/sos/sos-ball-squeeze-1600.webp',
    alt: 'Puha labda szorítása a tenyérben.',
  },
  {
    filename: 'sos-spiky-ball-forearm-1600.webp',
    filePath: 'public/media/sos/sos-spiky-ball-forearm-1600.webp',
    alt: 'Tüskés labdás alkarlazítás.',
  },
]

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
 * A kezdőlapi Rólunk-blokk RÉGI, seedelt címe (WP18). Kizárólag PONTOSAN ezzel
 * a címmel álló blokk szövege cserélődik a /rolunk lappal közös
 * bemutatkozásra (src/lib/rolunk-bemutatkozas.ts).
 */
export const REGI_KEZDOLAP_ROLUNK_CIM = 'Kiss Kata és Kocsis Kata vagyunk'

/**
 * A kezdőlapi Rólunk-blokk RÉGI címei, amelyeknél a csere megengedett: a
 * seedelt cím és az élő CMS-en a filmsáv utáni alapítói szekció szerkesztői
 * címe (mérve 2026-09-07: a 2. szekció „A Kineticare alapítói", a 11. szekció
 * a seedelt cím). Más cím a szerkesztőé, érintetlen.
 */
export const REGI_KEZDOLAP_ROLUNK_CIMEK: readonly string[] = [
  REGI_KEZDOLAP_ROLUNK_CIM,
  'A Kineticare alapítói',
]

/**
 * A `/szolgaltatasok` KORÁBBI fejléc-képének fájlnév-prefixe (az örökölt
 * rendelő-fotó). Prefix, mert a Média collection webp-re konvertál, ezért a
 * kiterjesztés környezetenként eltér. WP55-től ez a script által cserélhető
 * „korábbi kép” (lásd `SZOLGALTATASOK_HERO_FORRAS`); a 12a. javítás régebbi,
 * ürítő változata megszűnt, a mezőre egyetlen szabály él.
 */
export const SZOLGALTATASOK_HERO_PREFIX = '67b3bd06f3936_Rendelo'

/**
 * A `/szolgaltatasok` fejléc-képének jóváhagyott célja (WP55, tulajdonosi
 * visszajelzés: „olyan szűknek néz ki a sáv” — a lap fejléce a /rolunk
 * párosított alakját kapja, kezelőasztalos fotóval). PONTOS fájlnév; a
 * rekordot a script a repó fájljából hozza létre, ha még nincs.
 */
export const SZOLGALTATASOK_HERO_FORRAS: MediaForras = {
  filename: 'treatment-table-hands-1600.webp',
  filePath: 'public/media/team/treatment-table-hands-1600.webp',
  alt: 'Csuklókezelés a kezelőasztalon a Kineticare rendelőjében.',
}

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
  | 'howitworks-vasarlas-gondolatjel'
  | 'kurzus-lead-gondolatjel'
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
  | 'kezdolap-rolunk-szoveg'
  | 'bemutatkozas-szetvalasztas'
  | 'sos-publikalas'
  | 'szakmai-menupont'
  | 'kezdolap-segitseg-sorrend'
  | 'kezdolap-sajtologo-sorrend'
  | 'kezdolap-bemutatkozas-rovid'
  | 'rolunk-partner-mondat'
  | 'rolunk-logosavok-sorrend'
  | 'sos-galeria'
  | 'media-alt-szoveg'
  | 'szolgaltatasok-technikak-tabla'

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

/**
 * Egy repó-fájlból biztosítandó média leírása (WP54).
 *
 * A `filename` a Médiatárban elvárt PONTOS fájlnév (webp forrásnál a Payload
 * változatlanul tartja meg), a `filePath` a forrás a repóban, a futtatás
 * gyökeréhez (a repó gyökere) képest.
 */
export interface MediaForras {
  filename: string
  filePath: string
  alt: string
}

/**
 * Egy jóváhagyott kép állapota a döntéshez: a Médiatárban meglévő rekord
 * azonosítója (vagy `null`, ha még nincs), és hogy a repó-forrásfájl
 * létezik-e (ha nincs rekord ÉS nincs forrás, a lépés hangosan kimarad).
 */
export interface UjMediaAllapot {
  filename: string
  id: number | null
  forrasLetezik: boolean
}

/** A /rolunk fejléc-kép cseréjének eredménye. */
export interface HeroKepAtalakitas {
  /**
   * A beírandó média-azonosító, vagy `null`, ha nem szabad írni — VAGY ha a
   * kép még nincs a Médiatárban (ilyenkor a `modositasok` nem üres, és a
   * futtató a rekord létrehozása után tölti ki az azonosítót).
   */
  heroImage: number | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/** A kurzus-galéria (products.gallery) átalakításának eredménye. */
export interface GaleriaAtalakitas {
  /**
   * A beírandó sorok, vagy `null`, ha nem szabad írni — VAGY ha valamelyik kép
   * még nincs a Médiatárban (a `modositasok` ilyenkor sem üres; a futtató a
   * rekordok létrehozása után állítja össze a sorokat).
   */
  gallery: NonNullable<Product['gallery']> | null
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

/**
 * Élő kezdőlap: az „Így működik" vásárlás-lépésének U+2014 tölteléke.
 *
 * SZIGORÚ EGYEZÉS a 2026-09-06-án mért production mondatra. A seed már vesszős;
 * a CMS-t `ensureHomeLayout` nem írja felül. Más lépésszöveget nem nyúlunk.
 */
export const alkalmazHowItWorksGondolatjel = (
  layout: Szekciosor | null | undefined,
): SzekciosorCsere => {
  const uzenet = 'Az „Így működik” vásárlás-lépésének gondolatjele'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'howitworks-vasarlas-gondolatjel', uzenet, indok, hangos }],
  })

  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a kezdőlapnak nincs szekciósora — a lépést nincs hol átírni')
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltHowItWorks = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'howItWorks') {
      return blokk
    }
    voltHowItWorks = true
    const helye = `${index + 1}. szekció`
    const lepesek = blokk.steps
    if (!Array.isArray(lepesek) || lepesek.length === 0) {
      kihagyasok.push({
        szabaly: 'howitworks-vasarlas-gondolatjel',
        uzenet: `${uzenet} (${helye})`,
        indok: 'a szekciónak nincs lépése — a script üres mezőt nem tölt ki',
      })
      return blokk
    }

    let valtozott = false
    const ujLepesek = lepesek.map((lepes, lepesIndex) => {
      if (lepes.text !== HOW_IT_WORKS_STEP1_LEFTOVER) {
        return lepes
      }
      valtozott = true
      modositasok.push({
        szabaly: 'howitworks-vasarlas-gondolatjel',
        uzenet: `${uzenet} (${helye}, ${lepesIndex + 1}. lépés): ${ertekCimke(
          HOW_IT_WORKS_STEP1_LEFTOVER,
        )} → ${ertekCimke(HOW_IT_WORKS_STEP1_FIXED)}`,
        indok: null,
      })
      return { ...lepes, text: HOW_IT_WORKS_STEP1_FIXED }
    })

    if (valtozott) {
      return { ...blokk, steps: ujLepesek }
    }

    const marJavitva = lepesek.some((lepes) => lepes.text === HOW_IT_WORKS_STEP1_FIXED)
    kihagyasok.push({
      szabaly: 'howitworks-vasarlas-gondolatjel',
      uzenet: `${uzenet} (${helye})`,
      indok: marJavitva
        ? `a vásárlás-lépés MÁR ${ertekCimke(HOW_IT_WORKS_STEP1_FIXED)} — nincs teendő`
        : `egyetlen lépésszöveg sem PONTOSAN a cserélendő ${ertekCimke(
            HOW_IT_WORKS_STEP1_LEFTOVER,
          )} — a script csak pontos egyezésnél ír át`,
    })
    return blokk
  })

  if (!voltHowItWorks) {
    return kihagyas(
      'a kezdőlap szekciósorában nincs Így működik (howItWorks) szekció — a lépést nincs hol átírni',
    )
  }

  return { layout: modositasok.length > 0 ? ujLayout : null, modositasok, kihagyasok }
}

/**
 * Élő Otthoni KézRehab kurzuskártya-lead: U+2013 a „gyógytornászoktól" után.
 *
 * SZIGORÚ EGYEZÉS a 2026-09-06-án mért production mondatra. A hyphen a
 * „csukló-, ujj-" szóösszetételben megmarad (AkH. kiskötőjel).
 */
export const alkalmazKurzusLeadGondolatjel = (
  jelenlegi: Product['shortDescription'] | undefined,
): {
  shortDescription: string | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
} => {
  const uzenet = `Kurzus rövid leírása („${KURZUS_SKU}”)`

  if (jelenlegi === COURSE_SHORT_DESCRIPTION_LEFTOVER) {
    return {
      shortDescription: COURSE_SHORT_DESCRIPTION_FIXED,
      modositasok: [
        {
          szabaly: 'kurzus-lead-gondolatjel',
          uzenet: `${uzenet}: ${ertekCimke(COURSE_SHORT_DESCRIPTION_LEFTOVER)} → ${ertekCimke(
            COURSE_SHORT_DESCRIPTION_FIXED,
          )}`,
          indok: null,
        },
      ],
      kihagyasok: [],
    }
  }

  if (jelenlegi === COURSE_SHORT_DESCRIPTION_FIXED) {
    return {
      shortDescription: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'kurzus-lead-gondolatjel',
          uzenet,
          indok: `a rövid leírás MÁR ${ertekCimke(COURSE_SHORT_DESCRIPTION_FIXED)} — nincs teendő`,
        },
      ],
    }
  }

  return {
    shortDescription: null,
    modositasok: [],
    kihagyasok: [
      {
        szabaly: 'kurzus-lead-gondolatjel',
        uzenet,
        indok: `a jelenlegi rövid leírás ${ertekCimke(
          jelenlegi,
        )}, ami nem PONTOSAN a cserélendő ${ertekCimke(
          COURSE_SHORT_DESCRIPTION_LEFTOVER,
        )} — a script csak pontos egyezésnél ír át`,
      },
    ],
  }
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
 * Egy oldal fejléc-képének (`pages.heroImage`) tiszta átalakítása — a
 * /rolunk (4. javítás) és a /szolgaltatasok (12a. javítás, WP55-től) KÖZÖS
 * magja. Oldalanként EGYETLEN szabály él a mezőre.
 *
 * A jelenlegi kép FÁJLNEVÉT és az új kép állapotát a HÍVÓ deríti ki (a
 * Médiatárból); ez a függvény már csak a döntést hozza meg, adatbázis nélkül.
 *
 * VÉDŐFELTÉTELEK:
 *  - ha a mező MÁR az új képre mutat, nincs teendő (idempotencia);
 *  - ha az új kép nincs a Médiatárban ÉS a repó-forrásfájl is hiányzik, a
 *    lépés HANGOSAN kimarad;
 *  - üres mező vagy a script/seed korábbi képe (`korabbiPrefixek`) → csere;
 *  - minden más kép a szerkesztőé: HANGOS kihagyás (szerkesztői elsőbbség),
 *    ahogy a nem található média-rekordra mutató mező is.
 */
const alkalmazFejlecKep = (input: {
  szabaly: JavitasSzabaly
  /** Az oldal címkéje a naplóhoz (pl. „/rolunk”). */
  oldalCimke: string
  /** Az új kép rövid neve a naplóhoz (pl. „stúdiófotó”). */
  ujKepCimke: string
  /** Az új kép forrása (a hangos kihagyás a forrásútvonalat írja ki). */
  forras: MediaForras
  /** A script/seed KORÁBBI képeinek fájlnév-prefixei — csak ezek cserélhetők. */
  korabbiPrefixek: readonly string[]
  /** Az oldal jelenlegi `heroImage` értéke. */
  jelenlegi: Page['heroImage']
  /**
   * A jelenlegi kép fájlneve a Médiatárból; `null`, ha nincs kép, vagy a
   * hivatkozott rekord nem található.
   */
  jelenlegiFajlnev: string | null
  /** Az új kép állapota (meglévő azonosító és/vagy forrásfájl). */
  ujMedia: UjMediaAllapot
}): HeroKepAtalakitas => {
  const { szabaly, oldalCimke, ujKepCimke, forras, korabbiPrefixek, jelenlegi, ujMedia } = input
  const { jelenlegiFajlnev } = input
  const jelenlegiId = heroKepAzonosito(jelenlegi)
  const uzenet = `A ${oldalCimke} oldal fejléc-képe`

  const kihagyas = (indok: string, hangos = false): HeroKepAtalakitas => ({
    heroImage: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok, hangos }],
  })

  if (
    jelenlegiId !== null &&
    ((ujMedia.id !== null && jelenlegiId === ujMedia.id) || jelenlegiFajlnev === ujMedia.filename)
  ) {
    return kihagyas(
      `a fejléc-kép MÁR a ${ujKepCimke} („${ujMedia.filename}”, azonosító: ${jelenlegiId}) — nincs teendő`,
    )
  }

  if (ujMedia.id === null && !ujMedia.forrasLetezik) {
    return kihagyas(
      `a ${ujKepCimke} („${ujMedia.filename}”) nincs a Médiatárban, és a repó-forrásfájl (${forras.filePath}) sem található — a fejléc-kép érintetlen marad`,
      true,
    )
  }

  if (jelenlegiId !== null && jelenlegiFajlnev === null) {
    return kihagyas(
      `a fejléc-kép egy nem található média-rekordra mutat (azonosító: ${jelenlegiId}) — kézi átnézés kell, a script nem találgat`,
      true,
    )
  }

  if (
    jelenlegiId !== null &&
    jelenlegiFajlnev !== null &&
    !korabbiPrefixek.some((prefix) => jelenlegiFajlnev.startsWith(prefix))
  ) {
    return kihagyas(
      `a fejléc-kép a szerkesztő által választott kép („${jelenlegiFajlnev}”, azonosító: ${jelenlegiId}), nem a script korábbi képe (${korabbiPrefixek
        .map((prefix) => `„${prefix}…”`)
        .join(', ')}) — szerkesztői elsőbbség, a script nem ír felül`,
      true,
    )
  }

  const honnan =
    jelenlegiId === null
      ? 'üres mező'
      : `korábbi kép („${jelenlegiFajlnev ?? ''}”, azonosító: ${jelenlegiId})`
  const hova =
    ujMedia.id === null
      ? `${ujKepCimke} („${ujMedia.filename}”, a rekordot a script a repó fájljából hozza létre)`
      : `${ujKepCimke} („${ujMedia.filename}”, azonosító: ${ujMedia.id})`

  return {
    heroImage: ujMedia.id,
    modositasok: [{ szabaly, uzenet: `${uzenet}: ${honnan} → ${hova}`, indok: null }],
    kihagyasok: [],
  }
}

/** A fejléc-kép szabályok közös bemenete (a futtató oldja fel a Médiatárból). */
export interface FejlecKepBemenet {
  /** Az oldal jelenlegi `heroImage` értéke. */
  jelenlegi: Page['heroImage']
  /** A jelenlegi kép fájlneve; `null`, ha nincs kép, vagy a rekord nem található. */
  jelenlegiFajlnev: string | null
  /** Az új kép állapota (meglévő azonosító és/vagy forrásfájl). */
  ujMedia: UjMediaAllapot
}

/**
 * 4. javítás (WP54-től a stúdiófotóra) — a /rolunk fejléc-képe. A korábbi
 * célok (szóló portré, `katak-team` páros fotó) itt „korábbi” képek
 * (`ROLUNK_HERO_KORABBI_PREFIXEK`), nem külön szabály. A döntés:
 * `alkalmazFejlecKep`.
 */
export const alkalmazRolunkHeroKep = (input: FejlecKepBemenet): HeroKepAtalakitas =>
  alkalmazFejlecKep({
    ...input,
    szabaly: 'rolunk-hero-kep',
    oldalCimke: '/rolunk',
    ujKepCimke: 'stúdiófotó',
    forras: ROLUNK_HERO_FORRAS,
    korabbiPrefixek: ROLUNK_HERO_KORABBI_PREFIXEK,
  })

/**
 * 12a. javítás (WP55) — a /szolgaltatasok fejléc-képe: a kezelőasztalos
 * csuklókezelés-fotó (`SZOLGALTATASOK_HERO_FORRAS`), hogy a lap fejléce a
 * /rolunk párosított alakját kaphassa (cím + bevezető balra, fotó jobbra).
 * A korábbi ürítő szabály megszűnt: az örökölt rendelő-fotó
 * (`SZOLGALTATASOK_HERO_PREFIX`) és az üres mező cserélhető, minden más a
 * szerkesztőé. A döntés: `alkalmazFejlecKep`.
 */
export const alkalmazSzolgaltatasokHeroKep = (input: FejlecKepBemenet): HeroKepAtalakitas =>
  alkalmazFejlecKep({
    ...input,
    szabaly: 'szolgaltatasok-hero-kep',
    oldalCimke: '/szolgaltatasok',
    ujKepCimke: 'kezelőasztalos fotó',
    forras: SZOLGALTATASOK_HERO_FORRAS,
    korabbiPrefixek: [SZOLGALTATASOK_HERO_PREFIX],
  })

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
      .map(
        (kulcs) =>
          `${JSON.stringify(kulcs)}:${stabilJson((ertek as Record<string, unknown>)[kulcs])}`,
      )
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
      blokk.blockType === 'accordion' && blokk.sectionSettings?.anchorId === SZAKMAI_HATTER_HORGONY,
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
      typeof gyerek === 'object' &&
      gyerek !== null &&
      typeof (gyerek as { text?: unknown }).text === 'string'
        ? (gyerek as { text: string }).text
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
  const alap = typeof elsoGyerek === 'object' && elsoGyerek !== null ? (elsoGyerek as object) : {}
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
// WP18b — az SOS villámkurzus PUBLIKÁLÁSA a Payload verziózás szerint.
// ---------------------------------------------------------------------------

/** Az SOS kurzus publikálás-lépésének eredménye. */
export interface SosPublikalasAtalakitas {
  /** `true`, ha a legutóbbi piszkozatot publikálni kell; `false`, ha nem szabad írni. */
  publikal: boolean
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * Az SOS villámkurzus publikálása a Payload drafts szerint (`_status:
 * 'published'`, `draft: false`), KIZÁRÓLAG akkor, ha
 *  - a termék SAJÁT `status` mezője 'published' (a storefront erre szűr),
 *  - `priceInHUFEnabled === false` (a kurzus ingyenes — ezt a 13. javítás
 *    biztosítja, tehát ez a lépés utána fut),
 *  - és a `_status` (a `draft: true`-val olvasott, LEGUTÓBBI verzió) nem
 *    'published': élesben a publikált termék FÖLÖTT piszkozat áll, ezért az
 *    anonim API a friss adatot nem adja vissza, és a kezdőlap rácsa nem
 *    mutatja az ingyenes SOS-t (KOR3 hiánylista, 2026-09-07).
 * Minden más eset indokolt kihagyás; a hiányzó `_status` (verziózás nélkül
 * mentett rekord) is publikálható, mert a mező üres, nem 'published'.
 * A hívó a rekordot `draft: true`-val olvassa, különben a `_status` mindig
 * a publikált verzióé lenne, és a piszkozat sosem látszana.
 */
export const alkalmazSosPublikalas = (
  termek: Pick<Product, 'status' | 'priceInHUFEnabled' | '_status'>,
): SosPublikalasAtalakitas => {
  const uzenet = `Az SOS kurzus publikálása („${SOS_KURZUS_SLUG}”)`
  const kihagyas = (indok: string): SosPublikalasAtalakitas => ({
    publikal: false,
    modositasok: [],
    kihagyasok: [{ szabaly: 'sos-publikalas', uzenet, indok }],
  })

  if (termek.status !== 'published') {
    return kihagyas(
      `a kurzus saját státusza ${ertekCimke(termek.status)}, nem „published” — a script csak a szerkesztő által közzétettnek jelölt kurzust publikálja`,
    )
  }
  if (termek.priceInHUFEnabled !== false) {
    return kihagyas(
      'a kurzus nincs ingyenesként jelölve (priceInHUFEnabled nem false) — előbb a 13. javításnak kell lefutnia',
    )
  }
  if (termek._status === 'published') {
    return kihagyas('a legutóbbi verzió MÁR publikált — nincs teendő')
  }

  return {
    publikal: true,
    modositasok: [
      {
        szabaly: 'sos-publikalas',
        uzenet: `${uzenet}: a legutóbbi verzió ${ertekCimke(
          termek._status,
        )} → „published”. Enélkül a publikált termék fölött piszkozat áll, az anonim API a friss adatot nem adja, és a kezdőlap rácsából hiányzik az ingyenes SOS.`,
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
      ? {
          ...elem,
          sectionSettings: { ...elem.sectionSettings, anchorId: CLINIC_TREATMENTS_ANCHOR },
        }
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
// ---------------------------------------------------------------------------
// WP18 — a kezdőlapi Rólunk-blokk szövege a /rolunk lappal közös forrásra.
// ---------------------------------------------------------------------------

/** A kezdőlapi Rólunk-blokk ÚJ szövege (cím, bekezdések, kiemelés) — a seed-builderből. */
export type RolunkSzoveg = Pick<SzekcioTipus<'about'>, 'title' | 'paragraphs' | 'feature'>

/**
 * A kezdőlapi Rólunk-blokk jóváhagyott ÚJ szövege a seed-builderből, vagy
 * `null`, ha a builder alakja elcsúszott (nincs pontosan egy About-blokk,
 * vagy nincs benne cím és bekezdés).
 */
export const kezdolapRolunkUjSzoveg = (): RolunkSzoveg | null => {
  const blokk = kezdolapSeedBlokk('about')
  if (blokk === null) return null
  const title = blokk.title
  const paragraphs = blokk.paragraphs ?? []
  if (typeof title !== 'string' || title.trim().length === 0 || paragraphs.length === 0) {
    return null
  }
  return { title, paragraphs, feature: blokk.feature }
}

/**
 * WP18 — a kezdőlapi Rólunk-blokk címének, bekezdéseinek és kiemelésének
 * cseréje a /rolunk lappal KÖZÖS bemutatkozásra (tulajdonosi kérés,
 * 2026-09-07: „a főoldalon a rólunk rész legyen olyan, mint a rólunk
 * menüpont alatt").
 *
 * VÉDŐFELTÉTELEK:
 *  - csere KIZÁRÓLAG akkor, ha a blokk címe PONTOSAN a régi seedelt cím
 *    (`REGI_KEZDOLAP_ROLUNK_CIM`); szerkesztett cím a szerkesztőé, érintetlen;
 *  - ha a cím MÁR az új, nincs teendő (idempotencia);
 *  - a statisztikasor, a fotó, az eyebrow, az azonosító és a sávbeállítás
 *    NEM változik: csak a három szöveges mező cserélődik;
 *  - a bekezdések sorazonosítói nem öröklődnek (a Payload újakat ad; a régi
 *    négy sor helyett két új sor jön, az id-k párosítása értelmetlen);
 *  - hiányzó seed-alak vagy üres szekciósor: HANGOS, illetve indokolt kihagyás.
 */
export const alkalmazKezdolapRolunkSzoveg = (input: {
  layout: Page['layout']
  ujSzoveg: RolunkSzoveg | null
}): SzekciosorCsere => {
  const { layout, ujSzoveg } = input
  const uzenet = 'A kezdőlap Rólunk-blokkjának szövege (cím, bekezdések, kiemelés)'

  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly: 'kezdolap-rolunk-szoveg', uzenet, indok, hangos }],
  })

  if (ujSzoveg === null) {
    return kihagyas(
      'a kezdőlap seed-buildere (buildHomeLayout) nem ad pontosan egy, címmel és bekezdésekkel álló Rólunk-blokkot — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a kezdőlapnak nincs szekciósora — a Rólunk-blokkot nincs hol átírni')
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltRolunk = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'about') {
      return blokk
    }
    voltRolunk = true
    const helye = `${index + 1}. szekció`
    const jelenlegi = blokk.title

    if (typeof jelenlegi === 'string' && REGI_KEZDOLAP_ROLUNK_CIMEK.includes(jelenlegi)) {
      modositasok.push({
        szabaly: 'kezdolap-rolunk-szoveg',
        uzenet: `${uzenet} (${helye}): ${ertekCimke(jelenlegi)} → ${ertekCimke(
          ujSzoveg.title,
        )}, ${ujSzoveg.paragraphs?.length ?? 0} bekezdés, kiemelés: ${ertekCimke(
          ujSzoveg.feature?.label,
        )}`,
        indok: null,
      })
      return {
        ...blokk,
        title: ujSzoveg.title,
        paragraphs: (ujSzoveg.paragraphs ?? []).map(({ text, emphasized }) => ({
          text,
          emphasized,
        })),
        feature: ujSzoveg.feature,
      }
    }

    if (jelenlegi === ujSzoveg.title) {
      kihagyasok.push({
        szabaly: 'kezdolap-rolunk-szoveg',
        uzenet: `${uzenet} (${helye})`,
        indok: `a cím MÁR ${ertekCimke(ujSzoveg.title)} — nincs teendő`,
      })
      return blokk
    }

    kihagyasok.push({
      szabaly: 'kezdolap-rolunk-szoveg',
      uzenet: `${uzenet} (${helye})`,
      indok: `a jelenlegi cím ${ertekCimke(jelenlegi)}, ami nem PONTOSAN a cserélendő ${ertekCimke(
        REGI_KEZDOLAP_ROLUNK_CIM,
      )} — a script csak pontos egyezésnél ír át`,
    })
    return blokk
  })

  if (!voltRolunk) {
    kihagyasok.push({
      szabaly: 'kezdolap-rolunk-szoveg',
      uzenet,
      indok: 'a kezdőlap szekciósorában nincs Rólunk (about) szekció — a szöveget nincs hol átírni',
    })
  }

  // Egy bemutatkozás egy lapon: ha a csere után több LÁTHATÓ About-blokk is a
  // közös címet viseli, az ELSŐ marad (a filmsáv utáni alapítói szekció, a
  // fotó-frízzel), a későbbi duplikátumok rejtett szekcióvá válnak. A blokk
  // nem törlődik (a szerkesztő az adminban visszakapcsolhatja); NN/g Common
  // Region: egy tartalmi egység egyszer (https://www.nngroup.com/articles/common-region/).
  let elsoKozos = -1
  const vegleges: Szekciosor = ujLayout.map((blokk, index) => {
    if (blokk.blockType !== 'about' || blokk.title !== ujSzoveg.title) return blokk
    if (blokk.sectionSettings?.visible === false) return blokk
    if (elsoKozos === -1) {
      elsoKozos = index
      return blokk
    }
    modositasok.push({
      szabaly: 'kezdolap-rolunk-szoveg',
      uzenet: `${uzenet} (${index + 1}. szekció): a közös bemutatkozás már a ${
        elsoKozos + 1
      }. szekcióban áll, ezért ez a duplikált Rólunk-blokk rejtett szekció lett`,
      indok: null,
    })
    return { ...blokk, sectionSettings: { ...blokk.sectionSettings, visible: false } }
  })

  return { layout: modositasok.length > 0 ? vegleges : null, modositasok, kihagyasok }
}

// ---------------------------------------------------------------------------
// WP37 — a kezdőlapi és a /rolunk bemutatkozás SZÉTVÁLASZTÁSA.
// ---------------------------------------------------------------------------

/** Melyik lap About-blokkja kapja a saját bemutatkozását. */
export type BemutatkozasLap = 'kezdolap' | 'rolunk'

/** A lap ÚJ bemutatkozása (cím, bekezdések, kiemelés) a közös szövegforrásból. */
export const bemutatkozasUjSzoveg = (lap: BemutatkozasLap): RolunkSzoveg =>
  lap === 'kezdolap' ? kezdolapBemutatkozasSzoveg() : rolunkBemutatkozasSzoveg()

const bekezdesSzovegek = (blokk: SzekcioTipus<'about'>): string[] =>
  (blokk.paragraphs ?? []).map((sor) => sor.text)

const ugyanazokABekezdesek = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((szoveg, index) => szoveg === b[index])

/**
 * WP37 — a kezdőlap és a /rolunk About-blokkja SAJÁT szöveget kap
 * (tulajdonosi kérés, 2026-09-08: a kezdőlapon „több információ a lányokról”,
 * a Rólunk-on a menüpontra fókuszáló szöveg). A WP18-as közös szöveg
 * (`WP18_KOZOS_BEMUTATKOZAS`) mindkét lapon szóról szóra ugyanaz volt.
 *
 * VÉDŐFELTÉTELEK:
 *  - csere KIZÁRÓLAG akkor, ha a blokk címe ÉS minden bekezdése PONTOSAN a
 *    WP18-as közös szöveg (a ma élő állapot); szerkesztett cím vagy bekezdés a
 *    szerkesztőé, érintetlen (indokolt kihagyás);
 *  - ha a blokk MÁR a lap saját szövegét viseli, nincs teendő (idempotencia);
 *  - a statisztikasor, a fotó, az eyebrow, az azonosító és a sávbeállítás NEM
 *    változik: csak a cím, a bekezdések és a kiemelés cserélődik; a bekezdések
 *    sorazonosítói nem öröklődnek (a Payload újakat ad);
 *  - rejtett (visible: false) blokkhoz nem nyúl: a kezdőlapon a WP18 által
 *    elrejtett duplikátum rejtett marad;
 *  - üres szekciósor vagy About nélküli lap: indokolt kihagyás.
 */
export const alkalmazBemutatkozasSzetvalasztas = (input: {
  lap: BemutatkozasLap
  layout: Page['layout']
}): SzekciosorCsere => {
  const { lap, layout } = input
  const ujSzoveg = bemutatkozasUjSzoveg(lap)
  const ujBekezdesek = (ujSzoveg.paragraphs ?? []).map((sor) => sor.text)
  const lapCimke = lap === 'kezdolap' ? 'A kezdőlap' : 'A Rólunk oldal'
  const uzenet = `${lapCimke} bemutatkozásának saját szövege (cím, bekezdések, kiemelés)`
  const szabaly: JavitasSzabaly = 'bemutatkozas-szetvalasztas'

  if (!Array.isArray(layout) || layout.length === 0) {
    return {
      layout: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly,
          uzenet,
          indok: `${lapCimke.toLowerCase()}nak nincs szekciósora — a bemutatkozást nincs hol átírni`,
        },
      ],
    }
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltAbout = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'about') return blokk
    if (blokk.sectionSettings?.visible === false) return blokk
    voltAbout = true
    const helye = `${index + 1}. szekció`
    const jelenlegiCim = blokk.title ?? ''
    const jelenlegiBekezdesek = bekezdesSzovegek(blokk)

    if (
      jelenlegiCim === ujSzoveg.title &&
      ugyanazokABekezdesek(jelenlegiBekezdesek, ujBekezdesek)
    ) {
      kihagyasok.push({
        szabaly,
        uzenet: `${uzenet} (${helye})`,
        indok: `a blokk MÁR a lap saját bemutatkozását viseli (${ertekCimke(ujSzoveg.title)}) — nincs teendő`,
      })
      return blokk
    }

    const wp18Egyezik =
      jelenlegiCim === WP18_KOZOS_BEMUTATKOZAS.title &&
      ugyanazokABekezdesek(jelenlegiBekezdesek, WP18_KOZOS_BEMUTATKOZAS.paragraphs)
    // A Rólunk első éles változata (V1, Semmelweis-mondat nélkül) is ismert
    // forrás: a tulajdonos ugyanaznap kérte bele a mondatot.
    const rolunkV1Egyezik =
      lap === 'rolunk' &&
      jelenlegiCim === ROLUNK_BEMUTATKOZAS_V1.title &&
      ugyanazokABekezdesek(jelenlegiBekezdesek, ROLUNK_BEMUTATKOZAS_V1.paragraphs)
    if (!wp18Egyezik && !rolunkV1Egyezik) {
      kihagyasok.push({
        szabaly,
        uzenet: `${uzenet} (${helye})`,
        indok: `a blokk címe (${ertekCimke(jelenlegiCim)}) vagy bekezdései nem PONTOSAN a WP18-as közös bemutatkozás (Rólunk esetén az első saját változat sem) — a szerkesztő szövegéhez a script nem nyúl`,
      })
      return blokk
    }

    modositasok.push({
      szabaly,
      uzenet: `${uzenet} (${helye}): ${ertekCimke(jelenlegiCim)} → ${ertekCimke(ujSzoveg.title)}, ${ujBekezdesek.length} bekezdés, kiemelés: ${ertekCimke(ujSzoveg.feature?.label)}`,
      indok: null,
    })
    return {
      ...blokk,
      title: ujSzoveg.title,
      paragraphs: (ujSzoveg.paragraphs ?? []).map(({ text, emphasized }) => ({ text, emphasized })),
      feature: ujSzoveg.feature,
    }
  })

  if (!voltAbout) {
    kihagyasok.push({
      szabaly,
      uzenet,
      indok: `${lapCimke.toLowerCase()} szekciósorában nincs látható Rólunk (about) szekció — a bemutatkozást nincs hol átírni`,
    })
  }

  return { layout: modositasok.length > 0 ? ujLayout : null, modositasok, kihagyasok }
}

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
// 12. javítás — a /szolgaltatasok oldal teteje: az örökölt bevezető blokk
// cseréje üdvözlő (welcome) blokkra. (A 12a. fejléc-kép szabály a 4. javítás
// mellett él, `alkalmazSzolgaltatasokHeroKep`.)
// ---------------------------------------------------------------------------

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
 * Prefix és futásidejű feloldás (`keresdMediat`): a Média
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

/**
 * A technikák-tábla azonosító címe (WP54/4); ezzel ismeri fel a script a már
 * beszúrt blokkot, és ezzel zárja ki a 19b szabály a jelöltek közül (a tábla
 * is `services` blokk, de saját képe van — nélküle a második futás hangosan
 * „2 szolgáltatás-szekció áll” kihagyást adna, ami az idempotencia ígéretét
 * sértené).
 */
export const TECHNIKAK_TABLA_CIM = 'Amit a rendelőben kínálunk'

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

  // A WP54/4 technikák-tábla is `services` blokk, de a script maga szúrja be
  // saját képpel: a jelöltek közül kimarad, hogy a tábla után is EGY
  // szolgáltatás-szekció álljon a döntés előtt (idempotens második futás).
  const indexek = layout
    .map((blokk, index) =>
      blokk.blockType === 'services' && blokk.title !== TECHNIKAK_TABLA_CIM ? index : -1,
    )
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
// WP52 — a tulajdonosi kérések CMS-adat oldala (2026-09-19): a „Szakmai
// képzés” menüpont, a kezdőlap szekció-sorrendje, a bemutatkozás rövidítése,
// a /rolunk két logósávja és a partner-mondat.
// ---------------------------------------------------------------------------

/** A „Szakmai képzés” menüpont RÉGI feliratai; kizárólag pontosan ezek cserélhetők. */
export const SZAKMAI_MENUPONT_REGI_FELIRATOK: readonly string[] =
  LEGACY_PROFESSIONAL_TRAINING_MENU_LABELS

/** A menüpont jóváhagyott ÚJ felirata. */
export const SZAKMAI_MENUPONT_UJ_FELIRAT = 'Szakembereknek'

/** A menüpont ÚJ, belső célja (kód-útvonal, külön munkacsomag készíti). */
export const SZAKEMBEREKNEK_UTVONAL = '/szakembereknek'

/** A menüpont-csere eredménye: a beírandó mezők, vagy `null`, ha nem szabad írni. */
export interface MenupontAtalakitas {
  adat: Pick<Menu, 'label' | 'type' | 'url' | 'openInNewTab'> | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * WP52/1 — a „Szakmai képzés” menüpont átnevezése „Szakembereknek”-re, belső
 * `/szakembereknek` céllal.
 *
 * VÉDŐFELTÉTELEK:
 *  - csere KIZÁRÓLAG akkor, ha a felirat PONTOSAN a régi („Szakmai képzés”
 *    vagy „Szakmai képzések”), a típus „Külső link”, és a cél PONTOSAN a
 *    ProBody-workshop címe (`PROFESSIONAL_TRAINING_URL`);
 *  - ha a felirat és a cél MÁR az új, nincs teendő (idempotencia);
 *  - minden más (szerkesztett felirat, más cél, más típus) a szerkesztőé:
 *    indokolt kihagyás;
 *  - belső útvonalra visz, ezért az „új lapon nyíljon” kapcsolót kikapcsolja
 *    (belső lapnál a látogató munkamenete nem szakad meg; a NavAnchor a
 *    kapcsolóból adja a target="_blank"-ot).
 *
 * A futtató a Menus collection MINDEN, a régi URL-re mutató sorára lefuttatja
 * (a fejléc almenüje és egy esetleges másolat is). Lábléc-menü collection
 * ebben a repóban nincs: a lábléc a kódból épül, nem CMS-menüből.
 */
export const alkalmazSzakmaiMenupont = (
  menupont: Pick<Menu, 'id' | 'label' | 'type' | 'url' | 'openInNewTab'>,
): MenupontAtalakitas => {
  const szabaly: JavitasSzabaly = 'szakmai-menupont'
  const uzenet = `A „Szakmai képzés” menüpont (menus #${menupont.id})`
  const kihagyas = (indok: string): MenupontAtalakitas => ({
    adat: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok }],
  })

  if (
    menupont.label === SZAKMAI_MENUPONT_UJ_FELIRAT &&
    menupont.type === 'url' &&
    menupont.url === SZAKEMBEREKNEK_UTVONAL
  ) {
    return kihagyas(
      `a menüpont MÁR ${ertekCimke(SZAKMAI_MENUPONT_UJ_FELIRAT)} → ${SZAKEMBEREKNEK_UTVONAL} — nincs teendő`,
    )
  }
  if (!SZAKMAI_MENUPONT_REGI_FELIRATOK.includes(menupont.label)) {
    return kihagyas(
      `a felirat ${ertekCimke(menupont.label)}, ami nem PONTOSAN a cserélendő ${SZAKMAI_MENUPONT_REGI_FELIRATOK.map(
        ertekCimke,
      ).join(' / ')} — a script csak pontos egyezésnél ír át`,
    )
  }
  if (menupont.type !== 'url' || menupont.url !== PROFESSIONAL_TRAINING_URL) {
    return kihagyas(
      `a cél nem PONTOSAN a ProBody-workshop külső címe (típus: ${menupont.type}, cél: ${ertekCimke(
        menupont.url,
      )}) — a script csak a ${ertekCimke(PROFESSIONAL_TRAINING_URL)} célt cseréli`,
    )
  }

  return {
    adat: {
      label: SZAKMAI_MENUPONT_UJ_FELIRAT,
      type: 'url',
      url: SZAKEMBEREKNEK_UTVONAL,
      openInNewTab: false,
    },
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet}: ${ertekCimke(menupont.label)} → ${ertekCimke(
          SZAKMAI_MENUPONT_UJ_FELIRAT,
        )}, cél ${ertekCimke(menupont.url)} → ${ertekCimke(SZAKEMBEREKNEK_UTVONAL)} (belső útvonal, nem új lapon)`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/** Egy szekció látható-e (a rejtett blokkhoz a sorrend-szabályok nem nyúlnak). */
const lathato = (blokk: Szekciosor[number]): boolean => blokk.sectionSettings?.visible !== false

/**
 * A szekciósor EGYETLEN, látható, a feltételnek megfelelő blokkjának indexe.
 * `-1`, ha nincs ilyen; `-2`, ha több is van (kétértelmű, a script nem
 * találgat).
 */
const egyetlenIndex = (
  layout: Szekciosor,
  feltetel: (blokk: Szekciosor[number]) => boolean,
): number => {
  const indexek = layout.flatMap((blokk, index) =>
    lathato(blokk) && feltetel(blokk) ? [index] : [],
  )
  if (indexek.length === 0) return -1
  if (indexek.length > 1) return -2
  return indexek[0]
}

/** Indokolt kihagyás szövege, ha egy blokk nincs meg vagy többször is megvan. */
const talalatIndok = (leiras: string, index: number): string | null => {
  if (index === -1) return `nincs látható ${leiras} a szekciósorban — a script nem találgat`
  if (index === -2) return `több látható ${leiras} is van a szekciósorban — kézi átnézés kell`
  return null
}

/**
 * Egy blokk áthelyezése egy horgony-blokk ELÉ vagy MÖGÉ — a kezdőlapi
 * sorrend-szabályok közös magja. Tiszta függvény: a bemenetet nem módosítja,
 * a nem érintett blokkok referenciája változatlan. Mindkét blokkot
 * `blockType` + cím alapján, PONTOSAN egyszer kell megtalálni; különben
 * indokolt kihagyás. Ha a blokk már a helyén áll, nincs teendő.
 */
const alkalmazSzekcioAthelyezes = (input: {
  layout: Page['layout']
  szabaly: JavitasSzabaly
  uzenet: string
  mozgatando: { leiras: string; feltetel: (blokk: Szekciosor[number]) => boolean }
  horgony: { leiras: string; feltetel: (blokk: Szekciosor[number]) => boolean }
  hova: 'ele' | 'moge'
}): SzekciosorCsere => {
  const { layout, szabaly, uzenet, mozgatando, horgony, hova } = input
  const kihagyas = (indok: string): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok }],
  })

  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('az oldalnak nincs szekciósora — nincs mit átrendezni')
  }
  const forras = egyetlenIndex(layout, mozgatando.feltetel)
  const forrasIndok = talalatIndok(mozgatando.leiras, forras)
  if (forrasIndok !== null) return kihagyas(forrasIndok)
  const cel = egyetlenIndex(layout, horgony.feltetel)
  const celIndok = talalatIndok(horgony.leiras, cel)
  if (celIndok !== null) return kihagyas(celIndok)

  // A kívánt hely: a horgony előtti, illetve utáni látható SZOMSZÉD. Rejtett
  // blokk közéjük eshet, az a látogató sorrendjét nem érinti.
  const kozteLathato = (a: number, b: number): boolean =>
    layout.slice(Math.min(a, b) + 1, Math.max(a, b)).some(lathato)
  const jelenlegHelyen =
    hova === 'ele'
      ? forras < cel && !kozteLathato(forras, cel)
      : forras > cel && !kozteLathato(cel, forras)
  if (jelenlegHelyen) {
    return kihagyas(
      `a ${mozgatando.leiras} MÁR közvetlenül a ${horgony.leiras} ${
        hova === 'ele' ? 'előtt' : 'után'
      } áll (${forras + 1}. szekció) — nincs teendő`,
    )
  }

  const nelkule = layout.filter((_, index) => index !== forras)
  const ujCel = nelkule.indexOf(layout[cel])
  const beszuras = hova === 'ele' ? ujCel : ujCel + 1
  const ujLayout: Szekciosor = [
    ...nelkule.slice(0, beszuras),
    layout[forras],
    ...nelkule.slice(beszuras),
  ]

  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet}: a ${mozgatando.leiras} a ${forras + 1}. szekcióból a ${
          beszuras + 1
        }. szekcióba került, közvetlenül a ${horgony.leiras} ${hova === 'ele' ? 'elé' : 'mögé'}`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/** A sajtó-logósor felirata a látogatónak: a mező értéke, vagy üresen a beépített felirat. */
const sajtoLogosorFelirat = (heading: string | null | undefined): string =>
  typeof heading === 'string' && heading.trim().length > 0 ? heading : (pressLogosUjFejlec() ?? '')

/**
 * WP52/2a — a kezdőlapon az „Így tudunk segíteni” sín (a `services` blokk,
 * sín-elrendezés: Rendelői kezelések / Otthoni program / Szakmai képzések)
 * a „Kurzusaink” kurzuskártyák ELÉ kerül.
 *
 * Azonosítás: `services` + PONTOSAN a `HOME_HELP_TITLE` cím; `courseCards` +
 * PONTOSAN az `UJ_KURZUS_SZEKCIO_CIM` cím. Ha bármelyik hiányzik vagy több
 * van belőle, indokolt kihagyás. Ha a sín már közvetlenül a kártyák előtt áll,
 * nincs teendő. (A kiírás „states”-ként hivatkozott rá; a `states` blokk a
 * „Három állapot, egy folyamat” kártyasor, a háromsoros Rendelői/Otthoni/
 * Szakmai sín a `services` blokk — src/lib/home-seed.ts, home-help-states.ts.)
 */
export const alkalmazKezdolapSegitsegSorrend = (layout: Page['layout']): SzekciosorCsere =>
  alkalmazSzekcioAthelyezes({
    layout,
    szabaly: 'kezdolap-segitseg-sorrend',
    uzenet: 'A kezdőlap szekció-sorrendje („Így tudunk segíteni” a „Kurzusaink” elé)',
    mozgatando: {
      leiras: `„${HOME_HELP_TITLE}” szolgáltatás-sín (services)`,
      feltetel: (blokk) => blokk.blockType === 'services' && blokk.title === HOME_HELP_TITLE,
    },
    horgony: {
      leiras: `„${UJ_KURZUS_SZEKCIO_CIM}” kurzuskártya-szekció (courseCards)`,
      feltetel: (blokk) =>
        blokk.blockType === 'courseCards' && blokk.heading === UJ_KURZUS_SZEKCIO_CIM,
    },
    hova: 'ele',
  })

/**
 * WP52/2b — a kezdőlapon az „Itt találkozhattál velünk” sajtó-logósor
 * (ÖNÁLLÓ `pressLogos` blokk; az About-blokknak nincs beágyazott logó-mezője,
 * src/blocks/about.ts) közvetlenül a „Megérdemled a profi törődést”
 * About-blokk MÖGÉ kerül.
 *
 * Azonosítás: `pressLogos`, amelynek felirata PONTOSAN a beépített „Itt
 * találkozhattál velünk” (vagy üres, mert akkor a komponens ugyanezt írja ki);
 * `about` + PONTOSAN a kezdőlapi bemutatkozás címe. Rejtett duplikátum (a
 * WP18 által elrejtett About) nem számít.
 */
export const alkalmazKezdolapSajtologoSorrend = (layout: Page['layout']): SzekciosorCsere => {
  const uzenet = 'A kezdőlap szekció-sorrendje (sajtó-logósor a bemutatkozás alá)'
  const sajtoFelirat = pressLogosUjFejlec()
  if (sajtoFelirat === null) {
    return {
      layout: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly: 'kezdolap-sajtologo-sorrend',
          uzenet,
          indok:
            'a kezdőlap seed-buildere (buildHomeLayout) nem ad pontosan egy, feliratos sajtó-logósort — a kód és a javítás szétcsúszott, kézi átnézés kell',
          hangos: true,
        },
      ],
    }
  }
  return alkalmazSzekcioAthelyezes({
    layout,
    szabaly: 'kezdolap-sajtologo-sorrend',
    uzenet,
    mozgatando: {
      leiras: `„${sajtoFelirat}” sajtó-logósor (pressLogos)`,
      feltetel: (blokk) =>
        blokk.blockType === 'pressLogos' && sajtoLogosorFelirat(blokk.heading) === sajtoFelirat,
    },
    horgony: {
      leiras: `„${KEZDOLAP_BEMUTATKOZAS_CIM}” bemutatkozás (about)`,
      feltetel: (blokk) => blokk.blockType === 'about' && blokk.title === KEZDOLAP_BEMUTATKOZAS_CIM,
    },
    hova: 'moge',
  })
}

/**
 * WP52/3 — a kezdőlapi bemutatkozás RÖVIDÍTÉSE (tulajdonosi kérés: „lehetséges
 * a rövidítés? jó lenne, ha a szakmai egyesületi tagság rész a képekkel egy
 * vonalba kerülhetne”). Az új szöveg: `KEZDOLAP_BEMUTATKOZAS_ROVID`
 * (src/lib/rolunk-bemutatkozas.ts, mérésekkel).
 *
 * VÉDŐFELTÉTELEK:
 *  - csere KIZÁRÓLAG akkor, ha a látható About-blokk címe PONTOSAN
 *    `KEZDOLAP_BEMUTATKOZAS_CIM` ÉS minden bekezdése PONTOSAN a mai
 *    `KEZDOLAP_BEMUTATKOZAS` (a WP37 óta élő, tulajdonos által jóváhagyott
 *    szöveg); bármi más a szerkesztőé, indokolt kihagyás;
 *  - ha a blokk MÁR a rövid szöveget viseli, nincs teendő (idempotencia);
 *  - a cím, a kiemelés, a statisztikasor, a fotó és a sávbeállítás NEM
 *    változik: kizárólag a `paragraphs` cserélődik (az első kiemelt marad).
 */
export const alkalmazKezdolapBemutatkozasRovidites = (layout: Page['layout']): SzekciosorCsere => {
  const szabaly: JavitasSzabaly = 'kezdolap-bemutatkozas-rovid'
  const uzenet = 'A kezdőlap bemutatkozásának rövidítése (About-blokk bekezdései)'
  const ujSzoveg = kezdolapBemutatkozasRovidSzoveg()
  const ujBekezdesek = ujSzoveg.paragraphs.map((sor) => sor.text)

  if (!Array.isArray(layout) || layout.length === 0) {
    return {
      layout: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly,
          uzenet,
          indok: 'a kezdőlapnak nincs szekciósora — a bemutatkozást nincs hol rövidíteni',
        },
      ],
    }
  }

  const modositasok: JavitasLepes[] = []
  const kihagyasok: JavitasLepes[] = []
  let voltAbout = false

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (blokk.blockType !== 'about' || !lathato(blokk)) return blokk
    voltAbout = true
    const helye = `${index + 1}. szekció`
    const jelenlegiCim = blokk.title ?? ''
    const jelenlegiBekezdesek = bekezdesSzovegek(blokk)

    if (jelenlegiCim !== KEZDOLAP_BEMUTATKOZAS_CIM) {
      kihagyasok.push({
        szabaly,
        uzenet: `${uzenet} (${helye})`,
        indok: `a blokk címe ${ertekCimke(jelenlegiCim)}, nem PONTOSAN ${ertekCimke(
          KEZDOLAP_BEMUTATKOZAS_CIM,
        )} — a szerkesztő blokkjához a script nem nyúl`,
      })
      return blokk
    }
    if (ugyanazokABekezdesek(jelenlegiBekezdesek, ujBekezdesek)) {
      kihagyasok.push({
        szabaly,
        uzenet: `${uzenet} (${helye})`,
        indok: 'a bekezdések MÁR a rövidített szöveget viselik — nincs teendő',
      })
      return blokk
    }
    if (!ugyanazokABekezdesek(jelenlegiBekezdesek, KEZDOLAP_BEMUTATKOZAS)) {
      kihagyasok.push({
        szabaly,
        uzenet: `${uzenet} (${helye})`,
        indok:
          'a bekezdések nem PONTOSAN a mai, jóváhagyott kezdőlapi bemutatkozás (KEZDOLAP_BEMUTATKOZAS) — a szerkesztő szövegéhez a script nem nyúl',
      })
      return blokk
    }

    modositasok.push({
      szabaly,
      uzenet: `${uzenet} (${helye}): ${jelenlegiBekezdesek.join(' ').length} → ${
        ujBekezdesek.join(' ').length
      } karakter, ${ujBekezdesek.length} bekezdés; a cím, a kiemelés, a számok és a fotó változatlan`,
      indok: null,
    })
    return {
      ...blokk,
      paragraphs: ujSzoveg.paragraphs.map(({ text, emphasized }) => ({ text, emphasized })),
    }
  })

  if (!voltAbout) {
    kihagyasok.push({
      szabaly,
      uzenet,
      indok:
        'a kezdőlap szekciósorában nincs látható Rólunk (about) szekció — a bemutatkozást nincs hol rövidíteni',
    })
  }

  return { layout: modositasok.length > 0 ? ujLayout : null, modositasok, kihagyasok }
}

/**
 * Egy szabad-szöveg (richText) blokk bekezdéseinek sima szövege, ha a tartalom
 * KIZÁRÓLAG szöveges bekezdésekből áll; különben `null` (címsor, lista, link
 * vagy más csomópont esetén a script nem értelmezi a tartalmat, és nem nyúl
 * hozzá).
 */
export const richTextBekezdesek = (blokk: Szekciosor[number]): string[] | null => {
  if (blokk.blockType !== 'richText') return null
  const gyerekek = blokk.content?.root?.children
  if (!Array.isArray(gyerekek)) return null
  const bekezdesek: string[] = []
  for (const csomopont of gyerekek) {
    if (typeof csomopont !== 'object' || csomopont === null) return null
    const { type, children } = csomopont as { type?: unknown; children?: unknown }
    if (type !== 'paragraph' || !Array.isArray(children)) return null
    let szoveg = ''
    for (const gyerek of children) {
      if (typeof gyerek !== 'object' || gyerek === null) return null
      const { type: gyerekTipus, text } = gyerek as { type?: unknown; text?: unknown }
      if (gyerekTipus !== 'text' || typeof text !== 'string') return null
      szoveg += text
    }
    bekezdesek.push(szoveg)
  }
  return bekezdesek
}

// ---------------------------------------------------------------------------
// WP56 — a kurzusborítók alt-szövege (tulajdonosi kérés, 2026-09-19 este:
// „alt image mindenhol van?”). A két packshot a Médiatárban üres alt-tal él,
// ezért a kurzusoldalon és a megosztott képeken nincs leírás. A szabály CSAK
// az üres (vagy csupa szóköz) alt-ot tölti ki; a szerkesztő saját szövegét
// sosem írja felül. WCAG 2.2 SC 1.1.1 Non-text Content
// (https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html);
// W3C WAI Images Tutorial, Informative images
// (https://www.w3.org/WAI/tutorials/images/informative/).
// ---------------------------------------------------------------------------

/** A jóváhagyott alt-szövegek: fájlnév-előtag → alt (a régi oldal médiái). */
export const MEDIA_ALT_SZOVEGEK: readonly { prefix: string; cimke: string; alt: string }[] = [
  {
    prefix: '688b93e6ab76f_Programpackshot',
    cimke: 'Az Otthoni KézRehab Program borítója',
    alt: 'Az Otthoni KézRehab Program borítóképe: a videós gyakorlatok laptopon és telefonon.',
  },
  {
    prefix: '688b873ad2a80_belepotermekpackshot1',
    cimke: 'Az SOS Kézrelax villámkurzus borítója',
    alt: 'Az SOS Kézrelax villámkurzus borítóképe: a videós gyakorlatok laptopon, tableten és telefonon, mellette a nyomtatott üdvözlő lap.',
  },
]

/** Tiszta döntés: üres alt → a jóváhagyott szöveg; minden más érintetlen. */
export const alkalmazMediaAltSzoveg = (input: {
  cimke: string
  jelenlegiAlt: string | null | undefined
  ujAlt: string
}): { alt: string | null; modositasok: JavitasLepes[]; kihagyasok: JavitasLepes[] } => {
  const szabaly: JavitasSzabaly = 'media-alt-szoveg'
  const uzenet = `${input.cimke} alt-szövege`
  const jelenlegi = (input.jelenlegiAlt ?? '').trim()
  if (jelenlegi === input.ujAlt) {
    return {
      alt: null,
      modositasok: [],
      kihagyasok: [{ szabaly, uzenet, indok: 'az alt MÁR a jóváhagyott szöveg — nincs teendő' }],
    }
  }
  if (jelenlegi.length > 0) {
    return {
      alt: null,
      modositasok: [],
      kihagyasok: [
        {
          szabaly,
          uzenet,
          indok: `az alt-ban MÁR VAN szerkesztői szöveg (${ertekCimke(jelenlegi)}) — a script nem írja felül`,
        },
      ],
    }
  }
  return {
    alt: input.ujAlt,
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet}: üres → ${ertekCimke(input.ujAlt)}`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/**
 * WP52/4b — a /rolunk „Partnereink” logósáv ALATTI mondat törlése (tulajdonosi
 * kérés: „a Partnereink alatti szövegre nincs szükségünk”). A mondat a seed
 * `ROLUNK_TOVABBI_PARTNEREK` szövege egy önálló szabad-szöveg (richText)
 * blokkban, közvetlenül a „Partnereink” `pressLogos` sáv után
 * (src/scripts/restore-legacy-content.ts, `rolunkPartnerSzekciok`).
 *
 * VÉDŐFELTÉTELEK:
 *  - törlés KIZÁRÓLAG a „Partnereink” `pressLogos` sáv (látható, pontosan
 *    egyszer szerepel) KÖZVETLENÜL UTÁNI blokkra, és csak akkor, ha annak
 *    tartalma PONTOSAN egyetlen, ezzel a mondattal betűre egyező bekezdés;
 *    ugyanez a mondat a lap MÁS helyén (szerkesztői döntés) érintetlen marad;
 *  - a törölt szöveg a naplóban betűhíven szerepel (nyom nélkül semmi nem
 *    tűnik el);
 *  - ha nincs ilyen blokk (már törölve, vagy a szerkesztő átírta), indokolt
 *    kihagyás (idempotencia).
 */
export const alkalmazRolunkPartnerMondat = (layout: Page['layout']): SzekciosorCsere => {
  const szabaly: JavitasSzabaly = 'rolunk-partner-mondat'
  const uzenet = 'A Rólunk oldal „Partnereink” alatti mondata'
  if (!Array.isArray(layout) || layout.length === 0) {
    return {
      layout: null,
      modositasok: [],
      kihagyasok: [
        { szabaly, uzenet, indok: 'a Rólunk oldalnak nincs szekciósora — nincs mit törölni' },
      ],
    }
  }
  const kihagyas = (indok: string): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok }],
  })
  const partner = egyetlenIndex(
    layout,
    (blokk) => blokk.blockType === 'pressLogos' && blokk.heading === ROLUNK_PARTNER_FELIRAT,
  )
  const partnerIndok = talalatIndok(`„${ROLUNK_PARTNER_FELIRAT}” logósáv (pressLogos)`, partner)
  if (partnerIndok !== null) return kihagyas(partnerIndok)
  const torlendo = partner + 1
  const kovetkezo = layout[torlendo]
  const bekezdesek = kovetkezo === undefined ? null : richTextBekezdesek(kovetkezo)
  if (
    bekezdesek === null ||
    bekezdesek.length !== 1 ||
    bekezdesek[0] !== ROLUNK_TOVABBI_PARTNEREK
  ) {
    return kihagyas(
      `a „${ROLUNK_PARTNER_FELIRAT}” sáv (${
        partner + 1
      }. szekció) után nem olyan szabad-szöveg blokk áll, amelynek tartalma PONTOSAN ${ertekCimke(
        ROLUNK_TOVABBI_PARTNEREK,
      )} — már törölve, vagy a szerkesztő átírta`,
    )
  }
  return {
    layout: layout.filter((_, index) => index !== torlendo),
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet} (${torlendo + 1}. szekció) törölve. A törölt szöveg: ${ertekCimke(
          ROLUNK_TOVABBI_PARTNEREK,
        )}`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/**
 * WP52/4a — a /rolunk két logósávjának sorrendcseréje: a „Partnereink” sáv
 * kerül előre (a sajtó-logósor mai helyére), az „Itt találkozhattál velünk”
 * sajtó-logósor pedig a „Partnereink” mai helyére.
 *
 * VÉDŐFELTÉTELEK:
 *  - mindkét sáv `pressLogos`, PONTOSAN a feliratával azonosítva (a sajtó-
 *    logósornál az üres felirat is számít, mert a komponens ugyanazt írja ki),
 *    mindkettő látható és pontosan egyszer szerepel;
 *  - ha a „Partnereink” MÁR a sajtó-logósor előtt áll, nincs teendő
 *    (idempotencia: a cserét a script nem forgatja vissza);
 *  - ha a „Partnereink” sáv után közvetlenül még ott a partner-mondat
 *    (`alkalmazRolunkPartnerMondat` kihagyott), a csere HANGOSAN kimarad,
 *    különben a mondat a sajtó-logósor alá csúszna.
 */
export const alkalmazRolunkLogosavokSorrend = (layout: Page['layout']): SzekciosorCsere => {
  const szabaly: JavitasSzabaly = 'rolunk-logosavok-sorrend'
  const uzenet =
    'A Rólunk oldal logósávjainak sorrendje („Partnereink” előre, sajtó-logósor a helyére)'
  const kihagyas = (indok: string, hangos = false): SzekciosorCsere => ({
    layout: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok, hangos }],
  })
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a Rólunk oldalnak nincs szekciósora — nincs mit átrendezni')
  }
  const sajtoFelirat = pressLogosUjFejlec()
  if (sajtoFelirat === null) {
    return kihagyas(
      'a kezdőlap seed-buildere (buildHomeLayout) nem ad pontosan egy, feliratos sajtó-logósort — a kód és a javítás szétcsúszott, kézi átnézés kell',
      true,
    )
  }
  const partner = egyetlenIndex(
    layout,
    (blokk) => blokk.blockType === 'pressLogos' && blokk.heading === ROLUNK_PARTNER_FELIRAT,
  )
  const partnerIndok = talalatIndok(`„${ROLUNK_PARTNER_FELIRAT}” logósáv (pressLogos)`, partner)
  if (partnerIndok !== null) return kihagyas(partnerIndok)
  const sajto = egyetlenIndex(
    layout,
    (blokk) =>
      blokk.blockType === 'pressLogos' && sajtoLogosorFelirat(blokk.heading) === sajtoFelirat,
  )
  const sajtoIndok = talalatIndok(`„${sajtoFelirat}” sajtó-logósor (pressLogos)`, sajto)
  if (sajtoIndok !== null) return kihagyas(sajtoIndok)

  if (partner < sajto) {
    return kihagyas(
      `a „${ROLUNK_PARTNER_FELIRAT}” sáv (${partner + 1}. szekció) MÁR a sajtó-logósor (${
        sajto + 1
      }. szekció) előtt áll — nincs teendő`,
    )
  }
  const kovetkezo = layout[partner + 1]
  const kovetkezoBekezdesek = kovetkezo === undefined ? null : richTextBekezdesek(kovetkezo)
  if (kovetkezoBekezdesek !== null && kovetkezoBekezdesek[0] === ROLUNK_TOVABBI_PARTNEREK) {
    return kihagyas(
      'a „Partnereink” sáv alatt még ott a partner-mondat (a törlése kimaradt), ezért a csere nem futott — különben a mondat a sajtó-logósor alá csúszna',
      true,
    )
  }

  const ujLayout: Szekciosor = layout.map((blokk, index) => {
    if (index === partner) return layout[sajto]
    if (index === sajto) return layout[partner]
    return blokk
  })
  return {
    layout: ujLayout,
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet}: a „${ROLUNK_PARTNER_FELIRAT}” sáv a ${partner + 1}. szekcióból a ${
          sajto + 1
        }. szekcióba, a „${sajtoFelirat}” sajtó-logósor a ${sajto + 1}. szekcióból a ${
          partner + 1
        }. szekcióba került`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// WP54 — a tulajdonosi kör 2026-09-19 fotós része: a /rolunk stúdiófotó, az
// SOS galéria és a /szolgaltatasok technikák-táblája. A képeket a script a
// repó fájljaiból maga teszi a Médiatárba (`biztositMediaFajlbol`).
// ---------------------------------------------------------------------------

/** A galéria sorainak média-azonosítói (az üres sorok kimaradnak). */
const galeriaAzonositok = (gallery: Product['gallery']): number[] =>
  (gallery ?? []).flatMap((sor) => {
    const id = heroKepAzonosito(sor.image ?? null)
    return id === null ? [] : [id]
  })

/**
 * WP54/3 — az ingyenes SOS villámkurzus galériája: a három jóváhagyott kép,
 * ebben a sorrendben (`SOS_GALERIA_FORRASOK`).
 *
 * VÉDŐFELTÉTELEK:
 *  - írás KIZÁRÓLAG ÜRES galériába (nincs sor, vagy egyetlen sorban sincs kép);
 *  - ha a galéria MÁR pontosan ezt a három képet tartalmazza ebben a
 *    sorrendben, nincs teendő (idempotencia); ha csak ezekből áll, de más
 *    sorrendben vagy hiányosan, indokolt (nem hangos) kihagyás — a script nem
 *    rendez át és nem egészít ki;
 *  - ha a szerkesztő bármi mást töltött fel, HANGOS kihagyás, nem írunk felül;
 *  - ha valamelyik kép nincs a Médiatárban ÉS a forrásfájl is hiányzik,
 *    HANGOS kihagyás (a galéria csak a teljes hármassal kerül be).
 */
export const alkalmazSosGaleria = (input: {
  jelenlegi: Product['gallery']
  /** A három jóváhagyott kép állapota a `SOS_GALERIA_FORRASOK` sorrendjében. */
  ujMediak: readonly UjMediaAllapot[]
  /** A jelenlegi galéria képeinek fájlnevei a naplóhoz (a futtató oldja fel). */
  ismertFajlnevek?: ReadonlyMap<number, string>
}): GaleriaAtalakitas => {
  const { jelenlegi, ujMediak, ismertFajlnevek } = input
  const szabaly: JavitasSzabaly = 'sos-galeria'
  const uzenet = `Az SOS kurzus galériája („${SOS_COURSE_SKU}”)`
  const kihagyas = (indok: string, hangos = false): GaleriaAtalakitas => ({
    gallery: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok, hangos }],
  })
  const fajlnevLista = ujMediak.map((media) => `„${media.filename}”`).join(', ')
  const jelenlegiIds = galeriaAzonositok(jelenlegi)
  const ujIds = ujMediak.map((media) => media.id)
  const cimke = (id: number): string => {
    const fajlnev = ismertFajlnevek?.get(id)
    return fajlnev === undefined ? `azonosító: ${id}` : `„${fajlnev}”, azonosító: ${id}`
  }

  if (jelenlegiIds.length > 0) {
    const mindenUjMegvan = ujIds.every((id) => id !== null)
    if (
      mindenUjMegvan &&
      jelenlegiIds.length === ujIds.length &&
      jelenlegiIds.every((id, index) => id === ujIds[index])
    ) {
      return kihagyas(
        `a galéria MÁR a három jóváhagyott képet tartalmazza ebben a sorrendben (${fajlnevLista}) — nincs teendő`,
      )
    }
    if (jelenlegiIds.every((id) => ujIds.includes(id))) {
      return kihagyas(
        `a galéria csak a jóváhagyott képekből áll, de más sorrendben vagy hiányosan (${jelenlegiIds
          .map(cimke)
          .join('; ')}) — a script nem rendez át és nem egészít ki`,
      )
    }
    return kihagyas(
      `a galériában a szerkesztő által feltöltött kép van (${jelenlegiIds
        .map(cimke)
        .join('; ')}) — szerkesztői elsőbbség, a script nem ír felül`,
      true,
    )
  }

  const hianyzo = ujMediak.filter((media) => media.id === null && !media.forrasLetezik)
  if (hianyzo.length > 0) {
    return kihagyas(
      `a jóváhagyott képek közül ${hianyzo
        .map((media) => `„${media.filename}”`)
        .join(
          ', ',
        )} nincs a Médiatárban, és a repó-forrásfájl sem található — a galéria csak a teljes hármassal kerül be`,
      true,
    )
  }

  const mindenMegvan = ujIds.every((id): id is number => id !== null)
  return {
    gallery: mindenMegvan ? ujIds.map((id) => ({ image: id })) : null,
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet}: az üres galériába a három jóváhagyott kép kerül, ebben a sorrendben: ${fajlnevLista}${
          mindenMegvan ? '' : ' (a hiányzó rekordokat a script a repó fájljaiból hozza létre)'
        }`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

/** A technikák-tábla horgonya (`sectionSettings.anchorId`). */
export const TECHNIKAK_TABLA_HORGONY = 'rendeloi-technikak'

/**
 * A technikák-tábla képe (WP54/4, WP55-től a csukló-mobilizálás): NEM a
 * fejléc kezelőasztalos fotója (ugyanaz a kép kétszer egy lapon rossz). A
 * blokk kép NÉLKÜL nem kerül be.
 */
export const TECHNIKAK_TABLA_KEP_FORRAS: MediaForras = {
  filename: 'treatment-wrist-table-1600.webp',
  filePath: 'public/media/team/treatment-wrist-table-1600.webp',
  alt: 'Csuklókezelés a Kineticare rendelőjében: a gyógytornász két kézzel mobilizálja a csuklót.',
}

/** A technikák-tábla öt sora, a vezető által jóváhagyott vevői szövegekkel. */
export const TECHNIKAK_TABLA_SOROK: readonly { title: string; body: string }[] = [
  {
    title: 'Gyógytorna',
    body: 'Akut sérülés, műtét utáni időszak és hosszú ideje tartó fájdalom esetén a mozgásterápia a gyógyulás alapja. Otthonra is kapsz gyakorlatokat.',
  },
  {
    title: 'Manuálterápia',
    body: 'Az ízületek és a lágyrészek célzott, kézzel végzett kezelése, hogy a mozgás újra szabad és fájdalommentes legyen.',
  },
  {
    title: 'Kinesio Tape és Dynamic Tape',
    body: 'Rugalmas szalag, amely tehermentesíti a fájó szakaszt és támogatja a mozgást a kezelések között.',
  },
  {
    title: 'Flossing és köpölyterápia',
    body: 'Gumiszalagos kompresszió és vákuumos kezelés: fellazítják a lágyrészeket, élénkítik a keringést és csökkentik a fájdalmat.',
  },
  {
    title: 'Hegkezelés, fasciakés, NRX bandázs',
    body: 'Műtéti és sérüléses hegek puhítása, eszközös lágyrész-mobilizáció a letapadt kötőszövetre, és rögzítő kötés, ha a kéznek átmenetileg nyugalom kell.',
  },
]

/**
 * A technikák-tábla blokkja (`services`, tábla-elrendezés) a megadott képpel.
 * Tiszta builder: a rows a `TECHNIKAK_TABLA_SOROK`-ból, „1”–„5” számozással,
 * felirat/URL/fotó nélkül (a tábla nem ajtó-blokk, CTA nem tartozik hozzá).
 */
export const technikakTablaBlokk = (mediaId: number): SzekcioTipus<'services'> => ({
  blockType: 'services',
  eyebrow: 'Rendelői kezelések',
  title: TECHNIKAK_TABLA_CIM,
  lead: 'Vizsgálat után ezekből állítjuk össze a kezelési tervedet. Minden alkalom a te panaszodhoz igazodik.',
  elrendezes: 'tabla',
  image: mediaId,
  rows: TECHNIKAK_TABLA_SOROK.map((sor, index) => ({
    number: String(index + 1),
    title: sor.title,
    body: sor.body,
    felirat: '',
    url: '',
    photo: null,
  })),
  sectionSettings: { visible: true, hatter: 'feher', anchorId: TECHNIKAK_TABLA_HORGONY },
})

/** A technikák-tábla beszúrásának eredménye. */
export interface TechnikakTablaAtalakitas extends SzekciosorCsere {
  /**
   * A beszúrás indexe, ha a lépés módosít — a futtató ebből építi a blokkot
   * a kép létrehozása UTÁN, ha a rekord a döntéskor még nem volt meg.
   */
  beszurasIndex: number | null
}

/**
 * WP54/4 — a /szolgaltatasok technikák-táblája („Amit a rendelőben kínálunk”):
 * a régi oldal „miket csinálunk” listája (gyógytorna, manuálterápia, tape,
 * flossing, hegkezelés stb.) a három ajtós `services` blokk UTÁN, tábla-
 * elrendezésű `services` blokként. Tulajdonosi kérés: „Ez maradhat az új
 * honlapon is?”
 *
 * VÉDŐFELTÉTELEK:
 *  - ha a lapon MÁR van `services` blokk ezzel a címmel (rejtett is), nincs
 *    teendő (idempotencia; a szerkesztő elrejtését a script nem bírálja felül);
 *  - a három ajtós blokkot (`isSzolgaltatasokAjtoBlock`) PONTOSAN egyszer kell
 *    megtalálni, különben indokolt kihagyás;
 *  - kép nélkül a blokk NEM kerül be: ha a kép nincs a Médiatárban és a
 *    forrásfájl is hiányzik, HANGOS kihagyás.
 */
export const alkalmazSzolgaltatasokTechnikakTabla = (input: {
  layout: Page['layout']
  /** A tábla képének állapota (meglévő azonosító és/vagy forrásfájl). */
  kep: UjMediaAllapot
}): TechnikakTablaAtalakitas => {
  const { layout, kep } = input
  const szabaly: JavitasSzabaly = 'szolgaltatasok-technikak-tabla'
  const uzenet = `A /szolgaltatasok technikák-táblája („${TECHNIKAK_TABLA_CIM}”)`
  const kihagyas = (indok: string, hangos = false): TechnikakTablaAtalakitas => ({
    layout: null,
    beszurasIndex: null,
    modositasok: [],
    kihagyasok: [{ szabaly, uzenet, indok, hangos }],
  })
  if (!Array.isArray(layout) || layout.length === 0) {
    return kihagyas('a Szolgáltatások oldalnak nincs szekciósora — nincs mi után beszúrni')
  }
  const meglevo = layout.findIndex(
    (blokk) => blokk.blockType === 'services' && blokk.title === TECHNIKAK_TABLA_CIM,
  )
  if (meglevo !== -1) {
    return kihagyas(
      `a lapon MÁR van „${TECHNIKAK_TABLA_CIM}” című szolgáltatás-blokk (${
        meglevo + 1
      }. szekció) — nincs teendő`,
    )
  }
  const ajto = egyetlenIndex(layout, (blokk) => isSzolgaltatasokAjtoBlock(blokk))
  const ajtoIndok = talalatIndok('három ajtós szolgáltatás-blokk (services, 3 sor CTA-val)', ajto)
  if (ajtoIndok !== null) return kihagyas(ajtoIndok)
  if (kep.id === null && !kep.forrasLetezik) {
    return kihagyas(
      `a tábla képe („${kep.filename}”) nincs a Médiatárban, és a repó-forrásfájl (${TECHNIKAK_TABLA_KEP_FORRAS.filePath}) sem található — kép nélkül a blokk nem kerül be`,
      true,
    )
  }
  const beszurasIndex = ajto + 1
  return {
    layout:
      kep.id === null
        ? null
        : [
            ...layout.slice(0, beszurasIndex),
            technikakTablaBlokk(kep.id),
            ...layout.slice(beszurasIndex),
          ],
    beszurasIndex,
    modositasok: [
      {
        szabaly,
        uzenet: `${uzenet}: új tábla-blokk a ${ajto + 1}. szekció (ajtó-blokk) után, ${
          TECHNIKAK_TABLA_SOROK.length
        } sorral (${TECHNIKAK_TABLA_SOROK.map((sor) => sor.title).join(', ')}), képpel: „${
          kep.filename
        }”${
          kep.id === null
            ? ' (a rekordot a script a repó fájljából hozza létre)'
            : ` (azonosító: ${kep.id})`
        }`,
        indok: null,
      },
    ],
    kihagyasok: [],
  }
}

// ---------------------------------------------------------------------------
// WP54/1 — média a repó fájljából, idempotensen.
// ---------------------------------------------------------------------------

/** A tiszta döntés eredménye: mi a teendő a képpel. */
export type MediaBiztositasTeendo = 'megvan' | 'letrehoz' | 'letrehozna' | 'hianyzik'

/**
 * A tiszta döntés: meglévő rekord → `megvan`; nincs rekord és nincs forrás →
 * `hianyzik`; különben próbafutásban `letrehozna`, élesben `letrehoz`.
 */
export const dontsMediaBiztositas = (input: {
  meglevoId: number | null
  forrasLetezik: boolean
  dryRun: boolean
}): MediaBiztositasTeendo => {
  if (input.meglevoId !== null) return 'megvan'
  if (!input.forrasLetezik) return 'hianyzik'
  return input.dryRun ? 'letrehozna' : 'letrehoz'
}

/** A Médiatár-hozzáférés injektálható darabjai (tesztből hamisítható). */
export interface MediaBiztositasFuggosegek {
  /** Média-rekord azonosítója PONTOS fájlnév alapján, vagy `null`. */
  keres: (filename: string) => Promise<number | null>
  /** Létrehozás a forrásfájlból; az új rekord azonosítóját adja. */
  letrehoz: (forras: MediaForras) => Promise<number>
  /** Létezik-e a forrásfájl (a repó gyökeréhez képest). */
  letezik: (filePath: string) => boolean
}

/** A média-biztosítás eredménye a naplósorokkal. */
export interface MediaBiztositasEredmeny {
  filename: string
  teendo: MediaBiztositasTeendo
  /** A rekord azonosítója (`megvan` és `letrehoz` után); különben `null`. */
  id: number | null
  modositasok: JavitasLepes[]
  kihagyasok: JavitasLepes[]
}

/**
 * Egy jóváhagyott kép állapota a döntésekhez: meglévő azonosító + forrás-létezés.
 * Csak olvas (keres) és fájlrendszert néz; sosem ír.
 */
export const ujMediaAllapot = async (
  forras: MediaForras,
  fuggosegek: MediaBiztositasFuggosegek,
): Promise<UjMediaAllapot> => ({
  filename: forras.filename,
  id: await fuggosegek.keres(forras.filename),
  forrasLetezik: fuggosegek.letezik(forras.filePath),
})

/**
 * WP54/1 — média-rekord biztosítása a repó fájljából, idempotensen.
 *
 * Ha a Médiatárban MÁR van rekord ezzel a fájlnévvel, azt adja vissza (nem
 * duplikál); különben a `filePath` fájlból létrehozza a megadott alt-tal.
 * Próbafutásban (`dryRun`) SEMMIT nem hoz létre, csak naplózza, mit hozna
 * létre. Hiányzó forrásfájlnál hangos kihagyás. A Payload-hívás injektált
 * (`fuggosegek.letrehoz`), ezért a döntés adatbázis nélkül tesztelhető.
 */
export const biztositMediaFajlbol = async (input: {
  forras: MediaForras
  /** Melyik szabály kedvéért készül a kép (a naplósor szabály-mezője). */
  szabaly: JavitasSzabaly
  dryRun: boolean
  fuggosegek: MediaBiztositasFuggosegek
}): Promise<MediaBiztositasEredmeny> => {
  const { forras, szabaly, dryRun, fuggosegek } = input
  const uzenet = `Médiatár: „${forras.filename}” (alt: „${forras.alt}”)`
  const meglevoId = await fuggosegek.keres(forras.filename)
  const teendo = dontsMediaBiztositas({
    meglevoId,
    forrasLetezik: fuggosegek.letezik(forras.filePath),
    dryRun,
  })
  switch (teendo) {
    case 'megvan':
      return { filename: forras.filename, teendo, id: meglevoId, modositasok: [], kihagyasok: [] }
    case 'hianyzik':
      return {
        filename: forras.filename,
        teendo,
        id: null,
        modositasok: [],
        kihagyasok: [
          {
            szabaly,
            uzenet,
            indok: `nincs ilyen rekord a Médiatárban, és a repó-forrásfájl (${forras.filePath}) sem található — a képet nem lehet létrehozni`,
            hangos: true,
          },
        ],
      }
    case 'letrehozna':
      return {
        filename: forras.filename,
        teendo,
        id: null,
        modositasok: [
          { szabaly, uzenet: `${uzenet}: létrehozná a ${forras.filePath} fájlból`, indok: null },
        ],
        kihagyasok: [],
      }
    case 'letrehoz': {
      const id = await fuggosegek.letrehoz(forras)
      return {
        filename: forras.filename,
        teendo,
        id,
        modositasok: [
          {
            szabaly,
            uzenet: `${uzenet}: létrehozva a ${forras.filePath} fájlból (azonosító: ${id})`,
            indok: null,
          },
        ],
        kihagyasok: [],
      }
    }
  }
}

/**
 * A valódi Médiatár-hozzáférés. A létrehozás után ellenőrzi, hogy a Payload
 * a várt fájlnevet adta-e (ütköző fájlnál `-1` utótagot fűzne hozzá, és a
 * rekord nem lenne idempotensen megtalálható) — eltérésnél HANGOSAN dob, mert
 * a részleges állapot kézi átnézést kér. A team/press manifestben szereplő
 * (kezelt) képnél az eredetigazolást is rögzíti, hogy a Volume-helyreállítás
 * (`ensureMediaFiles`) később vissza tudja tölteni.
 */
export const payloadMediaFuggosegek = (payload: Payload): MediaBiztositasFuggosegek => ({
  keres: async (filename) => {
    const talalat = await payload.find({
      collection: 'media',
      where: { filename: { equals: filename } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const sor = talalat.docs[0]
    return sor === undefined || sor.filename !== filename ? null : sor.id
  },
  letrehoz: async (forras) => {
    // Ütközés-előellenőrzés: ha a feltöltési könyvtárban REKORD NÉLKÜL ott a
    // fájl (félbeszakadt futás, mentésből visszaállított DB, kézi másolás), a
    // Payload `-1` utótagot fűzne a névhez, és a rekord már létrejönne, mielőtt
    // az eltérést észrevennénk. Ilyenkor létrehozás nélkül, hangosan állunk meg.
    const utkozoFajl = path.join(resolveUploadDir(payload), forras.filename)
    if (existsSync(utkozoFajl)) {
      throw new Error(
        `A feltöltési könyvtárban már van „${forras.filename}” nevű fájl, de a Médiatárban nincs hozzá rekord (${utkozoFajl}) — kézi átnézést kér (a fájl törlése vagy a rekord pótlása), a hivatkozó javítás nem futott le.`,
      )
    }
    const created: Media = await payload.create({
      collection: 'media',
      data: { alt: forras.alt },
      filePath: path.resolve(forras.filePath),
      overrideAccess: true,
    })
    if (created.filename !== forras.filename) {
      // Nem hagyunk árva `-N` rekordot: a félresikerült létrehozást visszavonjuk,
      // és csak utána dobunk.
      await payload.delete({ collection: 'media', id: created.id, overrideAccess: true })
      throw new Error(
        `A Médiatár a(z) „${forras.filename}” helyett „${created.filename ?? ''}” fájlnévvel hozta volna létre a képet — ütköző fájl a feltöltési könyvtárban; a tévesen létrejött rekordot (azonosító: ${created.id}) a script törölte, a hivatkozó javítás nem futott le, kézi átnézést kér.`,
      )
    }
    if (managedMediaAssets().some((asset) => asset.filename === created.filename)) {
      await enrollMediaRecovery(payload, created)
    }
    return created.id
  },
  letezik: (filePath) => existsSync(path.resolve(filePath)),
})

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

/** Egy média-rekord fájlneve azonosító alapján; `null`, ha nincs ilyen rekord (csak olvas). */
const mediaFajlnev = async (payload: Payload, id: number): Promise<string | null> => {
  const doc = await payload
    .findByID({ collection: 'media', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  return typeof doc?.filename === 'string' ? doc.filename : null
}

/** Több média-rekord fájlneve azonosító szerint (a naplóhoz; csak olvas). */
const mediaFajlnevek = async (
  payload: Payload,
  ids: readonly number[],
): Promise<ReadonlyMap<number, string>> => {
  const nevek = new Map<number, string>()
  if (ids.length === 0) return nevek
  const talalat = await payload.find({
    collection: 'media',
    where: { id: { in: ids } },
    limit: ids.length,
    depth: 0,
    overrideAccess: true,
  })
  for (const doc of talalat.docs) {
    if (typeof doc.filename === 'string') nevek.set(doc.id, doc.filename)
  }
  return nevek
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
  // WP54: a repó-fájlból biztosított képek Médiatár-hozzáférése (a `letrehoz`
  // ága kizárólag a `biztositMediaFajlbol` `!dryRun` döntésén át hívódik).
  const mediaFuggosegek = payloadMediaFuggosegek(payload)

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
    // --- WP18: a Rólunk-blokk szövege a /rolunk lappal közös forrásra ---------
    kezdolapLepes(
      alkalmazKezdolapRolunkSzoveg({ layout: kezdolapLayout, ujSzoveg: kezdolapRolunkUjSzoveg() }),
    )
    // --- WP37: a kezdőlapi bemutatkozás SAJÁT szövege (a WP18-as közös után) --
    kezdolapLepes(alkalmazBemutatkozasSzetvalasztas({ lap: 'kezdolap', layout: kezdolapLayout }))
    // --- 11. javítás: a záró CTA-sáv -----------------------------------------
    kezdolapLepes(alkalmazZaroCta({ layout: kezdolapLayout, seedBlokk: zaroCtaSeedBlokk() }))
    // --- 15. javítás: a kurzuslista-gombok egységes felirata -----------------
    // A LÁNC VÉGÉN fut, hogy a 11. javítás által ÚJONNAN beszúrt záró CTA-sáv
    // feliratát is elérje — a beszúrás után az is a szekciósor része.
    kezdolapLepes(alkalmazKurzuslistaFeliratok(kezdolapLayout))
    // --- Gondolatjel-maradék: „Így működik" vásárlás-lépés -------------------
    kezdolapLepes(alkalmazHowItWorksGondolatjel(kezdolapLayout))
    // --- WP52/3: a bemutatkozás rövidítése (a WP37 saját szövege UTÁN) --------
    kezdolapLepes(alkalmazKezdolapBemutatkozasRovidites(kezdolapLayout))
    // --- WP52/2: szekció-sorrend — a sín a kártyák elé, a logósor az About alá
    kezdolapLepes(alkalmazKezdolapSegitsegSorrend(kezdolapLayout))
    kezdolapLepes(alkalmazKezdolapSajtologoSorrend(kezdolapLayout))

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

    const lead = alkalmazKurzusLeadGondolatjel(termek.shortDescription)
    naplozdLepeseket(lead, dryRun)
    modositasokSzama += lead.modositasok.length
    kihagyasokSzama += lead.kihagyasok.length

    const termekAdat: Partial<Pick<Product, 'cardHighlights' | 'shortDescription'>> = {}
    if (eredmeny.cardHighlights !== null) {
      termekAdat.cardHighlights = eredmeny.cardHighlights
    }
    if (lead.shortDescription !== null) {
      termekAdat.shortDescription = lead.shortDescription
    }

    if (Object.keys(termekAdat).length > 0 && !dryRun) {
      await payload.update({
        collection: 'products',
        id: termek.id,
        data: termekAdat,
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
    // WP54/2: a stúdiófotó. A jelenlegi kép fájlnevét és az új kép állapotát
    // a Médiatárból OLVASSUK; a rekord létrehozása csak akkor (és csak
    // élesben) történik, ha a döntés módosít.
    const jelenlegiHeroId = heroKepAzonosito(rolunk.heroImage)
    const eredmeny = alkalmazRolunkHeroKep({
      jelenlegi: rolunk.heroImage,
      jelenlegiFajlnev:
        jelenlegiHeroId === null ? null : await mediaFajlnev(payload, jelenlegiHeroId),
      ujMedia: await ujMediaAllapot(ROLUNK_HERO_FORRAS, mediaFuggosegek),
    })
    naplozdLepeseket(eredmeny, dryRun)
    modositasokSzama += eredmeny.modositasok.length
    kihagyasokSzama += eredmeny.kihagyasok.length
    let ujHeroId = eredmeny.heroImage
    if (eredmeny.modositasok.length > 0 && ujHeroId === null) {
      const heroMedia = await biztositMediaFajlbol({
        forras: ROLUNK_HERO_FORRAS,
        szabaly: 'rolunk-hero-kep',
        dryRun,
        fuggosegek: mediaFuggosegek,
      })
      naplozdLepeseket(heroMedia, dryRun)
      modositasokSzama += heroMedia.modositasok.length
      kihagyasokSzama += heroMedia.kihagyasok.length
      ujHeroId = heroMedia.id
    }

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

    // --- WP37: a /rolunk bemutatkozás SAJÁT szövege (láncban) ---------------
    const rolunkBemutatkozasAlap = rolunkPress.layout ?? rolunkPressAlap
    const rolunkBemutatkozas = alkalmazBemutatkozasSzetvalasztas({
      lap: 'rolunk',
      layout: rolunkBemutatkozasAlap,
    })
    naplozdLepeseket(rolunkBemutatkozas, dryRun)
    modositasokSzama += rolunkBemutatkozas.modositasok.length
    kihagyasokSzama += rolunkBemutatkozas.kihagyasok.length

    // --- 19a. javítás: fotó a „Miben segíthetünk?" szekcióba ------------------
    // A lánc VÉGÉN, hogy a korábbi lépések eredmény-layoutján dolgozzon.
    const rolunkKep = await keresdMediat(payload, KATAK_LABDAVAL_PREFIX)
    const rolunkKepLepes = alkalmazSzolgaltatasBlokkKep({
      layout: rolunkBemutatkozas.layout ?? rolunkBemutatkozasAlap,
      mediaId: rolunkKep?.id ?? null,
      oldalCimke: '/rolunk',
      // Üres képhely: meglévő képet NEM írunk felül.
      cserelheto: false,
    })
    naplozdLepeseket(rolunkKepLepes, dryRun)
    modositasokSzama += rolunkKepLepes.modositasok.length
    kihagyasokSzama += rolunkKepLepes.kihagyasok.length

    // --- WP52/4: a partner-mondat törlése, majd a két logósáv sorrendcseréje --
    // A SORREND KÖTÖTT: előbb a mondat, különben a csere hangosan kimarad.
    const rolunkPartnerMondat = alkalmazRolunkPartnerMondat(
      rolunkKepLepes.layout ?? rolunkBemutatkozas.layout ?? rolunkBemutatkozasAlap,
    )
    naplozdLepeseket(rolunkPartnerMondat, dryRun)
    modositasokSzama += rolunkPartnerMondat.modositasok.length
    kihagyasokSzama += rolunkPartnerMondat.kihagyasok.length
    const rolunkLogosavok = alkalmazRolunkLogosavokSorrend(
      rolunkPartnerMondat.layout ??
        rolunkKepLepes.layout ??
        rolunkBemutatkozas.layout ??
        rolunkBemutatkozasAlap,
    )
    naplozdLepeseket(rolunkLogosavok, dryRun)
    modositasokSzama += rolunkLogosavok.modositasok.length
    kihagyasokSzama += rolunkLogosavok.kihagyasok.length

    // A javítások EGY frissítésben mennek ki (a heroImage és a layout külön
    // mező, nem ütköznek), így egyetlen piszkozat-ellenőrzés elég.
    const irando: { heroImage?: number; layout?: Szekciosor } = {}
    if (ujHeroId !== null) {
      irando.heroImage = ujHeroId
    }
    const rolunkVegsoLayout =
      rolunkLogosavok.layout ??
      rolunkPartnerMondat.layout ??
      rolunkKepLepes.layout ??
      rolunkBemutatkozas.layout ??
      rolunkPress.layout ??
      harmonika.layout
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

    // --- WP54/3: az SOS kurzus galériája (három jóváhagyott kép) ------------
    // A képek állapotát OLVASSUK; a rekordokat csak akkor (és csak élesben)
    // hozzuk létre, ha a döntés módosít — ugyanabba az update-be fut össze.
    const galeriaAllapotok: UjMediaAllapot[] = []
    for (const forras of SOS_GALERIA_FORRASOK) {
      galeriaAllapotok.push(await ujMediaAllapot(forras, mediaFuggosegek))
    }
    const galeria = alkalmazSosGaleria({
      jelenlegi: sosKurzus.gallery,
      ujMediak: galeriaAllapotok,
      ismertFajlnevek: await mediaFajlnevek(payload, galeriaAzonositok(sosKurzus.gallery)),
    })
    naplozdLepeseket(galeria, dryRun)
    modositasokSzama += galeria.modositasok.length
    kihagyasokSzama += galeria.kihagyasok.length
    let galeriaSorok = galeria.gallery
    if (galeria.modositasok.length > 0 && galeriaSorok === null) {
      const galeriaIds: number[] = []
      for (const forras of SOS_GALERIA_FORRASOK) {
        const media = await biztositMediaFajlbol({
          forras,
          szabaly: 'sos-galeria',
          dryRun,
          fuggosegek: mediaFuggosegek,
        })
        naplozdLepeseket(media, dryRun)
        modositasokSzama += media.modositasok.length
        kihagyasokSzama += media.kihagyasok.length
        if (media.id !== null) {
          galeriaIds.push(media.id)
        }
      }
      // Csak a TELJES hármassal írunk (a sorrend a SOS_GALERIA_FORRASOK-é).
      galeriaSorok =
        galeriaIds.length === SOS_GALERIA_FORRASOK.length
          ? galeriaIds.map((id) => ({ image: id }))
          : null
    }

    const sosAdat: Partial<
      Pick<Product, 'slug' | 'priceInHUFEnabled' | 'relatedProducts' | 'gallery'>
    > = {}
    if (eredmeny.slug !== null) {
      sosAdat.slug = eredmeny.slug
    }
    if (galeriaSorok !== null) {
      sosAdat.gallery = galeriaSorok
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

  // --- WP18b: az SOS kurzus publikálása (a piszkozat a publikált fölött) ----
  // KÜLÖN olvasás `draft: true`-val, a fenti SOS-írás UTÁN: a `_status` csak
  // így a legutóbbi verzióé. Webcím alapján keresünk (a webcím a 7. javítás
  // után stabil), nem sku alapján.
  const sosPiszkozatTalalat = await payload.find({
    collection: 'products',
    where: { slug: { equals: SOS_KURZUS_SLUG } },
    limit: 1,
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  const sosPiszkozat = sosPiszkozatTalalat.docs[0]

  if (sosPiszkozat === undefined) {
    logger.error(
      `Tartalom-javítás: nem található az SOS kurzus webcím alapján („${SOS_KURZUS_SLUG}”) — a publikálás kimaradt.`,
    )
    hiba = true
  } else {
    const publikalas = alkalmazSosPublikalas(sosPiszkozat)
    naplozdLepeseket(publikalas, dryRun)
    modositasokSzama += publikalas.modositasok.length
    kihagyasokSzama += publikalas.kihagyasok.length

    if (publikalas.publikal && !dryRun) {
      await payload.update({
        collection: 'products',
        id: sosPiszkozat.id,
        data: { _status: 'published' },
        draft: false,
        depth: 0,
        overrideAccess: true,
      })
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
    // fejléc-kép beállítása (12a) pedig külön mező — mindhárom EGYETLEN
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

    // --- WP54/4: a technikák-tábla az ajtó-blokk után -------------------------
    // A lánc VÉGÉN (a horgony, a bevezető és a kép-csere eredmény-layoutján).
    // A kép állapotát OLVASSUK; a rekord csak akkor (és csak élesben) jön
    // létre, ha a döntés beszúr — a blokk kép nélkül nem kerül be.
    const tabla = alkalmazSzolgaltatasokTechnikakTabla({
      layout: szolgaltatasokLayout,
      kep: await ujMediaAllapot(TECHNIKAK_TABLA_KEP_FORRAS, mediaFuggosegek),
    })
    naplozdLepeseket(tabla, dryRun)
    modositasokSzama += tabla.modositasok.length
    kihagyasokSzama += tabla.kihagyasok.length
    let tablaLayout = tabla.layout
    if (tabla.modositasok.length > 0 && tablaLayout === null && tabla.beszurasIndex !== null) {
      const tablaKep = await biztositMediaFajlbol({
        forras: TECHNIKAK_TABLA_KEP_FORRAS,
        szabaly: 'szolgaltatasok-technikak-tabla',
        dryRun,
        fuggosegek: mediaFuggosegek,
      })
      naplozdLepeseket(tablaKep, dryRun)
      modositasokSzama += tablaKep.modositasok.length
      kihagyasokSzama += tablaKep.kihagyasok.length
      if (tablaKep.id !== null) {
        tablaLayout = [
          ...szolgaltatasokLayout.slice(0, tabla.beszurasIndex),
          technikakTablaBlokk(tablaKep.id),
          ...szolgaltatasokLayout.slice(tabla.beszurasIndex),
        ]
      }
    }
    if (tablaLayout !== null) {
      szolgaltatasokLayout = tablaLayout
      layoutValtozott = true
    }

    // --- 12a. javítás (WP55): a fejléc-kép a kezelőasztalos fotóra -----------
    // A /rolunk 4. javításának mintája: a jelenlegi kép fájlnevét és az új kép
    // állapotát OLVASSUK; a rekord csak akkor (és csak élesben) jön létre, ha
    // a döntés módosít.
    const jelenlegiSzolgHeroId = heroKepAzonosito(szolgaltatasok.heroImage)
    const szolgHero = alkalmazSzolgaltatasokHeroKep({
      jelenlegi: szolgaltatasok.heroImage,
      jelenlegiFajlnev:
        jelenlegiSzolgHeroId === null ? null : await mediaFajlnev(payload, jelenlegiSzolgHeroId),
      ujMedia: await ujMediaAllapot(SZOLGALTATASOK_HERO_FORRAS, mediaFuggosegek),
    })
    naplozdLepeseket(szolgHero, dryRun)
    modositasokSzama += szolgHero.modositasok.length
    kihagyasokSzama += szolgHero.kihagyasok.length
    let ujSzolgHeroId = szolgHero.heroImage
    if (szolgHero.modositasok.length > 0 && ujSzolgHeroId === null) {
      const szolgHeroMedia = await biztositMediaFajlbol({
        forras: SZOLGALTATASOK_HERO_FORRAS,
        szabaly: 'szolgaltatasok-hero-kep',
        dryRun,
        fuggosegek: mediaFuggosegek,
      })
      naplozdLepeseket(szolgHeroMedia, dryRun)
      modositasokSzama += szolgHeroMedia.modositasok.length
      kihagyasokSzama += szolgHeroMedia.kihagyasok.length
      ujSzolgHeroId = szolgHeroMedia.id
    }

    const irandoSzolgaltatasok: { layout?: Szekciosor; heroImage?: number } = {}
    if (layoutValtozott) {
      irandoSzolgaltatasok.layout = szolgaltatasokLayout
    }
    if (ujSzolgHeroId !== null) {
      irandoSzolgaltatasok.heroImage = ujSzolgHeroId
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

  // --- WP52/1: a „Szakmai képzés” menüpont → „Szakembereknek” ---------------
  // MINDEN, a ProBody-címre mutató menüpontra lefut (a fejléc almenüje és egy
  // esetleges másolat is); a tiszta szabály dönt soronként.
  const menuTalalat = await payload.find({
    collection: 'menus',
    where: { url: { equals: PROFESSIONAL_TRAINING_URL } },
    limit: 20,
    depth: 0,
    overrideAccess: true,
  })
  if (menuTalalat.docs.length === 0) {
    logger.warn(
      `Tartalom-javítás — ${dryRun ? 'KIHAGYNÁ' : 'KIHAGYVA'}: a „Szakmai képzés” menüpont (nincs a ProBody-címre („${PROFESSIONAL_TRAINING_URL}”) mutató menüpont a Menus collectionben — már átírva, vagy a szerkesztő törölte)`,
    )
    kihagyasokSzama += 1
  }
  for (const menupont of menuTalalat.docs) {
    const eredmeny = alkalmazSzakmaiMenupont(menupont)
    naplozdLepeseket(eredmeny, dryRun)
    modositasokSzama += eredmeny.modositasok.length
    kihagyasokSzama += eredmeny.kihagyasok.length
    if (eredmeny.adat !== null && !dryRun) {
      await payload.update({
        collection: 'menus',
        id: menupont.id,
        data: eredmeny.adat,
        depth: 0,
        overrideAccess: true,
      })
    }
  }

  // --- WP56: a kurzusborítók alt-szövege (Médiatár) ---------------------------
  for (const tetel of MEDIA_ALT_SZOVEGEK) {
    const media = await keresdMediat(payload, tetel.prefix)
    if (media === null) {
      logger.warn(
        `Tartalom-javítás — ${dryRun ? 'KIHAGYNÁ' : 'KIHAGYVA'}: ${tetel.cimke} alt-szövege (a Médiatárban nincs „${tetel.prefix}” kezdetű fájlnevű kép)`,
      )
      kihagyasokSzama += 1
      continue
    }
    // A második olvasás átmeneti hibája (pool, zár) NEM jelenthet „üres alt”-ot:
    // akkor a szabály a szerkesztői szöveget írná felül. Hiba esetén hangos kihagyás.
    const doc = await payload
      .findByID({ collection: 'media', id: media.id, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (doc === null) {
      logger.error(
        `Tartalom-javítás — ${dryRun ? 'KIHAGYNÁ' : 'KIHAGYVA'}: ${tetel.cimke} alt-szövege (a(z) ${media.id} azonosítójú média-rekord nem olvasható, az alt nem dönthető el)`,
      )
      kihagyasokSzama += 1
      continue
    }
    const eredmeny = alkalmazMediaAltSzoveg({
      cimke: tetel.cimke,
      jelenlegiAlt: typeof doc?.alt === 'string' ? doc.alt : null,
      ujAlt: tetel.alt,
    })
    naplozdLepeseket(eredmeny, dryRun)
    modositasokSzama += eredmeny.modositasok.length
    kihagyasokSzama += eredmeny.kihagyasok.length
    if (eredmeny.alt !== null && !dryRun) {
      await payload.update({
        collection: 'media',
        id: media.id,
        data: { alt: eredmeny.alt },
        depth: 0,
        overrideAccess: true,
      })
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
