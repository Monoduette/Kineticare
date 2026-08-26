'use client'

import { useEffect } from 'react'

import { CONSENT_EVENT, consentStateFromEvent, readConsent } from '@/lib/analytics/consent'
import { applyConsentToGoogleAnalytics, isGoogleAnalyticsConfigured } from '@/lib/analytics/ga4'

/**
 * GoogleAnalytics — a gtag.js consent-kapuja (a PostHogProvider párja).
 * - Mérési azonosító nélkül: teljes no-op (semmi nem töltődik be).
 * - CONSENT-FIRST: betöltéskor a TÁROLT döntés számít ('granted' → gtag.js
 * betöltés, 'denied' → leállító kapcsoló, 'unknown' → semmi), utána a
 * ConsentBanner 'kc:analytics-consent' eseménye kapcsol be/ki
 * oldalfrissítés nélkül.
 */
export function GoogleAnalytics(): null {
  useEffect(() => {
    if (!isGoogleAnalyticsConfigured()) {
      return
    }
    applyConsentToGoogleAnalytics(readConsent())

    const onConsent = (event: Event): void => {
      // A detail hordozza az állapotot; hiányában a tárolóból olvassuk újra.
      const state = consentStateFromEvent(event)
      applyConsentToGoogleAnalytics(state === 'unknown' ? readConsent() : state)
    }
    window.addEventListener(CONSENT_EVENT, onConsent)
    return () => window.removeEventListener(CONSENT_EVENT, onConsent)
  }, [])

  return null
}
