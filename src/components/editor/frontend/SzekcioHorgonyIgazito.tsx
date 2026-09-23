'use client'

import { useEffect } from 'react'

import { HORGONY_ELOTAG } from './szerkeszto-szalag'

/**
 * Az admin „Megnézem” linkje (`/next/preview…#szekcio-<blokk-azonosító>`)
 * után a böngésző a horgonyra ugrik, de a HTML beérkezésekor: a később
 * betöltődő képek és betűkészletek a horgony fölötti szekciók magasságát még
 * átírják, és a szalag elcsúszik. Mérve (B2-2-1, 2026-09-23, Chromium, a
 * pages 1, 3, 4, 5 minden linkjén): 1440 px-en 32/35, 390 px-en 25/35, a
 * betűk megvárásával 23/35 landolt jó helyen; ugyanott a betöltés utáni
 * egyszeri `scrollIntoView` 35/35-ször a fejléc alá, 8 px-re igazított.
 *
 * Ezért a komponens a `load` és a `document.fonts.ready` után a horgonyhoz
 * igazít, majd egy rövid ablakig a lap magasságváltozásakor újra. A
 * felhasználó első görgetése, érintése, billentyűje vagy kattintása
 * leállítja: az ő mozdulata mindig erősebb, a lap nem „rángatja vissza”
 * (WCAG 2.2 SC 2.2.2 szellemében: a felhasználó által nem kért mozgás
 * megállítható; NN/g, User Control and Freedom:
 * https://www.nngroup.com/articles/user-control-and-freedom/).
 *
 * Az igazítás `instant`: ez a böngésző saját ugrásának javítása, nem új,
 * animált mozgás (a `html { scroll-behavior: smooth }` itt csak üldözést
 * okozna). A `scroll-padding-top` (base.css) a `scrollIntoView`-ra is hat,
 * így a szalag a sticky fejléc alá kerül.
 *
 * Csak piszkozat-előnézetben renderelődik (a `SzerkesztoOldalSzalag`
 * része), a látogató lapjára nem kerül kliens-JS.
 */

/**
 * Ennyi ideig igazít újra, ha a horgony fölötti tartalom még mozog. Mérve
 * (390 px, dev-szerver): 2,5 mp-es ablakkal 34/35 landolt jól, az egy hiba a
 * lap alján (y ≈ 15 900) álló Tudástár-ajánló volt, a fölötte lustán töltődő
 * képek az ablak után értek be. A hosszabb ablak nem zavar: a felhasználó
 * első mozdulata úgyis leállítja.
 */
export const IGAZITAS_ABLAK_MS = 5000

/** A felhasználó saját mozdulatai: bármelyik leállítja az igazítást. */
export const MEGSZAKITO_ESEMENYEK = [
  'wheel',
  'touchstart',
  'keydown',
  'pointerdown',
  'hashchange',
] as const

/** A hash-ből a szekció-horgony azonosítója, vagy `null`, ha nem szekció-horgony. */
export function szekcioHorgonyAzonosito(hash: string): string | null {
  if (!hash.startsWith('#')) {
    return null
  }
  let azonosito: string
  try {
    azonosito = decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
  return azonosito.startsWith(HORGONY_ELOTAG) && azonosito.length > HORGONY_ELOTAG.length
    ? azonosito
    : null
}

export function SzekcioHorgonyIgazito() {
  useEffect(() => {
    const azonosito = szekcioHorgonyAzonosito(window.location.hash)
    if (azonosito === null) {
      return
    }
    let aktiv = true
    let figyelo: ResizeObserver | null = null
    let idozito: number | undefined
    const leall = () => {
      aktiv = false
      figyelo?.disconnect()
      window.clearTimeout(idozito)
      for (const esemeny of MEGSZAKITO_ESEMENYEK) {
        window.removeEventListener(esemeny, leall)
      }
    }
    for (const esemeny of MEGSZAKITO_ESEMENYEK) {
      window.addEventListener(esemeny, leall, { passive: true })
    }
    const igazit = () => {
      if (!aktiv) {
        return
      }
      document.getElementById(azonosito)?.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
    const betoltve =
      document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise<void>((kesz) => window.addEventListener('load', () => kesz(), { once: true }))
    const betuk: Promise<unknown> = document.fonts?.ready ?? Promise.resolve()
    void Promise.all([betoltve, betuk]).then(() => {
      if (!aktiv) {
        return
      }
      igazit()
      if (typeof ResizeObserver === 'function') {
        figyelo = new ResizeObserver(igazit)
        figyelo.observe(document.body)
      }
      idozito = window.setTimeout(leall, IGAZITAS_ABLAK_MS)
    })
    return leall
  }, [])
  return null
}
