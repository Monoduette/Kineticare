/**
 * systeme.io → Kineticare: CSV-beolvasás és sor-normalizálás (tiszta modul).
 *
 * Kezeli: UTF-8 BOM, idézőjeles mezők, CRLF/LF, konfigurálható elválasztó.
 * Oszlop-hozzárendelés név szerint; e-mailenként egy sor, uniózott kurzuslista.
 * Hibás sor → `issues`, nem áll meg. `format`: generic | systeme | auto.
 */

import { collapseWhitespace, normalizeKey, UTF8_BOM } from './normalize'
import { buildTagRuleSet, classifyTags, splitTagCell, type TagRuleSet } from './tags'

// A korábbi hívók (CLI, tesztek) ezeket a parse.ts-ből importálják — a
// re-export megtartja a meglévő importokat a közös modulra váltás után is.
export { collapseWhitespace, normalizeKey, UTF8_BOM }

/** Egy nyers CSV-rekord: a mezői és a rekord KEZDŐ fizikai sora (1-alapú). */
export interface CsvRecord {
  readonly fields: readonly string[]
  /**
   * A rekord első fizikai sorának száma a fájlban. Idézőjeles, sortörést
   * tartalmazó mezőnél a rekord több fizikai sorra nyúlik — a hibaüzenetben a
   * KEZDŐ sor a használható fogódzó.
   */
  readonly line: number
}

/** Egy kihagyott sor és a magyar indoklása — a záró mérleg hibalistája. */
export interface RowIssue {
  readonly line: number
  readonly reason: string
  readonly email?: string
}

/** Egy normalizált, importálható vásárlói sor. */
export interface CustomerRow {
  /** Kisbetűsített, trimmelt e-mail — ez a sor egyedi kulcsa. */
  readonly email: string
  /** Megjelenő név (a users.name kötelező mezője). Sosem üres. */
  readonly name: string
  /** A sorhoz tartozó kurzusnevek, eredeti írásmóddal, duplikátumok nélkül. */
  readonly courseNames: readonly string[]
  /** Mely fájlbeli sorokból állt össze (összefésülésnél több elem). */
  readonly lines: readonly number[]
  /**
   * A régi rendszerbeli regisztráció/vásárlás időpontja ISO-8601 alakban
   * (`Date Registered`). Több sor összefésülésénél a LEGKORÁBBI marad — ez az
   * az időpont, amikor a vevő vevővé vált.
   */
  readonly registeredAt?: string
  /** VISSZATÉRÍTÉS miatt kihagyott kurzusok (a sor mérlegéhez, hozzáférést nem ad). */
  readonly refundedCourseNames?: readonly string[]
  /** Ismert, de hozzáférést nem adó címkék (pl. előjelentkező). */
  readonly ignoredTags?: readonly string[]
  /** Egyik szabályba sem illő címkék — figyelmeztetés, hozzáférés nélkül. */
  readonly unknownTags?: readonly string[]
}

/** A felismert oszlopok indexe a fejlécben (`null` = nincs ilyen oszlop). */
export interface ResolvedColumns {
  readonly email: number
  readonly name: number | null
  readonly courses: number | null
  /** systeme.io: a `Last name` oszlop (a `name` ilyenkor a `First name`). */
  readonly lastName: number | null
  /** systeme.io: a `Date Registered` oszlop. */
  readonly registeredAt: number | null
}

/** A bemeneti alak. Az `auto` a fejlécből dönt (lásd a modul fejlécét). */
export type CsvFormat = 'auto' | 'generic' | 'systeme'

export interface ParseOptions {
  /** Mezőelválasztó. Alap: `,`. A `\t` / `tab` szöveg tabulátorra fordul. */
  readonly delimiter?: string
  /** Az e-mail-oszlop fejlécneve (felülírja az automatikus felismerést). */
  readonly emailColumn?: string
  /** A név-oszlop fejlécneve (systeme.io-nál a keresztnév-oszlopé). */
  readonly nameColumn?: string
  /** A kurzus-/címke-oszlop fejlécneve. */
  readonly coursesColumn?: string
  /** A vezetéknév-oszlop fejlécneve (systeme.io). */
  readonly lastNameColumn?: string
  /** A dátum-oszlop fejlécneve (systeme.io `Date Registered`). */
  readonly registeredColumn?: string
  /** A bemeneti alak kényszerítése. Alap: `auto`. */
  readonly format?: CsvFormat
  /**
   * A címke-szabálytábla (systeme.io-alak). Hiányában a beépített tábla
   * (`SYSTEME_TAG_RULES`) érvényes, CLI-kiegészítés nélkül.
   */
  readonly tagRules?: TagRuleSet
}

/** A címke-értelmezés összesítője — a próbafutás mérlegének forrása. */
export interface TagStats {
  /** Címke → hány vevőnek ADOTT hozzáférést. */
  readonly granted: ReadonlyMap<string, number>
  /** Címke → hány vevőnél maradt ki VISSZATÉRÍTÉS miatt. */
  readonly refunded: ReadonlyMap<string, number>
  /** Nem-vásárlás (érdeklődő) címke → hány vevőnél fordult elő. */
  readonly ignored: ReadonlyMap<string, number>
  /** Ismeretlen címke → hány vevőnél fordult elő. */
  readonly unknown: ReadonlyMap<string, number>
  /** Hány vevőnél nem volt EGYETLEN címke sem (üres cella). */
  readonly customersWithoutTags: number
  /** Hány vevő marad hozzáférés nélkül (üres, érdeklődő vagy csak visszatérített). */
  readonly customersWithoutAccess: number
  /** Hány vevőnél van kitöltött, értelmezhető dátum. */
  readonly customersWithDate: number
  /** Hány vevőnél volt kitöltött, de ÉRTELMEZHETETLEN dátum. */
  readonly unparsableDates: number
}

export interface ParsedCsv {
  readonly header: readonly string[]
  readonly columns: ResolvedColumns
  /** A ténylegesen alkalmazott bemeneti alak (az `auto` feloldása után). */
  readonly format: Exclude<CsvFormat, 'auto'>
  /** E-mailenként egy sor, e-mail szerint növekvő, determinisztikus sorrendben. */
  readonly rows: readonly CustomerRow[]
  readonly issues: readonly RowIssue[]
  /** Nem hibák, de a futás végén ki kell írni őket (pl. összefésült e-mailek). */
  readonly warnings: readonly string[]
  /** Csak a systeme.io-alaknál értelmezett címke-összesítő. */
  readonly tagStats?: TagStats
}

/** Automatikus fejléc-felismerés: e-mail-oszlop lehetséges nevei. */
const EMAIL_HEADERS: readonly string[] = [
  'email',
  'e-mail',
  'e-mail cím',
  'e-mail cim',
  'email cím',
  'email cim',
  'email address',
  'contact email',
  'customer email',
]

/** Automatikus fejléc-felismerés: név-oszlop lehetséges nevei. */
const NAME_HEADERS: readonly string[] = [
  'name',
  'full name',
  'nev',
  'név',
  'teljes nev',
  'teljes név',
  'customer name',
  'first name',
  'keresztnev',
  'keresztnév',
]

/** Automatikus fejléc-felismerés: kurzus-oszlop lehetséges nevei. */
const COURSES_HEADERS: readonly string[] = [
  'courses',
  'course',
  'kurzus',
  'kurzusok',
  'products',
  'product',
  'termek',
  'termék',
  'termekek',
  'termékek',
  'tags',
  'tag',
  'cimke',
  'címke',
  'cimkek',
  'címkék',
]

/** Automatikus fejléc-felismerés: vezetéknév-oszlop lehetséges nevei. */
const LAST_NAME_HEADERS: readonly string[] = [
  'last name',
  'surname',
  'family name',
  'vezeteknev',
  'vezetéknév',
]

/** Automatikus fejléc-felismerés: dátum-oszlop lehetséges nevei. */
const REGISTERED_HEADERS: readonly string[] = [
  'date registered',
  'registered',
  'registration date',
  'signup date',
  'created at',
  'regisztracio',
  'regisztráció',
  'regisztralt',
  'regisztrált',
  'regisztráció dátuma',
  'vasarlas datuma',
  'vásárlás dátuma',
  'datum',
  'dátum',
]

/**
 * A CÍMKE-oszlop fejlécnevei. Csak ezek mellett indul a systeme.io-értelmezés
 * `auto` módban: a `Courses`/`Termékek` oszlop továbbra is kurzusnév-lista.
 */
const TAG_HEADERS: readonly string[] = ['tag', 'tags', 'cimke', 'címke', 'cimkek', 'címkék']

/**
 * Cellán belül több kurzus elválasztói. A `;` azért is biztonságos, mert a
 * mező-szintű `;` elválasztót a tokenizer már feldolgozta: ide csak a cella
 * BELSEJE jut el.
 */
const COURSE_SPLIT = /[|;]/

/**
 * Szándékosan megengedő e-mail-ellenőrzés: a cél a nyilvánvalóan hibás cella
 * kiszűrése (üres, szóközös, `@` nélküli, pont nélküli domain), nem az RFC 5322
 * teljes újraimplementálása — a szigorúbb szabály valódi címeket zárna ki.
 */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/

/** A `--delimiter` értékének feloldása (a `\t` / `tab` szöveg tabulátort jelent). */
export function resolveDelimiter(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    return ','
  }
  const normalized = raw === '\\t' || raw.toLowerCase() === 'tab' ? '\t' : raw
  if ([...normalized].length !== 1) {
    throw new Error(
      `Az elválasztó pontosan egy karakter lehet (kapott: "${raw}"). Példa: --delimiter=";"`,
    )
  }
  if (normalized === '"' || normalized === '\r' || normalized === '\n') {
    throw new Error('Az elválasztó nem lehet idézőjel vagy sortörés.')
  }
  return normalized
}

/**
 * RFC 4180 szerinti tokenizer: mezőt csak a mező ELEJÉN álló idézőjel nyit,
 * belül a `""` egyetlen idézőjelre fordul, a mezőn belüli sortörés pedig a
 * mező része marad (`\n`-re normalizálva, hogy a sorvég-konvenció ne
 * szivárogjon be az adatba).
 */
export function parseCsvRecords(input: string, delimiter = ','): CsvRecord[] {
  const text = input.startsWith(UTF8_BOM) ? input.slice(UTF8_BOM.length) : input
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let index = 0
  let started = false

  const endField = (): void => {
    fields.push(field)
    field = ''
  }
  const endRecord = (): void => {
    endField()
    // A záró sortörés utáni „üres rekord" nem rekord — csak a fájl vége.
    if (fields.length > 1 || fields[0] !== '') {
      records.push({ fields, line: recordLine })
    }
    fields = []
    started = false
  }

  while (index < text.length) {
    const char = text[index]
    if (!started) {
      recordLine = line
      started = true
    }

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      if (char === '\r') {
        // Mezőn belüli sortörés — CRLF és CR is egységesen \n lesz.
        field += '\n'
        line += 1
        index += text[index + 1] === '\n' ? 2 : 1
        continue
      }
      if (char === '\n') {
        field += '\n'
        line += 1
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
      index += 1
      continue
    }
    if (char === delimiter) {
      endField()
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      endRecord()
      line += 1
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1
      continue
    }
    field += char
    index += 1
  }

  if (started || field !== '' || fields.length > 0) {
    endRecord()
  }
  return records
}

/** Egy cella kurzusnevekre bontása (`|` és `;`), trimmel és duplikátum-szűréssel. */
export function splitCourseNames(cell: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of cell.split(COURSE_SPLIT)) {
    const name = raw.trim()
    if (name === '') {
      continue
    }
    const key = normalizeKey(name)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    names.push(name)
  }
  return names
}

/** Az e-mail-cella normalizálása: trim + kisbetű (a users.email is így tárol). */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Alaki e-mail-ellenőrzés (lásd EMAIL_PATTERN indoklását). */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

function findColumn(
  header: readonly string[],
  explicit: string | undefined,
  candidates: readonly string[],
): number | null {
  const keys = header.map(normalizeKey)
  if (explicit !== undefined && explicit.trim() !== '') {
    const index = keys.indexOf(normalizeKey(explicit))
    return index === -1 ? null : index
  }
  for (const candidate of candidates) {
    const index = keys.indexOf(candidate)
    if (index !== -1) {
      return index
    }
  }
  return null
}

/** Névpótlék hiányzó név esetén: az e-mail `@` előtti része (a users.name kötelező). */
function fallbackName(email: string): string {
  const localPart = email.split('@')[0] ?? email
  return localPart.trim() === '' ? email : localPart
}

/** Szó-szintű tartalmazás: a `needle` MINDEN szava, egyben, a `haystack`-ben. */
function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `)
}

/** systeme.io két névoszlop → megjelenő név (üres/azonos/tartalmazás/összefűzés). */
export function composeCustomerName(first: string, last: string): string {
  const firstName = collapseWhitespace(first)
  const lastName = collapseWhitespace(last)
  if (firstName === '') {
    return lastName
  }
  if (lastName === '') {
    return firstName
  }
  const firstKey = normalizeKey(firstName)
  const lastKey = normalizeKey(lastName)
  if (firstKey === lastKey) {
    return firstName
  }
  if (containsWords(firstKey, lastKey)) {
    return firstName
  }
  if (containsWords(lastKey, firstKey)) {
    return lastName
  }
  return `${firstName} ${lastName}`
}

/**
 * A systeme.io dátum-cellája: `2024-05-12 09:30:11 (UTC+2)`.
 *
 * Visszatérés: ISO-8601 szöveg (`2024-05-12T09:30:11+02:00`), vagy `null`, ha
 * a cella üres vagy értelmezhetetlen. A rövidebb alakokat is elviseli:
 * `2024-05-12`, `2024-05-12 09:30`, `2024-05-12T09:30:11Z`, `…+02:00`.
 *
 * MIÉRT NEM `new Date(...)`: a nyers `Date`-értelmezés motorfüggő (a
 * `2024-05-12 09:30:11 (UTC+2)` alakot a V8 helyi időként, más motor
 * sehogy sem olvassa), és a hibás dátumot csendben `Invalid Date`-té teszi.
 * Az explicit minta a hibás cellát MEGMONDJA a hívónak.
 */
export function parseRegisteredAt(value: string): string | null {
  const text = collapseWhitespace(value)
  if (text === '') {
    return null
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\s*\(UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?\)|\s*(Z)|\s*([+-])(\d{2}):?(\d{2}))?$/i.exec(
      text,
    )
  if (!match) {
    return null
  }
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    utcSign,
    utcHour,
    utcMinute,
    zulu,
    offsetSign,
    offsetHour,
    offsetMinute,
  ] = match

  // Naptári ellenőrzés: a 2024-02-31 alakilag illeszkedne, de nem létező nap.
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? '0'),
    Number(minute ?? '0'),
    Number(second ?? '0'),
  )
  const check = new Date(asUtc)
  if (
    Number.isNaN(asUtc) ||
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day)
  ) {
    return null
  }
  if (Number(hour ?? '0') > 23 || Number(minute ?? '0') > 59 || Number(second ?? '0') > 59) {
    return null
  }

  // Dátum-only cella: nincs mit időzónásítani, a nap marad a nap.
  if (hour === undefined) {
    return `${year}-${month}-${day}`
  }

  const time = `${hour}:${minute}:${second ?? '00'}`
  if (zulu !== undefined) {
    return `${year}-${month}-${day}T${time}Z`
  }
  if (utcSign !== undefined && utcHour !== undefined) {
    const offset = `${utcSign}${utcHour.padStart(2, '0')}:${(utcMinute ?? '00').padStart(2, '0')}`
    return `${year}-${month}-${day}T${time}${offset === '+00:00' ? 'Z' : offset}`
  }
  if (offsetSign !== undefined && offsetHour !== undefined && offsetMinute !== undefined) {
    const offset = `${offsetSign}${offsetHour}:${offsetMinute}`
    return `${year}-${month}-${day}T${time}${offset === '+00:00' ? 'Z' : offset}`
  }
  // Időzóna-jelölés nélküli időpont: a systeme.io UTC-ben exportál, a jelölés
  // hiánya nem tehet egy időpontot időzóna-függővé — ezért Z.
  return `${year}-${month}-${day}T${time}Z`
}

interface MutableRow {
  email: string
  name: string
  courseNames: string[]
  courseKeys: Set<string>
  lines: number[]
  registeredAt?: string
  refundedCourseNames: string[]
  ignoredTags: string[]
  unknownTags: string[]
  /** Volt-e a sorban EGYÁLTALÁN címke (a mérleg „címke nélküli vevő" száma). */
  hasTags: boolean
}

/** A korábbi (legkisebb) ISO-időpont — a vevővé válás pillanata. */
function earlierIso(current: string | undefined, next: string | undefined): string | undefined {
  if (current === undefined) {
    return next
  }
  if (next === undefined) {
    return current
  }
  const currentMs = Date.parse(current)
  const nextMs = Date.parse(next)
  if (Number.isNaN(currentMs)) {
    return next
  }
  if (Number.isNaN(nextMs)) {
    return current
  }
  return nextMs < currentMs ? next : current
}

/** Előfordulás-számláló a címke-összesítőhöz. */
function countTags(target: Map<string, number>, tags: readonly string[]): void {
  for (const tag of tags) {
    target.set(tag, (target.get(tag) ?? 0) + 1)
  }
}

/**
 * A teljes CSV feldolgozása normalizált vásárlói sorokká.
 *
 * DOBÁS csak akkor, ha a fájl szerkezete miatt egyetlen sor sem értelmezhető
 * (nincs meg az e-mail-oszlop) — minden más hiba SOR-szintű, és a feldolgozás
 * megy tovább.
 */
export function parseCustomerCsv(input: string, options: ParseOptions = {}): ParsedCsv {
  const delimiter = resolveDelimiter(options.delimiter)
  const records = parseCsvRecords(input, delimiter)

  if (records.length === 0) {
    return {
      header: [],
      columns: { email: -1, name: null, courses: null, lastName: null, registeredAt: null },
      format: 'generic',
      rows: [],
      issues: [],
      warnings: ['A fájl üres — nincs benne fejlécsor sem.'],
    }
  }

  const header = records[0].fields.map((cell) => cell.trim())
  const emailIndex = findColumn(header, options.emailColumn, EMAIL_HEADERS)
  if (emailIndex === null) {
    throw new Error(
      options.emailColumn !== undefined
        ? `Nincs "${options.emailColumn}" nevű oszlop a fájlban. A fejléc: ${header.join(', ')}`
        : `Nem található e-mail-oszlop a fájlban. A fejléc: ${header.join(', ')}. ` +
          'Add meg kézzel: --email-col="<oszlopnév>"',
    )
  }
  const nameIndex = findColumn(header, options.nameColumn, NAME_HEADERS)
  const coursesIndex = findColumn(header, options.coursesColumn, COURSES_HEADERS)
  const lastNameIndex = findColumn(header, options.lastNameColumn, LAST_NAME_HEADERS)
  const registeredIndex = findColumn(header, options.registeredColumn, REGISTERED_HEADERS)

  // A címke-oszlop felismerése: `auto` módban csak a TÉNYLEGES címke-fejléc
  // (Tag/Címke) mellett indul systeme.io-értelmezés, a `Courses` oszlop
  // továbbra is kurzusnév-lista marad.
  const coursesHeaderKey = coursesIndex === null ? '' : normalizeKey(header[coursesIndex] ?? '')
  const looksLikeSysteme = lastNameIndex !== null && TAG_HEADERS.includes(coursesHeaderKey)
  const format: Exclude<CsvFormat, 'auto'> =
    options.format === 'systeme'
      ? 'systeme'
      : options.format === 'generic'
        ? 'generic'
        : looksLikeSysteme
          ? 'systeme'
          : 'generic'
  const tagRules: TagRuleSet = options.tagRules ?? buildTagRuleSet().ruleSet

  const warnings: string[] = []
  if (options.nameColumn !== undefined && nameIndex === null) {
    warnings.push(
      `Nincs "${options.nameColumn}" nevű oszlop — a név az e-mail-cím @ előtti részéből képződik.`,
    )
  }
  if (options.coursesColumn !== undefined && coursesIndex === null) {
    warnings.push(
      `Nincs "${options.coursesColumn}" nevű oszlop — a fájlból nem olvasható ki kurzus.`,
    )
  } else if (coursesIndex === null) {
    warnings.push(
      'Nem található kurzus-oszlop — csak felhasználók jönnének létre, kurzus-hozzáférés nélkül. ' +
        'Add meg kézzel: --courses-col="<oszlopnév>"',
    )
  }
  if (format === 'systeme') {
    warnings.push(
      'systeme.io-alak: a címke-oszlop értelmezése szabálytáblából történik ' +
        '(vásárlás / visszatérítés / érdeklődő). A visszatérített kurzushoz NEM jár hozzáférés.',
    )
    if (options.format === 'systeme' && !TAG_HEADERS.includes(coursesHeaderKey)) {
      warnings.push(
        'A kényszerített systeme.io-alakhoz nem található „Tag" oszlop — ' +
          'add meg kézzel: --courses-col="<oszlopnév>"',
      )
    }
    if (registeredIndex === null) {
      warnings.push(
        'Nincs dátum-oszlop (Date Registered) — a régi vásárlás időpontja nem őrizhető meg.',
      )
    }
  }

  const issues: RowIssue[] = []
  const byEmail = new Map<string, MutableRow>()
  const mergedEmails: string[] = []
  let missingNameCount = 0
  let unparsableDates = 0

  for (const record of records.slice(1)) {
    const { fields, line } = record
    if (fields.every((cell) => cell.trim() === '')) {
      continue
    }
    // A fejléctől eltérő mezőszám ELCSÚSZOTT sort jelent: ilyenkor a kurzus-cella
    // már nem oda tartozik, ahova a fejléc mutat — a vevő rossz (vagy semmilyen)
    // hozzáférést kapna. Ezért a sor kimarad, és a hibalistába kerül.
    if (fields.length !== header.length) {
      issues.push({
        line,
        reason: `Hiányzó vagy többlet oszlop: a sorban ${fields.length} mező van a fejléc ${header.length} oszlopa helyett.`,
      })
      continue
    }

    const rawEmail = fields[emailIndex] ?? ''
    const email = normalizeEmail(rawEmail)
    if (email === '') {
      issues.push({ line, reason: 'Üres e-mail-cím — a sor nem importálható.' })
      continue
    }
    if (!isValidEmail(email)) {
      issues.push({ line, reason: `Hibás e-mail-formátum: "${rawEmail.trim()}".`, email })
      continue
    }

    // NÉV: generic alakban egyetlen oszlop, systeme.io-nál a két név-oszlop
    // összeállítása (composeCustomerName — egyetlen névtöredék sem veszhet el).
    const firstNameCell = nameIndex === null ? '' : (fields[nameIndex] ?? '')
    const lastNameCell =
      format === 'systeme' && lastNameIndex !== null ? (fields[lastNameIndex] ?? '') : ''
    const rawName =
      format === 'systeme'
        ? composeCustomerName(firstNameCell, lastNameCell)
        : firstNameCell.trim()
    if (rawName === '') {
      missingNameCount += 1
    }
    const name = rawName === '' ? fallbackName(email) : rawName

    // KURZUS/CÍMKE: generic alakban kurzusnév-lista, systeme.io-nál címkék,
    // amikből a szabálytábla dönti el, mi ad hozzáférést.
    const cell = coursesIndex === null ? '' : (fields[coursesIndex] ?? '')
    const tags = format === 'systeme' ? splitTagCell(cell) : []
    const classification = format === 'systeme' ? classifyTags(tags, tagRules) : null
    const courseNames =
      classification !== null ? [...classification.courseNames] : splitCourseNames(cell)

    // DÁTUM: a régi rendszerbeli vevővé válás időpontja.
    const rawDate = registeredIndex === null ? '' : (fields[registeredIndex] ?? '')
    const registeredAt = parseRegisteredAt(rawDate) ?? undefined
    if (registeredAt === undefined && rawDate.trim() !== '') {
      unparsableDates += 1
      issues.push({
        line,
        email,
        reason: `Értelmezhetetlen dátum: "${rawDate.trim()}" — a sor importálható, de a régi vásárlás időpontja nélkül.`,
      })
    }

    const existing = byEmail.get(email)
    if (existing === undefined) {
      byEmail.set(email, {
        email,
        name,
        courseNames: [...courseNames],
        courseKeys: new Set(courseNames.map(normalizeKey)),
        lines: [line],
        registeredAt,
        refundedCourseNames: [...(classification?.refundedCourseNames ?? [])],
        ignoredTags: [...(classification?.ignoredTags ?? [])],
        unknownTags: [
          ...(classification?.unknownTags ?? []),
          ...(classification?.unmatchedRefundTags ?? []),
        ],
        hasTags: format === 'systeme' ? tags.length > 0 : courseNames.length > 0,
      })
      continue
    }

    // Ugyanaz az e-mail többször: uniózzuk a kurzusokat, a nevet az első
    // KITÖLTÖTT érték adja (a pótolt névnél a valódi név erősebb).
    if (rawName !== '' && existing.name === fallbackName(email)) {
      existing.name = rawName
    }
    for (const courseName of courseNames) {
      const key = normalizeKey(courseName)
      if (!existing.courseKeys.has(key)) {
        existing.courseKeys.add(key)
        existing.courseNames.push(courseName)
      }
    }
    // A vevővé válás pillanata a LEGKORÁBBI dátum a sorai közül.
    existing.registeredAt = earlierIso(existing.registeredAt, registeredAt)
    existing.refundedCourseNames.push(...(classification?.refundedCourseNames ?? []))
    existing.ignoredTags.push(...(classification?.ignoredTags ?? []))
    existing.unknownTags.push(
      ...(classification?.unknownTags ?? []),
      ...(classification?.unmatchedRefundTags ?? []),
    )
    existing.hasTags = existing.hasTags || (format === 'systeme' ? tags.length > 0 : courseNames.length > 0)
    existing.lines.push(line)
    if (existing.lines.length === 2) {
      mergedEmails.push(email)
    }
  }

  if (missingNameCount > 0) {
    warnings.push(
      `${missingNameCount} sorban hiányzott a név — az e-mail-cím @ előtti részét használjuk.`,
    )
  }
  if (mergedEmails.length > 0) {
    const shown = mergedEmails.slice(0, 10).join(', ')
    warnings.push(
      `${mergedEmails.length} e-mail többször szerepel a fájlban — a kurzusaikat összefésültük: ` +
        `${shown}${mergedEmails.length > 10 ? ' …' : ''}`,
    )
  }

  const rows: CustomerRow[] = [...byEmail.values()]
    .map((row) => ({
      email: row.email,
      name: row.name,
      courseNames: row.courseNames,
      lines: row.lines,
      ...(row.registeredAt !== undefined ? { registeredAt: row.registeredAt } : {}),
      ...(row.refundedCourseNames.length > 0
        ? { refundedCourseNames: uniqueByKey(row.refundedCourseNames) }
        : {}),
      ...(row.ignoredTags.length > 0 ? { ignoredTags: uniqueByKey(row.ignoredTags) } : {}),
      ...(row.unknownTags.length > 0 ? { unknownTags: uniqueByKey(row.unknownTags) } : {}),
    }))
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))

  const tagStats = format === 'systeme' ? buildTagStats([...byEmail.values()], unparsableDates) : undefined
  if (tagStats !== undefined && tagStats.unknown.size > 0) {
    const shown = [...tagStats.unknown.entries()]
      .map(([tag, count]) => `"${tag}" (${count} vevő)`)
      .join(', ')
    warnings.push(
      `ISMERETLEN CÍMKE — hozzáférést NEM adtunk érte: ${shown}. ` +
        'Ha ez mégis vásárlás, vedd fel a szabálytáblába (src/lib/customer-import/tags.ts) ' +
        'vagy jelöld nem-vásárlásnak: --ignore-tag "<címke>".',
    )
  }

  return {
    header,
    columns: {
      email: emailIndex,
      name: nameIndex,
      courses: coursesIndex,
      lastName: format === 'systeme' ? lastNameIndex : null,
      registeredAt: registeredIndex,
    },
    format,
    rows,
    issues,
    warnings,
    ...(tagStats !== undefined ? { tagStats } : {}),
  }
}

/** Duplikátum-szűrés az eredeti írásmód megtartásával. */
function uniqueByKey(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = normalizeKey(value)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(value)
  }
  return result
}

/** A címke-összesítő felépítése a VEVŐNKÉNTI (összefésült) sorokból. */
function buildTagStats(rows: readonly MutableRow[], unparsableDates: number): TagStats {
  const granted = new Map<string, number>()
  const refunded = new Map<string, number>()
  const ignored = new Map<string, number>()
  const unknown = new Map<string, number>()
  let customersWithoutTags = 0
  let customersWithoutAccess = 0
  let customersWithDate = 0

  for (const row of rows) {
    countTags(granted, uniqueByKey(row.courseNames))
    countTags(refunded, uniqueByKey(row.refundedCourseNames))
    countTags(ignored, uniqueByKey(row.ignoredTags))
    countTags(unknown, uniqueByKey(row.unknownTags))
    if (!row.hasTags) {
      customersWithoutTags += 1
    }
    if (row.courseNames.length === 0) {
      customersWithoutAccess += 1
    }
    if (row.registeredAt !== undefined) {
      customersWithDate += 1
    }
  }

  return {
    granted,
    refunded,
    ignored,
    unknown,
    customersWithoutTags,
    customersWithoutAccess,
    customersWithDate,
    unparsableDates,
  }
}
