import type { Block } from 'payload'

import { linkGroup } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Szakértő-kártyák — a két gyógytornász 50–50 arányú bemutatása.
 * nálunk viszont eddig NEM volt olyan blokk, ami két személyt EGYENRANGÚAN
 */
export const teamMembers: Block = {
  slug: 'teamMembers',
  interfaceName: 'BlockTeamMembers',
  labels: {
    singular: 'Szakértő-kártyák',
    plural: 'Szakértő-kártya szekciók',
  },
  admin: {
    // A meglévő KÉT admin-csoport egyike (a másik a kezdőlapi sorrendé). A blokk
    // elsősorban a /rolunk oldalra készült, de nem kötődik kezdőlapi pozícióhoz,
    // ezért ide tartozik — új csoport-nevet szándékosan nem vezetünk be.
    group: 'Bárhol használható',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Kis felső felirat',
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „A csapat"). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A két bemutatkozás fölötti cím (pl. „Kik vagyunk?").',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description: 'Egy-két mondat a nevek fölé. Nem kötelező.',
      },
    },
    linkGroup({
      name: 'bookingLink',
      label: 'Írásos időpontkérés',
      description:
        'Nem kötelező, a szekció alján jelenik meg, a kártyák alatt. A telefonálás melletti MÁSIK út (pl. „Kérj időpontot üzenetben" a /kapcsolat oldalra). Sok páciens nem szívesen telefonál, ezért érdemes írásos utat is kínálni.',
      labelDescription: 'Ez a szöveg jelenik meg a linken (pl. „Kérj időpontot üzenetben").',
    }),
    {
      name: 'members',
      type: 'array',
      label: 'Szakemberek',
      minRows: 1,
      maxRows: 2,
      labels: { singular: 'Szakember', plural: 'Szakemberek' },
      admin: {
        description:
          'Pontosan két szakember fér ide, egymás mellett, egyenlő súllyal. A portrékat előbb töltsd fel a Tartalom → Képek közé; a legjobb, ha mindkét kép AZONOS képarányú és hasonló fejméretű (különben az egyik közelebbinek látszik).',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'photo',
          type: 'upload',
          relationTo: 'media',
          label: 'Portré',
          admin: {
            description:
              'Álló (3:4 vagy 4:5) portré a legjobb. A képleírást (alt) a Képek közt add meg egyszer — ide nem kell újra beírni.',
          },
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          label: 'Név',
          admin: { description: 'A szakember teljes neve (pl. „Kocsis Kata").' },
        },
        {
          name: 'role',
          type: 'text',
          label: 'Titulus',
          admin: {
            description:
              'Rövid szakmai megnevezés (pl. „Gyógytornász, manuálterapeuta, sportrehabilitációs tréner").',
          },
        },
        {
          name: 'bio',
          type: 'textarea',
          label: 'Rövid bemutatkozás',
          admin: {
            description:
              '2–4 mondat. A teljes szakmai életutat NE ide írd — arra valók lent a szakmai listák.',
          },
        },
        {
          /*
           * A NEMZETKÖZI alak (`+36 …`) nem stílus kérdése: a `tel:` hivatkozás
           * csak így tárcsáz megbízhatóan minden készüléken és külföldről is
           * (web.dev, Click to Call: „Always supply the phone number using the
           * international dialing format: the plus sign (+), country code, area
           * code, and number.") — https://web.dev/articles/click-to-call
           * A LÁTHATÓ szám viszont tagolt marad: a hosszú számsort csoportokra
           * bontva lehet leolvasni és visszamondani (NHS design system, NHS
           * numbers: „Write the NHS number as 3 groups of numbers, with a single
           * space between them") —
           * https://service-manual.nhs.uk/design-system/patterns/ask-for-nhs-numbers
           */
          name: 'phone',
          type: 'text',
          label: 'Telefonszám',
          admin: {
            description:
              'Nem kötelező. Nemzetközi alakban, csoportokra tagolva írd (pl. „+36 30 169 2263"): így külföldről is tárcsázható, és könnyen leolvasható. Mobilon kattintható hívás-linkké alakul.',
          },
        },
        {
          name: 'callLabel',
          type: 'text',
          label: 'A hívás felirata',
          admin: {
            description:
              'Nem kötelező. Rövid, cselekvő felirat a telefonszám fölé (pl. „Hívd Katát"). Ha üresen hagyod, csak a szám látszik. Telefonszám nélkül nincs hatása.',
          },
        },
        {
          name: 'availability',
          type: 'text',
          label: 'Mikor és hol érhető el',
          admin: {
            description:
              'Nem kötelező, egyetlen sor a hívás alá (pl. „Hétfőtől péntekig, a budapesti rendelőben"). Azt mondja meg, mire számítson a látogató, ha telefonál.',
          },
        },
        {
          name: 'email',
          type: 'text',
          label: 'E-mail-cím',
          admin: {
            description: 'Nem kötelező. Kattintható levélírás-linkké alakul.',
          },
        },
        {
          name: 'cvSections',
          type: 'array',
          label: 'Szakmai listák',
          maxRows: 8,
          labels: { singular: 'Lista', plural: 'Listák' },
          admin: {
            description:
              'A szakmai háttér összecsukható listái (pl. Tanulmányok, Tanfolyamok, Publikációk, Konferenciák, Médiamegjelenések). Alapból zárva jelennek meg, a fejlécükben a tételek számával.',
            initCollapsed: true,
          },
          fields: [
            {
              name: 'heading',
              type: 'text',
              required: true,
              label: 'Lista címe',
              admin: { description: 'Pl. „Tanfolyamok, továbbképzések".' },
            },
            {
              name: 'items',
              type: 'textarea',
              required: true,
              label: 'Tételek',
              admin: {
                description:
                  'SORONKÉNT EGY tétel (pl. egy tanfolyam, egy előadás). Az üres sorok kimaradnak, a tételek számát a rendszer maga írja ki a lista címe mellé.',
              },
            },
          ],
        },
        linkGroup({
          name: 'link',
          label: 'Hivatkozás',
          description:
            'Nem kötelező. Pl. „Bővebben a szakmai hátterről" — a részletes önéletrajz horgonyára vagy egy aloldalra mutathat.',
          labelDescription:
            'Ez a szöveg jelenik meg a linken (pl. „Bővebben a szakmai hátterről").',
        }),
      ],
    },
    sectionSettings(),
  ],
}
