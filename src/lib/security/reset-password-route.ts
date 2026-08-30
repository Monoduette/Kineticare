/**
 * POST /api/users/reset-password — a jelszó-politika a reset-ágon is fusson.
 *
 * A Payload `resetPasswordOperation` megkerüli a Users `beforeChange` hookot
 * (hash után ír `db.updateOne`-nal). Ez a konkrét Next-route a catch-all elé
 * kerül, ellenőriz, majd `forwardToPayload`. A GraphQL `resetPasswordUser`
 * ugyanitt menne el — `graphQL.disable` tartja zárva. Token soha nem naplózandó.
 */

import type { Payload } from 'payload'

import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { formatPasswordPolicyErrors, validatePasswordStrength } from './password-policy'
import {
  checkRequestRateLimit,
  payloadRestRateLimitResponse,
  type CheckRequestRateLimitOptions,
} from './rate-limit'
import { DEFAULT_JSON_BODY_MAX_BYTES, readBodyBytesWithCap } from './request-body'
import { assertSameOrigin } from './same-origin'

export interface ResetPasswordHandlerDeps {
  /** Payload-példány — a tokenhez tartozó e-mail feloldásához. */
  getPayload: () => Promise<Payload>
  /**
   * A Payload beépített `/api/users/reset-password` végpontja. A politika
   * átmenetele UTÁN ide delegálunk, változatlan kéréssel.
   */
  forwardToPayload: (request: Request) => Promise<Response>
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös, folyamaton belüli számláló. */
  rateLimit?: CheckRequestRateLimitOptions
}

/** Hiányzó vagy nem szöveges token/jelszó — a két esetet szándékosan nem különböztetjük meg. */
export const RESET_MISSING_INPUT_MESSAGE =
  'Hiányzó adat: a jelszó-visszaállító link és az új jelszó is szükséges.'

export const RESET_INVALID_BODY_MESSAGE =
  'A jelszó módosítása nem indítható: a küldött adat nem értelmezhető. Frissítsd az oldalt, és próbáld újra.'

export const RESET_BODY_TOO_LARGE_MESSAGE =
  'A jelszó módosítása nem indítható: a küldött adat túl nagy.'

export const RESET_UNEXPECTED_ERROR_MESSAGE =
  'A jelszó módosítása most nem sikerült. Próbáld újra néhány perc múlva.'

export const RESET_PASSWORD_BODY_MAX_BYTES = DEFAULT_JSON_BODY_MAX_BYTES

interface ResetPasswordRequestBody {
  token?: unknown
  password?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `null` = a törzs nem értelmezhető (a hívó 400-at ad rá). */
function parseJsonObject(raw: string): ResetPasswordRequestBody | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return null
  }
}

/**
 * A kérés adatainak kiolvasása — a Payload `addDataAndFileToRequest`
 * segédletének viselkedését tükrözve.
 *
 * KÉT formátum érkezik erre a végpontra:
 *  - `application/json` — a nyilvános űrlap (`src/lib/auth-client.ts`) és a
 *    közvetlen REST-hívók;
 *  - `multipart/form-data` — a Payload ADMIN reset-oldala
 *    (`/admin/reset/<token>`): a `@payloadcms/ui` Form komponense FormData-t
 *    küld, és a mezőket egyetlen `_payload` nevű JSON-sztringbe csomagolja.
 *
 * A multipart-ág elhagyása némán eltörné az admin jelszó-beállítását, ezért
 * mindkettőt értjük. Minden más content-type-nál a Payload sem tölti ki a
 * `req.data`-t, tehát az üres bemenettel egyenértékű (→ hiányzó adat).
 *
 * Az eredeti törzset egyszer, byte-limittel olvassuk; siker esetén ugyanebből a
 * bounded byte-sorból rekonstruált, azonos URL/method/header kérés megy tovább.
 */
type ReadRequestDataResult =
  { forwardRequest: Request; ok: true; value: ResetPasswordRequestBody } | {
    ok: false
    reason: 'invalid' | 'too-large'
  }

function requestFromBoundedBytes(request: Request, bytes: Uint8Array<ArrayBuffer>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: new Headers(request.headers),
    body: bytes,
  })
}

async function readRequestData(request: Request): Promise<ReadRequestDataResult> {
  // Az eredeti streamet pontosan egyszer olvassuk. A clone()/tee() lassabb ága
  // chunked kérésnél korlátlanul bufferelhetne, ezért itt nem használható.
  const bytes = await readBodyBytesWithCap(request, RESET_PASSWORD_BODY_MAX_BYTES)
  if (bytes === null) {
    return { ok: false, reason: 'too-large' }
  }
  const forwardRequest = requestFromBoundedBytes(request, bytes)
  const contentType = (request.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (contentType.startsWith('multipart/')) {
    try {
      const parseRequest = requestFromBoundedBytes(request, bytes)
      const raw = (await parseRequest.formData()).get('_payload')
      if (typeof raw !== 'string') {
        return { forwardRequest, ok: true, value: {} }
      }
      const parsed = parseJsonObject(raw)
      return parsed === null
        ? { ok: false, reason: 'invalid' }
        : { forwardRequest, ok: true, value: parsed }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  const raw = new TextDecoder().decode(bytes)
  const parsed = parseJsonObject(raw)
  return parsed === null
    ? { ok: false, reason: 'invalid' }
    : { forwardRequest, ok: true, value: parsed }
}

/**
 * A token és a jelszó nyersen, TRIMELÉS NÉLKÜL kell: a tokent bájtra pontosan
 * a Payload hasonlítja össze, a jelszó pedig tartalmazhat szándékos szóközt.
 */
function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Payload REST alakú hibaválasz — ezt érti az auth-kliens és az admin űrlap is. */
function errorResponse(message: string, status: number): Response {
  return Response.json({ errors: [{ message }] }, { status })
}

/**
 * A tokenhez tartozó e-mail-cím feloldása — kizárólag a politika
 * „a jelszó ne tartalmazza az e-mail-címedet" szabályához.
 *
 * A szűrés a `resetPasswordOperation` feltételét tükrözi (érvényes token +
 * még le nem járt érvényesség), így a hívó pontosan akkor kap címet, amikor a
 * Payload is elfogadná a tokent. Ez NEM ad új információt a hívónak: a
 * végeredményből (siker vagy 403) a token érvényessége amúgy is látszik.
 */
async function resolveEmailForToken(payload: Payload, token: string): Promise<string | undefined> {
  const { docs } = await payload.find({
    collection: 'users',
    where: {
      resetPasswordToken: { equals: token },
      resetPasswordExpiration: { greater_than: new Date().toISOString() },
    },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })
  const email = docs[0]?.email
  return typeof email === 'string' && email.length > 0 ? email : undefined
}

export function createResetPasswordHandler(
  deps: ResetPasswordHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'users-reset-password' })

    // A sikeres reset session-sütit állíthat — idegen Originű POST CSRF.
    // A válasz a handler Payload-alakját tartja ({ errors: [{ message }] }),
    // mert azt olvassa az auth-kliens és az admin reset-űrlap.
    const originCheck = assertSameOrigin(request)
    if (!originCheck.ok) {
      log.warn('reset-password: idegen eredet elutasítva')
      return errorResponse(originCheck.message, originCheck.status)
    }

    // IP-alapú throttle (A2) — a `password-reset` osztály kerete. A korlát
    // eddig a Payload REST catch-all burkolójában futott; mivel ezt az
    // útvonalat már ez a handler szolgálja ki, a kérés-korlátnak is ITT kell
    // lefutnia, MINDEN drága lépés (Payload-betöltés, DB, hash) előtt.
    const rejection = checkRequestRateLimit(request, deps.rateLimit)
    if (rejection) {
      return payloadRestRateLimitResponse(rejection)
    }

    try {
      const bodyResult = await readRequestData(request)
      if (!bodyResult.ok) {
        if (bodyResult.reason === 'too-large') {
          return errorResponse(RESET_BODY_TOO_LARGE_MESSAGE, 413)
        }
        return errorResponse(RESET_INVALID_BODY_MESSAGE, 400)
      }
      const body = bodyResult.value

      const token = readNonEmptyString(body.token)
      const password = readNonEmptyString(body.password)
      if (!token || !password) {
        return errorResponse(RESET_MISSING_INPUT_MESSAGE, 400)
      }

      // Az e-mail feloldása BEST-EFFORT: ha nem sikerül (DB-hiba, lejárt
      // token), a többi szabály — hossz, kis-/nagybetű, szám — ettől még
      // érvényesül, a token sorsáról pedig úgyis a Payload dönt.
      let email: string | undefined
      try {
        email = await resolveEmailForToken(await deps.getPayload(), token)
      } catch (error) {
        log.warn(
          'reset-password: a tokenhez tartozó e-mail feloldása nem sikerült — a politika e-mail-szabálya kimarad',
          { error: error instanceof Error ? error.message : String(error) },
        )
      }

      const violations = validatePasswordStrength({ password, email })
      if (violations.length > 0) {
        // Sem a tokent, sem a jelszót nem naplózzuk — csak a szabálysértések
        // száma kerül a naplóba, hogy a visszaélés-minták kimérhetők legyenek.
        log.warn('reset-password: a megadott új jelszó nem felel meg a jelszó-politikának', {
          violationCount: violations.length,
          emailResolved: email !== undefined,
        })
        return errorResponse(formatPasswordPolicyErrors(violations), 400)
      }

      return await deps.forwardToPayload(bodyResult.forwardRequest)
    } catch (error) {
      log.error('reset-password: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return errorResponse(RESET_UNEXPECTED_ERROR_MESSAGE, 500)
    }
  }
}
