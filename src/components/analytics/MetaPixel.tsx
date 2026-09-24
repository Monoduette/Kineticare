'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import {
  CONSENT_EVENT,
  CONSENT_STORAGE_KEY,
  consentStateFromEvent,
  readConsent,
} from '@/lib/analytics/consent'
import {
  applyConsentToMetaPixel,
  isMetaPixelConfigured,
  trackMetaPageView,
} from '@/lib/analytics/meta-pixel'

/**
 * MetaPixel — a Meta (Facebook) Pixel consent-kapuja (a GoogleAnalytics párja).
 * - Pixel-azonosító nélkül teljes no-op.
 * - Betöltéskor a TÁROLT döntés számít, utána a ConsentBanner
 *   'kc:analytics-consent' eseménye kapcsol be/ki oldalfrissítés nélkül,
 *   a másik lapon hozott döntést pedig a `storage` esemény hozza át.
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
    // Másik lapon hozott döntés: a tároló változik, a saját esemény nem jön át.
    const onStorage = (event: StorageEvent): void => {
      if (event.key === CONSENT_STORAGE_KEY || event.key === null) {
        applyConsentToMetaPixel(readConsent())
      }
    }
    window.addEventListener(CONSENT_EVENT, onConsent)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CONSENT_EVENT, onConsent)
      window.removeEventListener('storage', onStorage)
    }
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
