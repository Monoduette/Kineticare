import { slugify } from '../../lib/slugify'

/**
 * Cikk-vázlat (címsor-horgony, sima szöveg, szó-szám) a Lexical-dokumentumból.
 * `headingIds` kapcsolójával. Az A-csomag ebben a körben NEM az én fájlom
 */

/** A cikk törzsének egy címsora, kiosztott horgonnyal. */
export interface HeadingEntry {
  /** A DOM-ban ténylegesen megjelenő szint (a tartalmi h1 itt is h2). */
  tag: 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  text: string
  id: string
}

/**
 * A lap SAJÁT (nem tartalmi) horgonyai. Tartalmi címsor ezeket nem kaphatja
 * meg, mert az elvenné a skip-link célját, illetve a jegyzék és a GYIK
 * szekció hivatkozását.
 */
export const RESERVED_ANCHOR_IDS: readonly string[] = [
  /** A skip-link célja a layout.tsx-ben. */
  'tartalom',
  /** A tartalomjegyzék saját címsora (aria-labelledby). */
  'tudastar-toc-cim',
  /** A GYIK-szekció címsora (a jegyzék utolsó tétele mutat rá). */
  'gyakori-kerdesek',
]

const HEADING_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const
type HeadingTag = (typeof HEADING_TAGS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function childrenOf(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.children) ? node.children : []
}

/** A gyökér gyermekei; nem Lexical-dokumentumra üres lista. */
function rootChildren(content: unknown): unknown[] {
  if (!isRecord(content) || !isRecord(content.root)) {
    return []
  }
  return childrenOf(content.root)
}

/**
 * A szerializáló h1 → h2 lágyítását tükrözi (serialize.tsx `renderHeading`):
 * oldalanként egy h1 él, a dokumentum-cím. Ismeretlen tag esetén h2.
 */
function normalizeTag(value: unknown): HeadingTag {
  if (typeof value !== 'string') return 'h2'
  return (HEADING_TAGS as readonly string[]).includes(value) ? (value as HeadingTag) : 'h2'
}

/** Egy csomópont alatti sima szöveg (kizárólag a text-csomópontokból). */
function textOf(node: unknown): string {
  if (!isRecord(node)) return ''
  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : ''
  }
  return childrenOf(node)
    .map((child) => textOf(child))
    .filter((part) => part.length > 0)
    .join('')
}

/** Címsor-csomópontok dokumentum-sorrendben, teljes mélységben. */
function collectHeadingNodes(nodes: readonly unknown[], into: Record<string, unknown>[]): void {
  for (const node of nodes) {
    if (!isRecord(node)) continue
    if (node.type === 'heading') {
      into.push(node)
      continue
    }
    collectHeadingNodes(childrenOf(node), into)
  }
}

/**
 * A cikk címsorai dokumentum-sorrendben, ütközésmentes horgonnyal.
 *
 * A kimenet sorrendje AZONOS a szerializáló bejárásáéval, ezért a `PostBody`
 * sorszám szerint tudja a horgonyokat a renderelt címsor-elemekre kiosztani.
 */
export function headingsOf(content: unknown): HeadingEntry[] {
  const nodes: Record<string, unknown>[] = []
  collectHeadingNodes(rootChildren(content), nodes)

  const used = new Set<string>(RESERVED_ANCHOR_IDS)
  return nodes.map((node, index) => {
    const text = textOf(node).trim()
    // Csak írásjelből/emojiból álló címsornál a slug üres — ilyenkor a sorszám
    // ad stabil, egyedi horgonyt (a link inkább legyen semmitmondó, mint halott).
    const base = slugify(text) || `szakasz-${index + 1}`
    let id = base
    let counter = 2
    while (used.has(id)) {
      id = `${base}-${counter}`
      counter += 1
    }
    used.add(id)
    return { tag: normalizeTag(node.tag), text, id }
  })
}

/**
 * A dokumentum sima szövege, KIZÁRÓLAG a text-csomópontokból, szóközzel fűzve.
 *
 * Miért nem a nyers objektum-bejárás: a `src/lib/reading-time.ts` mai
 * `countWords`-e MINDEN string-mezőt szónak számol (`type: 'paragraph'`,
 * `direction: 'ltr'`, `mode: 'normal'`), ami csomópontonként 2–3 fantomszó.
 * Ezért a cikkoldal a szöveget ADJA ÁT az `estimateReadingMinutes`-nak, nem a
 * fát: ugyanaz a képlet, csak valódi szavakon (docs/tudastar-technikai-terv.md
 * D5). Ha az A-csomag a `reading-time.ts`-t javítja, a hívás változatlanul jó.
 */
export function plainTextOf(content: unknown): string {
  const parts: string[] = []
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      if (!isRecord(node)) continue
      if (node.type === 'text') {
        if (typeof node.text === 'string' && node.text.length > 0) {
          parts.push(node.text)
        }
        continue
      }
      walk(childrenOf(node))
    }
  }
  walk(rootChildren(content))
  return parts.join(' ')
}

/** Szó-szám a `plainTextOf` kimenetéből (a tartalomjegyzék-küszöbhöz). */
export function wordCountOf(content: unknown): number {
  return plainTextOf(content)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}
