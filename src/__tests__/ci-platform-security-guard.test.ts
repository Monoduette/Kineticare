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
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  ['ci.yml', 'eef8b6a214d03b4833d57f40b25408fff05897da7cce064251f9fd8527fc8a6e'],
  ['claude.yml', '10e8ff4c055d47a9b9db6e9f828ca6defb72b514038f654358b6511cd58672ac'],
  ['db-backup.yml', '15adb4fa8c0b8582a58916e46400d7670126a746c9d39b2e55670eb42affd388'],
  ['gitleaks.yml', '2a6373e1fd6922147e77003bf3a19b560fc8068160e1ce224b783f57f73dbae9'],
])

const EXPECTED_NPMRC_SHA256 = '9379a4a8600c5bfbd8680df911b23cec5aa55969d6c8e828f1aa8b10ecb64770'
const EXPECTED_INSTALL_VERIFIER_SHA256 =
  'faefc53ab07948c40cbaa42e525553740685742338bf3e1cdc150b55e8092565'
const EXPECTED_EXACT_NPM_CLI_SHA256 =
  'b548d388e4f0d7f6997733c925890a95f386e74c4cdf657b6f3c625e785398c6'
const EXPECTED_INSTALL_VERIFIER_CHECKSUM_SHA256 =
  'a6c2b3abce950fb6e4a94ecd13cd728f792ca98d266a447d2481a8c0fd730f43'
const EXPECTED_REVIEWED_INSTALLER_SHA256 =
  '4d27e583b9b89d4c25a77af0a357891f3853e61de4b25036d76404ac4aadf558'
const EXPECTED_RAILWAY_SHA256 = '022685c41dba4b05b923da71a81b0a1ba59caa2efd8369bdf6af962fbf39021f'
const EXPECTED_RAILPACK_SHA256 = 'c452a63293e7a5b23377b4eb41ac4f5923b9d5235e3d9ff7c1262c578f8a10cf'
const EXPECTED_RAILPACK_PLAN_SHA256 =
  'dc91bfecd80be1e5ff7d4aed76c2f8148165cc4edb8aea2bff4e3555838b6003'
const EXPECTED_RAILPACK_PLAN_VERIFIER_SHA256 =
  '98ff5a6805798ad69b429a6c2b8835ecd6c3ca628e5a47f3fbde0c847196fe51'

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
  'posthog-js': '1.422.5',
  prettier: '3.9.6',
  react: '19.2.8',
  'react-dom': '19.2.8',
  sass: '1.103.1',
  sharp: '0.35.4',
  tsx: '4.23.12',
  'tus-js-client': '4.3.1',
  typescript: '5.9.3',
  vite: '8.2.1',
  vitest: '4.1.11',
}

const EXPECTED_INSTALL_SCRIPT_IDENTITIES: Readonly<Record<string, string>> = {
  'node_modules/@parcel/watcher':
    '002e2fffdb293f2d137d00f91eeeea833df98d35c2312510774062caceeca5d4',
  'node_modules/@payloadcms/graphql/node_modules/esbuild':
    'f11b2e7569a85e47a2d781b846a417de6f5c44eef72c4916fe01ecabfbe8f93d',
  'node_modules/core-js': 'ef81b90dec6e13367feab03b87f65de9daf7b1389be238c44c8888ef52dcab3e',
  'node_modules/esbuild': '73c0c75c0ea247dc6a5b1f0470bb203a849c28d1de4d889207ffa1abb88596e8',
  'node_modules/fsevents': 'c470ce7eb5ad9039b266026905f8ebf74d886b12acef87d82be31903eab06df1',
  'node_modules/payload/node_modules/esbuild':
    '6d5bb7c6d6a05e7ea9b1e202962d9fc160c71de54a66c1530808ed01fe1ae97f',
  'node_modules/tsx/node_modules/esbuild':
    '6d5bb7c6d6a05e7ea9b1e202962d9fc160c71de54a66c1530808ed01fe1ae97f',
  'node_modules/unrs-resolver': '430b66aedb54b3da13317c57d0a36a01dfe1ba729b7b15768eb987796c3f5df9',
}

const EXPECTED_INSTALL_SCRIPT_APPROVALS: Readonly<Record<string, boolean>> = {
  '@parcel/watcher@2.6.0': true,
  'core-js@3.50.0': true,
  'esbuild@0.25.12': true,
  'esbuild@0.28.1': true,
  'esbuild@0.28.2': true,
  'fsevents@2.3.3': true,
  'unrs-resolver@1.12.2': true,
}

interface PackageManifest {
  readonly allowScripts?: Record<string, boolean>
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly engines?: Record<string, string>
  readonly hasInstallScript?: boolean
  readonly integrity?: string
  readonly resolved?: string
  readonly version?: string
}

interface PackageLock {
  readonly packages?: Record<string, PackageManifest>
}

interface RailpackCommand {
  readonly cmd?: string
  readonly dest?: string
  readonly path?: string
  readonly src?: string
}

interface RailpackPlan {
  readonly deploy?: {
    readonly startCommand?: string
    readonly variables?: Record<string, string>
  }
  readonly steps?: Array<{
    readonly assets?: Record<string, string>
    readonly commands?: RailpackCommand[]
    readonly inputs?: Array<{
      readonly include?: string[]
      readonly local?: boolean
      readonly step?: string
    }>
    readonly name?: string
  }>
}

interface WorkflowMutation {
  readonly label: string
  readonly file: string
  readonly mutate: (source: string) => string
}

function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex')
}

function verifySha256Manifest(source: string, expectedTargets: string[]): string[] {
  const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : []
  const matches = lines.map((line) => line.match(/^([a-f0-9]{64})  ([^\n]+)$/))
  if (
    matches.length !== expectedTargets.length ||
    matches.some((match, index) => match === null || match[2] !== expectedTargets[index])
  ) {
    throw new Error('SHA-256 manifest format or target mismatch')
  }
  for (const [index, target] of expectedTargets.entries()) {
    const actual = sha256(readFileSync(join(REPO, target)))
    if (actual !== matches[index]?.[1]) throw new Error('SHA-256 manifest digest mismatch')
  }
  return expectedTargets
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

function cursorStartRuntimeViolations(source: string): string[] {
  const requiredInOrder = [
    "NODE_VERSION='24.20.0'",
    "NPM_VERSION='11.19.0'",
    'node_home="/opt/node-v${NODE_VERSION}-linux-${node_arch}"',
    'export PATH="${node_home}/bin:/usr/bin:$PATH"',
    'if [ "$(command -v node)" != "${node_home}/bin/node" ]; then',
    'if [ "$(node --version)" != "v${NODE_VERSION}" ] || [ "$(npm --version)" != "$NPM_VERSION" ]; then',
    './node_modules/.bin/payload migrate',
  ]
  const positions = requiredInOrder.map((value) => source.indexOf(value))
  const violations: string[] = []

  if (positions.some((position) => position < 0)) violations.push('exact runtime elem hiányzik')
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    violations.push('exact runtime ellenőrzési sorrend eltér')
  }
  if (!source.includes("x86_64) node_arch='x64' ;;")) violations.push('x64 arch mapping hiányzik')
  if (!source.includes("aarch64 | arm64) node_arch='arm64' ;;")) {
    violations.push('arm64 arch mapping hiányzik')
  }
  if (source.includes('export PATH="/usr/bin:$PATH"')) violations.push('/usr/bin bypass aktív')
  return violations
}

function cursorInstallRuntimeViolations(source: string): string[] {
  const requiredInOrder = [
    "NODE_VERSION='24.20.0'",
    "NPM_VERSION='11.19.0'",
    'node_home="/opt/node-v${NODE_VERSION}-linux-${node_arch}"',
    'if [ ! -x "${node_home}/bin/node" ] || [ ! -x "${node_home}/bin/npm" ]; then',
    'export PATH="${node_home}/bin:/usr/bin:$PATH"',
    'if [ "$(command -v node)" != "${node_home}/bin/node" ]; then',
    'if [ "$(command -v npm)" != "${node_home}/bin/npm" ]; then',
    'if [ "$(node --version)" != "v${NODE_VERSION}" ] || [ "$(npm --version)" != "$NPM_VERSION" ]; then',
    '"${node_home}/bin/node" scripts/install-reviewed-dependencies.mjs',
  ]
  const positions = requiredInOrder.map((value) => source.indexOf(value))
  const violations: string[] = []

  if (positions.some((position) => position < 0))
    violations.push('exact install runtime elem hiányzik')
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    violations.push('exact install runtime ellenőrzési sorrend eltér')
  }
  return violations
}

function reviewedInstallerViolations(source: string): string[] {
  const requiredInOrder = [
    "const NODE_VERSION = '24.20.0'",
    "const NPM_VERSION = '11.19.0'",
    'const npmChildEnv = exactNodeChildEnv()',
    'execFileSync(process.execPath, [npmCliPath, ...args],',
    'env: npmChildEnv',
    "runNpm(['ci', '--legacy-peer-deps', '--ignore-scripts'])",
    '\nverifyInstallVerifier()\n',
    "runNode(['scripts/verify-install-script-lock.mjs'])",
    "runNpm([\n  'rebuild',",
    "'--strict-allow-scripts=true'",
    "'--dangerously-allow-all-scripts=false'",
  ]
  const positions = requiredInOrder.map((value) => source.indexOf(value))
  const violations: string[] = []

  if (positions.some((position) => position < 0)) violations.push('reviewed install elem hiányzik')
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    violations.push('reviewed install sorrend eltér')
  }
  return violations
}

function railpackPlanVerifierViolations(source: string): string[] {
  const requiredInOrder = [
    "RAILPACK_VERSION='0.38.0'",
    "RAILPACK_CHECKSUMS_SHA256='69d58f46c00048b1ccddc35151842cfa393d88ad06e5d376e7a2f4bcc8aabb89'",
    'platform_key="$(uname -s):$(uname -m)"',
    'Linux:x86_64)',
    'Darwin:arm64 | Darwin:aarch64)',
    "curl --fail --silent --show-error --location --proto '=https' --tlsv1.2",
    'verify_sha256 "$RAILPACK_CHECKSUMS_SHA256" "$checksums_path"',
    'grep -Fqx -- "$RAILPACK_ARCHIVE_SHA256  $RAILPACK_ARCHIVE" "$checksums_path"',
    'verify_sha256 "$RAILPACK_ARCHIVE_SHA256" "$archive_path"',
    'tar -xzf "$archive_path" -C "$tmp_dir" railpack',
    '"$tmp_dir/railpack" plan --out "$generated_plan" "$repo_dir"',
    'verify_plan_semantics "$generated_plan"',
    'if [ "$platform_key" = "Linux:x86_64" ]; then',
    'cmp -s "$generated_plan" "$expected_plan"',
  ]
  const positions = requiredInOrder.map((value) => source.indexOf(value))
  const violations: string[] = []

  if (positions.some((position) => position < 0)) violations.push('pinned verifier elem hiányzik')
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    violations.push('download/checksum/execution sorrend eltér')
  }
  if (!source.includes('/releases/download/v${RAILPACK_VERSION}/${RAILPACK_ARCHIVE}')) {
    violations.push('official pinned release URL hiányzik')
  }
  for (const nonPortableOption of [
    '--fixed-strings',
    '--line-regexp',
    '--extended-regexp',
    '--quiet',
  ]) {
    if (new RegExp(`grep [^\\n]*${nonPortableOption}`).test(source)) {
      violations.push(`nem hordozható grep opció: ${nonPortableOption}`)
    }
  }
  if (source.includes('cmp --silent')) violations.push('nem hordozható cmp opció: --silent')
  for (const [archive, digest] of [
    [
      'railpack-v0.38.0-x86_64-unknown-linux-musl.tar.gz',
      '7c3f0e70ca8bf80bde87e8c30cb0171414c2b6bbd794d6f60a19cc3b71772950',
    ],
    [
      'railpack-v0.38.0-arm64-unknown-linux-musl.tar.gz',
      'd33716e87f0e39314898746c806e26d9edde890ac65156891b2f06c8d07ba8c4',
    ],
    [
      'railpack-v0.38.0-x86_64-apple-darwin.tar.gz',
      '82609c2224df5cb4ac8ec6f0687480f1448f419ca3c7f81f9b73be645820d3af',
    ],
    [
      'railpack-v0.38.0-arm64-apple-darwin.tar.gz',
      '6a66b44942884bfcc6038c559c48083d2bdc79f9e20306fcd5fe0d915fef2877',
    ],
  ]) {
    if (!source.includes(archive) || !source.includes(digest)) {
      violations.push(`pinned native asset hiányzik: ${archive}`)
    }
  }
  return violations
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

function installScriptIdentities(lock: PackageLock): Record<string, string> {
  return Object.fromEntries(
    Object.entries(lock.packages ?? {})
      .filter(([, manifest]) => manifest.hasInstallScript === true)
      .map(([path, manifest]) => [
        path,
        sha256(`${manifest.version}\n${manifest.resolved}\n${manifest.integrity}`),
      ]),
  )
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

it('the reviewed esbuild override preserves core-utils and Drizzle schema loading', () => {
  const fixture = mkdtempSync(join(REPO, '.loader-compat-'))
  const schema = [
    "import { pgTable, integer, text } from 'drizzle-orm/pg-core'",
    "enum Label { Ready = 'ready' }",
    "export const probe = pgTable('dependency_probe', {",
    '  id: integer().primaryKey(),',
    '  label: text().notNull().default(Label.Ready),',
    '})',
  ].join('\n')
  const harness = `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    import { readFileSync } from 'node:fs'
    import { pathToFileURL } from 'node:url'
    import vm from 'node:vm'
    const require = createRequire(import.meta.url)
    const core = require('@esbuild-kit/core-utils')
    const coreRequire = createRequire(require.resolve('@esbuild-kit/core-utils'))
    assert.equal(coreRequire('esbuild').version, '0.25.12')
    const source = 'enum Value { Answer = 42 }\\nexport const answer: number = Value.Answer;'
    for (const asyncMode of [false, true]) {
      for (const format of ['cjs', 'esm']) {
        const path = ${JSON.stringify(fixture)} + '/transform-' + asyncMode + '-' + format + '.ts'
        // transformSync defaults to a CJS wrapper; ESM exports must stay top-level.
        const options = format === 'esm' ? { format, banner: '', footer: '' } : { format }
        const result = asyncMode
          ? await core.transform(source, path, options)
          : core.transformSync(source, path, options)
        assert.equal(result.map.version, 3)
        assert.deepEqual(result.map.sources, [path])
        assert.deepEqual(result.map.sourcesContent, [source])
        assert.ok(result.map.mappings.length > 0)
        if (format === 'cjs') {
          const context = { module: { exports: {} } }
          vm.runInNewContext(result.code, context)
          assert.equal(context.module.exports.answer, 42)
        } else {
          const loaded = await import('data:text/javascript;base64,' + Buffer.from(result.code).toString('base64'))
          assert.equal(loaded.answer, 42)
        }
      }
    }
    assert.throws(() => core.transformSync('const broken: = ;', 'broken.ts'))
    await assert.rejects(core.transform('const broken: = ;', 'broken.mts'))
    const { register } = require('esbuild-register/dist/node')
    const { unregister } = register({ target: 'es2022', format: 'cjs' })
    const cjsSchema = require('./schema.cts')
    unregister()
    const esmSchema = await import(pathToFileURL(${JSON.stringify(join(fixture, 'schema.mts'))}).href)
    const { generateDrizzleJson } = require('drizzle-kit/api')
    for (const loaded of [cjsSchema, esmSchema]) {
      const snapshot = generateDrizzleJson(loaded)
      const table = snapshot.tables['public.dependency_probe']
      assert.ok(table)
      assert.equal(table.columns.id.primaryKey, true)
      assert.equal(table.columns.label.notNull, true)
      assert.equal(table.columns.label.default, "'ready'")
    }
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
    assert.ok(!Object.entries(lock.packages).some(([path, entry]) =>
      path.endsWith('/esbuild') && entry.version === '0.18.20'))
    console.log('core-utils transforms, sourcemaps, CJS/ESM schema loaders: PASS')
  `
  try {
    writeFileSync(join(fixture, 'schema.cts'), schema)
    writeFileSync(join(fixture, 'schema.mts'), schema)
    writeFileSync(join(fixture, 'probe.mjs'), harness)
    const output = execFileSync(
      process.execPath,
      [
        '--no-experimental-strip-types',
        '--loader',
        '@esbuild-kit/esm-loader',
        join(fixture, 'probe.mjs'),
      ],
      {
        cwd: fixture,
        env: { ...process.env, ESBK_DISABLE_CACHE: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    )
    expect(output).toContain('core-utils transforms, sourcemaps, CJS/ESM schema loaders: PASS')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}, 35_000)

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
  it('a valódi PG18 archívumpróba kötelező és az alkalmazási DB-env előtt fut', () => {
    const ci = workflow('ci.yml')
    const fixture = ci.indexOf('      - name: PG18 archive full-decode regression\n')
    const databaseEnv = ci.indexOf('      - name: Teszt-adatbázis env (nem titkok)\n')
    expect(fixture).toBeGreaterThan(
      ci.indexOf('"$node_exec" scripts/install-reviewed-dependencies.mjs'),
    )
    expect(fixture).toBeLessThan(databaseEnv)
    const nextStep = ci.indexOf('\n      - name:', fixture + 1)
    const step = ci.slice(fixture, nextStep)
    expect(step).toContain('KINETICARE_BACKUP_PG18_CONTAINER: ${{ job.services.postgres.id }}')
    expect(step).toContain('run: node --import tsx scripts/test-backup-archive-integrity.mjs')
    expect(step).not.toMatch(/continue-on-error|\|\|\s*true|\bif:/)
  })

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
    const ci = workflow('ci.yml')
    expect(ci).toContain('NODE_VERSION: "24.20.0"')
    expect(ci.match(/node_exec="\$\(realpath "\$\(command -v node\)"\)"/g)).toHaveLength(3)
    expect(
      ci.match(
        /test "\$node_exec" = "\$RUNNER_TOOL_CACHE\/node\/\$\{NODE_VERSION\}\/x64\/bin\/node"/g,
      ),
    ).toHaveLength(3)
    expect(ci.match(/test "\$\("\$node_exec" --version\)" = "v\$\{NODE_VERSION\}"/g)).toHaveLength(
      3,
    )
    expect(
      ci.match(
        /test "\$\("\$node_exec" -p 'require\("node:fs"\)\.realpathSync\(process\.execPath\)'\)" = "\$node_exec"/g,
      ),
    ).toHaveLength(3)
    expect(ci.match(/"\$node_exec" scripts\/install-reviewed-dependencies\.mjs/g)).toHaveLength(3)
    expect(ci).not.toContain('npm ci --legacy-peer-deps --ignore-scripts')
    expect(ci).not.toContain('node scripts/verify-install-script-lock.mjs')
    expect(ci).not.toContain('npm rebuild --ignore-scripts=false')
    expect(ci.match(/\.\/scripts\/verify-railpack-plan\.sh/g)).toHaveLength(1)
    expect(workflow('ci.yml')).toContain(CI_POSTGRES)
    expect(workflow('db-backup.yml')).toContain(BACKUP_POSTGRES)
    expect(workflow('claude.yml')).toContain(
      'anthropics/claude-code-action@a874e9ecd7bb36efdad65429c6b35815f5a08f10 # v1.0.210',
    )
    expect(workflow('gitleaks.yml')).toContain(
      'gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0',
    )
  })

  it('a fejlesztői bootstrap is kizárólag a lockfile-lokális Payload CLI-t futtatja', () => {
    const cursorStart = readFileSync(join(REPO, '.cursor', 'start.sh'), 'utf8')
    expect(cursorStartRuntimeViolations(cursorStart)).toEqual([])
    expect(cursorStart).toContain('./node_modules/.bin/payload migrate')
    expect(cursorStart).not.toMatch(/\bnpx\s+payload\b/)
  })

  it.each([
    ['exact Node lazítása', "NODE_VERSION='24.20.0'", "NODE_VERSION='24'"],
    ['exact npm lazítása', "NPM_VERSION='11.19.0'", "NPM_VERSION='11'"],
    [
      'exact /opt runtime bypass',
      'export PATH="${node_home}/bin:/usr/bin:$PATH"',
      'export PATH="/usr/bin:$PATH"',
    ],
  ])('a start.sh $0 mutációját fail-closed elutasítja', (_label, before, after) => {
    const cursorStart = readFileSync(join(REPO, '.cursor', 'start.sh'), 'utf8')
    expect(cursorStartRuntimeViolations(replaceRequired(cursorStart, before, after))).not.toEqual(
      [],
    )
  })

  it('a Cloud Agent install exact Node-dal ugyanazt a fail-closed lifecycle kaput futtatja', () => {
    const cursorInstall = readFileSync(join(REPO, '.cursor', 'install.sh'), 'utf8')
    const expectedOrder = [
      'curl -fsSLo "${node_tmp}/${node_archive}"',
      'printf \'%s  %s\\n\' "$node_sha256" "${node_tmp}/${node_archive}" | sha256sum --strict -c -',
      'sudo tar -xJf "${node_tmp}/${node_archive}" -C /opt',
      'if [ "$(node --version)" != "v${NODE_VERSION}" ] || [ "$(npm --version)" != "$NPM_VERSION" ]; then',
      '"${node_home}/bin/node" scripts/install-reviewed-dependencies.mjs',
    ]

    expect(cursorInstall).toContain("NODE_VERSION='24.20.0'")
    expect(cursorInstall).toContain("NPM_VERSION='11.19.0'")
    expect(cursorInstall).not.toContain('deb.nodesource.com')
    expect(cursorInstall).toContain(
      "node_sha256='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2'",
    )
    expect(cursorInstall).toContain(
      "node_sha256='5f4ddab610c1ab2016b3c227cebdbf6d9495161487e4739c7b90090595f465f7'",
    )
    expect(cursorInstall).toContain('"https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"')
    expect(cursorInstallRuntimeViolations(cursorInstall)).toEqual([])
    expect(expectedOrder.every((command) => cursorInstall.includes(command))).toBe(true)
    expect(expectedOrder.map((command) => cursorInstall.indexOf(command))).toEqual(
      [...expectedOrder]
        .map((command) => cursorInstall.indexOf(command))
        .sort((left, right) => left - right),
    )
  })

  it.each([
    [
      'hiányzó exact Node path',
      'if [ "$(command -v node)" != "${node_home}/bin/node" ]; then',
      'if false; then',
    ],
    [
      'hibás exact Node path',
      'if [ "$(command -v node)" != "${node_home}/bin/node" ]; then',
      'if [ "$(command -v node)" != "/usr/bin/node" ]; then',
    ],
    [
      'hiányzó exact npm path',
      'if [ "$(command -v npm)" != "${node_home}/bin/npm" ]; then',
      'if false; then',
    ],
    [
      'hibás exact npm path',
      'if [ "$(command -v npm)" != "${node_home}/bin/npm" ]; then',
      'if [ "$(command -v npm)" != "/usr/bin/npm" ]; then',
    ],
    [
      'ambient bootstrap launcher',
      '"${node_home}/bin/node" scripts/install-reviewed-dependencies.mjs',
      'node scripts/install-reviewed-dependencies.mjs',
    ],
  ])('az install.sh $0 mutációját fail-closed elutasítja', (_label, before, after) => {
    const cursorInstall = readFileSync(join(REPO, '.cursor', 'install.sh'), 'utf8')
    expect(
      cursorInstallRuntimeViolations(replaceRequired(cursorInstall, before, after)),
    ).not.toEqual([])
  })

  it('a helyi telepítés egyetlen review-zott fail-closed bootstrapot használ', () => {
    const installerBytes = readFileSync(join(REPO, 'scripts', 'install-reviewed-dependencies.mjs'))
    const installer = installerBytes.toString('utf8')
    expect(sha256(installerBytes)).toBe(EXPECTED_REVIEWED_INSTALLER_SHA256)
    expect(reviewedInstallerViolations(installer)).toEqual([])
    expect(installer.match(/env: npmChildEnv/g)).toHaveLength(3)
    expect(readFileSync(join(REPO, 'scripts', 'verify-install-script-lock.mjs'), 'utf8')).toContain(
      'env: exactNodeChildEnv()',
    )

    for (const guide of ['README.md', 'AGENTS.md']) {
      const source = readFileSync(join(REPO, guide), 'utf8')
      expect(source, guide).toContain('node scripts/install-reviewed-dependencies.mjs')
      expect(source, guide).not.toMatch(/\bnpm install\b/)
      expect(source, guide).toContain('Node 24.20.0')
      expect(source, guide).toContain('npm 11.19.0')
    }
  })

  it('az aktív operátori leírások sem tölthetnek le ambient Payload CLI-t', () => {
    const operationalGuides = [
      '.cursor/skills/verify-kineticare/SKILL.md',
      'docs/atadas-szamlazz-kor.md',
      'docs/tudastar-ux-terv.md',
      'docs/tudastar-technikai-terv.md',
    ]

    for (const guide of operationalGuides) {
      expect(readFileSync(join(REPO, guide), 'utf8'), guide).not.toMatch(/\bnpx\s+payload\b/)
    }

    const historicalReview = readFileSync(join(REPO, 'docs', 'owasp-security-review.md'), 'utf8')
    expect(historicalReview).toContain('A történeti parancsblokkok nem operatívak')
    expect(historicalReview).toContain('node scripts/install-reviewed-dependencies.mjs')
    expect(historicalReview).toContain('./node_modules/.bin/payload')
  })

  it('az install verifier hostile PATH mellett sem futtat ambient npm-et', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kineticare-hostile-npm-'))
    const fakeNpm = join(fixture, 'npm')
    const marker = join(fixture, 'ambient-npm-ran')
    writeExecutable(
      fakeNpm,
      `#!/bin/sh\nprintf 'called\\n' > ${JSON.stringify(marker)}\nprintf '11.19.0\\n'\n`,
    )

    try {
      const output = execFileSync(
        process.execPath,
        [join(REPO, 'scripts', 'verify-install-script-lock.mjs')],
        {
          cwd: REPO,
          encoding: 'utf8',
          env: { ...process.env, PATH: fixture },
        },
      )
      expect(output).toContain('Install-script lock verification passed.')
      expect(() => accessSync(marker)).toThrow()
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  })

  it('a mise bash npm wrapper helyett a prefix npm-cli.js-t futtatja', async () => {
    const prefix = mkdtempSync(join(tmpdir(), 'kineticare-mise-npm-'))
    const binDir = join(prefix, 'bin')
    const cliDir = join(prefix, 'lib', 'node_modules', 'npm', 'bin')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(cliDir, { recursive: true })
    const execPath = join(binDir, 'node')
    const wrapperPath = join(binDir, 'npm')
    const cliPath = join(cliDir, 'npm-cli.js')
    writeExecutable(execPath, '#!/bin/sh\nexit 0\n')
    writeExecutable(
      wrapperPath,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf "wrapper\\n"\nexit 97\n',
    )
    writeFileSync(cliPath, "#!/usr/bin/env node\nprocess.stdout.write('11.19.0\\n')\n", {
      encoding: 'utf8',
    })

    try {
      expect(() =>
        execFileSync(process.execPath, [wrapperPath, '--version'], { stdio: 'pipe' }),
      ).toThrow(/pipefail|Unexpected identifier/)
      const helperUrl = pathToFileURL(join(REPO, 'scripts', 'exact-npm-cli.mjs')).href
      const { resolveAdjacentNpmCli } = (await import(helperUrl)) as {
        resolveAdjacentNpmCli: (
          execPath?: string,
          platform?: NodeJS.Platform,
        ) => { cliPath: string; launcherPath: string }
      }
      const resolved = resolveAdjacentNpmCli(execPath, 'linux')
      expect(resolved.launcherPath).toBe(wrapperPath)
      expect(resolved.cliPath).toBe(cliPath)
      expect(
        execFileSync(process.execPath, [resolved.cliPath, '--version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim(),
      ).toBe('11.19.0')
    } finally {
      rmSync(prefix, { force: true, recursive: true })
    }
  })

  it('az exact npm child PATH-ja a lifecycle bare node hívását sem engedi eltéríteni', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kineticare-hostile-lifecycle-'))
    const hostileBin = join(fixture, 'hostile-bin')
    const packageDir = join(fixture, 'node_modules', 'lifecycle-probe')
    const hostileMarker = join(fixture, 'hostile-node-ran')
    const successMarker = join(fixture, 'exact-node-ran')
    mkdirSync(hostileBin)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(fixture, 'package.json'),
      `${JSON.stringify({
        name: 'lifecycle-fixture',
        version: '1.0.0',
        private: true,
        dependencies: { 'lifecycle-probe': '1.0.0' },
        allowScripts: { 'lifecycle-probe@1.0.0': true },
      })}\n`,
    )
    writeFileSync(
      join(fixture, 'package-lock.json'),
      `${JSON.stringify({
        name: 'lifecycle-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { 'lifecycle-probe': '1.0.0' } },
          'node_modules/lifecycle-probe': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/lifecycle-probe/-/lifecycle-probe-1.0.0.tgz',
            hasInstallScript: true,
          },
        },
      })}\n`,
    )
    writeExecutable(
      join(hostileBin, 'node'),
      `#!/bin/sh\nprintf 'called\\n' > ${JSON.stringify(hostileMarker)}\nexit 97\n`,
    )
    writeFileSync(
      join(packageDir, 'package.json'),
      `${JSON.stringify({ name: 'lifecycle-probe', version: '1.0.0', scripts: { install: 'node install.cjs' } })}\n`,
    )
    writeFileSync(
      join(packageDir, 'install.cjs'),
      `require('node:fs').writeFileSync(process.env.EXACT_NODE_MARKER, 'ok\\n')\n`,
    )

    const helperUrl = pathToFileURL(join(REPO, 'scripts', 'exact-npm-cli.mjs')).href
    const harness = `
      import { execFileSync } from 'node:child_process'
      import { exactNodeChildEnv, resolveAdjacentNpmCli } from ${JSON.stringify(helperUrl)}
      const { cliPath } = resolveAdjacentNpmCli()
      execFileSync(process.execPath, [
        cliPath,
        'rebuild',
        'lifecycle-probe',
        '--ignore-scripts=false',
        '--foreground-scripts',
        '--strict-allow-scripts=true',
        '--dangerously-allow-all-scripts=false',
      ], {
        cwd: ${JSON.stringify(fixture)},
        env: exactNodeChildEnv(),
        stdio: 'pipe',
      })
    `

    try {
      const hostileEnv: NodeJS.ProcessEnv = {
        ...process.env,
        EXACT_NODE_MARKER: successMarker,
        PATH: `${hostileBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      }
      for (const key of Object.keys(hostileEnv)) {
        if (key === 'INIT_CWD' || key.toLowerCase().startsWith('npm_')) delete hostileEnv[key]
      }
      execFileSync(process.execPath, ['--input-type=module', '--eval', harness], {
        cwd: REPO,
        env: hostileEnv,
        stdio: 'pipe',
      })
      expect(readFileSync(successMarker, 'utf8')).toBe('ok\n')
      expect(() => accessSync(hostileMarker)).toThrow()
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  })

  it('stdlib JSON parse alapján őrzi az exact package pineket yaml direct dependency nélkül', () => {
    const manifest = readJson<PackageManifest>(join(REPO, 'package.json'))
    const lock = readJson<PackageLock>(join(REPO, 'package-lock.json'))
    const dependencies = exactPinnedDependencies(manifest)
    const nvmNode = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim()
    const miseConfig = readFileSync(join(REPO, 'mise.toml'), 'utf8')
    expect(nvmNode).toMatch(/^\d+\.\d+\.\d+$/)
    expect(nvmNode).toBe(manifest.engines?.node)
    expect(manifest.engines).toEqual({ node: '24.20.0', npm: '11.19.0' })
    expect(miseConfig).toBe(
      '[tools]\nnode = "24.20.0"\n\n[settings]\ngpg_verify = true\n\n[settings.node]\nverify = true\n',
    )
    expect(dependencies).toEqual(EXPECTED_PACKAGE_PINS)
    expect(dependencies.yaml).toBeUndefined()
    expect(lock.packages?.['']?.dependencies?.yaml).toBeUndefined()
    expect(lock.packages?.['']?.devDependencies?.yaml).toBeUndefined()
    expect(sha256(readFileSync(join(REPO, '.npmrc')))).toBe(EXPECTED_NPMRC_SHA256)
    expect(sha256(readFileSync(join(REPO, 'scripts', 'verify-install-script-lock.mjs')))).toBe(
      EXPECTED_INSTALL_VERIFIER_SHA256,
    )
    expect(sha256(readFileSync(join(REPO, 'scripts', 'exact-npm-cli.mjs')))).toBe(
      EXPECTED_EXACT_NPM_CLI_SHA256,
    )
    expect(sha256(readFileSync(join(REPO, 'scripts', 'verify-install-script-lock.sha256')))).toBe(
      EXPECTED_INSTALL_VERIFIER_CHECKSUM_SHA256,
    )
    expect(sha256(readFileSync(join(REPO, 'railway.json')))).toBe(EXPECTED_RAILWAY_SHA256)
    expect(sha256(readFileSync(join(REPO, 'railpack.json')))).toBe(EXPECTED_RAILPACK_SHA256)
    const railway = readJson<{
      build?: { buildCommand?: string }
      deploy?: { startCommand?: string }
    }>(join(REPO, 'railway.json'))
    expect(railway.build?.buildCommand).toBe('node ./node_modules/next/dist/bin/next build')
    expect(railway.deploy?.startCommand).toBe(
      'node ./node_modules/payload/bin.js migrate && exec node ./node_modules/next/dist/bin/next start',
    )
    for (const [name, version] of Object.entries(dependencies)) {
      expect(version, `${name} csak exact verzióval engedélyezett`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('a pinned Railpack 0.38.0 terv exact Node-ot és fail-closed install sorrendet őriz', () => {
    const fixturePath = join(REPO, 'src', '__tests__', 'fixtures', 'railpack-v0.38.0-plan.json')
    const fixtureBytes = readFileSync(fixturePath)
    const plan = JSON.parse(fixtureBytes.toString('utf8')) as RailpackPlan
    const mise = plan.steps?.find((step) => step.name === 'packages:mise')
    const install = plan.steps?.find((step) => step.name === 'install')
    const build = plan.steps?.find((step) => step.name === 'build')
    const miseConfig = mise?.assets?.['generated-mise-toml'] ?? ''
    const installCommands = install?.commands ?? []
    const actualInstallCommands = installCommands.map((command) => command.cmd ?? command.path)
    const allShellCommands =
      plan.steps?.flatMap((step) => step.commands?.flatMap((command) => command.cmd ?? []) ?? []) ??
      []
    const verifierManifest = readFileSync(
      join(REPO, 'scripts', 'verify-install-script-lock.sha256'),
      'utf8',
    )

    expect(sha256(fixtureBytes)).toBe(EXPECTED_RAILPACK_PLAN_SHA256)
    expect(plan.deploy?.variables?.RAILPACK_VERSION).toBe('0.38.0')
    expect(miseConfig).toContain('node = "24.20.0"')
    expect(miseConfig).toContain('minimum_release_age = "14d"')
    expect(mise?.commands).toContainEqual({ dest: '.nvmrc', src: '.nvmrc' })
    expect(mise?.commands).toContainEqual({ dest: 'mise.toml', src: 'mise.toml' })
    expect(actualInstallCommands).toEqual([
      "sh -c 'node scripts/install-reviewed-dependencies.mjs'",
      'node_modules/.bin',
    ])
    expect(install?.inputs).toContainEqual({
      include: ['.npmrc', 'package.json', 'package-lock.json', 'scripts'],
      local: true,
    })
    expect(build?.commands?.map((command) => command.cmd ?? command.path)).toEqual([
      "sh -c 'node ./node_modules/next/dist/bin/next build'",
    ])
    expect(plan.deploy?.startCommand).toBe(
      'node ./node_modules/payload/bin.js migrate && exec node ./node_modules/next/dist/bin/next start',
    )
    expect(readFileSync(join(REPO, 'docs', 'deploy-railway.md'), 'utf8')).toContain(
      'A bizalmi határ a Railpack által generált exact Mise runtime',
    )
    expect(allShellCommands.some((command) => /\bcorepack\b/i.test(command))).toBe(false)
    expect(allShellCommands.some((command) => /\bnpm\s+(?:install|i)(?:\s|$)/.test(command))).toBe(
      false,
    )
    expect(sha256(verifierManifest)).toBe(EXPECTED_INSTALL_VERIFIER_CHECKSUM_SHA256)
    const checksumTargets = ['scripts/verify-install-script-lock.mjs', 'scripts/exact-npm-cli.mjs']
    expect(verifySha256Manifest(verifierManifest, checksumTargets)).toEqual(checksumTargets)
    expect(() =>
      verifySha256Manifest(
        verifierManifest.replace(EXPECTED_INSTALL_VERIFIER_SHA256, '0'.repeat(64)),
        checksumTargets,
      ),
    ).toThrow('digest mismatch')
    expect(() =>
      verifySha256Manifest(
        verifierManifest.replace(EXPECTED_EXACT_NPM_CLI_SHA256, '0'.repeat(64)),
        checksumTargets,
      ),
    ).toThrow('digest mismatch')
    expect(() =>
      verifySha256Manifest(
        verifierManifest.replace(/^.*scripts\/exact-npm-cli\.mjs\n$/m, ''),
        checksumTargets,
      ),
    ).toThrow('format or target mismatch')
  })

  it('a CI Railpack verifier pinned hivatalos assetből regenerálja a fixture-t', () => {
    const verifierBytes = readFileSync(join(REPO, 'scripts', 'verify-railpack-plan.sh'))
    const verifier = verifierBytes.toString('utf8')
    expect(sha256(verifierBytes)).toBe(EXPECTED_RAILPACK_PLAN_VERIFIER_SHA256)
    expect(railpackPlanVerifierViolations(verifier)).toEqual([])
  })

  it.each([
    [
      'archive SHA lazítása',
      "RAILPACK_ARCHIVE_SHA256='7c3f0e70ca8bf80bde87e8c30cb0171414c2b6bbd794d6f60a19cc3b71772950'",
      "RAILPACK_ARCHIVE_SHA256='unreviewed'",
    ],
    [
      'official checksum SHA lazítása',
      "RAILPACK_CHECKSUMS_SHA256='69d58f46c00048b1ccddc35151842cfa393d88ad06e5d376e7a2f4bcc8aabb89'",
      "RAILPACK_CHECKSUMS_SHA256='unreviewed'",
    ],
    [
      'checksum előtti kicsomagolás',
      'grep -Fqx -- "$RAILPACK_ARCHIVE_SHA256  $RAILPACK_ARCHIVE" "$checksums_path"',
      'tar -xzf "$archive_path" -C "$tmp_dir" railpack\ngrep -Fqx -- "$RAILPACK_ARCHIVE_SHA256  $RAILPACK_ARCHIVE" "$checksums_path"',
    ],
  ])('a Railpack verifier $0 mutációját fail-closed elutasítja', (_label, before, after) => {
    const verifier = readFileSync(join(REPO, 'scripts', 'verify-railpack-plan.sh'), 'utf8')
    expect(railpackPlanVerifierViolations(replaceRequired(verifier, before, after))).not.toEqual([])
  })

  it('csak az explicit review-zott exact csomagok kaphatnak install scriptet', () => {
    const manifest = readJson<PackageManifest>(join(REPO, 'package.json'))
    const lock = readJson<PackageLock>(join(REPO, 'package-lock.json'))

    expect(installScriptIdentities(lock)).toEqual(EXPECTED_INSTALL_SCRIPT_IDENTITIES)
    expect(manifest.allowScripts).toEqual(EXPECTED_INSTALL_SCRIPT_APPROVALS)
  })

  it('az engedélyezett install-script tarball integrity cseréjét elutasítja', () => {
    const lock = readJson<PackageLock>(join(REPO, 'package-lock.json'))
    const watcherPath = 'node_modules/@parcel/watcher'
    const watcher = lock.packages?.[watcherPath]
    expect(watcher).toBeDefined()

    const poisonedLock: PackageLock = {
      packages: {
        ...lock.packages,
        [watcherPath]: { ...watcher, integrity: 'sha512-poisoned' },
      },
    }
    expect(installScriptIdentities(poisonedLock)).not.toEqual(EXPECTED_INSTALL_SCRIPT_IDENTITIES)
  })

  it('a project-root lifecycle scriptet a dependency rebuild előtt elutasítja', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kineticare-root-lifecycle-'))
    const scripts = join(fixture, 'scripts')
    mkdirSync(scripts)
    try {
      const manifest = readJson<PackageManifest>(join(REPO, 'package.json'))
      writeFileSync(
        join(fixture, 'package.json'),
        `${JSON.stringify({ ...manifest, scripts: { install: 'node unexpected.js' } }, null, 2)}\n`,
      )
      writeFileSync(
        join(fixture, 'package-lock.json'),
        readFileSync(join(REPO, 'package-lock.json')),
      )
      writeFileSync(
        join(scripts, 'verify-install-script-lock.mjs'),
        readFileSync(join(REPO, 'scripts', 'verify-install-script-lock.mjs')),
      )
      writeFileSync(
        join(scripts, 'exact-npm-cli.mjs'),
        readFileSync(join(REPO, 'scripts', 'exact-npm-cli.mjs')),
      )

      expect(() =>
        execFileSync(process.execPath, [join(scripts, 'verify-install-script-lock.mjs')], {
          cwd: fixture,
          stdio: 'pipe',
        }),
      ).toThrow(/project-root lifecycle script is forbidden/)
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  })

  it('a dump konténer runner UID:GID-ja miatt a host age olvasni tudja a 0600-as fájlt', () => {
    const source = workflow('db-backup.yml')
    expect(source.match(/--user "\$\(id -u\):\$\(id -g\)"/g)).toHaveLength(3)
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
