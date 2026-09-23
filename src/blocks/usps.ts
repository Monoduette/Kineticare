import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Ígéretek kártyákon (slug: usps, terv 2. blokk-katalógus).
 *
 * A korábbi név („„Erre számíthatsz” kártyák”) betűre egyezett a kezdőlap
 * látható „Erre számíthatsz velünk” szekciójával, pedig azt élőben a services
 * típus adja (modul-térkép, live-pages.json): aki a látott címet kereste,
 * rossz típust talált. A név ezért a blokk formáját és szerepét mondja
 * (NN/g, Match Between the System and the Real World,
 * https://www.nngroup.com/articles/match-system-real-world/).
 *
 * 1–4 számozott kártya, kártyánként egy állítással és két bekezdéssel: mit ígér
 * a Kineticare, és miért igaz ez. A kártyák sorszámozását a megjelenítés adja —
 * itt csak a szövegek sorrendje számít.
 */
export const usps: Block = {
  slug: 'usps',
  interfaceName: 'BlockUsps',
  labels: {
    singular: 'Ígéretek kártyákon',
    plural: 'Ígéretkártya-szekciók',
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
        description: 'A kártyák fölötti cím (pl. „Ezt kapod tőlünk”).',
      },
    },
    {
      name: 'cards',
      type: 'array',
      label: 'Kártyák',
      minRows: 1,
      maxRows: 4,
      labels: { singular: 'Kártya', plural: 'Kártyák' },
      admin: {
        description: 'Legfeljebb 4 kártya. Sorrendjük fogd-és-vidd módszerrel átrendezhető.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Kártya címe',
          admin: { description: 'Egy tömör állítás, nem szlogen.' },
        },
        {
          name: 'body',
          type: 'textarea',
          required: true,
          label: 'Első bekezdés',
          admin: { description: 'Mit jelent ez a gyakorlatban.' },
        },
        {
          name: 'extra',
          type: 'textarea',
          label: 'Második bekezdés',
          admin: { description: 'Nem kötelező. A részletek, példák helye.' },
        },
      ],
    },
    sectionSettings(),
  ],
}
