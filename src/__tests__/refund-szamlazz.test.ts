import { describe, expect, it } from 'vitest'
import { fixture, documents, provider, store, claimInvoice } from './refund-fixture'
import { CORRECTIVE_LOCAL_ERROR_PREFIX } from '../lib/szamlazz/corrective'

describe('refund document selection and safe recovery', () => {
  it('first full uses storno, not corrective, and never hands it the owner reason', async () => {
    const f = fixture()
    await f.start({ reason: 'Elállás, telefonon egyeztetve' })
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(documents.corrective).not.toHaveBeenCalled()
    // A tulajdonos indoka a rendelésé; a stornó megjegyzését a vevő és a NAV is
    // látja, oda csak a rendszer rögzített indoka kerülhet (invoice.ts).
    expect(f.order.refundReason).toBe('Elállás, telefonon egyeztetve')
    expect(documents.storno.mock.calls[0]![1]).not.toHaveProperty('reason')
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
  it('storno ambiguity never queues or retries a provider POST', async () => {
    const f = fixture()
    documents.storno.mockImplementation(async () => {
      await claimInvoice(f.payload, 'storno')
      throw new Error('SYNTHETIC timeout')
    })
    await expect(f.start()).rejects.toThrow()
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(documents.queue).not.toHaveBeenCalled()
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
  // W1B-4: a claim utáni bármilyen hiba (itt a szám mentésének adatbázis-hibája
  // a sikeres POST után) a keresés-átvétel jobhoz megy, egyszer; új POST ettől
  // sincs, és a panel nem mondja se azt, hogy a helyesbítő biztosan nem
  // készült el, se azt, hogy a helyi hiba a Számlázz.hu üzenete volna.
  it('corrective ambiguity after the claim queues only the lookup-and-adopt job, never a second provider POST', async () => {
    const f = fixture()
    documents.queue.mockResolvedValue(true)
    documents.corrective.mockImplementation(async () => {
      await claimInvoice(f.payload, 'corrective')
      // A corrective.ts catch-ágának mentett állapota (szám nélkül, helyi hiba).
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 1,
        correctiveInvoiceLastError: `${CORRECTIVE_LOCAL_ERROR_PREFIX}Connection terminated unexpectedly`,
      })
      throw new Error('Connection terminated unexpectedly')
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect(documents.queue).toHaveBeenCalledExactlyOnceWith(
      f.payload,
      f.order.id,
      1,
      expect.anything(),
    )
    const queued = f.audits.filter((row) => row.action === 'refund-invoice-retry-queued')
    expect(queued).toHaveLength(1)
    expect(queued[0].after).toMatchObject({ kind: 'corrective', queuedAt: expect.any(String) })
    const status = await f.status()
    expect(status.state).toBe('manual_review')
    expect(status.message).toContain('Ne állíts ki kézzel helyesbítőt, amíg ez az üzenet látszik.')
    expect(status.message).not.toContain('A helyesbítő számla nem készült el.')
    expect(status.message).not.toContain('Connection terminated unexpectedly')
    expect(status.message).not.toContain('Számlázz.hu utolsó hibaüzenete')
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(documents.corrective).toHaveBeenCalledTimes(1)
    expect(documents.queue).toHaveBeenCalledTimes(1)
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
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
