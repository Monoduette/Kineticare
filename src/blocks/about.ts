import type { Block, UIField } from 'payload'

import { frizHelyzetUtvonalbol, nemFrizHelyzetUtvonalbol } from '../lib/admin/friz-helyzet'
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

const ABOUT_LABELS = {
  singular: 'Bemutatkozás és számok',
  plural: 'Bemutatkozó szekciók',
} as const

/** A fotósor neve; a fríz-csoport címkéje és a feltételes jelzések is ezt mondják. */
const FOTOSOR = 'Mozgó fotósor'

/** A fríz-csoport címkéje. */
export const FRIZ_CSOPORT_CIMKE = `${FOTOSOR} a kezdőlapon (négy kép)`

const FOTOSOR_NEVE = FOTOSOR.toLocaleLowerCase('hu')

/**
 * A szövegmezők címkéi. A mezők `label`-je és a fríz szövegfeltétele is
 * ezekből épül, hogy a jelzés pontosan azokat a neveket idézze, amelyeket a
 * szerkesztő a mezők fölött lát (WCAG 2.2 SC 3.2.4 Consistent Identification).
 * A lap a frízt csak akkor rajzolja, ha ezek közül legalább egy nem üres
 * (src/components/blocks/About.tsx, `hasCopy`).
 */
export const ABOUT_SZOVEG_CIMKEK = {
  eyebrow: 'Felső kis felirat',
  title: 'Szekció címe',
  paragraphs: 'Bekezdések',
  feature: 'Kiemelt blokk',
} as const

const SZOVEGFELTETEL = `a „${ABOUT_SZOVEG_CIMKEK.eyebrow}”, a „${ABOUT_SZOVEG_CIMKEK.title}”, a „${ABOUT_SZOVEG_CIMKEK.paragraphs}” és a „${ABOUT_SZOVEG_CIMKEK.feature}” közül legalább egy ki van töltve`

/**
 * A fríz-helyzet feltételes jelzései (modul-térkép H12). UI-mezők, adatbázis-
 * oszlop nélkül, a Payload saját FieldDescription-komponensével, így a többi
 * mezőleírással azonos betűt és kontrasztot kapnak. A feltétel a blokk
 * helyéből és szövegéből számol (src/lib/admin/friz-helyzet.ts, a
 * RenderBlocks.tsx és az About.tsx tükre), ezért a mondat csak ott áll, ahol
 * igaz. Források (megnyitva, 2026-09-23):
 * - WCAG 2.2 SC 3.3.2 Labels or Instructions: „Labels or instructions are
 *   provided when content requires user input”
 *   (https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html);
 * - NN/g, Progressive Disclosure: „Initially, show users only a few of the
 *   most important options” (https://www.nngroup.com/articles/progressive-disclosure/):
 *   a helyzethez nem tartozó magyarázat nem jelenik meg.
 * A fotósor nevét a csoport címkéjéből idézzük (WCAG 2.2 SC 3.2.4
 * Consistent Identification), a blokk nevét a blokk címkéjéből.
 */
export const CSAPATFOTO_FRIZ_JELZES = `Ebben a helyzetben a jobb oldalon a ${FOTOSOR_NEVE} látszik, ez a kép nem.`

export const FRIZ_NEM_LATSZIK_JELZES = `Ebben a helyzetben a ${FOTOSOR_NEVE} nem látszik: csak akkor jelenik meg, ha ez az első látható „${ABOUT_LABELS.singular}” szekció, közvetlenül a nyitó videó után áll, és ${SZOVEGFELTETEL}.`

const csapatfotoFrizJelzes: UIField = {
  name: 'csapatfotoFrizJelzes',
  type: 'ui',
  admin: {
    condition: (data, _siblingData, { path }) => frizHelyzetUtvonalbol(data, path),
    components: {
      Field: {
        path: '@payloadcms/ui#FieldDescription',
        clientProps: { description: CSAPATFOTO_FRIZ_JELZES, marginPlacement: 'bottom' },
      },
    },
  },
}

const frizNemLatszikJelzes: UIField = {
  name: 'frizNemLatszikJelzes',
  type: 'ui',
  admin: {
    condition: (data, _siblingData, { path }) => nemFrizHelyzetUtvonalbol(data, path),
    components: {
      Field: {
        path: '@payloadcms/ui#FieldDescription',
        clientProps: { description: FRIZ_NEM_LATSZIK_JELZES, marginPlacement: 'bottom' },
      },
    },
  },
}

export const about: Block = {
  slug: 'about',
  interfaceName: 'BlockAbout',
  labels: ABOUT_LABELS,
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: ABOUT_SZOVEG_CIMKEK.eyebrow,
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „Rólunk”). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: ABOUT_SZOVEG_CIMKEK.title,
      admin: {
        description: 'A bemutatkozás címe (pl. „Kiss Kata és Kocsis Kata vagyunk”).',
      },
    },
    {
      name: 'paragraphs',
      type: 'array',
      label: ABOUT_SZOVEG_CIMKEK.paragraphs,
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
      label: ABOUT_SZOVEG_CIMKEK.feature,
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
    csapatfotoFrizJelzes,
    frizNemLatszikJelzes,
    {
      // 2026-09-23: a fríz négy íve helyenként cserélhető (src/lib/kep-helyek.ts
      // fejkommentje: rögzített helyek, üresen a beépített fotó).
      name: 'frieze',
      type: 'group',
      label: FRIZ_CSOPORT_CIMKE,
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
