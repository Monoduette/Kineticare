import { SECTION_SETTINGS_LABEL, validateAnchorId } from '../blocks/section-settings'
import { ervenyesBlokkId, szekcioMelylink } from '../components/editor/szekcio-melylink'
import { HOME_PAGE_SLUG } from './content-slugs'
import { ctaLabel } from './cta-vocabulary'
import { FREE_SOS_NEUTRAL_TITLE, freeSosStripTitle } from './free-sos-title'
import { kezdolapiSinE, presentHomeHelpServicesBlock, szolgaltatasokSinE } from './home-help-states'
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
  howItWorks: ['title'],
  testimonials: ['heading'],
  knowledge: ['heading'],
  faq: ['heading', 'items.0.question'],
  teamMembers: ['title', 'eyebrow', 'members.0.name'],
  accordion: ['title', 'eyebrow', 'items.0.cim'],
  appointment: ['title', 'eyebrow', 'urlapCim'],
  richText: ['content'],
  ctaBanner: ['title', 'text'],
  offerCards: ['title', 'eyebrow', 'kartyak.0.cim'],
}

/**
 * Üres saját cím mellett a lapon a komponens beépített címe látszik
 * (course-showcase.ts COURSE_SHOWCASE_HEADING, PressLogos.tsx DEFAULT_HEADING,
 * TestimonialsSection.tsx, KnowledgeSection.tsx, FreeSos.tsx
 * FREE_SOS_STRIP_TITLE, HowItWorks.tsx:49 „Így működik az online kurzus”,
 * CredentialsStrip.tsx `CREDENTIALS`: kitöltött tétel nélkül a beépített
 * három tény), ezért itt nem „nincs címe”.
 *
 * A Számozott lépések címe üres Szekciócímnél NEM az első lépés címe: a lap
 * ilyenkor a beépített címet mutatja, ezért a lépés-tartalék kikerült
 * (modul-térkép H01, K15, WCAG 2.2 SC 3.2.4). A hitel-csík „címe” az első
 * KITÖLTÖTT tétel, mert a lap az üres tételeket kihagyja (RenderBlocks.tsx
 * credsStrip ág, `credsStripTitle`).
 *
 * Az SOS-sáv címét a lap, a sorcímke, a szerkesztői szalag és az
 * llms-full.txt ugyanazzal a feloldóval számolja (src/lib/free-sos-title.ts
 * `freeSosStripTitle`, modul-térkép H01/H07). A sorcímke a feloldó
 * eredményét mutatja, üres Címnél mellette a „(beépített cím)” jelet
 * (`sectionTitle`, `describeSection`).
 */
export const BUILT_IN_TITLE_TYPES: ReadonlySet<string> = new Set([
  'courseCards',
  'credsStrip',
  'freeSos',
  'howItWorks',
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
 * A hitel-csík első kitöltött tételének szövege, vagy null. A lap ugyanígy
 * dönt: a RenderBlocks.tsx credsStrip ága az üres tételeket kiszűri, és ha
 * egy sem marad, a CredentialsStrip a beépített tényeket mutatja.
 */
function credsStripTitle(data: Adat): string | null {
  const items = Array.isArray(data.items) ? data.items : []
  for (const item of items) {
    const text = isRecord(item) ? nonEmptyText(item.text) : null
    if (text) {
      return text
    }
  }
  return null
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
  if (blockType === 'credsStrip') {
    return credsStripTitle(data)
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
  /**
   * A lapon ténylegesen látszó elrendezés jele a típus után („(sín)”,
   * „(tábla)”), vagy null (`sectionPageMarks`). Opcionális, mert a meglévő
   * hívók (a frontend szalag, a szekció-másolatok) oldal nélkül építenek.
   */
  valtozat?: string | null
  /** Oldalfüggő jelek a cím után, pl. „#rendeloi (erre visz a menü)” (`sectionPageMarks`). */
  jelek?: readonly string[]
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

/** A típus és a lapon látszó elrendezés jele, pl. „Képes lista vagy kártyák (sín)”. */
export function tipusValtozattal(description: SectionDescription): string {
  const valtozat = nonEmptyText(description.valtozat)
  return valtozat ? `${description.tipus} ${valtozat}` : description.tipus
}

/**
 * A cím utáni rész: az oldalfüggő jelek, a régi blokknév és az ismétlődés,
 * ebben a sorrendben, szóközzel elválasztva; üresen null.
 */
export function sectionLabelTail(description: SectionDescription): string | null {
  const vege = [
    ...(description.jelek ?? []),
    description.blokkNev ? `(${description.blokkNev})` : null,
    repeatMarker(description.ismetles),
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(' ')
  return vege.length > 0 ? vege : null
}

/**
 * A sorcímke teljes szövege: sorszám, [Rejtve], típus [elrendezés],
 * kettőspont, cím, [jelek], [(blokknév)], [(N. ilyen)], pl.
 * „11 · Rejtve · Rólunk + statisztikák: Megérdemled a profi törődést (2. ilyen)”,
 * „05 · Képes lista vagy kártyák (sín): Így tudunk segíteni”.
 */
export function sectionRowLabelText(description: SectionDescription): string {
  const eleje = description.rejtett
    ? `${description.sorszam}${ELVALASZTO}${REJTVE_JEL}${ELVALASZTO}`
    : `${description.sorszam}${ELVALASZTO}`
  const vege = sectionLabelTail(description)
  return `${eleje}${tipusValtozattal(description)}: ${description.cimSzoveg}${vege ? ` ${vege}` : ''}`
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
  /**
   * Külön bekezdés arról, HOL látszik még ugyanez a tartalom (legfeljebb két
   * rövid mondat). Külön mező, mert más kérdésre felel, mint a `szoveg`
   * (honnan jön), és így a doboz egy bekezdése sem nő két mondat fölé.
   */
  holLatszik?: string
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

/** A CTA-sáv Kép mezője ki van-e töltve (azonosító vagy feloldott média). */
function vanFeltoltottKep(kep: unknown): boolean {
  if (typeof kep === 'number') return true
  if (typeof kep === 'string') return kep.trim().length > 0
  return isRecord(kep)
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
          'Ez az oldal nem tölti be a kurzusokat, ezért itt a felső kis felirat, a cím, a bevezető, a háttérfelirat, a kártyák és a fotók sem látszanak. A szekció helyén egy üres sáv marad.',
        hova: null,
      }
    case 'ctaBanner':
      // A feltöltött kép (H28) a Kapcsolat oldalon is megjelenik.
      if (vanFeltoltottKep(data.kep)) {
        return null
      }
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
 * A Vélemények szekció második bekezdése (modul-térkép H30, H43/5): hol látszik
 * még ugyanez a három vélemény, és mi lesz a többivel.
 *
 * Mérve a kódban (2026-09-23): a `getTestimonials` két helyen fut, a kezdőlap
 * route-jában (src/app/(frontend)/page.tsx:64) és a CMS-oldalak közös
 * route-jában (src/app/(frontend)/[slug]/page.tsx:236), mindkettő ugyanazzal a
 * lekérdezéssel (Látható és Kiemelt, Sorrend, legfeljebb 3); a /kapcsolat
 * saját route-ja üres listát ad (`kapcsolatiForras`). A „Hol látszik” oszlopot
 * a Vélemények listáján a B5 csomag vezeti be, a név onnan jön.
 * A mondat „csak” és „minden oldal” nélkül áll: a Kapcsolat oldalt kiveszi,
 * más kivétel a kódban nincs.
 */
export const VELEMENYEK_HOL_LATSZIK =
  'Ugyanezeket a véleményeket mutatja bármelyik másik oldal Vélemények szekciója is, a Kapcsolat oldalét kivéve. Amelyik vélemény nem kerül az első háromba, az sehol nem jelenik meg; a Vélemények listájában a „Hol látszik” oszlop véleményenként mutatja.'

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
          'A kurzus nevét, árát és borítóképét a Kurzusoknál írod át. Itt a szekció felső kis feliratát, címét, bevezetőjét, háttérfeliratát, a kártyák gombfeliratát és a kártyák alatti fotókat szerkeszted.',
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
        holLatszik: VELEMENYEK_HOL_LATSZIK,
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
      // H28 (A1): a Kép mezőbe feltöltött kép minden oldalon megelőzi a
      // számított képet (cta-banner-course.ts ctaBannerFigura), ilyenkor a kép
      // forrása maga ez a szekció, nincs mit jelezni.
      if (vanFeltoltottKep(data.kep)) {
        return null
      }
      const cta = isRecord(data.cta) ? data.cta : null
      if (!isCourseTarget(cta?.url)) {
        return null
      }
      if (pageSlug === 'rolunk') {
        return {
          cim: 'A kép beépített montázs',
          szoveg:
            'A Rólunk oldalon a sáv képe egy beépített montázs, ha a Kép mező üres. Ha oda feltöltesz egy képet, az látszik helyette.',
          hova: null,
        }
      }
      return {
        cim: 'A kép a Kurzusokból jön',
        szoveg:
          'Mivel a gomb egy kurzusra visz és a Kép mező üres, a sávban a kurzus borítóképe látszik, amelyet a Kurzusoknál cserélsz. Ha a Kép mezőbe feltöltesz egy képet, az látszik helyette.',
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
  /**
   * A sorcímke rövid jele a horgony után, zárójelben, pl. „erre visz a menü”
   * (`sectionPageMarks`, modul-térkép H48/4).
   */
  rovid: string
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
 * A „szakmai-hatter” nem kódhoz kötött: a weboldal kódja nem hivatkozik rá,
 *   CMS-linkek (a szakember-kártyák „Nézd meg a szakmai hátterét” linkjei) és
 *   egyszeri tartalom-szkriptek igen; ezt a `CMS_KOTOTT_UGROPONTOK` jelzi.
 */
export const KOTOTT_UGROPONTOK: readonly KotottUgropont[] = [
  {
    oldal: SERVICES_PAGE_SLUG,
    ugropont: CLINIC_TREATMENTS_ANCHOR,
    mi: 'a menü „Rendelői kezelések” pontja és két régi webcím átirányítása',
    tobb: true,
    rovid: 'erre visz a menü',
  },
  {
    oldal: KAPCSOLAT_OLDAL_SLUG,
    ugropont: 'idopontkeres',
    mi: `a blogbejegyzések végén álló „${ctaLabel('appointment-request-link')}” gomb`,
    tobb: false,
    // A gomb felirata „Kérj időpontot üzenetben” (ctaLabel('appointment-request-link')),
    // ezért „időpontgomb”; a „blogbejegyzések” szó a `mi` mondatéval és a
    // gyűjtemény nevével egyezik (SC 3.2.4).
    rovid: 'erre visz a blogbejegyzések időpontgombja',
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

/** A kötött ugrópont illesztése a sorcímkéhez: ugyanaz, mint a `kotottUgropont`-ban (oldal + horgony). */
function kotottElem(data: unknown, pageSlug: unknown): KotottUgropont | null {
  const horgony = sectionAnchor(data)
  return (
    KOTOTT_UGROPONTOK.find((elem) => elem.oldal === pageSlug && elem.ugropont === horgony) ?? null
  )
}

/**
 * Olyan ugrópont, amelyre nem a kód, hanem CMS-ben mentett linkek mutatnak
 * (modul-térkép H48/3). Átnevezéskor a weboldal kódja nem romlik el, a linkek
 * viszont már nem ide visznek, ezért ezt is kimondjuk, de más címmel, mint a
 * kódhoz kötöttet.
 */
export interface CmsKotottUgropont {
  /** Az oldal webcíme, amelyen az ugrópont áll. */
  oldal: string
  /** Az ugrópont neve (`sectionSettings.anchorId`). */
  ugropont: string
  /** A teljes mondat: mi visz ide, és mit kell átírni átnevezéskor. */
  mondat: string
}

/**
 * A CMS-linkekkel kötött ugrópontok. Mérve (az élő /api/pages, 2026-09-22,
 * modul-térkép live-pages.json): a „Szakemberek kártyái” szekciókban négy
 * link visz ide, mindegyik „Nézd meg a szakmai hátterét” felirattal: a
 * Kapcsolat oldal két kártyájáról `/rolunk#szakmai-hatter`, a Rólunk oldal két
 * kártyájáról `#szakmai-hatter`. A kártyákat a restore-legacy-content.ts
 * építette így (:583 `SZAKMAI_HATTER_URL`, :1374 `hatterUrl`). A mezőnevek a
 * team-members.ts („Hivatkozás”) és a link-fields.ts („Hová vigyen
 * (webcím)”) címkéi (SC 3.2.4).
 */
export const CMS_KOTOTT_UGROPONTOK: readonly CmsKotottUgropont[] = [
  {
    oldal: 'rolunk',
    ugropont: 'szakmai-hatter',
    mondat:
      'Erre az ugrópontra („szakmai-hatter”) a szakemberek kártyáin álló „Nézd meg a szakmai hátterét” linkek visznek, a Rólunk és a Kapcsolat oldalon. Ha átnevezed vagy törlöd, a kártyák „Hivatkozás” részében a „Hová vigyen (webcím)” mezőt is írd át, különben ezek a linkek már nem ide visznek.',
  },
]

/** A CMS-linkekkel kötött ugrópont dobozának címe, ha más tartalom nincs a dobozban. */
export const CMS_KOTOTT_CIM = 'Erre az ugrópontra linkek mutatnak'

/** CMS-linkekkel kötött ugrópontnál a mondat (oldal + horgony illesztés), különben null. */
export function cmsKotottUgropont(data: unknown, pageSlug: unknown): string | null {
  const horgony = sectionAnchor(data)
  const elem = CMS_KOTOTT_UGROPONTOK.find(
    (kotott) => kotott.oldal === pageSlug && kotott.ugropont === horgony,
  )
  return elem ? elem.mondat : null
}

/* ------------------------------------------------------------------------ */
/* Oldalfüggő jelek: amit a lap TÉNYLEGESEN mutat                            */
/* ------------------------------------------------------------------------ */

/**
 * A „Képes lista vagy kártyák” (services) blokk lapon látszó elrendezése.
 *
 * A lap a mentett „Elrendezés” mezőt követi (H15, A4, 2026-09-23); a route
 * csak a mező NÉLKÜLI, régi adatot egészíti ki felismeréssel (modul-térkép
 * H03):
 * - a kezdőlapon a `presentHomeHelpServicesBlock` a `kezdolapiSinE` szerint
 *   rajzol sínt: mentett „sin”, vagy mező nélkül a háromajtós felismerés
 *   (home-help-states.ts; bekötve a HomeView-ban és a [slug]/page.tsx
 *   `presentHomeLayout` ágában);
 * - a Szolgáltatások oldalon a `presentSzolgaltatasokLayout` a
 *   `szolgaltatasokSinE` szerint: mentett „sin”, vagy mező nélkül az
 *   ajtó-felismerés; a mentett „tabla” érintetlen marad;
 * - máshol a mező dönt: a lap (Services.tsx `isRail`) a „sin” értéket
 *   rajzolja sínnek, minden mást, a hiányzót is, táblának (a services.ts
 *   alapértéke is „tabla”).
 * A két predikátum a home-help-states.ts-ből jön, nem másolat: ha a lap
 * szabálya változik, a címke vele változik (WCAG 2.2 SC 3.2.4).
 *
 * @returns 'sin' vagy 'tabla', nem services blokknál null
 */
export function servicesTenylegesElrendezes(
  data: unknown,
  pageSlug: unknown,
): 'sin' | 'tabla' | null {
  if (!isRecord(data) || data.blockType !== 'services') {
    return null
  }
  if (pageSlug === HOME_PAGE_SLUG) {
    return kezdolapiSinE(data) ? 'sin' : 'tabla'
  }
  if (pageSlug === SERVICES_PAGE_SLUG) {
    return szolgaltatasokSinE(data) ? 'sin' : 'tabla'
  }
  return data.elrendezes === 'sin' ? 'sin' : 'tabla'
}

/** Az elrendezés jele a sorcímkében, a típus után. */
export const ELRENDEZES_JEL: Readonly<Record<'sin' | 'tabla', string>> = {
  sin: '(sín)',
  tabla: '(tábla)',
}

/**
 * A sorcímke oldalfüggő jelei: a lapon látszó elrendezés („(sín)”,
 * „(tábla)”) és a kódhoz kötött ugrópont („#rendeloi (erre visz a menü)”).
 *
 * Miért a címkében: a kezdőlapon és a /rolunk-on két, a /szolgaltatasok-on
 * három Képes lista áll, és eddig csak a sorszám különböztette meg őket (H03).
 * A hasonló kinézetű elemek összetévesztése a leírás-hasonlóság okozta csúszás
 * (NN/g, Preventing User Errors: Avoiding Unconscious Slips: „Slips occur when
 * users intend to perform one action, but end up doing another (often
 * similar) action.”, https://www.nngroup.com/articles/slips/); a felismerést
 * a látható jel segíti (NN/g, Memory Recognition and Recall in User
 * Interfaces, https://www.nngroup.com/articles/recognition-and-recall/). A jel
 * a lapon TÉNYLEGESEN látszó állapotot mondja, nem a mezőét (WCAG 2.2 SC 3.2.4
 * Consistent Identification,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html),
 * és szövegként áll, nem színként (SC 1.4.1). A kötött ugrópont jele a
 * következményre már a sorfejlécben figyelmeztet (NN/g, Visibility of System
 * Status: „no action with consequences to users should be taken without
 * informing them”, https://www.nngroup.com/articles/visibility-system-status/).
 */
export function sectionPageMarks(
  data: unknown,
  pageSlug: unknown,
): { valtozat: string | null; jelek: string[] } {
  const elrendezes = servicesTenylegesElrendezes(data, pageSlug)
  const kotott = kotottElem(data, pageSlug)
  return {
    valtozat: elrendezes ? ELRENDEZES_JEL[elrendezes] : null,
    jelek: kotott ? [`#${kotott.ugropont} (${kotott.rovid})`] : [],
  }
}

/**
 * Az oldal megjelenítési átalakítása által adott cím, ha az eltér a mentett
 * Szekciócímtől, különben null.
 *
 * A 19 blokk renderelőjének és a route-ok átalakításainak átnézése szerint
 * (2026-09-23) egy oldalfüggő eset van: a kezdőlap sínként rajzolt
 * segítség-blokkja (`kezdolapiSinE`, ugyanaz a döntés, amellyel a
 * `presentHomeHelpServicesBlock` átalakít). Az üres Szekciócímnél az
 * „Így tudunk segíteni” címet adja, a régi zárt-kéz sínnél pedig mindig azt
 * (home-help-states.ts). A címet a lap SAJÁT feloldója adja, nem másolat.
 */
export function sectionPageTitle(data: unknown, pageSlug: unknown): string | null {
  if (
    pageSlug !== HOME_PAGE_SLUG ||
    !isRecord(data) ||
    data.blockType !== 'services' ||
    !kezdolapiSinE(data)
  ) {
    return null
  }
  // Az űrlapállapot a BlockServices alakját követi (minden mezője opcionális);
  // a feloldó csak olvas, és új objektumot ad vissza.
  const lapCim = nonEmptyText(
    presentHomeHelpServicesBlock({ ...data, blockType: 'services' }).title,
  )
  return lapCim !== null && lapCim !== nonEmptyText(data.title) ? lapCim : null
}

/**
 * A szekció-sor leírása az OLDAL ismeretében: a `describeSection`, a lapon
 * látszó címmel (`sectionPageTitle`, a „(beépített cím)” jellel, mint az
 * SOS-sávnál) és az oldalfüggő jelekkel (`sectionPageMarks`). Az admin
 * sorcímkéje ezt hívja; ha a frontend szalag is ezt hívja, a kettő betűre
 * ugyanazt mutatja (WCAG 2.2 SC 3.2.4).
 */
export function describeSectionOnPage(
  data: unknown,
  rowIndex: unknown,
  blockLabel: string,
  textFields: readonly string[],
  pageSlug: unknown,
): SectionDescription {
  const leiras = describeSection(data, rowIndex, blockLabel, textFields)
  const lapCim = sectionPageTitle(data, pageSlug)
  const jelek = sectionPageMarks(data, pageSlug)
  const cimmel: SectionDescription =
    lapCim === null
      ? leiras
      : {
          ...leiras,
          cim: truncateAtWord(lapCim),
          teljesCim: lapCim,
          cimSzoveg: `${truncateAtWord(lapCim)} ${BEEPITETT_CIM}`,
        }
  return { ...cimmel, valtozat: jelek.valtozat, jelek: jelek.jelek }
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
  /**
   * CMS-linkekkel kötött ugrópontnál a mondat (`cmsKotottUgropont`), különben
   * null. Opcionális, hogy a meglévő, kézzel épített modellek (tesztek,
   * frontend szalag) változatlanul érvényesek maradjanak; a
   * `sectionNoticeModel` mindig kitölti.
   */
  cmsKotott?: string | null
  /**
   * Rejtett sornál a látható iker: „A látható párja: 02 · <cím>”, a
   * szerkesztőben az iker szekcióját nyitó mélylinkkel; érvényes dokumentum-
   * és blokk-azonosító nélkül `href: null`, és a felirat link nélkül áll
   * (modul-térkép H02). Opcionális, mint a `cmsKotott`.
   */
  ikerLink?: { felirat: string; href: string | null } | null
}

/** Az ikerlink feliratának eleje; utána a sorszám és a cím áll. */
export const IKER_LINK_ELOTAG = 'A látható párja:'

/** A rejtett sor látható ikrének sorindexe: azonos típus és cím (a blokknév nem számít), vagy -1. */
function visibleTwinIndex(data: unknown, rowIndex: number, siblings: readonly unknown[]): number {
  if (!isSectionHidden(data)) {
    return -1
  }
  const blockType = isRecord(data) ? data.blockType : undefined
  const cim = sectionTitle(data)?.toLocaleLowerCase('hu')
  if (!cim) {
    return -1
  }
  return siblings.findIndex(
    (sibling, i) =>
      i !== rowIndex &&
      !isSectionHidden(sibling) &&
      isRecord(sibling) &&
      sibling.blockType === blockType &&
      sectionTitle(sibling)?.toLocaleLowerCase('hu') === cim,
  )
}

/** A rejtett sor látható ikre: azonos típus és cím (a blokknév nem számít). */
export function visibleTwin(
  data: unknown,
  rowIndex: number,
  siblings: readonly unknown[],
): string | null {
  const index = visibleTwinIndex(data, rowIndex, siblings)
  return index === -1 ? null : sectionNumber(index)
}

/**
 * A szerkesztő mélylinkje az iker szekciójára, vagy null. A `szekcioMelylink`
 * hibás dokumentum-azonosítóra programhibaként dob; itt az űrlapból jövő
 * értékkel hívjuk, ezért előbb ellenőrzünk, és a maradék hibát elnyeljük.
 */
function ikerMelylink(adminRoute: string, docId: unknown, blokkId: unknown): string | null {
  const id =
    typeof docId === 'number' && Number.isInteger(docId) && docId >= 0
      ? docId
      : typeof docId === 'string' && docId.trim().length > 0
        ? docId.trim()
        : null
  if (id === null || !ervenyesBlokkId(blokkId)) {
    return null
  }
  try {
    return szekcioMelylink({ adminRoute, collection: 'pages', id, blokkId })
  } catch {
    return null
  }
}

/**
 * A rejtett sor ikerlinkje (modul-térkép H02): a látható iker sorszáma és
 * címe, és a szerkesztőben az iker szekciójára nyíló mélylink
 * (`?szekcio=<blokk-azonosító>`, amelyet a SzekcioMegnyito nyit ki).
 */
export function ikerLink({
  data,
  rowIndex,
  siblings,
  adminRoute,
  docId,
}: {
  data: unknown
  rowIndex: number
  siblings: readonly unknown[]
  adminRoute: string
  docId?: number | string | null
}): { felirat: string; href: string | null } | null {
  const index = visibleTwinIndex(data, rowIndex, siblings)
  const iker = index === -1 ? undefined : siblings[index]
  const cim = sectionTitle(iker)
  if (!cim) {
    return null
  }
  return {
    felirat: `${IKER_LINK_ELOTAG} ${sectionNumber(index)}${ELVALASZTO}${truncateAtWord(cim)}`,
    href: ikerMelylink(adminRoute, docId, isRecord(iker) ? iker.id : undefined),
  }
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
 * @param docId      a szerkesztett oldal azonosítója (az ikerlink mélylinkjéhez)
 */
export function sectionNoticeModel({
  data,
  pageSlug,
  rowIndex,
  siblings,
  adminRoute,
  docId,
}: {
  data: unknown
  pageSlug: unknown
  rowIndex: number
  siblings: readonly unknown[]
  adminRoute: string
  docId?: number | string | null
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
    cmsKotott: cmsKotottUgropont(data, pageSlug),
    ikerLink: ikerLink({ data, rowIndex, siblings, adminRoute, docId }),
  }
}
