/**
 * CSS-geometria teszt-segéd: stíluslapok parse-olása, kaszkád, @media kiértékelés,
 * `var(--kc-*)` feloldás. Komponens-tesztek layout/méret ellenőrzéséhez.
 */

import { readFileSync } from 'node:fs'

/** Egy CSS-szabály: a vesszős szelektorlista és a deklarációk. */
type Szabaly = {
  readonly szelektorok: readonly string[]
  readonly deklaraciok: ReadonlyMap<string, string>
}

/** Elem a modellben: az elemnév és a rá illeszkedő osztály (ha van). */
export type Elem = {
  /** Elemnév kisbetűvel, pl. `h2`, `p`, `li`. Üres a puszta osztály-gyökérnél. */
  readonly elemnev: string
  /** A szülő az öröklődési láncban (a `.kc-richtext` gyökér szülője null). */
  readonly szulo: Elem | null
  /** Az elemre illeszkedő osztály, pl. `.kc-richtext` (a gyökéren), különben null. */
  readonly osztaly: string | null
  /** A leszármazott-szelektor előtagja, pl. `.kc-richtext` a `.kc-richtext h2`-höz. */
  readonly ostagOsztaly: string | null
}

const KOMMENT = /\/\*[\s\S]*?\*\//g

/** Egy stíluslap szabályai, kommentek nélkül, forrás-sorrendben. */
export function szabalyok(css: string): readonly Szabaly[] {
  const tiszta = css.replace(KOMMENT, '')
  const eredmeny: Szabaly[] = []
  const minta = /([^{}@]+)\{([^{}]*)\}/g
  let talalat: RegExpExecArray | null
  while ((talalat = minta.exec(tiszta)) !== null) {
    const fej = talalat[1].trim()
    if (fej.length === 0) continue
    const deklaraciok = new Map<string, string>()
    for (const darab of talalat[2].split(';')) {
      const ketto = darab.indexOf(':')
      if (ketto < 0) continue
      const kulcs = darab.slice(0, ketto).trim()
      const ertek = darab.slice(ketto + 1).trim()
      if (kulcs.length > 0 && ertek.length > 0) deklaraciok.set(kulcs, ertek)
    }
    eredmeny.push({
      szelektorok: fej.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
      deklaraciok,
    })
  }
  return eredmeny
}

/** Több stíluslap egy kaszkáddá fűzve (a `styles.css` @import-sorrendjében). */
export function stilusLap(fajlok: readonly string[]): readonly Szabaly[] {
  return fajlok.flatMap((fajl) => szabalyok(readFileSync(fajl, 'utf8')))
}

/**
 * Egy média-lekérdezés érvényes-e adott nézetablak-szélességen és -magasságon.
 *
 * A vessző VAGY, az `and` ÉS (Media Queries 4, 3.1 és 3.2). Csak azt a néhány
 * jellemzőt ismeri, amit a repó ténylegesen használ; bármi másra HANGOSAN dob,
 * mert egy fel nem ismert lekérdezést némán érvényesnek (vagy érvénytelennek)
 * venni pontosan az a hibaosztály, ami ellen ezek az őrök készültek.
 * A `print` és a `prefers-reduced-motion: reduce` a képernyős, alapbeállítású
 * mérésben nem érvényes.
 */
function mediaErvenyes(
  prelude: string,
  nezetablakPx: number,
  magassagPx: number,
  kezdoBetumeretPx: number,
): boolean {
  // Minden feltételt ellenőrzünk: a rövidzár nem rejthet el ismeretlen jellemzőt.
  return prelude
    .split(',')
    .map((ag) =>
      ag
        .split(/\s+and\s+/i)
        .map((feltetel) => {
          const t = feltetel.trim().toLowerCase()
          if (t === 'screen' || t === 'all') return true
          if (t === 'print') return false
          const m = /^\(\s*(min|max)-(width|height)\s*:\s*(\d*\.?\d+)(px|em|rem)\s*\)$/.exec(t)
          if (m) {
            // Media-relative units use the initial browser font, not authored
            // root/element styles: https://www.w3.org/TR/mediaqueries-4/#units
            const hatar = Number(m[3]) * (m[4] === 'px' ? 1 : kezdoBetumeretPx)
            const meret = m[2] === 'height' ? magassagPx : nezetablakPx
            return m[1] === 'min' ? meret >= hatar : meret <= hatar
          }
          if (/^\(\s*prefers-reduced-motion\s*:/.test(t)) return false
          throw new Error(`ismeretlen média-jellemző: „${feltetel.trim()}" — az őr nem tud dönteni`)
        })
        .every(Boolean),
    )
    .some(Boolean)
}

/**
 * At-szabályok kilapítása adott nézetablakra: az érvényes `@media` és a
 * `@supports` TÖRZSE a lapba kerül, a nem érvényes `@media`, a `@font-face` és
 * a `@keyframes` kimarad. Enélkül a szabály-olvasó a média-blokkokba zárt
 * deklarációkat feltétel nélkül érvényesnek venné.
 */
function lapit(
  css: string,
  nezetablakPx: number,
  magassagPx: number,
  kezdoBetumeretPx: number,
): string {
  const tiszta = css.replace(KOMMENT, '')
  let ki = ''
  let i = 0
  while (i < tiszta.length) {
    const kukac = tiszta.indexOf('@', i)
    if (kukac < 0) {
      ki += tiszta.slice(i)
      break
    }
    ki += tiszta.slice(i, kukac)
    let j = kukac
    while (j < tiszta.length && tiszta[j] !== '{' && tiszta[j] !== ';') j++
    if (j >= tiszta.length || tiszta[j] === ';') {
      // `@import`, `@charset` — nincs törzse.
      i = j + 1
      continue
    }
    const fej = tiszta.slice(kukac + 1, j).trim()
    const nev = fej.split(/\s+/)[0].toLowerCase()
    const prelude = fej.slice(nev.length).trim()
    let szint = 0
    let k = j
    for (; k < tiszta.length; k++) {
      if (tiszta[k] === '{') szint++
      else if (tiszta[k] === '}') {
        szint--
        if (szint === 0) break
      }
    }
    const torzs = tiszta.slice(j + 1, k)
    if (nev === 'media') {
      const ervenyes = mediaErvenyes(prelude, nezetablakPx, magassagPx, kezdoBetumeretPx)
      // Az inaktív ág is validálandó, de a deklarációi nem kerülnek a kaszkádba.
      const belso = lapit(torzs, nezetablakPx, magassagPx, kezdoBetumeretPx)
      if (ervenyes) ki += belso
    } else if (nev === 'supports' || nev === 'layer') {
      ki += lapit(torzs, nezetablakPx, magassagPx, kezdoBetumeretPx)
    } else if (nev !== 'font-face' && nev !== 'keyframes' && nev !== 'page' && nev !== 'property') {
      throw new Error(`ismeretlen at-szabály: @${nev} — az őr nem tudja, érvényes-e`)
    }
    i = k + 1
  }
  return ki
}

/** Több stíluslap egy kaszkáddá fűzve, ADOTT nézetablakra kiértékelt @media-kkal. */
export function stilusLapNezetablakra(
  fajlok: readonly string[],
  nezetablakPx: number,
  magassagPx: number,
  // Existing geometry fixtures assume the browser's default 16px initial font.
  // Callers modelling a user font preference must pass that initial size.
  kezdoBetumeretPx = 16,
): readonly Szabaly[] {
  if (!Number.isFinite(magassagPx) || magassagPx <= 0) {
    throw new Error('érvényes, explicit nézetablak-magasság szükséges az őr méréséhez')
  }
  if (!Number.isFinite(kezdoBetumeretPx) || kezdoBetumeretPx <= 0) {
    throw new Error('érvényes kezdeti betűméret szükséges az őr méréséhez')
  }
  return fajlok.flatMap((fajl) =>
    szabalyok(lapit(readFileSync(fajl, 'utf8'), nezetablakPx, magassagPx, kezdoBetumeretPx)),
  )
}

/** A `:root` alatt deklarált egyéni tulajdonságok (`--kc-*`). */
export function tokenek(lap: readonly Szabaly[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const szabaly of lap) {
    if (!szabaly.szelektorok.includes(':root')) continue
    for (const [kulcs, ertek] of szabaly.deklaraciok) {
      if (kulcs.startsWith('--')) map.set(kulcs, ertek)
    }
  }
  return map
}

/** `var(--x)` és `var(--x, tartalék)` rekurzív behelyettesítése. */
export function varFeloldas(ertek: string, map: ReadonlyMap<string, string>, melyseg = 0): string {
  if (melyseg > 12) throw new Error(`körkörös var()-hivatkozás: ${ertek}`)
  if (!ertek.includes('var(')) return ertek
  const kezd = ertek.indexOf('var(')
  let szint = 0
  let veg = kezd + 3
  for (; veg < ertek.length; veg++) {
    if (ertek[veg] === '(') szint++
    else if (ertek[veg] === ')') {
      szint--
      if (szint === 0) break
    }
  }
  const belso = ertek.slice(kezd + 4, veg)
  const vesszo = belso.indexOf(',')
  const nev = (vesszo < 0 ? belso : belso.slice(0, vesszo)).trim()
  const tartalek = vesszo < 0 ? null : belso.slice(vesszo + 1).trim()
  const hivatkozott = map.get(nev) ?? tartalek
  if (hivatkozott === null || hivatkozott === undefined) {
    throw new Error(`ismeretlen egyéni tulajdonság: ${nev}`)
  }
  return varFeloldas(ertek.slice(0, kezd) + hivatkozott + ertek.slice(veg + 1), map, melyseg + 1)
}

/**
 * Hossz-kifejezés pixelben: `px`, `rem`, `em`, `ch`, `vw`, összeadás és
 * `clamp()`.
 *
 * A `ch` a „0" (U+0030) glif ELŐRETOLÁSA az elem saját betűjén (CSS Values 4,
 * 5.1.1), ezért a hívónak a valódi metszetből mért `chPx`-et kell átadnia; a
 * címsor-osztályok mértéke (`max-width: 30ch`, `62ch`) enélkül nem oldható fel.
 * Ha a kifejezés `ch`-t tartalmaz, de `chPx` nincs megadva, HANGOSAN dob — az
 * őr nem becsülhet ott, ahol mérni kell.
 */
export function hosszPx(
  kifejezes: string,
  nezetablakPx: number,
  szuloBetumeretPx: number,
  gyokerBetumeretPx = 16,
  chPx: number | null = null,
): number {
  const szoveg = kifejezes.trim()
  if (szoveg === 'normal' || szoveg === '0') return 0
  if (szoveg === 'none') return Infinity
  if (szoveg.startsWith('clamp(')) {
    const reszek = felsoSzintuVesszok(szoveg.slice(6, -1))
    if (reszek.length !== 3) throw new Error(`hibás clamp(): ${szoveg}`)
    const [also, alap, felso] = reszek.map((r) =>
      hosszPx(r, nezetablakPx, szuloBetumeretPx, gyokerBetumeretPx, chPx),
    )
    return Math.min(Math.max(alap, also), felso)
  }
  if (szoveg.startsWith('min(') || szoveg.startsWith('max(')) {
    const reszek = felsoSzintuVesszok(szoveg.slice(4, -1)).map((r) =>
      hosszPx(r, nezetablakPx, szuloBetumeretPx, gyokerBetumeretPx, chPx),
    )
    return szoveg.startsWith('min(') ? Math.min(...reszek) : Math.max(...reszek)
  }
  // Egyszerű összeg (`0.9464rem + 0.2679vw`) — a CSS a clamp() közepén ezt használja.
  let osszeg = 0
  for (const tag of szoveg.split('+')) {
    const t = tag.trim()
    const m = /^(-?\d*\.?\d+)(px|rem|em|ch|vw|vh|%)?$/.exec(t)
    if (!m) throw new Error(`nem értelmezhető hossz: „${t}" (${kifejezes})`)
    const szam = Number(m[1])
    switch (m[2]) {
      case undefined:
        osszeg += szam === 0 ? 0 : szam
        break
      case 'px':
        osszeg += szam
        break
      case 'rem':
        osszeg += szam * gyokerBetumeretPx
        break
      case 'em':
        osszeg += szam * szuloBetumeretPx
        break
      case 'ch':
        if (chPx === null) {
          throw new Error(`„ch" egység chPx nélkül nem oldható fel: ${kifejezes}`)
        }
        osszeg += szam * chPx
        break
      case 'vw':
        osszeg += (szam / 100) * nezetablakPx
        break
      default:
        throw new Error(`nem támogatott egység: ${m[2]}`)
    }
  }
  return osszeg
}

/**
 * Egy rövidítéses érték ELSŐ hossz-tagja (`border: 1px solid var(--x)` → `1px`).
 * A kártya-hasáb kiszámításához a keret vastagsága kell, a `border` rövidítésből.
 */
export function elsoHossz(ertek: string): string | null {
  for (const tag of ertek.trim().split(/\s+/)) {
    if (/^-?\d*\.?\d+(px|rem|em|ch|vw)$/.test(tag)) return tag
  }
  return null
}

/** Vesszős lista bontása a legfelső zárójel-szinten. */
function felsoSzintuVesszok(szoveg: string): string[] {
  const eredmeny: string[] = []
  let szint = 0
  let utolso = 0
  for (let i = 0; i < szoveg.length; i++) {
    const k = szoveg[i]
    if (k === '(') szint++
    else if (k === ')') szint--
    else if (k === ',' && szint === 0) {
      eredmeny.push(szoveg.slice(utolso, i))
      utolso = i + 1
    }
  }
  eredmeny.push(szoveg.slice(utolso))
  return eredmeny.map((r) => r.trim())
}

/** Egy szelektor illeszkedik-e az elemre, és ha igen, milyen fajsúllyal. */
function fajsuly(szelektor: string, elem: Elem): readonly [number, number, number] | null {
  if (elem.osztaly !== null && szelektor === elem.osztaly) return [0, 1, 0]
  // Osztály + osztály leszármazott-szelektor (`.kc-product-card .kc-product-card__title`).
  // Enélkül a kártya-címsorra írt `overflow-wrap: anywhere` LÁTHATATLAN lenne a
  // modellnek, és az őr olyan elemet jelentene tördeletlennek, amelyik törik.
  if (
    elem.osztaly !== null &&
    elem.ostagOsztaly !== null &&
    szelektor === `${elem.ostagOsztaly} ${elem.osztaly}`
  ) {
    return [0, 2, 0]
  }
  if (elem.elemnev.length === 0) return null
  if (szelektor === elem.elemnev) return [0, 0, 1]
  if (elem.ostagOsztaly !== null && szelektor === `${elem.ostagOsztaly} ${elem.elemnev}`) {
    return [0, 1, 1]
  }
  return null
}

const nagyobb = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2]

/**
 * Az elemre KÖZVETLENÜL érvényes deklaráció (kaszkád: fajsúly, majd sorrend).
 * Öröklődést nem néz — arra a `oroklottErtek` való.
 */
export function sajatErtekSullyal(
  lap: readonly Szabaly[],
  elem: Elem,
  tulajdonsag: string,
): { readonly suly: readonly [number, number, number]; readonly ertek: string } | null {
  let nyertes: { suly: readonly [number, number, number]; ertek: string } | null = null
  for (const szabaly of lap) {
    const ertek = szabaly.deklaraciok.get(tulajdonsag)
    if (ertek === undefined) continue
    for (const szelektor of szabaly.szelektorok) {
      const suly = fajsuly(szelektor, elem)
      if (suly === null) continue
      if (nyertes === null || nagyobb(suly, nyertes.suly)) nyertes = { suly, ertek }
    }
  }
  return nyertes
}

export function sajatErtek(
  lap: readonly Szabaly[],
  elem: Elem,
  tulajdonsag: string,
): string | null {
  return sajatErtekSullyal(lap, elem, tulajdonsag)?.ertek ?? null
}

/**
 * Ugyanaz a tulajdonság több írásmódban (`padding-left` és
 * `padding-inline-start`): a kaszkádban a NAGYOBB fajsúlyú deklaráció nyer,
 * egyenlőségnél a később írt. A folyószöveg-lista épp ilyen: a base.css
 * `ul, ol`-ra `padding-inline-start`-ot ír, a content.css `.kc-richtext ul`-ra
 * `padding-left`-et — a mért 240 px-es listaelem-hasáb (320 px-es nézetablak)
 * az utóbbit igazolja.
 */
export function sajatErtekTobbNeven(
  lap: readonly Szabaly[],
  elem: Elem,
  tulajdonsagok: readonly string[],
): string | null {
  let nyertes: { suly: readonly [number, number, number]; ertek: string } | null = null
  for (const tulajdonsag of tulajdonsagok) {
    const jelolt = sajatErtekSullyal(lap, elem, tulajdonsag)
    if (jelolt === null) continue
    if (nyertes === null || nagyobb(jelolt.suly, nyertes.suly)) nyertes = jelolt
  }
  return nyertes?.ertek ?? null
}

/** Öröklődő tulajdonság érvényes értéke: saját deklaráció, különben a szülőé. */
export function oroklottErtek(
  lap: readonly Szabaly[],
  elem: Elem,
  tulajdonsag: string,
  kezdoErtek: string,
): string {
  const sajat = sajatErtek(lap, elem, tulajdonsag)
  if (sajat !== null) return sajat
  if (elem.szulo === null) return kezdoErtek
  return oroklottErtek(lap, elem.szulo, tulajdonsag, kezdoErtek)
}
