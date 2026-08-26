'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { TurnstileWidget } from '@/app/(frontend)/kapcsolat/_components/TurnstileWidget'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { withLeadTracking, type LeadTrackers } from '@/lib/analytics/lead-events'
import { CTA_PROGRESS_LABELS } from '@/lib/cta-vocabulary'
import {
  buildFreeCourseRequestPayload,
  submitFreeCourseRequest,
  type FreeCourseRequestPayload,
  type FreeCourseSubmitResult,
} from '@/lib/free-course/submit'
import {
  CONTACT_PATH,
  FREE_COURSE_CONSENT_HINT,
  FREE_COURSE_CONSENT_TEXT,
  FREE_COURSE_EMAIL_HINT,
  FREE_COURSE_EMAIL_LABEL,
  FREE_COURSE_ERROR_SUMMARY,
  FREE_COURSE_INTRO,
  FREE_COURSE_NAME_LABEL,
  FREE_COURSE_NO_EMAIL_BODY,
  FREE_COURSE_NO_EMAIL_LINK_LABEL,
  FREE_COURSE_NO_EMAIL_TITLE,
  FREE_COURSE_SUBMIT_LABEL,
  FREE_COURSE_SUCCESS_BODY,
  FREE_COURSE_SUCCESS_TITLE,
  FREE_COURSE_TURNSTILE_PENDING_ERROR,
  PRIVACY_POLICY_PATH,
} from '@/lib/free-course/ui-text'
import {
  EMPTY_FREE_COURSE_VALUES,
  isFreeCourseFormValid,
  validateFreeCourseForm,
  type FreeCourseFormErrors,
  type FreeCourseFormValues,
} from '@/lib/free-course/validation'

/**
 * Ingyenes kurzus igénylő űrlap a kurzusoldalon (lapon belül, nem popup).
 * Név + e-mail; Barion/ár nélkül. Turnstile + honeypot, mint a kapcsolat-űrlap.
 * Siker/hiba után a címsor/összefoglaló kapja a fókuszt.
 */

export interface FreeCourseRequestFormProps {
  /** A kért kurzus adatbázis-azonosítója. */
  productId: number
  /** A kurzus megjelenő címe — a hozzáférhető űrlapnév és a siker-szöveg használja. */
  courseTitle: string
  /** TURNSTILE_SITE_KEY (szerver-oldalon olvasva); null/üres = widget rejtve. */
  turnstileSiteKey: string | null
  /** A CTA-blokk horgonya (a kurzusoldal CTA-területének azonosítója). */
  id?: string
  /** Bejelentkezett látogatónál előtöltött név (ilyenkor nem kell újra begépelnie). */
  defaultName?: string
  /** Bejelentkezett látogatónál előtöltött e-mail-cím. */
  defaultEmail?: string
}

/** A widget CSAK beállított site key mellett renderelődik (a kapcsolat-űrlap szabálya). */
function isTurnstileEnabled(siteKey: string | null | undefined): boolean {
  return typeof siteKey === 'string' && siteKey.trim().length > 0
}

/** A `trackedSubmitFreeCourseRequest` injektálható függőségei (a teszt kémeket ad be). */
export interface TrackedFreeCourseDeps {
  submit: (payload: FreeCourseRequestPayload) => Promise<FreeCourseSubmitResult>
  /** A PostHog lead-küldői; elhagyva az éles küldők futnak (LEAD_TRACKERS). */
  lead?: LeadTrackers
}

/**
 * Ingyenes kurzus igénylése + PostHog lead-funnel (`ingyenes-kurzus` címke).
 * A hívás ELŐTT `lead_submitted`, sikeres szerverválasz után `lead_succeeded`
 * megy ki. A kettő KÜLÖNBSÉGE a néma beküldési hibák egyetlen külső jelzője —
 * a részletes indoklás és az adatvédelmi szerződés a
 * `src/lib/analytics/lead-events.ts` fejlécében áll.
 * EZ AZ EGYETLEN LEAD-FORRÁS, AMI KURZUS-AZONOSÍTÓT IS KÜLD: az igénylés egy
 */
export async function trackedSubmitFreeCourseRequest(
  payload: FreeCourseRequestPayload,
  deps: TrackedFreeCourseDeps = { submit: submitFreeCourseRequest },
): Promise<FreeCourseSubmitResult> {
  return withLeadTracking('ingyenes-kurzus', () => deps.submit(payload), {
    extra: { courseId: payload.productId },
    trackers: deps.lead,
  })
}

export function FreeCourseRequestForm({
  productId,
  courseTitle,
  turnstileSiteKey,
  id,
  defaultName,
  defaultEmail,
}: FreeCourseRequestFormProps) {
  const [values, setValues] = useState<FreeCourseFormValues>({
    ...EMPTY_FREE_COURSE_VALUES,
    name: defaultName ?? '',
    email: defaultEmail ?? '',
  })
  const [errors, setErrors] = useState<FreeCourseFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  /** `null` = még nem küldtük be; egyébként: kiment-e a belépő levél. */
  const [succeededEmailSent, setSucceededEmailSent] = useState<boolean | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(0)

  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const successHeadingRef = useRef<HTMLParagraphElement>(null)

  const turnstileEnabled = isTurnstileEnabled(turnstileSiteKey)
  const succeeded = succeededEmailSent !== null

  useEffect(() => {
    if (succeeded) {
      successHeadingRef.current?.focus()
    }
  }, [succeeded])

  useEffect(() => {
    if (failedAttempts > 0) {
      errorSummaryRef.current?.focus()
    }
  }, [failedAttempts])

  const updateValue = useCallback((key: keyof FreeCourseFormValues, value: string | boolean) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    // A javított mező hibája azonnal törlődik, a többi a következő beküldésig
    // marad (Baymard: a hiba tűnjön el, amint a bevitel helyessé válik).
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
    setSubmitError(null)

    const validationErrors = validateFreeCourseForm(values)
    setErrors(validationErrors)
    if (!isFreeCourseFormValid(validationErrors)) {
      setFailedAttempts((previous) => previous + 1)
      return
    }

    // Honeypot: bot gyanú esetén hálózati hívás nélkül „sikerül" a beküldés.
    if (honeypot.length > 0) {
      setSucceededEmailSent(true)
      return
    }

    if (turnstileEnabled && !turnstileToken) {
      setSubmitError(FREE_COURSE_TURNSTILE_PENDING_ERROR)
      setFailedAttempts((previous) => previous + 1)
      return
    }

    setSubmitting(true)
    const result = await trackedSubmitFreeCourseRequest(
      buildFreeCourseRequestPayload(values, productId, turnstileToken),
    )
    setSubmitting(false)

    if (result.ok) {
      setSucceededEmailSent(result.emailSent)
      return
    }
    setSubmitError(result.message)
    setFailedAttempts((previous) => previous + 1)
  }

  if (succeeded) {
    // A siker-nézet KÉT változata. Ha a belépő levél nem tudott kimenni, a
    // látogató IGAZ üzenetet kap arról, mi történt és mi a következő lépése —
    // a hozzáférése ilyenkor is létrejött (§2.7: mondd meg, mi történt és
    // hogyan léphet tovább).
    const emailSent = succeededEmailSent === true
    return (
      <div
        aria-live="polite"
        // A SZÍN is mondjon igazat: a levél nélküli ág nem tiszta siker (a
        // hozzáférés megvan, a link viszont nem ment ki), ezért a figyelem-
        // (warning) tokenpárt viseli, nem a sikerzöldet. NN/g 1. heurisztika:
        // a rendszerállapot legyen látható és pontos. A `role="status"` marad:
        // ez állapot, nem hiba.
        className={`kc-free-course__success${emailSent ? '' : ' kc-free-course__success--figyelem'}`}
        id={id}
        role="status"
      >
        <p
          className="kc-free-course__success-title"
          ref={successHeadingRef}
          tabIndex={-1}
        >
          {emailSent ? FREE_COURSE_SUCCESS_TITLE : FREE_COURSE_NO_EMAIL_TITLE}
        </p>
        <p className="kc-free-course__success-body">
          {emailSent ? FREE_COURSE_SUCCESS_BODY : FREE_COURSE_NO_EMAIL_BODY}
        </p>
        {emailSent ? null : (
          <p className="kc-free-course__success-body">
            <Link className="kc-course-textlink" href={CONTACT_PATH}>
              {FREE_COURSE_NO_EMAIL_LINK_LABEL}
            </Link>
          </p>
        )}
      </div>
    )
  }

  const hasErrorSummary =
    submitError !== null || Object.values(errors).some((message) => Boolean(message))

  return (
    <form
      aria-label={`${courseTitle} igénylése`}
      className="kc-free-course"
      id={id}
      noValidate
      onSubmit={handleSubmit}
    >
      {hasErrorSummary ? (
        <div
          aria-live="assertive"
          className="kc-free-course__summary"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
        >
          {submitError ?? FREE_COURSE_ERROR_SUMMARY}
        </div>
      ) : null}

      <p className="kc-free-course__intro">{FREE_COURSE_INTRO}</p>

      <Field
        autoComplete="name"
        disabled={submitting}
        error={errors.name}
        label={FREE_COURSE_NAME_LABEL}
        name="freeCourseName"
        onChange={(event) => updateValue('name', event.target.value)}
        required
        value={values.name}
      />

      <Field
        autoComplete="email"
        disabled={submitting}
        error={errors.email}
        hint={FREE_COURSE_EMAIL_HINT}
        inputMode="email"
        label={FREE_COURSE_EMAIL_LABEL}
        name="freeCourseEmail"
        onChange={(event) => updateValue('email', event.target.value)}
        required
        type="email"
        value={values.email}
      />

      {/* Honeypot: emberi látogató sosem tölti ki (vizuálisan és a
          billentyű-navigációból is rejtett), a botok igen. */}
      <div aria-hidden="true" className="kc-free-course__hp">
        <label htmlFor="kc-free-course-website">Weboldal</label>
        <input
          autoComplete="off"
          id="kc-free-course-website"
          name="website"
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          type="text"
          value={honeypot}
        />
      </div>

      <div className="kc-field kc-free-course__consent">
        <div className="kc-free-course__consent-row">
          <input
            aria-describedby={
              errors.consentPrivacy ? 'kc-free-course-consent-error' : 'kc-free-course-consent-hint'
            }
            aria-invalid={errors.consentPrivacy ? true : undefined}
            checked={values.consentPrivacy}
            className="kc-free-course__checkbox"
            disabled={submitting}
            id="kc-free-course-consent"
            name="consentPrivacy"
            onChange={(event) => updateValue('consentPrivacy', event.target.checked)}
            required
            type="checkbox"
          />
          <label className="kc-free-course__consent-label" htmlFor="kc-free-course-consent">
            {FREE_COURSE_CONSENT_TEXT.before}
            <Link href={PRIVACY_POLICY_PATH}>{FREE_COURSE_CONSENT_TEXT.linkLabel}</Link>
            {FREE_COURSE_CONSENT_TEXT.after}{' '}
            <span aria-hidden="true" className="kc-field__required">
              *
            </span>
            <span className="kc-visually-hidden"> (kötelező)</span>
          </label>
        </div>
        {errors.consentPrivacy ? (
          <p className="kc-field__error" id="kc-free-course-consent-error" role="alert">
            {errors.consentPrivacy}
          </p>
        ) : (
          <p className="kc-field__hint" id="kc-free-course-consent-hint">
            {FREE_COURSE_CONSENT_HINT}
          </p>
        )}
      </div>

      {turnstileEnabled ? (
        <div className="kc-free-course__turnstile">
          <TurnstileWidget onToken={setTurnstileToken} siteKey={turnstileSiteKey as string} />
        </div>
      ) : null}

      {/* A felirat és a súly indoklása egy helyen él: `ui-text.ts`
          FREE_COURSE_SUBMIT_LABEL. A folyamatban-felirat a ZÁRT L-1
          készletből jön (`Küldés…`), nem kitalált szöveg. */}
      <Button disabled={submitting} type="submit" variant="primary">
        {submitting ? CTA_PROGRESS_LABELS.send : FREE_COURSE_SUBMIT_LABEL}
      </Button>
    </form>
  )
}
