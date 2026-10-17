import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  excerptFrom,
  extractArticleBody,
  FORRAS_JELOLESEK,
  inlineNodes,
  LEKTORI_JELOLESEK,
  markdownToLexical,
} from '../lib/tudastar/markdown-to-lexical'

/**
 * Őrök a Tudástár markdown → Lexical fordítására.
 *
 * A legfontosabb állítás nem az, hogy „lefut”, hanem hogy NEM VESZÍT SZÖVEGET.
 * A storefront szerializálója véges csomópont-készletet ismer, ezért egy
 * félrefordított szerkezet némán eltűnne a nyilvános oldalról, miközben az
 * adatbázisban minden rendben lévőnek látszana. A T4 teszt ezt méri
 * cikkenként, szószámmal.
 */

const CIKKEK = [
  '1-miert-zsibbad-a-kezem',
  '2-keztoalagut-szindroma',
  '3-teniszkonyok',
  '4-pattano-ujj',
  '5-csuklo-es-kezfajdalom',
  '6-csuklotores-utani-gyogytorna',
  '7-inhuvelygyulladas',
  '8-befagyott-vall',
  '9-peace-and-love-friss-serules',
  '10-gipszben-a-kezed',
] as const

const cikkPath = (nev: string): string => path.join(process.cwd(), 'docs', 'cikkek', `${nev}.md`)

interface LexicalLike {
  type?: string
  text?: string
  children?: unknown[]
}

/** A Lexical-fából visszanyert nyers szöveg. */
function szovegeOf(node: unknown): string {
  if (node === null || typeof node !== 'object') return ''
  const n = node as LexicalLike
  if (n.type === 'text') return typeof n.text === 'string' ? n.text : ''
  const gyerekek = Array.isArray(n.children) ? n.children : []
  return gyerekek.map(szovegeOf).join(' ')
}

function tipusokOf(node: unknown, acc: Map<string, number> = new Map()): Map<string, number> {
  if (node !== null && typeof node === 'object') {
    const n = node as LexicalLike
    if (typeof n.type === 'string') acc.set(n.type, (acc.get(n.type) ?? 0) + 1)
    for (const gy of Array.isArray(n.children) ? n.children : []) tipusokOf(gy, acc)
  }
  return acc
}

/**
 * A markdown-jelölésektől megtisztított bemenet, a szószám-összevetéshez.
 *
 * FONTOS: a kötőjelet NEM bántjuk. Az első változat globálisan szóközre
 * cserélte, és ezzel szétvágta a magyar összetételeket („kéztőalagút-szindróma”
 * → két szó) meg az ISO-dátumokat („2026-08-21” → három szó). Így az alapvonal
 * 2–4,5%-kal TÖBB szót számolt, mint amennyi a szövegben van, és a fordító
 * úgy látszott, mintha veszítene. Mérve: az 1. cikken 279 „hiányzó” szóból
 * mind ilyen műtermék volt. A listajelet és a címsor-jelölést ezért csak a
 * SOR ELEJÉN távolítjuk el, nem a sor belsejében.
 */
function nyersSzoveg(sorok: readonly string[]): string {
  return sorok
    .map((sor) =>
      sor
        .trim()
        .replace(/^#+ +/, '')
        .replace(/^> ?/, '')
        .replace(/^[-*] +/, '')
        .replace(/^\d+\. +/, '')
        .replace(/^\|[-:| ]+\|$/, '')
        .replace(/\|/g, ' '),
    )
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const szavak = (s: string): number => s.split(/\s+/).filter(Boolean).length

describe('T1 — a törzs kivágása', () => {
  it('az UTOLSÓ H1-et veszi címnek, nem a lektori figyelmeztetést', () => {
    const md = readFileSync(cikkPath('4-pattano-ujj'), 'utf8')
    const { title } = extractArticleBody(md)
    expect(title).toBe('Pattanó ujj: miért akad be az ujjad, és mit tehetsz otthon?')
    expect(title).not.toContain('LEKTORÁLANDÓ')
  })

  it('levágja a vezetőnek és a lektornak szóló szakaszokat', () => {
    for (const nev of CIKKEK) {
      const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
      const torzs = lines.join('\n')
      expect(torzs, `${nev}: önteszt a törzsben`).not.toContain('a cikkíró öntesztje')
      expect(torzs, `${nev}: vezetői jelzés a törzsben`).not.toContain('A vezetőnek szóló jelzések')
    }
  })

  it.each(CIKKEK)('%s törzsében NINCS lektornak szóló szöveg', (nev) => {
    // A 2026-08-21-i éles hiba őre: a figyelmeztetés a H1 ALATT állt, ezért a
    // törzsbe került, és a cikkoldalon LÁTHATÓAN, az og:description mezőben
    // pedig a megosztásokon is megjelent. A szószám-őr ezt nem fogta meg, mert
    // a mondat szöveg — csak épp nem a látogatónak szól.
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const torzs = lines.join('\n')
    for (const jel of LEKTORI_JELOLESEK) {
      expect(torzs, `${nev}: lektori jelölés a törzsben: ${jel}`).not.toContain(jel)
    }
  })

  it.each(CIKKEK)('%s bevezetője a VALÓDI első mondattal kezdődik', (nev) => {
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const excerpt = excerptFrom(lines)
    expect(excerpt).not.toContain('lektorálandó')
    expect(excerpt).not.toContain('gyógytornász szakmai jóváhagyása')
  })

  it.each(CIKKEK)('%s törzsében NINCS forrás-hivatkozás', (nev) => {
    // Tulajdonosi döntés (2026-08-21): a cikkszöveg nem tartalmaz
    // forrásmegjelölést. Az őr azt védi, hogy ez ne csússzon vissza egy
    // későbbi szerkesztéssel — nem azt állítja, hogy szakmailag ez a jobb.
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const torzs = lines.join('\n')
    for (const jel of FORRAS_JELOLESEK) {
      expect(torzs, `${nev}: forrás-hivatkozás a törzsben: ${jel}`).not.toContain(jel)
    }
  })

  it('a cikk RÉSZÉT képező záró szakaszokat viszont bent tartja', () => {
    const { lines } = extractArticleBody(readFileSync(cikkPath('4-pattano-ujj'), 'utf8'))
    const torzs = lines.join('\n')
    expect(torzs).toContain('Kik írták ezt a cikket?')
    expect(torzs).toContain('Fontos tudnivaló')
  })
})

describe('T2 — soron belüli formázás', () => {
  it('félkövér, dőlt és link', () => {
    const nodes = inlineNodes('Ez **fontos**, ez *árnyalat*, ez meg [link](https://pelda.hu).')
    const talalt = nodes.map((n) => {
      const x = n as unknown as { type?: string; format?: number }
      return `${x.type}:${x.format ?? ''}`
    })
    expect(talalt).toContain('text:1')
    expect(talalt).toContain('text:2')
    expect(talalt).toContain('link:')
  })

  it('a külső link új lapon nyílik, a belső nem', () => {
    const kulso = inlineNodes('[x](https://pelda.hu)')[0] as unknown as {
      fields: { newTab: boolean }
    }
    const belso = inlineNodes('[x](/kurzusok)')[0] as unknown as {
      fields: { newTab: boolean }
    }
    expect(kulso.fields.newTab).toBe(true)
    expect(belso.fields.newTab).toBe(false)
  })
})

describe('T3 — a fel nem ismert szerkezet HANGOSAN bukik', () => {
  it('a törzsbeli táblázatot ismert csomópontokra fordítja, szót nem veszt', () => {
    const doc = markdownToLexical(['| Fejléc A | Fejléc B |', '|---|---|', '| alma | körte |'])
    const szoveg = szovegeOf((doc as unknown as { root: unknown }).root)
    expect(szoveg).toContain('Fejléc A')
    expect(szoveg).toContain('alma')
    expect(szoveg).toContain('körte')
  })

  it('a táblázat-sor címe nem lehet egyetlen link (a storefront gombként mutatná)', () => {
    expect(() =>
      markdownToLexical(['| | Leírás |', '|---|---|', '| [Kurzus](/kurzusok/a) | szöveg |']),
    ).toThrowError(/csak link/)
  })

  it.each([
    ['táblázat után közvetlenül lista', ['| A | B |', '|---|---|', '| a | b |', '', '- c']],
    ['üres sorral elválasztott listatételek', ['- a', '', '- b']],
  ])('két egymás melletti felsorolásra kivételt dob: %s', (_eset, sorok) => {
    expect(() => markdownToLexical(sorok)).toThrowError(/egybefűzné/)
  })

  it('kódblokkra kivételt dob', () => {
    expect(() => markdownToLexical(['```js', 'kod()', '```'])).toThrowError(/Kódblokk/)
  })

  it('a törzsbe került második H1-re kivételt dob', () => {
    expect(() => markdownToLexical(['# Másik cím'])).toThrowError(/Második H1/)
  })
})

describe('T4 — MÉRT szövegveszteség: nulla', () => {
  it.each(CIKKEK)('%s minden szava átjön a Lexical-fába', (nev) => {
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const doc = markdownToLexical(lines)
    const beSzavak = szavak(nyersSzoveg(lines))
    const kiSzavak = szavak(szovegeOf((doc as unknown as { root: unknown }).root))
    expect(beSzavak).toBeGreaterThan(300)
    // A fordítás nem dobhat el szöveget. A felső tűrés a listajelek és a
    // címsor-kettőskeresztek eltűnése miatt van (azok nem szavak).
    expect(kiSzavak / beSzavak).toBeGreaterThan(0.99)
  })

  it.each(CIKKEK)('%s csak a szerializáló által ismert csomóponttípusokat használ', (nev) => {
    const ISMERT = new Set([
      'root',
      'text',
      'paragraph',
      'heading',
      'list',
      'listitem',
      'quote',
      'link',
      'horizontalrule',
      'linebreak',
    ])
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const doc = markdownToLexical(lines)
    const tipusok = tipusokOf((doc as unknown as { root: unknown }).root)
    for (const tipus of tipusok.keys()) {
      expect(ISMERT.has(tipus), `${nev}: ismeretlen csomóponttípus: ${tipus}`).toBe(true)
    }
  })
})

describe('T5 — bevezető', () => {
  it.each(CIKKEK)('%s bevezetője értelmes hosszú és jelöléstől mentes', (nev) => {
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const excerpt = excerptFrom(lines)
    expect(excerpt.length).toBeGreaterThan(40)
    expect(excerpt.length).toBeLessThanOrEqual(201)
    expect(excerpt).not.toMatch(/[*#|]|\]\(/)
  })
})

describe('T6 — a 7. és 8. cikk zárai', () => {
  it('a befagyott váll törzse nem írja a „fagyott váll” alakot', () => {
    const { lines } = extractArticleBody(readFileSync(cikkPath('8-befagyott-vall'), 'utf8'))
    expect(lines.join('\n')).not.toMatch(/(?<![Bb]e)fagyott váll/)
  })

  it('az ínhüvelygyulladás törzse blog-útvonalra hivatkozik, nem gyökér hubra', () => {
    const { lines } = extractArticleBody(readFileSync(cikkPath('7-inhuvelygyulladas'), 'utf8'))
    const torzs = lines.join('\n')
    expect(torzs).not.toMatch(/\]\(\/inhuvelygyulladas\)/)
    expect(torzs).toContain('/blog/pattano-ujj')
    expect(torzs).toContain('/blog/keztoalagut-szindroma')
    expect(torzs).toContain('/blog/csuklo-es-kezfajdalom')
    expect(torzs).toContain('/kurzusok/otthoni-kezrehab-program')
    expect(torzs).not.toContain('de-quervain-szindroma')
  })

  it('a befagyott váll törzse a szolgáltatásokra visz, nem kurzus-CTA-ra', () => {
    const { lines } = extractArticleBody(readFileSync(cikkPath('8-befagyott-vall'), 'utf8'))
    const torzs = lines.join('\n')
    expect(torzs).toContain('/szolgaltatasok')
    expect(torzs).not.toContain('/kurzusok/otthoni-kezrehab-program')
  })

  it('az importer listája megtartja az eredeti hat slughot, felveszi a kettőt és a két tulajdonosi piszkozatot', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/scripts/import-tudastar-cikkek.ts'),
      'utf8',
    )
    for (const slug of [
      'miert-zsibbad-a-kezem',
      'keztoalagut-szindroma',
      'teniszkonyok',
      'pattano-ujj',
      'csuklo-es-kezfajdalom',
      'csuklotores-utani-gyogytorna',
      'inhuvelygyulladas',
      'befagyott-vall',
      'peace-and-love-friss-serules',
      'gipszben-a-kezed',
    ]) {
      expect(src).toContain(`slug: '${slug}'`)
    }
    expect(src).not.toMatch(/kapcsolodoSlugok: \[[^\]]*de-quervain-szindroma/)
  })
})

/**
 * T7 — a szerkesztő nem vonhatja össze a táblázat sorait (2026-10-17, a #329
 * kritikus körének megerősített találata).
 *
 * A Lexical 0.50 (a Payload 3.90.2 szerkesztője) betöltéskor minden
 * csomópontot piszkosnak jelöl, és a lista-transzformáció az egymás melletti,
 * azonos típusú felsorolásokat egybefűzi. Az első gépelés után a mentés ezt az
 * összefűzött állapotot írja vissza: a táblázat soronkénti listái egy hosszú
 * listává olvadnak a nyilvános oldalon. A szerződés: a fordító kimenete a
 * telepített szerkesztőben betöltve és egyszer szerkesztve is ugyanaz a
 * szerkezet marad.
 */
describe('T7 — a szerkesztőben szerkesztve is megmarad a szerkezet', () => {
  type Csomopont = { type?: string; listType?: string; children?: Csomopont[] }
  const gyokerGyerekek = (doc: unknown): Csomopont[] =>
    ((doc as { root: { children: Csomopont[] } }).root.children ?? []) as Csomopont[]
  /**
   * A teljes fa a szerkesztő saját, a megjelenítést nem érintő kulcsai
   * (`textFormat`, `textStyle`, `direction`, `version`) nélkül.
   */
  const kanonikus = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(kanonikus)
    if (node === null || typeof node !== 'object') return node
    return Object.fromEntries(
      Object.entries(node)
        .filter(([kulcs]) => !['textFormat', 'textStyle', 'direction', 'version'].includes(kulcs))
        .map(([kulcs, ertek]) => [kulcs, kanonikus(ertek)]),
    )
  }

  it.each(CIKKEK)('%s: nincs két egymás melletti, azonos típusú felsorolás', (nev) => {
    const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
    const gyerekek = gyokerGyerekek(markdownToLexical(lines))
    for (let i = 1; i < gyerekek.length; i += 1) {
      const elozo = gyerekek[i - 1]
      const aktualis = gyerekek[i]
      expect(
        elozo.type === 'list' && aktualis.type === 'list' && elozo.listType === aktualis.listType,
        `${nev}: a ${i}. és ${i + 1}. csomópont egymás melletti ${aktualis.listType} lista`,
      ).toBe(false)
    }
  })

  it.each(CIKKEK)(
    '%s: a telepített Lexical-szerkesztőben betöltve és egyszer szerkesztve ugyanaz a szerkezet',
    async (nev) => {
      // A szerkesztő a @payloadcms/richtext-lexical függősége: szándékosan a
      // telepített változatot töltjük be, mert annak viselkedése a szerződés.
      const csomag = (ut: string) =>
        import(pathToFileURL(path.join(process.cwd(), 'node_modules', ut)).href)
      const { createHeadlessEditor } = await import('@lexical/headless')
      const { HeadingNode, QuoteNode } = await import('@lexical/rich-text')
      const { ListItemNode, ListNode } = await import('@lexical/list')
      const { $getRoot, $isTextNode } = await import('lexical')
      const { LinkNode } = await csomag(
        '@payloadcms/richtext-lexical/dist/features/link/nodes/LinkNode.js',
      )
      const { HorizontalRuleServerNode } = await csomag(
        '@payloadcms/richtext-lexical/dist/features/horizontalRule/server/nodes/HorizontalRuleNode.js',
      )

      const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
      const doc = markdownToLexical(lines)
      const editor = createHeadlessEditor({
        nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, HorizontalRuleServerNode],
        onError: (error: Error) => {
          throw error
        },
      })
      editor.setEditorState(editor.parseEditorState(JSON.stringify(doc)))
      // Egy elütés és a javítása a bevezetőben: a mentés ezután a teljes
      // állapotot írja, a szöveg pedig ugyanaz, mint előtte.
      for (const javitas of [(t: string) => `${t}x`, (t: string) => t.slice(0, -1)]) {
        editor.update(
          () => {
            const elso = $getRoot()
              .getAllTextNodes()
              .find((node) => $isTextNode(node))
            elso?.setTextContent(javitas(elso.getTextContent()))
          },
          { discrete: true },
        )
      }
      const utana = editor.getEditorState().toJSON() as unknown
      expect(kanonikus(gyokerGyerekek(utana))).toEqual(kanonikus(gyokerGyerekek(doc)))
    },
  )
})
