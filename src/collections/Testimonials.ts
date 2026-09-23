import type { CollectionConfig } from 'payload'

/**
 * Vélemények (páciens-visszajelzések).
 *
 * A kezdőlap M6 modulja ebből a collectionből épül: legfeljebb 3 kiemelt
 * (`featured`) és látható (`visible`) vélemény jelenik meg, `order` szerint.
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

/** A rövid változat felső határa — ennél hosszabb már nem „1–2 mondat". */
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
    defaultColumns: ['authorName', 'authorTitle', 'featured', 'order', 'visible'],
    description:
      'Páciensek valódi visszajelzései. A kezdőlapon legfeljebb 3 kiemelt vélemény jelenik meg.',
  },
  fields: [
    {
      name: 'quote',
      type: 'textarea',
      required: true,
      label: 'Teljes szöveg',
      admin: {
        description: 'A vélemény teljes, eredeti szövege, pontosan úgy, ahogy elhangzott.',
      },
    },
    {
      name: 'shortQuote',
      type: 'textarea',
      label: 'Rövid idézet',
      admin: {
        description: `Rövid, 1–2 mondatos változat a főoldalra (legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter). Ha üresen hagyod, a kezdőlapon a Teljes szöveg jelenik meg, ezért hosszú véleménynél töltsd ki.`,
      },
      validate: (value: string | null | undefined) => {
        if (typeof value === 'string' && value.trim().length > SHORT_QUOTE_MAX_LENGTH) {
          return `A rövid változat legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter lehet (jelenleg ${value.trim().length}).`
        }
        return true
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
        description: 'Nem kötelező — pl. „zenész, műsorvezető".',
      },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      label: 'Kiemelt',
      admin: {
        description:
          'Főoldalon megjelenik (a Sorrend szerinti első 3 kiemelt). Kiemeléshez rövid változat kell, vagy elég rövid teljes szöveg.',
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
  ],
}
