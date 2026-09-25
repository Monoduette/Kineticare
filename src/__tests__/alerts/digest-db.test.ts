import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createDigestState,
  isDigestDue,
  runDailyDigestIfDue,
  type DigestOutcome,
} from '../../lib/alerts/digest'
import {
  DIGEST_ENTITY_TYPE,
  DIGEST_SENT_ACTION,
  recordDigestSent,
} from '../../lib/alerts/digest-claim'
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
  // A foglalt zár esetéhez külön nap, hogy az előző eset nyoma ne hasson rá.
  const BUSY_NOW = Date.parse('2031-05-18T05:10:00Z')
  const BUSY_DAY = '2031-05-18'
  // A zár alatti újraolvasás és a megszakadt zár-kapcsolat esetének saját napja.
  const RACE_DAY = '2031-05-19'
  const DROP_DAY = '2031-05-20'
  // Egy folyamat két átfedő futásának saját napja.
  const OVERLAP_DAY = '2031-05-21'
  let payload: Payload
  let releaseBootstrap: (() => void) | undefined
  let userId: number | undefined

  const adapter = () => payload.db as unknown as PostgresAdapter

  async function deleteDayClaims(): Promise<void> {
    await adapter().pool.query(
      'DELETE FROM audit_logs WHERE action = $1 AND entity_type = $2 AND entity_id = ANY($3)',
      [DIGEST_SENT_ACTION, DIGEST_ENTITY_TYPE, [DAY, BUSY_DAY, RACE_DAY, DROP_DAY, OVERLAP_DAY]],
    )
  }

  // SMTP-szerű küldés: nincs szolgáltatói idempotencia, és időbe telik.
  function smtpLikeSend(sent: SendMailInput[]) {
    return async (input: SendMailInput): Promise<SendResult> => {
      sent.push(input)
      await new Promise((resolve) => setTimeout(resolve, 300))
      return { ok: true, provider: 'smtp' }
    }
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
    const sendMail = smtpLikeSend(sent)
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
    // A másik példány vagy a küldés alatt ér a zárhoz (folyamatban), vagy utána
    // (a nyomot látja); küldeni egyik esetben sem küld.
    expect(outcomes.filter((outcome) => outcome === 'elkuldve')).toHaveLength(1)
    expect(['folyamatban', 'mar-elkuldve']).toContain(
      outcomes.find((outcome) => outcome !== 'elkuldve'),
    )
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

  it('breaker (PR #305): ha egy másik példány tartja a napi zárat (lassú SMTP-küldés), ez a futás nem vár rá, nem dob és nem küld; a zár elengedése után küld', async () => {
    const sent: SendMailInput[] = []
    const state = createDigestState()
    const run = (): Promise<DigestOutcome> =>
      runDailyDigestIfDue({
        payload,
        sendMail: smtpLikeSend(sent),
        recipients: () => ['tulajdonos@example.test'],
        logger: silentLogger,
        nowMs: BUSY_NOW,
        serverUrl: 'https://kineticare.hu',
        state,
      })

    // A „másik példány”: saját kapcsolaton, nyitott tranzakcióban tartja a zárat.
    const holder = await adapter().pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
        `alerts:daily-digest:${BUSY_DAY}`,
      ])
      // A várakozó zár a pool 30 s-os statement_timeoutjáig állna, majd dobna
      // (hamis riasztás); 10 s bőven elég a nem váró útnak.
      const outcome = await Promise.race([
        run().catch((error: unknown) => `DOBOTT: ${String(error)}`),
        new Promise<string>((resolve) => setTimeout(() => resolve('VART A ZARRA'), 10_000)),
      ])
      expect(outcome).toBe('folyamatban')
      expect(sent).toHaveLength(0)
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }

    // A zár felszabadult (a másik példány nem írt nyomot, pl. elbukott a küldése):
    // a következő futás ugyanabban a folyamatban pótolja.
    expect(await run()).toBe('elkuldve')
    expect(sent).toHaveLength(1)
  }, 30_000)

  it('breaker (PR #305): zár alatti újraolvasás: ha egy másik példány a lekérdezés közben küldött és beírta a nyomot, ez a futás nem küld', async () => {
    // A másik példány a külső nyom-ellenőrzés UTÁN, de a zár megszerzése ELŐTT
    // küld és ír nyomot (itt: az első számolás közben), majd elengedi a zárat.
    const sent: SendMailInput[] = []
    const state = createDigestState()
    let injected = false
    const racing = new Proxy(payload, {
      get(target, prop) {
        if (prop === 'count') {
          return async (args: Parameters<Payload['count']>[0]) => {
            if (!injected) {
              injected = true
              await recordDigestSent(payload, RACE_DAY, { teendo: 1, provider: 'smtp' })
            }
            return target.count(args)
          }
        }
        const value: unknown = Reflect.get(target, prop, target)
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value
      },
    })
    const nowMs = Date.parse(`${RACE_DAY}T05:10:00Z`)
    const outcome = await runDailyDigestIfDue({
      payload: racing,
      sendMail: smtpLikeSend(sent),
      recipients: () => ['tulajdonos@example.test'],
      logger: silentLogger,
      nowMs,
      serverUrl: 'https://kineticare.hu',
      state,
    })
    expect(injected).toBe(true)
    expect(sent).toHaveLength(0)
    expect(outcome).toBe('mar-elkuldve')
    // Aznapra lezárva: a következő poll már nem is számol.
    expect(isDigestDue(nowMs + 5 * 60_000, state)).toBe(false)
  })

  it('breaker (PR #305): ha a zár kapcsolatát a küldés közben bontják, a folyamat nem kap uncaughtException-t, a levél és a nyom megmarad, a zár felszabadul', async () => {
    const lockKey = `alerts:daily-digest:${DROP_DAY}`
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown): void => {
      uncaught.push(error)
    }
    process.on('uncaughtException', onUncaught)
    const sent: SendMailInput[] = []
    let holderState: string | undefined
    let terminated = false
    try {
      const outcome = await runDailyDigestIfDue({
        payload,
        // Lassú SMTP-küldés, közben a Postgres bontja a zár kapcsolatát (mint a
        // 60 s-os idle_in_transaction_session_timeout, egy Postgres-újraindulás
        // vagy a hálózat elvágása).
        sendMail: async (input: SendMailInput): Promise<SendResult> => {
          sent.push(input)
          const holder = await adapter().pool.query<{ pid: number; state: string }>(
            `SELECT l.pid, a.state
               FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
              WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
                AND l.classid::bigint = ((hashtextextended($1::text, 0) >> 32) & 4294967295)
                AND l.objid::bigint = (hashtextextended($1::text, 0) & 4294967295)`,
            [lockKey],
          )
          holderState = holder.rows[0]?.state
          const pid = holder.rows[0]?.pid
          if (pid !== undefined) {
            const killed = await adapter().pool.query<{ ok: boolean }>(
              'SELECT pg_terminate_backend($1) AS ok',
              [pid],
            )
            terminated = killed.rows[0]?.ok === true
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
          return { ok: true, provider: 'smtp' }
        },
        recipients: () => ['tulajdonos@example.test'],
        logger: silentLogger,
        nowMs: Date.parse(`${DROP_DAY}T05:10:00Z`),
        serverUrl: 'https://kineticare.hu',
        state: createDigestState(),
      })
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(terminated).toBe(true)
      // A zár kapcsolata a küldés alatt nincs tranzakcióban, így az
      // idle_in_transaction_session_timeout nem vonatkozik rá.
      expect(holderState).toBe('idle')
      expect(uncaught).toEqual([])
      expect(outcome).toBe('elkuldve')
      expect(sent).toHaveLength(1)
    } finally {
      process.off('uncaughtException', onUncaught)
    }

    const claims = await adapter().pool.query(
      'SELECT id FROM audit_logs WHERE action = $1 AND entity_type = $2 AND entity_id = $3',
      [DIGEST_SENT_ACTION, DIGEST_ENTITY_TYPE, DROP_DAY],
    )
    expect(claims.rows).toHaveLength(1)
    // A bontott session zárja felszabadult: egy másik kapcsolat megkapja.
    const probe = await adapter().pool.connect()
    try {
      const free = await probe.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS locked',
        [lockKey],
      )
      expect(free.rows[0]?.locked).toBe(true)
      await probe.query('SELECT pg_advisory_unlock(hashtextextended($1::text, 0))', [lockKey])
    } finally {
      probe.release()
    }
  }, 30_000)

  it('breaker (PR #305 rev4): egy folyamat két átfedő futása közül a második nem küld újra, ha az első levele kiment, de a nyoma nem íródott be', async () => {
    // Átfedés élesben: a staff/owner kézi job-indítása (/api/payload-jobs/run)
    // croner-védelem nélkül fut, a runJobs pedig Promise.all-lal viszi a sort.
    const sent: SendMailInput[] = []
    let releaseFirstSend = (): void => undefined
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve
    })
    const sendMail = async (input: SendMailInput): Promise<SendResult> => {
      sent.push(input)
      if (sent.length === 1) await firstSendGate
      return { ok: true, provider: 'smtp' }
    }
    // Az első futás nyom-írása átmenetileg hibázik; a második futás számolása
    // addig vár, amíg az első le nem zárult.
    let auditFailures = 1
    const countGate: { wait: Promise<void> | null; open: () => void } = {
      wait: null,
      open: () => undefined,
    }
    const flaky = new Proxy(payload, {
      get(target, prop) {
        if (prop === 'create') {
          return async (args: Parameters<Payload['create']>[0]) => {
            if (args.collection === 'audit-logs' && auditFailures > 0) {
              auditFailures -= 1
              throw new Error('timeout exceeded when trying to connect')
            }
            return target.create(args)
          }
        }
        if (prop === 'count') {
          return async (args: Parameters<Payload['count']>[0]) => {
            if (countGate.wait !== null) await countGate.wait
            return target.count(args)
          }
        }
        const value: unknown = Reflect.get(target, prop, target)
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value
      },
    })
    const state = createDigestState()
    const nowMs = Date.parse(`${OVERLAP_DAY}T05:10:00Z`)
    const runOnce = (at: number): Promise<DigestOutcome> =>
      runDailyDigestIfDue({
        payload: flaky,
        sendMail,
        recipients: () => ['tulajdonos@example.test'],
        logger: silentLogger,
        nowMs: at,
        serverUrl: 'https://kineticare.hu',
        state,
      })

    const first = runOnce(nowMs)
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 10_000 })
    countGate.wait = new Promise<void>((resolve) => {
      countGate.open = resolve
    })
    const second = runOnce(nowMs + 1_000)
    await new Promise((resolve) => setTimeout(resolve, 200))
    releaseFirstSend()
    expect(await first).toBe('elkuldve')
    expect(state.pendingClaim).not.toBeNull()
    countGate.open()
    const secondOutcome = await second

    expect(sent).toHaveLength(1)
    expect(['mar-elkuldve', 'folyamatban']).toContain(secondOutcome)
  }, 30_000)
})
