import type { FieldHook, TextField } from 'payload'

import { duplicateSlugBeforeDuplicate } from '../lib/duplicate'
import { slugify } from '../lib/slugify'

/**
 * A slugot a `sourceField` (alapból a title) értékéből generálja, ha az üres.
 * Ha a szerkesztő kézzel ad meg slugot, azt nem írja felül: szerkeszthető marad.
 */
const generateFromTitle =
  (sourceField: string): FieldHook =>
  ({ data, value }) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      return slugify(value)
    }
    const source = data?.[sourceField]
    if (typeof source === 'string' && source.trim().length > 0) {
      return slugify(source)
    }
    return value
  }

/** A Webcím mező alapleírása (minden gyűjteményben). */
export const WEBCIM_LEIRAS =
  'A lap linkjének vége, pl. a kineticare.hu/rolunk címben a „rolunk”. A címből magától kitöltődik, ékezetek nélkül, kötőjelekkel. Ha átírod, a régi link nem működik tovább.'

/**
 * Egy mondat a kódhoz kötött webcímekről (modul-térkép H48). Csak ott áll,
 * ahol a mező alatt tényleg ott a KotottWebcimNotice (Oldalak,
 * Blogbejegyzések); a kategóriák webcímét nem ez a doboz figyeli.
 */
export const KOTOTT_WEBCIM_UTALAS =
  'Ha a weboldal kódja erre a webcímre épít, ezt a mező alatti doboz jelzi.'

export interface SlugFieldOpciok {
  /** A leírás kiegészül a kötött webcímekre utaló mondattal. */
  kotottWebcimJelzes?: boolean
}

export const slugField = (sourceField = 'title', opciok: SlugFieldOpciok = {}): TextField => ({
  name: 'slug',
  type: 'text',
  required: true,
  unique: true,
  label: 'Webcím',
  admin: {
    description: opciok.kotottWebcimJelzes
      ? `${WEBCIM_LEIRAS} ${KOTOTT_WEBCIM_UTALAS}`
      : WEBCIM_LEIRAS,
  },
  hooks: {
    beforeValidate: [generateFromTitle(sourceField)],
    // Duplikáláskor (beépített duplicate-folyamat) egyedi
    // '<eredeti>-masodpeldany' slugot ad, lásd src/lib/duplicate.ts.
    beforeDuplicate: [duplicateSlugBeforeDuplicate],
  },
})
