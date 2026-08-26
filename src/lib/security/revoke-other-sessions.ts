/**
 * Más sessionök visszavonása jelszó-/e-mail-csere után (OWASP). Csak a saját
 * `sid` marad; reset-útvonalon az afterLogin kezeli.
 */

import type { Payload, PayloadRequest } from 'payload'

import { createLogger } from '../logger'

const logger = createLogger({ module: 'users-sessions' })

/** A beforeChange → afterChange zászló a `req.context`-ben. */
export const CREDENTIAL_CHANGE_REVOKE_KEY = 'kineticareRevokeOtherSessions'

export interface AuthSession {
  id: string
  createdAt?: string | Date | null
  expiresAt: string | Date
}

export function isPasswordChanged(data: { password?: unknown }): boolean {
  return typeof data.password === 'string' && data.password.length > 0
}

export function isEmailChanged(input: {
  currentEmail: string | undefined
  nextEmail: string | undefined
}): boolean {
  return input.nextEmail !== undefined && input.nextEmail !== input.currentEmail
}

export function shouldMarkCredentialChangeForSessionRevoke(input: {
  operation: string
  passwordChanged: boolean
  emailChanged: boolean
}): boolean {
  return input.operation === 'update' && (input.passwordChanged || input.emailChanged)
}

export function isPasswordResetRequest(req: {
  url?: unknown
  pathname?: unknown
  path?: unknown
}): boolean {
  const haystack = [req.url, req.pathname, req.path]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  return /reset-password/i.test(haystack)
}

export function readSidFromJwtPayload(token: string): string | null {
  const parts = token.split('.')
  const payloadPart = parts[1]
  if (parts.length < 2 || !payloadPart) {
    return null
  }
  try {
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const sid = (parsed as { sid?: unknown }).sid
    return typeof sid === 'string' && sid.length > 0 ? sid : null
  } catch {
    return null
  }
}

export function resolveSidToKeep(input: {
  actorId: unknown
  targetId: unknown
  actorSid: string | null | undefined
  jwtSid?: string | null
}): string | null {
  const jwtSid = input.jwtSid ?? null
  const actorSid = input.actorSid ?? null
  if (input.actorId == null || input.targetId == null) {
    return actorSid ?? jwtSid
  }
  if (String(input.actorId) !== String(input.targetId)) {
    return null
  }
  return actorSid ?? jwtSid
}

export function sessionsAfterCredentialChange(input: {
  sessions: AuthSession[] | null | undefined
  keepSid: string | null
  now?: Date
}): AuthSession[] {
  if (!input.keepSid) {
    return []
  }
  const now = input.now ?? new Date()
  return (input.sessions ?? []).filter((session) => {
    if (session.id !== input.keepSid) {
      return false
    }
    const expiry =
      session.expiresAt instanceof Date ? session.expiresAt : new Date(session.expiresAt)
    return expiry.getTime() > now.getTime()
  })
}

export function sessionIdsChanged(
  current: AuthSession[] | null | undefined,
  next: AuthSession[],
): boolean {
  const currentIds = new Set((current ?? []).map((session) => session.id))
  const nextIds = new Set(next.map((session) => session.id))
  if (currentIds.size !== nextIds.size) {
    return true
  }
  for (const id of nextIds) {
    if (!currentIds.has(id)) {
      return true
    }
  }
  return false
}

function serializeSession(session: AuthSession): {
  id: string
  createdAt?: string
  expiresAt: string
} {
  const expiresAt =
    session.expiresAt instanceof Date ? session.expiresAt.toISOString() : session.expiresAt
  if (session.createdAt == null) {
    return { id: session.id, expiresAt }
  }
  const createdAt =
    session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt
  return { id: session.id, createdAt, expiresAt }
}

function readActorSid(user: unknown): string | null {
  if (typeof user !== 'object' || user === null) {
    return null
  }
  const sid = (user as { _sid?: unknown })._sid
  return typeof sid === 'string' && sid.length > 0 ? sid : null
}

function readActorId(user: unknown): unknown {
  if (typeof user !== 'object' || user === null) {
    return undefined
  }
  return (user as { id?: unknown }).id
}

export async function revokeOtherSessionsForUser(input: {
  payload: Payload
  req: PayloadRequest
  targetId: string | number
  actorId: unknown
  actorSid: string | null | undefined
  jwtSid?: string | null
}): Promise<{ wrote: boolean; kept: number; revoked: number }> {
  const db = input.payload.db
  const empty = { wrote: false, kept: 0, revoked: 0 }
  if (!db || typeof db.findOne !== 'function' || typeof db.updateOne !== 'function') {
    return empty
  }

  const current = await db.findOne({
    collection: 'users',
    req: input.req,
    where: { id: { equals: input.targetId } },
  })
  if (!current) {
    return empty
  }

  const currentRecord = current as { sessions?: AuthSession[] | null }
  const currentSessions = Array.isArray(currentRecord.sessions) ? currentRecord.sessions : []
  const keepSid = resolveSidToKeep({
    actorId: input.actorId,
    targetId: input.targetId,
    actorSid: input.actorSid,
    jwtSid: input.jwtSid,
  })
  const nextSessions = sessionsAfterCredentialChange({
    sessions: currentSessions,
    keepSid,
  }).map(serializeSession)

  if (!sessionIdsChanged(currentSessions, nextSessions)) {
    return { wrote: false, kept: nextSessions.length, revoked: 0 }
  }

  const revoked = currentSessions.length - nextSessions.length
  await db.updateOne({
    id: input.targetId,
    collection: 'users',
    data: {
      ...current,
      sessions: nextSessions,
      // A Payload logout/addSession mintája: session-írás ne mozdítsa az updatedAt-et.
      updatedAt: null,
    },
    req: input.req,
    returning: false,
  })

  return { wrote: true, kept: nextSessions.length, revoked }
}

export async function revokeOtherSessionsAfterCredentialChange(args: {
  doc: { id?: unknown; sessions?: AuthSession[] | null }
  operation: string
  req: PayloadRequest
  context?: Record<string, unknown>
}): Promise<void> {
  if (args.operation !== 'update') {
    return
  }
  if (args.context?.[CREDENTIAL_CHANGE_REVOKE_KEY] !== true) {
    return
  }
  if (args.req.context) {
    args.req.context[CREDENTIAL_CHANGE_REVOKE_KEY] = false
  }
  const targetId = args.doc.id
  if (typeof targetId !== 'number' && typeof targetId !== 'string') {
    return
  }
  try {
    const result = await revokeOtherSessionsForUser({
      payload: args.req.payload,
      req: args.req,
      targetId,
      actorId: readActorId(args.req.user),
      actorSid: readActorSid(args.req.user),
    })
    if (result.wrote) {
      logger.info('más eszközök kijelentkeztetve hitelesítési-adat csere után', {
        userId: targetId,
        kept: result.kept,
        revoked: result.revoked,
      })
    }
  } catch (error) {
    logger.warn('más sessionök visszavonása jelszócsere után sikertelen (best-effort)', {
      userId: targetId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function revokeOtherSessionsAfterPasswordReset(args: {
  req: PayloadRequest
  user: { id?: unknown }
  token?: string
}): Promise<void> {
  if (!isPasswordResetRequest(args.req)) {
    return
  }
  const targetId = args.user.id
  if (typeof targetId !== 'number' && typeof targetId !== 'string') {
    return
  }
  try {
    const result = await revokeOtherSessionsForUser({
      payload: args.req.payload,
      req: args.req,
      targetId,
      actorId: readActorId(args.req.user) ?? targetId,
      actorSid: readActorSid(args.req.user),
      jwtSid: typeof args.token === 'string' ? readSidFromJwtPayload(args.token) : null,
    })
    if (result.wrote) {
      logger.info('más eszközök kijelentkeztetve jelszó-visszaállítás után', {
        userId: targetId,
        kept: result.kept,
        revoked: result.revoked,
      })
    }
  } catch (error) {
    logger.warn('más sessionök visszavonása jelszó-visszaállítás után sikertelen (best-effort)', {
      userId: targetId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
