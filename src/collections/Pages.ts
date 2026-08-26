import type { CollectionConfig } from 'payload'

import { pageBlocks } from '../blocks'
import { seoKeywordsField } from '../fields/seo-keywords'
import { slugField } from '../fields/slug'
import {
  clearPublishedAtBeforeDuplicate,
  draftStatusBeforeDuplicate,
  forceDraftVersionOnDuplicate,
} from '../lib/duplicate'
import { buildAdminPreviewUrl } from '../lib/preview/preview-target'
import { setPublishedAtOnFirstPublish, syncStatusFromDraftStatus } from '../lib/publish-status'

/**
 * CMS oldalak: `versions.drafts` + rejtett `status` (sync hook). Nyilvános read a
 * `status=published`-re szűr. Duplikálás: slug `-masodpeldany`, draft állapot.
 * Opcionális `layout` szekció-rendszer (docs/szekcio-rendszer-terv.md).
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: 'Oldal',
    plural: 'Oldalak',
  },
  admin: {
    useAsTitle: 'title',
    group: 'Tartalom',
    defaultColumns: ['title', 'slug', '_status', 'publishedAt', 'updatedAt'],
    description:
      'Önálló aloldalak (pl. Rólunk, Szolgáltatások). A kezdőlap tartalma a „kezdolap" webcímű oldalon él.',
    preview: (doc) => buildAdminPreviewUrl('pages', doc?.slug),
  },
  versions: {
    drafts: {
      // Automatikus piszkozat-mentés: a szerkesztő munkája nem veszhet el, ha
      // bezárja a fület. Az alapértelmezett intervallum megfelelő.
      autosave: true,
    },
  },
  hooks: {
    beforeValidate: [forceDraftVersionOnDuplicate],
    // A sorrend számít: előbb a `status` szinkronizálódik a `_status`-ból,
    // utána dől el, hogy ez a mentés az első közzététel-e (publishedAt).
    beforeChange: [syncStatusFromDraftStatus, setPublishedAtOnFirstPublish],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Cím',
      admin: {
        description: 'Az oldal címe — ez jelenik meg a lap tetején és a böngészőfülön.',
      },
    },
    slugField('title'),
    {
      name: 'excerpt',
      type: 'textarea',
      label: 'Rövid bevezető',
      admin: {
        description: 'Pár mondatos összefoglaló; a Google találati listáján is ez jelenhet meg.',
      },
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
      label: 'Tartalom',
      admin: {
        description:
          'Az oldal szövege. A felső eszköztárral formázhatsz, listázhatsz, linkelhetsz.',
      },
    },
    {
      name: 'layout',
      type: 'blocks',
      label: 'Szekciók',
      labels: {
        singular: 'Szekció',
        plural: 'Szekciók',
      },
      blocks: pageBlocks,
      admin: {
        initCollapsed: true,
        description:
          'Az oldal „építőkockás" része. A lap alján lévő + gombbal veszel fel új szekciót; a sorok bal szélén lévő fogantyúval fogd-és-vidd módszerrel átrendezed őket; a szekción belüli Szekció-beállítások → Látható pipával pedig elrejtheted az egyiket úgy, hogy a tartalma megmarad. Ha üresen hagyod, az oldal a megszokott módon jelenik meg — semmi nem vész el.',
      },
    },
    {
      name: 'heroImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Fejléckép',
      admin: {
        description: 'Az oldal tetején megjelenő nagy kép (nem kötelező).',
      },
    },
    {
      name: 'seoTitle',
      type: 'text',
      label: 'SEO-cím',
      admin: {
        description: 'Ha üresen hagyod, a Google a fenti címet használja.',
      },
    },
    {
      name: 'seoDescription',
      type: 'text',
      label: 'SEO-leírás',
      admin: {
        description: 'A Google találati listáján megjelenő rövid leírás (kb. 150 karakter).',
      },
    },
    seoKeywordsField,
    {
      name: 'ogImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Megosztási kép',
      admin: {
        description:
          'Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja az oldalt.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      label: 'Állapot',
      options: [
        { label: 'Piszkozat', value: 'draft' },
        { label: 'Közzétéve', value: 'published' },
      ],
      admin: {
        // Rejtett: a szerkesztő a natív Piszkozat/Közzététel gombokat használja,
        // ezt a mezőt a syncStatusFromDraftStatus hook tölti automatikusan.
        hidden: true,
      },
      hooks: {
        beforeDuplicate: [draftStatusBeforeDuplicate],
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Megjelenés dátuma',
      admin: {
        description:
          'Az első közzétételkor magától kitöltődik. Csak akkor írd át, ha más dátumot akarsz mutatni.',
      },
      hooks: {
        beforeDuplicate: [clearPublishedAtBeforeDuplicate],
      },
    },
    {
      name: 'order',
      type: 'number',
      label: 'Sorrend',
      admin: {
        description: 'A lista- és menürendezéshez használt sorszám (kisebb = előrébb).',
      },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      label: 'Szerző',
      // Alapból a bejelentkezett szerkesztő — átállítható, ha más nevében írsz.
      defaultValue: ({ user }) => user?.id,
      admin: {
        description: 'Alapból te vagy; ha más nevében írod a cikket, itt átállíthatod.',
      },
    },
    {
      name: 'reviewedBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Szakmai ellenőrzést végezte',
      admin: {
        description:
          'A gyógytornász, aki a cikk klinikai állításait a forrásokkal együtt ellenőrizte.',
      },
    },
    {
      name: 'reviewedAt',
      type: 'date',
      label: 'Utolsó szakmai ellenőrzés',
      admin: {
        description:
          'Az utolsó szakmai ellenőrzés napja. Csak akkor töltsd ki, ha az ellenőrzés tényleg megtörtént.',
        // Csak NAP, óra nélkül: a mező leírása napról beszél, a cikkoldalon
        // pedig a `formatPostDate` amúgy is dátumot mutat (PostAuthorBox,
        // az NHS „Page last reviewed" mintája). Óraválasztót felkínálni olyan
        // pontosságot ígérne, aminek se jelentése, se megjelenése nincs.
        // Kizárólag megjelenítés: az oszlop marad `timestamp`, séma nem változik.
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'nextReviewAt',
      type: 'date',
      label: 'Következő ellenőrzés',
      admin: {
        description:
          'A következő tervezett ellenőrzés napja (az NHS-minta szerint jellemzően 2 év).',
        // Lásd a `reviewedAt` indoklását: nap-pontosság, megjelenítés-szintű.
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'faq',
      type: 'array',
      maxRows: 6,
      label: 'Gyakori kérdések (GYIK)',
      labels: { singular: 'Kérdés', plural: 'Kérdések' },
      admin: {
        description:
          'Mások ezt is kérdezik: 2–6 rövid kérdés-válasz a cikk végére. A válasz önmagában is megálljon (2–4 mondat), mert a keresők és az AI-válaszok pontosan ezt idézik.',
      },
      fields: [
        {
          name: 'question',
          type: 'text',
          required: true,
          label: 'Kérdés',
        },
        {
          name: 'answer',
          type: 'textarea',
          required: true,
          label: 'Válasz',
        },
      ],
    },
  ],
}
