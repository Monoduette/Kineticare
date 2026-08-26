'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { forgotPassword, GENERIC_AUTH_ERROR } from '../../lib/auth-client'
import { ctaLabel, ctaProgressLabel } from '../../lib/cta-vocabulary'

/**
 * ForgotPasswordForm — jelszó-visszaállító link kérése.
 * A két prop SZÁNDÉKOSAN puszta szöveg, nem `variant` felsorolás:
 * Amit a propok NEM érintenek: a végpont, a kérés-korlát, az enumeráció-védő
 */
/**
 * Üres mezővel való beküldés MAGYAR üzenete.
 * A gomb korábban `disabled` volt, amíg a mező üres. Chromium-mal, VALÓDI
 * Tab-billentyűvel bejárva a `/belepes-atallas` lap fókusz-lánca ez volt:
 * mező → „Írj nekünk" → „Vissza a belépéshez" — a BEKÜLDŐ GOMB KIMARADT.
 * A natív `disabled` kiesik a Tab-sorrendből, tehát a billentyűzetes és a
 * képernyőolvasós látogató a lap elsődleges cselekvését meg sem találta,
 */
export const URES_EMAIL_HIBA = 'Add meg az e-mail-címed.'

/**
 * Az üres mező hibája MEZŐ-hiba, a szerveré ŰRLAP-hiba, és a kettőnek más a
 * gazdája. Korábban mindkettő ugyanabban a form-szintű dobozban állt, tehát a
 * mező maga jelöletlen maradt: nem volt rajta sem `aria-invalid`, sem
 * `aria-describedby`, sem hibakeret.
 * WCAG 2.2 · 3.3.1 (Error Identification): „the item that is in error is
 * identified and the error is described to the user in text" — a hiba SZÖVEGE
 */

export interface ForgotPasswordFormProps {
  /**
   * Segédszöveg az e-mail-mező alatt (`Field.hint` → `aria-describedby`,
   * WCAG 2.2 · 3.3.2 Labels or Instructions). Alapból nincs.
   */
  emailHint?: string
  /**
   * Egy MÁSODIK mondat a beküldés utáni megerősítő panelen, az enumeráció-védő
   * mondat UTÁN. Az elsőt sosem írja felül.
   */
  successNote?: string
}

/**
 * Minden prop opcionális, ezért a `<ForgotPasswordForm />` alak változatlanul
 * érvényes. Alapértelmezett paraméter-objektum (`= {}`) SZÁNDÉKOSAN nincs: attól
 * a komponens típusa `(props?: …) => …` lenne, amit a `React.createElement`
 * túlterhelései nem fogadnak el propokkal (mérve: TS2769 a felületi őr-tesztben).
 */
export function ForgotPasswordForm({ emailHint, successNote }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const formErrorRef = useRef<HTMLDivElement>(null)

  // A hibadoboz a state-tel EGYÜTT jelenik meg, tehát a fókuszálás csak a
  // renderelés UTÁN talál elemet — ezért effektben, nem a beküldő ágban.
  useEffect(() => {
    if (formError !== null) {
      formErrorRef.current?.focus()
    }
  }, [formError])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    if (!email.trim()) {
      setFieldError(URES_EMAIL_HIBA)
      formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus()
      return
    }
    setFieldError(null)
    setSubmitting(true)
    const result = await forgotPassword(email.trim())
    setSubmitting(false)
    if (!result.ok) {
      setFormError(result.message ?? GENERIC_AUTH_ERROR)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div aria-live="polite" className="kc-auth-success" role="status">
        <h2>Ellenőrizd az e-mail-fiókodat</h2>
        <p>
          Ha a <strong>{email}</strong> címhez tartozik fiók, néhány percen belül megérkezik a
          jelszó-visszaállító link. A link 1 óráig érvényes.
        </p>
        {successNote ? <p className="kc-auth-success__note">{successNote}</p> : null}
      </div>
    )
  }

  return (
    <form className="kc-auth-form" noValidate onSubmit={handleSubmit} ref={formRef}>
      <Field
        autoComplete="email"
        error={fieldError ?? undefined}
        hint={emailHint}
        label="E-mail-cím"
        name="email"
        onChange={(event) => {
          setEmail(event.target.value)
          setFieldError(null)
        }}
        required
        type="email"
        value={email}
      />
      {formError !== null ? (
        <div
          aria-live="assertive"
          className="kc-auth-form__error"
          ref={formErrorRef}
          role="alert"
          tabIndex={-1}
        >
          {formError}
        </div>
      ) : null}
      {/* §3.2 #21: e-mail indul a látogatónak, tehát elkötelezés (P-1a → E/1).
          A korábbi „Visszaállító link küldése" deverbális főnévi alak volt. */}
      <Button disabled={submitting} type="submit">
        {submitting ? ctaProgressLabel('password-reset-request') : ctaLabel('password-reset-request')}
      </Button>
    </form>
  )
}
