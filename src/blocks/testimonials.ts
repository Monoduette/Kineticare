import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Vélemények — páciens-visszajelzések (terv 2. blokk-katalógus, M6).
 *
 * ADATVEZÉRELT blokk: maguk a vélemények NEM itt születnek, hanem a
 * Tartalom → Vélemények alatt. A kezdőlapra a KIEMELT és látható vélemények
 * kerülnek ki, a Vélemények közt beállított sorrend szerint.
 *
 * Itt csak a szekció megjelenése állítható. Ha nincs kiemelt vélemény, a
 * szekció elmarad — kitalált idézet fogyasztóvédelmi okból sem kerülhet ki.
 */
export const testimonials: Block = {
  slug: 'testimonials',
  interfaceName: 'BlockTestimonials',
  labels: {
    singular: 'Vélemények (automatikus)',
    plural: 'Vélemény-szekciók',
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
        description: 'A cím fölötti apró szöveg (pl. „Vélemények”). Nem kötelező.',
      },
    },
    {
      name: 'heading',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description:
          'Nem kötelező. Ha üresen hagyod, a beépített cím marad („Pácienseink mondták”).',
      },
    },
    {
      name: 'maxItems',
      type: 'number',
      defaultValue: 3,
      min: 1,
      max: 3,
      label: 'Hány vélemény jelenjen meg',
      admin: {
        description:
          'Legfeljebb 3, hogy a kezdőlap ne legyen több képernyőnyi idézet. A megjelenő véleményeket a Tartalom → Vélemények alatt a „Kiemelt” pipa és a „Sorrend” dönti el.',
        step: 1,
      },
    },
    sectionSettings({ defaultBackground: 'tint' }),
  ],
}
