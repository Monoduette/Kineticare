import type { MediaLike } from '../components/content/media-url'
import { pickMediaUrl } from '../components/content/media-url'

/**
 * Rögzített képhelyek (a kezdőlapi mozgó fotósor négy íve és a „Kurzusaink”
 * jelenet három fotója) feloldása: a CMS-ben kiválasztott kép, vagy ha a hely
 * üres, a beépített fotó.
 *
 * MIÉRT RÖGZÍTETT HELYEK, ÉS NEM SZABAD LISTA. A két elrendezés helyekhez
 * kötött (a fríz 2×2-es rácsa, 900 px alatt az 1. ív elmarad; a jelenet három
 * oszlopa), ezért az admin minden helyet a nevével mutat, és a szerkesztő azt
 * cseréli, amit a lapon lát. NN/g, Memory Recognition and Recall in User
 * Interfaces: „minimize the user's memory load by making elements, actions,
 * and options visible” (https://www.nngroup.com/articles/recognition-and-recall/);
 * GOV.UK Design System, Text input: a súgó azt mondja, amire a felhasználók
 * többségének szüksége van (https://design-system.service.gov.uk/components/text-input/).
 *
 * AZ ÜRES HELY A MAI FOTÓT MUTATJA, így a mezők bevezetése a lapot bájtra nem
 * változtatja meg (az őr: src/__tests__/kep-helyek.test.tsx), a lap pedig sosem
 * marad kép nélkül (NN/g, 10 Usability Heuristics #5, Error prevention:
 * https://www.nngroup.com/articles/ten-usability-heuristics/).
 *
 * A KIVÁGÁS A KÉP FÓKUSZPONTJA (Media `focalX`/`focalY`, százalék): a
 * szerkesztő a Képek közt egyszer állítja be, és minden `object-fit: cover`
 * kivágásnál az a pont marad bent (Payload, Uploads: „focalPoint”,
 * https://payloadcms.com/docs/upload/overview; W3C CSS Images 3,
 * object-position: https://www.w3.org/TR/css-images-3/#the-object-position).
 */

/** A CMS-kép a sablonhoz szükséges mezőivel (a Media dokumentum része). */
export type KepHelyMedia = MediaLike & {
  focalX?: number | null
  focalY?: number | null
}

/** Egy hely feloldása: vagy a CMS-kép, vagy `null` (a beépített fotó marad). */
export function kepHelyMedia(ertek: unknown): KepHelyMedia | null {
  if (typeof ertek !== 'object' || ertek === null || Array.isArray(ertek)) {
    return null
  }
  const media = ertek as KepHelyMedia
  return pickMediaUrl(media, 'md') ? media : null
}

const ervenyesSzazalek = (ertek: unknown): ertek is number =>
  typeof ertek === 'number' && Number.isFinite(ertek) && ertek >= 0 && ertek <= 100

/**
 * A CMS-kép kivágása `object-position` alakban. Fókuszpont nélkül (vagy
 * érvénytelen értéknél) a kép közepe, ahogy a Payload is 50/50-nel tölti ki.
 */
export function fokuszPozicio(media: KepHelyMedia): string {
  const x = ervenyesSzazalek(media.focalX) ? media.focalX : 50
  const y = ervenyesSzazalek(media.focalY) ? media.focalY : 50
  return `${x}% ${y}%`
}
