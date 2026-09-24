import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  createStaleAwareBeforeSchedule,
  STALE_JOB_RELEASE_AFTER_MS,
  STALE_JOB_RELEASE_MESSAGE,
} from '../../jobs/schedule-guard'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { BARION_GET_TIMEOUT_MS } from '../../lib/barion/client'
import type { LogContext, Logger } from '../../lib/logger'
import { CONFIRMATION_RETRY_DELAYS_MS } from '../../lib/order-paid'
import {
  LATE_SUCCESS_BATCH_SIZE,
  LATE_SUCCESS_REFILL_PAGES,
  ORDER_POLL_BATCH_SIZE,
  ORDER_POLL_REFILL_PAGES,
} from '../../lib/order-poll/service'
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
    throw new Error('A schedule-guard DB-teszt csak az eldobható, helyi CI-adatbázison futhat')
  }
}
const hasDb = await isDatabaseAvailable()

/**
 * A schedule-guard lezárása VALÓDI Postgresen (H1).
 *
 * A lezárás feltételes SQL-írás; azt, hogy élő vagy közben befejeződött sorba
 * nem ír bele, csak valódi sorzárral és a valódi `payload_jobs` sémán lehet
 * megmérni. A tesztek saját, egyedi queue-t használnak, így más job-sorokhoz
 * nem nyúlnak.
 */

/** A Resend-hívás időkorlátja (src/lib/email/resend.ts, RESEND_TIMEOUT_MS). */
const RESEND_TIMEOUT_MS = 10_000

/**
 * Az order-poll dokumentált legrosszabb futásideje (a STALE_JOB_RELEASE_AFTER_MS
 * leírásának modellje, ugyanazokból az állandókból): 70 lassú, de sikeres
 * GetState, mindegyik után a leghosszabb mellékhatás (a visszaigazoló levél
 * minden próbálkozása időtúllépéssel, a várakozásokkal együtt), plusz egy perc
 * a futás végére. ≈ 63 perc.
 */
const DOCUMENTED_WORST_CASE_MS =
  (ORDER_POLL_BATCH_SIZE * (1 + ORDER_POLL_REFILL_PAGES) +
    LATE_SUCCESS_BATCH_SIZE * (1 + LATE_SUCCESS_REFILL_PAGES)) *
    (BARION_GET_TIMEOUT_MS +
      (1 + CONFIRMATION_RETRY_DELAYS_MS.length) * RESEND_TIMEOUT_MS +
      CONFIRMATION_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)) +
  60_000

interface LogEntry {
  level: 'debug' | 'error' | 'info' | 'warn'
  msg: string
  context?: LogContext
}

interface JobRow {
  processing: boolean
  has_error: boolean | null
  error: Record<string, unknown> | null
  completed_at: Date | null
}

describe.skipIf(!hasDb)('schedule-guard lezárás (valódi PostgreSQL)', () => {
  const run = `schedule-guard-${randomUUID()}`
  const queue = `teszt-${randomUUID().slice(0, 8)}`
  let payload: Payload
  let releaseBootstrap: (() => void) | undefined

  const adapter = () => payload.db as unknown as PostgresAdapter

  beforeAll(async () => {
    const config = await configPromise
    payload = await new BasePayload().init({
      config: {
        ...config,
        telemetry: false,
        typescript: { ...config.typescript, autoGenerate: false },
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
    resetAlertThrottle()
    await adapter().pool.query('DELETE FROM payload_jobs WHERE queue = $1', [queue])
  })

  afterAll(async () => {
    if (!payload) return
    const pool = adapter().pool
    await payload.destroy()
    releaseBootstrap?.()
    await pool.end()
  })

  async function insertRunningJob(claimedAtMs: number): Promise<number> {
    const claimedAt = new Date(claimedAtMs).toISOString()
    const inserted = await adapter().pool.query<{ id: number }>(
      `INSERT INTO payload_jobs (queue, task_slug, processing, input, created_at, updated_at)
       VALUES ($1, 'order-poll', true, '{}'::jsonb, $2, $2) RETURNING id`,
      [queue, claimedAt],
    )
    return inserted.rows[0].id
  }

  async function readJob(id: number): Promise<JobRow> {
    const result = await adapter().pool.query<JobRow>(
      'SELECT processing, has_error, error, completed_at FROM payload_jobs WHERE id = $1',
      [id],
    )
    return result.rows[0]
  }

  async function otherJobs(id: number): Promise<number> {
    const result = await adapter().pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM payload_jobs WHERE queue = $1 AND id <> $2',
      [queue, id],
    )
    return result.rows[0].count
  }

  function runGuard(nowMs: number): { entries: LogEntry[]; done: Promise<unknown> } {
    const entries: LogEntry[] = []
    const logger: Logger = {
      debug: (msg, context) => entries.push({ level: 'debug', msg, context }),
      info: (msg, context) => entries.push({ level: 'info', msg, context }),
      warn: (msg, context) => entries.push({ level: 'warn', msg, context }),
      error: (msg, context) => entries.push({ level: 'error', msg, context }),
      child: () => logger,
    }
    const hook = createStaleAwareBeforeSchedule({
      taskSlug: 'order-poll',
      logger,
      now: () => nowMs,
    })
    const done = Promise.resolve(
      hook({
        defaultBeforeSchedule: async () => ({ shouldSchedule: false }),
        jobStats: null as never,
        queueable: {
          scheduleConfig: { cron: '*/5 * * * *', queue },
          waitUntil: new Date(nowMs),
        } as never,
        req: { payload } as unknown as PayloadRequest,
      }),
    )
    return { entries, done }
  }

  /** Vár, amíg a guard egy sorzárra nem vár (pg_stat_activity), vagy lefut. */
  async function lockWaitOrSettled(done: Promise<unknown>): Promise<'waiting' | 'settled'> {
    let settled = false
    void done.then(
      () => (settled = true),
      () => (settled = true),
    )
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (settled) return 'settled'
      const waiting = await adapter().pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE application_name = $1 AND wait_event_type = 'Lock'`,
        [run],
      )
      if (waiting.rows[0].count > 0) return 'waiting'
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('a guard 5 mp alatt sem futott le, és sorzárra sem várt')
  }

  it('a dokumentált legrosszabb futásidőig (~63 perc) futó order-poll sorába nem ír, de mellette új futást állít sorba', async () => {
    const nowMs = Date.now()
    const id = await insertRunningJob(nowMs - DOCUMENTED_WORST_CASE_MS)

    const { entries, done } = runGuard(nowMs)
    await done

    expect(await readJob(id)).toMatchObject({
      processing: true,
      has_error: false,
      error: null,
      completed_at: null,
    })
    expect(await otherJobs(id)).toBe(1)
    expect(entries.filter((entry) => entry.context?.alert === true)).toEqual([])
  }, 30_000)

  it('a legrosszabb futásidőn túli sort lezárja, és egyszer riaszt róla', async () => {
    const nowMs = Date.now()
    const id = await insertRunningJob(nowMs - STALE_JOB_RELEASE_AFTER_MS - 60_000)

    const { entries, done } = runGuard(nowMs)
    await done

    const row = await readJob(id)
    expect(row).toMatchObject({ processing: false, has_error: true, completed_at: null })
    expect(row.error).toMatchObject({
      message: STALE_JOB_RELEASE_MESSAGE,
      releasedBy: 'schedule-guard',
    })
    expect(await otherJobs(id)).toBe(1)
    const alerts = entries.filter((entry) => entry.context?.alert === true)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.context).toMatchObject({ alertCode: 'beragadt-job', releasedJobs: 1 })
  }, 30_000)

  it('a lezárás közben befejeződő sorra nem kerül hasError, és a guard a sorzárra sem vár', async () => {
    const nowMs = Date.now()
    const id = await insertRunningJob(nowMs - STALE_JOB_RELEASE_AFTER_MS - 60_000)
    // A Payload befejező írása (completedAt + processing: false) épp fut: a
    // tranzakciója a sort zárolja, de még nem commitolt.
    const blocker = await adapter().pool.connect()
    let done: Promise<unknown> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query(
        `UPDATE payload_jobs SET completed_at = now(), processing = false, updated_at = now()
         WHERE id = $1`,
        [id],
      )

      const guard = runGuard(nowMs)
      done = guard.done
      const outcome = await lockWaitOrSettled(done)
      await blocker.query('COMMIT')
      await done

      const row = await readJob(id)
      expect(row.completed_at).not.toBeNull()
      expect(row).toMatchObject({ processing: false, has_error: false, error: null })
      // Egy beragadt tranzakció sorzárja sem akaszthatja meg az ütemezést.
      expect(outcome).toBe('settled')
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
      if (done) await done.catch(() => undefined)
    }
  }, 30_000)
})
