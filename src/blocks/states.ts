import type { Block } from 'payload'

import { KEP_CSERE_SUGO } from './kep-csere'
import { sectionSettings } from './section-settings'

/**
 * Három állapot — a terápia íve képekben (terv 2. blokk-katalógus).
 *
 * Zárt → nyíló → nyitott kéz: a márka logójának és a hero-filmnek a kulcskockái,
 * kártyánként képpel, sorszámmal, címmel és rövid szöveggel.
 */
export const states: Block = {
  slug: 'states',
  interfaceName: 'BlockStates',
  labels: {
    singular: 'A kéz három állapota',
    plural: 'Kézállapot-szekciók',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A kártyák fölötti cím (pl. „Három állapot, egy folyamat”).',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description: 'Pár mondat arról, mit mutat a három kép. Nem kötelező.',
      },
    },
    {
      name: 'cards',
      type: 'array',
      label: 'Kártyák',
      minRows: 1,
      maxRows: 3,
      labels: { singular: 'Kártya', plural: 'Kártyák' },
      admin: {
        description:
          'Három kártya: a zárt, a nyíló és a nyitott kéz, ebben a sorrendben. A képeket előbb töltsd fel a Tartalom → Képek közé.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Kép',
          admin: {
            description: `A kártya képe. A képleírást (alt) a Képek közt add meg egyszer. ${KEP_CSERE_SUGO}`,
          },
        },
        {
          name: 'number',
          type: 'text',
          label: 'Sorszám',
          admin: {
            description: 'Nem kötelező. Pl. „01”. Ha üresen hagyod, a rendszer maga számoz.',
          },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Kártya címe',
          admin: { description: 'Egy szó a legjobb (pl. „Zárt”, „Nyíló”, „Nyitott”).' },
        },
        {
          name: 'text',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
          admin: { description: '1–2 mondat arról, mit jelent ez az állapot.' },
        },
      ],
    },
    sectionSettings(),
  ],
}
