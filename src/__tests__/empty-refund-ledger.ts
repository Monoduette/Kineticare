import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { expect, vi } from 'vitest'

import { activeRefundOrderKey } from '../lib/refund/refund-intent'

/**
 * Explicit empty financial history for tests that do not exercise refunds.
 * It accepts only an order-scoped SELECT; an unexpected financial write fails.
 * The transaction stub is for sequential fixtures, not concurrency evidence.
 * Lock interleaving tests retain their own serializing transaction fixture.
 */
export function emptyRefundLedger(orderIds: number[]) {
  const dialect = new PgDialect()
  const execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query)
    expect(compiled.sql).toMatch(/^SELECT [\s\S]+FROM "public"\."refund_intents"/u)
    expect(compiled.sql).toContain('WHERE order_id = $1')
    expect(compiled.sql).toContain('OR active_order_key = $2')
    const id = compiled.params[0]
    expect(orderIds).toContain(id)
    expect(compiled.params).toEqual([id, activeRefundOrderKey(String(id), 'prepared'), 1001])
    return { rows: [], rowCount: 0 }
  })
  return {
    execute,
    transaction: async <T>(run: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>) =>
      run({
        execute: async (query: SQL) => {
          const compiled = dialect.sqlToQuery(query)
          expect(compiled.sql).toContain('select pg_advisory_xact_lock')
          expect(compiled.params).toHaveLength(1)
          return { rows: [], rowCount: 0 }
        },
      }),
  }
}
