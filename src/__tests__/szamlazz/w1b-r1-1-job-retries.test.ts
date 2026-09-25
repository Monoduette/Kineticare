import { BasePayload, type PayloadRequest, type SanitizedConfig } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Order } from '../../payload-types'

/**
 * A corrective-invoice-issue job a VALÓDI Payload-futtatóval (runJobs →
 * runJob → handleTaskError), ál-adatbázissal: a Payload saját újrapróbálási
 * döntése és az `onFail` hívása itt nem feltételezés, hanem a függőség
 * tényleges viselkedése (payload 3.88, queues/errors/handleTaskError.js).
 *
 * - Újrapróbálható hibánál a Payload `retries: 3` mellett négyszer futtat, és a
 *   végleges hiba RIASZTÁS-a (`helyesbito-ujraprobalas-kimerult`) csak az
 *   utolsó próbálkozásnál megy ki, egyszer.
 * - A refund-őr végleges elutasítása sikeres (failed kimenetű) futás: a Payload
 *   nem próbálja újra, és csak a saját riasztása (`helyesbito-nem-kuldheto-be-ujra`)
 *   megy ki.
 */

type IssueCorrectiveFn = (typeof import('../../lib/szamlazz'))['issueCorrectiveInvoiceForOrder']
const szamlazz = vi.hoisted(() => ({ issueCorrective: vi.fn<IssueCorrectiveFn>() }))
vi.mock('../../lib/szamlazz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/szamlazz')>()),
  issueCorrectiveInvoiceForOrder: szamlazz.issueCorrective,
}))

import { correctiveInvoiceIssueTask } from '../../jobs/tasks/corrective-invoice-issue'
import { setAlertSink, type AlertLogEntry } from '../../lib/logger'
import { RefundDocumentGuardError } from '../../lib/szamlazz/refund-guard'
import { SzamlazzApiError } from '../../lib/szamlazz/types'

const ORDER = {
  id: 557,
  orderNumber: 'KH-2026-000779',
  status: 'paid',
  invoiceNumber: 'E-KIN-2026-3',
  refunds: [
    {
      transactionId: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      amountHuf: 3000,
      status: 'PartiallyRefunded',
      refundedAt: '2026-09-20T10:00:00.000Z',
      type: 'partial',
    },
  ],
} as unknown as Order

interface JobRow {
  id: number
  taskSlug: string
  queue: string
  input: Record<string, unknown>
  totalTried: number
  processing: boolean
  hasError: boolean
  completedAt?: string | null
  log: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Egyetlen sorban álló job ál-adatbázisban. Csak azt tudja, amit a Payload
 * id szerinti futtatása használ: `updateJobs` (a naplósor `$push`-sal),
 * tranzakció, és a sikeres job törlése (`deleteJobOnComplete`).
 */
function createRunner(readOrder: () => Promise<Order>) {
  const job: JobRow = {
    id: 1,
    taskSlug: 'corrective-invoice-issue',
    queue: 'order-maintenance',
    input: { orderId: ORDER.id, refundSeq: 1 },
    totalTried: 0,
    processing: false,
    hasError: false,
    log: [],
  }
  let deleted = false
  const db = {
    name: 'postgres',
    beginTransaction: async () => 'w1b-r1-1-tx',
    commitTransaction: async () => undefined,
    updateJobs: async ({ id, data }: { id?: number | string; data: Record<string, unknown> }) => {
      if (id !== job.id || deleted) return []
      for (const [key, value] of Object.entries(data)) {
        if (key === 'log' && isRecord(value) && '$push' in value) {
          job.log.push(...(Array.isArray(value.$push) ? value.$push : [value.$push]))
        } else {
          Object.assign(job, { [key]: value })
        }
      }
      return [structuredClone(job)]
    },
    deleteMany: async () => {
      deleted = true
    },
  }
  const payload = new BasePayload()
  payload.config = {
    jobs: { tasks: [correctiveInvoiceIssueTask], depth: 0, deleteJobOnComplete: true },
  } as unknown as SanitizedConfig
  payload.db = db as unknown as BasePayload['db']
  const findByID = vi.fn(async () => readOrder())
  payload.findByID = findByID as unknown as BasePayload['findByID']
  const req = { payload } as unknown as PayloadRequest
  return {
    job,
    findByID,
    isDeleted: () => deleted,
    run: () => payload.jobs.runByID({ id: job.id, req, silent: true }),
  }
}

const alerts: AlertLogEntry[] = []

beforeEach(() => {
  alerts.length = 0
  setAlertSink((entry) => {
    alerts.push(entry)
  })
  // A task-kapu a valódi környezeti változókat olvassa (DUMMY kulcs, AAM).
  vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'DUMMY-W1B-R1-1-AGENT-KEY')
  vi.stubEnv('SZAMLAZZ_AFAKULCS', 'AAM')
  // CLAUDE.md 15.: tesztből nincs valódi hálózati hívás.
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
  szamlazz.issueCorrective.mockReset()
  // A strukturált naplósorok itt zajként jelentkeznének.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  setAlertSink(undefined)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const exhausted = () =>
  alerts.filter((entry) => entry.alertCode === 'helyesbito-ujraprobalas-kimerult')

describe('corrective-invoice-issue a Payload-futtatóban: végleges hiba (onFail)', () => {
  it('újrapróbálható hibánál négy futás, és a RIASZTÁS csak a negyedik (utolsó) után megy ki, egyszer', async () => {
    szamlazz.issueCorrective.mockRejectedValue(
      new SzamlazzApiError({
        message: 'A Számlázz.hu nem válaszolt 30000 ms-en belül.',
        kind: 'timeout',
        retryable: true,
      }),
    )
    const runner = createRunner(async () => structuredClone(ORDER))

    for (let tries = 1; tries <= 3; tries += 1) {
      await runner.run()
      expect(runner.job).toMatchObject({ totalTried: tries, hasError: false })
      expect(exhausted()).toEqual([])
    }
    await runner.run()

    expect(runner.job).toMatchObject({ totalTried: 4, hasError: true, processing: false })
    expect(szamlazz.issueCorrective).toHaveBeenCalledTimes(4)
    expect(exhausted()).toHaveLength(1)
    expect(exhausted()[0].context).toMatchObject({
      orderId: 557,
      orderNumber: 'KH-2026-000779',
      refundSeq: 1,
    })
    // A kézi kiállítás előtti kereséshez: a fiókban kereshető rendelésszám és a külső azonosító.
    expect(exhausted()[0].msg).toContain('KH-2026-000779-HELYESBITO-1')
    expect(exhausted()[0].msg).toContain('külső azonosítója: KH-2026-000779-557-HELYESBITO-1')
  })

  it('ha a rendelés sem olvasható (adatbázis-hiba), a riasztás akkor is kimegy, és a Payload hibakezelése végigfut', async () => {
    const runner = createRunner(async () => {
      throw new Error('SYNTHETIC Connection terminated unexpectedly')
    })

    for (let tries = 1; tries <= 4; tries += 1) await runner.run()

    expect(runner.job).toMatchObject({ totalTried: 4, hasError: true, processing: false })
    expect(szamlazz.issueCorrective).not.toHaveBeenCalled()
    expect(exhausted()).toHaveLength(1)
    expect(exhausted()[0].context).toMatchObject({ orderId: 557, orderNumber: null, refundSeq: 1 })
  })
})

describe('corrective-invoice-issue a Payload-futtatóban: a refund-őr elutasítása', () => {
  it('az első futás sikeresen (failed kimenettel) lezárul: nincs újrapróbálás, csak a refund-őr riasztása', async () => {
    szamlazz.issueCorrective.mockRejectedValue(new RefundDocumentGuardError())
    const runner = createRunner(async () => structuredClone(ORDER))

    await runner.run()

    expect(szamlazz.issueCorrective).toHaveBeenCalledTimes(1)
    expect(runner.job).toMatchObject({ totalTried: 1, hasError: false, processing: false })
    expect(runner.job.completedAt).toEqual(expect.any(String))
    expect(runner.isDeleted()).toBe(true)
    expect(alerts.map((entry) => entry.alertCode)).toEqual(['helyesbito-nem-kuldheto-be-ujra'])
  })
})
