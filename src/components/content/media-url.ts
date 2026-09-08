/**
 * Media-dokumentum → képforrás segédfüggvények (tiszta, unit-tesztelhető).
 *
 * A Media collection imageSizes-ei (xs 320 / sm 640 / md 1280 / lg 1920 / og
 * 1200×630) alapján választ forrást és épít srcSet-et. A strukturális
 * MediaLike típus szándékosan laza: a feltöltéskori mezők (url/width/height)
 * és a sizes-alréteg is hiányozhat (pl. withoutEnlargement miatt kis képnél
 * nem jön létre minden méret) — a függvények ilyenkor az eredeti képre
 * esnek vissza, sosem dobnak hibát.
 */

export interface MediaSizeInfo {
  url?: string | null
  width?: number | null
  height?: number | null
}

export interface MediaLike {
  url?: string | null
  width?: number | null
  height?: number | null
  alt?: string | null
  sizes?: Record<string, MediaSizeInfo | undefined> | null
}

/** A védett kép közvetlenül, a böngésző sessionjével kérhető le. */
export function isPrivateCourseFileUrl(value: string): boolean {
  try {
    const pathname = new URL(value, 'https://kineticare.invalid').pathname
    return decodeURIComponent(pathname).startsWith('/api/course-files/')
  } catch {
    return false
  }
}

/** A storefront által használt reszponzív méretek sorrendje (og kizárva — az fix arányú meta-kép). */
const RESPONSIVE_SIZE_NAMES = ['xs', 'sm', 'md', 'lg'] as const

/**
 * A legjobb elérhető kép-URL kiválasztása. A preferált méret hiányában a
 * nála nagyobb, majd az eredeti url az eső lánc.
 */
export function pickMediaUrl(media: MediaLike, preferredSize?: string): string | null {
  if (preferredSize) {
    const sized = media.sizes?.[preferredSize]?.url
    if (typeof sized === 'string' && sized.length > 0) {
      return sized
    }
  }
  if (typeof media.url === 'string' && media.url.length > 0) {
    return media.url
  }
  // Utolsó mentsvár: bármelyik elérhető reszponzív méret.
  for (const name of RESPONSIVE_SIZE_NAMES) {
    const url = media.sizes?.[name]?.url
    if (typeof url === 'string' && url.length > 0) {
      return url
    }
  }
  return null
}

/**
 * srcSet-építés az elérhető reszponzív méretekből („url 320w" sorok,
 * növekvő sorrendben). Egyedi URL-ek — azonos URL különböző szélességgel
 * (withoutEnlargement-miatt ismétlődés) csak egyszer szerepel.
 */
export function buildMediaSrcSet(media: MediaLike): string | undefined {
  const entries: Array<{ url: string; width: number }> = []
  for (const name of RESPONSIVE_SIZE_NAMES) {
    const size = media.sizes?.[name]
    const url = size?.url
    const width = size?.width
    if (typeof url === 'string' && url.length > 0 && typeof width === 'number' && width > 0) {
      entries.push({ url, width })
    }
  }
  if (entries.length === 0) {
    return undefined
  }
  const seen = new Set<string>()
  return entries
    .sort((a, b) => a.width - b.width)
    .filter(({ url }) => (seen.has(url) ? false : (seen.add(url), true)))
    .map(({ url, width }) => `${url} ${width}w`)
    .join(', ')
}

/**
 * Intrinsic méretek a next/image-hez: a preferált méret, vagy az eredeti
 * width/height. null, ha semmi sem ismert (ilyenkor a hívó fill-re vált).
 */
export function mediaDimensions(
  media: MediaLike,
  preferredSize?: string,
): { width: number; height: number } | null {
  const sized = preferredSize ? media.sizes?.[preferredSize] : undefined
  if (typeof sized?.width === 'number' && typeof sized?.height === 'number') {
    return { width: sized.width, height: sized.height }
  }
  if (typeof media.width === 'number' && typeof media.height === 'number') {
    return { width: media.width, height: media.height }
  }
  return null
}

/**
 * Alt-szöveg kikényszerítése: a Media collectionben az alt kötelező, de a
 * renderer védőhálót tart — hiányzó alt esetén üres string (dekoratívként
 * kezeli a képernyőolvasó) és a hívó fejlesztői figyelmeztetést adhat.
 */
export function mediaAlt(media: MediaLike): string {
  return typeof media.alt === 'string' ? media.alt : ''
}
