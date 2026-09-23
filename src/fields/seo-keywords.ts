import type { ArrayField } from 'payload'

import { SEO_KEYWORDS_MAX_LENGTH, SEO_KEYWORDS_MAX_ROWS } from '../lib/seo-keywords'

/**
 * Szerkeszthető SEO-kulcsszómező a `posts`, a `pages` és a `products` kollekcióhoz.
 *
 * Szándékosan gyökérszintű (nem `seo.` csoportba ágyazott): a meglévő
 * `seoTitle` / `seoDescription` útvonala ne változzon. A szerkesztő a
 * SEO-cím és a SEO-leírás után látja. A nyilvános lapon a mező NEM
 * jelenik meg külön listaként: csak a forráskódba (JSON-LD + meta) megy.
 */
export const seoKeywordsField: ArrayField = {
  name: 'seoKeywords',
  type: 'array',
  maxRows: SEO_KEYWORDS_MAX_ROWS,
  label: 'SEO-kulcsszavak',
  labels: { singular: 'Kifejezés', plural: 'Kifejezések' },
  admin: {
    description:
      'Keresőszavak és hosszabb kifejezések; később bővíthető. A forráskódba mennek, a lapon nem látszanak külön listaként.',
    // Beszédes sorcímke (modul-térkép H13): „1. kéztorna gyakorlatok”, üres
    // sornál „3. kifejezés (még üres)”, nem az általános „Kifejezés 01”. A
    // közös ArrayRowLabel (src/components/admin/SectionRowLabel.tsx) a
    // csukott sorban is megmutatja a kifejezést, így a 43 soros lista
    // kinyitás nélkül átnézhető (NN/g, Recognition Rather Than Recall,
    // https://www.nngroup.com/articles/recognition-and-recall/).
    components: {
      RowLabel: {
        path: '/components/admin/SectionRowLabel#ArrayRowLabel',
        clientProps: { singular: 'Kifejezés', titleFields: ['phrase'] },
      },
    },
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
