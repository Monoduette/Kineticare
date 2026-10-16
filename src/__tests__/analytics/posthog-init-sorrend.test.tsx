// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REGRESSZIÓ: az első oldalmegtekintés és a mount-idejű funnel-esemény nem
 * veszhet el az init előtt.
 *
 * A layout így ágyaz: <PostHogProvider><PostHogPageView /></PostHogProvider>,
 * az oldal pedig <TrackEvent />-et renderel. A React a gyerek effectjét a
 * szülőé ELŐTT futtatja, ezért a capture az init előtt futott, és no-op volt:
 * minden hideg betöltés első $pageview-ja és course_viewed / checkout_started
 * eseménye elveszett. Ugyanez történt, ha a látogató a bannerben, az oldalon
 * belül adott hozzájárulást. A teszt a valódi komponenseket rendereli a
 * layout sorrendjében; csak a posthog-js SDK és a Next router mockolt.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let pathname = '/kurzusok/kez'

/** Navigáció: a Next útvonala és a böngésző címe együtt változik. */
function nav(path: string): void {
  pathname = path
  window.history.replaceState(null, '', path)
}

/**
 * Az SDK betöltése alatt sorba állított esemény a keletkezési oldalát viszi
 * (posthog.ts, originProperties); a közvetlenül küldött nem, azt az SDK maga
 * olvassa a címből.
 */
function keletkezes(path: string): Record<string, string> {
  return { $current_url: `${window.location.origin}${path}`, $pathname: path }
}

// A Next useSearchParams-a navigációig ugyanazt az objektumot adja.
const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

// Az SDK tartósan tárolt opt-out állapota: opt-out alatt a posthog-js a
// capture-t eldobja, ezért a teszt csak az akkor kézbesített eseményeket látja.
const sdk = vi.hoisted(() => ({
  optedOut: false,
  delivered: [] as Array<[string, Record<string, unknown> | undefined]>,
}))

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn((event: string, properties?: Record<string, unknown>) => {
      if (!sdk.optedOut) {
        sdk.delivered.push([event, properties])
      }
    }),
    has_opted_out_capturing: () => sdk.optedOut,
    opt_in_capturing: vi.fn(() => {
      sdk.optedOut = false
    }),
    opt_out_capturing: vi.fn(() => {
      sdk.optedOut = true
    }),
  },
}))

// A kulcsot a posthog-config modul betöltéskor olvassa, ezért az import előtt.
vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'DUMMY-posthog-teszt-kulcs')

const posthog = (await import('posthog-js')).default as unknown as {
  init: ReturnType<typeof vi.fn>
}
const { CONSENT_STORAGE_KEY, optInToAnalytics, optOutOfAnalytics, resetPostHogForTests } =
  await import('@/lib/analytics/posthog')
const { PostHogProvider } = await import('@/components/analytics/PostHogProvider')
const { PostHogPageView } = await import('@/components/analytics/PostHogPageView')
const { TrackEvent } = await import('@/components/analytics/TrackEvent')

let root: Root
let container: HTMLElement

function renderPage(courseId: number): void {
  act(() => {
    root.render(
      createElement(
        PostHogProvider,
        null,
        createElement(PostHogPageView),
        createElement(TrackEvent, { event: 'course_viewed', properties: { courseId } }),
      ),
    )
  })
}

function captured(): Array<[string, Record<string, unknown> | undefined]> {
  return sdk.delivered
}

/**
 * Az SDK 2026-10-16 óta lustán, dinamikus `import()`-tal érkezik (posthog.ts):
 * az init és a várakozó események kézbesítése egy aszinkron lépés után fut.
 * Ez a segéd kivárja a lépést, mielőtt a teszt a kézbesítést vizsgálja.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  resetPostHogForTests()
  posthog.init.mockReset()
  sdk.optedOut = false
  sdk.delivered = []
  window.localStorage.clear()
  nav('/kurzusok/kez')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('PostHog init-sorrend: a korai capture nem vész el', () => {
  it('tárolt hozzájárulással a hideg betöltés első $pageview-ja és course_viewed-je kimegy, egyszer', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')

    renderPage(7)
    await settle()

    expect(posthog.init).toHaveBeenCalledTimes(1)
    expect(captured()).toEqual([
      ['$pageview', { ...keletkezes('/kurzusok/kez'), $current_url: '/kurzusok/kez' }],
      ['course_viewed', { ...keletkezes('/kurzusok/kez'), courseId: 7 }],
    ])
  })

  it('hozzájárulás nélkül semmi nem megy ki; a banner-elfogadás után az aktuális oldal eseményei igen', async () => {
    renderPage(7)
    await settle()
    expect(posthog.init).not.toHaveBeenCalled()
    expect(captured()).toEqual([])

    act(() => optInToAnalytics())
    await settle()

    expect(captured()).toEqual([
      ['$pageview', { ...keletkezes('/kurzusok/kez'), $current_url: '/kurzusok/kez' }],
      ['course_viewed', { ...keletkezes('/kurzusok/kez'), courseId: 7 }],
    ])
  })

  it('hozzájárulás előtt elhagyott oldal eseménye nem megy ki utólag', async () => {
    renderPage(7)
    nav('/kurzusok/masik')
    renderPage(8)

    act(() => optInToAnalytics())
    await settle()

    expect(captured()).toEqual([
      ['$pageview', { ...keletkezes('/kurzusok/masik'), $current_url: '/kurzusok/masik' }],
      ['course_viewed', { ...keletkezes('/kurzusok/masik'), courseId: 8 }],
    ])
  })

  it('kurzusról kurzusra lépve (ugyanaz a komponens) az új courseId-vel is kimegy a course_viewed', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    renderPage(7)
    await settle()
    sdk.delivered = []

    nav('/kurzusok/masik')
    renderPage(8)

    expect(captured()).toEqual([
      ['$pageview', { $current_url: '/kurzusok/masik' }],
      ['course_viewed', { courseId: 8 }],
    ])

    sdk.delivered = []
    renderPage(8)
    expect(captured()).toEqual([])
  })
  it('korábbi elutasítás után (az SDK tartós opt-outjával) az újra-elfogadáskor is kimegy az aktuális oldal eseménye', async () => {
    // Újratöltés egy korábbi „Elutasítom” után: a tárolt döntés 'denied', az
    // SDK a saját opt-outjával indulna.
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    sdk.optedOut = true
    renderPage(7)
    await settle()
    expect(posthog.init).not.toHaveBeenCalled()

    act(() => optInToAnalytics())
    await settle()

    expect(captured()).toEqual([
      ['$pageview', { ...keletkezes('/kurzusok/kez'), $current_url: '/kurzusok/kez' }],
      ['course_viewed', { ...keletkezes('/kurzusok/kez'), courseId: 7 }],
    ])
  })
  it('ugyanazon látogatáson belül visszavonás, navigáció, újra-elfogadás után az aktuális oldal eseménye kimegy', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    renderPage(7)
    await settle()
    act(() => optOutOfAnalytics())
    sdk.delivered = []

    nav('/kurzusok/masik')
    renderPage(8)
    expect(captured()).toEqual([])

    act(() => optInToAnalytics())

    expect(captured()).toEqual([
      ['$pageview', { $current_url: '/kurzusok/masik' }],
      ['course_viewed', { courseId: 8 }],
    ])
  })
})
