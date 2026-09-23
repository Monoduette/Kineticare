import type { Block } from 'payload'

import { appointmentShowsForm } from '../lib/appointment/context'

import { sectionSettings } from './section-settings'

/**
 * Admin-feltétel: az ŰRLAPHOZ tartozó mezők csak akkor jelennek meg a
 * szerkesztőben, ha van űrlap. Enélkül a szerkesztő olyan mezőket töltene
 * (gombfelirat, siker-szöveg, időpont-sávok), amik sehol nem látszanak — ez a
 * repó saját, már megtanult „néma közzétételi csapda" hibája, csak fordítva.
 *
 * A `siblingData` a BLOKK saját mezőit hozza (a blokk a `layout` tömb egy
 * eleme), ezért a kapcsolót itt kell keresni, nem a lap gyökerében.
 */
const urlapLatszik = (_data: unknown, siblingData: { urlapMutatasa?: boolean | null }): boolean =>
  appointmentShowsForm(siblingData)

/**
 * Időpontkérő szekció — a RENDELŐI kezelések (gyógytorna, manuálterápia)
 * MIÉRT NEM ÚJ BEKÜLDÉSI ÚT: a beküldés a MEGLÉVŐ form-builder végpontra megy
 * a GDPR 9. cikk (1) szerinti különleges adat. Ezért a mező NEM kötelező
 */
export const appointment: Block = {
  slug: 'appointment',
  interfaceName: 'BlockAppointment',
  labels: {
    singular: 'Időpontkérés',
    plural: 'Időpontkérő szekciók',
  },
  admin: {
    // Nem kötődik kezdőlapi pozícióhoz (a kapcsolat- és a szolgáltatás-oldal a
    // helye), ezért a meglévő „bárhol" csoportba kerül.
    group: 'Bárhol használható',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Felső kis felirat',
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „Rendelői kezelés”). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A szekció címe (pl. „Kérj időpontot a rendelőbe”).',
      },
    },
    {
      name: 'urlapMutatasa',
      type: 'checkbox',
      defaultValue: true,
      label: 'Legyen űrlap a szekcióban',
      admin: {
        description:
          'Bekapcsolva a látogató űrlapon hagyja itt az elérhetőségét, és ti hívjátok vissza. Kikapcsolva a szekció csak a rendelő adatait mutatja, és a telefonszám lesz az egyetlen út. Ezt válaszd, ha az időpontot telefonon egyeztetitek. Kikapcsolás után nézd át a bevezetőt és a „Hogyan megy tovább?” szöveget: ne hivatkozzanak űrlapra.',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description:
          'Egy-két mondat a cím alá: kinek való, mire számítson. Ez az a szöveg, ami eldönti, megkeres-e valaki. Ha nincs űrlap, itt már ne kérj adatot („hagyd itt az elérhetőséged”), mert nincs hova beírni.',
      },
    },
    {
      name: 'magyarazat',
      type: 'textarea',
      label: 'Hogyan megy tovább?',
      admin: {
        description:
          'Írd le, hogyan jut a látogató időponthoz. Űrlappal: mennyi időn belül hívjátok vissza. Űrlap nélkül: hogy hívja a lenti számok egyikét, és ott rögtön egyeztettek. Fontos: naptáras foglalás nincs a rendszerben, ezért itt se ígérj azonnali foglalást.',
      },
    },
    {
      name: 'urlapCim',
      type: 'text',
      label: 'Az űrlap címe',
      admin: {
        condition: urlapLatszik,
        description: 'Az űrlapdoboz fölötti cím (pl. „Időpontkérés”). Nem kötelező.',
      },
    },
    {
      name: 'gombFelirat',
      type: 'text',
      label: 'A gomb felirata',
      admin: {
        condition: urlapLatszik,
        description:
          'Az elküldő gomb felirata. Ige + tárgy alakban a legjobb (pl. „Időpontot kérek”). Üresen hagyva az alapértelmezett felirat jelenik meg.',
      },
    },
    {
      name: 'idopontSavok',
      type: 'array',
      label: 'Választható időpont-sávok',
      maxRows: 6,
      labels: { singular: 'Időpont-sáv', plural: 'Időpont-sávok' },
      admin: {
        condition: urlapLatszik,
        description:
          'Ezek közül jelölhet be a látogató, hogy mikor alkalmas neki. Csak olyan sávot vegyél fel, amit tényleg tudtok tartani (pl. „Hétköznap délelőtt”). Ha üresen hagyod, a kérdés egyszerűen kimarad az űrlapból.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'felirat',
          type: 'text',
          required: true,
          label: 'A sáv felirata',
          admin: {
            description: 'Rövid, egysoros felirat (pl. „Hétköznap délelőtt”).',
          },
        },
      ],
    },
    {
      name: 'helyszinekFelirat',
      type: 'text',
      label: 'A helyszínek felirata',
      admin: {
        description: 'A rendelő-címek fölötti szó (pl. „Rendelőink”).',
      },
    },
    {
      name: 'helyszinek',
      type: 'array',
      label: 'Rendelők címe',
      maxRows: 6,
      labels: { singular: 'Rendelő', plural: 'Rendelők' },
      admin: {
        description:
          'A rendelők postai címe. A látogató itt látja, hova kell majd mennie; enélkül az időpontkérés vak ugrás lenne.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'cim',
          type: 'text',
          required: true,
          label: 'Cím',
          admin: { description: 'Teljes postai cím (pl. „1117 Budapest, Nádorliget u. 7/b”).' },
        },
        {
          name: 'megjegyzes',
          type: 'text',
          label: 'Megjegyzés a címhez',
          admin: {
            description: 'Nem kötelező, egysoros kiegészítés (pl. „bejárat az udvar felől”).',
          },
        },
      ],
    },
    {
      name: 'telefonFelirat',
      type: 'text',
      label: 'A telefonszámok felirata',
      admin: { description: 'A telefonszámok fölötti szó (pl. „Telefon”).' },
    },
    {
      name: 'telefonszamok',
      type: 'array',
      label: 'Telefonszámok',
      maxRows: 4,
      labels: { singular: 'Telefonszám', plural: 'Telefonszámok' },
      admin: {
        description:
          'Akik időpontot tudnak adni. Mobilon kattintható hívás-linkké alakul, ezért ez a leggyorsabb út a türelmetlen látogatónak.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'nev',
          type: 'text',
          label: 'Kihez tartozik',
          admin: { description: 'Nem kötelező (pl. „Kocsis Kata”).' },
        },
        {
          name: 'szam',
          type: 'text',
          required: true,
          label: 'Telefonszám',
          admin: {
            description:
              'Tagoltan írd (pl. „+36 30 169 2263”). Mobilon kattintható hívás-link lesz belőle.',
          },
        },
      ],
    },
    {
      name: 'emailFelirat',
      type: 'text',
      label: 'Az e-mail-cím felirata',
      admin: { description: 'Az e-mail-cím fölötti szó (pl. „E-mail”).' },
    },
    {
      name: 'email',
      type: 'text',
      label: 'E-mail-cím',
      admin: {
        description: 'Nem kötelező. Ha megadod, kattintható levélíró-linkként jelenik meg.',
      },
    },
    {
      name: 'sikerCim',
      type: 'text',
      label: 'A sikeres beküldés címe',
      admin: {
        condition: urlapLatszik,
        description:
          'Ez jelenik meg az űrlap helyén a sikeres beküldés után (pl. „Megkaptuk az időpontkérésed”). Üresen hagyva az alapértelmezett szöveg jelenik meg.',
      },
    },
    {
      name: 'sikerSzoveg',
      type: 'textarea',
      label: 'A sikeres beküldés szövege',
      admin: {
        condition: urlapLatszik,
        description:
          'Mi történik most, és mikor keresitek vissza a látogatót. Konkrét határidőt írj (pl. „két munkanapon belül”), mert a bizonytalanság új üzenetet szül.',
      },
    },
    sectionSettings({ defaultBackground: 'tint' }),
  ],
}
