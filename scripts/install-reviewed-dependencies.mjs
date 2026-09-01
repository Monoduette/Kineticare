#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAdjacentNpmCli } from './exact-npm-cli.mjs'

const NODE_VERSION = '24.20.0'
const NPM_VERSION = '11.19.0'
const CHECKSUM_MANIFEST_SHA256 =
  '309c43f603cbd7b6f299ef1177ae856ceae96563d940792e60cfa135e7f103dc'
const CHECKSUM_TARGETS = [
  'scripts/verify-install-script-lock.mjs',
  'scripts/exact-npm-cli.mjs',
]
const REPO = fileURLToPath(new URL('../', import.meta.url))

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

  const manifestSource = manifest.toString('utf8')
  const lines = manifestSource.endsWith('\n') ? manifestSource.slice(0, -1).split('\n') : []
  const matches = lines.map((line) => line.match(/^([a-f0-9]{64})  ([^\n]+)$/))
  if (
    matches.length !== CHECKSUM_TARGETS.length ||
    matches.some((match, index) => match === null || match[2] !== CHECKSUM_TARGETS[index])
  ) {
    fail('install verifier checksum manifest format mismatch')
  }
  for (const [index, target] of CHECKSUM_TARGETS.entries()) {
    if (sha256(readFileSync(join(REPO, target))) !== matches[index]?.[1]) {
      fail(`install verifier hash mismatch: ${target}`)
    }
  }
}

if (process.versions.node !== NODE_VERSION) {
  fail(`Node ${NODE_VERSION} required, found ${process.versions.node}`)
}
let npmCliPath
try {
  npmCliPath = resolveAdjacentNpmCli().cliPath
} catch {
  fail(`exact runtime npm executable missing next to ${process.execPath}`)
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
