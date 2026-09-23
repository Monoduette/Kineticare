import type { CollectionConfig, Field } from 'payload'

import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import { seoKeywordsField } from '../fields/seo-keywords'
import { slugField } from '../fields/slug'
import { hubBlogbejegyzesbol } from '../lib/admin/kotott-cimek'
import { relatedPostsFilter, staffOrOwnerUserFilter } from '../lib/admin/relationship-filters'
import {
  clearPublishedAtBeforeDuplicate,
  draftStatusBeforeDuplicate,
  forceDraftVersionOnDuplicate,
} from '../lib/duplicate'
import { buildAdminPreviewUrl } from '../lib/preview/preview-target'
import { setPublishedAtOnFirstPublish, syncStatusFromDraftStatus } from '../lib/publish-status'

/**
 * Nap-pontosságú dátum, csak számjegyekkel (pl. 2026. 12. 20.; AkH. 12. kiadás,
 * 295. pont). Hónapnév nem lehet benne: a Payload 3.88 DatePickere friss
 * betöltéskor angol hónapnevet mutat (részletek a Pages.ts azonos állandójánál).
 */
const NAP_MEGJELENITES = { pickerAppearance: 'dayOnly', displayFormat: 'yyyy. MM. dd.' } as const

const slugMezo = slugField('title', { kotottWebcimJelzes: true })

/** A tájékoztató ui-mezők nem listaoszlopok (az oszlopválasztóban sem jelennek meg). */
const NEM_OSZLOP = { disableListColumn: true } as const

/** A 8 Tudástár-hub párja (src/lib/tudastar/hub-oldalak.ts HUB_OLDALAK cikkSlug). */
const hubBlogbejegyzes = (data: unknown): boolean =>
  typeof data === 'object' &&
  data !== null &&
  hubBlogbejegyzesbol((data as Record<string, unknown>).slug) !== null

/**
 * Versions × status viszony: megegyezik a Pages collection leírásával: a
 * `_status` (drafts + autosave) a technikai publikálási állapot, a custom
 * `status` select pedig a nyilvános szűrők (publishedOrAdmin, PUBLISHED_WHERE,
 * sitemap) mezője. A kettőt a `syncStatusFromDraftStatus` hook tartja
 * szinkronban, a custom mező az adminban rejtett, a szerkesztő csak a natív
 * Piszkozat/Közzététel gombokat látja. Duplikáláskor a slug '-masodpeldany'
 * lesz, a status draft, a publishedAt üres, a `_status` draft
 * (src/lib/duplicate.ts hookjai).
 *
 * Szerkesztő (modul-térkép H51): fül nélkül 14 700 px hosszú volt, a
 * keresőmezők (akár 43 kifejezés) a Tartalom és a GYIK közé ékelődtek, a cikk
 * végi ajánló kurzusa a lap legalján állt. Most három NÉV NÉLKÜLI fül: a név
 * nélküli fül csak megjelenítés, a mezők adatútja nem változik (Payload
 * Tabs: a `name` „Groups field data into an object when stored and retrieved
 * from the database”, név nélkül nincs ilyen csoport,
 * https://payloadcms.com/docs/fields/tabs). A fülek a nem egyszerre nézett
 * tartalmat választják szét (NN/g, Tabs, Used Right: „When users don't need
 * to simultaneously see information presented under different tabs.”,
 * https://www.nngroup.com/articles/tabs-used-right/). A fülnevekben nincs
 * vessző: a Payload a közzétételi hibalistát vesszőnél vágja
 * (@payloadcms/ui dist/elements/Toasts/fieldErrors.js). Az oldalsávban a
 * webcím, a dátumok, a szerző, a szakmai ellenőrzés és a kategóriák; a
 * tájékoztatók a fülek fölött. Séma-semlegesség: G2 (schema-config-sync),
 * változatlan Post-interfész és üres `migrate:create --skip-empty` igazolja.
 */
/**
 * Az Ajánlott kurzus leírása (modul-térkép H27), a PostCourseCta.tsx és a
 * post-article.ts szerint: kurzussal a dobozban a kurzus neve, Rövid leírása
 * és ára áll, a többi szöveg (NO_COURSE_HEADING, APPOINTMENT_* állandók) a
 * kódban van; üresen a doboz a kurzuslistára visz; az APPOINTMENT_CTA_SLUGS
 * blogbejegyzéseinél időpontkérés áll, ott a mező nem hat.
 */
export const AJANLOTT_KURZUS_LEIRAS =
  'A lap végén álló ajánló kurzusa. Itt csak a kurzust választod: a dobozban a kurzus neve, Rövid leírása és ára jelenik meg, a doboz többi szövege a weboldal kódjában van, azt a fejlesztő írja át. Üresen, vagy ha a kurzus nincs közzétéve vagy „Rejtett kurzus”, a doboz a kurzuslistára visz. Néhány blogbejegyzés végén kurzus helyett időpontkérés áll: ezt a weboldal kódjában lévő lista dönti el, és ott ez a mező nem hat.'

/** 1. fül: a látható blogbejegyzés (a lap teteje és törzse). */
const blogbejegyzesFul: Field[] = [
  {
    name: 'title',
    type: 'text',
    required: true,
    label: 'Cím',
    admin: {
      description:
        'A blogbejegyzés nagy címe a lap tetején és a bloglistán. Ha a SEO-cím üres, a böngészőfül és a Google-találat címe is ez.',
    },
  },
  {
    name: 'excerpt',
    type: 'textarea',
    label: 'Rövid bevezető',
    admin: {
      description:
        'Pár mondatos bevezető a blogbejegyzés címe alatt és a bloglista kártyáin. Ha a SEO-leírás üres, a Google-találat leírása is ez.',
    },
  },
  {
    name: 'content',
    type: 'richText',
    required: true,
    label: 'Tartalom',
    admin: {
      description:
        'A blogbejegyzés szövege. A felső eszköztárral formázhatsz, listázhatsz, linkelhetsz.',
    },
  },
  {
    name: 'heroImage',
    type: 'upload',
    relationTo: 'media',
    label: 'Borítókép',
    admin: {
      // A végén a képmezők közös súgója (H34, src/blocks/kep-csere.ts).
      description: `A blogbejegyzés fő képe a bloglistán és a lap tetején. Ha a Megosztási kép üres, megosztáskor is ez látszik; ha ez is üres, a Kineticare alapképe (csapatfotó). ${KEP_CSERE_SUGO}`,
    },
  },
]

/**
 * 2. fül: a lap vége. Az Ajánlott kurzus áll elöl, mert rövid, a GYIK pedig
 * akár hat kinyitott sorral is hosszú: így a fül kiválasztása után mindkettő
 * görgetés nélkül a nézetben van (mérve 2026-09-23-án 1440 × 900-on,
 * eldobható blogbejegyzésen: GYIK-elöl sorrendnél két kinyitott kérdéssel az
 * Ajánlott kurzus teteje 1266 px-en, a nézet alján túl állt). A cikk végi
 * ajánló (PostCourseCta.tsx) szövege a kódban van; itt csak a kurzust választod. Az időpontkérős változatot a webcím
 * dönti el (post-article.ts APPOINTMENT_CTA_SLUGS, postCtaVariantOf), ott ez
 * a mező nem hat. Üres vagy nem felfedezhető kurzusnál (courseCtaTargetOf:
 * nem közzétett vagy „Rejtett kurzus”) a doboz a kurzuslistára visz. A
 * posts-admin-fulek.test.ts köti a sorokhoz.
 */
const gyikEsAjanloFul: Field[] = [
  {
    name: 'ctaCourse',
    type: 'relationship',
    relationTo: 'products',
    label: 'Ajánlott kurzus',
    admin: {
      allowCreate: false,
      description: AJANLOTT_KURZUS_LEIRAS,
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
        'Mások ezt is kérdezik: 2–6 rövid kérdés-válasz a blogbejegyzés végére. A válasz önmagában is megálljon (2–4 mondat), mert a keresők és az AI-válaszok pontosan ezt idézik.',
      // Beszédes sorcímke: „1. <kérdés>”, üresen „3. kérdés (még üres)” (H13).
      components: {
        RowLabel: {
          path: '/components/admin/SectionRowLabel#ArrayRowLabel',
          clientProps: { singular: 'Kérdés', titleFields: ['question'] },
        },
      },
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
  {
    name: 'relatedPosts',
    type: 'relationship',
    relationTo: 'posts',
    hasMany: true,
    maxRows: 3,
    label: 'Kapcsolódó blogbejegyzések',
    filterOptions: relatedPostsFilter,
    admin: {
      allowCreate: false,
      description: 'Legfeljebb 3 másik blogbejegyzés, amelyet a lap alján ajánlunk az olvasónak.',
    },
  },
]

/** 3. fül: a kereső és a megosztási előnézet (a lapon nem látszik). */
const keresoEsMegosztasFul: Field[] = [
  {
    name: 'seoTitle',
    type: 'text',
    label: 'SEO-cím',
    admin: {
      description:
        'A böngészőfül és a Google-találat címe a blogbejegyzés oldalán. Ha üresen hagyod, a Cím kerül oda.',
    },
  },
  {
    name: 'seoDescription',
    type: 'text',
    label: 'SEO-leírás',
    admin: {
      description:
        'A Google-találat rövid leírása a blogbejegyzés oldalán (kb. 150 karakter). Ha üresen hagyod, a Rövid bevezető kerül oda.',
    },
  },
  seoKeywordsField,
  {
    name: 'ogImage',
    type: 'upload',
    relationTo: 'media',
    label: 'Megosztási kép',
    admin: {
      description: `Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja a blogbejegyzést. Ha üres, a Borítókép, annak híján a Kineticare alapképe (csapatfotó) látszik. ${KEP_CSERE_SUGO}`,
    },
  },
]

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: {
    singular: 'Blogbejegyzés',
    plural: 'Blogbejegyzések',
  },
  admin: {
    useAsTitle: 'title',
    group: 'Tartalom',
    defaultColumns: ['title', 'slug', 'categories', '_status', 'publishedAt', 'updatedAt'],
    // Csak az admin-lista keresője, séma nem változik: a webcím egy részére is
    // rá lehet keresni (pl. „keztoalagut”).
    listSearchableFields: ['title', 'slug'],
    description:
      'A Tudástár (blog) blogbejegyzései. A közzétett blogbejegyzések azonnal megjelennek a weboldalon.',
    preview: (doc) => buildAdminPreviewUrl('posts', doc?.slug),
    components: {
      edit: {
        PreviewButton: '/components/admin/ElonezetGomb#ElonezetGomb',
      },
    },
  },
  versions: {
    drafts: {
      // Automatikus piszkozat-mentés (alapértelmezett intervallum).
      autosave: true,
    },
  },
  hooks: {
    beforeValidate: [forceDraftVersionOnDuplicate],
    beforeChange: [syncStatusFromDraftStatus, setPublishedAtOnFirstPublish],
  },
  fields: [
    {
      // Közzétételi állapot, visszaállítás (csak megjelenítés, nincs oszlopa).
      name: 'kozzetetelAllapot',
      type: 'ui',
      admin: {
        ...NEM_OSZLOP,
        components: { Field: '/components/admin/ElonezetAllapot#ElonezetAllapot' },
      },
    },
    {
      // A Tudástár-hub párja (H05): ez a blogbejegyzés a hub-Oldalon is
      // megjelenik, ott a metaadatot az Oldal adja. A fülek fölött.
      name: 'hubTajekoztato',
      type: 'ui',
      admin: {
        ...NEM_OSZLOP,
        condition: (data) => hubBlogbejegyzes(data),
        components: { Field: '/components/admin/HubPageNotice#HubPageNotice' },
      },
    },
    {
      type: 'tabs',
      tabs: [
        { label: 'Blogbejegyzés', fields: blogbejegyzesFul },
        { label: 'GYIK és ajánló', fields: gyikEsAjanloFul },
        { label: 'Kereső és megosztás', fields: keresoEsMegosztasFul },
      ],
    },
    {
      ...slugMezo,
      admin: { ...slugMezo.admin, position: 'sidebar' },
    },
    {
      // Közvetlenül a Webcím alatt: a kódhoz kötött webcím átírásának
      // figyelmeztetése és a „Visszaállítom” gomb (H48, nem blokkoló).
      name: 'kotottWebcim',
      type: 'ui',
      admin: {
        ...NEM_OSZLOP,
        position: 'sidebar',
        components: { Field: '/components/admin/KotottWebcimNotice#KotottWebcimNotice' },
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
        // Rejtett: a natív Piszkozat/Közzététel gomb az egyetlen kapcsoló,
        // ezt a mezőt a syncStatusFromDraftStatus hook tölti automatikusan. A
        // lista oszlopválasztójában ez volt a második „Állapot” (a _status
        // mellett), ezért onnan is kivesszük.
        hidden: true,
        ...NEM_OSZLOP,
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
        position: 'sidebar',
        description:
          'Az első közzététel napja, pl. 2026. 12. 20. Magától kitöltődik; a bloglista ez alapján rendez (a legfrissebb elöl).',
        date: { displayFormat: NAP_MEGJELENITES.displayFormat },
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
        // Holt mező: a `sort: 'order'` csak a vélemények (src/lib/cms.ts) és a
        // menük (src/lib/menus.ts) lekérdezésében él, a blogbejegyzéseket semmi
        // nem rendezi vele. Az oszlop marad (séma), a szerkesztő elől rejtve, a
        // lista oszlopválasztójából is.
        hidden: true,
        ...NEM_OSZLOP,
      },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      label: 'Szerző',
      filterOptions: staffOrOwnerUserFilter,
      // Alapból a bejelentkezett szerkesztő, átállítható, ha más nevében írsz.
      defaultValue: ({ user }) => user?.id,
      admin: {
        position: 'sidebar',
        allowCreate: false,
        description:
          'Alapból te vagy; ha más nevében írod a blogbejegyzést, itt átállíthatod. A szerzői doboz nevét, bemutatkozását és arcképét a Felhasználók között, a munkatárs adatlapján lehet átírni.',
      },
    },
    {
      // A kiválasztott szerző adatlapjára visz (H52).
      name: 'szerzoAdatlap',
      type: 'ui',
      admin: {
        ...NEM_OSZLOP,
        position: 'sidebar',
        components: { Field: '/components/admin/AuthorProfileLink#AuthorProfileLink' },
      },
    },
    {
      name: 'reviewedBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Szakmai ellenőrzést végezte',
      filterOptions: staffOrOwnerUserFilter,
      admin: {
        position: 'sidebar',
        allowCreate: false,
        description:
          'A gyógytornász, aki a blogbejegyzés klinikai állításait a forrásokkal együtt ellenőrizte. A listában csak munkatárs és tulajdonos van.',
      },
    },
    {
      name: 'reviewedAt',
      type: 'date',
      label: 'Utolsó szakmai ellenőrzés',
      admin: {
        position: 'sidebar',
        description:
          'Az utolsó szakmai ellenőrzés napja, pl. 2026. 12. 20. Csak akkor töltsd ki, ha az ellenőrzés tényleg megtörtént.',
        // Csak NAP, óra nélkül: a mező leírása napról beszél, a cikkoldalon
        // pedig a `formatPostDate` amúgy is dátumot mutat (PostAuthorBox,
        // az NHS „Page last reviewed” mintája). Óraválasztót felkínálni olyan
        // pontosságot ígérne, aminek se jelentése, se megjelenése nincs.
        // Kizárólag megjelenítés: az oszlop marad `timestamp`, séma nem változik.
        date: { ...NAP_MEGJELENITES },
      },
    },
    {
      name: 'nextReviewAt',
      type: 'date',
      label: 'Következő ellenőrzés',
      admin: {
        position: 'sidebar',
        description:
          'A következő tervezett ellenőrzés napja, az NHS-minta szerint jellemzően 2 év múlva, pl. 2028. 12. 20.',
        // Lásd a `reviewedAt` indoklását: nap-pontosság, megjelenítés-szintű.
        date: { ...NAP_MEGJELENITES },
      },
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      label: 'Kategóriák',
      admin: {
        position: 'sidebar',
        description: 'Melyik témakörökbe tartozik a blogbejegyzés. Több is választható.',
      },
    },
  ],
}
