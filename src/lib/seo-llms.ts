import type { Page, Post, Product } from '../payload-types'
import { feloldottKapcsolatiEmail, KAPCSOLAT_OLDAL_WEBCIM } from './contact-email'
import { isLegacyNoindexPage } from './legacy-noindex'
import { isDiscoverableCourse } from './course-discovery'
import { courseHref } from './course-url'
import { courseTitle } from './courses'
import { resolveFilmCaptions } from './film-captions'
import { freeSosStripTitle } from './free-sos-title'
import { rewriteVisitorDashLeftover } from './gondolatjel-leftover'
import { sanitizeCmsUrl } from './safe-url'
import { presentHomeLayout } from './home-help-states'
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from './seo'
import { isAvailableSosProduct } from './sos-offer'
import { isHubSlug } from './tudastar-kapcsolo'
import { layoutTudastarLinkekNelkul, lexicalTudastarLinkekNelkul } from './tudastar-link-szuro'
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
 *
 * EGY MEZŐ, EGY FELOLDÓ (modul-térkép H46, terv 2. szakasz): ahol a lap mást
 * mutat, mint a nyers CMS-mező, ott ez a fájl UGYANAZT a tiszta feloldót
 * hívja, mint a komponens. Az SOS-sáv címe a `freeSosStripTitle`
 * (src/lib/free-sos-title.ts, a FreeSos.tsx-szel közös), a nyitó videó két
 * beúszó felirata a `resolveFilmCaptions` (src/lib/film-captions.ts, a
 * FilmHero.tsx-szel közös), a kezdőlap szekciósora a `presentHomeLayout`
 * (src/lib/home-help-states.ts, a HomeView-val közös). Így a gépi olvasó nem
 * kap más nevet ugyanarra a szekcióra, mint a látogató (WCAG 2.2 SC 3.2.4;
 * NN/g, Consistency and Standards: „Users should not have to wonder whether
 * different words, situations, or actions mean the same thing.”
 * https://www.nngroup.com/articles/consistency-and-standards/). Az őr:
 * src/__tests__/gepi-olvasas-feloldok.test.ts.
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
 * Az „Ajánlat-kártyák” blokk egy kártyája markdownban (modul-térkép H46, az
 * A6 /szakembereknek blokkja). REKORD-alapú, típusimport nélkül: a blokk
 * típusai egy későbbi körrel érkeznek, és a szekciósor-bejárás addig is a
 * nyers CMS-rekordot kapja. A kártya sorrendje a lapéval egyezik: cím
 * (`### `), szöveg, a tények felsorolásként, végül a gomb linkként.
 *
 * A gomb a kártya lapos link-mezőiből jön (`felirat`, `url`; a blokk a
 * közös `linkFields`-et teríti ki a kártyán, src/blocks/link-fields.ts).
 * Link csak akkor kerül ki, ha a felirat és a biztonságos cél
 * (src/lib/safe-url.ts `sanitizeCmsUrl`) is megvan; a relatív cél abszolút
 * lesz, ahogy a rich text linkjeinél.
 */
function ajanlatKartyaSorai(kartya: Record<string, unknown>): string[] {
  const lines: string[] = []
  const cim = trimmed(kartya.cim)
  if (cim) lines.push(`### ${clean(cim)}`)
  const szoveg = trimmed(kartya.szoveg)
  if (szoveg) lines.push(clean(szoveg))
  const tenyek = (Array.isArray(kartya.tenyek) ? kartya.tenyek : [])
    .map((teny) => (isRecord(teny) ? trimmed(teny.szoveg) : undefined))
    .filter((teny): teny is string => teny !== undefined)
  if (tenyek.length > 0) lines.push(tenyek.map((teny) => `- ${clean(teny)}`).join('\n'))
  const felirat = trimmed(kartya.felirat)
  const cel = sanitizeCmsUrl(trimmed(kartya.url))
  if (felirat && cel) {
    // Sémás cél (https:, mailto:, tel:) maradjon, a webhelyen belüli út abszolút lesz.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(cel) ? cel : absoluteUrl(cel)
    lines.push(`[${clean(felirat)}](${href})`)
  }
  return lines
}

/**
 * Amit a lap a blokkon KÍVÜLRŐL dönt el, és a szekció szövegét változtatja.
 * A RenderBlocks ugyanezt a két jelet számolja (`freeProduct`, `freeSosHref`,
 * src/components/blocks/RenderBlocks.tsx).
 */
export interface BlokkKornyezet {
  /** Van-e a lapon elérhető ingyenes SOS-kurzus (a RenderBlocks `freeProduct !== null`). */
  ingyenesSos: boolean
  /**
   * A nyitó videó vég-leírásához: elérhető SOS-kurzus mellett van-e a blokk
   * UTÁN látható SOS-sáv (a RenderBlocks `freeSosHref`-je nem null). Csak
   * ilyenkor hivatkozhat a szöveg a „lentebb” álló ingyenes gyakorlatokra.
   */
  sosSavLentebb: boolean
}

/** Termék nélküli környezet: a lap is így renderel, ha nincs elérhető SOS-kurzus. */
const SOS_NELKUL: BlokkKornyezet = { ingyenesSos: false, sosSavLentebb: false }

/**
 * Egy feloldó kimenete egy sorban. A feloldó szövege szó szerint az, amit a
 * lap mutat, ezért itt a `clean` maradék-cseréje sem fut rá; csak a sortörés
 * és a többszörös szóköz esik össze, ahogy a böngésző is összevonja.
 */
function egySorban(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A szekció H2-je: az SOS-sávnál a lap feloldója, máshol a Cím vagy a Címsor mező. */
function blokkCim(record: Record<string, unknown>, kornyezet: BlokkKornyezet): string | undefined {
  if (record.blockType === 'freeSos') {
    return egySorban(freeSosStripTitle(record, kornyezet.ingyenesSos))
  }
  const title = trimmed(record.title) ?? trimmed(record.heading)
  return title ? clean(title) : undefined
}

/**
 * Egy szekció-blokk markdownja: cím H2-ként, bevezető, majd a tételek. A
 * rejtett (`sectionSettings.visible === false`) blokk kimarad, ahogy a lapról
 * is hiányzik.
 *
 * A `kornyezet` a lap döntése arról, ami a blokkon kívül van (elérhető
 * ingyenes SOS-kurzus, SOS-sáv lentebb). Elhagyva: termék nélkül, ahogy a lap
 * is renderel, ha nincs elérhető SOS-kurzus.
 */
export function layoutBlockToMarkdown(
  block: LayoutBlock,
  kornyezet: BlokkKornyezet = SOS_NELKUL,
): string {
  const record = block as unknown as Record<string, unknown>
  const settings = isRecord(record.sectionSettings) ? record.sectionSettings : {}
  if (settings.visible === false) return ''
  const lines: string[] = []
  const title = blokkCim(record, kornyezet)
  if (title) lines.push(`## ${title}`)
  for (const key of ['lead', 'text', 'magyarazat'] as const) {
    const value = trimmed(record[key])
    if (value) lines.push(clean(value))
  }
  if (record.content !== undefined) {
    const md = lexicalToMarkdown(record.content)
    if (md.length > 0) lines.push(md)
  }
  const kartyak = Array.isArray(record.kartyak) ? record.kartyak : null
  if (kartyak !== null) {
    for (const kartya of kartyak) {
      if (isRecord(kartya)) lines.push(...ajanlatKartyaSorai(kartya))
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (SKIP_KEYS.has(key) || !Array.isArray(value)) continue
    if (key === 'kartyak' && kartyak !== null) continue
    for (const entry of value) {
      if (isRecord(entry)) {
        lines.push(...itemLines(entry))
      } else if (typeof entry === 'string' && entry.trim().length > 0) {
        lines.push(`- ${clean(entry)}`)
      }
    }
  }
  if (record.blockType === 'filmHero') {
    // A két beúszó felirat a lapon a jelenet szövege után, olvasási listában
    // áll (scroll-scrub.tsx `scroll-scrub__reading-captions`: cím és leírás,
    // két bekezdés). A szöveg a FilmHero feloldójából jön, a beépített
    // tartalékkal együtt, így üres CMS-mezőnél is az kerül ide, ami a lapon.
    const feliratok = resolveFilmCaptions(record, kornyezet.sosSavLentebb)
    for (const felirat of [feliratok.mid, feliratok.end]) {
      lines.push(egySorban(felirat.title), egySorban(felirat.body))
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
  /**
   * Van-e elérhető ingyenes SOS-kurzus (`vanElerhetoIngyenesSos`, a route a
   * lapokkal azonos terméklistából számolja). Ettől függ az SOS-sáv címe és a
   * nyitó videó vég-leírása. Elhagyva: nincs, ahogy a lap is renderel
   * termék nélkül (az SOS-sáv címe „Kurzusaink”).
   */
  ingyenesSos?: boolean
  /**
   * A Tudástár-kapcsoló állapota (`getTudastarLathato`). Elhagyva: látható.
   * Hamis értéknél a kimenetben nincs Tudástár: se szekció, se cikk, se
   * tünet-hub, és a lapok, kurzusok szövegéből a Tudástár-linkek is kibomlanak.
   */
  tudastarLathato?: boolean
}

/**
 * A forrás Tudástár nélkül (kikapcsolt kapcsolónál). A hub-oldalak is
 * kimaradnak, mert a hub Tudástár-cikk (src/lib/tudastar-kapcsolo.ts); a
 * szekciósorból a Tudástár-ajánló blokk is kiesik, mert a lapon sem látszik.
 */
function tudastarSzurtForras(source: LlmsSource): LlmsSource {
  if (source.tudastarLathato !== false) return source
  return {
    ...source,
    posts: [],
    hubUtvonalak: {},
    pages: source.pages
      .filter((page) => !isHubSlug(page.slug))
      .map((page) => ({
        ...page,
        ...(page.layout
          ? {
              layout: layoutTudastarLinkekNelkul(page.layout).filter(
                (block) => block.blockType !== 'knowledge',
              ),
            }
          : {}),
        ...(page.content ? { content: lexicalTudastarLinkekNelkul(page.content) } : {}),
      })),
    products: source.products.map((product) =>
      product.longDescription
        ? { ...product, longDescription: lexicalTudastarLinkekNelkul(product.longDescription) }
        : product,
    ),
  }
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
 * Van-e elérhető ingyenes SOS-kurzus: UGYANAZ a predikátum, amellyel a lap
 * dönt. A RenderBlocks és a HomeView:
 * `products.filter(isPubliclyVisibleProduct).find(isAvailableSosProduct)`,
 * ahol az `isPubliclyVisibleProduct` maga az `isDiscoverableCourse`
 * (src/components/content/ProductCard.tsx). A komponens-modul CSS-t és
 * next/link-et húz be, ezért a két függvényt a forrásukból importáljuk.
 */
export function vanElerhetoIngyenesSos(products: ReadonlyArray<Product>): boolean {
  return products.filter(isDiscoverableCourse).some((product) => isAvailableSosProduct(product))
}

/**
 * Azok a lapok, amelyek a szekciósort termékek nélkül renderelik: a /kapcsolat
 * route a RenderBlocks-nak üres terméklistát ad
 * (src/app/(frontend)/kapcsolat/page.tsx, `products={[]}`), ezért ott egy
 * SOS-sáv a semleges címet mutatná.
 */
const TERMEK_NELKULI_LAPOK: ReadonlySet<string> = new Set(['kapcsolat'])

/**
 * A lap szekciósora úgy, ahogy a lap megjeleníti: a kezdőlap a HomeView-val
 * közös `presentHomeLayout`-on megy át (a segítség-sín üres mezőit a
 * kódbeli szöveg pótolja). A /szolgaltatasok `presentSzolgaltatasokLayout`-ja
 * csak elrendezést, hátteret és fotót állít, szöveget nem, ezért itt nem kell.
 */
function megjelenoSzekciosor(page: LlmsPage): NonNullable<Page['layout']> {
  const layout = page.layout ?? []
  return page.slug === HOME_SLUG ? presentHomeLayout(layout) : layout
}

/** A RenderBlocks `freeSosHref`-jének feltétele: látható SOS-sáv áll-e a blokk után. */
function lathatoSosSavUtana(layout: NonNullable<Page['layout']>, index: number): boolean {
  return layout
    .slice(index + 1)
    .some((block) => block.blockType === 'freeSos' && block.sectionSettings?.visible !== false)
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
export function buildLlmsTxt(input: LlmsSource): string {
  const source = tudastarSzurtForras(input)
  const tudastarLathato = input.tudastarLathato !== false
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
  const contact = pages.find((page) => page.slug === KAPCSOLAT_OLDAL_WEBCIM)
  // A kapcsolati e-mail ugyanabból a láncból, mint a lábléc és a szervezet
  // JSON-LD-je (src/lib/contact-email.ts): a Kapcsolat-oldal első látható
  // Időpontkérőjének mezője, különben a kódtartalék.
  const kapcsolatiEmail = feloldottKapcsolatiEmail(contact?.layout)
  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}. Két budapesti gyógytornász, Kocsis Kata és Kiss Kata kézrehabilitációs praxisa: rendelői kezelés, otthoni online videóprogram és akkreditált szakmai képzés. ${tudastarLathato ? 'A cikkek és a kurzusok magyar nyelvűek.' : 'A kurzusok magyar nyelvűek.'} Kapcsolat: ${kapcsolatiEmail}.`,
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
        `Időpontkérés és elérhetőségek, e-mail: ${kapcsolatiEmail}`,
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
  if (tudastarLathato) {
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

function pageMarkdown(page: LlmsPage, ingyenesSos: boolean): string {
  const parts: string[] = [`# ${clean(page.title)}`, `URL: ${absoluteUrl(pagePath(page))}`]
  const modified = dateLine('Frissítve', page.updatedAt)
  if (modified) parts.push(modified)
  const excerpt = trimmed(page.excerpt)
  if (excerpt) parts.push(clean(excerpt))
  const layout = megjelenoSzekciosor(page)
  const sosALapon = ingyenesSos && !TERMEK_NELKULI_LAPOK.has(page.slug)
  layout.forEach((block, index) => {
    const md = layoutBlockToMarkdown(block, {
      ingyenesSos: sosALapon,
      sosSavLentebb: sosALapon && lathatoSosSavUtana(layout, index),
    })
    if (md.length > 0) parts.push(md)
  })
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
export function buildLlmsFullTxt(input: LlmsSource): string {
  const source = tudastarSzurtForras(input)
  const contact = source.pages.find((page) => page.slug === KAPCSOLAT_OLDAL_WEBCIM)
  // Az llms.txt bevezetőjével azonos kapcsolati e-mail, ugyanabból a láncból.
  const sections: string[] = [
    `# ${SITE_NAME}`,
    `> ${SITE_DESCRIPTION}`,
    `Forrás: ${absoluteUrl('/llms.txt')}`,
    `Kapcsolat: ${feloldottKapcsolatiEmail(contact?.layout)}`,
  ]
  const hubSlugs = hubSlugSet(source.hubUtvonalak)
  for (const page of source.pages.filter(isPublicPage)) {
    if (hubSlugs.has(page.slug)) continue
    sections.push(pageMarkdown(page, source.ingyenesSos === true))
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
