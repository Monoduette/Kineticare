import { describe, expect, it } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { access, claimInvoice, documents, fixture, provider, store } from '../refund-fixture'
import { claimManagedRefundDocument } from '../../lib/szamlazz/refund-guard'
import { SzamlazzApiError } from '../../lib/szamlazz/types'
import type { Order } from '../../payload-types'

/**
 * A Barion-siker utáni helyi feldolgozás elakadásai (a-refund-4, a-refund-10):
 * a tulajdonos üzenete megnevezi a kurzust és a következő lépést, a
 * helyesbítő átmeneti hibája a meglévő újrapróbáló jobhoz megy, a job
 * eredményét a job maga, tartalékként a „Feldolgozás folytatása” veszi át. A
 * stornót a rendszer beküldés után soha nem küldi újra (F3).
 */

function withCourse(f: ReturnType<typeof fixture>) {
  Object.assign(f.order, {
    items: [{ product: 42, quantity: 1, titleSnapshot: 'Kézterápia alapok' }],
  } satisfies Partial<Order>)
}

describe('a-refund-10: a hozzáférés kézi rendezése a kurzus nevével és a következő lépéssel', () => {
  it.each([
    ['grant-provenance', 'nem ehhez a rendeléshez van kötve'],
    ['access-changed', 'megváltozhattak'],
  ] as const)('%s: a panel megnevezi a kurzust, az okot és a teendőt', async (detail, why) => {
    const f = fixture()
    withCourse(f)
    access.apply.mockResolvedValueOnce({ status: 'manual_review', detail, productId: 42 })
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    const status = await f.status()
    expect(status.state).toBe('manual_review')
    expect(status.message).toContain(
      'A „Kézterápia alapok” kurzus hozzáférését a rendszer nem vonta vissza',
    )
    expect(status.message).toContain(why)
    expect(status.message).toContain('Következő lépés: jelezd az üzemeltetőnek')
    // A jogosultság-szabály változatlan: a hozzáférés megmaradt, a rendszer nem vett el semmit.
    expect(f.user.purchases).toContain(42)
    expect(f.audits.find((row) => row.action === 'refund-cleanup-manual')?.after).toMatchObject({
      detail,
      productId: 42,
    })
  })
})

describe('a-refund-4: a helyesbítő újrapróbálható hibája a meglévő jobhoz megy', () => {
  function failCorrectiveOnce(f: ReturnType<typeof fixture>) {
    documents.corrective.mockImplementationOnce(async () => {
      await claimInvoice(f.payload, 'corrective')
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 1,
        correctiveInvoiceLastError: 'A Számlázz.hu nem válaszolt időben.',
      })
      throw new SzamlazzApiError({
        message: 'A Számlázz.hu nem válaszolt időben.',
        kind: 'timeout',
        retryable: true,
      })
    })
  }

  it('sorba állítja a jobot, a panel a háttérbeli ellenőrzést mondja, és a job eredménye után a folytatás lezár', async () => {
    const f = fixture()
    failCorrectiveOnce(f)
    documents.queue.mockResolvedValue(true)
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect(documents.queue).toHaveBeenCalledExactlyOnceWith(
      f.payload,
      f.order.id,
      1,
      expect.anything(),
    )
    const waiting = await f.status()
    expect(waiting.state).toBe('manual_review')
    expect(waiting.message).toContain('A rendszer a háttérben újra megpróbálja')
    expect(waiting.message).toContain('A Számlázz.hu nem válaszolt időben.')
    // W1B-1: amíg a job dolgozik, a panel kifejezetten tiltja a kézi
    // kiállítást (a Figyelmet igényel blokk erre a mondatra hivatkozik), és
    // W1B-6: nem kéri, hogy a tulajdonos visszatérve maga fejezze be.
    expect(waiting.message).toContain('Ne állíts ki kézzel helyesbítőt, amíg ez az üzenet látszik.')
    expect(waiting.message).not.toContain('Feldolgozás folytatása')
    // A gombnyomás sem küld új helyesbítőt, amíg a job nem végzett.
    await f.recover()
    expect(documents.corrective).toHaveBeenCalledTimes(1)
    expect(documents.queue).toHaveBeenCalledTimes(1)

    // A job a beküldés előtti lekérdezéssel megtalálta és rögzítette a bizonylatot.
    Object.assign(f.order, {
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-10',
      correctiveInvoiceSeq: 1,
    })
    expect((await f.status()).state).toBe('recoverable')
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.audits.find((row) => row.action === 'refund-invoice-done')?.after).toMatchObject({
      number: 'KIN-2026-10',
    })
    expect(documents.corrective).toHaveBeenCalledTimes(1)
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })

  // A job (corrective.ts) negatív lekérdezés után a valódi refund-őrt hívja;
  // az első kísérlet után az őr megtagadja a beküldést, és a helyesbítő a
  // dobott (angol, belső) szöveget a rendelés utolsó hibájaként menti. Ez nem
  // a Számlázz.hu üzenete, a panel nem mutathatja annak.
  it.each([
    [
      'a sorba állítás jelzése megvan',
      '',
      'A rendszer a háttérben megnézte a Számlázz.hu-ban, de ehhez a visszatérítéshez nem talált helyesbítő számlát, és nem küldi be újra.',
    ],
    [
      'a sorba állítás jelzése elveszett',
      'refund-invoice-retry-queued',
      'Jelezd az üzemeltetőnek a rendelésszámmal együtt; a rendszer nem küldi be újra.',
    ],
  ] as const)(
    'a job negatív ága (%s): a refund-őr elutasítása nem Számlázz.hu-hibaüzenet, és a panel nem ígér háttérbeli ellenőrzést',
    async (_label, lostReceipt, expected) => {
      const f = fixture()
      failCorrectiveOnce(f)
      documents.queue.mockResolvedValue(true)
      f.failures.receipt = lostReceipt
      await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
      f.failures.receipt = ''
      const intent = store.intents.get(f.payload)!
      const refusal = await claimManagedRefundDocument(
        f.payload,
        { intent, kind: 'corrective', number: null },
        f.order.correctiveInvoiceAttempts ?? 0,
      ).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(Error)
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceLastError: (refusal as Error).message,
      })
      const status = await f.status()
      expect(status.state).toBe('manual_review')
      expect(status.message).toContain('A helyesbítő számla nem készült el.')
      expect(status.message).toContain(expected)
      expect(status.message).not.toContain('A Számlázz.hu utolsó hibaüzenete')
      expect(status.message).not.toContain((refusal as Error).message)
      expect(status.message).not.toContain('A rendszer a háttérben megnézi')
      expect(documents.queue).toHaveBeenCalledTimes(1)
      expect(documents.corrective).toHaveBeenCalledTimes(1)
    },
  )

  // A végleges Számlázz.hu-elutasítást a corrective.ts nem dobja, hanem
  // 'failed' kimenettel adja vissza. Az igénylés után ez sem „biztosan nem
  // készült el” (W1B-4): a panel a fiók ellenőrzését kéri a helyesbítő
  // rendelésszámával, és nem ígér újrapróbálást.
  it('végleges hibánál nem állít sorba jobot, és a fiók ellenőrzését kéri', async () => {
    const f = fixture()
    documents.corrective.mockImplementationOnce(async () => {
      await claimInvoice(f.payload, 'corrective')
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 1,
        correctiveInvoiceLastError: 'Számla Agent elutasította a számlakiállítást: 57',
      })
      return { outcome: 'failed', reason: 'Számla Agent elutasította a számlakiállítást: 57' }
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    await f.recover()
    expect(documents.queue).not.toHaveBeenCalled()
    const status = await f.status()
    expect(status.state).toBe('manual_review')
    expect(status.message).toContain('A helyesbítő számla nem készült el biztosan')
    expect(status.message).toContain(
      'Nézd meg a Számlázz.hu-fiókodban, készült-e helyesbítő a(z) SYNTHETIC-RECOVERY-11-HELYESBITO-1 rendelésszámmal',
    )
    expect(status.message).toContain('A rendszer a helyesbítőt nem küldi be újra.')
    expect(status.message).not.toContain('A helyesbítő számla nem készült el.')
    expect(documents.corrective).toHaveBeenCalledTimes(1)
  })

  it('a stornót beküldés után nem küldi újra: a panel a Számlázz.hu-fiók ellenőrzését kéri, job nélkül', async () => {
    const f = fixture()
    documents.storno.mockImplementationOnce(async () => {
      await claimInvoice(f.payload, 'storno')
      Object.assign(f.order, {
        stornoStatus: 'failed',
        stornoAttempts: 1,
        stornoLastError: 'A Számlázz.hu nem válaszolt időben.',
      })
      throw new SzamlazzApiError({ message: 'SYNTHETIC', kind: 'timeout', retryable: true })
    })
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    const status = await f.status()
    expect(status.message).toContain('Nézd meg a Számlázz.hu-fiókodban')
    expect(status.message).toContain('SYNTHETIC-INV')
    expect(status.message).toContain('A rendszer a stornót nem küldi be újra.')
    await f.recover()
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(documents.queue).not.toHaveBeenCalled()
  })
})
