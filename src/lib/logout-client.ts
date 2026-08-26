/**
 * Kijelentkezés-kliens: POST /api/users/logout (állapotváltozás, nem GET — CSRF).
 * `fetch` injektálható teszthez.
 */

import { resetAnalyticsIdentity } from './analytics/posthog'

/** Magyar, cselekvésre irányító hibaszöveg (WCAG 3.3.1 szellemében: mit tegyen). */
export const LOGOUT_ERROR_MESSAGE =
  'A kijelentkezés most nem sikerült. Próbáld újra, vagy zárd be a böngészőt.'

export interface LogoutResult {
  ok: boolean
  message?: string
}

/**
 * Kijelentkezés + PostHog reset siker után — közös gépen ne olvadjon össze két felhasználó profilja.
 */
export async function logoutUser(
  fetchImpl: typeof fetch = fetch,
  resetIdentity: () => void = resetAnalyticsIdentity,
): Promise<LogoutResult> {
  try {
    const response = await fetchImpl('/api/users/logout', {
      method: 'POST',
      // A süti-alapú session nélkül a végpont 400-at adna („No User").
      credentials: 'include',
    })
    if (!response.ok) {
      return { ok: false, message: LOGOUT_ERROR_MESSAGE }
    }
    try {
      resetIdentity()
    } catch {
      // A mérés hibája nem érheti el a felhasználót — a kilépés sikeres.
    }
    return { ok: true }
  } catch {
    return { ok: false, message: LOGOUT_ERROR_MESSAGE }
  }
}
