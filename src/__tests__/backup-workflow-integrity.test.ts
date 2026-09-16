import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const workflowPath = fileURLToPath(
  new URL('../../.github/workflows/db-backup.yml', import.meta.url),
)
const pinnedImage =
  'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2'

function integrityScript(source: string): string {
  const afterId = source.slice(source.indexOf('        id: integrity\n'))
  const run = afterId.indexOf('        run: |\n')
  if (run < 0) throw new Error('Az integrity run blokk hiányzik')
  return afterId
    .slice(run + '        run: |\n'.length)
    .split('\n')
    .filter((line, index, lines) => index < lines.findIndex((item) => /^      - name:/.test(item)))
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n')
}

/** Valós workflow shell, fake docker; hálózati/PG folyamat egyáltalán nem indul. */
function runIntegrity(script: string, decodeFails: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'kineticare-backup-workflow-test-'))
  const bin = join(root, 'bin')
  const calls = join(root, 'calls')
  const output = join(root, 'output')
  mkdirSync(bin)
  const docker = join(bin, 'docker')
  writeFileSync(
    docker,
    `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n')
const restore = args.indexOf('pg_restore')
if (restore < 0) process.exit(65)
if (args[restore + 1] === '--list') process.stdout.write('1; 0 0 TABLE DATA public synthetic fixture\\n')
else if (${JSON.stringify(decodeFails)}) process.exit(1)
`,
    { mode: 0o700 },
  )
  chmodSync(docker, 0o700)
  try {
    const result = spawnSync('/bin/bash', ['-c', script], {
      cwd: root,
      env: {
        NODE_ENV: 'test',
        PATH: `${bin}:/usr/bin:/bin`,
        FILE: 'DUMMY.dump',
        PG_IMAGE: pinnedImage,
        GITHUB_OUTPUT: output,
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.error) throw result.error
    return {
      status: result.status,
      calls: existsSync(calls)
        ? readFileSync(calls, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as string[])
        : [],
      output: existsSync(output) ? readFileSync(output, 'utf8') : '',
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function assertSafeIntegrity(script: string): void {
  const good = runIntegrity(script, false)
  expect(good.status).toBe(0)
  expect(good.calls).toHaveLength(2)
  for (const args of good.calls) {
    expect(args[args.indexOf('--network') + 1]).toBe('none')
    expect(args[args.indexOf('--volume') + 1]).toMatch(/:\/backups:ro$/)
    expect(args).not.toContain('--env')
    expect(args).not.toContain('--env-file')
    expect(args).toContain(pinnedImage)
  }
  expect(good.calls[0].slice(good.calls[0].indexOf('pg_restore'))).toEqual([
    'pg_restore',
    '--list',
    '/backups/DUMMY.dump',
  ])
  expect(good.calls[1].slice(good.calls[1].indexOf('pg_restore'))).toEqual([
    'pg_restore',
    '--file=/dev/null',
    '/backups/DUMMY.dump',
  ])
  expect(good.output).toContain('entries=1')
  const failed = runIntegrity(script, true)
  expect(failed.status).not.toBe(0)
  expect(failed.output).not.toContain('entries=')
}

describe('backup workflow: teljes, adatbázis- és hálózatmentes decode kapu', () => {
  it('a tényleges shell sikernél továbbenged, decode hibánál nem ír siker-outputot', () => {
    assertSafeIntegrity(integrityScript(readFileSync(workflowPath, 'utf8')))
  })

  it.each([
    ['kihagyott decode', 'pg_restore --file=/dev/null', 'pg_restore --list'],
    [
      'DB céllal bővített restore',
      'pg_restore --file=/dev/null',
      'pg_restore --dbname=DUMMY --file=/dev/null',
    ],
    ['részleges restore', 'pg_restore --file=/dev/null', 'pg_restore --data-only --file=/dev/null'],
    ['kikapcsolt hálózati őr', '--network none', '--network host'],
    [
      'lenyelt dekódolási hiba',
      'pg_restore --file=/dev/null "/backups/${FILE}"',
      'pg_restore --file=/dev/null "/backups/${FILE}" || true',
    ],
  ])('a szemantikai őr elutasítja: %s', (_, before, after) => {
    const script = integrityScript(readFileSync(workflowPath, 'utf8'))
    expect(script).toContain(before)
    const mutated = script.replace(before, after)
    expect(() => assertSafeIntegrity(mutated)).toThrow()
  })
})
