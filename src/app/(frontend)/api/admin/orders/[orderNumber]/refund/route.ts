import { getPayload } from 'payload'

import {
  createRefundHandler,
  createRefundRecoveryStatusHandler,
} from '../../../../../../../lib/refund/route-handler'
import config from '../../../../../../../payload.config'

/**
 * POST /api/admin/orders/[orderNumber]/refund — owner-only visszatérítés.
 *
 * A handler a src/lib/refund/route-handler.ts-ben él (függőség-injekcióval,
 * egységtesztelhetően); itt csak a valódi config bekötése történik.
 *
 * A konfig relatív import: a vitest nem oldja fel a tsconfig `@payload-config`
 * aliasát, a relatív útvonal viszont a buildben és a tesztekben is működik
 * (checkout-start / barion-callback route-minta).
 */
export const POST = createRefundHandler({
  getPayload: () => getPayload({ config }),
})

export const GET = createRefundRecoveryStatusHandler({
  getPayload: () => getPayload({ config }),
})
