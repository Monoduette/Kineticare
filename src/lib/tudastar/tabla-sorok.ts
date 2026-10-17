import type { BlockNode, RichTextContent } from '../../scripts/restore-legacy-content'

/**
 * A már TÁROLT Tudástár-tartalom táblázat-sorainak szétválasztása, helyben.
 *
 * Miért: a régi betöltő (a #329 előtti `markdown-to-lexical.ts`) a markdown-
 * tábla minden adat-sorát egy-egy felsorolásnak írta, egymás mellé. A Payload
 * 3.90.2 szerkesztője (Lexical 0.50) az egymás melletti, azonos típusú
 * felsorolásokat betöltéskor egybefűzi, ezért az adminban az első mentés a
 * sorhatárokat eltüntetné (feladatlista P3). A markdownból való újratöltés
 * viszont a szerkesztőben azóta tett javításokat is felülírná.
 *
 * Ez az átalakítás csak a táblázat-alakú futamokhoz nyúl, és pontosan azt a
 * szerkezetet adja, amit az új fordító ír (`tablaCsomopontok`): soronként egy
 * félkövér bekezdés (a sor első cellája, a sor címe) és egy felsorolás a
 * többi cellával. Minden más csomópont változatlan referenciaként marad, így
 * a szerkesztői javítások megmaradnak. A nem táblázat-alakú szomszédos listák
 * érintetlenek, de a hívó jelentést kap róluk: ezekről ember dönt.
 *
 * Táblázat-alak (a régi fordító kimenetének lenyomata): legalább két egymás
 * melletti `bullet` lista; minden tétel „Fejléc: érték” alakú szöveg, kivéve
 * a sor első tételét, ha az első oszlop fejléce üres; a sorok címe ugyanabból
 * az oszlopból jön. Egy táblázatot közvetlenül követő, nem táblázat-alakú
 * lista a futamot nem táblázattá teszi: azt a szerkesztő a szétválasztás után
 * is az utolsó sor listájával fűzné egybe, ezért ott ember dönt.
 *
 * Már egybeolvadt sorok (a 3.88 szerkesztője egy sor szerkezeti szerkesztésekor
 * a sortól lefelé, a 3.90 szerkesztője betöltéskor az egész táblát egy listába
 * fűzi) nem sorok: egy listában a sor címének fejléce csak egyszer állhat, és
 * üres első fejlécű táblánál csak az első tétel lehet fejléc nélküli. Az ilyen
 * listát az átalakítás nem bántja, de külön jelenti (`egybeolvadt`): a
 * sorhatárokat csak ember vagy a markdown-forrás állíthatja helyre.
 */

const FORMAT_BOLD = 1

/** Egy tétel szövege elején álló fejléc („Fejléc: érték” → „Fejléc”), vagy null. */
const FEJLEC = /^([^:\n]{1,80}):\s\S/

type Csomopont = BlockNode & {
  type?: string
  listType?: string
  text?: string
  format?: number | string
  value?: number
  children?: BlockNode[]
}

function szoveg(node: Csomopont): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.children ?? []).map((gyerek) => szoveg(gyerek as Csomopont)).join('')
}

function fejlec(tetel: Csomopont): string | null {
  const talalat = FEJLEC.exec(szoveg(tetel).trim())
  return talalat === null ? null : talalat[1].trim()
}

/**
 * Egy `bullet` lista, amelyben már több táblázat-sor olvadt össze: a sor
 * címének fejléce a tételek között újra előfordul, vagy (üres első fejlécű
 * táblánál) az első tételen túl is áll fejléc nélküli tétel a fejléces tételek
 * között. Ezt a szerkesztő egybefűzése hagyja hátra; gépi szétválasztása nem
 * biztonságos.
 */
function sorEgybeolvadt(node: Csomopont): boolean {
  if (node.type !== 'list' || node.listType !== 'bullet') return false
  const tetelek = (node.children ?? []) as Csomopont[]
  if (tetelek.length < 2) return false
  const fejlecek = tetelek.map(fejlec)
  if (!fejlecek.some((f) => f !== null)) return false
  const cim = fejlecek[0]
  if (cim !== null) return fejlecek.slice(1).includes(cim)
  return fejlecek.slice(1).some((f) => f === null)
}

/**
 * A régi fordító táblázat-sora: `bullet` lista, amelyben az első tétel a sor
 * első cellája (a fejléc nevével, ha az első oszlop fejléce nem üres), a
 * többi tétel pedig csupa „Fejléc: érték”, és egyetlen sor (nem egybeolvadt).
 */
function tablaSor(node: Csomopont): boolean {
  if (node.type !== 'list' || node.listType !== 'bullet') return false
  const tetelek = (node.children ?? []) as Csomopont[]
  // Legalább egy cella viseli a fejlécét: a puszta egytételes lista nem sor.
  return (
    tetelek.length > 0 &&
    tetelek.some((tetel) => fejlec(tetel) !== null) &&
    tetelek.slice(1).every((tetel) => fejlec(tetel) !== null) &&
    !sorEgybeolvadt(node)
  )
}

/** A sor címének fejléce (az első oszlopé), vagy null, ha az első oszlop fejléce üres. */
function sorCimFejlec(lista: Csomopont): string | null {
  const elso = (lista.children ?? [])[0] as Csomopont | undefined
  return elso === undefined ? null : fejlec(elso)
}

/**
 * Egy futam akkor táblázat, ha minden listája táblázat-sor, és a sorok címe
 * ugyanabból az oszlopból jön: vagy mindenütt ugyanaz a fejléc áll előtte,
 * vagy sehol (üres első fejléc, mint a 7. cikk összehasonlító táblájában).
 */
function tablazat(listak: readonly Csomopont[]): boolean {
  if (!listak.every(tablaSor)) return false
  const elsoFejlec = sorCimFejlec(listak[0])
  return listak.every((lista) => sorCimFejlec(lista) === elsoFejlec)
}

function felkover(node: Csomopont): BlockNode {
  if (node.type === 'text') {
    const format = typeof node.format === 'number' ? node.format : 0
    return { ...node, format: format | FORMAT_BOLD } as BlockNode
  }
  return Array.isArray(node.children)
    ? ({
        ...node,
        children: node.children.map((gyerek) => felkover(gyerek as Csomopont)),
      } as BlockNode)
    : (node as BlockNode)
}

/**
 * Egy táblázat-sor (lista) → félkövér bekezdés + a többi tétel listája.
 * A tételek belső csomópontjai (szöveg, link) változatlanul kerülnek át; csak
 * a sor címének szövege kap félkövér jelölést.
 */
function sorSzetvalasztasa(lista: Csomopont): BlockNode[] {
  const [elso, ...tobbi] = (lista.children ?? []) as Csomopont[]
  const cim: BlockNode = {
    type: 'paragraph',
    children: (elso.children ?? []).map((gyerek) => felkover(gyerek as Csomopont)),
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  } as BlockNode
  if (tobbi.length === 0) return [cim]
  const maradek: BlockNode = {
    ...lista,
    children: tobbi.map((tetel, index) => ({ ...tetel, value: index + 1 }) as BlockNode),
  } as BlockNode
  return [cim, maradek]
}

export interface TablaSorokEredmeny {
  /** Az új tartalom, vagy `null`, ha nincs táblázat-alakú futam (nem szabad írni). */
  content: RichTextContent | null
  /** A szétválasztott táblázat-sorok száma. */
  sorok: number
  /**
   * Nem táblázat-alakú, egymás melletti azonos típusú listák helye (a
   * gyökértől számított csomópont-sorszámmal). Ezeket a szerkesztő egybefűzné,
   * de gépi döntés nincs: ember nézze meg.
   */
  egyebFutamok: string[]
  /**
   * Már egybeolvadt táblázat-sorok helye: egy listában több sor cellái. A
   * szerkesztő egybefűzésének nyoma; a sorhatárokat csak ember vagy a
   * markdown-forrás (`docs/cikkek/`) állíthatja helyre.
   */
  egybeolvadt: string[]
}

/** Egymás melletti, azonos típusú listák futamai egy gyermeklistában. */
function futamok(gyerekek: readonly Csomopont[]): Array<{ kezdet: number; veg: number }> {
  const talalatok: Array<{ kezdet: number; veg: number }> = []
  let i = 0
  while (i < gyerekek.length) {
    const node = gyerekek[i]
    let j = i
    while (
      node.type === 'list' &&
      j + 1 < gyerekek.length &&
      gyerekek[j + 1].type === 'list' &&
      gyerekek[j + 1].listType === node.listType
    ) {
      j += 1
    }
    if (j > i) talalatok.push({ kezdet: i, veg: j })
    i = j + 1
  }
  return talalatok
}

function atalakit(
  gyerekek: readonly BlockNode[],
  ut: string,
  eredmeny: { sorok: number; egyebFutamok: string[]; egybeolvadt: string[]; valtozott: boolean },
): BlockNode[] {
  const csomopontok = gyerekek as readonly Csomopont[]
  csomopontok.forEach((node, index) => {
    if (sorEgybeolvadt(node)) {
      eredmeny.egybeolvadt.push(
        `${ut}: a ${index + 1}. csomópont listájában több táblázat-sor cellái állnak (${(node.children ?? []).length} tétel)`,
      )
    }
  })
  const tablaFutamok = new Set<number>()
  for (const futam of futamok(csomopontok)) {
    const sorokSzama = futam.veg - futam.kezdet + 1
    const listak = csomopontok.slice(futam.kezdet, futam.veg + 1)
    if (tablazat(listak)) {
      for (let k = futam.kezdet; k <= futam.veg; k += 1) tablaFutamok.add(k)
      eredmeny.sorok += sorokSzama
    } else {
      eredmeny.egyebFutamok.push(
        `${ut}: a ${futam.kezdet + 1}–${futam.veg + 1}. csomópont ${sorokSzama} egymás melletti ${listak[0].listType} lista`,
      )
    }
  }
  // Csak akkor új tömb, ha EBBEN a gyermeklistában változott valami: a nem
  // érintett ágak ugyanazzal a referenciával mennek vissza.
  let helyiValtozas = false
  const uj: BlockNode[] = []
  csomopontok.forEach((node, index) => {
    if (tablaFutamok.has(index)) {
      helyiValtozas = true
      uj.push(...sorSzetvalasztasa(node))
      return
    }
    if (Array.isArray(node.children) && node.type !== 'list' && node.type !== 'listitem') {
      const belso = atalakit(node.children, `${ut} › ${index + 1}. ${node.type ?? '?'}`, eredmeny)
      if (belso !== node.children) {
        helyiValtozas = true
        uj.push({ ...node, children: belso } as BlockNode)
        return
      }
    }
    uj.push(node as BlockNode)
  })
  if (!helyiValtozas) return gyerekek as BlockNode[]
  eredmeny.valtozott = true
  return uj
}

/**
 * A tartalom táblázat-sorainak szétválasztása. Idempotens: a már
 * szétválasztott (bekezdés + lista) alak nem futam, ezért a második futás
 * `content: null`-t ad.
 */
export function tablaSorokSzetvalasztasa(content: RichTextContent): TablaSorokEredmeny {
  const eredmeny = {
    sorok: 0,
    egyebFutamok: [] as string[],
    egybeolvadt: [] as string[],
    valtozott: false,
  }
  const gyerekek = atalakit(content.root.children, 'gyökér', eredmeny)
  return {
    content: eredmeny.valtozott
      ? { ...content, root: { ...content.root, children: gyerekek } }
      : null,
    sorok: eredmeny.sorok,
    egyebFutamok: eredmeny.egyebFutamok,
    egybeolvadt: eredmeny.egybeolvadt,
  }
}
