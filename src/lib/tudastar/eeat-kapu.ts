/**
 * E-E-A-T / Search GEO kapu a két ÚJ Tudástár-posztra.
 *
 * A hat élő cikk `author=null` / `faq=[]` mintáját nem másoljuk, nem
 * backfill-eljük, és nem noindexeljük. Collection-szintű noindex mező nincs.
 * Organization vagy SITE_NAME szerző = noindex (csak a két új slugra).
 */

import { SITE_NAME } from '../seo'
import { GYIK_MAX, GYIK_MIN } from './faq'

export const UJ_TUDASTAR_SLUGOK = ['inhuvelygyulladas', 'befagyott-vall'] as const

/** A két új cikk indexeléséhez elfogadott Person user-nevek. */
export const UJ_TUDASTAR_SZERZO_NEVEK = ['Kiss Kata', 'Kocsis Kata'] as const

export type UjTudastarSlug = (typeof UJ_TUDASTAR_SLUGOK)[number]

export function ujTudastarSlug(slug: string | null | undefined): slug is UjTudastarSlug {
  return slug === 'inhuvelygyulladas' || slug === 'befagyott-vall'
}

function vanSzerzo(author: unknown): boolean {
  if (author == null || author === '') return false
  if (typeof author === 'number') return author > 0
  if (typeof author === 'object') {
    const rec = author as {
      id?: unknown
      name?: unknown
      collection?: unknown
      type?: unknown
    }
    if (rec.collection === 'organizations' || rec.type === 'Organization') return false
    if (typeof rec.name === 'string') {
      const nev = rec.name.trim()
      if (nev.length === 0 || nev === SITE_NAME) return false
      return (UJ_TUDASTAR_SZERZO_NEVEK as readonly string[]).includes(nev)
    }
    if (typeof rec.id === 'number' && rec.id > 0) return true
  }
  return false
}

function vanGyik(faq: unknown): boolean {
  return Array.isArray(faq) && faq.length >= GYIK_MIN && faq.length <= GYIK_MAX
}

/**
 * True, ha a két új slug egyike, és author vagy faq hiányzik.
 * Minden más slugra (a hat élő poszt is) false.
 */
export function ujTudastarPostNoindex(post: {
  slug?: string | null
  author?: unknown
  faq?: unknown
}): boolean {
  if (!ujTudastarSlug(post.slug)) return false
  return !vanSzerzo(post.author) || !vanGyik(post.faq)
}
