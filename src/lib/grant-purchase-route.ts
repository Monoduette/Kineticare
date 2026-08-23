import type { Payload } from 'payload'

import { hasStaffOrOwnerRole } from '../access/roles'
import { grantPurchase } from './grant-purchase'
import { logger } from './logger'
import { generateRequestId, getRequestId } from './request-id'

/**
 * POST /api/admin/grant-purchase route-handler factory.
 *
 * A függőségek (Payload-példány) injektálva vannak, így a handler
 * egységtesztelhető; a tényleges route az
 * src/app/(frontend)/api/admin/grant-purchase/route.ts köti be a valódi configgal
 * (a src/lib/refund/route-handler.ts mintája).
 *
 * RBAC-szerződés (a refund route-handler auth-mintáját tükrözi, de ez NEM
 * pénzügyi művelet, ezért a staff is jogosult):
 * - anon hívó → 401,
 * - customer (és minden más szerepkör) → 403,
 * - staff VAGY owner → engedélyezett. A meglévő hasStaffOrOwnerRole
 *   predikátumot hívja (src/access/roles.ts) — RBAC-függvényt nem ír át.
 *
 * Válasz-szerződés:
 * - 200: { status: 'granted' | 'already-had', message, email, userId?,
 *   productId?, productLabel? } — az already-had NEM hiba (idempotens no-op)
 * - 400: hiányzó/érvénytelen email, kurzus-azonosító vagy indok
 * - 401/403: RBAC (fent)
 * - 404: ismeretlen felhasználó, illetve ismeretlen kurzus (külön üzenettel)
 * - 500: váratlan technikai hiba (naplózva requestId-vel)
 */
export interface GrantPurchaseHandlerDeps {
  getPayload: () => Promise<Payload>
}

/** A kérés törzse — minden mező kötelező (az indok is, az audit miatt). */
interface GrantPurchaseRequestBody {
  email?: unknown
  productIdOrSku?: unknown
  reason?: unknown
}

/** Nem üres szöveggé szűkítés (a JSON-ból bármi jöhet). */
function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function createGrantPurchaseHandler(
  deps: GrantPurchaseHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'admin-grant-purchase' })

    try {
      const payload = await deps.getPayload()

      // RBAC: anon → 401; customer → 403; staff/owner mehet tovább.
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return Response.json(
          { error: 'A kurzus ajándékozásához bejelentkezés szükséges.' },
          { status: 401 },
        )
      }
      if (!hasStaffOrOwnerRole(user)) {
        log.warn('grant-purchase: jogosulatlan kísérlet (nem staff/owner szerepkör)', {
          userId: user.id,
          role: user.role ?? null,
        })
        return Response.json(
          { error: 'A kurzus ajándékozásához munkatársi vagy tulajdonosi jogosultság kell.' },
          { status: 403 },
        )
      }

      // A content-length fejléc hiányozhat (chunked átvitel, illetve a tesztekben
      // konstruált Requesteknél az undici nem tölti ki) — a törzs beolvasása ezért
      // NEM függhet a fejléctől: üres törzs = üres input, nem-JSON = 400.
      let body: GrantPurchaseRequestBody = {}
      const rawBody = await request.text()
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody) as GrantPurchaseRequestBody
        } catch {
          return Response.json(
            {
              error:
                'A hozzáférés nem adható meg: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
            },
            { status: 400 },
          )
        }
      }

      const email = readRequiredString(body.email)
      if (!email) {
        return Response.json(
          { error: 'Hiányzó e-mail-cím: add meg, kinek ajándékozod a kurzust.' },
          { status: 400 },
        )
      }
      const productIdOrSku = readRequiredString(body.productIdOrSku)
      if (!productIdOrSku) {
        return Response.json(
          { error: 'Válassz kurzust az ajándékozáshoz.' },
          { status: 400 },
        )
      }
      const reason = readRequiredString(body.reason)
      if (!reason) {
        return Response.json(
          // Szó szerint AZONOS a GrantPurchasePanel kliens-üzenetével (3.2.4).
          { error: 'Add meg az indokot: ez kerül az audit-naplóba.' },
          { status: 400 },
        )
      }

      const result = await grantPurchase({
        payload,
        email,
        productIdOrSku,
        reason,
        grantedBy: { id: user.id, email: user.email },
        logger: log,
      })

      if (result.status === 'user-not-found') {
        return Response.json(
          { error: `Nincs ilyen felhasználó: ${email}. Előbb regisztrálnia kell a vevőnek.` },
          { status: 404 },
        )
      }
      if (result.status === 'product-not-found') {
        return Response.json(
          {
            error:
              result.productRefKind === 'id'
                ? `Nincs ilyen kurzus (azonosító: ${result.productRef}).`
                : `Nincs ilyen kurzus (név/sku: ${result.productRef}).`,
          },
          { status: 404 },
        )
      }

      return Response.json(
        {
          status: result.status,
          message:
            result.status === 'already-had'
              ? 'Már hozzáfér ehhez a kurzushoz.'
              : 'A kurzust ajándékoztam.',
          email: result.email,
          userId: result.userId,
          productId: result.productId,
          productLabel: result.productLabel,
        },
        { status: 200 },
      )
    } catch (error) {
      log.error('grant-purchase: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        {
          error: 'A kurzus ajándékozása most nem sikerült. Próbáld újra néhány perc múlva.',
        },
        { status: 500 },
      )
    }
  }
}
