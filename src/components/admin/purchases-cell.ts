import type { CourseStudentStatus } from '../../lib/admin/course-progress-stats'
import type { UserCourseProgressEntry } from '../../lib/admin/user-progress-contract'
import { NO_LESSONS_LABEL } from '../../lib/curriculum/progress'
import { statusLabel } from './course-progress-view'

/**
 * A „Megvásárolt kurzusok" admin-megjelenítés TISZTA (mellékhatásmentes)
 * segédfüggvényei — a Felhasználók lista-oszlopához és a felhasználó lapján
 * lévő áttekintő panelhez.
 * Külön modulban él a kliens-komponensektől, hogy egységtesztelhető legyen (a
 * @payloadcms/ui-s komponensek node-környezetű tesztben nem tölthetők be — az
 * order-items-cell.ts mintája).
 */

/**
 * Üres/hiányzó hozzáférés-lista helyőrzője.
 * itt. Két baj volt vele. (1) A `docs/ui-sztenderdek.md` §3.1.1 szerint a
 * kvirtmínusz magyar szövegben nem írásjel. (2) A puszta jel a képernyőolvasóban
 * vagy néma, vagy „em dash"-ként hangzik el, tehát az információ elvész
 * (WCAG 2.2 SC 1.3.1). Ugyanezért váltotta ki a Kurzus-haladás panel is a
 * jelet szöveges `NO_DATA`-ra (src/components/admin/course-progress-view.ts).
 */
export const PURCHASES_EMPTY_PLACEHOLDER = 'Nincs kurzusa'

/** A kurzus-címkéhez szükséges minimális termék-alak. */
export interface PurchaseProductLike {
  id: number | string
  sku?: unknown
  displayTitle?: unknown
}

/**
 * Egy kurzus megjelenő neve: `displayTitle` → `sku` → `Kurzus #id`.
 * (A storefront `courseTitle` láncával azonos.)
 */
export function formatCourseLabel(product: PurchaseProductLike): string {
  const displayTitle = typeof product.displayTitle === 'string' ? product.displayTitle.trim() : ''
  if (displayTitle.length > 0) {
    return displayTitle
  }
  const sku = typeof product.sku === 'string' ? product.sku.trim() : ''
  return sku.length > 0 ? sku : `Kurzus #${product.id}`
}

/**
 * A hozzáférés-lista azonosítói.
 * A bemenet futásidőben többféle: a lista-nézet nyers azonosítókat ad
 * (`[11, 12]`), a szerkesztő-nézet feloldott dokumentumokat is adhat
 * (`[{ id: 11, … }]`), polimorf kapcsolatnál pedig `{ relationTo, value }`
 * alakot. Mindhármat elviseli, ismeretlen elemet némán kihagy — egy hibás
 * elem nem omlaszthatja el a listát.
 */
export function readPurchaseIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id: string): void => {
    if (id !== '' && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  for (const entry of value) {
    if (typeof entry === 'number' || typeof entry === 'string') {
      add(String(entry).trim())
      continue
    }
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const record = entry as Record<string, unknown>
    const candidate = 'value' in record ? record.value : record.id
    if (typeof candidate === 'number' || typeof candidate === 'string') {
      add(String(candidate).trim())
      continue
    }
    if (typeof candidate === 'object' && candidate !== null) {
      const nested = (candidate as Record<string, unknown>).id
      if (typeof nested === 'number' || typeof nested === 'string') {
        add(String(nested).trim())
      }
    }
  }
  return ids
}

/**
 * A termék-lekérdezés (`GET /api/products`) válaszából azonosító → cím térkép.
 * Hibás vagy hiányos elemet kihagy.
 */
export function readProductTitles(body: unknown): Map<string, string> {
  const titles = new Map<string, string>()
  if (typeof body !== 'object' || body === null) {
    return titles
  }
  const docs = (body as Record<string, unknown>).docs
  if (!Array.isArray(docs)) {
    return titles
  }
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) {
      continue
    }
    const record = doc as Record<string, unknown>
    const id = record.id
    if (typeof id !== 'number' && typeof id !== 'string') {
      continue
    }
    titles.set(String(id), formatCourseLabel({ id, sku: record.sku, displayTitle: record.displayTitle }))
  }
  return titles
}

/**
 * A megjelenítendő sorok CÍMEI (haladás nélkül).
 * - üres lista → egyetlen „—",
 * - ismert azonosító → a kurzus címe,
 * - még be nem töltött (vagy törölt) kurzus → `Kurzus #<id>`, hogy a sor
 * akkor is azonosítható maradjon, ha a cím nem érhető el.
 * A `formatPurchaseRows` cím-oszlopát adja vissza, tehát a két függvény nem
 */
export function formatPurchaseLabels(
  value: unknown,
  titles: ReadonlyMap<string, string>,
): string[] {
  return formatPurchaseRows(value, titles, null).map((row) => row.title)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * HALADÁS A KURZUS MELLETT (Felhasználók lista)
 *
 * A vezetői döntés (`docs/statisztika-audit-2026-08-21.md` §2): a MEGLÉVŐ
 * „Megvásárolt kurzusok" oszlop bővül, új oszlop NEM jön, és a haladás
 * KURZUSONKÉNTI sorban áll, nem átlagként. A sor alakja ott szó szerint:
 *
 *   Otthoni KézRehab Program · 45% · folyamatban
 *   SOS KézRelax · 0% · nem kezdte el
 *
 * Ehhez jött harmadikként a „nincs tananyag" sor (lásd `NO_LESSONS_LABEL`):
 * ott sem százalék, sem állapot-szó nem szerepel, mert egyik sem a vevőről
 * szólna.
 *
 * Miért nincs átlag: három kurzusnál a súlyozott átlag olyan számot mutatna,
 * ami egyetlen kurzusra sem igaz. A kérdés („hol tart?") kurzusonként
 * értelmes, tehát kurzusonként is válaszolunk rá.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A sor három adatát elválasztó jel: KÖZÉPPONT (U+00B7), szóközök között.
 *
 * NEM gondolatjel és NEM kvirtmínusz: a magyar mikroszöveg-szabályzat szerint
 * a kvirtmínusz (U+2014) magyar szövegben nem írásjel, töltelék-elválasztóként
 * pedig a gondolatjel is tilos (`docs/ui-sztenderdek.md` §3.1.1–3.1.3). A
 * középpont semleges listaelválasztó, a repó doksijai is ezt használják, és a
 * vezetői döntés mintasora is ezzel íródott.
 */
export const PROGRESS_SEPARATOR = '·'

/** Igaz, ha az érték a három ismert állapot egyike. */
export function isCourseStudentStatus(value: unknown): value is CourseStudentStatus {
  return value === 'nem-kezdte' || value === 'folyamatban' || value === 'befejezte'
}

/**
 * Azonosító olvasása ISMERETLEN értékből: pozitív egész, vagy `null`.
 *
 * A Postgres-adapter számot ad, de a Payload `rowData.id` típusa
 * `Record<string, any>`-ből jön (node_modules/payload/dist/admin/elements/
 * Cell.d.ts), és a REST-válaszok szöveges azonosítót is hordozhatnak — a
 * szám alakú szöveget ezért elfogadjuk. Ami nem pozitív egész, az `null`:
 * hibás azonosítóval nem indítunk kérést.
 */
export function readEntityId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

/**
 * A lista-sor felhasználó-azonosítója a Payload `rowData` propjából.
 *
 * MÉRVE (@payloadcms/ui 3.88.0, providers/TableColumns/buildColumnState/
 * renderCell.js): az egyedi Cell a `cellClientProps`-ot kapja, amelyben
 * `rowData: doc` — a sor TELJES dokumentuma. A prop mégis `unknown`-ként
 * érkezik ide, mert a Payload típusa `Record<string, any>`, az `any` pedig
 * tilos (CLAUDE.md, kódolási konvenciók). Hiányzó vagy hibás `rowData`
 * esetén `null`: a cella ilyenkor haladás nélkül, a mai alakjában jelenik
 * meg, és nem indít kérést.
 */
export function readRowUserId(rowData: unknown): number | null {
  if (typeof rowData !== 'object' || rowData === null) {
    return null
  }
  return readEntityId((rowData as Record<string, unknown>).id)
}

/**
 * Egy haladás-bejegyzés ELLENŐRZÖTT alakja, vagy `null`.
 * Ez az EGYETLEN hely, ahol a bejegyzés érvényessége eldől — a betöltő
 * (user-progress-client.ts) és a formázó is ezt hívja, tehát nem tud
 * kétféle „érvényes" fogalom kialakulni.
 * Hiányzó vagy ismeretlen `status`, nem szám `percent`, hibás `productId`:
 * a bejegyzés kiesik, a kurzus sora pedig a haladás előtti alakját hozza
 */
export function normalizeProgressEntry(value: unknown): UserCourseProgressEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const productId = readEntityId(record.productId)
  if (productId === null) {
    return null
  }
  const status = record.status
  if (!isCourseStudentStatus(status)) {
    return null
  }
  const rawPercent = record.percent
  if (typeof rawPercent !== 'number' || !Number.isFinite(rawPercent)) {
    return null
  }
  // A `lessonCount` KÖTELEZŐ a szerződésben, ezért a hiánya itt sem
  // „alapértelmezett 0", hanem érvénytelen bejegyzés: enélkül nem tudnánk
  // megkülönböztetni a „nincs tananyag" esetet a valódi 0%-tól, és pont az a
  // hamis mondat jönne vissza, ami miatt a mező született.
  const rawLessonCount = record.lessonCount
  if (
    typeof rawLessonCount !== 'number' ||
    !Number.isInteger(rawLessonCount) ||
    rawLessonCount < 0
  ) {
    return null
  }
  const percent = Math.round(Math.min(100, Math.max(0, rawPercent)))
  return { productId, percent, status, lessonCount: rawLessonCount }
}

/**
 * Egy felirat MONDATKÖZI alakja: a kezdőbetű kicsi, a többi változatlan.
 *
 * A bontás kódpontonként történik (`[...label]`), nem `charAt(0)`-lal: így
 * egy jövőbeli, BMP-n kívüli kezdőkarakter sem szakadna ketté.
 */
function inlineLabel(label: string): string {
  const [first = '', ...rest] = label
  return first.toLocaleLowerCase('hu-HU') + rest.join('')
}

/**
 * Az állapot MONDATKÖZI, kisbetűs alakja („folyamatban", „nem kezdte el").
 * A szótár NEM íródik újra: a felirat a Kurzus-haladás panel `statusLabel`
 * függvényéből jön, csak a kezdőbetűje lesz kicsi. Így a lista és a panel
 * ugyanazt a szót használja ugyanarra az állapotra (WCAG 2.2 SC 3.2.4,
 * Consistent Identification:
 * és egy jövőbeli átfogalmazás egyszerre viszi mindkét felületet.
 */
export function inlineStatusLabel(status: CourseStudentStatus): string {
  return inlineLabel(statusLabel(status))
}

/**
 * Az üres tananyag felirata MONDATKÖZI, kisbetűs alakban („nincs tananyag").
 * `processing`, ezért egy frissen feltöltött (vagy még feldolgozás alatt álló)
 * kurzusnál NULLA az elindítható leckék száma. A közös összesítő ilyenkor
 * — helyesen — 0%-ot és `nem-kezdte` állapotot ad, a sor viszont ebből azt
 * állította, hogy „0% · nem kezdte el". Ez HAMIS: nem a vevőn múlt, hanem
 * azon, hogy nincs mit elkezdeni; a munkatárs pedig e szerint keresné meg
 */
export const INLINE_NO_LESSONS_LABEL = inlineLabel(NO_LESSONS_LABEL)

/** Egy megjelenítendő sor a „Megvásárolt kurzusok" cellában. */
export interface PurchaseRow {
  /** A kurzus címe (`displayTitle` → `sku` → `Kurzus #id`). */
  title: string
  /**
   * Kerekített százalék, ha van értelmezhető haladás-adat ÉS van mit
   * százalékolni; egyébként `null` (a „nincs tananyag" sor is ilyen).
   */
  percent: number | null
  /** Az állapot, ha van értelmezhető haladás-adat; egyébként `null`. */
  status: CourseStudentStatus | null
  /** A sor teljes, megjelenítendő szövege — a komponens ezt írja ki. */
  text: string
}

/** Kurzus-azonosító → haladás, csak az ÉRVÉNYES bejegyzésekből. */
function indexProgress(
  progress: readonly UserCourseProgressEntry[] | null | undefined,
): Map<string, UserCourseProgressEntry> {
  const byProduct = new Map<string, UserCourseProgressEntry>()
  if (!Array.isArray(progress)) {
    return byProduct
  }
  for (const candidate of progress) {
    const entry = normalizeProgressEntry(candidate)
    if (entry !== null) {
      byProduct.set(String(entry.productId), entry)
    }
  }
  return byProduct
}

/**
 * A cella sorai, kurzusonként, a haladással kiegészítve.
 * A haladást minden sor a SAJÁT `productId`-je alapján keresi meg. Ha arra a
 * kurzusra nincs (még be nem töltött, a szerver nem ismeri, vagy értelmezhetetlen)
 * bejegyzés, a sor a haladás előtti viselkedést hozza: csak a cím. Ezért nincs
 * betöltés-jelző és helyfoglaló sem — a cella a betöltés alatt pontosan úgy néz
 * ki, mint eddig, majd a szöveg kiegészül. Ugrálás (layout shift) így nem
 */
export function formatPurchaseRows(
  value: unknown,
  titles: ReadonlyMap<string, string>,
  progress: readonly UserCourseProgressEntry[] | null | undefined,
): PurchaseRow[] {
  const ids = readPurchaseIds(value)
  if (ids.length === 0) {
    return [
      {
        title: PURCHASES_EMPTY_PLACEHOLDER,
        percent: null,
        status: null,
        text: PURCHASES_EMPTY_PLACEHOLDER,
      },
    ]
  }
  const byProduct = indexProgress(progress)
  return ids.map((id) => {
    const title = titles.get(id) ?? `Kurzus #${id}`
    const entry = byProduct.get(id)
    if (entry === undefined) {
      return { title, percent: null, status: null, text: title }
    }
    if (entry.lessonCount === 0) {
      // Nincs elindítható lecke: sem százalék, sem állapot-szó nem állítható a
      // vevőről (lásd INLINE_NO_LESSONS_LABEL).
      return {
        title,
        percent: null,
        status: null,
        text: `${title} ${PROGRESS_SEPARATOR} ${INLINE_NO_LESSONS_LABEL}`,
      }
    }
    const text = [
      title,
      `${String(entry.percent)}%`,
      inlineStatusLabel(entry.status),
    ].join(` ${PROGRESS_SEPARATOR} `)
    return { title, percent: entry.percent, status: entry.status, text }
  })
}
