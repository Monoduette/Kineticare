import type { TaskConfig } from 'payload'

import { getSzamlazzConfig, issueInvoiceForOrder } from '../../lib/szamlazz'
import { logger } from '../../lib/logger'

/** invoice-issue: paid után számla; `szamlaKulsoAzon` = orderNumber (idempotens). */

interface InvoiceIssueJobIO {
  input: { orderId: number }
  output: {
    outcome: string
    invoiceNumber?: string
    reason?: string
  }
}

export const invoiceIssueTask: TaskConfig<InvoiceIssueJobIO> = {
  slug: 'invoice-issue',
  retries: 3,
  inputSchema: [{ name: 'orderId', type: 'number', required: true }],
  outputSchema: [
    { name: 'outcome', type: 'text', required: true },
    { name: 'invoiceNumber', type: 'text' },
    { name: 'reason', type: 'text' },
  ],
  handler: async ({ req, input }) => {
    const orderId = (input as { orderId?: unknown }).orderId
    if (typeof orderId !== 'number' || !Number.isInteger(orderId) || orderId <= 0) {
      throw new Error(`invoice-issue: érvénytelen orderId input (${String(orderId)})`)
    }

    // Kikapcsolt integrációnál a task azonnal, hiba nélkül lezárul.
    if (!getSzamlazzConfig().enabled) {
      logger.debug('invoice-issue: a Számlázz.hu-integráció kikapcsolva (nincs agent-kulcs) — no-op')
      return { output: { outcome: 'disabled' } }
    }

    const result = await issueInvoiceForOrder({ payload: req.payload, orderId })
    return {
      output: {
        outcome: result.outcome,
        ...(result.invoiceNumber ? { invoiceNumber: result.invoiceNumber } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      },
    }
  },
}
