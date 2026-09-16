import type { ResetPasswordHandlerDeps } from './reset-password-route'

import { withPayloadLoginCsrfProtection } from './login-csrf'
import { withPayloadRestRateLimit } from './rate-limit'
import { createResetPasswordHandler } from './reset-password-route'

export interface PayloadRestRouteContext {
  params: Promise<{ slug?: string[] }>
}

export type PayloadRestPost = (
  request: Request,
  context: PayloadRestRouteContext,
) => Promise<Response>

export interface ProtectedPayloadPostDeps {
  getPayload: ResetPasswordHandlerDeps['getPayload']
  payloadPost: PayloadRestPost
  rateLimit?: ResetPasswordHandlerDeps['rateLimit']
}

/**
 * Közös reset-konstruktor a konkrét Next-route és a catch-all számára.
 * Csak a már ellenőrzött, byte-limittel olvasott kérés kap kanonikus belső
 * útvonalat. Erre az afterLogin session-visszavonó hooknak is szüksége van:
 * a Payload a req.pathname-t az URL-ből, nem a route paramsból építi.
 */
export function createProtectedResetPost(deps: ProtectedPayloadPostDeps) {
  return createResetPasswordHandler({
    getPayload: deps.getPayload,
    rateLimit: deps.rateLimit,
    forwardToPayload: (request) => {
      const url = new URL(request.url)
      url.pathname = '/api/users/reset-password'
      return deps.payloadPost(new Request(url, request), {
        params: Promise.resolve({ slug: ['users', 'reset-password'] }),
      })
    },
  })
}

/**
 * A Next már egyszer dekódolta a szegmenseket. A collection neve pontos,
 * a Payload endpoint-illesztése kis-/nagybetűtől független. Újabb decode
 * hamis aliasokat teremtene a dupla kódolásból, ezért itt nem végezzük el.
 */
function isResetPasswordRoute(slug: string[] | undefined): boolean {
  return slug?.length === 2 && slug[0] === 'users' && slug[1]?.toLowerCase() === 'reset-password'
}

export function createProtectedPayloadPost(deps: ProtectedPayloadPostDeps): PayloadRestPost {
  const resetPost = createProtectedResetPost(deps)
  const genericPost = withPayloadLoginCsrfProtection(
    withPayloadRestRateLimit(deps.payloadPost, deps.rateLimit),
  )
  return async (request, context) => {
    const params = await context.params
    if (isResetPasswordRoute(params.slug)) {
      // A reset saját eredet-/body-/jelszóvédelme és kerete egyszer fusson.
      return resetPost(request)
    }
    return genericPost(request, context)
  }
}
