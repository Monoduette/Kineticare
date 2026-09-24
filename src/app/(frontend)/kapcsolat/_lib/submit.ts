import { extractPayloadErrorMessage } from '@/lib/payload-rest-error'
import type { ContactFormValues } from './validation'

/**
 * Kapcsolat-űrlap — beküldés a T-016 form-submissions végpontra.
 * API-szerződés (a repóból felderítve, src/payload.config.ts T-016 szakasz):
 * - Végpont: POST /api/form-submissions (a @payloadcms/plugin-form-builder
 * nyilvános create-je — külön /api/contact route szándékosan nincs).
 * - Törzs: { form: <formId>, submissionData: [{ field, value }…],
 * turnstileToken?: string }
 */

export interface SubmissionDataEntry {
  field: string
  value: string
}

export interface FormSubmissionPayload {
  form: string
  submissionData: SubmissionDataEntry[]
  turnstileToken?: string
}

export type SubmitResult = { ok: true } | { ok: false; message: string }

/** Általános, felhasználóbarát hibaüzenet — a szerver-válasz felülírhatja. */
export const GENERIC_SUBMIT_ERROR =
  'Az üzenet küldése most nem sikerült. Próbáld újra néhány perc múlva, vagy írj nekünk e-mailben.'

/**
 * Turnstile-widget láthatósága: CSAK akkor renderelünk widgetet, ha a site
 * key be van állítva. Kulcs nélkül a spam-védelem a szerveren is ki van
 * kapcsolva (T-016), így a widget felesleges zaj lenne.
 */
export function isTurnstileEnabled(siteKey: string | null | undefined): boolean {
  return typeof siteKey === 'string' && siteKey.trim().length > 0
}

export function buildSubmissionPayload(
  values: ContactFormValues,
  formId: string,
  turnstileToken?: string | null,
): FormSubmissionPayload {
  const payload: FormSubmissionPayload = {
    form: formId,
    submissionData: [
      { field: 'name', value: values.name.trim() },
      { field: 'email', value: values.email.trim() },
      { field: 'subject', value: values.subject.trim() },
      { field: 'message', value: values.message.trim() },
      { field: 'consentPrivacy', value: values.consentPrivacy ? 'true' : 'false' },
    ],
  }
  if (typeof turnstileToken === 'string' && turnstileToken.length > 0) {
    payload.turnstileToken = turnstileToken
  }
  return payload
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function submitContactForm(
  payload: FormSubmissionPayload,
  fetchImpl: FetchLike = fetch,
): Promise<SubmitResult> {
  try {
    const response = await fetchImpl('/api/form-submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      return {
        ok: false,
        message: await extractPayloadErrorMessage(response, GENERIC_SUBMIT_ERROR),
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: GENERIC_SUBMIT_ERROR }
  }
}
