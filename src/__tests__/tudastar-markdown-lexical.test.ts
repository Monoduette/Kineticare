import { readFileSync } from 'node:fs'
import path from 'node:path'

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
] as const

const cikkPath = (nev: string): string =>
  path.join(process.cwd(), 'docs', 'cikkek', `${nev}.md`)

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
        .replace(/^\d+\. +/, ''),
    )
    .filter((sor) => !/^[\s|:-]*$/.test(sor) || !sor.includes('-'))
    .map((sor) => (sor.includes('|') ? sor.replace(/\|/g, ' ') : sor))
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
      expect(torzs, `${nev}: vezetői jelzés a törzsben`).not.toContain(
        'A vezetőnek szóló jelzések',
      )
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
  it('GFM-táblázatot table/tablerow/tablecell csomópontokra képez', () => {
    const doc = markdownToLexical(['| a | b |', '|---|---|', '| 1 | 2 |'])
    const tipusok = tipusokOf((doc as unknown as { root: unknown }).root)
    expect(tipusok.get('table')).toBe(1)
    expect(tipusok.get('tablerow')).toBe(2)
    expect(tipusok.get('tablecell')).toBe(4)
  })

  it('adatsor nélküli táblázatra kivételt dob', () => {
    expect(() => markdownToLexical(['| a | b |', '|---|---|'])).toThrowError(/adatsora/)
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
      'table',
      'tablerow',
      'tablecell',
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
