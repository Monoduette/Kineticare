import type { TaskConfig } from 'payload'

import { resolveServerUrl } from '../../env'
import { installAlertSink } from '../../lib/alerts/install'
import { parseAlertRecipients } from '../../lib/alerts/mail'
import { afterOrderPoll } from '../../lib/alerts/poll-watch'
import { sendMail } from '../../lib/email'
import { type InvoiceResweepStatus, pollPendingOrders } from '../../lib/order-poll/service'
import { logger } from '../../lib/logger'
import { ORDER_MAINTENANCE_CRON, ORDER_MAINTENANCE_QUEUE } from '../queues'
import { createStaleAwareBeforeSchedule } from '../schedule-guard'

/**
 * order-poll: callback-mentőháló + számla-resweep; ütemezés cron-ból (ENABLE_JOB_WORKERS).
 * A futás után: 24 órás függő-fizetés riasztás, reggeli napi összesítő és életjel
 * (`src/lib/alerts/poll-watch.ts`).
 *
 * A riasztás-csatorna (e-mail + PostHog a RIASZTÁS-sorokra) itt kapcsol be: ezt
 * a modult a Payload-config minden szerverfolyamatban betölti (jobs/index.ts),
 * a bekötés pedig csak a Next szerveren él (`src/lib/alerts/install.ts`).
 */
installAlertSink()

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
    await afterOrderPoll({
      payload: req.payload,
      logger,
      nowMs: Date.now(),
      sendMail,
      recipients: () => parseAlertRecipients(process.env.OWNER_ALERT_EMAILS),
      serverUrl: resolveServerUrl(),
      heartbeatUrl: process.env.HEALTHCHECK_PING_URL,
      vatMode: process.env.SZAMLAZZ_AFAKULCS,
    })
    return { output: { ...summary } }
  },
}
