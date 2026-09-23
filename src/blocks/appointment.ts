import type { Block } from 'payload'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../lib/contact-email'

import { appointmentShowsForm } from '../lib/appointment/context'
import { ctaLabel } from '../lib/cta-vocabulary'

import { sectionSettings } from './section-settings'

/**
 * A beküldőnek küldött visszaigazoló e-mail ígérete (modul-térkép H44, B22).
 *
 * A levél szövege KÓDBAN van (src/lib/email/templates/appointment.ts,
 * `appointmentCustomerEmail`, a `mit` és az `elso` mondat), a lapon látható
 * ígéret viszont CMS-mező (Hogyan megy tovább?, A sikeres beküldés szövege).
 * Ha a szerkesztő csak a lapot írja át, a lap és a levél ellentmond, és az
 * adminban eddig semmi nem utalt a levélre. A két részlet BETŰRE a sablonból
 * való; az őr (src/__tests__/blokk-feltetel-sugok.test.ts) a sablonfüggvény
 * kimenetével veti össze, így a levél változásakor bukik.
 *
 * Források: NN/g, 10 Usability Heuristics, #1 Visibility of System Status és
 * #4 Consistency and Standards (a rendszer mondja meg, mi történik a háttérben,
 * és ugyanaz az ígéret mindenhol ugyanazt mondja;
 * https://www.nngroup.com/articles/ten-usability-heuristics/); WCAG 2.2
 * SC 3.3.2 Labels or Instructions (a mező mellett álljon, amit a kitöltéshez
 * tudni kell; https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).
 */
const LEVEL_HATARIDO = 'két munkanapon belül telefonon keresünk'
const LEVEL_ELSO_ALKALOM = 'Az első alkalom minden esetben 50 perces vizsgálattal kezdődik.'
const LEVEL_IGERETE = `Ennek ígérete a rendszerbe beépített szöveg, itt nem szerkeszthető: „${LEVEL_HATARIDO}”, és „${LEVEL_ELSO_ALKALOM}” Ha itt mást ígérsz, szólj a fejlesztőnek, hogy a levél is ugyanezt mondja.`

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
        description: `Írd le, hogyan jut a látogató időponthoz. Űrlappal: mennyi időn belül hívjátok vissza. Űrlap nélkül: hogy hívja a lenti számok egyikét, és ott rögtön egyeztettek. Fontos: naptáras foglalás nincs a rendszerben, ezért itt se ígérj azonnali foglalást. Ha a szekcióban van űrlap, a beküldő visszaigazoló e-mailt is kap. ${LEVEL_IGERETE}`,
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
    /*
     * CSAK OLVASHATÓ (modul-térkép H16, B10). A beküldő gomb feliratát a §3.2
     * #25 szótára adja (`ctaLabel('appointment-submit')`,
     * src/components/blocks/AppointmentForm.tsx:30-59, „INAKTÍV,
     * SZÁNDÉKOSAN”), a CMS-érték nem írja felül. Szerkeszthetően hamis sikert
     * jelzett volna: a szerkesztő átírja, ment, és a lapon semmi nem változik.
     * A mezőnév, a típus és a tárolt adat marad (a mező sorsa tulajdonosi
     * döntés); a mező nem kötelező, ezért a readOnly a mentést nem akadályozza.
     * Ugyanez a minta a free-sos.ts `felirat` mezőjén (H07).
     * Források: Payload, Fields overview, Admin Options: „Setting a field to
     * readOnly has no effect on the API whatsoever but disables the admin
     * component's editability” (https://payloadcms.com/docs/fields/overview);
     * WCAG 2.2 SC 3.3.2 Labels or Instructions, a leírás mondja ki, miért nem
     * írható (https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html);
     * NN/g #1 Visibility of System Status
     * (https://www.nngroup.com/articles/ten-usability-heuristics/).
     */
    {
      name: 'gombFelirat',
      type: 'text',
      label: 'A gomb felirata',
      admin: {
        condition: urlapLatszik,
        readOnly: true,
        description: `A gomb felirata egységesen „${ctaLabel('appointment-submit')}”, a rendszer adja. A mezőbe korábban írt szöveg megmarad, de a weboldalon nem jelenik meg.`,
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
        // A H18/H46 közös feloldó (src/lib/contact-email.ts) ezt a mezőt olvassa a
        // Kapcsolat oldal első látható Időpontkérőjéből: a súgó ezért mondja ki,
        // hol jelenik még meg (NN/g, Visibility of System Status).
        description: `Nem kötelező. Ha megadod, kattintható levélíró-linkként jelenik meg. A Kapcsolat oldal első látható Időpontkérő szekciójában megadott cím a weboldal kapcsolati címe is: ez áll a láblécben, a hibaoldalon, a keresőknek szóló adatokban és a kiküldött levelek válaszcímében. Ha ott üres, ${KAPCSOLATI_EMAIL_TARTALEK} látszik.`,
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
        description: `Mi történik most, és mikor keresitek vissza a látogatót. Konkrét határidőt írj (pl. „két munkanapon belül”), mert a bizonytalanság új üzenetet szül. A beküldő ezzel egy időben visszaigazoló e-mailt is kap. ${LEVEL_IGERETE}`,
      },
    },
    sectionSettings({ defaultBackground: 'tint' }),
  ],
}
