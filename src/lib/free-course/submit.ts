import { FREE_COURSE_GENERIC_ERROR } from './ui-text'
import type { FreeCourseFormValues } from './validation'

/**
 * Ingyenes kurzus kliens beküldés → POST /api/free-course/request (nem form-builder: fiók+hozzáférés+levél).
 */

/** A saját igénylő-végpont útvonala. */
export const FREE_COURSE_REQUEST_ENDPOINT = '/api/free-course/request'

export interface FreeCourseRequestPayload {
  productId: number
  name: string
  email: string
  consentPrivacy: boolean
  turnstileToken?: string
  website?: string
}

export type FreeCourseSubmitResult =
  | { ok: true; emailSent: boolean }
  | { ok: false; message: string }

export function buildFreeCourseRequestPayload(
  values: FreeCourseFormValues,
  productId: number,
  turnstileToken?: string | null,
): FreeCourseRequestPayload {
  const payload: FreeCourseRequestPayload = {
    productId,
    name: values.name.trim(),
    email: values.email.trim(),
    consentPrivacy: values.consentPrivacy,
  }
  if (typeof turnstileToken === 'string' && turnstileToken.length > 0) {
    payload.turnstileToken = turnstileToken
  }
  return payload
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * A szerver hibaüzenetének kiolvasása. A saját végpont `{ error }` alakot ad
 * (a route-handlerek közös szerződése, lásd `checkout/route-handler.ts`);
 * bármi másra az általános magyar üzenet marad.
 */
async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const message = (body as Record<string, unknown>).error
      if (typeof message === 'string' && message.length > 0) {
        return message
      }
    }
  } catch {
    // Nem JSON-válasz — marad az általános üzenet.
  }
  return FREE_COURSE_GENERIC_ERROR
}

export async function submitFreeCourseRequest(
  payload: FreeCourseRequestPayload,
  fetchImpl: FetchLike = fetch,
): Promise<FreeCourseSubmitResult> {
  try {
    const response = await fetchImpl(FREE_COURSE_REQUEST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      return { ok: false, message: await extractErrorMessage(response) }
    }
    const body: unknown = await response.json().catch(() => ({}))
    // Az `emailSent` hiánya a ROSSZABB ágra esik: inkább mondjuk azt, hogy a
    // levél nem ment ki (és adjunk kézi utat), mint hogy hamisan ígérjünk
    // levelet, ami sosem érkezik meg.
    const emailSent =
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>).emailSent === true
    return { ok: true, emailSent }
  } catch {
    return { ok: false, message: FREE_COURSE_GENERIC_ERROR }
  }
}
