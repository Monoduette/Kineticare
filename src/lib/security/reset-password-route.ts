/**
 * POST /api/users/reset-password — saját végpont a jelszó-politika
 * SZERVEROLDALI kikényszerítéséhez a jelszó-visszaállítás útvonalán (OWASP A07).
 *
 * ## Miért kell külön végpont
 *
 * A jelszó-politikát (`validatePasswordStrength`) eddig KIZÁRÓLAG a Users
 * collection `beforeChange` hookja futtatta. A Payload 3.86
 * `resetPasswordOperation`-je viszont NEM megy át ezen a hookon: maga hívja a
 * `generatePasswordSaltHash`-t, és a már hash-elt rekordot írja ki
 * `payload.db.updateOne`-nal (a `beforeChange` lánc kimarad, csak a
 * `beforeValidate` fut — az pedig már a hash-t látja, nem a nyers jelszót).
 * Vagyis a `POST /api/users/reset-password` közvetlen hívásával tetszőlegesen
 * gyenge jelszó volt beállítható: a regisztrációnál kikényszerített 12
 * karakteres, vegyes szabály a reset-ágon megkerülhető volt.
 *
 * ## Hogyan zárja be a rést
 *
 * Ez a route-handler UGYANAZT az útvonalat foglalja el, amit eddig a Payload
 * REST catch-all (`src/app/(payload)/api/[...slug]/route.ts`) szolgált ki. A
 * Next.js útvonal-feloldása a konkrét szegmenst előbbre sorolja a catch-all
 * mintánál, ezért `/api/users/reset-password`-re MINDEN kérés ide érkezik —
 * beleértve az admin felület saját reset-űrlapját és a végpont közvetlen,
 * kliens megkerülésével indított hívását is. Nincs olyan út, amelyik a
 * politika mellett elmenne: a GraphQL API (amelynek beépített
 * `resetPasswordUser` mutációja szintén a `resetPasswordOperation`-t hívná,
 * a politika ÉS a REST-oldali rate-limit megkerülésével) a configban
 * teljesen le van tiltva — `graphQL.disable`, src/payload.config.ts. Ha a
 * GraphQL valaha visszakapcsolásra kerül, ELŐBB ide is őrt kell építeni.
 *
 * A tényleges jelszócserét NEM írjuk újra: sikeres politika-ellenőrzés után a
 * kérést változatlanul továbbadjuk a Payload beépített végpontjának
 * (`forwardToPayload`). A token ellenőrzése, a hash-elés, a session-süti
 * kiállítása és a válaszformátum így végig a Payload dolga marad — nincs mit
 * szinkronban tartani egy verziófrissítéskor.
 *
 * A kérés törzsét ezért csak OLVASSUK (a kérés klónjából), és két formátumot
 * értünk: a nyilvános űrlap JSON-ját és az admin reset-oldalának multipart
 * FormData-ját (lásd `readRequestData`).
 *
 * ## Miért Next route-handler, és nem Payload custom endpoint
 *
 * A collection `endpoints` tömbje a Users kollekció konfigurációját módosítaná
 * (annak access-szabályai és auth-hookjai mellett), és a beépített
 * auth-végponttal való ütközés feloldása a Payload belső regisztrációs
 * sorrendjén múlna. A route-réteg ezzel szemben a repóban már bevált minta
 * (`src/lib/checkout/route-handler.ts`, `src/lib/grant-purchase-route.ts`):
 * függőség-injekcióval egységtesztelhető, és a Users kollekcióhoz hozzá sem
 * nyúl.
 *
 * ## Hibaválaszok és szivárgás
 *
 * A válasz a Payload REST hibaformátumát (`{ errors: [{ message }] }`) követi,
 * mert ezt olvassa ki a repó auth-kliense (`src/lib/auth-client.ts`) ÉS a
 * Payload admin reset-űrlapja is. A tokent sosem naplózzuk (a logger
 * redact-listája is védi), és a hibaüzenetek nem árulnak el többet a
 * szükségesnél: a token érvényességéről továbbra is csak annyi derül ki,
 * amennyit a Payload maga is elárul (siker vagy 403).
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

export const RESET_UNEXPECTED_ERROR_MESSAGE =
  'A jelszó módosítása most nem sikerült. Próbáld újra néhány perc múlva.'

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
 * A törzset MINDIG a kérés klónjából olvassuk, hogy az eredeti kérés
 * változatlanul továbbadható maradjon.
 */
async function readRequestData(request: Request): Promise<ResetPasswordRequestBody | null> {
  const contentType = (request.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (contentType.startsWith('multipart/')) {
    try {
      const raw = (await request.clone().formData()).get('_payload')
      return typeof raw === 'string' ? parseJsonObject(raw) : {}
    } catch {
      return null
    }
  }

  return parseJsonObject(await request.clone().text())
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
      const body = await readRequestData(request)
      if (!body) {
        return errorResponse(RESET_INVALID_BODY_MESSAGE, 400)
      }

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

      return await deps.forwardToPayload(request)
    } catch (error) {
      log.error('reset-password: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return errorResponse(RESET_UNEXPECTED_ERROR_MESSAGE, 500)
    }
  }
}
