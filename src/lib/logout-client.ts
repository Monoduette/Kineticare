/**
 * Kijelentkezés-kliens — a Payload auth REST kijelentkező végpontjához.
 *
 * API-szerződés (Payload 3, `authCollectionEndpoints`):
 * - POST /api/users/logout → 200 { message }, és a válasz `Set-Cookie` fejléce
 *   LEJÁRT süti (`generateExpiredPayloadCookie`), azaz a böngésző a session-t a
 *   válasz feldolgozásakor eldobja. Sikertelen művelet: 400 { message }.
 *   Forrás (a repóban telepített csomag): `payload/dist/auth/endpoints/logout.js`
 *   és `payload/dist/auth/endpoints/index.js` (`{ method: 'post', path: '/logout' }`).
 *
 * MIÉRT POST, ÉS MIÉRT NEM LINK. A kijelentkezés ÁLLAPOTVÁLTOZÁS. Az OWASP
 * CSRF-útmutatója egyértelmű: „Do not use GET requests for state changing
 * operations", mert a `SameSite=Lax` süti a biztonságosnak minősített
 * metódusokkal induló felső szintű navigációkon átmegy — egy GET-es kilépő
 * útvonalat idegen oldal is elsüthetne.
 * OWASP — Cross-Site Request Forgery Prevention Cheat Sheet:
 * https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 *
 * A `fetch` injektálható, hogy a teszt VALÓDI hálózati hívás nélkül mérhesse a
 * szerződést (a repó 15. üzemeltetési tanulsága: tesztből sosem megy ki hívás).
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
