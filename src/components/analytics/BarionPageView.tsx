'use client'

import { useEffect } from 'react'

import { trackPageView, type BarionList } from '@/lib/analytics/barion-events'

/**
 * BarionPageView — a NEM termék oldalak Barion Pixel `contentView` eseménye.
 * és a kurzus-oldal (`/kurzusok/[slug]`) SZÁNDÉKOSAN kimarad belőle. Ezt
 */
export interface BarionPageViewProps {
  /** Rövid, útvonaltól független azonosító (pl. `'kezdolap'`). */
  pageId: string
  /** A magyar, emberi oldalnév (pl. `'Kezdőlap'`). */
  pageName: string
  /** Csak akkor, ha a bp.js kötött listájából van ráillő érték. */
  list?: BarionList
}

export function BarionPageView({ pageId, pageName, list }: BarionPageViewProps): null {
  useEffect(() => {
    trackPageView({
      id: pageId,
      name: pageName,
      ...(list !== undefined ? { list } : {}),
    })
    // Mount-egyszeri küldés: útvonalváltásnál a komponens újra mountol (új
    // oldal = új megtekintés), ugyanazon az oldalon maradva viszont nem.
  }, [pageId, pageName, list])
  return null
}
