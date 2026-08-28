import type { TaskConfig } from 'payload'

import { type InvoiceResweepStatus, pollPendingOrders } from '../../lib/order-poll/service'
import { logger } from '../../lib/logger'
import { ORDER_MAINTENANCE_CRON, ORDER_MAINTENANCE_QUEUE } from '../queues'
import { createStaleAwareBeforeSchedule } from '../schedule-guard'

/** order-poll: callback-mentőháló + számla-resweep; ütemezés cron-ból (ENABLE_JOB_WORKERS). */

interface OrderPollJobIO {
  input: Record<string, never>
  output: {
    scanned: number
    transitionedPaid: number
    cancelled: number
    stillPending: number
    skipped: number
    failed: number
    orphaned: number
    invoiceRequeued: number
    invoiceResweep: InvoiceResweepStatus
    lateSuccessScanned: number
  }
}

export const orderPollTask: TaskConfig<OrderPollJobIO> = {
  slug: 'order-poll',
  retries: 1,
  schedule: [
    {
      cron: ORDER_MAINTENANCE_CRON,
      queue: ORDER_MAINTENANCE_QUEUE,
      hooks: { beforeSchedule: createStaleAwareBeforeSchedule({ taskSlug: 'order-poll' }) },
    },
  ],
  outputSchema: [
    { name: 'scanned', type: 'number', required: true },
    { name: 'transitionedPaid', type: 'number', required: true },
    { name: 'cancelled', type: 'number', required: true },
    { name: 'stillPending', type: 'number', required: true },
    { name: 'skipped', type: 'number', required: true },
    { name: 'failed', type: 'number', required: true },
    { name: 'orphaned', type: 'number', required: true },
    { name: 'invoiceRequeued', type: 'number', required: true },
    // A `text` szándékos: az outputSchema KIZÁRÓLAG típusgeneráláshoz kell (a
    // job-log `output` mezője sima json), tehát ez a mező NEM jár sémaváltozással.
    { name: 'invoiceResweep', type: 'text', required: true },
    { name: 'lateSuccessScanned', type: 'number', required: true },
  ],
  handler: async ({ req }) => {
    const summary = await pollPendingOrders({ payload: req.payload })
    logger.info('order-poll task lefutott', { ...summary })
    return { output: { ...summary } }
  },
}
