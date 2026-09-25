import type { TaskConfig } from 'payload'

import { issueInvoiceForOrder } from '../../lib/szamlazz'
import { resolveSzamlazzTaskGate } from '../szamlazz-task-gate'

/**
 * invoice-issue: paid után számla. Idempotens: a beküldés előtt a globálisan
 * egyedi `szamlaKulsoAzon`-on (kulso-azon.ts) lekérdez, és egyeztetett
 * bizonylatot vesz át. Visszatérített, számla nélküli rendelésre nem állít ki
 * utólag számlát (K12), hanem RIASZTÁS-t ír.
 * A konfig-kapu (`resolveSzamlazzTaskGate`) a no-op / fél-lábas konfig ágát
 * throw nélkül zárja — lásd src/jobs/szamlazz-task-gate.ts.
 */

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

    const gate = resolveSzamlazzTaskGate('invoice-issue')
    if (gate.kind === 'disabled') {
      return { output: { outcome: 'disabled' } }
    }
    if (gate.kind === 'failed') {
      return { output: { outcome: 'failed', reason: gate.reason } }
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
