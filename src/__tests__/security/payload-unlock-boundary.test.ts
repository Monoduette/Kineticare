import { unlockOperation, type PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import configPromise from '../../payload.config'

async function fixture(role: 'owner' | 'staff' | 'customer' | null) {
  const config = await configPromise
  const users = config.collections.find((collection) => collection.slug === 'users')
  if (!users) throw new Error('Users collection is required')
  const db = {
    findOne: vi.fn(async () => ({ id: 99, loginAttempts: 5 })),
    updateOne: vi.fn(async () => undefined),
  }
  const req = {
    user: role ? { id: 1, role, collection: 'users' } : null,
    context: {},
    payload: { db },
    t: (key: string) => key,
  } as unknown as PayloadRequest
  const args: Parameters<typeof unlockOperation>[0] = {
    collection: { config: users },
    // Match unlockHandler: the shared login type requires an unused password.
    data: { email: 'locked-account@example.test' } as Parameters<typeof unlockOperation>[0]['data'],
    overrideAccess: false,
    req,
  }
  return { args, db }
}

describe('configured Payload unlock operation boundary', () => {
  it.each([null, 'customer', 'staff'] as const)(
    'rejects %s before reading or resetting the target account',
    async (role) => {
      const { args, db } = await fixture(role)
      await expect(unlockOperation(args)).rejects.toMatchObject({ status: 403 })
      expect(db.findOne).not.toHaveBeenCalled()
      expect(db.updateOne).not.toHaveBeenCalled()
    },
  )

  it('allows the owner to reset only the located account', async () => {
    const { args, db } = await fixture('owner')
    await expect(unlockOperation(args)).resolves.toBe(true)
    expect(db.findOne).toHaveBeenCalledExactlyOnceWith({
      collection: 'users',
      locale: undefined,
      req: args.req,
      where: { and: [{}, { email: { equals: 'locked-account@example.test' } }] },
    })
    expect(db.updateOne).toHaveBeenCalledExactlyOnceWith({
      id: 99,
      collection: 'users',
      data: { lockUntil: null, loginAttempts: 0 },
      req: args.req,
      returning: false,
    })
  })
})
