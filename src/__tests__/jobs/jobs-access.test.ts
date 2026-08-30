import {
  BasePayload,
  type Access,
  type PayloadRequest,
  type SanitizedConfig,
  type Where,
} from 'payload'
import { describe, expect, it } from 'vitest'

import { isStaffOrOwner } from '../../access/isStaffOrOwner'
import { buildJobsConfig } from '../../jobs'
import { ORDER_MAINTENANCE_QUEUE } from '../../jobs/queues'
import { queueInvoiceIssueJob } from '../../lib/order-paid'
import configPromise from '../../payload.config'

/**
 * A JOB-VÉGPONTOK JOGOSULTSÁGA (S2/a) — a VALÓDI Payload-kóddal bizonyítva.
 * A `jobs.access` alapértelmezése a szanitizáláskor kerül be
 * (payload/dist/config/defaults.js, `addDefaultsToConfig`):
 * access: { cancel: defaultAccess, queue: defaultAccess, run: defaultAccess,
 * ...config.jobs?.access }
 */

const JOBS_COLLECTION_SLUG = 'payload-jobs'

type Role = 'owner' | 'staff' | 'customer'

const owner = { id: 1, role: 'owner' as Role }
const staff = { id: 2, role: 'staff' as Role }
const customer = { id: 3, role: 'customer' as Role }

interface DbCall {
  method: string
  args: unknown
}

interface Harness {
  payload: BasePayload
  dbCalls: DbCall[]
}

/**
 * Ál-persistence a jobs-műveletekhez.
 * - `updateJobs` üres tömböt ad → a `runJobs` „nincs futtatható job"-bal tér vissza;
 * - `findGlobal` undefined → a `handleSchedules` első ütemezésnek veszi;
 * - `count` 0 → a duplikátum-védelem (schedule-guard) enged ütemezni.
 */
function createHarness(config: SanitizedConfig): Harness {
  const dbCalls: DbCall[] = []

  const record =
    <T>(method: string, result: T) =>
    async (args: unknown): Promise<T> => {
      dbCalls.push({ method, args })
      return result
    }

  const db = {
    name: 'postgres',
    beginTransaction: record('beginTransaction', 'tx-1'),
    commitTransaction: record('commitTransaction', undefined),
    count: async (args: { where: Where }): Promise<{ totalDocs: number }> => {
      dbCalls.push({ method: 'count', args })
      return { totalDocs: 0 }
    },
    create: async (args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => {
      dbCalls.push({ method: 'create', args })
      return { id: 1, ...args.data }
    },
    createGlobal: record('createGlobal', {}),
    findGlobal: record('findGlobal', undefined),
    updateGlobal: record('updateGlobal', {}),
    updateJobs: record('updateJobs', []),
  }

  const payload = new BasePayload()
  payload.config = config
  payload.db = db as unknown as BasePayload['db']
  payload.collections = {} as unknown as BasePayload['collections']

  return { payload, dbCalls }
}

/** Ál-kérés a végpont-handlerhez: a Payload i18n-je és loggere kiváltva. */
function createReq(harness: Harness, user: { id: number; role: Role } | null): PayloadRequest {
  return {
    payload: harness.payload,
    user,
    query: {},
    i18n: { t: (key: string) => key },
    t: (key: string) => key,
  } as unknown as PayloadRequest
}

interface JobEndpoint {
  method: string
  path: string
  handler: (req: PayloadRequest) => Promise<Response> | Response
}

function jobEndpoints(config: SanitizedConfig): JobEndpoint[] {
  const collection = (config.collections ?? []).find((c) => c.slug === JOBS_COLLECTION_SLUG)
  expect(collection, 'a payload-jobs collection létezik').toBeDefined()
  return (collection?.endpoints === false ? [] : (collection?.endpoints ?? [])) as JobEndpoint[]
}

function endpointByPath(config: SanitizedConfig, path: string): JobEndpoint {
  const endpoint = jobEndpoints(config).find((e) => e.path === path)
  if (!endpoint) {
    throw new Error(`nincs ilyen jobs-végpont: ${path}`)
  }
  return endpoint
}

/**
 * Az éles config másolata a Payload GYÁRI jobs-access-ével (negatív kontroll).
 * Ez a mai main állapota: `defaultAccess` = bármely bejelentkezett felhasználó
 * (payload/dist/config/defaults.js → payload/dist/auth/defaultAccess.js).
 */
function withDefaultJobsAccess(config: SanitizedConfig): SanitizedConfig {
  const defaultAccess = ({ req }: { req: PayloadRequest }): boolean => Boolean(req.user)
  return {
    ...config,
    jobs: {
      ...config.jobs,
      access: { cancel: defaultAccess, queue: defaultAccess, run: defaultAccess },
    },
  } as SanitizedConfig
}

describe('jobs access — a konfiguráció bekötése', () => {
  it('a buildJobsConfig mindhárom műveletre staff/owner-t köt be', () => {
    const jobs = buildJobsConfig({} as NodeJS.ProcessEnv)

    expect(jobs.access?.run).toBe(isStaffOrOwner)
    expect(jobs.access?.queue).toBe(isStaffOrOwner)
    expect(jobs.access?.cancel).toBe(isStaffOrOwner)
  })

  it('a bekötés a VÉGLEGES, szanitált configban is megvan', async () => {
    const config = await configPromise

    expect(config.jobs.access?.run).toBe(isStaffOrOwner)
    expect(config.jobs.access?.queue).toBe(isStaffOrOwner)
    expect(config.jobs.access?.cancel).toBe(isStaffOrOwner)
  })

  /**
   * A támadási felület pontos leltára: a `jobs.access` KIZÁRÓLAG a jobs-specifikus
   * `/run` és `/handle-schedules` GET-végpontot védi
   * (payload/dist/queues/config/collection.js `endpoints` tömbje). Külön
   * `/queue` és `/cancel` REST-végpont a 3.88.0-ban NINCS — azok az access-ágak
   * csak a local API `overrideAccess: false` hívásain élnek. Ha egy verzióemelés
   * új jobs-végpontot hozna, ez a teszt megbukik, és újra kell gondolni a szabályt.
   */
  it('a jobs-specifikus végpontok: /run és /handle-schedules (nincs /queue és /cancel)', async () => {
    const config = await configPromise
    const paths = jobEndpoints(config).map((e) => `${e.method} ${e.path}`)

    expect(paths).toContain('get /run')
    expect(paths).toContain('get /handle-schedules')
    expect(paths.filter((path) => path.includes('/queue'))).toEqual([])
    expect(paths.filter((path) => path.includes('/cancel'))).toEqual([])
  })

  /**
   * A MÁSIK FÉL: a jobs-collection a SZOKÁSOS CRUD REST-felületet is megkapja
   * (`GET/POST/PATCH/DELETE /api/payload-jobs…`), amit nem a `jobs.access`, hanem
   * a COLLECTION `access` blokkja véd. A gyári jobs-collection nem ad meg
   * access-t, tehát a `defaultAccess` (= bármely bejelentkezett felhasználó)
   * lépne életbe: egy vevő `POST`-tal tetszőleges taskot injektálhatna, amit az
   * autoRun-cron lefuttat. Ezt a `jobsCollectionOverrides` zárja be.
   */
  it('a payload-jobs collection CRUD-felülete staff/owner-re szűkített', async () => {
    const config = await configPromise
    const collection = (config.collections ?? []).find((c) => c.slug === JOBS_COLLECTION_SLUG)

    expect(collection?.access?.create).toBe(isStaffOrOwner)
    expect(collection?.access?.read).toBe(isStaffOrOwner)
    expect(collection?.access?.update).toBe(isStaffOrOwner)
    expect(collection?.access?.delete).toBe(isStaffOrOwner)
  })

  it('a CRUD-felület a szerepkör-mátrix szerint dönt (látogató/customer kizárva)', async () => {
    const config = await configPromise
    const collection = (config.collections ?? []).find((c) => c.slug === JOBS_COLLECTION_SLUG)
    const harness = createHarness(config)

    const accessArgs = (user: { id: number; role: Role } | null): Parameters<Access>[0] =>
      ({ req: createReq(harness, user) }) as unknown as Parameters<Access>[0]

    for (const operation of ['create', 'read', 'update', 'delete'] as const) {
      const rule = collection?.access?.[operation]
      expect(rule, operation).toBeDefined()
      expect(rule?.(accessArgs(null)), `${operation} / anonim`).toBe(false)
      expect(rule?.(accessArgs(customer)), `${operation} / customer`).toBe(false)
      expect(rule?.(accessArgs(staff)), `${operation} / staff`).toBe(true)
      expect(rule?.(accessArgs(owner)), `${operation} / owner`).toBe(true)
    }
  })
})

describe('GET /api/payload-jobs/run — jogosultság', () => {
  it.each([
    ['anonim látogató', null],
    ['customer', customer],
  ])('%s 401-et kap, és egyetlen job sem indul', async (_label, user) => {
    const config = await configPromise
    const harness = createHarness(config)

    const response = await endpointByPath(config, '/run').handler(createReq(harness, user))

    expect(response.status).toBe(401)
    expect(harness.dbCalls).toHaveLength(0)
  })

  it.each([
    ['staff', staff],
    ['owner', owner],
  ])('%s átjut a kapun (a futtatás elindul)', async (_label, user) => {
    const config = await configPromise
    const harness = createHarness(config)

    const response = await endpointByPath(config, '/run').handler(createReq(harness, user))

    expect(response.status).toBe(200)
    // A kapun túl a VALÓDI runJobs futott: megpróbálta „processing"-re állítani
    // a soron következő jobokat (az ál-adatbázis üres listát ad vissza).
    expect(harness.dbCalls.map((call) => call.method)).toContain('updateJobs')
  })

  /**
   * NEGATÍV KONTROLL — a sebezhetőség bizonyítéka. A saját access-blokk nélkül
   * (ez volt a mai main állapota) a Payload `defaultAccess`-e marad hatályban,
   * és a BEJELENTKEZETT customer kérése lefuttatja a jobokat.
   */
  it('saját access NÉLKÜL a customer lefuttatja a jobokat (a mai main hibája)', async () => {
    const config = withDefaultJobsAccess(await configPromise)
    const harness = createHarness(config)

    const response = await endpointByPath(config, '/run').handler(createReq(harness, customer))

    expect(response.status).toBe(200)
    expect(harness.dbCalls.map((call) => call.method)).toContain('updateJobs')
  })
})

describe('GET /api/payload-jobs/handle-schedules — jogosultság', () => {
  it.each([
    ['anonim látogató', null],
    ['customer', customer],
  ])('%s 401-et kap, és semmi nem kerül sorba', async (_label, user) => {
    const config = await configPromise
    const harness = createHarness(config)

    const response = await endpointByPath(config, '/handle-schedules').handler(
      createReq(harness, user),
    )

    expect(response.status).toBe(401)
    expect(harness.dbCalls).toHaveLength(0)
  })

  it('staff átjut a kapun (a valódi ütemező lefut)', async () => {
    const config = await configPromise
    const harness = createHarness(config)

    const response = await endpointByPath(config, '/handle-schedules').handler(
      createReq(harness, staff),
    )

    expect(response.status).toBe(200)
    // A `handleSchedules` első dolga a stats-global olvasása — ez bizonyítja,
    // hogy a kapun túl a VALÓDI ütemező futott.
    expect(harness.dbCalls.map((call) => call.method)).toContain('findGlobal')
  })

  /** NEGATÍV KONTROLL: saját access nélkül a customer ütemezése is átmegy. */
  it('saját access NÉLKÜL a customer ütemezhet (a mai main hibája)', async () => {
    const config = withDefaultJobsAccess(await configPromise)
    const harness = createHarness(config)

    const response = await endpointByPath(config, '/handle-schedules').handler(
      createReq(harness, customer),
    )

    expect(response.status).toBe(200)
    expect(harness.dbCalls.map((call) => call.method)).toContain('findGlobal')
  })
})

/**
 * A KRITIKUS KÉRDÉS: nem áll-e le a saját, szerver-oldali ütemezés és a
 * számlázási lánc? A local API `overrideAccess` alapértelmezése `true`
 * (`args?.overrideAccess !== false`), ami az access-ágba BE SEM LÉP — ezért a
 * felhasználó nélküli, szerver-oldali hívások érintetlenek.
 */
describe('local API — a szerver-oldali sorbaállítás és futtatás érintetlen', () => {
  it('payload.jobs.queue felhasználó NÉLKÜL is sorba állít (cron/callback útja)', async () => {
    const config = await configPromise
    const harness = createHarness(config)

    const job = await harness.payload.jobs.queue({
      input: { orderId: 12 },
      queue: ORDER_MAINTENANCE_QUEUE,
      req: createReq(harness, null),
      task: 'invoice-issue',
    } as unknown as Parameters<BasePayload['jobs']['queue']>[0])

    expect(job).toMatchObject({ taskSlug: 'invoice-issue', queue: ORDER_MAINTENANCE_QUEUE })
    expect(harness.dbCalls.map((call) => call.method)).toContain('create')
  })

  it('payload.jobs.run felhasználó NÉLKÜL sem dob (az autoRun-cron útja)', async () => {
    const config = await configPromise
    const harness = createHarness(config)

    const result = await harness.payload.jobs.run({
      queue: ORDER_MAINTENANCE_QUEUE,
      req: createReq(harness, null),
    })

    expect(result.noJobsRemaining).toBe(true)
  })

  it('az ÉLES queueInvoiceIssueJob továbbra is sorba állít (számlázási lánc)', async () => {
    const config = await configPromise
    const harness = createHarness(config)

    const queued = await queueInvoiceIssueJob(harness.payload, 99)

    expect(queued).toBe(true)
    const createCall = harness.dbCalls.find((call) => call.method === 'create')
    expect(createCall?.args).toMatchObject({
      data: { taskSlug: 'invoice-issue', queue: ORDER_MAINTENANCE_QUEUE },
    })
  })

  /**
   * NEGATÍV KONTROLL: a `queue` access-ág mégsem holt kód — aki KIFEJEZETTEN
   * `overrideAccess: false`-szal hív (pl. egy jövőbeli, felhasználói kérésből
   * induló sorbaállítás), arra a szabály érvényes.
   */
  it('overrideAccess: false mellett a customer sorbaállítása elutasított', async () => {
    const config = await configPromise
    const harness = createHarness(config)

    await expect(
      harness.payload.jobs.queue({
        input: { orderId: 12 },
        overrideAccess: false,
        queue: ORDER_MAINTENANCE_QUEUE,
        req: createReq(harness, customer),
        task: 'invoice-issue',
      } as unknown as Parameters<BasePayload['jobs']['queue']>[0]),
    ).rejects.toThrow()

    expect(harness.dbCalls.map((call) => call.method)).not.toContain('create')
  })

  it('overrideAccess: false mellett a staff sorbaállítása átmegy', async () => {
    const config = await configPromise
    const harness = createHarness(config)

    await harness.payload.jobs.queue({
      input: { orderId: 12 },
      overrideAccess: false,
      queue: ORDER_MAINTENANCE_QUEUE,
      req: createReq(harness, staff),
      task: 'invoice-issue',
    } as unknown as Parameters<BasePayload['jobs']['queue']>[0])

    expect(harness.dbCalls.map((call) => call.method)).toContain('create')
  })
})
