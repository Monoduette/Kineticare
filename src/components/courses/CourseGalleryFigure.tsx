import type { Media, Product } from '../../payload-types'
import { MediaImage } from '../content/MediaImage'
import { pickMediaUrl } from '../content/media-url'

/**
 * CourseGalleryFigure — a kurzusoldal törzsét megtörő kép a `gallery` mező
 * ELSŐ képéből (WP51, tulajdonosi kör 2026-09-19 az ingyenes SOS kurzusról:
 * „a szövegrészt jó lenne megtörni képpel").
 *
 * HOL: az „A kurzusról" leírás-szakasz UTÁN, a „Hogyan működik?" ELŐTT —
 * ott, ahol a folyószöveg véget ér és a lépéses szakasz kezdődik. A kép így
 * a két, eltérő szerkezetű blokk közti szünet, nem a leírás közepébe ékelt
 * megszakítás (a folyószöveg egy gondolatmenet, a Lexical-törzsbe kívülről
 * nem vágunk bele). A `gallery` mező eddig sehol nem renderelt: az admin
 * „További képek a kurzus oldalára" súgója üres ígéret volt.
 *
 * MIÉRT egy kép, és miért az első: NN/g Photos as Web Content — a tartalmat
 * hordozó, valódi fotó növeli a figyelmet, a töltelék-kép rontja
 * (https://www.nngroup.com/articles/photos-as-web-content/); NN/g „How
 * People Read Online": a hosszú szöveget a pásztázó olvasó vizuális
 * horgonyok mentén tagolja (https://www.nngroup.com/articles/how-people-read-online/).
 * A galéria további képei egyelőre nem jelennek meg (a jump-nav és a lap
 * ritmusa egy képpel mérhető; több kép külön döntés).
 *
 * KÉPARÁNY: 3:2 kivágás (`object-fit: cover`, kurzusok.css) — a kurzus
 * főhasábját tölti ki, a folyószöveg mértékénél szélesebb, tehát a szem
 * tényleg „szünetet" lát. Álló fotó feltöltésnél a felső harmad marad
 * (object-position 50% 30%): fekvő, kezelés közbeni felvétel javasolt.
 * GOV.UK images: alt a Media-n, a kép nem díszként lebeg
 * (https://design-system.service.gov.uk/styles/images/).
 */
export interface CourseGalleryFigureProps {
  product: Pick<Product, 'gallery'>
  sizes?: string
}

/** A galéria első, feloldott (URL-lel bíró) képe, vagy null. */
export function firstGalleryMedia(product: Pick<Product, 'gallery'>): Media | null {
  for (const row of product.gallery ?? []) {
    const image = row?.image
    if (typeof image === 'object' && image !== null && pickMediaUrl(image, 'lg')) {
      return image
    }
  }
  return null
}

export function CourseGalleryFigure({
  product,
  sizes = '(max-width: 899px) 100vw, 60vw',
}: CourseGalleryFigureProps) {
  const media = firstGalleryMedia(product)
  if (media === null) {
    return null
  }
  return (
    <figure className="kc-course-figure">
      <MediaImage media={media} preferredSize="lg" sizes={sizes} />
    </figure>
  )
}
