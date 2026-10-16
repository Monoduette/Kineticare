'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { NavItem } from '../../lib/menu-tree'
import { getNavRouteState } from '../../lib/nav-route'
import { AccountNav } from './AccountNav'
import { NavAnchor } from './NavAnchor'

/** A fiókban Tab-bal bejárható vezérlők (a rejtett, 0 méretű elemek nélkül). */
function drawerTabbables(drawer: HTMLElement): HTMLElement[] {
  // A fátyol-gomb (`tabindex="-1"`) nem Tab-állomás, a csapda sem számol vele.
  return [
    ...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]):not([tabindex="-1"])'),
  ].filter((element) => element.getClientRects().length > 0)
}

/**
 * FÓKUSZCSAPDA a nyitott fiókban (WP9, 2026-09-07, mérve).
 *
 * A fiók MODÁLIS: fátyol fedi a lapot és a lap görgetése zárolt. Mérve
 * (Chromium, 320 és 390 px): a fiók utolsó eleméről a Tab
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
 * kurzora és a koppintás érintetlen (a fátyolra koppintás zár).
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

/** A fiók azonosítója: a fejléc gombja és a bezáró gomb `popovertarget`-je. */
export const MOBILE_MENU_ID = 'kc-mobile-menu'

/** Ismeri-e a böngésző a popover API-t (a CSS `@supports selector(:popover-open)` párja). */
function supportsPopover(element: HTMLElement): boolean {
  return typeof element.showPopover === 'function'
}

/** Nyitva van-e a fiók (popover vagy a régi böngészős `<details>` ág). */
function isDrawerOpen(drawer: HTMLElement | null, fallback: HTMLDetailsElement | null): boolean {
  if (drawer && supportsPopover(drawer)) {
    return drawer.matches(':popover-open')
  }
  return fallback?.open ?? false
}

/**
 * Kompakt (< 900px) navigáció: hamburger-gomb + jobb oldali fiók.
 *
 * NATÍV NYITÁS (2026-10-16, a mobil halott kattintások javítása). A PostHog
 * szerint a mobil halott kattintások 54%-a a hamburgerre esett: lassú
 * hálózaton a fejléc már látszik, de a React hidratálása 3–5 mp-ig nem fut le,
 * és addig a koppintás elveszett, mert a nyitás egy React `onClick` volt. A
 * fiókot ezért a böngésző nyitja, JavaScript nélkül:
 * - a fejléc gombja `popovertarget` + `popovertargetaction="toggle"`, a fiók
 *   `popover="manual"` (HTML Living Standard, popover API);
 *   https://html.spec.whatwg.org/multipage/popover.html
 * - régi böngészőn (popover nélkül) `<details><summary>` pár nyit, a CSS
 *   `@supports selector(:popover-open)` dönt a kettő között (layout.css);
 * - a React csak ráül a már működő menüre: útvonalváltáskor és asztali
 *   szélességen bezár, kezeli az Escape-et és a fókuszcsapdát. Nyitó
 *   `onClick` nincs, a hidratálás előtti koppintás is nyit.
 * A görgetés zárolása és a fátyol CSS (`html:has(...:popover-open)`,
 * `::backdrop`), nem `body.style.overflow`. A fátyolra koppintást a fiókon
 * belüli, `popovertargetaction="hide"` fátyol-gomb fogja el: zár, és nem
 * engedi le a koppintást az alatta lévő linkre (JavaScript nélkül is).
 *
 * - A fiók tartalma: fiók-belépő + a CMS-menü. Külön időpont-gomb a fiók
 *   alján NINCS (2026-09-07, tulajdonosi döntés): a „Kapcsolat” menüpont
 *   viszi az időpontkérő űrlapra. Kijelentkezve a lista a fiók utolsó
 *   Tab-állomása; BEJELENTKEZVE a lista után a „Kijelentkezés" gomb áll, és
 *   az a fiók utolsó fókuszálható eleme (WP31, tulajdonosi kérés: „ha be
 *   vagyok jelentkezve akkor a kijelentkezés az utolsó gomb"; AccountNav.tsx
 *   `section`; WCAG 2.2 SC 2.4.3 Focus Order — a DOM-sorrend a Tab-sorrend).
 *   NN/g Menu-Design Checklist: https://www.nngroup.com/articles/menu-design/
 * - Nyitva a Tab a fiókon belül körbejár (fókuszcsapda, lásd fent).
 */
export function MobileNav({ items, signedIn = false }: { items: NavItem[]; signedIn?: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const fallbackRef = useRef<HTMLDetailsElement>(null)

  /** A fiók bezárása a natív állapoton át; a React-állapotot a `toggle` esemény követi. */
  const close = useCallback(() => {
    const drawer = drawerRef.current
    const fallback = fallbackRef.current
    if (drawer && supportsPopover(drawer)) {
      if (drawer.matches(':popover-open')) {
        drawer.hidePopover()
      }
    } else if (fallback?.open) {
      fallback.open = false
    }
  }, [])

  /** Zárás + a fókusz visszaadása a hamburgernek (Escape, bezáró gomb, fátyol). */
  const closeAndRestoreFocus = useCallback(() => {
    close()
    const drawer = drawerRef.current
    const toggle =
      drawer && !supportsPopover(drawer)
        ? fallbackRef.current?.querySelector<HTMLElement>('summary')
        : toggleRef.current
    toggle?.focus()
  }, [close])

  // A natív nyitás-zárás követése. A popover és a <details> is `toggle`
  // eseményt küld. Ha a látogató a hidratálás ELŐTT nyitotta ki a fiókot,
  // az esemény már lement: a mountkori olvasás pótolja.
  useEffect(() => {
    const drawer = drawerRef.current
    const fallback = fallbackRef.current
    const sync = () => setOpen(isDrawerOpen(drawerRef.current, fallbackRef.current))
    sync()
    drawer?.addEventListener('toggle', sync)
    fallback?.addEventListener('toggle', sync)
    return () => {
      drawer?.removeEventListener('toggle', sync)
      fallback?.removeEventListener('toggle', sync)
    }
  }, [])

  // Útvonalváltáskor záródik. A natív állapot a DOM-ban él, ezért effekt kell
  // (nem render közbeni állapot-igazítás); mountkor nem fut.
  const renderedPathname = useRef(pathname)
  useEffect(() => {
    if (renderedPathname.current === pathname) {
      return
    }
    renderedPathname.current = pathname
    close()
  }, [close, pathname])

  // Escape + fókuszcsapda + asztali zárás + a fókusz beléptetése.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAndRestoreFocus()
        return
      }
      if (event.key === 'Tab') {
        trapTabInDrawer(event, drawerRef.current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    // A layout.css közös határán a rejtett fiók nem maradhat nyitva.
    const desktop = window.matchMedia('(min-width: 900px)')
    const drawer = drawerRef.current
    // A Chromium a médiaesemény előtt BODY-ra állíthatja az activeElementet.
    // A fiók és a külső hamburger fókuszát még látható állapotban követjük;
    // a más vezérlőre vitt fókuszt viszont nem vesszük el.
    const ownsFocus = (target: EventTarget | null) =>
      target instanceof Node &&
      (target === toggleRef.current ||
        (fallbackRef.current?.contains(target) ?? false) ||
        (drawer?.contains(target) ?? false))
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
      close()
    }
    desktop.addEventListener('change', onDesktop)
    // A hidratálás előtt kinyitott fiók már asztali szélességen is lehet (a
    // telefon közben elfordult): ott rejtett, tehát nem maradhat nyitva.
    if (desktop.matches) {
      close()
    } else {
      closeRef.current?.focus()
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      desktop.removeEventListener('change', onDesktop)
    }
  }, [close, closeAndRestoreFocus, open])

  const hamburger = (
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
  )

  return (
    <div className="kc-nav-mobile">
      {/* A nyitás a böngészőé: a `popovertarget` JavaScript nélkül, a
          hidratálás előtt is működik. A kibontott állapotot a böngésző
          maga közli a felolvasóval (HTML-AAM: popovertarget → aria-expanded),
          ezért nincs kézi `aria-expanded`. */}
      <button
        aria-controls={MOBILE_MENU_ID}
        aria-label="Menü megnyitása"
        className="kc-nav-mobile__toggle"
        popoverTarget={MOBILE_MENU_ID}
        popoverTargetAction="toggle"
        ref={toggleRef}
        type="button"
      >
        {hamburger}
      </button>

      {/* Régi böngésző (popover nélkül): ugyanaz a gomb `<summary>`-ként. A
          CSS csak `@supports not selector(:popover-open)` mellett mutatja.
          Nyitva a fátyol a summary része, tehát a fátyolra koppintás JS
          nélkül is zár. */}
      <details className="kc-nav-mobile__fallback" ref={fallbackRef}>
        <summary aria-label="Menü megnyitása" className="kc-nav-mobile__toggle">
          {hamburger}
        </summary>
      </details>

      <nav
        aria-label="Mobil navigáció"
        className="kc-nav-mobile__drawer"
        id={MOBILE_MENU_ID}
        popover="manual"
        ref={drawerRef}
      >
        {/* A fátyol koppintási felülete (layout.css `.kc-nav-mobile__scrim`):
            a fiók melletti sávot fedi, a natív `hide` zár vele, JavaScript
            nélkül is. A felolvasónak és a Tabnak nem létezik; a fiók saját
            bezáró gombja és az Escape az akadálymentes út. */}
        <button
          aria-hidden="true"
          className="kc-nav-mobile__scrim"
          onClick={closeAndRestoreFocus}
          popoverTarget={MOBILE_MENU_ID}
          popoverTargetAction="hide"
          tabIndex={-1}
          type="button"
        />
        <div className="kc-nav-mobile__drawer-header">
          <span className="kc-nav-mobile__drawer-title">Menü</span>
          <button
            aria-label="Menü bezárása"
            className="kc-nav-mobile__toggle"
            onClick={closeAndRestoreFocus}
            popoverTarget={MOBILE_MENU_ID}
            popoverTargetAction="hide"
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
        <AccountNav onNavigate={close} section="entry" signedIn={signedIn} variant="drawer" />
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
        {signedIn ? (
          <AccountNav onNavigate={close} section="exit" signedIn={signedIn} variant="drawer" />
        ) : null}
      </nav>
    </div>
  )
}
