import { afterEach, describe, expect, it, vi } from 'vitest'

import { invoiceIssueTask } from '../../jobs/tasks/invoice-issue'
import { correctiveInvoiceIssueTask } from '../../jobs/tasks/corrective-invoice-issue'
import { stornoIssueTask } from '../../jobs/tasks/storno-issue'
import {
  resolveSzamlazzTaskGate,
  SZAMLAZZ_TASK_CONFIG_FAILED_REASON,
} from '../../jobs/szamlazz-task-gate'
import type { Order } from '../../payload-types'

/**
 * A számla / stornó / helyesbítő jobok bekötése (C4/C5, R-04) — a taskok
 * vékony rétegének szerződése: input-validáció, kikapcsolt integráció,
 * fél-lábas konfig (failed, nem throw), hiányzó rendelés és a refund-nyom
 * sorszám-feloldása. A hálózati ág a szolgáltatás-tesztekben fut
 * (szamlazz.test.ts, szamlazz/storno.test.ts, szamlazz/corrective.test.ts);
 * az invoice-issue handler itt NEM hívja az `issueInvoiceForOrder`-t.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

/**
 * A helyesbítő-kiállító a modul-határon mockolt (a job-nak nincs injektálási
 * pontja): a job ágait lefedő többi teszt a kiállításig el sem jut, ezért a
 * mock alapból hangosan dob.
 */
type IssueCorrectiveFn = (typeof import('../../lib/szamlazz'))['issueCorrectiveInvoiceForOrder']
const szamlazz = vi.hoisted(() => ({
  issueCorrective: vi.fn<IssueCorrectiveFn>(async () => {
    throw new Error('TESZT-HIBA: ezen az ágon nem indulhat helyesbítő-kiállítás')
  }),
}))
vi.mock('../../lib/szamlazz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/szamlazz')>()),
  issueCorrectiveInvoiceForOrder: szamlazz.issueCorrective,
}))

interface TaskResult {
  output: Record<string, unknown>
}

/** A TaskConfig.handler string is lehet — a teszt a függvény-ágat futtatja. */
async function runTask(task: { handler: unknown }, args: unknown): Promise<TaskResult> {
  const { handler } = task
  if (typeof handler !== 'function') {
    throw new Error('a task handlere nem függvény')
  }
  return (handler as (a: unknown) => Promise<TaskResult>)(args)
}

function reqWith(order: Order | null) {
  const findByID = vi.fn(async () => order)
  return { req: { payload: { findByID } }, findByID }
}

/**
 * Bekapcsolt számlázás a job-tesztekhez.
 *
 * Az ÁFAKULCS is kell: 2026-08-17 óta a bekapcsolt számlázás kifejezett
 * `SZAMLAZZ_AFAKULCS`-ot követel (a csendes '27' alapértelmezés megszűnt, mert
 * alanyi adómentes eladónál minden bizonylatot elrontott volna). A jobok a
 * VALÓDI `process.env`-ből olvasnak, ezért itt is oda kell tenni.
 */
function restoreSzamlazzEnv(previousKey: string | undefined, previousVat: string | undefined) {
  if (previousKey === undefined) {
    delete process.env.SZAMLAZZ_AGENT_KEY
  } else {
    process.env.SZAMLAZZ_AGENT_KEY = previousKey
  }
  if (previousVat === undefined) {
    delete process.env.SZAMLAZZ_AFAKULCS
  } else {
    process.env.SZAMLAZZ_AFAKULCS = previousVat
  }
}

function withAgentKey(): () => void {
  const previousKey = process.env.SZAMLAZZ_AGENT_KEY
  const previousVat = process.env.SZAMLAZZ_AFAKULCS
  process.env.SZAMLAZZ_AGENT_KEY = DUMMY_AGENT_KEY
  process.env.SZAMLAZZ_AFAKULCS = '27'
  return () => restoreSzamlazzEnv(previousKey, previousVat)
}

/**
 * R-04: agent-kulcs van, áfakulcs nincs. A `getSzamlazzConfig` dobna;
 * a task-kapu failed kimenetet ad throw nélkül, hálózat nélkül.
 */
function withHalfConfig(): () => void {
  const previousKey = process.env.SZAMLAZZ_AGENT_KEY
  const previousVat = process.env.SZAMLAZZ_AFAKULCS
  process.env.SZAMLAZZ_AGENT_KEY = DUMMY_AGENT_KEY
  delete process.env.SZAMLAZZ_AFAKULCS
  return () => restoreSzamlazzEnv(previousKey, previousVat)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveSzamlazzTaskGate', () => {
  it('nincs agent-kulcs → disabled, nem dob', () => {
    const previous = process.env.SZAMLAZZ_AGENT_KEY
    delete process.env.SZAMLAZZ_AGENT_KEY
    try {
      expect(resolveSzamlazzTaskGate('invoice-issue')).toEqual({ kind: 'disabled' })
    } finally {
      if (previous !== undefined) {
        process.env.SZAMLAZZ_AGENT_KEY = previous
      }
    }
  })

  it('agent-kulcs van, áfakulcs nincs → failed, nem dob', () => {
    const restore = withHalfConfig()
    try {
      expect(resolveSzamlazzTaskGate('invoice-issue')).toEqual({
        kind: 'failed',
        reason: SZAMLAZZ_TASK_CONFIG_FAILED_REASON,
      })
    } finally {
      restore()
    }
  })

  it('teljes konfig → ready', () => {
    const restore = withAgentKey()
    try {
      expect(resolveSzamlazzTaskGate('invoice-issue')).toEqual({ kind: 'ready' })
    } finally {
      restore()
    }
  })
})

describe('invoice-issue task', () => {
  it('a slug, a retry-szám és az input-séma megvan', () => {
    expect(invoiceIssueTask.slug).toBe('invoice-issue')
    expect(invoiceIssueTask.retries).toBe(3)
    expect(invoiceIssueTask.inputSchema?.[0]).toMatchObject({ name: 'orderId', required: true })
  })

  it('érvénytelen orderId → dob (a job hibára fut, nem hallgat)', async () => {
    const { req } = reqWith(null)
    await expect(runTask(invoiceIssueTask, { req, input: { orderId: 'x' } })).rejects.toThrow(
      'érvénytelen orderId',
    )
  })

  it('kikapcsolt integrációnál disabled — a rendeléshez sem nyúl', async () => {
    const previous = process.env.SZAMLAZZ_AGENT_KEY
    delete process.env.SZAMLAZZ_AGENT_KEY
    try {
      const { req, findByID } = reqWith(null)
      const result = await runTask(invoiceIssueTask, { req, input: { orderId: 555 } })
      expect(result.output).toEqual({ outcome: 'disabled' })
      expect(findByID).not.toHaveBeenCalled()
    } finally {
      if (previous !== undefined) {
        process.env.SZAMLAZZ_AGENT_KEY = previous
      }
    }
  })

  it('fél-lábas konfig (kulcs van, áfa nincs) → failed, nem dob, nem POSTol', async () => {
    const restore = withHalfConfig()
    try {
      const { req, findByID } = reqWith(null)
      const result = await runTask(invoiceIssueTask, { req, input: { orderId: 555 } })
      expect(result.output).toEqual({
        outcome: 'failed',
        reason: SZAMLAZZ_TASK_CONFIG_FAILED_REASON,
      })
      expect(findByID).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})

describe('storno-issue task', () => {
  it('a slug, a queue-beli retry-szám és az input-séma az invoice-issue mintáját követi', () => {
    expect(stornoIssueTask.slug).toBe('storno-issue')
    expect(stornoIssueTask.retries).toBe(3)
    expect(stornoIssueTask.inputSchema?.[0]).toMatchObject({ name: 'orderId', required: true })
  })

  it('érvénytelen orderId → dob (a job hibára fut, nem hallgat)', async () => {
    const { req } = reqWith(null)
    await expect(runTask(stornoIssueTask, { req, input: { orderId: 'x' } })).rejects.toThrow(
      'érvénytelen orderId',
    )
  })

  it('kikapcsolt integrációnál disabled — a rendeléshez sem nyúl', async () => {
    const previous = process.env.SZAMLAZZ_AGENT_KEY
    delete process.env.SZAMLAZZ_AGENT_KEY
    try {
      const { req, findByID } = reqWith(null)
      const result = await runTask(stornoIssueTask, { req, input: { orderId: 555 } })
      expect(result.output).toEqual({ outcome: 'disabled' })
      expect(findByID).not.toHaveBeenCalled()
    } finally {
      if (previous !== undefined) {
        process.env.SZAMLAZZ_AGENT_KEY = previous
      }
    }
  })

  it('fél-lábas konfig → failed, a rendeléshez sem nyúl', async () => {
    const restore = withHalfConfig()
    try {
      const { req, findByID } = reqWith(null)
      const result = await runTask(stornoIssueTask, { req, input: { orderId: 555 } })
      expect(result.output).toEqual({
        outcome: 'failed',
        reason: SZAMLAZZ_TASK_CONFIG_FAILED_REASON,
      })
      expect(findByID).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('ismeretlen rendelésnél failed, magyar indokkal', async () => {
    const restore = withAgentKey()
    try {
      const { req } = reqWith(null)
      const result = await runTask(stornoIssueTask, { req, input: { orderId: 555 } })
      expect(result.output).toEqual({ outcome: 'failed', reason: 'a rendelés nem található' })
    } finally {
      restore()
    }
  })

  it('nem visszatérített (nem refunded) rendelésnél failed — refund nélkül nincs stornó, nem POSTol', async () => {
    const restore = withAgentKey()
    try {
      const order = {
        id: 555,
        orderNumber: 'KH-2026-000777',
        status: 'paid',
        invoiceNumber: 'E-TESZT-1',
      } as unknown as Order
      const issueStorno = vi.fn()
      const { req } = reqWith(order)
      const result = await runTask(stornoIssueTask, {
        req,
        input: { orderId: 555 },
        issueStorno,
      })
      expect(result.output.outcome).toBe('failed')
      expect(String(result.output.reason)).toContain('visszatérít')
      expect(issueStorno).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('refunded rendelésnél a stornó-kiállítás elindul', async () => {
    const restore = withAgentKey()
    try {
      const order = {
        id: 556,
        orderNumber: 'KH-2026-000778',
        status: 'refunded',
        invoiceNumber: 'E-TESZT-2',
      } as unknown as Order
      const issueStorno = vi.fn(async () => ({ outcome: 'storned', stornoNumber: 'S-1' }))
      const { req } = reqWith(order)
      const result = await runTask(stornoIssueTask, {
        req,
        input: { orderId: 556 },
        issueStorno,
      })
      expect(issueStorno).toHaveBeenCalledTimes(1)
      expect(result.output).toMatchObject({ outcome: 'storned', stornoNumber: 'S-1' })
    } finally {
      restore()
    }
  })
})

describe('corrective-invoice-issue task', () => {
  it('a slug, a retry-szám és az input-séma (orderId + refundSeq)', () => {
    expect(correctiveInvoiceIssueTask.slug).toBe('corrective-invoice-issue')
    expect(correctiveInvoiceIssueTask.retries).toBe(3)
    expect(correctiveInvoiceIssueTask.inputSchema).toMatchObject([
      { name: 'orderId', required: true },
      { name: 'refundSeq', required: true },
    ])
  })

  it('érvénytelen refundSeq → dob', async () => {
    const { req } = reqWith(null)
    await expect(
      runTask(correctiveInvoiceIssueTask, { req, input: { orderId: 555, refundSeq: 0 } }),
    ).rejects.toThrow('érvénytelen refundSeq')
  })

  it('fél-lábas konfig → failed, a rendeléshez sem nyúl', async () => {
    const restore = withHalfConfig()
    try {
      const { req, findByID } = reqWith(null)
      const result = await runTask(correctiveInvoiceIssueTask, {
        req,
        input: { orderId: 555, refundSeq: 1 },
      })
      expect(result.output).toEqual({
        outcome: 'failed',
        reason: SZAMLAZZ_TASK_CONFIG_FAILED_REASON,
      })
      expect(findByID).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('ismeretlen sorszámú visszatérítésnél failed (nem állít ki bizonylatot)', async () => {
    const restore = withAgentKey()
    try {
      const order = { id: 555, orderNumber: 'KH-2026-000777', refunds: [] } as unknown as Order
      const { req } = reqWith(order)
      const result = await runTask(correctiveInvoiceIssueTask, {
        req,
        input: { orderId: 555, refundSeq: 3 },
      })
      expect(result.output).toEqual({
        outcome: 'failed',
        reason: 'ismeretlen visszatérítés-sorszám',
      })
    } finally {
      restore()
    }
  })

  // A helyesbítő összege a kért sorszámú refund-bejegyzésé: ez megy a NAV-hoz.
  // A visszatérítés indokát a kiállító nem is fogadja (corrective.ts, a
  // típusellenőrzés őrzi), ezért itt csak a sorszám és az összeg számít.
  it('a kiállító a kért sorszámú refund-bejegyzés összegét kapja, a kimenet a kiállítás eredménye', async () => {
    const restore = withAgentKey()
    try {
      const order = {
        id: 557,
        orderNumber: 'KH-2026-000779',
        status: 'paid',
        invoiceNumber: 'E-TESZT-3',
        refunds: [
          {
            transactionId: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
            amountHuf: 3000,
            status: 'PartiallyRefunded',
            refundedAt: '2026-09-20T10:00:00.000Z',
            type: 'partial',
          },
          {
            transactionId: 'c4a2e3f5-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
            amountHuf: 2000,
            status: 'PartiallyRefunded',
            refundedAt: '2026-09-21T10:00:00.000Z',
            type: 'partial',
          },
        ],
      } as unknown as Order
      szamlazz.issueCorrective.mockResolvedValueOnce({
        outcome: 'issued',
        correctiveInvoiceNumber: 'E-TESZT-H2',
      })
      const { req } = reqWith(order)
      const result = await runTask(correctiveInvoiceIssueTask, {
        req,
        input: { orderId: 557, refundSeq: 2 },
      })
      expect(szamlazz.issueCorrective).toHaveBeenCalledExactlyOnceWith(
        order,
        expect.objectContaining({ payload: req.payload, refundSeq: 2, amountHuf: 2000 }),
      )
      expect(result.output).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'E-TESZT-H2' })
    } finally {
      restore()
    }
  })
})
