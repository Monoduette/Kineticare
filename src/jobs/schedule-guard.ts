import type { PayloadRequest, TaskConfig, Where } from 'payload'

import { withAdvisoryLock } from '../lib/advisory-lock'
import { shouldEmitThrottledAlert } from '../lib/alert-throttle'
import { ALERT_CODES } from '../lib/alerts/classify'
import { emitAlert } from '../lib/alerts/emit'
import { logger as rootLogger, type Logger } from '../lib/logger'

/**
 * Periodikus task `beforeSchedule` őre: beragadt `processing` job ne némítsa
 * az ütemezést, és két példány ne állítson sorba kétszer.
 *
 * A számolás + `jobs.queue` advisory-zár alatt fut; a Payload felé mindig
 * `shouldSchedule: false` megy vissza (különben a handleSchedules még egyszer
 * sorba állítana). A beragadt (stale) sort lezárjuk (`processing: false`,
 * `hasError: true`, `error`), és EGY fojtott riasztás megy róla; ha csak
 * beragadt job blokkolt, ütemezünk, ha van élő job is, nem. `meta.scheduled`
 * szűrés szándékosan nincs.
 */

type ScheduleEntry = NonNullable<TaskConfig['schedule']>[number]
type BeforeScheduleHook = NonNullable<NonNullable<ScheduleEntry['hooks']>['beforeSchedule']>

/** A Payload jobs-collection slugja (payload/dist/queues/config/collection.js). */
const JOBS_COLLECTION_SLUG = 'payload-jobs'

/**
 * Ennyi tétlenség után tekintünk egy `processing: true` jobot beragadtnak.
 *
 * 15 perc: a leghosszabb futású periodikus task (order-poll) legrosszabb esetben
 * 25 Barion-hívást végez, egyenként max. 15 mp-es timeouttal (BARION_TIMEOUT_MS
 * alapértelmezése), tehát ~6 perc a felső korlátja; a webhook-retry ennél
 * nagyságrenddel rövidebb. A 15 perc így bő kétszeres tartalék: élő futást nem
 * minősít beragadtnak, de egy elhalt sor legkésőbb 15 perc múlva feloldódik.
 */
export const STALE_SCHEDULED_JOB_MS = 15 * 60 * 1000

/** A beragadt-job riasztás fojtása queue+task párra (6 óra). */
export const STUCK_JOB_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000

/** Az ütemezés-ellenőrzés hibájának riasztás-fojtása (1 óra). */
export const SCHEDULE_CHECK_ALERT_COOLDOWN_MS = 60 * 60 * 1000

/** Egy tickben legfeljebb ennyi beragadt sort zárunk le. */
export const MAX_RELEASED_JOBS_PER_TICK = 10

/** A lezárt sor `error` mezőjének üzenete (a job-sorban olvasható). */
export const STALE_JOB_RELEASE_MESSAGE =
  'A futás beragadt (processing: true, régóta nem frissült, jellemzően egy újraindítás ' +
  'szakította meg). A schedule-guard lezárta, hogy az ütemezés helyreálljon.'

export interface StaleAwareBeforeScheduleOptions {
  /** A task slugja — csak az ehhez tartozó jobokat számoljuk. */
  taskSlug: string
  /** Beragadási küszöb (teszthez felülírható). */
  staleAfterMs?: number
  /** Injektálható logger (teszthez); alapból a projekt gyökér-loggere. */
  logger?: Logger
  /** Injektálható óra (teszthez). */
  now?: () => number
}

/** „Fut vagy futtatható" job ugyanerre a taskra ugyanebben a queue-ban. */
function runnableOrActiveWhere(queue: string, taskSlug: string): Where {
  return {
    and: [
      { queue: { equals: queue } },
      { taskSlug: { equals: taskSlug } },
      { completedAt: { exists: false } },
      { error: { exists: false } },
    ],
  }
}

/** A fentiek közül a beragadtak: `processing: true` és régen frissült. */
function staleWhere(queue: string, taskSlug: string, staleBeforeIso: string): Where {
  return {
    and: [
      ...(runnableOrActiveWhere(queue, taskSlug).and ?? []),
      { processing: { equals: true } },
      { updatedAt: { less_than: staleBeforeIso } },
    ],
  }
}

async function countJobs(req: PayloadRequest, where: Where): Promise<number> {
  const result = await req.payload.db.count({
    collection: JOBS_COLLECTION_SLUG,
    req,
    where,
  })
  return result.totalDocs
}

/**
 * A beragadt sorok lezárása ugyanazzal a DB-hívással, amellyel a Payload a
 * saját job-sorait írja (`payload.db.updateJobs`, lásd
 * payload/dist/queues/utilities/updateJob.js). A `hasError: true` sort a
 * Payload nem futtatja újra („If hasError is true this job will not be
 * retried", a jobs-collection mezőleírása), az `error` pedig kiveszi a
 * blokkoló-számlálásból.
 */
async function releaseStaleJobs(
  req: PayloadRequest,
  queue: string,
  taskSlug: string,
  staleBeforeIso: string,
  nowMs: number,
): Promise<number> {
  const updated = await req.payload.db.updateJobs({
    where: staleWhere(queue, taskSlug, staleBeforeIso),
    data: {
      processing: false,
      hasError: true,
      error: {
        message: STALE_JOB_RELEASE_MESSAGE,
        releasedBy: 'schedule-guard',
        releasedAt: new Date(nowMs).toISOString(),
      },
    },
    limit: MAX_RELEASED_JOBS_PER_TICK,
    req,
  })
  return Array.isArray(updated) ? updated.length : 0
}

/**
 * EGY fojtott riasztás a lezárásról. A lezárás után a sor nem blokkol, tehát
 * a riasztás nem ismétlődik minden tickben; a fojtás a sorozatos újraindítások
 * idejére is egy levélre korlátoz. A szöveg olyan helyet nevez meg, amit a
 * tulajdonos el is ér (a payload-jobs lista az adminban rejtett).
 */
function reportReleasedJobs(
  log: Logger,
  facts: {
    queue: string
    taskSlug: string
    stuckJobs: number
    releasedJobs: number
    liveJobs: number
    nowMs: number
  },
): void {
  const context = {
    queue: facts.queue,
    stuckJobs: facts.stuckJobs,
    releasedJobs: facts.releasedJobs,
    runnableOrActiveJobs: facts.stuckJobs + facts.liveJobs,
  }
  if (
    shouldEmitThrottledAlert(
      `beragadt-job:${facts.queue}:${facts.taskSlug}`,
      STUCK_JOB_ALERT_COOLDOWN_MS,
      facts.nowMs,
    )
  ) {
    emitAlert(
      log,
      ALERT_CODES.beragadtJob,
      'RIASZTÁS: beragadt háttérfeladatot zárt le a rendszer, az ütemezés helyreállt. Teendő ' +
        'csak akkor van, ha ez naponta többször előfordul: ilyenkor a Railway naplójában ' +
        '(@alertCode:beragadt-job) látszik, melyik feladat akadt el, és szólj a fejlesztőnek.',
      context,
    )
    return
  }
  log.warn('beragadt job lezárva (a riasztás a fojtási időn belül már kiment)', context)
}

/** A schedule-zár kulcsa: egy queue+task párra egy zár (K4). */
export function scheduleLockKey(queue: string, taskSlug: string): string {
  return `schedule:${queue}:${taskSlug}`
}

/**
 * A `payload.jobs.queue` minimális, szerkezeti felülete — a TypedJobs a
 * konsolidációs loopig nem feltétlen ismeri az összes taskot, ezért a hívás
 * strukturálisan típusozott (az order-paid.ts JobsQueueLike-mintája).
 */
type JobsQueueLike = {
  queue?: (args: {
    task: string
    input?: Record<string, unknown>
    queue?: string
    waitUntil?: Date
    meta?: Record<string, unknown>
  }) => Promise<unknown>
}

/**
 * A tényleges sorba állítás — a zár alatt hívva. Pontosan azokkal az
 * értékekkel, amelyekkel a Payload `scheduleQueueable`-je dolgozna
 * (`meta.scheduled: true`, a cron-tick `waitUntil`-je).
 */
async function queueScheduledJob(
  req: PayloadRequest,
  queue: string,
  taskSlug: string,
  waitUntil: Date | undefined,
): Promise<void> {
  const jobs = (req.payload as unknown as { jobs?: JobsQueueLike }).jobs
  if (typeof jobs?.queue !== 'function') {
    throw new Error('a payload.jobs.queue nem érhető el — a job nem állítható sorba')
  }
  await jobs.queue({
    task: taskSlug,
    input: {},
    queue,
    ...(waitUntil ? { waitUntil } : {}),
    meta: { scheduled: true },
  })
}

/**
 * A `TaskConfig.schedule[].hooks.beforeSchedule` hook gyártása egy taskra.
 * A visszaadott függvény TELJESEN kiváltja a Payload `defaultBeforeSchedule`-jét,
 * és — a K4 versenyablak bezárásához — a sorba állítást is MAGA végzi, a
 * számolással EGY advisory-zárban. A Payload felé ezért mindig
 * `shouldSchedule: false` tér vissza (a handleSchedules már nem queue-ol).
 */
export function createStaleAwareBeforeSchedule(
  options: StaleAwareBeforeScheduleOptions,
): BeforeScheduleHook {
  const { taskSlug } = options
  const staleAfterMs = options.staleAfterMs ?? STALE_SCHEDULED_JOB_MS
  const now = options.now ?? (() => Date.now())
  const log = (options.logger ?? rootLogger).child({ module: 'jobs/schedule', taskSlug })

  return async ({ queueable, req }) => {
    const queue = queueable.scheduleConfig.queue
    const skip = { input: {}, shouldSchedule: false } as const

    try {
      return await withAdvisoryLock(
        req.payload,
        scheduleLockKey(queue, taskSlug),
        async () => {
          const blocking = await countJobs(req, runnableOrActiveWhere(queue, taskSlug))
          if (blocking > 0) {
            const staleBeforeIso = new Date(now() - staleAfterMs).toISOString()
            const stale = await countJobs(req, staleWhere(queue, taskSlug, staleBeforeIso))
            if (stale === 0) {
              // Élő job — ez a helyes duplikátum-védelem (a zár miatt a
              // számlálás a PÁRHUZAMOS példány sorba állítását is látja).
              return skip
            }
            // A beragadt sort a Payload soha nem veszi fel újra (csak
            // `processing: false` jobot futtat), tehát magától sosem tűnik el.
            // Lezárjuk: `processing: false` + `hasError: true` + `error`, így a
            // következő tick már nem látja blokkolónak, és a riasztás sem
            // ismétlődik minden tickben (a-callback-2).
            let released = 0
            try {
              released = await releaseStaleJobs(req, queue, taskSlug, staleBeforeIso, now())
            } catch (error) {
              // A lezárás hibája nem állíthatja meg az ütemezést: a régi
              // viselkedés (sorba állítás a beragadt sor mellett) marad.
              log.warn('a beragadt job-sor lezárása nem sikerült, a következő tick újrapróbálja', {
                queue,
                error: error instanceof Error ? error.message : String(error),
              })
            }
            reportReleasedJobs(log, {
              queue,
              taskSlug,
              stuckJobs: stale,
              releasedJobs: released,
              liveJobs: blocking - stale,
              nowMs: now(),
            })
            if (stale < blocking) {
              // Él mellette egy futás is: az viszi tovább a munkát.
              return skip
            }
          }

          // A sorba állítás A ZÁRON BELÜL történik: a versenyző példány a zárra
          // vár, és a fenti számlálásnál már ezt a jobot is látja → kiszáll.
          await queueScheduledJob(req, queue, taskSlug, queueable.waitUntil)
          log.info('ütemezett job sorba állítva (schedule-zár alatt)', { queue })
          return skip
        },
        log,
      )
    } catch (error) {
      // Zárt irányba tévedünk: inkább kimarad egy kör, mint hogy duplikátum
      // keletkezzen. A következő cron-tick úgyis újrapróbálja. A riasztás
      // fojtott: egy adatbázis-kimaradás alatt percenként ismétlődne.
      const context = { queue, error: error instanceof Error ? error.message : String(error) }
      if (
        shouldEmitThrottledAlert(
          `utemezes-ellenorzes-hiba:${queue}:${taskSlug}`,
          SCHEDULE_CHECK_ALERT_COOLDOWN_MS,
          now(),
        )
      ) {
        emitAlert(
          log,
          ALERT_CODES.utemezesEllenorzesHiba,
          'RIASZTÁS: a job-ütemezés duplikátum-ellenőrzése nem futott le, ebben a körben nem ' +
            'indul új futás. Ha óránál tovább tart, az adatbázis-kapcsolatot kell megnézni ' +
            '(Railway, Postgres-c8Rg szolgáltatás).',
          context,
        )
      } else {
        log.warn(
          'a job-ütemezés duplikátum-ellenőrzése most sem futott le (a riasztás már kiment)',
          context,
        )
      }
      return skip
    }
  }
}
