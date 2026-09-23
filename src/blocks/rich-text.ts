import type { Block } from 'payload'

import { ARLISTA_TEENDO } from '../components/editor/frontend/szerkeszto-szalag'
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
