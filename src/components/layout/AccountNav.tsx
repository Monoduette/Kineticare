'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { CTA_PROGRESS_LABELS, ctaLabel } from '../../lib/cta-vocabulary'
import { logoutUser } from '../../lib/logout-client'

/**
 * AccountNav — belépési pont a fejléc/drawer jobb oldalán.
 * Kijelentkezve a fejléc-sávban IKON-LINK (profil-glif), a fiókban ikon +
 * szöveg; bejelentkezve „Kurzusaim" szöveglink + kijelentkezés POST button.
 * Feliratok: „Belépés", „Kurzusaim" — szótár szerint, minden felületen azonos.
 *
 * IKON A „BELÉPÉS" HELYETT (WP27, 2026-09-07, tulajdonosi kérés: „A Belépés ne
 * legyen kiírva: egy felhasználói profil ikon legyen, és ha rákattint, dobja
 * a belépésre.").
 * - A HOZZÁFÉRHETŐ NÉV marad „Belépés": az ikon `aria-hidden`, mellette
 *   vizuálisan rejtett szöveg (`.kc-visually-hidden`) adja a link nevét, így
 *   a képernyőolvasó, a hangvezérlés („kattints: Belépés") és a fókusz-lista
 *   ugyanazt a szót kapja, mint a fiók és a §3.2 #5 szótári sor (WCAG 2.2
 *   SC 2.4.4 Link Purpose, SC 4.1.2 Name, Role, Value; SC 3.2.4 Consistent
 *   Identification a fiók szöveges változatával).
 *   https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html
 *   https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
 * - MIÉRT A „FEJ + VÁLL KÖRBEN" GLIF: NN/g szerint az ikon önmagában ritkán
 *   egyértelmű, kivéve a kevés, univerzálisan felismert jelet; a profil/fiók
 *   ikon a kereskedelmi fejlécek bevett belépő-jele (Jakob törvénye), és a
 *   `title` tooltip a mutatós látogatónak is megnevezi.
 *   https://www.nngroup.com/articles/icon-usability/
 *   Material 3 Icon buttons: 48 dp célfelület, 24 dp ikon, kör alakú
 *   állapotréteg hoverre: https://m3.material.io/components/icon-buttons/specs
 *   Apple HIG Buttons / Icons: az ikon egyszerű, felismerhető, a felület
 *   többi ikonjával azonos vonalvastagságú:
 *   https://developer.apple.com/design/human-interface-guidelines/icons
 * - CÉLFELÜLET 44×44 CSS px (layout.css `.kc-account-nav__link--icon`), a
 *   hamburgerrel azonos (WCAG 2.2 SC 2.5.8 küszöbe 24×24, a projekt célja
 *   44×44): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
 * - A fiókban (drawer) NEM ikon-only: ott a lista szöveges, az ikon a szó
 *   mellett áll (NN/g: „icons with labels" a biztonságos alak).
 */

/**
 * Profil-glif: fej + váll egy körben. Saját rajz a repó 24-es nézetablakú,
 * 2 px-es, lekerekített végű vonalnyelvén (a hamburger és a caret ugyanez),
 * a Lucide `circle-user` ikon geometriáját követve (Lucide: ISC licenc,
 * https://lucide.dev/icons/circle-user, https://lucide.dev/license). A repó
 * nem húz be ikoncsomagot: a glif beágyazott SVG. Dekoratív (`aria-hidden`),
 * a nevet a mellette álló szöveg adja.
 */
function UserCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-account-nav__icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
    </svg>
  )
}

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
  const accountRef = useRef<HTMLDivElement>(null)

  // A fejléc fióksávja üres menü mellett is létezik, ezért a saját elemét
  // követi. A drawer fókuszát továbbra is a MobileNav kezeli.
  useEffect(() => {
    if (variant !== 'header') return
    const desktop = window.matchMedia('(min-width: 900px)')
    let ownsFocus = accountRef.current?.contains(document.activeElement) ?? false
    const onFocusIn = (event: FocusEvent) => {
      ownsFocus =
        event.target instanceof Node && (accountRef.current?.contains(event.target) ?? false)
    }
    const onCompact = (event: MediaQueryListEvent) => {
      if (event.matches || !ownsFocus) return
      accountRef.current
        ?.closest('header')
        ?.querySelector<HTMLAnchorElement>('.kc-site-header__brand')
        ?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    desktop.addEventListener('change', onCompact)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      desktop.removeEventListener('change', onCompact)
    }
  }, [variant])

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
    if (variant === 'header') {
      // Ikon-link: a látható felirat helyett rejtett szöveg adja a nevet
      // (lásd a fejkommentet). A `title` a mutatós látogató tooltipje, NEM a
      // név forrása: a névhez a szöveg kell (SC 4.1.2).
      return (
        <div className={base} ref={accountRef}>
          <Link
            className="kc-account-nav__link kc-account-nav__link--icon"
            href="/belepes"
            onClick={onNavigate}
            title={ACCOUNT_NAV_LABELS.signIn}
          >
            <UserCircleIcon />
            <span className="kc-visually-hidden">{ACCOUNT_NAV_LABELS.signIn}</span>
          </Link>
        </div>
      )
    }
    return (
      <div className={base} ref={accountRef}>
        <Link className="kc-account-nav__link" href="/belepes" onClick={onNavigate}>
          <UserCircleIcon />
          <span>{ACCOUNT_NAV_LABELS.signIn}</span>
        </Link>
      </div>
    )
  }

  return (
    <div className={base} ref={accountRef}>
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
