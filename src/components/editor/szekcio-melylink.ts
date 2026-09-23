/**
 * Szekció-mélylink: egy oldal szerkesztőjének címe, amely egy adott szekciót
 * (blokkot) nyit meg, például
 * `/admin/collections/pages/1?szekcio=6ab2d1c655cfcd3e03073521`.
 *
 * Tiszta, React- és Payload-mentes modul. Két fél használja ugyanazt:
 * - az admin átirányító nézete (`/admin/kezdolap-video`, VideoSzovegeiNezet)
 *   és a 2. kör frontend „Szerkesztem” rétege ÉPÍTI a címet;
 * - az admin mélylink-nyitója (src/components/editor/admin/SzekcioMegnyito.tsx)
 *   ÉRTELMEZI: melyik dokumentum szerkesztője nyílt meg, és érvényes-e a
 *   szekció-azonosító.
 *
 * MIÉRT MÉLYLINK ÉS NEM KÜLÖN ŰRLAP. A modul-térkép kutatása szerint a
 * vezető tartalomkezelők (Sanity, Storyblok, Contentful, Shopify) a látott
 * elemtől a szerkesztő PONTOS helyére visznek, a Drupal pedig a helyben
 * szerkesztést (Quick Edit) „numerous technical, usability, and accessibility
 * limitations” miatt kivette az alapprofilból, miközben a „Contextual Links”
 * (a tartalom szerkesztő-űrlapját megnyitó link) megmaradt
 * (https://www.drupal.org/node/3227039). A natív szerkesztő megtartja a
 * piszkozatot, a verziókat, a dokumentumzárat és a validálást.
 *
 * A BLOKK-AZONOSÍTÓ FORMÁTUMA. A Payload a tömb- és blokksorok azonosítóját
 * `new ObjectId().toHexString()`-gel adja (node_modules/payload/dist/fields/
 * baseFields/baseIDField.js), ez 24 kisbetűs hexadecimális jegy. Mérve
 * 2026-09-22: az élő adat 34 szekció-azonosítójából 34, a helyi adatbázis
 * pages_blocks_film_hero és _pages_v_blocks_film_hero tábláiban 2/2 és 39/39
 * ilyen alakú. A paraméter ezért csak erre a mintára illeszkedve kerül
 * összehasonlításra; HTML-be, URL-be vagy átirányításba sosem (nincs XSS,
 * nincs nyílt átirányítás).
 *
 * MEZŐ-MÉLYLINK (H06, H50/B26). A `?mezo=<mezőútvonal>` paraméter a mélylinket
 * a szekción belül (vagy szekció nélküli dokumentumon) egy MEZŐIG viszi:
 * - szekcióval: `?szekcio=<blokkId>&mezo=captions`: a mezőútvonal a szekción
 *   (blokksoron) belüli, relatív útvonal;
 * - szekció nélkül: `/admin/collections/products/12?mezo=howItWorks`: a
 *   mezőútvonal a dokumentum gyökeréhez képest értendő (a névtelen fülek,
 *   sorok és csukható dobozok nem részei az útvonalnak, a nevesített
 *   csoportok és fülek igen, pl. `seo.title`).
 * A mezőútvonal a Payload mezőneveiből áll (betűvel kezdődő azonosítók,
 * ponttal tagolva), legfeljebb 128 karakter; sorindexet nem tartalmazhat.
 * Ugyanaz a szabály érvényes rá, mint a szekció-azonosítóra: csak mintával
 * ellenőrzött összehasonlításra és CSS.escape-pel képzett szelektorba kerül.
 */

/** Az URL-paraméter neve: `?szekcio=<blokk-azonosító>`. */
export const SZEKCIO_PARAM = 'szekcio'

/** Az URL-paraméter neve: `?mezo=<mezőútvonal>`. */
export const MEZO_PARAM = 'mezo'

/**
 * A mezőútvonal alakja: ponttal tagolt Payload-mezőnevek (pl. `captions`,
 * `howItWorks`, `seo.title`). Minden tag betűvel kezdődik, utána betű, szám
 * vagy aláhúzás állhat; az egész legfeljebb 128 karakter.
 */
export const MEZO_UTVONAL_MINTA = /^(?=.{1,128}$)[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/

/** Érvényes-e a mezőútvonal (típusszűkítő). */
export function ervenyesMezoUtvonal(ertek: unknown): ertek is string {
  return typeof ertek === 'string' && MEZO_UTVONAL_MINTA.test(ertek)
}

/**
 * A `?mezo=` paraméter értelmezése: az érvényes mezőútvonal, vagy null, ha a
 * paraméter hiányzik vagy hibás alakú. Elfogad `URLSearchParams`-ot és
 * keresőszöveget is (a vezető `?` elhagyható).
 */
export function mezoParameter(search: URLSearchParams | string): string | null {
  const parameterek = typeof search === 'string' ? new URLSearchParams(search) : search
  const ertek = parameterek.get(MEZO_PARAM)
  return ervenyesMezoUtvonal(ertek) ? ertek : null
}

/**
 * A Payload mező-dobozának (vagy beviteli elemének) DOM-azonosítója egy
 * abszolút mezőútvonalhoz: `field-` előtag, a pontok helyén `__`
 * (@payloadcms/ui/dist/utilities/generateFieldID.js:5, és ugyanígy
 * fields/Group/index.js:72, fields/Array/index.js:293,
 * fields/Blocks/index.js:304, fields/Text/Input.js:117,
 * fields/Textarea/Input.js:81). Például `layout.0.captions` →
 * `field-layout__0__captions`.
 */
export function mezoDomId(abszolutUtvonal: string): string {
  return `field-${abszolutUtvonal.split('.').join('__')}`
}

/** A Payload blokk-azonosítójának alakja (bson ObjectId, 24 hex jegy). */
export const BLOKK_ID_MINTA = /^[a-f0-9]{24}$/

/** Collection-slug: kisbetű, szám, kötőjel (a Payload slugjai ilyenek). */
const GYUJTEMENY_MINTA = /^[a-z0-9][a-z0-9-]*$/

/** Dokumentum-azonosító az URL-ben: szám (Postgres) vagy ObjectId-szerű jel. */
const DOKUMENTUM_ID_MINTA = /^[A-Za-z0-9_-]+$/

/** A Payload saját, dokumentum-azonosítónak látszó útvonal-szavai. */
const NEM_DOKUMENTUM = new Set(['create'])

/** Érvényes-e a blokk-azonosító (típusszűkítő). */
export function ervenyesBlokkId(ertek: unknown): ertek is string {
  return typeof ertek === 'string' && BLOKK_ID_MINTA.test(ertek)
}

/** Az admin-útvonal normalizálása: a gyökér (`/`) üres előtag, a záró perjel lekerül. */
function adminElotag(adminRoute: string): string {
  const levagott = adminRoute.replace(/\/+$/, '')
  return levagott === '' ? '' : levagott.startsWith('/') ? levagott : `/${levagott}`
}

export interface SzekcioMelylinkAdatok {
  /** A Payload admin-útvonala (config.routes.admin), alapból `/admin`. */
  adminRoute?: string
  /** A collection slugja, pl. `pages`. */
  collection: string
  /** A dokumentum azonosítója. */
  id: number | string
  /** A megnyitandó szekció (blokk) azonosítója; hiányában a szerkesztő teteje nyílik. */
  blokkId?: string | null
  /**
   * A megnyitandó mező útvonala (MEZO_UTVONAL_MINTA). Ha a `blokkId` meg van
   * adva (akár null is), a szekción belüli relatív útvonal; ha nincs megadva
   * (undefined), a dokumentum gyökeréhez képest értendő.
   */
  mezo?: string | null
}

/**
 * A szerkesztő címe, érvényes blokk-azonosítónál a `?szekcio=` paraméterrel,
 * megadott mezőnél a `?mezo=` paraméterrel.
 *
 * Hibás collection, dokumentum-azonosító vagy mezőútvonal programhiba, ezért
 * dob: a hívó adatbázisból kapott azonosítóval és kódkonstans mezőnévvel
 * hívja, és hibás címet nem adhat ki. A hiányzó vagy hibás alakú
 * blokk-azonosító viszont nem hiba (az adat elavulhat): ilyenkor a
 * szerkesztő szekció nélkül nyílik, a lap tetején. Ha a hívó szekciót kért
 * (a `blokkId` meg van adva), de az hibás vagy null, a szekcióhoz relatív
 * mező is elmarad, mert szekció nélkül mást jelentene.
 *
 * A paramétereket az URLSearchParams kódolja (a mai `?szekcio=<24 hex>`
 * kimenet ettől betűre változatlan: a hexadecimális jegyeket nem kódolja).
 */
export function szekcioMelylink({
  adminRoute = '/admin',
  collection,
  id,
  blokkId,
  mezo,
}: SzekcioMelylinkAdatok): string {
  if (mezo !== undefined && mezo !== null && !ervenyesMezoUtvonal(mezo)) {
    throw new TypeError(`A szerkesztő címéhez adott mezőútvonal nem értelmezhető: ${mezo}`)
  }
  if (!GYUJTEMENY_MINTA.test(collection)) {
    throw new TypeError(
      `A szerkesztő címéhez adott collection-slug nem értelmezhető: ${collection}`,
    )
  }
  const idSzoveg = typeof id === 'number' ? String(id) : id
  if (
    (typeof id === 'number' && (!Number.isInteger(id) || id < 0)) ||
    !DOKUMENTUM_ID_MINTA.test(idSzoveg) ||
    NEM_DOKUMENTUM.has(idSzoveg)
  ) {
    throw new TypeError(
      `A szerkesztő címéhez adott dokumentum-azonosító nem értelmezhető: ${idSzoveg}`,
    )
  }
  const alap = `${adminElotag(adminRoute)}/collections/${collection}/${idSzoveg}`
  const parameterek = new URLSearchParams()
  const szekcioKert = blokkId !== undefined
  const szekcioErvenyes = ervenyesBlokkId(blokkId)
  if (szekcioErvenyes) {
    parameterek.set(SZEKCIO_PARAM, blokkId)
  }
  if (typeof mezo === 'string' && (szekcioErvenyes || !szekcioKert)) {
    parameterek.set(MEZO_PARAM, mezo)
  }
  const kereso = parameterek.toString()
  return kereso === '' ? alap : `${alap}?${kereso}`
}

export interface SzerkesztoUtvonal {
  collection: string
  id: string
}

/**
 * Ha az útvonal PONTOSAN egy dokumentum szerkesztője
 * (`<admin>/collections/<slug>/<id>`), a collection és az azonosító; minden
 * más útvonalon (lista, új dokumentum, verziók, API) null.
 */
export function szerkesztoUtvonal(
  pathname: string,
  adminRoute: string = '/admin',
): SzerkesztoUtvonal | null {
  const elotag = `${adminElotag(adminRoute)}/collections/`
  if (!pathname.startsWith(elotag)) {
    return null
  }
  const reszek = pathname.slice(elotag.length).replace(/\/+$/, '').split('/')
  if (reszek.length !== 2) {
    return null
  }
  const [collection, id] = reszek
  if (
    !collection ||
    !id ||
    !GYUJTEMENY_MINTA.test(collection) ||
    !DOKUMENTUM_ID_MINTA.test(id) ||
    NEM_DOKUMENTUM.has(id)
  ) {
    return null
  }
  return { collection, id }
}

/**
 * A blokk sorindexe egy dokumentum szekció-tömbjében, vagy null, ha a
 * dokumentumban nincs ilyen azonosítójú szekció (elavult link).
 */
export function szekcioIndexe(layout: unknown, blokkId: string): number | null {
  if (!Array.isArray(layout)) {
    return null
  }
  const index = layout.findIndex(
    (blokk: unknown) =>
      typeof blokk === 'object' && blokk !== null && (blokk as { id?: unknown }).id === blokkId,
  )
  return index >= 0 ? index : null
}

/**
 * A Payload szekciósorának DOM-azonosítója. A Blocks mező a sort
 * `${parentPath.split('.').join('-')}-row-${rowIndex}` azonosítóval rajzolja
 * (@payloadcms/ui/dist/fields/Blocks/BlockRow.js:108), a legfelső szintű
 * `layout` mezőnél ez `layout-row-<index>`; az azonosító tehát INDEX-alapú,
 * nem a blokk-azonosítóból képzett (modul-térkép, deeplink-probe.json).
 */
export function szekcioSorDomId(mezoUtvonal: string, index: number): string {
  return `${mezoUtvonal.split('.').join('-')}-row-${String(index)}`
}
