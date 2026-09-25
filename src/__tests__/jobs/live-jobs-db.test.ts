import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EVENT_JOB_STALE_AFTER_MS, liveJobInputs } from '../../jobs/live-jobs'
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
    throw new Error('Az élő-job DB-teszt csak az eldobható, helyi CI-adatbázison futhat')
  }
}
const hasDb = await isDatabaseAvailable()

/**
 * Az élő-job felismerés a valódi payload-jobs sorokon (jobs/live-jobs.ts).
 *
 * Erre épül a helyesbítő-panel ígérete (refund-recovery.ts) és a számla-resweep
 * duplikátum-szűrője (order-poll/service.ts). Az egységtesztek a lekérdezést
 * mockolt `find`-dal futtatják; hogy a Payload a `taskSlug`- és a
 * `completedAt`-szűrőt a valódi táblán is így érti, és a `processing`,
 * `has_error`, `updated_at` oszlopok a várt mezőkbe kerülnek, csak itt látszik.
 * A tesztsorokat egyedi queue és egyedi rendelésazonosítók választják el a
 * párhuzamos tesztfájlok jobjaitól.
 */
describe.skipIf(!hasDb)('élő job felismerése (valódi PostgreSQL)', () => {
  const run = `live-jobs-${randomUUID()}`
  const queue = `teszt-${randomUUID().slice(0, 8)}`
  const base = 700_000 + Math.floor(Math.random() * 100_000) * 10
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

  afterAll(async () => {
    if (!payload) return
    const pool = adapter().pool
    await pool.query('DELETE FROM payload_jobs WHERE queue = $1', [queue])
    await payload.destroy()
    releaseBootstrap?.()
    await pool.end()
  })

  type QueueJob = (args: {
    task: string
    input: Record<string, unknown>
    queue: string
  }) => Promise<{ id: number | string }>

  async function queueInvoiceJob(orderId: number): Promise<number | string> {
    const job = await (payload.jobs.queue as unknown as QueueJob)({
      task: 'invoice-issue',
      input: { orderId },
      queue,
    })
    return job.id
  }

  it('a várakozó és a friss futó job él; a lefutott, a hibával zárult és az elhalt nem', async () => {
    const nowMs = Date.now()
    await queueInvoiceJob(base + 1) // vár a következő futására
    const running = await queueInvoiceJob(base + 2)
    const completed = await queueInvoiceJob(base + 3)
    const failed = await queueInvoiceJob(base + 4)
    const dead = await queueInvoiceJob(base + 5)
    const pool = adapter().pool
    await pool.query('UPDATE payload_jobs SET processing = true, updated_at = $2 WHERE id = $1', [
      running,
      new Date(nowMs - 60_000).toISOString(),
    ])
    await pool.query('UPDATE payload_jobs SET completed_at = $2 WHERE id = $1', [
      completed,
      new Date(nowMs - 60_000).toISOString(),
    ])
    await pool.query('UPDATE payload_jobs SET has_error = true WHERE id = $1', [failed])
    await pool.query('UPDATE payload_jobs SET processing = true, updated_at = $2 WHERE id = $1', [
      dead,
      new Date(nowMs - EVENT_JOB_STALE_AFTER_MS - 60_000).toISOString(),
    ])

    const live = (await liveJobInputs(payload, 'invoice-issue', nowMs))
      .map((input) => input.orderId)
      .filter((orderId) => typeof orderId === 'number' && orderId > base && orderId <= base + 5)

    expect([...live].sort()).toEqual([base + 1, base + 2])
    // A task szerint szűr: ugyanezek a rendelések helyesbítő-jobként nem élnek.
    const corrective = (await liveJobInputs(payload, 'corrective-invoice-issue', nowMs)).filter(
      (input) =>
        typeof input.orderId === 'number' && input.orderId > base && input.orderId <= base + 5,
    )
    expect(corrective).toEqual([])
  }, 60_000)
})
