import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDigestState, runDailyDigestIfDue, type DigestOutcome } from '../../lib/alerts/digest'
import { DIGEST_ENTITY_TYPE, DIGEST_SENT_ACTION } from '../../lib/alerts/digest-claim'
import type { SendMailInput } from '../../lib/email'
import type { SendResult } from '../../lib/email/types'
import type { Logger } from '../../lib/logger'
import configPromise from '../../payload.config'
import { isDatabaseAvailable } from '../helpers/db-available'
import { captureOwnedPostgresBootstrap } from '../helpers/owned-postgres-bootstrap'

// A teszt rendelés- és naplósorokat ír és töröl: csak az eldobható, helyi
// CI-adatbázison futhat. Az audit:1 a hálózattiltott lokális runner elérhetetlen jelzője.
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    (target.pathname !== '/kineticare_ci' && !(target.pathname === '/audit' && target.port === '1'))
  ) {
    throw new Error('A napi összesítő DB-tesztje csak az eldobható, helyi CI-adatbázison futhat')
  }
}
const hasDb = await isDatabaseAvailable()

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
}

/**
 * A napi összesítő tartós napi nyoma VALÓDI Postgresen (PR #305, Codex P2).
 *
 * Az SMTP-tartaléknak nincs szolgáltatói idempotenciája, és a folyamaton
 * belüli állapot újraindításkor elvész. Két átfedő példány (deploy) közül
 * csak az egyik küldhet: ezt az audit-logs napi nyoma és a napi advisory-zár
 * együtt adja, ami csak valódi adatbázison mérhető (a memóriabeli
 * teszt-Payloadon nincs zár). A teszt egy távoli napra fut, és a nap nyomát
 * előtte és utána törli, így az ismételt futás sem hat rá.
 */
describe.skipIf(!hasDb)('napi összesítő napi nyoma (valódi PostgreSQL)', () => {
  const run = `digest-db-${randomUUID()}`
  // 2031-05-17 07:10 Budapest (nyári idő, UTC+2).
  const NOW = Date.parse('2031-05-17T05:10:00Z')
  const DAY = '2031-05-17'
  let payload: Payload
  let releaseBootstrap: (() => void) | undefined
  let userId: number | undefined

  const adapter = () => payload.db as unknown as PostgresAdapter

  async function deleteDayClaims(): Promise<void> {
    await adapter().pool.query(
      'DELETE FROM audit_logs WHERE action = $1 AND entity_type = $2 AND entity_id = $3',
      [DIGEST_SENT_ACTION, DIGEST_ENTITY_TYPE, DAY],
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
      ['DUMMY digest user', 'customer', `${run}@example.test`],
    )
    userId = created.rows[0]?.id
    // Fizetett rendelés számla nélkül, két óránál régebben: a napra van teendő.
    await adapter().pool.query(
      `INSERT INTO orders (customer_id, status, amount, currency, created_at, updated_at, invoice_status)
       VALUES ($1, 'paid', 1000, 'HUF', '2031-05-16T08:00:00.000Z', '2031-05-16T08:00:00.000Z', 'none')`,
      [userId],
    )
    await deleteDayClaims()
  }, 60_000)

  afterAll(async () => {
    if (!payload) return
    const pool = adapter().pool
    try {
      await deleteDayClaims()
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

  it('két párhuzamos folyamat közül csak az egyik küld, és egy újraindult folyamat sem küld aznap még egyszer', async () => {
    const sent: SendMailInput[] = []
    // SMTP-szerű küldés: nincs szolgáltatói idempotencia, és időbe telik.
    const sendMail = async (input: SendMailInput): Promise<SendResult> => {
      sent.push(input)
      await new Promise((resolve) => setTimeout(resolve, 300))
      return { ok: true, provider: 'smtp' }
    }
    const freshProcess = (): Promise<DigestOutcome> =>
      runDailyDigestIfDue({
        payload,
        sendMail,
        recipients: () => ['tulajdonos@example.test'],
        logger: silentLogger,
        nowMs: NOW,
        serverUrl: 'https://kineticare.hu',
        state: createDigestState(),
      })

    const outcomes = await Promise.all([freshProcess(), freshProcess()])
    expect([...outcomes].sort()).toEqual(['elkuldve', 'mar-elkuldve'])
    expect(sent).toHaveLength(1)

    // Deploy után: új folyamat, üres állapottal.
    expect(await freshProcess()).toBe('mar-elkuldve')
    expect(sent).toHaveLength(1)

    const claims = await adapter().pool.query(
      'SELECT after FROM audit_logs WHERE action = $1 AND entity_type = $2 AND entity_id = $3',
      [DIGEST_SENT_ACTION, DIGEST_ENTITY_TYPE, DAY],
    )
    expect(claims.rows).toHaveLength(1)
    expect(JSON.stringify(claims.rows)).not.toContain('@')
  })
})
