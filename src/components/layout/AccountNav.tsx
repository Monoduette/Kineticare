'use client'

import Link from 'next/link'
import { useState } from 'react'

import { CTA_PROGRESS_LABELS, ctaLabel } from '../../lib/cta-vocabulary'
import { logoutUser } from '../../lib/logout-client'

/**
 * AccountNav — belépési pont a fejléc/drawer jobb oldalán.
 * Szöveglink (nem második primary gomb); kijelentkezés POST button.
 * Feliratok: „Belépés", „Kurzusaim" — szótár szerint, minden felületen azonos.
 */

export type AccountNavVariant = 'header' | 'drawer'

export interface AccountNavProps {
  /** Szerver-oldalon megállapított állapot (lásd header-user.ts). */
  signedIn: boolean
  /** Elhelyezés: fejléc-sáv (asztali) vagy mobil drawer. */
  variant: AccountNavVariant
  /** Drawerben: a menü zárása navigációkor (a MobileNav adja). */
  onNavigate?: () => void
}

export const ACCOUNT_NAV_LABELS = {
  /** §3.2 #5 – bevett, egyszavas címke (P-1c). */
  signIn: ctaLabel('sign-in'),
  /** A fiókmenü menüpontjának NEVE (N-3: menücímke, nem CTA) — nem szótári sor. */
  myCourses: 'Kurzusaim',
  /** §3.2 #32 – a #5 szabályos párja, ugyanaz a P-1c kivétel. */
  signOut: ctaLabel('sign-out'),
  /** L-1 folyamatban-felirat: három pont (U+2026), gondolatjel nélkül. */
  signOutPending: CTA_PROGRESS_LABELS['sign-out'],
} as const

export function AccountNav({ signedIn, variant, onNavigate }: AccountNavProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignOut = async () => {
    setError(null)
    setPending(true)
    const result = await logoutUser()
    if (result.ok) {
      /**
 * TELJES oldalletöltés a kezdőlapra, három okból:
 * A `useRouter()` szándékosan NEM szerepel itt: attól a komponens csak
 */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/'
      return
    }
    setPending(false)
    setError(result.message ?? null)
  }

  const base = variant === 'header' ? 'kc-account-nav' : 'kc-account-nav kc-account-nav--drawer'

  if (!signedIn) {
    return (
      <div className={base}>
        <Link className="kc-account-nav__link" href="/belepes" onClick={onNavigate}>
          {ACCOUNT_NAV_LABELS.signIn}
        </Link>
      </div>
    )
  }

  return (
    <div className={base}>
      <Link className="kc-account-nav__link" href="/kurzusaim" onClick={onNavigate}>
        {ACCOUNT_NAV_LABELS.myCourses}
      </Link>
      <button
        aria-busy={pending}
        className="kc-account-nav__signout"
        disabled={pending}
        onClick={handleSignOut}
        type="button"
      >
        {pending ? ACCOUNT_NAV_LABELS.signOutPending : ACCOUNT_NAV_LABELS.signOut}
      </button>
      {error === null ? null : (
        <p aria-live="assertive" className="kc-account-nav__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
