// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Services } from '../components/blocks/Services'
import {
  SIN_CIMKE_OSZTALY,
  SinKoppintasIgazito,
  sinCimkeKattintas,
} from '../components/blocks/SinKoppintasIgazito'
import type { BlockServices } from '../payload-types'

/**
 * Az „Így tudunk segíteni” sín őre: az asztali fül-címke kattintás-javítása
 * (src/components/blocks/SinKoppintasIgazito.tsx) és a mobil harmonika
 * szerkezete (Services.tsx).
 *
 * Bejelentett hibák: 2026-09-23 koppintásra 1188 px-es ugrás (a rejtett
 * rádió fókusza a modul tetejére görgetett); 2026-10-05 a mobil nyitás
 * „nem sima”, a tulajdonos kérése: „sima, egyszerű CSS-animáció”. A
 * happy-dom nem számol elrendezést és nem futtat átmenetet: a mobil
 * mozgást a Chromiumos filmszalag igazolta, itt a szerkezetet őrizzük. A
 * stíluslap szerződése a services-block.test.tsx „mobil harmonika” blokkjában.
 */

const blokk = {
  id: 'abc123',
  blockType: 'services',
  elrendezes: 'sin',
  title: 'Így tudunk segíteni',
  rows: [
    { id: 'r1', title: 'Rendelői kezelés' },
    { id: 'r2', title: 'Otthoni program' },
    { id: 'r3', title: 'Szakmai képzés' },
  ],
} as unknown as BlockServices

function sinDom() {
  document.body.innerHTML = renderToStaticMarkup(<Services block={blokk} />)
  const fieldset = document.querySelector('fieldset')
  const cimkek = [...document.querySelectorAll<HTMLLabelElement>(`label.${SIN_CIMKE_OSZTALY}`)]
  const radiok = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  return { fieldset, cimkek, radiok }
}

/**
 * Kézzel épített kattintás-esemény: a valódi `dispatchEvent` a címke
 * alapviselkedését (a rádió bejelölését) is lefuttatná a kezelő előtt.
 */
function kattintas(cel: Element | null) {
  return { target: cel, preventDefault: vi.fn() } as unknown as MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('a sín szerkezete', () => {
  it('a fieldset azonosítót kap, az asztali címkék a saját rádiójukra mutatnak', () => {
    const { fieldset, cimkek, radiok } = sinDom()
    expect(fieldset?.id).toBe('kc-help-abc123-sin')
    expect(cimkek).toHaveLength(3)
    cimkek.forEach((cimke, index) => expect(cimke.htmlFor).toBe(radiok[index]?.id))
    expect(radiok[0]?.checked).toBe(true)
  })

  it('mobilon minden sornak saját nyitója van a panelen belül, az első nyitva indul', () => {
    sinDom()
    const panelek = [...document.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    expect(panelek).toHaveLength(3)
    panelek.forEach((panel, index) => {
      const jelolo = panel.querySelector<HTMLInputElement>('input.kc-services-sin__nyito-jelolo')
      const cimke = panel.querySelector<HTMLLabelElement>('label.kc-services-sin__mobil-cimke')
      expect(jelolo?.type).toBe('checkbox')
      expect(jelolo?.checked).toBe(index === 0)
      expect(cimke?.htmlFor).toBe(jelolo?.id)
      // A nyitó a címke ELŐTT, a nyíló kártya utánuk áll (`:checked +` és `~`).
      expect(jelolo?.nextElementSibling).toBe(cimke)
      expect(cimke?.nextElementSibling?.classList.contains('kc-services-sin__nyithato')).toBe(true)
      expect(
        panel.querySelector(
          '.kc-services-sin__nyithato > .kc-services-sin__vago > .kc-services-sin__kartya .kc-services-sin__copy',
        ),
      ).not.toBeNull()
    })
    // Egymástól független jelölőnégyzetek: egy sor nyitása nem csukja a többit.
    const jelolok = panelek.map((panel) =>
      panel.querySelector<HTMLInputElement>('input.kc-services-sin__nyito-jelolo'),
    )
    expect(new Set(jelolok.map((jelolo) => jelolo?.name ?? '')).size).toBe(1)
    expect(jelolok.every((jelolo) => !jelolo?.name)).toBe(true)
  })

  it('a mobil címke ugyanazt mondja, mint az asztali fül', () => {
    const { cimkek } = sinDom()
    const mobil = [
      ...document.querySelectorAll<HTMLLabelElement>('label.kc-services-sin__mobil-cimke'),
    ]
    expect(mobil.map((cimke) => cimke.textContent)).toEqual(
      cimkek.map((cimke) => cimke.textContent),
    )
  })
})

describe('sinCimkeKattintas (asztali fülek)', () => {
  it('kiválasztja a sort, és görgetés nélkül fókuszál', () => {
    const { cimkek, radiok } = sinDom()
    const cimke = cimkek[2]
    const radio = radiok[2]
    if (!cimke || !radio) throw new Error('hiányzó sín-elem')
    const fokusz = vi.spyOn(radio, 'focus')
    const gorget = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const valtozas = vi.fn()
    radio.addEventListener('change', valtozas)

    const esemeny = kattintas(cimke.querySelector('.kc-services-sin__rail-title'))
    sinCimkeKattintas(esemeny, window)

    expect(radio.checked).toBe(true)
    expect(radiok[0]?.checked).toBe(false)
    expect(valtozas).toHaveBeenCalled()
    expect(esemeny.preventDefault).toHaveBeenCalled()
    expect(fokusz).toHaveBeenCalledWith({ preventScroll: true })
    expect(gorget).not.toHaveBeenCalled()
  })

  it('a már kiválasztott sornál csak fókuszál', () => {
    const { cimkek, radiok } = sinDom()
    const cimke = cimkek[0]
    const radio = radiok[0]
    if (!cimke || !radio) throw new Error('hiányzó sín-elem')
    const fokusz = vi.spyOn(radio, 'focus')
    const valtozas = vi.fn()
    radio.addEventListener('change', valtozas)
    sinCimkeKattintas(kattintas(cimke), window)
    expect(valtozas).not.toHaveBeenCalled()
    expect(fokusz).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('a sínen kívüli és a mobil címkére esett kattintáshoz nem nyúl', () => {
    sinDom()
    for (const cel of [
      document.querySelector('h2'),
      document.querySelector('label.kc-services-sin__mobil-cimke'),
    ]) {
      const esemeny = kattintas(cel)
      sinCimkeKattintas(esemeny, window)
      expect(esemeny.preventDefault).not.toHaveBeenCalled()
    }
  })

  it('a komponens eltávolítása leveszi a kezelőt', async () => {
    const { fieldset, cimkek, radiok } = sinDom()
    const cimke = cimkek[1]
    if (!fieldset || !cimke) throw new Error('hiányzó sín-elem')
    const tarolo = document.createElement('div')
    document.body.append(tarolo)
    const gyoker = createRoot(tarolo)
    await act(async () => {
      gyoker.render(createElement(SinKoppintasIgazito, { fieldsetId: fieldset.id }))
    })
    await act(async () => {
      gyoker.unmount()
    })
    const esemeny = new MouseEvent('click', { bubbles: true, cancelable: true })
    cimke.querySelector('.kc-services-sin__rail-title')?.dispatchEvent(esemeny)
    // Kezelő nélkül a böngésző alapviselkedése marad (a kattintás nem tiltott).
    expect(esemeny.defaultPrevented).toBe(false)
    expect(radiok).toHaveLength(3)
  })
})
