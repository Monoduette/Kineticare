import type { CollectionConfig } from 'payload'

import { HOL_LATSZIK_OSZLOP } from '../lib/admin/velemeny-helye'

/**
 * Vélemények (páciens-visszajelzések).
 *
 * A weboldal minden Vélemények szekciója (a kezdőlap M6 modulja és bármely
 * oldal `testimonials` blokkja) ebből a collectionből épül: a kiemelt
 * (`featured`) és látható (`visible`) vélemények közül a Sorrend szerinti első
 * három, minden szekcióban ugyanaz (src/lib/cms.ts `getTestimonials`). A
 * Kapcsolat oldal üres listát ad (kapcsolat/page.tsx). Hogy melyik vélemény
 * hol látszik, a lista „Hol látszik” oszlopa mutatja
 * (src/lib/admin/velemeny-helye.ts, modul-térkép H43).
 * Szándékosan EGYSZERŰ collection: nincs verziózás/piszkozat — egy vélemény
 * vagy látszik, vagy nem, ezt a `visible` pipa dönti el.
 *
 * FONTOS tartalmi szabály: ide kizárólag VALÓS, elhangzott vélemények
 * kerülhetnek, betűhíven. Kitalált vagy „szépített" visszajelzés tilos.
 *
 * Access: a centrális politika (src/access/policies.ts) applikálja rá a
 * `visibleTestimonialsOrAdmin` read-szabályt és a staff/owner írást — a
 * bekötés az src/plugins/ecommerce.ts config-pipeline-jában történik
 * (applyCollectionAccessPolicies), ahogy a pages/posts/menus/categories/media
 * esetében is.
 */

/** A rövid változat felső határa: ennél hosszabb már nem „egy-két mondat”. */
export const SHORT_QUOTE_MAX_LENGTH = 260

/**
 * Egy szöveges mező értéke a Payload ismeretlen alakú `siblingData`-jából.
 * (A checkbox-validate típusa `unknown` testvéradatot ad, ezért kell a szűkítés.)
 */
const readTextField = (source: unknown, key: string): string => {
  if (typeof source !== 'object' || source === null) {
    return ''
  }
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Kiemelt vélemény ellenőrzése: a kezdőlapra rövid szöveg való.
 *
 * A megjelenítés a `shortQuote || quote` szabályt követi (lásd
 * TestimonialsSection), ezért rövid változat NÉLKÜL a teljes szöveg kerül ki —
 * hosszú idézetnél ez tolná szét a kezdőlapot (UX-skill M6). A kiemelésnél
 * tehát vagy legyen rövid változat, vagy legyen maga a teljes szöveg elég rövid.
 *
 * Tiszta függvény (tesztelhetőség), a `featured` mező `validate`-je ezt hívja.
 */
export const validateFeaturedTestimonial = (
  featured: unknown,
  siblingData: unknown,
): string | true => {
  if (featured !== true) {
    return true
  }
  if (readTextField(siblingData, 'shortQuote').length > 0) {
    return true
  }
  if (readTextField(siblingData, 'quote').length > SHORT_QUOTE_MAX_LENGTH) {
    return `Kiemelt véleményhez adj meg rövid változatot, vagy legyen a teljes szöveg legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter.`
  }
  return true
}

export const Testimonials: CollectionConfig = {
  slug: 'testimonials',
  labels: {
    singular: 'Vélemény',
    plural: 'Vélemények',
  },
  admin: {
    useAsTitle: 'authorName',
    group: 'Tartalom',
    defaultColumns: ['authorName', 'holLatszik', 'authorTitle', 'featured', 'order', 'visible'],
    // H43/1: a leírás azt mondja, amit a weboldal kódja tesz (cms.ts
    // `getTestimonials`, kapcsolat/page.tsx), és megnevezi az oszlopot, amely
    // soronként megmutatja. NN/g, Visibility of System Status,
    // https://www.nngroup.com/articles/visibility-system-status/; NN/g, Match
    // Between the System and the Real World (a szerkesztő szavaival: pipa,
    // Sorrend, szekció), https://www.nngroup.com/articles/match-system-real-world/
    description: `Páciensek valódi visszajelzései. A Kiemelt és Látható pipás vélemények közül a Sorrend szerinti első három jelenik meg, minden Vélemények szekcióban ugyanaz (a Kapcsolat oldal kivételével). Amelyik vélemény nem kerül az első háromba, az sehol nem jelenik meg. Hogy melyik vélemény hol látszik, a „${HOL_LATSZIK_OSZLOP}” oszlop mutatja.`,
  },
  fields: [
    // H43/3: a Rövid idézet a Teljes szöveg ELŐTT áll, mert a weboldalon az
    // látszik, ha ki van töltve: a szerkesztő azt látja elsőnek, ami kikerül.
    // Csak admin-sorrend: a G2 (schema-config-sync) a mezőket név szerint
    // veti össze, adatbázis-változás nincs. NN/g, Visual Hierarchy in UX,
    // https://www.nngroup.com/articles/visual-hierarchy-ux-definition/; GOV.UK
    // Design System, Question pages (a kérdések sorrendje a feladatot kövesse),
    // https://design-system.service.gov.uk/patterns/question-pages/
    {
      name: 'shortQuote',
      type: 'textarea',
      label: 'Rövid idézet',
      admin: {
        description: `Rövid, egy-két mondatos változat a weboldalra (legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter). Ha üresen hagyod, a weboldalon a Teljes szöveg jelenik meg, ezért hosszú véleménynél töltsd ki.`,
      },
      validate: (value: string | null | undefined) => {
        if (typeof value === 'string' && value.trim().length > SHORT_QUOTE_MAX_LENGTH) {
          return `A rövid változat legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter lehet (jelenleg ${value.trim().length}).`
        }
        return true
      },
    },
    {
      name: 'quote',
      type: 'textarea',
      required: true,
      label: 'Teljes szöveg',
      admin: {
        description:
          'A vélemény teljes, eredeti szövege, pontosan úgy, ahogy elhangzott. Ha a Rövid idézet ki van töltve, a weboldalon az látszik, ez nem.',
      },
    },
    {
      name: 'authorName',
      type: 'text',
      required: true,
      label: 'Név',
      admin: {
        description: 'Aki a véleményt mondta (pl. „Garami Gábor" vagy „P. Benjámin").',
      },
    },
    {
      name: 'authorTitle',
      type: 'text',
      label: 'Titulus, foglalkozás',
      admin: {
        description: 'Nem kötelező, pl. „zenész, műsorvezető”.',
      },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      label: 'Kiemelt',
      admin: {
        description:
          'A Sorrend szerinti első három kiemelt vélemény jelenik meg a weboldal Vélemények szekcióiban. Kiemeléshez rövid változat kell, vagy elég rövid teljes szöveg.',
      },
      validate: (value: boolean | null | undefined, { siblingData }: { siblingData?: unknown }) =>
        validateFeaturedTestimonial(value, siblingData),
    },
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      label: 'Sorrend',
      admin: {
        description: 'A megjelenés sorrendje (kisebb szám = előrébb).',
      },
    },
    {
      name: 'visible',
      type: 'checkbox',
      defaultValue: true,
      label: 'Látható',
      admin: {
        description: 'Ha kiveszed a pipát, a vélemény sehol nem jelenik meg, de nem vész el.',
      },
    },
    {
      // H43/4: a lista „Hol látszik” oszlopa. Adata nincs: a szerveroldali
      // cella a weboldal véleménylistájából és a közzétett oldalak
      // szekciósorából számol (src/lib/admin/velemeny-helye.ts). A
      // szerkesztőben nem rajzol semmit (ui-mező Field komponens nélkül),
      // ugyanúgy, mint az Oldalak „Mi ez” oszlopa (Pages.ts `oldalFajta`).
      name: 'holLatszik',
      type: 'ui',
      label: HOL_LATSZIK_OSZLOP,
      admin: {
        components: {
          Cell: '/components/admin/TestimonialPlacementCell#TestimonialPlacementCell',
        },
      },
    },
  ],
}
