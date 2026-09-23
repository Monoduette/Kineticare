import { SECTION_SETTINGS_LABEL, validateAnchorId } from '../blocks/section-settings'
import { ervenyesBlokkId } from '../components/editor/szekcio-melylink'
import { ctaLabel } from './cta-vocabulary'
import { FREE_SOS_NEUTRAL_TITLE, freeSosStripTitle } from './free-sos-title'
import { CLINIC_TREATMENTS_ANCHOR, SERVICES_PAGE_SLUG } from './menu-seed'
import { PREVIEW_PATH, previewTargetPath } from './preview/preview-target'

/**
 * Az Oldalak „Szekciók” sorának felismerhető sorcímkéi és forrás-jelzései.
 *
 * Tiszta, React- és Payload-mentes modul: az admin sorcímkéje
 * (src/components/admin/SectionRowLabel.tsx), a szekció tetején álló
 * tájékoztató (src/components/admin/SectionSourceNotice.tsx) és a frontend
 * piszkozat-szalagja (modul-térkép A3) ugyanebből dolgozik, így a sorszám és a
 * név mindenhol ugyanaz (WCAG 2.2 SC 3.2.4).
 *
 * MIÉRT KELL: a helyi és az élő mérés szerint (modul-térkép, admin-oldal.json)
 * 34 élő szekcióból 33 sorfejléce csak „NN · típus · Névtelen” volt, a kezdőlap
 * két „Rólunk + statisztikák” sora betűre egyforma, a rejtett 11. sor pedig
 * semmit nem jelzett. A tulajdonos szavaival: „hasonlóan kinéző modul, de más
 * tartalom volt benne, és ez megzavarta”.
 *
 * Források (megnyitva, 2026-09-22):
 * - NN/g, Memory Recognition and Recall in User Interfaces: „How do you promote
 *   recognition? By making information and interface functions visible and
 *   easily accessible.” https://www.nngroup.com/articles/recognition-and-recall/
 * - NN/g, Accordions on Desktop: „Ensure that the heading accurately reflects
 *   the content within the panel.” https://www.nngroup.com/articles/accordions-on-desktop/
 * - GOV.UK Design System, Accordion: „describe the content that will show, and
 *   keep it short.”, mert „Users of screen readers might find it difficult to
 *   navigate the accordion if the button text is too long.” Ezért vág a cím
 *   60 karakternél. https://design-system.service.gov.uk/components/accordion/
 * - IBM Carbon, Accordion: „The title should be as brief as possible while
 *   still being clear and descriptive.”
 *   https://carbondesignsystem.com/components/accordion/usage/
 * - WCAG 2.2 SC 2.4.6 (Headings and Labels) és SC 1.4.1 (Use of Color): a
 *   rejtettséget SZÖVEG mondja ki, nem csak szín.
 *   https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
 *   https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
 */

/** A sorcímkében mutatott cím felső korlátja (karakter), szóhatáron vágva. */
export const SECTION_TITLE_MAX_LENGTH = 60

/** A szöveges ugrópont (#:~:text=) felső korlátja: rövid, de egyedi részlet. */
export const TEXT_FRAGMENT_MAX_LENGTH = 60

/** A sorcímke elemei közti elválasztó. */
export const ELVALASZTO = ' · '

/** Cím nélküli szekció jelzése a sorcímkében. */
export const NINCS_CIME = '(még nincs címe)'

/**
 * Olyan adatvezérelt szekció jelzése, amelynek saját címe üres, a lapon ezért
 * a komponens beépített címe látszik (pl. „Pácienseink mondták”).
 */
export const BEEPITETT_CIM = '(beépített cím)'

/** A rejtett szekció szöveges jele (SC 1.4.1: nem csak szín). */
export const REJTVE_JEL = 'Rejtve'

/** A „Megnézem az oldalon” link látható szövege; az új lapot a szöveg is jelzi. */
export const MEGNEZEM_FELIRAT = 'Megnézem az oldalon (új lapon)'

/** Az admin-hely linkjének eleje; a cél neve kettőspont után áll. */
export const UGRAS_FELIRAT = 'Ugrás oda, ahol szerkeszted'

/** Rejtett szekció dobozának címe: a jelentést szöveg mondja ki, nem a szín (SC 1.4.1). */
export const REJTETT_CIM = 'Figyelem: rejtett szekció'

/** Rejtett szekciónál a link helyén álló magyarázat. */
export const REJTETT_MAGYARAZAT = 'Ez a szekció most rejtve van, a lapon nem látszik.'

/**
 * Rejtett szekciónál: hol és hogyan kapcsolható vissza. A hely nevét a
 * szerkesztő így felismeri, nem kell emlékeznie rá (NN/g, Memory Recognition
 * and Recall: „making information and interface functions visible”). A csukott
 * rész címe az exportált SECTION_SETTINGS_LABEL, így átnevezéskor ez a mondat
 * is vele mozog. Hogy a rész mind a 19 oldalblokk UTOLSÓ mezője, és benne áll a
 * `sectionSettings.visible` pipa, azt a section-row-label.test.ts ellenőrzi;
 * ha akár egy blokkra nem igaz, a „blokk alján” helymegjelölés nem maradhat.
 */
export const REJTETT_TEENDO = `A blokk alján, a „${SECTION_SETTINGS_LABEL}” részben a Látható pipával kapcsolod vissza.`

/** Horgony és cím nélküli szekciónál őszintén megmondjuk, hol nyílik a lap. */
export const LAP_TETEJE_MAGYARAZAT = 'A lap a tetején nyílik meg, innen görgess a szekcióhoz.'

/**
 * A szekció horgonyának előtagja a piszkozat-előnézetben: minden szekció előtt
 * egy `<div id="szekcio-<blokk-azonosító>">` szalag áll (a frontend
 * szerkesztői rétege, src/components/editor/frontend/szerkeszto-szalag.ts
 * `HORGONY_ELOTAG`). Az előtag itt él, mert a szalag-modul maga importálja ezt
 * a fájlt, a fordított import körkörös volna. Hogy a kettő betűre egyezik,
 * azt a section-row-label.test.ts ellenőrzi; a cél, hogy a szalag-modul
 * innen importálja, és egy forrás maradjon.
 */
export const SZEKCIO_HORGONY_ELOTAG = 'szekcio-'

/**
 * A Kapcsolat CMS-oldal webcíme. A /kapcsolat saját route-tal renderel
 * (src/app/(frontend)/kapcsolat/page.tsx `CONTACT_PAGE_SLUG`), és a
 * szekciósorának a kurzusok, a vélemények és a blogbejegyzések listáját üresen
 * adja át. A két sort a szekcio-forras-kotesek.test.ts köti össze.
 */
export const KAPCSOLAT_OLDAL_SLUG = 'kapcsolat'

type Adat = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Adat {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Nem üres, szóközökben összevont szöveg, vagy null. */
export function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

/**
 * Szóhatáron csonkít, „…” (U+2026) jellel. A vágás előtti írásjelet és a
 * gondolatjelet elhagyja, hogy ne „Így tudunk,…” maradjon.
 */
export function truncateAtWord(text: string, max: number = SECTION_TITLE_MAX_LENGTH): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) {
    return normalized
  }
  const hard = normalized.slice(0, Math.max(1, max - 1))
  const lastSpace = hard.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(max / 2) ? hard.slice(0, lastSpace) : hard
  return `${cut.replace(/[\s,;:.–—-]+$/u, '')}…`
}

/** Szöveges ugróponthoz: a cím eleje szóhatáron, „…” nélkül. */
export function fragmentSnippet(text: string, max: number = TEXT_FRAGMENT_MAX_LENGTH): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) {
    return normalized
  }
  const hard = normalized.slice(0, max)
  const lastSpace = hard.lastIndexOf(' ')
  const cut = lastSpace > 0 ? hard.slice(0, lastSpace) : hard
  return cut.replace(/[\s,;:.–—-]+$/u, '')
}

/**
 * A Lexical-JSON első nem üres blokkjának szövege (bekezdés, címsor, lista).
 * A sortörés-csomópont szóközzé válik. Hibás vagy üres érték: null.
 */
export function lexicalFirstText(value: unknown): string | null {
  const root = isRecord(value) && isRecord(value.root) ? value.root : null
  const blocks = root && Array.isArray(root.children) ? root.children : []
  for (const block of blocks) {
    const text = nonEmptyText(collectLexicalText(block))
    if (text) {
      return text
    }
  }
  return null
}

function collectLexicalText(node: unknown): string {
  if (!isRecord(node)) {
    return ''
  }
  if (node.type === 'linebreak') {
    return ' '
  }
  const own = typeof node.text === 'string' ? node.text : ''
  const children = Array.isArray(node.children) ? node.children : []
  return own + children.map(collectLexicalText).join('')
}

/** Pontozott útvonal olvasása (pl. `items.0.text`, `feature.label`). */
export function valueAtPath(data: unknown, path: string): unknown {
  let current: unknown = data
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part)
      current = Number.isInteger(index) ? current[index] : undefined
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      return undefined
    }
  }
  return current
}

function textAtPath(data: unknown, path: string): string | null {
  const value = valueAtPath(data, path)
  return nonEmptyText(value) ?? lexicalFirstText(value)
}

/**
 * A cím forrása blokktípusonként, sorrendben: az első nem üres nyer.
 *
 * A lista a blokk-komponensek tényleges címéhez igazodik (src/components/blocks/,
 * src/components/content/home/): ahol a lap a mezőt címként mutatja, az áll
 * elöl; ahol nincs cím-mező, a lapon elsőként látszó szöveg (pl. a hitel-csík
 * első tétele, a szabad szöveg első bekezdése).
 */
export const SECTION_TITLE_SOURCES: Readonly<Record<string, readonly string[]>> = {
  filmHero: ['title', 'lead'],
  credsStrip: ['items.0.text'],
  courseCards: ['heading'],
  freeSos: ['title'],
  pressLogos: ['heading'],
  welcome: ['title', 'lead', 'checklist.0.text'],
  usps: ['title', 'cards.0.title'],
  states: ['title', 'lead', 'cards.0.title'],
  services: ['title', 'eyebrow', 'lead', 'rows.0.title'],
  about: ['title', 'eyebrow', 'paragraphs.0.text', 'feature.label'],
  howItWorks: ['title', 'steps.0.title'],
  testimonials: ['heading'],
  knowledge: ['heading'],
  faq: ['heading', 'items.0.question'],
  teamMembers: ['title', 'eyebrow', 'members.0.name'],
  accordion: ['title', 'eyebrow', 'items.0.cim'],
  appointment: ['title', 'eyebrow', 'urlapCim'],
  richText: ['content'],
  ctaBanner: ['title', 'text'],
}

/**
 * Üres saját cím mellett a lapon a komponens beépített címe látszik
 * (course-showcase.ts COURSE_SHOWCASE_HEADING, PressLogos.tsx DEFAULT_HEADING,
 * TestimonialsSection.tsx, KnowledgeSection.tsx, FreeSos.tsx
 * FREE_SOS_STRIP_TITLE), ezért itt nem „nincs címe”.
 *
 * Az SOS-sáv címét a lap, a sorcímke, a szerkesztői szalag és az
 * llms-full.txt ugyanazzal a feloldóval számolja (src/lib/free-sos-title.ts
 * `freeSosStripTitle`, modul-térkép H01/H07). A sorcímke a feloldó
 * eredményét mutatja, üres Címnél mellette a „(beépített cím)” jelet
 * (`sectionTitle`, `describeSection`).
 */
export const BUILT_IN_TITLE_TYPES: ReadonlySet<string> = new Set([
  'courseCards',
  'freeSos',
  'pressLogos',
  'testimonials',
  'knowledge',
])

/** A generikus tartalékból kizárt, nem-tartalmi kulcsok. */
const NEM_TARTALMI_KULCSOK = new Set([
  'id',
  'blockType',
  'blockName',
  'sectionSettings',
  'url',
  'hatter',
  'elrendezes',
  'ujAblakban',
  'anchorId',
])

function genericFirstText(data: unknown): string | null {
  if (!isRecord(data)) {
    return null
  }
  for (const [key, value] of Object.entries(data)) {
    if (NEM_TARTALMI_KULCSOK.has(key)) {
      continue
    }
    const text = nonEmptyText(value) ?? lexicalFirstText(value)
    if (text) {
      return text
    }
  }
  return null
}

/**
 * Üres-e az SOS-sáv Cím mezője a közös feloldó szabálya szerint: nem szöveg,
 * vagy trim után üres (src/lib/free-sos-title.ts `cmsCim`). Ilyenkor a lap a
 * beépített címet mutatja.
 */
function freeSosCimUres(data: Adat): boolean {
  return typeof data.title !== 'string' || data.title.trim().length === 0
}

/**
 * A szekció teljes (csonkítatlan) címe, vagy null.
 *
 * Az SOS-sávnál a lap feloldója adja (`freeSosStripTitle(data, true)`): az
 * admin nem tudja, van-e éppen elérhető ingyenes kurzus, ezért a címke azt
 * mondja, amit a lap elérhető SOS-kurzusnál mutat. A „Kurzusaink” ágat a
 * szekció tájékoztatója mondja ki (`sectionSource`).
 *
 * @param data       a blokk adatai (az űrlapállapotból vagy a REST-ből)
 * @param textFields a blokk text/textarea mezőinek neve a configból (tartalék)
 */
export function sectionTitle(data: unknown, textFields: readonly string[] = []): string | null {
  if (!isRecord(data)) {
    return null
  }
  const blockType = typeof data.blockType === 'string' ? data.blockType : ''
  if (blockType === 'freeSos') {
    return freeSosStripTitle(data, true)
  }
  for (const path of SECTION_TITLE_SOURCES[blockType] ?? []) {
    const text = textAtPath(data, path)
    if (text) {
      return text
    }
  }
  if (BUILT_IN_TITLE_TYPES.has(blockType)) {
    return null
  }
  for (const field of textFields) {
    const text = textAtPath(data, field)
    if (text) {
      return text
    }
  }
  return genericFirstText(data)
}

/** A Payload 0-alapú sorindexéből két jegyű sorszám („01”). */
export function sectionNumber(rowIndex: unknown): string {
  const index =
    typeof rowIndex === 'number' && Number.isFinite(rowIndex) && rowIndex >= 0
      ? Math.floor(rowIndex)
      : 0
  return String(index + 1).padStart(2, '0')
}

/** Rejtett-e a szekció: csak a kifejezett `visible: false` rejt (a lap is így dönt). */
export function isSectionHidden(data: unknown): boolean {
  return isRecord(data) && isRecord(data.sectionSettings) && data.sectionSettings.visible === false
}

/** A szekció érvényes horgonya, vagy null. */
export function sectionAnchor(data: unknown): string | null {
  const raw =
    isRecord(data) && isRecord(data.sectionSettings)
      ? nonEmptyText(data.sectionSettings.anchorId)
      : null
  return raw && validateAnchorId(raw) === true ? raw : null
}

export interface SectionDescription {
  /** Két jegyű sorszám, pl. „05”. */
  sorszam: string
  /** A blokktípus emberi neve (a blokk labels.singular-ja). */
  tipus: string
  /** A sorcímkében álló, szükség szerint csonkított cím, vagy null. */
  cim: string | null
  /** A csonkítatlan cím (a szöveges ugróponthoz), vagy null. */
  teljesCim: string | null
  /**
   * A cím helyén álló szöveg: a cím, a hiányát jelző zárójeles szöveg, vagy az
   * SOS-sáv üres Címénél a lap beépített címe a „(beépített cím)” jellel.
   */
  cimSzoveg: string
  /** A régi, kézzel adott blokknév („Rövid bemutatkozás”), ha van. */
  blokkNev: string | null
  rejtett: boolean
  horgony: string | null
  /** Azonos típusú és tartalmú testvér esetén a sorszáma közöttük (1, 2, …), különben null. */
  ismetles: number | null
}

/**
 * Egy szekció-sor leírása.
 *
 * @param data       a blokk adatai
 * @param rowIndex   a Payload 0-alapú sorindexe
 * @param blockLabel a blokktípus emberi neve
 * @param textFields a blokk text/textarea mezőinek neve (tartalék a címhez)
 */
export function describeSection(
  data: unknown,
  rowIndex: unknown,
  blockLabel: string,
  textFields: readonly string[] = [],
): SectionDescription {
  const blockType = isRecord(data) && typeof data.blockType === 'string' ? data.blockType : ''
  const teljesCim = sectionTitle(data, textFields)
  const cim = teljesCim ? truncateAtWord(teljesCim) : null
  const blokkNev = isRecord(data) ? nonEmptyText(data.blockName) : null
  // Az SOS-sáv üres Címénél a címke a lap beépített címét mondja, és mellette
  // jelzi, hogy a mező üres: így a címke betűre a lap szövegét adja, a
  // szerkesztő mégis látja, honnan jön (WCAG 2.2 SC 3.2.4).
  const sosTartalek = blockType === 'freeSos' && isRecord(data) && freeSosCimUres(data)
  return {
    sorszam: sectionNumber(rowIndex),
    tipus: nonEmptyText(blockLabel) ?? (blockType || 'Szekció'),
    cim,
    teljesCim,
    cimSzoveg:
      cim === null
        ? BUILT_IN_TITLE_TYPES.has(blockType)
          ? BEEPITETT_CIM
          : NINCS_CIME
        : sosTartalek
          ? `${cim} ${BEEPITETT_CIM}`
          : cim,
    blokkNev: blokkNev ? truncateAtWord(blokkNev, 40) : null,
    rejtett: isSectionHidden(data),
    horgony: sectionAnchor(data),
    ismetles: null,
  }
}

/** Az azonosság kulcsa: típus + cím + blokknév (a sorszám és a rejtettség nélkül). */
function repeatKey(data: unknown): string {
  const blockType = isRecord(data) && typeof data.blockType === 'string' ? data.blockType : ''
  const cim = (sectionTitle(data) ?? '').toLocaleLowerCase('hu')
  const nev = (isRecord(data) ? (nonEmptyText(data.blockName) ?? '') : '').toLocaleLowerCase('hu')
  return `${blockType}\u0000${cim}\u0000${nev}`
}

/**
 * Az oldalon belüli ismétlődések sorszáma: az azonos típusú, című és nevű
 * sorok 1., 2., … sorszámot kapnak, az egyediek null-t.
 */
export function sectionRepeatOrdinals(rows: readonly unknown[]): (number | null)[] {
  const keys = rows.map(repeatKey)
  const total = new Map<string, number>()
  for (const key of keys) {
    total.set(key, (total.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return keys.map((key) => {
    if ((total.get(key) ?? 0) < 2) {
      return null
    }
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n
  })
}

/** Az ismétlődés jelzése a címke végén. */
export function repeatMarker(ismetles: number | null): string | null {
  return ismetles === null ? null : `(${String(ismetles)}. ilyen)`
}

/**
 * A sorcímke teljes szövege, pl.
 * „11 · Rejtve · Rólunk + statisztikák: Megérdemled a profi törődést (2. ilyen)”.
 */
export function sectionRowLabelText(description: SectionDescription): string {
  const eleje = description.rejtett
    ? `${description.sorszam}${ELVALASZTO}${REJTVE_JEL}${ELVALASZTO}`
    : `${description.sorszam}${ELVALASZTO}`
  const vege = [
    description.blokkNev ? `(${description.blokkNev})` : null,
    repeatMarker(description.ismetles),
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
  return `${eleje}${description.tipus}: ${description.cimSzoveg}${vege ? ` ${vege}` : ''}`
}

/**
 * A modul-térkép közös címke-API-ja (terv.md 5. pont, 3.): a frontend
 * piszkozat-szalagja ugyanazt a sorszámot és nevet mutassa, mint az admin.
 */
export function sectionLabel(
  block: unknown,
  index: number,
  blockLabels: Readonly<Record<string, string>>,
): {
  sorszam: string
  tipus: string
  cim: string | null
  rejtett: boolean
  horgony: string | null
} {
  const blockType = isRecord(block) && typeof block.blockType === 'string' ? block.blockType : ''
  const leiras = describeSection(block, index, blockLabels[blockType] ?? blockType)
  return {
    sorszam: leiras.sorszam,
    tipus: leiras.tipus,
    cim: leiras.cim,
    rejtett: leiras.rejtett,
    horgony: leiras.horgony,
  }
}

/* ------------------------------------------------------------------------ */
/* Tömbsorok                                                                 */
/* ------------------------------------------------------------------------ */

export interface ArrayRowLabelOptions {
  /**
   * Ha meg van adva, MINDEN nem üres cím-mező összefűzve, ezzel az
   * elválasztóval (pl. a Számok sora: „10+” + „év szakmai tapasztalat”).
   */
  separator?: string
  /** Képes sor tartaléka: a kiválasztott kép leírása (alt) vagy fájlneve. */
  imageTitle?: string | null
  /** Van-e kép a sorban (a leírása még töltődhet): ilyenkor a sor nem „üres”. */
  hasImage?: boolean
}

/** Az első betű kisbetűre, ha a második is kisbetű (a „SOS” marad). */
function lowerFirst(text: string): string {
  const first = text.charAt(0)
  const second = text.charAt(1)
  if (
    second &&
    second === second.toLocaleUpperCase('hu') &&
    second !== second.toLocaleLowerCase('hu')
  ) {
    return text
  }
  return first.toLocaleLowerCase('hu') + text.slice(1)
}

/** A tömbsor címe (csonkítatlan), vagy null. */
export function arrayRowTitle(
  data: unknown,
  titleFields: readonly string[],
  options: ArrayRowLabelOptions = {},
): string | null {
  const texts = titleFields
    .map((field) => textAtPath(data, field))
    .filter((text): text is string => text !== null)
  if (options.separator !== undefined && texts.length > 0) {
    return texts.join(options.separator)
  }
  return texts[0] ?? nonEmptyText(options.imageTitle)
}

/**
 * Egy tömbsor felirata: „1. Rendelői kezelések”, üres sornál „3. kérdés (még üres)”,
 * felirat nélküli képes sornál, amíg a kép leírása töltődik, „2. logó (kép)”.
 *
 * @param rowIndex a Payload 0-alapú sorindexe
 * @param singular a tömb egyes számú neve (pl. „Kérdés”)
 */
export function arrayRowLabel(
  data: unknown,
  rowIndex: unknown,
  singular: string,
  titleFields: readonly string[],
  options: ArrayRowLabelOptions = {},
): string {
  const n = String(Number(sectionNumber(rowIndex)))
  const title = arrayRowTitle(data, titleFields, options)
  if (title) {
    return `${n}. ${truncateAtWord(title)}`
  }
  const nev = lowerFirst(nonEmptyText(singular) ?? 'Sor')
  return options.hasImage ? `${n}. ${nev} (kép)` : `${n}. ${nev} (még üres)`
}

/* ------------------------------------------------------------------------ */
/* „Megnézem az oldalon” és forrás-jelzés                                    */
/* ------------------------------------------------------------------------ */

/**
 * Szöveges ugrópont kódolása. A `,` és a `&` a direktíva elválasztója, a `-`
 * az előtag/utótag jele: szövegben mindhármat százalékkódolni kell. Az
 * encodeURIComponent a `,`-t és a `&`-et kódolja, a `-`-t nem, ezért azt
 * külön („the URL-safe dash character '-' to be similarly percent-encoded”).
 * https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments
 */
export function encodeTextFragment(text: string): string {
  return encodeURIComponent(text).replace(/-/g, '%2D')
}

/**
 * Azok a típusok, amelyeknél a lap címe nem mindig a mentett cím (az SOS-sáv
 * elérhető ingyenes kurzus nélkül „Kurzusaink”, FreeSos.tsx), ezért azonosító
 * nélküli sornál szöveges ugrópont nem ígérhető.
 */
const NEM_UGRATHATO_SZOVEG = new Set(['freeSos'])

/**
 * Hová ugrik a „Megnézem” link: `szekcio` a szekció előnézeti horgonyára
 * (minden mentett sor), a többi csak azonosító nélküli sornál: `horgony` a
 * szerkesztő által adott ugrópontra, `szoveg` a címre, `lap` a lap tetejére.
 */
export type SectionViewMode = 'szekcio' | 'horgony' | 'szoveg' | 'lap'

export interface SectionViewLink {
  href: string
  mode: SectionViewMode
}

/**
 * A „Megnézem az oldalon” link célja: a piszkozat-előnézet (/next/preview),
 * amely a szerkesztőnek a legutóbb mentett piszkozatot mutatja, a szekció
 * ugrópontjával.
 *
 * Érvényes blokk-azonosítónál (24 hexa jegy, `ervenyesBlokkId`) mindig a
 * `#szekcio-<blokk-azonosító>` horgony: a piszkozat-előnézetben minden szekció
 * (a rejtett is) előtt ott áll a szerkesztői szalag ezzel az id-vel, a lap
 * `scroll-padding-top`-ja pedig a ragadós fejléc alá görget (base.css; MDN,
 * scroll-padding-top: „defines offsets for the top of the optimal viewing
 * region of the scrollport”, amellyel a szerző kizárhatja „regions of the
 * scrollport that are obscured by other content (such as fixed-positioned
 * toolbars or sidebars)”). A Payload a sor azonosítóját már a sor hozzáadásakor kiosztja
 * (@payloadcms/ui/dist/forms/Form/fieldReducer.js, `new ObjectId()`), az
 * automatikus piszkozat-mentés pedig a sort az előnézetbe viszi.
 *
 * Azonosító nélküli sornál a régi sorrend marad: 1. a szerkesztő ugrópontja
 * (`#anchorId`); 2. szöveges ugrópont a szekció címére (`#:~:text=`), csak ha
 * a cím a lapon előtte nem fordul elő (a böngésző az ELSŐ egyezésre ugrik);
 * 3. a lap teteje, amit a tájékoztató ki is mond.
 *
 * @param earlierTitles a lapon ELŐTTE álló, látható szekciók teljes címe
 */
export function sectionViewLink(
  collection: 'pages',
  slug: unknown,
  data: unknown,
  earlierTitles: readonly (string | null)[] = [],
): SectionViewLink | null {
  if (previewTargetPath(collection, slug) === null || typeof slug !== 'string') {
    return null
  }
  const params = new URLSearchParams({ collection, slug: slug.trim() })
  const base = `${PREVIEW_PATH}?${params.toString()}`
  const blokkId = isRecord(data) ? data.id : undefined
  if (ervenyesBlokkId(blokkId)) {
    return { href: `${base}#${SZEKCIO_HORGONY_ELOTAG}${blokkId}`, mode: 'szekcio' }
  }
  const horgony = sectionAnchor(data)
  if (horgony) {
    return { href: `${base}#${horgony}`, mode: 'horgony' }
  }
  const blockType = isRecord(data) && typeof data.blockType === 'string' ? data.blockType : ''
  const teljesCim = NEM_UGRATHATO_SZOVEG.has(blockType) ? null : sectionTitle(data)
  if (teljesCim) {
    const reszlet = fragmentSnippet(teljesCim)
    const kulcs = reszlet.toLocaleLowerCase('hu')
    const korabban = earlierTitles.some(
      (cim) => cim !== null && cim.toLocaleLowerCase('hu').includes(kulcs),
    )
    if (!korabban) {
      return { href: `${base}#:~:text=${encodeTextFragment(reszlet)}`, mode: 'szoveg' }
    }
  }
  return { href: base, mode: 'lap' }
}

export interface SectionSourceInfo {
  /** Rövid cím a doboz tetején. */
  cim: string
  /** Legfeljebb két rövid mondat. */
  szoveg: string
  /** Hol szerkeszthető: az admin-útvonal az admin gyökere után (pl. `/collections/products`). */
  hova: { nev: string; adminPath: string } | null
}

/** Kurzusra visz-e a gomb (a cta-banner-course.ts ctaPathname szabálya szerint). */
export function isCourseTarget(url: unknown): boolean {
  const trimmed = nonEmptyText(url)
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return false
  }
  const pathname = (trimmed.split(/[?#]/, 1)[0] ?? '').replace(/\/+$/, '')
  return pathname === '/kurzusok' || pathname.startsWith('/kurzusok/')
}

/** Az SOS-kurzus webcíme: a lap csak ezt a kurzust teszi a sávba (src/lib/sos-offer.ts `isStorefrontFreeSos`). */
export const SOS_KURZUS_SLUG = 'sos-kezrelax-villamkurzus'

/**
 * Azok a szekciók, amelyeknek a /kapcsolat route üres listát ad
 * (src/app/(frontend)/kapcsolat/page.tsx: `posts={[]}`, `products={[]}`,
 * `testimonials={[]}`; a három sort a szekcio-forras-kotesek.test.ts köti).
 * Mérve (RenderBlocks, üres listákkal): a Vélemények és a Tudástár-ajánló
 * semmit nem renderel, a Kurzuskártyák helyén egy üres sáv marad cím, bevezető
 * és kártyák nélkül, a kurzusra vivő gombos sáv pedig kép nélkül jelenik meg.
 * Ezeknél a sornál a „Megnézem” link elmarad (a B vezető döntése, 2026-09-23).
 */
export function kapcsolatiUresLista(data: unknown, pageSlug: unknown): boolean {
  if (pageSlug !== KAPCSOLAT_OLDAL_SLUG || !isRecord(data)) {
    return false
  }
  switch (data.blockType) {
    case 'testimonials':
    case 'knowledge':
    case 'courseCards':
      return true
    case 'ctaBanner':
      return isCourseTarget(isRecord(data.cta) ? data.cta.url : undefined)
    default:
      return false
  }
}

/**
 * A /kapcsolat oldal szekciói, amelyek ott másképp látszanak, mert a route a
 * listájukat üresen adja (`kapcsolatiUresLista`, és az SOS-sáv: termék nélkül
 * a FreeSos.tsx semleges ágra vált).
 */
function kapcsolatiForras(data: Adat): SectionSourceInfo | null {
  switch (data.blockType) {
    case 'testimonials':
      return {
        cim: 'A Kapcsolat oldalon ez a szekció nem jelenik meg',
        szoveg:
          'Ez az oldal nem tölti be a véleményeket, ezért a szekcióból itt semmi nem látszik, a címe sem.',
        hova: null,
      }
    case 'knowledge':
      return {
        cim: 'A Kapcsolat oldalon ez a szekció nem jelenik meg',
        szoveg:
          'Ez az oldal nem tölti be a blogbejegyzéseket, ezért a szekcióból itt semmi nem látszik, a címe sem.',
        hova: null,
      }
    case 'courseCards':
      return {
        cim: 'A Kapcsolat oldalon a kártyák nem jelennek meg',
        szoveg:
          'Ez az oldal nem tölti be a kurzusokat, ezért itt a felső kis felirat, a cím, a bevezető, a kártyák és a fotók sem látszanak. A szekció helyén egy üres sáv marad.',
        hova: null,
      }
    case 'ctaBanner':
      return {
        cim: 'A Kapcsolat oldalon a sáv kép nélkül jelenik meg',
        szoveg:
          'Ez az oldal nem tölti be a kurzusokat, ezért a kurzus borítóképe itt nem látszik. A sáv címe, szövege és gombja megjelenik.',
        hova: null,
      }
    case 'freeSos':
      return {
        cim: 'A Kapcsolat oldalon a kurzus adatai nem töltődnek be',
        szoveg: `Ez az oldal nem tölti be a kurzusokat, ezért itt a sáv a „${FREE_SOS_NEUTRAL_TITLE}” címet, egy beépített mondatot és a kurzuslistára vivő gombot mutatja. A nagy címe és a Szövege itt nem látszik.`,
        hova: null,
      }
    default:
      return null
  }
}

/**
 * A más gyűjteményből vagy automatikusan töltődő szekciók jelzése.
 *
 * A kód olvasásával igazolt esetek (a modul-térkép „cms-gyűjtemény-más-helyen”
 * és „számított” sorai):
 * - courseCards: CourseShowcase a közzétett Kurzusokból (RenderBlocks.tsx courseCards ág);
 * - freeSos: a cím fölötti kis sor a kurzus neve (`displayTitle`, üresen
 *   `sku`), a gomb a kurzus oldalára visz (`resolveFreeSosCta`), üres
 *   Szövegnél a kurzus rövid leírása látszik; elérhető ingyenes kurzus nélkül
 *   a sáv semleges (FreeSos.tsx). A mondat a free-sos.ts mezőleírásainak és a
 *   Kurzusok mezőcímkéinek szavait használja (WCAG 2.2 SC 3.2.4);
 * - testimonials: `getTestimonials` (cms.ts: Látható és Kiemelt, `sort:
 *   'order'`, legfeljebb 3) és `featuredTestimonials` (a blokk „Hány vélemény
 *   jelenjen meg” mezője 1–3 közé szorítva); az idézet a rövid, ha ki van
 *   töltve, különben a teljes szöveg (`testimonialQuoteText`,
 *   TestimonialsSection.tsx; modul-térkép H43);
 * - knowledge: getLatestPosts, a legfrissebb közzétett blogbejegyzések
 *   (cms.ts, KnowledgeSection.tsx); kikapcsolt Tudástárnál (a /blog webcímű
 *   menüpont kapcsolója, src/lib/tudastar-kapcsolo.ts) a route üres listát ad,
 *   és a szekció nem jelenik meg. A mondat a knowledge.ts `heading`
 *   leírásának szavait követi (WCAG 2.2 SC 3.2.4);
 * - ctaBanner: a kép a gomb céljából, a kurzus borítójából (cta-banner-course.ts
 *   resolveCtaBannerFigure); a Rólunk oldalon beépített montázs;
 * - richText `rendeloi` horgonnyal: árkártyák a szöveg szerkezetéből
 *   (RenderBlocks.tsx, rendeloi-arlista.ts); a felismerés szabályát a Tartalom
 *   mező leírása mondja el, itt nem ismételjük;
 * - a Kapcsolat oldalon a fenti öt típus másképp látszik (`kapcsolatiForras`).
 * A filmHero szövege az A csapaté, ide szándékosan nem kerül.
 * A térkép bővíthető: új esetnél új ág és új teszt kell.
 *
 * A szöveg nem állíthat kivétel nélkül igazat: „csak”, „minden” vagy „a többi”
 * nem állhat benne, ha a felsorolás nem teljes (a blokk mezőlistájával
 * összevetve; a teszt a „csak” szót minden ágon tiltja).
 */
export function sectionSource(data: unknown, pageSlug: unknown): SectionSourceInfo | null {
  if (!isRecord(data)) {
    return null
  }
  if (pageSlug === KAPCSOLAT_OLDAL_SLUG) {
    const kapcsolati =
      data.blockType === 'freeSos' || kapcsolatiUresLista(data, pageSlug)
        ? kapcsolatiForras(data)
        : null
    if (kapcsolati) {
      return kapcsolati
    }
  }
  switch (data.blockType) {
    case 'courseCards':
      return {
        cim: 'A kártyák a Kurzusokból töltődnek',
        szoveg:
          'A kurzus nevét, árát és borítóképét a Kurzusoknál írod át. Itt a szekció felső kis feliratát, címét, bevezetőjét, a kártyák gombfeliratát és a kártyák alatti fotókat szerkeszted.',
        hova: { nev: 'Kurzusok', adminPath: '/collections/products' },
      }
    case 'freeSos':
      return {
        cim: 'A kurzus neve és a gomb célja a Kurzusokból jön',
        szoveg: `A cím fölötti kis sor a kurzus neve (a „Kurzus címe”, üresen a „Belső azonosító”), a gomb az ingyenes kurzus oldalára visz, és ha a Szöveget üresen hagyod, a kurzus „Rövid leírás” mezője látszik. Ha éppen nincs elérhető ingyenes kurzus, a sáv ehelyett a „${FREE_SOS_NEUTRAL_TITLE}” címet, egy beépített mondatot és a kurzuslistára vivő gombot mutatja.`,
        hova: {
          nev: 'Kurzusok',
          adminPath: `/collections/products?where[slug][equals]=${SOS_KURZUS_SLUG}`,
        },
      }
    case 'testimonials':
      return {
        cim: 'Az idézetek a Véleményekből jönnek',
        szoveg:
          'A Kiemelt és Látható pipás vélemények közül a Sorrend szerinti első legfeljebb három látszik, a „Hány vélemény jelenjen meg” mezőben kevesebbet is kérhetsz. Ha a Rövid idézet ki van töltve, az látszik, különben a Teljes szöveg.',
        hova: { nev: 'Vélemények', adminPath: '/collections/testimonials' },
      }
    case 'knowledge':
      return {
        cim: 'A kártyák a Blogbejegyzésekből jönnek',
        szoveg:
          'A legfrissebb közzétett blogbejegyzések közül legfeljebb annyi látszik, amennyit a „Hány blogbejegyzés jelenjen meg” mezőben beállítasz, a szövegüket a Blogbejegyzéseknél írod át. Ha a Tudástár ki van kapcsolva (a Menüpontok között a /blog webcímű menüpontnál nincs pipa a „Látható” mezőben, vagy be van jelölve a „Rejtett link”), ez a szekció nem jelenik meg az oldalon.',
        hova: { nev: 'Blogbejegyzések', adminPath: '/collections/posts' },
      }
    case 'ctaBanner': {
      const cta = isRecord(data.cta) ? data.cta : null
      if (!isCourseTarget(cta?.url)) {
        return null
      }
      if (pageSlug === 'rolunk') {
        return {
          cim: 'A kép beépített montázs',
          szoveg:
            'A Rólunk oldalon a sáv képe egy beépített montázs, ezt itt nem tudod cserélni. Ha a gomb nem kurzusra visz, a sáv kép nélkül jelenik meg.',
          hova: null,
        }
      }
      return {
        cim: 'A kép a Kurzusokból jön',
        szoveg:
          'Mivel a gomb egy kurzusra visz, a sávban a kurzus borítóképe látszik. A borítóképet a Kurzusoknál cseréled.',
        hova: { nev: 'Kurzusok', adminPath: '/collections/products' },
      }
    }
    case 'richText':
      if (sectionAnchor(data) !== CLINIC_TREATMENTS_ANCHOR) {
        return null
      }
      return {
        cim: 'Árlista a szövegből',
        szoveg:
          'Ennél a szekciónál a lap a szövegből árkártyákat épít, ha a szerkezete felismerhető, különben sima szövegként látszik. A felismerés szabályát a Tartalom mező leírása mondja el.',
        hova: null,
      }
    default:
      return null
  }
}

/**
 * Egy ugrópont, amelyre a weboldal kódja hivatkozik (modul-térkép H48). Ha a
 * szerkesztő átnevezi, a hivatkozás nem ide ugrik, és ezt semmi nem jelzi.
 */
export interface KotottUgropont {
  /** Az oldal webcíme, amelyen az ugrópontra a kód hivatkozik. */
  oldal: string
  /** Az ugrópont neve (`sectionSettings.anchorId`). */
  ugropont: string
  /** A mondat alanya: mi visz ide. */
  mi: string
  /** Többes számú-e az alany (az „ezek” és az „ez” igeegyeztetéséhez). */
  tobb: boolean
}

/**
 * A kódhoz kötött ugrópontok egyetlen listája. Ahol tiszta, importálható
 * konstans van, onnan jön (CLINIC_TREATMENTS_ANCHOR, SERVICES_PAGE_SLUG); ahol
 * nincs, a szekcio-forras-kotesek.test.ts readFileSync-őre köti a hivatkozó
 * sorhoz. A kódból felderítve (2026-09-23):
 * - „rendeloi” a Szolgáltatások oldalon: a menü „Rendelői kezelések” pontjának
 *   alapértéke (menu-seed.ts `CLINIC_TREATMENTS_PATH`, élőben és helyben is ez
 *   a menüpont) és két régi webcím 308-as átirányítása (legacy-redirects.ts
 *   `SERVICES_RENDELOI_ANCHOR`: /rendeloi-kezelesek, /rendeloi-kezelesek-regi);
 *   a szabad szöveg árkártyái is ehhez a névhez kötöttek (RenderBlocks.tsx);
 * - „idopontkeres” a Kapcsolat oldalon: a blogbejegyzések végén álló
 *   időpontkérő gomb célja (PostCourseCta.tsx `APPOINTMENT_HREF`, a cikk végi
 *   ajánló mindhárom változatában).
 * A „szakmai-hatter” nem kötött: a kód nem hivatkozik rá, csak CMS-linkek
 *   (a szakember-kártyák „Bővebben” linkjei) és egyszeri tartalom-szkriptek.
 */
export const KOTOTT_UGROPONTOK: readonly KotottUgropont[] = [
  {
    oldal: SERVICES_PAGE_SLUG,
    ugropont: CLINIC_TREATMENTS_ANCHOR,
    mi: 'a menü „Rendelői kezelések” pontja és két régi webcím átirányítása',
    tobb: true,
  },
  {
    oldal: KAPCSOLAT_OLDAL_SLUG,
    ugropont: 'idopontkeres',
    mi: `a blogbejegyzések végén álló „${ctaLabel('appointment-request-link')}” gomb`,
    tobb: false,
  },
]

/** A kötött ugrópont figyelmeztetésének címe. */
export const KOTOTT_CIM = 'Az ugrópont nevét a weboldal használja'

/**
 * Kötött ugrópontú sornál egy mondat: mi visz ide, és mi történik
 * átnevezéskor; különben null.
 *
 * Mérve (2026-09-23, eldobható piszkozat-oldalon, a lapról a /kapcsolat és a
 * /szolgaltatasok nem létező ugrópontjára mutató gombbal): a weboldal belső
 * linkjei (a menü és a cikk végi gomb is next/link) nem létező ugrópontnál a
 * lapot az előző lap görgetési helyén nyitják meg (3597 → 3243, 4332 → 4332
 * px), az átirányítás és a beírt webcím a lap tetején (0 px). Egyik sem a
 * szekció, ezért a mondat ezt mondja („már nem ide visz”), nem azt, hogy a
 * lap tetejére visz. A szabad szövegnél a „rendeloi” név az árkártyákat is
 * kapcsolja (RenderBlocks.tsx `CLINIC_TREATMENTS_ANCHOR`).
 */
export function kotottUgropont(data: unknown, pageSlug: unknown): string | null {
  const horgony = sectionAnchor(data)
  const kotott = KOTOTT_UGROPONTOK.find(
    (elem) => elem.oldal === pageSlug && elem.ugropont === horgony,
  )
  if (!kotott) {
    return null
  }
  const arlista =
    isRecord(data) && data.blockType === 'richText' && horgony === CLINIC_TREATMENTS_ANCHOR
      ? ', és a szövegből árkártyák sem lesznek'
      : ''
  const kovetkezmeny = kotott.tobb ? 'ezek már nem ide visznek' : 'már nem ide visz'
  return `Erre az ugrópontra („${kotott.ugropont}”) visz ${kotott.mi}, ezért ha átnevezed vagy törlöd, ${kovetkezmeny}${arlista}.`
}

export interface SectionNoticeModel {
  rejtett: boolean
  forras: SectionSourceInfo | null
  /**
   * A „Megnézem az oldalon” link; null rejtett szekciónál, mentetlen (webcím
   * nélküli) oldalon, és a Kapcsolat oldalon ott, ahol a route üres listát ad
   * (`kapcsolatiUresLista`).
   */
  megnezem: SectionViewLink | null
  /** Az „Ugrás oda, ahol szerkeszted” link, ha a tartalom máshol szerkeszthető. */
  ugras: { felirat: string; href: string } | null
  /**
   * Rejtett szekciónál a LÁTHATÓ, azonos típusú és című testvér sorszáma
   * („02”), ha van: az élő kezdőlap 11. rejtett Rólunk-sora a 02. sor ikre, és
   * aki a rejtettet szerkeszti, annak a munkája sosem jelenik meg (modul-térkép H02).
   */
  iker: string | null
  /** Kötött ugrópontnál a figyelmeztető mondat (`kotottUgropont`), különben null. */
  kotott: string | null
}

/** A rejtett sor látható ikre: azonos típus és cím (a blokknév nem számít). */
export function visibleTwin(
  data: unknown,
  rowIndex: number,
  siblings: readonly unknown[],
): string | null {
  if (!isSectionHidden(data)) {
    return null
  }
  const blockType = isRecord(data) ? data.blockType : undefined
  const cim = sectionTitle(data)?.toLocaleLowerCase('hu')
  if (!cim) {
    return null
  }
  const index = siblings.findIndex(
    (sibling, i) =>
      i !== rowIndex &&
      !isSectionHidden(sibling) &&
      isRecord(sibling) &&
      sibling.blockType === blockType &&
      sectionTitle(sibling)?.toLocaleLowerCase('hu') === cim,
  )
  return index === -1 ? null : sectionNumber(index)
}

/**
 * A határozott névelő egy sorszám előtt, a kiejtés szerint: „az 1.”, „az 5.”,
 * „az 50–59.”, minden más 1–99 között „a” (egy, öt, ötven magánhangzóval kezdődik).
 */
export function nevelo(n: number): 'a' | 'az' {
  return n === 1 || n === 5 || (n >= 50 && n <= 59) ? 'az' : 'a'
}

/** A rejtett doboz második mondata: a látható iker, vagy a visszakapcsolás módja. */
export function hiddenHint(iker: string | null): string {
  if (!iker) {
    return REJTETT_TEENDO
  }
  const n = Number(iker)
  const sor = `${nevelo(n)} ${String(n)}. sor`
  return `Ugyanezzel a címmel ${sor} látszik a lapon, a látható szöveget ott írod át.`
}

/**
 * A szekció tetején álló tájékoztató modellje.
 *
 * @param siblings   a Szekciók-mező összes sorának adata, sorrendben
 * @param adminRoute az admin gyökere (a Payload `routes.admin`, pl. `/admin`)
 */
export function sectionNoticeModel({
  data,
  pageSlug,
  rowIndex,
  siblings,
  adminRoute,
}: {
  data: unknown
  pageSlug: unknown
  rowIndex: number
  siblings: readonly unknown[]
  adminRoute: string
}): SectionNoticeModel {
  const rejtett = isSectionHidden(data)
  const forras = sectionSource(data, pageSlug)
  const earlierTitles = siblings
    .slice(0, Math.max(0, rowIndex))
    .filter((sibling) => !isSectionHidden(sibling))
    .map((sibling) => sectionTitle(sibling))
  const admin = adminRoute.replace(/\/+$/, '')
  return {
    rejtett,
    forras,
    megnezem:
      rejtett || kapcsolatiUresLista(data, pageSlug)
        ? null
        : sectionViewLink('pages', pageSlug, data, earlierTitles),
    ugras: forras?.hova
      ? {
          felirat: `${UGRAS_FELIRAT}: ${forras.hova.nev}`,
          href: `${admin}${forras.hova.adminPath}`,
        }
      : null,
    iker: visibleTwin(data, rowIndex, siblings),
    kotott: kotottUgropont(data, pageSlug),
  }
}
