import type { Block } from 'payload'

import { KEP_CSERE_SUGO } from './kep-csere'
import { sectionSettings } from './section-settings'

/**
 * Bemutatkozás és számok (terv 2. blokk-katalógus). Korábbi nevei: „Rólunk +
 * statisztikák”, majd „Rólunk, számokkal”. A névben nem lehet vessző, mert a
 * Payload közzétételi hibaértesítője a hibaútvonalak listáját vesszőnél vágja
 * (@payloadcms/ui/dist/elements/Toasts/fieldErrors.js:37, split(',')), így a
 * vesszős név két értelmetlen tételre törte a szekció hibáját, és a számláló
 * eggyel többet mutatott. A „Rólunk” szó a /rolunk oldal nevével is
 * összetéveszthető volt, pedig ez a típus ott is, a kezdőlapon is áll.
 *
 * A két gyógytornász bemutatkozása: bekezdések, egy kiemelt „ígéret"-blokk,
 * csapatfotó és néhány szám (évek, páciensek). A számok VALÓS adatok legyenek —
 * kitalált statisztika fogyasztóvédelmi kockázat.
 */
export const about: Block = {
  slug: 'about',
  interfaceName: 'BlockAbout',
  labels: {
    singular: 'Bemutatkozás és számok',
    plural: 'Bemutatkozó szekciók',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Felső kis felirat',
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „Rólunk”). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A bemutatkozás címe (pl. „Kiss Kata és Kocsis Kata vagyunk”).',
      },
    },
    {
      name: 'paragraphs',
      type: 'array',
      label: 'Bekezdések',
      maxRows: 8,
      labels: { singular: 'Bekezdés', plural: 'Bekezdések' },
      admin: {
        description:
          'A bemutatkozás szövege bekezdésenként. Az első, összefoglaló bekezdésnél szokás bekapcsolni a „Kiemelt” pipát.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'text',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
        },
        {
          name: 'emphasized',
          type: 'checkbox',
          defaultValue: false,
          label: 'Kiemelt (félkövér)',
          admin: {
            description:
              'Vastag betűvel jelenik meg. Egy szekcióban legfeljebb egy bekezdésnél használd.',
          },
        },
      ],
    },
    {
      name: 'feature',
      type: 'group',
      label: 'Kiemelt blokk',
      admin: {
        description:
          'A bekezdések alatti, keretes kiemelés: egy fontos ígéret pár szóban. Ha mindkét mezőt üresen hagyod, nem jelenik meg.',
      },
      fields: [
        {
          name: 'label',
          type: 'text',
          label: 'Felirat',
          admin: { description: 'Pl. „Személyre szabott kezelések”.' },
        },
        {
          name: 'note',
          type: 'textarea',
          label: 'Magyarázat',
          admin: { description: 'Egy mondat a felirat alá.' },
        },
      ],
    },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
      label: 'Csapatfotó',
      admin: {
        description: `A szekció melletti fénykép. A képleírást (alt) a Képek közt add meg egyszer. ${KEP_CSERE_SUGO}`,
      },
    },
    {
      name: 'stats',
      type: 'array',
      label: 'Számok',
      maxRows: 4,
      labels: { singular: 'Szám', plural: 'Számok' },
      admin: {
        description:
          'Rövid, valós adatok (pl. „10+ év szakmai tapasztalat”). Kitalált számot ne írj ide.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'value',
          type: 'text',
          required: true,
          label: 'Érték',
          admin: { description: 'A nagy betűs szám (pl. „10+”, „5000+”).' },
        },
        {
          name: 'label',
          type: 'text',
          required: true,
          label: 'Mit jelent',
          admin: { description: 'A szám alatti magyarázat (pl. „év szakmai tapasztalat”).' },
        },
      ],
    },
    sectionSettings(),
  ],
}
