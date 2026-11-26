/**
 * A „Csuklófájdalom témakurzus” minta (témakurzusok, 3. lépés).
 *
 * A minta egy teljesen kitöltött, de PISZKOZAT és REJTETT témakurzus, amelyet
 * a szerkesztők megnyithatnak, átírhatnak, és amelyből a többi témakurzus
 * mintáját látják. Élesben semmit nem mutat a látogatóknak, amíg valaki
 * közzé nem teszi és ki nem veszi a rejtettből.
 *
 * A szövegek kizárólag a teljes program (Otthoni KézRehab Program) már
 * jóváhagyott mondataiból állnak, a csuklóra szűkítve; új egészségügyi
 * állítás nincs bennük. Ár nem szerepel a szövegekben (a fejléc mutatja az
 * árat élőben, a szerkesztői ellenőrzőlista a kézzel írt árat jelzi). Az ár
 * mintaár: a Belső azonosító „(minta)” jelölése és a szerkesztői útmutató
 * mondja ki, hogy átírandó.
 *
 * A tananyag a program MEGLÉVŐ leckéiből válogat a videó azonosítója (Bunny
 * GUID) szerint, ugyanabban a sorrendben, ugyanazokkal a videókkal. A leckék
 * mellékletei kimaradnak (azok egy kurzushoz kötött fájlok), a sorok
 * azonosítói újak lesznek.
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis, hálózat vagy naplózás. A hívó
 * (src/scripts/temakurzus-minta.ts) keresi meg a programot és a már létező
 * mintát, és `LETREHOZANDO` állapotnál az `adat`-ot adja a `payload.create`-nek.
 */
import type { RequiredDataFromCollectionSlug } from 'payload'

import type { Product } from '../payload-types'
import { OTTHONI_COURSE_SKU } from './curriculum/bunny-keszlet'
import { formatPriceHuf } from './format-price'

export { OTTHONI_COURSE_SKU }

/** A minta Belső azonosítója. A „(minta)” jelzi, hogy az ár és a szöveg átírandó. */
export const CSUKLO_MINTA_SKU = 'Csuklófájdalom témakurzus (minta)'
export const CSUKLO_MINTA_SLUG = 'csuklofajdalom-temakurzus'
export const CSUKLO_MINTA_CIM = 'Csuklófájdalom témakurzus'
/** Mintaár: a tulajdonos írja át közzététel előtt. */
export const CSUKLO_MINTA_AR_HUF = 19_900

/**
 * A program leckéi, amelyeket a minta átvesz (Bunny GUID, a programbeli
 * sorrendben). Forrás: src/lib/curriculum/bunny-keszlet.ts OTTHONI_PLAN.
 */
export const CSUKLO_MINTA_LECKEK: readonly string[] = [
  // 1. Így kezdj neki: mind a négy
  '25f6f5f0-418c-42ef-a9f1-b9f9adabcae5', // Fontos tudnivalók a programról
  '3be4f7dd-e2c2-4089-8a3d-6cda9fdd9f6b', // Ismerd meg a kezed
  'ce882fed-1dd4-4638-8632-c9238ef4c875', // Így csináld a gyakorlatokat
  '9bf411f5-93d5-4c3b-a8d1-7d3a86e2ba0e', // Mikor fordulj orvoshoz…
  // 2. Mi okozza a fájdalmat: a csuklót érintő két panasz
  'c54c2057-5fa7-4723-b200-cee4d0f53fd8', // Hogyan alakul ki az ínhüvelygyulladás?
  'b52fd6fe-7b9d-4ab0-b9ab-e0331b3d49a1', // Hogyan alakul ki a kéztőalagút szindróma?
  // 3. Gyakorlatok
  'bec0fad1-93a9-4991-98b9-9051555d14fd', // Egyszerű mobilizáló gyakorlatok
  '64bef377-ef24-4060-951e-bb2e4dac3bc1', // Gyakorlatok csuklófájdalomra
  // 4. Eszközök és mindennapok
  'af73719f-ef52-41e1-9832-c8eb765de9bf', // Rögzítők
  '5ed4ee2d-d25d-4ac0-a814-ccb7d0bcf17e', // Kinesiotape
  'b1ff827f-bb5c-4b56-85e2-d4e12dae400f', // Így tudod elkerülni, hogy kiújuljon a probléma
]

export const CSUKLO_MINTA_ROVID_LEIRAS =
  'Az Otthoni KézRehab Program csuklófájdalomra összeállított része: könnyen követhető, otthon is biztonságosan alkalmazható gyakorlatok gyógytornászoktól, a saját tempódban.'

export const CSUKLO_MINTA_LEIRAS_BEKEZDESEK: readonly string[] = [
  'Ez a témakurzus az Otthoni KézRehab Program csuklóra vonatkozó leckéit tartalmazza, ugyanazokkal a videókkal. Megismered a kezed felépítését, a csuklót érintő két gyakori panasz, az ínhüvelygyulladás és a kéztőalagút szindróma kialakulását, a csukló gyakorlatait, valamint a rögzítőket, a tape-elést és a kiújulás megelőzését.',
  'Ha a kezed más részén is fáj, a teljes program az ujjakra, az alkarra és a könyökre is kiterjed, és mindegyik témát tartalmazza.',
  'Az ingyenes SOS KézRelax villámkurzus röviden elmagyarázza a leggyakoribb panaszok kialakulását. Ez a témakurzus ezen felül a csukló gyakorlatait, a tape-elést és a kiújulás megelőzését is bemutatja.',
]

export const CSUKLO_MINTA_KINEK_VALO: readonly string[] = [
  'hónapok óta fáj a csuklód, de eddig semmi nem hozott tartós enyhülést,',
  'sokat dolgozol a kezeddel, és erős terhelést kap a csuklód,',
  'szeretnél aktívan tenni a gyógyulásodért, és nem csak a fájdalomcsillapításra hagyatkozni,',
  'olyan megoldást akarsz, ami biztonságos, szakmailag megalapozott, mégis otthon is végezhető,',
  'szeretnéd tudni, hogyan kell szakszerűen tape-elni a kezed.',
]

/** A program „Nem javasoljuk, ha…” listája, változatlan tartalommal. */
export const CSUKLO_MINTA_NEM_JAVASOLT: readonly string[] = [
  'a kezed érintő traumás (pl. törés) sérülésed volt, és az orvos még nem enged mindent csinálni,',
  'már jelentkezett érzéskiesés, vagy régebb óta tart, észlelhető, jelentős gyengülés a szorítóerőben, esetleg látható izomtömeg-vesztés a tenyéren,',
  'már műtétre vársz, esetleg onkológiai kezelés alatt állsz, vagy folyamatban lévő orvosi kezelésben részesülsz, ilyenkor mindenképp kérdezd meg előbb a kezelőorvosod,',
  'nem szeretnéd megérteni a kézproblémáid miértjét,',
  'csak az olyan passzív kezelésektől (masszázs, manuálterápia) várod a megoldást, amiket „rajtad végeznek”, de otthon nem akarod végezni a gyakorlatokat,',
  'nincs napi 5 perced magadra.',
]

export const CSUKLO_MINTA_GARANCIA_CIM = '30 napos kipróbálási garancia'
/** A program garancia-szövege a program ár-mondata nélkül. */
export const CSUKLO_MINTA_GARANCIA_SZOVEG =
  'Próbáld ki a kurzust 30 napig, és tapasztald meg, milyen változást hoz a kezed állapotában! Ha úgy érzed, hogy nem segített, csak írj egy e-mailt, és kérdés nélkül visszafizetjük a kurzus árát. (A kurzus nem helyettesíti a szakorvosi kontrollt.)'

export type CsukloMintaAdat = RequiredDataFromCollectionSlug<'products'>

export interface CsukloMintaTerv {
  /**
   * `LETREHOZANDO`: az `adat` a létrehozandó piszkozat; `MAR_LETEZIK`: van már
   * ilyen Belső azonosítójú vagy webcímű kurzus, nincs teendő; `NINCS_PROGRAM`:
   * a teljes program nem található; `HIANYZO_LECKE`: a programból hiányzik
   * egy átveendő lecke (a programot azóta átszerkesztették), ezért nem ír.
   */
  allapot: 'LETREHOZANDO' | 'MAR_LETEZIK' | 'NINCS_PROGRAM' | 'HIANYZO_LECKE'
  adat: CsukloMintaAdat | null
  uzenet: string
}

type ProgramModul = NonNullable<Product['modules']>[number]
type ProgramLecke = NonNullable<ProgramModul['lessons']>[number]

function bekezdes(szoveg: string) {
  return {
    type: 'paragraph',
    version: 1,
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    textFormat: 0,
    children: [
      { type: 'text', version: 1, text: szoveg, format: 0, style: '', mode: 'normal', detail: 0 },
    ],
  }
}

function leiras(): NonNullable<Product['longDescription']> {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: 'ltr',
      format: '',
      indent: 0,
      children: CSUKLO_MINTA_LEIRAS_BEKEZDESEK.map(bekezdes),
    },
  }
}

/** Egy átvett lecke: azonosító és mellékletek nélkül (új sor, kurzushoz kötött fájlok nélkül). */
function atvettLecke(lecke: ProgramLecke): ProgramLecke {
  const masolat: ProgramLecke = { ...lecke, attachments: [] }
  delete masolat.id
  return masolat
}

/**
 * A program moduljaiból a kiválasztott leckék, a programbeli sorrendben. Üres
 * modul kimarad; a modul összefoglalója csak akkor marad, ha a modul minden
 * leckéje átjön (különben a program más témáit ígérné).
 */
export function csukloMintaModulok(
  programModulok: Product['modules'],
  kivalasztott: readonly string[] = CSUKLO_MINTA_LECKEK,
): { modulok: NonNullable<Product['modules']>; hianyzo: string[] } {
  const keresett = new Set(kivalasztott)
  const talalt = new Set<string>()
  const modulok: NonNullable<Product['modules']> = []
  for (const modul of programModulok ?? []) {
    const leckek = (modul.lessons ?? []).filter(
      (lecke) => typeof lecke.streamAssetId === 'string' && keresett.has(lecke.streamAssetId),
    )
    for (const lecke of leckek) talalt.add(lecke.streamAssetId as string)
    if (leckek.length === 0) continue
    const teljes = leckek.length === (modul.lessons ?? []).length
    modulok.push({
      title: modul.title,
      summary: teljes ? (modul.summary ?? null) : null,
      lessons: leckek.map(atvettLecke),
    })
  }
  return { modulok, hianyzo: kivalasztott.filter((guid) => !talalt.has(guid)) }
}

function relacioId(ertek: unknown): number | null {
  if (typeof ertek === 'number') return ertek
  if (
    typeof ertek === 'object' &&
    ertek !== null &&
    typeof (ertek as { id?: unknown }).id === 'number'
  ) {
    return (ertek as { id: number }).id
  }
  return null
}

/** A minta terve a program és a már létező minta ismeretében. */
export function tervezdCsukloMintat(input: {
  program: Product | null
  marLetezik: boolean
}): CsukloMintaTerv {
  if (input.marLetezik) {
    return {
      allapot: 'MAR_LETEZIK',
      adat: null,
      uzenet: `A „${CSUKLO_MINTA_CIM}” minta már létezik (Belső azonosító vagy webcím szerint), nincs teendő.`,
    }
  }
  const program = input.program
  const kategoria = program === null ? null : relacioId(program.category)
  if (program === null || kategoria === null) {
    return {
      allapot: 'NINCS_PROGRAM',
      adat: null,
      uzenet: `A teljes program („${OTTHONI_COURSE_SKU}”) nem található, a minta nem készül el.`,
    }
  }
  const { modulok, hianyzo } = csukloMintaModulok(program.modules)
  if (hianyzo.length > 0) {
    return {
      allapot: 'HIANYZO_LECKE',
      adat: null,
      uzenet: `A teljes programból hiányzik ${hianyzo.length} átveendő lecke (${hianyzo.join(', ')}), a minta nem készül el.`,
    }
  }
  const leckeSzam = modulok.reduce((osszeg, modul) => osszeg + (modul.lessons?.length ?? 0), 0)
  const adat: CsukloMintaAdat = {
    sku: CSUKLO_MINTA_SKU,
    displayTitle: CSUKLO_MINTA_CIM,
    slug: CSUKLO_MINTA_SLUG,
    status: 'draft',
    _status: 'draft',
    unlisted: true,
    pageLayout: 'landing',
    parentCourses: [program.id],
    category: kategoria,
    audience: program.audience ?? null,
    coverImage: relacioId(program.coverImage),
    accessDurationDays: program.accessDurationDays ?? null,
    priceInHUFEnabled: true,
    priceInHUF: CSUKLO_MINTA_AR_HUF,
    shortDescription: CSUKLO_MINTA_ROVID_LEIRAS,
    longDescription: leiras(),
    salesHighlights: [
      { text: `${leckeSzam} videós lecke a teljes programból, a csuklóra válogatva` },
      { text: 'a hetek, hónapok óta tartó fájdalmat is rendbehozni a csuklódban' },
      { text: 'megtanulni a megelőzés „fortélyait”' },
    ],
    fitFor: CSUKLO_MINTA_KINEK_VALO.map((text) => ({ text })),
    notFitFor: CSUKLO_MINTA_NEM_JAVASOLT.map((text) => ({ text })),
    guaranteeTitle: CSUKLO_MINTA_GARANCIA_CIM,
    guaranteeText: CSUKLO_MINTA_GARANCIA_SZOVEG,
    modules: modulok,
  }
  return {
    allapot: 'LETREHOZANDO',
    adat,
    uzenet: `A „${CSUKLO_MINTA_CIM}” minta piszkozatként és rejtettként létrehozandó: ${modulok.length} modul, ${leckeSzam} lecke, mintaár ${formatPriceHuf(CSUKLO_MINTA_AR_HUF)}.`,
  }
}
