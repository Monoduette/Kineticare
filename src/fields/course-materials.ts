import type { ArrayField } from 'payload'

import { courseContentReadAccess } from '../access/courseContentRead'

/**
 * products.materials: a KURZUS egészéhez tartozó segédanyagok (például a
 * gyakorlatfüzet az ismétlésszámokkal). A leckéhez csatolt melléklet
 * (`modules.lessons.attachments`) csak annál az egy leckénél látszik; ami a
 * teljes kurzushoz kell, annak állandó hely jár, mert a vevő gyakorlás közben
 * bármelyik leckéről keresi.
 *
 * Forrás a külön, állandó helyre:
 *  - GOV.UK, Content design: Links, a fájlra ne elszórt linkek mutassanak,
 *    hanem egy állandó oldal (https://www.gov.uk/guidance/content-design/links)
 *  - NN/g, Avoid PDF for On-Screen Reading, a PDF-hez kapuoldal kell, a link
 *    mellett a formátummal és a mérettel
 *    (https://www.nngroup.com/articles/avoid-pdf-for-on-screen-reading/)
 *
 * Csak védett kurzusfájl választható: a fizetős anyag nem kerülhet nyilvános
 * webcímre. A letöltési jogot a src/access/courseFileRead.ts adja ki.
 */
export const COURSE_MATERIALS_ADMIN_DESCRIPTION =
  'Az egész kurzushoz tartozó anyagok, például a gyakorlatfüzet. A vásárló minden lecke alatt és a Kurzusaim oldalon is megtalálja. Előbb mentsd el a kurzust, majd tölts fel hozzá védett kurzusfájlt (PDF vagy kép, legfeljebb 10 MB).'

export const courseMaterialsField: ArrayField = {
  name: 'materials',
  type: 'array',
  label: 'Segédanyagok a kurzushoz',
  labels: { singular: 'Segédanyag', plural: 'Segédanyagok' },
  access: { read: courseContentReadAccess },
  admin: { description: COURSE_MATERIALS_ADMIN_DESCRIPTION },
  fields: [
    {
      name: 'label',
      type: 'text',
      label: 'Megnevezés',
      admin: {
        description: 'Ezt látja a vásárló, például „Gyakorlatfüzet”. Ha üres, a fájl neve áll ott.',
      },
    },
    {
      name: 'protectedFile',
      type: 'upload',
      relationTo: 'course-files',
      required: true,
      label: 'Védett kurzusfájl',
      filterOptions: ({ id }) => (typeof id === 'number' ? { course: { equals: id } } : false),
    },
  ],
}
