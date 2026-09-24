import { trackMetaEvent, type MetaEventParams, type MetaTrackOptions } from './meta-pixel'

/**
 * Meta Pixel üzleti események — a Barion-tölcsér (barion-events.ts) és a
 * lead-mérés (lead-events.ts) pontjain, azokkal PÁRHUZAMOSAN hívva.
 *
 * A `Purchase` SZÁNDÉKOSAN nincs itt: a köszönőoldal címe rendelés- és
 * Barion-fizetésazonosítót hordoz, amit az fbevents.js a Metának küldene
 * (lásd META_BLOCKED_PATH_PREFIXES). A vásárlás Meta-mérésének helye a
 * szerveroldali Conversions API, a megerősített rendelésösszeggel.
 *
 * Csak nem személyes adat megy ki: termék-azonosító, ár, pénznem, a lead
 * forrás-címkéje. A kurzus NEVE szándékosan nem: egészségügyi jellegű
 * terméknévre a Meta hirdetési szabályai érzékenyek, a riportokhoz az
 * azonosító elég.
 */

export const META_CURRENCY = 'HUF'

/** A Meta-eseményhez elég kurzus-adat (a BarionCourseInput részhalmaza). */
export interface MetaCourseInput {
  readonly id: number
  readonly priceHuf: number
  readonly quantity?: number
}

/** Kurzus → esemény-paraméterek; `null`, ha az adat hiányos (ilyenkor nincs küldés). */
export function metaCourseParams(course: MetaCourseInput): MetaEventParams | null {
  const quantity = course.quantity ?? 1
  if (
    !Number.isInteger(course.id) ||
    course.id <= 0 ||
    typeof course.priceHuf !== 'number' ||
    !Number.isFinite(course.priceHuf) ||
    course.priceHuf < 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null
  }
  return {
    content_ids: [String(course.id)],
    content_type: 'product',
    value: course.priceHuf * quantity,
    currency: META_CURRENCY,
    num_items: quantity,
  }
}

function trackCourseEvent(
  event: 'ViewContent' | 'InitiateCheckout',
  course: MetaCourseInput,
  options?: MetaTrackOptions,
): boolean {
  const params = metaCourseParams(course)
  if (params === null) {
    return false
  }
  return trackMetaEvent(event, params, options)
}

/** Kurzusoldal megtekintése. */
export function trackMetaViewContent(course: MetaCourseInput, options?: MetaTrackOptions): boolean {
  return trackCourseEvent('ViewContent', course, options)
}

/** A pénztár megnyitása. */
export function trackMetaInitiateCheckout(
  course: MetaCourseInput,
  options?: MetaTrackOptions,
): boolean {
  return trackCourseEvent('InitiateCheckout', course, options)
}

/** Sikeres lead (időpontkérés, kapcsolat, hírlevél, ingyenes kurzus). */
export function trackMetaLead(forras: string, options?: MetaTrackOptions): boolean {
  return trackMetaEvent('Lead', { content_name: forras }, options)
}
