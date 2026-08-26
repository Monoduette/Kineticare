import {
  BasePayload,
  type Access,
  type PayloadRequest,
  type SanitizedConfig,
  type SanitizedGlobalConfig,
} from 'payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { JOB_STATS_GLOBAL_SLUG, restrictJobStatsGlobalAccess } from '../../jobs/jobs-stats-access'
import { ORDER_MAINTENANCE_QUEUE } from '../../jobs/queues'
import configPromise from '../../payload.config'

/**
 * A GENERÁLT `payload-jobs-stats` GLOBAL JOGOSULTSÁGA (S2/c).
 * A `jobs.scheduling` bekapcsolásával a Payload maga regisztrál egy
 * `payload-jobs-stats` globalt, ACCESS NÉLKÜL — a szanitizálás pedig hiányzó
 * szabálynál a `defaultAccess`-t teszi be READ-re ÉS UPDATE-re
 * (`({ req: { user } }) => Boolean(user)`). Zárás nélkül tehát a
 */

type Role = 'owner' | 'staff' | 'customer'

const asReq = (user: { id: number; role: Role } | null) =>
  ({ req: { user } }) as unknown as Parameters<Access>[0]

const ANONYMOUS = null
const CUSTOMER = { id: 3, role: 'customer' as const }
const STAFF = { id: 2, role: 'staff' as const }
const OWNER = { id: 1, role: 'owner' as const }

let config: SanitizedConfig
let statsGlobal: SanitizedGlobalConfig | undefined

beforeAll(async () => {
  config = await configPromise
  statsGlobal = config.globals.find((global) => global.slug === JOB_STATS_GLOBAL_SLUG)
})

describe('a payload-jobs-stats global a VÉGLEGES, szanitált configban', () => {
  it('létezik (a Payload a scheduling miatt tolja be)', () => {
    expect(config.jobs.scheduling).toBe(true)
    expect(statsGlobal).toBeDefined()
  })

  it('OLVASÁS: anonim és customer NEM, staff és owner IGEN', async () => {
    expect(await statsGlobal?.access.read(asReq(ANONYMOUS))).toBe(false)
    expect(await statsGlobal?.access.read(asReq(CUSTOMER))).toBe(false)
    expect(await statsGlobal?.access.read(asReq(STAFF))).toBe(true)
    expect(await statsGlobal?.access.read(asReq(OWNER))).toBe(true)
  })

  /**
   * A LÉNYEG: a `POST /api/globals/payload-jobs-stats` az `access.update`-en
   * múlik (payload/dist/globals/operations/update.js). Enélkül a customer
   * ÍRHATTA volna az ütemezés-statisztikát.
   */
  it('ÍRÁS: anonim és customer NEM, staff és owner IGEN', async () => {
    expect(await statsGlobal?.access.update(asReq(ANONYMOUS))).toBe(false)
    expect(await statsGlobal?.access.update(asReq(CUSTOMER))).toBe(false)
    expect(await statsGlobal?.access.update(asReq(STAFF))).toBe(true)
    expect(await statsGlobal?.access.update(asReq(OWNER))).toBe(true)
  })

  it('VERZIÓ-OLVASÁS: a customer erre sem jut be', async () => {
    expect(await statsGlobal?.access.readVersions(asReq(CUSTOMER))).toBe(false)
    expect(await statsGlobal?.access.readVersions(asReq(STAFF))).toBe(true)
  })
})

/**
 * A `restrictJobStatsGlobalAccess` viselkedése a config KÖRNYEZETÉTŐL függően.
 * Az éles bekötést a fenti blokk méri; itt a két határeset.
 */
describe('restrictJobStatsGlobalAccess — határesetek', () => {
  const configWithout = (scheduling: boolean): SanitizedConfig =>
    ({ globals: [], jobs: { scheduling } }) as unknown as SanitizedConfig

  it('DOB, ha az ütemezés be van kapcsolva, de a global hiányzik (slug-átnevezés)', () => {
    expect(() => restrictJobStatsGlobalAccess(configWithout(true))).toThrow(
      /payload-jobs-stats/,
    )
  })

  it('nem dob, ha nincs ütemezés (a global sem jön létre)', () => {
    expect(() => restrictJobStatsGlobalAccess(configWithout(false))).not.toThrow()
  })
})

/**
 * A `handleSchedules` a stats-globalt a db-rétegen olvassa és írja
 * (`req.payload.db.findGlobal` / `db.updateGlobal` / `db.createGlobal`), ami az
 * access-ellenőrzés ALATT van. Ezt itt a VALÓDI Payload-operáció futtatásával
 * bizonyítjuk, kifejezetten USER NÉLKÜLI kéréssel: ha az ütemező a
 * `globalConfig.access.*` szabályon menne át, ez a kérés most elhasalna
 */
describe('a zár után is fut az ütemezés (user nélküli, belső úton)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a VALÓDI handleSchedules user NÉLKÜL is sorba állítja az order-poll jobot', async () => {
    // CLAUDE.md 15.: tesztből SOSEM mehet ki valódi hálózati hívás.
    vi.stubGlobal('fetch', () => {
      throw new Error('TESZT: valódi hálózati hívás nem futhat')
    })

    const globalCalls: string[] = []
    const queued: { task?: string; queue?: string }[] = []

    const payload = new BasePayload()
    payload.config = config
    payload.db = {
      count: async () => ({ totalDocs: 0 }),
      createGlobal: async ({ slug }: { slug: string }) => {
        globalCalls.push(`db.createGlobal:${slug}`)
        return {}
      },
      findGlobal: async ({ slug }: { slug: string }) => {
        globalCalls.push(`db.findGlobal:${slug}`)
        return undefined
      },
      updateGlobal: async ({ slug }: { slug: string }) => {
        globalCalls.push(`db.updateGlobal:${slug}`)
        return {}
      },
    } as unknown as BasePayload['db']
    payload.jobs.queue = (async (args: { task?: string; queue?: string }) => {
      queued.push(args)
      return { id: queued.length }
    }) as unknown as BasePayload['jobs']['queue']

    // A kérésben SZÁNDÉKOSAN nincs user — ez a szigorítás legszigorúbb esete.
    const req = { payload, user: null } as unknown as PayloadRequest

    const result = await payload.jobs.handleSchedules({ queue: ORDER_MAINTENANCE_QUEUE, req })

    // K4: a saját őr MAGA állítja sorba a jobot advisory-zár alatt (a `queued`
    // a bizonyíték), és shouldSchedule:false-t ad vissza — a handleSchedules
    // ezért „skipped"-ként könyveli a kört, nem „queued"-ként.
    expect(result.queued).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ task: 'order-poll', queue: ORDER_MAINTENANCE_QUEUE })
    // …és mindezt a db-rétegen keresztül, nem a global-operationökön.
    expect(globalCalls).toContain(`db.findGlobal:${JOB_STATS_GLOBAL_SLUG}`)
    expect(globalCalls.some((call) => call.startsWith('db.'))).toBe(true)
  })
})
