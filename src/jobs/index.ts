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
  ORDER_POLL_QUEUE,
  WEBHOOK_RETRY_CRON,
  WEBHOOK_RETRY_QUEUE,
} from './queues'

/**
 * Payload jobs-konfig.
 *
 * Ütemezett: webhook-retry, order-poll (mindkettő a saját queue-jában).
 * Esemény-vezérelt: invoice / storno / helyesbítő (order-maintenance queue).
 * Az `autoRun` csak a már sorban lévő jobokat futtatja — a periodikus
 * taskoknak `schedule` kell, különben a Barion-callback pótlása némán
 * elmarad. A `schedule` + `autoRun` PÁRBAN érvényes.
 *
 * A `scheduling` Payload-global + `payload-jobs.meta` sémát hoz; a migrációnak
 * ugyanabban a változáskörben kell mennie. Hiányzó `payload-jobs-stats`
 * táblánál a cron ELŐSZÖR a `handleSchedules`-t hívja, az dob, és a számlázási
 * jobok sem futnak. Workerek: `ENABLE_JOB_WORKERS=true`.
 */

/**
 * Az order-maintenance queue egy tickben ennyi jobot vesz fel. A Payload a
 * felvett jobokat PÁRHUZAMOSAN futtatja (runJobs: `Promise.all`, `sequential`
 * nélkül), és ebben a queue-ban futnak a számla-, stornó- és helyesbítő jobok:
 * mindegyik egy zár-kapcsolatot és még 1–2 lekérdező kapcsolatot fog, a
 * Számlázz.hu-hívások idejére is. A korábbi 25-ös limit egy Számlázz.hu-
 * kimaradás utáni torlódásnál (resweep + újrapróbálások + friss rendelések) a
 * 20-as poolt (payload.config.ts) kimerítette volna, és az egész oldal (pénztár,
 * Barion-callback, admin) a kapcsolat-timeoutig állt volna (a-szamlazz-11).
 *
 * A két rendelés-queue együtt egy tickben legfeljebb 4 jobot futtat: 3
 * Számlázz.hu-jobot és az order-poll egyetlen jobját (ORDER_POLL_AUTORUN_LIMIT,
 * saját queue-ban, lásd queues.ts). 4 job × legfeljebb 3 kapcsolat = 12, a
 * maradék a kéréseké (a keret leírása: src/lib/checkout/lock-slots.ts). Amíg az
 * order-poll ebben a queue-ban volt, a 4 helyből egyet ő foglalt minden tickben,
 * tehát a Számlázz.hu-jobok áteresztése a szétválasztással nem változott. A
 * torlódás így is lefut, csak több tick (5 perc) alatt.
 */
export const ORDER_MAINTENANCE_AUTORUN_LIMIT = 3

/**
 * Az order-poll queue egy tickben egy jobot futtat: a schedule-őr
 * (schedule-guard.ts) queue-nként és taskonként egyetlen élő order-poll jobot
 * enged, tehát több hely úgysem telne meg.
 */
export const ORDER_POLL_AUTORUN_LIMIT = 1

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
              limit: ORDER_MAINTENANCE_AUTORUN_LIMIT,
              queue: ORDER_MAINTENANCE_QUEUE,
            },
            {
              cron: ORDER_MAINTENANCE_CRON,
              limit: ORDER_POLL_AUTORUN_LIMIT,
              queue: ORDER_POLL_QUEUE,
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
  ORDER_POLL_QUEUE,
  WEBHOOK_RETRY_CRON,
  WEBHOOK_RETRY_QUEUE,
} from './queues'
export { webhookRetryTask } from './tasks/webhook-retry'
export { orderPollTask } from './tasks/order-poll'
export { invoiceIssueTask } from './tasks/invoice-issue'
export { stornoIssueTask } from './tasks/storno-issue'
export { correctiveInvoiceIssueTask } from './tasks/corrective-invoice-issue'
