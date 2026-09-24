// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TURNSTILE_NORMAL_WIDTH_PX,
  TURNSTILE_POLL_MS,
  TurnstileWidget,
  turnstileSize,
} from '../app/(frontend)/kapcsolat/_components/TurnstileWidget'

/**
 * A Turnstile-widget őre (src/app/(frontend)/kapcsolat/_components/TurnstileWidget.tsx).
 *
 * Bejelentett hiba (2026-09-24, éles oldal, Chromium-mérés): a widget csak a
 * next/script `onLoad`-jában rajzolódott ki, ami a szkript ELSŐ betöltésekor fut
 * le. A később megjelenő második widget (a lábléc hírlevele után a /kapcsolat
 * időpontkérése, vagy lapváltás után) sosem rajzolódott ki, és az űrlap nem
 * volt beküldhető. A teszt a már betöltött API-t szimulálja (hálózat nélkül).
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

interface TurnstileMock {
  render: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

let turnstile: TurnstileMock
const roots: Root[] = []

function mount(props: Parameters<typeof TurnstileWidget>[0]) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  return {
    root,
    async render(next: Parameters<typeof TurnstileWidget>[0] = props) {
      await act(async () => {
        root.render(createElement(TurnstileWidget, next))
      })
    },
  }
}

beforeEach(() => {
  let sorszam = 0
  turnstile = {
    render: vi.fn(() => {
      sorszam += 1
      return `w${sorszam}`
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  Object.assign(window, { turnstile })
  // A szkriptet a teszt nem tölti le: hangosan dobó fetch (CLAUDE.md 15. pont).
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('a tesztből nem mehet ki hálózati hívás')
    }),
  )
})

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount()
    })
  }
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'turnstile')
  document.body.innerHTML = ''
})

describe('TurnstileWidget', () => {
  it('a már betöltött API-val azonnal kirajzol, és újramountkor újra (a hiba javítása)', async () => {
    const elso = mount({ siteKey: 'kulcs', onToken: vi.fn() })
    await elso.render()
    expect(turnstile.render).toHaveBeenCalledTimes(1)

    await act(async () => {
      elso.root.unmount()
    })
    roots.splice(roots.indexOf(elso.root), 1)
    expect(turnstile.remove).toHaveBeenCalledWith('w1')

    const masodik = mount({ siteKey: 'kulcs', onToken: vi.fn() })
    await masodik.render()
    expect(turnstile.render).toHaveBeenCalledTimes(2)
  })

  it('két widget egy lapon: mindkettő kirajzolódik (lábléc-hírlevél + időpontkérés)', async () => {
    await mount({ siteKey: 'kulcs', onToken: vi.fn() }).render()
    await mount({ siteKey: 'kulcs', onToken: vi.fn() }).render()
    expect(turnstile.render).toHaveBeenCalledTimes(2)
  })

  it('a még töltődő közös api.js mellett mountolt két widget is kirajzolódik, amint az API megérkezik', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      Reflect.deleteProperty(window, 'turnstile')
      await mount({ siteKey: 'kulcs', onToken: vi.fn() }).render()
      await mount({ siteKey: 'kulcs', onToken: vi.fn() }).render()
      expect(turnstile.render).not.toHaveBeenCalled()

      Object.assign(window, { turnstile })
      await act(async () => {
        vi.advanceTimersByTime(TURNSTILE_POLL_MS)
      })
      expect(turnstile.render).toHaveBeenCalledTimes(2)

      // Kirajzolás után a figyelés leáll: nincs újabb render.
      await act(async () => {
        vi.advanceTimersByTime(TURNSTILE_POLL_MS * 5)
      })
      expect(turnstile.render).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 300 px-es határ átlépésekor (elforgatás) a megfelelő méretben újrarajzol, a régi tokent törli', async () => {
    let visszahivas: (() => void) | null = null
    class FigyeloMock {
      constructor(cb: () => void) {
        visszahivas = cb
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FigyeloMock)
    let szelesseg = 342
    const onToken = vi.fn()
    const widget = mount({ siteKey: 'kulcs', onToken })
    const proto = HTMLElement.prototype
    const eredeti = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => szelesseg })
    try {
      await widget.render()
      expect(turnstile.render).toHaveBeenCalledTimes(1)
      expect(turnstile.render.mock.calls[0]?.[1]).toMatchObject({ size: 'normal' })

      // Méretváltozás a határon belül: nincs újrarajzolás.
      szelesseg = 320
      await act(async () => {
        visszahivas?.()
      })
      expect(turnstile.render).toHaveBeenCalledTimes(1)

      // Keskenyebb 300 px-nél: kompakt, a régi widget eltávolítva, token törölve.
      szelesseg = 288
      await act(async () => {
        visszahivas?.()
      })
      expect(turnstile.remove).toHaveBeenCalledWith('w1')
      expect(onToken).toHaveBeenLastCalledWith(null)
      expect(turnstile.render).toHaveBeenCalledTimes(2)
      expect(turnstile.render.mock.calls[1]?.[1]).toMatchObject({ size: 'compact' })
    } finally {
      if (eredeti) {
        Object.defineProperty(proto, 'clientWidth', eredeti)
      }
    }
  })

  it('a token a szülőhöz jut, lejárat és hiba után null, hibánál onError is', async () => {
    const onToken = vi.fn()
    const onError = vi.fn()
    await mount({ siteKey: 'kulcs', onToken, onError }).render()
    const [, opciok] = turnstile.render.mock.calls[0] as [
      HTMLElement,
      {
        callback: (token: string) => void
        'expired-callback': () => void
        'error-callback': () => void
        language: string
      },
    ]
    expect(opciok.language).toBe('hu')
    opciok.callback('token-1')
    expect(onToken).toHaveBeenLastCalledWith('token-1')
    opciok['expired-callback']()
    expect(onToken).toHaveBeenLastCalledWith(null)
    opciok['error-callback']()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('a resetKey változása új ellenőrzést kér és törli a régi tokent', async () => {
    const onToken = vi.fn()
    const widget = mount({ siteKey: 'kulcs', onToken, resetKey: 0 })
    await widget.render()
    expect(turnstile.reset).not.toHaveBeenCalled()

    await widget.render({ siteKey: 'kulcs', onToken, resetKey: 1 })
    expect(turnstile.reset).toHaveBeenCalledWith('w1')
    expect(onToken).toHaveBeenLastCalledWith(null)
    expect(turnstile.render).toHaveBeenCalledTimes(1)
  })
})

describe('turnstileSize', () => {
  it('300 px alatti tárolóban kompakt (320 px-es kijelzőn nincs vízszintes görgetés)', () => {
    expect(TURNSTILE_NORMAL_WIDTH_PX).toBe(300)
    expect(turnstileSize(288)).toBe('compact')
    expect(turnstileSize(300)).toBe('normal')
    expect(turnstileSize(414)).toBe('normal')
    // Mérhetetlen (0) szélességnél a normál marad.
    expect(turnstileSize(0)).toBe('normal')
  })
})
