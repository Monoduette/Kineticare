import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A beágyazott PostHog-dashboard kerete (admin Webanalitika).
 *
 * Mit véd: a PostHog a keret magasságát betöltéskor, egyszer küldi
 * (`posthog:dimensions`). Ha a keret a figyelő előtt kap címet, az üzenet
 * elveszhet, és a keret a tartalék magasságon ragad (Codex-review,
 * 2026-11-07). A teszt ezért a sorrendet méri: előbb figyelő, utána `src`.
 * A keret-betöltés ki van kapcsolva, hálózati hívás nincs (CLAUDE.md, 15.).
 */

const SRC = 'https://eu.posthog.com/embedded/abcDEF123_tokenXYZ'
const ORIGIN = 'https://eu.posthog.com'

let root: Root
let container: HTMLElement
let happyWindow: Window

beforeEach(async () => {
  happyWindow = new Window({
    url: 'http://localhost:3000/admin/webanalitika',
    settings: { disableIframePageLoading: true },
  })
  vi.stubGlobal('window', happyWindow)
  vi.stubGlobal('document', happyWindow.document)
  vi.stubGlobal('HTMLElement', happyWindow.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  try {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    await happyWindow.happyDOM.close()
  } finally {
    vi.unstubAllGlobals()
  }
})

async function renderEmbed() {
  const { PosthogDashboardEmbed, POSTHOG_EMBED_FRAME_NAME } =
    await import('../components/admin/webanalitika/PosthogDashboardEmbed')
  const order: string[] = []
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    const frame = container.querySelector('iframe')
    order.push(`listener:${String(type)}:src=${frame?.getAttribute('src') ?? 'nincs'}`)
    add(type, listener, options)
  })
  await act(async () => {
    root.render(createElement(PosthogDashboardEmbed, { origin: ORIGIN, src: SRC }))
  })
  const frame = container.querySelector('iframe')
  if (!frame) {
    throw new Error('hiányzik a keret')
  }
  return { frame, order, name: POSTHOG_EMBED_FRAME_NAME }
}

function postDimensions(origin: string, data: unknown) {
  window.dispatchEvent(
    new happyWindow.MessageEvent('message', { data, origin }) as unknown as Event,
  )
}

describe('PosthogDashboardEmbed', () => {
  it('a figyelő a keret címe ELŐTT indul, utána a keret megkapja az embedded címet', async () => {
    const { frame, order } = await renderEmbed()
    expect(order).toContain('listener:message:src=nincs')
    expect(frame.getAttribute('src')).toBe(SRC)
  })

  it('a saját nevű, EU-cloud originről jövő méret-üzenet beállítja a keret magasságát', async () => {
    const { frame, name } = await renderEmbed()
    await act(async () => {
      postDimensions(ORIGIN, { event: 'posthog:dimensions', name, height: 2345, width: 900 })
    })
    expect(frame.style.height).toBe('2345px')
  })

  it('idegen originről jövő üzenetet figyelmen kívül hagy', async () => {
    const { frame, name } = await renderEmbed()
    const before = frame.style.height
    await act(async () => {
      postDimensions('https://evil.example', { event: 'posthog:dimensions', name, height: 3000 })
    })
    expect(frame.style.height).toBe(before)
  })
})
