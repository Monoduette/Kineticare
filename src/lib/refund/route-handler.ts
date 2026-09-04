import type { Payload } from 'payload'

import { hasOwnerRole } from '../../access/roles'
import { resolveClientIp } from '../audit'
import { BarionApiError } from '../barion'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { assertSameOrigin } from '../security/same-origin'
import { RefundError, refundOrder, type RefundOrderInput } from './refund-order'

/** POST /api/admin/orders/[orderNumber]/refund — owner-only, a refundOrder szolgáltatást hívja. */
export interface RefundHandlerDeps {
  getPayload: () => Promise<Payload>
}

/** Next 15 route-context (async params). */
export interface RefundRouteContext {
  params: Promise<{ orderNumber: string }>
}

const MANUAL_REVIEW_ERROR =
  'A visszatérítés eredménye nem igazolt. Ne indíts új pénzvisszatérítést. Kézi ellenőrzés és egyeztetés szükséges a Barionban és a rendelésnél.'

/** BarionApiError → HTTP-státusz; a hiba nem bizonyítja a pénzmozgás hiányát. */
function mapBarionError(error: BarionApiError): { status: number; message: string } {
  if (error.kind === 'timeout') {
    return {
      status: 504,
      message: MANUAL_REVIEW_ERROR,
    }
  }
  return {
    status: 502,
    message: MANUAL_REVIEW_ERROR,
  }
}

export function createRefundHandler(
  deps: RefundHandlerDeps,
): (request: Request, context: RefundRouteContext) => Promise<Response> {
  return async function POST(request: Request, context: RefundRouteContext): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'admin-order-refund' })

    const originCheck = assertSameOrigin(request)
    if (!originCheck.ok) {
      log.warn('refund: idegen eredet elutasítva')
      return Response.json({ error: originCheck.message }, { status: originCheck.status })
    }

    try {
      const payload = await deps.getPayload()

      // RBAC: anon → 401; nem owner (staff is) → 403; csak owner mehet tovább.
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return Response.json(
          { error: 'A visszatérítés indításához bejelentkezés szükséges.' },
          { status: 401 },
        )
      }
      if (!hasOwnerRole(user)) {
        log.warn('refund: jogosulatlan kísérlet (nem owner szerepkör)', {
          userId: user.id,
          role: user.role ?? null,
        })
        return Response.json(
          { error: 'A visszatérítés kizárólag owner szerepkörrel indítható.' },
          { status: 403 },
        )
      }

      const { orderNumber } = await context.params
      if (!orderNumber || orderNumber.trim().length === 0) {
        return Response.json({ error: 'Hiányzó rendelésszám.' }, { status: 400 })
      }

      let body: unknown = {}
      // A content-length fejléc hiányozhat (chunked átvitel, illetve a tesztekben
      // konstruált Requesteknél az undici nem tölti ki) — a törzs beolvasása ezért
      // NEM függhet a fejléctől: üres törzs = üres input, nem-JSON = 400.
      const rawBody = await request.text()
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody)
        } catch {
          return Response.json(
            {
              error:
                'A visszatérítés nem indítható: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.',
            },
            { status: 400 },
          )
        }
      }

      const result = await refundOrder({
        payload,
        orderNumber,
        input: (body ?? {}) as RefundOrderInput,
        actor: user,
        headers: request.headers,
        ipAddress: resolveClientIp(request.headers),
        logger: log,
      })

      return Response.json(result, { status: 200 })
    } catch (error) {
      if (error instanceof RefundError) {
        if (error.status >= 500) {
          log.error('refund: kézi ellenőrzést igénylő szolgáltatáshiba', {
            status: error.status,
            errorKind: 'refund-service',
          })
          return Response.json(
            {
              error: error.status === 503 ? error.message : MANUAL_REVIEW_ERROR,
              manualReviewRequired: true,
            },
            { status: error.status },
          )
        }
        log.warn('refund: üzleti hiba', { status: error.status, error: error.message })
        return Response.json({ error: error.message }, { status: error.status })
      }
      if (error instanceof BarionApiError) {
        const mapped = mapBarionError(error)
        log.error('refund: Barion-hiba, a visszatérítés eredménye nem igazolt', {
          status: mapped.status,
          errorKind: error.kind === 'timeout' ? 'barion-timeout' : 'barion-error',
        })
        return Response.json(
          { error: mapped.message, manualReviewRequired: true },
          { status: mapped.status },
        )
      }
      log.error('refund: váratlan technikai hiba', {
        errorKind: error instanceof Error ? 'error' : 'non-error',
      })
      return Response.json(
        {
          error: MANUAL_REVIEW_ERROR,
          manualReviewRequired: true,
        },
        { status: 500 },
      )
    }
  }
}
