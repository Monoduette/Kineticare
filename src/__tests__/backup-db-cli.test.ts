import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  statSync,
  symlinkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../', import.meta.url))
type Scenario = 'good' | 'dump-fails' | 'toc-fails' | 'decode-fails' | 'decoder-disappears'
interface Invocation {
  tool: string
  args: string[]
  connectionKeys: string[]
  pgpassExists: boolean
  visibleDumps: string[]
}

/** Csak saját fake programok futnak, explicit szintetikus env-vel. A hívó sandboxja öröklődik. */
function runFixture(
  scenario: Scenario,
  options: {
    collision?: 'regular' | 'symlink'
    failBeforeDump?: boolean
    partialCollision?: boolean
    publicationCollision?: boolean
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'kineticare-backup-cli-test-'))
  const bin = join(root, 'bin')
  const target = join(root, 'backups')
  const calls = join(root, 'calls.jsonl')
  const oldDump = 'kineticare-20000101-000000.dump'
  const fixedDump = 'kineticare-20260908-123456.dump'
  const collisionPath = join(target, fixedDump)
  const outside = join(root, 'previous-backup.dump')
  const bootstrap = join(root, 'clock.mjs')
  mkdirSync(bin)
  mkdirSync(target)
  writeFileSync(join(target, oldDump), 'DUMMY_PREVIOUS_GOOD_BACKUP')
  writeFileSync(join(target, 'unrelated.txt'), 'DUMMY_UNRELATED')
  writeFileSync(calls, '')
  writeFileSync(outside, 'DUMMY_EXISTING_BACKUP')
  if (options.partialCollision) writeFileSync(collisionPath + '.partial', 'DUMMY_OTHER_PENDING')
  if (options.collision === 'regular') writeFileSync(collisionPath, 'DUMMY_EXISTING_BACKUP')
  if (options.collision === 'symlink') symlinkSync(outside, collisionPath)
  writeFileSync(
    bootstrap,
    `
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
const OriginalDate = globalThis.Date
const fixed = '2026-09-08T12:34:56.000Z'
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [fixed])) }
  static now() { return OriginalDate.parse(fixed) }
}
if (${JSON.stringify(options.failBeforeDump ?? false)}) {
  const original = fs.mkdtemp
  fs.mkdtemp = async (prefix, ...args) => {
    if (String(prefix).includes('kineticare-pgpass-')) throw new Error('DUMMY_PRE_DUMP_FAILURE')
    return original(prefix, ...args)
  }
  syncBuiltinESMExports()
}
`,
  )

  const program = `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const tool = path.basename(process.argv[1])
const args = process.argv.slice(2)
const scenario = ${JSON.stringify(scenario)}
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({tool, args,
  connectionKeys: Object.keys(process.env).filter(key => key === 'DATABASE_URI' || key.startsWith('PG')),
  pgpassExists: Boolean(process.env.PGPASSFILE && fs.existsSync(process.env.PGPASSFILE)),
  visibleDumps: fs.readdirSync(${JSON.stringify(target)}).filter(name => name.endsWith('.dump'))}) + '\\n')
if (tool === 'pg_dump') {
  const output = args[args.indexOf('--file') + 1]
  fs.writeFileSync(output, 'DUMMY_NEW_DUMP')
  process.exit(scenario === 'dump-fails' ? 1 : 0)
}
if (args.includes('--list')) {
  process.stdout.write('; Archive TOC\\n1; 0 0 TABLE DATA public synthetic_fixture fixture\\n')
  if (scenario === 'decoder-disappears') fs.unlinkSync(process.argv[1])
  process.exit(scenario === 'toc-fails' ? 1 : 0)
}
if (!args.includes('--file') || args.includes('--dbname')) process.exit(90)
if (${JSON.stringify(options.publicationCollision ?? false)}) fs.writeFileSync(${JSON.stringify(collisionPath)}, 'DUMMY_COMPETING_VERIFIED_BACKUP', {flag: 'wx', mode: 0o600})
process.stderr.write(scenario === 'decode-fails' ? 'DUMMY truncated archive data' : '')
process.exit(scenario === 'decode-fails' ? 1 : 0)
`
  for (const tool of ['pg_dump', 'pg_restore']) {
    const path = join(bin, tool)
    writeFileSync(path, program, { mode: 0o700 })
    chmodSync(path, 0o700)
  }
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        bootstrap,
        '--import',
        'tsx',
        'src/scripts/backup-db.ts',
        `--cel=${target}`,
        '--megtart=1',
      ],
      {
        cwd: repo,
        env: {
          PATH: `${bin}:${dirname(process.execPath)}`,
          NODE_ENV: 'test',
          DATABASE_URI:
            'postgresql://fixture:DUMMY-NOT-A-REAL-PASSWORD@fixture.example.test/fixture',
          PGSERVICE: 'DUMMY_AMBIENT_SERVICE',
          PGPASSWORD: 'DUMMY-NOT-A-REAL-PASSWORD',
          LANG: 'C',
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    )
    expect(result.error).toBeUndefined()
    const invocations = readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Invocation)
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      files: readdirSync(target),
      invocations,
      oldDump,
      fixedDump,
      collisionContents: existsSync(collisionPath) ? readFileSync(collisionPath, 'utf8') : null,
      isSymlink: existsSync(collisionPath) ? lstatSync(collisionPath).isSymbolicLink() : false,
      outsideContents: readFileSync(outside, 'utf8'),
      partialContents: existsSync(collisionPath + '.partial')
        ? readFileSync(collisionPath + '.partial', 'utf8')
        : null,
      mode: existsSync(collisionPath) ? statSync(collisionPath).mode & 0o777 : null,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('backup CLI: teljes dekódolás a siker és retenció előtt', () => {
  it.each(['regular', 'symlink'] as const)(
    'a korábbi azonos nevű %s mentést nem írja felül vagy törli',
    (collision) => {
      const result = runFixture('good', { collision })
      expect(result.status).not.toBe(0)
      expect(result.invocations).toEqual([])
      expect(result.collisionContents).toBe('DUMMY_EXISTING_BACKUP')
      expect(result.outsideContents).toBe('DUMMY_EXISTING_BACKUP')
      expect(result.isSymlink).toBe(collision === 'symlink')
      expect(result.files.sort()).toEqual(
        [result.oldDump, result.fixedDump, 'unrelated.txt'].sort(),
      )
    },
  )

  it('a pgpass előtti hiba sem törölheti a másik futás azonos nevű mentését', () => {
    const result = runFixture('good', { collision: 'regular', failBeforeDump: true })
    expect(result.status).not.toBe(0)
    expect(result.invocations).toEqual([])
    expect(result.collisionContents).toBe('DUMMY_EXISTING_BACKUP')
    expect(result.files).toContain(result.oldDump)
  })

  it('a pgpass előtti hiba csak a saját kizárólagosan lefoglalt új fájlt takarítja', () => {
    const result = runFixture('good', { failBeforeDump: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain('DUMMY_PRE_DUMP_FAILURE')
    expect(result.invocations).toEqual([])
    expect(result.files.sort()).toEqual([result.oldDump, 'unrelated.txt'].sort())
  })

  it('a másik futás kizárólagos partial fájlja nem írható felül és nem takarítható', () => {
    const result = runFixture('good', { partialCollision: true })
    expect(result.status).not.toBe(0)
    expect(result.invocations).toEqual([])
    expect(result.partialContents).toBe('DUMMY_OTHER_PENDING')
    expect(result.files).toContain(result.oldDump)
    expect(result.collisionContents).toBeNull()
  })

  it('a publikálás előtti final-fájl versenytársat nem írja felül vagy törli', () => {
    const result = runFixture('good', { publicationCollision: true })
    expect(result.status).not.toBe(0)
    expect(result.invocations).toHaveLength(3)
    expect(result.collisionContents).toBe('DUMMY_COMPETING_VERIFIED_BACKUP')
    expect(result.partialContents).toBeNull()
    expect(result.files).toContain(result.oldDump)
    expect(result.output).not.toContain('Kész:')
  })

  it('TOC és teljes dekódolás után engedi csak a régi mentés retencióját', () => {
    const result = runFixture('good')
    expect(result.status).toBe(0)
    expect(result.invocations.every((call) => !call.visibleDumps.includes(result.fixedDump))).toBe(
      true,
    )
    expect(result.mode).toBe(0o600)
    expect(result.invocations.map((call) => call.tool)).toEqual([
      'pg_dump',
      'pg_restore',
      'pg_restore',
    ])
    const [dump, listing, decode] = result.invocations
    expect(dump.pgpassExists).toBe(true)
    expect(listing.args[0]).toBe('--list')
    expect(decode.args.slice(0, 2)).toEqual(['--file', '/dev/null'])
    expect(decode.args).toHaveLength(3)
    for (const call of [listing, decode]) {
      expect(call.connectionKeys).toEqual([])
      expect(call.pgpassExists).toBe(false)
    }
    expect(result.files).not.toContain(result.oldDump)
    expect(result.files).toContain('unrelated.txt')
    expect(result.files.filter((file) => file.endsWith('.dump'))).toHaveLength(1)
  })

  it.each(['decode-fails', 'decoder-disappears'] as const)(
    'érvényes TOC után %s: nincs siker vagy régi mentés törlés',
    (scenario) => {
      const result = runFixture(scenario)
      expect(result.status).not.toBe(0)
      expect(result.files.sort()).toEqual([result.oldDump, 'unrelated.txt'].sort())
      expect(result.output).not.toContain('mentés kész és ellenőrizve')
      expect(result.output).not.toContain('Kész:')
      expect(result.output).not.toContain('DUMMY-NOT-A-REAL-PASSWORD')
      expect(result.output).not.toContain('postgresql://')
    },
  )

  it.each(['dump-fails', 'toc-fails'] as const)(
    '%s: a teljes dekódolásig sem jut, korábbi fájlok megmaradnak',
    (scenario) => {
      const result = runFixture(scenario)
      expect(result.status).not.toBe(0)
      expect(result.invocations).toHaveLength(scenario === 'dump-fails' ? 1 : 2)
      expect(result.files.sort()).toEqual([result.oldDump, 'unrelated.txt'].sort())
    },
  )
})
