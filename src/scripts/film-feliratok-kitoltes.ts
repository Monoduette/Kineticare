import {
  FILM_CAPTION_DEFAULTS,
  FILM_CAPTION_FIELDS,
  type FilmCaptionField,
} from '../lib/film-captions'

/**
 * Előtöltő szabály: a kezdőlapi nyitó videó (`filmHero` blokk) beúszó
 * feliratainak mezői.
 *
 * MIÉRT KELL: 2026-09-22-től a két felirat CMS-mező (a blokk `captions`
 * csoportja, src/blocks/film-hero.ts). A migráció után minden érték NULL, a
 * lapon ilyenkor a beépített szöveg látszik (src/lib/film-captions.ts), az
 * adminban viszont üres mezőt látna a szerkesztő, és nem tudná, mit ír át.
 * Ez a szabály az ÜRES mezőkbe beírja a ma látható szöveget, így az admin azt
 * mutatja, ami a lapon van (R1 2. vezetői döntés), a lap látványa pedig nem
 * változik.
 *
 * HATÁR: csak az üres mezőbe ír (hiányzó, undefined, null vagy csak szóköz).
 * Minden más értéket szerkesztői szövegnek tekint, és betűre érintetlenül
 * hagy. Nem szöveg típusú értéket (pl. szám) sem ír felül: az nem üres, és
 * nem a szabály dolga eldönteni, mi legyen vele.
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis, hálózat vagy naplózás; a bemenetet nem
 * módosítja (csak a megváltozott blokk és annak `captions` csoportja kap új
 * objektumot). Hibás alakú bemenetre sem dob. A hívó
 * (src/scripts/apply-owner-content.ts, a fő vezető köti be) a visszakapott
 * `layout`-ot írja a kezdőlapra, a `kitoltottMezok` sorait a loggerrel
 * naplózza. `layout === null`: nincs mit írni.
 */

/**
 * A futás állapota.
 * - `KITOLTVE`: legalább egy mező kapott beépített szöveget.
 * - `MAR`: van nyitó videó blokk, de minden mezője ki van töltve (az ismételt
 *   futás mindig ezt adja).
 * - `NINCS_FILMHERO`: a szekciósorban nincs nyitó videó blokk (vagy nem tömb).
 */
export type FilmFeliratKitoltesAllapot = 'KITOLTVE' | 'MAR' | 'NINCS_FILMHERO'

/** Egy kitöltött mező helye és új értéke. */
export interface KitoltottFeliratMezo {
  /** A blokk helye a szekciósorban, 0-tól. */
  index: number
  /** A blokk Payload-azonosítója, ha van. */
  blokkId: string | null
  mezo: FilmCaptionField
  /** A mező útvonala a dokumentumban, pl. `layout.0.captions.midTitle`. */
  utvonal: string
  /** A beírt beépített szöveg. */
  ertek: string
}

export interface FilmFeliratKitoltes {
  allapot: FilmFeliratKitoltesAllapot
  /** Az új szekciósor, ha legalább egy mező változott; különben null. */
  layout: unknown[] | null
  kitoltottMezok: KitoltottFeliratMezo[]
}

type Rekord = Readonly<Record<string, unknown>>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Üres-e a mező a szabály szerint: hiányzik, undefined, null vagy csak szóköz. */
export function uresFeliratMezo(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * A nyitó videó blokkok üres feliratmezőinek kitöltése a beépített szöveggel.
 *
 * @param layout egy oldal `layout` mezője, ahogy az adatbázisból jön (ismeretlen alak)
 */
export function filmFeliratokKitoltese(layout: unknown): FilmFeliratKitoltes {
  if (!Array.isArray(layout)) {
    return { allapot: 'NINCS_FILMHERO', layout: null, kitoltottMezok: [] }
  }
  const kitoltottMezok: KitoltottFeliratMezo[] = []
  let vanFilmHero = false
  const ujLayout = layout.map((blokk: unknown, index: number): unknown => {
    if (!isRekord(blokk) || blokk.blockType !== 'filmHero') {
      return blokk
    }
    vanFilmHero = true
    const regiCaptions = isRekord(blokk.captions) ? blokk.captions : {}
    const blokkId = typeof blokk.id === 'string' && blokk.id.length > 0 ? blokk.id : null
    const ujCaptions: Record<string, unknown> = { ...regiCaptions }
    let valtozott = false
    for (const mezo of FILM_CAPTION_FIELDS) {
      if (!uresFeliratMezo(regiCaptions[mezo])) {
        continue
      }
      const ertek = FILM_CAPTION_DEFAULTS[mezo]
      ujCaptions[mezo] = ertek
      valtozott = true
      kitoltottMezok.push({
        index,
        blokkId,
        mezo,
        utvonal: `layout.${index}.captions.${mezo}`,
        ertek,
      })
    }
    return valtozott ? { ...blokk, captions: ujCaptions } : blokk
  })
  if (!vanFilmHero) {
    return { allapot: 'NINCS_FILMHERO', layout: null, kitoltottMezok: [] }
  }
  if (kitoltottMezok.length === 0) {
    return { allapot: 'MAR', layout: null, kitoltottMezok: [] }
  }
  return { allapot: 'KITOLTVE', layout: ujLayout, kitoltottMezok }
}
