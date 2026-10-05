'use client'

import { useEffect } from 'react'

/**
 * Az „Így tudunk segíteni” sín (Services, `elrendezes: 'sin'`) asztali
 * fül-címkéinek kattintás-javítása.
 *
 * A HIBA (2026-09-23, mérve Chromiumban): a címke-kattintás a hozzá tartozó
 * rádióra teszi a fókuszt, a böngésző pedig a fókuszált elemet a nézetbe
 * görgeti. A rejtett rádiók a `fieldset` ELEJÉN állnak (a `:checked ~`
 * testvér-kombinátor miatt ott kell lenniük), tehát a modul tetején: ha a
 * modul teteje a képernyő fölött van, a lap felugrik. A komponens ezért a
 * címke-kattintást maga kezeli: kiválasztja a rádiót, és görgetés nélkül
 * fókuszálja (`focus({ preventScroll: true })`). A felhasználó által nem kért
 * mozgás megszűnik (WCAG 2.2 SC 3.2.2 On Input,
 * https://www.w3.org/WAI/WCAG22/Understanding/on-input.html).
 *
 * MOBILON (< 900 px) a sín nem fül, hanem harmonika: minden sornak saját
 * jelölőnégyzete és címkéje van a panelen belül, a nyitás-csukás tisztán
 * CSS-átmenet (services-sin.css, „Mobil accordion”). Ahhoz ez a komponens
 * nem nyúl: a jelölőnégyzet a címke mellett áll, fókuszkor nem görget.
 *
 * JavaScript nélkül az asztali sín is működik (a rádió és a `:checked`
 * szabályok tisztán CSS-esek); a billentyűzetes kezelés (nyilak a
 * rádiócsoportban) sem változik, azt a böngésző végzi.
 */

/** A sín asztali fül-címkéinek osztálya (Services.tsx, services-sin.css). */
export const SIN_CIMKE_OSZTALY = 'kc-services-sin__rail-label'

/**
 * Egy címke-kattintás kezelése a sín `fieldset`-jén. Exportálva, hogy a
 * viselkedés tesztből (happy-dom) bizonyítható legyen.
 */
export function sinCimkeKattintas(event: MouseEvent, ablak: Window = window): void {
  const cel = event.target
  if (!(cel instanceof Element)) {
    return
  }
  const cimke = cel.closest(`label.${SIN_CIMKE_OSZTALY}`)
  if (!(cimke instanceof HTMLLabelElement)) {
    return
  }
  const radio = cimke.htmlFor ? ablak.document.getElementById(cimke.htmlFor) : null
  if (!(radio instanceof HTMLInputElement) || radio.type !== 'radio' || radio.disabled) {
    return
  }
  event.preventDefault()
  if (!radio.checked) {
    radio.checked = true
    radio.dispatchEvent(new Event('input', { bubbles: true }))
    radio.dispatchEvent(new Event('change', { bubbles: true }))
  }
  radio.focus({ preventScroll: true })
}

export function SinKoppintasIgazito({ fieldsetId }: { fieldsetId: string }) {
  useEffect(() => {
    const fieldset = document.getElementById(fieldsetId)
    if (!fieldset) {
      return
    }
    const kezelo = (event: MouseEvent) => sinCimkeKattintas(event)
    fieldset.addEventListener('click', kezelo)
    return () => fieldset.removeEventListener('click', kezelo)
  }, [fieldsetId])
  return null
}
