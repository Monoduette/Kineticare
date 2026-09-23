import type { Page } from '../payload-types'
import { isHubSlug, isTudastarHref } from './tudastar-kapcsolo'

/**
 * Tudástár-linkek eltávolítása a CMS-tartalomból, KIKAPCSOLT Tudástárnál.
 *
 * TISZTA modul: a bemenetet nem módosítja, új objektumokat ad vissza; az
 * érintetlen ágak referenciája változatlan marad. A route-ok (`/`, `/[slug]`)
 * és az llms-kimenet hívja, a renderelő (RenderBlocks, RichText) így
 * változtatás nélkül már a tisztított tartalmat kapja.
 *
 * MIT TÁVOLÍT EL (a döntés a `tudastar-kapcsolo.ts` `isTudastarHref`-je: a
 * /blog, a /blog/… és a 8 tünet-hub, relatív és saját abszolút alakban is):
 *
 * 1. A szekciósor link-mezői (`linkFields`/`linkGroup`, src/blocks/link-fields.ts):
 *    - TISZTA link-tömb eleme (csak `felirat`, `url`, `ujAblakban`, `id`
 *      kulcsa van, pl. a Nyitó videó gombjai): az elem kikerül a tömbből;
 *    - csoport vagy tartalmi sor (CTA-sáv gombja, hitel-csík linkje,
 *      szakember-kártya linkje, szolgáltatás-sor, logó): a CÉL ürül (`url`
 *      és `felirat` null, `ujAblakban` hamis). A felirat is ürül, különben a
 *      megjelenítő tartalék-célja (pl. a kezdőlapi sín kanonikus ajtaja) a
 *      Tudástárra szóló felirattal jelenne meg. A blokk-komponensek felirat
 *      VAGY cél hiányában nem adnak linket (üres href és felirat nélküli gomb
 *      így nem keletkezik; a render-teszt ezt méri).
 * 2. A Lexical rich text `link` és `autolink` csomópontjai, ha a céljuk
 *    Tudástár: a külső/egyedi `url`, a belső `posts`-hivatkozás (minden cikk
 *    a Tudástár része) és a hub-oldalra mutató belső `pages`-hivatkozás. A
 *    link KIBOMLIK: a szövege a helyén marad, csak a hivatkozás tűnik el.
 *
 * A blokkokat NEM veszi ki a sorból (a szomszédság-függő megjelenítés, pl. a
 * filmsáv utáni első bemutatkozás, így nem mozdul); a Tudástár-ajánló
 * (`knowledge`) blokk attól tűnik el, hogy a route üres posztlistát ad át.
 */

type LayoutBlock = NonNullable<Page['layout']>[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A csak link-mezőkből álló tömbelem kulcsai. */
const TISZTA_LINK_KULCSOK = new Set(['id', 'felirat', 'url', 'ujAblakban'])

/** Link-mezős rekord-e (a `linkFields` `url` mezője string). */
function isLinkRekord(value: Record<string, unknown>): boolean {
  return typeof value.url === 'string'
}

function isTisztaLinkElem(value: Record<string, unknown>): boolean {
  return isLinkRekord(value) && Object.keys(value).every((key) => TISZTA_LINK_KULCSOK.has(key))
}

function isTudastarLinkRekord(value: Record<string, unknown>): boolean {
  return isLinkRekord(value) && isTudastarHref(value.url)
}

// ---------------------------------------------------------------------------
// Lexical
// ---------------------------------------------------------------------------

function isLexicalGyoker(value: Record<string, unknown>): boolean {
  return isRecord(value.root) && Array.isArray(value.root.children)
}

/** A link-csomópont célja Tudástár-e (egyedi url, belső cikk vagy belső hub-oldal). */
function isTudastarLexicalLink(node: Record<string, unknown>): boolean {
  if (node.type !== 'link' && node.type !== 'autolink') return false
  const fields = isRecord(node.fields) ? node.fields : null
  if (fields === null) return false
  if (isTudastarHref(fields.url)) return true
  if (fields.linkType !== 'internal' || !isRecord(fields.doc)) return false
  const { relationTo, value } = fields.doc
  if (relationTo === 'posts') return true
  return relationTo === 'pages' && isRecord(value) && isHubSlug(value.slug)
}

/** Egy csomópontlista tisztítása; a Tudástár-link helyére a gyermekei kerülnek. */
function lexicalGyermekek(children: readonly unknown[]): { lista: unknown[]; valtozott: boolean } {
  const lista: unknown[] = []
  let valtozott = false
  for (const child of children) {
    if (!isRecord(child)) {
      lista.push(child)
      continue
    }
    const tisztitott = lexicalCsomopont(child)
    if (tisztitott !== child) valtozott = true
    if (isTudastarLexicalLink(tisztitott)) {
      valtozott = true
      lista.push(...(Array.isArray(tisztitott.children) ? tisztitott.children : []))
      continue
    }
    lista.push(tisztitott)
  }
  return { lista, valtozott }
}

function lexicalCsomopont(node: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(node.children)) return node
  const { lista, valtozott } = lexicalGyermekek(node.children)
  return valtozott ? { ...node, children: lista } : node
}

/**
 * Egy Lexical rich-text érték Tudástár-linkek nélkül. Nem Lexical értéknél
 * (null, szöveg, ismeretlen alak) a bemenet változatlanul jön vissza.
 */
export function lexicalTudastarLinkekNelkul<T>(content: T): T {
  if (!isRecord(content) || !isLexicalGyoker(content)) return content
  const root = content.root as Record<string, unknown>
  const tisztitott = lexicalCsomopont(root)
  if (tisztitott === root) return content
  return { ...content, root: tisztitott } as T
}

// ---------------------------------------------------------------------------
// Szekciósor (layout)
// ---------------------------------------------------------------------------

function ertekTisztitas(value: unknown): unknown {
  if (Array.isArray(value)) return tombTisztitas(value)
  if (!isRecord(value)) return value
  if (isLexicalGyoker(value)) return lexicalTudastarLinkekNelkul(value)
  return rekordTisztitas(value)
}

function tombTisztitas(items: readonly unknown[]): unknown[] {
  let valtozott = false
  const lista: unknown[] = []
  for (const item of items) {
    if (isRecord(item) && isTisztaLinkElem(item) && isTudastarLinkRekord(item)) {
      valtozott = true
      continue
    }
    const tisztitott = ertekTisztitas(item)
    if (tisztitott !== item) valtozott = true
    lista.push(tisztitott)
  }
  return valtozott ? lista : (items as unknown[])
}

function rekordTisztitas(record: Record<string, unknown>): Record<string, unknown> {
  let kimenet: Record<string, unknown> = record
  if (isTudastarLinkRekord(record)) {
    kimenet = {
      ...record,
      url: null,
      ...('felirat' in record ? { felirat: null } : {}),
      ...('ujAblakban' in record ? { ujAblakban: false } : {}),
    }
  }
  for (const [key, value] of Object.entries(kimenet)) {
    if (key === 'url' || key === 'felirat') continue
    const tisztitott = ertekTisztitas(value)
    if (tisztitott !== value) {
      if (kimenet === record) kimenet = { ...record }
      kimenet[key] = tisztitott
    }
  }
  return kimenet
}

/**
 * A szekciósor Tudástár-linkek nélkül (a szabályok a fejkommentben). A
 * blokkok száma és sorrendje változatlan.
 */
export function layoutTudastarLinkekNelkul(layout: readonly LayoutBlock[]): LayoutBlock[] {
  return layout.map((block) =>
    rekordTisztitas(block as unknown as Record<string, unknown>),
  ) as unknown as LayoutBlock[]
}
