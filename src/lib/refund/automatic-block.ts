import type { Payload } from 'payload'
import type { RefundIntent } from '../../payload-types'
import { auditLogStore, writeAuditLog } from '../audit'
import { latestAutomaticFailure } from './automatic-retry'
import { isRecord, relationId } from './recovery-receipts'

/**
 * Az automatikus (paid-reject) visszatérítés tartós leállás-jelzése a rendelésen.
 *
 * Az újrapróbálási szabály (automatic-retry.ts) csak a kísérletek előzményéből
 * dönt. Van azonban olyan leállás, amely előtt kísérlet sem indul, így az
 * előzményben nem látszik: a friss GetState szerint a forrásra már van
 * visszatérítés (foreign-refund-detected, K17), a fizetés adatai
 * megváltoztak (source-transaction-unproven, pl. a Barion felületén részben
 * visszatérítették), vagy a fizetés maga nem egyezik a rendeléssel
 * (payment-state-unproven). Ezt egy audit-bejegyzés (entityType 'orders',
 * a rendszer a szereplő) rögzíti, és a tulajdonosi panel állapota ebből tudja,
 * hogy a rendszer NEM próbálkozik tovább, tehát nem ígérhet újrapróbálást vagy
 * tárca-feltöltést.
 *
 * A jelzés addig érvényes, amíg utána nem zárult le újabb automatikus
 * kísérlet: ha a feltétel megszűnik és a rendszer újra indít, az új kísérlet
 * kimenete dönt. Az audit-log `action` mezője szöveg, új érték nem igényel
 * migrációt (src/collections/AuditLogs.ts).
 */
export const AUTOMATIC_REFUND_BLOCKED_ACTION = 'automatic-refund-blocked'

export const AUTOMATIC_REFUND_BLOCK_DETAILS = [
  'foreign-refund-detected',
  'source-transaction-unproven',
  'payment-state-unproven',
] as const

export type AutomaticRefundBlockDetail = (typeof AUTOMATIC_REFUND_BLOCK_DETAILS)[number]

export interface AutomaticRefundBlock {
  detail: AutomaticRefundBlockDetail
  observedAt: string
}

/** Egy rendelésen ennél több leállás-bejegyzés nem keletkezhet észszerűen; több = olvasási hiba. */
const MAX_BLOCK_RECORDS = 1000

function isBlockDetail(value: unknown): value is AutomaticRefundBlockDetail {
  return (
    typeof value === 'string' &&
    (AUTOMATIC_REFUND_BLOCK_DETAILS as readonly string[]).includes(value)
  )
}

/**
 * A rendelés legutóbbi leállás-jelzése (null, ha nincs). Csonka vagy
 * érvénytelen olvasásnál dob: a hívó ilyenkor nem állíthat rendezett állapotot.
 */
export async function readLatestAutomaticRefundBlock(
  payload: Payload,
  orderId: number,
): Promise<AutomaticRefundBlock | null> {
  const found = await payload.find({
    collection: 'audit-logs',
    where: {
      and: [
        { action: { equals: AUTOMATIC_REFUND_BLOCKED_ACTION } },
        { entityType: { equals: 'orders' } },
        { entityId: { equals: String(orderId) } },
      ],
    },
    limit: MAX_BLOCK_RECORDS,
    depth: 0,
    overrideAccess: true,
  })
  if (found.hasNextPage || found.totalDocs !== found.docs.length)
    throw new Error('automatic refund block: incomplete lookup')
  let latest: AutomaticRefundBlock | null = null
  for (const event of found.docs) {
    const after: unknown = event.after
    if (
      event.action !== AUTOMATIC_REFUND_BLOCKED_ACTION ||
      event.entityType !== 'orders' ||
      event.entityId !== String(orderId) ||
      relationId(event.actor) !== null ||
      !isRecord(after) ||
      after.version !== 1 ||
      !isBlockDetail(after.detail) ||
      typeof after.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(after.observedAt))
    )
      throw new Error('automatic refund block: invalid record')
    if (!latest || Date.parse(after.observedAt) > Date.parse(latest.observedAt))
      latest = { detail: after.detail, observedAt: after.observedAt }
  }
  return latest
}

/** A jelzés érvényes-e: az utolsó lezárt automatikus kísérlet után keletkezett. */
export function isCurrentAutomaticRefundBlock(
  block: AutomaticRefundBlock | null,
  failures: readonly RefundIntent[],
): block is AutomaticRefundBlock {
  if (!block) return false
  const last = latestAutomaticFailure(failures)
  if (!last) return true
  const resolvedAt = Date.parse(String(last.providerResolvedAt))
  return !Number.isFinite(resolvedAt) || Date.parse(block.observedAt) > resolvedAt
}

/**
 * Leállás rögzítése a rendelés-zár alatt. Idempotens: ha már van érvényes
 * jelzés ugyanezzel az okkal, nem ír újat (az 5 perces poll nem szaporítja).
 * Az írás best-effort (writeAuditLog nem dob); elveszett írásnál a következő
 * futás pótolja. Visszaadja, hogy most keletkezett-e új bejegyzés.
 */
export async function recordAutomaticRefundBlock(
  payload: Payload,
  input: {
    orderId: number
    detail: AutomaticRefundBlockDetail
    failures: readonly RefundIntent[]
    now: Date
  },
): Promise<boolean> {
  const latest = await readLatestAutomaticRefundBlock(payload, input.orderId)
  if (isCurrentAutomaticRefundBlock(latest, input.failures) && latest.detail === input.detail)
    return false
  return writeAuditLog({
    store: auditLogStore(payload),
    actor: null,
    action: AUTOMATIC_REFUND_BLOCKED_ACTION,
    entityType: 'orders',
    entityId: input.orderId,
    after: { version: 1, detail: input.detail, observedAt: input.now.toISOString() },
  })
}
