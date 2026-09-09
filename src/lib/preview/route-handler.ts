import type { Payload } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { isPreviewCollection, previewTargetPath } from './preview-target'
import { publicRedirectBase } from './public-redirect-base'
import { loadProductPreview } from './product-preview'

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }

/**
 * GET /next/preview — piszkozat-előnézet bekapcsolása.
 *
 * Az admin „Előnézet" gombja ide navigál (a linket a collections
 * `admin.preview`-ja építi, lásd src/lib/preview/preview-target.ts). A route
 * a Next draft mode-ját kapcsolja be, majd átirányít a tartalom nyilvános
 * útvonalára — a storefront oldalak innen már a publikálatlan verziót kérik le
 * (a bekötés a B2 munkacsomag feladata).
 *
 * RBAC: a piszkozat NEM nyilvános tartalom, ezért kizárólag staff/owner
 * kapcsolhatja be az előnézetet. Minden más (be nem jelentkezett látogató és
 * customer is) 403-at kap, magyar üzenettel; a visszautasítás naplózásra kerül
 * a kérés request ID-jével (a middleware állítja be, src/middleware.ts).
 *
 * A függőségek injektálva vannak (a refund/stream/checkout route-handlerek
 * mintájára), így a handler DB és Next-runtime nélkül egységtesztelhető.
 */
export interface PreviewHandlerDeps {
  getPayload: () => Promise<Payload>
  /** A Next draft mode bekapcsolása (a route a next/headers draftMode()-ját adja át). */
  enableDraftMode: () => Promise<void>
}

/** 403-as elutasítás magyar üzenettel — a szerkesztőnek is érthető szöveggel. */
const FORBIDDEN_MESSAGE =
  'Az előnézet megtekintéséhez szerkesztői belépés szükséges. Lépj be az adminba, majd próbáld újra.'

const INVALID_TARGET_MESSAGE =
  'Az előnézet nem nyitható meg: hiányzik vagy hibás a tartalom azonosítója.'

export function createPreviewHandler(
  deps: PreviewHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'draft-preview' })

    const url = new URL(request.url)
    const collection = url.searchParams.get('collection')
    const slug = url.searchParams.get('slug')

    if (!isPreviewCollection(collection)) {
      return Response.json(
        { error: INVALID_TARGET_MESSAGE },
        { status: 400, headers: PRIVATE_HEADERS },
      )
    }

    const target = previewTargetPath(collection, slug)
    if (target === null) {
      return Response.json(
        { error: INVALID_TARGET_MESSAGE },
        { status: 400, headers: PRIVATE_HEADERS },
      )
    }

    let user: { id: number | string; role?: string | null } | null = null
    try {
      const payload = await deps.getPayload()
      const authHeaders = new Headers(request.headers)
      authHeaders.set('DisableAutologin', 'true')
      const auth = await payload.auth({ headers: authHeaders })
      user = auth.user
      if (collection === 'products' && hasStaffOrOwnerRole(user)) {
        const product = await loadProductPreview({ payload, headers: request.headers, slug: slug! })
        if (!product) {
          return Response.json(
            { error: INVALID_TARGET_MESSAGE },
            { status: 404, headers: PRIVATE_HEADERS },
          )
        }
      }
    } catch (error) {
      log.error('Az előnézet jogosultság-ellenőrzése sikertelen', {
        collection,
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        {
          error:
            'Az előnézet most nem érhető el egy technikai hiba miatt. Próbáld újra néhány perc múlva.',
        },
        { status: 500, headers: PRIVATE_HEADERS },
      )
    }

    if (!hasStaffOrOwnerRole(user)) {
      log.warn('Előnézet: jogosulatlan kísérlet', {
        collection,
        role: user?.role ?? null,
        authenticated: Boolean(user),
      })
      return Response.json({ error: FORBIDDEN_MESSAGE }, { status: 403, headers: PRIVATE_HEADERS })
    }

    await deps.enableDraftMode()
    log.info('Előnézet bekapcsolva', { collection, target })

    // Szándékosan NEM Response.redirect(): az azzal létrehozott válasz fejlécei
    // csak olvashatók, így a Next nem tudná ráfűzni a draft mode sütijét.
    // A Location bázisa a publikus origin (Railway belső host ellen) —
    // lásd publicRedirectBase.
    return new Response(null, {
      status: 307,
      headers: {
        ...PRIVATE_HEADERS,
        Location: new URL(target, publicRedirectBase(request.url)).toString(),
      },
    })
  }
}
