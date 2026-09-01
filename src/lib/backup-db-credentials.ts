import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LibpqConnection } from './backup-db'

/** Eltávolít minden ambient adatbázis-kapcsolati felülírást a gyermek env-ből. */
export function buildCredentialSafeEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
  libpqEnvironment: Readonly<Record<string, string>>,
  pgpassFile: string,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = { ...parentEnvironment }
  for (const key of Object.keys(childEnvironment)) {
    if (key === 'DATABASE_URI' || key.startsWith('PG')) {
      delete childEnvironment[key]
    }
  }
  Object.assign(childEnvironment, libpqEnvironment)
  childEnvironment.PGPASSFILE = pgpassFile
  return childEnvironment
}

/**
 * Egy művelet idejére 0700-as temp könyvtárban 0600-as PGPASSFILE-t készít.
 * A finally cleanup siker és kivétel esetén is kötelező; cleanup-hiba bukás.
 */
export async function withPgPassFile<T>(
  connection: LibpqConnection,
  operation: (environment: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'kineticare-pgpass-'))
  const pgpassFile = join(tempDirectory, 'pgpass')

  try {
    await chmod(tempDirectory, 0o700)
    await writeFile(pgpassFile, connection.pgpassContents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await chmod(pgpassFile, 0o600)

    const environment = buildCredentialSafeEnvironment(
      process.env,
      connection.environment,
      pgpassFile,
    )
    return await operation(environment)
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}
