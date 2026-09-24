import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { PayloadRequest, Where } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createStaleAwareBeforeSchedule,
  MAX_RELEASED_JOBS_PER_TICK,
  scheduleLockKey,
  STALE_JOB_RELEASE_AFTER_MS,
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
 *
 * A beragadt sor lezárása feltételes SQL-írás; hogy élő vagy közben
 * befejeződött sorba nem ír, azt a schedule-guard-db.test.ts méri valódi
 * Postgresen. Itt a fixtúra csak azt adja meg, hány sort zárt le az adatbázis.
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
  /** Ebből a 15 perces ütemezési küszöbnél régebbi (processing: true). */
  stale: number
  /** Ebből ennyit zár le az adatbázis feltételes UPDATE-je (alapból mindet). */
  released?: number
  /** Ebből a lezárási korlátnál (STALE_JOB_RELEASE_AFTER_MS) régebbi (alapból 0). */
  overdue?: number
  staleAfterMs?: number
  countThrows?: boolean
  releaseThrows?: boolean
  /** A lezárási korlát szerinti számolás hibája (a lezárás hibája után fut). */
  overdueCountThrows?: boolean
  /** Az új futás sorba állítása elbukik (például betelt vagy csak olvasható lemez). */
  queueThrows?: boolean
}

/** A lezáró UPDATE lefordított alakja (szöveg + kötött paraméterek). */
interface ReleaseStatement {
  sql: string
  params: unknown[]
}

const NOW = Date.parse('2026-08-10T12:00:00Z')
const TASK_SLUG = 'order-poll'

function isStaleCountQuery(where: Where): boolean {
  const conditions = Array.isArray(where.and) ? where.and : []
  return conditions.some((condition) => 'processing' in condition)
}

/** A számolás `updatedAt < …` vágási időpontja, ha van. */
function updatedAtCutoff(where: Where): unknown {
  const conditions = Array.isArray(where.and) ? where.and : []
  const cutoff = conditions.find((condition) => 'updatedAt' in condition) as
    { updatedAt?: { less_than?: unknown } } | undefined
  return cutoff?.updatedAt?.less_than
}

function createHarness(scenario: Scenario, clock: { now: number } = { now: NOW }) {
  const entries: LogEntry[] = []
  const seenWheres: Where[] = []
  const queueCalls: QueueCall[] = []
  const releaseStatements: ReleaseStatement[] = []
  const { drizzle, lockParams } = createSerializingDrizzle()
  const dialect = new PgDialect()

  const payload = {
    db: {
      drizzle: {
        ...drizzle,
        // A beragadt sorok lezárása (egyetlen feltételes UPDATE).
        execute: async (query: SQL) => {
          releaseStatements.push(dialect.sqlToQuery(query))
          if (scenario.releaseThrows) {
            throw new Error('írás elutasítva')
          }
          const count = scenario.released ?? scenario.stale
          return { rows: Array.from({ length: count }, (_, index) => ({ id: index + 1 })) }
        },
      },
      count: async ({ where }: { where: Where }) => {
        if (scenario.countThrows) {
          throw new Error('kapcsolat megszakadt')
        }
        seenWheres.push(where)
        // A beragadt-számlálás a fixtúrából jön; a „fut vagy futtatható"
        // számlálás a MÁR SORBA ÁLLÍTOTT jobokat is látja (mint a valódi DB) —
        // ez kell a K4 kétszálas próbához.
        if (!isStaleCountQuery(where)) {
          return { totalDocs: scenario.runnableOrActive + queueCalls.length }
        }
        if (
          updatedAtCutoff(where) === new Date(clock.now - STALE_JOB_RELEASE_AFTER_MS).toISOString()
        ) {
          if (scenario.overdueCountThrows) {
            throw new Error('kapcsolat megszakadt')
          }
          return { totalDocs: scenario.overdue ?? 0 }
        }
        return { totalDocs: scenario.stale }
      },
    },
    jobs: {
      queue: async (args: QueueCall) => {
        if (scenario.queueThrows) {
          throw new Error('nincs hely az eszközön')
        }
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

  return { entries, seenWheres, queueCalls, releaseStatements, lockParams, waitUntil, run }
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
    const { run, queueCalls, entries, releaseStatements } = createHarness({
      runnableOrActive: 1,
      stale: 1,
    })

    const result = await run()

    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(1)
    // A lezárás: egyetlen UPDATE erre a queue-ra és taskra, a LEZÁRÁSI korlát
    // (a futás kezdete + a legrosszabb futásidő) szerinti vágással, nem a 15
    // perces ütemezési küszöbbel; tickenként korlátozva, a lezárás okával.
    expect(releaseStatements).toHaveLength(1)
    const params = releaseStatements[0]?.params ?? []
    expect(params).toEqual(
      expect.arrayContaining([
        ORDER_MAINTENANCE_QUEUE,
        TASK_SLUG,
        new Date(NOW - STALE_JOB_RELEASE_AFTER_MS).toISOString(),
        MAX_RELEASED_JOBS_PER_TICK,
      ]),
    )
    expect(params).not.toContain(new Date(NOW - STALE_SCHEDULED_JOB_MS).toISOString())
    const errorJson = params.find(
      (param) => typeof param === 'string' && param.includes('releasedBy'),
    )
    expect(JSON.parse(String(errorJson))).toMatchObject({
      message: STALE_JOB_RELEASE_MESSAGE,
      releasedBy: 'schedule-guard',
    })
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

  /**
   * H1: ha a lezárás elbukik, semmi nem zárult le. A lezárási korlátnál
   * fiatalabb sor mögött élő futás lehet, róla a tulajdonos nem kaphat
   * riasztást; a korlát szerint elhaltnak tekintett, de le nem zárható sorról
   * viszont hangosan kell szólni (a lezáró SQL elromlását csak így venni észre), úgy, hogy a
   * szöveg ne állítsa, hogy a rendszer lezárta.
   */
  it('ha a lezárás elbukik egy még élhető soron: nincs riasztás, csak figyelmeztetés, és sorba állít', async () => {
    const { run, queueCalls, entries } = createHarness({
      runnableOrActive: 1,
      stale: 1,
      releaseThrows: true,
    })

    await run()

    expect(queueCalls).toHaveLength(1)
    expect(entries.filter((entry) => entry.level === 'error')).toEqual([])
    expect(entries.some((entry) => entry.level === 'warn' && entry.msg.includes('lezárása'))).toBe(
      true,
    )
  })

  it('ha a lezárás elbukik egy a korlát szerint elhalt soron: sorba állít, és a hibáról riaszt, nem lezárásról', async () => {
    const { run, queueCalls, entries } = createHarness({
      runnableOrActive: 1,
      stale: 1,
      overdue: 1,
      releaseThrows: true,
    })

    await run()

    expect(queueCalls).toHaveLength(1)
    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.msg).toContain('lezárása nem sikerült')
    expect(alerts[0]?.msg).not.toContain('zárt le')
    expect(alerts[0]?.msg).toContain('@alertCode:beragadt-job-lezaras-sikertelen')
    expect(alerts[0]?.context).toMatchObject({
      alert: true,
      alertCode: 'beragadt-job-lezaras-sikertelen',
      overdueJobs: 1,
      error: 'írás elutasítva',
    })
  })

  it('ha a lezárás után a korlát szerinti számolás is elbukik, az ütemezés akkor sem áll meg', async () => {
    const { run, queueCalls, entries } = createHarness({
      runnableOrActive: 1,
      stale: 1,
      releaseThrows: true,
      overdueCountThrows: true,
    })

    await run()

    expect(queueCalls).toHaveLength(1)
    expect(entries.filter((entry) => entry.level === 'error')).toEqual([])
  })

  /**
   * A lezárásról és a lezárás hibájáról szóló riasztás azt is mondja, hogy az
   * ütemezés működik. Ha az új futás sorba állítása is elbukik (például betelt
   * vagy csak olvasható lemez mellett), ugyanabban a tickben nem mehet ki
   * mellette az ütemezés hibájáról szóló, ellentmondó riasztás: csak ez az
   * utóbbi szól, a lezárás sorsa pedig a naplóban marad.
   */
  it.each([
    {
      eset: 'a lezárás sikerült',
      scenario: { runnableOrActive: 1, stale: 1 },
      warn: 'beragadt job lezárva, de az új futás sorba állítása nem sikerült',
    },
    {
      eset: 'a lezárás is elbukott egy a korlát szerint elhalt soron',
      scenario: { runnableOrActive: 1, stale: 1, overdue: 1, releaseThrows: true },
      warn: 'a beragadt job-sor lezárása nem sikerült',
    },
  ])(
    'ha a sorba állítás is elbukik ($eset): csak az ütemezés hibájáról riaszt',
    async ({ scenario, warn }) => {
      const { run, queueCalls, entries } = createHarness({ ...scenario, queueThrows: true })

      await run()

      expect(queueCalls).toHaveLength(0)
      expect(
        entries.filter((entry) => entry.level === 'error').map((entry) => entry.context?.alertCode),
      ).toEqual(['utemezes-ellenorzes-hiba'])
      expect(entries).toContainEqual(
        expect.objectContaining({ level: 'warn', msg: expect.stringContaining(warn) }),
      )
    },
  )

  it('beragadt ÉS élő job → a beragadtat lezárja, nincs sorba állítás', async () => {
    const { run, queueCalls, entries, releaseStatements } = createHarness({
      runnableOrActive: 2,
      stale: 1,
    })

    const result = await run()

    expect(result.shouldSchedule).toBe(false)
    expect(queueCalls).toHaveLength(0)
    expect(releaseStatements).toHaveLength(1)
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
    expect(harness.releaseStatements).toHaveLength(3)
  })

  /**
   * A lezárás tartós hibája minden tickben előjön (az order-maintenance
   * queue-n 5 percenként, a webhook-maintenance-en percenként). A riasztása a
   * „zárt le" riasztással közös, 6 órás fojtáson osztozik: egy queue+task
   * párról 6 óránként egy levél megy, akármelyik eset történt.
   */
  it('a lezárás tartós hibája 6 órán belül egyszer riaszt, a „zárt le" riasztással közös fojtáson', async () => {
    const clock = { now: NOW }
    const failing = createHarness(
      { runnableOrActive: 1, stale: 1, overdue: 1, releaseThrows: true },
      clock,
    )

    await failing.run()
    clock.now = NOW + 5 * 60_000
    await failing.run()
    expect(failing.entries.filter((entry) => entry.level === 'error')).toHaveLength(1)

    // Egy közbeni sikeres lezárás a fojtási időn belül csak figyelmeztetés.
    const recovered = createHarness({ runnableOrActive: 1, stale: 1 }, clock)
    clock.now = NOW + 10 * 60_000
    await recovered.run()
    expect(recovered.entries.filter((entry) => entry.level === 'error')).toEqual([])
    expect(recovered.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ releasedJobs: 1 }),
      }),
    )

    clock.now = NOW + STUCK_JOB_ALERT_COOLDOWN_MS
    await failing.run()
    expect(
      failing.entries
        .filter((entry) => entry.level === 'error')
        .map((entry) => entry.context?.alertCode),
    ).toEqual(['beragadt-job-lezaras-sikertelen', 'beragadt-job-lezaras-sikertelen'])
  })

  /**
   * H1: a 15 percnél régebbi, de a lezárási korlátnál fiatalabb sor mögött még
   * élő futás lehet (például egy lassú Barion mellett 70 GetState). Az ilyen
   * sort az adatbázis nem zárja le, és a tulajdonos sem kaphat róla
   * „beragadt feladatot zárt le" riasztást; az ütemezés viszont nem áll meg.
   */
  it('lezáratlan régi sor → nincs riasztás, csak óránként egy figyelmeztetés, és sorba állít', async () => {
    const clock = { now: NOW }
    const harness = createHarness({ runnableOrActive: 1, stale: 1, released: 0 }, clock)

    await harness.run()
    clock.now = NOW + 5 * 60_000
    await harness.run()
    // Egy óra múlva a még mindig le nem zárható sorról újra szól.
    clock.now = NOW + 60 * 60_000 + 1
    await harness.run()

    // Az első tick sorba állít; a későbbiekben az új job már élőként blokkol.
    expect(harness.queueCalls).toHaveLength(1)
    expect(harness.entries.filter((entry) => entry.level === 'error')).toEqual([])
    const warnings = harness.entries.filter((entry) => entry.level === 'warn')
    expect(warnings).toHaveLength(2)
    for (const warning of warnings) {
      expect(warning.context).toMatchObject({
        queue: ORDER_MAINTENANCE_QUEUE,
        stuckJobs: 1,
        releaseAfterMs: STALE_JOB_RELEASE_AFTER_MS,
      })
    }
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
