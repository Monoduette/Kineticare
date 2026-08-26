/**
 * systeme.io → Kineticare tömeges CSV-import (C8).
 *
 * `--map` párokkal kurzusneveket termékekre képezi; hiányzó userek + purchases.
 * Nem hoz rendelést/számlát; meglévő vásárlást nem módosít. `--send-invites` külön.
 * Idempotens — megszakadt futás újraindítható. Logika: `src/lib/customer-import/`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getPayload } from 'payload'

import { executeImportPlan, type ExecutionOutcome } from '../lib/customer-import/execute'
import {
  generateInviteLinks,
  renderInviteCsv,
  resolveServerUrl,
  type InviteLink,
} from '../lib/customer-import/invite'
import { parseCustomerCsv, type ParsedCsv, type RowIssue } from '../lib/customer-import/parse'
import { buildImportPlan, parseCourseMap, type ImportPlan } from '../lib/customer-import/plan'
import {
  checkSendInvitesPreconditions,
  sendInviteEmails,
  type InviteSendOutcome,
} from '../lib/customer-import/send-invites'
import { buildTagRuleSet, SYSTEME_TAG_RULES } from '../lib/customer-import/tags'
import { createLogger } from '../lib/logger'
import config from '../payload.config'

const log = createLogger({ script: 'import-customers' })

const write = (text: string): void => {
  process.stdout.write(`${text}\n`)
}
const writeError = (text: string): void => {
  process.stderr.write(`${text}\n`)
}

/** A `--send-invites` hatóköre: csak az új fiókok, vagy minden tervbeli vevő. */
type SendInvitesMode = 'created' | 'all'

interface CliArgs {
  file: string
  map: string[]
  dryRun: boolean
  /** CSAK a fájl ellenőrzése: adatbázis-kapcsolat nélkül, terv nélkül. */
  parseOnly: boolean
  outLinks?: string
  inviteAll: boolean
  sendInvites?: SendInvitesMode
  delimiter?: string
  emailCol?: string
  nameCol?: string
  coursesCol?: string
  lastNameCol?: string
  registeredCol?: string
  format?: 'auto' | 'generic' | 'systeme'
  /** További, hozzáférést NEM adó címkék. */
  ignoreTags: string[]
  /** További visszatérítés-párok: „Visszatérítés-címke=Vásárlás-címke". */
  refundTags: string[]
}

/**
 * A CSV-t hordozó KÖRNYEZETI VÁLTOZÓ neve (base64-kódolt fájltartalom).
 *
 * MIÉRT: a vásárlói lista SZEMÉLYES ADAT — a repóba nem kerülhet be, a Railway
 * jobnak viszont valahogy meg kell kapnia. A base64-kódolt tartalom változóként
 * adható át, a futás után pedig TÖRLENDŐ (Railway → Variables → a változó
 * törlése), különben a személyes adat ott marad a szolgáltatás konfigjában.
 */
const CSV_BASE64_ENV = 'IMPORT_CUSTOMERS_CSV_BASE64'

const USAGE = [
  'Vásárló-import (systeme.io → Kineticare)',
  '',
  'Használat:',
  '  npx tsx src/scripts/import-customers.ts --file=export.csv --map "Kurzus A=SKU-A" [opciók]',
  '',
  'Bemenet (a kettő közül az egyik kötelező):',
  '  --file=<út>            A beolvasandó CSV-fájl.',
  `  ${CSV_BASE64_ENV}   Környezeti változó a base64-kódolt CSV-vel (fájl helyett).`,
  '                         A személyes adatot tartalmazó lista így nem kerül fájlba;',
  '                         a változót a futás UTÁN törölni kell.',
  '',
  'Leképezés (ismételhető):',
  '  --map "Kurzusnév=SKU"  Egy systeme.io-kurzusnév/címke → Kineticare-termék (sku).',
  '                         Minden kurzushoz kell egy pár; ami kimarad, az nem',
  '                         tűnik el csendben, hanem a mérlegben listázódik.',
  '',
  'Opciók:',
  '  --dry-run              PRÓBAFUTÁS: nulla írás, csak a teljes terv kiírása.',
  '  --parse-only           CSAK a fájl ellenőrzése — adatbázis-kapcsolat nélkül.',
  '  --out-links=<út>       Aktiválási linkek CSV-be (éles futás után).',
  '  --invite-all           Link ne csak az új, hanem minden érintett vevőnek.',
  '  --send-invites         Aktiváló LEVÉL kiküldése az új fiókoknak (Resend).',
  '  --send-invites=all     Levél minden tervbeli vevőnek (a kihagyottaknak is).',
  '  --delimiter=<jel>      Mezőelválasztó (alap: ","; magyar Excel: ";").',
  '  --email-col=<név>      Az e-mail-oszlop fejlécneve.',
  '  --name-col=<név>       A név-oszlop fejlécneve (systeme.io: „First name").',
  '  --last-name-col=<név>  A vezetéknév-oszlop fejlécneve (systeme.io: „Last name").',
  '  --courses-col=<név>    A kurzus-/címke-oszlop fejlécneve (systeme.io: „Tag").',
  '  --registered-col=<név> A dátum-oszlop fejlécneve (systeme.io: „Date Registered").',
  '  --format=<alak>        auto (alap) | generic | systeme — a bemeneti alak.',
  '  --ignore-tag "<címke>" További, hozzáférést NEM adó címke (ismételhető).',
  '  --refund-tag "V=K"     Visszatérítés-címke (V) → az általa kiütött vásárlás-címke (K).',
  '  --help                 Ez a súgó.',
  '',
  'SYSTEME.IO-CÍMKÉK: a `Tag` oszlop vesszős címkelistáját szabálytábla értelmezi',
  '(src/lib/customer-import/tags.ts). Vásárlás-címke hozzáférést ad, a',
  'visszatérítés-címke a saját párját KIÜTI (a sor másik kurzusa jár), az',
  'érdeklődő-címke nem ad hozzáférést, az ISMERETLEN címke pedig figyelmeztetést',
  'kap — a sor feldolgozása hozzáférés nélkül folytatódik.',
  '',
  'ELŐBB MINDIG --dry-run. A próbafutás ugyanazt a tervet mutatja, amit az éles',
  'futás végrehajtana, és egyetlen sort sem ír az adatbázisba.',
  '',
  'LEVÉLKÜLDÉS: a --send-invites az ÉLES import UTÁN küld magyar aktiváló levelet.',
  'A --dry-run kapcsolóval EGYÜTT nem használható, és beállított e-mail-szolgáltató',
  '(RESEND_API_KEY) nélkül el sem indul. A sorrend: --dry-run → éles → --send-invites.',
  '',
  'ÚJRAFUTTATHATÓ: a művelet idempotens (meglévő jelszót, szerepkört és vásárlást',
  'sosem módosít, csak hiányzó hozzáférést fűz hozzá), ezért egy megszakadt futás',
  'biztonságosan újraindítható — a második kör a kész sorokat kihagyja.',
  '',
  'Kilépési kód: 0 = hibátlan futás, 1 = indítási hiba vagy hibás sor a futásban.',
].join('\n')

/**
 * Az argumentum-feldolgozás eredménye: futtatható argumentumok, súgó-kérés
 * (0-s kilépés) vagy hiba (1-es kilépés).
 */
type ArgsResult =
  | { readonly kind: 'args'; readonly args: CliArgs }
  | { readonly kind: 'help' }
  | { readonly kind: 'error' }

/** Argumentum-feldolgozás: `--kulcs=érték`, `--kulcs érték` és kapcsoló-alak is. */
function parseArgs(argv: readonly string[]): ArgsResult {
  const args: CliArgs = {
    file: '',
    map: [],
    dryRun: false,
    parseOnly: false,
    inviteAll: false,
    ignoreTags: [],
    refundTags: [],
  }
  const valueKeys = new Set([
    'file',
    'map',
    'out-links',
    'delimiter',
    'email-col',
    'name-col',
    'courses-col',
    'last-name-col',
    'registered-col',
    'format',
    'ignore-tag',
    'refund-tag',
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--help' || raw === '-h') {
      write(USAGE)
      return { kind: 'help' }
    }
    if (raw === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (raw === '--parse-only') {
      args.parseOnly = true
      continue
    }
    if (raw === '--invite-all') {
      args.inviteAll = true
      continue
    }
    // A --send-invites az EGYETLEN kapcsoló, aminek OPCIONÁLIS értéke van
    // (`--send-invites` vagy `--send-invites=all`), ezért az általános
    // „--kulcs érték" ág ELŐTT kell lekezelni: különben a puszta kapcsoló
    // felfalná a következő argumentumot értékként.
    if (raw === '--send-invites') {
      args.sendInvites = 'created'
      continue
    }
    if (raw.startsWith('--send-invites=')) {
      const value = raw.slice('--send-invites='.length)
      if (value !== 'all') {
        writeError(
          `Hiba: a "--send-invites" egyetlen értéke az "all" lehet (kapott: "${value}"). ` +
            'Érték nélkül csak az új fiókok kapnak levelet.',
        )
        return { kind: 'error' }
      }
      args.sendInvites = 'all'
      continue
    }

    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw)
    if (!match) {
      writeError(`Hiba: érvénytelen argumentum: "${raw}" (a forma: --kulcs=érték).`)
      return { kind: 'error' }
    }
    const [, key, inlineValue] = match
    if (!valueKeys.has(key)) {
      writeError(`Hiba: ismeretlen argumentum: "--${key}".`)
      return { kind: 'error' }
    }
    let value = inlineValue
    if (value === undefined) {
      // Szóközzel elválasztott alak: --map "Kurzus A=SKU-A"
      value = argv[index + 1]
      index += 1
    }
    if (value === undefined || value.trim() === '') {
      writeError(`Hiba: a "--${key}" argumentum értéke nem lehet üres.`)
      return { kind: 'error' }
    }

    switch (key) {
      case 'file':
        args.file = value
        break
      case 'map':
        args.map.push(value)
        break
      case 'out-links':
        args.outLinks = value
        break
      case 'delimiter':
        args.delimiter = value
        break
      case 'email-col':
        args.emailCol = value
        break
      case 'name-col':
        args.nameCol = value
        break
      case 'courses-col':
        args.coursesCol = value
        break
      case 'last-name-col':
        args.lastNameCol = value
        break
      case 'registered-col':
        args.registeredCol = value
        break
      case 'format':
        if (value !== 'auto' && value !== 'generic' && value !== 'systeme') {
          writeError(
            `Hiba: a "--format" értéke csak auto, generic vagy systeme lehet (kapott: "${value}").`,
          )
          return { kind: 'error' }
        }
        args.format = value
        break
      case 'ignore-tag':
        args.ignoreTags.push(value)
        break
      case 'refund-tag':
        args.refundTags.push(value)
        break
      default:
        writeError(`Hiba: ismeretlen argumentum: "--${key}".`)
        return { kind: 'error' }
    }
  }

  if (args.file === '' && !hasCsvFromEnv()) {
    writeError(
      `Hiba: a --file argumentum kötelező (vagy add át a CSV-t az ${CSV_BASE64_ENV} ` +
        'környezeti változóban, base64-kódolva). Súgó: --help',
    )
    return { kind: 'error' }
  }
  if (args.file !== '' && hasCsvFromEnv()) {
    writeError(
      `Hiba: a --file és az ${CSV_BASE64_ENV} környezeti változó EGYSZERRE van megadva. ` +
        'Pontosan az egyiket add meg, hogy egyértelmű legyen, melyik listát importálod.',
    )
    return { kind: 'error' }
  }
  if (args.parseOnly && args.sendInvites !== undefined) {
    writeError(
      'Hiba: a --parse-only és a --send-invites nem használható együtt (a fájl-ellenőrzés ' +
        'adatbázis és levélküldés nélkül fut).',
    )
    return { kind: 'error' }
  }
  // A levélküldés feltételeit MÉG a fájl beolvasása és bármilyen DB-kapcsolat
  // előtt ellenőrizzük: ha a mód nem indítható, semmi ne történjen addig sem.
  if (args.sendInvites !== undefined) {
    const problem = checkSendInvitesPreconditions({ dryRun: args.dryRun })
    if (problem !== null) {
      writeError(`Hiba: ${problem}`)
      return { kind: 'error' }
    }
  }
  return { kind: 'args', args }
}

/** Egyszerű, fix szélességű táblázat — a próbafutás terve emberi szemnek. */
function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length), 0),
  )
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  ').trimEnd()
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)].join(
    '\n',
  )
}

const ACTION_LABEL: Record<string, string> = {
  'create-user': 'ÚJ FIÓK',
  'append-purchases': 'BŐVÍTÉS',
  'skip-complete': 'KIHAGY',
  failed: 'HIBA',
}

function printPlan(plan: ImportPlan): void {
  if (plan.entries.length === 0) {
    write('A terv üres — nincs feldolgozható sor.')
    return
  }
  const rows = plan.entries.map((entry) => [
    ACTION_LABEL[entry.action] ?? entry.action,
    entry.email,
    entry.missingProducts.map((product) => product.sku).join(', ') || '—',
    entry.unknownCourseNames.join(', ') || '—',
  ])
  write(renderTable(['MŰVELET', 'E-MAIL', 'HOZZÁADANDÓ (SKU)', 'NEM LEKÉPEZETT KURZUS'], rows))
}

function printIssues(title: string, issues: readonly RowIssue[]): void {
  if (issues.length === 0) {
    return
  }
  write('')
  write(`${title} (${issues.length}):`)
  for (const issue of issues) {
    const where = issue.line > 0 ? `${issue.line}. sor` : (issue.email ?? 'ismeretlen sor')
    write(`  - ${where}: ${issue.reason}${issue.email && issue.line > 0 ? ` (${issue.email})` : ''}`)
  }
}

/**
 * A CÍMKE-MÉRLEG kiírása (systeme.io-alak).
 *
 * A megrendelő kérdésére válaszol: hány vevő kap melyik kurzust, hány maradt ki
 * visszatérítés miatt, hány az érdeklődő, és van-e ismeretlen címke. A számok
 * VEVŐNKÉNT (összefésült e-mail-cím szerint) értendők, nem fájlsoronként.
 */
function printTagSummary(parsed: ParsedCsv): void {
  const stats = parsed.tagStats
  if (stats === undefined) {
    return
  }
  write('')
  write(`CÍMKE-MÉRLEG (${parsed.rows.length} vevő a fájlban):`)
  const line = (label: string, value: number): void => {
    write(`  ${label}: ${value}`)
  }
  for (const [tag, count] of stats.granted) {
    line(`hozzáférést kap — "${tag}"`, count)
  }
  for (const [tag, count] of stats.refunded) {
    line(`VISSZATÉRÍTÉS miatt kihagyva — "${tag}"`, count)
  }
  for (const [tag, count] of stats.ignored) {
    line(`nem vásárlás (hozzáférés nélkül) — "${tag}"`, count)
  }
  for (const [tag, count] of stats.unknown) {
    line(`ISMERETLEN címke (hozzáférés nélkül) — "${tag}"`, count)
  }
  line('címke nélküli vevő', stats.customersWithoutTags)
  line('összesen hozzáférés nélkül marad', stats.customersWithoutAccess)
  line('régi vásárlás-dátummal', stats.customersWithDate)
  if (stats.unparsableDates > 0) {
    line('ÉRTELMEZHETETLEN dátum', stats.unparsableDates)
  }
  write('')
  write('A címke-szabályok (vásárlás / visszatérítés / érdeklődő):')
  for (const rule of SYSTEME_TAG_RULES) {
    write(`  - "${rule.tag}" → ${rule.note}`)
  }
}

function printUnknownCourses(plan: ImportPlan): void {
  if (plan.unknownCourseNames.length === 0) {
    return
  }
  write('')
  write(`Nem leképezett kurzusnevek (${plan.unknownCourseNames.length}):`)
  for (const name of plan.unknownCourseNames) {
    write(`  - "${name}"  →  add meg: --map "${name}=<SKU>"`)
  }
}

/** Az aktiválási linkek CSV-jének kiírása (jogosultság-szűkítve). */
async function writeLinksFile(target: string, contents: string): Promise<void> {
  const absolute = path.resolve(target)
  await writeFile(absolute, contents, { encoding: 'utf8', mode: 0o600 })
  write(`Aktiválási linkek: ${absolute}`)
  write(
    'FIGYELEM: a fájl aktiválási tokeneket tartalmaz — ne kerüljön a repóba és ne maradjon ' +
      'a gépen a kiküldés után. Töröld, amint a levelek kimentek.',
  )
  if (!path.relative(process.cwd(), absolute).startsWith('..')) {
    write(
      'FIGYELEM: a fájl a projekt könyvtárán BELÜL jött létre — a véletlen commit elkerüléséhez ' +
        'inkább a projekten kívülre írasd (pl. --out-links="$HOME/kineticare-linkek.csv").',
    )
  }
}

/** Van-e (nem üres) base64-CSV a környezeti változóban? */
function hasCsvFromEnv(): boolean {
  const raw = process.env[CSV_BASE64_ENV]
  return typeof raw === 'string' && raw.trim() !== ''
}

/**
 * A CSV beolvasása a KÖRNYEZETI VÁLTOZÓBÓL (base64).
 *
 * A Railway-változó értékébe a másoláskor sortörés is kerülhet — a whitespace
 * ezért a dekódolás előtt kiesik. A dekódolt tartalom UTF-8 szövegként áll
 * elő; a BOM levágását a parser végzi.
 *
 * A hibaüzenet SOHA nem írja ki a változó tartalmát (személyes adat).
 */
function readCsvFromEnv(): string {
  const raw = (process.env[CSV_BASE64_ENV] ?? '').replace(/\s+/g, '')
  if (raw === '') {
    throw new Error(`Az ${CSV_BASE64_ENV} környezeti változó üres.`)
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error(
      `Az ${CSV_BASE64_ENV} környezeti változó nem base64-kódolt szöveg. ` +
        'Készítsd így: base64 -w0 lista.csv (macOS: base64 -i lista.csv).',
    )
  }
  const decoded = Buffer.from(raw, 'base64').toString('utf8')
  if (decoded.trim() === '') {
    throw new Error(`Az ${CSV_BASE64_ENV} változó dekódolt tartalma üres.`)
  }
  return decoded
}

async function readCsvFile(file: string): Promise<string> {
  try {
    return await readFile(path.resolve(file), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error(`Nem található a fájl: ${path.resolve(file)}. Ellenőrizd az útvonalat.`)
    }
    if (code === 'EACCES') {
      throw new Error(`A fájl nem olvasható (nincs jogosultság): ${path.resolve(file)}.`)
    }
    if (code === 'EISDIR') {
      throw new Error(`A megadott útvonal egy könyvtár, nem fájl: ${path.resolve(file)}.`)
    }
    throw new Error(
      `A fájl beolvasása sikertelen (${path.resolve(file)}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function run(args: CliArgs): Promise<number> {
  // --- 1. CSV beolvasása és értelmezése -------------------------------------
  const csv = args.file !== '' ? await readCsvFile(args.file) : readCsvFromEnv()
  if (args.file === '') {
    write(`A CSV az ${CSV_BASE64_ENV} környezeti változóból érkezett (fájl nélkül).`)
    write(
      `FIGYELEM: a lista SZEMÉLYES ADAT — az ${CSV_BASE64_ENV} változót a futás után TÖRÖLD ` +
        '(Railway → Variables).',
    )
  }
  const tagRules = buildTagRuleSet({
    ignoreTags: args.ignoreTags,
    refundPairs: args.refundTags,
  })
  if (tagRules.errors.length > 0) {
    for (const error of tagRules.errors) {
      writeError(`Hiba: ${error}`)
    }
    return 1
  }
  const parsed = parseCustomerCsv(csv, {
    delimiter: args.delimiter,
    emailColumn: args.emailCol,
    nameColumn: args.nameCol,
    coursesColumn: args.coursesCol,
    lastNameColumn: args.lastNameCol,
    registeredColumn: args.registeredCol,
    format: args.format,
    tagRules: tagRules.ruleSet,
  })

  for (const warning of parsed.warnings) {
    write(`Figyelmeztetés: ${warning}`)
  }
  printIssues('Kihagyott sorok', parsed.issues)
  printTagSummary(parsed)

  if (parsed.rows.length === 0) {
    write('')
    write('Nincs importálható sor.')
    return parsed.issues.length > 0 ? 1 : 0
  }

  // --- 1b. CSAK FÁJL-ELLENŐRZÉS (adatbázis nélkül) --------------------------
  if (args.parseOnly) {
    write('')
    write(
      `FÁJL-ELLENŐRZÉS — ${parsed.rows.length} vevő a fájlban, ${parsed.issues.length} hibás sor. ` +
        'Adatbázis-kapcsolat nem épült ki, írás nem történt.',
    )
    write('Következő lépés: ugyanez a parancs --parse-only helyett --dry-run kapcsolóval.')
    return parsed.issues.length > 0 ? 1 : 0
  }

  // --- 2. Kurzusnév → SKU leképezés ------------------------------------------
  const courseMap = parseCourseMap(args.map)
  if (courseMap.errors.length > 0) {
    for (const error of courseMap.errors) {
      writeError(`Hiba: ${error}`)
    }
    return 1
  }

  // --- 3. Terv (CSAK OLVASÁS) ------------------------------------------------
  const payload = await getPayload({ config })
  const plan = await buildImportPlan(payload, { rows: parsed.rows, courseMap })

  if (plan.unknownSkus.length > 0) {
    writeError(
      `Hiba: a --map olyan SKU-ra hivatkozik, ami nincs az adatbázisban: ${plan.unknownSkus.join(', ')}. ` +
        'Ellenőrizd a kurzusok azonosítóit az admin felületen. Írás nem történt.',
    )
    return 1
  }

  write('')
  write(
    `Terv: ${plan.summary.create} új fiók, ${plan.summary.append} bővítés, ` +
      `${plan.summary.skip} kihagyás (${parsed.rows.length} vásárló a fájlban).`,
  )
  write('')
  printPlan(plan)
  printUnknownCourses(plan)

  // --- 4a. Próbafutás --------------------------------------------------------
  if (args.dryRun) {
    write('')
    write(
      `PRÓBAFUTÁS ÖSSZESÍTŐ — létrehozandó: ${plan.summary.create}, bővítendő: ${plan.summary.append}, ` +
        `kihagyva: ${plan.summary.skip}, hibás sor: ${parsed.issues.length}, ` +
        `nem leképezett kurzusnév: ${plan.unknownCourseNames.length}. ` +
        'Az adatbázisba SEMMI nem íródott.',
    )
    const withDate = plan.entries.filter(
      (entry) => entry.action !== 'skip-complete' && entry.registeredAt !== undefined,
    ).length
    if (withDate > 0) {
      write(
        `A régi vásárlás időpontja ${withDate} vevőnél kerülne audit-bejegyzésbe ` +
          '(admin → Rendszer → Műveletnapló, „customer-import.legacy-purchase").',
      )
    }
    if (plan.emptyUserCollection && plan.summary.create > 0) {
      write(
        'FIGYELEM: a users kollekció ÜRES — az első létrehozott felhasználó tulajdonosi (owner) ' +
          'szerepkört kapna. Hozd létre előbb az admin-felhasználót; éles futás így nem indul el.',
      )
    }
    if (args.outLinks !== undefined) {
      write(
        'Megjegyzés: próbafutásban nem készülnek aktiválási linkek (a link-generálás tokent ír ' +
          'a felhasználóra). Éles futás után add meg újra a --out-links kapcsolót.',
      )
    }
    write('Levél SEM ment ki (a --send-invites próbafutással nem is használható).')
    write('Éles futtatás: ugyanez a parancs a --dry-run kapcsoló NÉLKÜL.')
    return parsed.issues.length > 0 ? 1 : 0
  }

  // --- 4b. Éles futás --------------------------------------------------------
  // A linkek szerverneve MÉG az írás előtt ellenőrizendő: ne írjunk be
  // vásárlókat úgy, hogy utána a meghívó linkek generálása bukik el.
  const needsLinks = args.outLinks !== undefined || args.sendInvites !== undefined
  const serverUrl = needsLinks ? resolveServerUrl() : undefined

  write('')
  write('ÉLES FUTÁS — a sorok feldolgozása:')
  const printOutcome = (outcome: ExecutionOutcome): void => {
    const label = ACTION_LABEL[outcome.action] ?? outcome.action
    const detail =
      outcome.action === 'failed'
        ? ` — ${outcome.error ?? 'ismeretlen hiba'}`
        : outcome.grantedSkus.length > 0
          ? ` — ${outcome.grantedSkus.join(', ')}`
          : ''
    write(`  [${label}] ${outcome.email}${detail}`)
  }

  const result = await executeImportPlan(payload, plan, { log, onOutcome: printOutcome })

  const failed: RowIssue[] = result.outcomes
    .filter((outcome) => outcome.action === 'failed')
    .map((outcome) => ({
      line: 0,
      email: outcome.email,
      reason: outcome.error ?? 'ismeretlen hiba',
    }))
  printIssues('Sikertelen sorok', failed)

  // --- 5. Aktiválási linkek és levelek (opcionális) --------------------------
  //
  // A LINKGENERÁLÁS EGYETLEN KÖRBEN fut. Minden `forgotPassword`-hívás ÚJ
  // tokent ír a felhasználóra és ezzel érvényteleníti a korábbit — ha a CSV-hez
  // és a levélhez külön generálnánk, a CSV-be került link már a levél kiküldése
  // pillanatában halott lenne. Ezért a két címzett-halmaz UNIÓJÁRA készül a
  // link, és utána szűrünk fogyasztónként.
  const csvTargets =
    args.outLinks !== undefined
      ? args.inviteAll
        ? result.touchedEmails
        : result.createdEmails
      : []
  const mailTargets =
    args.sendInvites === undefined
      ? []
      : args.sendInvites === 'all'
        ? result.outcomes
            .filter((outcome) => outcome.action !== 'failed')
            .map((outcome) => outcome.email)
        : result.createdEmails
  const linkTargets = [...new Set([...csvTargets, ...mailTargets])]

  let sentCount = 0
  let sendFailedCount = 0

  if (needsLinks && serverUrl !== undefined && linkTargets.length === 0) {
    write('')
    write('Aktiválási link nem készült: nincs olyan vevő, akinek most kellene.')
    if (args.sendInvites !== undefined) {
      write('Nincs kinek küldeni — levél sem ment ki. Ez nem hiba.')
    }
  } else if (needsLinks && serverUrl !== undefined) {
    const invites = await generateInviteLinks(payload, linkTargets, { serverUrl, log })
    printIssues('Sikertelen aktiválási linkek', invites.issues)
    failed.push(...invites.issues)

    if (args.outLinks !== undefined) {
      const csvSet = new Set(csvTargets)
      await writeLinksFile(
        args.outLinks,
        renderInviteCsv(invites.links.filter((link) => csvSet.has(link.email))),
      )
    }

    if (args.sendInvites !== undefined) {
      const mailSet = new Set(mailTargets)
      const mailLinks: InviteLink[] = invites.links.filter((link) => mailSet.has(link.email))
      if (mailLinks.length === 0) {
        write('')
        write('Nincs kinek küldeni — levél nem ment ki. Ez nem hiba.')
      } else {
        write('')
        write(`AKTIVÁLÓ LEVELEK KIKÜLDÉSE (${mailLinks.length} címzett):`)
        const printSend = (outcome: InviteSendOutcome): void => {
          write(
            outcome.ok
              ? `  [ELKÜLDVE] ${outcome.email}`
              : `  [SIKERTELEN] ${outcome.email} — ${outcome.error ?? 'ismeretlen hiba'}`,
          )
        }
        const sent = await sendInviteEmails(payload, mailLinks, {
          log,
          names: new Map(plan.entries.map((entry) => [entry.email, entry.name])),
          onOutcome: printSend,
        })
        sentCount = sent.summary.elkuldve
        sendFailedCount = sent.summary.sikertelen
        printIssues('Sikertelen levelek', sent.issues)
        failed.push(...sent.issues)
      }
    }
  }

  // --- 6. MÉRLEG -------------------------------------------------------------
  const rowErrorCount = parsed.issues.length + failed.length
  write('')
  write(
    `MÉRLEG — létrehozva: ${result.summary.letrehozva}, bővítve: ${result.summary.bovitve}, ` +
      `kihagyva (már megvolt): ${result.summary.kihagyva}, hibás sor: ${rowErrorCount}, ` +
      `nem leképezett kurzusnév: ${plan.unknownCourseNames.length}.`,
  )
  if (args.sendInvites !== undefined) {
    write(`AKTIVÁLÓ LEVELEK — elküldve: ${sentCount}, sikertelen: ${sendFailedCount}.`)
  }
  log.info('vásárló-import mérleg', {
    letrehozva: result.summary.letrehozva,
    bovitve: result.summary.bovitve,
    kihagyva: result.summary.kihagyva,
    hibasSor: rowErrorCount,
    nemLekepezettKurzus: plan.unknownCourseNames.length,
    ...(args.sendInvites !== undefined
      ? { levelElkuldve: sentCount, levelSikertelen: sendFailedCount }
      : {}),
  })
  write(
    'A régi (systeme.io-beli) vásárlás időpontja a Műveletnaplóba került, ' +
      'műveletnév: „customer-import.legacy-purchase" (admin → Rendszer → Műveletnapló).',
  )
  write(
    'Az import idempotens: ugyanez a parancs bármikor újrafuttatható — a kész sorok kimaradnak.',
  )

  return rowErrorCount > 0 ? 1 : 0
}

const parsedArgs = parseArgs(process.argv.slice(2))
if (parsedArgs.kind !== 'args') {
  process.exit(parsedArgs.kind === 'help' ? 0 : 1)
}

run(parsedArgs.args)
  .then((code) => {
    process.exit(code)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    log.error('vásárló-import sikertelen', { error: message })
    writeError(`Hiba: ${message}`)
    process.exit(1)
  })
