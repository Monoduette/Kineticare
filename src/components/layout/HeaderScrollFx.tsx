'use client'

import { useEffect } from 'react'

/**
 * HeaderScrollFx — a sticky fejléc scroll-állapotának jelzője.
 * A <html> elemre két jelzést tesz:
 * - `--kc-header-veil`: 0..1 FOLYTONOS érték, a görgetés-pozícióval arányos.
 * A lap tetején 0 (a fejléc teljesen átlátszó), `VEIL_RANGE` pixel után 1
 * (fagyott üveg: 72% lap-fedés + blur a layout.css ::before rétegén). A fejléc
 * minden vizuális átmenete ebből az egy számból számolódik, így a háttér, a
 * hajszálvonal, a CTA és a fókuszgyűrű ugyanazon a görbén marad.
 */

/**
 * Ennyi pixel görgetés után éri el a fejléc a fagyott üveget. Elég hosszú
 * ahhoz, hogy az átmenet érzékelhetően folytonos legyen, és elég rövid ahhoz,
 * hogy a filmsávon a részlegesen áttetsző állapot ne tartson sokáig.
 */
const VEIL_RANGE = 280

export function HeaderScrollFx() {
  useEffect(() => {
    const root = document.documentElement
    let frame = 0
    let last = -1

    const update = () => {
      frame = 0
      const y = window.scrollY
      // Két tizedesre kerekítve: a stílus újraszámolása így nem fut le minden
      // egyes pixelre, a szem viszont folytonosnak látja.
      const veil = Math.round(Math.min(Math.max(y / VEIL_RANGE, 0), 1) * 100) / 100
      if (veil !== last) {
        last = veil
        root.style.setProperty('--kc-header-veil', String(veil))
      }
      root.toggleAttribute('data-kc-scrolled', y > 8)
    }

    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) {
        cancelAnimationFrame(frame)
      }
      root.style.removeProperty('--kc-header-veil')
      root.removeAttribute('data-kc-scrolled')
    }
  }, [])

  return null
}
