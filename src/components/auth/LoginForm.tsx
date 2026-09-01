'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import {
  BARION_SIGNUP,
  trackAccountSignUp,
  type BarionSignUpEvent,
} from '@/lib/analytics/barion-events'
import { identifyUser } from '@/lib/analytics/posthog'
import { DEFAULT_AUTH_RETURN_URL, sanitizeReturnUrl } from '@/lib/return-url'
import { loginUser, type AuthResult } from '../../lib/auth-client'
import { ctaLabel, ctaProgressLabel } from '../../lib/cta-vocabulary'

/**
 * LoginForm — a bejelentkezés űrlapja (Payload auth REST-re).
 *
 * A returnUrl-paraméterrel tér vissza oda, ahonnan jött (csak belső
 * útvonal — open-redirect ellen védve). Magyar hibaüzenetek.
 */
export interface LoginFormProps {
  /** Gyökér-relatív útvonal; a hívó oldal `sanitizeReturnUrl`-lel szűri. */
  returnUrl: string
}

/**
 * A `posthog.ts` `person_profiles: 'identified_only'` beállítása miatt
 * MÉRT TÉNY, NEM FELTÉTELEZÉS: a Payload REST login-végpontja
 * MIÉRT ÍGY, ÉS NEM AZ `AuthResult`-BÓL: a `src/lib/auth-client.ts`
 * `loginUser`-je a sikeres válasz törzsét SZÁNDÉKOSAN nem olvassa el, és az
 * közé. Az `AuthResult.data.userId` átírása szándékosan NEM kell: a klón
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Az azonosító kiolvasása a válasz KLÓNJÁBÓL. Sosem dob: bármilyen váratlan
 * törzsalak (nem JSON, hiányzó kulcs, más típusú id) `null`-t ad — a belépés
 * ilyenkor is zavartalan, csak azonosítás nem történik.
 */
export async function readLoginUserId(response: Response): Promise<number | string | null> {
  try {
    const body: unknown = await response.clone().json()
    if (!isRecord(body)) {
      return null
    }
    const user = body.user
    if (!isRecord(user)) {
      return null
    }
    const id = user.id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/** A `trackedLogin` injektálható függőségei (a teszt kémeket ad be). */
export interface TrackedLoginDeps {
  /**
   * A második paraméter a MEGFIGYELŐ `fetch` — a burkoló ezen keresztül jut
   * hozzá a login-válasz törzséhez. Opcionális, hogy a régebbi, csak
   * `(input)`-ot váró teszt-kémek is beadhatók maradjanak.
   */
  login: (input: { email: string; password: string }, fetchImpl?: typeof fetch) => Promise<AuthResult>
  track: (event: BarionSignUpEvent) => boolean
  /** Alapértelmezés: a PostHog `identifyUser` (consent/kulcs nélkül no-op). */
  identify?: (userId: number | string) => boolean
  /** Alapértelmezés: a böngésző `fetch`-e (a tesztben injektált hamis fetch). */
  fetchImpl?: typeof fetch
}

/**
 * Belépés + Barion `signUp`.
 * A belépés a hivatalos leírás szerint is `signUp`-esemény, DE csak akkor, ha
 * meg is történt. A mountkor (vagy a beküldés pillanatában) küldött esemény a
 * rossz jelszóval próbálkozót is belépőnek számolná — a Barion felé némán
 * felnagyítva a belépés-számot.
 * A `track` és az `identify` hívás saját `try/catch`-ben fut. A gyártásban
 */
export async function trackedLogin(
  input: { email: string; password: string },
  deps: TrackedLoginDeps = {
    login: loginUser,
    track: (event) => trackAccountSignUp(event),
  },
): Promise<AuthResult> {
  const identify = deps.identify ?? identifyUser
  const baseFetch: typeof fetch = deps.fetchImpl ?? ((request, init) => fetch(request, init))

  let userId: number | string | null = null
  const observingFetch: typeof fetch = async (request, init) => {
    const response = await baseFetch(request, init)
    if (response.ok) {
      userId = await readLoginUserId(response)
    }
    return response
  }

  const result = await deps.login(input, observingFetch)
  if (result.ok) {
    try {
      deps.track(BARION_SIGNUP.login)
    } catch {
      // A mérés hibája nem érheti el a felhasználót.
    }
    if (userId !== null) {
      try {
        identify(userId)
      } catch {
        // Ugyanaz a garancia: az azonosítás hibája nem érinti a belépést.
      }
    }
  }
  return result
}

/**
 * Üres mező magyar hibái. A mező viseli őket (`Field.error` → `aria-invalid`),
 * nem egy külön doboz: WCAG 2.2 · 3.3.1 Error Identification.
 * https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
 * GOV.UK Error message: a hibás mezőt magát kell megjelölni.
 * https://design-system.service.gov.uk/components/error-message/
 */
export const URES_BELEPES_EMAIL_HIBA = 'Add meg az e-mail-címed.'
export const URES_BELEPES_JELSZO_HIBA = 'Add meg a jelszavad.'

export function LoginForm({ returnUrl }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const formErrorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (formError !== null) {
      formErrorRef.current?.focus()
    }
  }, [formError])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const nextEmailError = email.trim() ? null : URES_BELEPES_EMAIL_HIBA
    const nextPasswordError = password ? null : URES_BELEPES_JELSZO_HIBA
    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    if (nextEmailError !== null || nextPasswordError !== null) {
      return
    }
    setSubmitting(true)
    const result = await trackedLogin({ email: email.trim(), password })
    setSubmitting(false)
    if (result.ok) {
      // A tényleges átirányítás itt történik, ezért a szűrés a sinknél is
      // megismétlődik: a prop a szerver oldalon már ellenőrzött, de így egy
      // jövőbeli, figyelmetlen hívási hely sem vihet idegen oldalra
      // (belépés utáni adathalászat).
      window.location.href = sanitizeReturnUrl(returnUrl, DEFAULT_AUTH_RETURN_URL)
      return
    }
    setFormError(result.message ?? null)
  }

  return (
    <form className="kc-auth-form" noValidate onSubmit={handleSubmit}>
      <Field
        autoComplete="email"
        error={emailError ?? undefined}
        label="E-mail-cím"
        name="email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <Field
        autoComplete="current-password"
        error={passwordError ?? undefined}
        label="Jelszó"
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      <div
        aria-live="assertive"
        className={formError ? 'kc-auth-form__error' : 'kc-visually-hidden'}
        ref={formErrorRef}
        role="alert"
        tabIndex={-1}
      >
        {formError}
      </div>
      <Button disabled={submitting} type="submit">
        {submitting ? ctaProgressLabel('sign-in') : ctaLabel('sign-in')}
      </Button>
    </form>
  )
}
