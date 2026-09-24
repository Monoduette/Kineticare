import type { PayloadRequest, Where } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createStaleAwareBeforeSchedule,
  MAX_RELEASED_JOBS_PER_TICK,
  scheduleLockKey,
  STALE_JOB_RELEASE_MESSAGE,
  STALE_SCHEDULED_JOB_MS,
  STUCK_JOB_ALERT_COOLDOWN_MS,
} from '../../jobs/schedule-guard'
import { ORDER_MAINTENANCE_QUEUE } from '../../jobs/queues'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import type { LogContext, Logger } from '../../lib/logger'

afterEach(() => {
  resetAlertThrottle()
})

/**
 * A beragadás-tűrő ÉS versenyhelyzet-biztos ütemezés-őr EGYSÉGTESZTJE.
 *
 * A K4-es változás óta a hook a számolást ÉS a sorba állítást is maga végzi,
 * queue+task szintű advisory-zár alatt (`schedule:<queue>:<taskSlug>`), és a
 * Payload felé mindig `shouldSchedule: false` tér vissza (különben a
 * handleSchedules még egyszer sorba állítaná — a versenyablak a hook
 * visszatérése UTÁNI `jobs.queue`-ban lenne). Ezért itt nem a visszatérési
 * érték a lényeg, hanem a QUEUE-HÍVÁS: pontosan egyszer, a helyes értékekkel.
 *
 * A tesztek a VALÓDI withAdvisoryLockot futtatják: a drizzle-mock FIFO-lánca
 * sorosítja a tranzakciókat, mint a Postgres advisory-zár — így a kétszálas
 * (rolling-deploy) verseny is hitelesen szimulálható.
 */

interface LogEntry {
  level: 'debug' | 'error' | 'info' | 'warn'
  msg: string
  context?: LogContext
}

function createRecordingLogger(entries: LogEntry[]): Logger {
  const logger: Logger = {
    debug: (msg, context) => entries.push({ level: 'debug', msg, context }),
    info: (msg, context) => entries.push({ level: 'info', msg, context }),
    warn: (msg, context) => entries.push({ level: 'warn', msg, context }),
    error: (msg, context) => entries.push({ level: 'error', msg, context }),
    child: () => logger,
  }
  return logger
}

/** A tranzakciókat FIFO-lánccal sorosító drizzle-mock (a valódi zár fut felette). */
function createSerializingDrizzle() {
  const lockParams: unknown[][] = []
  let chain: Promise<unknown> = Promise.resolve()
  const drizzle = {
    transaction: async <T>(
      run: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<T>,
    ): Promise<T> => {
      const result = chain.then(() =>
        run({
          execute: async (query: unknown) => {
            const candidate = query as { queryChunks?: unknown[] }
            const chunks = Array.isArray(candidate.queryChunks) ? candidate.queryChunks : []
            const params: unknown[] = []
            for (const chunk of chunks) {
              const stringChunk =
                typeof chunk === 'object' && chunk !== null
                  ? (chunk as { value?: unknown }).value
                  : undefined
              if (!Array.isArray(stringChunk)) {
                params.push(chunk)
              }
            }
            lockParams.push(params)
            return { rows: [] }
          },
        }),
      )
      // A lánc hibatűrő: egy elbukó védett szakasz nem akasztja meg a sort.
      chain = result.catch(() => undefined)
      return result
    },
  }
  return { drizzle, lockParams }
}

interface QueueCall {
  task?: string
  queue?: string
  waitUntil?: Date
  meta?: unknown
  input?: unknown
}

interface Scenario {
  /** „Fut vagy futtatható" jobok száma a sorba állításokon FELÜL. */
  runnableOrActive: number
  /** Ebből beragadt (processing: true + régen frissült). */
  stale: number
  staleAfterMs?: number
  countThrows?: boolean
  updateThrows?: boolean
}

interface UpdateJobsCall {
  where?: Where
  data: Record<string, unknown>
  limit?: number
}

const NOW = Date.parse('2026-08-10T12:00:00Z')
const TASK_SLUG = 'order-poll'

function isStaleCountQuery(where: Where): boolean {
  const conditions = Array.isArray(where.and) ? where.and : []
  return conditions.some((condition) => 'processing' in condition)
}

function createHarness(scenario: Scenario, clock: { now: number } = { now: NOW }) {
  const entries: LogEntry[] = []
  const seenWheres: Where[] = []
  const queueCalls: QueueCall[] = []
  const updateJobsCalls: UpdateJobsCall[] = []
  const { drizzle, lockParams } = createSerializingDrizzle()

  const payload = {
    db: {
      drizzle,
      count: async ({ where }: { where: Where }) => {
        if (scenario.countThrows) {
          throw new Error('kapcsolat megszakadt')
        }
        seenWheres.push(where)
        // A beragadt-számlálás a fixtúrából jön; a „fut vagy futtatható"
        // számlálás a MÁR SORBA ÁLLÍTOTT jobokat is látja (mint a valódi DB) —
        // ez kell a K4 kétszálas próbához.
        return {
          totalDocs: isStaleCountQuery(where)
            ? scenario.stale
            : scenario.runnableOrActive + queueCalls.length,
        }
      },
      // A beragadt sorok lezárása (a Payload saját job-író hívása).
      updateJobs: async (args: UpdateJobsCall) => {
        updateJobsCalls.push(args)
        if (scenario.updateThrows) {
          throw new Error('írás elutasítva')
        }
        return Array.from({ length: scenario.stale }, (_, index) => ({ id: index + 1 }))
      },
    },
    jobs: {
      queue: async (args: QueueCall) => {
        queueCalls.push(args)
        return { id: queueCalls.length }
      },
    },
  }
  const req = { payload } as unknown as PayloadRequest
  const waitUntil = new Date(NOW + 60_000)
  const beforeSchedule = createStaleAwareBeforeSchedule({
    taskSlug: TASK_SLUG,
    logger: createRecordingLogger(entries),
    now: () => clock.now,
    ...(scenario.staleAfterMs === undefined ? {} : { staleAfterMs: scenario.staleAfterMs }),
  })

  const run = () =>
    beforeSchedule({
      defaultBeforeSchedule: async () => ({ shouldSchedule: false }),
      jobStats: null as never,
      queueable: {
        scheduleConfig: { cron: '*/5 * * * *', queue: ORDER_MAINTENANCE_QUEUE },
        waitUntil,
      } as never,
      req,
    })

  return { entries, seenWheres, queueCalls, updateJobsCalls, lockParams, waitUntil, run }
}

describe('schedule-guard — döntés (a sorba állítás a hookban, zár alatt történik)', () => {
  it('nincs kintlévő job → PONTOSAN EGY sorba állítás, a Payload által használt értékekkel', async () => {
    const { run, queueCalls, entries, waitUntil, lockParams } = createHarness({
      runnableOrActive: 0,
      stale: 0,
    })

    const result = await run()

    // A hook maga állított sorba — a Payload már NEM queue-olhat még egyszer.
    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(1)
    expect(queueCalls[0]).toMatchObject({
      task: TASK_SLUG,
      queue: ORDER_MAINTENANCE_QUEUE,
      waitUntil,
      meta: { scheduled: true },
    })
    // A zár a queue+task szintű kulccsal jött létre, kötött paraméterként.
    expect(scheduleLockKey(ORDER_MAINTENANCE_QUEUE, TASK_SLUG)).toBe(
      `schedule:${ORDER_MAINTENANCE_QUEUE}:${TASK_SLUG}`,
    )
    expect(lockParams).toEqual([[`schedule:${ORDER_MAINTENANCE_QUEUE}:${TASK_SLUG}`]])
    // A sorba állítás NEM néma (a handleSchedules „skipped"-ként könyveli a
    // kört, ezért a tényleges queue-ról a hook ad info-sort).
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('info')
  })

  it('ÉLŐ job → nincs sorba állítás (duplikátum-védelem), riasztás nélkül', async () => {
    const { run, queueCalls, entries } = createHarness({ runnableOrActive: 1, stale: 0 })

    const result = await run()

    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(0)
    expect(entries).toHaveLength(0)
  })

  it('csak BERAGADT job → a sort lezárja, sorba állít, EGY riasztás kóddal', async () => {
    const { run, queueCalls, entries, updateJobsCalls } = createHarness({
      runnableOrActive: 1,
      stale: 1,
    })

    const result = await run()

    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(1)
    // A beragadt sor lezárása: processing: false + hasError + error, csak a
    // beragadt sorokra szűrve, tickenként korlátozva.
    expect(updateJobsCalls).toHaveLength(1)
    expect(updateJobsCalls[0]?.data).toMatchObject({
      processing: false,
      hasError: true,
      error: { message: STALE_JOB_RELEASE_MESSAGE, releasedBy: 'schedule-guard' },
    })
    expect(updateJobsCalls[0]?.limit).toBe(MAX_RELEASED_JOBS_PER_TICK)
    expect(isStaleCountQuery(updateJobsCalls[0]?.where ?? {})).toBe(true)
    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.msg).toContain('RIASZTÁS')
    expect(alerts[0]?.msg).toContain('beragadt')
    // Elérhető helyet nevez meg (a payload-jobs lista az adminban rejtett).
    expect(alerts[0]?.msg).not.toContain('payload-jobs')
    expect(alerts[0]?.msg).toContain('@alertCode:beragadt-job')
    expect(alerts[0]?.context).toMatchObject({
      alert: true,
      alertCode: 'beragadt-job',
      queue: ORDER_MAINTENANCE_QUEUE,
      stuckJobs: 1,
      releasedJobs: 1,
    })
  })

  it('ha a lezárás elbukik, az ütemezés akkor is helyreáll (sorba állít), és szól róla', async () => {
    const { run, queueCalls, entries } = createHarness({
      runnableOrActive: 1,
      stale: 1,
      updateThrows: true,
    })

    await run()

    expect(queueCalls).toHaveLength(1)
    expect(entries.some((entry) => entry.level === 'warn' && entry.msg.includes('lezárása'))).toBe(
      true,
    )
    expect(entries.find((entry) => entry.level === 'error')?.context).toMatchObject({
      alertCode: 'beragadt-job',
      releasedJobs: 0,
    })
  })

  it('beragadt ÉS élő job → a beragadtat lezárja, nincs sorba állítás', async () => {
    const { run, queueCalls, entries, updateJobsCalls } = createHarness({
      runnableOrActive: 2,
      stale: 1,
    })

    const result = await run()

    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(0)
    expect(updateJobsCalls).toHaveLength(1)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.level).toBe('error')
    expect(entries[0]?.context).toMatchObject({ stuckJobs: 1, runnableOrActiveJobs: 2 })
  })

  it('a beragadt-riasztás FOJTOTT: a cooldownon belüli újabb lezárás csak warn, utána újra riaszt', async () => {
    const clock = { now: NOW }
    const harness = createHarness({ runnableOrActive: 1, stale: 1 }, clock)

    await harness.run()
    clock.now = NOW + 60_000
    await harness.run()
    clock.now = NOW + STUCK_JOB_ALERT_COOLDOWN_MS
    await harness.run()

    expect(harness.entries.filter((entry) => entry.level === 'error')).toHaveLength(2)
    expect(harness.entries.filter((entry) => entry.level === 'warn')).toHaveLength(1)
    expect(harness.updateJobsCalls).toHaveLength(3)
  })

  /**
   * Hibás számolásnál ZÁRT irányba tévedünk: inkább kimarad egy kör, mint hogy
   * duplikátum keletkezzen. A következő cron-tick újrapróbálja — de a hibáról
   * szólni kell, különben ez is néma leállás lenne.
   */
  it('a számolás hibája → nincs sorba állítás, és hangosan szól', async () => {
    const { run, queueCalls, entries } = createHarness({
      runnableOrActive: 0,
      stale: 0,
      countThrows: true,
    })

    const result = await run()

    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(0)
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('error')
    expect(entries[0].msg).toContain('RIASZTÁS')
    expect(entries[0].context).toMatchObject({ alert: true, alertCode: 'utemezes-ellenorzes-hiba' })
  })

  it('a számolás ismételt hibája a fojtási időn belül csak warn (nem percenkénti riasztás)', async () => {
    const harness = createHarness({ runnableOrActive: 0, stale: 0, countThrows: true })

    await harness.run()
    await harness.run()

    expect(harness.entries.map((entry) => entry.level)).toEqual(['error', 'warn'])
  })
})

describe('schedule-guard — K4 versenyhelyzet (két app-példány, egy cron-tick)', () => {
  it('két PÁRHUZAMOS hívásból PONTOSAN EGY sorba állítás történik', async () => {
    const harness = createHarness({ runnableOrActive: 0, stale: 0 })

    const [first, second] = await Promise.all([harness.run(), harness.run()])

    // A sorosító zár miatt a második példány már az első által beszúrt jobot
    // látja a számlálásnál → kiszáll. Dupla job NEM keletkezhet.
    expect(harness.queueCalls).toHaveLength(1)
    expect(first.shouldSchedule).toBe(false)
    expect(second.shouldSchedule).toBe(false)
  })
})

describe('schedule-guard — a lekérdezések alakja', () => {
  it('a beragadás-küszöb a MOST mínusz staleAfterMs időpontra szűr', async () => {
    const staleAfterMs = 7 * 60 * 1000
    const { run, seenWheres } = createHarness({ runnableOrActive: 1, stale: 0, staleAfterMs })

    await run()

    const staleQuery = seenWheres.find(isStaleCountQuery)
    expect(staleQuery).toBeDefined()
    expect(staleQuery?.and).toContainEqual({
      updatedAt: { less_than: new Date(NOW - staleAfterMs).toISOString() },
    })
    expect(staleQuery?.and).toContainEqual({ processing: { equals: true } })
  })

  it('alapértelmezésben a 15 perces küszöb érvényes', async () => {
    const { run, seenWheres } = createHarness({ runnableOrActive: 1, stale: 0 })

    await run()

    expect(seenWheres.find(isStaleCountQuery)?.and).toContainEqual({
      updatedAt: { less_than: new Date(NOW - STALE_SCHEDULED_JOB_MS).toISOString() },
    })
  })

  it('mindkét számolás a queue-ra ÉS a task slugjára szűkít', async () => {
    const { run, seenWheres } = createHarness({ runnableOrActive: 1, stale: 1 })

    await run()

    expect(seenWheres).toHaveLength(2)
    for (const where of seenWheres) {
      expect(where.and).toContainEqual({ queue: { equals: ORDER_MAINTENANCE_QUEUE } })
      expect(where.and).toContainEqual({ taskSlug: { equals: TASK_SLUG } })
      expect(where.and).toContainEqual({ completedAt: { exists: false } })
      expect(where.and).toContainEqual({ error: { exists: false } })
    }
  })
})
