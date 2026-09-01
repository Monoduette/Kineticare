import type { BaseDatabaseAdapter, DatabaseAdapterObj } from 'payload'

export const DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR =
  'destructive_payload_migration_command_blocked'

const rejectDestructiveMigrationCommand = async (): Promise<never> => {
  throw new Error(DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR)
}

/**
 * A konfigurált Payload adapteren tiltja a teljes adatbázist vagy a migrációs
 * történetet visszafelé módosító parancsokat. A generált down közvetlen
 * meghívása ettől külön, továbbra is szigorúan tiltott üzemeltetési művelet.
 */
export function guardDestructiveMigrationCommands<T extends BaseDatabaseAdapter>(
  adapter: DatabaseAdapterObj<T>,
): DatabaseAdapterObj<T> {
  return {
    ...adapter,
    init: (args) => {
      const initialized = adapter.init(args)
      initialized.migrateDown = rejectDestructiveMigrationCommand
      initialized.migrateFresh = rejectDestructiveMigrationCommand
      initialized.migrateRefresh = rejectDestructiveMigrationCommand
      initialized.migrateReset = rejectDestructiveMigrationCommand
      return initialized
    },
  }
}
