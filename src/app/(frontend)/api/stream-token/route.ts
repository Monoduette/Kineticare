import { getPayload } from 'payload'

import { createStreamTokenHandler } from '../../../../lib/stream/route-handler'
import config from '../../../../payload.config'

/**
 * GET /api/stream-token — védett videókhoz signed playback token, kizárólag
 * a kurzust megvásárló, bejelentkezett felhasználónak (paywall API-szinten).
 * Query: ?productId=<szám> [&videoId=<streamAssetId|sor-id>]
 * Válasz: 200 { token, expiresAt } | 401 | 403 | 404 | 409 | 429 | 503 —
 * magyar üzenettel; a technikai részletek csak a naplóba kerülnek (requestId).
 * A 429 a per-user kérés-korlát (src/lib/security/rate-limit.ts, `stream-token`
 */
export const GET = createStreamTokenHandler({
  getPayload: () => getPayload({ config }),
})
