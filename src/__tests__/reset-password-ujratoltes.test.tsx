// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ResetPasswordPage from '../app/(frontend)/jelszo-visszaallitas/page'
import { ResetPasswordForm } from '../components/auth/ResetPasswordForm'

/**
 * REGRESSZIÓ (2026-10-17): hozzájárulás esetén az analitika a visszaállító
 * jegyet kiveszi a címsorból (posthog.ts, scrubSensitiveQueryFromAddressBar).
 * A lap újratöltése, vagy a mobilon eldobott fül visszaállítása után a szerver
 * jegy nélkül renderelt, és a látogató az űrlap helyett hibát kapott. Az
 * űrlap ezért a jegyet a lapfül munkamenet-tárolójában megjegyzi, és a token
 * nélküli lap onnan állítja helyre. A sikeres beállítás után a jegy nem
 * maradhat a tárolóban.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLElement

function mount(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
}

/** Teljes lapbetöltés: a régi fa eltűnik, a lapfül tárolója marad. */
function reload(): void {
  act(() => root.unmount())
  container.remove()
  mount()
}

async function renderPageWithoutToken(): Promise<void> {
  const page = await ResetPasswordPage({
    searchParams: Promise.resolve({ returnUrl: '/kurzusaim' }),
  })
  act(() => root.render(page))
}

function type(name: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (!input) throw new Error(`Hiányzó mező: ${name}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  window.sessionStorage.clear()
  mount()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('/jelszo-visszaallitas — újratöltés a címsor-tisztítás után', () => {
  it('a jegy nélküli újratöltés a lapfülben megjegyzett jeggyel az űrlapot mutatja', async () => {
    act(() => root.render(<ResetPasswordForm token="DUMMY-RESET-TOKEN" />))
    reload()
    await renderPageWithoutToken()

    expect(container.querySelector('input[name="password"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Hiányzik a visszaállító token')
  })

  it('megjegyzett jegy nélkül a hiba látszik, a tároló olvasása után', async () => {
    await renderPageWithoutToken()

    expect(container.textContent).toContain('Hiányzik a visszaállító token')
    expect(container.querySelector('.kc-reset-restore')?.hasAttribute('data-checked')).toBe(true)
  })

  it('a sikeres beállítás után a jegy nem marad a lapfülben', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    act(() => root.render(<ResetPasswordForm token="DUMMY-RESET-TOKEN" />))
    type('password', 'Hosszu-Jelszo-2026')
    type('passwordConfirm', 'Hosszu-Jelszo-2026')
    await act(async () => {
      container.querySelector('form')?.requestSubmit()
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Új jelszó beállítva')

    reload()
    await renderPageWithoutToken()
    expect(container.querySelector('input[name="password"]')).toBeNull()
    expect(container.textContent).toContain('Hiányzik a visszaállító token')
  })
})
