import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { RefundIntents } from '@/collections/RefundIntents'
import { REFUND_INTENT_STATES } from '@/lib/refund/refund-intent'

const fields = RefundIntents.fields.filter((field) => 'name' in field)
const field = (name: string) => fields.find((candidate) => candidate.name === name)

describe('RefundIntents collection', () => {
  it('does not lock the system-write, read-only ledger', () => {
    expect(RefundIntents.lockDocuments).toBe(false)
  })

  it('is registered exactly once in Payload configuration', () => {
    const configPath = fileURLToPath(new URL('../payload.config.ts', import.meta.url))
    const source = readFileSync(configPath, 'utf8')
    expect(source.match(/import \{ RefundIntents \}/gu)).toHaveLength(1)
    expect(source.match(/^\s+RefundIntents,$/gmu)).toHaveLength(1)
  })

  it('wraps the configured PostgreSQL adapter with the destructive-command guard', () => {
    const configPath = fileURLToPath(new URL('../payload.config.ts', import.meta.url))
    const source = readFileSync(configPath, 'utf8')
    expect(source).toContain(
      "import { guardDestructiveMigrationCommands } from './lib/migrations/destructive-migration-guard'",
    )
    expect(source).toMatch(/db: guardDestructiveMigrationCommands\(\s*postgresAdapter\(\{/u)
  })

  it('permits only owner reads and denies every external write', async () => {
    const access = RefundIntents.access
    expect(await access?.read?.({ req: { user: { role: 'owner' } } } as never)).toBe(true)
    expect(await access?.read?.({ req: { user: { role: 'staff' } } } as never)).toBe(false)
    expect(await access?.read?.({ req: { user: null } } as never)).toBe(false)
    expect(await access?.create?.({} as never)).toBe(false)
    expect(await access?.update?.({} as never)).toBe(false)
    expect(await access?.delete?.({} as never)).toBe(false)
  })

  it('has exact states, relationships, and unique digest/nullable active-order fields', () => {
    expect(field('state')).toMatchObject({ type: 'select', required: true, index: true })
    expect(
      (field('state') as { options: { value: string }[] }).options.map(({ value }) => value),
    ).toEqual(REFUND_INTENT_STATES)
    expect(field('order')).toMatchObject({
      type: 'relationship',
      relationTo: 'orders',
      required: true,
    })
    expect(field('actor')).toMatchObject({
      type: 'relationship',
      relationTo: 'users',
      required: true,
    })
    expect(field('idempotencyKeyHash')).toMatchObject({
      type: 'text',
      required: true,
      unique: true,
      index: true,
    })
    expect(field('activeOrderKey')).toMatchObject({ type: 'text', unique: true, index: true })
    expect(field('activeOrderKey')).not.toHaveProperty('required')
  })

  it('has no hooks or custom endpoints, and no sensitive raw/error fields', () => {
    expect(RefundIntents).not.toHaveProperty('hooks')
    expect(RefundIntents).not.toHaveProperty('endpoints')
    const names = fields.map((candidate) => candidate.name)
    for (const prohibited of [
      'idempotencyKey',
      'rawKey',
      'requestBody',
      'body',
      'providerPayload',
      'error',
      'errorMessage',
    ]) {
      expect(names).not.toContain(prohibited)
    }
  })

  it('has the exact refund-intent schema constraints', () => {
    expect(field('requestedAmountHuf')).toMatchObject({ type: 'number', required: true, min: 1 })
    expect(field('provider')).toMatchObject({
      type: 'select',
      required: true,
      options: [{ label: 'Barion', value: 'barion' }],
    })
    expect(field('providerPaymentId')).toMatchObject({ type: 'text', required: true })
    expect(field('providerTransactionId')).toMatchObject({ type: 'text', required: true })
    expect(field('requestHash')).toMatchObject({ type: 'text', required: true, index: true })
    expect(field('schemaVersion')).toMatchObject({
      type: 'number',
      required: true,
      min: 1,
      max: 1,
    })
    expect(field('refundSequence')).toMatchObject({ type: 'number', required: true, min: 1 })
    expect(field('currency')).toMatchObject({
      type: 'select',
      required: true,
      options: [{ label: 'HUF', value: 'HUF' }],
    })
    expect(field('reason')).toMatchObject({ type: 'textarea', maxLength: 1000 })
  })
})
