import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Kurzuskártyák — a fizetős kurzusok kiemelése (terv 2. blokk-katalógus, M3).
 * ADATVEZÉRELT blokk: a kártyák tartalmát NEM itt írod. A kurzusok igazságforrása
 * a Webshop → Kurzusok: amit ott létrehozol és közzéteszel, az automatikusan
 * megjelenik ebben a szekcióban (ár, borító, rövid leírás, kiemelt előnyök
 * onnan jönnek). Így a kezdőlap sosem tud „elszakadni" a valós kínálattól
 * (terv 2. pont zárása).
 */
export const courseCards: Block = {
  slug: 'courseCards',
  interfaceName: 'BlockCourseCards',
  labels: {
    singular: 'Kurzuskártyák (automatikus)',
    plural: 'Kurzuskártya-szekciók',
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
        description:
          'A cím fölötti rövid, nagybetűs felirat. Nem kötelező: üresen a beépített felirat marad („Kurzusok”).',
      },
    },
    {
      name: 'heading',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'Nem kötelező. Ha üresen hagyod, a beépített cím marad („Kurzusaink”).',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description: 'A cím alatti 1–2 mondat a kártyák előtt. Nem kötelező.',
      },
    },
    {
      name: 'ctaLabel',
      type: 'text',
      label: 'Gombfelirat a kártyákon',
      admin: {
        // A súgó a JÓVÁHAGYOTT alakot mutatja (§3.2 #28), nem a régi
        // „Megnézem a programot"-ot: a mezősúgó a szerkesztő mintája, tehát
        // amit itt írunk, azt fogja írni ő is.
        description:
          'A kurzuskártyák alján megjelenő gomb felirata. Nem kötelező: üresen a beépített, jóváhagyott felirat marad („Nyisd meg a kurzusoldalt”). A gomb csak jelzés, maga a kártya a link.',
      },
    },
    sectionSettings(),
  ],
}
