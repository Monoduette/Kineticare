/**
 * E-E-A-T kapu a két ÚJ Tudástár-posztra.
 *
 * A hat élő cikk `author`/`faq` mintáját nem backfill-eljük, és nem noindexeljük.
 * Csak `inhuvelygyulladas` és `befagyott-vall` kap noindexet, ha a Person
 * author vagy a faq tömb üres. Collection-szintű noindex mező nincs.
 */

export const UJ_TUDASTAR_SLUGOK = ['inhuvelygyulladas', 'befagyott-vall'] as const

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
    if (typeof rec.name === 'string' && rec.name.trim().length > 0) return true
    if (typeof rec.id === 'number' && rec.id > 0) return true
  }
  return false
}

function vanGyik(faq: unknown): boolean {
  return Array.isArray(faq) && faq.length >= 2
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
