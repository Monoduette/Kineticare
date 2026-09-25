import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload, type TaskConfig } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildJobsConfig } from '../../jobs'
import { ORDER_MAINTENANCE_QUEUE } from '../../jobs/queues'
import { INVOICE_RESWEEP_BATCH_SIZE } from '../../lib/order-poll/service'
import { SzamlazzApiError } from '../../lib/szamlazz/types'
import configPromise from '../../payload.config'
import { isDatabaseAvailable } from '../helpers/db-available'
import { captureOwnedPostgresBootstrap } from '../helpers/owned-postgres-bootstrap'

// A teszt job-sorokat ír és töröl: csak az eldobható, helyi CI-adatbázison
// futhat. Az audit:1 a hálózattiltott lokális runner elérhetetlen jelzője.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    (target.pathname !== '/kineticare_ci' && !(target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error(
      'Az order-poll kiéheztetés DB-teszt csak az eldobható, helyi CI-adatbázison futhat',
    )
  }
}
const hasDb = await isDatabaseAvailable()

/**
 * Az order-poll a Számlázz.hu-torlódás mögött is lefut (hibavadász C, PR #307).
 *
 * A Payload runJobs a futtatható jobokból `limit` darabot vesz fel, `createdAt`
 * szerint növekvő sorrendben. Az újrapróbáló számlajobok megtartják a régi
 * createdAt-jüket, és várakoztatás nélkül a következő tickben újra felvehetők.
 * Amíg az order-poll velük egy queue-ban volt, egy Számlázz.hu-kimaradás alatt
 * 20–40 percig nem futott: nem volt elveszett-callback-pótlás, resweep és
 * életjel.
 *
 * A teszt a valódi wiringet használja: az order-poll schedule-jének queue-ját
 * a Payload-configból, az autoRun-entryket (queue és limit) a bekapcsolt
 * workerekkel épített jobs-configból, a jobok felvételét a valódi runJobs és a
 * valódi Postgres dönti el. Csak a két task handlere helyettesített, hogy ne
 * menjen ki hálózati hívás; a retries a valódi task-configé. A queue-neveket
 * egy futásonként egyedi utótag választja el a párhuzamos tesztfájlok
 * jobjaitól. A leképezés kölcsönösen egyértelmű, így az „egy queue-ban van-e a
 * poll a számlajobokkal” kérdést nem változtatja meg.
 */
describe.skipIf(!hasDb)('order-poll a számlázási torlódás mögött (valódi PostgreSQL)', () => {
  const run = `order-poll-starvation-${randomUUID()}`
  const suffix = randomUUID().slice(0, 8)
  const testQueue = (queue: string): string => `${queue}-${suffix}`
  let payload: Payload
  let releaseBootstrap: (() => void) | undefined
  let pollQueue = ''
  let currentTick = 0
  const pollRanAtTick: number[] = []

  const adapter = () => payload.db as unknown as PostgresAdapter

  /** A Payload autoRun-cronjának entryjei bekapcsolt workerekkel (élesben ez fut). */
  const autoRunEntries = (() => {
    const autoRun = buildJobsConfig({ ...process.env, ENABLE_JOB_WORKERS: 'true' }).autoRun
    return (Array.isArray(autoRun) ? autoRun : []) as Array<{ queue?: string; limit?: number }>
  })()

  type QueueJob = (args: {
    task: string
    input: Record<string, unknown>
    queue: string
    waitUntil?: Date
    meta?: Record<string, unknown>
  }) => Promise<unknown>
  const queueJob: QueueJob = (args) =>
    (payload.jobs.queue as unknown as QueueJob)({ ...args, queue: testQueue(args.queue) })

  beforeAll(async () => {
    const config = await configPromise
    const tasks = (config.jobs.tasks ?? []) as TaskConfig[]
    pollQueue = tasks.find((task) => task.slug === 'order-poll')?.schedule?.[0]?.queue ?? ''
    payload = await new BasePayload().init({
      config: {
        ...config,
        telemetry: false,
        typescript: { ...config.typescript, autoGenerate: false },
        jobs: {
          ...config.jobs,
          tasks: tasks.map((task) => {
            if (task.slug === 'invoice-issue') {
              // Amit az issueInvoiceForOrder egy Számlázz.hu-kimaradásnál tesz:
              // újrapróbálható hibát dob, a job a következő tickben újra jön.
              return {
                ...task,
                handler: async () => {
                  throw new SzamlazzApiError({
                    message: 'A Számlázz.hu nem válaszolt 15000 ms-en belül.',
                    kind: 'timeout',
                    retryable: true,
                  })
                },
              }
            }
            if (task.slug === 'order-poll') {
              return {
                ...task,
                handler: async () => {
                  pollRanAtTick.push(currentTick)
                  return { output: {} }
                },
              }
            }
            return task
          }),
        },
        db: {
          ...config.db,
          init(options) {
            const db = config.db.init(options) as unknown as PostgresAdapter
            db.poolOptions = { ...db.poolOptions, application_name: run }
            releaseBootstrap = captureOwnedPostgresBootstrap(db)
            return db
          },
        },
      },
      disableOnInit: true,
    })
  }, 60_000)

  afterEach(async () => {
    await adapter().pool.query('DELETE FROM payload_jobs WHERE queue LIKE $1', [`%-${suffix}`])
    pollRanAtTick.length = 0
    currentTick = 0
  })

  afterAll(async () => {
    if (!payload) return
    const pool = adapter().pool
    await payload.destroy()
    releaseBootstrap?.()
    await pool.end()
  })

  /** Egy cron-tick: minden autoRun-entry a saját queue-ján és limitjével (a Payload alapja 10). */
  async function runTick(tick: number): Promise<void> {
    currentTick = tick
    for (const entry of autoRunEntries) {
      await payload.jobs.run({
        queue: testQueue(entry.queue ?? 'default'),
        limit: entry.limit ?? 10,
        silent: true,
      })
    }
  }

  it('egy resweep-környi hibázó számlajob mögött a poll minden tickben lefut', async () => {
    expect(pollQueue, 'az order-poll schedule-jének queue-ja a configból').not.toBe('')
    // Egy resweep-kör számlajobjai, a Számlázz.hu-jobok queue-jában, ahová a
    // termelő kód (order-paid.ts, szamlazz/queue.ts) állítja őket.
    for (let orderId = 1; orderId <= INVOICE_RESWEEP_BATCH_SIZE; orderId += 1) {
      await queueJob({ task: 'invoice-issue', input: { orderId }, queue: ORDER_MAINTENANCE_QUEUE })
    }

    for (const tick of [1, 2, 3]) {
      // Ahogy a schedule-őr teszi: a poll a számlajobok után, a tick idejére kerül sorba.
      await queueJob({
        task: 'order-poll',
        input: {},
        queue: pollQueue,
        waitUntil: new Date(Date.now() - 1_000),
        meta: { scheduled: true },
      })
      await runTick(tick)
    }

    expect(pollRanAtTick).toEqual([1, 2, 3])
    // A torlódás közben is fogy: a számlajobok is futottak mindhárom tickben.
    const tried = await adapter().pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(total_tried), 0) AS total FROM payload_jobs
        WHERE queue = $1 AND task_slug = 'invoice-issue'`,
      [testQueue(ORDER_MAINTENANCE_QUEUE)],
    )
    expect(Number(tried.rows[0]?.total)).toBeGreaterThan(0)
  }, 120_000)
})
