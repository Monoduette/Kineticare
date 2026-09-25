'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ctaProgressLabel } from '@/lib/cta-vocabulary'
import { budapestDateTimeString } from '@/lib/date/budapest'
import {
  WITHDRAWAL_STATEMENT,
  WITHDRAWAL_SUBMIT_LABEL,
  submitWithdrawalForm,
  type WithdrawalReceipt,
} from '@/lib/withdrawal/client'
import {
  validateWithdrawalForm,
  type WithdrawalFormErrors,
  type WithdrawalFormValues,
} from '@/lib/withdrawal/validation'

import { isTurnstileEnabled } from '../../kapcsolat/_lib/submit'
import {
  TURNSTILE_UNAVAILABLE_ERROR,
  TurnstileWidget,
} from '../../kapcsolat/_components/TurnstileWidget'

/**
 * Az elállási funkció űrlapja (45/2014. Korm. rendelet 22. § (1a)–(1c)).
 *
 * Tervezési döntések és forrásuk:
 * - Pontosan a rendelet szerinti három adat (név, a szerződés azonosítása,
 *   e-mail-cím), bejelentkezés és hozzájárulás-jelölőnégyzet nélkül (NKFH,
 *   „Elállási funkció: gyakorlati tudnivalók webáruházak részére”,
 *   2026. 07. 17.). A fölösleges mező elhagyása a Baymard ajánlása is
 *   („Checkout Optimization: 5 Ways to Minimize Form Fields in Checkout”,
 *   https://baymard.com/blog/checkout-flow-average-form-fields).
 * - A segédszöveg a mező alatt, látható, nem helykitöltő: NN/g, „Placeholders
 *   in Form Fields Are Harmful” (https://www.nngroup.com/articles/form-design-placeholders/);
 *   GOV.UK Design System, Text input, hint text
 *   (https://design-system.service.gov.uk/components/text-input/).
 * - Hibánál az űrlap tetején összefoglaló kap fókuszt, a mező alatt a saját
 *   hibája áll: GOV.UK, Error summary
 *   (https://design-system.service.gov.uk/components/error-summary/); WCAG
 *   2.2 SC 3.3.1 és 3.3.3. A mezők `autocomplete` jelölést kapnak (SC 1.3.5).
 * - A gomb felirata a rendelet szövege („elállás megerősítése”); küldés közben
 *   tiltott és a folyamatban-feliratot mutatja, így a nyilatkozat nem megy
 *   ki kétszer (docs/ui-sztenderdek.md §2.6).
 * - Siker után visszaigazoló panel a nyilatkozat tartalmával, a beérkezés
 *   időpontjával, a hivatkozási számmal, a következő lépéssel és az
 *   elérhetőséggel. GOV.UK, Confirmation pages: „a reference number”,
 *   „details of what happens next and when”, „contact details for the
 *   service” (https://design-system.service.gov.uk/patterns/confirmation-pages/).
 */

export interface WithdrawalFormProps {
  /** Előtöltött rendelésszám (a fiók és a visszaigazoló levél linkjéből). */
  initialOrderReference: string
  /** TURNSTILE_SITE_KEY (szerveroldalon olvasva); üresen a widget rejtve. */
  turnstileSiteKey: string | null
  /** A hivatalos kapcsolati cím (K14), az e-mailes út a hibaüzenetekben. */
  supportEmail: string
}

const ERROR_SUMMARY = 'Javítsd a megjelölt mezőket, utána küldheted el a nyilatkozatot.'

export function WithdrawalForm({
  initialOrderReference,
  turnstileSiteKey,
  supportEmail,
}: WithdrawalFormProps) {
  const [values, setValues] = useState<WithdrawalFormValues>({
    name: '',
    orderReference: initialOrderReference,
    email: '',
  })
  const [errors, setErrors] = useState<WithdrawalFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<WithdrawalReceipt | null>(null)
  const [submitted, setSubmitted] = useState<WithdrawalFormValues | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  const [honeypot, setHoneypot] = useState('')

  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const turnstileEnabled = isTurnstileEnabled(turnstileSiteKey)

  useEffect(() => {
    if (receipt) successHeadingRef.current?.focus()
  }, [receipt])

  const updateValue = useCallback((key: keyof WithdrawalFormValues, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      if (!(key in previous)) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setSubmitError(null)

    const validationErrors = validateWithdrawalForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      errorSummaryRef.current?.focus()
      return
    }
    if (turnstileEnabled && !turnstileToken) {
      setSubmitError(
        turnstileFailed
          ? TURNSTILE_UNAVAILABLE_ERROR
          : 'Pipáld ki a spam-ellenőrzést, utána küldheted el a nyilatkozatot.',
      )
      errorSummaryRef.current?.focus()
      return
    }

    setSubmitting(true)
    const result = await submitWithdrawalForm({
      ...values,
      turnstileToken,
      website: honeypot,
    })
    setSubmitting(false)

    if (result.ok) {
      setSubmitted({
        name: values.name.trim(),
        orderReference: values.orderReference.trim(),
        email: values.email.trim(),
      })
      setReceipt(result.receipt)
      return
    }
    setSubmitError(result.message)
    if (turnstileEnabled) {
      setTurnstileFailed(false)
      setTurnstileReset((previous) => previous + 1)
    }
    errorSummaryRef.current?.focus()
  }

  if (receipt && submitted) {
    return (
      <WithdrawalSuccess
        headingRef={successHeadingRef}
        receipt={receipt}
        submitted={submitted}
        supportEmail={supportEmail}
      />
    )
  }

  const hasErrorSummary =
    submitError !== null || Object.values(errors).some((message) => Boolean(message))

  // A hidratálás előtti vagy JavaScript nélküli natív beküldés is POST legyen.
  // GET-tel a név, az e-mail-cím és a rendelésszám az URL-be kerülne, onnan a
  // böngészési előzménybe, a naplókba és az analitikába (CWE-598,
  // https://cwe.mitre.org/data/definitions/598.html). A JavaScript nélküli
  // útról: GOV.UK Service Manual, Using progressive enhancement,
  // https://www.gov.uk/service-manual/technology/using-progressive-enhancement.
  return (
    <form className="kc-contact-form" method="post" noValidate onSubmit={handleSubmit}>
      {hasErrorSummary ? (
        <div
          aria-live="assertive"
          className="kc-contact-form__summary"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
        >
          {submitError ?? ERROR_SUMMARY}
        </div>
      ) : null}

      <Field
        autoComplete="name"
        disabled={submitting}
        error={errors.name}
        label="Név"
        name="name"
        onChange={(event) => updateValue('name', event.target.value)}
        required
        value={values.name}
      />

      <Field
        autoComplete="off"
        disabled={submitting}
        error={errors.orderReference}
        hint="A visszaigazoló levélben és a Fiókom oldalon találod, például KH-2026-000123. Ha nincs meg, írd ide a vásárlás napját és a kurzus nevét."
        label="Rendelésszám"
        name="orderReference"
        onChange={(event) => updateValue('orderReference', event.target.value)}
        required
        value={values.orderReference}
      />

      <Field
        autoComplete="email"
        disabled={submitting}
        error={errors.email}
        hint="Erre a címre küldjük az átvételi elismervényt."
        inputMode="email"
        label="E-mail-cím"
        name="email"
        onChange={(event) => updateValue('email', event.target.value)}
        required
        type="email"
        value={values.email}
      />

      {/* Honeypot: emberi látogató sosem tölti ki (vizuálisan és a
          billentyű-navigációból is rejtett), a botok igen. */}
      <div aria-hidden="true" className="kc-contact-form__hp">
        <label htmlFor="kc-withdrawal-website">Weboldal</label>
        <input
          autoComplete="off"
          id="kc-withdrawal-website"
          name="website"
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          type="text"
          value={honeypot}
        />
      </div>

      {turnstileEnabled ? (
        <TurnstileWidget
          onError={() => setTurnstileFailed(true)}
          onToken={(token) => {
            setTurnstileToken(token)
            if (token) setTurnstileFailed(false)
          }}
          resetKey={turnstileReset}
          siteKey={turnstileSiteKey as string}
        />
      ) : null}

      <Button disabled={submitting} type="submit">
        {submitting ? ctaProgressLabel('contact-submit') : WITHDRAWAL_SUBMIT_LABEL}
      </Button>
    </form>
  )
}

export interface WithdrawalSuccessProps {
  receipt: WithdrawalReceipt
  /** A beküldött (vágott) adatok: a visszaigazolás ezt mutatja vissza. */
  submitted: WithdrawalFormValues
  supportEmail: string
  headingRef?: RefObject<HTMLHeadingElement | null>
}

/**
 * A beküldés utáni visszaigazoló panel (GOV.UK, Confirmation pages; lásd a
 * fájl fejlécét). Külön komponens, hogy mindkét változata (kiment / nem ment
 * ki az elismervény) renderelve is ellenőrizhető legyen.
 */
export function WithdrawalSuccess({
  receipt,
  submitted,
  supportEmail,
  headingRef,
}: WithdrawalSuccessProps) {
  const receivedAt = new Date(receipt.receivedAt)
  const when = Number.isNaN(receivedAt.getTime()) ? null : budapestDateTimeString(receivedAt)
  return (
    <div aria-live="polite" className="kc-contact-success kc-withdrawal-success" role="status">
      <h2 className="kc-contact-success__title" ref={headingRef} tabIndex={-1}>
        Megkaptuk az elállási nyilatkozatodat
      </h2>
      <p>
        {when ? `Beérkezett: ${when}. ` : null}
        Hivatkozási szám: <strong>{receipt.reference}</strong>
      </p>
      {receipt.receiptSent ? (
        <p>
          Az átvételi elismervényt elküldtük erre a címre: <strong>{submitted.email}</strong>. Ha
          néhány percen belül nem látod, nézd meg a levélszemét mappát is.
        </p>
      ) : (
        <p>
          Az átvételi elismervényt most nem tudtuk e-mailben elküldeni. A nyilatkozatod megérkezett,
          az elismervényt munkatársunk küldi el. Addig jegyezd fel a hivatkozási számot.
        </p>
      )}
      <p>
        Munkatársunk azonosítja a rendelésedet. Ha az elállás érvényes, a kifizetett összeget a
        nyilatkozatod beérkezésétől számított 14 napon belül visszatérítjük. Kérdésed van? Írj
        nekünk: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
      <dl className="kc-withdrawal-success__list">
        <dt>Nyilatkozat</dt>
        <dd>{WITHDRAWAL_STATEMENT}</dd>
        <dt>Név</dt>
        <dd>{submitted.name}</dd>
        <dt>Rendelés</dt>
        <dd>{submitted.orderReference}</dd>
        <dt>E-mail-cím</dt>
        <dd>{submitted.email}</dd>
      </dl>
      <Button href="/" variant="secondary">
        Vissza a kezdőlapra
      </Button>
    </div>
  )
}
