import type { Access, CollectionConfig } from 'payload'

import { isStaffOrOwner } from '../access/isStaffOrOwner'

/**
 * Kurzus-haladás: user+product+videoRef sor, csak szerver írja (`mark-watched`).
 * `videoRef` stabil (CMS id / streamAssetId), index SOHA. Unique index + find-then-create.
 */

/**
 * Olvasás: a saját haladását MINDENKI látja (where-constraint a `user` mezőre),
 * staff/owner pedig mindenkiét (a megrendelői igény: „lássuk, ki melyik kurzust
 * végezte el"). Bejelentkezés nélkül semmi.
 *
 * ÚJ access-szabály (CLAUDE.md 4. tilos zóna): meglévő access-függvényt NEM ír
 * át, de merge előtt emberi review kötelező.
 */
export const canReadOwnCourseProgress: Access = ({ req }) => {
  if (isStaffOrOwner({ req })) {
    return true
  }
  if (!req.user) {
    return false
  }
  return { user: { equals: req.user.id } }
}

/** Írás kizárólag a szerveroldali route-ból, overrideAccess-szel. */
const denyWrite: Access = () => false

export const CourseProgress: CollectionConfig = {
  slug: 'course-progress',
  labels: {
    singular: 'Kurzus-haladás',
    plural: 'Kurzus-haladás',
  },
  admin: {
    useAsTitle: 'videoRef',
    // A 24 karakteres hex `videoRef` SZÁNDÉKOSAN kikerült az alapnézetből: az
    // admin UX-audit szerint ez volt a lista legszélesebb oszlopa, és ember
    // számára nulla információt hordoz (nem derül ki belőle, melyik LECKE az).
    // A mező továbbra is elérhető: a sort megnyitva és az oszlopválasztóban is.
    defaultColumns: ['user', 'product', 'watchedAt'],
    // Ugyanaz a csoport, ahol a kurzusok és a rendelések élnek
    // (src/plugins/ecommerce.ts → WEBSHOP_GROUP, src/plugins/admin-groups.ts).
    group: 'Webshop',
    description:
      'Ki melyik kurzus melyik videóját nézte meg. A rendszer tölti a lejátszóból — kézzel nem szerkeszthető, hibás sor törölhető.',
  },
  access: {
    read: canReadOwnCourseProgress,
    create: denyWrite,
    update: denyWrite,
    // Hibás/félrement sor javítása az adminból: törlés staff vagy owner joggal.
    delete: isStaffOrOwner,
  },
  // Idempotencia adatbázis-szinten: ugyanaz a felhasználó ugyanazt a videót
  // egyszer szerepelhet megnézettként.
  indexes: [{ fields: ['user', 'product', 'videoRef'], unique: true }],
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      label: 'Felhasználó',
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
      label: 'Kurzus',
    },
    {
      name: 'videoRef',
      type: 'text',
      required: true,
      index: true,
      label: 'Videó azonosítója',
      admin: {
        description:
          'A videó STABIL azonosítója (a CMS-sor id-ja, ennek hiányában a Bunny videó GUID-ja). Sorszám sosem kerül ide.',
      },
    },
    {
      name: 'watchedAt',
      type: 'date',
      required: true,
      label: 'Megnézve',
      admin: {
        readOnly: true,
        // A sor megnyitva korábban amerikai sorrendben (08/15/2026) jelent meg,
        // miközben a listában magyarul — a hónap 1–12. napjain ez mindkét
        // irányban értelmes, tehát félreolvasható dátumot adott.
        date: { displayFormat: 'yyyy. MM. dd. HH:mm' },
        description: 'A megjelölés időpontja — kizárólag a szerver állítja.',
      },
    },
  ],
}

export default CourseProgress
