import { afterEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { claimInvoice, documents, fixture, store } from '../refund-fixture'
import {
  REFUND_INVOICE_RETRY_QUEUED_ACTION,
  writeReceipt,
} from '../../lib/refund/recovery-receipts'
import { getRefundRecoveryStatus, recoverRefundOrder } from '../../lib/refund/refund-recovery'
import { CORRECTIVE_RETRY_ESCALATION_MS } from '../../lib/szamlazz/refund-guard'
import { SzamlazzApiError } from '../../lib/szamlazz/types'

/**
 * W1B-4 és W1B-1: a helyesbítő bizonytalan kimenete (a kérés elmehetett) a
 * keresés-átvétel jobhoz kerül, a panel pedig nem ad a Figyelmet igényel
 * blokkal ellentétes utasítást. A job halála után (lejárt határidő) a panel
 * nem ígér tovább háttérbeli ellenőrzést, hanem a kereséssel kezdődő kézi
 * rendezést kéri.
 */

const DO_NOT_ISSUE = 'Ne állíts ki kézzel helyesbítőt, amíg ez az üzenet látszik.'
const T0 = Date.parse('2026-09-25T08:00:00.000Z')

afterEach(() => {
  vi.useRealTimers()
})

type Fixture = ReturnType<typeof fixture>

/** Az első helyesbítő-kísérlet az igénylés ELŐTT megszakad: sem igénylés, sem sorba állítás. */
async function startWithPauseBeforeClaim(f: Fixture) {
  documents.queue.mockResolvedValue(true)
  documents.corrective.mockRejectedValueOnce(new Error('SYNTHETIC pause before invoicing'))
  await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
}

/** Egy későbbi futás igényelt, a pending-írás és a beküldés után a folyamat leállt. */
async function crashAfterCorrectivePost(f: Fixture) {
  await claimInvoice(f.payload, 'corrective')
  Object.assign(f.order, {
    correctiveInvoiceStatus: 'pending',
    correctiveInvoiceAttempts: 1,
    correctiveInvoiceAttemptsSeq: 1,
  })
}

function queuedReceipts(f: Fixture): unknown[] {
  return f.audits
    .filter((row) => row.action === REFUND_INVOICE_RETRY_QUEUED_ACTION)
    .map((row) => row.after)
}

describe('W1B-4: a beküldés után leállt folyamat (pending, igénylés, szám nélkül)', () => {
  it('a folytatás egyszer sorba állítja a keresés-átvétel jobot, és a jelzést az idővel együtt rögzíti', async () => {
    const f = fixture()
    await startWithPauseBeforeClaim(f)
    // Negatív kontroll: az igénylés előtti, nem újrapróbálható hiba nem állít sorba jobot.
    expect(documents.queue).not.toHaveBeenCalled()
    await crashAfterCorrectivePost(f)

    await f.recover()

    expect(documents.queue).toHaveBeenCalledTimes(1)
    expect(documents.queue.mock.calls[0].slice(0, 3)).toEqual([f.payload, f.order.id, 1])
    expect(queuedReceipts(f)).toEqual([
      expect.objectContaining({ kind: 'corrective', sequence: 1, queuedAt: expect.any(String) }),
    ])
    const waiting = await f.status()
    expect(waiting.state).toBe('manual_review')
    expect(waiting.message).toContain(DO_NOT_ISSUE)
    // Újabb gombnyomás sem állít sorba még egy jobot, és nem küld be semmit.
    await f.recover()
    expect(documents.queue).toHaveBeenCalledTimes(1)
    expect(documents.corrective).toHaveBeenCalledTimes(1)
  })

  it('a panel ilyenkor a folytatás gombját mutatja (e nélkül a job sosem állna sorba)', async () => {
    const f = fixture()
    await startWithPauseBeforeClaim(f)
    await crashAfterCorrectivePost(f)

    expect((await f.status()).state).toBe('recoverable')
  })

  it('stornónál ugyanez a helyzet nem állít sorba jobot, a panel a fiók ellenőrzését kéri (F3)', async () => {
    const f = fixture()
    documents.storno.mockRejectedValueOnce(new Error('SYNTHETIC pause before invoicing'))
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    await claimInvoice(f.payload, 'storno')
    Object.assign(f.order, { stornoStatus: 'pending', stornoAttempts: 1 })

    await f.recover()

    expect(documents.queue).not.toHaveBeenCalled()
    expect(documents.storno).toHaveBeenCalledTimes(1)
    const status = await f.status()
    expect(status.state).toBe('manual_review')
    expect(status.message).toContain('A rendszer a stornót nem küldi be újra.')
  })

  // Az igénylés előtt semmi nem ment ki, ezért a folytatás gombja az első
  // beküldést próbálja újra (a helyesbítő-kiállító dönt), nem a keresés-átvétel jobot.
  it('igénylés nélküli végleges hiba (hiányos vevőadat) nem állít sorba jobot, a folytatásra sem', async () => {
    const f = fixture()
    documents.queue.mockResolvedValue(true)
    documents.corrective.mockImplementation(async () => {
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceLastError: 'hiányos vevő-számlázási adatok',
      })
      return { outcome: 'failed', reason: 'hiányos vevő-számlázási adatok' }
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect((await f.status()).state).toBe('recoverable')

    await f.recover()

    expect(documents.corrective).toHaveBeenCalledTimes(2)
    expect(documents.queue).not.toHaveBeenCalled()
    expect(queuedReceipts(f)).toEqual([])
    expect((await f.status()).message).not.toContain(DO_NOT_ISSUE)
  })
})

describe('W1B-1 és W1B-2: a sorba állított job határideje a panelen', () => {
  /** Az igénylés utáni első beküldés időtúllépéssel bukik; a folyamat T0-kor sorba állítja a jobot. */
  async function queuedAtT0() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const f = fixture()
    documents.queue.mockResolvedValue(true)
    documents.corrective.mockImplementationOnce(async () => {
      await claimInvoice(f.payload, 'corrective')
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 1,
        correctiveInvoiceLastError: 'A Számlázz.hu nem válaszolt 30000 ms-en belül.',
      })
      throw new SzamlazzApiError({
        message: 'A Számlázz.hu nem válaszolt 30000 ms-en belül.',
        kind: 'timeout',
        retryable: true,
      })
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    vi.useRealTimers()
    return f
  }

  const statusAt = (f: Fixture, elapsedMs: number) =>
    getRefundRecoveryStatus({ ...f.options, now: new Date(T0 + elapsedMs) })

  it('a határidőtől a háttérbeli ellenőrzés helyett a kereséssel kezdődő kézi rendezést kéri', async () => {
    const f = await queuedAtT0()

    const expired = await statusAt(f, CORRECTIVE_RETRY_ESCALATION_MS)

    expect(expired.state).toBe('manual_review')
    expect(expired.message).toContain(
      'A helyesbítő számla nem készült el biztosan, és a háttérbeli ellenőrzés sem járt sikerrel.',
    )
    expect(expired.message).toContain(
      'Nézd meg a Számlázz.hu-fiókodban, készült-e helyesbítő a(z) SYNTHETIC-RECOVERY-11-HELYESBITO-1 rendelésszámmal.',
    )
    expect(expired.message).toContain('Ha nem, állítsd ki kézzel (05-ös útmutató, 4. pont)')
    expect(expired.message).not.toContain(DO_NOT_ISSUE)
    expect(expired.message).not.toContain('A rendszer a háttérben újra megpróbálja')

    const running = await statusAt(f, CORRECTIVE_RETRY_ESCALATION_MS - 1000)
    expect(running.message).toContain('A rendszer a háttérben újra megpróbálja')
    expect(running.message).toContain(DO_NOT_ISSUE)
    expect(running.message).not.toContain('állítsd ki kézzel')
  })

  it('ha éppen beküldés fut (pending), a határidő után sem kér kézi kiállítást', async () => {
    const f = await queuedAtT0()
    Object.assign(f.order, { correctiveInvoiceStatus: 'pending' })
    // A job most fut: a Payload a futás elején jelöli a sort.
    f.jobUpdates.set(1, {
      processing: true,
      updatedAt: new Date(T0 + 3 * CORRECTIVE_RETRY_ESCALATION_MS - 60_000).toISOString(),
    })

    const status = await statusAt(f, 3 * CORRECTIVE_RETRY_ESCALATION_MS)

    expect(status.message).toContain(DO_NOT_ISSUE)
    expect(status.message).not.toContain('állítsd ki kézzel')
  })

  // Hibavadász C (PR #307): a beküldés közben leállt folyamat sorát a Payload
  // nem engedi el, a 'pending' pedig már nem változik. A panel eddig örökre
  // háttérbeli újrapróbálást ígért és tiltotta a kézi kiállítást.
  it('a beküldés közben elhalt job mellett (pending, régóta processing) a határidő után a kereséssel kezdődő kézi rendezést kéri', async () => {
    const f = await queuedAtT0()
    Object.assign(f.order, { correctiveInvoiceStatus: 'pending' })
    f.jobUpdates.set(1, { processing: true, updatedAt: new Date(T0).toISOString() })

    const status = await statusAt(f, 3 * CORRECTIVE_RETRY_ESCALATION_MS)

    expect(status.message).not.toContain(DO_NOT_ISSUE)
    expect(status.message).toContain(
      'Nézd meg a Számlázz.hu-fiókodban, készült-e helyesbítő a(z) SYNTHETIC-RECOVERY-11-HELYESBITO-1 rendelésszámmal.',
    )
    expect(status.message).toContain('Ha nem, állítsd ki kézzel (05-ös útmutató, 4. pont)')
  })

  /** Az igénylés előtti átmeneti hiba (Számlázz.hu-kimaradás) a jobot T0-kor sorba állítja. */
  async function queuedBeforeClaimAtT0() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const f = fixture()
    documents.queue.mockResolvedValue(true)
    documents.corrective.mockImplementation(async () => {
      throw new SzamlazzApiError({
        message: 'A Számlázz.hu nem válaszolt 30000 ms-en belül.',
        kind: 'timeout',
        retryable: true,
      })
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect(queuedReceipts(f)).toHaveLength(1)
    vi.useRealTimers()
    return f
  }

  const clickAt = (f: Fixture, elapsedMs: number) =>
    recoverRefundOrder({ ...f.options, now: new Date(T0 + elapsedMs) })

  // Igénylés nélkül a Számlázz.hu-nak még semmi nem ment ki, de a job később
  // elvégezheti az első beküldést: kézi kiállítás mellett dupla helyesbítő lenne.
  it('igénylés nélküli sorba állításnál a határidő után sem kér kézi kiállítást (a job még beküldhet)', async () => {
    const f = await queuedBeforeClaimAtT0()

    const click = await clickAt(f, 3 * CORRECTIVE_RETRY_ESCALATION_MS)

    expect(click.recoveryStatus).toBe('manual_review')
    expect(click.message).toContain(DO_NOT_ISSUE)
    expect(click.message).not.toContain('állítsd ki kézzel')
  })

  // Hibavadász C (PR #307): a job legfeljebb négyszer fut, utána semmi nem
  // állítja újra sorba. A panel eddig ilyenkor is háttérbeli újrapróbálást
  // ígért, holott csak a folytatás gombja próbálhatja újra az első beküldést.
  it.each([
    ['mind a négy futását elhasználta', { hasError: true, totalTried: 4 }],
    ['futás közben elhalt', { processing: true, updatedAt: new Date(T0).toISOString() }],
  ])(
    'igénylés nélkül, ha a job %s, nem ígér háttérbeli újrapróbálást, hanem a gombot ajánlja',
    async (_eset, jobState) => {
      const f = await queuedBeforeClaimAtT0()
      f.jobUpdates.set(1, jobState)

      const click = await clickAt(f, 3 * CORRECTIVE_RETRY_ESCALATION_MS)

      expect(click.message).not.toContain('A rendszer a háttérben újra megpróbálja')
      expect(click.message).toContain(
        'A helyesbítő számla nem készült el, és a háttérbeli újrapróbálás véget ért. A Számlázz.hu-nak nem ment kérés.',
      )
      expect(click.message).toContain('Próbáld újra a „Feldolgozás folytatása” gombbal.')
      expect(click.message).not.toContain('állítsd ki kézzel')
    },
  )

  // Hibavadász C (PR #307): a job igénylés előtt véglegesen elutasított (az
  // eredeti számla áfakulcsa eltér), és lezárult. A panel eddig ugyanabban az
  // üzenetben mondta, hogy kézi rendezés kell, és hogy ne állítsd ki kézzel.
  it('a job végleges elutasítása után nem ígér háttérbeli újrapróbálást', async () => {
    const f = await queuedBeforeClaimAtT0()
    const refusal =
      'a helyesbítő nem állítható ki biztonságosan: az eredeti számla áfakulcsa (27) nem egyezik a beállított AAM kulccsal. ' +
      'A helyesbítőnek az eredeti számla áfakulcsát kell hordoznia; a rendszer nem találgat, kézi rendezés kell.'
    Object.assign(f.order, {
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceLastError: refusal,
    })
    f.jobUpdates.set(1, { completedAt: new Date(T0 + 10 * 60 * 1000).toISOString() })
    documents.corrective.mockImplementation(async () => ({ outcome: 'failed', reason: refusal }))

    const click = await clickAt(f, 30 * 24 * 60 * 60 * 1000)

    expect(click.message).not.toContain(DO_NOT_ISSUE)
    expect(click.message).not.toContain('A rendszer a háttérben újra megpróbálja')
    expect(click.message).toContain('kézi rendezés kell')
    expect(click.message).toContain('a rendszer nem küldi be újra')
  })

  it('az idő nélküli (régi) sorba állítási jelzés nem jár le', async () => {
    const f = fixture()
    documents.queue.mockResolvedValue(true)
    f.failures.receipt = REFUND_INVOICE_RETRY_QUEUED_ACTION
    documents.corrective.mockImplementationOnce(async () => {
      await claimInvoice(f.payload, 'corrective')
      Object.assign(f.order, {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 1,
      })
      throw new SzamlazzApiError({ message: 'SYNTHETIC', kind: 'timeout', retryable: true })
    })
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    f.failures.receipt = ''
    await writeReceipt(
      f.payload,
      store.intents.get(f.payload)!,
      REFUND_INVOICE_RETRY_QUEUED_ACTION,
      {
        version: 1,
        kind: 'corrective',
        sequence: 1,
      },
    )

    const status = await getRefundRecoveryStatus({
      ...f.options,
      now: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

    expect(status.message).toContain(DO_NOT_ISSUE)
    expect(status.message).not.toContain('állítsd ki kézzel')
  })
})
