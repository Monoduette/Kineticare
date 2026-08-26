import { getPayload } from 'payload'

import { createMarkWatchedHandler } from '../../../../../lib/course-progress/route-handler'
import config from '../../../../../payload.config'

/**
 * POST /api/course-progress/mark-watched — „megnéztem ezt a videót" jelölés a
 * bejelentkezett, a kurzust megvásárolt (és még érvényes hozzáférésű)
 * felhasználónak.
 * Törzs: { productId, videoRef } — a videoRef a videó STABIL azonosítója
 * (src/lib/stream/contract.ts `streamVideoRef()`), sosem sorszám.
 * Válasz: 200 { productId, videoRef, watchedAt, alreadyWatched } | 400 | 401 |
 */
export const POST = createMarkWatchedHandler({
  getPayload: () => getPayload({ config }),
})
