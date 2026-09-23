'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { CONSENT_EVENT, consentStateFromEvent, readConsent } from '@/lib/analytics/consent'
import {
  applyConsentToMetaPixel,
  isMetaPixelConfigured,
  trackMetaPageView,
} from '@/lib/analytics/meta-pixel'

/**
 * MetaPixel — a Meta (Facebook) Pixel consent-kapuja (a GoogleAnalytics párja).
 * - Pixel-azonosító nélkül teljes no-op.
 * - Betöltéskor a TÁROLT döntés számít, utána a ConsentBanner
 *   'kc:analytics-consent' eseménye kapcsol be/ki oldalfrissítés nélkül.
 * - SPA-navigációnál PageView megy ki; az első oldalét az indulás küldi.
 */
export function MetaPixel(): null {
  const pathname = usePathname()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (!isMetaPixelConfigured()) {
      return
    }
    applyConsentToMetaPixel(readConsent())

    const onConsent = (event: Event): void => {
      const state = consentStateFromEvent(event)
      applyConsentToMetaPixel(state === 'unknown' ? readConsent() : state)
    }
    window.addEventListener(CONSENT_EVENT, onConsent)
    return () => window.removeEventListener(CONSENT_EVENT, onConsent)
  }, [])

  useEffect(() => {
    if (!isMetaPixelConfigured() || !pathname) {
      return
    }
    if (lastPath.current === null) {
      // Az első oldal PageView-ját az indulás (enableMetaPixel) küldi.
      lastPath.current = pathname
      return
    }
    if (lastPath.current === pathname) {
      return
    }
    lastPath.current = pathname
    trackMetaPageView()
  }, [pathname])

  return null
}
