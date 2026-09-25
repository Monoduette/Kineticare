import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CSV_FEJLEC, penzugyiExport } from '../../scripts/export-penzugyi-egyeztetes'
import configPromise from '../../payload.config'
import { isDatabaseAvailable } from '../helpers/db-available'
import { captureOwnedPostgresBootstrap } from '../helpers/owned-postgres-bootstrap'

// A teszt rendelés-, vevő- és termék-sorokat ír és töröl: csak az eldobható,
// helyi CI-adatbázison futhat. Az audit:1 a hálózattiltott lokális runner
// elérhetetlen jelzője.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    (target.pathname !== '/kineticare_ci' && !(target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error('Az export DB-tesztje csak az eldobható, helyi CI-adatbázison futhat')
  }
}
const hasDb = await isDatabaseAvailable()

/** A CSV rendelésszámai (a fejléc a modul saját oszloplistája). */
function rendelesszamok(csv: string): string[] {
  const oszlop = CSV_FEJLEC.indexOf('rendelesszam')
  return csv
    .slice(1)
    .split('\r\n')
    .slice(1)
    .filter((vonal) => vonal.length > 0)
    .map((vonal) => vonal.split(';')[oszlop] ?? '')
}

/**
 * A könyvelői export jelölt-lekérdezése VALÓDI Payload/PostgreSQL-en (PR #305,
 * Codex P2). Az export az azonosítón kulcsosan lapoz (`sort: 'id'`,
 * `id >= előző + 1`, mindig az első oldal), és oldalanként kérdezi le a
 * fizetési időt a `users_access_grants` tábla `source_order_id`-ján át. Hogy
 * ez a lekérdezés-alak a valódi sémán is minden jelöltet pontosan egyszer
 * hoz (több oldalon át), és a hozzáférés-óra a fizetés hónapjába sorolja a
 * rendelést, csak valódi adatbázison mérhető; a memóriás tesztek a hónap-
 * szabályokat fedik.
 *
 * Az adatbázisban más tesztek rendelései is lehetnek, ezért az állítások csak
 * a saját, egyedi rendelésszámú sorokra szűkülnek.
 */
describe.skipIf(!hasDb)('pénzügyi export (valódi PostgreSQL)', () => {
  const run = randomUUID().slice(0, 8)
  const OKTOBERI_DARAB = 250
  let payload: Payload
  let releaseBootstrap: (() => void) | undefined
  let userId: number | undefined
  let productId: number | undefined
  const orderIds: number[] = []

  const adapter = () => payload.db as unknown as PostgresAdapter
  const rendelesszam = (sorszam: number) => `DBX-${run}-${String(sorszam).padStart(4, '0')}`

  async function insertOrder(order: {
    orderNumber: string
    createdAt: string
    updatedAt: string
  }): Promise<number> {
    const result = await adapter().pool.query<{ id: number }>(
      `INSERT INTO orders (customer_id, order_number, status, amount, currency, created_at,
         updated_at, total_huf_snapshot)
       VALUES ($1, $2, 'paid', 1000, 'HUF', $3, $4, 1000) RETURNING id`,
      [userId, order.orderNumber, order.createdAt, order.updatedAt],
    )
    const id = result.rows[0]?.id
    if (id === undefined) throw new Error('a teszt-rendelés nem jött létre')
    orderIds.push(id)
    return id
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
    const pool = adapter().pool
    const user = await pool.query<{ id: number }>(
      'INSERT INTO users (name, role, email) VALUES ($1, $2, $3) RETURNING id',
      ['DUMMY export user', 'customer', `export-db-${run}@example.test`],
    )
    userId = user.rows[0]?.id
    const product = await pool.query<{ id: number }>(
      'INSERT INTO products (sku) VALUES ($1) RETURNING id',
      [`export-db-${run}`],
    )
    productId = product.rows[0]?.id

    // Devin példája: augusztus 31. 23:50-kor (Budapest) jött létre, szeptember
    // 1. 00:10-kor fizették (a hozzáférés-óra ekkor indult), visszatérítés nélkül.
    const devin = await insertOrder({
      orderNumber: rendelesszam(0),
      createdAt: '2026-08-31T21:50:00.000Z',
      updatedAt: '2026-08-31T22:10:01.000Z',
    })
    await pool.query(
      `INSERT INTO users_access_grants (_order, _parent_id, id, product_id, granted_at, source_kind, source_order_id)
       VALUES (1, $1, $2, $3, $4, 'order', $5)`,
      [userId, `export-db-${run}-grant`, productId, '2026-08-31T22:10:00.000Z', devin],
    )
    // Októberi rendelések: több, mint egy lekérdezés-oldal (200).
    for (let sorszam = 1; sorszam <= OKTOBERI_DARAB; sorszam += 1) {
      await insertOrder({
        orderNumber: rendelesszam(sorszam),
        createdAt: '2026-10-05T08:00:00.000Z',
        updatedAt: '2026-10-05T08:00:00.000Z',
      })
    }
  }, 120_000)

  afterAll(async () => {
    if (!payload) return
    const pool = adapter().pool
    try {
      if (userId !== undefined) {
        await pool.query('DELETE FROM users_access_grants WHERE _parent_id = $1', [userId])
      }
      await pool.query('DELETE FROM orders WHERE id = ANY($1::int[])', [orderIds])
      if (userId !== undefined) {
        await pool.query('DELETE FROM users WHERE id = $1 AND email = $2', [
          userId,
          `export-db-${run}@example.test`,
        ])
      }
      if (productId !== undefined) {
        await pool.query('DELETE FROM products WHERE id = $1', [productId])
      }
    } finally {
      await payload.destroy()
      releaseBootstrap?.()
      await pool.end()
    }
  })

  it('a hónap minden jelöltje pontosan egyszer jön több oldalon át, és a fizetés hónapja is behozza a rendelést', async () => {
    const sajat = (csv: string) =>
      rendelesszamok(csv).filter((szam) => szam.startsWith(`DBX-${run}-`))

    const szeptember = sajat((await penzugyiExport(payload, '2026-09')).csv)
    const oktober = sajat((await penzugyiExport(payload, '2026-10')).csv)

    expect(szeptember).toEqual([rendelesszam(0)])
    expect(oktober).toHaveLength(OKTOBERI_DARAB)
    expect(new Set(oktober)).toEqual(
      new Set(Array.from({ length: OKTOBERI_DARAB }, (_, index) => rendelesszam(index + 1))),
    )
  }, 60_000)
})
