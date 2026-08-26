import type { JobsConfig } from 'payload'

import { isStaffOrOwner } from '../access/isStaffOrOwner'
import { correctiveInvoiceIssueTask } from './tasks/corrective-invoice-issue'
import { invoiceIssueTask } from './tasks/invoice-issue'
import { orderPollTask } from './tasks/order-poll'
import { stornoIssueTask } from './tasks/storno-issue'
import { webhookRetryTask } from './tasks/webhook-retry'
import {
  ORDER_MAINTENANCE_CRON,
  ORDER_MAINTENANCE_QUEUE,
  WEBHOOK_RETRY_CRON,
  WEBHOOK_RETRY_QUEUE,
} from './queues'

/**
 * Payload jobs-konfig.
 *
 * Ütemezett: webhook-retry, order-poll. Esemény-vezérelt: invoice / storno /
 * helyesbítő. Az `autoRun` csak a már sorban lévő jobokat futtatja — a
 * periodikus taskoknak `schedule` kell, különben a Barion-callback pótlása
 * némán elmarad. A `schedule` + `autoRun` PÁRBAN érvényes.
 *
 * A `scheduling` Payload-global + `payload-jobs.meta` sémát hoz; a migrációnak
 * ugyanabban a változáskörben kell mennie. Hiányzó `payload-jobs-stats`
 * táblánál a cron ELŐSZÖR a `handleSchedules`-t hívja, az dob, és a számlázási
 * jobok sem futnak. Workerek: `ENABLE_JOB_WORKERS=true`.
 */

function jobWorkersEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ENABLE_JOB_WORKERS === 'true'
}

/**
 * Job REST-végpontok: staff/owner. A Payload defaultja bármely bejelentkezett
 * user (customer is). A cron és a `payload.jobs.queue` `overrideAccess: true`,
 * tehát a számlázási lánc nem törik el.
 */
const JOBS_ACCESS: NonNullable<JobsConfig['access']> = {
  cancel: isStaffOrOwner,
  queue: isStaffOrOwner,
  run: isStaffOrOwner,
}

/**
 * A `jobs.access` csak a /run és /handle-schedules végpontot védi. A collection
 * CRUD defaultja szintén bármely bejelentkezett user — POST-tal tetszőleges
 * taskot lehetne sorba állítani. A belső `payload.db.*` utak megkerülik ezt.
 */
const jobsCollectionOverrides: NonNullable<JobsConfig['jobsCollectionOverrides']> = ({
  defaultJobsCollection,
}) => ({
  ...defaultJobsCollection,
  access: {
    ...defaultJobsCollection.access,
    create: isStaffOrOwner,
    delete: isStaffOrOwner,
    read: isStaffOrOwner,
    update: isStaffOrOwner,
  },
})

/**
 * A jobs-konfig felépítése az env függvényében. Tiszta függvény, hogy a
 * teszt a bekapcsolt worker-ág (autoRun) és a task-schedule-ök EGYÜTTES
 * helyességét is ellenőrizni tudja — az `ENABLE_JOB_WORKERS` a tesztfutásban
 * nincs beállítva, tehát a modul-szintű `jobsConfig` autoRun nélkül épül fel.
 */
export function buildJobsConfig(env: NodeJS.ProcessEnv = process.env): JobsConfig {
  return {
    access: JOBS_ACCESS,
    jobsCollectionOverrides,
    tasks: [
      webhookRetryTask,
      orderPollTask,
      invoiceIssueTask,
      stornoIssueTask,
      correctiveInvoiceIssueTask,
    ],
    ...(jobWorkersEnabled(env)
      ? {
          autoRun: [
            {
              cron: WEBHOOK_RETRY_CRON,
              limit: 25,
              queue: WEBHOOK_RETRY_QUEUE,
            },
            {
              cron: ORDER_MAINTENANCE_CRON,
              limit: 25,
              queue: ORDER_MAINTENANCE_QUEUE,
            },
          ],
        }
      : {}),
  }
}

export const jobsConfig: JobsConfig = buildJobsConfig()

export {
  ORDER_MAINTENANCE_CRON,
  ORDER_MAINTENANCE_QUEUE,
  WEBHOOK_RETRY_CRON,
  WEBHOOK_RETRY_QUEUE,
} from './queues'
export { webhookRetryTask } from './tasks/webhook-retry'
export { orderPollTask } from './tasks/order-poll'
export { invoiceIssueTask } from './tasks/invoice-issue'
export { stornoIssueTask } from './tasks/storno-issue'
export { correctiveInvoiceIssueTask } from './tasks/corrective-invoice-issue'
