/**
 * Előtöltő szabály: a kezdőlapi SOS-sáv (`freeSos` blokk) címe.
 *
 * MIÉRT KELL: 2026-09-22-től a sáv h2-je a blokk `title` mezője (CMS-elsőbbség,
 * admin-audit K18, src/components/content/home/FreeSos.tsx). Az élő kezdőlapon
 * a mező értéke még a WP26 előtti „SOS Kézrelax — ingyenes villámkurzus”
 * (U+2014), amit a lap eddig nem mutatott, mert a cím rögzített volt. Ez a
 * szabály a mentett értéket a tulajdonos 2026-09-07-i szó szerinti címére
 * állítja („Ingyenes villámkurzus”), így a kódváltás után a lap látványa nem
 * változik, és a mező igazat mond. A CMS-elsőbbségi kód ezért CSAK ugyanabban
 * a deployban élesíthető, mint ennek a szabálynak a futtatása.
 *
 * HATÁR: kizárólag PONTOS egyezésre ír (trim után a régi alak, vagy üres,
 * null, hiányzó, csak szóköz). Minden más értéket szerkesztői szövegnek tekint
 * és érintetlenül hagy, köztük a seed kettőspontos alakját („SOS Kézrelax:
 * ingyenes villámkurzus”, src/lib/home-seed.ts) és a nagykötőjeles változatot
 * is. A seed-címet a fő vezető a seedben javítja, nem ez a szabály.
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis, hálózat vagy naplózás; a bemenetet nem
 * módosítja. A hívó (src/scripts/apply-owner-content.ts, a fő vezető köti be)
 * a visszakapott `layout`-ot a kezdőlap KÖZZÉTETT változatába írja
 * (`payload.update`, `draft` nélkül), a `naplo` sorait pedig a loggerrel
 * naplózza. `layout === null`: nincs mit írni.
 */

/** A kezdőlapi SOS-sáv WP26 előtti, élő CMS-címe (U+2014 kvirtmínusszal). */
export const SOS_CIM_REGI = 'SOS Kézrelax \u2014 ingyenes villámkurzus'

/**
 * A tulajdonos 2026-09-07-i szó szerinti címe (WP26). Betűre egyezik a
 * `FREE_SOS_STRIP_TITLE` tartalékkal (FreeSos.tsx); az egyezést teszt őrzi
 * (src/__tests__/sos-cim-kitoltes.test.ts). A konstans azért nem onnan jön,
 * mert a komponens-modul CSS-t és React-függőséget húz be, a szkript pedig
 * Node alatt, bundler nélkül fut.
 */
export const SOS_CIM_UJ = 'Ingyenes villámkurzus'

/** Egy `freeSos` blokk sorsa. */
export type SosCimBlokkAllapot =
  /** A cím a régi alak vagy üres volt, és „Ingyenes villámkurzus” lett. */
  | 'KITOLTVE'
  /** A cím már „Ingyenes villámkurzus”, nincs teendő. */
  | 'MAR'
  /** Szerkesztői (vagy seed-) szöveg, ehhez a szabály nem nyúl. */
  | 'ERINTETLEN'

/**
 * A teljes futás állapota.
 * - `KITOLTVE`: legalább egy cím átíródott, a `layout` az új szekciósor.
 * - `MAR`: nincs mit írni, és legalább egy sáv címe már a cél; az ismételt
 *   futás mindig ezt adja, ha az első `KITOLTVE` volt.
 * - `ERINTETLEN`: nincs mit írni, minden sáv szerkesztői szöveget visel.
 * - `NINCS_FREESOS`: a szekciósorban nincs SOS-sáv (vagy nem tömb).
 */
export type SosCimAllapot = SosCimBlokkAllapot | 'NINCS_FREESOS'

/** Blokkonkénti naplósor. */
export interface SosCimBlokkNaplo {
  /** A blokk helye a szekciósorban, 0-tól. */
  index: number
  /** A blokk Payload-azonosítója, ha van. */
  blokkId: string | null
  /** A cím a futás előtt; hiányzó, null vagy nem szöveg értéknél null. */
  regiCim: string | null
  allapot: SosCimBlokkAllapot
  /** Magyar naplósor az üzemeltetőnek. */
  uzenet: string
}

/** A szabály eredménye. */
export interface SosCimKitoltes {
  allapot: SosCimAllapot
  /** Az új szekciósor, ha legalább egy cím változott; különben null (nincs mit írni). */
  layout: unknown[] | null
  naplo: SosCimBlokkNaplo[]
}

type Rekord = Readonly<Record<string, unknown>>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Egyetlen cím-érték besorolása.
 *
 * A `MAR` trim után vizsgál: a komponens is trimelve mutatja, tehát a szélső
 * szóközzel mentett „Ingyenes villámkurzus” a lapon már helyes, átírni nem kell.
 */
export function sosCimAllapota(title: unknown): SosCimBlokkAllapot {
  if (title === undefined || title === null) {
    return 'KITOLTVE'
  }
  if (typeof title !== 'string') {
    return 'ERINTETLEN'
  }
  const trimmed = title.trim()
  if (trimmed === SOS_CIM_UJ) {
    return 'MAR'
  }
  if (trimmed.length === 0 || trimmed === SOS_CIM_REGI) {
    return 'KITOLTVE'
  }
  return 'ERINTETLEN'
}

function naploSor(
  oldalNev: string,
  index: number,
  blokkId: string | null,
  title: unknown,
  allapot: SosCimBlokkAllapot,
): string {
  const hely = `${oldalNev}, ${index + 1}. szekció (SOS-sáv${blokkId ? `, azonosító: ${blokkId}` : ''})`
  const ures =
    title === undefined ||
    title === null ||
    (typeof title === 'string' && title.trim().length === 0)
  switch (allapot) {
    case 'KITOLTVE':
      return ures
        ? `${hely}: az üres cím helyére „${SOS_CIM_UJ}” került.`
        : `${hely}: a cím „${String(title)}” helyett „${SOS_CIM_UJ}” lett.`
    case 'MAR':
      return `${hely}: a cím már „${SOS_CIM_UJ}”, nincs teendő.`
    case 'ERINTETLEN':
      return typeof title === 'string'
        ? `${hely}: a cím „${title}”, ez nem a régi alapérték, szerkesztői szövegként érintetlen marad.`
        : `${hely}: a cím nem szöveg (${typeof title}), érintetlen marad.`
  }
}

/**
 * A szabály: a szekciósor minden `freeSos` blokkjára lefut.
 *
 * @param layout A kezdőlap `layout` mezője (bármilyen alakú lehet; rossz
 *   alakú bemenetre sem dob).
 * @param oldalNev A naplósorok elején álló oldalnév.
 */
export function kitoltSosCim(layout: unknown, oldalNev = 'Kezdőlap'): SosCimKitoltes {
  if (!Array.isArray(layout)) {
    return { allapot: 'NINCS_FREESOS', layout: null, naplo: [] }
  }

  const naplo: SosCimBlokkNaplo[] = []
  let valtozott = false
  const uj = layout.map((blokk: unknown, index: number): unknown => {
    if (!isRekord(blokk) || blokk.blockType !== 'freeSos') {
      return blokk
    }
    const blokkId = typeof blokk.id === 'string' && blokk.id.length > 0 ? blokk.id : null
    const title = blokk.title
    const allapot = sosCimAllapota(title)
    naplo.push({
      index,
      blokkId,
      regiCim: typeof title === 'string' ? title : null,
      allapot,
      uzenet: naploSor(oldalNev, index, blokkId, title, allapot),
    })
    if (allapot !== 'KITOLTVE') {
      return blokk
    }
    valtozott = true
    return { ...blokk, title: SOS_CIM_UJ }
  })

  if (naplo.length === 0) {
    return { allapot: 'NINCS_FREESOS', layout: null, naplo }
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
