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
 * várunk: a küldés (SMTP-n lépésenként 15 s) a zár alatt fut, és a várakozó
 * `pg_advisory_xact_lock` a pool 30 s-os statement_timeoutjába futna, ami
 * hamis „a reggeli levél elmarad” riasztást adna (PR #305, breaker). Ha a zár
 * foglalt, egy másik példány épp küld; a hívó ilyenkor csendben kihagyja a
 * kört, és a következő futás a napi nyomot látva már nem küld.
 */

import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
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

/**
 * A napi nyom beírása a sikeres küldés után. Nem dob (a `writeAuditLog`
 * best-effort); a visszatérési érték mondja meg, sikerült-e.
 */
export async function recordDigestSent(
  payload: DigestClaimPayload,
  day: string,
  after: { readonly teendo: number; readonly provider: string },
): Promise<boolean> {
  return writeAuditLog({
    store: auditLogStore(payload as unknown as Payload),
    action: DIGEST_SENT_ACTION,
    entityType: DIGEST_ENTITY_TYPE,
    entityId: day,
    after: { day, ...after },
  })
}

/** A zár-tranzakció minimális, szerkezeti felülete (a drizzle-példányból). */
interface TryLockTransaction {
  execute(query: SQL): Promise<unknown>
}

interface TryLockDrizzle {
  transaction<T>(run: (tx: TryLockTransaction) => Promise<T>): Promise<T>
}

/** A Payload postgres-adapterének drizzle-példánya, ha van (vö. advisory-lock.ts). */
function resolveDrizzle(payload: Partial<Pick<Payload, 'db'>>): TryLockDrizzle | null {
  const db = payload.db as unknown as { drizzle?: unknown } | undefined
  const candidate = db?.drizzle
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { transaction?: unknown }).transaction === 'function'
  ) {
    return candidate as TryLockDrizzle
  }
  return null
}

/** A `pg_try_advisory_xact_lock` válasza; értelmezhetetlen válasznál dob (fail-closed). */
function lockAcquired(result: unknown): boolean {
  const rows =
    typeof result === 'object' && result !== null ? (result as { rows?: unknown }).rows : undefined
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined
  const locked =
    typeof row === 'object' && row !== null ? (row as { locked?: unknown }).locked : undefined
  if (typeof locked !== 'boolean') {
    throw new Error('a napi összesítő zárának válasza nem értelmezhető')
  }
  return locked
}

export type DigestLockResult<T> =
  { readonly acquired: true; readonly value: T } | { readonly acquired: false }

/**
 * A `fn` a napi összesítő `lockKey` kulcsú advisory-zárja alatt, várakozás
 * nélkül. A kulcs ugyanúgy képződik, mint a `withAdvisoryLock`-nál
 * (`hashtextextended(kulcs, 0)`), így a két zárfajta ugyanazt a zárat látja.
 *
 * Ha a zár foglalt, a `fn` nem fut, és `{ acquired: false }` a válasz. Ha a
 * drizzle-példány nem oldható fel, a `withAdvisoryLock` szabálya érvényes:
 * productionben dob, teszt/mock környezetben figyelmeztetéssel zár nélkül fut.
 * A `fn` nem a zár tranzakciójában fut (a Payload-írás saját kapcsolatot
 * használ), a zár-tranzakció a futása alatt tétlen.
 */
export async function withDigestTryLock<T>(
  payload: Partial<Pick<Payload, 'db'>>,
  lockKey: string,
  fn: () => Promise<T>,
  log: Logger,
): Promise<DigestLockResult<T>> {
  const drizzle = resolveDrizzle(payload)
  if (!drizzle) {
    if (process.env.NODE_ENV === 'production') {
      log.error(
        'RIASZTÁS: a napi összesítő zárja nem szerezhető meg (nincs drizzle-példány), a levél zár nélkül nem mehet ki',
        { lockKey },
      )
      throw new Error(`Az adatbázis-zár nem szerezhető meg (${lockKey}).`)
    }
    log.warn(
      'napi összesítő: advisory-zár kihagyva, a Payload-példányon nincs drizzle (teszt/mock)',
      {
        lockKey,
      },
    )
    return { acquired: true, value: await fn() }
  }
  return drizzle.transaction(async (tx) => {
    // A kulcs kötött paraméterként megy át ($1), string-összefűzés nincs.
    const result = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey}::text, 0)) as locked`,
    )
    if (!lockAcquired(result)) {
      return { acquired: false }
    }
    return { acquired: true, value: await fn() }
  })
}
