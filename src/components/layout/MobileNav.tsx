'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import type { NavItem } from '../../lib/menu-tree'
import { getNavRouteState } from '../../lib/nav-route'
import { AccountNav } from './AccountNav'
import { HeaderAppointmentCta } from './HeaderAppointmentCta'
import { NavAnchor } from './NavAnchor'

/** A fiókban Tab-bal bejárható vezérlők (a rejtett, 0 méretű elemek nélkül). */
function drawerTabbables(drawer: HTMLElement): HTMLElement[] {
  return [...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
    (element) => element.getClientRects().length > 0,
  )
}

/**
 * FÓKUSZCSAPDA a nyitott fiókban (WP9, 2026-09-07, mérve).
 *
 * A fiók MODÁLIS: overlay fedi a lapot és a body görgetése zárolt. Mérve
 * (Chromium, 320 és 390 px): a fiók utolsó eleméről (Időpontfoglalás) a Tab
 * a lap tartalmára vitte a fókuszt, az overlay ALÁ, ahol a fókuszált elem
 * teljesen takart, és a lap nem is görgethető oda. Ez a WCAG 2.2 SC 2.4.11
 * Focus Not Obscured (Minimum) bukása: „a component is not entirely hidden
 * due to author-created content" — az Understanding szerint a modális
 * réteg csak akkor felel meg, ha a fókuszt magánál tartja.
 * https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
 *
 * A szabály a W3C APG modális párbeszéd-mintájáé: „Tab and Shift + Tab do
 * not move focus outside the dialog" — az utolsó elemről a Tab az elsőre, az
 * elsőről a Shift+Tab az utolsóra lép; az Escape zár.
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 *
 * A csapda CSAK a billentyűs Tab-ot fogja el: a képernyőolvasó virtuális
 * kurzora és a koppintás érintetlen (az overlay-koppintás zár).
 */
function trapTabInDrawer(event: KeyboardEvent, drawer: HTMLElement | null): void {
  if (!drawer) {
    return
  }
  const tabbables = drawerTabbables(drawer)
  const first = tabbables[0]
  const last = tabbables[tabbables.length - 1]
  if (!first || !last) {
    return
  }
  const active = document.activeElement
  if (!drawer.contains(active)) {
    // A fókusz kívül áll (pl. a hamburgeren): az első fiókelemre húzzuk.
    event.preventDefault()
    first.focus()
    return
  }
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Kompakt (< 900px) navigáció: hamburger-gomb + jobb oldali drawer.
 * - Hivatkozásra kattintva a fókusz NEM tér vissza a hamburgerre: ott az
 * - Nyitva a Tab a fiókon belül körbejár (fókuszcsapda, lásd fent).
 */
export function MobileNav({ items, signedIn = false }: { items: NavItem[]; signedIn?: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const drawerId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  const close = useCallback(() => setOpen(false), [])

  /** Zárás + a fókusz visszaadása a hamburgernek (Escape, bezáró gomb, overlay). */
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false)
    toggleRef.current?.focus()
  }, [])

  // Útvonalváltáskor záródik — a React ajánlott „állapot-igazítás renderben"
  // mintájával (https://react.dev/learn/you-might-not-need-an-effect), nem
  // effektben. Mountkor (és hidratáláskor) a két útvonal egyenlő, tehát nem
  // fut igazítás: a szerver- és a kliens-render kimenete változatlan. Csak
  // tényleges útvonalváltáskor zár, még a festés előtt (effekt helyett).
  const [renderedPathname, setRenderedPathname] = useState(pathname)
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname)
    setOpen(false)
  }

  // Escape + body scroll-lock + a fókusz beléptetése a drawerbe.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
        return
      }
      if (event.key === 'Tab') {
        trapTabInDrawer(event, drawerRef.current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    // A layout.css közös határán a rejtett drawer nem tarthatja zárolva az oldalt.
    const desktop = window.matchMedia('(min-width: 900px)')
    const drawer = drawerRef.current
    // A Chromium a médiaesemény előtt BODY-ra állíthatja az activeElementet.
    // A drawer és a külső hamburger fókuszát még látható állapotban követjük;
    // a más vezérlőre vitt fókuszt viszont nem vesszük el.
    const ownsFocus = (target: EventTarget | null) =>
      target instanceof Node &&
      (target === toggleRef.current || (drawer?.contains(target) ?? false))
    let navigationOwnsFocus = ownsFocus(document.activeElement)
    const onFocusIn = (event: FocusEvent) => {
      navigationOwnsFocus = ownsFocus(event.target)
    }
    document.addEventListener('focusin', onFocusIn)
    const onDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) return
      if (navigationOwnsFocus) {
        toggleRef.current
          ?.closest('header')
          ?.querySelector<HTMLAnchorElement>('.kc-site-header__brand')
          ?.focus()
      }
      setOpen(false)
    }
    desktop.addEventListener('change', onDesktop)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // A drawer ekkorra már `data-open="true"` (a CSS a rejtett → látható
    // irányban azonnal láthatóra vált), tehát a gomb fókuszálható.
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      desktop.removeEventListener('change', onDesktop)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <div className="kc-nav-mobile">
      <button
        aria-controls={drawerId}
        aria-expanded={open}
        aria-label={open ? 'Menü bezárása' : 'Menü megnyitása'}
        className="kc-nav-mobile__toggle"
        onClick={() => setOpen((value) => !value)}
        ref={toggleRef}
        type="button"
      >
        {open ? (
          <svg
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <line x1="18" x2="6" y1="6" y2="18" />
            <line x1="6" x2="18" y1="6" y2="18" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <line x1="3" x2="21" y1="6" y2="6" />
            <line x1="3" x2="21" y1="12" y2="12" />
            <line x1="3" x2="21" y1="18" y2="18" />
          </svg>
        )}
      </button>

      <div
        aria-hidden="true"
        className="kc-nav-mobile__overlay"
        data-open={open}
        onClick={closeAndRestoreFocus}
      />

      <nav
        aria-label="Mobil navigáció"
        className="kc-nav-mobile__drawer"
        data-open={open}
        id={drawerId}
        ref={drawerRef}
      >
        <div className="kc-nav-mobile__drawer-header">
          <span className="kc-nav-mobile__drawer-title">Menü</span>
          <button
            aria-label="Menü bezárása"
            className="kc-nav-mobile__toggle"
            onClick={closeAndRestoreFocus}
            ref={closeRef}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>
        <AccountNav onNavigate={close} signedIn={signedIn} variant="drawer" />
        {items.length > 0 ? (
          <ul className="kc-nav-mobile__list">
            {items.map((item) => {
              const routeState = getNavRouteState(item, pathname)
              return (
                <li key={item.id}>
                  <NavAnchor
                    className="kc-nav-mobile__link"
                    item={item}
                    onClick={close}
                    routeState={routeState}
                  />
                  {item.children.length > 0 ? (
                    <ul aria-label={`${item.label} almenü`} className="kc-nav-mobile__sublist">
                      {item.children.map((child) => {
                        const childRouteState = getNavRouteState(child, pathname)
                        return (
                          <li key={child.id}>
                            <NavAnchor
                              className="kc-nav-mobile__sublink"
                              item={child}
                              onClick={close}
                              routeState={childRouteState}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="kc-nav-mobile__empty">A menü jelenleg üres.</p>
        )}
        <div className="kc-nav-mobile__appointment">
          <HeaderAppointmentCta onNavigate={close} variant="drawer" />
        </div>
      </nav>
    </div>
  )
}
