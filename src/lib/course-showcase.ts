/**
 * Kurzus-galéria (Astra „Bring ideas” szerkezet) — tiszta, DB nélkül tesztelhető.
 *
 * A két audience-sáv (Otthoni / Szakembereknek) a kártya kickerében marad,
 * nem külön szekciócím. A borító hiányánál a csapatportrék lépnek be, index
 * szerint, hogy a háromhasábos rács ne legyen üres keret.
 */

export const COURSE_SHOWCASE_MARK = 'Kurzusaink'

export const COURSE_SHOWCASE_HEADING = 'A kezed, lépésről lépésre.'

export const COURSE_SHOWCASE_LEAD =
  'Online kézrehabilitációs kurzusok otthon és szakembereknek, egy kínálatban. Ár minden kártyán.'

export interface CourseShowcaseFallbackImage {
  src: string
  width: number
  height: number
}

/**
 * A public/media/team fájlok — sorrend: két portré, majd közös munka.
 * Az alt üres: a kártya egésze link, a kép dekoratív (ProductCard mintája).
 */
export const COURSE_SHOWCASE_FALLBACKS: readonly CourseShowcaseFallbackImage[] = [
  {
    src: '/media/team/portrait-seated-ball-a-portrait-1600.webp',
    width: 1600,
    height: 2000,
  },
  {
    src: '/media/team/portrait-seated-ball-b-portrait-1600.webp',
    width: 1600,
    height: 2000,
  },
  {
    src: '/media/team/founders-working-laptop-1600.webp',
    width: 1600,
    height: 2400,
  },
]

/**
 * A „Kurzusaink” vízjel körüli három döntött csapatfotó (a galéria alatti
 * jelenet). Sorrend = a CSS `__photo--0/1/2` helye: bal, közép, jobb.
 */
export const COURSE_SHOWCASE_DRIFT: readonly CourseShowcaseFallbackImage[] = [
  {
    src: '/media/team/founders-shared-laugh-1600.webp',
    width: 1600,
    height: 1006,
  },
  {
    src: '/media/team/hand-treatment-detail-1600.webp',
    width: 1600,
    height: 2400,
  },
  {
    src: '/media/team/founders-intro-white-1600.webp',
    width: 1600,
    height: 1067,
  },
]

export function showcaseFallbackAt(index: number): CourseShowcaseFallbackImage {
  const image = COURSE_SHOWCASE_FALLBACKS[index % COURSE_SHOWCASE_FALLBACKS.length]
  if (image === undefined) {
    return COURSE_SHOWCASE_FALLBACKS[0]
  }
  return image
}

/**
 * Astra-címforma: „A place, imagined.” — az első vessző utáni tag dőlt.
 * Vessző nélkül a teljes cím a főág.
 */
export function splitEditorialTitle(title: string): { head: string; tail: string | null } {
  const trimmed = title.trim()
  const comma = trimmed.indexOf(',')
  if (comma <= 0 || comma >= trimmed.length - 1) {
    return { head: trimmed, tail: null }
  }
  const head = trimmed.slice(0, comma + 1)
  const tail = trimmed.slice(comma + 1).trim()
  if (tail.length === 0) {
    return { head: trimmed, tail: null }
  }
  return { head, tail }
}
