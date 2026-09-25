import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { payloadAamFind, queryAamStatus, type AamFindFn } from '../../lib/alerts/aam'
import configPromise from '../../payload.config'
import { isDatabaseAvailable } from '../helpers/db-available'
import { captureOwnedPostgresBootstrap } from '../helpers/owned-postgres-bootstrap'

// A teszt rendelés-sorokat ír és töröl: csak az eldobható, helyi CI-adatbázison
// futhat. Az audit:1 a hálózattiltott lokális runner elérhetetlen jelzője.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    (target.pathname !== '/kineticare_ci' && !(target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error('Az AAM DB-teszt csak az eldobható, helyi CI-adatbázison futhat')
  }
}
const hasDb = await isDatabaseAvailable()

/**
 * Az alanyi adómentes keret jelöltjei VALÓDI Postgresen (PR #305, Devin).
 *
 * A teljesítési dátum szöveges oszlop (varchar), a keret évét pedig ez adja.
 * Hogy a szöveges tartomány-szűrés a Payload lekérdezésén át valóban a
 * teljesítési év rendeléseit hozza (és nem a létrehozás idejére támaszkodik),
 * csak a valódi sémán és a valódi rendezéssel mérhető. A rendelések egy saját,
 * egyedi vevőhöz tartoznak, és a lekérdezés erre a vevőre szűkül, így a
 * párhuzamos tesztek sorai nem zavarnak bele.
 */
describe.skipIf(!hasDb)('AAM-keret jelöltjei (valódi PostgreSQL)', () => {
  const run = `aam-db-${randomUUID()}`
  const NOW = Date.parse('2026-09-24T08:00:00Z')
  let payload: Payload
  let releaseBootstrap: (() => void) | undefined
  let userId: number | undefined

  const adapter = () => payload.db as unknown as PostgresAdapter

  async function insertOrder(order: {
    createdAt: string
    invoiceStatus: 'issued' | 'pending'
    invoiceCompletionDate: string | null
    totalHuf: number
  }): Promise<void> {
    await adapter().pool.query(
      `INSERT INTO orders (customer_id, status, amount, currency, created_at, updated_at,
         invoice_status, invoice_completion_date, total_huf_snapshot)
       VALUES ($1, 'paid', $2, 'HUF', $3, $3, $4, $5, $2)`,
      [userId, order.totalHuf, order.createdAt, order.invoiceStatus, order.invoiceCompletionDate],
    )
  }

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
            releaseBootstrap = captureOwnedPostgresBootstrap(db)
            return db
          },
        },
      },
      disableOnInit: true,
    })
    const created = await adapter().pool.query<{ id: number }>(
      'INSERT INTO users (name, role, email) VALUES ($1, $2, $3) RETURNING id',
      ['DUMMY aam user', 'customer', `${run}@example.test`],
    )
    userId = created.rows[0]?.id

    // Devin példája: novemberi rendelés, januári teljesítés → a 2026-os keretbe számít.
    await insertOrder({
      createdAt: '2025-11-20T10:00:00.000Z',
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-01-05',
      totalHuf: 1_000,
    })
    // Az évben létrejött és teljesített rendelés.
    await insertOrder({
      createdAt: '2026-03-01T10:00:00.000Z',
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-03-01',
      totalHuf: 20_000,
    })
    // Előző évi teljesítés (a régi, decemberi visszatekintés is elérte): nem számít.
    await insertOrder({
      createdAt: '2025-12-20T10:00:00.000Z',
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2025-12-31',
      totalHuf: 300_000,
    })
    // Következő évi teljesítés: nem a tárgyévé.
    await insertOrder({
      createdAt: '2026-09-20T10:00:00.000Z',
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2027-01-01',
      totalHuf: 4_000_000,
    })
    // Tárgyévi dátum, de a számla nem állt ki.
    await insertOrder({
      createdAt: '2026-04-01T10:00:00.000Z',
      invoiceStatus: 'pending',
      invoiceCompletionDate: '2026-04-01',
      totalHuf: 50_000_000,
    })
  }, 60_000)

  afterAll(async () => {
    if (!payload) return
    const pool = adapter().pool
    try {
      if (userId !== undefined) {
        await pool.query('DELETE FROM orders WHERE customer_id = $1', [userId])
        await pool.query('DELETE FROM users WHERE id = $1 AND email = $2', [
          userId,
          `${run}@example.test`,
        ])
      }
    } finally {
      await payload.destroy()
      releaseBootstrap?.()
      await pool.end()
    }
  })

  it('a késve kiállt számla (korábbi rendelés, tárgyévi teljesítés) is a keretbe számít, az előző évi nem', async () => {
    const aamFind = payloadAamFind(payload, { overrideAccess: true })
    const find: AamFindFn = (args) =>
      aamFind({ ...args, where: { and: [args.where, { customer: { equals: userId } }] } })

    const status = await queryAamStatus(find, NOW)

    expect(status.year).toBe(2026)
    expect(status.netHuf).toBe(21_000)
  })
})
