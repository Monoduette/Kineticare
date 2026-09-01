/**
 * Stream-token kliens — a GET /api/stream-token végpont hívása a lejátszóhoz.
 *
 * A kérés- és válasz-alak EGYETLEN forrása az src/lib/stream/contract.ts (ezt
 * használja a szerver oldala is): a kliens nem épít saját query-paramétert és
 * nem értelmezi maga a választörzset. Korábban ezek külön voltak leírva a két
 * oldalon, és el is tértek — a fizető vevő sem tudott lejátszani.
 *
 * Státuszok: 200 { token, expiresAt } | 401 (nincs belépés) | 403 (nem vevő /
 * lejárt hozzáférés / lookup-hiba) | 404 | 409 (feldolgozás alatt) |
 * 503 (hiányzó CF-kulcs) | 500. A 401 és a 403 KÜLÖN ág: az elsőnél a
 * belépés a következő lépés, a másodiknál nem az.
 */

import { buildStreamTokenRequestUrl, parseStreamTokenResponseBody } from './stream/contract'

export type StreamTokenResult =
  | { kind: 'token'; token: string; expiresAtEpochSec: number }
  | { kind: 'unauthenticated'; message: string | null }
  | { kind: 'forbidden'; message: string | null }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

export const GENERIC_STREAM_ERROR =
  'A videó lejátszási joga most nem ellenőrizhető. Próbáld újra néhány perc múlva.'

/** A szerver 409-es szövege (`issueStreamToken`) — a kliens ugyanazt mutatja. */
export const STREAM_PROCESSING_MESSAGE =
  'A videó feldolgozása még folyamatban van. Nézz vissza néhány perc múlva.'

/** A szerver 401-es szövege (`route-handler`) — üzenet nélküli törzsnél ez a tartalék. */
export const STREAM_SIGN_IN_REQUIRED_MESSAGE = 'A videó lejátszásához bejelentkezés szükséges.'

async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' && body.error.trim().length > 0
      ? body.error.trim()
      : null
  } catch {
    return null
  }
}

export async function fetchStreamToken(
  input: { productId: number; videoId?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<StreamTokenResult> {
  try {
    const response = await fetchImpl(buildStreamTokenRequestUrl(input), {
      credentials: 'include',
    })

    if (response.status === 401) {
      return { kind: 'unauthenticated', message: await serverMessage(response) }
    }
    if (response.status === 403) {
      return { kind: 'forbidden', message: await serverMessage(response) }
    }
    if (response.status === 503) {
      return { kind: 'unavailable' }
    }
    if (response.status === 409) {
      return { kind: 'error', message: STREAM_PROCESSING_MESSAGE }
    }
    if (!response.ok) {
      return { kind: 'error', message: GENERIC_STREAM_ERROR }
    }

    const parsed = parseStreamTokenResponseBody(await response.json())
    if (parsed === null) {
      return { kind: 'error', message: GENERIC_STREAM_ERROR }
    }
    return { kind: 'token', token: parsed.token, expiresAtEpochSec: parsed.expiresAtEpochSec }
  } catch {
    return { kind: 'error', message: GENERIC_STREAM_ERROR }
  }
}
