import type { Payload } from 'payload'

import { logger } from './logger'
import { getRequestId } from './request-id'

/**
 * Audit-log író segéd (T-015).
 *
 * Szabályok:
 * - Best-effort: SOSEM dob hibát a hívó felé — ha az írás elhasal (DB-hiba,
 *   séma-eltérés), az üzleti művelet attól még sikeres marad, a hiba
 *   logger.warn-nel naplózódik.
 * - A requestId-t a PayloadRequest fejléceiből veszi (a requestId-middleware
 *   állítja be), így az audit-sor korrelál a többi naplósorral.
 * - A before/after tartalomból a nyilvánvalóan érzékeny mezőket (jelszó-hash,
 *   token, só) tárolás előtt eltávolítja — a naplóredakcióval azonos kulcslista.
 */

export interface AuditLogDoc {
  id: number | string
}

/** Lásd a WebhookEventStore indoklását — a payload-types a migrációs loop végéig még nem ismeri ezt a collectiont. */
export interface AuditLogStore {
  create: (args: {
    collection: 'audit-logs'
    data: Record<string, unknown>
    overrideAccess?: boolean
  }) => Promise<AuditLogDoc>
}

export function auditLogStore(payload: Payload): AuditLogStore {
  return payload as unknown as AuditLogStore
}

/** A logger redact-listájával konzisztens, sosem tárolható kulcs-jelöltek. */
const SENSITIVE_KEY_MARKERS = [
  'password',
  'hash',
  'salt',
  'token',
  'secret',
  'apikey',
  'poskey',
  'authorization',
  'session',
  'loginattempts',
] as const

/**
 * Érzékeny-e a kulcs? RÉSZLEGES, kisbetűs illesztés: a `resetPasswordToken`,
 * `sessions` vagy `accessToken` is redaktilódjon — pontos egyezés mellett
 * ezek némán kiszivárogtak az audit-bejegyzésekbe (a before/after a teljes
 * dokumentumot hordozza). Az `email` szándékosan NEM marker: az audit-sor
 * értéke pont az azonosíthatóság.
 */
export function isSensitiveAuditKey(key: string): boolean {
  const lowered = key.toLowerCase()
  return SENSITIVE_KEY_MARKERS.some((marker) => lowered.includes(marker))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mélységkorlátos másolat az érzékeny kulcsok nélkül (körkörösség-biztos). */
export function stripSensitiveFields(
  value: unknown,
  seen: ReadonlySet<object> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item, seen))
  }
  if (!isPlainRecord(value)) {
    return value
  }
  if (seen.has(value)) {
    return null
  }
  const nextSeen = new Set(seen)
  nextSeen.add(value)
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveAuditKey(key)) {
      continue
    }
    output[key] = stripSensitiveFields(item, nextSeen)
  }
  return output
}

export interface WriteAuditLogArgs {
  store: AuditLogStore
  actor?: number | string | null
  action: string
  entityType?: string
  entityId?: number | string | null
  before?: unknown
  after?: unknown
  /** PayloadRequest vagy bármi, aminek Headers-féle fejlécei vannak. */
  req?: { headers?: Headers } | null
  ipAddress?: string | null
}

/**
 * Audit-bejegyzés írása. Visszatérési érték: sikerült-e az írás — a hívó
 * dönthet úgy, hogy naplózza, de hibát sosem kap vissza.
 */
export async function writeAuditLog(args: WriteAuditLogArgs): Promise<boolean> {
  const { store, req } = args
  try {
    const requestId = req?.headers ? getRequestId(req.headers) : undefined
    await store.create({
      collection: 'audit-logs',
      data: {
        action: args.action,
        ...(args.actor !== undefined && args.actor !== null ? { actor: args.actor } : {}),
        ...(args.entityType ? { entityType: args.entityType } : {}),
        ...(args.entityId !== undefined && args.entityId !== null
          ? { entityId: String(args.entityId) }
          : {}),
        ...(args.before !== undefined ? { before: stripSensitiveFields(args.before) } : {}),
        ...(args.after !== undefined ? { after: stripSensitiveFields(args.after) } : {}),
        ...(requestId ? { requestId } : {}),
        ...(args.ipAddress ? { ipAddress: args.ipAddress } : {}),
      },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    logger.warn('audit-bejegyzés írása sikertelen (best-effort)', {
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Kliens-IP proxy mögött: cf-connecting-ip csak TRUST_CF_CONNECTING_IP=true mellett;
 * egyébként x-forwarded-for jobbról TRUSTED_PROXY_HOP_COUNT eleme, tartalék x-real-ip.
 */

/** A `cf-connecting-ip` elfogadásának kapcsolója (alapértelmezés: NEM bízunk benne). */
function trustsCloudflareHeader(): boolean {
  return process.env.TRUST_CF_CONNECTING_IP?.trim().toLowerCase() === 'true'
}

/**
 * Hány `x-forwarded-for`-elemet fűz hozzá a SAJÁT infrastruktúránk (jobbról).
 * Érvénytelen vagy hiányzó érték → 1. A felső korlát a véletlen elgépelés ellen
 * véd: túl nagy hop-szám mellett a lánc elejére (a kliens által hamisítható
 * részre) csúsznánk vissza.
 */
function trustedProxyHopCount(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOP_COUNT)
  if (!Number.isInteger(raw) || raw < 1 || raw > 8) {
    return 1
  }
  return raw
}

/** Egy fejléc értéke, üres/whitespace-only értéket hiányzónak tekintve. */
function headerValue(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Az `x-forwarded-for` lánc MEGBÍZHATÓ eleme: a jobbról `hops`-adik nem üres
 * bejegyzés. Ha a lánc rövidebb, mint a hop-szám, a legbaloldalibb (tehát a
 * rendelkezésre álló legkorábbi) elemet adjuk — az sosem „több", mint amit a
 * proxy hozzáfűzött, tehát nem enged hamisítást, csak pontatlanabb.
 */
export function trustedForwardedForEntry(
  forwarded: string | undefined,
  hops: number,
): string | undefined {
  if (!forwarded) {
    return undefined
  }
  const entries = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (entries.length === 0) {
    return undefined
  }
  const index = Math.max(0, entries.length - hops)
  return entries[index]
}

export function resolveClientIp(headers: Headers | undefined): string | undefined {
  if (!headers) {
    return undefined
  }
  if (trustsCloudflareHeader()) {
    const cfIp = headerValue(headers, 'cf-connecting-ip')
    if (cfIp) {
      return cfIp
    }
  }
  const trusted = trustedForwardedForEntry(
    headerValue(headers, 'x-forwarded-for'),
    trustedProxyHopCount(),
  )
  if (trusted) {
    return trusted
  }
  return headerValue(headers, 'x-real-ip')
}
