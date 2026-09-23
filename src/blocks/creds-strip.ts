import type { Block } from 'payload'

import { linkGroup } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Szakmai háttér sáv (slug: credsStrip, korábbi neve „Hitel-csík”): szöveges
 * szakmai bizonyítéksáv (terv 2. blokk-katalógus, M2).
 *
 * A hero alatti visszafogott csík a legerősebb bizalmi érvekkel (szakmai
 * háttér, kikhez járnak, tagságok). Az értékesítési audit szerint ez keretezi a
 * vásárlási döntést — a sajtólogó-sor NEM helyettesíti (terv 4. pont).
 *
 * A mai kódba égetett CredentialsStrip tartalma kerül ide CMS-esítve.
 */
export const credsStrip: Block = {
  slug: 'credsStrip',
  interfaceName: 'BlockCredsStrip',
  labels: {
    singular: 'Szakmai háttér sáv',
    plural: 'Szakmai háttér sávok',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'items',
      type: 'array',
      label: 'Tételek',
      minRows: 1,
      maxRows: 6,
      labels: { singular: 'Tétel', plural: 'Tételek' },
      admin: {
        description:
          'Rövid, tényszerű állítások egymás mellett (pl. „Gyógytornász és manuálterapeuta szakmai háttér”). 2–4 tétel a legjobb; a hosszú mondatok itt elvesznek.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
          label: 'Szöveg',
          admin: { description: 'Egy tömör mondatrész, pont nélkül.' },
        },
      ],
    },
    linkGroup({
      name: 'link',
      label: 'Link a sáv végén',
      // A súgó a JÓVÁHAGYOTT alakot mutatja (§3.2 #34): a korábbi példa
      // („Bővebben a szakmai hátterünkről") a szerkesztőnek pontosan azt a
      // „Bővebben"-nel kezdődő, öt szavas alakot tanította, amit az M-3 és a
      // GOV.UK linkszöveg-útmutatója egyaránt kizár.
      description:
        'Nem kötelező. Ide a Rólunk oldalra vivő hivatkozás kerül; a jóváhagyott felirat: „Ismerd meg a hátterünket”.',
    }),
    sectionSettings(),
  ],
}
