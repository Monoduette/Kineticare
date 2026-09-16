import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fixture, locks, provider, store } from '../refund-fixture'
import { applyBarionStateTransition } from '../../lib/order-status/apply-barion-state'
import { recoverRejectedSucceededPayment } from '../../lib/order-status/recover-paid-reject'
import * as intentStore from '../../lib/refund/intent-store'
import { createLogger } from '../../lib/logger'
import type { BarionPaymentStateResponse } from '../../lib/barion'

function setup() {
  const f = fixture()
  Object.assign(f.order, { status: 'payment_pending', currency: 'HUF', invoiceNumber: null })
  f.user.purchases = []
  const state: BarionPaymentStateResponse = {
    PaymentId: f.order.barionPaymentId!,
    PaymentRequestId: 'SYNTHETIC-REVIEW',
    Status: 'Succeeded',
    Total: 20000,
    Currency: 'HUF',
    Transactions: [
      {
        TransactionId: '11111111-2222-3333-4444-555555555555',
        POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: 20000,
      },
    ],
  }
  const paid = () =>
    applyBarionStateTransition({
      payload: f.payload,
      order: structuredClone(f.order),
      mapped: 'paid',
      state,
      log: createLogger({}),
    })
  const recover = (reason = 'duplicate-paid-order') =>
    recoverRejectedSucceededPayment({
      payload: f.payload,
      order: structuredClone(f.order),
      state,
      reason,
      source: 'callback',
      log: createLogger({}),
      refundPayment: provider.refund,
    })
  return { ...f, state, paid, recover }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PAY-REFUND-REENTRY: az aktív refund megelőzi a paid hozzáférés-írást', () => {
  it.each(['provider_unknown', 'provider_succeeded'] as const)(
    'a tényleges auto refund %s állapota után sem lesz új paid/grant',
    async (outcome) => {
      const f = setup()
      f.failures.otherPaid = true
      expect(await f.paid()).toMatchObject({ action: 'rejected', reason: 'duplicate-paid-order' })
      if (outcome === 'provider_unknown')
        provider.refund.mockRejectedValue(new Error('SYNTHETIC response loss'))
      else f.failures.order = true
      await f.recover()
      expect(store.intents.get(f.payload)?.state).toBe(outcome)
      expect(f.order.status).toBe('payment_pending')
      expect(f.order.refunds).toEqual([])
      f.failures.order = false
      // A korábbi duplicate hozzáférés közben lejárt: a másik paid őr átengedne.
      f.failures.otherPaid = false
      expect(await f.paid()).toEqual({
        action: 'rejected',
        reason: 'refund-pending-reconciliation',
      })
      expect(f.order.status).toBe('payment_pending')
      expect(f.user.purchases).toEqual([])
      expect(f.user.accessGrants).toEqual([])
      expect(provider.refund).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['owner', 'system'] as const)(
    '%s actor prepared/started/unknown/succeeded állapota is kapu',
    async (actorKind) => {
      const f = setup()
      const intent = await intentStore.createRefundIntent(
        f.payload,
        {
          ...(actorKind === 'owner'
            ? { schemaVersion: 1 as const, actorId: '1' }
            : {
                schemaVersion: 2 as const,
                actorId: null,
                actorKind: 'system' as const,
                systemActor: 'paid-reject-recovery' as const,
              }),
          orderId: String(f.order.id),
          provider: 'barion',
          providerPaymentId: f.order.barionPaymentId!,
          providerTransactionId: f.state.Transactions[0].TransactionId!,
          refundSequence: 1,
          requestedAmountHuf: 20000,
          currency: 'HUF',
          reason: 'SYNTHETIC review',
        },
        'SYNTHETIC-ACTIVE-OPERATION',
      )
      for (const state of [
        'prepared',
        'provider_started',
        'provider_unknown',
        'provider_succeeded',
      ] as const) {
        store.intents.set(f.payload, { ...intent, state })
        expect(await f.paid()).toMatchObject({
          action: 'rejected',
          reason: 'refund-pending-reconciliation',
        })
      }
      expect(f.payload.update).not.toHaveBeenCalled()
      expect(f.payload.create).not.toHaveBeenCalled()
      expect(f.user.purchases).toEqual([])
      expect((await f.recover('refund-pending-reconciliation')).action).toBe('failed')
      expect(provider.refund).not.toHaveBeenCalled()
    },
  )

  it('a tárolóhibát nem tekinti üres intentnek, és customer feloldásig sem jut', async () => {
    const f = setup()
    const lookup = vi
      .spyOn(intentStore, 'loadActiveRefundIntent')
      .mockImplementationOnce(async (payload, id) => {
        expect(payload).toBe(f.payload)
        expect(id).toBe(f.order.id)
        expect(locks.held).toContain(`order:mutate:${f.order.id}`)
        throw new Error('SYNTHETIC ledger unavailable')
      })
    await expect(f.paid()).rejects.toThrow('SYNTHETIC ledger unavailable')
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(vi.mocked(f.payload.findByID).mock.calls.map(([args]) => args.collection)).toEqual([
      'orders',
    ])
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.payload.create).not.toHaveBeenCalled()
  })

  it('a tényleges SQL parser hibás actor/provenance sora is zárja a paid utat', async () => {
    const f = setup()
    const actual = await vi.importActual<typeof intentStore>('../../lib/refund/intent-store')
    const dialect = new PgDialect()
    const execute = vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      expect(compiled.sql).toContain('FROM "public"."refund_intents"')
      expect(compiled.sql).toContain('WHERE order_id = $1')
      expect(compiled.params[0]).toBe(f.order.id)
      return {
        rows: [
          {
            state: 'provider_unknown',
            order: f.order.id,
            schemaVersion: 2,
            actor: 1,
            actorKind: 'system',
            systemActor: 'paid-reject-recovery',
          },
        ],
        rowCount: 1,
      }
    })
    Object.assign(f.payload, {
      db: {
        drizzle: {
          execute,
          transaction: async () => {
            throw new Error('SYNTHETIC unexpected transaction')
          },
        },
      },
    })
    vi.spyOn(intentStore, 'loadActiveRefundIntent').mockImplementationOnce(
      actual.loadActiveRefundIntent,
    )
    await expect(f.paid()).rejects.toMatchObject({ code: 'invalid_record' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.payload.create).not.toHaveBeenCalled()
  })

  it('lezárt részleges refund után a meglévő hozzáférést megőrzi, új paid/grant nélkül', async () => {
    const f = setup()
    f.order.status = 'paid'
    f.order.refunds = [
      {
        transactionId: 'SYNTHETIC-OLD',
        amountHuf: 1000,
        status: 'Succeeded',
        type: 'partial',
        refundedAt: '2026-09-05T10:00:00.000Z',
      },
    ]
    f.user.purchases = [42]
    expect(await f.paid()).toMatchObject({ action: 'rejected', reason: 'refund-recorded' })
    expect(f.user.purchases).toEqual([42])
    expect(f.order.status).toBe('paid')
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(provider.refund).not.toHaveBeenCalled()
  })

  it('üres főkönyvnél megmarad az egyszeri paid + külön membership és eredetóra', async () => {
    const f = setup()
    expect(await f.paid()).toMatchObject({ action: 'paid', transitionedToPaid: true })
    expect(f.user.purchases).toEqual([42])
    expect(f.user.accessGrants).toEqual([
      { product: 42, sourceOrder: f.order.id, sourceKind: 'order', grantedAt: expect.any(String) },
    ])
    expect(f.order.status).toBe('paid')
    expect(provider.refund).not.toHaveBeenCalled()
  })

  it('refund és paid párhuzamosan: az order-zár után az új provider_unknown intent látszik', async () => {
    const f = setup()
    let announceStarted!: () => void
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve
    })
    let releaseProvider!: () => void
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    provider.refund.mockImplementation(async () => {
      announceStarted()
      await providerReleased
      throw new Error('SYNTHETIC lost response')
    })
    const refund = f.recover()
    await started
    expect(locks.held).toContain(`order:mutate:${f.order.id}`)
    const paid = f.paid()
    releaseProvider()
    expect((await refund).action).toBe('failed')
    expect(await paid).toMatchObject({
      action: 'rejected',
      reason: 'refund-pending-reconciliation',
    })
    expect(f.order.status).toBe('payment_pending')
    expect(f.user.purchases).toEqual([])
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
})

describe('az új reject reason kizárólag helyi reconciliation', () => {
  it('aktív provider_succeeded befejezhető, majd a committed completion visszaolvasható új POST nélkül', async () => {
    const f = setup()
    f.failures.order = true
    await f.recover()
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
    f.failures.order = false
    const rejected = await f.paid()
    expect(rejected.reason).toBe('refund-pending-reconciliation')
    expect(await f.recover(rejected.reason)).toMatchObject({ action: 'refunded' })
    expect(f.order.status).toBe('refunded')
    expect(await f.recover('refund-pending-reconciliation')).toMatchObject({ action: 'refunded' })
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(f.user.purchases).toEqual([])
  })

  it.each(['empty', 'cleared', 'unproven-refunded'] as const)(
    '%s ledger nem indíthat új pénzműveletet a reconciliation reasonnel',
    async (kind) => {
      const f = setup()
      if (kind === 'cleared') {
        provider.refund.mockRejectedValue(new Error('SYNTHETIC response loss'))
        await f.recover()
        store.intents.clear()
        store.history.clear()
        provider.refund.mockClear()
      }
      if (kind === 'unproven-refunded') f.order.status = 'refunded'
      expect(await f.recover('refund-pending-reconciliation')).toMatchObject({ action: 'failed' })
      expect(provider.refund).not.toHaveBeenCalled()
      expect(store.intents.get(f.payload)).toBeUndefined()
      expect(f.user.purchases).toEqual([])
    },
  )
})
