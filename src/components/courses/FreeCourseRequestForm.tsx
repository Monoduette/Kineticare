'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'

import { TurnstileWidget } from '@/app/(frontend)/kapcsolat/_components/TurnstileWidget'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { withLeadTracking, type LeadTrackers } from '@/lib/analytics/lead-events'
import { CTA_PROGRESS_LABELS, ctaLabel } from '@/lib/cta-vocabulary'
import { myCoursePlayerHref } from '@/lib/courses'
import {
  buildFreeCourseRequestPayload,
  submitFreeCourseRequest,
  type FreeCourseRequestPayload,
  type FreeCourseSubmitResult,
} from '@/lib/free-course/submit'
import {
  CONTACT_PATH,
  FREE_COURSE_BLOCKED_BODY,
  FREE_COURSE_BLOCKED_TITLE,
  FREE_COURSE_CONSENT_HINT,
  FREE_COURSE_CONSENT_TEXT,
  FREE_COURSE_EMAIL_HINT,
  FREE_COURSE_EMAIL_LABEL,
  FREE_COURSE_ERROR_SUMMARY,
  FREE_COURSE_INTRO,
  FREE_COURSE_LIBRARY_BODY,
  FREE_COURSE_LIBRARY_TITLE,
  FREE_COURSE_NAME_LABEL,
  FREE_COURSE_NO_EMAIL_BODY,
  FREE_COURSE_NO_EMAIL_LINK_LABEL,
  FREE_COURSE_NO_EMAIL_TITLE,
  FREE_COURSE_SUBMIT_LABEL,
  FREE_COURSE_SUCCESS_BODY,
  FREE_COURSE_SUCCESS_TITLE,
  FREE_COURSE_TURNSTILE_PENDING_ERROR,
  PRIVACY_POLICY_PATH,
  resolveFreeCourseSuccessKind,
  type FreeCourseUiNext,
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

/**
 * A beküldés utáni nézet. A `next` CSAK bejelentkezett válaszból jön;
 * vendégnél a két út (új cím / meglévő fiók) szándékosan egy e-mail-szöveg.
 *
 * Forrás: GOV.UK, Confirm a user exists
 * https://design-system.service.gov.uk/patterns/confirm-a-user-exists/ ;
 * NN/g, Error Message Guidelines (mondd meg, mi történt)
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * WCAG 2.2 · 3.3.1 Error Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
 */
export function FreeCourseSuccessView(input: {
  emailSent: boolean
  next?: FreeCourseUiNext | null
  productId: number
  id?: string
  headingRef?: RefObject<HTMLParagraphElement | null>
}): JSX.Element {
  const kind = resolveFreeCourseSuccessKind({
    next: input.next,
    emailSent: input.emailSent,
  })
  const figyelem = kind === 'no-email' || kind === 'blocked'
  const title =
    kind === 'library'
      ? FREE_COURSE_LIBRARY_TITLE
      : kind === 'blocked'
        ? FREE_COURSE_BLOCKED_TITLE
        : kind === 'email'
          ? FREE_COURSE_SUCCESS_TITLE
          : FREE_COURSE_NO_EMAIL_TITLE
  const body =
    kind === 'library'
      ? FREE_COURSE_LIBRARY_BODY
      : kind === 'blocked'
        ? FREE_COURSE_BLOCKED_BODY
        : kind === 'email'
          ? FREE_COURSE_SUCCESS_BODY
          : FREE_COURSE_NO_EMAIL_BODY

  return (
    <div
      aria-live="polite"
      className={`kc-free-course__success${figyelem ? ' kc-free-course__success--figyelem' : ''}`}
      id={input.id}
      role="status"
    >
      <p className="kc-free-course__success-title" ref={input.headingRef} tabIndex={-1}>
        {title}
      </p>
      <p className="kc-free-course__success-body">{body}</p>
      {kind === 'library' ? (
        <p className="kc-free-course__success-body">
          <Button href={myCoursePlayerHref(input.productId)} variant="primary">
            {ctaLabel('course-start')}
          </Button>
        </p>
      ) : null}
      {kind === 'blocked' || kind === 'no-email' ? (
        <p className="kc-free-course__success-body">
          <Link className="kc-course-textlink" href={CONTACT_PATH}>
            {FREE_COURSE_NO_EMAIL_LINK_LABEL}
          </Link>
        </p>
      ) : null}
    </div>
  )
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
  /** `null` = még nem küldtük be; egyébként a szerver őszinte sikerága. */
  const [success, setSuccess] = useState<{
    emailSent: boolean
    next?: FreeCourseUiNext
  } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(0)

  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const successHeadingRef = useRef<HTMLParagraphElement>(null)

  const turnstileEnabled = isTurnstileEnabled(turnstileSiteKey)
  const succeeded = success !== null

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
      setSuccess({ emailSent: true })
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
      setSuccess({ emailSent: result.emailSent, next: result.next })
      return
    }
    setSubmitError(result.message)
    setFailedAttempts((previous) => previous + 1)
  }

  if (succeeded && success !== null) {
    return (
      <FreeCourseSuccessView
        emailSent={success.emailSent}
        headingRef={successHeadingRef}
        id={id}
        next={success.next}
        productId={productId}
      />
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
