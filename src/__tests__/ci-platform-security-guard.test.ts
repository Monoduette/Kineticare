import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const WORKFLOWS = join(REPO, '.github', 'workflows')

const CI_POSTGRES =
  'postgres:18@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280'
const BACKUP_POSTGRES =
  'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2'

// Ezek teljes UTF-8 fájl-hashek, nem YAML-normalizált reprezentációk. Emiatt
// bármilyen bájtváltozás (komment, formázás, CRLF, tag vagy extra dokumentum is)
// tudatos security review-t és az allowlist explicit frissítését igényli.
const EXPECTED_WORKFLOW_SHA256 = new Map<string, string>([
  ['ci.yml', '53d4c7c56faf61a4078ee94685df7294ea723fe70ec8a9b5cae73ff6163cc1f9'],
  ['claude.yml', '10e8ff4c055d47a9b9db6e9f828ca6defb72b514038f654358b6511cd58672ac'],
  ['db-backup.yml', '2e94e224cf6e5a444f297b8ac9a1ec790b4bf8334f0f9519b9baf694fedcc3f5'],
  ['gitleaks.yml', '2a6373e1fd6922147e77003bf3a19b560fc8068160e1ce224b783f57f73dbae9'],
])

const EXPECTED_PACKAGE_PINS: Readonly<Record<string, string>> = {
  '@eslint/eslintrc': '3.3.6',
  '@payloadcms/db-postgres': '3.88.0',
  '@payloadcms/next': '3.88.0',
  '@payloadcms/plugin-ecommerce': '3.88.0',
  '@payloadcms/plugin-form-builder': '3.88.0',
  '@payloadcms/richtext-lexical': '3.88.0',
  '@payloadcms/translations': '3.88.0',
  '@types/json-schema': '7.0.15',
  '@types/node': '24.13.3',
  '@types/react': '19.2.18',
  '@types/react-dom': '19.2.4',
  eslint: '9.39.5',
  'eslint-config-next': '16.3.3',
  graphql: '16.14.2',
  next: '16.3.3',
  payload: '3.88.0',
  'posthog-js': '1.413.3',
  prettier: '3.9.6',
  react: '19.2.8',
  'react-dom': '19.2.8',
  sass: '1.77.4',
  sharp: '0.35.3',
  tsx: '4.23.12',
  typescript: '5.9.3',
  vite: '8.2.1',
  vitest: '4.1.10',
}

interface PackageManifest {
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly engines?: Record<string, string>
}

interface PackageLock {
  readonly packages?: Record<string, PackageManifest>
}

interface WorkflowMutation {
  readonly label: string
  readonly file: string
  readonly mutate: (source: string) => string
}

function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex')
}

function workflowBytes(name: string): Buffer {
  return readFileSync(join(WORKFLOWS, name))
}

function workflow(name: string): string {
  return workflowBytes(name).toString('utf8')
}

function violationsForWorkflowBytes(name: string, input: Buffer | string): string[] {
  const expected = EXPECTED_WORKFLOW_SHA256.get(name)
  if (expected === undefined) return [`${name}: nincs jóváhagyott workflow hash`]
  const actual = sha256(input)
  return actual === expected
    ? []
    : [`${name}: workflow byte hash eltérés (várt: ${expected}, kapott: ${actual})`]
}

function replaceRequired(source: string, before: string, after: string): string {
  if (!source.includes(before)) throw new Error(`A mutáció forrásmintája hiányzik: ${before}`)
  return source.replace(before, after)
}

function insertBefore(source: string, marker: string, insertion: string): string {
  return replaceRequired(source, marker, `${insertion}${marker}`)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function exactPinnedDependencies(manifest: PackageManifest): Record<string, string> {
  return { ...manifest.dependencies, ...manifest.devDependencies }
}

function extractDumpDockerInvocation(source: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'docker run --rm \\')
  const end = lines.findIndex((line, index) => index > start && line.trim() === "sh -ceu '")
  if (start < 0 || end < 0) throw new Error('A dump docker run blokk nem található')
  return lines.slice(start, end + 1).join('\n')
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source, { encoding: 'utf8', mode: 0o755 })
  chmodSync(path, 0o755)
}

function runFakeBackup(invocation: string): {
  readonly args: string[]
  readonly dump: string
  readonly encrypted: string
  readonly dumpMode: number
} {
  const root = mkdtempSync(join(tmpdir(), 'kineticare-backup-owner-'))
  const bin = join(root, 'bin')
  const backups = join(root, 'backups')
  const argsFile = join(root, 'docker-args')
  const accessState = join(root, 'docker-access-state')
  const dump = join(backups, 'kineticare-test.dump')
  const encrypted = `${dump}.age`
  mkdirSync(bin)
  mkdirSync(backups)

  writeExecutable(
    join(bin, 'id'),
    `#!/bin/sh
case "\${1:-}" in
  -u) printf '%s\\n' 1234 ;;
  -g) printf '%s\\n' 5678 ;;
  *) exit 64 ;;
esac
`,
  )
  writeExecutable(
    join(bin, 'docker'),
    `#!/bin/sh
set -eu
: > "\${FAKE_DOCKER_ARGS}"
runner_id=''
while [ "\$#" -gt 0 ]; do
  printf '%s\\n' "\$1" >> "\${FAKE_DOCKER_ARGS}"
  if [ "\$1" = '--user' ] && [ "\$#" -gt 1 ]; then
    shift
    runner_id="\$1"
    printf '%s\\n' "\$1" >> "\${FAKE_DOCKER_ARGS}"
  fi
  shift
done
umask 077
printf 'custom-format-dump\\n' > "\${FAKE_DUMP_PATH}"
if [ "\${runner_id}" = "\${FAKE_RUNNER_ID}" ]; then
  printf 'readable\\n' > "\${FAKE_DOCKER_ACCESS_STATE}"
else
  printf 'wrong-owner\\n' > "\${FAKE_DOCKER_ACCESS_STATE}"
fi
`,
  )
  writeExecutable(
    join(bin, 'age'),
    `#!/bin/sh
set -eu
output=''
input=''
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --recipient) shift 2 ;;
    --output) output="\$2"; shift 2 ;;
    *) input="\$1"; shift ;;
  esac
done
IFS= read -r access_state < "\${FAKE_DOCKER_ACCESS_STATE}"
[ "\${access_state}" = 'readable' ]
[ -r "\${input}" ]
printf 'age-encrypted\\n' > "\${output}"
`,
  )

  const safeInvocation = replaceRequired(invocation, "sh -ceu '", "sh -ceu 'exit 0'")
  try {
    execFileSync(
      '/bin/sh',
      [
        '-ceu',
        `${safeInvocation}
age --recipient age1publictestrecipient --output "\${FAKE_ENCRYPTED_PATH}" "\${FAKE_DUMP_PATH}"`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:/usr/bin:/bin`,
          FILE: 'kineticare-test.dump',
          PG_IMAGE: BACKUP_POSTGRES,
          FAKE_DOCKER_ARGS: argsFile,
          FAKE_DOCKER_ACCESS_STATE: accessState,
          FAKE_DUMP_PATH: dump,
          FAKE_ENCRYPTED_PATH: encrypted,
          FAKE_RUNNER_ID: '1234:5678',
        },
        stdio: 'pipe',
      },
    )
    accessSync(dump, constants.R_OK)
    accessSync(encrypted, constants.R_OK)
    return {
      args: readFileSync(argsFile, 'utf8').trimEnd().split('\n'),
      dump: readFileSync(dump, 'utf8'),
      encrypted: readFileSync(encrypted, 'utf8'),
      dumpMode: statSync(dump).mode & 0o777,
    }
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

const mutations: readonly WorkflowMutation[] = [
  {
    label: 'root permissions módosítás',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, 'permissions: {}', 'permissions: { contents: write }'),
  },
  {
    label: 'job permissions felülírás',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        '  backup:\n    name:',
        '  backup:\n    permissions: { contents: write }\n    name:',
      ),
  },
  {
    label: 'mutable CI image',
    file: 'ci.yml',
    mutate: (source) => replaceRequired(source, CI_POSTGRES, 'postgres:18'),
  },
  {
    label: 'mutable backup image',
    file: 'db-backup.yml',
    mutate: (source) => replaceRequired(source, BACKUP_POSTGRES, 'postgres:18-alpine'),
  },
  {
    label: 'action tag ref',
    file: 'ci.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        'actions/checkout@v7',
      ),
  },
  {
    label: 'idézett mutable action',
    file: 'ci.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        'uses: "actions/checkout@v7"',
      ),
  },
  {
    label: 'flow-style mutable action',
    file: 'ci.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        '- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '- { uses: actions/checkout@v7 }',
      ),
  },
  {
    label: 'folded mutable action',
    file: 'ci.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        'uses: >-\n          actions/checkout@v7',
      ),
  },
  {
    label: 'run parancs módosítás',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        'pg_dump --format=custom --file="${DUMP_TARGET}"',
        'pg_dump --dbname="${DATABASE_URI}" --format=custom --file="${DUMP_TARGET}"',
      ),
  },
  {
    label: 'extra step',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        '    steps:\n',
        '    steps:\n      - name: Nem jóváhagyott lépés\n        run: true\n',
      ),
  },
  {
    label: 'comment-only változás',
    file: 'db-backup.yml',
    mutate: (source) => `${source}# guard bypass comment\n`,
  },
  {
    label: 'CRLF normalizálás',
    file: 'db-backup.yml',
    mutate: (source) => source.replaceAll('\n', '\r\n'),
  },
  {
    label: '.nan scalar',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, '  workflow_dispatch:', '  workflow_dispatch: .nan'),
  },
  {
    label: '.inf scalar',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, '  workflow_dispatch:', '  workflow_dispatch: .inf'),
  },
  {
    label: 'explicit YAML tag',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, '  workflow_dispatch:', '  workflow_dispatch: !unsafe null'),
  },
  {
    label: 'multi-document YAML',
    file: 'db-backup.yml',
    mutate: (source) => `${source}---\npermissions: write-all\n`,
  },
  {
    label: 'feltételes mutable docker run',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        '          if true; then docker run postgres:18-alpine true; fi\n',
      ),
  },
  {
    label: 'semicolon mutable docker pull',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        '          :; docker pull postgres:18-alpine\n',
      ),
  },
  {
    label: 'command docker wrapper',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        '          command docker run postgres:18-alpine true\n',
      ),
  },
  {
    label: 'command sh wrapper',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        "          command sh -c 'docker run postgres:18-alpine true'\n",
      ),
  },
  {
    label: 'nice sh wrapper',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        "          nice sh -c 'docker run postgres:18-alpine true'\n",
      ),
  },
  {
    label: 'bash stdin wrapper',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        "          bash <<< 'docker run postgres:18-alpine true'\n",
      ),
  },
  {
    label: 'env -S wrapper',
    file: 'db-backup.yml',
    mutate: (source) =>
      insertBefore(
        source,
        '          docker pull --quiet "${PG_IMAGE}"',
        '          env -S "sh -c \'docker run postgres:18-alpine true\'"\n',
      ),
  },
  {
    label: 'wildcard artifact',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        'path: backups/${{ steps.encrypt.outputs.encrypted_file }}',
        'path: backups/*',
      ),
  },
  {
    label: 'no-op plaintext cleanup',
    file: 'db-backup.yml',
    mutate: (source) => replaceRequired(source, 'rm -f backups/*.dump toc.txt', ': # no cleanup'),
  },
  {
    label: 'comment-only plaintext cleanup',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, 'rm -f backups/*.dump toc.txt', '# rm -f backups/*.dump toc.txt'),
  },
  {
    label: 'cleanup always eltávolítása',
    file: 'db-backup.yml',
    mutate: (source) => replaceRequired(source, '        if: always()', '        if: success()'),
  },
  {
    label: 'continue-on-error',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        '      - name: Mentés feltöltése artifactként',
        '      - name: Mentés feltöltése artifactként\n        continue-on-error: true',
      ),
  },
  {
    label: 'job PG_IMAGE override',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        '  backup:\n    name:',
        '  backup:\n    env:\n      PG_IMAGE: postgres:18-alpine\n    name:',
      ),
  },
  {
    label: 'step PG_IMAGE override',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(
        source,
        '        env:\n          DATABASE_URI:',
        '        env:\n          PG_IMAGE: postgres:18-alpine\n          DATABASE_URI:',
      ),
  },
  {
    label: 'service file unset eltávolítása',
    file: 'db-backup.yml',
    mutate: (source) => replaceRequired(source, '              unset DATABASE_URI\n', ''),
  },
  {
    label: 'service file engedély lazítása',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, 'chmod 0600 "${SERVICE_FILE}"', 'chmod 0644 "${SERVICE_FILE}"'),
  },
  {
    label: 'service file cleanup eltávolítása',
    file: 'db-backup.yml',
    mutate: (source) =>
      replaceRequired(source, 'rm -f -- "${SERVICE_FILE}"', ': # service file retained'),
  },
  {
    label: 'runner UID:GID eltávolítása',
    file: 'db-backup.yml',
    mutate: (source) => replaceRequired(source, '            --user "$(id -u):$(id -g)" \\\n', ''),
  },
]

describe('CI/platform supply-chain guard', () => {
  it('byte-for-byte engedélyezi kizárólag a négy review-zott workflow-t', () => {
    const files = readdirSync(WORKFLOWS)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort()
    expect(files).toEqual([...EXPECTED_WORKFLOW_SHA256.keys()].sort())
    for (const file of files) {
      expect(violationsForWorkflowBytes(file, workflowBytes(file)), file).toEqual([])
    }
  })

  it.each(mutations)('$label mutációt fail-closed elutasítja', ({ file, mutate }) => {
    expect(violationsForWorkflowBytes(file, mutate(workflow(file)))).not.toEqual([])
  })

  it('a jóváhagyott action és image pinek a hash-elt workflow-k részei', () => {
    expect(workflow('ci.yml')).toContain(CI_POSTGRES)
    expect(workflow('db-backup.yml')).toContain(BACKUP_POSTGRES)
    expect(workflow('claude.yml')).toContain(
      'anthropics/claude-code-action@a874e9ecd7bb36efdad65429c6b35815f5a08f10 # v1.0.210',
    )
    expect(workflow('gitleaks.yml')).toContain(
      'gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0',
    )
  })

  it('stdlib JSON parse alapján őrzi az exact package pineket yaml direct dependency nélkül', () => {
    const manifest = readJson<PackageManifest>(join(REPO, 'package.json'))
    const lock = readJson<PackageLock>(join(REPO, 'package-lock.json'))
    const dependencies = exactPinnedDependencies(manifest)
    expect(manifest.engines?.node).toBe('24.x')
    expect(dependencies).toEqual(EXPECTED_PACKAGE_PINS)
    expect(dependencies.yaml).toBeUndefined()
    expect(lock.packages?.['']?.dependencies?.yaml).toBeUndefined()
    expect(lock.packages?.['']?.devDependencies?.yaml).toBeUndefined()
    for (const [name, version] of Object.entries(dependencies)) {
      expect(version, `${name} csak exact verzióval engedélyezett`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('a dump konténer runner UID:GID-ja miatt a host age olvasni tudja a 0600-as fájlt', () => {
    const source = workflow('db-backup.yml')
    expect(source.match(/--user "\$\(id -u\):\$\(id -g\)"/g)).toHaveLength(2)
    const result = runFakeBackup(extractDumpDockerInvocation(source))
    const userIndex = result.args.indexOf('--user')
    expect(userIndex).toBeGreaterThanOrEqual(0)
    expect(result.args[userIndex + 1]).toBe('1234:5678')
    expect(result.args).toContain('--env')
    expect(result.args).toContain('DATABASE_URI')
    expect(result.dumpMode).toBe(0o600)
    expect(result.dump).toBe('custom-format-dump\n')
    expect(result.encrypted).toBe('age-encrypted\n')
  })

  it('a fake runtime elutasítja a runner UID:GID nélküli dumpot az age előtt', () => {
    const invocation = extractDumpDockerInvocation(workflow('db-backup.yml'))
    const unsafe = replaceRequired(invocation, '            --user "$(id -u):$(id -g)" \\\n', '')
    expect(() => runFakeBackup(unsafe)).toThrow()
  })
})
