// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Services } from '../components/blocks/Services'
import {
  SIN_CIMKE_OSZTALY,
  SIN_MAGASSAG_GORBE,
  SIN_MAGASSAG_MS,
  SinKoppintasIgazito,
  elsoAtmenetMs,
  sinCimkeKattintas,
} from '../components/blocks/SinKoppintasIgazito'
import type { BlockServices } from '../payload-types'

/**
 * Az „Így tudunk segíteni” sín koppintás-javításának őre
 * (src/components/blocks/SinKoppintasIgazito.tsx).
 *
 * Bejelentett hiba (2026-09-23, mobil gyári böngésző): koppintásra a lap
 * 1188 px-t ugrott, mert a címke-kattintás a modul tetején álló rejtett
 * rádiót fókuszálta, és a fölötte összecsukódó panel is elcsúsztatta a sort.
 * A happy-dom nem számol elrendezést, ezért a címke helyzetét a teszt adja
 * meg (az összecsukódást a `getBoundingClientRect` második értéke jelzi); a
 * valódi elrendezést a mobil-emulációs mérés igazolta.
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
  it('a fieldset azonosítót kap, a címkék a saját rádiójukra mutatnak', () => {
    const { fieldset, cimkek, radiok } = sinDom()
    expect(fieldset?.id).toBe('kc-help-abc123-sin')
    expect(cimkek).toHaveLength(3)
    cimkek.forEach((cimke, index) => expect(cimke.htmlFor).toBe(radiok[index]?.id))
    expect(radiok[0]?.checked).toBe(true)
  })
})

describe('sinCimkeKattintas', () => {
  it('kiválasztja a sort, görgetés nélkül fókuszál, és helyben tartja a koppintott sort', () => {
    const { cimkek, radiok } = sinDom()
    const cimke = cimkek[2]
    const radio = radiok[2]
    if (!cimke || !radio) throw new Error('hiányzó sín-elem')
    // Koppintáskor a sor 424 px-en áll; a fölötte lévő 812 px-es panel
    // összecsukódása után -388 px-re csúszna.
    vi.spyOn(cimke, 'getBoundingClientRect')
      .mockReturnValueOnce({ top: 424 } as DOMRect)
      .mockReturnValue({ top: -388 } as DOMRect)
    const fokusz = vi.spyOn(radio, 'focus')
    const gorget = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    const valtozas = vi.fn()
    radio.addEventListener('change', valtozas)

    const esemeny = kattintas(cimke.querySelector('.kc-services-sin__rail-title'))
    sinCimkeKattintas(esemeny, window)

    expect(radio.checked).toBe(true)
    expect(radiok[0]?.checked).toBe(false)
    expect(valtozas).toHaveBeenCalled()
    expect(esemeny.preventDefault).toHaveBeenCalled()
    expect(fokusz).toHaveBeenCalledWith({ preventScroll: true })
    expect(gorget).toHaveBeenCalledWith({ top: -812, behavior: 'instant' })
  })

  it('ha a sor nem mozdul, nem görget', () => {
    const { cimkek } = sinDom()
    const cimke = cimkek[1]
    if (!cimke) throw new Error('hiányzó sín-elem')
    vi.spyOn(cimke, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect)
    const gorget = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    sinCimkeKattintas(kattintas(cimke), window)
    expect(gorget).not.toHaveBeenCalled()
  })

  it('a sínen kívüli kattintáshoz nem nyúl', () => {
    sinDom()
    const cim = document.querySelector('h2')
    const gorget = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const esemeny = kattintas(cim)
    sinCimkeKattintas(esemeny, window)
    expect(esemeny.preventDefault).not.toHaveBeenCalled()
    expect(gorget).not.toHaveBeenCalled()
  })
})

describe('mobil nyitás-zárás animáció', () => {
  it('az átmenet idejét ms-ra váltja, a listából az elsőt veszi', () => {
    expect(elsoAtmenetMs('0.35s, 0s')).toBe(350)
    expect(elsoAtmenetMs('400ms')).toBe(400)
    expect(elsoAtmenetMs('0s, 0s')).toBe(0)
    expect(elsoAtmenetMs('')).toBe(0)
  })

  /** Mobil környezet: a mobil média igaz, a panel átmenete 0,35 s, 24 px-es paddinggel. */
  function mobilKornyezet() {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('max-width') }) as MediaQueryList,
    )
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          transitionDuration: '0.35s, 0s',
          paddingTop: '24px',
          paddingBottom: '24px',
          marginBottom: '24px',
          borderTopWidth: '1px',
          borderBottomWidth: '1px',
        }) as CSSStyleDeclaration,
    )
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
  }

  /** A panel magassága koppintás előtt, majd utána (happy-dom nem számol elrendezést). */
  function magassag(panel: HTMLElement, elotte: number, utana: number) {
    vi.spyOn(panel, 'getBoundingClientRect')
      .mockReturnValueOnce({ height: elotte } as DOMRect)
      .mockReturnValue({ height: utana } as DOMRect)
  }

  it('mobilon a nyíló és a záródó panelt is animálja, a Carbon nagy kinyitás időzítésével', () => {
    const { cimkek, radiok } = sinDom()
    const panelek = [...document.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    const [regiPanel, kozepso, ujPanel] = panelek
    const cimke = cimkek[2]
    if (!cimke || !ujPanel || !regiPanel || !kozepso) throw new Error('hiányzó sín-elem')
    mobilKornyezet()
    magassag(regiPanel, 800, 0)
    magassag(kozepso, 0, 0)
    magassag(ujPanel, 0, 700)
    const kesz = { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation
    const uj = vi.fn(() => kesz)
    const regi = vi.fn(() => kesz)
    const kozep = vi.fn(() => kesz)
    Object.assign(ujPanel, { animate: uj })
    Object.assign(regiPanel, { animate: regi })
    Object.assign(kozepso, { animate: kozep })

    sinCimkeKattintas(kattintas(cimke), window)

    expect(radiok[2]?.checked).toBe(true)
    expect(uj).toHaveBeenCalledTimes(1)
    expect(regi).toHaveBeenCalledTimes(1)
    expect(kozep).not.toHaveBeenCalled()
    const [ujKockak, ujIdozites] = uj.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ]
    expect(ujKockak[0]).toMatchObject({ height: '0px' })
    expect(ujKockak[1]).toMatchObject({ height: '700px', paddingTop: '24px' })
    expect(ujIdozites).toEqual({ duration: SIN_MAGASSAG_MS, easing: SIN_MAGASSAG_GORBE })
    const [regiKockak] = regi.mock.calls[0] as unknown as [Keyframe[]]
    expect(regiKockak[0]).toMatchObject({ height: '800px', visibility: 'visible' })
    expect(regiKockak[1]).toMatchObject({ height: '0px', visibility: 'visible' })
  })

  it('a gyors második koppintás leállítja az előző váltás animációit', () => {
    const { cimkek, radiok } = sinDom()
    const panelek = [...document.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    const [elso, masodik, harmadik] = panelek
    if (!elso || !masodik || !harmadik || !cimkek[1] || !cimkek[2]) {
      throw new Error('hiányzó sín-elem')
    }
    mobilKornyezet()
    magassag(elso, 800, 0)
    magassag(harmadik, 0, 700)
    magassag(masodik, 0, 0)
    const futo = { finished: new Promise(() => undefined), cancel: vi.fn() }
    const animal = vi.fn(() => futo as unknown as Animation)
    panelek.forEach((panel) => Object.assign(panel, { animate: animal }))

    sinCimkeKattintas(kattintas(cimkek[2]), window)
    expect(futo.cancel).not.toHaveBeenCalled()
    sinCimkeKattintas(kattintas(cimkek[1]), window)

    expect(futo.cancel).toHaveBeenCalled()
    expect(radiok[1]?.checked).toBe(true)
  })

  it('csökkentett mozgásnál nem animál', () => {
    const { cimkek } = sinDom()
    const panelek = [...document.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    const cimke = cimkek[1]
    const ujPanel = panelek[1]
    if (!cimke || !ujPanel) throw new Error('hiányzó sín-elem')
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: true }) as MediaQueryList)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    const animal = vi.fn()
    Object.assign(ujPanel, { animate: animal })
    sinCimkeKattintas(kattintas(cimke), window)
    expect(animal).not.toHaveBeenCalled()
  })

  it('billentyű- vagy mutató-mozdulatra leáll a görgetéskövetés', () => {
    const { cimkek } = sinDom()
    const panelek = [...document.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    const [elso, masodik, harmadik] = panelek
    const cimke = cimkek[2]
    if (!elso || !masodik || !harmadik || !cimke) throw new Error('hiányzó sín-elem')
    mobilKornyezet()
    magassag(elso, 800, 0)
    magassag(masodik, 0, 0)
    magassag(harmadik, 0, 700)
    const kepkockak: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((visszahivas) => {
      kepkockak.push(visszahivas)
      return kepkockak.length
    })
    const futo = { finished: new Promise(() => undefined), cancel: vi.fn() }
    panelek.forEach((panel) => Object.assign(panel, { animate: () => futo }))
    vi.spyOn(cimke, 'getBoundingClientRect')
      .mockReturnValueOnce({ top: 400 } as DOMRect)
      .mockReturnValue({ top: 380 } as DOMRect)
    const gorget = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    sinCimkeKattintas(kattintas(cimke), window)
    const hivasokElotte = gorget.mock.calls.length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))
    kepkockak.forEach((kepkocka) => kepkocka(0))

    expect(gorget.mock.calls.length).toBe(hivasokElotte)
  })

  it('a komponens eltávolítása leállítja a futó váltást', async () => {
    const { fieldset, cimkek } = sinDom()
    const panelek = [...document.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    const [elso, masodik, harmadik] = panelek
    const cimke = cimkek[2]
    if (!fieldset || !elso || !masodik || !harmadik || !cimke) {
      throw new Error('hiányzó sín-elem')
    }
    mobilKornyezet()
    magassag(elso, 800, 0)
    magassag(masodik, 0, 0)
    magassag(harmadik, 0, 700)
    const futo = { finished: new Promise(() => undefined), cancel: vi.fn() }
    panelek.forEach((panel) => Object.assign(panel, { animate: () => futo }))
    const tarolo = document.createElement('div')
    document.body.append(tarolo)
    const gyoker = createRoot(tarolo)
    await act(async () => {
      gyoker.render(createElement(SinKoppintasIgazito, { fieldsetId: fieldset.id }))
    })

    // A happy-dom a címke alapviselkedését (a rádió bejelölését) a buborékoló
    // kezelő ELŐTT futtatja, a böngészők utána; ezért a kezelőt közvetlenül hívjuk.
    sinCimkeKattintas(kattintas(cimke), window)
    expect(futo.cancel).not.toHaveBeenCalled()
    await act(async () => {
      gyoker.unmount()
    })

    expect(futo.cancel).toHaveBeenCalled()
  })
})
