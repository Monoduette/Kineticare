import type { TaskConfig } from 'payload'

import type { Order } from '../../payload-types'
import { readRefundEntries } from '../../lib/refund/refund-order'
import { issueCorrectiveInvoiceForOrder } from '../../lib/szamlazz'
import { resolveSzamlazzTaskGate } from '../szamlazz-task-gate'
import { logger } from '../../lib/logger'

/** corrective-invoice-issue: részleges refund helyesbítő számlája; `refundSeq` = idempotencia-kulcs. */

interface CorrectiveInvoiceJobIO {
  input: { orderId: number; refundSeq: number }
  output: {
    outcome: string
    correctiveInvoiceNumber?: string
    reason?: string
  }
}

export const correctiveInvoiceIssueTask: TaskConfig<CorrectiveInvoiceJobIO> = {
  slug: 'corrective-invoice-issue',
  retries: 3,
  inputSchema: [
    { name: 'orderId', type: 'number', required: true },
    { name: 'refundSeq', type: 'number', required: true },
  ],
  outputSchema: [
    { name: 'outcome', type: 'text', required: true },
    { name: 'correctiveInvoiceNumber', type: 'text' },
    { name: 'reason', type: 'text' },
  ],
  handler: async ({ req, input }) => {
    const { orderId, refundSeq } = input as { orderId?: unknown; refundSeq?: unknown }
    if (typeof orderId !== 'number' || !Number.isInteger(orderId) || orderId <= 0) {
      throw new Error(`corrective-invoice-issue: érvénytelen orderId input (${String(orderId)})`)
    }
    if (typeof refundSeq !== 'number' || !Number.isInteger(refundSeq) || refundSeq <= 0) {
      throw new Error(
        `corrective-invoice-issue: érvénytelen refundSeq input (${String(refundSeq)})`,
      )
    }

    const gate = resolveSzamlazzTaskGate('corrective-invoice-issue')
    if (gate.kind === 'disabled') {
      return { output: { outcome: 'disabled' } }
    }
    if (gate.kind === 'failed') {
      return { output: { outcome: 'failed', reason: gate.reason } }
    }

    const order = (await req.payload.findByID({
      collection: 'orders',
      id: orderId,
      depth: 0,
      overrideAccess: true,
    })) as Order | null
    if (!order) {
      logger.warn('corrective-invoice-issue: a rendelés nem található — helyesbítő kihagyva', {
        orderId,
      })
      return { output: { outcome: 'failed', reason: 'a rendelés nem található' } }
    }

    const entry = readRefundEntries(order)[refundSeq - 1]
    if (!entry) {
      logger.warn('corrective-invoice-issue: a refund-nyomban nincs ilyen sorszámú bejegyzés', {
        orderId,
        refundSeq,
      })
      return { output: { outcome: 'failed', reason: 'ismeretlen visszatérítés-sorszám' } }
    }

    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload: req.payload,
      refundSeq,
      amountHuf: entry.amountHuf,
      ...(entry.reason ? { reason: entry.reason } : {}),
    })
    return {
      output: {
        outcome: result.outcome,
        ...(result.correctiveInvoiceNumber
          ? { correctiveInvoiceNumber: result.correctiveInvoiceNumber }
          : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      },
    }
  },
}
