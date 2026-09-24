import { BasePayload, type PayloadRequest, type SanitizedConfig, type Where } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ORDER_MAINTENANCE_QUEUE, WEBHOOK_RETRY_QUEUE } from '../../jobs/queues'
import configPromise from '../../payload.config'

/**
 * A VALÓDI `handleSchedules` az ÉLES configgal, ál-adatbázissal.
 * A `scheduling.test.ts` a config ALAKJÁT ellenőrzi (van-e `schedule`, egyezik-e
 * a queue és a cron). Az viszont ott NEM derül ki, hogy a Payload ütemezője
 * ténylegesen SORBA ÁLLÍTJA-e a jobot, és milyen értékekkel. Ez a fájl ezért a
 * Payload SAJÁT `handleSchedules` operációját futtatja le (payload/dist/queues/
 */

/** A stats-global slugja (payload/dist/queues/config/global.js). */
const JOB_STATS_GLOBAL_SLUG = 'payload-jobs-stats'

interface QueueCall {
  task?: string
  queue?: string
  meta?: unknown
  waitUntil?: Date
  input?: unknown
}

interface FakeDbOptions {
  /** „Fut vagy futtatható" jobok száma (a duplikátum-védelem alap-számlálása). */
  runnableOrActive?: number
  /** Ebből beragadt (processing: true + régen frissült). */
  stale?: number
}

interface Harness {
  payload: BasePayload
  req: PayloadRequest
  queueCalls: QueueCall[]
  countedWheres: Where[]
  globalWrites: string[]
  /** A beragadt sorok lezárásának feltételei (`db.updateJobs`). */
  releasedWheres: Where[]
}

/**
 * A beragadt-számlálás felismerése: az őr (src/jobs/schedule-guard.ts) a második
 * lekérdezésbe `processing` és `updatedAt` feltételt is tesz — a Payload
 * alapértelmezett számlálásában ilyen nincs.
 */
function isStaleCountQuery(where: Where): boolean {
  const conditions = Array.isArray(where.and) ? where.and : []
  return conditions.some((condition) => 'processing' in condition)
}

function createHarness(config: SanitizedConfig, options: FakeDbOptions = {}): Harness {
  const queueCalls: QueueCall[] = []
  const countedWheres: Where[] = []
  const globalWrites: string[] = []
  const releasedWheres: Where[] = []

  const db = {
    count: async ({ where }: { where: Where }) => {
      countedWheres.push(where)
      return {
        totalDocs: isStaleCountQuery(where)
          ? (options.stale ?? 0)
          : (options.runnableOrActive ?? 0),
      }
    },
    createGlobal: async ({ slug }: { slug: string }) => {
      globalWrites.push(slug)
      return {}
    },
    findGlobal: async ({ slug }: { slug: string }) => {
      globalWrites.push(`read:${slug}`)
      return undefined
    },
    updateGlobal: async ({ slug }: { slug: string }) => {
      globalWrites.push(slug)
      return {}
    },
    updateJobs: async ({ where }: { where: Where }) => {
      releasedWheres.push(where)
      return Array.from({ length: options.stale ?? 0 }, (_, index) => ({ id: index + 1 }))
    },
  }

  const payload = new BasePayload()
  payload.config = config
  payload.db = db as unknown as BasePayload['db']
  payload.jobs.queue = (async (args: QueueCall) => {
    queueCalls.push(args)
    return { id: queueCalls.length }
  }) as unknown as BasePayload['jobs']['queue']

  return {
    payload,
    req: { payload } as unknown as PayloadRequest,
    queueCalls,
    countedWheres,
    globalWrites,
    releasedWheres,
  }
}

/** Az éles config másolata, a saját `beforeSchedule` őr NÉLKÜL (negatív kontroll). */
function withDefaultScheduleHooks(config: SanitizedConfig): SanitizedConfig {
  return {
    ...config,
    jobs: {
      ...config.jobs,
      tasks: (config.jobs.tasks ?? []).map((task) => ({
        ...task,
        schedule: task.schedule?.map((entry) => {
          const withoutHooks = { ...entry }
          delete withoutHooks.hooks
          return withoutHooks
        }),
      })),
    },
  } as SanitizedConfig
}

let config: SanitizedConfig

beforeEach(async () => {
  config = await configPromise
  // CLAUDE.md 15.: tesztből SOSEM mehet ki valódi hálózati hívás.
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
  // Az ál-adatbázisnak nincs drizzle-példánya, tehát az advisory-zár
  // passthrough-figyelmeztetése itt zajként jelentkezne — elnyomva.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('handleSchedules — a VALÓDI Payload-ütemező az éles configgal', () => {
  it('az order-poll PONTOSAN EGYSZER kerül sorba, a helyes task/queue/meta értékekkel', async () => {
    const harness = createHarness(config, { runnableOrActive: 0 })

    const result = await harness.payload.jobs.handleSchedules({
      queue: ORDER_MAINTENANCE_QUEUE,
      req: harness.req,
    })

    expect(harness.queueCalls).toHaveLength(1)
    expect(harness.queueCalls[0]).toMatchObject({
      task: 'order-poll',
      queue: ORDER_MAINTENANCE_QUEUE,
      meta: { scheduled: true },
    })
    expect(harness.queueCalls[0].waitUntil).toBeInstanceOf(Date)
    // K4: a saját őr MAGA állítja sorba a jobot (a queueCalls a bizonyíték), és
    // shouldSchedule:false-t ad vissza — a handleSchedules ezért „skipped"-ként
    // könyveli a kört. Ez szándékos: így nem állíthatja sorba még egyszer.
    expect(result.queued).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.errored).toHaveLength(0)
  })

  it('a webhook-retry a saját queue-ján kerül sorba (a queue-szűrés működik)', async () => {
    const harness = createHarness(config, { runnableOrActive: 0 })

    await harness.payload.jobs.handleSchedules({
      queue: WEBHOOK_RETRY_QUEUE,
      req: harness.req,
    })

    expect(harness.queueCalls).toHaveLength(1)
    expect(harness.queueCalls[0]).toMatchObject({
      task: 'webhook-retry',
      queue: WEBHOOK_RETRY_QUEUE,
      meta: { scheduled: true },
    })
  })

  /**
   * Ez a séma-vonzat BIZONYÍTÉKA: a `handleSchedules` a stats-globalt olvassa,
   * az `afterSchedule` pedig írja. A `payload_jobs_stats` tábla nélkül tehát a
   * cron-tick az első lépésén elhasalna — és mivel a tick ELŐBB ütemez, csak
   * UTÁNA futtat, a ma működő esemény-vezérelt jobok is leállnának.
   */
  it('a stats-globalt olvassa ÉS írja (ezért kell hozzá a payload_jobs_stats tábla)', async () => {
    const harness = createHarness(config, { runnableOrActive: 0 })

    await harness.payload.jobs.handleSchedules({
      queue: ORDER_MAINTENANCE_QUEUE,
      req: harness.req,
    })

    expect(harness.globalWrites).toContain(`read:${JOB_STATS_GLOBAL_SLUG}`)
    expect(harness.globalWrites).toContain(JOB_STATS_GLOBAL_SLUG)
  })

  it('ÉLŐ (nem beragadt) job blokkol — nem lesz duplikátum', async () => {
    const harness = createHarness(config, { runnableOrActive: 1, stale: 0 })

    const result = await harness.payload.jobs.handleSchedules({
      queue: ORDER_MAINTENANCE_QUEUE,
      req: harness.req,
    })

    expect(harness.queueCalls).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
  })
})

describe('handleSchedules — beragadt job (a néma leállás elleni védelem)', () => {
  it('a beragadt job NEM kapcsolja ki az ütemezést: a jobot így is sorba állítjuk', async () => {
    const harness = createHarness(config, { runnableOrActive: 1, stale: 1 })

    const result = await harness.payload.jobs.handleSchedules({
      queue: ORDER_MAINTENANCE_QUEUE,
      req: harness.req,
    })

    expect(harness.queueCalls).toHaveLength(1)
    expect(harness.queueCalls[0]).toMatchObject({ task: 'order-poll' })
    // K4: a sorba állítás a hookban történt — a visszatérési listában „skipped".
    expect(result.queued).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    // Az őr tényleg megnézte a beragadást (második, `processing`-re szűrt számolás).
    expect(harness.countedWheres.filter(isStaleCountQuery)).toHaveLength(1)
    // …és a beragadt sort le is zárta, csak a beragadtakra szűrve (a-callback-2).
    expect(harness.releasedWheres).toHaveLength(1)
    expect(isStaleCountQuery(harness.releasedWheres[0] ?? {})).toBe(true)
  })

  /**
   * NEGATÍV KONTROLL — a Payload ALAPÉRTELMEZETT hookjával (a sajátunk nélkül)
   * UGYANEZ a beragadt sor kikapcsolja az ütemezést. Ez mutatja meg, hogy az őr
   * nem díszlet: nélküle egyetlen elhalt job VÉGLEGESEN és NÉMÁN megállítaná a
   * periodikus jobokat.
   */
  it('a saját őr NÉLKÜL ugyanez a beragadt job végleg blokkolna (negatív kontroll)', async () => {
    const harness = createHarness(withDefaultScheduleHooks(config), {
      runnableOrActive: 1,
      stale: 1,
    })

    const result = await harness.payload.jobs.handleSchedules({
      queue: ORDER_MAINTENANCE_QUEUE,
      req: harness.req,
    })

    expect(harness.queueCalls).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    // Az alapértelmezett hook a beragadást meg sem nézi.
    expect(harness.countedWheres.filter(isStaleCountQuery)).toHaveLength(0)
  })
})
