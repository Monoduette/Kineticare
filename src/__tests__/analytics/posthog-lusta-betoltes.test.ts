// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A PostHog SDK LUSTA betöltésének szerződése (2026-10-16, a mobil halott
 * kattintások javítása, src/lib/analytics/posthog.ts).
 *
 * A `posthog-js` a főoldal legnagyobb JS-csomagja volt, és minden látogatónál
 * a hidratálás előtt futott, hozzájárulás nélkül is. Most csak hozzájárulás
 * után töltődik be, dinamikus `import()`-tal. Három hihető regressziót fog:
 *  1. valaki visszateszi a statikus importot: az SDK hozzájárulás nélkül is
 *     betöltődik (a mock gyára az import pillanatában fut, ezt számoljuk);
 *  2. a betöltés alatt küldött esemény (például egy koppintásra küldött
 *     `checkout_started`) elvész, mert a kliens még nincs kész;
 *  3. a betöltés alatt visszavont hozzájárulás után az SDK mégis elindul, és
 *     a várakozó esemény kimegy.
 */

const sdk = vi.hoisted(() => ({
  betoltve: 0,
  init: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('posthog-js', () => {
  sdk.betoltve += 1
  return {
    default: {
      init: sdk.init,
      capture: sdk.capture,
      has_opted_out_capturing: () => false,
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
    },
  }
})

// A kulcsot a posthog-config modul betöltéskor olvassa, ezért az import előtt.
vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'DUMMY-posthog-teszt-kulcs')

const {
  CONSENT_STORAGE_KEY,
  captureAnalyticsEvent,
  initPostHog,
  optInToAnalytics,
  optOutOfAnalytics,
  resetPostHogForTests,
} = await import('@/lib/analytics/posthog')

/** A dinamikus import és az init lépése egy makrotaszkon belül lezajlik. */
const kivar = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetPostHogForTests()
  sdk.init.mockClear()
  sdk.capture.mockClear()
  window.localStorage.clear()
})

describe('PostHog SDK: lusta betöltés', () => {
  it('hozzájárulás nélkül az SDK le sem töltődik; elfogadás után egyszer betöltődik és elindul', async () => {
    expect(initPostHog()).toBe(false)
    captureAnalyticsEvent('course_viewed', { courseId: 7 })
    await kivar()
    expect(sdk.betoltve).toBe(0)

    optInToAnalytics()
    await kivar()
    expect(sdk.betoltve).toBe(1)
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })

  it('a betöltés alatt küldött esemény az SDK megérkezése után egyszer kimegy', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    expect(initPostHog()).toBe(true)
    captureAnalyticsEvent('checkout_started', { productId: 3 })
    expect(sdk.capture).not.toHaveBeenCalled()

    await kivar()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.capture).toHaveBeenCalledTimes(1)
    expect(sdk.capture).toHaveBeenCalledWith('checkout_started', { productId: 3 })
  })

  it('a betöltés alatt visszavont hozzájárulás után az SDK nem indul el, és semmi nem megy ki', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    initPostHog()
    captureAnalyticsEvent('checkout_started', { productId: 3 })
    optOutOfAnalytics()

    await kivar()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.capture).not.toHaveBeenCalled()
  })
})
