#!/usr/bin/env node
/**
 * Valódi PG18 regresszió kizárólag a CI eldobható service-konténerében.
 * A jó archívumot vissza is állítjuk; a csonka adatú, ép TOC-os változat
 * teljes dekódolásának buknia kell. Éles mentést vagy app-env-et nem olvas.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildPgDumpArgs,
  buildPgRestoreDecodeArgs,
  buildPgRestoreListArgs,
  interpretRestoreList,
} from '../src/lib/backup-db.ts'

const pinnedImage =
  'postgres:18@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280'
const container = process.env.KINETICARE_BACKUP_PG18_CONTAINER
assert(
  process.env.CI === 'true' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.platform === 'linux',
  'Ez a próba csak Linux GitHub Actions CI service-konténerében futtatható.',
)
assert(container && /^[a-f0-9]{12,64}$/.test(container), 'Explicit CI PG18 konténerazonosító kell.')

// A Docker kizárólag a runner helyi socketjét használhatja; DOCKER_HOST,
// config, alkalmazási titok és PG-kapcsolati környezet nem öröklődik.
const commandEnvironment = { PATH: process.env.PATH, LANG: 'C' }
const started = Date.now()
const mainDeadline = started + 100_000
const finalDeadline = started + 120_000

function docker(args, { allowFailure = false, cleanup = false } = {}) {
  const remaining = (cleanup ? finalDeadline : mainDeadline) - Date.now()
  assert(remaining > 0, 'A PG18 fixture időkerete lejárt.')
  const result = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    env: commandEnvironment,
    encoding: 'utf8',
    timeout: Math.min(cleanup ? 5000 : 30_000, remaining),
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (!allowFailure) {
    assert.equal(result.status, 0, `CI fixture parancshiba: ${result.stderr.trim()}`)
  }
  return result
}

function inside(args, options = {}) {
  return docker(
    [
      'exec',
      container,
      // A kliens timeoutja mellett a konténerben futó folyamat is korlátos.
      'timeout',
      '--kill-after=1s',
      options.cleanup ? '3s' : '25s',
      'env',
      '-i',
      'PATH=/usr/local/bin:/usr/bin:/bin',
      'LANG=C',
      ...args,
    ],
    options,
  )
}

const metadata = JSON.parse(
  docker([
    'inspect',
    '--format',
    '{"image":{{json .Config.Image}},"running":{{json .State.Running}}}',
    container,
  ]).stdout,
)
assert.equal(
  metadata.image,
  pinnedImage,
  'A fixture kizárólag a rögzített PG18 image-et használja.',
)
assert.equal(metadata.running, true, 'A megadott CI service-konténer nem fut.')

const suffix = randomUUID().replaceAll('-', '')
const sourceDatabase = `kc_backup_${suffix}_source`
const restoredDatabase = `kc_backup_${suffix}_restored`
const containerDirectory = `/tmp/kc-backup-fixture-${suffix}`
const goodArchive = `${containerDirectory}/good.dump`
const truncatedArchive = `${containerDirectory}/truncated.dump`
const localDirectory = mkdtempSync(join(tmpdir(), 'kc-backup-archive-fixture-'))
const createdDatabases = []
let createdContainerDirectory = false
const connectionArgs = ['--host=/var/run/postgresql', '--username=kineticare_ci', '--no-password']

function sql(database, statement) {
  return inside([
    'psql',
    ...connectionArgs,
    `--dbname=${database}`,
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command',
    statement,
  ]).stdout.trim()
}

function listArchive(path) {
  const args = buildPgRestoreListArgs(path)
  assert.deepEqual(args, ['--list', path])
  const result = inside(['pg_restore', ...args])
  const listing = interpretRestoreList({
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  })
  assert.equal(listing.ok, true, 'A fixture előfeltétele: ép, nem üres TOC.')
  assert.match(result.stdout, /TABLE DATA public archive_fixture/)
}

function decodeArchive(path, options) {
  const args = buildPgRestoreDecodeArgs(path)
  // Ez a kapu akkor is védi a próba célját, ha később rossz DB-cél vagy
  // szűrő kerülne a tényleges, a CLI által is használt argumentumsegédbe.
  assert.deepEqual(args, ['--file', '/dev/null', path])
  return inside(['pg_restore', ...args], options)
}

const md5 = (value) => createHash('md5').update(value).digest('hex')
const rowHashes = []
for (let row = 1; row <= 2048; row += 1) {
  let payload = ''
  for (let chunk = 1; chunk <= 32; chunk += 1) payload += md5(`${row}:${chunk}:fixture`)
  rowHashes.push(md5(payload))
}
const expectedFingerprint = `2048|2097152|${md5(rowHashes.join(''))}`
const fingerprintSql = `SELECT count(*)::text || '|' || sum(octet_length(payload))::text || '|' ||
  md5(string_agg(md5(payload), '' ORDER BY id)) FROM archive_fixture`

let failure
try {
  // A művelet indítása előtt regisztráljuk a saját véletlen nevet: egy
  // timeout után is legyen cleanup, ha a szerveroldali létrehozás már sikerült.
  createdContainerDirectory = true
  inside(['mkdir', '-m', '0700', containerDirectory])
  for (const database of [sourceDatabase, restoredDatabase]) {
    createdDatabases.push(database)
    inside(['createdb', ...connectionArgs, '--template=template0', database])
  }
  sql(
    sourceDatabase,
    `
    SET statement_timeout = '15s';
    CREATE TABLE archive_fixture (id integer PRIMARY KEY, payload text NOT NULL);
    INSERT INTO archive_fixture
    SELECT row_id, string_agg(md5(row_id::text || ':' || chunk_id::text || ':fixture'), '' ORDER BY chunk_id)
    FROM generate_series(1, 2048) row_id CROSS JOIN generate_series(1, 32) chunk_id
    GROUP BY row_id;
  `,
  )
  assert.equal(sql(sourceDatabase, fingerprintSql), expectedFingerprint)

  inside([
    'pg_dump',
    ...connectionArgs,
    `--dbname=${sourceDatabase}`,
    ...buildPgDumpArgs(goodArchive),
  ])
  listArchive(goodArchive)
  decodeArchive(goodArchive)
  inside([
    'pg_restore',
    ...connectionArgs,
    `--dbname=${restoredDatabase}`,
    '--exit-on-error',
    goodArchive,
  ])
  assert.equal(sql(restoredDatabase, fingerprintSql), expectedFingerprint)

  const localGood = join(localDirectory, 'good.dump')
  const localTruncated = join(localDirectory, 'truncated.dump')
  docker(['cp', `${container}:${goodArchive}`, localGood])
  const bytes = readFileSync(localGood)
  assert(bytes.length > 64 * 1024, 'A fixture adatblokkjai nem elég nagyok a csonkolási próbához.')
  // Egyetlen, előre rögzített csonkolás; a TOC olvashatóságát utána a valódi
  // pg_restore bizonyítja. Sikertelen előfeltételnél nincs skip vagy új mintavétel.
  writeFileSync(localTruncated, bytes.subarray(0, Math.floor((bytes.length * 2) / 3)), {
    mode: 0o600,
  })
  docker(['cp', localTruncated, `${container}:${truncatedArchive}`])
  listArchive(truncatedArchive)
  const truncated = decodeArchive(truncatedArchive, { allowFailure: true })
  assert.equal(truncated.status, 1, 'A csonka adatú archívum teljes dekódolásának buknia kell.')
  assert.match(truncated.stderr, /pg_restore: error:/)
} catch (error) {
  failure = error
} finally {
  // Csak az e futásban létrehozott két név és egy könyvtár törölhető.
  // Cleanup-hiba piros kapu: a próba nem hagyhat észrevétlenül fixture-állapotot.
  for (const database of createdDatabases.reverse()) {
    try {
      inside(['dropdb', ...connectionArgs, '--if-exists', database], { cleanup: true })
    } catch (error) {
      failure ??= error
    }
  }
  if (createdContainerDirectory) {
    try {
      inside(['rm', '-rf', '--', containerDirectory], { cleanup: true })
    } catch (error) {
      failure ??= error
    }
  }
  rmSync(localDirectory, { recursive: true, force: true })
}
if (failure) throw failure
process.stdout.write(
  'PG18 archive PASS: 2048 sor / 2 MiB checksum-egyezés; jó mentés dekódolva és visszaállítva; ép TOC-os csonka mentés elutasítva; fixture cleanup kész.\n',
)
