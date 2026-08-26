'use client'

import { useEffect, type ReactNode } from 'react'

import { consentStateFromEvent, readConsent } from '@/lib/analytics/consent'
import {
  CONSENT_EVENT,
  disableAnalyticsCapture,
  enableAnalyticsCapture,
  initPostHog,
  isPostHogConfigured,
} from '@/lib/analytics/posthog'

/**
 * PostHogProvider — a PostHog kliensoldali inicializálásának kapuja.
 * - Kulcs nélkül: tiszta pass-through (az analitika kikapcsolt, a felület
 * ettől függetlenül működik).
 * - CONSENT-FIRST: csak analytics-hozzájárulás esetén init; a ConsentBanner
 * 'kc:analytics-consent' eseményére oldalfrissítés nélkül bekapcsol
 * ('granted' → init, vagy opt_in, ha már volt init), 'denied'-re pedig
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!isPostHogConfigured()) {
      return
    }
    // Betöltéskor: csak tárolt 'granted' consenttel init (a kapu a posthog.ts-ben).
    initPostHog()

    const onConsent = (event: Event): void => {
      // A detail hordozza az állapotot; hiányában a tárolóból olvassuk újra.
      const state = consentStateFromEvent(event)
      const effective = state === 'unknown' ? readConsent() : state
      if (effective === 'granted') {
        enableAnalyticsCapture()
      } else if (effective === 'denied') {
        disableAnalyticsCapture()
      }
    }
    window.addEventListener(CONSENT_EVENT, onConsent)
    return () => window.removeEventListener(CONSENT_EVENT, onConsent)
  }, [])

  return <>{children}</>
}
