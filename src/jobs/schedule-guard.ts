import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
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
 * sorba állítana). Két küszöb van: a `STALE_SCHEDULED_JOB_MS`-nél régebbi
 * `processing` sor már nem akadályozza az új futást (ha csak ilyen blokkolt,
 * ütemezünk, ha van élő job is, nem), lezárni (`processing: false`,
 * `hasError: true`, `error`) viszont csak a `STALE_JOB_RELEASE_AFTER_MS`-nél
 * régebbit szabad, feltételes írással; a lezárásról EGY fojtott riasztás megy.
 * Ha a lezárás hibára fut, tulajdonosi riasztás csak a korlátnál régebbi,
 * biztosan elhalt sorról szól, és nem állítja, hogy bármit lezárt.
 * `meta.scheduled` szűrés szándékosan nincs.
 */

type ScheduleEntry = NonNullable<TaskConfig['schedule']>[number]
type BeforeScheduleHook = NonNullable<NonNullable<ScheduleEntry['hooks']>['beforeSchedule']>

/** A Payload jobs-collection slugja (payload/dist/queues/config/collection.js). */
const JOBS_COLLECTION_SLUG = 'payload-jobs'

/**
 * Ennyi idő után már nem várunk egy `processing: true` sorra: ha más élő vagy
 * várakozó job nincs, mellette új futás kerül sorba. A sort ez még NEM zárja
 * le (lásd `STALE_JOB_RELEASE_AFTER_MS`), tehát élő futásba nem ír bele.
 *
 * A 15 perc csak folyamatok közötti heurisztika, nem biztonsági korlát. Egy
 * folyamaton belül az élő futást a Payload autoRun-cronja védi: a
 * `handleSchedules` és a `jobs.run` ugyanabban a croner-callbackben fut
 * `protect: true` mellett (payload/dist/index.js, `_initializeCrons`), így az
 * őr a saját folyamata futó jobját sosem látja. Élő sort egy másik futtatás
 * akkor láthat, ha (1) deploy közben a régi és az új konténer átfed, (2) a
 * stáb a /api/payload-jobs/run vagy /handle-schedules végpontot hívja (a
 * kérésen belül fut, croner-védelem nélkül), (3) a numReplicas 1 fölé megy.
 * Az order-poll 15 percnél tovább is futhat (lásd lent), ilyenkor két futás
 * mehet egymás mellett. Ez biztonságos: a fizetés-átmenet, a státuszírás és a
 * visszatérítés rendelésenkénti advisory-zár alatt, feltételes írással fut,
 * tehát egy rendelés csak egyszer vált állapotot. A 15 perc azt adja, hogy egy
 * újraindítás által megölt futás után az ütemezés legfeljebb ennyi ideig (és
 * a következő cron-tickig) álljon.
 */
export const STALE_SCHEDULED_JOB_MS = 15 * 60 * 1000

/**
 * Egy `processing: true` sort csak ennyivel a futás kezdete után zárunk le.
 * A Payload a sort a felvételkor írja (`processing: true` + `updatedAt`),
 * futás közben nem frissíti (a task-napló `$push`-a `updatedAt: null`-lal
 * megy, payload/dist/queues/operations/runJobs/runJob/getRunTaskFunction.js),
 * a végén pedig `completedAt`-et ír. Az `updatedAt` tehát a futás kezdete.
 *
 * A korlát a leghosszabb ütemezett task, az order-poll legrosszabb
 * futásidejéből jön, minden külső hívást a saját időkorlátjával számolva:
 * - GetState: legfeljebb 25 × 2 függő (ORDER_POLL_BATCH_SIZE, egy pótlap) és
 *   10 × 2 késői-siker rendelés (LATE_SUCCESS_BATCH_SIZE, egy pótlap), azaz 70
 *   hívás × 15 s (BARION_GET_TIMEOUT_MS; a GET-et ez korlátozza, nem a 35 s-os
 *   BARION_TIMEOUT_MS) = 17,5 perc. A lassú, de sikeres válasz nullázza a
 *   hibaféket, tehát mind a 70 lefuthat.
 * - Rendelésenként legfeljebb egy mellékhatás: paid-átmenetnél a visszaigazoló
 *   levél 3 próbálkozás × 10 s Resend-timeout + 2 s + 6 s várakozás = 38 s,
 *   elutasított fizetésnél egy Refund POST, legfeljebb 35 s. 70 × 38 s ≈ 44 perc.
 * - A futás vége (számla-resweep, napi összesítő, életjel-ping): ≈ 1 perc.
 * Ez ≈ 63 perc; a webhook-retry (25 esemény × (15 s + 38 s)) ≈ 22 perc. A 2 óra
 * ennek közel kétszerese. A tartalék azt fedi, amit a számítás kihagy: a
 * rendelésenkénti advisory-zárra és a többi adatbázis-utasításra várakozást
 * (mindegyiket csak a 30 s-os statement_timeout korlátozza), valamint a
 * paid-reject ág Refund POST-on túli lépéseit (visszatérítési szándék és
 * nyugták írása). Ez tehát modell, nem kemény korlát: kemény korlátot csak a
 * pollPendingOrders falióra-kerete adna (ilyen még nincs). Ha a batch-méret, a
 * pótlapok száma vagy egy timeout nő, ezt is emelni kell. Egy téves lezárás
 * következménye kozmetikai: a még futó sor `hasError` jelölést kap, és egy
 * fojtott riasztás megy róla, de a futás nem szakad meg (az `error` nem
 * `cancelled`, így a Payload nem dob JobCancelledError-t).
 *
 * Az ára: egy újraindítás által megölt futás sora legfeljebb 2 óráig
 * `processing: true` marad. Az ütemezést ez nem akasztja meg (lásd
 * `STALE_SCHEDULED_JOB_MS`), csak a lezárás és a róla szóló riasztás késik.
 */
export const STALE_JOB_RELEASE_AFTER_MS = 2 * 60 * 60 * 1000

/** A beragadt-job riasztás fojtása queue+task párra (6 óra). */
export const STUCK_JOB_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000

/** Az ütemezés-ellenőrzés hibájának riasztás-fojtása (1 óra). */
export const SCHEDULE_CHECK_ALERT_COOLDOWN_MS = 60 * 60 * 1000

/** A régóta futó, még le nem zárható sorról szóló figyelmeztetés fojtása (1 óra). */
const LONG_RUNNING_JOB_WARN_COOLDOWN_MS = 60 * 60 * 1000

/** Egy tickben legfeljebb ennyi beragadt sort zárunk le. */
export const MAX_RELEASED_JOBS_PER_TICK = 10

/** A lezárt sor `error` mezőjének üzenete (a job-sorban olvasható). */
export const STALE_JOB_RELEASE_MESSAGE =
  'A futás beragadt (processing: true, régóta nem frissült, jellemzően egy újraindítás ' +
  'szakította meg). A schedule-guard lezárta, hogy az ütemezés helyreálljon.'

export interface StaleAwareBeforeScheduleOptions {
  /** A task slugja — csak az ehhez tartozó jobokat számoljuk. */
  taskSlug: string
  /** Az ütemezési küszöb (teszthez felülírható); a lezárási korlát nem az. */
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

/** A Payload postgres-adapterének drizzle-példánya (`payload.db.drizzle`). */
interface SqlExecutor {
  execute(query: SQL): Promise<unknown>
}

function resolveExecutor(req: PayloadRequest): SqlExecutor {
  const candidate = (req.payload.db as unknown as { drizzle?: unknown } | undefined)?.drizzle
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as { execute?: unknown }).execute !== 'function'
  ) {
    throw new Error('a payload.db.drizzle nem érhető el, a beragadt sor nem zárható le')
  }
  return candidate as SqlExecutor
}

/**
 * A legrosszabb futásidőnél régebben felvett sorok lezárása EGYETLEN
 * feltételes UPDATE-tel.
 *
 * A Payload saját `db.updateJobs`-a nem feltételes írás: előbb kiválaszt,
 * majd azonosító szerint ír. Ha a sor a kettő között befejeződik, a
 * `hasError: true` a már kész sorra kerülne. Itt a jelölt sorokat a
 * `FOR UPDATE SKIP LOCKED` zárolja: a Postgres a zárolt sor legfrissebb
 * változatán újraértékeli a feltételt, a más által épp írt sort pedig
 * kihagyja (az a futó munka jele, és nem várunk rá). Ami közben befejeződött
 * (`completed_at`), elvesztette a `processing`-et vagy hibát kapott, azt a
 * feltétel kizárja. A `hasError: true` sort a Payload nem futtatja újra, az
 * `error` pedig kiveszi a blokkoló-számlálásból.
 */
async function releaseDeadJobs(
  req: PayloadRequest,
  queue: string,
  taskSlug: string,
  releaseBeforeIso: string,
  nowMs: number,
): Promise<number> {
  const nowIso = new Date(nowMs).toISOString()
  const error = JSON.stringify({
    message: STALE_JOB_RELEASE_MESSAGE,
    releasedBy: 'schedule-guard',
    releasedAt: nowIso,
  })
  const result = await resolveExecutor(req).execute(sql`UPDATE "payload_jobs"
    SET "processing" = false, "has_error" = true, "error" = ${error}::jsonb,
      "updated_at" = ${nowIso}
    WHERE "id" IN (
      SELECT "id" FROM "payload_jobs"
      WHERE "queue" = ${queue} AND "task_slug"::text = ${taskSlug}
        AND "processing" = true AND "completed_at" IS NULL AND "error" IS NULL
        AND "updated_at" < ${releaseBeforeIso}
      ORDER BY "updated_at"
      LIMIT ${MAX_RELEASED_JOBS_PER_TICK}
      FOR UPDATE SKIP LOCKED
    )
      AND "processing" = true AND "completed_at" IS NULL AND "error" IS NULL
    RETURNING "id"`)
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? rows.length : 0
}

/**
 * A beragadt-job téma fojtási kulcsa. A lezárásról és a lezárás hibájáról
 * szóló riasztás ugyanezen osztozik: egy queue+task párról 6 óránként egy
 * levél megy, akármelyik eset történt.
 */
function stuckJobAlertKey(queue: string, taskSlug: string): string {
  return `beragadt-job:${queue}:${taskSlug}`
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
    releaseAfterMs: STALE_JOB_RELEASE_AFTER_MS,
  }
  if (
    shouldEmitThrottledAlert(
      stuckJobAlertKey(facts.queue, facts.taskSlug),
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

/**
 * A lezárás hibára futott, tehát semmit nem zárt le: „zárt le" riasztás nem
 * mehet. A lezárási korlátnál fiatalabb sor mögött élő futás lehet, róla csak
 * a hívó figyelmeztetése szól. Tulajdonosi riasztás akkor megy, ha van a
 * korlátnál régebbi, tehát biztosan elhalt sor, és azt sem sikerült lezárni:
 * ez a lezárás tartós hibájának jele lehet (például elromlott a lezáró SQL).
 * Ennek a számolásnak a hibája sem állíthatja meg az ütemezést.
 */
async function reportFailedRelease(
  req: PayloadRequest,
  log: Logger,
  facts: {
    queue: string
    taskSlug: string
    stuckJobs: number
    liveJobs: number
    nowMs: number
    releaseBeforeIso: string
    error: string
  },
): Promise<void> {
  let overdueJobs: number
  try {
    overdueJobs = await countJobs(
      req,
      staleWhere(facts.queue, facts.taskSlug, facts.releaseBeforeIso),
    )
  } catch (error) {
    log.warn('a lezárási korlátnál régebbi job-sorok száma nem olvasható', {
      queue: facts.queue,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  if (
    overdueJobs === 0 ||
    !shouldEmitThrottledAlert(
      stuckJobAlertKey(facts.queue, facts.taskSlug),
      STUCK_JOB_ALERT_COOLDOWN_MS,
      facts.nowMs,
    )
  ) {
    return
  }
  emitAlert(
    log,
    ALERT_CODES.beragadtJobLezarasSikertelen,
    'RIASZTÁS: egy beragadt háttérfeladat lezárása nem sikerült. Az ütemezés ettől még ' +
      'működik, a rendszer a következő körökben ismét megpróbálja a lezárást. Teendő csak ' +
      'akkor van, ha ez a riasztás újra megjön: ilyenkor szólj a fejlesztőnek, a Railway ' +
      'naplójában (@alertCode:beragadt-job-lezaras-sikertelen) látszik, mi akadályozza.',
    {
      queue: facts.queue,
      stuckJobs: facts.stuckJobs,
      overdueJobs,
      runnableOrActiveJobs: facts.stuckJobs + facts.liveJobs,
      releaseAfterMs: STALE_JOB_RELEASE_AFTER_MS,
      error: facts.error,
    },
  )
}

/**
 * A régi, de a lezárási korlátnál még fiatalabb sor: lehet élő futás, ezért
 * nem nyúlunk hozzá, és a tulajdonosnak sem riasztunk. Fojtott figyelmeztetés,
 * mert a sor a lezárásig minden tickben látszik.
 */
function reportLongRunningJobs(
  log: Logger,
  facts: { queue: string; taskSlug: string; stuckJobs: number; liveJobs: number; nowMs: number },
): void {
  if (
    !shouldEmitThrottledAlert(
      `hosszan-futo-job:${facts.queue}:${facts.taskSlug}`,
      LONG_RUNNING_JOB_WARN_COOLDOWN_MS,
      facts.nowMs,
    )
  ) {
    return
  }
  log.warn(
    'régóta futó vagy elhalt job: a sort még nem zárjuk le, mert futhat; az ütemezést nem akasztja meg',
    {
      queue: facts.queue,
      stuckJobs: facts.stuckJobs,
      runnableOrActiveJobs: facts.stuckJobs + facts.liveJobs,
      releaseAfterMs: STALE_JOB_RELEASE_AFTER_MS,
    },
  )
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
            const nowMs = now()
            const staleBeforeIso = new Date(nowMs - staleAfterMs).toISOString()
            const stale = await countJobs(req, staleWhere(queue, taskSlug, staleBeforeIso))
            if (stale === 0) {
              // Élő job — ez a helyes duplikátum-védelem (a zár miatt a
              // számlálás a PÁRHUZAMOS példány sorba állítását is látja).
              return skip
            }
            // A beragadt sort a Payload soha nem veszi fel újra (csak
            // `processing: false` jobot futtat), tehát magától sosem tűnik el.
            // Lezárni (`processing: false` + `hasError: true` + `error`) csak
            // a legrosszabb futásidőn túlit szabad: a fiatalabb mögött még élő
            // futás lehet. A lezárt sor a következő tickben már nem blokkol,
            // és a riasztás sem ismétlődik minden tickben (a-callback-2).
            const releaseBeforeIso = new Date(nowMs - STALE_JOB_RELEASE_AFTER_MS).toISOString()
            let released = 0
            let releaseError: string | undefined
            try {
              released = await releaseDeadJobs(req, queue, taskSlug, releaseBeforeIso, nowMs)
            } catch (error) {
              // A lezárás hibája nem állíthatja meg az ütemezést: a sorba
              // állítás a beragadt sor mellett így is megtörténik.
              releaseError = error instanceof Error ? error.message : String(error)
              log.warn('a beragadt job-sor lezárása nem sikerült, a következő tick újrapróbálja', {
                queue,
                error: releaseError,
              })
            }
            const facts = { queue, taskSlug, stuckJobs: stale, liveJobs: blocking - stale, nowMs }
            if (released > 0) {
              reportReleasedJobs(log, { ...facts, releasedJobs: released })
            } else if (releaseError !== undefined) {
              await reportFailedRelease(req, log, {
                ...facts,
                releaseBeforeIso,
                error: releaseError,
              })
            } else {
              reportLongRunningJobs(log, facts)
            }
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
