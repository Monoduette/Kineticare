'use client'

import { useFieldPath, useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type JSX } from 'react'

import {
  BEJELENTES_KESLELTETES_MS,
  szamlaloModell,
  type SzamlaloModell,
} from './KarakterSzamlaloLogika'

import './KarakterSzamlalo.css'

/**
 * Élő karakterszámláló a mező alatt („38 / 60 karakter”), a Payload
 * `admin.components.afterInput` helyére. A GOV.UK Character count mintája
 * (https://design-system.service.gov.uk/components/character-count/), a
 * logika és a források: KarakterSzamlaloLogika.ts.
 *
 * Akadálymentesség (a K53-as core-hibák elkerülésével):
 * - a látható szám aria-hidden, és nem fókuszálható, tehát nincs rejtett, de
 *   fókuszálható elem;
 * - a képernyőolvasó egy külön, vizuálisan rejtett aria-live="polite" régióból
 *   hallja a teljes mondatot, a gépelés megállása után
 *   (BEJELENTES_KESLELTETES_MS), betöltéskor pedig nem szól (WCAG 2.2
 *   SC 4.1.3);
 * - túllépésnél szöveg és szín együtt jelez (SC 1.4.1);
 * - a színek a Payload témaváltozói, így világos és sötét témában is AA-t
 *   adnak (mérés: KarakterSzamlalo.css).
 */

interface KarakterSzamlaloProps {
  /** A korlát karakterben (clientProps). */
  max?: number
  /** A mező útvonala; a Payload adja. A mezőkörnyezet útvonala elsőbbséget kap. */
  path?: string
}

/** A megjelenés, állapot nélkül (a render-teszt ezt hívja közvetlenül). */
export function KarakterSzamlaloView({
  modell,
  bejelentes,
}: {
  modell: SzamlaloModell
  bejelentes: string
}): JSX.Element {
  return (
    <div
      className={`kc-karakter-szamlalo${modell.tullepve ? ' kc-karakter-szamlalo--tul' : ''}`}
      data-hossz={modell.hossz}
      data-max={modell.max}
    >
      <p aria-hidden="true" className="kc-karakter-szamlalo__szoveg">
        {modell.lathatoSzoveg}
      </p>
      <div aria-atomic="true" aria-live="polite" className="kc-karakter-szamlalo__bejelentes">
        {bejelentes}
      </div>
    </div>
  )
}

export function KarakterSzamlalo({ max, path }: KarakterSzamlaloProps): JSX.Element | null {
  // A blokkok átrendezése után a propként kapott útvonal elavulhat; a
  // RenderFields környezete mindig a mező aktuális útvonalát adja.
  const kornyezetiUt = useFieldPath()
  const ut = kornyezetiUt || path || ''
  const ertek = useFormFields(([fields]) => (ut ? fields?.[ut]?.value : undefined))
  const modell = szamlaloModell(ertek, max)
  const aktualis = modell?.bejelentes ?? ''
  const [kiindulo] = useState(aktualis)
  const [bejelentes, setBejelentes] = useState('')

  useEffect(() => {
    // Betöltéskor (és amíg a szerkesztő nem írt bele) csend: a lapon több
    // számláló is van, egyszerre mind megszólalna.
    if (bejelentes === '' && aktualis === kiindulo) {
      return
    }
    const idozito = window.setTimeout(() => setBejelentes(aktualis), BEJELENTES_KESLELTETES_MS)
    return () => window.clearTimeout(idozito)
  }, [aktualis, bejelentes, kiindulo])

  if (!modell) {
    return null
  }
  return <KarakterSzamlaloView bejelentes={bejelentes} modell={modell} />
}
