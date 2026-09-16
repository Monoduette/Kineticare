import { devNull } from 'node:os'

/**
 * Adatbázis-mentés — TISZTA (mellékhatás-mentes) logika.
 *
 * Ez a modul SEMMILYEN folyamatot nem indít és fájlrendszert nem ír: csak
 * neveket képez, szövegeket redaktál, argumentumot értelmez és dönt a
 * retencióról. A tényleges pg_dump/pg_restore futtatás a vékony CLI-burkolatban
 * él (src/scripts/backup-db.ts) — így ez a réteg valódi hálózat és valódi
 * pg_dump nélkül tesztelhető (src/__tests__/backup-db.test.ts).
 *
 * A modul legfontosabb biztonsági szabálya: a DATABASE_URI értéke SEMMILYEN
 * kimenetbe vagy gyermekfolyamat-argumentumba nem kerülhet. A libpq mezők
 * külön környezeti változókba, a jelszó védett PGPASSFILE-ba kerül. A
 * `redactConnectionInfo` emellett defense-in-depth réteg minden külső
 * eredetű szöveghez (pg_dump/pg_restore stderr).
 */

/**
 * A mentésfájlok neve: `kineticare-YYYYMMDD-HHmmss.dump`, UTC időbélyeggel.
 *
 * Az UTC azért kötelező, mert a mentés két helyről is indulhat (GitHub Actions
 * runner és üzemeltetői gép); helyi idővel a nevek nem lennének rendezhetők,
 * és a nyári időszámítás váltásakor ütköznének. A formátum lexikografikus
 * rendezése egyben időrendi is — a retenció-döntés erre épül.
 */
export const DUMP_FILE_PATTERN = /^kineticare-(\d{8})-(\d{6})\.dump$/

/** A mentések alapértelmezett célkönyvtára (a .gitignore kizárja a repóból). */
export const DEFAULT_TARGET_DIR = './backups'

/** Alapértelmezett retenció: ennyi legfrissebb mentés marad meg a célkönyvtárban. */
export const DEFAULT_KEEP = 14

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

/** `kineticare-YYYYMMDD-HHmmss.dump` képzése az adott időpontból (UTC). */
export function buildDumpFileName(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new Error('A mentésfájl neve nem képezhető: a kapott időpont nem valódi dátum.')
  }
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`
  return `kineticare-${date}-${time}.dump`
}

/** Igaz, ha a fájlnév a saját mentés-névsémánkat követi. */
export function isDumpFileName(name: string): boolean {
  return DUMP_FILE_PATTERN.test(name)
}

/**
 * Kapcsolati adat kiszűrése tetszőleges szövegből.
 *
 * Két rétegben véd:
 *  1. ha ismerjük a konkrét URI-t, annak MINDEN előfordulását cseréljük
 *     (akkor is, ha a pg_dump valamilyen szokatlan formában írja ki);
 *  2. mintaillesztéssel minden `postgres://` / `postgresql://` kezdetű
 *     szeletet levágunk — ez fogja el az ismeretlen forrásból (pl. libpq
 *     hibaszövegből) származó kapcsolati stringeket is.
 *
 * Ráadásként a `user:pass@host` alakú, séma nélküli darabokat is maszkoljuk.
 */
export function redactConnectionInfo(text: string, uri?: string): string {
  let output = text

  if (uri !== undefined && uri.trim().length > 0) {
    output = output.split(uri).join('[REDACTED-DATABASE_URI]')
  }

  output = output.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED-DATABASE_URI]')
  output = output.replace(/[^\s:/@]+:[^\s:/@]+@[^\s/]+/g, '[REDACTED-CREDENTIALS]')

  return output
}

/** A retenció-döntés eredménye: mely fájlok maradnak és melyek törlendők. */
export interface RetentionDecision {
  /** A megtartandó mentések, legfrissebbtől a legrégebbiig. */
  readonly keep: readonly string[]
  /** A törlendő (a határon túli, legrégebbi) mentések, legrégebbitől kezdve. */
  readonly remove: readonly string[]
  /** A célkönyvtár nem hozzánk tartozó fájljai — ezekhez SOSEM nyúlunk. */
  readonly ignored: readonly string[]
}

/**
 * Retenció-döntés: a névséma szerinti mentésekből a `keep` legfrissebb marad,
 * a többi törlendő. Idegen fájlokat (nem a mi névsémánk) érintetlenül hagyunk —
 * a script sosem törölhet olyat, amit nem ő hozott létre.
 */
export function decideRetention(fileNames: readonly string[], keep: number): RetentionDecision {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error('A megtartandó mentések száma csak 1 vagy annál nagyobb egész lehet.')
  }

  const dumps: string[] = []
  const ignored: string[] = []
  for (const name of fileNames) {
    if (isDumpFileName(name)) {
      dumps.push(name)
    } else {
      ignored.push(name)
    }
  }

  // A névséma miatt a fordított ábécésorrend = időrend visszafelé.
  dumps.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  return {
    keep: dumps.slice(0, keep),
    remove: dumps.slice(keep).reverse(),
    ignored,
  }
}

/** A `pg_restore --list` futásának nyers eredménye (már redaktált szövegekkel). */
export interface RestoreListResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** A TOC-ellenőrzés kiértékelt eredménye; teljes dekódolás külön szükséges. */
export type IntegrityOutcome =
  | { readonly ok: true; readonly entryCount: number }
  | { readonly ok: false; readonly message: string }

function firstMeaningfulLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return ''
}

/**
 * A `pg_restore --list` kimenetének értelmezése.
 *
 * A kimenet fejléce `;`-vel kezdődő kommentsorokból áll, utána jönnek a TOC-
 * bejegyzések (`215; 1259 16389 TABLE public users postgres`). Sérült fejléc
 * vagy TOC hibát okoz; későbbi sérült adatblokk viszont rejtve maradhat.
 * Ezért a bejegyzésszám után teljes dekódolás is kell a sikerhez.
 *
 * A `stdout`/`stderr` értékét a hívó KÖTELESEN redaktálva adja át.
 */
export function interpretRestoreList(result: RestoreListResult): IntegrityOutcome {
  if (result.exitCode !== 0) {
    const detail = firstMeaningfulLine(result.stderr)
    return {
      ok: false,
      message:
        `A mentésfájl integritás-ellenőrzése megbukott (pg_restore --list, kilépési kód: ${result.exitCode}).` +
        (detail.length > 0 ? ` Részlet: ${detail}` : ''),
    }
  }

  let entryCount = 0
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && !trimmed.startsWith(';')) {
      entryCount += 1
    }
  }

  if (entryCount === 0) {
    return {
      ok: false,
      message:
        'A mentésfájl egyetlen visszaállítható bejegyzést sem tartalmaz — üres vagy sérült archívum.',
    }
  }

  return { ok: true, entryCount }
}

/** A CLI feldolgozott kapcsolói. */
export interface BackupOptions {
  readonly targetDir: string
  readonly keep: number
}

/** Az argumentum-feldolgozás eredménye — hiba esetén magyar üzenettel. */
export type ArgParseResult =
  | { readonly ok: true; readonly options: BackupOptions }
  | { readonly ok: false; readonly message: string }

/**
 * A `--cel=<könyvtár>` és `--megtart=<n>` kapcsolók feldolgozása.
 * Ismeretlen vagy hibás alakú argumentumra magyar hibaüzenettel elbukik —
 * elgépelt kapcsoló nem eshet csendben az alapértelmezésre.
 */
export function parseBackupArgs(argv: readonly string[]): ArgParseResult {
  let targetDir = DEFAULT_TARGET_DIR
  let keep = DEFAULT_KEEP

  for (const raw of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(raw)
    if (!match) {
      return {
        ok: false,
        message: `Nem értelmezhető argumentum: "${raw}" (a forma: --kulcs=érték).`,
      }
    }
    const [, key, value] = match

    if (key === 'cel') {
      if (value.trim().length === 0) {
        return { ok: false, message: 'A "--cel" argumentum értéke nem lehet üres.' }
      }
      targetDir = value
      continue
    }

    if (key === 'megtart') {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 1) {
        return {
          ok: false,
          message: `A "--megtart" értéke csak 1 vagy annál nagyobb egész szám lehet (kapott: "${value}").`,
        }
      }
      keep = parsed
      continue
    }

    return { ok: false, message: `Ismeretlen argumentum: "--${key}".` }
  }

  return { ok: true, options: { targetDir, keep } }
}

/** A DATABASE_URI-ból származtatott, credential-mentes libpq környezet és pgpass tartalom. */
export interface LibpqConnection {
  readonly environment: Readonly<Record<string, string>>
  readonly pgpassContents: string
}

const LIBPQ_QUERY_ENV: Readonly<Record<string, string>> = {
  application_name: 'PGAPPNAME',
  channel_binding: 'PGCHANNELBINDING',
  connect_timeout: 'PGCONNECT_TIMEOUT',
  options: 'PGOPTIONS',
  sslcert: 'PGSSLCERT',
  sslcrl: 'PGSSLCRL',
  sslkey: 'PGSSLKEY',
  sslmode: 'PGSSLMODE',
  sslrootcert: 'PGSSLROOTCERT',
  target_session_attrs: 'PGTARGETSESSIONATTRS',
}

function decodeUriField(encoded: string, fieldName: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch {
    throw new Error(`A DATABASE_URI ${fieldName} mezője hibás percent-kódolást tartalmaz.`)
  }
}

function assertSafeLibpqField(value: string, fieldName: string): void {
  if (value.length === 0) {
    throw new Error(`A DATABASE_URI ${fieldName} mezője kötelező.`)
  }
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`A DATABASE_URI ${fieldName} mezője tiltott vezérlőkaraktert tartalmaz.`)
  }
}

/** A `.pgpass` mezőiben a backslash és a kettőspont backslash-sel escape-elendő. */
export function escapePgPassField(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

/**
 * PostgreSQL URI biztonságos szétbontása libpq env + PGPASSFILE használatához.
 *
 * Ismeretlen vagy duplikált query-paraméterre fail-closed hibát ad: egy TLS-
 * vagy routing-opció nem veszhet el csendben az URI argv-ból való kivezetésekor.
 * A hibaüzenetek sosem tartalmazzák a teljes URI-t vagy a paraméter értékét.
 */
export function parseDatabaseUriForLibpq(uri: string): LibpqConnection {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('A DATABASE_URI nem érvényes PostgreSQL kapcsolati URI.')
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('A DATABASE_URI protokollja csak postgres: vagy postgresql: lehet.')
  }
  if (parsed.hash.length > 0) {
    throw new Error('A DATABASE_URI nem tartalmazhat fragmentet.')
  }

  const host =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname
  const port = parsed.port || '5432'
  const user = decodeUriField(parsed.username, 'felhasználó')
  const password = decodeUriField(parsed.password, 'jelszó')
  const database = decodeUriField(parsed.pathname.replace(/^\//, ''), 'adatbázis')

  assertSafeLibpqField(host, 'host')
  assertSafeLibpqField(port, 'port')
  assertSafeLibpqField(user, 'felhasználó')
  assertSafeLibpqField(password, 'jelszó')
  assertSafeLibpqField(database, 'adatbázis')
  if (host.includes(',')) {
    throw new Error('A DATABASE_URI több hostot nem tartalmazhat.')
  }

  const environment: Record<string, string> = {
    PGHOST: host,
    PGPORT: port,
    PGUSER: user,
    PGDATABASE: database,
  }
  const seenQueryKeys = new Set<string>()
  for (const [key, value] of parsed.searchParams.entries()) {
    if (seenQueryKeys.has(key)) {
      throw new Error('A DATABASE_URI ugyanazt a query-paramétert többször tartalmazza.')
    }
    seenQueryKeys.add(key)

    const envKey = LIBPQ_QUERY_ENV[key]
    if (envKey === undefined) {
      throw new Error('A DATABASE_URI nem támogatott query-paramétert tartalmaz.')
    }
    assertSafeLibpqField(value, 'query-paraméter értéke')
    environment[envKey] = value
  }

  const pgpassContents =
    [host, port, database, user, password].map(escapePgPassField).join(':') + '\n'

  return { environment, pgpassContents }
}

/**
 * A pg_dump argumentumlistája.
 *
 * KRITIKUS: kapcsolati adat egyáltalán nincs az argv-ban. A pg_dump a külön
 * PGHOST/PGPORT/PGUSER/PGDATABASE env-ből és a 0600-as PGPASSFILE-ból olvas.
 *
 * A custom formátum (`--format=custom`) alapból tömörít és szelektív
 * visszaállítást tesz lehetővé, ezért nincs külön tömörítés-kapcsoló.
 *
 * A tulajdonos- és jogosultság-információt SZÁNDÉKOSAN benne hagyjuk a
 * dumpban (nincs --no-owner): a custom formátumnál a visszaállításkor lehet
 * róla dönteni (`pg_restore --no-owner --no-privileges`), fordítva nem.
 */
export function buildPgDumpArgs(filePath: string): string[] {
  return ['--format=custom', '--file', filePath]
}

/** TOC-listázás a bejegyzésszámhoz; önmagában nem igazolja az adatblokkokat. */
export function buildPgRestoreListArgs(filePath: string): string[] {
  return ['--list', filePath]
}

/** Teljes archívumdekódolás SQL-kimenettel a null eszközre, adatbáziscél és szűrő nélkül. */
export function buildPgRestoreDecodeArgs(filePath: string): string[] {
  return ['--file', devNull, filePath]
}

/** Emberi olvasásra szánt méret (a naplóba és a konzolra). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'ismeretlen méret'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}
