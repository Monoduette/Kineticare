import { describe, expect, it } from 'vitest'
import { fixture, provider, store } from './refund-fixture'

const refundId = 'aaaaaaaa-bbbb-cccc-dddd-123456789012'
describe('owner refund response proof runtime binding', () => {
  it('accepts the documented new refund id and preserves the original source id in the ledger', async () => {
    const f = fixture()
    provider.refund.mockResolvedValue({
      PaymentId: f.order.barionPaymentId,
      RefundedTransactions: [
        {
          TransactionId: refundId,
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          Total: 5000,
          Status: 'Succeeded',
        },
      ],
    })
    await expect(f.start({ amountHuf: 5000 })).resolves.toMatchObject({
      transactionId: 'SYNTHETIC-TX',
      amountHuf: 5000,
    })
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'committed',
      providerTransactionId: 'SYNTHETIC-TX',
    })
    expect(
      f.audits.find((entry) => entry.action === 'refund-provider-succeeded')?.after,
    ).toMatchObject({
      version: 2,
      transactionId: 'SYNTHETIC-TX',
      refundTransactionId: refundId,
      posTransactionId: 'SYNTHETIC-RECOVERY-11-1',
    })
  })

  it('rejects a response with the original source id but the wrong merchant transaction', async () => {
    const f = fixture()
    provider.refund.mockResolvedValue({
      PaymentId: f.order.barionPaymentId,
      RefundedTransactions: [
        {
          TransactionId: 'SYNTHETIC-TX',
          POSTransactionId: 'OTHER-POS',
          Total: 5000,
          Status: 'Succeeded',
        },
      ],
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    expect(f.order.refunds).toEqual([])
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a distinct returned refund id for two equal partial refunds', async () => {
    const f = fixture()
    provider.refund.mockResolvedValue({
      PaymentId: f.order.barionPaymentId,
      RefundedTransactions: [
        {
          TransactionId: refundId,
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          Total: 5000,
          Status: 'Succeeded',
        },
      ],
    })
    await f.start({ amountHuf: 5000 })
    // A GetState az első visszatérítést a forrásra mutató tranzakcióként mutatja.
    f.barionRefunds.push({
      TransactionId: refundId,
      POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
      TransactionType: 'RefundToBankCard',
      Status: 'Succeeded',
      Total: 5000,
      RelatedId: 'SYNTHETIC-TX',
    })
    await expect(
      f.start({ amountHuf: 5000, operationKey: Buffer.alloc(32, 2).toString('base64url') }),
    ).rejects.toMatchObject({ status: 503 })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    expect(f.order.refunds).toHaveLength(1)
    expect(provider.refund).toHaveBeenCalledTimes(2)
  })

  it('allows two equal partial refunds with source-id echoes and distinct durable operation keys', async () => {
    const f = fixture()
    const source = refundId
    provider.state.mockResolvedValue({
      PaymentId: f.order.barionPaymentId,
      Transactions: [
        {
          TransactionId: source,
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          Status: 'Succeeded',
          TransactionType: 'CardPayment',
          Total: 20000,
        },
      ],
    })
    provider.refund.mockResolvedValue({
      PaymentId: f.order.barionPaymentId,
      RefundedTransactions: [
        {
          TransactionId: source,
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          Total: 5000,
          Status: 'Succeeded',
        },
      ],
    })
    await f.start({ amountHuf: 5000 })
    // A válasz a forrás azonosítóját visszhangozza, a GetState viszont a
    // visszatérítést saját tranzakcióként, a forrásra mutatva listázza.
    provider.state.mockResolvedValue({
      PaymentId: f.order.barionPaymentId,
      Transactions: [
        {
          TransactionId: source,
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          Status: 'Succeeded',
          TransactionType: 'CardPayment',
          Total: 20000,
        },
        {
          TransactionId: 'bbbbbbbb-bbbb-cccc-dddd-000000000001',
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          Status: 'Succeeded',
          TransactionType: 'RefundToBankCard',
          Total: 5000,
          RelatedId: source,
        },
      ],
    })
    await f.start({ amountHuf: 5000, operationKey: Buffer.alloc(32, 2).toString('base64url') })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.order.refunds).toHaveLength(2)
    expect(provider.refund).toHaveBeenCalledTimes(2)
  })

  it('can finish a previously acknowledged V1 owner receipt without rewriting its identity', async () => {
    const f = fixture()
    f.failures.order = true
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    const receipt = f.audits.find((entry) => entry.action === 'refund-provider-succeeded')!
    const data = receipt.after as Record<string, unknown>
    Object.assign(data, { version: 1, status: 'Refunded' })
    delete data.refundTransactionId
    delete data.posTransactionId
    delete data.actorKind
    delete data.systemActor
    const before = structuredClone(data)
    f.failures.order = false
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(receipt.after).toEqual(before)
    expect(f.order.refunds).toEqual([
      expect.objectContaining({ status: 'Refunded', amountHuf: 5000 }),
    ])
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
})
