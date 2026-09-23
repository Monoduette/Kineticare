import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Így működik (lépések) — a vásárlás utáni folyamat (terv 2. blokk-katalógus, M5).
 *
 * Egy videókurzusnál ez a legfontosabb ellenérv-csökkentő: megveszem → azonnal
 * nézem → otthon gyakorlok. Ma statikus szöveg, innentől szerkeszthető.
 */
export const howItWorks: Block = {
  slug: 'howItWorks',
  interfaceName: 'BlockHowItWorks',
  labels: {
    singular: 'Számozott lépések',
    plural: 'Lépés-szekciók',
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
        description: 'A lépések fölötti cím (pl. „Így működik az online kurzus”).',
      },
    },
    {
      name: 'steps',
      type: 'array',
      label: 'Lépések',
      minRows: 1,
      maxRows: 5,
      labels: { singular: 'Lépés', plural: 'Lépések' },
      admin: {
        description:
          'A folyamat lépései sorrendben. Három lépés a legérthetőbb. A sorszámokat a rendszer teszi ki.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Lépés címe',
          admin: { description: 'Rövid, cselekvő megfogalmazás (pl. „Kiválasztod a kurzust”).' },
        },
        {
          name: 'text',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
          admin: { description: '1–2 mondat arról, mi történik ebben a lépésben.' },
        },
      ],
    },
    sectionSettings(),
  ],
}
