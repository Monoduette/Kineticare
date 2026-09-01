import { accessSync, constants, realpathSync } from 'node:fs'
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

export function resolveAdjacentNpmCli(execPath = process.execPath, platform = process.platform) {
  const executableDirectory = dirname(execPath)
  const launcherPath = join(executableDirectory, platform === 'win32' ? 'npm.cmd' : 'npm')

  try {
    accessSync(launcherPath, platform === 'win32' ? constants.F_OK : constants.X_OK)
    const cliPath =
      platform === 'win32'
        ? join(executableDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : realpathSync(launcherPath)
    accessSync(cliPath, constants.R_OK)
    return { cliPath, launcherPath }
  } catch (cause) {
    throw new Error(`Exact adjacent npm CLI is unavailable for ${execPath}`, { cause })
  }
}
