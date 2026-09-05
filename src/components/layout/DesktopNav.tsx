'use client'

import { usePathname } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import type { NavItem } from '../../lib/menu-tree'
import { getNavRouteState } from '../../lib/nav-route'
import { NavAnchor } from './NavAnchor'

/**
 * Desktop (>= 75em) vízszintes navigáció, egy szintű almenüvel.
 * `visibility: hidden`, tehát a benne lévő hivatkozások NEM fókuszálhatók — a
 */

function CaretIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-nav-desktop__caret"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * Hidratálás-érzékelő: szerveren `false`, a kliensen az első hidratálás után
 * `true`. A `useSyncExternalStore` a hivatalos út erre (a szerver- és a
 * kliens-pillanatkép SZÁNDÉKOSAN különbözik); effektben hívott `setState`
 * helyett azért ez, mert az kaszkádoló újrarenderelést okozna — a repó
 * ESLint-szabálya (react-hooks/set-state-in-effect) is tiltja.
 */
const subscribeToNothing = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function DesktopNav({ items }: { items: NavItem[] }) {
  const [openId, setOpenId] = useState<number | null>(null)
  const pathname = usePathname()
  const submenuIdPrefix = useId()
  const navRef = useRef<HTMLElement>(null)
  const toggleRefs = useRef(new Map<number, HTMLButtonElement | null>())

  // A `data-open` CSAK a hidratálás után kerül ki: a szerver-renderelt HTML
  // így pontosan a régi, CSS-vezérelt viselkedést hozza (lásd a fejlécet).
  const hydrated = useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot)

  const close = useCallback((id: number) => {
    setOpenId((current) => (current === id ? null : current))
  }, [])

  /**
   * A NAVIGÁCIÓN KÍVÜLI koppintás/kattintás zár.
   *
   * Érintésnél ez a megbízható zárás: a `pointerleave` ott a koppintás VÉGÉN
   * tüzel (a touch-pointer megszűnik), tehát önmagában azonnal be is csukná a
   * most megnyitott lenyílót, a `blur` pedig iOS-en nem mindig érkezik meg.
   */
  useEffect(() => {
    if (openId === null) {
      return
    }
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && navRef.current?.contains(target)) {
        return
      }
      setOpenId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openId])

  /**
   * Hover-nyitás/zárás — KIZÁRÓLAG egérrel.
   *
   * Érintésnél a böngésző a koppintásra is küld `pointerenter`-t: ha az
   * nyitna, a rá következő `click` a lenyitó gombon azonnal vissza is zárná a
   * most megnyílt lenyílót (a gomb „nyitva volt" állapotot látna). Ezért az
   * érintés kizárólag a gombon keresztül nyit.
   */
  const handlePointerEnter = useCallback((event: PointerEvent<HTMLLIElement>, id: number) => {
    if (event.pointerType !== 'mouse') {
      return
    }
    setOpenId(id)
  }, [])

  /**
   * Az egér elhagyja a menüpontot. Ha a BILLENTYŰZET-fókusz közben a lenyílón
   * belül áll, NEM zárunk: a zárás `visibility: hidden`-t adna a fókuszált
   * hivatkozásnak, és a fókusz nyom nélkül elveszne.
   */
  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLLIElement>, id: number) => {
      if (event.pointerType !== 'mouse') {
        return
      }
      const focused = typeof document === 'undefined' ? null : document.activeElement
      if (focused instanceof Node && event.currentTarget.contains(focused)) {
        return
      }
      close(id)
    },
    [close],
  )

  /**
   * A fókusz BELÉPÉSE a menüpontba nyit. A menüponton BELÜLI fókuszmozgást
   * (pl. Esc után a lenyitó gombra ugrás) szándékosan figyelmen kívül hagyjuk,
   * különben az Esc utáni fókuszmozgás azonnal újranyitná a lenyílót.
   */
  const handleFocus = useCallback((event: FocusEvent<HTMLLIElement>, id: number) => {
    const from = event.relatedTarget
    if (from instanceof Node && event.currentTarget.contains(from)) {
      return
    }
    setOpenId(id)
  }, [])

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLLIElement>, id: number) => {
      const to = event.relatedTarget
      if (to instanceof Node && event.currentTarget.contains(to)) {
        return
      }
      close(id)
    },
    [close],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>, id: number) => {
      if (event.key !== 'Escape') {
        return
      }
      // A fókusz ELŐBB kerül biztonságos helyre: a lenyíló zárt állapotban
      // `visibility: hidden`, tehát a benne álló fókusz elveszne.
      toggleRefs.current.get(id)?.focus()
      close(id)
    },
    [close],
  )

  if (items.length === 0) {
    return null
  }

  return (
    <nav aria-label="Fő navigáció" className="kc-nav-desktop" ref={navRef}>
      <ul className="kc-nav-desktop__list">
        {items.map((item) => {
          const hasChildren = item.children.length > 0
          const isOpen = openId === item.id
          const routeState = getNavRouteState(item, pathname)
          const submenuId = `${submenuIdPrefix}-${item.id}`

          if (!hasChildren) {
            return (
              <li className="kc-nav-desktop__item" key={item.id}>
                <NavAnchor className="kc-nav-desktop__link" item={item} routeState={routeState} />
              </li>
            )
          }

          return (
            <li
              className="kc-nav-desktop__item"
              data-open={hydrated ? String(isOpen) : undefined}
              key={item.id}
              onBlur={(event) => handleBlur(event, item.id)}
              onFocus={(event) => handleFocus(event, item.id)}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
              onPointerEnter={(event) => handlePointerEnter(event, item.id)}
              onPointerLeave={(event) => handlePointerLeave(event, item.id)}
            >
              <NavAnchor className="kc-nav-desktop__link" item={item} routeState={routeState} />
              <button
                aria-controls={submenuId}
                aria-expanded={isOpen}
                className="kc-nav-desktop__toggle"
                onClick={() => setOpenId((current) => (current === item.id ? null : item.id))}
                ref={(node) => {
                  toggleRefs.current.set(item.id, node)
                }}
                type="button"
              >
                <CaretIcon />
                <span className="kc-visually-hidden">{`${item.label} almenü`}</span>
              </button>
              <ul
                aria-label={`${item.label} almenü`}
                className="kc-nav-desktop__submenu"
                id={submenuId}
              >
                {item.children.map((child) => {
                  const childRouteState = getNavRouteState(child, pathname)
                  return (
                    <li key={child.id}>
                      <NavAnchor
                        className="kc-nav-desktop__sublink"
                        item={child}
                        routeState={childRouteState}
                      />
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
