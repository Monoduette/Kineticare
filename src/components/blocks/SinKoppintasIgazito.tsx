'use client'

import { useEffect } from 'react'

/**
 * Az „Így tudunk segíteni” sín (Services, `elrendezes: 'sin'`) koppintás-javítása.
 *
 * A HIBA (bejelentve 2026-09-23, mobil gyári böngésző; mérve Chromiumban,
 * 390×844, érintéssel, az éles lapon): nyitott 1. sornál a 3. sorra koppintva
 * a lap 1188 px-t ugrott FELFELÉ, a kinyílt tartalom a képernyő alja alá
 * került (teteje 892 px a 844 px magas nézetben). Két ok:
 *  1. A címke-kattintás a hozzá tartozó rádióra teszi a fókuszt, a böngésző
 *     pedig a fókuszált elemet a nézetbe görgeti. A rejtett rádiók a
 *     `fieldset` ELEJÉN állnak (a `:checked ~` testvér-kombinátor miatt ott
 *     kell lenniük), tehát a modul tetejére. Az ugrás pixelre egyezett a
 *     rádió és a nézet közti távolsággal.
 *  2. Mobilon a sín accordion: a koppintott sor FÖLÖTT nyitva lévő panel
 *     összecsukódik, és minden feljebb csúszik. Chromium a görgetés-
 *     horgonyzással (CSS Scroll Anchoring) részben kiegyenlíti, a Safari nem.
 *
 * A JAVÍTÁS: a címke-kattintást a komponens kezeli. Kiválasztja a rádiót,
 * görgetés nélkül fókuszálja (`focus({ preventScroll: true })`), majd a lapot
 * annyival görgeti, hogy a koppintott sor ugyanott maradjon a képernyőn, ahol
 * a koppintáskor volt; a kinyílt tartalom így közvetlenül alatta kezdődik.
 * Ez a mobil accordion elvárt viselkedése: a megnyitott tartalom a
 * fejléce alatt jelenik meg, a fejléc nem mozdul (NN/g, Accordions on
 * Mobile: https://www.nngroup.com/articles/mobile-accordions/; GOV.UK
 * Accordion: https://design-system.service.gov.uk/components/accordion/).
 * A felhasználó által nem kért mozgás megszűnik (WCAG 2.2 SC 3.2.2 On Input:
 * a kiválasztás nem okozhat váratlan kontextusváltást,
 * https://www.w3.org/WAI/WCAG22/Understanding/on-input.html).
 *
 * A görgetés `instant`: a böngésző saját ugrásának kiegyenlítése, nem új,
 * animált mozgás (a `html { scroll-behavior: smooth }` itt csak üldözést
 * okozna). A következő képkockában még egyszer igazít, ha a horgonyzás vagy
 * egy késői elrendezés-változás közben elmozdította a sort.
 *
 * JavaScript nélkül a sín a mai, tisztán CSS-es módon működik (a rádió és a
 * `:checked` szabályok változatlanok); a billentyűzetes kezelés (nyilak a
 * rádiócsoportban) sem változik, azt a böngésző végzi.
 */

/** A sín címkéinek osztálya (Services.tsx, services-sin.css). */
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
  const elotte = cimke.getBoundingClientRect().top
  if (!radio.checked) {
    radio.checked = true
    radio.dispatchEvent(new Event('input', { bubbles: true }))
    radio.dispatchEvent(new Event('change', { bubbles: true }))
  }
  radio.focus({ preventScroll: true })
  const igazit = () => {
    const elteres = cimke.getBoundingClientRect().top - elotte
    if (Math.abs(elteres) >= 1) {
      ablak.scrollBy({ top: elteres, behavior: 'instant' })
    }
  }
  igazit()
  ablak.requestAnimationFrame(igazit)
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
