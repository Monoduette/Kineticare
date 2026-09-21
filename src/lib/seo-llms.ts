import type { Page, Post, Product } from '../payload-types'
import { isLegacyNoindexPage } from './legacy-noindex'
import { courseHref } from './course-url'
import { courseTitle } from './courses'
import { rewriteVisitorDashLeftover } from './gondolatjel-leftover'
import { absoluteUrl, CONTACT_EMAIL, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from './seo'
import { cikkUtvonal } from './tudastar/hub-oldalak'

/**
 * `/llms.txt` és `/llms-full.txt` — a nyilvános tartalom gépi olvasásra
 * szánt, markdown alakja.
 *
 * FORMÁTUM: az llmstxt.org javaslata szerint (https://llmstxt.org/) a fájl
 * egy H1-gyel (a webhely neve) kezdődik, utána egy blockquote-os rövid
 * leírás, szabad bekezdések, majd H2-es szekciók, amelyek `- [név](url):
 * leírás` alakú linklistát tartalmaznak; az `## Optional` szekció linkjei
 * kihagyhatók, ha a kontextus szűk. Az `llms-full.txt` ugyanezen oldalak
 * TELJES szövegét adja egyetlen markdown fájlban.
 *
 * HELYE A STRATÉGIÁBAN: a `docs/seo-geo-llm.md` kimondja, hogy az llms.txt
 * NEM elsődleges eszköz (nem hivatalos szabvány, idézési hatása nem
 * bizonyított); a séma, a GYIK és a jól tagolt tartalom viszi a
 * láthatóságot. Ez a fájl olcsó kiegészítés: egyetlen kérésből adja az
 * AI-ágensnek az oldal térképét és szövegét, HTML-zaj nélkül. Tartalma
 * kizárólag a publikált CMS-rekordokból épül — ugyanaz a szöveg, ami a
 * lapokon látszik (a strukturált adat és a látható tartalom egyezésének
 * elve itt is áll).
 */

/** A markdown-ban kiírt szöveg: töltelék gondolatjel nélkül, egy sorban. */
function clean(text: string): string {
  return rewriteVisitorDashLeftover(text).replace(/\s+/g, ' ').trim()
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

// ---------------------------------------------------------------------------
// Lexical → markdown
// ---------------------------------------------------------------------------

interface LexicalLike {
  type?: unknown
  text?: unknown
  format?: unknown
  tag?: unknown
  listType?: unknown
  fields?: unknown
  children?: unknown
  [key: string]: unknown
}

function childrenOf(node: LexicalLike): LexicalLike[] {
  return Array.isArray(node.children) ? (node.children as LexicalLike[]) : []
}

function inlineText(node: LexicalLike): string {
  if (node.type === 'text') {
    const text = typeof node.text === 'string' ? node.text : ''
    const format = typeof node.format === 'number' ? node.format : 0
    // A félkövér (bit 1) megőrzése: a kiemelés a szöveg értelmének része.
    return (format & 1) === 1 && text.trim().length > 0 ? `**${text}**` : text
  }
  if (node.type === 'linebreak') {
    return '\n'
  }
  if (node.type === 'link' || node.type === 'autolink') {
    const fields =
      typeof node.fields === 'object' && node.fields !== null
        ? (node.fields as Record<string, unknown>)
        : {}
    const url = trimmed(fields.url)
    const label = childrenOf(node).map(inlineText).join('')
    return url ? `[${label}](${absoluteUrl(url)})` : label
  }
  return childrenOf(node).map(inlineText).join('')
}

function listItems(node: LexicalLike, ordered: boolean, depth: number): string[] {
  const lines: string[] = []
  childrenOf(node).forEach((item, index) => {
    const nested = childrenOf(item).filter((child) => child.type === 'list')
    const own = childrenOf(item).filter((child) => child.type !== 'list')
    const text = own.map(inlineText).join('').trim()
    const indent = '  '.repeat(depth)
    if (text.length > 0) {
      lines.push(`${indent}${ordered ? `${index + 1}.` : '-'} ${text}`)
    }
    for (const sub of nested) {
      lines.push(...listItems(sub, sub.listType === 'number', depth + 1))
    }
  })
  return lines
}

function blockToMarkdown(node: LexicalLike): string | undefined {
  switch (node.type) {
    case 'heading': {
      const level = /^h([1-6])$/.exec(String(node.tag ?? 'h2'))?.[1] ?? '2'
      const text = inlineText(node).trim()
      return text.length > 0 ? `${'#'.repeat(Number(level))} ${text}` : undefined
    }
    case 'paragraph': {
      const text = inlineText(node).trim()
      return text.length > 0 ? text : undefined
    }
    case 'quote': {
      const text = inlineText(node).trim()
      return text.length > 0 ? `> ${text}` : undefined
    }
    case 'list': {
      const lines = listItems(node, node.listType === 'number', 0)
      return lines.length > 0 ? lines.join('\n') : undefined
    }
    case 'horizontalrule':
      return '---'
    case 'upload':
    case 'block':
    case 'relationship':
      return undefined
    default: {
      const text = inlineText(node).trim()
      return text.length > 0 ? text : undefined
    }
  }
}

/**
 * Egy Lexical rich-text dokumentum markdownja. Ismeretlen csomópontból a
 * szöveg megy tovább, a média/beágyazás kimarad (nem szöveg).
 */
export function lexicalToMarkdown(content: unknown): string {
  if (typeof content !== 'object' || content === null) return ''
  const root = (content as { root?: unknown }).root
  if (typeof root !== 'object' || root === null) return ''
  return childrenOf(root as LexicalLike)
    .map(blockToMarkdown)
    .filter((line): line is string => line !== undefined)
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Szekciósor (layout) → markdown
// ---------------------------------------------------------------------------

type LayoutBlock = NonNullable<Page['layout']>[number]

/** Szöveges kulcsok, ebben a sorrendben, ha egy blokkban/tételben megvannak. */
const TEXT_KEYS = [
  'eyebrow',
  'title',
  'cim',
  'heading',
  'lead',
  'text',
  'osszefoglalo',
  'body',
  'question',
  'answer',
  'bio',
  'role',
  'magyarazat',
  'extra',
  'note',
  'label',
] as const

const SKIP_KEYS = new Set([
  'id',
  'blockName',
  'blockType',
  'sectionSettings',
  'url',
  'ujAblakban',
  'felirat',
  'anchorId',
  'visible',
  'hatter',
  'image',
  'photo',
  'kep',
  'sikerCim',
  'sikerSzoveg',
  'gombFelirat',
  'urlapCim',
  'callLabel',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Egy tétel (kártya, sor, kérdés) sorai: címe H4-ként, szövegei bekezdésként. */
function itemLines(item: Record<string, unknown>): string[] {
  const lines: string[] = []
  const title =
    trimmed(item.title) ?? trimmed(item.cim) ?? trimmed(item.question) ?? trimmed(item.name)
  if (title) lines.push(`#### ${clean(title)}`)
  for (const key of TEXT_KEYS) {
    if (key === 'title' || key === 'cim' || key === 'question') continue
    const value = trimmed(item[key])
    if (value) lines.push(clean(value))
  }
  if (typeof item.items === 'string') {
    const rows = item.items
      .split('\n')
      .map((row) => row.trim())
      .filter((row) => row.length > 0)
    if (rows.length > 0) lines.push(rows.map((row) => `- ${clean(row)}`).join('\n'))
  }
  if (isRecord(item.content) || (typeof item.content === 'object' && item.content !== null)) {
    const md = lexicalToMarkdown(item.content)
    if (md.length > 0) lines.push(md)
  }
  return lines
}

/**
 * Egy szekció-blokk markdownja: cím H2-ként, bevezető, majd a tételek. A
 * rejtett (`sectionSettings.visible === false`) blokk kimarad, ahogy a lapról
 * is hiányzik.
 */
export function layoutBlockToMarkdown(block: LayoutBlock): string {
  const record = block as unknown as Record<string, unknown>
  const settings = isRecord(record.sectionSettings) ? record.sectionSettings : {}
  if (settings.visible === false) return ''
  const lines: string[] = []
  const title = trimmed(record.title) ?? trimmed(record.heading)
  if (title) lines.push(`## ${clean(title)}`)
  for (const key of ['lead', 'text', 'magyarazat'] as const) {
    const value = trimmed(record[key])
    if (value) lines.push(clean(value))
  }
  if (record.content !== undefined) {
    const md = lexicalToMarkdown(record.content)
    if (md.length > 0) lines.push(md)
  }
  for (const [key, value] of Object.entries(record)) {
    if (SKIP_KEYS.has(key) || !Array.isArray(value)) continue
    for (const entry of value) {
      if (isRecord(entry)) {
        lines.push(...itemLines(entry))
      } else if (typeof entry === 'string' && entry.trim().length > 0) {
        lines.push(`- ${clean(entry)}`)
      }
    }
  }
  return lines.join('\n\n')
}

// ---------------------------------------------------------------------------
// A két fájl
// ---------------------------------------------------------------------------

/** Az llms.txt egy sora: `- [név](url): leírás`. */
function linkLine(name: string, path: string, description?: string | null): string {
  const desc = trimmed(description)
  return `- [${clean(name)}](${absoluteUrl(path)})${desc ? `: ${clean(desc)}` : ''}`
}

export type LlmsPage = Pick<Page, 'title' | 'slug' | 'excerpt' | 'updatedAt'> & {
  layout?: Page['layout']
  content?: Page['content'] | null
  seoDescription?: string | null
}
export type LlmsPost = Pick<Post, 'title' | 'slug' | 'excerpt' | 'publishedAt' | 'updatedAt'> & {
  content?: Post['content'] | null
  seoDescription?: string | null
}
export type LlmsProduct = Pick<
  Product,
  'id' | 'sku' | 'displayTitle' | 'slug' | 'shortDescription' | 'updatedAt'
> & {
  longDescription?: Product['longDescription'] | null
  seoDescription?: string | null
}

export interface LlmsSource {
  pages: ReadonlyArray<LlmsPage>
  posts: ReadonlyArray<LlmsPost>
  products: ReadonlyArray<LlmsProduct>
  /** Poszt-slug → kanonikus útvonal (publikált gyökér-hub). */
  hubUtvonalak?: Readonly<Record<string, string>>
}

/** A kezdőlap CMS-slugja: a `/` címen él, nem `/kezdolap`-on. */
const HOME_SLUG = 'kezdolap'
/** Dedikált route-tal bíró slugok: a CMS-oldal a route címén jelenik meg. */
const ROUTE_SLUGS: Readonly<Record<string, string>> = { kapcsolat: '/kapcsolat', [HOME_SLUG]: '/' }
const LEGAL_SLUGS = new Set(['aszf', 'adatvedelem', 'impresszum'])

/** A publikált gyökér-hubok slugjai a poszt→hub térképből. */
function hubSlugSet(hubUtvonalak: Readonly<Record<string, string>> | undefined): Set<string> {
  return new Set(Object.values(hubUtvonalak ?? {}).map((path) => path.replace(/^\//, '')))
}

function pagePath(page: LlmsPage): string {
  return ROUTE_SLUGS[page.slug] ?? `/${page.slug}`
}

/**
 * Slug nélküli (piszkozat, elrontott) rekord kimarad. Rejtett slug-lista
 * nincs (WP60): az egykori demólap (`akcios-kurzus`) kivezetése nem kódból,
 * hanem a CMS-ből történik (közzététel visszavonása, `demo-oldal-visszavonas`
 * szabály a src/scripts/apply-owner-content.ts-ben), és ami nincs közzétéve,
 * az ide sem kerül be.
 */
function isPublicPage(page: LlmsPage): boolean {
  return typeof page.slug === 'string' && page.slug.length > 0 && !isLegacyNoindexPage(page)
}

/**
 * `/llms.txt` — a webhely térképe az llmstxt.org alakjában.
 */
export function buildLlmsTxt(source: LlmsSource): string {
  const pages = source.pages.filter(isPublicPage)
  // A publikált tünet-hubok (pages) a Tudástár szekcióban állnak, a cikkük
  // kanonikus címén — itt nem ismételjük őket, egy URL egyszer szerepel.
  const hubSlugs = hubSlugSet(source.hubUtvonalak)
  const contentPages = pages.filter(
    (page) =>
      page.slug !== HOME_SLUG &&
      !LEGAL_SLUGS.has(page.slug) &&
      page.slug !== 'kapcsolat' &&
      !hubSlugs.has(page.slug),
  )

  const legalPages = pages.filter((page) => LEGAL_SLUGS.has(page.slug))
  const contact = pages.find((page) => page.slug === 'kapcsolat')
  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}. Két budapesti gyógytornász, Kocsis Kata és Kiss Kata kézrehabilitációs praxisa: rendelői kezelés, otthoni online videóprogram és akkreditált szakmai képzés. A cikkek és a kurzusok magyar nyelvűek. Kapcsolat: ${CONTACT_EMAIL}.`,
    '',
    'Fontos: a tartalom tájékoztató jellegű, nem helyettesíti az orvosi vizsgálatot; a gyakorlatokat a kezelőorvos jóváhagyásával érdemes végezni.',
    '',
    '## Szolgáltatások és oldalak',
    '',
    linkLine('Kezdőlap', '/', SITE_TAGLINE),
    ...contentPages.map((page) =>
      linkLine(page.title, pagePath(page), page.seoDescription ?? page.excerpt),
    ),
    linkLine(
      'Kapcsolat',
      '/kapcsolat',
      contact?.seoDescription ??
        contact?.excerpt ??
        `Időpontkérés és elérhetőségek, e-mail: ${CONTACT_EMAIL}`,
    ),
    '',
    '## Kurzusok',
    '',
  ]
  if (source.products.length === 0) {
    lines.push(linkLine('Kurzusok', '/kurzusok', 'Az online kurzusok listája.'))
  } else {
    lines.push(linkLine('Kurzusok listája', '/kurzusok', 'Minden online kurzus egy helyen.'))
    for (const product of source.products) {
      lines.push(
        linkLine(
          courseTitle(product),
          courseHref(product),
          product.seoDescription ?? product.shortDescription,
        ),
      )
    }
  }
  lines.push(
    '',
    '## Tudástár',
    '',
    linkLine('Tudástár', '/blog', 'Kézrehabilitációs cikkek gyógytornászoktól.'),
  )
  for (const post of source.posts) {
    if (typeof post.slug !== 'string' || post.slug.length === 0) continue
    lines.push(
      linkLine(
        post.title,
        cikkUtvonal(post.slug, source.hubUtvonalak),
        post.seoDescription ?? post.excerpt,
      ),
    )
  }
  lines.push(
    '',
    '## Gépi olvasás',
    '',
    linkLine(
      'Teljes szöveg',
      '/llms-full.txt',
      'A nyilvános lapok teljes szövege egy markdown fájlban.',
    ),
    linkLine('Sitemap', '/sitemap.xml', 'XML oldaltérkép.'),
  )
  if (legalPages.length > 0) {
    lines.push('', '## Optional', '')
    for (const page of legalPages) {
      lines.push(linkLine(page.title, pagePath(page), page.excerpt))
    }
  }
  return `${lines.join('\n')}\n`
}

function dateLine(label: string, value: unknown): string | undefined {
  const text = trimmed(value)
  return text ? `${label}: ${text.slice(0, 10)}` : undefined
}

function pageMarkdown(page: LlmsPage): string {
  const parts: string[] = [`# ${clean(page.title)}`, `URL: ${absoluteUrl(pagePath(page))}`]
  const modified = dateLine('Frissítve', page.updatedAt)
  if (modified) parts.push(modified)
  const excerpt = trimmed(page.excerpt)
  if (excerpt) parts.push(clean(excerpt))
  for (const block of page.layout ?? []) {
    const md = layoutBlockToMarkdown(block)
    if (md.length > 0) parts.push(md)
  }
  const content = lexicalToMarkdown(page.content)
  if ((page.layout ?? []).length === 0 && content.length > 0) parts.push(content)
  return parts.join('\n\n')
}

function postMarkdown(post: LlmsPost, hubUtvonalak?: Readonly<Record<string, string>>): string {
  const parts: string[] = [
    `# ${clean(post.title)}`,
    `URL: ${absoluteUrl(cikkUtvonal(post.slug, hubUtvonalak))}`,
  ]
  const published = dateLine('Közzétéve', post.publishedAt)
  const modified = dateLine('Frissítve', post.updatedAt)
  if (published) parts.push(published)
  if (modified) parts.push(modified)
  const excerpt = trimmed(post.excerpt)
  if (excerpt) parts.push(clean(excerpt))
  const content = lexicalToMarkdown(post.content)
  if (content.length > 0) parts.push(content)
  return parts.join('\n\n')
}

function productMarkdown(product: LlmsProduct): string {
  const parts: string[] = [
    `# ${clean(courseTitle(product))}`,
    `URL: ${absoluteUrl(courseHref(product))}`,
  ]
  const short = trimmed(product.shortDescription)
  if (short) parts.push(clean(short))
  const long = lexicalToMarkdown(product.longDescription)
  if (long.length > 0) parts.push(long)
  return parts.join('\n\n')
}

/**
 * `/llms-full.txt` — a nyilvános lapok teljes szövege. A hub-lapok (a
 * `pages`-ben élő tünet-gyökerek) a cikkük szövegét viszik, ahogy a lapon
 * is a cikk látszik; a cikk így egyszer szerepel, a kanonikus címén.
 */
export function buildLlmsFullTxt(source: LlmsSource): string {
  const sections: string[] = [
    `# ${SITE_NAME}`,
    `> ${SITE_DESCRIPTION}`,
    `Forrás: ${absoluteUrl('/llms.txt')}`,
  ]
  const hubSlugs = hubSlugSet(source.hubUtvonalak)
  for (const page of source.pages.filter(isPublicPage)) {
    if (hubSlugs.has(page.slug)) continue
    sections.push(pageMarkdown(page))
  }
  for (const product of source.products) {
    sections.push(productMarkdown(product))
  }
  for (const post of source.posts) {
    if (typeof post.slug !== 'string' || post.slug.length === 0) continue
    sections.push(postMarkdown(post, source.hubUtvonalak))
  }
  return `${sections.join('\n\n---\n\n')}\n`
}
