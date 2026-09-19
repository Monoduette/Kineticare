import type { Product } from '../../payload-types'

/**
 * A kurzus ÉRTÉKESÍTŐ TARTALMÁNAK egyetlen igazságforrása.
 */

type LexicalDoc = NonNullable<Product['longDescription']>
type LexicalNode = LexicalDoc['root']['children'][number]

/** A partícionálás címkéi — a `body` a „minden más" ág. */
type SectionPart = 'body' | 'fitFor' | 'notFitFor' | 'faq' | 'guarantee'

interface Segment {
  part: SectionPart
  /** A szakaszt nyitó címsor (a `body` szakaszoknál null). */
  heading: LexicalNode | null
  nodes: LexicalNode[]
}

export interface SalesStep {
  title: string
  text: string | null
}

export interface SalesFaqItem {
  question: string
  answer: string
}

export interface SalesGuarantee {
  title: string
  text: string
}

export interface CourseSalesContent {
  /** Pipás előny-sorok a vásárlódobozban (legfeljebb 4). */
  highlights: string[]
  /** „Hogyan működik?" lépések. */
  steps: SalesStep[]
  fitFor: string[]
  notFitFor: string[]
  guarantee: SalesGuarantee | null
  faq: SalesFaqItem[]
  /** A „A kurzusról" szakaszba maradó szöveg (a kiemelt szakaszok nélkül). */
  body: LexicalDoc | null
}

/** A vásárlódobozban legfeljebb ennyi pipás sor fér el olvashatóan. */
export const MAX_HIGHLIGHTS = 4

/** Egy pipás sor felső hossza karakterben (a doboz szűk hasáb). */
const HIGHLIGHT_MAX_LENGTH = 84

// ---------------------------------------------------------------------------
// Lexical-segédek (típusszűkítéssel, `any` nélkül)
// ---------------------------------------------------------------------------

function nodeType(node: LexicalNode): string {
  const value: unknown = node.type
  return typeof value === 'string' ? value : ''
}

function childrenOf(node: LexicalNode): LexicalNode[] {
  const value: unknown = node.children
  return Array.isArray(value) ? (value as LexicalNode[]) : []
}

/** A csomópont (és leszármazottai) sima szövege, összevont szóközökkel. */
function plainText(node: LexicalNode): string {
  const text: unknown = node.text
  if (typeof text === 'string') {
    return text
  }
  return childrenOf(node)
    .map((child) => plainText(child))
    .join('')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** A címsor szintje (h1 → 1 … h6 → 6); nem címsor esetén null. */
function headingLevel(node: LexicalNode): number | null {
  if (nodeType(node) !== 'heading') {
    return null
  }
  const tag: unknown = node.tag
  if (typeof tag === 'string') {
    const match = /^h([1-6])$/i.exec(tag.trim())
    if (match) {
      return Number(match[1])
    }
  }
  // Ismeretlen/hiányzó tag: a legvalószínűbb szakaszszint (h2) — a
  // partícionálás így sem szakad meg, csak konzervatívabban dönt.
  return 2
}

/** A felsorolás (`list`) elemeinek szövege; nem lista esetén üres tömb. */
function listItemTexts(node: LexicalNode): string[] {
  if (nodeType(node) !== 'list') {
    return []
  }
  return childrenOf(node)
    .map((item) => normalizeWhitespace(plainText(item)))
    .filter((text) => text.length > 0)
}

// ---------------------------------------------------------------------------
// Címsor-osztályozás
// ---------------------------------------------------------------------------

/**
 * Melyik kiemelt szakaszt nyitja meg ez a címsor.
 *
 * A minták a SAJÁT tartalmunkra készültek (a régi kineticare.hu értékesítő
 * oldalainak címsoraira, lásd docs/tartalom-leltar-regi-oldal.md 2.7):
 * „Ez a program tökéletes számodra, ha…", „Nem javasoljuk a programot, ha…",
 * „30 napos kipróbálási garancia", „Kérdések, amik talán felmerültek benned".
 * A tagadó ág SZÁNDÉKOSAN előbb dönt, mert a „Nem javasoljuk a programot…"
 * címsor a pozitív mintákra is illeszkedhetne.
 */
export function classifyHeading(rawText: string): SectionPart {
  const text = normalizeWhitespace(rawText).toLowerCase()
  if (text.length === 0) {
    return 'body'
  }
  if (/nem javasol|nem ajánl|nem való|ne vedd meg|kinek nem/.test(text)) {
    return 'notFitFor'
  }
  if (/garanci|visszafizet|pénzvisszafizet/.test(text)) {
    return 'guarantee'
  }
  if (/gyakori kérdés|gyik|kérdések|kérdés, ami/.test(text)) {
    return 'faq'
  }
  if (/tökéletes|neked való|kinek való|akkor való|számodra, ha|neked szól/.test(text)) {
    return 'fitFor'
  }
  return 'body'
}

/**
 * A dokumentum felbontása szakaszokra, DOKUMENTUM-SORRENDBEN.
 *
 * Egy kiemelt szakasz a nyitó címsortól addig tart, amíg NEM jön nála azonos
 * vagy magasabb szintű címsor — így a GYIK h2 alatti h3-as kérdései a GYIK
 * szakaszban maradnak, a következő h2 viszont lezárja.
 */
export function segmentDocument(content: LexicalDoc | null | undefined): Segment[] {
  const rootChildren = content?.root?.children
  if (!Array.isArray(rootChildren) || rootChildren.length === 0) {
    return []
  }

  const segments: Segment[] = []
  let body: Segment | null = null
  let active: (Segment & { level: number }) | null = null

  const pushBody = (node: LexicalNode) => {
    if (body === null) {
      body = { part: 'body', heading: null, nodes: [] }
      segments.push(body)
    }
    body.nodes.push(node)
  }
  const closeActive = () => {
    if (active !== null) {
      segments.push({ part: active.part, heading: active.heading, nodes: active.nodes })
      active = null
    }
  }

  for (const node of rootChildren) {
    const level = headingLevel(node)
    if (level === null) {
      if (active !== null) {
        active.nodes.push(node)
      } else {
        pushBody(node)
      }
      continue
    }
    // Címsor: lezárja a nála azonos vagy magasabb szintű aktív szakaszt.
    if (active !== null && level <= active.level) {
      closeActive()
    }
    if (active !== null) {
      // Mélyebb címsor a szakaszon BELÜL (pl. GYIK-kérdés) — marad.
      active.nodes.push(node)
      continue
    }
    const part = classifyHeading(plainText(node))
    if (part === 'body') {
      pushBody(node)
      continue
    }
    body = null
    active = { part, heading: node, nodes: [], level }
  }
  closeActive()
  return segments
}

// ---------------------------------------------------------------------------
// Szakasz-kinyerők
// ---------------------------------------------------------------------------

/** A szakasz összes felsorolás-eleme (a „kinek való / kinek nem" listák). */
function bulletsOf(segment: Segment): string[] {
  return segment.nodes.flatMap((node) => listItemTexts(node))
}

/** A szakasz bekezdéseinek szövege (garancia-törzs). */
function paragraphsOf(segment: Segment): string[] {
  return segment.nodes
    .filter((node) => nodeType(node) === 'paragraph' || nodeType(node) === 'quote')
    .map((node) => normalizeWhitespace(plainText(node)))
    .filter((text) => text.length > 0)
}

/**
 * GYIK-párok a szakaszból: minden címsor egy kérdés, a HOZZÁ tartozó
 * bekezdések a válasz. Címsor nélküli (vagy válasz nélküli) tétel kimarad —
 * félkész kérdés nem kerülhet ki az oldalra és a JSON-LD-be sem.
 */
function faqPairsOf(segment: Segment): SalesFaqItem[] {
  const items: SalesFaqItem[] = []
  let question: string | null = null
  let answer: string[] = []
  const flush = () => {
    if (question !== null && answer.length > 0) {
      items.push({ question, answer: answer.join(' ') })
    }
    question = null
    answer = []
  }
  for (const node of segment.nodes) {
    if (headingLevel(node) !== null) {
      flush()
      const text = normalizeWhitespace(plainText(node))
      question = text.length > 0 ? text : null
      continue
    }
    const text = normalizeWhitespace(plainText(node))
    if (text.length > 0 && question !== null) {
      answer.push(text)
    }
  }
  flush()
  return items
}

// ---------------------------------------------------------------------------
// Rövidítés (pipás sorok)
// ---------------------------------------------------------------------------

/**
 * Hosszú felsorolás-elem pipás sorrá rövidítése.
 * A hosszú, vesszős magyar mondat a szűk vásárlódobozban 5-6 sort venne el —
 * a pipás sor viszont csak akkor működik, ha EGY pillantással olvasható.
 * A vágás sorrendje szándékos:
 * szövegeinkben pontosan itt ér véget a lényeg, és utána jön a
 * kifejtés („50+ videós gyakorlat – rövid, lépésről lépésre…");
 */
const MIN_CUT = 16

export function shortenHighlight(raw: string, max: number = HIGHLIGHT_MAX_LENGTH): string {
  const text = normalizeWhitespace(raw).replace(/[,;.]+$/, '')
  if (text.length <= max) {
    return text
  }
  const tidy = (value: string): string => value.replace(/[\s,;.–—:]+$/, '')

  const dash = /[–—:]/.exec(text)
  if (dash !== null && dash.index > MIN_CUT && dash.index <= max) {
    return tidy(text.slice(0, dash.index))
  }

  const comma = text.lastIndexOf(',', max)
  if (comma > MIN_CUT) {
    return tidy(text.slice(0, comma))
  }

  const space = text.lastIndexOf(' ', max)
  const end = space > MIN_CUT ? space : max
  return `${tidy(text.slice(0, end))}…`
}

// ---------------------------------------------------------------------------
// Bemenetek
// ---------------------------------------------------------------------------

/** A tényadat-tartalék bemenete (a felület a tananyag-modellből tölti). */
export interface CourseFactsInput {
  moduleCount: number
  lessonCount: number
  /** A hozzáférés hossza napokban; null/0 = nem jár le. */
  accessDurationDays: number | null
  /** Tudatosan ingyenes kurzus (nincs Barion-fizetés). */
  free: boolean
  /** Van-e megnézhető ingyenes előzetes. */
  hasPreview: boolean
}

type SalesFields = Pick<
  Product,
  | 'longDescription'
  | 'salesHighlights'
  | 'howItWorks'
  | 'fitFor'
  | 'notFitFor'
  | 'guaranteeTitle'
  | 'guaranteeText'
  | 'faq'
>

function textRows(rows: { text: string }[] | null | undefined): string[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows.map((row) => normalizeWhitespace(row.text ?? '')).filter((text) => text.length > 0)
}

// ---------------------------------------------------------------------------
// Tényadat-tartalékok
// ---------------------------------------------------------------------------

/**
 * Pipás sorok TÉNYADATOKBÓL — csak akkor, ha sem strukturált mező, sem
 * felsorolás nincs a leírásban. Minden sor ELLENŐRIZHETŐ adat a termékről:
 * marketing-állítást ez az ág sem talál ki.
 */
export function factHighlights(facts: CourseFactsInput): string[] {
  const rows: string[] = []
  if (facts.moduleCount > 1) {
    rows.push(`${facts.moduleCount} modul, lépésről lépésre`)
  }
  if (facts.lessonCount > 0) {
    rows.push(`${facts.lessonCount} lecke a tananyagban`)
  }
  if (facts.accessDurationDays !== null && facts.accessDurationDays > 0) {
    rows.push(`${facts.accessDurationDays} napos hozzáférés`)
  } else {
    rows.push('Örökös hozzáférés: bármikor újranézheted')
  }
  if (facts.hasPreview) {
    rows.push('Ingyenes előzetes vásárlás előtt')
  }
  return rows.slice(0, MAX_HIGHLIGHTS)
}

/**
 * A vásárlási folyamat három TÉNYSZERŰ lépése — a `howItWorks` mező
 * tartaléka. Nem ígéret és nem szlogen: pontosan azt írja le, ami a
 * rendszerben történik (fizetés → azonnali hozzáférés a fiókban → a
 * hozzáférés hossza).
 */
export function factSteps(facts: CourseFactsInput): SalesStep[] {
  const access =
    facts.accessDurationDays !== null && facts.accessDurationDays > 0
      ? `A hozzáférésed a vásárlástól számított ${facts.accessDurationDays} napig él.`
      : 'A hozzáférésed nem jár le: a saját tempódban haladhatsz, és bármikor újranézheted.'
  if (facts.free) {
    return [
      {
        title: 'Belépsz',
        text: 'Ez a kurzus ingyenes: fiók létrehozása után azonnal a tiéd.',
      },
      {
        title: 'Azonnal eléred',
        text: 'A kurzus megjelenik a „Kurzusaim" listádban, és rögtön indíthatod.',
      },
      { title: 'Otthon gyakorolsz', text: access },
    ]
  }
  return [
    {
      title: 'Megveszed',
      text: 'Bankkártyás fizetés a Barionon keresztül. A bankkártya adatait mi nem látjuk.',
    },
    {
      title: 'Azonnal eléred',
      text: 'A sikeres fizetés után a kurzus rögtön megjelenik a „Kurzusaim" listádban.',
    },
    { title: 'Otthon gyakorolsz', text: access },
  ]
}

// ---------------------------------------------------------------------------
// A fő összeállító
// ---------------------------------------------------------------------------

/**
 * A kurzusoldal értékesítő tartalma — strukturált mező → leírás-szakasz →
 * tényadat sorrendben. A visszaadott `body` a leírás azon része, amit a
 * kiemelt szakaszok NEM használtak fel.
 */
export function buildCourseSalesContent(
  product: SalesFields,
  facts: CourseFactsInput,
): CourseSalesContent {
  const segments = segmentDocument(product.longDescription)

  const structuredFitFor = textRows(product.fitFor)
  const structuredNotFitFor = textRows(product.notFitFor)
  const structuredFaq = (Array.isArray(product.faq) ? product.faq : [])
    .map((row) => ({
      question: normalizeWhitespace(row.question ?? ''),
      answer: normalizeWhitespace(row.answer ?? ''),
    }))
    .filter((row) => row.question.length > 0 && row.answer.length > 0)
  const structuredGuaranteeTitle = normalizeWhitespace(product.guaranteeTitle ?? '')
  const structuredGuaranteeText = normalizeWhitespace(product.guaranteeText ?? '')

  // Szakasz-kinyerés a leírásból (csak ott, ahol kell — a nem használt
  // szakasz visszakerül a törzsbe).
  const derived: Record<Exclude<SectionPart, 'body'>, boolean> = {
    fitFor: false,
    notFitFor: false,
    faq: false,
    guarantee: false,
  }
  let derivedFitFor: string[] = []
  let derivedNotFitFor: string[] = []
  let derivedFaq: SalesFaqItem[] = []
  let derivedGuarantee: SalesGuarantee | null = null

  for (const segment of segments) {
    if (segment.part === 'fitFor' && derivedFitFor.length === 0) {
      derivedFitFor = bulletsOf(segment)
      derived.fitFor = derivedFitFor.length > 0
      continue
    }
    if (segment.part === 'notFitFor' && derivedNotFitFor.length === 0) {
      derivedNotFitFor = bulletsOf(segment)
      derived.notFitFor = derivedNotFitFor.length > 0
      continue
    }
    if (segment.part === 'faq' && derivedFaq.length === 0) {
      derivedFaq = faqPairsOf(segment)
      derived.faq = derivedFaq.length > 0
      continue
    }
    if (segment.part === 'guarantee' && derivedGuarantee === null) {
      const title = segment.heading === null ? '' : normalizeWhitespace(plainText(segment.heading))
      const text = paragraphsOf(segment).join(' ')
      if (title.length > 0 && text.length > 0) {
        derivedGuarantee = { title, text }
        derived.guarantee = true
      }
    }
  }

  const fitFor = structuredFitFor.length > 0 ? structuredFitFor : derivedFitFor
  const notFitFor = structuredNotFitFor.length > 0 ? structuredNotFitFor : derivedNotFitFor
  const faq = structuredFaq.length > 0 ? structuredFaq : derivedFaq
  /**
   * INGYENES KURZUSON NINCS GARANCIA (WP51, tulajdonosi kör 2026-09-19 az SOS
   * villámkurzusról: „100% boldogság garancia: nincs visszatérítés, mert
   * ingyenes"). A garancia visszatérítési ígéret; ahol nincs mit
   * visszatéríteni, a sáv és a vásárlódoboz bizalmi címkéje HAMIS állítás
   * lenne — a felirat legyen igaz (docs/ui-sztenderdek.md, SKILL 2. pont;
   * Baymard: a visszaküldési feltételek a fizetős vásárlás kockázatát
   * csökkentik, ingyenes terméknél nincs ilyen kockázat). Ezért a `free`
   * ágon a garancia null, akkor is, ha a CMS strukturált mezője ki van
   * töltve vagy a leírásban van garancia-szakasz; az utóbbi a törzsbe SEM
   * kerül vissza (lent), különben a lap alján olvasható maradna.
   */
  const guarantee: SalesGuarantee | null = facts.free
    ? null
    : structuredGuaranteeTitle.length > 0 && structuredGuaranteeText.length > 0
      ? { title: structuredGuaranteeTitle, text: structuredGuaranteeText }
      : derivedGuarantee

  /**
   * A törzs: minden `body` szakasz, PLUSZ minden olyan kiemelt szakasz,
   * amelyből nem lett használható tartalom (különben némán elveszne). A
   * szakaszt nyitó címsor is visszakerül, hogy a szöveg tagolása megmaradjon.
   */
  const bodyNodes: LexicalNode[] = []
  for (const segment of segments) {
    // Ingyenes kurzuson a garancia-szakasz sehol nem jelenik meg (lásd fent).
    if (facts.free && segment.part === 'guarantee') continue
    if (segment.part === 'body' || !derived[segment.part]) {
      if (segment.heading !== null) {
        bodyNodes.push(segment.heading)
      }
      bodyNodes.push(...segment.nodes)
    }
  }
  const source = product.longDescription
  const body: LexicalDoc | null =
    source && bodyNodes.length > 0
      ? { ...source, root: { ...source.root, children: bodyNodes } }
      : null

  // Előny-pipák: strukturált → a törzs ELSŐ felsorolása → tényadatok.
  const structuredHighlights = textRows(product.salesHighlights)
  let highlights = structuredHighlights.slice(0, MAX_HIGHLIGHTS)
  if (highlights.length === 0) {
    const firstList = bodyNodes.find((node) => listItemTexts(node).length > 0)
    const fromBody = firstList === undefined ? [] : listItemTexts(firstList)
    highlights = fromBody.slice(0, 3).map((text) => shortenHighlight(text))
  }
  if (highlights.length === 0) {
    highlights = factHighlights(facts)
  }

  const structuredSteps = (Array.isArray(product.howItWorks) ? product.howItWorks : [])
    .map((row) => ({
      title: normalizeWhitespace(row.title ?? ''),
      text: normalizeWhitespace(row.text ?? ''),
    }))
    .filter((row) => row.title.length > 0)
    .map((row) => ({ title: row.title, text: row.text.length > 0 ? row.text : null }))

  return {
    highlights,
    steps: structuredSteps.length > 0 ? structuredSteps : factSteps(facts),
    fitFor,
    notFitFor,
    guarantee,
    faq,
    body,
  }
}

/**
 * A garancia RÖVID alakja a vásárlódoboz bizalmi sorához: a cím önmagában
 * elég (pl. „30 napos kipróbálási garancia"), a teljes szöveg a kiemelt
 * sávban olvasható.
 */
export function guaranteeBadgeLabel(guarantee: SalesGuarantee | null): string | null {
  return guarantee === null ? null : guarantee.title
}
