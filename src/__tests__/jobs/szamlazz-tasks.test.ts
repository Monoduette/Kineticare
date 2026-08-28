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
})
