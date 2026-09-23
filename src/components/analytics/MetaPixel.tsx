'use client'

import { usePathname, useSearchParams } from 'next/navigation'
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
 * - SPA-navigációnál (a csak query-váltást is beleértve, pl. `?termek=`)
 *   PageView megy ki; az első oldalét az indulás küldi. Jegyes címen semmi.
 * - A useSearchParams miatt a szülőben <Suspense>-be kerül (Next build-szabály).
 */
export function MetaPixel(): null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams?.toString() ?? ''
  const location = pathname ? (query ? `${pathname}?${query}` : pathname) : null
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
    if (!isMetaPixelConfigured() || location === null) {
      return
    }
    if (lastPath.current === null) {
      // Az első oldal PageView-ját az indulás (enableMetaPixel) küldi.
      lastPath.current = location
      return
    }
    if (lastPath.current === location) {
      return
    }
    lastPath.current = location
    trackMetaPageView()
  }, [location])

  return null
}
