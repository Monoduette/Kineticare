/**
 * Előtöltő szabály: a services blokkok `elrendezes` és `sectionSettings.hatter`
 * mezője (H15, A4 adat).
 *
 * MIÉRT KELL: 2026-09-23-ig a kezdőlap és a /szolgaltatasok megjelenítése
 * (src/lib/home-help-states.ts) a mezőtől FÜGGETLENÜL, cím- és URL-felismeréssel
 * döntött sín és tábla között, és a sínt világoskék sávra tette. Az élő adatban
 * ezért az admin „Tábla” és „Fehér” értéket mutat, a lapon pedig sín és
 * világoskék áll: a kezdőlap 5. szekciója („Így tudunk segíteni”) és a
 * /szolgaltatasok 2. szekciója („Így segítünk”, a háromsoros, CTA-s
 * ajtó-blokk). Az új kód a mezőt tiszteli, ezért előbb a mezőnek kell igazat
 * mondania: ez a szabály minden services blokkra kiszámolja, hogyan rajzolta a
 * RÉGI kód, és a két mezőt pontosan erre állítja. Így a kódváltás után a két lap
 * látványa VÁLTOZATLAN, az admin pedig azt mutatja, ami a lapon van.
 *
 * DEPLOY-FELTÉTEL (a sos-cim-kitoltes.ts precedense): a mezőt tisztelő kód
 * (home-help-states.ts `kezdolapiSinE`, `szolgaltatasokSinE`) CSAK ugyanabban a
 * deployban élesíthető, mint ennek a szabálynak az éles futtatása. A szabály
 * nélkül a kezdőlap és a /szolgaltatasok ajtó-blokkja táblára váltana.
 *
 * A RÉGI KÓD DÖNTÉSE (befagyasztva, 2026-09-23, a 793fe0b állapot):
 *  - kezdőlap (`presentHomeLayout`): sín, ha a blokk háromajtós
 *    (`isConvertibleHomeHelpServices`) VAGY a mentett érték `sin` (ezt a
 *    Services komponens rajzolta sínnek). Minden más tábla.
 *  - /szolgaltatasok (`presentSzolgaltatasokLayout`): sín, ha a blokk ajtó-blokk
 *    (`isSzolgaltatasokAjtoBlock`), a mentett értéktől függetlenül; minden más
 *    tábla (a régi kód a mentett `sin` értéket is táblára írta).
 *  - háttér: a sín a Sötétkék választást megtartja, minden mást világoskéken
 *    rajzolt (`tint`). A tábla háttere a mentett érték volt; ahhoz a szabály nem
 *    nyúl. (A kezdőlapon a sín ELŐTTI szomszéd tint-váltása nem elrendezés-döntés:
 *    az új kód is ugyanúgy végzi, ez a szabály nem írja.)
 *
 * HATÁR: csak a services blokk `elrendezes` mezőjét és a sín `hatter` mezőjét
 * írja, és csak ott, ahol a mentett érték eltér. Minden más szerkesztői mezőt
 * (szöveg, sorok, fotó, horgony, láthatóság) érintetlenül hagy. Idempotens: a
 * második futás `MAR` (vagy táblák esetén `ERINTETLEN`).
 *
 * EGYSZERI JELLEG: a szabály a RÉGI kód döntését írja a mezőbe. Ha a deploy
 * után egy szerkesztő tudatosan Táblára állítja a kezdőlapi háromajtós blokkot,
 * egy ismételt futás visszaírná Sínre. A hívónak (A8) ezért egyszeri
 * futásként kell kezelnie.
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis, hálózat vagy naplózás; a bemenetet nem
 * módosítja. A hívó (src/scripts/apply-owner-content.ts, az A8 köti be) a
 * visszakapott `layout`-ot az oldal KÖZZÉTETT változatába írja, a `naplo`
 * sorait pedig a loggerrel naplózza. `layout === null`: nincs mit írni.
 */

import {
  isConvertibleHomeHelpServices,
  isSzolgaltatasokAjtoBlock,
  mentettElrendezes,
  type ServicesElrendezes,
} from '../lib/home-help-states'

/** A lap, amelynek a szekciósorát a szabály kapja. */
export type SinElrendezesLap = 'kezdolap' | 'szolgaltatasok'

/** A szekció háttere (src/blocks/section-settings.ts `hatter`). */
type Hatter = 'feher' | 'tint' | 'sotet'

/** Egy services blokk sorsa. */
export type SinElrendezesBlokkAllapot =
  /** Az `elrendezes` vagy a `hatter` átíródott a régi kód megjelenítésére. */
  | 'KITOLTVE'
  /** Sín, és a mező már `sin` a helyes háttérrel: nincs teendő. */
  | 'MAR'
  /** Tábla, és a mező már `tabla`: nincs teendő. */
  | 'ERINTETLEN'

/**
 * A teljes futás állapota.
 * - `KITOLTVE`: legalább egy blokk változott, a `layout` az új szekciósor.
 * - `MAR`: nincs mit írni, és legalább egy sín már helyes; az első `KITOLTVE`
 *   utáni ismételt futás az élő lapokon ezt adja.
 * - `ERINTETLEN`: nincs mit írni, a lapon csak helyes táblák vannak.
 * - `NINCS_SERVICES`: a szekciósorban nincs services blokk (vagy nem tömb).
 */
export type SinElrendezesAllapot = SinElrendezesBlokkAllapot | 'NINCS_SERVICES'

/** A két vizsgált mező egy pillanatképe. */
export interface SinElrendezesMezok {
  elrendezes: ServicesElrendezes | null
  hatter: Hatter | null
}

/** Blokkonkénti naplósor. */
export interface SinElrendezesNaplo {
  /** A blokk helye a szekciósorban, 0-tól. */
  index: number
  /** A blokk Payload-azonosítója, ha van. */
  blokkId: string | null
  regi: SinElrendezesMezok
  uj: SinElrendezesMezok
  allapot: SinElrendezesBlokkAllapot
  /** Magyar naplósor az üzemeltetőnek. */
  uzenet: string
}

/** A szabály eredménye. */
export interface SinElrendezesKitoltes {
  allapot: SinElrendezesAllapot
  /** Az új szekciósor, ha legalább egy blokk változott; különben null. */
  layout: unknown[] | null
  naplo: SinElrendezesNaplo[]
}

type Rekord = Readonly<Record<string, unknown>>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const mentettHatter = (value: unknown): Hatter | null =>
  value === 'feher' || value === 'tint' || value === 'sotet' ? value : null

/**
 * A RÉGI (2026-09-23 előtti) kód döntése: sínként rajzolta-e a blokkot. A
 * fejkomment írja le, miért így; a függvény szándékosan nem a mai
 * `kezdolapiSinE` / `szolgaltatasokSinE`, mert azok már a mezőt tisztelik.
 */
export function regiKodSinE(blokk: Rekord, lap: SinElrendezesLap): boolean {
  if (lap === 'kezdolap') {
    return blokk.elrendezes === 'sin' || isConvertibleHomeHelpServices(blokk)
  }
  return isSzolgaltatasokAjtoBlock(blokk)
}

const LAP_NEV: Readonly<Record<SinElrendezesLap, string>> = {
  kezdolap: 'Kezdőlap',
  szolgaltatasok: 'Szolgáltatások',
}

const ELRENDEZES_NEV: Readonly<Record<ServicesElrendezes, string>> = {
  sin: 'Sín',
  tabla: 'Tábla',
}

const HATTER_NEV: Readonly<Record<Hatter, string>> = {
  feher: 'Fehér',
  tint: 'Világoskék',
  sotet: 'Sötétkék',
}

const mezoNev = (mezok: SinElrendezesMezok): string =>
  `${mezok.elrendezes ? ELRENDEZES_NEV[mezok.elrendezes] : 'üres'} elrendezés, ${
    mezok.hatter ? HATTER_NEV[mezok.hatter] : 'üres'
  } háttér`

function naploSor(
  lap: SinElrendezesLap,
  index: number,
  blokk: Rekord,
  blokkId: string | null,
  regi: SinElrendezesMezok,
  uj: SinElrendezesMezok,
  allapot: SinElrendezesBlokkAllapot,
): string {
  const cim = typeof blokk.title === 'string' && blokk.title.trim().length > 0 ? blokk.title : null
  const hely = `${LAP_NEV[lap]}, ${index + 1}. szekció (${cim ? `„${cim}”` : 'cím nélkül'}${
    blokkId ? `, azonosító: ${blokkId}` : ''
  })`
  switch (allapot) {
    case 'KITOLTVE':
      return `${hely}: ${mezoNev(regi)} helyett ${mezoNev(uj)}, ahogy a lapon eddig is látszott.`
    case 'MAR':
      return `${hely}: már sín a helyes háttérrel, nincs teendő.`
    case 'ERINTETLEN':
      return `${hely}: tábla, a mező is tábla, nincs teendő.`
  }
}

/**
 * A szabály: a szekciósor minden `services` blokkjára lefut.
 *
 * @param layout Az oldal `layout` mezője (bármilyen alakú lehet; rossz alakú
 *   bemenetre sem dob).
 * @param lap Melyik lap szekciósora (a régi kód lapfüggően döntött).
 */
export function sinElrendezesKitoltese(
  layout: unknown,
  lap: SinElrendezesLap,
): SinElrendezesKitoltes {
  if (!Array.isArray(layout)) {
    return { allapot: 'NINCS_SERVICES', layout: null, naplo: [] }
  }

  const naplo: SinElrendezesNaplo[] = []
  let valtozott = false
  const uj = layout.map((blokk: unknown, index: number): unknown => {
    if (!isRekord(blokk) || blokk.blockType !== 'services') {
      return blokk
    }
    const blokkId = typeof blokk.id === 'string' && blokk.id.length > 0 ? blokk.id : null
    const settings = isRekord(blokk.sectionSettings) ? blokk.sectionSettings : null
    const regi: SinElrendezesMezok = {
      elrendezes: mentettElrendezes(blokk.elrendezes),
      hatter: mentettHatter(settings?.hatter),
    }
    const sin = regiKodSinE(blokk, lap)
    const cel: SinElrendezesMezok = sin
      ? { elrendezes: 'sin', hatter: regi.hatter === 'sotet' ? 'sotet' : 'tint' }
      : { elrendezes: 'tabla', hatter: regi.hatter }
    const elrendezesValtozik = blokk.elrendezes !== cel.elrendezes
    const hatterValtozik = sin && settings?.hatter !== cel.hatter
    const allapot: SinElrendezesBlokkAllapot =
      elrendezesValtozik || hatterValtozik ? 'KITOLTVE' : sin ? 'MAR' : 'ERINTETLEN'
    naplo.push({
      index,
      blokkId,
      regi,
      uj: cel,
      allapot,
      uzenet: naploSor(lap, index, blokk, blokkId, regi, cel, allapot),
    })
    if (allapot !== 'KITOLTVE') {
      return blokk
    }
    valtozott = true
    return {
      ...blokk,
      elrendezes: cel.elrendezes,
      ...(hatterValtozik ? { sectionSettings: { ...(settings ?? {}), hatter: cel.hatter } } : {}),
    }
  })

  if (naplo.length === 0) {
    return { allapot: 'NINCS_SERVICES', layout: null, naplo }
  }
  if (valtozott) {
    return { allapot: 'KITOLTVE', layout: uj, naplo }
  }
  return {
    allapot: naplo.some((sor) => sor.allapot === 'MAR') ? 'MAR' : 'ERINTETLEN',
    layout: null,
    naplo,
  }
}
