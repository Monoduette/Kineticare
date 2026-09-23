// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IGAZITAS_ABLAK_MS,
  SzekcioHorgonyIgazito,
  szekcioHorgonyAzonosito,
} from '../components/editor/frontend/SzekcioHorgonyIgazito'
import { HORGONY_ELOTAG } from '../components/editor/frontend/szerkeszto-szalag'

/**
 * Az előnézeti horgony-igazító (B2-2-1): a „Megnézem” link utáni landolás a
 * betöltés és a betűk után a szalagra igazít, a felhasználó első mozdulata
 * pedig leállítja.
 */

describe('szekcioHorgonyAzonosito', () => {
  it('csak a szekció-horgonyt fogadja el', () => {
    expect(szekcioHorgonyAzonosito(`#${HORGONY_ELOTAG}abc123`)).toBe(`${HORGONY_ELOTAG}abc123`)
    expect(szekcioHorgonyAzonosito('#kurzusok')).toBeNull()
    expect(szekcioHorgonyAzonosito(`#${HORGONY_ELOTAG}`)).toBeNull()
    expect(szekcioHorgonyAzonosito('')).toBeNull()
    expect(szekcioHorgonyAzonosito('#%E0%A4%A')).toBeNull()
  })
})

describe('SzekcioHorgonyIgazito', () => {
  let meretFigyelok: { visszahivas: () => void; lekapcsolva: boolean }[]
  let gorgetesek: number
  let gyokerek: Root[]

  const render = (elem: React.ReactElement) => {
    const tarto = document.createElement('div')
    document.body.append(tarto)
    const gyoker = createRoot(tarto)
    gyokerek.push(gyoker)
    act(() => {
      gyoker.render(elem)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    meretFigyelok = []
    gorgetesek = 0
    gyokerek = []
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly bejegyzes: { visszahivas: () => void; lekapcsolva: boolean }
        constructor(visszahivas: () => void) {
          this.bejegyzes = { visszahivas, lekapcsolva: false }
          meretFigyelok.push(this.bejegyzes)
        }
        observe() {}
        disconnect() {
          this.bejegyzes.lekapcsolva = true
        }
      },
    )
    const cel = document.createElement('div')
    cel.id = `${HORGONY_ELOTAG}blokk1`
    cel.scrollIntoView = () => {
      gorgetesek += 1
    }
    document.body.appendChild(cel)
    window.history.replaceState(null, '', `/#${HORGONY_ELOTAG}blokk1`)
  })

  afterEach(() => {
    for (const gyoker of gyokerek) {
      act(() => {
        gyoker.unmount()
      })
    }
    document.body.innerHTML = ''
    window.history.replaceState(null, '', '/')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const betoltesUtan = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('betöltés után igazít, méretváltozásra újra, az ablak végén leáll', async () => {
    render(<SzekcioHorgonyIgazito />)
    await betoltesUtan()
    expect(gorgetesek).toBe(1)
    meretFigyelok[0]?.visszahivas()
    expect(gorgetesek).toBe(2)
    act(() => {
      vi.advanceTimersByTime(IGAZITAS_ABLAK_MS)
    })
    expect(meretFigyelok[0]?.lekapcsolva).toBe(true)
    meretFigyelok[0]?.visszahivas()
    expect(gorgetesek).toBe(2)
  })

  it('a felhasználó görgetése után nem igazít többé', async () => {
    render(<SzekcioHorgonyIgazito />)
    await betoltesUtan()
    expect(gorgetesek).toBe(1)
    window.dispatchEvent(new Event('wheel'))
    meretFigyelok[0]?.visszahivas()
    expect(gorgetesek).toBe(1)
    expect(meretFigyelok[0]?.lekapcsolva).toBe(true)
  })

  it('nem szekció-horgonynál semmit nem csinál', async () => {
    window.history.replaceState(null, '', '/#kurzusok')
    render(<SzekcioHorgonyIgazito />)
    await betoltesUtan()
    expect(gorgetesek).toBe(0)
    expect(meretFigyelok).toHaveLength(0)
  })
})
