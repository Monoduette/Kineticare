'use client'

import { useEffect } from 'react'

import {
  captureAnalyticsEvent,
  whenPostHogReady,
  type AnalyticsEventName,
} from '@/lib/analytics/posthog'

/**
 * TrackEvent — mount-idejű üzleti esemény (funnel-lépések).
 *
 * Szerver-komponens oldalakba ágyazható (kliens-komponensként renderel):
 * a mount = az esemény bekövetkezése (pl. a kurzus-oldal megnyitása =
 * course_viewed; a pénztár megnyitása = checkout_started). No-op, ha az
 * analitika nincs konfigurálva vagy nincs hozzájárulás.
 */
export interface TrackEventProps {
  event: AnalyticsEventName
  properties?: Record<string, unknown>
}

export function TrackEvent({ event, properties }: TrackEventProps): null {
  // Tartalom szerinti függőség: a szerver-oldal minden rendernél új objektumot
  // ad, de esemény csak akkor megy újra, ha a tartalma változik. Ha a látogató
  // kurzusról kurzusra lép, a Next ugyanazt a komponenst rendereli újra, és a
  // második kurzus courseId-jével is kell course_viewed.
  const serialized = JSON.stringify(properties ?? null)
  useEffect(() => {
    const parsed = JSON.parse(serialized) as Record<string, unknown> | null
    // Az első betöltéskor ez az effect a PostHogProvider initje ELŐTT fut,
    // ezért az init utánra vár (lásd whenPostHogReady).
    return whenPostHogReady(() => captureAnalyticsEvent(event, parsed ?? undefined))
  }, [event, serialized])
  return null
}
