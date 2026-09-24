import { extractPayloadErrorMessage } from '../payload-rest-error'

import {
  NEWSLETTER_CONSENT_FIELD,
  NEWSLETTER_EMAIL_FIELD,
  type NewsletterFormValues,
} from './validation'

/**
 * Hírlevél-feliratkozás — POST /api/form-submissions (form-builder plugin).
 * Mezők: email, consentNewsletter; Turnstile, ha TURNSTILE_SECRET_KEY be van állítva.
 * A fetch injektálható teszthez.
 */

export interface NewsletterSubmissionEntry {
  field: string
  value: string
}

export interface NewsletterSubmissionPayload {
  form: string
  submissionData: NewsletterSubmissionEntry[]
  turnstileToken?: string
}

export type NewsletterSubmitResult = { ok: true } | { ok: false; message: string }

/** A form-builder plugin nyilvános beküldési végpontja. */
export const FORM_SUBMISSIONS_ENDPOINT = '/api/form-submissions'

/** Általános, felhasználóbarát hibaüzenet — a szerver-válasz felülírhatja. */
export const NEWSLETTER_GENERIC_ERROR =
  'A feliratkozás most nem sikerült. Próbáld újra néhány perc múlva.'

/** Sikerüzenet — a beküldés után az élő régióban (role="status") jelenik meg. */
/**
 * A lábléc zöld sikerdobozának címe és szövege. A cím kimondja, mi történt,
 * így a jelentést nem egyedül a zöld szín hordozza (GOV.UK Design System,
 * Notification banner: https://design-system.service.gov.uk/components/notification-banner/;
 * WCAG 2.2 SC 1.4.1 Use of Color). A megfogalmazás a kapcsolat-oldali
 * időpontkérés sikerdobozát követi („Megkaptuk az időpontkérésed").
 */
export const NEWSLETTER_SUCCESS_TITLE = 'Feliratkoztál a hírlevélre'

export const NEWSLETTER_SUCCESS_MESSAGE = 'Köszönjük! Hamarosan jelentkezünk az első hírlevéllel.'

/** Turnstile-kulcs mellett, még token nélküli állapotban ez az üzenet megy ki. */
export const NEWSLETTER_TURNSTILE_PENDING_ERROR =
  'A spam-ellenőrzés még fut. Várd meg, amíg lezárul, és küldd el újra.'

/**
 * Turnstile-widget láthatósága: CSAK beállított site key mellett renderelünk.
 * Kulcs nélkül a szerver sem ellenőriz, így a widget felesleges zaj lenne
 * (a kapcsolat-űrlap `isTurnstileEnabled`-jével azonos szabály).
 */
export function isTurnstileEnabled(siteKey: string | null | undefined): boolean {
  return typeof siteKey === 'string' && siteKey.trim().length > 0
}

export function buildNewsletterPayload(
  values: NewsletterFormValues,
  formId: string,
  turnstileToken?: string | null,
): NewsletterSubmissionPayload {
  const payload: NewsletterSubmissionPayload = {
    form: formId,
    submissionData: [
      { field: NEWSLETTER_EMAIL_FIELD, value: values.email.trim() },
      {
        field: NEWSLETTER_CONSENT_FIELD,
        value: values.consentNewsletter ? 'true' : 'false',
      },
    ],
  }
  if (typeof turnstileToken === 'string' && turnstileToken.length > 0) {
    payload.turnstileToken = turnstileToken
  }
  return payload
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function submitNewsletterForm(
  payload: NewsletterSubmissionPayload,
  fetchImpl: FetchLike = fetch,
): Promise<NewsletterSubmitResult> {
  try {
    const response = await fetchImpl(FORM_SUBMISSIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      return {
        ok: false,
        message: await extractPayloadErrorMessage(response, NEWSLETTER_GENERIC_ERROR),
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: NEWSLETTER_GENERIC_ERROR }
  }
}
