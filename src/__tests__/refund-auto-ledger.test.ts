import { describe, expect, it, vi } from 'vitest'
import { fixture, provider, store, documents, access } from './refund-fixture'
import { recoverRejectedSucceededPayment } from '../lib/order-status/recover-paid-reject'
import { createLogger } from '../lib/logger'
import type { BarionPaymentStateResponse } from '../lib/barion'
import { NO_PROVIDER_REQUEST_REFERENCE } from '../lib/refund/refund-intent'

const sourceId = '11111111-2222-3333-4444-555555555555'
const refundId = 'aaaaaaaa-bbbb-cccc-dddd-123456789012'
function setup() {
  const f = fixture()
  Object.assign(f.order, { status: 'payment_pending', customer: null, invoiceNumber: null })
  const state: BarionPaymentStateResponse = {
    PaymentId: f.order.barionPaymentId!,
    PaymentRequestId: 'SYNTHETIC',
    Status: 'Succeeded',
    Total: 20000,
    Currency: 'HUF',
    Transactions: [
      {
        TransactionId: sourceId,
        POSTransactionId: `${f.order.orderNumber}-1`,
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: 20000,
      },
    ],
  }
  provider.refund.mockResolvedValue({
    PaymentId: f.order.barionPaymentId,
    RefundedTransactions: [
      {
        TransactionId: refundId,
        POSTransactionId: `${f.order.orderNumber}-1`,
        Total: 20000,
        Status: 'Succeeded',
      },
    ],
  })
  const run = (now?: Date) =>
    recoverRejectedSucceededPayment({
      payload: f.payload,
      order: structuredClone(f.order),
      state,
      reason: 'guest-bind-privileged-account',
      source: 'callback',
      log: createLogger({}),
      refundPayment: provider.refund,
      ...(now ? { now } : {}),
    })
  return { ...f, state, run }
}

describe('automatic paid-reject durable ledger runtime', () => {
  it('creates a guest system intent and acknowledges it before the only provider request', async () => {
    const f = setup()
    const response = provider.refund.getMockImplementation()!
    provider.refund.mockImplementation(async (...args) => {
      expect(store.intents.get(f.payload)).toMatchObject({
        state: 'provider_started',
        actor: null,
        actorKind: 'system',
        systemActor: 'paid-reject-recovery',
      })
      expect(f.audits.some((audit) => audit.action === 'refund-prepared')).toBe(true)
      return response(...args)
    })
    await expect(f.run()).resolves.toMatchObject({ action: 'refunded' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.order).toMatchObject({
      status: 'refunded',
      refunds: [{ amountHuf: 20000, transactionId: sourceId, type: 'full', status: 'Succeeded' }],
    })
    expect(access.read).not.toHaveBeenCalled()
    expect(access.apply).not.toHaveBeenCalled()
    expect(documents.storno).not.toHaveBeenCalled()
  })

  it('keeps a timed-out submission unresolved across repeat calls with no financial replay', async () => {
    const f = setup()
    provider.refund.mockRejectedValue(new Error('SYNTHETIC provider response loss'))
    // A fixture 10:00:01-re rögzíti az indítást; negyedórán belül nincs GetState-alapú nullhatás.
    const soon = new Date('2026-09-05T10:05:00.000Z')
    expect((await f.run(soon)).action).toBe('failed')
    expect((await f.run(soon)).action).toBe('failed')
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(f.order).toMatchObject({ status: 'payment_pending', refunds: [] })
  })

  it.each(['Unknown', 'PartiallyRefunded', 'RefundFailed'])(
    'does not invent full financial success for %s',
    async (status) => {
      const f = setup()
      provider.refund.mockResolvedValue({
        PaymentId: f.order.barionPaymentId,
        RefundedTransactions: [
          {
            TransactionId: refundId,
            POSTransactionId: `${f.order.orderNumber}-1`,
            Total: 20000,
            Status: status,
          },
        ],
      })
      expect((await f.run()).action).toBe('failed')
      expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
      expect(f.order).toMatchObject({ status: 'payment_pending', refunds: [] })
    },
  )

  it('continues only local recording after provider success and a failed order write', async () => {
    const f = setup()
    f.failures.order = true
    expect((await f.run()).action).toBe('failed')
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
    f.failures.order = false
    expect((await f.run()).action).toBe('refunded')
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(store.intents.get(f.payload)?.state).toBe('committed')
  })

  it('serializes two simultaneous callbacks through the shared order claim', async () => {
    const f = setup()
    const results = await Promise.all([f.run(), f.run()])
    expect(results.every((result) => result.action === 'refunded')).toBe(true)
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(f.order.refunds).toHaveLength(1)
  })

  it('does not refund a fresh order that became paid before the order lock', async () => {
    const f = setup()
    f.order.status = 'paid'
    expect((await f.run()).action).toBe('failed')
    expect(provider.refund).not.toHaveBeenCalled()
  })

  it('offers owner-visible local recovery and completes it without customer or invoice assumptions', async () => {
    const f = setup()
    f.failures.order = true
    await f.run()
    const before = vi.mocked(f.payload.update).mock.calls.length
    expect(await f.status()).toMatchObject({ state: 'recoverable' })
    expect(vi.mocked(f.payload.update).mock.calls.length).toBe(before)
    f.failures.order = false
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(await f.status()).toMatchObject({ state: 'clear' })
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(documents.storno).not.toHaveBeenCalled()
    expect(access.apply).not.toHaveBeenCalled()
  })

  it('does not launch without an acknowledged prepared baseline', async () => {
    const f = setup()
    f.failures.receipt = 'refund-prepared'
    f.failures.receiptAfterWrite = true
    expect((await f.run()).action).toBe('failed')
    // Indítási engedély nélkül Barion-kérés nem ment: a kísérlet igazoltan hatástalan.
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'provider_failed',
      activeOrderKey: null,
      reconciliationReference: NO_PROVIDER_REQUEST_REFERENCE,
    })
    f.failures.receipt = ''
    // Az újrapróbálás csak a várakozási idő után jön, addig nincs POST.
    expect((await f.run()).action).toBe('failed')
    expect(provider.refund).not.toHaveBeenCalled()
  })

  it('completes locally after a lost provider-proof acknowledgement, without a second POST', async () => {
    const f = setup()
    f.failures.receipt = 'refund-provider-succeeded'
    f.failures.receiptAfterWrite = true
    expect((await f.run()).action).toBe('failed')
    expect(store.intents.get(f.payload)?.state).toBe('provider_started')
    f.failures.receipt = ''
    // A tartósan rögzített, korrelált Barion-siker bizonyíték: helyi lezárás, új pénzmozgás nélkül.
    expect(await f.run()).toMatchObject({ action: 'refunded', detail: 'provider-reconciled' })
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(f.order).toMatchObject({ status: 'refunded', refunds: [{ amountHuf: 20000 }] })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
  })

  it.each(['payment', 'currency', 'amount', 'source-status', 'source-duplicate', 'pos'])(
    'rejects unproven fresh source %s before the ledger and POST',
    async (kind) => {
      const f = setup()
      if (kind === 'payment') f.state.PaymentId = 'OTHER-PAYMENT'
      if (kind === 'currency') f.state.Currency = 'EUR'
      if (kind === 'amount') f.state.Transactions[0].Total = 1.5
      if (kind === 'source-status') f.state.Transactions[0].Status = 'Refunded'
      if (kind === 'source-duplicate') f.state.Transactions.push({ ...f.state.Transactions[0] })
      if (kind === 'pos') f.state.Transactions[0].POSTransactionId = ''
      expect((await f.run()).action).toBe('failed')
      expect(provider.refund).not.toHaveBeenCalled()
      expect(store.intents.get(f.payload)).toBeUndefined()
    },
  )
})
