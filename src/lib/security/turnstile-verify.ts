/**
 * Cloudflare Turnstile szerveroldali ellenőrzése HÁROM kimenettel.
 *
 * MIÉRT NEM ELÉG A MEGLÉVŐ `verifyTurnstileToken` (src/lib/free-course/
 * route-handler.ts): az logikai értéket ad, tehát a „rossz token" és a
 * „nem érhető el a Cloudflare" ugyanaz a `false`. A pénztárban ez a kettő
 * gyökeresen mást jelent (a-checkout-9, vezetői kikötés): a rossz tokennél a
 * vevő újrapróbál, a szolgáltatás kiesésénél viszont MINDEN eladás megállna,
 * ezt tehát nem szabad szó nélkül hagyni. A szabály a form-builder útjának
 * (`callTurnstileSiteverify`, src/payload.config.ts) mintáját követi:
 *  - hálózati hiba, időtúllépés, nem 2xx, nem JSON vagy logikai `success`
 *    nélküli törzs, illetve NEM a látogató tokenjére vonatkozó hibakód
 *    (`internal-error`, kulcs- és kéréshiba) → `unavailable` (503);
 *  - `success: false` a látogató tokenjére vonatkozó kóddal → `rejected` (400);
 *  - `success: true` → `ok`.
 * Forrás: Cloudflare, Server-side validation, Error codes
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/#error-codes
 *
 * A token SOHA nem kerül a naplóba (és a hívó sem naplózza).
 */

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** A form-builder útjával azonos felső korlát: a pénztár nem várhat percekig. */
export const TURNSTILE_VERIFY_TIMEOUT_MS = 8_000

/** A siteverify hibakódjai, amelyek a LÁTOGATÓ tokenjéről szólnak. */
export const TURNSTILE_VISITOR_ERROR_CODES: ReadonlySet<string> = new Set([
  'missing-input-response',
  'invalid-input-response',
  'timeout-or-duplicate',
])

export type TurnstileVerifyResult =
  | { kind: 'ok' }
  | { kind: 'rejected'; errorCodes: string[] }
  | {
      kind: 'unavailable'
      reason: 'timeout' | 'network' | 'http-status' | 'invalid-body' | 'error-codes'
      status?: number
      errorCodes?: string[]
    }

export async function verifyTurnstile(input: {
  secret: string
  token: string
  remoteIp?: string | null
}): Promise<TurnstileVerifyResult> {
  const body = new URLSearchParams({ secret: input.secret, response: input.token })
  if (typeof input.remoteIp === 'string' && input.remoteIp !== '' && input.remoteIp !== 'unknown') {
    body.set('remoteip', input.remoteIp)
  }

  let response: Response
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
    }
  }
  if (!response.ok) {
    return { kind: 'unavailable', reason: 'http-status', status: response.status }
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }
  const record =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  if (record === null || typeof record.success !== 'boolean') {
    return { kind: 'unavailable', reason: 'invalid-body' }
  }
  if (record.success) {
    return { kind: 'ok' }
  }
  const rawCodes = record['error-codes']
  const errorCodes = Array.isArray(rawCodes)
    ? rawCodes.filter((code): code is string => typeof code === 'string')
    : []
  const serviceSide = errorCodes.filter((code) => !TURNSTILE_VISITOR_ERROR_CODES.has(code))
  if (serviceSide.length > 0) {
    return { kind: 'unavailable', reason: 'error-codes', errorCodes }
  }
  return { kind: 'rejected', errorCodes }
}
