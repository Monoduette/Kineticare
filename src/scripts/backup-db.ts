/**
 * Adatbázis-mentés: pg_dump custom + TOC és teljes archívumdekódolás. DATABASE_URI kötelező.
 *   npm run backup:db [-- --cel=<dir>] [-- --megtart=<n>]
 * A médiafájlokat nem menti. Részletek: docs/adatbazis-mentes.md
 */

import { execFile } from 'node:child_process'
import { link, lstat, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  buildDumpFileName,
  buildPgDumpArgs,
  buildPgRestoreDecodeArgs,
  buildPgRestoreListArgs,
  decideRetention,
  formatBytes,
  interpretRestoreList,
  parseBackupArgs,
  parseDatabaseUriForLibpq,
  redactConnectionInfo,
  type BackupOptions,
} from '../lib/backup-db'
import { withPgPassFile } from '../lib/backup-db-credentials'
import { createLogger } from '../lib/logger'

const log = createLogger({ script: 'backup-db' })

const execFileAsync = promisify(execFile)

/** A pg_restore --list kimenete nagy is lehet — bőven méretezett puffer. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024

function printUsage(): void {
  console.error(
    [
      'Használat:',
      '  npm run backup:db -- [--cel=<könyvtár>] [--megtart=<n>]',
      '',
      'Argumentumok:',
      '  --cel      (opcionális) A mentések célkönyvtára. Alapértelmezés: ./backups',
      '  --megtart  (opcionális) Ennyi legfrissebb mentés marad meg. Alapértelmezés: 14',
      '',
      'Környezeti változó:',
      '  DATABASE_URI  (kötelező) A menteni kívánt adatbázis kapcsolati stringje.',
    ].join('\n'),
  )
}

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Mezőolvasás ismeretlen alakú hibaobjektumból, típuskényszerítés nélkül. */
function readProp(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Külső parancs futtatása execFile-lal. A nem nulla kilépést NEM dobja tovább,
 * hanem eredménnyé alakítja — kivéve a „nincs ilyen program" esetet, amit
 * érthető magyar üzenettel jelzünk.
 */
async function runCommand(
  command: string,
  args: readonly string[],
  uri: string,
  environment: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      env: environment,
      maxBuffer: MAX_BUFFER_BYTES,
    })
    return { exitCode: 0, stdout, stderr: redactConnectionInfo(stderr, uri) }
  } catch (error: unknown) {
    const code = readProp(error, 'code')

    if (code === 'ENOENT') {
      throw new Error(
        `A(z) "${command}" parancs nem található. Telepítsd a PostgreSQL kliens-eszközöket ` +
          '(postgresql-client), és győződj meg róla, hogy a főverziója legalább akkora, ' +
          'mint a menteni kívánt szerveré.',
      )
    }

    if (typeof error === 'object' && error !== null) {
      return {
        exitCode: typeof code === 'number' ? code : 1,
        stdout: asString(readProp(error, 'stdout')),
        stderr: redactConnectionInfo(asString(readProp(error, 'stderr')), uri),
      }
    }

    throw new Error(redactConnectionInfo(String(error), uri))
  }
}

/** A megtartási határon túli mentések törlése; a nem hozzánk tartozó fájlokhoz nem nyúlunk. */
async function applyRetention(targetDir: string, keep: number): Promise<void> {
  const entries = await readdir(targetDir, { withFileTypes: true })
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const decision = decideRetention(fileNames, keep)

  if (decision.remove.length === 0) {
    log.info('retenció: nincs törlendő mentés', {
      megtartva: decision.keep.length,
      hatar: keep,
    })
    return
  }

  for (const name of decision.remove) {
    await rm(join(targetDir, name), { force: true })
    log.info('retenció: régi mentés törölve', { fajl: name, hatar: keep })
    console.log(`Retenció: törölve — ${name}`)
  }

  log.info('retenció kész', {
    torolve: decision.remove.length,
    megtartva: decision.keep.length,
    hatar: keep,
  })
}

async function createBackup(options: BackupOptions, uri: string): Promise<void> {
  const connection = parseDatabaseUriForLibpq(uri)
  await mkdir(options.targetDir, { recursive: true })

  const fileName = buildDumpFileName(new Date())
  const filePath = join(options.targetDir, fileName)
  const partialPath = `${filePath}.partial`
  // Refuse existing regular files and symlinks before obtaining credentials.
  // This early check is only a fast refusal; link() below enforces no replacement atomically.
  const existing = await lstat(filePath).catch((error: unknown) => {
    if (readProp(error, 'code') === 'ENOENT') return null
    throw error
  })
  if (existing) throw new Error(`Már létezik ilyen nevű mentés: ${fileName}`)
  // Outside the cleanup try: if exclusive creation fails, this file is not ours.
  // Partial archives never participate in retention or appear as verified .dump files.
  await writeFile(partialPath, '', { flag: 'wx', mode: 0o600 })

  log.info('mentés indul', { celkonyvtar: options.targetDir, fajl: fileName })

  let verified: { entryCount: number; size: number }
  try {
    const dump = await withPgPassFile(connection, (commandEnvironment) =>
      runCommand('pg_dump', buildPgDumpArgs(partialPath), uri, commandEnvironment),
    )
    if (dump.exitCode !== 0) {
      throw new Error(
        `A pg_dump hibával állt le (kilépési kód: ${dump.exitCode}). ` +
          `Részlet: ${dump.stderr.trim() || 'nincs további információ'}`,
      )
    }

    // A pgpass már törölve. A helyi archívumolvasó egyik PG felülírást és
    // alkalmazási titkot sem örökli; --dbname nélkül SQL-t dekódol, nem kapcsolódik.
    const restoreEnvironment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV }
    for (const key of [
      'PATH',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'SystemRoot',
      'SYSTEMROOT',
      'TMPDIR',
    ]) {
      if (process.env[key] !== undefined) restoreEnvironment[key] = process.env[key]
    }
    const listing = await runCommand(
      'pg_restore',
      buildPgRestoreListArgs(partialPath),
      uri,
      restoreEnvironment,
    )
    const integrity = interpretRestoreList({
      exitCode: listing.exitCode,
      stdout: listing.stdout,
      stderr: listing.stderr,
    })

    if (!integrity.ok) {
      throw new Error(integrity.message)
    }

    const decoded = await runCommand(
      'pg_restore',
      buildPgRestoreDecodeArgs(partialPath),
      uri,
      restoreEnvironment,
    )
    if (decoded.exitCode !== 0) {
      throw new Error(
        `A mentés teljes dekódolása sikertelen (kilépési kód: ${decoded.exitCode}). ` +
          `Részlet: ${decoded.stderr.trim() || 'nincs további információ'}`,
      )
    }

    const { size } = await stat(partialPath)
    verified = { size, entryCount: integrity.entryCount }
    // Same-directory hard link: EEXIST refuses a publication race, without rename overwrite.
    // Unsupported filesystems fail here; there is no unsafe copy/rename fallback.
    await link(partialPath, filePath)
    await rm(partialPath)
  } catch (error) {
    // Only our exclusively created partial belongs to this cleanup. A final path
    // may belong to another run, including when publication failed with EEXIST.
    await rm(partialPath, { force: true })
    log.error('mentés vagy ellenőrzés megbukott — a saját részleges fájl törölve', {
      fajl: fileName,
    })
    throw error
  }

  log.info('mentés kész és ellenőrizve', {
    fajl: fileName,
    meret: verified.size,
    bejegyzesek: verified.entryCount,
    ellenorzes: 'toc-es-teljes-dekodolas',
  })
  console.log(
    `Kész: ${filePath} (${formatBytes(verified.size)}, ${verified.entryCount} TOC-bejegyzés, teljes dekódolás rendben).`,
  )

  await applyRetention(options.targetDir, options.keep)
}

const parsed = parseBackupArgs(process.argv.slice(2))
if (!parsed.ok) {
  console.error(`Hiba: ${parsed.message}`)
  printUsage()
  process.exit(1)
}

const databaseUri = process.env.DATABASE_URI
if (databaseUri === undefined || databaseUri.trim().length === 0) {
  console.error(
    'Hiba: a DATABASE_URI környezeti változó nincs beállítva — enélkül nincs mit menteni.',
  )
  printUsage()
  process.exit(1)
}

createBackup(parsed.options, databaseUri)
  .then(() => {
    process.exit(0)
  })
  .catch((error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error)
    const message = redactConnectionInfo(raw, databaseUri)
    log.error('adatbázis-mentés sikertelen', { error: message })
    console.error(`Hiba: ${message}`)
    process.exit(1)
  })
