import type { Block } from 'payload'

/** A kurzus leírásába illeszthető csomaglista; csak szöveg és rögzített ikonok. */
export const coursePackage: Block = {
  slug: 'coursePackage',
  interfaceName: 'CoursePackageBlock',
  labels: { singular: 'Kurzuscsomag', plural: 'Kurzuscsomagok' },
  fields: [
    { name: 'heading', type: 'text', required: true, label: 'Szakasz címe' },
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      maxRows: 12,
      label: 'A csomag tartalma',
      labels: { singular: 'Elem', plural: 'Elemek' },
      fields: [
        {
          name: 'icon',
          type: 'select',
          label: 'Ikon',
          defaultValue: 'book',
          options: [
            { label: 'Lejátszás', value: 'play' },
            { label: 'Videó', value: 'video' },
            { label: 'Időtartam', value: 'clock' },
            { label: 'Pajzs', value: 'shield' },
            { label: 'Tananyag', value: 'book' },
            { label: 'Dokumentum', value: 'file' },
            { label: 'Szakemberek', value: 'users' },
          ],
        },
        { name: 'title', type: 'text', required: true, label: 'Megnevezés' },
        { name: 'description', type: 'textarea', label: 'Rövid leírás' },
      ],
    },
  ],
}
