import { formatPriceHuf } from './format-price'

/**
 * Kézzel írt ár keresése szabad szövegben (tiszta, kliens- és szerveroldalon
 * is futtatható). Az akciós állapotpanel (CoursePromoStatus, K42) és a
 * kurzus-ellenőrzőlista témakurzus-tétele (course-editorial-checklist.ts)
 * ugyanezt a mintát használja.
 */

/**
 * Forintösszeg a szabad szövegben: „79 500 Ft”, „79.500 Ft”, „79500 Ft”,
 * „79 500,- Ft”, „79 500 forint”, „19 900 Ft-ért”. A tagoló lehet sima,
 * nem törhető vagy keskeny szóköz, illetve pont.
 */
const PRICE_IN_TEXT = /(\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d+)\s?(?:,-\s?)?(?:Ft\b|HUF\b|forint)/giu

/** A Lexical rich text JSON-jának szövege (bekezdésenként új sorral). */
export function lexicalPlainText(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return typeof value === 'string' ? value : ''
  }
  const node = value as { text?: unknown; children?: unknown; root?: unknown; type?: unknown }
  if (node.root !== undefined) return lexicalPlainText(node.root)
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.children)) return ''
  const separator = node.type === 'root' || node.type === 'list' ? '\n' : ''
  return node.children.map(lexicalPlainText).join(separator)
}

/** A szövegben kézzel írt árak, formázva és ismétlés nélkül. */
export function pricesInText(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(PRICE_IN_TEXT)) {
    const amount = Number(match[1].replace(/\D/g, ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) continue
    const label = formatPriceHuf(amount)
    if (!found.includes(label)) found.push(label)
  }
  return found
}
