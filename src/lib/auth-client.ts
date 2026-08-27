/**
 * Auth-kliens — a Payload auth REST végpontjaihoz (bejelentkezés,
 * regisztráció, jelszó-reset, profil).
 *
 * API-szerződés (Payload REST, /api/users):
 * - POST /api/users/login { email, password } → { user, token } (süti is jön);
 * - POST /api/users { email, password, name, billingName?, ... } → { doc } (regisztráció);
 * - POST /api/users/forgot-password { email } → 200 (mindig 200, ne szivárogjon);
 * - POST /api/users/reset-password { token, password } → { user };
 *   ezt az útvonalat a saját, jelszó-politikát kikényszerítő handler szolgálja
 *   ki (src/lib/security/reset-password-route.ts), amely a politika átmenetele
 *   után a Payload beépített végpontjára delegál — a kérés és a sikeres válasz
 *   alakja ezért változatlan;
 * - GET /api/users/me → { user } (a session-ből).
 *
 * A kliens a fetch injektálhatóságával tesztelhető (lásd a teszteket).
 */

import { DEFAULT_AUTH_RETURN_URL, sanitizeReturnUrl } from './return-url'

export interface AuthResult<T = undefined> {
  ok: boolean
  message?: string
  data?: T
}

export const GENERIC_AUTH_ERROR =
  'A művelet most nem sikerült. Próbáld újra néhány perc múlva, vagy írj nekünk a kapcsolatfelvételnél.'

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ message?: string }>
      message?: string
    }
    const first = body.errors?.find((entry) => typeof entry.message === 'string')
    if (first?.message) {
      return first.message
    }
    if (typeof body.message === 'string' && body.message.length > 0) {
      return body.message
    }
  } catch {
    // Nem JSON-válasz.
  }
  return fallback
}

export async function loginUser(
  input: { email: string; password: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  try {
    const response = await fetchImpl('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    })
    if (!response.ok) {
      const message =
        response.status === 401
          ? 'Hibás e-mail-cím vagy jelszó.'
          : await parseErrorMessage(response, GENERIC_AUTH_ERROR)
      return { ok: false, message }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: GENERIC_AUTH_ERROR }
  }
}

export interface RegisterInput {
  email: string
  password: string
  name: string
  billingName?: string
  billingZip?: string
  billingCity?: string
  billingStreet?: string
  taxNumber?: string
}

export async function registerUser(
  input: RegisterInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  try {
    const response = await fetchImpl('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    })
    if (!response.ok) {
      const message =
        response.status === 409 || response.status === 400
          ? 'Ez az e-mail-cím már foglalt, vagy a jelszó nem felel meg a követelményeknek (min. 12 karakter).'
          : await parseErrorMessage(response, GENERIC_AUTH_ERROR)
      return { ok: false, message }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: GENERIC_AUTH_ERROR }
  }
}

export async function forgotPassword(
  email: string,
  fetchImpl: typeof fetch = fetch,
  returnUrl?: string,
): Promise<AuthResult> {
  try {
    const body: { email: string; returnUrl?: string } = { email }
    if (returnUrl !== undefined) {
      body.returnUrl = sanitizeReturnUrl(returnUrl, DEFAULT_AUTH_RETURN_URL)
    }
    const response = await fetchImpl('/api/users/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    })
    // Az IP-alapú kérés-korlát (A2) 429-e KIVÉTEL a „mindig ok" szabály alól:
    // ilyenkor e-mail sem ment ki, tehát a megerősítő képernyő hazudna — a
    // felhasználó hiába várná a levelet. A 429 az IP-hez kötődik, nem a
    // címhez, ezért nem szivárogtatja, hogy létezik-e a fiók.
    if (response.status === 429) {
      return { ok: false, message: await parseErrorMessage(response, GENERIC_AUTH_ERROR) }
    }
    // Egyébként a Payload mindig 200-at ad (ne szivárogjon, létezik-e a cím) —
    // a kliens ugyanazt a megerősítő üzenetet mutatja.
    return { ok: true }
  } catch {
    return { ok: false, message: GENERIC_AUTH_ERROR }
  }
}

/** Lejárt vagy érvénytelen visszaállító token — magyar üzenet a Payload angol szövege helyett. */
export const RESET_LINK_INVALID_MESSAGE =
  'A jelszó-visszaállító link lejárt vagy érvénytelen. Kérj újat.'

export async function resetPassword(
  input: { token: string; password: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  try {
    const response = await fetchImpl('/api/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    })
    if (!response.ok) {
      // A lejárt/érvénytelen tokent a Payload 403-mal és ANGOL szöveggel
      // utasítja el — azt itt fordítjuk magyarra.
      if (response.status === 403) {
        return { ok: false, message: RESET_LINK_INVALID_MESSAGE }
      }
      // A 400 a saját végpont (src/lib/security/reset-password-route.ts)
      // jelszó-politika-hibája, MAGYAR üzenettel: azt kell megmutatni, nem
      // felülírni. A tartalék szöveg csak akkor kell, ha a törzs olvashatatlan.
      const fallback = response.status === 400 ? RESET_LINK_INVALID_MESSAGE : GENERIC_AUTH_ERROR
      return { ok: false, message: await parseErrorMessage(response, fallback) }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: GENERIC_AUTH_ERROR }
  }
}
