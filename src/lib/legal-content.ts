/**
 * Jogi oldalak (ÁSZF, adatkezelés, impresszum) — forrás: src/lib/legal-source/*.txt, szó szerint.
 * #/##/- jelölők megjelenítési meta; Lexical építők a legacy scriptből.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bulletList,
  heading,
  para,
  richText,
  type BlockNode,
  type RichTextContent,
} from '../scripts/restore-legacy-content'

/**
 * A `jogiRichText` inverze (Lexical → jelölős forrásszöveg). A függőség nélküli
 * megvalósítás a levélküldő oldalon él, mert ezt a modult a levél futásideje
 * nem importálhatja (indoklás: src/lib/email/templates/aszf-forras.ts).
 */
export { lexicalToJogiForras } from './email/templates/aszf-forras'

/** A szó szerinti forrásfájlok könyvtára (a modul mellett). */
export const JOGI_FORRAS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'legal-source',
)

// ---------------------------------------------------------------------------
// Forrás-elemzés
// ---------------------------------------------------------------------------

/** Egy forrássor szerepe a dokumentumban. */
export type JogiElemTipus = 'cim' | 'alcim' | 'bekezdes' | 'listaelem'

/** Egy értelmezett forrássor: a szerepe és a SZÓ SZERINTI szövege. */
export interface JogiElem {
  tipus: JogiElemTipus
  szoveg: string
}

/** A sor eleji jelölők — a leghosszabbtól a legrövidebbig (a `##` előbb, mint a `#`). */
const JELOLOK: readonly { jelolo: string; tipus: JogiElemTipus }[] = [
  { jelolo: '## ', tipus: 'alcim' },
  { jelolo: '# ', tipus: 'cim' },
  { jelolo: '- ', tipus: 'listaelem' },
]

/**
 * Forrásfájl → értelmezett elemek.
 *
 * Az üres (csak whitespace-ből álló) sorok elválasztók, nem kerülnek a
 * kimenetbe. Minden más sor bekerül — jelölővel a szerepe, jelölő nélkül
 * bekezdésként. A sor SZÖVEGE a jelölő levágása után VÁLTOZATLAN: se trim, se
 * whitespace-normalizálás nem történik rajta (a bevezető szóköz és a
 * tabulátor a jogász dokumentumában is így áll).
 */
export function parseJogiForras(nyers: string): JogiElem[] {
  const elemek: JogiElem[] = []
  for (const sor of nyers.split('\n')) {
    if (sor.trim().length === 0) {
      continue
    }
    const talalat = JELOLOK.find((jelolt) => sor.startsWith(jelolt.jelolo))
    elemek.push(
      talalat === undefined
        ? { tipus: 'bekezdes', szoveg: sor }
        : { tipus: talalat.tipus, szoveg: sor.slice(talalat.jelolo.length) },
    )
  }
  return elemek
}

/**
 * Az elemek SZÓ SZERINTI szövege, soronként — a szó szerintiség
 * összehasonlítási alapja (a jelölők nélküli forrásfájl-tartalom).
 */
export function jogiSzoveg(elemek: readonly JogiElem[]): string {
  return elemek.map((elem) => elem.szoveg).join('\n')
}

// ---------------------------------------------------------------------------
// Lexical építés és visszaolvasás
// ---------------------------------------------------------------------------

/**
 * Értelmezett elemek → Lexical rich-text.
 *
 * Az EGYMÁS UTÁNI felsorolás-elemek egyetlen `ul` listába kerülnek; minden más
 * elem önálló csomópont. A szöveg sorrendje és tartalma nem változik.
 */
export function jogiRichText(elemek: readonly JogiElem[]): RichTextContent {
  const csomopontok: BlockNode[] = []
  let listaPuffer: string[] = []

  const puffertKiirja = (): void => {
    if (listaPuffer.length > 0) {
      csomopontok.push(bulletList(listaPuffer))
      listaPuffer = []
    }
  }

  for (const elem of elemek) {
    if (elem.tipus === 'listaelem') {
      listaPuffer.push(elem.szoveg)
      continue
    }
    puffertKiirja()
    if (elem.tipus === 'cim') {
      csomopontok.push(heading('h2', elem.szoveg))
      continue
    }
    if (elem.tipus === 'alcim') {
      csomopontok.push(heading('h3', elem.szoveg))
      continue
    }
    csomopontok.push(para(elem.szoveg))
  }
  puffertKiirja()

  return richText(csomopontok)
}

/**
 * Egy Lexical csomópontfa TELJES szövege, blokkonként új sorral elválasztva.
 *
 * A szó szerintiség bizonyításához készült (a teszt ezt veti össze a
 * forrásfájl szövegével), de a szekciósor-javításokhoz is használjuk: a
 * rendelői szekciót a tartalmában álló címsor szövege azonosítja.
 */
export function richTextSzoveg(tartalom: unknown): string {
  const gyoker =
    typeof tartalom === 'object' && tartalom !== null
      ? (tartalom as { root?: unknown }).root
      : undefined
  const gyerekek = gyermekLista(gyoker)
  return gyerekek.map(blokkSzoveg).join('\n')
}

/** Egy csomópont `children` tömbje, ha van. */
function gyermekLista(csomopont: unknown): unknown[] {
  if (typeof csomopont !== 'object' || csomopont === null) {
    return []
  }
  const gyerekek = (csomopont as { children?: unknown }).children
  return Array.isArray(gyerekek) ? gyerekek : []
}

/**
 * Egy BLOKK-szintű csomópont szövege.
 *
 * A lista külön eset: minden eleme ÖNÁLLÓ sor, hogy a visszanyert szöveg a
 * forrásfájl soraival egy az egyben összevethető legyen.
 */
function blokkSzoveg(csomopont: unknown): string {
  if (typeof csomopont !== 'object' || csomopont === null) {
    return ''
  }
  const tipus = (csomopont as { type?: unknown }).type
  if (tipus === 'list') {
    return gyermekLista(csomopont).map(blokkSzoveg).join('\n')
  }
  return beagyazottSzoveg(csomopont)
}

/** Egy csomópont alatti ÖSSZES szöveg, elválasztó nélkül összefűzve. */
function beagyazottSzoveg(csomopont: unknown): string {
  if (typeof csomopont !== 'object' || csomopont === null) {
    return ''
  }
  const rekord = csomopont as { type?: unknown; text?: unknown }
  if (rekord.type === 'text') {
    return typeof rekord.text === 'string' ? rekord.text : ''
  }
  return gyermekLista(csomopont).map(beagyazottSzoveg).join('')
}

// ---------------------------------------------------------------------------
// A három jogi oldal
// ---------------------------------------------------------------------------

/** Egy jogi oldal létrehozásához szükséges minden adat (a tartalom kivételével). */
export interface JogiOldalLeiras {
  /** Pages.slug — a lábléc linkjeivel AZONOS (src/components/layout/Footer.tsx). */
  slug: string
  /** Pages.title — a lap H1-e és a böngészőfül címe. */
  cim: string
  /** A szó szerinti forrásfájl neve a `legal-source` mappában. */
  forrasFajl: string
  /**
   * Pages.seoDescription — a Google találati listájára szánt, TÉNYKÖZLŐ
   * összefoglaló. Szándékosan NEM a jogi szöveg átfogalmazása: a dokumentum
   * tartalmát egyetlen mondat sem helyettesíti, ez csak megnevezi, mi az oldal.
   */
  seoLeiras: string
}

/**
 * A három jogi oldal — a slugok a LÁBLÉC linkjeihez igazodnak
 * (`/adatvedelem`, `/aszf`, `/impresszum`, lásd
 * src/components/layout/Footer.tsx `LEGAL_LINKS`), és ugyanezekre mutat a
 * pénztár ÁSZF-linkje (CheckoutForm), a süti-sáv és a kapcsolat-űrlap
 * adatkezelési linkje is. A lábléc emiatt VÁLTOZATLAN maradhatott.
 */
export const JOGI_OLDALAK: readonly JogiOldalLeiras[] = [
  {
    slug: 'aszf',
    cim: 'Általános szerződési feltételek',
    forrasFajl: 'aszf.txt',
    seoLeiras:
      'A KINETICARE Kft. általános szerződési feltételei a kineticare.hu weboldalon megvásárolható online ismeretterjesztő videókurzusokra.',
  },
  {
    slug: 'adatvedelem',
    cim: 'Adatkezelési és adatvédelmi szabályzat',
    forrasFajl: 'adatkezeles.txt',
    seoLeiras:
      'A KINETICARE Kft. adatkezelési tájékoztatója: milyen személyes adatokat kezelünk, milyen célból és jogalapon, meddig őrizzük őket, és milyen jogok illetnek meg.',
  },
  {
    slug: 'impresszum',
    cim: 'Impresszum',
    forrasFajl: 'impresszum.txt',
    seoLeiras:
      'A kineticare.hu weboldal üzemeltetőjének és tárhelyszolgáltatójának hivatalos adatai.',
  },
]

/** Egy jogi oldal szó szerinti forrásszövege (nyersen, jelölőkkel együtt). */
export function jogiForrasSzoveg(oldal: JogiOldalLeiras): string {
  return readFileSync(path.join(JOGI_FORRAS_DIR, oldal.forrasFajl), 'utf8')
}

/** Egy jogi oldal értelmezett elemei. */
export function jogiElemek(oldal: JogiOldalLeiras): JogiElem[] {
  return parseJogiForras(jogiForrasSzoveg(oldal))
}

/** Egy jogi oldal Lexical tartalma (Pages.content). */
export function jogiOldalTartalom(oldal: JogiOldalLeiras): RichTextContent {
  return jogiRichText(jogiElemek(oldal))
}
