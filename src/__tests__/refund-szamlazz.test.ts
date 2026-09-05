import { describe, expect, it } from 'vitest'
import { fixture, documents, provider, store, claimInvoice } from './refund-fixture'

describe('refund document selection and safe recovery', () => {
  it('first full uses storno, not corrective', async () => {
    const f = fixture()
    await f.start()
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(documents.corrective).not.toHaveBeenCalled()
  })
  it('partial uses exact corrective sequence and amount', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    expect(documents.corrective).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refundSeq: 1, amountHuf: 5000 }),
    )
    expect(documents.storno).not.toHaveBeenCalled()
  })
  it('closing partial uses corrective, not storno', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    await f.start({ operationKey: 'B'.repeat(42) + 'A' })
    expect(documents.corrective).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ refundSeq: 2, amountHuf: 15000 }),
    )
    expect(documents.storno).not.toHaveBeenCalled()
    expect(f.user.purchases).toEqual([99])
  })
  it.each(['storno', 'corrective'] as const)(
    '%s ambiguity never queues or retries a provider POST',
    async (kind) => {
      const f = fixture()
      documents[kind].mockImplementation(async () => {
        await claimInvoice(f.payload, kind)
        throw new Error('SYNTHETIC timeout')
      })
      await expect(f.start(kind === 'corrective' ? { amountHuf: 5000 } : {})).rejects.toThrow()
      expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
      expect(documents[kind]).toHaveBeenCalledTimes(1)
      expect(documents.queue).not.toHaveBeenCalled()
      expect(provider.refund).toHaveBeenCalledTimes(1)
    },
  )
  it('disabled invoice is manual, not committed', async () => {
    const f = fixture()
    documents.storno.mockResolvedValue({ outcome: 'disabled' })
    await expect(f.start()).rejects.toThrow()
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
  })
  it('a successful helper return without a persisted document is not completion', async () => {
    const f = fixture()
    documents.storno.mockImplementation(async () => {
      await claimInvoice(f.payload, 'storno')
      return { outcome: 'storned', stornoNumber: 'SYNTHETIC-NOT-SAVED' }
    })
    await expect(f.start()).rejects.toThrow()
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })
  it('an existing uncertain storno attempt is never submitted again', async () => {
    const f = fixture()
    f.order.stornoAttempts = 1
    await expect(f.start()).rejects.toThrow()
    expect(documents.storno).not.toHaveBeenCalled()
  })
  it('missing original invoice can be processed once after it becomes durably available', async () => {
    const f = fixture()
    f.order.invoiceNumber = null
    await expect(f.start()).rejects.toThrow()
    expect(documents.storno).not.toHaveBeenCalled()
    f.order.invoiceNumber = 'SYNTHETIC-INVOICE-RECOVERED'
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  it('adopts the actual stored result after invoice-done acknowledgement loss', async () => {
    const f = fixture()
    f.failures.receipt = 'refund-invoice-done'
    await expect(f.start()).rejects.toThrow()
    f.failures.receipt = ''
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })
})
