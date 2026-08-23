'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { resetPassword } from '../../lib/auth-client'
import { ctaLabel, ctaProgressLabel } from '../../lib/cta-vocabulary'
import {
  formatPasswordPolicyErrors,
  validatePasswordStrength,
} from '../../lib/security/password-policy'

/**
 * ResetPasswordForm — új jelszó beállítása a visszaállító tokennel.
 *
 * A kliensoldali ellenőrzés UGYANAZT a `validatePasswordStrength` függvényt
 * hívja, amit a végpont is (src/lib/security/reset-password-route.ts), így a
 * felhasználó pontosan azt a magyar üzenetet látja, amit a szerver adna — csak
 * hálózati kör nélkül. Az e-mail-szabályt a kliens nem tudja ellenőrizni (a
 * visszaállító oldalon csak a token van meg, a cím nem), azt a szerver fogja meg.
 */
/**
 * A siker-panel második mondata: a többi eszköz kijelentkezik (J2).
 *
 * GOV.UK Passwords: a jelszócsere után mondd el, mi történt, és e-mailben
 * is jelezd (a Payload reset-levele megvan; itt a képernyő a kiegészítő).
 * https://design-system.service.gov.uk/patterns/passwords/
 * OWASP ASVS V3.3.1 / Session Management: credential-csere után a többi
 * sessiont le kell zárni. CWE-613.
 * WCAG 2.2 · 4.1.3 Status Messages: a panel `role="status"` + `aria-live`.
 * https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
 *
 * Kontraszt: a meglévő success-panel tintája (`#e8f5ec` fölött az ink
 * `#10243e`) 13,92:1, AA (4,5:1) fölött. Új szín nincs.
 * Érintőcél: a Belépés gomb a meglévő `.kc-button` 44 px-es minimuma.
 * 320 px: a panel a form szélességét viszi, vízszintes görgetés nincs.
 */
export const RESET_OTHER_DEVICES_NOTE = 'A többi eszközön ki leszel jelentkeztetve.'

export interface ResetPasswordFormProps {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const violations = validatePasswordStrength({ password })
    if (violations.length > 0) {
      setError(formatPasswordPolicyErrors(violations))
      return
    }
    if (password !== passwordConfirm) {
      setError('A két jelszó nem egyezik.')
      return
    }
    setSubmitting(true)
    const result = await resetPassword({ token, password })
    setSubmitting(false)
    if (result.ok) {
      setDone(true)
      return
    }
    setError(result.message ?? 'A jelszó-visszaállítás nem sikerült. Kérj új linket.')
  }

  if (done) {
    return (
      <div aria-live="polite" className="kc-auth-success" role="status">
        <h2>Új jelszó beállítva</h2>
        <p>Sikeresen beállítottad az új jelszavadat. Most már be tudsz lépni vele.</p>
        <p className="kc-auth-success__note">{RESET_OTHER_DEVICES_NOTE}</p>
        <Link className="kc-button kc-button--primary" href="/belepes">
          {ctaLabel('sign-in')}
        </Link>
      </div>
    )
  }

  return (
    <form className="kc-auth-form" noValidate onSubmit={handleSubmit}>
      <Field
        autoComplete="new-password"
        hint="Legalább 12 karakter, kisbetűvel, nagybetűvel és számmal."
        label="Új jelszó"
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      <Field
        autoComplete="new-password"
        label="Új jelszó mégegyszer"
        name="passwordConfirm"
        onChange={(event) => setPasswordConfirm(event.target.value)}
        required
        type="password"
        value={passwordConfirm}
      />
      {error ? (
        <div aria-live="assertive" className="kc-auth-form__error" role="alert">
          {error}
        </div>
      ) : null}
      {/* §3.2 #22: a fiók megváltozik (P-1a → E/1), a folyamatban-felirat pedig
          a ZÁRT L-1 lista `Mentés…` eleme. A korábbi „Beállítás…" nem volt a
          listán, és szinonimája a `/fiok` mentés-gombjának (Polaris: „identify
          and eliminate synonyms"). */}
      <Button disabled={submitting} type="submit">
        {submitting ? ctaProgressLabel('password-reset-set') : ctaLabel('password-reset-set')}
      </Button>
    </form>
  )
}
