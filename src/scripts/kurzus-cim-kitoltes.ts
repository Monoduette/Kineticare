/**
 * Kitöltő szabály: a kurzusok (products) üres „Kurzus címe” mezője
 * (`displayTitle`) megkapja a mai belső azonosítót (`sku`). Modul-térkép H25,
 * terv A12.
 *
 * MIÉRT KELL: élőben (2026-09-23, live-products.json) a három kurzusból
 * kettőnél üres a Kurzus címe, ezért a kártyán, a kurzusoldalon és az
 * SOS-sávban a „Belső azonosító” látszik (src/lib/courses.ts `courseTitle`:
 * displayTitle → sku). A szerkesztő az adminban üres mezőre érkezik, és nem
 * tudja, hogy a látott nevet a számlán is szereplő azonosító adja. Kitöltés
 * után a név a Kurzus címe mezőben szerkeszthető, a számla érintése nélkül.
 *
 * A LÁTVÁNY ÉS A WEBCÍM NEM VÁLTOZIK:
 *  - a beírt érték a trimmelt `sku`, pontosan az, amit a `courseTitle` ma is
 *    mutat (a `courseTitle` a displayTitle-t és az sku-t is trimmeli);
 *  - a módosítás a meglévő `slug`-ot is tartalmazza, így a webcím-hook
 *    (src/fields/course-slug.ts) az első ágán („változatlan → skip”) a régi
 *    slugot adja, lekérdezés nélkül, közzétett és piszkozat állapotban is;
 *  - webcím nélküli kurzust NEM tölt ki: ott a hook a mentéskor webcímet
 *    generálna, és a kurzus id-alapú címe megváltozna (ERINTETLEN, indokkal).
 *
 * HATÁR: csak az üres (hiányzó, null vagy csupa szóköz) Kurzus címét tölti,
 * és csak nem üres azonosító mellett. Kitöltött címhez nem nyúl: ha az
 * egyezik az azonosítóval, `MAR`, különben szerkesztői szövegként
 * `ERINTETLEN`. Nem szöveg típusú címet sem ír felül.
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis, hálózat vagy naplózás; a bemenetet nem
 * módosítja, hibás alakú bemenetre sem dob. A második futás a kitöltött
 * kurzusokra `MAR`-t ad. A hívó (src/scripts/apply-owner-content.ts, a fő
 * vezető köti be) a `modositasok` `data`-ját a kurzus KÖZZÉTETT változatába
 * írja (`payload.update`, `draft` nélkül), a `naplo` sorait a loggerrel
 * naplózza. `modositasok === null`: nincs mit írni.
 */

/** Egy kurzus sorsa. */
export type KurzusCimAllapot =
  /** Üres volt a Kurzus címe, a trimmelt azonosító került bele. */
  | 'KITOLTVE'
  /** A Kurzus címe már az azonosító (trim után), nincs teendő. */
  | 'MAR'
  /** Szerkesztői cím, vagy nem tölthető ki (nincs azonosító vagy webcím). */
  | 'ERINTETLEN'

/**
 * A teljes futás állapota: `KITOLTVE`, ha legalább egy kurzus változik;
 * különben `MAR`, ha van már kitöltött kurzus; különben `ERINTETLEN`;
 * `NINCS_TERMEK`, ha a lista üres vagy nem tömb.
 */
export type KurzusCimFutasAllapot = KurzusCimAllapot | 'NINCS_TERMEK'

/** Egy írandó módosítás: a `data` pontosan az, amit a `payload.update` kap. */
export interface KurzusCimModositas {
  id: number | string
  /** A kurzus utolsó módosítása a futás előtt (a piszkozat-figyelmeztetéshez). */
  updatedAt: string | null
  data: {
    displayTitle: string
    /** A meglévő webcím, változatlanul: a slug-hook így az első ágán marad. */
    slug: string
  }
}

export interface KurzusCimNaplo {
  id: number | string | null
  allapot: KurzusCimAllapot
  /** Magyar naplósor az üzemeltetőnek. */
  uzenet: string
}

export interface KurzusCimKitoltes {
  allapot: KurzusCimFutasAllapot
  /** Az írandó módosítások, vagy null, ha nincs mit írni. */
  modositasok: KurzusCimModositas[] | null
  naplo: KurzusCimNaplo[]
}

type Rekord = Readonly<Record<string, unknown>>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Nem üres, trimmelt szöveg, különben null. */
function nemUresSzoveg(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uresCim(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function azonositoja(termek: Rekord): number | string | null {
  const { id } = termek
  return typeof id === 'number' || typeof id === 'string' ? id : null
}

function hely(id: number | string | null, sku: string | null): string {
  const nev = id === null ? 'Azonosító nélküli kurzus' : `Kurzus #${String(id)}`
  return sku === null ? nev : `${nev} („${sku}”)`
}

/**
 * Egyetlen kurzus besorolása és (ha kell) a módosítása.
 * Exportálva a tesztekhez; a hívó a `kitoltKurzusCimeket`-et használja.
 */
export function kurzusCimSorsa(termek: unknown): {
  naplo: KurzusCimNaplo
  modositas: KurzusCimModositas | null
} {
  if (!isRekord(termek)) {
    return {
      naplo: {
        id: null,
        allapot: 'ERINTETLEN',
        uzenet: 'Nem értelmezhető kurzus-sor, érintetlen marad.',
      },
      modositas: null,
    }
  }
  const id = azonositoja(termek)
  const sku = nemUresSzoveg(termek.sku)
  const slug = nemUresSzoveg(termek.slug)
  const cim = termek.displayTitle
  const hol = hely(id, sku)
  const naplo = (allapot: KurzusCimAllapot, uzenet: string): KurzusCimNaplo => ({
    id,
    allapot,
    uzenet: `${hol}: ${uzenet}`,
  })

  if (!uresCim(cim)) {
    if (typeof cim !== 'string') {
      return {
        naplo: naplo('ERINTETLEN', `a Kurzus címe nem szöveg (${typeof cim}), érintetlen marad.`),
        modositas: null,
      }
    }
    if (sku !== null && cim.trim() === sku) {
      return {
        naplo: naplo('MAR', 'a Kurzus címe már az azonosító, nincs teendő.'),
        modositas: null,
      }
    }
    return {
      naplo: naplo(
        'ERINTETLEN',
        `a Kurzus címe „${cim}”, szerkesztői szövegként érintetlen marad.`,
      ),
      modositas: null,
    }
  }
  if (sku === null) {
    return {
      naplo: naplo('ERINTETLEN', 'a Kurzus címe és a belső azonosító is üres, nincs mit beírni.'),
      modositas: null,
    }
  }
  if (id === null) {
    return {
      naplo: naplo('ERINTETLEN', 'a kurzusnak nincs azonosítója, nem írható.'),
      modositas: null,
    }
  }
  if (slug === null) {
    return {
      naplo: naplo(
        'ERINTETLEN',
        'a kurzusnak nincs webcíme; mentéskor a rendszer webcímet generálna, és a kurzus azonosító alapú linkje megváltozna, ezért érintetlen marad.',
      ),
      modositas: null,
    }
  }
  return {
    naplo: naplo(
      'KITOLTVE',
      `az üres Kurzus címébe a belső azonosító került: „${sku}”. A lapon látszó név és a webcím nem változik.`,
    ),
    modositas: {
      id,
      updatedAt: typeof termek.updatedAt === 'string' ? termek.updatedAt : null,
      data: { displayTitle: sku, slug },
    },
  }
}

/**
 * A szabály a kurzusok listájára (a `payload.find` `docs`-a, `depth: 0`).
 * Hibás alakú bemenetre sem dob.
 */
export function kitoltKurzusCimeket(termekek: unknown): KurzusCimKitoltes {
  if (!Array.isArray(termekek) || termekek.length === 0) {
    return { allapot: 'NINCS_TERMEK', modositasok: null, naplo: [] }
  }
  const naplo: KurzusCimNaplo[] = []
  const modositasok: KurzusCimModositas[] = []
  for (const termek of termekek) {
    const sors = kurzusCimSorsa(termek)
    naplo.push(sors.naplo)
    if (sors.modositas !== null) {
      modositasok.push(sors.modositas)
    }
  }
  if (modositasok.length > 0) {
    return { allapot: 'KITOLTVE', modositasok, naplo }
  }
  return {
    allapot: naplo.some((sor) => sor.allapot === 'MAR') ? 'MAR' : 'ERINTETLEN',
    modositasok: null,
    naplo,
  }
}
