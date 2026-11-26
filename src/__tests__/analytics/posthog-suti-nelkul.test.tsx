// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Süti nélküli mérés az elutasítóknak (tulajdonosi döntés, 2026-11-26).
 *
 * Mit véd: elutasítás után, bekapcsolt `NEXT_PUBLIC_POSTHOG_COOKIELESS`
 * mellett a látogatás süti nélkül számolódik, a belépő oldal megtekintésével
 * együtt; azonosítás ilyenkor sosem megy ki; kikapcsolt kapcsolónál az
 * elutasítóról semmi nem megy ki. A valódi komponenseket rendereli a layout
 * sorrendjében, csak az SDK és a Next router mockolt.
 *
 * Az SDK-mock a posthog-js 1.430.3 mért döntését utánozza (consent.js
 * `isOptedOut`/`isRejected`, posthog-core.js `is_capturing`): elutasított
 * állapotban `cookieless_mode: 'on_reject'` mellett az esemény süti nélkül
 * megy ki, nélküle eldobódik; a még döntés nélküli SDK-t a
 * `opt_out_capturing_by_default` teszi elutasítottá.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let pathname = '/kurzusok/kez'

function nav(path: string): void {
  pathname = path
  window.history.replaceState(null, '', path)
}

const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

type Mod = 'suti' | 'suti-nelkul'

const sdk = vi.hoisted(() => ({
  /** Az SDK tárolt hozzájárulása (a posthog-js saját jele). */
  stored: 'pending' as 'pending' | 'in' | 'out',
  options: {} as Record<string, unknown>,
  delivered: [] as Array<[string, Mod]>,
  identified: [] as string[],
}))

function optedOut(): boolean {
  return (
    sdk.stored === 'out' ||
    (sdk.stored === 'pending' && sdk.options.opt_out_capturing_by_default === true)
  )
}

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn((_key: string, options: Record<string, unknown>) => {
      sdk.options = options
    }),
    capture: vi.fn((event: string) => {
      if (!optedOut()) {
        sdk.delivered.push([event, 'suti'])
      } else if (sdk.options.cookieless_mode === 'on_reject') {
        sdk.delivered.push([event, 'suti-nelkul'])
      }
    }),
    has_opted_out_capturing: () => optedOut(),
    opt_in_capturing: vi.fn(() => {
      sdk.stored = 'in'
    }),
    opt_out_capturing: vi.fn(() => {
      sdk.stored = 'out'
    }),
    identify: vi.fn((id: string) => {
      if (!optedOut()) {
        sdk.identified.push(id)
      }
    }),
    reset: vi.fn(),
  },
}))

vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'DUMMY-posthog-teszt-kulcs')

const posthog = (await import('posthog-js')).default as unknown as {
  init: ReturnType<typeof vi.fn>
  opt_out_capturing: ReturnType<typeof vi.fn>
}
const { CONSENT_STORAGE_KEY, optInToAnalytics, optOutOfAnalytics, resetPostHogForTests } =
  await import('@/lib/analytics/posthog')
const { PostHogProvider } = await import('@/components/analytics/PostHogProvider')
const { PostHogPageView } = await import('@/components/analytics/PostHogPageView')
const { IdentifyUser } = await import('@/components/analytics/IdentifyUser')

let root: Root
let container: HTMLElement

function renderPage(): void {
  act(() => {
    root.render(
      createElement(
        PostHogProvider,
        null,
        createElement(PostHogPageView),
        createElement(IdentifyUser, { userId: 42 }),
      ),
    )
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  resetPostHogForTests()
  posthog.init.mockClear()
  posthog.opt_out_capturing.mockClear()
  sdk.stored = 'pending'
  sdk.options = {}
  sdk.delivered = []
  sdk.identified = []
  window.localStorage.clear()
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_COOKIELESS', 'true')
  nav('/kurzusok/kez')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_COOKIELESS', '')
})

describe('PostHog süti nélküli mérés elutasítás után', () => {
  it('tárolt elutasítással a belépő oldal süti nélkül számolódik, azonosítás nélkül', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')

    renderPage()
    await settle()

    expect(posthog.init).toHaveBeenCalledTimes(1)
    expect(sdk.options).toMatchObject({
      cookieless_mode: 'on_reject',
      opt_out_capturing_by_default: true,
    })
    expect(sdk.delivered).toEqual([['$pageview', 'suti-nelkul']])
    expect(sdk.identified).toEqual([])
    // Tárolt SDK-jel nélkül az SDK-t nem kapcsoljuk ki külön: az a gépre írna.
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled()
  })

  it('első látogatáskor a banner-elutasítás után a belépő oldal egyszer, süti nélkül számolódik', async () => {
    renderPage()
    await settle()
    expect(posthog.init).not.toHaveBeenCalled()
    expect(sdk.delivered).toEqual([])

    act(() => optOutOfAnalytics())
    await settle()

    expect(sdk.delivered).toEqual([['$pageview', 'suti-nelkul']])
    expect(sdk.identified).toEqual([])
  })

  it('egy korábbi elfogadás tárolt SDK-jele mellett az SDK süti nélküli módba vált', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    sdk.stored = 'in'

    renderPage()
    await settle()

    expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1)
    expect(sdk.delivered).toEqual([['$pageview', 'suti-nelkul']])
  })

  it('a lapon belüli későbbi elfogadás után sütivel mér, és az azonosítás is átmegy', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    renderPage()
    await settle()

    act(() => optInToAnalytics())
    await settle()
    nav('/kurzusok/masik')
    renderPage()
    await settle()

    expect(sdk.delivered).toEqual([
      ['$pageview', 'suti-nelkul'],
      ['$pageview', 'suti'],
    ])
    expect(sdk.identified).toEqual(['42'])
  })

  it('a böngésző tiltakozó jelzésével (GPC) az elutasítóról süti nélkül sem megy ki semmi', async () => {
    Object.defineProperty(window.navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
    })
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')

    try {
      renderPage()
      await settle()
      act(() => optOutOfAnalytics())
      await settle()
    } finally {
      Reflect.deleteProperty(window.navigator, 'globalPrivacyControl')
    }

    expect(posthog.init).not.toHaveBeenCalled()
    expect(sdk.delivered).toEqual([])
  })

  it('kikapcsolt süti nélküli méréssel az elutasítóról semmi nem megy ki', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_COOKIELESS', '')
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')

    renderPage()
    await settle()
    act(() => optOutOfAnalytics())
    await settle()

    expect(posthog.init).not.toHaveBeenCalled()
    expect(sdk.delivered).toEqual([])
  })
})
