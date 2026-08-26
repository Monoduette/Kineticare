'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { withLeadTracking, type LeadTrackers } from '@/lib/analytics/lead-events'
import { ctaLabel, ctaProgressLabel } from '@/lib/cta-vocabulary'

import {
  buildSubmissionPayload,
  GENERIC_SUBMIT_ERROR,
  isTurnstileEnabled,
  submitContactForm,
  type FormSubmissionPayload,
  type SubmitResult,
} from '../_lib/submit'
import {
  CONTACT_ERROR_SUMMARY,
  EMPTY_CONTACT_VALUES,
  isContactFormValid,
  validateContactForm,
  type ContactFormErrors,
  type ContactFormValues,
} from '../_lib/validation'
import { TurnstileWidget } from './TurnstileWidget'

/**
 * ContactForm — a /kapcsolat oldal űrlapja (T-016 form-submissions beküldés).
 * Viselkedés:
 * - Kliensoldali validáció magyar hibaüzenetekkel; az adatkezelési
 * hozzájárulás (consentPrivacy) KÖTELEZŐ és NEM előpipált — enélkül a
 * submit blokkolva van.
 * - Sikeres beküldésnél az űrlap helyett köszönő-nézet jelenik meg.
 */

export interface ContactFormProps {
  /** A „Kapcsolat" form-builder űrlap azonosítója; null = a backend-űrlap nem elérhető. */
  formId: string | null
  /** TURNSTILE_SITE_KEY (szerver-oldalon olvasva); null/üres = widget rejtve. */
  turnstileSiteKey: string | null
}

/** A `trackedSubmitContact` injektálható függőségei (a teszt kémeket ad be). */
export interface TrackedContactDeps {
  submit: (payload: FormSubmissionPayload) => Promise<SubmitResult>
  /** A PostHog lead-küldői; elhagyva az éles küldők futnak (LEAD_TRACKERS). */
  lead?: LeadTrackers
}

/**
 * Kapcsolat-beküldés + PostHog lead-funnel (`kapcsolat` forrás-címke).
 * A hívás ELŐTT `lead_submitted`, sikeres szerverválasz után `lead_succeeded`
 * megy ki. A kettő KÜLÖNBSÉGE a néma beküldési hibák egyetlen külső jelzője —
 * a részletes indoklás és az adatvédelmi szerződés a
 * `src/lib/analytics/lead-events.ts` fejlécében áll.
 * A mérés hibája nem ronthatja el a beküldést: a `withLeadTracking` mindkét
 */
export async function trackedSubmitContact(
  payload: FormSubmissionPayload,
  deps: TrackedContactDeps = { submit: submitContactForm },
): Promise<SubmitResult> {
  return withLeadTracking('kapcsolat', () => deps.submit(payload), { trackers: deps.lead })
}

export function ContactForm({ formId, turnstileSiteKey }: ContactFormProps) {
  const [values, setValues] = useState<ContactFormValues>(EMPTY_CONTACT_VALUES)
  const [errors, setErrors] = useState<ContactFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState('')

  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)

  const turnstileEnabled = isTurnstileEnabled(turnstileSiteKey)
  const formAvailable = formId !== null

  useEffect(() => {
    if (succeeded) {
      successHeadingRef.current?.focus()
    }
  }, [succeeded])

  const updateValue = useCallback(
    (key: keyof ContactFormValues, value: string | boolean) => {
      setValues((previous) => ({ ...previous, [key]: value }))
      // A javított mező hibája azonnal törlődik — a többi marad a submit-ig.
      setErrors((previous) => {
        if (!(key in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[key]
        return next
      })
    },
    [],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)

    const validationErrors = validateContactForm(values)
    setErrors(validationErrors)
    if (!isContactFormValid(validationErrors)) {
      errorSummaryRef.current?.focus()
      return
    }

    // Honeypot: bot gyanú esetén hálózati hívás nélkül „sikerül" a beküldés.
    if (honeypot.length > 0) {
      setSucceeded(true)
      return
    }

    if (turnstileEnabled && !turnstileToken) {
      setSubmitError('Pipáld ki a spam-ellenőrzést, utána küldheted el az üzenetet.')
      errorSummaryRef.current?.focus()
      return
    }

    if (!formId) {
      setSubmitError(GENERIC_SUBMIT_ERROR)
      return
    }

    setSubmitting(true)
    const result = await trackedSubmitContact(
      buildSubmissionPayload(values, formId, turnstileToken),
    )
    setSubmitting(false)

    if (result.ok) {
      setSucceeded(true)
      return
    }
    setSubmitError(result.message)
    errorSummaryRef.current?.focus()
  }

  if (succeeded) {
    return (
      <div aria-live="polite" className="kc-contact-success" role="status">
        <h2 className="kc-contact-success__title" ref={successHeadingRef} tabIndex={-1}>
          Üzeneted megérkezett
        </h2>
        <p>
          Köszönjük, hogy írtál nekünk! Hamarosan válaszolunk a megadott e-mail-címen. Ha sürgős
          a kérdésed, a láblécben találod közvetlen elérhetőségünket.
        </p>
        <Button href="/" variant="secondary">
          Vissza a kezdőlapra
        </Button>
      </div>
    )
  }

  const hasErrorSummary =
    submitError !== null || Object.values(errors).some((message) => Boolean(message))

  return (
    <form className="kc-contact-form" noValidate onSubmit={handleSubmit}>
      {hasErrorSummary ? (
        <div
          aria-live="assertive"
          className="kc-contact-form__summary"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
        >
          {submitError ?? CONTACT_ERROR_SUMMARY}
        </div>
      ) : null}

      <Field
        autoComplete="name"
        disabled={!formAvailable || submitting}
        error={errors.name}
        label="Név"
        name="name"
        onChange={(event) => updateValue('name', event.target.value)}
        required
        value={values.name}
      />

      <Field
        autoComplete="email"
        disabled={!formAvailable || submitting}
        error={errors.email}
        label="E-mail-cím"
        name="email"
        onChange={(event) => updateValue('email', event.target.value)}
        required
        type="email"
        value={values.email}
      />

      <Field
        disabled={!formAvailable || submitting}
        error={errors.subject}
        label="Tárgy"
        name="subject"
        onChange={(event) => updateValue('subject', event.target.value)}
        required
        value={values.subject}
      />

      <div className="kc-field">
        <label className="kc-field__label" htmlFor="kc-field-message">
          Üzenet{' '}
          <span aria-hidden="true" className="kc-field__required">
            *
          </span>
          <span className="kc-visually-hidden"> (kötelező)</span>
        </label>
        <textarea
          aria-describedby={errors.message ? 'kc-field-message-error' : undefined}
          aria-invalid={errors.message ? true : undefined}
          className={[
            'kc-field__input',
            'kc-contact-form__textarea',
            errors.message ? 'kc-field__input--error' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!formAvailable || submitting}
          id="kc-field-message"
          name="message"
          onChange={(event) => updateValue('message', event.target.value)}
          required
          rows={6}
          value={values.message}
        />
        {errors.message ? (
          <p className="kc-field__error" id="kc-field-message-error" role="alert">
            {errors.message}
          </p>
        ) : null}
      </div>

      {/* Honeypot: emberi látogató sosem tölti ki (vizuálisan és a
          billentyű-navigációból is rejtett), a botok igen. */}
      <div aria-hidden="true" className="kc-contact-form__hp">
        <label htmlFor="kc-contact-website">Weboldal</label>
        <input
          autoComplete="off"
          id="kc-contact-website"
          name="website"
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          type="text"
          value={honeypot}
        />
      </div>

      <div className="kc-field kc-contact-form__consent">
        <div className="kc-contact-form__consent-row">
          <input
            aria-describedby={errors.consentPrivacy ? 'kc-consent-error' : 'kc-consent-hint'}
            aria-invalid={errors.consentPrivacy ? true : undefined}
            checked={values.consentPrivacy}
            className="kc-contact-form__checkbox"
            disabled={!formAvailable || submitting}
            id="kc-consent"
            name="consentPrivacy"
            onChange={(event) => updateValue('consentPrivacy', event.target.checked)}
            required
            type="checkbox"
          />
          <label className="kc-contact-form__consent-label" htmlFor="kc-consent">
            Hozzájárulok, hogy az űrlapon megadott adataimat az üzenetem megválaszolása céljából
            az{' '}
            <Link href="/adatvedelem">Adatkezelési és adatvédelmi szabályzatban</Link>{' '}
            foglaltak szerint kezeljük.{' '}
            <span aria-hidden="true" className="kc-field__required">
              *
            </span>
          </label>
        </div>
        {errors.consentPrivacy ? (
          <p className="kc-field__error" id="kc-consent-error" role="alert">
            {errors.consentPrivacy}
          </p>
        ) : (
          <p className="kc-field__hint" id="kc-consent-hint">
            A hozzájárulás nélkül nem tudjuk fogadni az üzeneted.
          </p>
        )}
      </div>

      {turnstileEnabled ? (
        <TurnstileWidget onToken={setTurnstileToken} siteKey={turnstileSiteKey as string} />
      ) : null}

      {!formAvailable ? (
        <p className="kc-contact-form__unavailable" role="alert">
          Az űrlap most nem érhető el. Próbáld újra később, vagy írj nekünk közvetlenül e-mailben:
          a címünket a láblécben találod.
        </p>
      ) : null}

      {/* §3.2 #12: adat megy el, tehát elkötelezés (P-1a → E/1). A régi
          kineticare.hu kapcsolat-űrlapján szó szerint ELKÜLDÖM állt (mérve:
          docs/regi-oldal-osszehasonlitas.md 3.1) — Jakob törvénye. A korábbi
          „Üzenet küldése" deverbális főnévi alak volt (M-1). */}
      <Button disabled={!formAvailable || submitting} type="submit">
        {submitting ? ctaProgressLabel('contact-submit') : ctaLabel('contact-submit')}
      </Button>
    </form>
  )
}
