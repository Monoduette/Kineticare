'use client'

import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import {
  BARION_SIGNUP,
  trackAccountSignUp,
  type BarionSignUpEvent,
} from '@/lib/analytics/barion-events'
import { identifyUser } from '@/lib/analytics/posthog'
import { DEFAULT_AUTH_RETURN_URL, sanitizeReturnUrl } from '@/lib/return-url'
import { registerUser, type AuthResult, type RegisterInput } from '../../lib/auth-client'
import { ctaLabel, ctaProgressLabel } from '../../lib/cta-vocabulary'

/**
 * RegisterForm — a regisztrációs űrlap (Payload auth REST-re).
 * NEM VÉSZ EL SEMMI. Ugyanezek a mezők két helyen élnek tovább:
 * A `RegisterInput` továbbra is ismeri a mezőket — az API-szerződéshez nem
 */
export interface RegisterFormProps {
  /** Gyökér-relatív útvonal; a hívó oldal `sanitizeReturnUrl`-lel szűri. */
  returnUrl: string
}

/**
 * MÉRT TÉNY: a Payload REST create-végpontja `{ doc, message }` alakú törzset
 * ad (201), ahol a `doc.id` az új rekord azonosítója — a telepített csomagban
 * ellenőrizve: node_modules/payload/dist/collections/endpoints/create.js
 * (`Response.json({ doc, message }, { status: httpStatus.CREATED })`).
 * A kiolvasás indoklása (miért a válasz klónjából, és miért nem az
 * `AuthResult`-ból) azonos a belépésével — lásd
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Az új felhasználó azonosítója a create-válasz klónjából; sosem dob. */
export async function readRegisteredUserId(
  response: Response,
): Promise<number | string | null> {
  try {
    const body: unknown = await response.clone().json()
    if (!isRecord(body)) {
      return null
    }
    const doc = body.doc
    if (!isRecord(doc)) {
      return null
    }
    const id = doc.id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/** A `trackedRegister` injektálható függőségei (a teszt kémeket ad be). */
export interface TrackedRegisterDeps {
  /**
   * A második paraméter a MEGFIGYELŐ `fetch` (lásd a `TrackedLoginDeps`
   * azonos mezőjét). Opcionális, hogy a csak `(input)`-ot váró teszt-kémek is
   * beadhatók maradjanak.
   */
  register: (input: RegisterInput, fetchImpl?: typeof fetch) => Promise<AuthResult>
  track: (event: BarionSignUpEvent) => boolean
  /** Alapértelmezés: a PostHog `identifyUser` (consent/kulcs nélkül no-op). */
  identify?: (userId: number | string) => boolean
  /** Alapértelmezés: a böngésző `fetch`-e (a tesztben injektált hamis fetch). */
  fetchImpl?: typeof fetch
}

/**
 * Regisztráció + Barion `signUp`.
 * Az esemény a SIKERES válasz után megy ki: a foglalt e-mail-cím vagy a túl
 * rövid jelszó miatt elutasított próbálkozás nem regisztráció, és nem is
 * szabad annak látszania a Barion riportjában.
 * A `trackAccountSignUp` a munkamenet signUp-reteszét is elfoglalja: a
 * regisztráció utáni átirányításkor a fejléc implicit, munkamenet-nyitó
 */
export async function trackedRegister(
  input: RegisterInput,
  deps: TrackedRegisterDeps = {
    register: registerUser,
    track: (event) => trackAccountSignUp(event),
  },
): Promise<AuthResult> {
  const identify = deps.identify ?? identifyUser
  const baseFetch: typeof fetch = deps.fetchImpl ?? ((request, init) => fetch(request, init))

  let userId: number | string | null = null
  const observingFetch: typeof fetch = async (request, init) => {
    const response = await baseFetch(request, init)
    if (response.ok) {
      userId = await readRegisteredUserId(response)
    }
    return response
  }

  const result = await deps.register(input, observingFetch)
  if (result.ok) {
    try {
      deps.track(BARION_SIGNUP.registration)
    } catch {
      // A mérés hibája nem érheti el a felhasználót.
    }
    if (userId !== null) {
      try {
        identify(userId)
      } catch {
        // Ugyanaz a garancia: az azonosítás hibája nem érinti a regisztrációt.
      }
    }
  }
  return result
}

export function RegisterForm({ returnUrl }: RegisterFormProps) {
  const [values, setValues] = useState<RegisterInput>({
    email: '',
    password: '',
    name: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: keyof RegisterInput, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!values.name.trim() || !values.email.trim() || !values.password) {
      setError('Add meg a neved, az e-mail-címed és a jelszavad.')
      return
    }
    if (values.password.length < 12) {
      setError('A jelszónak legalább 12 karakter hosszúnak kell lennie.')
      return
    }
    setSubmitting(true)
    const result = await trackedRegister(values)
    setSubmitting(false)
    if (result.ok) {
      // A szűrés a sinknél is megismétlődik (lásd LoginForm): a prop a szerver
      // oldalon már ellenőrzött, de az átirányítás itt történik, és idegen
      // eredetre semmiképp nem mehet.
      window.location.href = sanitizeReturnUrl(returnUrl, DEFAULT_AUTH_RETURN_URL)
      return
    }
    setError(result.message ?? 'A regisztráció nem sikerült. Próbáld újra.')
  }

  return (
    <form className="kc-auth-form" noValidate onSubmit={handleSubmit}>
      <Field
        autoComplete="name"
        label="Név"
        name="name"
        onChange={(event) => update('name', event.target.value)}
        required
        value={values.name}
      />
      <Field
        autoComplete="email"
        label="E-mail-cím"
        name="email"
        onChange={(event) => update('email', event.target.value)}
        required
        type="email"
        value={values.email}
      />
      <Field
        autoComplete="new-password"
        hint="Legalább 12 karakter."
        label="Jelszó"
        name="password"
        onChange={(event) => update('password', event.target.value)}
        required
        type="password"
        value={values.password}
      />

      {error ? (
        <div aria-live="assertive" className="kc-auth-form__error" role="alert">
          {error}
        </div>
      ) : null}
      <Button disabled={submitting} type="submit">
        {submitting ? ctaProgressLabel('sign-up') : ctaLabel('sign-up')}
      </Button>
    </form>
  )
}
