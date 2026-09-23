import type { Block } from 'payload'

import { FRIEZE_PHOTOS } from '../lib/foto-friz'
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
/**
 * A fríz négy helyének neve az asztali 2×2-es rács szerint; 900 px alatt az
 * 1. ív elmarad (photo-frieze.css), ezt a név kimondja.
 */
export const FRIZ_HELY_NEVEK: readonly string[] = [
  '1. kép: bal fent (telefonon nem látszik)',
  '2. kép: jobb fent',
  '3. kép: bal lent',
  '4. kép: jobb lent',
]

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
        description: `A szekció melletti fénykép. A kezdőlapon, ha ez a szekció közvetlenül a nyitó videó után áll, helyette a lenti mozgó fotósor látszik. A képleírást (alt) a Képek közt add meg egyszer. ${KEP_CSERE_SUGO}`,
      },
    },
    {
      // 2026-09-23: a fríz négy íve helyenként cserélhető (src/lib/kep-helyek.ts
      // fejkommentje: rögzített helyek, üresen a beépített fotó).
      name: 'frieze',
      type: 'group',
      label: 'Mozgó fotósor a kezdőlapon (négy kép)',
      admin: {
        description: `Csak a kezdőlapon látszik, ha ez a szekció közvetlenül a nyitó videó után áll. Minden mező egy ívnek felel meg; ha üresen hagyod, ott a beépített fotó marad. A kivágást a kép fókuszpontja adja: a Képek közt arra a pontra állítsd, aminek mindig látszania kell. ${KEP_CSERE_SUGO}`,
      },
      fields: FRIEZE_PHOTOS.map((foto, index) => ({
        name: `photo${index + 1}`,
        type: 'upload' as const,
        relationTo: 'media' as const,
        label: FRIZ_HELY_NEVEK[index] ?? `${index + 1}. kép`,
        admin: {
          description: `Ha üresen hagyod, a beépített fotó látszik: ${foto.alt}`,
        },
      })),
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
