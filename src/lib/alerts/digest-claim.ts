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
 * Postgres advisory-zár alatt futtatja (`withAdvisoryLock`): a második példány
 * a zárra vár, és utána már látja a bejegyzést.
 */

import type { Payload } from 'payload'

import { auditLogStore, writeAuditLog } from '../audit'

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
