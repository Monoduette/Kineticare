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
 * ═══ A FELHASZNÁLÓ AZONOSÍTÓJA A LOGIN-VÁLASZBÓL ═══
 *
 * A `posthog.ts` `person_profiles: 'identified_only'` beállítása miatt
 * person-profil KIZÁRÓLAG `identify()` után jön létre — enélkül a „ki tért
 * vissza / mekkora a megtartás" kérdés megválaszolhatatlan. Az azonosítóhoz a
 * belépett felhasználó Payload `id`-je kell.
 *
 * MÉRT TÉNY, NEM FELTÉTELEZÉS: a Payload REST login-végpontja
 * `{ message, user, token, exp }` alakú törzset ad vissza — a telepített
 * csomagban ellenőrizve
 * (node_modules/payload/dist/auth/endpoints/login.js `Response.json({ message,
 * ...result })`, ahol a `result` a `loginOperation` `{ exp, token, user }`
 * hármasa: node_modules/payload/dist/auth/operations/login.js).
 *
 * MIÉRT ÍGY, ÉS NEM AZ `AuthResult`-BÓL: a `src/lib/auth-client.ts`
 * `loginUser`-je a sikeres válasz törzsét SZÁNDÉKOSAN nem olvassa el, és az
 * `AuthResult` nem hordoz felhasználó-azonosítót. Az auth-kliens
 * ÁTÍRÁSA HELYETT annak MEGLÉVŐ, publikus injektálási pontját (`fetchImpl`)
 * használjuk: a válasz KLÓNJÁBÓL olvasunk (`response.clone()`), így az eredeti
 * törzs érintetlen marad az auth-kliens hibaága számára, és nem kell egy
 * második hálózati kör sem (`GET /api/users/me`) a belépés és az átirányítás
 * közé. Az `AuthResult.data.userId` átírása szándékosan NEM kell: a klón
 * egy kérést spórol, az auth-kliens szerződését nem bontja, és a belépés
 * a hiányzó id mellett is megy (identify kimarad, nem a belépés).
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
 *
 * ═══ MIÉRT A SIKERES VÁLASZ UTÁN, ÉS NEM MOUNTKOR ═══
 * A belépés a hivatalos leírás szerint is `signUp`-esemény, DE csak akkor, ha
 * meg is történt. A mountkor (vagy a beküldés pillanatában) küldött esemény a
 * rossz jelszóval próbálkozót is belépőnek számolná — a Barion felé némán
 * felnagyítva a belépés-számot.
 *
 * ═══ A KÖVETÉS NEM RONTHATJA EL A BELÉPÉST ═══
 * A `track` és az `identify` hívás saját `try/catch`-ben fut. A gyártásban
 * használt `trackAccountSignUp` maga sem dob (a `sendBarionEvent` elnyeli a
 * pixel hibáit), az `identifyUser` pedig consent/kulcs nélkül no-op — de a
 * burkoló így akkor is tartja a garanciát, ha a követő láncba később bármi
 * bekerül: a visszaadott `AuthResult` és vele az átirányítás változatlan marad.
 *
 * SZEMÉLYES ADAT NEM MEGY KI: kizárólag a Payload `id`. E-mail-cím, név és IP
 * SOHA (a posthog.ts fejlécének tilalma).
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

export function LoginForm({ returnUrl }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Add meg az e-mail-címed és a jelszavad.')
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
    setError(result.message ?? null)
  }

  return (
    <form className="kc-auth-form" noValidate onSubmit={handleSubmit}>
      <Field
        autoComplete="email"
        label="E-mail-cím"
        name="email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <Field
        autoComplete="current-password"
        label="Jelszó"
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      {error ? (
        <div aria-live="assertive" className="kc-auth-form__error" role="alert">
          {error}
        </div>
      ) : null}
      <Button disabled={submitting} type="submit">
        {submitting ? ctaProgressLabel('sign-in') : ctaLabel('sign-in')}
      </Button>
    </form>
  )
}
