import { Cron } from 'croner'
import type { JobsConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildJobsConfig } from '../../jobs'
import {
  ORDER_MAINTENANCE_CRON,
  ORDER_MAINTENANCE_QUEUE,
  ORDER_POLL_QUEUE,
  WEBHOOK_RETRY_CRON,
  WEBHOOK_RETRY_QUEUE,
} from '../../jobs/queues'
import configPromise from '../../payload.config'

/**
 * JOB-ÜTEMEZÉS REGRESSZIÓS KAPU.
 * A `jobs.autoRun` ÖNMAGÁBAN nem állít sorba egyetlen jobot sem. A rendszer
 * hetekig „zölden" futott úgy, hogy az order-poll és a webhook-retry task
 * SOHA nem futott le: a kódban egyedül az invoice-issue / storno-issue /
 * corrective-invoice-issue került valaha sorba (src/lib/order-paid.ts,
 */

/** Ezeknek a taskoknak PERIODIKUSAN futniuk KELL — enélkül pénz veszik el. */
const REQUIRED_SCHEDULED_TASKS = ['order-poll', 'webhook-retry'] as const

/**
 * Ezeket a taskokat TUDATOSAN nem ütemezzük: eseményre (fizetés lezárása,
 * visszatérítés) állítja sorba őket a kód a `payload.jobs.queue`-val.
 * Ha új task kerül a configba, ez a lista bukik — a fejlesztőnek DÖNTENIE
 * kell, hogy ütemezett vagy esemény-vezérelt.
 */
const EVENT_DRIVEN_TASKS = ['invoice-issue', 'storno-issue', 'corrective-invoice-issue'] as const

type TaskLike = NonNullable<JobsConfig['tasks']>[number]

interface AutorunEntryLike {
  allQueues?: boolean
  cron?: string
  disableScheduling?: boolean
  queue?: string
}

interface SchedulingGap {
  task: string
  reason: string
}

function taskBySlug(config: JobsConfig, slug: string): TaskLike | undefined {
  return config.tasks?.find((task) => task.slug === slug)
}

/**
 * A Payload szanitizálásának TÜKRE (sanitize.js, lásd a fejléc 2. pontját):
 * `config.jobs.scheduling` pontosan akkor lesz igaz, ha van legalább egy
 * `schedule`-lel rendelkező task. A tükröt csak a NEGATÍV kontrollhoz
 * használjuk (mutált configon nem tudunk valódi szanitizálást futtatni); az
 * ép configra a Payload SAJÁT számítását ellenőrizzük lentebb.
 */
function payloadWouldEnableScheduling(config: JobsConfig): boolean {
  return Boolean(config.tasks?.some((task) => task.schedule))
}

/**
 * Egy cron LEGSŰRŰBB tüzelési köze ezredmásodpercben.
 *
 * A `croner` a Payload SAJÁT cron-motorja (a `handleSchedules` és az
 * `_initializeCrons` is ezt használja), ezért a ritmust ugyanazzal a
 * szemantikával mérjük, mint amivel élesben tüzelni fog — nem saját
 * cron-értelmezővel. Fix kezdőpont: az eredmény determinisztikus.
 */
function minIntervalMs(cron: string): number {
  const runs = new Cron(cron, { sloppyRanges: true }).nextRuns(
    24,
    new Date('2026-01-01T00:00:00Z'),
  )
  let min = Number.POSITIVE_INFINITY
  for (let index = 1; index < runs.length; index += 1) {
    min = Math.min(min, runs[index].getTime() - runs[index - 1].getTime())
  }
  return min
}

/**
 * A teljes ütemezési lánc ellenőrzése EGY configon. Üres tömb = minden
 * kötelezően periodikus task ténylegesen sorba fog kerülni.
 *
 * Az utolsó szabály NEM „azonos cron", hanem „a schedule nem SŰRŰBB, mint az
 * autoRun-tick". Ez a valódi Payload-korlát: a sorba állítás kizárólag az
 * autoRun-cron tickjén történik meg, tehát egy sűrűbb schedule-cron nem tud
 * gyakrabban tüzelni — a szándék és a valóság csendben szétcsúszna. A RITKÁBB
 * schedule viszont teljesen legitim (pl. ugyanazon a queue-n egy napi task),
 * ezért azt nem tekintjük résnek: a korábbi „azonos cron" szabály itt épített
 * volna be egy jövőbeli hamis bukást.
 */
function findSchedulingGaps(config: JobsConfig, requiredSlugs: readonly string[]): SchedulingGap[] {
  const gaps: SchedulingGap[] = []

  if (!Array.isArray(config.autoRun)) {
    return requiredSlugs.map((task) => ({
      task,
      reason: 'nincs autoRun — a handleSchedules-t semmi nem indítja el',
    }))
  }
  const autoRunEntries = config.autoRun as AutorunEntryLike[]

  for (const slug of requiredSlugs) {
    const task = taskBySlug(config, slug)
    if (!task) {
      gaps.push({ task: slug, reason: 'a task nincs a jobs.tasks listában' })
      continue
    }
    const schedules = task.schedule ?? []
    if (schedules.length === 0) {
      gaps.push({ task: slug, reason: 'nincs schedule — semmi nem állítja sorba a jobot' })
      continue
    }

    for (const schedule of schedules) {
      const covering = autoRunEntries.find(
        (entry) => entry.allQueues === true || entry.queue === schedule.queue,
      )
      if (!covering) {
        gaps.push({
          task: slug,
          reason: `a schedule queue-ja ('${schedule.queue}') egyetlen autoRun-entryben sem szerepel`,
        })
        continue
      }
      if (covering.disableScheduling === true) {
        gaps.push({
          task: slug,
          reason: `a queue ('${schedule.queue}') autoRun-entryje disableScheduling: true`,
        })
        continue
      }
      if (typeof covering.cron === 'string' && minIntervalMs(schedule.cron) < minIntervalMs(covering.cron)) {
        gaps.push({
          task: slug,
          reason:
            `a schedule cronja ('${schedule.cron}') SŰRŰBB, mint az autoRun cronja ` +
            `('${covering.cron}') — a sorba állítás csak az autoRun tickjén történik meg, ` +
            'tehát a szándékolt ritmus élesben nem valósulna meg',
        })
      }
    }
  }

  return gaps
}

/**
 * Env-másolat a worker-kapcsolóval. A `buildJobsConfig` szándékosan
 * paraméteres, hogy a teszt a process.env MÓDOSÍTÁSA NÉLKÜL is meg tudja
 * nézni mindkét ágat (a modul-szintű `jobsConfig` importkor dől el).
 */
function envWithWorkers(enabled: boolean): NodeJS.ProcessEnv {
  return { ...process.env, ENABLE_JOB_WORKERS: enabled ? 'true' : undefined }
}

/** Bekapcsolt worker-ág — élesben/stagingen ez a tényleges konfiguráció. */
function workersOnConfig(): JobsConfig {
  return buildJobsConfig(envWithWorkers(true))
}

/** Sekély másolat, hogy a negatív kontroll mutálhasson (a handlerek megmaradnak). */
function cloneJobsConfig(config: JobsConfig): JobsConfig {
  return {
    ...config,
    tasks: config.tasks?.map((task) => ({ ...task })),
    ...(Array.isArray(config.autoRun)
      ? { autoRun: config.autoRun.map((entry) => ({ ...entry })) }
      : {}),
  }
}

describe('job-ütemezés — a végleges (szanitált) Payload-config', () => {
  it('a Payload SAJÁT szanitizálása bekapcsolta a scheduling-et', async () => {
    const config = await configPromise

    // Ez a Payload számítása, nem a miénk: sanitize.js akkor és csak akkor
    // állítja true-ra, ha legalább egy tasknak van `schedule` mezője.
    expect(config.jobs.scheduling).toBe(true)
    expect(config.jobs.enabled).toBe(true)
  })

  it.each(REQUIRED_SCHEDULED_TASKS)(
    'a(z) %s task a végleges configban ténylegesen ÜTEMEZVE van',
    async (slug) => {
      const config = await configPromise
      const task = taskBySlug(config.jobs, slug)

      expect(task, `a(z) ${slug} task hiányzik a végleges configból`).toBeDefined()
      expect(task?.schedule?.length ?? 0).toBeGreaterThan(0)
      for (const schedule of task?.schedule ?? []) {
        expect(schedule.queue).toBeTruthy()
        expect(schedule.cron).toBeTruthy()
      }
    },
  )

  it('a queue-k és a cronok a megosztott konstansokból jönnek (nem tudnak szétcsúszni)', async () => {
    const config = await configPromise

    expect(taskBySlug(config.jobs, 'order-poll')?.schedule).toMatchObject([
      { cron: ORDER_MAINTENANCE_CRON, queue: ORDER_POLL_QUEUE },
    ])
    expect(taskBySlug(config.jobs, 'webhook-retry')?.schedule).toMatchObject([
      { cron: WEBHOOK_RETRY_CRON, queue: WEBHOOK_RETRY_QUEUE },
    ])
  })

  /**
   * A beragadás-tűrő őr (src/jobs/schedule-guard.ts) MINDEN ütemezett taskon
   * kötelező: nélküle a Payload alapértelmezése lép életbe, amelyet egyetlen
   * beragadt `processing: true` sor véglegesen és némán kikapcsol.
   */
  it.each(REQUIRED_SCHEDULED_TASKS)(
    'a(z) %s schedule-jén ott a beragadás-tűrő beforeSchedule őr',
    async (slug) => {
      const config = await configPromise

      for (const schedule of taskBySlug(config.jobs, slug)?.schedule ?? []) {
        expect(
          typeof schedule.hooks?.beforeSchedule,
          `a(z) ${slug} schedule-jéről hiányzik a beforeSchedule őr — a Payload alapértelmezése ` +
            'egyetlen beragadt jobtól véglegesen kikapcsolná az ütemezést',
        ).toBe('function')
      }
    },
  )

  /**
   * Ez a lista kényszeríti ki a DÖNTÉST: minden task vagy ütemezett, vagy
   * tudatosan esemény-vezérelt. Új task felvételekor ez a teszt bukik, és a
   * fejlesztőnek állást kell foglalnia — nem tud csendben kimaradni.
   */
  it('minden task besorolt: ütemezett VAGY tudatosan esemény-vezérelt', async () => {
    const config = await configPromise
    const slugs = (config.jobs.tasks ?? []).map((task) => task.slug)
    const withoutSchedule = (config.jobs.tasks ?? [])
      .filter((task) => (task.schedule?.length ?? 0) === 0)
      .map((task) => task.slug)

    expect(
      [...slugs].sort(),
      'Új vagy megszűnt task a jobs-configban. Ez NEM elírás-ellenőrzés: dönteni kell, hogy az ' +
        'új task PERIODIKUS (kerüljön a REQUIRED_SCHEDULED_TASKS listába és kapjon `schedule`-t) ' +
        'vagy ESEMÉNY-VEZÉRELT (kerüljön az EVENT_DRIVEN_TASKS listába, és a kód állítsa sorba ' +
        '`payload.jobs.queue`-val). A csendes kimaradás ára: a task soha nem fut le.',
    ).toEqual([...REQUIRED_SCHEDULED_TASKS, ...EVENT_DRIVEN_TASKS].sort())
    expect(
      [...withoutSchedule].sort(),
      'Egy task `schedule` nélkül maradt, pedig nincs az esemény-vezéreltek között — így SEMMI ' +
        'nem állítja sorba, tehát soha nem fut le.',
    ).toEqual([...EVENT_DRIVEN_TASKS].sort())
  })
})

describe('job-ütemezés — a schedule ÉS az autoRun együtt (bekapcsolt workerek)', () => {
  it('nincs ütemezési rés: minden kötelező task queue-ja szerepel az autoRun-ban, tickelhető ritmussal', () => {
    expect(findSchedulingGaps(workersOnConfig(), REQUIRED_SCHEDULED_TASKS)).toEqual([])
  })

  it('az autoRun-entryk egyike sem kapcsolja ki az ütemezést', () => {
    const config = workersOnConfig()
    const entries = (Array.isArray(config.autoRun) ? config.autoRun : []) as AutorunEntryLike[]

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.disableScheduling).not.toBe(true)
    }
  })

  it('ENABLE_JOB_WORKERS nélkül nincs autoRun — a schedule ilyenkor nem is fut le (dev)', () => {
    const devConfig = buildJobsConfig(envWithWorkers(false))

    expect(devConfig.autoRun).toBeUndefined()
    // A schedule attól még ott van a taskokon: a hiányzó láncszem az autoRun.
    expect(payloadWouldEnableScheduling(devConfig)).toBe(true)
    expect(findSchedulingGaps(devConfig, REQUIRED_SCHEDULED_TASKS)).toHaveLength(
      REQUIRED_SCHEDULED_TASKS.length,
    )
  })
})

/**
 * NEGATÍV KONTROLL: az ellenőrzés csak akkor ér valamit, ha bukni is tud.
 * Mind a négy rés-fajtát előállítjuk mutációval, és megmutatjuk, hogy a
 * `findSchedulingGaps` mindegyiket elkapja.
 */
describe('job-ütemezés — negatív kontroll (a kapu tényleg bukik)', () => {
  it('törölt schedule (= a JAVÍTÁS ELŐTTI állapot) → rés', () => {
    const broken = cloneJobsConfig(workersOnConfig())
    broken.tasks = broken.tasks?.map((task) =>
      task.slug === 'order-poll' ? { ...task, schedule: undefined } : task,
    )

    const gaps = findSchedulingGaps(broken, REQUIRED_SCHEDULED_TASKS)

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ task: 'order-poll' })
    expect(gaps[0].reason).toContain('nincs schedule')
  })

  it('idegen queue a schedule-ben → rés (a handleSchedules sosem futna rá)', () => {
    const broken = cloneJobsConfig(workersOnConfig())
    broken.tasks = broken.tasks?.map((task) =>
      task.slug === 'webhook-retry'
        ? { ...task, schedule: [{ cron: WEBHOOK_RETRY_CRON, queue: 'nem-letezo-queue' }] }
        : task,
    )

    const gaps = findSchedulingGaps(broken, REQUIRED_SCHEDULED_TASKS)

    expect(gaps).toHaveLength(1)
    expect(gaps[0].reason).toContain('nem-letezo-queue')
  })

  it('disableScheduling: true az autoRun-entryn → rés', () => {
    const broken = cloneJobsConfig(workersOnConfig())
    broken.autoRun = (broken.autoRun as AutorunEntryLike[]).map((entry) =>
      entry.queue === ORDER_POLL_QUEUE ? { ...entry, disableScheduling: true } : entry,
    )

    const gaps = findSchedulingGaps(broken, REQUIRED_SCHEDULED_TASKS)

    expect(gaps).toHaveLength(1)
    expect(gaps[0].reason).toContain('disableScheduling')
  })

  it('SŰRŰBB schedule-cron, mint az autoRun-tick → rés', () => {
    const broken = cloneJobsConfig(workersOnConfig())
    broken.tasks = broken.tasks?.map((task) =>
      task.slug === 'order-poll'
        ? { ...task, schedule: [{ cron: '* * * * *', queue: ORDER_POLL_QUEUE }] }
        : task,
    )

    const gaps = findSchedulingGaps(broken, REQUIRED_SCHEDULED_TASKS)

    expect(gaps).toHaveLength(1)
    expect(gaps[0].reason).toContain('SŰRŰBB')
  })

  /**
   * POZITÍV kontroll a lazításhoz: a RITKÁBB schedule (pl. napi karbantartás
   * ugyanazon a queue-n) LEGITIM, nem rés. Az eredeti „azonos cron" invariáns
   * itt hamisan bukott volna — ez a teszt őrzi, hogy ne épüljön vissza.
   */
  it('RITKÁBB schedule-cron ugyanazon a queue-n → NEM rés (tudatosan megengedett)', () => {
    const relaxed = cloneJobsConfig(workersOnConfig())
    relaxed.tasks = relaxed.tasks?.map((task) =>
      task.slug === 'order-poll'
        ? { ...task, schedule: [{ cron: '0 3 * * *', queue: ORDER_POLL_QUEUE }] }
        : task,
    )

    expect(findSchedulingGaps(relaxed, REQUIRED_SCHEDULED_TASKS)).toEqual([])
  })
})

/**
 * A SZEMANTIKAI CSAPDA, ami az eredeti hibát okozta — külön teszt, hogy a
 * következő fejlesztő ne essen bele újra.
 *
 * A csapda: az `autoRun` beállítva volt (percenkénti és 5 percenkénti cron,
 * a helyes queue-nevekkel), a naplóban látszott, hogy a jobrendszer él — de
 * SEMMI nem került sorba, mert az autoRun a saját dokumentációja szerint
 * kizárólag a MÁR SORBAN ÁLLÓ jobokat futtatja. A hiányzó láncszem a
 * `TaskConfig.schedule` volt, amely nélkül a szanitizálás `jobs.scheduling`-et
 * sem kapcsolja be, tehát a `handleSchedules` ága el sem indul.
 */
describe('job-ütemezés — az autoRun ÖNMAGÁBAN nem elég (a hiba oka)', () => {
  it('autoRun megvan, schedule nincs → a Payload nem kapcsolná be a scheduling-et', () => {
    const autoRunOnly = cloneJobsConfig(workersOnConfig())
    autoRunOnly.tasks = autoRunOnly.tasks?.map((task) => ({ ...task, schedule: undefined }))

    // Az autoRun érintetlen: cron + queue a helyén van, a jobrendszer "él".
    expect(Array.isArray(autoRunOnly.autoRun)).toBe(true)
    expect((autoRunOnly.autoRun as AutorunEntryLike[]).map((entry) => entry.queue)).toEqual([
      WEBHOOK_RETRY_QUEUE,
      ORDER_MAINTENANCE_QUEUE,
      ORDER_POLL_QUEUE,
    ])

    // Mégsem ütemez semmit: sanitize.js `hasScheduleProperty` → false, tehát
    // `config.jobs.scheduling` undefined marad, és _initializeCrons feltétele
    // (`… && this.config.jobs.scheduling`) sosem teljesül.
    expect(payloadWouldEnableScheduling(autoRunOnly)).toBe(false)

    // Ez pontosan a JAVÍTÁS ELŐTTI éles állapot: mindkét periodikus task néma.
    expect(
      findSchedulingGaps(autoRunOnly, REQUIRED_SCHEDULED_TASKS).map((gap) => gap.task),
    ).toEqual([...REQUIRED_SCHEDULED_TASKS])
  })
})
