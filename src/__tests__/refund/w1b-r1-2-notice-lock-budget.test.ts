import { afterEach, describe, expect, it, vi } from 'vitest'

// A zár-mock (a tartott kulcsokat mutatja) és a tároló-fixtúra a modulok
// importja előtt regisztrálódik.
import { claimInvoice, documents, fixture, locks, mail } from '../refund-fixture'

/**
 * A vevői értesítő újrapróbálása nem nyújthatja a visszatérítés-helyreállítás
 * koordinátor-zárját (`refund-recovery:order:<id>`, refund-recovery.ts) a
 * Postgres tétlenségi korlátja fölé (W1B-5, törő, major).
 *
 * A zár tranzakciója a védett szakasz alatt tétlen, és a Postgres 60 s után
 * leöli (idle_in_transaction_session_timeout, payload.config.ts): a kész
 * visszatérítés is „elakadt” RIASZTÁS-t és 503-at adna. Ezen a fejen az
 * értesítő a zár alatt fut, előtte pedig a helyesbítő akár 45 s-ig hívja a
 * Számlázz.hu-t (lekérdezés, beküldés, 71/152 utáni lekérdezés, 15-15 s).
 *
 * A mért idő a hamisított órán fut: a helyesbítő és a levélküldő mockja viszi
 * előre, a többi lépés (tároló-mock) nem tart. Az értesítő valódi szünete
 * (setTimeout) nem része az órának, ezért a korlátot a zár alatti utolsó
 * kérés végéig mérjük. Ha a küldés a záron kívülre kerül, a zár ideje a
 * helyesbítőé marad, és a korlát magától teljesül.
 */

const IDLE_IN_TRANSACTION_LIMIT_MS = 60_000
/** A helyesbítő leghosszabb ideje ezen a fejen (három Számlázz.hu-hívás, 15-15 s). */
const CORRECTIVE_WORST_CASE_MS = 45_000

afterEach(() => {
  vi.useRealTimers()
})

describe('a vevői értesítő a koordinátor-zár tétlenségi korlátján belül marad', () => {
  it('45 s-os helyesbítő után egy lassú (9,9 s-os) 503: a zár alatt nincs második kísérlet, és a zár 60 s-on belül szabadul', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'))
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    const coordinator = `refund-recovery:order:${f.order.id}`
    let correctiveStartedAt: number | null = null
    documents.corrective.mockImplementation(
      async (_order: unknown, deps: { refundSeq: number }) => {
        correctiveStartedAt = Date.now()
        vi.setSystemTime(Date.now() + CORRECTIVE_WORST_CASE_MS)
        await claimInvoice(f.payload, 'corrective')
        Object.assign(f.order, {
          correctiveInvoiceStatus: 'issued',
          correctiveInvoiceNumber: 'SYNTHETIC-HE',
          correctiveInvoiceSeq: deps.refundSeq,
        })
        return { outcome: 'issued', correctiveInvoiceNumber: 'SYNTHETIC-HE' }
      },
    )
    const lockedMailEnds: number[] = []
    mail.send.mockImplementation(async () => {
      // A Resend 503-at ad (vagy a pereme 504-et), közvetlenül a 10 s-os
      // kliensoldali korlát előtt.
      vi.setSystemTime(Date.now() + 9_900)
      if (locks.held.includes(coordinator)) lockedMailEnds.push(Date.now())
      return { ok: false, provider: 'resend', retryable: true, error: 'Resend API hiba (HTTP 503)' }
    })

    await expect(f.start({ amountHuf: 5000 })).resolves.toMatchObject({ type: 'partial' })

    expect(correctiveStartedAt).not.toBeNull()
    expect(mail.send).toHaveBeenCalled()
    const lockedUntil = Math.max(correctiveStartedAt! + CORRECTIVE_WORST_CASE_MS, ...lockedMailEnds)
    expect(lockedUntil - correctiveStartedAt!).toBeLessThanOrEqual(IDLE_IN_TRANSACTION_LIMIT_MS)
    // Egy második, akár 10 s-os kísérlet a zár alatt 60 s fölé vinné.
    expect(lockedMailEnds.length).toBeLessThanOrEqual(1)
  }, 20_000)
})
