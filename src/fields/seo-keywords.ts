import type { ArrayField } from 'payload'

import { SEO_KEYWORDS_MAX_LENGTH, SEO_KEYWORDS_MAX_ROWS } from '../lib/seo-keywords'

/**
 * Szerkeszthető SEO-kulcsszómező a `posts`, a `pages` és a `products` kollekcióhoz.
 *
 * Szándékosan gyökérszintű (nem `seo.` csoportba ágyazott): a meglévő
 * `seoTitle` / `seoDescription` útvonala ne változzon. A szerkesztő a
 * SEO-cím és a SEO-leírás után látja. A nyilvános lapon a mező NEM
 * jelenik meg külön listaként — csak a forráskódba (JSON-LD + meta) megy.
 */
export const seoKeywordsField: ArrayField = {
  name: 'seoKeywords',
  type: 'array',
  maxRows: SEO_KEYWORDS_MAX_ROWS,
  label: 'SEO kulcsszavak',
  labels: { singular: 'Kifejezés', plural: 'Kifejezések' },
  admin: {
    description:
      'Keresőszavak és hosszabb kifejezések; később bővíthető. A forráskódba mennek, a lapon nem látszanak külön listaként.',
  },
  fields: [
    {
      name: 'phrase',
      type: 'text',
      required: true,
      maxLength: SEO_KEYWORDS_MAX_LENGTH,
      label: 'Kifejezés',
    },
  ],
}
