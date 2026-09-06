'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import type { NavItem } from '../../lib/menu-tree'
import { getNavRouteState } from '../../lib/nav-route'
import { AccountNav } from './AccountNav'
import { HeaderAppointmentCta } from './HeaderAppointmentCta'
import { NavAnchor } from './NavAnchor'

/**
 * Kompakt (< 75em) navigáció: hamburger-gomb + jobb oldali drawer.
 * - Hivatkozásra kattintva a fókusz NEM tér vissza a hamburgerre: ott az
 */
export function MobileNav({ items, signedIn = false }: { items: NavItem[]; signedIn?: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const drawerId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

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
      }
    }
    document.addEventListener('keydown', onKeyDown)
    // A layout.css közös határán a rejtett drawer nem tarthatja zárolva az oldalt.
    const desktop = window.matchMedia('(min-width: 75em)')
    const drawer = closeRef.current?.closest('nav')
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
