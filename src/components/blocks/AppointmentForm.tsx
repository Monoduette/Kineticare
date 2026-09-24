'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  TURNSTILE_UNAVAILABLE_ERROR,
  TurnstileWidget,
} from '@/app/(frontend)/kapcsolat/_components/TurnstileWidget'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { withLeadTracking, type LeadTrackers } from '@/lib/analytics/lead-events'
import {
  APPOINTMENT_CONSENT_TEXT,
  APPOINTMENT_PRIVACY_POLICY_PATH,
} from '@/lib/appointment/consent-text'
import {
  APPOINTMENT_REASON_MAX_LENGTH,
  APPOINTMENT_UI_TEXT,
  EMPTY_APPOINTMENT_VALUES,
  isAppointmentFormValid,
  validateAppointmentForm,
  type AppointmentFormErrors,
  type AppointmentFormValues,
} from '@/lib/appointment/validation'
import {
  APPOINTMENT_TURNSTILE_PENDING_ERROR,
  APPOINTMENT_UNAVAILABLE_ERROR,
  buildAppointmentPayload,
  isTurnstileEnabled,
  submitAppointmentForm,
  type AppointmentSubmissionPayload,
  type AppointmentSubmitResult,
} from '@/lib/appointment/submit'
import { ctaLabel } from '@/lib/cta-vocabulary'

/**
 * AppointmentForm — időpontkérő szekció űrlapja (kapcsolat-űrlap mintájára).
 * Beküldő felirat: kód nyer (§3.2 #25); CMS gombFelirat prop inaktív.
 * Siker/hiba után a címsor/összefoglaló kapja a fókuszt.
 */

export interface AppointmentFormProps {
  /** Az „Időpontkérés" form-builder űrlap azonosítója; null = a backend nem elérhető. */
  formId: string | null
  /** TURNSTILE_SITE_KEY (szerver-oldalon olvasva); null/üres = widget rejtve. */
  turnstileSiteKey: string | null
  /** A választható időpont-sávok feliratai (CMS); üres tömb = a kérdés kimarad. */
  idopontSavok: readonly string[]
  /**
   * A blokk „A gomb felirata" mezője (CMS).
   *
   * INAKTÍV, SZÁNDÉKOSAN. Az időpontkérés a §3.2 #25 SZÓTÁRI cselekvése, ezért
   * a feliratot a kód adja (`ctaLabel('appointment-submit')`), és a CMS-mező
   * nem írja felül. Lásd a komponens fejkommentjének „A FELIRAT FORRÁSA"
   * szakaszát. A mező azért marad a propok között, mert az adatbázisban lévő
   * értékeket NEM dobjuk el: a szerkesztő szövege megmarad, csak nem jelenik
   * meg. A mező sorsáról (súgó-szöveg vagy megszüntetés) tulajdonosi döntés
   * kell — addig a prop itt, egy helyen, kimondva inaktív.
   */
  gombFelirat?: string
  /** A sikeres beküldés címe (CMS); üresen az alapértelmezett. */
  sikerCim?: string
  /** A sikeres beküldés szövege (CMS); üresen az alapértelmezett. */
  sikerSzoveg?: string
  /** A siker-nézetben megismételt telefonszámok (CMS), hívás-linkkel. */
  telefonok?: ReadonlyArray<{ nev: string; szam: string; href: string | null }>
}

/** A `trackedSubmitAppointment` injektálható függőségei (a teszt kémeket ad be). */
export interface TrackedAppointmentDeps {
  submit: (payload: AppointmentSubmissionPayload) => Promise<AppointmentSubmitResult>
  /** A PostHog lead-küldői; elhagyva az éles küldők futnak (LEAD_TRACKERS). */
  lead?: LeadTrackers
}

/**
 * Időpontkérés beküldése + PostHog lead-funnel. Egészségügyi adat NEM megy a mérésbe.
 * Részletek: lead-events.ts.
 */
export async function trackedSubmitAppointment(
  payload: AppointmentSubmissionPayload,
  deps: TrackedAppointmentDeps = { submit: submitAppointmentForm },
): Promise<AppointmentSubmitResult> {
  return withLeadTracking('idopontkeres', () => deps.submit(payload), { trackers: deps.lead })
}

export function AppointmentForm({
  formId,
  turnstileSiteKey,
  idopontSavok,
  sikerCim,
  sikerSzoveg,
  telefonok = [],
}: AppointmentFormProps) {
  const [values, setValues] = useState<AppointmentFormValues>(EMPTY_APPOINTMENT_VALUES)
  const [errors, setErrors] = useState<AppointmentFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  // A Turnstile-token egyszer használható: sikertelen beküldés után új kell.
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  const [honeypot, setHoneypot] = useState('')

  /**
   * Sikertelen beküldési kísérletek számlálója — CSAK a fókuszáláshoz.
   *
   * MIÉRT NEM ELÉG a `errorSummaryRef.current?.focus()` a beküldés-kezelőben:
   * a hiba-összefoglaló akkor kerül a DOM-ba, amikor a hiba-állapot már
   * kirenderelődött, a `setErrors` viszont ASZINKRON. A kezelőben hívott focus
   * ezért még `null` refre futna, és a fókusz a gombon maradna — élő lapon
   * mérve pontosan ez történt. A számláló növelése új rendert vált ki, és az
   * effekt már a kirenderelt dobozt találja meg. A számláló azért jobb a
   * „van-e hiba" logikai értéknél, mert két egymás utáni, UGYANOLYAN hibás
   * beküldésnél is újra fókuszál.
   */
  const [hibasKiserlet, setHibasKiserlet] = useState(0)

  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (succeeded) {
      successHeadingRef.current?.focus()
    }
  }, [succeeded])

  useEffect(() => {
    if (hibasKiserlet > 0) {
      errorSummaryRef.current?.focus()
    }
  }, [hibasKiserlet])

  const turnstileEnabled = isTurnstileEnabled(turnstileSiteKey)
  const formAvailable = formId !== null
  const disabled = !formAvailable || submitting

  const updateValue = useCallback(
    (key: keyof AppointmentFormValues, value: string | boolean | string[]) => {
      setValues((previous) => ({ ...previous, [key]: value }))
      // A javított mező hibája azonnal törlődik — a többi a következő
      // beküldésig marad (az NN/g „ne szidd le, mielőtt gépelne" szabálya).
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

  const toggleSav = useCallback((felirat: string, checked: boolean) => {
    setValues((previous) => ({
      ...previous,
      availability: checked
        ? [...previous.availability, felirat]
        : previous.availability.filter((item) => item !== felirat),
    }))
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)

    const validationErrors = validateAppointmentForm(values)
    setErrors(validationErrors)
    if (!isAppointmentFormValid(validationErrors)) {
      setHibasKiserlet((elozo) => elozo + 1)
      return
    }

    // Honeypot: bot gyanú esetén hálózati hívás nélkül „sikerül" a beküldés.
    if (honeypot.length > 0) {
      setSucceeded(true)
      return
    }

    if (turnstileEnabled && !turnstileToken) {
      setSubmitError(
        turnstileFailed ? TURNSTILE_UNAVAILABLE_ERROR : APPOINTMENT_TURNSTILE_PENDING_ERROR,
      )
      setHibasKiserlet((elozo) => elozo + 1)
      return
    }

    if (!formId) {
      setSubmitError(APPOINTMENT_UNAVAILABLE_ERROR)
      setHibasKiserlet((elozo) => elozo + 1)
      return
    }

    setSubmitting(true)
    const result = await trackedSubmitAppointment(
      buildAppointmentPayload(values, formId, turnstileToken),
    )
    setSubmitting(false)

    if (result.ok) {
      setSucceeded(true)
      return
    }
    setSubmitError(result.message)
    setHibasKiserlet((elozo) => elozo + 1)
    if (turnstileEnabled) {
      // Új ellenőrzés indul: a korábbi hibát csak a végleges betöltési hiba
      // jelzi újra (TurnstileWidget).
      setTurnstileFailed(false)
      setTurnstileReset((elozo) => elozo + 1)
    }
  }

  if (succeeded) {
    return (
      <div aria-live="polite" className="kc-appointment__success" role="status">
        <h3 className="kc-appointment__success-title" ref={successHeadingRef} tabIndex={-1}>
          {sikerCim?.trim() || APPOINTMENT_UI_TEXT.successTitle}
        </h3>
        <p className="kc-appointment__success-text">
          {sikerSzoveg?.trim() || APPOINTMENT_UI_TEXT.successBody}
        </p>
        {telefonok.length > 0 ? (
          <p className="kc-appointment__success-text">
            {APPOINTMENT_UI_TEXT.successPhoneLead}{' '}
            {telefonok.map((telefon, index) => (
              <span key={telefon.szam}>
                {index > 0 ? ', ' : ''}
                {telefon.href ? <a href={telefon.href}>{telefon.szam}</a> : telefon.szam}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    )
  }

  const hasErrorSummary =
    submitError !== null || Object.values(errors).some((message) => Boolean(message))

  return (
    <form className="kc-appointment__form" noValidate onSubmit={handleSubmit}>
      {hasErrorSummary ? (
        <div
          aria-live="assertive"
          className="kc-appointment__summary"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
        >
          {submitError ?? APPOINTMENT_UI_TEXT.errorSummary}
        </div>
      ) : null}

      <Field
        autoComplete="name"
        disabled={disabled}
        error={errors.name}
        label={APPOINTMENT_UI_TEXT.nameLabel}
        name="appointmentName"
        onChange={(event) => updateValue('name', event.target.value)}
        required
        value={values.name}
      />

      <Field
        autoComplete="tel"
        disabled={disabled}
        error={errors.phone}
        hint={APPOINTMENT_UI_TEXT.phoneHint}
        inputMode="tel"
        label={APPOINTMENT_UI_TEXT.phoneLabel}
        name="appointmentPhone"
        onChange={(event) => updateValue('phone', event.target.value)}
        required
        type="tel"
        value={values.phone}
      />

      <Field
        autoComplete="email"
        disabled={disabled}
        error={errors.email}
        hint={APPOINTMENT_UI_TEXT.emailHint}
        inputMode="email"
        label={APPOINTMENT_UI_TEXT.emailLabel}
        name="appointmentEmail"
        onChange={(event) => updateValue('email', event.target.value)}
        type="email"
        value={values.email}
      />

      <div className="kc-field">
        <label className="kc-field__label" htmlFor="kc-appointment-reason">
          {APPOINTMENT_UI_TEXT.reasonLabel}
        </label>
        <textarea
          aria-describedby={
            errors.reason ? 'kc-appointment-reason-error' : 'kc-appointment-reason-hint'
          }
          aria-invalid={errors.reason ? true : undefined}
          className={[
            'kc-field__input',
            'kc-appointment__textarea',
            errors.reason ? 'kc-field__input--error' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={disabled}
          id="kc-appointment-reason"
          maxLength={APPOINTMENT_REASON_MAX_LENGTH}
          name="appointmentReason"
          onChange={(event) => updateValue('reason', event.target.value)}
          rows={4}
          value={values.reason}
        />
        {errors.reason ? (
          <p className="kc-field__error" id="kc-appointment-reason-error" role="alert">
            {errors.reason}
          </p>
        ) : (
          // Adattakarékossági tájékoztatás a mező MELLETT, nem a lap alján: a
          // GDPR 9. cikk (1) szerinti egészségügyi adatot itt adja meg a
          // látogató, tehát itt kell tudnia, hogy nem kötelező és mennyi elég.
          <p className="kc-field__hint" id="kc-appointment-reason-hint">
            {APPOINTMENT_UI_TEXT.reasonHint}
          </p>
        )}
      </div>

      {idopontSavok.length > 0 ? (
        <fieldset className="kc-appointment__fieldset">
          <legend className="kc-field__label">{APPOINTMENT_UI_TEXT.availabilityLegend}</legend>
          <p className="kc-field__hint" id="kc-appointment-availability-hint">
            {APPOINTMENT_UI_TEXT.availabilityHint}
          </p>
          <div className="kc-appointment__options">
            {idopontSavok.map((felirat, index) => {
              const optionId = `kc-appointment-sav-${index}`
              return (
                <div className="kc-appointment__option" key={felirat}>
                  <input
                    aria-describedby="kc-appointment-availability-hint"
                    checked={values.availability.includes(felirat)}
                    className="kc-appointment__checkbox"
                    disabled={disabled}
                    id={optionId}
                    name="appointmentAvailability"
                    onChange={(event) => toggleSav(felirat, event.target.checked)}
                    type="checkbox"
                    value={felirat}
                  />
                  <label className="kc-appointment__option-label" htmlFor={optionId}>
                    {felirat}
                  </label>
                </div>
              )
            })}
          </div>
          {errors.availability ? (
            <p className="kc-field__error" role="alert">
              {errors.availability}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {/* Honeypot: emberi látogató sosem tölti ki (vizuálisan és a
          billentyű-navigációból is rejtett), a botok igen. */}
      <div aria-hidden="true" className="kc-appointment__hp">
        <label htmlFor="kc-appointment-website">Weboldal</label>
        <input
          autoComplete="off"
          id="kc-appointment-website"
          name="website"
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          type="text"
          value={honeypot}
        />
      </div>

      <div className="kc-appointment__consent">
        <div className="kc-appointment__consent-row">
          <input
            aria-describedby={errors.consentHealth ? 'kc-appointment-consent-error' : undefined}
            aria-invalid={errors.consentHealth ? true : undefined}
            checked={values.consentHealth}
            className="kc-appointment__checkbox"
            disabled={disabled}
            id="kc-appointment-consent"
            name="consentHealth"
            onChange={(event) => updateValue('consentHealth', event.target.checked)}
            required
            type="checkbox"
          />
          <label className="kc-appointment__consent-label" htmlFor="kc-appointment-consent">
            {APPOINTMENT_CONSENT_TEXT.before}
            <Link href={APPOINTMENT_PRIVACY_POLICY_PATH}>{APPOINTMENT_CONSENT_TEXT.linkLabel}</Link>
            {APPOINTMENT_CONSENT_TEXT.after}{' '}
            <span aria-hidden="true" className="kc-field__required">
              *
            </span>
            <span className="kc-visually-hidden"> (kötelező)</span>
          </label>
        </div>
        {errors.consentHealth ? (
          <p className="kc-field__error" id="kc-appointment-consent-error" role="alert">
            {errors.consentHealth}
          </p>
        ) : null}
      </div>

      {turnstileEnabled ? (
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

      {!formAvailable ? (
        <p className="kc-appointment__unavailable" role="alert">
          {APPOINTMENT_UNAVAILABLE_ERROR}
        </p>
      ) : null}

      {/* A felirat a §3.2 SZÓTÁRBÓL jön, nem a CMS-mezőből — lásd a fejkomment
          „A FELIRAT FORRÁSA" szakaszát. A folyamatban-felirat a zárt L-1
          listáé (`Küldés…`), az sem szerkesztői döntés. */}
      <Button disabled={disabled} type="submit">
        {submitting ? APPOINTMENT_UI_TEXT.submitPending : ctaLabel('appointment-submit')}
      </Button>
    </form>
  )
}
