#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NODE_VERSION = '24.20.0'
const NPM_VERSION = '11.19.0'
const CHECKSUM_MANIFEST_SHA256 =
  '22770112e6e712a96208daa7b47046fe91d3492a90af7cca7224b7c789de02c2'
const VERIFIER_PATH = 'scripts/verify-install-script-lock.mjs'
const REPO = fileURLToPath(new URL('../', import.meta.url))
const npmLauncherPath = join(
  dirname(process.execPath),
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
)
const npmCliPath =
  process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : realpathSync(npmLauncherPath)

function fail(message) {
  console.error(`[install-reviewed-dependencies] ERROR: ${message}`)
  process.exit(1)
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex')
}

function runNpm(args) {
  execFileSync(process.execPath, [npmCliPath, ...args], { cwd: REPO, stdio: 'inherit' })
}

function runNode(args) {
  execFileSync(process.execPath, args, { cwd: REPO, stdio: 'inherit' })
}

function verifyInstallVerifier() {
  const manifestPath = join(REPO, 'scripts', 'verify-install-script-lock.sha256')
  const manifest = readFileSync(manifestPath)
  if (sha256(manifest) !== CHECKSUM_MANIFEST_SHA256) {
    fail('install verifier checksum manifest hash mismatch')
  }

  const match = manifest.toString('utf8').match(/^([a-f0-9]{64})  ([^\n]+)\n$/)
  if (match === null || match[2] !== VERIFIER_PATH) {
    fail('install verifier checksum manifest format mismatch')
  }
  if (sha256(readFileSync(join(REPO, VERIFIER_PATH))) !== match[1]) {
    fail('install verifier hash mismatch')
  }
}

if (process.versions.node !== NODE_VERSION) {
  fail(`Node ${NODE_VERSION} required, found ${process.versions.node}`)
}
try {
  accessSync(npmLauncherPath, constants.X_OK)
  accessSync(npmCliPath, constants.R_OK)
} catch {
  fail(`exact runtime npm executable missing: ${npmLauncherPath}`)
}
const npmVersion = execFileSync(process.execPath, [npmCliPath, '--version'], {
  cwd: REPO,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim()
if (npmVersion !== NPM_VERSION) {
  fail(`npm ${NPM_VERSION} required, found ${npmVersion}`)
}

runNpm(['ci', '--legacy-peer-deps', '--ignore-scripts'])
verifyInstallVerifier()
runNode(['scripts/verify-install-script-lock.mjs'])
runNpm([
  'rebuild',
  '--ignore-scripts=false',
  '--foreground-scripts',
  '--strict-allow-scripts=true',
  '--dangerously-allow-all-scripts=false',
])
