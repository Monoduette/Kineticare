import type { Payload } from 'payload'
import { hasStaffOrOwnerRole } from '../../access/roles'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { SlidingWindowRateLimiter } from '../security/rate-limit'
import { readJsonWithCap } from '../security/request-body'
import { assertSameOrigin } from '../security/same-origin'
import { readBunnyLibraryConfig, type BunnyLibraryKind } from './bunny-library'

export interface BunnyAdminDeps {
  getPayload: () => Promise<Payload>
  fetchImpl?: typeof fetch
  now?: () => number
  limiter?: SlidingWindowRateLimiter
}

export class BunnyAdminError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function invalidInput(): never {
  throw new BunnyAdminError(400, 'invalid-input', 'A megadott adatok érvénytelenek.')
}

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export const BUNNY_VIDEO_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function libraryKind(value: unknown): BunnyLibraryKind {
  if (value !== 'protected' && value !== 'public') invalidInput()
  return value
}

export function libraryConfig(kind: BunnyLibraryKind) {
  const config = readBunnyLibraryConfig(kind)
  if (!config || !/^[1-9][0-9]{0,11}$/.test(config.libraryId)) {
    throw new BunnyAdminError(503, 'not-configured', 'A videótár jelenleg nincs beállítva.')
  }
  return config
}

export async function jsonObject(request: Request, keys: readonly string[]) {
  const parsed = await readJsonWithCap(request, 8192)
  if (!parsed.ok) {
    throw new BunnyAdminError(
      parsed.reason === 'too-large' ? 413 : 400,
      'invalid-input',
      'A kérés törzse érvénytelen vagy túl nagy.',
    )
  }
  const body = record(parsed.value)
  if (
    !body ||
    Object.keys(body).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(body, key))
  )
    invalidInput()
  return body
}

const limiter = new SlidingWindowRateLimiter()
type Operation = 'upload' | 'sign' | 'detail' | 'preview'
const limits = {
  upload: { limit: 5, windowMs: 600000 },
  sign: { limit: 20, windowMs: 60000 },
  detail: { limit: 60, windowMs: 60000 },
  preview: { limit: 20, windowMs: 60000 },
}

/** Fresh auth on every request; never log credentials, exceptions or upstream bodies. */
export function adminHandler<T>(
  deps: BunnyAdminDeps,
  operation: Operation,
  action: (
    request: Request,
    context: { payload: Payload; userId: string; authenticatedSessionId: unknown; now: number },
    arg: T,
  ) => Promise<unknown>,
) {
  return async (request: Request, arg: T): Promise<Response> => {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Request-ID': requestId,
    }
    try {
      const payload = await deps.getPayload()
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) throw new BunnyAdminError(401, 'unauthenticated', 'Bejelentkezés szükséges.')
      if (!hasStaffOrOwnerRole(user))
        throw new BunnyAdminError(
          403,
          'forbidden',
          'Munkatársi vagy tulajdonosi jogosultság szükséges.',
        )
      if (request.method !== (operation === 'detail' ? 'GET' : 'POST')) {
        throw new BunnyAdminError(405, 'method-not-allowed', 'Ez a kérésmód nem támogatott.')
      }
      if (operation !== 'detail') {
        if (!request.headers.get('origin')?.trim() || !assertSameOrigin(request).ok) {
          throw new BunnyAdminError(403, 'invalid-origin', 'A kérés eredete nem engedélyezett.')
        }
        if (
          request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
          'application/json'
        ) {
          throw new BunnyAdminError(415, 'invalid-content-type', 'JSON kérés szükséges.')
        }
      }
      const userId = `${typeof user.id}:${user.id}`
      const decision = (deps.limiter ?? limiter).check(
        `bunny-admin:${operation}:user:${userId}`,
        limits[operation],
      )
      if (!decision.allowed) {
        headers['Retry-After'] = String(decision.retryAfterSeconds)
        throw new BunnyAdminError(429, 'rate-limited', 'Túl sok próbálkozás. Próbáld újra később.')
      }
      const value = await action(
        request,
        {
          payload,
          userId,
          authenticatedSessionId: record(user)?._sid,
          now: Math.floor((deps.now?.() ?? Date.now()) / 1000),
        },
        arg,
      )
      return Response.json(value, { headers })
    } catch (error) {
      const safe =
        error instanceof BunnyAdminError
          ? error
          : new BunnyAdminError(500, 'internal', 'A videóművelet most nem érhető el.')
      if (safe.status >= 500)
        logger
          .child({ requestId, route: `admin-bunny-${operation}` })
          .warn('bunny-admin: sikertelen muvelet', { code: safe.code })
      return Response.json(
        { error: safe.message, code: safe.code, requestId },
        { status: safe.status, headers },
      )
    }
  }
}

export async function bunnyJson(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  body?: { title: string },
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        AccessKey: apiKey,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (!body && response.status === 404)
      throw new BunnyAdminError(404, 'not-found', 'A videó nem található.')
    if (!response.ok) throw new Error('upstream')
    return (await response.json()) as unknown
  } catch (error) {
    if (error instanceof BunnyAdminError) throw error
    throw new BunnyAdminError(
      502,
      body ? 'create-uncertain' : 'upstream',
      body
        ? 'A létrehozás eredménye bizonytalan. Új feltöltés előtt ellenőrizd a videótárat.'
        : 'A videótár most nem érhető el.',
    )
  }
}
