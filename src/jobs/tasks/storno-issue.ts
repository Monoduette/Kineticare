import type { TaskConfig } from 'payload'

import type { Order } from '../../payload-types'
import { getSzamlazzConfig, issueStornoForOrder } from '../../lib/szamlazz'
import { logger } from '../../lib/logger'

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
  handler: async ({ req, input }) => {
    const orderId = (input as { orderId?: unknown }).orderId
    if (typeof orderId !== 'number' || !Number.isInteger(orderId) || orderId <= 0) {
      throw new Error(`storno-issue: érvénytelen orderId input (${String(orderId)})`)
    }

    // Kikapcsolt integrációnál a task azonnal, hiba nélkül lezárul.
    if (!getSzamlazzConfig().enabled) {
      logger.debug('storno-issue: a Számlázz.hu-integráció kikapcsolva (nincs agent-kulcs) — no-op')
      return { output: { outcome: 'disabled' } }
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

    const result = await issueStornoForOrder(order, { payload: req.payload })
    return {
      output: {
        outcome: result.outcome,
        ...(result.stornoNumber ? { stornoNumber: result.stornoNumber } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      },
    }
  },
}
