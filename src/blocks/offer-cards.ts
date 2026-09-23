import type { Block } from 'payload'

import { linkFields } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Ajánlat-kártyák (slug: offerCards): 1–4 egymás melletti kártya, mindegyik
 * egy ajánlat (képzés, szakkönyv) saját gombbal (modul-térkép H11). Ez a
 * /szakembereknek oldal CMS-be költözésének sémája; a mezők a mai, kódban
 * álló kártyák minden elemét lefedik: ikon, kis felirat, cím, szöveg, tények
 * listája, gomb (felirat, cél, új lap), gombsúly, jegyzet a gomb alatt és a
 * „még nem elérhető” állapot (src/app/(frontend)/szakembereknek/page.tsx).
 * A megjelenítés (OfferCards.tsx, RenderBlocks) külön csomag (A7).
 *
 * A súgók a docs/ui-sztenderdek.md 8.3 és 8.5 szerint: tegező, rövid, egy
 * példával, és mindegyik kimondja, mi történik, ha a mező üres. GOV.UK Design
 * System, Text input: „Use hint text for help that's relevant to the majority
 * of users” (https://design-system.service.gov.uk/components/text-input/);
 * NN/g, Website Forms Usability: „If a field requires a specific format or
 * type of input, state the exact instructions.”
 * (https://www.nngroup.com/articles/web-form-design/).
 */

/** A kártya-ikonok választéka: a /szakembereknek oldal két rajza, vagy semmi. */
export const OFFER_CARD_IKONOK = [
  { label: 'Képzés (tábla)', value: 'kepzes' },
  { label: 'Szakkönyv (nyitott könyv)', value: 'szakkonyv' },
  { label: 'Nincs ikon', value: 'nincs' },
] as const

/** A gomb két súlya (docs/ui-sztenderdek.md 2.2). */
export const OFFER_CARD_GOMBSULYOK = [
  { label: 'Elsődleges (kitöltött)', value: 'elsodleges' },
  { label: 'Másodlagos (keretes)', value: 'masodlagos' },
] as const

export const offerCards: Block = {
  slug: 'offerCards',
  interfaceName: 'BlockOfferCards',
  labels: {
    singular: 'Ajánlat-kártyák',
    plural: 'Ajánlat-kártyák',
  },
  admin: {
    group: 'Bárhol használható',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Felső kis felirat',
      admin: {
        description:
          'A cím fölötti rövid felirat (pl. „Gyógytornászoknak és terapeutáknak”). Nem kötelező: ha üresen hagyod, nem jelenik meg.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description:
          'A kártyák fölötti cím (pl. „Szakembereknek”). Nem kötelező: ha üresen hagyod, a szekció cím nélkül jelenik meg.',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető',
      admin: {
        description:
          'A cím alatti 1–3 mondat a kártyák előtt. Nem kötelező: ha üresen hagyod, nem jelenik meg.',
      },
    },
    {
      name: 'kartyak',
      type: 'array',
      label: 'Kártyák',
      minRows: 1,
      maxRows: 4,
      labels: { singular: 'Kártya', plural: 'Kártyák' },
      admin: {
        description:
          'Egy kártya egy ajánlat (pl. képzés vagy szakkönyv). Legalább 1, legfeljebb 4.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'ikon',
          type: 'select',
          label: 'Ikon',
          defaultValue: 'nincs',
          options: OFFER_CARD_IKONOK.map((ikon) => ({ ...ikon })),
          admin: {
            description:
              'A kártya tetején álló kis rajz. Ha a „Nincs ikon” marad kiválasztva, a kártya ikon nélkül jelenik meg.',
          },
        },
        {
          name: 'kicker',
          type: 'text',
          label: 'Kis felirat',
          admin: {
            description:
              'A kártya címe fölötti egy-két szó (pl. „Képzés”). Nem kötelező: ha üresen hagyod, nem jelenik meg.',
          },
        },
        {
          name: 'cim',
          type: 'text',
          required: true,
          label: 'Cím',
          admin: {
            description: 'A kártya címe (pl. „Akkreditált kézrehabilitációs képzés”).',
          },
        },
        {
          name: 'szoveg',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
          admin: {
            description: '2–3 mondat arról, kinek szól az ajánlat, és mit kap tőle.',
          },
        },
        {
          name: 'tenyek',
          type: 'array',
          label: 'Tények (felsorolás)',
          maxRows: 4,
          labels: { singular: 'Tény', plural: 'Tények' },
          admin: {
            description:
              'Rövid, egysoros tények a szöveg alatt (pl. „12 kreditpont (SZTK-A-33553/2024)”). Legfeljebb 4. Ha üresen hagyod, a kártyán nincs felsorolás.',
          },
          fields: [
            {
              name: 'szoveg',
              type: 'text',
              required: true,
              label: 'Tény',
              admin: {
                description: 'Egy tény egy sorban.',
              },
            },
          ],
        },
        // A felirat-súgó a services.ts sorainak mintája (K27): a gomb nevezze
        // meg, hova visz. GOV.UK, Add links: „make it descriptive and avoid
        // generic text like 'click here' or 'more'”
        // (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/);
        // NN/g, Better Link Labels: „A link's primary purpose is to
        // communicate to users what they'll find on the other side of a
        // click.” (https://www.nngroup.com/articles/better-link-labels/).
        // A példák a §3.2 #41 és #43 jóváhagyott feliratai.
        ...linkFields({
          labelDescription:
            'A kártya gombjának felirata. Nevezd meg, hova visz (pl. „Nézd meg a kézworkshopot” vagy „Érdeklődj a szakkönyvről”). Ha a felirat vagy a webcím üres, a kártya gomb nélkül jelenik meg.',
        }),
        {
          // GOV.UK Design System, Button: „Use a default button for the main
          // call to action on a page.” és „Avoid using multiple default
          // buttons on a single page. Having more than one main call to
          // action reduces their impact”
          // (https://design-system.service.gov.uk/components/button/);
          // IBM Carbon, Button usage: „Each page should have only one primary
          // button.” (https://carbondesignsystem.com/components/button/usage/,
          // docs/ui-sztenderdek.md 2.2). Az alap ezért a keretes: a
          // szerkesztő tudatosan emel ki egyet, nem véletlenül kettőt.
          name: 'gombSuly',
          type: 'select',
          label: 'Gomb súlya',
          defaultValue: 'masodlagos',
          options: OFFER_CARD_GOMBSULYOK.map((suly) => ({ ...suly })),
          admin: {
            description:
              'Egy lapon egy elsődleges gomb legyen: az a fő cselekvés, a többi keretes. Ha nem választasz, a gomb keretes.',
          },
        },
        {
          // WCAG 2.2 SC 3.2.5 (Change on Request): az új lapon nyíló linkről
          // előre szólni kell; a mai /szakembereknek oldal ezt a gomb alatti
          // jegyzettel teszi (G201 technika:
          // https://www.w3.org/WAI/WCAG22/Techniques/general/G201).
          name: 'jegyzet',
          type: 'text',
          label: 'Jegyzet a gomb alatt',
          admin: {
            description:
              'Egy rövid mondat a gomb alá arról, hova visz (pl. „A kapcsolat-oldalunkra visz.”). Ha üresen hagyod és a gomb új lapon nyílik, a lap magától kiírja: „Külső oldal, új lapon nyílik.” Más gombnál üresen nem jelenik meg jegyzet.',
          },
        },
        {
          name: 'hamarosan',
          type: 'checkbox',
          label: 'Még nem elérhető',
          defaultValue: false,
          admin: {
            description:
              'Kapcsold be, ha az ajánlat még nem kapható. Ekkor megjelenik alatta a „Mikor lesz elérhető?” mező, és a szövege a kártyára kerül.',
          },
        },
        {
          name: 'allapotSzoveg',
          type: 'textarea',
          label: 'Mikor lesz elérhető?',
          admin: {
            condition: (_data, siblingData) => siblingData?.hamarosan === true,
            description:
              'Egy-két mondat arról, mikor és hogyan lesz elérhető (pl. „A vásárlás lehetőségét hamarosan közzétesszük. Addig kérdezz tőlünk, és szólunk, amint elérhető.”). Ha üresen hagyod, a kártyán nem jelenik meg ilyen szöveg.',
          },
        },
      ],
    },
    sectionSettings(),
  ],
}
