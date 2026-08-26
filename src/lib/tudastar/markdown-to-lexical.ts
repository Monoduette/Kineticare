import {
  type BlockNode,
  type RichTextContent,
  richText,
  textNode,
} from '../../scripts/restore-legacy-content'

/**
 * Markdown → Lexical fordító a Tudástár cikkeihez (`docs/cikkek/` → `posts.content`).
 *
 * Fel nem ismert szerkezet kivételt dob (néma adatvesztés tilos). Táblázat → bekezdés
 * + felsorolás (a storefront nem ismer `table` csomópontot). A törzs H1-től indul;
 * belső/lektori szakaszok kizárva (`LEKTORI_JELOLESEK`, `FORRAS_JELOLESEK` őr).
 */

/** A törzset lezáró, kizárólag belső használatú szakaszcímek. */
const BELSO_SZAKASZOK: readonly string[] = [
  'Állítás és forrás',
  'A vezetőnek szóló jelzések',
  'A cikkíró javaslata a vezetőnek',
]

/** Lektori/vezetői jelölések — ha a törzsben felbukkannak, a fordítás bukik (2026-08-21-i éles hiba). */
export const LEKTORI_JELOLESEK: readonly string[] = [
  'lektorálandó vázlat',
  'nem publikálható',
  'a cikkíró öntesztje',
  'A vezetőnek szóló',
  'a cikkíró javaslata',
]

/** Forrás-jelölések — tulajdonosi döntés (2026-08-21) óta nem kerülhetnek a nyilvános törzsbe. */
export const FORRAS_JELOLESEK: readonly string[] = [
  'NHS',
  'AAOS',
  'OrthoInfo',
  'Cochrane',
  'PMID',
  'StatPearls',
  'Forrásjegyzék',
]

/** Lexical szövegformátum-bitek (a Lexical TextNode formatját követve). */
const FORMAT_BOLD = 1
const FORMAT_ITALIC = 2

export interface ArticleBody {
  /** A H1 szövege — ez lesz a bejegyzés címe. */
  title: string
  /** A törzs sorai, a H1 sora NÉLKÜL. */
  lines: string[]
}

/**
 * Kivágja a publikálandó törzset: az UTOLSÓ H1-től az első belső szakaszig.
 *
 * Az utolsó H1 azért kell, mert a fájl első sora maga is `# ` kezdetű
 * („LEKTORÁLANDÓ VÁZLAT…”), és a valódi cikkcím ez alatt áll.
 */
export function extractArticleBody(markdown: string): ArticleBody {
  const lines = markdown.split('\n')
  const h1Indexek = lines
    .map((line, index) => (line.startsWith('# ') ? index : -1))
    .filter((index) => index >= 0)
  if (h1Indexek.length === 0) {
    throw new Error('A cikkben nincs H1 sor, így a cím és a törzs nem határozható meg.')
  }
  const h1 = h1Indexek[h1Indexek.length - 1]
  const title = lines[h1].slice(2).trim()
  if (title.length === 0) {
    throw new Error('A cikk H1 sora üres.')
  }

  let veg = lines.length
  for (let i = h1 + 1; i < lines.length; i += 1) {
    const sor = lines[i]
    if (sor.startsWith('## ') && BELSO_SZAKASZOK.some((cim) => sor.includes(cim))) {
      veg = i
      break
    }
  }
  const torzs = lines.slice(h1 + 1, veg)

  // A H1 UTÁNI, bevezető lektori figyelmeztetés levágása. Egy bekezdésnyi:
  // az első üres sorig tart (a hat cikk közül kettőben két sorra tördelve áll).
  let kezd = 0
  while (kezd < torzs.length && torzs[kezd].trim().length === 0) kezd += 1
  let bekezdesVeg = kezd
  while (bekezdesVeg < torzs.length && torzs[bekezdesVeg].trim().length > 0) bekezdesVeg += 1
  const elsoBekezdes = torzs.slice(kezd, bekezdesVeg).join(' ')
  const torzsSorok = LEKTORI_JELOLESEK.some((jel) => elsoBekezdes.includes(jel))
    ? torzs.slice(bekezdesVeg)
    : torzs

  // ŐR: a levágás után a törzs SEHOL nem tartalmazhat lektori jelölést.
  const maradek = torzsSorok.join('\n')
  for (const jel of LEKTORI_JELOLESEK) {
    if (maradek.includes(jel)) {
      throw new Error(
        `A cikk törzsében lektornak szóló szöveg maradt: „${jel}”. Ez a nyilvános ` +
          'oldalra és az og:description mezőbe is kikerülne. Nézd át a cikkfájl szerkezetét.',
      )
    }
  }

  // ŐR: forrás-hivatkozás sem maradhat a törzsben (tulajdonosi döntés, 2026-08-21).
  for (const jel of FORRAS_JELOLESEK) {
    if (maradek.includes(jel)) {
      throw new Error(
        `A cikk törzsében forrás-hivatkozás maradt: „${jel}”. A tulajdonos döntése ` +
          'szerint a cikkszöveg nem tartalmaz forrásmegjelölést. Írd át a mondatot ' +
          'úgy, hogy az állítás megmaradjon, a forrás neve viszont ne szerepeljen.',
      )
    }
  }

  return { title, lines: torzsSorok }
}

interface InlineDarab {
  text: string
  format: number
  url?: string
}

/**
 * Soron belüli formázás: `**félkövér**`, `*dőlt*` és `[felirat](webcím)`.
 *
 * Egy menetben, balról jobbra olvassuk a sort, mert a három minta egymásba is
 * ágyazódhat a szövegben (pl. dőlt zárójeles megjegyzés egy félkövér mondat
 * után). A `**` mintát a `*` ELŐTT próbáljuk, különben a félkövér nyitása két
 * üres dőlt jelölésnek látszana.
 */
function darabokra(sor: string): InlineDarab[] {
  const darabok: InlineDarab[] = []
  let puffer = ''
  let i = 0

  const pufferKiir = (): void => {
    if (puffer.length > 0) {
      darabok.push({ text: puffer, format: 0 })
      puffer = ''
    }
  }

  while (i < sor.length) {
    if (sor.startsWith('**', i)) {
      const zaro = sor.indexOf('**', i + 2)
      if (zaro > i + 1) {
        pufferKiir()
        darabok.push({ text: sor.slice(i + 2, zaro), format: FORMAT_BOLD })
        i = zaro + 2
        continue
      }
    }
    if (sor[i] === '*') {
      const zaro = sor.indexOf('*', i + 1)
      if (zaro > i) {
        pufferKiir()
        darabok.push({ text: sor.slice(i + 1, zaro), format: FORMAT_ITALIC })
        i = zaro + 1
        continue
      }
    }
    if (sor[i] === '[') {
      const zarojel = sor.indexOf('](', i)
      if (zarojel > i) {
        const veg = sor.indexOf(')', zarojel + 2)
        if (veg > zarojel) {
          pufferKiir()
          darabok.push({
            text: sor.slice(i + 1, zarojel),
            format: 0,
            url: sor.slice(zarojel + 2, veg),
          })
          i = veg + 1
          continue
        }
      }
    }
    puffer += sor[i]
    i += 1
  }
  pufferKiir()
  return darabok
}

/** Egy szövegsor Lexical gyermek-csomópontjai (szöveg és link keverve). */
export function inlineNodes(sor: string): BlockNode[] {
  return darabokra(sor).map((darab) =>
    darab.url === undefined
      ? textNode(darab.text, darab.format)
      : ({
          type: 'link',
          fields: {
            linkType: 'custom',
            url: darab.url,
            newTab: /^https?:\/\//i.test(darab.url),
          },
          children: [textNode(darab.text, darab.format)],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        } as BlockNode),
  )
}

const bekezdes = (sor: string): BlockNode => ({
  type: 'paragraph',
  children: inlineNodes(sor),
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

const cimsor = (tag: 'h2' | 'h3' | 'h4', sor: string): BlockNode => ({
  type: 'heading',
  tag,
  children: inlineNodes(sor),
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

const lista = (tetelek: string[], szamozott: boolean): BlockNode => ({
  type: 'list',
  listType: szamozott ? 'number' : 'bullet',
  tag: szamozott ? 'ol' : 'ul',
  start: 1,
  children: tetelek.map((tetel, index) => ({
    type: 'listitem',
    value: index + 1,
    children: inlineNodes(tetel),
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  })),
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

const idezet = (sorok: string[]): BlockNode => ({
  type: 'quote',
  children: sorok.map((sor) => bekezdes(sor)),
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

const FELSOROLAS = /^[-*] +(.*)$/
const SZAMOZOTT = /^\d+\. +(.*)$/
const TABLA_ELVALASZTO = /^:?-+:?$/

/** Egy markdown-táblasor cellái, a szélső üres pipe-ok nélkül. */
function tablaCellak(sor: string): string[] {
  const trimmelt = sor.trim()
  const belso = trimmelt.startsWith('|') ? trimmelt.slice(1) : trimmelt
  const veg = belso.endsWith('|') ? belso.slice(0, -1) : belso
  return veg.split('|').map((cella) => cella.trim())
}

function tablaElvalaszto(cellak: readonly string[]): boolean {
  return (
    cellak.length > 0 &&
    cellak.every((cella) => cella.length === 0 || TABLA_ELVALASZTO.test(cella))
  )
}

/**
 * Markdown-tábla → bekezdés + felsorolás.
 *
 * A storefront szerializálója és a Payload alapszerkesztője nem ismer táblázat-
 * csomópontot. A cellák szövegét ezért ismert csomópontokban tartjuk: minden
 * adat-sor egy felsorolás, a fejléc szövege a tétel elején („Fejléc: érték”),
 * hogy a T4 szószám-őr és a látogató is megkapja a teljes tartalmat.
 */
function tablaCsomopontok(sorok: readonly string[]): BlockNode[] {
  const parsed = sorok
    .map(tablaCellak)
    .filter((cellak) => !tablaElvalaszto(cellak) && cellak.some((cella) => cella.length > 0))
  if (parsed.length < 2) {
    throw new Error(
      'Táblázat a cikk törzsében fejléc vagy adatsor nélkül: a fordítás nem tudja, mit mutasson.',
    )
  }
  const fejlec = parsed[0]
  const csomopontok: BlockNode[] = []
  for (const sor of parsed.slice(1)) {
    const tetelek: string[] = []
    const oszlopok = Math.max(fejlec.length, sor.length)
    for (let i = 0; i < oszlopok; i += 1) {
      const ertek = (sor[i] ?? '').trim()
      if (ertek.length === 0) continue
      const fej = (fejlec[i] ?? '').trim()
      tetelek.push(fej.length > 0 ? `${fej}: ${ertek}` : ertek)
    }
    if (tetelek.length === 0) continue
    csomopontok.push(lista(tetelek, false))
  }
  if (csomopontok.length === 0) {
    throw new Error('Táblázat a cikk törzsében üres adatsorokkal.')
  }
  return csomopontok
}

/**
 * A törzs sorait Lexical-dokumentummá fordítja.
 *
 * Fel nem ismert szerkezetre KIVÉTELT DOB (lásd a modul fejlécét): a néma
 * elnyelés rosszabb, mint a hangos leállás, mert az előbbi hiánytalannak
 * látszó, valójában csonka cikket tenne ki a nyilvános oldalra.
 */
export function markdownToLexical(lines: readonly string[]): RichTextContent {
  const csomopontok: BlockNode[] = []
  let i = 0

  while (i < lines.length) {
    const sor = lines[i]
    const trimmelt = sor.trim()

    if (trimmelt.length === 0) {
      i += 1
      continue
    }

    if (trimmelt.startsWith('|')) {
      const tablaSorok: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tablaSorok.push(lines[i])
        i += 1
      }
      csomopontok.push(...tablaCsomopontok(tablaSorok))
      continue
    }
    if (trimmelt.startsWith('```')) {
      throw new Error(
        `Kódblokk a cikk törzsében (${i + 1}. sor): a szerializáló nem rendereli. ` +
          'Cikkszövegben nincs is helye.',
      )
    }
    if (trimmelt.startsWith('# ')) {
      throw new Error(
        `Második H1 a törzsben (${i + 1}. sor): egy cikknek egy címe van, és azt a ` +
          'lap fejléce adja.',
      )
    }

    if (trimmelt === '---' || trimmelt === '***') {
      csomopontok.push({
        type: 'horizontalrule',
        version: 1,
      } as BlockNode)
      i += 1
      continue
    }

    if (trimmelt.startsWith('#### ')) {
      csomopontok.push(cimsor('h4', trimmelt.slice(5).trim()))
      i += 1
      continue
    }
    if (trimmelt.startsWith('### ')) {
      csomopontok.push(cimsor('h3', trimmelt.slice(4).trim()))
      i += 1
      continue
    }
    if (trimmelt.startsWith('## ')) {
      csomopontok.push(cimsor('h2', trimmelt.slice(3).trim()))
      i += 1
      continue
    }

    if (trimmelt.startsWith('> ')) {
      const sorok: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        sorok.push(lines[i].trim().slice(2).trim())
        i += 1
      }
      csomopontok.push(idezet(sorok))
      continue
    }

    const felsorolas = FELSOROLAS.exec(trimmelt)
    if (felsorolas) {
      const tetelek: string[] = []
      while (i < lines.length) {
        const talalat = FELSOROLAS.exec(lines[i].trim())
        if (!talalat) break
        tetelek.push(talalat[1].trim())
        i += 1
      }
      csomopontok.push(lista(tetelek, false))
      continue
    }

    const szamozott = SZAMOZOTT.exec(trimmelt)
    if (szamozott) {
      const tetelek: string[] = []
      while (i < lines.length) {
        const talalat = SZAMOZOTT.exec(lines[i].trim())
        if (!talalat) break
        tetelek.push(talalat[1].trim())
        i += 1
      }
      csomopontok.push(lista(tetelek, true))
      continue
    }

    // Bekezdés: a következő üres sorig tartó, összefüggő szövegblokk.
    const bekezdesSorok: string[] = []
    while (i < lines.length) {
      const aktualis = lines[i].trim()
      if (
        aktualis.length === 0 ||
        aktualis.startsWith('#') ||
        aktualis.startsWith('|') ||
        aktualis.startsWith('> ') ||
        aktualis === '---' ||
        FELSOROLAS.test(aktualis) ||
        SZAMOZOTT.test(aktualis)
      ) {
        break
      }
      bekezdesSorok.push(aktualis)
      i += 1
    }
    csomopontok.push(bekezdes(bekezdesSorok.join(' ')))
  }

  if (csomopontok.length === 0) {
    throw new Error('A cikk törzse üres lett a fordítás után.')
  }
  return richText(csomopontok)
}

/**
 * Rövid bevezető (excerpt) a törzs első valódi bekezdéséből.
 *
 * A `PostCard` a lista-változatban ezt mutatja, és a Google is ezt veheti
 * leírásnak. A vágás mondathatáron történik, hogy ne csonka félmondat álljon
 * a kártyán; a felső korlát 200 karakter (a mért kártyaszélességen ez 3–4 sor).
 */
export function excerptFrom(lines: readonly string[], maxLength = 200): string {
  for (const sor of lines) {
    const trimmelt = sor.trim()
    if (
      trimmelt.length === 0 ||
      trimmelt.startsWith('#') ||
      trimmelt.startsWith('>') ||
      trimmelt.startsWith('|') ||
      FELSOROLAS.test(trimmelt) ||
      SZAMOZOTT.test(trimmelt)
    ) {
      continue
    }
    const tiszta = trimmelt
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim()
    if (tiszta.length <= maxLength) {
      return tiszta
    }
    const vagott = tiszta.slice(0, maxLength)
    const mondatVeg = Math.max(vagott.lastIndexOf('. '), vagott.lastIndexOf('? '))
    if (mondatVeg > maxLength / 2) {
      return vagott.slice(0, mondatVeg + 1).trim()
    }
    return `${vagott.slice(0, vagott.lastIndexOf(' ')).trim()}…`
  }
  throw new Error('A cikk törzsében nincs bekezdés, amiből bevezetőt lehetne képezni.')
}
