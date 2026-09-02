import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { exactNodeChildEnv, resolveAdjacentNpmCli } from './exact-npm-cli.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

const EXPECTED_NODE = '24.20.0'
const EXPECTED_NPM = '11.19.0'
const EXPECTED_LOCK_SHA256 = '48ba8e960806a238909e7333dee00f4a75422c6190a90ce36fb424c99675d2c5'

const EXPECTED_APPROVALS = {
  '@parcel/watcher@2.6.0': true,
  'core-js@3.50.0': true,
  'esbuild@0.18.20': true,
  'esbuild@0.25.12': true,
  'esbuild@0.28.1': true,
  'esbuild@0.28.2': true,
  'fsevents@2.3.3': true,
  'unrs-resolver@1.12.2': true,
}

const EXPECTED_IDENTITIES = {
  'node_modules/@esbuild-kit/core-utils/node_modules/esbuild':
    '5c4075154b788aaae1bc4a2963f5dc1546909beae6dea5443c9769d0afd1efa5',
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function read(name) {
  return readFileSync(`${root}${name}`)
}

function parse(name) {
  return JSON.parse(read(name).toString('utf8'))
}

function stableEntries(value) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
}

function fail(message) {
  throw new Error(`Install-script verification failed: ${message}`)
}

const manifest = parse('package.json')
const lockBytes = read('package-lock.json')
const lock = JSON.parse(lockBytes.toString('utf8'))

for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
  if (manifest.scripts?.[lifecycle] !== undefined) {
    fail(`project-root lifecycle script is forbidden: ${lifecycle}`)
  }
}

if (process.versions.node !== EXPECTED_NODE) {
  fail(`Node ${process.versions.node} is not reviewed Node ${EXPECTED_NODE}`)
}
const { cliPath: npmCliPath } = resolveAdjacentNpmCli()
const activeNpm = execFileSync(process.execPath, [npmCliPath, '--version'], {
  encoding: 'utf8',
  env: exactNodeChildEnv(),
}).trim()
if (activeNpm !== EXPECTED_NPM || manifest.engines?.npm !== EXPECTED_NPM) {
  fail('npm policy version is not exact')
}
if (sha256(lockBytes) !== EXPECTED_LOCK_SHA256) {
  fail('package-lock.json byte hash changed before lifecycle execution')
}
if (
  JSON.stringify(stableEntries(manifest.allowScripts ?? {})) !==
  JSON.stringify(stableEntries(EXPECTED_APPROVALS))
) {
  fail('allowScripts differs from the reviewed exact approval set')
}

const identities = {}
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (entry.hasInstallScript === true) {
    identities[path] = sha256(`${entry.version}\n${entry.resolved}\n${entry.integrity}`)
  }
}
if (
  JSON.stringify(stableEntries(identities)) !== JSON.stringify(stableEntries(EXPECTED_IDENTITIES))
) {
  fail('install-script package identity differs from reviewed version/resolved/integrity')
}

const lockRoot = lock.packages?.[''] ?? {}
for (const field of ['dependencies', 'devDependencies', 'engines']) {
  if (
    JSON.stringify(stableEntries(manifest[field] ?? {})) !==
    JSON.stringify(stableEntries(lockRoot[field] ?? {}))
  ) {
    fail(`package.json and package-lock.json disagree on ${field}`)
  }
}

console.log('Install-script lock verification passed.')
