import type { Block, Field } from 'payload'

import {
  HOME_HELP_LEAD,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  HOME_USPS_EYEBROW,
} from '../lib/home-help-states'
import { KEP_CSERE_SUGO } from './kep-csere'
import { linkFields } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Képes lista vagy kártyák (slug: services, korábbi neve
 * „Szolgáltatás-sorok”): tábla (kép + számozott sorok) vagy sín + panel.
 *
 * A név a blokk FORMÁJÁT mondja, nem egy konkrét szekció címét: élőben ez a
 * típus adja a kezdőlap „Így tudunk segíteni” és „Erre számíthatsz velünk”,
 * a /rolunk „Amiben mások vagyunk” és a /szolgaltatasok „Ezért fogod imádni”
 * szekcióját is (modul-térkép, live-pages.json). A régi „Szolgáltatás-sorok”
 * és az usps blokk „„Erre számíthatsz” kártyák” neve ezért rossz típusra
 * vitte azt, aki a látott címet kereste. A sorcímke (B2) a név mellé a
 * szekció saját címét is kiírja.
 *
 * A név, a feliratok, a tipográfia és a képmezők közös képcsere-súgója
 * (K36, KEP_CSERE_SUGO: a Kép és a Panel fotója súgójának végén) a #292-ből
 * való. A mező-feltételek és a hatásosságot állító súgók (K29) az alábbiak
 * szerint élnek (H15, H14).
 *
 * Az elrendezést a blokk `elrendezes` mezője dönti el (H15, A4; a megjelenítés
 * src/lib/home-help-states.ts). Élesben sín: a kezdőlap „Így tudunk segíteni”
 * és a /szolgaltatasok „Így segítünk” szekciója, valamint a /rolunk sínje.
 *
 * MEZŐ-FELTÉTELEK (H15, B9, 2026-09-23): a szerkesztő csak azt a mezőt lássa,
 * amelynek a választott elrendezésben hatása van. A Kép és a Sorszám csak
 * Táblánál, a Rövid összegzés és a Panel fotója csak Sínnél jelenik meg.
 * Korábban mind a négy mindig látszott, és a súgó mondta meg, hogy „ennél nem
 * jelenik meg”: a szerkesztő kitöltötte, a lapon mégsem látszott. Források:
 * GOV.UK Design System, Radios, „Conditionally revealing a related question”
 * („so they only see the question when it’s relevant to them”:
 * https://design-system.service.gov.uk/components/radios/#conditionally-revealing-a-related-question);
 * NN/g, Progressive Disclosure (a ritkán kellő vagy épp hatástalan beállítást
 * ne mutassuk az elsődleges felületen:
 * https://www.nngroup.com/articles/progressive-disclosure/). A választóhoz
 * tartozó súgó kimondja, mely mezők jönnek és mennek, hogy az eltűnő mező ne
 * lepje meg a szerkesztőt (WCAG 2.2 SC 3.3.2 Labels or Instructions:
 * https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).
 *
 * ADATMEGŐRZÉS: az elrejtett mező értéke mentéskor megmarad (Payload 3.88):
 *  - kliens: a feltételen elbukó mező a form-state-ben az értékével együtt
 *    marad (`@payloadcms/ui/dist/forms/fieldSchemasToFormState/
 *    addFieldStatePromise.js`: `passesCondition === false` ágon
 *    `fieldState.value = data[field.name]`), és a beküldött adat a teljes
 *    form-state-ből épül, `passesCondition` szűrés nélkül
 *    (`payload/dist/utilities/reduceFieldsToValues.js`);
 *  - szerver: a `beforeChange` a feltételt csak a validáció kihagyására
 *    használja (`payload/dist/fields/hooks/beforeChange/promise.js`:
 *    `skipValidationFromHere = skipValidation || !passesCondition`), az
 *    értéket nem törli.
 * Visszaváltáskor tehát a korábbi kép, sorszám, összegzés és fotó újra
 * látszik. Őr: src/__tests__/services-mezo-feltetelek.test.ts.
 *
 * SÚGÓK („Ha üresen hagyod”, H14, B8): minden ilyen állítás a kód tényleges
 * tartalékát mondja, lapra pontosan. A kezdőlapi sín a konstansokkal pótolja
 * az üres címet, bevezetőt, összegzést és fotót; a /szolgaltatasok sínje csak
 * a fotót pótolja, a szöveget nem; más lap (pl. /rolunk) semmit, ott a fotó
 * helyén „Fotó később” felirat áll (src/components/blocks/Services.tsx). A
 * tartalék-szöveg a src/lib/home-help-states.ts konstansaiból jön (import,
 * nem másolat), így a súgó nem avulhat el a laptól. A tartalékot a súgó
 * mondja ki, NEM a mező helyőrzője: a helyőrző gépelésre eltűnik, és kitöltött
 * értéknek látszik (NN/g, Form Design: Placeholders:
 * https://www.nngroup.com/articles/form-design-placeholders/; GOV.UK Design
 * System, Text input, Hint text:
 * https://design-system.service.gov.uk/components/text-input/#hint-text).
 */

/** Blokk-szintű mező, amely csak Táblánál hat (Kép); üres elrendezésnél is látszik. */
export const tablaBlokkMezoLatszik = (
  _data: unknown,
  siblingData: { elrendezes?: unknown } | undefined,
): boolean => siblingData?.elrendezes !== 'sin'

/**
 * Sor-szintű mező: a `rows` tömbön belül a `siblingData` a sor, az
 * elrendezés a blokké, ezért a Payload 3.88 `Condition` harmadik
 * argumentumának `blockData` mezője kell (a legközelebbi szülő blokk adata;
 * payload/dist/fields/config/types.d.ts `Condition`).
 */
interface SorFeltetelKornyezet {
  blockData?: { elrendezes?: unknown } | null
}

/** Sor-mező, amely csak Táblánál hat (Sorszám). */
export const tablaSorMezoLatszik = (
  _data: unknown,
  _siblingData: unknown,
  kornyezet: SorFeltetelKornyezet | undefined,
): boolean => kornyezet?.blockData?.elrendezes !== 'sin'

/** Sor-mező, amely csak Sínnél hat (Rövid összegzés, Panel fotója). */
export const sinSorMezoLatszik = (
  _data: unknown,
  _siblingData: unknown,
  kornyezet: SorFeltetelKornyezet | undefined,
): boolean => kornyezet?.blockData?.elrendezes === 'sin'

/** A kezdőlapi sín ajtónkénti tartalék-összegzése, a konstansokból. */
const OSSZEGZES_TARTALEKOK = HOME_HELP_STATES.map(
  (state) => `${state.title}: „${state.osszefoglalo}”`,
).join('; ')

export const SERVICES_SUGO = {
  eyebrow: `A cím fölötti apró szöveg (pl. „Szolgáltatásaink”). Nem kötelező. Ha üresen hagyod, nem jelenik meg semmi; kivétel a kezdőlapon a közvetlenül a sín előtt álló tábla, ott „${HOME_USPS_EYEBROW}” látszik.`,
  title: `A szekció címe (pl. „Így tudunk segíteni”). Ha üresen hagyod, a kezdőlapi sínen „${HOME_HELP_TITLE}” látszik, máshol a szekció cím nélkül jelenik meg.`,
  lead: `A cím alatti bekezdés. Sín-elrendezésnél ide kerül a három út rövid magyarázata. Nem kötelező. Ha üresen hagyod, a kezdőlapi sínen ez látszik: „${HOME_HELP_LEAD}” Más oldalon ilyenkor nincs bevezető.`,
  elrendezes:
    'Tábla: bal oldalon kép, mellette számozott sorok. Sín és panel: bal oldalon ajtóválasztó, jobb oldalon a kiválasztott sor szövege és fotója. A lapon ez a választás látszik. A választástól függ, mely mezők jelennek meg: a Kép és a Sorszám csak táblánál, a Rövid összegzés és a Panel fotója csak sínnél. Az elrejtett mező tartalma megmarad, visszaváltáskor újra látszik. Új blokknál a tábla az alap.',
  image: `A tábla sorai mellé kerülő kép (pl. terapeuta keze munka közben). Nem kötelező. ${KEP_CSERE_SUGO}`,
  number: 'Nem kötelező. Pl. „01” vagy „1”. Ha üresen hagyod, a rendszer maga számoz.',
  osszefoglalo: `A sín rövid második sora és a panel félkövér bevezetője. Nem kötelező. Ha üresen hagyod, a kezdőlapon az ajtó beépített mondata látszik (${OSSZEGZES_TARTALEKOK}). Más oldalon ilyenkor a sor összegzés nélkül jelenik meg.`,
  photo: `A panel jobb oldali képe. Arckép csak a tulajdonos által kijelölt fotóból. Ha üresen hagyod, a kezdőlapon és a Szolgáltatások oldalon az ajtó beépített fotója látszik (rendelő, otthoni program vagy szakmai képzés, a sor címe, webcíme vagy helye szerint). Más oldalon ilyenkor a kép helyén „Fotó később” felirat áll. ${KEP_CSERE_SUGO}`,
  hatterKiegeszites:
    'Sín-elrendezésnél a Fehér helyett is világoskék látszik, a Sötétkék megmarad. A kezdőlapon a közvetlenül a sín előtt álló tábla Fehér háttere is világoskékre vált, hogy a két szekció elváljon.',
} as const

/**
 * A közös Szekció-beállítások (src/blocks/section-settings.ts) a services
 * blokkban: a Háttér súgója kiegészül azzal, amit a kód ténylegesen tesz
 * (`presentHomeHelpServicesBlock`, `presentSzolgaltatasokLayout`: a sín
 * `tint`, a `sotet` marad; a Services sín-ága a Fehéret is tintnek rajzolja;
 * `presentBlockBeforeHomeHelp`: a sín előtti tábla paper hátterét tintre
 * váltja). A közös függvényhez nem nyúlunk, más blokk súgója változatlan.
 * A súgó nem séma: a drizzle-séma és a migráció-snapshot nem változik (G2).
 * A `sectionSettings` csoport a #292 óta a „Megjelenés és elrejtés” csukott
 * része (collapsible) alatt áll, ezért a Háttér mezőt a bejáró a collapsible
 * és a group mezőin át keresi, a szerkezetet nem változtatja.
 * Forrás: NN/g, 10 Usability Heuristics, #1 Visibility of System Status
 * (https://www.nngroup.com/articles/ten-usability-heuristics/); WCAG 2.2
 * SC 3.3.2 Labels or Instructions
 * (https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).
 */
const hatterSugoKiegeszitve = (mezo: Field): Field => {
  if (mezo.type === 'collapsible') {
    return { ...mezo, fields: mezo.fields.map(hatterSugoKiegeszitve) }
  }
  if (mezo.type === 'group') {
    return { ...mezo, fields: mezo.fields.map(hatterSugoKiegeszitve) }
  }
  if (mezo.type !== 'select' || mezo.name !== 'hatter') return mezo
  const alap = typeof mezo.admin?.description === 'string' ? mezo.admin.description : ''
  return {
    ...mezo,
    admin: {
      ...mezo.admin,
      description:
        alap.length > 0
          ? `${alap} ${SERVICES_SUGO.hatterKiegeszites}`
          : SERVICES_SUGO.hatterKiegeszites,
    },
  }
}

const servicesSectionSettings = (): Field => hatterSugoKiegeszitve(sectionSettings())

export const services: Block = {
  slug: 'services',
  interfaceName: 'BlockServices',
  labels: {
    singular: 'Képes lista vagy kártyák',
    plural: 'Képes listák és kártyák',
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
        description: SERVICES_SUGO.eyebrow,
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: SERVICES_SUGO.title,
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető',
      admin: {
        description: SERVICES_SUGO.lead,
      },
    },
    {
      name: 'elrendezes',
      type: 'select',
      defaultValue: 'tabla',
      label: 'Elrendezés',
      options: [
        { label: 'Tábla (kép + számozott sorok)', value: 'tabla' },
        { label: 'Sín és panel (három szolgáltatás-ajtó)', value: 'sin' },
      ],
      admin: {
        description: SERVICES_SUGO.elrendezes,
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Kép',
      admin: {
        condition: tablaBlokkMezoLatszik,
        description: SERVICES_SUGO.image,
      },
    },
    {
      name: 'rows',
      type: 'array',
      label: 'Sorok',
      minRows: 1,
      maxRows: 5,
      labels: { singular: 'Sor', plural: 'Sorok' },
      admin: {
        description:
          'Táblánál egy sor = egy szolgáltatás. Sínnél egy sor = egy ajtó (Rendelői kezelések, Otthoni program, Szakmai képzések). Legfeljebb 5.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'number',
          type: 'text',
          label: 'Sorszám',
          admin: {
            condition: tablaSorMezoLatszik,
            description: SERVICES_SUGO.number,
          },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Cím',
          admin: {
            description: 'A szolgáltatás-ajtó neve (pl. „Rendelői kezelések”, „Otthoni program”).',
          },
        },
        {
          name: 'osszefoglalo',
          type: 'text',
          label: 'Rövid összegzés',
          admin: {
            condition: sinSorMezoLatszik,
            description: SERVICES_SUGO.osszefoglalo,
          },
        },
        {
          name: 'body',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
          admin: { description: '2–4 mondat arról, kinek és miben segít.' },
        },
        {
          name: 'photo',
          type: 'upload',
          relationTo: 'media',
          label: 'Panel fotója',
          admin: {
            condition: sinSorMezoLatszik,
            description: SERVICES_SUGO.photo,
          },
        },
        // A felirat-súgó története (K27). 2026-08-18-ig a súgó példája a
        // „Tovább a kezelésekre” volt; akkor igés, célt megnevező példára
        // cserélték, és a súgó minden „Tovább…” kezdést tiltottnak mondott.
        // Ez túllőtt: a docs/ui-sztenderdek.md §3.1.4 M-7 csak a PUSZTA, célt
        // nem nevező „Tovább” szót tiltja, a rendelői ajtó élő „Tovább a
        // kezelésekre” feliratát pedig a tulajdonos jóváhagyta
        // (src/lib/home-help-states.ts fejkommentje, §3.2 #40). A súgó ezért
        // mindkét elfogadott alakot mutatja, és csak az önmagában álló
        // „Tovább” szót zárja ki. Források: GOV.UK, Add links: „make it
        // descriptive and avoid generic text like 'click here' or 'more'”
        // (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/);
        // NN/g, Better Link Labels: „A link's primary purpose is to communicate
        // to users what they'll find on the other side of a click.”
        // (https://www.nngroup.com/articles/better-link-labels/).
        ...linkFields({
          labelDescription:
            'A sor végi hivatkozás szövege. Nevezd meg, hova visz (pl. „Tovább a kezelésekre” vagy „Nézd meg a kezeléseket”). Az önmagában álló „Tovább” nem mondja meg, mi történik.',
        }),
      ],
    },
    servicesSectionSettings(),
  ],
}
