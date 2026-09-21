import type { CoursePromo } from '../../../lib/course-promo'
import { promoLastDayLabel } from '../../../lib/course-promo'

/**
 * Az akció utolsó napjának két alakja az akciós kurzusoldalhoz.
 *
 * - `promoUntilLabel`: a látogatónak szóló, ragozott alak („szeptember
 *   30-ig"). A `promoLastDayLabel` a hu-HU dátumformátum szerint ponttal
 *   zárja a napot („szeptember 30."), a toldalék elé a pont nem való (AkH.
 *   12. kiadás, 297.: a számmal írt nap után a kötőjeles toldalék a pont
 *   nélküli alakhoz járul).
 * - `promoLastDayIso`: a strukturált adat `priceValidUntil` mezője
 *   (schema.org Offer, ISO 8601 dátum, https://schema.org/priceValidUntil),
 *   Budapest szerinti utolsó napra számolva, hogy a látható „…-ig" és a gépi
 *   olvasónak adott dátum ugyanaz a nap legyen.
 */
export function promoUntilLabel(promo: Pick<CoursePromo, 'end'>): string | null {
  const lastDay = promoLastDayLabel(promo)
  if (lastDay === null) {
    return null
  }
  return `${lastDay.replace(/\.$/, '')}-ig`
}

export function promoLastDayIso(promo: Pick<CoursePromo, 'end'>): string | null {
  if (promo.end === null) {
    return null
  }
  const lastDay = new Date(promo.end.getTime() - 1)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(lastDay)
}
