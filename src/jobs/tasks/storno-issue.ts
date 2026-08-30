import type { TaskConfig } from 'payload'

import type { Order } from '../../payload-types'
import { issueStornoForOrder } from '../../lib/szamlazz'
import { resolveSzamlazzTaskGate } from '../szamlazz-task-gate'
import { logger } from '../../lib/logger'

type IssueStornoFn = typeof issueStornoForOrder

/**
 * storno-issue: kézi/explicit újrafuttatásra. Automatikus retry tilos (F3 bizonytalan
 * állapot → dupla stornó). `stornoAttempts > 0` és nincs szám → RIASZTÁS, nem POST.
 */

interface StornoIssueJobIO {
  input: { orderId: number }
  output: {
    outcome: string
    stornoNumber?: string
    reason?: string
  }
}

export const stornoIssueTask: TaskConfig<StornoIssueJobIO> = {
  slug: 'storno-issue',
  retries: 3,
  inputSchema: [{ name: 'orderId', type: 'number', required: true }],
  outputSchema: [
    { name: 'outcome', type: 'text', required: true },
    { name: 'stornoNumber', type: 'text' },
    { name: 'reason', type: 'text' },
  ],
  handler: async (args) => {
    const { req, input } = args as {
      req: { payload: { findByID: (a: unknown) => Promise<unknown> } }
      input: { orderId?: unknown }
      issueStorno?: IssueStornoFn
    }
    const issueStorno = (args as { issueStorno?: IssueStornoFn }).issueStorno ?? issueStornoForOrder
    const orderId = input.orderId
    if (typeof orderId !== 'number' || !Number.isInteger(orderId) || orderId <= 0) {
      throw new Error(`storno-issue: érvénytelen orderId input (${String(orderId)})`)
    }

    const gate = resolveSzamlazzTaskGate('storno-issue')
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
      logger.warn('storno-issue: a rendelés nem található — stornó kihagyva', { orderId })
      return { output: { outcome: 'failed', reason: 'a rendelés nem található' } }
    }

    if (order.status !== 'refunded') {
      const reason =
        'a rendelés nincs visszatérített állapotban — stornó csak igazolt teljes visszatérítés után állítható ki'
      logger.error('RIASZTÁS: storno-issue visszatérítés nélküli rendelésre — POST kihagyva', {
        orderId,
        status: order.status ?? null,
      })
      return { output: { outcome: 'failed', reason } }
    }

    const result = await issueStorno(order, { payload: req.payload as never })
    return {
      output: {
        outcome: result.outcome,
        ...(result.stornoNumber ? { stornoNumber: result.stornoNumber } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      },
    }
  },
}
