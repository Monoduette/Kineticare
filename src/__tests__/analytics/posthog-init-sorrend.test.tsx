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
// A Next useSearchParams-a navigációig ugyanazt az objektumot adja.
const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}))

// A kulcsot a posthog-config modul betöltéskor olvassa, ezért az import előtt.
vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'DUMMY-posthog-teszt-kulcs')

const posthog = (await import('posthog-js')).default as unknown as {
  init: ReturnType<typeof vi.fn>
  capture: ReturnType<typeof vi.fn>
}
const { CONSENT_STORAGE_KEY, optInToAnalytics, resetPostHogForTests } =
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
  return posthog.capture.mock.calls as Array<[string, Record<string, unknown> | undefined]>
}

beforeEach(() => {
  resetPostHogForTests()
  posthog.init.mockReset()
  posthog.capture.mockReset()
  window.localStorage.clear()
  pathname = '/kurzusok/kez'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('PostHog init-sorrend: a korai capture nem vész el', () => {
  it('tárolt hozzájárulással a hideg betöltés első $pageview-ja és course_viewed-je kimegy, egyszer', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')

    renderPage(7)

    expect(posthog.init).toHaveBeenCalledTimes(1)
    expect(captured()).toEqual([
      ['$pageview', { $current_url: '/kurzusok/kez' }],
      ['course_viewed', { courseId: 7 }],
    ])
  })

  it('hozzájárulás nélkül semmi nem megy ki; a banner-elfogadás után az aktuális oldal eseményei igen', () => {
    renderPage(7)
    expect(posthog.init).not.toHaveBeenCalled()
    expect(captured()).toEqual([])

    act(() => optInToAnalytics())

    expect(captured()).toEqual([
      ['$pageview', { $current_url: '/kurzusok/kez' }],
      ['course_viewed', { courseId: 7 }],
    ])
  })

  it('hozzájárulás előtt elhagyott oldal eseménye nem megy ki utólag', () => {
    renderPage(7)
    pathname = '/kurzusok/masik'
    renderPage(8)

    act(() => optInToAnalytics())

    expect(captured()).toEqual([
      ['$pageview', { $current_url: '/kurzusok/masik' }],
      ['course_viewed', { courseId: 8 }],
    ])
  })

  it('kurzusról kurzusra lépve (ugyanaz a komponens) az új courseId-vel is kimegy a course_viewed', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    renderPage(7)
    posthog.capture.mockReset()

    pathname = '/kurzusok/masik'
    renderPage(8)

    expect(captured()).toEqual([
      ['$pageview', { $current_url: '/kurzusok/masik' }],
      ['course_viewed', { courseId: 8 }],
    ])

    posthog.capture.mockReset()
    renderPage(8)
    expect(captured()).toEqual([])
  })
})
