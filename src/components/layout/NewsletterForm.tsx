'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  TURNSTILE_UNAVAILABLE_ERROR,
  TurnstileWidget,
} from '@/app/(frontend)/kapcsolat/_components/TurnstileWidget'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { BARION_SIGNUP, trackSignUp, type BarionSignUpEvent } from '@/lib/analytics/barion-events'
import { withLeadTracking, type LeadTrackers } from '@/lib/analytics/lead-events'
import { NEWSLETTER_CONSENT_TEXT, PRIVACY_POLICY_PATH } from '@/lib/newsletter/consent-text'
import {
  buildNewsletterPayload,
  isTurnstileEnabled,
  NEWSLETTER_SUCCESS_MESSAGE,
  NEWSLETTER_SUCCESS_TITLE,
  NEWSLETTER_TURNSTILE_PENDING_ERROR,
  submitNewsletterForm,
  type NewsletterSubmissionPayload,
  type NewsletterSubmitResult,
} from '@/lib/newsletter/submit'
import {
  EMPTY_NEWSLETTER_VALUES,
  isNewsletterFormValid,
  validateNewsletterForm,
  type NewsletterFormErrors,
  type NewsletterFormValues,
} from '@/lib/newsletter/validation'

/**
 * NewsletterForm — a lábléc hírlevél-feliratkozó űrlapja (C9).
 * A kapcsolat-űrlap (T-016) mintáját követi, mert UGYANARRA a form-builder
 * végpontra küld:
 * - kliensoldali validáció magyar hibaüzenetekkel, hozzájárulás nélkül a
 * beküldés blokkolva (a szerver is elutasítaná);
 * - honeypot rejtett mező a botok ellen;
 */

export interface NewsletterFormProps {
  /** A „Hírlevél" form-builder űrlap azonosítója. */
  formId: string
  /** TURNSTILE_SITE_KEY (szerver-oldalon olvasva); null/üres = widget rejtve. */
  turnstileSiteKey: string | null
}

/** A `trackedSubmitNewsletter` injektálható függőségei (a teszt kémeket ad be). */
export interface TrackedNewsletterDeps {
  submit: (payload: NewsletterSubmissionPayload) => Promise<NewsletterSubmitResult>
  track: (event: BarionSignUpEvent) => boolean
  /** A PostHog lead-küldői; elhagyva az éles küldők futnak (LEAD_TRACKERS). */
  lead?: LeadTrackers
}

/**
 * Hírlevél-beküldés + Barion `signUp` + PostHog lead-funnel.
 * A feliratkozás NEM beléptetés: a látogató továbbra is kijelentkezve marad.
 * A `trackAccountSignUp` (retesz-foglaló) változat itt hibás lenne — elnyelné
 */
export async function trackedSubmitNewsletter(
  payload: NewsletterSubmissionPayload,
  deps: TrackedNewsletterDeps = {
    submit: submitNewsletterForm,
    track: (event) => trackSignUp(event),
  },
): Promise<NewsletterSubmitResult> {
  return withLeadTracking(
    'hirlevel',
    async () => {
      const result = await deps.submit(payload)
      if (result.ok) {
        try {
          deps.track(BARION_SIGNUP.newsletter)
        } catch {
          // A mérés hibája nem érheti el a felhasználót.
        }
      }
      return result
    },
    { trackers: deps.lead },
  )
}

export function NewsletterForm({ formId, turnstileSiteKey }: NewsletterFormProps) {
  const [values, setValues] = useState<NewsletterFormValues>(EMPTY_NEWSLETTER_VALUES)
  const [errors, setErrors] = useState<NewsletterFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  // A Turnstile-token egyszer használható: sikertelen beküldés után új kell.
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  const [touched, setTouched] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const successTitleRef = useRef<HTMLHeadingElement>(null)

  // Sikerkor a mezők és a gomb eltűnnek: a fókusz a zöld doboz címére lép,
  // különben a billentyűzetes látogató fókusza a lap elejére esne vissza
  // (a kapcsolat-oldali időpontkérés azonos mintája, WCAG 2.2 SC 2.4.3).
  useEffect(() => {
    if (succeeded) {
      successTitleRef.current?.focus()
    }
  }, [succeeded])

  const turnstileEnabled = isTurnstileEnabled(turnstileSiteKey)
  const disabled = submitting || succeeded

  const updateValue = useCallback((key: keyof NewsletterFormValues, value: string | boolean) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      if (!(key in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[key]
      return next
    })
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatusMessage('')

    const validationErrors = validateNewsletterForm(values)
    setErrors(validationErrors)
    if (!isNewsletterFormValid(validationErrors)) {
      return
    }

    // Honeypot: bot gyanú esetén hálózati hívás nélkül „sikerül" a beküldés.
    if (honeypot.length > 0) {
      setSucceeded(true)
      setStatusMessage(NEWSLETTER_SUCCESS_MESSAGE)
      return
    }

    if (turnstileEnabled && !turnstileToken) {
      setStatusMessage(
        turnstileFailed ? TURNSTILE_UNAVAILABLE_ERROR : NEWSLETTER_TURNSTILE_PENDING_ERROR,
      )
      return
    }

    setSubmitting(true)
    const result = await trackedSubmitNewsletter(
      buildNewsletterPayload(values, formId, turnstileToken),
    )
    setSubmitting(false)

    if (result.ok) {
      setSucceeded(true)
      setStatusMessage(NEWSLETTER_SUCCESS_MESSAGE)
      return
    }
    setStatusMessage(result.message)
    if (turnstileEnabled) {
      setTurnstileReset((previous) => previous + 1)
    }
  }

  return (
    <form
      aria-labelledby="kc-newsletter-title"
      className="kc-newsletter"
      noValidate
      onFocus={() => setTouched(true)}
      onSubmit={handleSubmit}
    >
      <div className="kc-newsletter__intro">
        <h2 className="kc-newsletter__title" id="kc-newsletter-title">
          Hírlevél
        </h2>
        <p className="kc-newsletter__lead">
          Iratkozz fel, és értesülj elsőként az új kézrehabilitációs kurzusokról, gyakorlatokról és
          szakmai tartalmakról. Bármikor leiratkozhatsz.
        </p>
      </div>

      {succeeded ? null : (
        <>
          <div className="kc-newsletter__row">
            <Field
              autoComplete="email"
              className="kc-newsletter__email"
              disabled={disabled}
              error={errors.email}
              inputMode="email"
              label="E-mail-cím"
              name="newsletterEmail"
              onChange={(event) => updateValue('email', event.target.value)}
              placeholder="nev@pelda.hu"
              required
              type="email"
              value={values.email}
            />
            <Button disabled={disabled} type="submit">
              {submitting ? 'Küldés…' : 'Feliratkozom'}
            </Button>
          </div>

          {/* Honeypot: emberi látogató sosem tölti ki (vizuálisan és a
            billentyű-navigációból is rejtett), a botok igen. */}
          <div aria-hidden="true" className="kc-newsletter__hp">
            <label htmlFor="kc-newsletter-website">Weboldal</label>
            <input
              autoComplete="off"
              id="kc-newsletter-website"
              name="website"
              onChange={(event) => setHoneypot(event.target.value)}
              tabIndex={-1}
              type="text"
              value={honeypot}
            />
          </div>

          <div className="kc-newsletter__consent">
            <div className="kc-newsletter__consent-row">
              <input
                aria-describedby={
                  errors.consentNewsletter ? 'kc-newsletter-consent-error' : undefined
                }
                aria-invalid={errors.consentNewsletter ? true : undefined}
                checked={values.consentNewsletter}
                className="kc-newsletter__checkbox"
                disabled={disabled}
                id="kc-newsletter-consent"
                name="consentNewsletter"
                onChange={(event) => updateValue('consentNewsletter', event.target.checked)}
                required
                type="checkbox"
              />
              <label className="kc-newsletter__consent-label" htmlFor="kc-newsletter-consent">
                {NEWSLETTER_CONSENT_TEXT.before}
                <Link href={PRIVACY_POLICY_PATH}>{NEWSLETTER_CONSENT_TEXT.linkLabel}</Link>
                {NEWSLETTER_CONSENT_TEXT.after}{' '}
                <span aria-hidden="true" className="kc-field__required">
                  *
                </span>
              </label>
            </div>
            {errors.consentNewsletter ? (
              <p className="kc-field__error" id="kc-newsletter-consent-error" role="alert">
                {errors.consentNewsletter}
              </p>
            ) : null}
          </div>

          {turnstileEnabled && touched ? (
            <TurnstileWidget
              onError={() => setTurnstileFailed(true)}
              onToken={(token) => {
                setTurnstileToken(token)
                if (token) {
                  setTurnstileFailed(false)
                }
              }}
              resetKey={turnstileReset}
              siteKey={turnstileSiteKey as string}
            />
          ) : null}
        </>
      )}

      {/* Élő régió: MINDIG a DOM-ban van (üresen is), csak a tartalma változik,
          így a képernyőolvasó a zöld dobozt és a hibát is felolvassa
          (WCAG 2.2 SC 4.1.3 Status Messages). */}
      <div aria-live="polite" className="kc-newsletter__status" role="status">
        {succeeded ? (
          <div className="kc-newsletter__success">
            <h3 className="kc-newsletter__success-title" ref={successTitleRef} tabIndex={-1}>
              {NEWSLETTER_SUCCESS_TITLE}
            </h3>
            <p className="kc-newsletter__success-text">{NEWSLETTER_SUCCESS_MESSAGE}</p>
          </div>
        ) : statusMessage ? (
          <p className="kc-newsletter__error">{statusMessage}</p>
        ) : null}
      </div>
    </form>
  )
}
