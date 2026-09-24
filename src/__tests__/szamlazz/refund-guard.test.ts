import { describe, expect, it, vi } from 'vitest'

import { documents, fixture, locks, store } from '../refund-fixture'
import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import { issueCorrectiveInvoiceForOrder } from '../../lib/szamlazz/corrective'
import { issueStornoForOrder } from '../../lib/szamlazz/storno'
import type { InvoiceLookupResult } from '../../lib/szamlazz/pdf'
import { RECEIPTS, writeReceipt } from '../../lib/refund/recovery-receipts'
import { claimManagedRefundDocument } from '../../lib/szamlazz/refund-guard'
import type { RefundIntent } from '../../payload-types'

const config = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: 'DUMMY-REFUND-GUARD-AGENT-KEY',
  SZAMLAZZ_AFAKULCS: '27',
})

function realDocuments() {
  const f = fixture()
  f.order.customerSnapshot = {
    name: 'Synthetic Buyer',
    email: 'synthetic@example.test',
    billingName: 'Synthetic Buyer',
    billingZip: '1111',
    billingCity: 'Budapest',
    billingStreet: 'Synthetic street 1',
  }
  f.order.invoiceCompletionDate = '2026-09-05'
  const post = vi.fn(async () => ({ szamlaszam: 'SYNTHETIC-CREDIT-1' }))
  const query = vi.fn<() => Promise<InvoiceLookupResult | null>>(async () => null)
  const deps = {
    payload: f.payload,
    config,
    postXml: post,
    queryByKulsoAzon: query,
    refundSeq: 1,
    amountHuf: 5000,
  }
  documents.corrective.mockImplementation((order, options) =>
    issueCorrectiveInvoiceForOrder(order, {
      ...options,
      config,
      postXml: post,
      queryByKulsoAzon: query,
    }),
  )
  documents.storno.mockImplementation((order, options) =>
    issueStornoForOrder(order, { ...options, config, postXml: post }),
  )
  return { ...f, post, query, deps }
}

describe('intent-managed refunds through real invoice helpers', () => {
  it('does not grant launch permission for a claim created by another caller between reads', async () => {
    const f = realDocuments()
    documents.corrective.mockRejectedValue(new Error('SYNTHETIC pause before invoicing'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    const intent = store.intents.get(f.payload)!
    await writeReceipt(f.payload, intent, RECEIPTS.invoiceStarted, {
      version: 1,
      kind: 'corrective',
      sequence: 1,
    })
    const find = vi.mocked(f.payload.find).getMockImplementation()!
    vi.spyOn(f.payload, 'find')
      .mockImplementationOnce(
        async () =>
          ({
            docs: [],
            totalDocs: 0,
            hasNextPage: false,
          }) as never,
      )
      .mockImplementation(find)
    const create = vi.spyOn(f.payload, 'create').mockClear()
    await expect(
      claimManagedRefundDocument(
        f.payload,
        {
          intent,
          kind: 'corrective',
          number: null,
        },
        0,
      ),
    ).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
    expect(f.post).not.toHaveBeenCalled()
  })

  it.each(['totalHuf', 'alreadyRefundedHuf', 'type'] as const)(
    'rejects a contradictory provider snapshot %s before document lookup or submission',
    async (field) => {
      const f = realDocuments()
      documents.corrective.mockRejectedValue(new Error('SYNTHETIC pause before invoicing'))
      await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
      const proof = f.audits.find((entry) => entry.action === RECEIPTS.provider)!.after as Record<
        string,
        unknown
      >
      proof[field] = field === 'type' ? 'full' : -1
      await expect(issueCorrectiveInvoiceForOrder(f.order, f.deps)).rejects.toThrow()
      expect(f.query).not.toHaveBeenCalled()
      expect(f.post).not.toHaveBeenCalled()
    },
  )

  it('does not adopt another invocation after a silently lost claim write', async () => {
    const f = realDocuments()
    documents.corrective.mockRejectedValue(new Error('SYNTHETIC pause before invoicing'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    const intent = store.intents.get(f.payload)!
    vi.mocked(f.payload.create).mockImplementationOnce(async (args) => {
      const data = (args as unknown as { data: Omit<(typeof f.audits)[number], 'id'> }).data
      const replacement = {
        id: 900,
        ...data,
        after: {
          ...(data.after as Record<string, unknown>),
          claimReference: 'another-invocation',
        },
      }
      f.audits.push(replacement)
      return replacement as never
    })
    await expect(
      claimManagedRefundDocument(
        f.payload,
        {
          intent,
          kind: 'corrective',
          number: null,
        },
        0,
      ),
    ).rejects.toThrow('unacknowledged persistence')
    expect(f.post).not.toHaveBeenCalled()
  })

  it('claims inside the corrective lock and blocks a standalone retry after timeout plus negative lookup', async () => {
    const f = realDocuments()
    f.post.mockImplementation(async () => {
      expect(locks.held.some((key) => key.includes('corrective'))).toBe(true)
      expect(f.audits.some((entry) => entry.action === RECEIPTS.invoiceStarted)).toBe(true)
      throw new Error('SYNTHETIC uncertain credit document')
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    await expect(issueCorrectiveInvoiceForOrder(f.order, f.deps)).rejects.toThrow()
    expect(f.query).toHaveBeenCalledTimes(2)
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.order.correctiveInvoiceAttempts).toBe(1)
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it('a standalone claim made before recovery prevents the recovery path from submitting', async () => {
    const f = realDocuments()
    documents.corrective.mockImplementation(async (order, options) => {
      await writeReceipt(f.payload, store.intents.get(f.payload)!, RECEIPTS.invoiceStarted, {
        version: 1,
        kind: 'corrective',
        sequence: 1,
      })
      return issueCorrectiveInvoiceForOrder(order, {
        ...options,
        config,
        postXml: f.post,
        queryByKulsoAzon: f.query,
      })
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
  })

  it('durable claim prevents replay even when the order attempt marker silently disappears', async () => {
    const f = realDocuments()
    f.post.mockRejectedValue(new Error('SYNTHETIC timeout'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    f.order.correctiveInvoiceAttempts = 0
    f.order.correctiveInvoiceAttemptsSeq = 0
    await expect(issueCorrectiveInvoiceForOrder(f.order, f.deps)).rejects.toThrow()
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it('positive lookup adopts an uncertain corrective result without another submission', async () => {
    const f = realDocuments()
    f.post.mockRejectedValue(new Error('SYNTHETIC timeout'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toThrow()
    f.query.mockResolvedValue({ szamlaszam: 'SYNTHETIC-ADOPTED-CREDIT' })
    await expect(issueCorrectiveInvoiceForOrder(f.order, f.deps)).resolves.toMatchObject({
      outcome: 'issued',
      correctiveInvoiceNumber: 'SYNTHETIC-ADOPTED-CREDIT',
    })
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
  })

  it('rejects corrective for the first full refund and storno for a partial before lookup or POST', async () => {
    const f = realDocuments()
    await f.start({ amountHuf: 5000 })
    const count = f.post.mock.calls.length
    await expect(issueStornoForOrder(f.order, f.deps)).rejects.toThrow()
    expect(f.post).toHaveBeenCalledTimes(count)
    const second = realDocuments()
    await second.start()
    const secondCount = second.post.mock.calls.length
    await expect(
      issueCorrectiveInvoiceForOrder(second.order, { ...second.deps, amountHuf: 20000 }),
    ).rejects.toThrow()
    expect(second.query).not.toHaveBeenCalled()
    expect(second.post).toHaveBeenCalledTimes(secondCount)
  })

  it('rejects an incorrect corrective amount and preserves the committed document receipt', async () => {
    const f = realDocuments()
    await f.start({ amountHuf: 5000 })
    await expect(
      issueCorrectiveInvoiceForOrder(f.order, { ...f.deps, amountHuf: 6000 }),
    ).rejects.toThrow()
    expect(f.post).toHaveBeenCalledTimes(1)
    const before = f.query.mock.calls.length
    await expect(issueCorrectiveInvoiceForOrder(f.order, f.deps)).resolves.toMatchObject({
      outcome: 'already-issued',
      correctiveInvoiceNumber: 'SYNTHETIC-CREDIT-1',
    })
    expect(f.query).toHaveBeenCalledTimes(before)
    expect(f.post).toHaveBeenCalledTimes(1)
  })
})

/**
 * A Barion által igazoltan HATÁS NÉLKÜL lezárt kísérlet (provider_failed +
 * egyeztetési bizonyíték, pl. TooLowBalanceToMakeRefund) nem mozgatott pénzt,
 * ezért nem teheti „intent-kezeltté" a rendelés bizonylatát. Korábban egyetlen
 * ilyen sor is elég volt ahhoz, hogy a stornó/helyesbítő a „verified
 * reconciliation" hiányával MINDIG elbukjon (az intent nélküli, hagyományos út
 * helyett).
 */
describe('refund-guard — a hatás nélküli provider_failed kísérlet nem blokkol', () => {
  function legacyRefundedOrder() {
    const f = fixture()
    Object.assign(f.order, {
      status: 'refunded',
      refundedAt: '2026-09-06T10:00:00.000Z',
      refunds: [
        {
          transactionId: 'SYNTHETIC-LEGACY-REFUND-TX',
          amountHuf: 20000,
          status: 'Succeeded',
          refundedAt: '2026-09-06T10:00:00.000Z',
          type: 'full',
        },
      ],
      customerSnapshot: { email: 'synthetic@example.test' },
    })
    const post = vi.fn(async () => ({ szamlaszam: 'SYNTHETIC-STORNO-1' }))
    return { ...f, post }
  }

  function failedIntent(overrides: Partial<RefundIntent> = {}): RefundIntent {
    return {
      id: 81,
      order: 11,
      actor: 1,
      requestedAmountHuf: 20000,
      provider: 'barion',
      providerPaymentId: 'SYNTHETIC-PAYMENT',
      providerTransactionId: 'SYNTHETIC-TX',
      state: 'provider_failed',
      requestHash: 'a'.repeat(64),
      idempotencyKeyHash: 'b'.repeat(64),
      activeOrderKey: null,
      schemaVersion: 1,
      refundSequence: 1,
      currency: 'HUF',
      reason: null,
      providerStartedAt: '2026-09-05T10:00:01.000Z',
      providerResolvedAt: '2026-09-05T10:00:05.000Z',
      committedAt: null,
      reconciliationCheckedAt: '2026-09-05T10:00:05.000Z',
      reconciliationReference: 'SYNTHETIC-GETSTATE-NO-EFFECT',
      createdAt: '2026-09-05T10:00:00.000Z',
      updatedAt: '2026-09-05T10:00:05.000Z',
      ...overrides,
    } as unknown as RefundIntent
  }

  it('csak no-effect provider_failed előzmény: a stornó a hagyományos úton kiáll', async () => {
    const f = legacyRefundedOrder()
    store.intents.set(f.payload, failedIntent())

    await expect(
      issueStornoForOrder(f.order, { payload: f.payload, config, postXml: f.post }),
    ).resolves.toEqual({ outcome: 'storned', stornoNumber: 'SYNTHETIC-STORNO-1' })
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.order.stornoStatus).toBe('storned')
  })

  it('bizonyíték NÉLKÜLI provider_failed továbbra is blokkol (fail-closed), POST nélkül', async () => {
    const f = legacyRefundedOrder()
    store.intents.set(
      f.payload,
      failedIntent({ reconciliationCheckedAt: null, reconciliationReference: null }),
    )

    await expect(
      issueStornoForOrder(f.order, { payload: f.payload, config, postXml: f.post }),
    ).rejects.toThrow('verified reconciliation')
    expect(f.post).not.toHaveBeenCalled()
  })

  it('feloldatlan (provider_unknown) kísérlet mellett a no-effect sor sem nyit utat: blokkol, POST nélkül', async () => {
    const f = legacyRefundedOrder()
    store.history.set(f.payload, [failedIntent()])
    store.intents.set(
      f.payload,
      failedIntent({
        id: 82,
        state: 'provider_unknown',
        providerResolvedAt: null,
        reconciliationCheckedAt: null,
        reconciliationReference: null,
      }),
    )

    await expect(
      issueStornoForOrder(f.order, { payload: f.payload, config, postXml: f.post }),
    ).rejects.toThrow('verified reconciliation')
    expect(f.post).not.toHaveBeenCalled()
  })

  it('no-effect sor + sikeres intent ugyanarra a sorszámra: a sikeres intent dönt (kezelt út, igazolás kell)', async () => {
    const f = realDocuments()
    documents.storno.mockRejectedValue(new Error('SYNTHETIC pause before invoicing'))
    await expect(f.start()).rejects.toThrow()
    const succeeded = store.intents.get(f.payload)!
    store.history.set(f.payload, [failedIntent({ id: 70 }), succeeded])
    const post = vi.fn(async () => ({ szamlaszam: 'SYNTHETIC-STORNO-2' }))

    await expect(
      issueStornoForOrder(f.order, { payload: f.payload, config, postXml: post }),
    ).resolves.toEqual({ outcome: 'storned', stornoNumber: 'SYNTHETIC-STORNO-2' })
    expect(post).toHaveBeenCalledTimes(1)
    // A kezelt út a saját indítási nyugtáját is rögzítette (claim).
    expect(f.audits.some((entry) => entry.action === RECEIPTS.invoiceStarted)).toBe(true)
  })
})
