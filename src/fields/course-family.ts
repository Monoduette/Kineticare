import type { Field, FieldHook, Where } from 'payload'

import { isOwnerFieldAccess } from '../access'

/**
 * Témakurzus-mezők a products collectionön (src/lib/course-family.ts a szabály).
 *
 * `parentCourses` („Teljes program, amelynek része”): owner-only írás, mert
 * ugyanolyan súlyú döntés, mint az ár vagy a rejtettség: eldönti, hogy egy
 * vevőnek fizetnie kell-e, vagy a pénztár elutasítja (TILOS ZÓNA 4, emberi
 * review). `maxDepth: 0`: a kapcsolt kurzus SOHA nem töltődik be populate-olva,
 * így a teljes program tananyaga (lecke-szöveg, Bunny-azonosító) semmilyen
 * `depth` mellett nem kerülhet a témakurzus válaszába; a megjelenítéshez
 * kell adatot a hívó külön, szűk `select`-tel kéri le.
 *
 * Duplikáláskor üres: a másolatot a tulajdonos köti újra programhoz, így a
 * duplikált teljes program nem válik véletlenül témakurzussá, és fordítva.
 */

const clearOnDuplicate: FieldHook = () => []

export const parentCoursesField: Field = {
  name: 'parentCourses',
  type: 'relationship',
  relationTo: 'products',
  hasMany: true,
  maxDepth: 0,
  label: 'Teljes program, amelynek része',
  access: {
    create: isOwnerFieldAccess,
    update: isOwnerFieldAccess,
  },
  // A választólista csak olyan kurzust kínál, amelyik maga nem témakurzus, és
  // nem önmaga. A szerver a mentés-őrben (course-family-guard.ts) is ellenőriz.
  filterOptions: ({ id }) => {
    const and: Where[] = [{ parentCourses: { exists: false } }]
    if (typeof id === 'number') and.push({ id: { not_equals: id } })
    return { and }
  },
  hooks: { beforeDuplicate: [clearOnDuplicate] },
  admin: {
    description:
      'Csak témakurzusnál töltsd ki, és csak akkor, ha a témakurzus teljes anyaga benne van a kiválasztott programban. Aki a programot megvette, ezen az oldalon nem vásárlógombot lát, hanem a programja linkjét, és a pénztár sem engedi újra fizetni. Csak a tulajdonos állíthatja.',
  },
}

/**
 * A kurzusoldal elrendezése. A „Fotós fejléc” az akciós sablonból általánosított
 * landing-elrendezés (src/components/courses/promo/PromoCourseView.tsx), az
 * „Oldalsó vásárlódoboz” a mai rendes kurzusoldal. Megjelenési döntés, nem ár:
 * a munkatárs is állíthatja. Élő akció idején a kurzusoldal mindig a fotós
 * fejlécet kapja (a mai viselkedés).
 */
export const pageLayoutField: Field = {
  name: 'pageLayout',
  type: 'select',
  label: 'Kurzusoldal kinézete',
  defaultValue: 'standard',
  options: [
    { label: 'Oldalsó vásárlódoboz', value: 'standard' },
    { label: 'Fotós fejléc', value: 'landing' },
  ],
  admin: {
    description:
      'A „Fotós fejléc” teljes szélességű fejlécet ad a borítóképpel (kép nélkül sötét háttérrel), alatta a kurzus szakaszaival és az árral. Témakurzushoz ezt ajánljuk. Élő akció idején a kurzusoldal mindig a fotós fejlécet kapja.',
  },
}
