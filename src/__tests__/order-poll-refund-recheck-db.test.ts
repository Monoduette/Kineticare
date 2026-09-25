import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { BarionPaymentStateResponse } from '../lib/barion'
import type { Logger } from '../lib/logger'
import {
  REFUND_RECHECK_AFTER_MS,
  REFUND_RECHECK_BAND_MS,
  pollPendingOrders,
} from '../lib/order-poll/service'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'

// A hálózati próba ELŐTT ellenőrizzük a célpontot: az SQL-fixtúrák csak az
// eldobható, helyi (localhost) CI-adatbázisba mehetnek, pontosan úgy, mint a
// testvér DB-tesztekben (refund-intent-store-db). Az audit:1 a hálózattiltott
// runner elérhetetlen jelzője.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !(target.pathname === '/kineticare_ci' || (target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error('Refund recheck DB verification requires a disposable localhost CI database')
  }
}
const hasDb = await isDatabaseAvailable()

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/**
 * Rögzített „most”: a sáv [2026-09-16 12:00Z, 2026-09-17 12:00Z], azaz két
 * UTC-napra esik, és 2026-09-16 hajnala ugyanarra a napra esik, de a sáv előtt.
 * A JSON-ág mindkét UTC-napját egy-egy részleges visszatérítés gyakorolja.
 */
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0)
const UNTIL_MS = NOW - REFUND_RECHECK_AFTER_MS
const SINCE_MS = UNTIL_MS - REFUND_RECHECK_BAND_MS

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * r-barion-8 a valódi Payload-lekérdezésen át: a `refunds` JSON-oszlop. A
 * mockolt payload.find a where-alakot nem értékeli ki, ezért a JSON-ág
 * érvénytelen operátora (greater_than_equal → `@ undefined` jsonpath) csak
 * valódi Postgresen derül ki: ott az egész jelöltlekérdezés dob, és egyetlen
 * visszatérítés (a teljes sem) kap újraellenőrzést.
 *
 * Elszigetelés a közös CI-adatbázisban: a futás minden `orders`-olvasása a
 * saját sorokra szűkül (a lekérdezés eredeti where-feltétele változatlan, csak
 * egy ÉS-tag kerül mellé a futás rendelésszám-előtagjára). Így a rögzített,
 * múltbeli NOW mellett sem érhet a futás más tesztfájlok sorához: egy
 * visszadátumozott, barionPaymentId nélküli payment_pending sort például
 * árvaként lezárna, a lezárt sorokat pedig forgatná (updatedAt-írás).
 */
describe.skipIf(!hasDb)('order-poll heti visszatérítés-újraellenőrzés (valódi PostgreSQL)', () => {
  const run = randomUUID().slice(0, 8)
  const createdIds: number[] = []
  let payload: Payload

  const rows = {
    full: { paymentId: randomUUID(), orderNumber: `RC-${run}-FULL` },
    partialIn: { paymentId: randomUUID(), orderNumber: `RC-${run}-PIN` },
    partialInSecondDay: { paymentId: randomUUID(), orderNumber: `RC-${run}-PIN2` },
    partialSameDayBefore: { paymentId: randomUUID(), orderNumber: `RC-${run}-PDAY` },
    partialOld: { paymentId: randomUUID(), orderNumber: `RC-${run}-POLD` },
  }

  async function insertOrder(input: {
    orderNumber: string
    paymentId: string
    status: 'paid' | 'refunded'
    refundedAt: string | null
    refunds: unknown[]
  }): Promise<void> {
    const pool = (payload.db as unknown as PostgresAdapter).pool
    const created = await pool.query<{ id: number }>(
      `INSERT INTO orders (status, amount, currency, order_number, barion_payment_id,
         total_huf_snapshot, refunded_at, refunds, created_at, updated_at)
       VALUES ($1, 19990, 'HUF', $2, $3, 19990, $4, $5::jsonb, $6, $6) RETURNING id`,
      [
        input.status,
        input.orderNumber,
        input.paymentId,
        input.refundedAt,
        JSON.stringify(input.refunds),
        iso(NOW - 40 * DAY_MS),
      ],
    )
    createdIds.push(created.rows[0].id)
  }

  const refundEntry = (refundedAtMs: number, amountHuf: number, type: 'full' | 'partial') => ({
    transactionId: randomUUID(),
    amountHuf,
    status: 'Succeeded',
    refundedAt: iso(refundedAtMs),
    type,
  })

  beforeAll(async () => {
    // onInit (tartalom-seed) nem kell: a teszt csak az orders táblát használja.
    payload = await getPayload({ config: configPromise, disableOnInit: true })
    // Teljes visszatérítés a sávban: a rendelés refundedAt-je is kitöltött.
    const fullAt = UNTIL_MS - 6 * HOUR_MS
    await insertOrder({
      ...rows.full,
      status: 'refunded',
      refundedAt: iso(fullAt),
      refunds: [refundEntry(fullAt, 19990, 'full')],
    })
    // Részleges visszatérítés a sávban: a rendelés paid, a refundedAt üres.
    await insertOrder({
      ...rows.partialIn,
      status: 'paid',
      refundedAt: null,
      refunds: [refundEntry(SINCE_MS + 6 * HOUR_MS, 5000, 'partial')],
    })
    // Részleges visszatérítés a sáv második UTC-napján (2026-09-17), még a
    // sávban: a JSON-ágnak a sáv vége napját is le kell fednie.
    await insertOrder({
      ...rows.partialInSecondDay,
      status: 'paid',
      refundedAt: null,
      refunds: [refundEntry(UNTIL_MS - HOUR_MS, 5000, 'partial')],
    })
    // Részleges visszatérítés a sáv első UTC-napján, de a sáv kezdete ELŐTT.
    await insertOrder({
      ...rows.partialSameDayBefore,
      status: 'paid',
      refundedAt: null,
      refunds: [refundEntry(SINCE_MS - 6 * HOUR_MS, 5000, 'partial')],
    })
    // Régi (30 napos) részleges visszatérítés: rég túl van a sávon.
    await insertOrder({
      ...rows.partialOld,
      status: 'paid',
      refundedAt: null,
      refunds: [refundEntry(NOW - 30 * DAY_MS, 5000, 'partial')],
    })
  }, 120_000)

  afterAll(async () => {
    if (payload && createdIds.length > 0) {
      await (payload.db as unknown as PostgresAdapter).pool.query(
        'DELETE FROM orders WHERE id = ANY($1::int[])',
        [createdIds],
      )
    }
    await payload?.db?.destroy?.()
  })

  it('a sávba eső teljes ÉS részleges (a sáv mindkét UTC-napján) visszatérítés GetState-et kap, a sávon kívüliek nem', async () => {
    const warns: string[] = []
    const log: Logger = {
      child: () => log,
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warns.push(message)
      },
      error: () => undefined,
    }
    // Második védvonal a szűkítés mellé: ha mégis idegen sor jutna ide, arra
    // nem végleges (Prepared) állapot megy, így egyiket sem írjuk át, és
    // semmilyen pénz- vagy e-mail-mellékhatás nem indulhat (CLAUDE.md 15.).
    const ownPaymentIds = new Set<string>(Object.values(rows).map((row) => row.paymentId))
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => ({
      PaymentId: paymentId,
      Status: ownPaymentIds.has(paymentId) ? 'Succeeded' : 'Prepared',
      Transactions: [],
    }))
    const forbidden = (name: string) => async (): Promise<never> => {
      throw new Error(`teszthiba: ${name} ebben a tesztben nem futhat`)
    }
    // A futás csak a saját sorait látja (lásd a describe fejkommentjét).
    const ownOrders = { orderNumber: { like: `RC-${run}-` } }
    const scopedPayload = new Proxy(payload, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target)
        if (property === 'find') {
          return (args: Parameters<Payload['find']>[0]) =>
            target.find(
              args.collection === 'orders'
                ? { ...args, where: args.where ? { and: [args.where, ownOrders] } : ownOrders }
                : args,
            )
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    vi.stubGlobal('fetch', forbidden('valódi hálózati hívás'))
    try {
      await pollPendingOrders({
        payload: scopedPayload,
        fetchState,
        now: NOW,
        logger: log,
        invoicingEnabled: () => false,
        onPaid: forbidden('onPaid'),
        recoverRejectedPaid: forbidden('recoverRejectedPaid'),
        queueInvoice: forbidden('queueInvoice'),
      })
    } finally {
      vi.unstubAllGlobals()
    }

    expect(
      warns.filter((message) => message.includes('újraellenőrzésének jelöltjei nem olvashatók')),
    ).toEqual([])
    const called = fetchState.mock.calls.map(([paymentId]) => paymentId)
    expect(called).toContain(rows.full.paymentId)
    expect(called).toContain(rows.partialIn.paymentId)
    expect(called).toContain(rows.partialInSecondDay.paymentId)
    expect(called).not.toContain(rows.partialSameDayBefore.paymentId)
    expect(called).not.toContain(rows.partialOld.paymentId)
  }, 120_000)
})
