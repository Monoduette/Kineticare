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

/**
 * A panelek `data-active` jelzője a rádiók állapotából (a sorrend azonos: az
 * n-edik rádió az n-edik panelé, Services.tsx).
 *
 * MIÉRT: a fülváltás tisztán CSS (`:checked ~`), tehát DOM-változás nélkül
 * történik. A PostHog halott kattintásnak veszi azt a koppintást, amely után
 * 2,5 másodpercen belül nincs DOM-mutáció; ez az attribútum-írás a valódi
 * váltást láthatóvá teszi számára. Megjelenést nem befolyásol.
 * https://posthog.com/docs/product-analytics/dead-clicks
 */
export function sinPanelAllapot(fieldset: HTMLElement): void {
  const radiok = [...fieldset.querySelectorAll<HTMLInputElement>('input.kc-services-sin__input')]
  const panelek = [...fieldset.querySelectorAll<HTMLElement>('article.kc-services-sin__panel')]
  panelek.forEach((panel, index) => {
    const aktiv = radiok[index]?.checked ? 'true' : 'false'
    if (panel.dataset.active !== aktiv) {
      panel.dataset.active = aktiv
    }
  })
}

export function SinKoppintasIgazito({ fieldsetId }: { fieldsetId: string }) {
  useEffect(() => {
    const fieldset = document.getElementById(fieldsetId)
    if (!fieldset) {
      return
    }
    const kezelo = (event: MouseEvent) => sinCimkeKattintas(event)
    const valtas = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'radio') {
        sinPanelAllapot(fieldset)
      }
    }
    // A hidratálás előtti (JS nélküli) váltás után is igaz legyen a jelző.
    sinPanelAllapot(fieldset)
    fieldset.addEventListener('click', kezelo)
    fieldset.addEventListener('change', valtas)
    return () => {
      fieldset.removeEventListener('click', kezelo)
      fieldset.removeEventListener('change', valtas)
    }
  }, [fieldsetId])
  return null
}
