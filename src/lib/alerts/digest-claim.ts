/**
 * A napi összesítő tartós, napi „elküldve” nyoma.
 *
 * MIÉRT KELL: a küldés-állapot (`DigestState`) folyamaton belüli. Egy 07:00
 * utáni újraindulás vagy deploy után a friss folyamat nem tudja, hogy aznap
 * már ment levél; a Resend idempotenciakulcsa ezt kivédi, az SMTP-tartalék
 * viszont nem (PR #305, Codex P2). Két, átfedő példány (deploy) pedig egyszerre
 * is küldhetne.
 *
 * HOVÁ: a meglévő `audit-logs` gyűjteménybe (src/collections/AuditLogs.ts),
 * egy `daily-digest-sent` bejegyzés Budapest-naponként. Séma- és
 * jogosultság-változás nem kell: a rendszer `overrideAccess`-szel ír és olvas
 * (ugyanígy dolgoznak a refund-nyugták, src/lib/refund/recovery-receipts.ts),
 * a bejegyzés API-n át nem módosítható és nem törölhető, olvasni csak a
 * tulajdonos tudja. A bejegyzés személyes adatot nem tartalmaz (címzett
 * nincs benne, csak a nap, a teendők száma és a szolgáltató neve).
 *
 * ATOMITÁS: az `audit-logs`-on nincs egyedi megszorítás, ezért a „nézd meg,
 * küldd el, írd be” lépést a hívó (`runDailyDigestIfDue`) napi kulcsú
 * Postgres advisory-zár alatt futtatja (`withDigestTryLock`). A zárra NEM
 * várunk: a küldés (SMTP-n lépésenként 15 s) a zár alatt fut, és egy várakozó
 * zár a pool 30 s-os statement_timeoutjába futna, ami hamis „a reggeli levél
 * elmarad” riasztást adna (PR #305, breaker). Ha a zár foglalt, egy másik
 * példány épp küld; a hívó ilyenkor csendben kihagyja a kört, és a következő
 * futás a napi nyomot látva már nem küld. A zár session-szintű, tranzakció
 * nélkül, hogy a hosszú küldés alatt se az idle-in-transaction időkorlát, se
 * egy megszakadt kapcsolat ne bántsa a folyamatot (lásd `withDigestTryLock`).
 */

import type { Payload } from 'payload'

import { auditLogStore, writeAuditLog } from '../audit'
import type { Logger } from '../logger'

/** A napi összesítő elküldésének nyoma az audit-logs `action` mezőjében. */
export const DIGEST_SENT_ACTION = 'daily-digest-sent'

/** Az `entityType`; az `entityId` a Budapest-nap (ÉÉÉÉ-HH-NN). */
export const DIGEST_ENTITY_TYPE = 'daily-digest'

/** Az éles Payload-példány, amelyen a nyom olvasható és írható. */
export type DigestClaimPayload = Pick<Payload, 'find' | 'create'>

/**
 * A payload írni is tud-e. Az order-poll az éles példányt adja át; a
 * `DigestDeps` típusa csak az olvasást ígéri, ezért szerkezetileg ellenőrzünk.
 */
export function asDigestClaimPayload(payload: Pick<Payload, 'find'>): DigestClaimPayload | null {
  const candidate = payload as Partial<Pick<Payload, 'create'>>
  return typeof candidate.create === 'function' ? (payload as DigestClaimPayload) : null
}

/** Van-e már „elküldve” nyom a napra. Adatbázis-hiba esetén dob. */
export async function digestSentOn(payload: DigestClaimPayload, day: string): Promise<boolean> {
  const found = await payload.find({
    collection: 'audit-logs',
    where: {
      and: [
        { action: { equals: DIGEST_SENT_ACTION } },
        { entityType: { equals: DIGEST_ENTITY_TYPE } },
        { entityId: { equals: day } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return found.totalDocs > 0 || found.docs.length > 0
}

/** A napi nyom tartalma: a teendők száma és a levelet vivő szolgáltató neve. */
export interface DigestClaimAfter {
  readonly teendo: number
  readonly provider: string
}

/**
 * A napi nyom beírása a sikeres küldés után. Nem dob (a `writeAuditLog`
 * best-effort); a visszatérési érték mondja meg, sikerült-e.
 */
export async function recordDigestSent(
  payload: DigestClaimPayload,
  day: string,
  after: DigestClaimAfter,
): Promise<boolean> {
  return writeAuditLog({
    store: auditLogStore(payload as unknown as Payload),
    action: DIGEST_SENT_ACTION,
    entityType: DIGEST_ENTITY_TYPE,
    entityId: day,
    after: { day, ...after },
  })
}

/**
 * A zár saját, poolból kivett kapcsolatának minimális, szerkezeti felülete
 * (a `pg` `PoolClient`-je).
 */
interface DigestLockClient {
  query(text: string, values: readonly unknown[]): Promise<unknown>
  on(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  /** Hibával hívva a pool eldobja a kapcsolatot (a session vége minden zárat elenged). */
  release(error?: Error): void
}

interface DigestLockPool {
  connect(): Promise<DigestLockClient>
}

/** A Payload postgres-adapterének `pg` poolja, ha van (vö. payload.config.ts). */
function resolvePool(payload: Partial<Pick<Payload, 'db'>>): DigestLockPool | null {
  const db = payload.db as unknown as { pool?: unknown } | undefined
  const candidate = db?.pool
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { connect?: unknown }).connect === 'function'
  ) {
    return candidate as DigestLockPool
  }
  return null
}

/** Egy logikai oszlop az első sorból; értelmezhetetlen válasznál dob (fail-closed). */
function booleanColumn(result: unknown, column: string): boolean {
  const rows =
    typeof result === 'object' && result !== null ? (result as { rows?: unknown }).rows : undefined
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined
  const value =
    typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[column] : undefined
  if (typeof value !== 'boolean') {
    throw new Error('a napi összesítő zárának válasza nem értelmezhető')
  }
  return value
}

// A kulcs kötött paraméterként megy át ($1), string-összefűzés nincs.
const TRY_LOCK_SQL = 'select pg_try_advisory_lock(hashtextextended($1::text, 0)) as locked'
const UNLOCK_SQL = 'select pg_advisory_unlock(hashtextextended($1::text, 0)) as unlocked'

/**
 * A session-szintű zár elengedése. Csak akkor ad `true`-t, ha a Postgres
 * visszaigazolta; minden más esetben a hívó eldobja a kapcsolatot, mert egy
 * zárat tartó session a poolba visszakerülve aznapra minden összesítőt
 * `folyamatban`-ra állítana.
 */
async function unlockDigestLock(
  client: DigestLockClient,
  lockKey: string,
  log: Logger,
): Promise<boolean> {
  try {
    if (booleanColumn(await client.query(UNLOCK_SQL, [lockKey]), 'unlocked')) {
      return true
    }
    log.warn('napi összesítő: a zár elengedésekor a kapcsolat nem tartotta a zárat', { lockKey })
  } catch (error) {
    log.warn('napi összesítő: a zár elengedése nem sikerült, a kapcsolatot eldobjuk', {
      lockKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return false
}

export type DigestLockResult<T> =
  { readonly acquired: true; readonly value: T } | { readonly acquired: false }

/**
 * A `fn` a napi összesítő `lockKey` kulcsú advisory-zárja alatt, várakozás
 * nélkül. A kulcs ugyanúgy képződik, mint a `withAdvisoryLock`-nál
 * (`hashtextextended(kulcs, 0)`), így a két zárfajta ugyanazt a zárat látja.
 *
 * SESSION-SZINTŰ zár egy saját, poolból kivett kapcsolaton, TRANZAKCIÓ
 * NÉLKÜL (PR #305, breaker). A `fn` (a levélküldés) SMTP-n percekig is
 * tarthat; egy nyitott zár-tranzakciót a pool 60 s-os
 * `idle_in_transaction_session_timeout`-ja közben megölne. Tranzakció nélkül
 * ez az időkorlát nem vonatkozik a kapcsolatra. Ha a kapcsolat mégis
 * megszakad (Postgres-újraindulás, hálózat), a kivett kliens `error`
 * eseményét itt kezeljük: kezelő nélkül a Node `uncaughtException`-ként
 * vinné el a szerverfolyamatot (CLAUDE.md 7. tanulság). A kapcsolatot a pool
 * eldobja, a zárat a Postgres a session végén engedi el: ha a szerver bontott
 * (újraindulás, pg_terminate_backend), azonnal; ha a kapcsolat a kliens
 * oldalán szakadt meg, csak amikor a szerver is észleli (TCP keepalive, lásd
 * a `runDailyDigestIfDue` ismert réseit).
 *
 * Ha a zár foglalt, a `fn` nem fut, és `{ acquired: false }` a válasz. Ha a
 * pool nem oldható fel, a `withAdvisoryLock` szabálya érvényes: productionben
 * dob, teszt/mock környezetben figyelmeztetéssel zár nélkül fut. A `fn` nem a
 * zár kapcsolatán fut (a Payload-írás saját kapcsolatot használ).
 */
export async function withDigestTryLock<T>(
  payload: Partial<Pick<Payload, 'db'>>,
  lockKey: string,
  fn: () => Promise<T>,
  log: Logger,
): Promise<DigestLockResult<T>> {
  const pool = resolvePool(payload)
  if (!pool) {
    if (process.env.NODE_ENV === 'production') {
      log.error(
        'RIASZTÁS: a napi összesítő zárja nem szerezhető meg (nincs adatbázis-pool), a levél zár nélkül nem mehet ki',
        { lockKey },
      )
      throw new Error(`Az adatbázis-zár nem szerezhető meg (${lockKey}).`)
    }
    log.warn('napi összesítő: advisory-zár kihagyva, a Payload-példányon nincs pool (teszt/mock)', {
      lockKey,
    })
    return { acquired: true, value: await fn() }
  }

  const client = await pool.connect()
  const connection: { error?: Error } = {}
  const onError = (error: Error): void => {
    connection.error ??= error
    // Csak azt mondjuk, amit a kliens tud: a zárat a Postgres a session végén
    // engedi el, és ez kliensoldali szakadásnál később is lehet.
    log.warn(
      'napi összesítő: a zár kapcsolata megszakadt, a kapcsolatot eldobjuk; a zárat a Postgres a session végén engedi el',
      { lockKey, error: error.message },
    )
  }
  client.on('error', onError)
  // Csak ép, zárat már nem tartó kapcsolat mehet vissza a poolba.
  let reusable = false
  try {
    if (!booleanColumn(await client.query(TRY_LOCK_SQL, [lockKey]), 'locked')) {
      reusable = true
      return { acquired: false }
    }
    try {
      return { acquired: true, value: await fn() }
    } finally {
      reusable = connection.error === undefined && (await unlockDigestLock(client, lockKey, log))
    }
  } finally {
    if (reusable && connection.error === undefined) {
      client.removeListener('error', onError)
      client.release()
    } else {
      // Az eldobott kapcsolat késői hibáit is ez a kezelő nyeli el.
      client.release(
        connection.error ?? new Error('a napi összesítő zár-kapcsolata nem tehető vissza a poolba'),
      )
    }
  }
}
