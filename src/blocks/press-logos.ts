import type { Block } from 'payload'

import { KEP_CSERE_SUGO } from './kep-csere'
import { linkFields } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Sajtó-logósor — „Itt találkozhattál velünk" (terv 2. blokk-katalógus).
 *
 * Média-megjelenések és szakmai szervezetek logói egy sorban. Bizalmi elem, de
 * NEM helyettesíti a szakmai hitel-csíkot (terv 4. pont): a logósor a lap
 * későbbi szakaszába való.
 *
 * A logók a Médiatárból jönnek, így a lányok maguk cserélhetik őket.
 */
export const pressLogos: Block = {
  slug: 'pressLogos',
  interfaceName: 'BlockPressLogos',
  labels: {
    singular: 'Logósor',
    plural: 'Logósorok',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Felirat',
      admin: {
        description:
          'A logók fölötti rövid szöveg. Üresen hagyva a beépített „Itt találkozhattál velünk” felirat jelenik meg.',
      },
    },
    {
      name: 'logos',
      type: 'array',
      label: 'Logók',
      minRows: 1,
      maxRows: 12,
      labels: { singular: 'Logó', plural: 'Logók' },
      admin: {
        description:
          'A logókat előbb töltsd fel a Tartalom → Képek közé, itt már csak kiválasztod őket. Átlátszó hátterű (PNG) logó néz ki a legjobban.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          required: true,
          label: 'Logó képe',
          admin: { description: `A médium vagy szervezet logója. ${KEP_CSERE_SUGO}` },
        },
        {
          name: 'alt',
          type: 'text',
          label: 'Képleírás (alt) felülírása',
          admin: {
            description:
              'Nem kötelező. Ha üresen hagyod, a Képek közt megadott képleírás jelenik meg, és általában az a jó.',
          },
        },
        // A logó saját maga a „felirat", ezért itt nincs külön felirat-mező —
        // csak a cél és az „új lapon nyíljon" kapcsoló.
        ...linkFields({
          includeLabel: false,
          urlDescription:
            'Nem kötelező. A médium cikkének vagy a szervezet oldalának teljes címe https://-sel.',
        }),
      ],
    },
    sectionSettings(),
  ],
}
