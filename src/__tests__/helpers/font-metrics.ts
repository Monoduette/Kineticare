/**
 * WOFF2 font-metrika olvasó teszt-segéd: brotli kicsomagolás, cmap/gvar/avar
 * feldolgozás, előretolás számítás változó betűkhöz.
 */

import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'

/** A woff2 ismert tábla-jelei, a spec 5. szakaszának sorrendjében (flags 0–62). */
const ISMERT_TABLAK = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
] as const

/** Egy metszet mérhető metrikája: em-egység és karakter → előretolás. */
export type BetuMetrika = {
  /** A tervezési egység (`head.unitsPerEm`) — a font fájljából olvasva. */
  readonly egysegPerEm: number
  /** Kódpont → előretolás em-ben (`hmtx.advanceWidth / unitsPerEm`). */
  readonly eloretolas: ReadonlyMap<number, number>
  /** A `wght` tengely beállított értéke, ha a metszet variábilis. */
  readonly suly: number | null
}

/** UIntBase128 (WOFF2 spec 4.1) — változó hosszú, 7 bites csoportos egész. */
function base128(buf: Buffer, pos: number): readonly [number, number] {
  let ertek = 0
  let p = pos
  for (let i = 0; i < 5; i++) {
    const b = buf[p]
    if (b === undefined) break
    p += 1
    ertek = ertek * 128 + (b & 0x7f)
    if ((b & 0x80) === 0) return [ertek, p] as const
  }
  throw new Error('hibás UIntBase128 a woff2 tábla-jegyzékben')
}

type Tabla = { readonly buf: Buffer; readonly transzformalt: boolean }

/** A woff2 konténer szétszedése táblákra (brotli-kicsomagolással). */
function tablak(fajl: string): ReadonlyMap<string, Tabla> {
  const buf = readFileSync(fajl)
  if (buf.toString('latin1', 0, 4) !== 'wOF2') {
    throw new Error(`nem woff2 fájl: ${fajl}`)
  }
  const tablaSzam = buf.readUInt16BE(12)
  const tomoritettMeret = buf.readUInt32BE(20)
  let pos = 48 // WOFF2Header fix mérete
  const jegyzek: { tag: string; hossz: number; transzformalt: boolean }[] = []
  for (let i = 0; i < tablaSzam; i++) {
    const flags = buf[pos]
    pos += 1
    const index = flags & 0x3f
    let tag: string
    if (index === 63) {
      tag = buf.toString('latin1', pos, pos + 4)
      pos += 4
    } else {
      tag = ISMERT_TABLAK[index] ?? `?${index}`
    }
    const transzformVerzio = (flags >> 6) & 0x03
    const [eredetiHossz, utan] = base128(buf, pos)
    pos = utan
    // Spec 5.: glyf/loca esetén a 0 jelenti a transzformációt (a 3 a null-t),
    // minden más táblánál fordítva — ott a 0 a null-transzformáció.
    const transzformalt =
      tag === 'glyf' || tag === 'loca' ? transzformVerzio === 0 : transzformVerzio !== 0
    let hossz = eredetiHossz
    if (transzformalt) {
      const [transzformaltHossz, utan2] = base128(buf, pos)
      hossz = transzformaltHossz
      pos = utan2
    }
    jegyzek.push({ tag, hossz, transzformalt })
  }
  const adat = brotliDecompressSync(buf.subarray(pos, pos + tomoritettMeret))
  const eredmeny = new Map<string, Tabla>()
  let eltolas = 0
  for (const be of jegyzek) {
    eredmeny.set(be.tag, {
      buf: adat.subarray(eltolas, eltolas + be.hossz),
      transzformalt: be.transzformalt,
    })
    eltolas += be.hossz
  }
  return eredmeny
}

/** cmap → kódpont ⇒ glif-azonosító (formátum 4 és 12). */
function cmapOlvas(tabla: Buffer): ReadonlyMap<number, number> {
  const alTablaSzam = tabla.readUInt16BE(2)
  let valasztott: { pontszam: number; eltolas: number; formatum: number } | null = null
  for (let i = 0; i < alTablaSzam; i++) {
    const p = 4 + i * 8
    const platform = tabla.readUInt16BE(p)
    const kodolas = tabla.readUInt16BE(p + 2)
    const eltolas = tabla.readUInt32BE(p + 4)
    const formatum = tabla.readUInt16BE(eltolas)
    if (formatum !== 4 && formatum !== 12) continue
    const pontszam = formatum === 12 ? 3 : platform === 3 && kodolas === 1 ? 2 : 1
    if (!valasztott || pontszam > valasztott.pontszam) valasztott = { pontszam, eltolas, formatum }
  }
  if (!valasztott) throw new Error('a cmap táblában nincs 4-es vagy 12-es formátumú altábla')
  const { eltolas, formatum } = valasztott
  const terkep = new Map<number, number>()
  if (formatum === 12) {
    const csoportok = tabla.readUInt32BE(eltolas + 12)
    for (let i = 0; i < csoportok; i++) {
      const p = eltolas + 16 + i * 12
      const kezd = tabla.readUInt32BE(p)
      const veg = tabla.readUInt32BE(p + 4)
      const elsoGlif = tabla.readUInt32BE(p + 8)
      for (let c = kezd; c <= veg; c++) terkep.set(c, elsoGlif + (c - kezd))
    }
    return terkep
  }
  const szegmensX2 = tabla.readUInt16BE(eltolas + 6)
  const szegmensek = szegmensX2 / 2
  const vegO = eltolas + 14
  const kezdO = vegO + szegmensX2 + 2
  const deltaO = kezdO + szegmensX2
  const rangeO = deltaO + szegmensX2
  for (let s = 0; s < szegmensek; s++) {
    const veg = tabla.readUInt16BE(vegO + s * 2)
    const kezd = tabla.readUInt16BE(kezdO + s * 2)
    const delta = tabla.readInt16BE(deltaO + s * 2)
    const rangeOffset = tabla.readUInt16BE(rangeO + s * 2)
    if (kezd === 0xffff) continue
    for (let c = kezd; c <= veg && c < 0x10000; c++) {
      let glif: number
      if (rangeOffset === 0) {
        glif = (c + delta) & 0xffff
      } else {
        const gi = rangeO + s * 2 + rangeOffset + (c - kezd) * 2
        if (gi + 1 >= tabla.length) continue
        glif = tabla.readUInt16BE(gi)
        if (glif !== 0) glif = (glif + delta) & 0xffff
      }
      if (glif !== 0) terkep.set(c, glif)
    }
  }
  return terkep
}

// ---------------------------------------------------------------------------
// Variábilis metszet: fvar + avar + HVAR
// ---------------------------------------------------------------------------
//
// A törzsbetű (`public/fonts/nunito-sans-var-*.woff2`) VARIÁBILIS, és a `wght`
// tengely alapértelmezése MÉRVE 200 — nem 400. A `hmtx` tábla ezért a 200-as
// metszet szélességeit hordozza; a 400-as (törzsszöveg) és a 700-as (h3–h6)
// előretolás a `HVAR` tábla eltérés-halmazaiból áll elő. Enélkül a számolt
// szó-szélesség ~3%-kal alábecsülne, ami épp a döntési határon (hasáb-szélesség)
// billenthetné el az őrt.
//
// Forrás: OpenType `fvar`, `avar`, `HVAR` és „Font Variations Common Table
// Formats" (ItemVariationStore, DeltaSetIndexMap), illetve az
// „Algorithm for interpolating instance values" szakasz,
// https://learn.microsoft.com/typography/opentype/spec/otvaroverview

const F2DOT14 = 16384

/** Egy tengely normalizált koordinátája (`fvar` + `avar` szerint). */
function normalizaltKoordinata(
  t: ReadonlyMap<string, Tabla>,
  tengelyJel: string,
  ertek: number,
): number | null {
  const fvar = t.get('fvar')
  if (!fvar) return null
  const tengelyEltolas = fvar.buf.readUInt16BE(4)
  const tengelySzam = fvar.buf.readUInt16BE(8)
  const tengelyMeret = fvar.buf.readUInt16BE(10)
  let index = -1
  let min = 0
  let alap = 0
  let max = 0
  for (let i = 0; i < tengelySzam; i++) {
    const p = tengelyEltolas + i * tengelyMeret
    if (fvar.buf.toString('latin1', p, p + 4) !== tengelyJel) continue
    index = i
    min = fvar.buf.readInt32BE(p + 4) / 65536
    alap = fvar.buf.readInt32BE(p + 8) / 65536
    max = fvar.buf.readInt32BE(p + 12) / 65536
    break
  }
  if (index < 0) return null
  const szoritott = Math.min(Math.max(ertek, min), max)
  let n =
    szoritott < alap
      ? alap === min
        ? 0
        : (szoritott - alap) / (alap - min)
      : szoritott > alap
        ? max === alap
          ? 0
          : (szoritott - alap) / (max - alap)
        : 0
  // avar: darabonként lineáris újratérképezés a tengely szegmens-térképével.
  const avar = t.get('avar')
  if (avar) {
    let p = 8
    for (let i = 0; i < avar.buf.readUInt16BE(6); i++) {
      const parok = avar.buf.readUInt16BE(p)
      p += 2
      const terkep: { be: number; ki: number }[] = []
      for (let j = 0; j < parok; j++) {
        terkep.push({
          be: avar.buf.readInt16BE(p) / F2DOT14,
          ki: avar.buf.readInt16BE(p + 2) / F2DOT14,
        })
        p += 4
      }
      if (i !== index || terkep.length < 2) continue
      for (let j = 1; j < terkep.length; j++) {
        const also = terkep[j - 1]
        const felso = terkep[j]
        if (n >= also.be && n <= felso.be) {
          n =
            felso.be === also.be
              ? felso.ki
              : also.ki + ((n - also.be) / (felso.be - also.be)) * (felso.ki - also.ki)
          break
        }
      }
    }
  }
  return Math.min(Math.max(n, -1), 1)
}

/** Egy variációs régió skalárja a normalizált koordinátán. */
function regioSkalar(
  regio: readonly { kezd: number; csucs: number; veg: number }[],
  koordinatak: readonly number[],
): number {
  let skalar = 1
  for (let i = 0; i < regio.length; i++) {
    const { kezd, csucs, veg } = regio[i]
    const k = koordinatak[i] ?? 0
    if (csucs === 0) continue
    if (kezd > csucs || csucs > veg) continue
    if (kezd < 0 && veg > 0) continue
    if (k === csucs) continue
    if (k <= kezd || k >= veg) return 0
    skalar *= k < csucs ? (k - kezd) / (csucs - kezd) : (veg - k) / (veg - csucs)
  }
  return skalar
}

type VariacioTar = {
  readonly regiok: readonly (readonly { kezd: number; csucs: number; veg: number }[])[]
  readonly adatok: readonly { regioIndexek: readonly number[]; sorok: readonly (readonly number[])[] }[]
}

/** ItemVariationStore beolvasása (formátum 1). */
function variacioTar(buf: Buffer, eltolas: number): VariacioTar {
  const regioLista = eltolas + buf.readUInt32BE(eltolas + 2)
  const tengelySzam = buf.readUInt16BE(regioLista)
  const regioSzam = buf.readUInt16BE(regioLista + 2)
  const regiok: { kezd: number; csucs: number; veg: number }[][] = []
  for (let r = 0; r < regioSzam; r++) {
    const tengelyek: { kezd: number; csucs: number; veg: number }[] = []
    for (let a = 0; a < tengelySzam; a++) {
      const p = regioLista + 4 + (r * tengelySzam + a) * 6
      tengelyek.push({
        kezd: buf.readInt16BE(p) / F2DOT14,
        csucs: buf.readInt16BE(p + 2) / F2DOT14,
        veg: buf.readInt16BE(p + 4) / F2DOT14,
      })
    }
    regiok.push(tengelyek)
  }
  const adatSzam = buf.readUInt16BE(eltolas + 6)
  const adatok: { regioIndexek: number[]; sorok: number[][] }[] = []
  for (let i = 0; i < adatSzam; i++) {
    const adatEltolas = eltolas + buf.readUInt32BE(eltolas + 8 + i * 4)
    const sorSzam = buf.readUInt16BE(adatEltolas)
    const szoDeltaMezo = buf.readUInt16BE(adatEltolas + 2)
    const hosszuSzavak = (szoDeltaMezo & 0x8000) !== 0
    const szoDeltaSzam = szoDeltaMezo & 0x7fff
    const regioIndexSzam = buf.readUInt16BE(adatEltolas + 4)
    const regioIndexek: number[] = []
    for (let r = 0; r < regioIndexSzam; r++) {
      regioIndexek.push(buf.readUInt16BE(adatEltolas + 6 + r * 2))
    }
    let p = adatEltolas + 6 + regioIndexSzam * 2
    const sorok: number[][] = []
    for (let s = 0; s < sorSzam; s++) {
      const sor: number[] = []
      for (let r = 0; r < regioIndexSzam; r++) {
        if (r < szoDeltaSzam) {
          sor.push(hosszuSzavak ? buf.readInt32BE(p) : buf.readInt16BE(p))
          p += hosszuSzavak ? 4 : 2
        } else {
          sor.push(hosszuSzavak ? buf.readInt16BE(p) : buf.readInt8(p))
          p += hosszuSzavak ? 2 : 1
        }
      }
      sorok.push(sor)
    }
    adatok.push({ regioIndexek, sorok })
  }
  return { regiok, adatok }
}

/** DeltaSetIndexMap: glif → (külső, belső) index. Hiányzó térkép = azonosság. */
function deltaIndex(
  buf: Buffer,
  eltolas: number | null,
  glif: number,
): readonly [number, number] {
  if (eltolas === null) return [0, glif] as const
  const formatum = buf.readUInt8(eltolas)
  const bejegyzesAlak = buf.readUInt8(eltolas + 1)
  const bejegyzesMeret = ((bejegyzesAlak & 0x30) >> 4) + 1
  const belsoBitek = (bejegyzesAlak & 0x0f) + 1
  const darab = formatum === 0 ? buf.readUInt16BE(eltolas + 2) : buf.readUInt32BE(eltolas + 2)
  const adat = eltolas + (formatum === 0 ? 4 : 6)
  const i = Math.min(glif, darab - 1)
  let ertek = 0
  for (let b = 0; b < bejegyzesMeret; b++) ertek = (ertek << 8) | buf.readUInt8(adat + i * bejegyzesMeret + b)
  return [ertek >> belsoBitek, ertek & ((1 << belsoBitek) - 1)] as const
}

/**
 * Egy vagy több (subsetelt) woff2 fájl összeolvasott metrikája.
 *
 * A latin és latin-ext metszet ugyanannak a mesternek a részhalmaza: a magyar
 * ő és ű a latin-ext fájlból jön, minden más ékezet a latinból
 * (`src/app/(frontend)/styles/fonts.css` unicode-range-ei). A fájlokat ezért
 * EGY metrikába kell összefésülni.
 *
 * A `suly` a CSS `font-weight`: variábilis metszeten a `wght` tengely erre az
 * értékre áll, és az előretolások a HVAR-ból interpolálódnak. Statikus
 * metszeten a paraméternek nincs hatása (a fájl maga hordozza a súlyt).
 */
export function betuMetrika(fajlok: readonly string[], suly = 400): BetuMetrika {
  const eloretolas = new Map<number, number>()
  let egysegPerEm = 0
  let variabilis: number | null = null
  for (const fajl of fajlok) {
    const t = tablak(fajl)
    const head = t.get('head')
    const hhea = t.get('hhea')
    const hmtx = t.get('hmtx')
    const cmap = t.get('cmap')
    if (!head || !hhea || !hmtx || !cmap) {
      throw new Error(`hiányzó tábla (head/hhea/hmtx/cmap) ebben: ${fajl}`)
    }
    const egysegek = head.buf.readUInt16BE(18)
    if (egysegPerEm !== 0 && egysegPerEm !== egysegek) {
      throw new Error(`eltérő unitsPerEm ugyanabban a családban: ${fajl}`)
    }
    egysegPerEm = egysegek
    const metrikaSzam = hhea.buf.readUInt16BE(34)
    const szelessegek: number[] = []
    for (let i = 0; i < metrikaSzam; i++) {
      // Transzformált hmtx (spec 5.1): 1 bájt flags, utána az advanceWidth tömb.
      // Nem transzformált: longHorMetric = { UInt16 advanceWidth, Int16 lsb }.
      szelessegek.push(
        hmtx.transzformalt ? hmtx.buf.readUInt16BE(1 + i * 2) : hmtx.buf.readUInt16BE(i * 4),
      )
    }

    // Variábilis metszet: a `wght` tengelyre állított előretolás-eltérések.
    const hvar = t.get('HVAR')
    const koordinata = normalizaltKoordinata(t, 'wght', suly)
    let delta: ((glif: number) => number) | null = null
    if (hvar && koordinata !== null) {
      variabilis = suly
      const tar = variacioTar(hvar.buf, hvar.buf.readUInt32BE(4))
      const terkepEltolas = hvar.buf.readUInt32BE(8)
      const terkep = terkepEltolas === 0 ? null : terkepEltolas
      const koordinatak = [koordinata]
      delta = (glif: number): number => {
        const [kulso, belso] = deltaIndex(hvar.buf, terkep, glif)
        const adat = tar.adatok[kulso]
        const sor = adat?.sorok[belso]
        if (!adat || !sor) return 0
        let osszeg = 0
        for (let r = 0; r < adat.regioIndexek.length; r++) {
          const regio = tar.regiok[adat.regioIndexek[r]]
          if (!regio) continue
          osszeg += regioSkalar(regio, koordinatak) * sor[r]
        }
        return osszeg
      }
    }

    const utolso = szelessegek[szelessegek.length - 1] ?? 0
    for (const [kodpont, glif] of cmapOlvas(cmap.buf)) {
      if (eloretolas.has(kodpont)) continue
      const alap = glif < szelessegek.length ? szelessegek[glif] : utolso
      eloretolas.set(kodpont, (alap + (delta ? delta(glif) : 0)) / egysegek)
    }
  }
  if (egysegPerEm === 0) throw new Error('nem érkezett metszet a metrika-olvasáshoz')
  return { egysegPerEm, eloretolas, suly: variabilis }
}

/**
 * Egy szó szélessége pixelben, adott betűméret mellett.
 *
 * Ismeretlen (a subsetből hiányzó) karakterre dob: az őr így nem tud némán
 * alábecsülni. A `betuKoz` a CSS `letter-spacing` em-ben — a folyószövegen 0.
 */
export function szoSzelessegPx(
  metrika: BetuMetrika,
  szo: string,
  betumeretPx: number,
  betuKozEm = 0,
): number {
  let em = 0
  for (const karakter of szo) {
    const eloretolas = metrika.eloretolas.get(karakter.codePointAt(0) ?? 0)
    if (eloretolas === undefined) {
      throw new Error(`a metszetből hiányzik a(z) „${karakter}" karakter — nem mérhető`)
    }
    em += eloretolas + betuKozEm
  }
  return em * betumeretPx
}
