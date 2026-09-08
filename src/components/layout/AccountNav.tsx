'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import { CTA_PROGRESS_LABELS, ctaLabel } from '../../lib/cta-vocabulary'
import { logoutUser } from '../../lib/logout-client'

/**
 * AccountNav — belépési pont a fejléc/drawer jobb oldalán.
 *
 * A FEJLÉC-SÁVBAN (≥ 900 px) MINDKÉT állapotban ugyanaz a 44×44-es profil-ikon
 * áll, ugyanazon a helyen:
 * - kijelentkezve IKON-LINK a /belepes-re (WP27, tulajdonosi kérés: „A Belépés
 *   ne legyen kiírva: egy felhasználói profil ikon legyen");
 * - bejelentkezve MENÜGOMB (WP36, 2026-09-08, tulajdonosi kérés, szó szerint:
 *   „be vagyok jelentkezve akkor ne kerüljön oda a kijelentkezés gomb hanem
 *   csak maradjon meg az a profil ikon … ha rákattintok elviszem az egeret
 *   akkor ide kerüljön be a kijelentkezés és a kurzusaim menüpont is"),
 *   lenyílóval: „Kurzusaim" (link) és „Kijelentkezés" (POST-gomb).
 * A fiókban (drawer, < 900 px) a lista szöveges marad: belépő fél elöl
 * (Belépés / Kurzusaim), kilépő fél a fiók alján (Kijelentkezés) — WP31.
 *
 * A MENÜGOMB MINTÁJA — W3C WAI-ARIA APG „Menu Button":
 * https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
 * - a gomb `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` a
 *   `role="menu"` tárolóra; a tételek `role="menuitem"`;
 * - Enter / Space / Le nyíl nyit és az ELSŐ tételre fókuszál, Fel nyíl az
 *   utolsóra; a menüben Le/Fel nyíl léptet (körbe), Home / End a szélekre,
 *   Escape zár és a fókuszt VISSZAADJA a gombnak, Tab zár és továbblép
 *   (a tételek `tabIndex={-1}`: a gomb az egyetlen Tab-állomás — SC 2.1.1
 *   Keyboard, SC 2.4.3 Focus Order, SC 2.4.7 Focus Visible);
 * - `aria-expanded` + a látható lenyíló adja a nevet/szerepet/állapotot
 *   (SC 4.1.2 Name, Role, Value:
 *   https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html).
 *
 * NYITÁS HOVERRE IS (a tulajdonos „elviszem az egeret" kérése), de csak
 * `(hover: hover)` eszközön és egér-pointerrel (érintésen a koppintás nyit;
 * NN/g Menu-Design Checklist: a hover nem univerzális, a kattintás minden
 * eszközön elérhető marad: https://www.nngroup.com/articles/menu-design/).
 * Időzítés — NN/g, Timing Guidelines for Exposing Hidden Content: „Wait
 * 0.3–0.5 seconds" a mutató megállása után, és „keep displaying … until the
 * cursor has left … for longer than 0.5 seconds"
 * (https://www.nngroup.com/articles/timing-exposing-content/); NN/g Mega
 * Menus Work Well: a lenyíló ne tűnjön el, amíg a mutató úton van a tétel
 * felé („diagonal problem"): https://www.nngroup.com/articles/mega-menus-work-well/
 * Ezért NYITÁSI késleltetés 300 ms (a sáv mellett elhaladó mutató nem
 * nyit), ZÁRÁSI türelem 500 ms (a gomb → tétel átlós út nem zár).
 * WCAG 2.2 SC 1.4.13 Content on Hover or Focus
 * (https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html):
 * - dismissable: Escape zár a mutató mozgatása nélkül is;
 * - hoverable: a lenyíló a gomb ALATT, résszel együtt hover-területben áll
 *   (a türelmi idő fedi a rést), a mutató rávihető anélkül, hogy eltűnne;
 * - persistent: amíg a mutató a gombon vagy a lenyílón áll, nyitva marad.
 * Hoverre nyitva a FÓKUSZ nem mozdul (a hover nem lophatja el a
 * billentyűzet-fókuszt); kattintásra/billentyűre az első tételre lép.
 *
 * A JELÖLÉS („be vagyok jelentkezve"): a glif fej + váll része KITÖLTÖTT
 * (kijelentkezve kontúros), és a rejtett név „Fiók (bejelentkezve)". Az
 * ikon-állapot kitöltött/kontúros párja a Material 3 navigációs sávjának
 * aktív/inaktív jelölése (https://m3.material.io/components/navigation-bar/guidelines);
 * új színt nem hozunk be, a kontraszt a vonaléval azonos (SC 1.4.11), a
 * jelentést pedig a szöveg is hordozza, nem csak a forma (SC 1.3.3).
 *
 * MIÉRT A „FEJ + VÁLL KÖRBEN" GLIF (WP27): NN/g Icon Usability szerint az
 * ikon önmagában ritkán egyértelmű, ezért a hozzáférhető név szöveg
 * (`.kc-visually-hidden`), a `title` a mutatós látogatónak is megnevezi:
 * https://www.nngroup.com/articles/icon-usability/
 * Material 3 Icon buttons: 48 dp célfelület, 24 dp ikon, kör állapotréteg:
 * https://m3.material.io/components/icon-buttons/specs
 * Apple HIG Buttons: célfelület ≥ 44×44 pt:
 * https://developer.apple.com/design/human-interface-guidelines/buttons
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum) küszöbe 24×24, itt 44×44:
 * https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
 * A fiókban (drawer) NEM ikon-only: ott az ikon a látható szó mellett áll
 * (NN/g: „a text label must be present alongside an icon").
 *
 * A LENYÍLÓ TÉTELEINEK SORRENDJE: a navigációs cél (Kurzusaim) elöl, a
 * kilépő cselekvés (Kijelentkezés) elválasztó után, utoljára — Apple HIG
 * Menus: a kilépő/destruktív cselekvés a menü alján, elválasztóval:
 * https://developer.apple.com/design/human-interface-guidelines/menus
 * A tételek 44 px magasak, a panel a gomb alá, jobbra zárva nyílik
 * (Material 3 Menus: a menü a horgony alatt, emelt felületen:
 * https://m3.material.io/components/menus/guidelines).
 */

/** Hover-nyitás késleltetése (NN/g: 0,3–0,5 s a mutató megállása után). */
export const ACCOUNT_MENU_HOVER_OPEN_MS = 300
/** Zárási türelem a mutató kilépése után (NN/g: „longer than 0.5 seconds"). */
export const ACCOUNT_MENU_HOVER_CLOSE_MS = 500

/**
 * Profil-glif: fej + váll egy körben. Saját rajz a repó 24-es nézetablakú,
 * 2 px-es, lekerekített végű vonalnyelvén (a hamburger és a caret ugyanez),
 * a Lucide `circle-user` ikon geometriáját követve (Lucide: ISC licenc,
 * https://lucide.dev/icons/circle-user, https://lucide.dev/license). A repó
 * nem húz be ikoncsomagot: a glif beágyazott SVG. Dekoratív (`aria-hidden`),
 * a nevet a mellette álló szöveg adja. Bejelentkezve a fej és a váll
 * kitöltött (`.kc-account-nav__icon-fill`, layout.css).
 */
function UserCircleIcon({ signedIn = false }: { signedIn?: boolean }) {
  const fill = signedIn ? 'kc-account-nav__icon-fill' : undefined
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
      <circle className={fill} cx="12" cy="10" r="3" />
      <path className={fill} d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
    </svg>
  )
}

export type AccountNavVariant = 'header' | 'drawer'

/**
 * A FIÓK KÉT SZEKCIÓJA A DRAWERBEN (WP31, 2026-09-07, tulajdonosi kérés, szó
 * szerint: „ha be vagyok jelentkezve akkor a kijelentkezés az utolsó gomb").
 *  - `entry`: a belépő (kijelentkezve „Belépés", bejelentkezve „Kurzusaim") a
 *    fiók ELEJÉN (NN/g Menu-Design Checklist, 2. pont: a segéd-navigáció a fő
 *    navigáció fölött; https://www.nngroup.com/articles/menu-design/);
 *  - `exit`: a Kijelentkezés gomb (és a hibaüzenete) a menülista UTÁN, a fiók
 *    alján, tehát az UTOLSÓ fókuszálható elem. A DOM-sorrend adja a
 *    Tab-sorrendet, nem CSS `order` (WCAG 2.2 SC 2.4.3 Focus Order:
 *    https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html; SC 1.3.2).
 *    Material 3 navigation drawer: a másodlagos tételek a lista végén;
 *    https://m3.material.io/components/navigation-drawer/guidelines
 * Szekció nélkül (fejléc-sáv) a komponens a menügombot rendereli.
 */
export type AccountNavSection = 'entry' | 'exit'

export interface AccountNavProps {
  /** Szerver-oldalon megállapított állapot (lásd header-user.ts). */
  signedIn: boolean
  /** Elhelyezés: fejléc-sáv (asztali) vagy mobil drawer. */
  variant: AccountNavVariant
  /** Drawerben: a menü zárása navigációkor (a MobileNav adja). */
  onNavigate?: () => void
  /** Drawerben: csak a belépő (`entry`) vagy csak a kilépő (`exit`) fele. */
  section?: AccountNavSection
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
  /** A fejléc menügombjának NEVE (N-3: menücímke, nem CTA; a /fiok lap címe „Fiókom"). */
  account: 'Fiók',
  /** A menügomb nevének állapot-kiegészítése (rejtett szöveg, SC 1.3.3). */
  accountSignedIn: '(bejelentkezve)',
} as const

/** Hover-képes eszköz (`@media (hover: hover)` JS-párja); érintésen a koppintás nyit. */
function hoverCapable(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
}

/** A fiókmenü tételei DOM-sorrendben (csak a nem letiltottak). */
function menuItemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')]
}

/**
 * Fókusz a frissen látszó tételre, legfeljebb néhány képkockán át próbálva —
 * a zárt lenyíló `visibility: hidden`, a `data-open` beállítása után a
 * `focus()` a DesktopNav mérése szerint csak a második képkockától ér célba.
 */
function focusWhenFocusable(target: HTMLElement, attempts = 5): void {
  target.focus()
  if (document.activeElement === target || attempts === 0) {
    return
  }
  requestAnimationFrame(() => focusWhenFocusable(target, attempts - 1))
}

export function AccountNav({ signedIn, variant, onNavigate, section }: AccountNavProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const menuId = useId()
  const accountRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocus = useRef<'first' | 'last' | null>(null)

  const isHeaderMenu = variant === 'header' && signedIn

  // Útvonalváltáskor a lenyíló záródik — a React „állapot-igazítás
  // renderben" mintájával (https://react.dev/learn/you-might-not-need-an-effect).
  const [renderedPathname, setRenderedPathname] = useState(pathname)
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname)
    setOpen(false)
  }

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

  const openMenu = useCallback(
    (focusTarget: 'first' | 'last' | null) => {
      clearHoverTimer()
      pendingFocus.current = focusTarget
      setOpen(true)
    },
    [clearHoverTimer],
  )

  const closeMenu = useCallback(() => {
    clearHoverTimer()
    pendingFocus.current = null
    setOpen(false)
  }, [clearHoverTimer])

  // A fejléc fióksávja üres menü mellett is létezik, ezért a saját elemét
  // követi. A drawer fókuszát továbbra is a MobileNav kezeli.
  useEffect(() => {
    if (variant !== 'header') return
    const desktop = window.matchMedia('(min-width: 900px)')
    let ownsFocus = accountRef.current?.contains(document.activeElement) ?? false
    const onFocusIn = (event: globalThis.FocusEvent) => {
      ownsFocus =
        event.target instanceof Node && (accountRef.current?.contains(event.target) ?? false)
    }
    const onCompact = (event: MediaQueryListEvent) => {
      if (event.matches) return
      setOpen(false)
      if (!ownsFocus) return
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

  /**
   * Nyitott menü mellett: kattintás/koppintás a fiókon KÍVÜL zár, és az
   * Escape akkor is zár, ha a fókusz nincs a fiókon (hoverre nyílt menü —
   * SC 1.4.13 „dismissable": a mutató mozgatása nélkül).
   */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && accountRef.current?.contains(event.target)) return
      closeMenu()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (accountRef.current?.contains(document.activeElement)) return
      closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, closeMenu])

  // A nyitás utáni fókuszlépés a következő renderben, amikor a lenyíló már látszik.
  useEffect(() => {
    const target = pendingFocus.current
    if (!open || target === null || !menuRef.current) return
    pendingFocus.current = null
    const items = menuItemsOf(menuRef.current)
    const item = target === 'first' ? items[0] : items[items.length - 1]
    if (item) focusWhenFocusable(item)
  }, [open])

  useEffect(() => clearHoverTimer, [clearHoverTimer])

  const handlePointerEnter = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || !hoverCapable()) return
      clearHoverTimer()
      if (open) return
      hoverTimer.current = setTimeout(() => openMenu(null), ACCOUNT_MENU_HOVER_OPEN_MS)
    },
    [clearHoverTimer, open, openMenu],
  )

  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || !hoverCapable()) return
      clearHoverTimer()
      if (!open || pending) return
      // Billentyűzet-fókusz a LENYÍLÓBAN: az egér távozása nem zárhat, a
      // fókuszált tétel `visibility: hidden` lenne, és a fókusz elveszne.
      // (A gombon álló fókusz nem akadály: hoverre nyílt menü mellett a gomb
      // látható marad, a türelmi idő után zárunk — mérve 1024 px-en.)
      const focused = document.activeElement
      if (focused instanceof Node && menuRef.current?.contains(focused)) return
      hoverTimer.current = setTimeout(closeMenu, ACCOUNT_MENU_HOVER_CLOSE_MS)
    },
    [clearHoverTimer, closeMenu, open, pending],
  )

  /** A fókusz kilép a fiókból (Tab / Shift+Tab): a lenyíló zár. */
  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const to = event.relatedTarget
      if (to instanceof Node && event.currentTarget.contains(to)) return
      if (pending) return
      closeMenu()
    },
    [closeMenu, pending],
  )

  const handleButtonKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape') {
        // Hoverre nyílt menü, a fókusz a gombon: az Escape itt is zár
        // (SC 1.4.13 dismissable), a fókusz a gombon marad.
        if (open) {
          event.preventDefault()
          closeMenu()
        }
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        openMenu('first')
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        openMenu('last')
      }
    },
    [closeMenu, open, openMenu],
  )

  const handleMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const items = menuItemsOf(event.currentTarget)
      const index = items.findIndex((item) => item === document.activeElement)
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          // A fókusz ELŐBB kerül a gombra: zárva a lenyíló `visibility: hidden`.
          buttonRef.current?.focus()
          closeMenu()
          return
        case 'Tab':
          // Nem akadályozzuk: a Tab továbblép, a blur zár.
          return
        case 'ArrowDown':
          event.preventDefault()
          items[(index + 1) % items.length]?.focus()
          return
        case 'ArrowUp':
          event.preventDefault()
          items[(index - 1 + items.length) % items.length]?.focus()
          return
        case 'Home':
          event.preventDefault()
          items[0]?.focus()
          return
        case 'End':
          event.preventDefault()
          items[items.length - 1]?.focus()
          return
        default:
      }
    },
    [closeMenu],
  )

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

  // Kijelentkezve nincs kilépő fél: a „Belépés" a belépő szekcióban áll.
  if (!signedIn && section === 'exit') {
    return null
  }

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

  const signOutLabel = pending ? ACCOUNT_NAV_LABELS.signOutPending : ACCOUNT_NAV_LABELS.signOut

  if (isHeaderMenu) {
    const myCoursesCurrent = pathname === '/kurzusaim' || pathname?.startsWith('/kurzusaim/')
    return (
      <div
        className={`${base} kc-account-nav--menu`}
        data-open={open}
        onBlur={handleBlur}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        ref={accountRef}
      >
        <button
          aria-controls={menuId}
          aria-expanded={open}
          aria-haspopup="menu"
          className="kc-account-nav__link kc-account-nav__link--icon kc-account-nav__menu-button"
          onClick={() => (open ? closeMenu() : openMenu('first'))}
          onKeyDown={handleButtonKeyDown}
          ref={buttonRef}
          title={ACCOUNT_NAV_LABELS.account}
          type="button"
        >
          <UserCircleIcon signedIn />
          <span className="kc-visually-hidden">
            {ACCOUNT_NAV_LABELS.account} {ACCOUNT_NAV_LABELS.accountSignedIn}
          </span>
        </button>
        <div
          aria-label={ACCOUNT_NAV_LABELS.account}
          className="kc-account-nav__menu"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="menu"
        >
          <Link
            aria-current={myCoursesCurrent ? 'page' : undefined}
            className="kc-account-nav__menu-item"
            href="/kurzusaim"
            onClick={closeMenu}
            role="menuitem"
            tabIndex={-1}
          >
            {ACCOUNT_NAV_LABELS.myCourses}
          </Link>
          <div className="kc-account-nav__menu-separator" role="separator" />
          <button
            aria-busy={pending}
            className="kc-account-nav__menu-item kc-account-nav__signout"
            disabled={pending}
            onClick={handleSignOut}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            {signOutLabel}
          </button>
          {error !== null ? (
            <p aria-live="assertive" className="kc-account-nav__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  const showEntry = section !== 'exit'
  const showExit = section !== 'entry'
  const className = section === 'exit' ? `${base} kc-account-nav--exit` : base

  return (
    <div className={className} ref={accountRef}>
      {showEntry ? (
        <Link className="kc-account-nav__link" href="/kurzusaim" onClick={onNavigate}>
          {ACCOUNT_NAV_LABELS.myCourses}
        </Link>
      ) : null}
      {showExit ? (
        <button
          aria-busy={pending}
          className="kc-account-nav__signout"
          disabled={pending}
          onClick={handleSignOut}
          type="button"
        >
          {signOutLabel}
        </button>
      ) : null}
      {showExit && error !== null ? (
        <p aria-live="assertive" className="kc-account-nav__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
