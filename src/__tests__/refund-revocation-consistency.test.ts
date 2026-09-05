import { describe, expect, it, vi } from 'vitest'
import { fixture, provider, documents, store, access } from './refund-fixture'

describe('acknowledged finances and independently recoverable local phases', () => {
  it('failed order acknowledgement retains provider success and no access mutation', async () => {
    const f = fixture()
    f.failures.order = true
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
    expect(f.user.purchases).toEqual([42, 99])
  })
  it('silently rolled back order write cannot advance cleanup or invoicing', async () => {
    const f = fixture()
    f.failures.orderNoop = true
    await expect(f.start()).rejects.toThrow()
    expect(f.user.purchases).toEqual([42, 99])
    expect(documents.storno).not.toHaveBeenCalled()
  })
  it('silently rolled back user write cannot advance cleanup-done', async () => {
    const f = fixture()
    f.failures.userNoop = true
    await expect(f.start()).rejects.toThrow()
    expect(f.audits.some((item) => item.action === 'refund-cleanup-done')).toBe(false)
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })
  it('grant-bearing access is preserved even with equal updatedAt', async () => {
    const f = fixture()
    f.failures.order = true
    await expect(f.start()).rejects.toThrow()
    f.user.accessGrants = [{ product: 42, grantedAt: '2026-09-05T11:00:00.000Z' }]
    f.failures.order = false
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(f.user.purchases).toEqual([42, 99])
  })
  it('atomic cleanup rollback can recover without a Payload user rewrite', async () => {
    const f = fixture()
    f.failures.receipt = 'refund-cleanup-done'
    await expect(f.start()).rejects.toThrow()
    expect(f.user.purchases).toEqual([42, 99])
    f.failures.receipt = ''
    vi.mocked(f.payload.update).mockClear()
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(
      vi.mocked(f.payload.update).mock.calls.some(([args]) => args.collection === 'users'),
    ).toBe(false)
  })
  it('a completed SQL helper return without its durable receipt is not completion', async () => {
    const f = fixture()
    access.apply.mockResolvedValue({ status: 'completed' })
    await expect(f.start()).rejects.toThrow()
    expect(f.user.purchases).toEqual([42, 99])
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
  })
  it('reads committed cleanup proof after a lost transaction acknowledgement', async () => {
    const f = fixture()
    f.failures.receipt = 'refund-cleanup-done'
    f.failures.receiptAfterWrite = true
    await expect(f.start()).resolves.toMatchObject({ refundStatusOutcome: 'succeeded' })
    expect(f.user.purchases).toEqual([99])
    f.regrant()
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(f.user.purchases).toEqual([99, 42])
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('audit failure does not suppress invoice and later recovery does not delete a new gift', async () => {
    const f = fixture()
    f.failures.receipt = 'order-refund'
    await expect(f.start()).rejects.toThrow()
    expect(documents.storno).toHaveBeenCalledTimes(1)
    f.failures.receipt = ''
    f.user.purchases = [42, 99]
    f.user.updatedAt = '2026-09-05T12:00:00.000Z'
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(f.user.purchases).toEqual([42, 99])
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('conflicting duplicate baseline receipts never authorize deletion', async () => {
    const f = fixture()
    f.failures.order = true
    await expect(f.start()).rejects.toThrow()
    f.audits.push(structuredClone(f.audits.find((item) => item.action === 'refund-prepared')!))
    f.failures.order = false
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(f.user.purchases).toEqual([42, 99])
  })
  it('legacy successful history without a committed proof is not reported clear', async () => {
    const f = fixture()
    f.order.status = 'refunded'
    f.order.refunds = [
      {
        transactionId: 'SYNTHETIC-TX',
        amountHuf: 20000,
        type: 'full',
        status: 'Refunded',
        refundedAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    expect(await f.status()).toMatchObject({ state: 'manual_review' })
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(provider.refund).not.toHaveBeenCalled()
  })
})
