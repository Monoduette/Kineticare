import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár-, Barion-, számlázó- és levélmockokat a job importja
// előtt kell regisztrálni (refund-fixture).
import { claimInvoice, documents, fixture, mail, provider, store } from '../refund-fixture'
import { correctiveInvoiceIssueTask } from '../../jobs/tasks/corrective-invoice-issue'
import { setAlertSink, type AlertLogEntry } from '../../lib/logger'
import { getSzamlazzConfig, type SzamlazzParsedSuccess } from '../../lib/szamlazz/client'
import {
  issueCorrectiveInvoiceForOrder,
  type IssueCorrectiveInvoiceDeps,
} from '../../lib/szamlazz/corrective'
import type { InvoiceLookupResult } from '../../lib/szamlazz/pdf'
import { REFUND_DOCUMENT_GUARD_REFUSAL } from '../../lib/szamlazz/refund-guard'
import { SzamlazzApiError } from '../../lib/szamlazz/types'
import type { Order } from '../../payload-types'

/**
 * A corrective-invoice-issue job VALÓDI handlere a refund-folyamat
 * fixtúráján: W1B-6 (a job sikere után a visszatérítés magától lezárul) és a
 * refund-őr végleges elutasításának kezelése (W1B-1 5. pont, W1B-2 3. pont).
 */

// A task-kapu a Számlázz.hu-konfigurációt olvassa; a saját tesztje a
// jobs/szamlazz-tasks.test.ts. A refund-fixture a számlázó modult szűken
// mockolja, ezért a kapu itt a „ready” ágat adja.
vi.mock('../../jobs/szamlazz-task-gate', () => ({
  resolveSzamlazzTaskGate: () => ({ kind: 'ready' }),
}))

// Az eredeti számla adat-lekérdezése (áfakulcs-ellenőrzés): egy AAM-es, élő
// számla, ahogy élesben; valódi hálózati hívás nincs.
vi.mock('../../lib/szamlazz/invoice-data', () => ({
  queryInvoiceData: async (szamlaszam: string) => ({
    szamlaszam,
    vatKeys: ['AAM'],
    sztornozott: false,
  }),
}))

/** DUMMY érték, egyértelműen jelölve: NEM valódi Számla Agent kulcs. */
const config = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: 'DUMMY-W1B-R1-1-AGENT-KEY',
  SZAMLAZZ_AFAKULCS: 'AAM',
})

interface JobResult {
  output: Record<string, unknown>
}

/** A job handlere, ahogy a Payload hívja (req.payload + input). */
async function runJob(payload: unknown, orderId: number, refundSeq: number): Promise<JobResult> {
  const { handler } = correctiveInvoiceIssueTask
  if (typeof handler !== 'function') throw new Error('a task handlere nem függvény')
  return (handler as (args: unknown) => Promise<JobResult>)({
    req: { payload },
    input: { orderId, refundSeq },
  })
}

const alerts: AlertLogEntry[] = []
beforeEach(() => {
  alerts.length = 0
  setAlertSink((entry) => {
    alerts.push(entry)
  })
})
afterEach(() => {
  setAlertSink(undefined)
})

type Fixture = ReturnType<typeof fixture>

/**
 * Részleges visszatérítés, amelynek helyesbítője az igénylés és a beküldés
 * után időtúllépéssel bukott: a folyamat sorba állította a jobot.
 */
async function queuedAfterTimeout(): Promise<Fixture> {
  const f = fixture()
  Object.assign(f.order, { customerEmail: 'vevo@example.test' } satisfies Partial<Order>)
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
  expect(documents.queue).toHaveBeenCalledTimes(1)
  expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
  return f
}

/** A job beküldés előtti lekérdezése megtalálja és rögzíti a helyesbítőt (corrective.ts: 'issued'). */
function jobAdoptsCorrective(f: Fixture) {
  documents.corrective.mockImplementationOnce(async () => {
    Object.assign(f.order, {
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'E-KIN-2026-10',
      correctiveInvoiceSeq: 1,
      correctiveInvoiceLastError: null,
    })
    return { outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' }
  })
}

describe('W1B-6: a job sikere után a visszatérítés magától lezárul', () => {
  it('gombnyomás nélkül: committed, a bizonylat-nyugta a számmal, és pontosan egy vevői értesítő', async () => {
    const f = await queuedAfterTimeout()
    expect(mail.send).not.toHaveBeenCalled()
    jobAdoptsCorrective(f)

    const result = await runJob(f.payload, f.order.id, 1)

    expect(result.output).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.audits.find((row) => row.action === 'refund-invoice-done')?.after).toMatchObject({
      number: 'E-KIN-2026-10',
    })
    expect(mail.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: 'vevo@example.test' }),
    )
    expect((await f.status()).state).toBe('clear')
    // A lezárás pénzt nem mozgatott, és a helyesbítőt sem kérte újra.
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(documents.corrective).toHaveBeenCalledTimes(2)
    // Egy későbbi gombnyomásnak már nincs dolga: második levél sincs.
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it('ha a tulajdonos ugyanekkor nyomja meg a gombot, a lezárás és az értesítő akkor is egyszer történik meg', async () => {
    const f = await queuedAfterTimeout()
    // A bizonylat már rögzítve van (egy korábbi job-futás vette át).
    Object.assign(f.order, {
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'E-KIN-2026-10',
      correctiveInvoiceSeq: 1,
    })
    documents.corrective.mockImplementationOnce(async () => ({
      outcome: 'already-issued',
      correctiveInvoiceNumber: 'E-KIN-2026-10',
    }))

    const [job, click] = await Promise.all([runJob(f.payload, f.order.id, 1), f.recover()])

    expect(job.output).toEqual({
      outcome: 'already-issued',
      correctiveInvoiceNumber: 'E-KIN-2026-10',
    })
    expect(click).toMatchObject({ recoveryStatus: 'completed' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.audits.filter((row) => row.action === 'refund-invoice-done')).toHaveLength(1)
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it('ha a lezárás elakad (az indító felhasználó nem olvasható), a job nem dob, és a panel a folytatás gombját mutatja', async () => {
    const f = await queuedAfterTimeout()
    const findByID = vi.mocked(f.payload.findByID)
    const read = findByID.getMockImplementation()!
    findByID.mockImplementation(async (args) => {
      if (args.collection === 'users') throw new Error('SYNTHETIC users read failure')
      return read(args)
    })
    jobAdoptsCorrective(f)

    const result = await runJob(f.payload, f.order.id, 1)

    expect(result.output).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' })
    expect(documents.corrective).toHaveBeenCalledTimes(2)
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
    findByID.mockImplementation(read)
    expect((await f.status()).state).toBe('recoverable')
    expect(mail.send).not.toHaveBeenCalled()
  })
})

describe('a refund-őr végleges elutasítása a jobban', () => {
  it('nem dob (a Payload nem próbálja újra), failed kimenettel zárul, és egy RIASZTÁS-t ad a kereshető azonosítókkal', async () => {
    const f = fixture()
    Object.assign(f.order, {
      customerSnapshot: {
        name: 'Synthetic Buyer',
        email: 'synthetic@example.test',
        billingName: 'Synthetic Buyer',
        billingZip: '1111',
        billingCity: 'Budapest',
        billingStreet: 'Synthetic street 1',
      },
      invoiceCompletionDate: '2026-09-05',
    } satisfies Partial<Order>)
    // Valódi helyesbítő-kiállító és refund-őr; az első beküldés időtúllépés
    // (bizonytalan kimenet), a job lekérdezése negatív.
    const post = vi.fn(async (): Promise<SzamlazzParsedSuccess> => {
      throw new SzamlazzApiError({
        message: 'A Számlázz.hu nem válaszolt 30000 ms-en belül.',
        kind: 'timeout',
        retryable: true,
      })
    })
    const query = vi.fn(async (): Promise<InvoiceLookupResult | null> => null)
    documents.corrective.mockImplementation((order: Order, options: IssueCorrectiveInvoiceDeps) =>
      issueCorrectiveInvoiceForOrder(order, {
        ...options,
        config,
        postXml: post,
        queryByKulsoAzon: query,
      }),
    )
    documents.queue.mockResolvedValue(true)
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect(documents.queue).toHaveBeenCalledTimes(1)
    alerts.length = 0

    const result = await runJob(f.payload, f.order.id, 1)

    expect(result.output).toEqual({ outcome: 'failed', reason: REFUND_DOCUMENT_GUARD_REFUSAL })
    expect(post).toHaveBeenCalledTimes(1)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      alertCode: 'helyesbito-nem-kuldheto-be-ujra',
      context: { orderId: f.order.id, orderNumber: 'SYNTHETIC-RECOVERY-11', refundSeq: 1 },
    })
    expect(alerts[0].msg).toContain('SYNTHETIC-RECOVERY-11-HELYESBITO-1')
    expect(alerts[0].msg).toContain('SYNTHETIC-RECOVERY-11-11-HELYESBITO-1')
    expect(alerts[0].msg).toContain('05-ös útmutató, 4. pont')
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
  })
})
