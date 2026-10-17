import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ANALYTICS_EVENTS,
  buildPageViewProperties,
  buildPostHogOptions,
  captureAnalyticsEvent,
  capturePageView,
  CONSENT_STORAGE_KEY,
  hasAnalyticsConsent,
  initPostHog,
  isPostHogConfigured,
  POSTHOG_API_HOST,
  resetPostHogForTests,
} from '../lib/analytics/posthog'

/**
 * PostHog-integráció egységtesztek — a központi konfig, a consent-kapu és a
 * capture no-op viselkedések. A posthog-js singleton mockolt (valódi hálózat
 * és böngésző-API nélkül).
 */

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}))

import posthog from 'posthog-js'

const posthogMock = posthog as unknown as {
  init: ReturnType<typeof vi.fn>
  capture: ReturnType<typeof vi.fn>
}

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return {
    getItem: (key: string) => (key === CONSENT_STORAGE_KEY ? value : null),
  }
}

beforeEach(() => {
  resetPostHogForTests()
  posthogMock.init.mockReset()
  posthogMock.capture.mockReset()
})

describe('isPostHogConfigured / hasAnalyticsConsent', () => {
  it('a munkatérben nincs NEXT_PUBLIC_POSTHOG_KEY → nincs konfigurálva', () => {
    // A NEXT_PUBLIC_* env build-időben kerül a bundle-be; a tesztkörnyezetben üres.
    expect(isPostHogConfigured()).toBe(false)
  })

  it("consent: csak explicit 'granted' jelent hozzájárulást", () => {
    expect(hasAnalyticsConsent(storageWith('granted'))).toBe(true)
    expect(hasAnalyticsConsent(storageWith('denied'))).toBe(false)
    expect(hasAnalyticsConsent(storageWith(null))).toBe(false)
    expect(hasAnalyticsConsent(storageWith('bármi-más'))).toBe(false)
  })

  it('tárolóhiba esetén is false (sosem engedélyezünk vakon)', () => {
    const broken: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('storage tiltva')
      },
    }
    expect(hasAnalyticsConsent(broken)).toBe(false)
  })
})

describe('buildPostHogOptions', () => {
  it('elsőfél-proxy api_host (/ingest), EU ui_host, identified_only person-profil', () => {
    const options = buildPostHogOptions()
    expect(options.api_host).toBe('/ingest')
    expect(POSTHOG_API_HOST).toBe('/ingest')
    expect(options.ui_host).toBe('https://eu.i.posthog.com')
    expect(options.person_profiles).toBe('identified_only')
  })

  it('a $pageview manuális (App Router), a pageleave automatikus', () => {
    const options = buildPostHogOptions()
    expect(options.capture_pageview).toBe(false)
    expect(options.capture_pageleave).toBe(true)
  })

  it('ŐR: a munkamenet-felvétel ki van kapcsolva, az autocapture csak engedélyezőlistával fut, elemszöveg nélkül', () => {
    const options = buildPostHogOptions()
    // Mindkettő a posthog-js-ben ALAPBÓL aktív (a felvételt a projekt-oldali
    // kapcsoló, az autocapture-t a kliens dönti el), ezért a kiírt érték a
    // védelem. Ha valaki törli a sort, a viselkedés némán megfordul.
    expect(options.disable_session_recording).toBe(true)
    // Az autocapture 2026-10-16 óta csak a menü és a `.kc-button` gombok
    // kattintását küldi (tulajdonosi kérés). A posthog-js-ben az üres vagy
    // hiányzó lista MINDENT enged, és az elem szövegét is felküldi, ezért a
    // pontos lista a szerződés: `true`, egy bővebb lista vagy egy elhagyott
    // engedélyezőlista panasz-szöveget is az elemzésbe vihetne.
    expect(options.autocapture).toEqual({
      css_selector_allowlist: [
        '.kc-nav-mobile__toggle',
        '.kc-button',
        '.kc-nav-mobile__link',
        '.kc-nav-mobile__sublink',
      ],
    })
    // A `$dead_click` az engedélyezőlistát nem nézi, bármely elemre jöhet
    // (egy cikk bekezdésére is). Az elem szövegét csak ez tartja vissza.
    expect(options.mask_all_text).toBe(true)
  })
})

describe('initPostHog / capture no-op szabályok', () => {
  it('kulcs nélkül NEM inicializál — a capture bármitől függetlenül no-op', () => {
    expect(initPostHog()).toBe(false)
    expect(posthogMock.init).not.toHaveBeenCalled()

    captureAnalyticsEvent('course_viewed', { courseId: 1 })
    capturePageView('/kurzusok/1')
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('az esemény-nevek a regiszterből jönnek (elgépelés-védelem)', () => {
    expect(ANALYTICS_EVENTS.courseViewed).toBe('course_viewed')
    expect(ANALYTICS_EVENTS.checkoutStarted).toBe('checkout_started')
    expect(ANALYTICS_EVENTS.purchaseConfirmed).toBe('purchase_confirmed')
  })
})

describe('M9 — a $pageview URL-je a capture-határon megtisztítva', () => {
  it('a capture felé készülő payloadból a reset-jegy KIVÁGVA, az utm MEGMARAD', () => {
    // A capturePageView a buildPageViewProperties-en át küld — ez a tiszta
    // függvény a capture-határ tényleges kimenete (a PostHog-kliens ezt kapja).
    expect(
      buildPageViewProperties('/jelszo-visszaallitas?token=DUMMY-JEGY&utm_source=hirlevel'),
    ).toEqual({ $current_url: '/jelszo-visszaallitas?utm_source=hirlevel' })
  })
})

describe('M9 — a before_send minden eseményt a beágyazott értékeivel együtt tisztít', () => {
  const JEGY = 'DUMMY-JEGY'
  const cim = `https://kineticare.hu/jelszo-visszaallitas?token=${JEGY}&utm_source=hirlevel`
  const tiszta = 'https://kineticare.hu/jelszo-visszaallitas?utm_source=hirlevel'

  function kuldes(event: string, properties: Record<string, unknown>): string {
    const beforeSend = buildPostHogOptions().before_send
    if (typeof beforeSend !== 'function') {
      throw new Error('A before_send horog hiányzik')
    }
    const result = beforeSend({ uuid: 'u', event, properties } as Parameters<typeof beforeSend>[0])
    return JSON.stringify(result)
  }

  it('a $$heatmap adatából a címkulcsban álló jegy kivágva, az utm megmarad', () => {
    const kimenet = kuldes('$$heatmap', { $heatmap_data: { [cim]: [{ x: 1, y: 2 }] } })
    expect(kimenet).not.toContain(JEGY)
    expect(kimenet).toContain(JSON.stringify(tiszta))
  })

  it('a $web_vitals beágyazott URL-jeiből a jegy kivágva', () => {
    const kimenet = kuldes('$web_vitals', {
      $web_vitals_LCP_event: {
        name: 'LCP',
        value: 1200,
        $current_url: cim,
        attribution: { url: cim, navigationEntry: { name: cim } },
      },
    })
    expect(kimenet).not.toContain(JEGY)
    expect(kimenet.split(JSON.stringify(tiszta))).toHaveLength(4)
  })

  it('a mélységi korlátnál mélyebb objektum kimarad, nem tisztítatlanul megy ki', () => {
    let melyen: Record<string, unknown> = { url: cim, [cim]: 1 }
    for (let i = 0; i < 12; i += 1) {
      melyen = { n: melyen }
    }
    const kimenet = kuldes('egyedi', { melyen })
    expect(kimenet).not.toContain(JEGY)
  })
})
