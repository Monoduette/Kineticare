import { createPostHogCapture } from '../../../../lib/feedback/posthog-capture'
import { createVisszajelzesRouteHandler } from '../../../../lib/feedback/route-handler'

/**
 * POST /api/visszajelzes — visszajelzés-doboz (WP65).
 *
 * A handler a src/lib/feedback/route-handler.ts-ben él (függőség-injekcióval,
 * egységtesztelhetően); itt csak a valódi PostHog-kliens bekötése történik,
 * pontosan úgy, mint a checkout-start és az ingyenes kurzus végpontján.
 */
export const POST = createVisszajelzesRouteHandler({ capture: createPostHogCapture() })
