import { describe, expect, it } from 'vitest'
import { fixture, provider, documents, store, claimInvoice, access } from './refund-fixture'
import { getRefundRecoveryStatus } from '../lib/refund/refund-recovery'
import type { RefundAccessBaseline } from '../lib/refund/access-store'

describe('durable refund recovery integration', () => {
  it('preserves the bounded row-version baseline through audit storage and recovery', async () => {
    const f = fixture()
    const baseline: RefundAccessBaseline = {
      version: 1,
      customerId: 7,
      productIds: [42],
      purchases: [{ id: 1, productId: 42 }],
      grantProductIds: [42],
      grantsFingerprint: 'b'.repeat(64),
      grantProof: 'bounded-xmin-v1',
      fullXid: '1000',
      xidCeiling: '1001',
      grants: [
        {
          id: 'SYNTHETIC-GRANT',
          productId: 42,
          grantedAt: '2026-09-05T09:00:00.000Z',
          position: 0,
          xmin: '900',
          age: 100,
        },
      ],
    }
    access.read.mockResolvedValue(baseline)
    f.failures.order = true
    await expect(f.start()).rejects.toThrow()
    expect(f.audits.find((event) => event.action === 'refund-prepared')?.after).toMatchObject({
      accessBaseline: baseline,
    })
    f.failures.order = false
    await f.recover()
    expect(access.apply).toHaveBeenCalledWith(f.payload, expect.objectContaining({ baseline }))
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('does not report a keyed completion when its latest invoice is no longer stored', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    f.order.correctiveInvoiceNumber = null
    expect(
      await getRefundRecoveryStatus({ ...f.options, operationKey: 'A'.repeat(43) }),
    ).toMatchObject({
      state: 'manual_review',
      operationState: 'pending',
    })
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('reports unseen, pending and completed operation state without echoing the key', async () => {
    const f = fixture()
    const options = { ...f.options, operationKey: 'A'.repeat(43) }
    expect(await getRefundRecoveryStatus(options)).toMatchObject({
      state: 'clear',
      operationState: 'unseen',
    })
    f.failures.order = true
    await expect(f.start()).rejects.toThrow()
    expect(await getRefundRecoveryStatus(options)).toMatchObject({
      state: 'recoverable',
      operationState: 'pending',
    })
    f.failures.order = false
    await f.recover()
    const result = await getRefundRecoveryStatus(options)
    expect(result).toMatchObject({ state: 'clear', operationState: 'completed' })
    expect(JSON.stringify(result)).not.toContain(options.operationKey)
  })
  it('claims before POST, records success, independently completes phases and commits', async () => {
    const f = fixture()
    await expect(f.start()).resolves.toMatchObject({ refundStatusOutcome: 'succeeded' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.user.purchases).toEqual([99])
    expect(await f.status()).toMatchObject({ state: 'clear' })
  })
  it.each([false, true])(
    'never launches after baseline receipt failure (lost ack: %s)',
    async (lostAck) => {
      const f = fixture()
      f.failures.receipt = 'refund-prepared'
      f.failures.receiptAfterWrite = lostAck
      await expect(f.start()).rejects.toThrow()
      expect(provider.refund).not.toHaveBeenCalled()
      expect(store.intents.get(f.payload)?.state).toBe('prepared')
    },
  )
  it('reconstructs a failed financial write without re-sending money', async () => {
    const f = fixture()
    f.failures.order = true
    await expect(f.start()).rejects.toThrow()
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
    expect(await f.status()).toMatchObject({ state: 'recoverable' })
    f.failures.order = false
    await expect(f.recover()).resolves.toMatchObject({ recoveryStatus: 'completed' })
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(f.order.refunds).toHaveLength(1)
  })
  it('preserves a later unlimited gift/import without a grant timestamp', async () => {
    const f = fixture()
    f.failures.order = true
    await expect(f.start()).rejects.toThrow()
    f.regrant()
    f.failures.order = false
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(f.user.purchases).toEqual([42, 99])
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })
  it('rolls back cleanup on receipt failure and preserves a later regrant', async () => {
    const f = fixture()
    f.failures.receipt = 'refund-cleanup-done'
    await expect(f.start()).rejects.toThrow()
    expect(f.user.purchases).toEqual([42, 99])
    f.regrant()
    f.failures.receipt = ''
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(f.user.purchases).toEqual([42, 99])
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('cleanup failure does not suppress audit or invoice', async () => {
    const f = fixture()
    f.failures.user = true
    await expect(f.start()).rejects.toThrow()
    expect(f.audits.some((audit) => audit.action === 'order-refund')).toBe(true)
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
  })
  it('unknown or mismatched provider response remains blocked without local financial mutations', async () => {
    const f = fixture()
    provider.refund.mockResolvedValue({
      PaymentId: 'OTHER',
      RefundedTransactions: [{ TransactionId: 'SYNTHETIC-TX', Status: 'Refunded' }],
    })
    await expect(f.start()).rejects.toThrow()
    expect(await f.status()).toMatchObject({ state: 'manual_review' })
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(f.order.refunds).toEqual([])
    expect(documents.storno).not.toHaveBeenCalled()
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('does not retry an ambiguous invoice submission', async () => {
    const f = fixture()
    documents.storno.mockImplementation(async () => {
      await claimInvoice(f.payload, 'storno')
      throw new Error('SYNTHETIC timeout')
    })
    await expect(f.start()).rejects.toThrow()
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })
})
