import type { LexicalNode } from '../components/lexical/types'

/**
 * WP58 — a rendelői árlista SZERKEZETÉNEK felismerése a szabad szövegből
 * (tulajdonosi kérés, 2026-09-19: „egymás mellé kellene rendezni a dolgokat
 * esztétikusan … az időpontot kérek link az legyen egy gomb ugyanebben a
 * szekcióban").
 *
 * MIÉRT FELISMERÉS ÉS NEM ÚJ BLOKK. Adatbázis-migráció tilos (CLAUDE.md 3.
 * tilos zóna), a postgres-adapter minden új blokkmezőt oszlopként tárolna.
 * A tartalom ezért a meglévő `richText` blokkban marad, a szerkesztők az
 * adminban továbbra is a szövegen dolgoznak, és a megjelenítő a Lexical
 * csomópontokból olvassa ki a szerkezetet. Ha a szerkezet nem ismerhető fel
 * (más címsor, más listaalak, hiányzó ár), a blokk a sima folyószövegre esik
 * vissza: a felismerés SOHA nem dob el tartalmat, legfeljebb nem alkalmazza
 * az elrendezést.
 *
 * MIT ISMER FEL (a 2026-09-19-i élő és a seed-beli alak is ilyen):
 *   1. egy címsor (h2 vagy h3) a blokk elején: a szekció címe,
 *   2. tetszőleges bevezető csomópontok (bekezdés, lista) a címsor után,
 *   3. egy „Árlista…" kezdetű címsor,
 *   4. közvetlenül utána egy lista, amelynek MINDEN tétele
 *      „<N> perces alkalom – <ár> Ft (megjegyzés)" alakú,
 *   5. utána csak bekezdések: „Helyszíneink: A • B" (helyszínek), egy linket
 *      tartalmazó bekezdés (az időpontkérés célja), és tény-mondatok.
 *
 * A modul TISZTA: DOM, React és adatbázis nélkül tesztelhető.
 */

export interface ArlistaTetel {
  /** Az alkalom hossza, ahogy a szerkesztő írta („50 perces alkalom"). */
  readonly idotartam: string
  /** Az ár a pénznemmel („18 000 Ft"). */
  readonly ar: string
  /** A tétel SAJÁT zárójeles megjegyzése; null, ha nincs, vagy ha közös. */
  readonly megjegyzes: string | null
}

export interface RendeloiArlista {
  /** A szekció címe és a címsor szintje, ahogy a CMS-ben áll. */
  readonly cim: string
  readonly cimTag: 'h2' | 'h3'
  /** A cím és az árlista-címsor közötti csomópontok (bevezető), változatlanul. */
  readonly bevezeto: readonly LexicalNode[]
  /** Az árlista-címsor első tagja („Árlista") és a kettőspont/gondolatjel utáni része. */
  readonly arlistaCim: string
  readonly arlistaAlcim: string | null
  readonly tetelek: readonly ArlistaTetel[]
  /** Az összes tételnél SZÓ SZERINT azonos megjegyzés egyszer; különben null. */
  readonly kozosMegjegyzes: string | null
  /** A lista utáni tény-mondatok (mondatonként egy tétel). */
  readonly tenyek: readonly string[]
  /** A „Helyszíneink:" bekezdés címkéje és a felsorolt címek. */
  readonly helyszinek: { readonly cimke: string; readonly cimek: readonly string[] } | null
  /** A lista utáni, linket tartalmazó bekezdés link-csomópontja (a gomb célja). */
  readonly cta: LexicalNode | null
}

const ARLISTA_CIMSOR = /^árlista/iu
const HELYSZIN_CIMKE = /^(helysz[ií]n(?:eink|ek))\s*:\s*(.+)$/iu
/** Elválasztók a helyszín-felsorolásban: pont-jel, függőleges vonal, pontosvessző. */
const HELYSZIN_ELVALASZTO = /\s*[•|;]\s*/u
/**
 * „50 perces alkalom – 18 000 Ft (megjegyzés)". Az elválasztó lehet
 * gondolatjel, kettőspont vagy kötőjel (a szerkesztő bármelyiket írhatja); az
 * ár számjegyekből és szóközökből áll (a `\s` az ECMAScript WhiteSpace
 * osztály, benne a nem törő és a keskeny nem törő szóközzel).
 */
const TETEL =
  /^\s*(\d+\s*perces\s+alkalom)\s*[\u2013\u2014:-]\s*(\d[\d\s]*Ft)\s*(?:\(([^()]+)\))?\s*\.?\s*$/iu

/** U+00A0: az ár ezres-csoportja és pénzneme nem törhet sorba. */
const NEM_TORO_SZOKOZ = String.fromCharCode(0xa0)

function childrenOf(node: LexicalNode): readonly LexicalNode[] {
  return Array.isArray(node.children) ? node.children : []
}

/** Formázás nélküli szöveg, összevont szóközökkel. */
export function csomopontSzovege(node: LexicalNode): string {
  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : ''
  }
  if (node.type === 'linebreak') return ' '
  return childrenOf(node)
    .map((child) => csomopontSzovege(child))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
}

function elsoLink(node: LexicalNode): LexicalNode | null {
  if (node.type === 'link') return node
  for (const child of childrenOf(node)) {
    const talalat = elsoLink(child)
    if (talalat) return talalat
  }
  return null
}

function cimsorTag(node: LexicalNode): 'h2' | 'h3' | null {
  if (node.type !== 'heading') return null
  // A serializer a h1-et h2-re lágyítja, a h4–h6 itt nem szekciócím.
  if (node.tag === 'h1' || node.tag === 'h2') return 'h2'
  if (node.tag === 'h3') return 'h3'
  return null
}

/** Mondatokra bontás: záró pont/felkiáltójel/kérdőjel után szóköz. */
function mondatok(szoveg: string): string[] {
  return szoveg
    .split(/(?<=[.!?])\s+(?=\p{Lu})/u)
    .map((mondat) => mondat.trim())
    .filter((mondat) => mondat.length > 0)
}

function tetelbol(node: LexicalNode): ArlistaTetel | null {
  if (node.type !== 'listitem') return null
  const talalat = TETEL.exec(csomopontSzovege(node))
  if (!talalat) return null
  return {
    idotartam: talalat[1].replace(/\s+/gu, ' ').trim(),
    ar: talalat[2].trim().replace(/\s+/gu, NEM_TORO_SZOKOZ),
    megjegyzes: talalat[3]?.trim() || null,
  }
}

/**
 * A rendelői árlista felismerése egy Lexical-dokumentumból. `null`, ha a
 * szerkezet bármely ponton eltér a fent leírttól — ilyenkor a hívó a sima
 * folyószöveget rendereli.
 */
export function felismerRendeloiArlista(content: unknown): RendeloiArlista | null {
  if (typeof content !== 'object' || content === null) return null
  const root = (content as { root?: unknown }).root
  if (typeof root !== 'object' || root === null) return null
  const gyerekek = (root as { children?: unknown }).children
  if (!Array.isArray(gyerekek)) return null
  const csomopontok = gyerekek as LexicalNode[]

  // 1. A szekció címe a blokk ELSŐ csomópontja.
  const cimNode = csomopontok[0]
  if (!cimNode) return null
  const cimTag = cimsorTag(cimNode)
  if (cimTag === null) return null
  const cim = csomopontSzovege(cimNode)
  if (cim.length === 0) return null

  // 3. Az árlista-címsor.
  const arlistaIndex = csomopontok.findIndex(
    (node, index) =>
      index > 0 && cimsorTag(node) !== null && ARLISTA_CIMSOR.test(csomopontSzovege(node)),
  )
  if (arlistaIndex < 0) return null
  const arlistaSzoveg = csomopontSzovege(csomopontok[arlistaIndex])
  const [arlistaCim, ...alcimReszek] = arlistaSzoveg.split(/\s*[\u2013\u2014:]\s*/u)
  const arlistaAlcim = alcimReszek.join(' ').trim() || null

  // 4. Közvetlenül utána a tétel-lista.
  const lista = csomopontok[arlistaIndex + 1]
  if (!lista || lista.type !== 'list') return null
  const tetelek: ArlistaTetel[] = []
  for (const item of childrenOf(lista)) {
    const tetel = tetelbol(item)
    if (tetel === null) return null
    tetelek.push(tetel)
  }
  if (tetelek.length === 0 || tetelek.length > 4) return null

  // A minden tételnél azonos megjegyzés egyszer, közös lábjegyzetként.
  const elsoMegjegyzes = tetelek[0].megjegyzes
  const kozos =
    elsoMegjegyzes !== null && tetelek.every((tetel) => tetel.megjegyzes === elsoMegjegyzes)
  const kozosMegjegyzes = kozos ? elsoMegjegyzes : null
  const vegsoTetelek = kozos ? tetelek.map((tetel) => ({ ...tetel, megjegyzes: null })) : tetelek

  // 5. A lista utáni bekezdések.
  const tenyek: string[] = []
  let helyszinek: RendeloiArlista['helyszinek'] = null
  let cta: LexicalNode | null = null
  for (const node of csomopontok.slice(arlistaIndex + 2)) {
    if (node.type !== 'paragraph') return null
    const szoveg = csomopontSzovege(node)
    if (szoveg.length === 0) continue
    const link = elsoLink(node)
    if (link) {
      if (cta !== null) return null
      cta = link
      continue
    }
    const helyszin = HELYSZIN_CIMKE.exec(szoveg)
    if (helyszin) {
      if (helyszinek !== null) return null
      const cimek = helyszin[2]
        .split(HELYSZIN_ELVALASZTO)
        .map((cimSzoveg) => cimSzoveg.replace(/\.$/u, '').trim())
        .filter((cimSzoveg) => cimSzoveg.length > 0)
      if (cimek.length === 0) return null
      helyszinek = { cimke: helyszin[1], cimek }
      continue
    }
    tenyek.push(...mondatok(szoveg))
  }

  return {
    cim,
    cimTag,
    bevezeto: csomopontok.slice(1, arlistaIndex),
    arlistaCim: arlistaCim.trim(),
    arlistaAlcim,
    tetelek: vegsoTetelek,
    kozosMegjegyzes,
    tenyek,
    helyszinek,
    cta,
  }
}

/**
 * A közös megjegyzés lábjegyzet-alakja: nagy kezdőbetű és záró pont, hogy
 * a kártyák alatt önálló mondatként álljon („Tartalmazza a …kezeléseket.").
 * A szöveg többi része a szerkesztőé, változatlan.
 */
export function labjegyzetMondat(megjegyzes: string): string {
  const tiszta = megjegyzes.trim()
  if (tiszta.length === 0) return tiszta
  const nagy = tiszta.charAt(0).toLocaleUpperCase('hu') + tiszta.slice(1)
  return /[.!?]$/u.test(nagy) ? nagy : `${nagy}.`
}
