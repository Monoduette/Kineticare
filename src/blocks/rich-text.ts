import type { Block, UIField } from 'payload'

import { ARLISTA_TEENDO } from '../components/editor/frontend/szerkeszto-szalag'
import { arlistaSzabalySzoveg, rendeloiHorgonyu } from '../lib/admin/arlista-szabalyok'
import { CLINIC_TREATMENTS_ANCHOR } from '../lib/menu-seed'
import { sectionSettings } from './section-settings'

/**
 * A Tartalom mező súgója. A rendelői árlista szabályát (WP58, H29) betűre
 * ugyanaz a mondat mondja, mint az előnézet figyelmeztetése, hogy a szerkesztő
 * a mezőnél is lássa, mitől lesz árkártya a szövegből (WCAG 2.2 SC 3.3.2,
 * Labels or Instructions; SC 3.2.4, Consistent Identification).
 */
export const RICH_TEXT_TARTALOM_SUGO = `Szabadon szerkeszthető szöveg. A felső eszköztárral formázhatsz, listát és linket szúrhatsz be. Ha a szekció ugrópontja „${CLINIC_TREATMENTS_ANCHOR}” (rendelői árlista): ${ARLISTA_TEENDO}`

/**
 * A rendelői árlista teljes formai szabálya (H29), csak ott, ahol érvényes:
 * a „rendeloi” ugrópontú Szabad szövegnél, a Tartalom mező fölött. UI-mező,
 * adatbázis-oszlop nélkül, a Payload saját FieldDescription-komponensével.
 * Források (megnyitva, 2026-09-23):
 * - WCAG 2.2 SC 3.3.2 Labels or Instructions: „Labels or instructions are
 *   provided when content requires user input”
 *   (https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html);
 *   a formai elvárást a bevitel ELŐTT kell közölni, nem a hiba után;
 * - NN/g, Progressive Disclosure: „Initially, show users only a few of the
 *   most important options” (https://www.nngroup.com/articles/progressive-disclosure/):
 *   a többi Szabad szövegnél a hosszú szabálylista nem jelenik meg.
 */
const arlistaSzabalyJelzes: UIField = {
  name: 'arlistaSzabalyJelzes',
  type: 'ui',
  admin: {
    condition: (_data, siblingData) => rendeloiHorgonyu(siblingData),
    components: {
      Field: {
        path: '@payloadcms/ui#FieldDescription',
        clientProps: { description: arlistaSzabalySzoveg(), marginPlacement: 'bottom' },
      },
    },
  },
}

/**
 * Szabad szöveg — Lexical szerkesztős szekció (terv 2. blokk-katalógus).
 *
 * Az a blokk, amivel bármi elmondható, amire nincs saját szekció-típus: hosszabb
 * magyarázat, tájékoztató, akciós közlemény. A felső eszköztárral formázható,
 * listázható, linkelhető.
 */
export const richText: Block = {
  slug: 'richText',
  interfaceName: 'BlockRichText',
  labels: {
    singular: 'Szabad szöveg',
    plural: 'Szabad szövegek',
  },
  admin: {
    group: 'Bárhol használható',
  },
  fields: [
    arlistaSzabalyJelzes,
    {
      name: 'content',
      type: 'richText',
      required: true,
      label: 'Tartalom',
      admin: {
        description: RICH_TEXT_TARTALOM_SUGO,
      },
    },
    sectionSettings(),
  ],
}
