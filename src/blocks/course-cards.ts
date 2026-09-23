import type { Block } from 'payload'

import { KEP_CSERE_SUGO } from './kep-csere'
import { sectionSettings } from './section-settings'

/**
 * A „Kurzusaink” jelenet három helye és az üres helyen álló beépített fotó
 * (src/lib/course-showcase.ts, COURSE_SHOWCASE_SCENE_PHOTOS, ugyanebben a
 * sorrendben; az egyezést a src/__tests__/kep-helyek.test.tsx őrzi).
 */
export const KURZUSAINK_KEPHELYEK: readonly { nev: string; mezo: string; beepitett: string }[] = [
  { nev: 'Bal oldali kép', mezo: 'left', beepitett: 'Kiss Kata kis labdán gyakorol a tenyerével.' },
  {
    nev: 'Középső kép',
    mezo: 'middle',
    beepitett: 'Otthoni gyakorlás labdával és törölközővel.',
  },
  {
    nev: 'Jobb oldali kép',
    mezo: 'right',
    beepitett: 'Kocsis Kata bögrével a fotelben.',
  },
]

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
    {
      // 2026-09-23: a jelenet fotói helyenként cserélhetők (src/lib/kep-helyek.ts).
      name: 'scenePhotos',
      type: 'group',
      label: 'Fotók a „Kurzusaink” felirat alatt (három kép)',
      admin: {
        description: `Díszítő fotók a kártyák alatt. Ha egy mezőt üresen hagysz, ott a beépített fotó marad. A kivágást a kép fókuszpontja adja: a Képek közt arra a pontra állítsd, aminek mindig látszania kell. ${KEP_CSERE_SUGO}`,
      },
      fields: KURZUSAINK_KEPHELYEK.map((hely) => ({
        name: hely.mezo,
        type: 'upload' as const,
        relationTo: 'media' as const,
        label: hely.nev,
        admin: {
          description: `Ha üresen hagyod, a beépített fotó látszik: ${hely.beepitett}`,
        },
      })),
    },
    sectionSettings(),
  ],
}
