import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'

import { logger as rootLogger, type Logger } from './logger'

/**
 * Postgres advisory-zárak a check-then-act pénzügyi utakhoz.
 *
 * - `withAdvisoryLock`: `pg_advisory_xact_lock` egy külön, TÉTLEN
 *   tranzakcióban. A `fn` NEM a zár tranzakciójában fut (külön kapcsolat) —
 *   nincs közös rollback. Külső HTTP ne menjen a záron belülre: a tétlen
 *   tranzakciót a Postgres 60 s után bontja (idle_in_transaction_session_timeout),
 *   a zár ilyenkor csendben elengedődik.
 * - `withSessionAdvisoryLock`: session-szintű `pg_try_advisory_lock` egy
 *   dedikált kapcsolaton, tranzakció NÉLKÜL, hibafigyelővel. Azoknak a
 *   hívóknak, amelyeknek a védett szakasza külső HTTP-t is átível (a-callback-7,
 *   a-szamlazz-11).
 */

/** A zár-tranzakció minimális, szerkezeti felülete (a drizzle-példányból). */
interface AdvisoryLockTransaction {
  execute(query: SQL): Promise<unknown>
}

interface AdvisoryLockDrizzle {
  transaction<T>(run: (tx: AdvisoryLockTransaction) => Promise<T>): Promise<T>
}

/** A dedikált kapcsolat minimális felülete (pg `PoolClient`). */
export interface SessionLockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
  on(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  /** Igaz értékű argumentummal a pool a kapcsolatot eldobja (nem adja vissza). */
  release(destroy?: Error | boolean): void
}

interface SessionLockPool {
  connect(): Promise<SessionLockClient>
}

/** Ennyi ideig próbáljuk megszerezni a session-zárat, utána hibával feladjuk. */
export const SESSION_LOCK_ACQUIRE_TIMEOUT_MS = 30_000
/** A foglalt zár újrapróbálási közege. */
export const SESSION_LOCK_POLL_INTERVAL_MS = 250

export interface SessionAdvisoryLockOptions {
  acquireTimeoutMs?: number
  pollIntervalMs?: number
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * A Payload postgres-adapterének drizzle-példánya (`payload.db.drizzle`).
 * A `db` mezője adapter-függő, ezért szerkezetileg ellenőrizzük, és csak akkor
 * fogadjuk el, ha valóban van `transaction` metódusa.
 */
function resolveDrizzle(payload: Payload): AdvisoryLockDrizzle | null {
  const db = payload.db as unknown as { drizzle?: unknown } | undefined
  const candidate = db?.drizzle
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { transaction?: unknown }).transaction === 'function'
  ) {
    return candidate as unknown as AdvisoryLockDrizzle
  }
  return null
}

/** A Payload postgres-adapterének `pg` poolja (`payload.db.pool`), szerkezetileg ellenőrizve. */
function resolvePool(payload: Payload): SessionLockPool | null {
  const db = payload.db as unknown as { pool?: unknown } | undefined
  const candidate = db?.pool
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { connect?: unknown }).connect === 'function'
  ) {
    return candidate as SessionLockPool
  }
  return null
}

/** Zár nélküli futás kezelése (drizzle/pool hiányában): élesben dob, máshol figyelmeztet. */
function runWithoutLock<T>(lockLog: Logger, lockKey: string, fn: () => Promise<T>, what: string) {
  if (isProduction()) {
    lockLog.error(
      `RIASZTÁS: az adatbázis-zár nem szerezhető meg (nincs ${what}) — a védett szakasz zár nélkül NEM futhat`,
    )
    throw new Error(
      `Az adatbázis-zár nem szerezhető meg (${lockKey}) — a művelet biztonságosan nem folytatható.`,
    )
  }
  lockLog.warn(
    `advisory-zár kihagyva: a Payload-példányon nincs ${what} (nem-production környezet — teszt/mock)`,
  )
  return fn()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A `fn` futtatása SESSION-szintű advisory-zár alatt, egy dedikált
 * pool-kapcsolaton, tranzakció nélkül.
 *
 * Miért nem a tranzakciós zár: a callback-feldolgozás és a számlázás a záron
 * belül HTTP-t is hív. A tranzakciós zár ilyenkor egy tétlen tranzakciót tart
 * nyitva, amit a Postgres 60 s után bont (a zár csendben elengedődik, és a
 * pg-pool a kiadott kliensről leveszi a hibafigyelőt, így a bontás
 * uncaughtException lesz — CLAUDE.md 7. tanulság). A session-zárnál nincs
 * tétlen tranzakció, a kapcsolat hibáját pedig saját figyelő kapja el.
 *
 * Minden úton elengedi a zárat ÉS a kapcsolatot:
 * - siker és a `fn` hibája: `pg_advisory_unlock`, majd a kapcsolat vissza a poolba;
 * - ha az unlock hibázik vagy hamisat ad, vagy a kapcsolat hibát jelzett, vagy
 *   egy zár-lekérdezés elbukott: a kapcsolatot a pool ELDOBJA
 *   (`release(error)`). Ez a Postgres oldalán is elengedi a session-zárat —
 *   egy zárat tartó kapcsolat soha nem kerül vissza a poolba;
 * - időtúllépés (`acquireTimeoutMs`): a `fn` nem fut, a kapcsolat visszakerül.
 *
 * A kapcsolat hibája (pl. a hálózat elvágta) a `fn` futása közben RIASZTÁS:
 * a zár a szerveren ilyenkor már elengedődött, egy párhuzamos futás
 * beléphetett. A `fn`-t nem szakítjuk meg (félbehagyott pénzügyi lépés
 * rosszabb volna), a védett utak ezért maguk is feltételes írással dolgoznak.
 */
export async function withSessionAdvisoryLock<T>(
  payload: Payload,
  lockKey: string,
  fn: () => Promise<T>,
  log: Logger = rootLogger,
  options: SessionAdvisoryLockOptions = {},
): Promise<T> {
  const lockLog = log.child({ module: 'advisory-lock', lockKey, lockLevel: 'session' })
  const pool = resolvePool(payload)
  if (!pool) {
    return runWithoutLock(lockLog, lockKey, fn, 'pg pool')
  }
  const acquireTimeoutMs = options.acquireTimeoutMs ?? SESSION_LOCK_ACQUIRE_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? SESSION_LOCK_POLL_INTERVAL_MS

  const client = await pool.connect()
  let clientError: Error | null = null
  let fnRunning = false
  const onClientError = (error: Error): void => {
    clientError ??= error
    lockLog.error(
      fnRunning
        ? 'RIASZTÁS: az advisory-zár kapcsolata megszakadt a védett szakasz közben — a zár ' +
            'elengedődött, egy párhuzamos futás beléphetett'
        : 'az advisory-zár kapcsolata megszakadt (a védett szakasz nem futott)',
      { error: error.message },
    )
  }
  client.on('error', onClientError)

  let acquired = false
  let destroyReason: Error | null = null
  try {
    const deadline = Date.now() + acquireTimeoutMs
    for (;;) {
      let locked: unknown
      try {
        // A kulcs KÖTÖTT paraméterként megy át ($1), mint a tranzakciós zárnál.
        const result = await client.query(
          'select pg_try_advisory_lock(hashtextextended($1::text, 0)) as locked',
          [lockKey],
        )
        locked = result.rows[0]?.locked
      } catch (queryError) {
        destroyReason = queryError instanceof Error ? queryError : new Error(String(queryError))
        throw queryError
      }
      if (locked === true) {
        acquired = true
        break
      }
      if (clientError) {
        throw clientError
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Az adatbázis-zár (${lockKey}) ${acquireTimeoutMs} ms alatt sem szerezhető meg — ` +
            'a művelet később újrapróbálható.',
        )
      }
      await sleep(pollIntervalMs)
    }
    fnRunning = true
    return await fn()
  } finally {
    fnRunning = false
    if (acquired && !clientError) {
      try {
        const result = await client.query(
          'select pg_advisory_unlock(hashtextextended($1::text, 0)) as unlocked',
          [lockKey],
        )
        if (result.rows[0]?.unlocked !== true) {
          destroyReason = new Error('pg_advisory_unlock: a zár nem ennél a kapcsolatnál volt')
          lockLog.warn('advisory-zár: az unlock nem talált zárat — a kapcsolat eldobva')
        }
      } catch (unlockError) {
        destroyReason = unlockError instanceof Error ? unlockError : new Error(String(unlockError))
        lockLog.warn(
          'advisory-zár: az unlock hibázott — a kapcsolat eldobva (a zár így elengedődik)',
          {
            error: destroyReason.message,
          },
        )
      }
    }
    if (clientError) {
      destroyReason = clientError
    }
    client.removeListener('error', onClientError)
    client.release(destroyReason ?? undefined)
  }
}

/**
 * A `fn` futtatása a `lockKey`-hez tartozó Postgres advisory-zár alatt.
 *
 * A zár PROCESSZEK KÖZÖTT is véd (ellentétben egy folyamaton belüli mutexszel),
 * tehát több Next.js-példány mellett is soros marad a védett szakasz.
 *
 * Ha a drizzle-példány nem oldható fel:
 * - PRODUCTION-ben ez néma zár-vesztés lenne (a hívó azt hinné, védve van),
 *   ezért riasztást naplózunk és DOBUNK — inkább látható hiba, mint csendben
 *   elveszített kölcsönös kizárás egy pénzügyi útvonalon;
 * - nem-production (teszt/mock) környezetben a `fn` zár nélkül fut, egy
 *   figyelmeztetéssel. Ez szándékos és dokumentált: a mockolt Payload-példányok
 *   nem hordoznak drizzle-t, és a lokális/CI-tesztfutást nem akarjuk emiatt
 *   valódi adatbázishoz kötni.
 */
export async function withAdvisoryLock<T>(
  payload: Payload,
  lockKey: string,
  fn: () => Promise<T>,
  log: Logger = rootLogger,
): Promise<T> {
  const lockLog = log.child({ module: 'advisory-lock', lockKey })
  const drizzle = resolveDrizzle(payload)

  if (!drizzle) {
    return runWithoutLock(lockLog, lockKey, fn, 'drizzle')
  }

  return drizzle.transaction(async (tx) => {
    // A kulcs KÖTÖTT paraméterként megy át ($1) — string-összefűzés nincs,
    // tehát a lockKey tartalma nem befolyásolhatja a lekérdezés szerkezetét.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`)
    return fn()
  })
}
