import { accessSync, constants, readFileSync, realpathSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export function exactNodeChildEnv(execPath = process.execPath, environment = process.env) {
  const childEnv = { ...environment }
  const pathKeys = Object.keys(childEnv).filter((key) => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? 'PATH'
  const preservedPath = pathKeys.map((key) => childEnv[key]).find(Boolean) ?? ''

  for (const key of pathKeys) delete childEnv[key]
  childEnv[pathKey] = preservedPath
    ? `${dirname(execPath)}${delimiter}${preservedPath}`
    : dirname(execPath)
  return childEnv
}

function prefixNpmCliCandidates(executableDirectory) {
  return [
    join(dirname(executableDirectory), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(executableDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
}

function isNodeJavascriptCli(filePath) {
  let head
  try {
    head = readFileSync(filePath, { encoding: 'utf8' }).slice(0, 256)
  } catch {
    return false
  }
  if (/^\s*#!(?:.*\b)?(?:ba)?sh\b/m.test(head)) return false
  if (/^\s*set -[A-Za-z]*e/m.test(head)) return false
  return (
    filePath.endsWith('.js') ||
    /^\s*#!(?:.*\b)?node(?:\.exe)?\b/m.test(head) ||
    /^\s*(?:import |require\()/m.test(head)
  )
}

function firstReadableJavascriptCli(candidates) {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.R_OK)
      if (isNodeJavascriptCli(candidate)) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

export function resolveAdjacentNpmCli(execPath = process.execPath, platform = process.platform) {
  const executableDirectory = dirname(execPath)
  const launcherPath = join(executableDirectory, platform === 'win32' ? 'npm.cmd' : 'npm')

  try {
    accessSync(launcherPath, platform === 'win32' ? constants.F_OK : constants.X_OK)
    const resolvedLauncher =
      platform === 'win32'
        ? join(executableDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : realpathSync(launcherPath)
    // A hivatalos Node `bin/npm` JS-re mutat. A mise 0.38-as Railpack runtime
    // bash wrapperrel írja felül (`set -euo pipefail`); azt node nem futtathatja.
    // A valódi CLI a prefix `lib/node_modules/npm/bin/npm-cli.js`.
    const cliPath = firstReadableJavascriptCli([
      resolvedLauncher,
      ...prefixNpmCliCandidates(executableDirectory),
    ])
    if (cliPath === undefined) {
      throw new Error(`Adjacent npm CLI is not a Node script: ${resolvedLauncher}`)
    }
    return { cliPath, launcherPath }
  } catch (cause) {
    throw new Error(`Exact adjacent npm CLI is unavailable for ${execPath}`, { cause })
  }
}
