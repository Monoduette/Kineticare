'use client'

import { useConfig } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type FocusEvent } from 'react'

import {
  KEZDO_ALLAPOT,
  KET_LAP_CIM,
  KET_LAP_SZOVEG,
  dokumentumKulcs,
  eletciklusBekotese,
  jelenletFigyelo,
  type CsatornaGyar,
  type FigyeloAllapot,
  type JelenletFigyelo,
} from './ket-lap-figyelo'
import './KetLapFigyelo.css'

/**
 * Figyelmeztetés, ha ugyanaz a dokumentum egy másik böngészőlapon is
 * szerkesztőben van (a logika és a források: ket-lap-figyelo.ts). A
 * SzekcioMegnyito provider rendereli, így az egész adminban él, és a
 * payload.config.ts, valamint az importMap nem változik.
 *
 * MEGJELENÉS. Nem modális értesítés a nézetablak jobb alsó sarkában, a
 * Payload értesítéseinek és a SzekcioMegnyito figyelmeztetésének helyén; ha
 * az utóbbi is látszik, fölé kerül. Stílus: a B-1 szerződése
 * (.kc-admin-notice, .kc-admin-notice--figyelem, custom.scss 9. szakasz).
 * NN/g: „A typical implementation of a passive notification may be a badge
 * icon or a small nonmodal popover in a corner of a screen”
 * (https://www.nngroup.com/articles/indicators-validations-notifications/).
 *
 * FELOLVASÁS ÉS FÓKUSZ. A cím és a szöveg egy mindig jelen lévő
 * `role="status"` régióba kerül, epizódonként egyszer (WCAG 2.2 SC 4.1.3:
 * „can be presented to the user by assistive technologies without receiving
 * focus”, https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
 * A fókuszt nem veszi el. A bezáró gomb a régión kívül áll, így nem olvasódik
 * fel a szöveggel; bezáráskor a fókusz oda tér vissza, ahonnan a dobozba
 * érkezett.
 *
 * NEM TAKARHATJA A FÓKUSZT (SC 2.4.11: „A notification implemented as sticky
 * content, such as a cookie banner, will fail this success criterion if it
 * entirely obscures a component receiving focus”,
 * https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
 * Amíg a doboz látszik, a gyökérelem `scroll-padding-block-end`-je a doboz
 * sávjával egyenlő (WCAG-technika C43, „Using CSS scroll-padding to
 * un-obscure content”, https://www.w3.org/WAI/WCAG22/Techniques/css/C43), így
 * a böngésző a fókuszba kerülő elemet a doboz fölé görgeti; a lap végére
 * ugyanekkora tartalék kerül, hogy a legutolsó elem is a doboz fölé
 * görgethető legyen. A mentés és közzététel sávja fent van, a doboz lent.
 */

export interface KetLapFigyeloProps {
  /** A bezáró gomb felirata: a SzekcioMegnyito BEZARAS_FELIRAT-ja (SC 3.2.4). */
  bezarasFelirat: string
  /** Látszik-e a SzekcioMegnyito figyelmeztetése; ha igen, a doboz fölé kerül. */
  szekcioErtesitesLatszik?: boolean
  /** Tesztekhez: a csatorna forrása (alap: a böngésző BroadcastChannel-je). */
  csatornaGyar?: CsatornaGyar
}

/** A gyökérelem jelzője, amíg a doboz látszik (a CSS erre építi a scroll-paddinget). */
export const SAV_ATTR = 'data-kc-ket-lap-figyelo'

/** A doboz sávjának magassága a nézetablak aljától (px), a gyökérelemen. */
export const SAV_VALTOZO = '--kc-ket-lap-savmagassag'

/** A doboz távolsága a nézetablak szélétől, és a két doboz közti rés (px). */
const SZEL_PX = 16
const RES_PX = 8

/** A SzekcioMegnyito látható figyelmeztetésének osztálya (SzekcioMegnyito.css). */
const SZEKCIO_ERTESITES = '.kc-szekcio-megnyito--figyelem'

export function KetLapFigyelo({
  bezarasFelirat,
  szekcioErtesitesLatszik = false,
  csatornaGyar,
}: KetLapFigyeloProps) {
  const pathname = usePathname()
  const { config } = useConfig()
  const kulcs = dokumentumKulcs(pathname, config.routes.admin)
  const [allapot, setAllapot] = useState<FigyeloAllapot>(KEZDO_ALLAPOT)
  const figyeloRef = useRef<JelenletFigyelo | null>(null)
  const gyarRef = useRef<CsatornaGyar | undefined>(undefined)
  const lebontandoRef = useRef<JelenletFigyelo | null>(null)
  const dobozRef = useRef<HTMLDivElement>(null)
  const elozoFokuszRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const meglevo = figyeloRef.current
    const figyelo =
      meglevo !== null && !meglevo.megszunt() && gyarRef.current === csatornaGyar
        ? meglevo
        : jelenletFigyelo({
            csatornaGyar,
            lapLathato: document.visibilityState === 'visible',
          })
    if (lebontandoRef.current === figyelo) {
      lebontandoRef.current = null
    }
    figyeloRef.current = figyelo
    gyarRef.current = csatornaGyar
    const leiratkozas = figyelo.feliratkozas(setAllapot)
    const levalasztas = eletciklusBekotese(figyelo, window)
    figyelo.kulcsBeallitasa(kulcs)
    return () => {
      leiratkozas()
      levalasztas()
      // A lebontás egy mikrofeladattal később jön: ha ugyanez a komponens
      // azonnal újra felépül (navigáció, React fejlesztői kettős futtatás),
      // a figyelő marad, és a többi lap nem kap fölösleges távozás–bejelentés
      // párt (ami ott a figyelmeztetést eltüntetné és újra felolvastatná).
      lebontandoRef.current = figyelo
      queueMicrotask(() => {
        if (lebontandoRef.current === figyelo) {
          lebontandoRef.current = null
          figyelo.megszuntetes()
        }
      })
    }
  }, [csatornaGyar, kulcs])

  const { megjelenit } = allapot

  useEffect(() => {
    const doboz = dobozRef.current
    if (!megjelenit || doboz === null) {
      return undefined
    }
    const gyoker = document.documentElement
    const szekcio = szekcioErtesitesLatszik
      ? document.querySelector<HTMLElement>(SZEKCIO_ERTESITES)
      : null
    const igazit = () => {
      const alatta = szekcio?.isConnected ? szekcio.getBoundingClientRect().height + RES_PX : 0
      const also = SZEL_PX + alatta
      doboz.style.insetBlockEnd = `${String(also)}px`
      const sav = Math.ceil(also + doboz.getBoundingClientRect().height + RES_PX)
      gyoker.style.setProperty(SAV_VALTOZO, `${String(sav)}px`)
      gyoker.setAttribute(SAV_ATTR, '')
    }
    igazit()
    const meretFigyelo = typeof ResizeObserver === 'function' ? new ResizeObserver(igazit) : null
    meretFigyelo?.observe(doboz)
    if (szekcio) {
      meretFigyelo?.observe(szekcio)
    }
    window.addEventListener('resize', igazit)
    return () => {
      meretFigyelo?.disconnect()
      window.removeEventListener('resize', igazit)
      doboz.style.insetBlockEnd = ''
      gyoker.removeAttribute(SAV_ATTR)
      gyoker.style.removeProperty(SAV_VALTOZO)
    }
  }, [megjelenit, szekcioErtesitesLatszik])

  /** Honnan érkezett a fókusz a dobozba (bezáráskor oda tér vissza). */
  const fokuszErkezett = (esemeny: FocusEvent<HTMLDivElement>) => {
    const honnan = esemeny.relatedTarget
    if (honnan instanceof HTMLElement && !esemeny.currentTarget.contains(honnan)) {
      elozoFokuszRef.current = honnan
    }
  }

  const bezaras = () => {
    const vissza = elozoFokuszRef.current
    elozoFokuszRef.current = null
    const dobozban = dobozRef.current?.contains(document.activeElement) ?? false
    figyeloRef.current?.bezaras()
    if (dobozban && vissza?.isConnected) {
      vissza.focus()
    }
  }

  return (
    <>
      <div
        className={
          megjelenit
            ? 'kc-admin-notice kc-admin-notice--figyelem kc-ket-lap-figyelo'
            : 'kc-ket-lap-figyelo kc-ket-lap-figyelo--rejtett'
        }
        onFocus={fokuszErkezett}
        ref={dobozRef}
      >
        <div aria-atomic="true" className="kc-ket-lap-figyelo__allapot" role="status">
          {megjelenit ? (
            <>
              <p className="kc-admin-notice__cim">{KET_LAP_CIM}</p>
              <p className="kc-admin-notice__szoveg">{KET_LAP_SZOVEG}</p>
            </>
          ) : null}
        </div>
        {megjelenit ? (
          <button className="kc-ket-lap-figyelo__bezaras" onClick={bezaras} type="button">
            {bezarasFelirat}
          </button>
        ) : null}
      </div>
      {megjelenit ? <div aria-hidden="true" className="kc-ket-lap-figyelo__tartalek" /> : null}
    </>
  )
}

export default KetLapFigyelo
