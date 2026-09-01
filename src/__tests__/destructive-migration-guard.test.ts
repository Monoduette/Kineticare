import { describe, expect, it, vi } from 'vitest'

import type { BaseDatabaseAdapter, DatabaseAdapterObj, Payload } from 'payload'

import {
  DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR,
  guardDestructiveMigrationCommands,
} from '@/lib/migrations/destructive-migration-guard'

describe('destructive migration command guard', () => {
  it('rejects every destructive command before the wrapped adapter can run it', async () => {
    const original = {
      migrateDown: vi.fn(async () => undefined),
      migrateFresh: vi.fn(async () => undefined),
      migrateRefresh: vi.fn(async () => undefined),
      migrateReset: vi.fn(async () => undefined),
    }
    const originalMigrateDown = original.migrateDown
    const originalMigrateFresh = original.migrateFresh
    const originalMigrateRefresh = original.migrateRefresh
    const originalMigrateReset = original.migrateReset
    const adapter: DatabaseAdapterObj<BaseDatabaseAdapter> = {
      defaultIDType: 'text',
      init: () => original as unknown as BaseDatabaseAdapter,
      name: 'fake',
    }
    const initialized = guardDestructiveMigrationCommands(adapter).init({
      payload: {} as Payload,
    })

    await expect(initialized.migrateDown()).rejects.toThrow(
      DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR,
    )
    await expect(initialized.migrateFresh({})).rejects.toThrow(
      DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR,
    )
    await expect(initialized.migrateRefresh()).rejects.toThrow(
      DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR,
    )
    await expect(initialized.migrateReset()).rejects.toThrow(
      DESTRUCTIVE_MIGRATION_COMMAND_BLOCKED_ERROR,
    )

    expect(originalMigrateDown).not.toHaveBeenCalled()
    expect(originalMigrateFresh).not.toHaveBeenCalled()
    expect(originalMigrateRefresh).not.toHaveBeenCalled()
    expect(originalMigrateReset).not.toHaveBeenCalled()
  })

  it('leaves normal migration commands delegated to the initialized adapter', async () => {
    const original = {
      createMigration: vi.fn(async () => undefined),
      migrate: vi.fn(async () => undefined),
      migrateStatus: vi.fn(async () => undefined),
    }
    const adapter: DatabaseAdapterObj<BaseDatabaseAdapter> = {
      defaultIDType: 'text',
      init: () => original as unknown as BaseDatabaseAdapter,
      name: 'fake',
    }
    const initialized = guardDestructiveMigrationCommands(adapter).init({
      payload: {} as Payload,
    })

    await initialized.createMigration({ payload: {} as Payload })
    await initialized.migrate()
    await initialized.migrateStatus()

    expect(original.createMigration).toHaveBeenCalledOnce()
    expect(original.migrate).toHaveBeenCalledOnce()
    expect(original.migrateStatus).toHaveBeenCalledOnce()
  })
})
