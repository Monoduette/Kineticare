import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  extractArticleBody,
  inlineNodes,
  markdownToLexical,
} from '../lib/tudastar/markdown-to-lexical'
import { tablaSorokSzetvalasztasa } from '../lib/tudastar/tabla-sorok'
import { richText, textNode, type BlockNode } from '../scripts/restore-legacy-content'
import { javitsdTudastarTablaSorokat, type TablaSorokPayload } from '../scripts/apply-owner-content'

/**
 * P3 (2026-10-17): a Tudástár TÁROLT táblázat-sorainak szétválasztása helyben,
 * a szerkesztői javítások megtartásával (src/lib/tudastar/tabla-sorok.ts), és
 * a tartalomjob szabálya (apply-owner-content.ts `tudastar-tabla-sorok`).
 *
 * Szerződések:
 * 1. A régi fordító (a #329 előtti markdown-to-lexical) táblázat-alakjából
 *    PONTOSAN az új fordító szerkezete lesz (bekezdés + felsorolás soronként),
 *    a 7. és 8. cikk valódi táblázatán mérve.
 * 2. A telepített Lexical-szerkesztő a régi alakot egybefűzi (ez a hiba), a
 *    szétválasztottat nem (ez a javítás).
 * 3. Csak a táblázat-alakú futamokhoz nyúl: más csomópont ugyanaz a referencia,
 *    a szerkesztői szöveg megmarad; nem táblázat-alakú szomszédos listát nem
 *    bánt, de jelent. Idempotens.
 * 4. A job csak közzétett, piszkozat nélküli dokumentumba ír, próbafutásban
 *    sosem.
 */

const cikkPath = (nev: string): string => path.join(process.cwd(), 'docs', 'cikkek', `${nev}.md`)

/** A cikk törzsének első markdown-táblája (a `|` kezdetű sorok első futama). */
function elsoTabla(nev: string): string[] {
  const { lines } = extractArticleBody(readFileSync(cikkPath(nev), 'utf8'))
  const kezdet = lines.findIndex((sor) => sor.trim().startsWith('|'))
  expect(kezdet, `${nev}: nincs táblázat a törzsben`).toBeGreaterThanOrEqual(0)
  const tabla: string[] = []
  for (let i = kezdet; i < lines.length && lines[i].trim().startsWith('|'); i += 1) {
    tabla.push(lines[i])
  }
  return tabla
}

const cellak = (sor: string): string[] => {
  const belso = sor.trim().replace(/^\|/, '').replace(/\|$/, '')
  return belso.split('|').map((c) => c.trim())
}

const lista = (tetelek: string[], listType: 'bullet' | 'number' = 'bullet'): BlockNode =>
  ({
    type: 'list',
    listType,
    tag: listType === 'number' ? 'ol' : 'ul',
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
  }) as BlockNode

/**
 * A RÉGI fordító táblázat-kimenete (a #329 előtti `tablaCsomopontok`): minden
 * adat-sor egy felsorolás, a tételek „Fejléc: érték” alakban, egymás mellett.
 */
function regiTablaCsomopontok(tabla: readonly string[]): BlockNode[] {
  const sorok = tabla.map(cellak).filter((c) => !c.every((x) => /^:?-+:?$/.test(x) || x === ''))
  const fejlec = sorok[0]
  return sorok.slice(1).map((sor) => {
    const tetelek: string[] = []
    for (let i = 0; i < Math.max(fejlec.length, sor.length); i += 1) {
      const ertek = (sor[i] ?? '').trim()
      if (ertek.length === 0) continue
      const fej = (fejlec[i] ?? '').trim()
      tetelek.push(fej.length > 0 ? `${fej}: ${ertek}` : ertek)
    }
    return lista(tetelek)
  })
}

const bekezdes = (szoveg: string): BlockNode =>
  ({
    type: 'paragraph',
    children: [textNode(szoveg)],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  }) as BlockNode

const kanonikus = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(kanonikus)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([kulcs]) => !['textFormat', 'textStyle', 'direction', 'version'].includes(kulcs))
      .map(([kulcs, ertek]) => [kulcs, kanonikus(ertek)]),
  )
}

const gyokerGyerekek = (doc: unknown): BlockNode[] =>
  (doc as { root: { children: BlockNode[] } }).root.children

async function szerkesztoben(doc: unknown): Promise<BlockNode[]> {
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
  const editor = createHeadlessEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, HorizontalRuleServerNode],
    onError: (error: Error) => {
      throw error
    },
  })
  editor.setEditorState(editor.parseEditorState(JSON.stringify(doc)))
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
  return gyokerGyerekek(editor.getEditorState().toJSON())
}

describe('tablaSorokSzetvalasztasa: a tárolt táblázat-sorok', () => {
  it.each(['7-inhuvelygyulladas', '8-befagyott-vall'])(
    '%s: a régi fordító alakjából pontosan az új fordító szerkezete lesz',
    (nev) => {
      const tabla = elsoTabla(nev)
      const regi = richText(regiTablaCsomopontok(tabla))
      expect(gyokerGyerekek(regi).length).toBeGreaterThanOrEqual(2)
      const eredmeny = tablaSorokSzetvalasztasa(regi)
      expect(eredmeny.content).not.toBeNull()
      expect(eredmeny.sorok).toBe(gyokerGyerekek(regi).length)
      expect(eredmeny.egyebFutamok).toEqual([])
      expect(kanonikus(gyokerGyerekek(eredmeny.content))).toEqual(
        kanonikus(gyokerGyerekek(markdownToLexical(tabla))),
      )
    },
  )

  it('7-inhuvelygyulladas: a szerkesztő a régi alakot egybefűzi, a szétválasztottat nem', async () => {
    const regi = richText(regiTablaCsomopontok(elsoTabla('7-inhuvelygyulladas')))
    const regiSzerkesztve = await szerkesztoben(regi)
    // A hiba: a sorok egyetlen listába olvadnak.
    expect(regiSzerkesztve).toHaveLength(1)
    expect((regiSzerkesztve[0] as { type: string }).type).toBe('list')

    const javitott = tablaSorokSzetvalasztasa(regi).content
    const javitottSzerkesztve = await szerkesztoben(javitott)
    expect(kanonikus(javitottSzerkesztve)).toEqual(kanonikus(gyokerGyerekek(javitott)))
  })

  it('a szerkesztői javítás megmarad, a nem érintett csomópont ugyanaz a referencia, második futásra nincs teendő', () => {
    const elotte = bekezdes('Bevezető, az adminban javítva.')
    const utana = lista(['Önálló felsorolás, nem táblázat'])
    const sor1 = lista(['Tünet: zsibbadás', 'Teendő: pihentetés (az adminban átírva)'])
    const sor2 = lista(['Tünet: fájdalom', 'Teendő: hűtés'])
    const kozte = bekezdes('A táblázat után bekezdés áll.')
    const regi = richText([elotte, sor1, sor2, kozte, utana])

    const eredmeny = tablaSorokSzetvalasztasa(regi)
    expect(eredmeny.sorok).toBe(2)
    const gyerekek = gyokerGyerekek(eredmeny.content) as Array<BlockNode & { type: string }>
    expect(gyerekek.map((g) => g.type)).toEqual([
      'paragraph',
      'paragraph',
      'list',
      'paragraph',
      'list',
      'paragraph',
      'list',
    ])
    expect(gyerekek[0]).toBe(elotte)
    expect(gyerekek[5]).toBe(kozte)
    expect(gyerekek[6]).toBe(utana)
    expect(JSON.stringify(gyerekek[2])).toContain('az adminban átírva')
    const cim = gyerekek[1] as unknown as { children: Array<{ text: string; format: number }> }
    expect(cim.children[0]).toMatchObject({ text: 'Tünet: zsibbadás', format: 1 })

    const masodik = tablaSorokSzetvalasztasa(
      eredmeny.content as NonNullable<typeof eredmeny.content>,
    )
    expect(masodik.content).toBeNull()
    expect(masodik.sorok).toBe(0)
  })

  it('nem táblázat-alakú szomszédos listákhoz nem nyúl, de jelenti őket', () => {
    const a = lista(['első pont', 'második pont'])
    const b = lista(['harmadik pont'])
    const c = lista(['Lépés: egy'], 'number')
    const d = lista(['Lépés: kettő'], 'number')
    const regi = richText([a, b, bekezdes('köztes'), c, d])
    const eredmeny = tablaSorokSzetvalasztasa(regi)
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.sorok).toBe(0)
    expect(eredmeny.egyebFutamok).toEqual([
      'gyökér: a 1–2. csomópont 2 egymás melletti bullet lista',
      'gyökér: a 4–5. csomópont 2 egymás melletti number lista',
    ])
  })

  it('a táblázatot közvetlenül követő, nem táblázat-alakú lista az egész futamot emberi döntésre hagyja', () => {
    const regi = richText([
      lista(['Tünet: zsibbadás', 'Teendő: pihentetés']),
      lista(['Tünet: fájdalom', 'Teendő: hűtés']),
      lista(['Önálló felsorolás, nem táblázat']),
    ])
    const eredmeny = tablaSorokSzetvalasztasa(regi)
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.egyebFutamok).toEqual([
      'gyökér: a 1–3. csomópont 3 egymás melletti bullet lista',
    ])
  })

  it('eltérő fejlécű sorok (két külön tábla egymás után) sem számítanak egy táblázatnak', () => {
    const regi = richText([
      lista(['Tünet: zsibbadás', 'Teendő: pihentetés']),
      lista(['Gyakorlat: nyújtás']),
    ])
    const eredmeny = tablaSorokSzetvalasztasa(regi)
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.egyebFutamok).toHaveLength(1)
  })
})

describe('javitsdTudastarTablaSorokat: a tartalomjob szabálya', () => {
  const tablas = () =>
    richText([
      lista(['Tünet: zsibbadás', 'Teendő: pihentetés']),
      lista(['Tünet: fájdalom', 'Teendő: hűtés']),
    ])
  const sima = () => richText([bekezdes('Sima cikk.')])

  function csonk(dokumentumok: {
    posts: Array<{
      id: number
      title: string
      _status: string
      content: unknown
      legutobbi?: string
    }>
    pages: Array<{
      id: number
      title: string
      _status: string
      content: unknown
      legutobbi?: string
    }>
  }) {
    const update = vi.fn<
      (hivas: {
        collection: string
        id: number
        draft: boolean
        data: { _status: string; content: unknown }
      }) => Promise<object>
    >(async () => ({}))
    const payload = {
      find: vi.fn(async ({ collection }: { collection: 'posts' | 'pages' }) => ({
        docs: dokumentumok[collection],
      })),
      findByID: vi.fn(async ({ collection, id }: { collection: 'posts' | 'pages'; id: number }) => {
        const doc = dokumentumok[collection].find((d) => d.id === id)
        return { _status: doc?.legutobbi ?? doc?._status, updatedAt: null }
      }),
      update,
    } as unknown as TablaSorokPayload
    return { payload, update }
  }

  it('próbafutásban számol, de nem ír', async () => {
    const { payload, update } = csonk({
      posts: [{ id: 7, title: 'Ínhüvelygyulladás', _status: 'published', content: tablas() }],
      pages: [{ id: 3, title: 'Hub', _status: 'published', content: sima() }],
    })
    const eredmeny = await javitsdTudastarTablaSorokat(payload, true)
    expect(eredmeny).toEqual({ modositasok: 1, kihagyasok: 0, hiba: false, irt: [] })
    expect(update).not.toHaveBeenCalled()
  })

  it('éles futásban a közzétett, piszkozat nélküli dokumentumba ír, a szétválasztott tartalommal és közzétett állapottal', async () => {
    const { payload, update } = csonk({
      posts: [{ id: 7, title: 'Ínhüvelygyulladás', _status: 'published', content: tablas() }],
      pages: [{ id: 3, title: 'Hub', _status: 'published', content: tablas() }],
    })
    const eredmeny = await javitsdTudastarTablaSorokat(payload, false)
    expect(eredmeny).toMatchObject({ modositasok: 2, hiba: false, irt: ['posts #7', 'pages #3'] })
    expect(update).toHaveBeenCalledTimes(2)
    const hivas = update.mock.calls[0][0]
    expect(hivas).toMatchObject({ collection: 'posts', id: 7, draft: false })
    expect(hivas.data._status).toBe('published')
    expect(kanonikus(gyokerGyerekek(hivas.data.content))).toEqual(
      kanonikus(gyokerGyerekek(tablaSorokSzetvalasztasa(tablas()).content)),
    )
  })

  it('közzé nem tett piszkozat mellett nem ír, hangosan hibával zár', async () => {
    const { payload, update } = csonk({
      posts: [
        {
          id: 7,
          title: 'Ínhüvelygyulladás',
          _status: 'published',
          content: tablas(),
          legutobbi: 'draft',
        },
      ],
      pages: [],
    })
    const eredmeny = await javitsdTudastarTablaSorokat(payload, false)
    expect(eredmeny).toEqual({ modositasok: 0, kihagyasok: 0, hiba: true, irt: [] })
    expect(update).not.toHaveBeenCalled()
  })

  it('nem táblázat-alakú szomszédos listát hangos kihagyásként jelent, írás nélkül', async () => {
    const { payload, update } = csonk({
      posts: [
        {
          id: 9,
          title: 'Kézzel írt',
          _status: 'published',
          content: richText([lista(['egy']), lista(['kettő'])]),
        },
      ],
      pages: [],
    })
    const eredmeny = await javitsdTudastarTablaSorokat(payload, false)
    expect(eredmeny).toEqual({ modositasok: 0, kihagyasok: 1, hiba: false, irt: [] })
    expect(update).not.toHaveBeenCalled()
  })
})
