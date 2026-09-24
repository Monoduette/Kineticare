'use client'

import { useEffect } from 'react'

import { trackContentView, type BarionCourseInput } from '@/lib/analytics/barion-events'
import { trackMetaViewContent } from '@/lib/analytics/meta-events'

/**
 * CourseBarionView — a kurzus-oldal Barion Pixel `contentView` eseménye.
 * A kurzusoldal a Barion tölcsérének TERMÉKOLDALA, ezért az esemény
 * `contentType: 'Product'` ágon megy ki, a hozzá tartozó KÖTELEZŐ mezőkkel
 * (unitPrice, unit, currency, quantity) — a `list: 'ProductPage'` pedig
 * megmondja a Barionnak, honnan indult a látogatás. A törzs összeállítása és
 * a mezők szerződése a `src/lib/analytics/barion-events.ts` modulban él
 */
export interface CourseBarionViewProps {
  course: BarionCourseInput
}

export function CourseBarionView({ course }: CourseBarionViewProps): null {
  const { id, name, priceHuf, category, imageUrl } = course
  useEffect(() => {
    trackContentView(
      {
        id,
        name,
        priceHuf,
        quantity: 1,
        ...(category !== undefined && category !== null ? { category } : {}),
        ...(imageUrl !== undefined && imageUrl !== null ? { imageUrl } : {}),
      },
      { list: 'ProductPage' },
    )
    trackMetaViewContent({ id, priceHuf })
    // A mount-egyszeri küldés a cél: útvonalváltásnál a komponens újra mountol,
    // ugyanazon az oldalon maradva viszont nem küldünk újabb megtekintést.
  }, [id, name, priceHuf, category, imageUrl])
  return null
}
