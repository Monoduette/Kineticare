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
 *
 * NYITÁS-ZÁRÁS ANIMÁCIÓ MOBILON (2026-09-23, tulajdonosi kör: „nagyon
 * hirtelen … nem méltó az oldal finomságához”). A mobil accordionban a CSS
 * a panel magasságát, paddingját, keretét és margóját egy lépésben váltja
 * (0 ↔ auto), csak a tartalom halványul: a régi panel egy képkocka alatt
 * eltűnik, az új teljes magasságában megjelenik. A komponens ezért a váltást
 * Web Animations API-val animálja: a nyíló panel 0-ról a saját dobozára nő,
 * a záródó a régi dobozáról 0-ra zsugorodik, egyszerre, és a koppintott sor
 * a mozgás minden képkockájában ugyanott marad a képernyőn (a fölötte
 * záródó panel zsugorodását a görgetés követi).
 *
 * IDŐZÍTÉS ÉS GÖRBE (mérve). Az első változat a sín áttűnés-tokenjét
 * (350 ms, `--kc-ease-out` = cubic-bezier(0.2, 0.8, 0.2, 1)) használta; a
 * képkockánkénti mérés szerint a 812 px-es panel magasságváltozásának
 * kétharmada az első 100 ms-ban lezajlott, ami ugrásnak hat. A panel
 * magassága ezért a nagy kinyitásra ajánlott értékeket kapja:
 * 400 ms (IBM Carbon `duration--slow-01`: „Large expansion”) és a Carbon
 * kiegyensúlyozott, finoman induló és érkező görbéje,
 * cubic-bezier(0.4, 0.14, 0.3, 1) („standard, expressive”):
 * https://v10.carbondesignsystem.com/guidelines/motion/overview/. A nagyobb
 * elmozdulás hosszabb, egyenletesebb mozgást kér: NN/g, Animation Duration
 * and Motion Characteristics (100–500 ms),
 * https://www.nngroup.com/articles/animation-duration/; Material 3, Easing
 * and duration, https://m3.material.io/styles/motion/easing-and-duration/tokens-specs.
 * A panel tartalmának áttűnése a sín meglévő tokenjein marad (CSS).
 * Csökkentett mozgásnál (`prefers-reduced-motion`, a CSS a tokent 0-ra zárja)
 * és asztalon (ott a panelek egy cellában rétegződnek, magasságváltás
 * nincs) nincs animáció, a váltás azonnali (WCAG 2.2 SC 2.3.3).
 */

/** A panel magasság-animációjának ideje (IBM Carbon `duration--slow-01`). */
export const SIN_MAGASSAG_MS = 400

/** A panel magasság-animációjának görbéje (IBM Carbon „standard, expressive”). */
export const SIN_MAGASSAG_GORBE = 'cubic-bezier(0.4, 0.14, 0.3, 1)'

/** A mobil accordion töréspontja (services-sin.css `max-width: 899px`). */
export const SIN_MOBIL_MEDIA = '(max-width: 899px)'

/** A panel dobozának animált tulajdonságai (a mobil CSS ezeket váltja 0 ↔ érték között). */
type Doboz = Record<
  | 'height'
  | 'paddingTop'
  | 'paddingBottom'
  | 'marginBottom'
  | 'borderTopWidth'
  | 'borderBottomWidth',
  string
>

const URES_DOBOZ: Doboz = {
  height: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  marginBottom: '0px',
  borderTopWidth: '0px',
  borderBottomWidth: '0px',
}

function dobozMeres(panel: HTMLElement, ablak: Window): Doboz {
  const stilus = ablak.getComputedStyle(panel)
  return {
    height: `${panel.getBoundingClientRect().height}px`,
    paddingTop: stilus.paddingTop,
    paddingBottom: stilus.paddingBottom,
    marginBottom: stilus.marginBottom,
    borderTopWidth: stilus.borderTopWidth,
    borderBottomWidth: stilus.borderBottomWidth,
  }
}

/** Az első átmenet ideje ms-ban a kiszámolt `transition-duration`-ből (`0.35s` → 350). */
export function elsoAtmenetMs(ertek: string): number {
  const elso = ertek.split(',')[0]?.trim() ?? ''
  const szam = Number.parseFloat(elso)
  if (!Number.isFinite(szam)) {
    return 0
  }
  return elso.endsWith('ms') ? szam : szam * 1000
}

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
  const igazit = () => {
    const elteres = cimke.getBoundingClientRect().top - elotte
    if (Math.abs(elteres) >= 1) {
      ablak.scrollBy({ top: elteres, behavior: 'instant' })
    }
  }
  if (radio.checked) {
    radio.focus({ preventScroll: true })
    return
  }

  const fieldset = cimke.closest('fieldset')
  const radiok = fieldset
    ? [...fieldset.querySelectorAll<HTMLInputElement>('input.kc-services-sin__input')]
    : []
  const panelek = fieldset
    ? [...fieldset.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    : []
  const regiPanel = panelek[radiok.findIndex((elem) => elem.checked)]
  const ujPanel = panelek[radiok.indexOf(radio)]
  const mobil = ablak.matchMedia?.(SIN_MOBIL_MEDIA).matches === true
  const regiDoboz = mobil && regiPanel ? dobozMeres(regiPanel, ablak) : null

  radio.checked = true
  radio.dispatchEvent(new Event('input', { bubbles: true }))
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  radio.focus({ preventScroll: true })

  // A csökkentett mozgást a CSS jelzi: reduce alatt a panel átmenete 0 s.
  const mozoghat =
    mobil && ujPanel
      ? elsoAtmenetMs(ablak.getComputedStyle(ujPanel).transitionDuration) > 0 &&
        ablak.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
      : false
  if (!ujPanel || !mozoghat || typeof ujPanel.animate !== 'function') {
    igazit()
    ablak.requestAnimationFrame(igazit)
    return
  }

  const idozites: KeyframeAnimationOptions = {
    duration: SIN_MAGASSAG_MS,
    easing: SIN_MAGASSAG_GORBE,
  }
  const animaciok: Animation[] = []
  try {
    animaciok.push(ujPanel.animate([URES_DOBOZ, dobozMeres(ujPanel, ablak)], idozites))
    if (regiPanel && regiDoboz && regiPanel !== ujPanel) {
      animaciok.push(
        regiPanel.animate(
          [
            { ...regiDoboz, visibility: 'visible' },
            { ...URES_DOBOZ, visibility: 'visible' },
          ],
          idozites,
        ),
      )
    }
  } catch {
    // Ha a böngésző nem tudja lejátszani, a váltás azonnali marad, de a
    // koppintott sor akkor is a helyén.
    animaciok.forEach((animacio) => animacio.cancel())
    igazit()
    ablak.requestAnimationFrame(igazit)
    return
  }

  // A koppintott sor minden képkockában a helyén marad; a felhasználó saját
  // görgetése vagy érintése azonnal átveszi az irányítást.
  let kovet = true
  const leall = () => {
    kovet = false
  }
  ablak.addEventListener('touchstart', leall, { once: true, passive: true })
  ablak.addEventListener('wheel', leall, { once: true, passive: true })
  const lepes = () => {
    if (!kovet) {
      return
    }
    igazit()
    ablak.requestAnimationFrame(lepes)
  }
  lepes()
  void Promise.all(animaciok.map((animacio) => animacio.finished))
    .catch(() => undefined)
    .finally(() => {
      if (kovet) {
        igazit()
      }
      kovet = false
      ablak.removeEventListener('touchstart', leall)
      ablak.removeEventListener('wheel', leall)
    })
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
