import { accessSync, constants, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
