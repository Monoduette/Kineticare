import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn() }))
vi.mock('../../lib/course-progress/cleanup', () => ({
  deleteCourseProgressOnParentDelete: () => cleanup,
}))

import configPromise from '../../payload.config'

const config = await configPromise
const products = config.collections.find((collection) => collection.slug === 'products')!

async function runDeleteHooks(req: PayloadRequest) {
  for (const hook of products.hooks.beforeDelete ?? []) {
    await hook({ id: 42, req, context: req.context, collection: products })
  }
}

beforeEach(() => cleanup.mockReset())

describe('private file ownership before deleting a course', () => {
  it('blocks a course with retained private files before progress cleanup', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 1 })
    const req = { payload: { count }, context: {} } as unknown as PayloadRequest
    await expect(runDeleteHooks(req)).rejects.toMatchObject({ status: 409 })
    expect(cleanup).not.toHaveBeenCalled()
    expect(count).toHaveBeenCalledWith({
      collection: 'course-files',
      where: { course: { equals: 42 } },
      overrideAccess: true,
      req,
    })
  })

  it('preserves deletion and existing cleanup for a course without private files', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 0 })
    const req = { payload: { count }, context: {} } as unknown as PayloadRequest
    await expect(runDeleteHooks(req)).resolves.toBeUndefined()
    expect(count).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('does not treat a failed file lookup as proof that deletion is safe', async () => {
    const count = vi.fn().mockRejectedValue(new Error('DUMMY count unavailable'))
    const req = { payload: { count }, context: {} } as unknown as PayloadRequest
    await expect(runDeleteHooks(req)).rejects.toThrow('DUMMY count unavailable')
    expect(cleanup).not.toHaveBeenCalled()
  })
})
