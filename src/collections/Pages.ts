import type { Block, CollectionConfig, Field } from 'payload'

import { pageBlocks } from '../blocks'
import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import { SECTION_SETTINGS_LABEL } from '../blocks/section-settings'
import { seoKeywordsField } from '../fields/seo-keywords'
import { slugField } from '../fields/slug'
import { hubOldalbol, OLDAL_FAJTA_OSZLOP } from '../lib/admin/kotott-cimek'
import { staffOrOwnerUserFilter } from '../lib/admin/relationship-filters'
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
 *
 * Szerkesztői felület (K17, K19, K25, K40, K52): a mezők leírása azt mondja,
 * ami a lapon tényleg történik (a route-ok kódja szerint, lásd
 * src/components/admin/HomePageEditNotice.tsx). A tájékoztatók `type: 'ui'`
 * mezők, a mellékmezők az oldalsávban állnak (`admin.position`), a rejtett
 * Sorrend `admin.hidden`: mind csak megjelenítés, adatbázis-oszlop nem
 * változik (a G2 őr, src/__tests__/schema-config-sync.test.ts igazolja).
 *
 * 2. kör (modul-térkép H04, H05, H13, H26, H47, H48, H52): a leírások az
 * igazság-tábla szerint (hat oldal × tíz mező, a route-ok kódjából és a
 * helyi példány anonim HTML-jéből mérve) mondják, mi hat a lapon, a
 * <title>-ben, a meta leírásban és a megosztási képben. A tájékoztató
 * ui-mezők `admin.disableListColumn`-t kapnak, mert a lista oszlopválasztója
 * a nevükből képzett, ékezet nélküli címkével kínálta fel őket (mérve
 * 2026-09-23-án); a rejtett `status` és `order` ugyanígy, mert a választóban
 * a második „Állapot” és a „Sorrend” ezek voltak. A „Mi ez” oszlop az
 * egyetlen listázható ui-mező. Az Oldalak NEM kapnak fület (vezetői döntés,
 * H04): a mélylink-nyitó és a tájékoztatók ugrólinkjei a látható Szekciókra
 * épülnek, a Payload pedig megjegyzi a fülállapotot.
 */

/** A blokk emberi neve a katalógusból (a blokkfájl `labels.singular`-ja). */
function blokkNev(blocks: readonly Block[], slug: string, tartalek: string): string {
  const singular = blocks.find((block) => block.slug === slug)?.labels?.singular
  return typeof singular === 'string' && singular.trim().length > 0 ? singular : tartalek
}

/** Van-e az oldalnak legalább egy szekciója (a UI-tájékoztatók feltétele). */
const vanSzekcio = (data: unknown): boolean => {
  if (typeof data !== 'object' || data === null) return false
  const layout = (data as Record<string, unknown>).layout
  return Array.isArray(layout) && layout.length > 0
}

/**
 * Nap-pontosságú dátum, csak számjegyekkel (pl. 2026. 12. 20.; AkH. 12. kiadás,
 * 295. pont: „2014. 02. 28.” helyes keltezés,
 * https://helyesiras.mta.hu/helyesiras/default/akh12).
 *
 * Hónapnév NEM lehet a formátumban: a Payload 3.88 DatePickere a magyar
 * dátum-nyelvet csak az első render UTÁN, useEffect-ben jegyzi be
 * (@payloadcms/ui/dist/elements/DatePicker/DatePicker.js:108-129), így friss
 * betöltéskor a mező „2026. September 22.” alakot mutatott (mérve
 * 2026-09-23-án a helyi adminban). Magyar felületen az angol szó WCAG 2.2
 * SC 3.1.2 (Language of Parts) hibája is. Őr: oldal-szerkeszto-tajekoztatas.test.tsx.
 */
const NAP_MEGJELENITES = { pickerAppearance: 'dayOnly', displayFormat: 'yyyy. MM. dd.' } as const

/** Az oldal végi GYIK és a Szerző mező címkéje: a tetején álló tájékoztató is ezt idézi. */
const OLDAL_GYIK_CIMKE = 'Oldal végi GYIK'
const SZERZO_CIMKE = 'Szerző'

/** A tájékoztató ui-mezők nem listaoszlopok (az oszlopválasztóban sem jelennek meg). */
const NEM_OSZLOP = { disableListColumn: true } as const

/** A 8 Tudástár-hub Oldala (src/lib/tudastar/hub-oldalak.ts HUB_OLDALAK). */
const hubOldal = (data: unknown): boolean =>
  typeof data === 'object' &&
  data !== null &&
  hubOldalbol((data as Record<string, unknown>).slug) !== null

const slugMezo = slugField('title', { kotottWebcimJelzes: true })

const felsoTajekoztatok: Field[] = [
  {
    name: 'kozzetetelAllapot',
    type: 'ui',
    admin: {
      ...NEM_OSZLOP,
      components: { Field: '/components/admin/ElonezetAllapot#ElonezetAllapot' },
    },
  },
  {
    // A Tudástár-hub ikerdokumentuma (H05): mi jön a blogbejegyzésből, mi innen.
    name: 'hubTajekoztato',
    type: 'ui',
    admin: {
      ...NEM_OSZLOP,
      condition: (data) => hubOldal(data),
      components: { Field: '/components/admin/HubPageNotice#HubPageNotice' },
    },
  },
  {
    name: 'mihelyTajekoztato',
    type: 'ui',
    admin: {
      ...NEM_OSZLOP,
      condition: (data) => vanSzekcio(data),
      components: {
        Field: {
          path: '/components/admin/HomePageEditNotice#HomePageEditNotice',
          clientProps: {
            nyitoBlokkNev: blokkNev(pageBlocks, 'filmHero', 'Nyitó videó'),
            gyikMezoNev: OLDAL_GYIK_CIMKE,
            szerzoMezoNev: SZERZO_CIMKE,
          },
        },
      },
    },
  },
]

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: 'Oldal',
    plural: 'Oldalak',
  },
  admin: {
    useAsTitle: 'title',
    group: 'Tartalom',
    // A „Mi ez” (oldalFajta) a cím mellett: a 8 Tudástár-hub Oldala a
    // blogbejegyzésével azonos címet visel, ez az oszlop különbözteti meg (H05).
    defaultColumns: ['title', 'oldalFajta', 'slug', '_status', 'publishedAt', 'updatedAt'],
    // Csak az admin-lista keresője (a Payload `like` szűrőt épít rájuk), séma
    // nem változik. Így a „kezdolap”, „rolunk”, „szolgaltatasok” keresés is
    // megtalálja az oldalt, nem csak a cím szavai.
    listSearchableFields: ['title', 'slug'],
    // Lapozás (H08/1): a Payload alapból 10 sort mutat, így a kezdőlap a lista
    // 2. oldalára került (admin-audit, admin-oldal.json). A lista alapból a
    // LÉTREHOZÁS szerint rendez, a legújabb elöl (defaultSort nélkül
    // '-createdAt': payload/dist/versions/drafts/getQueryDraftsSort.js), ezért
    // a legrégebbi fő oldalak csúsznak hátra: élesben a 15 közzétett oldal
    // közül a Kapcsolat a 9., a Szolgáltatások a 13., a Rólunk a 14., a
    // kezdőlap a 15. (mérve 2026-09-23-án, a helyi példányon 16 oldalból a
    // kezdőlap a 16.). 25 sorral mind az első lapon van. A választható értékek
    // a Payload `admin.pagination.limits` opciója
    // (https://payloadcms.com/docs/configuration/collections: „Defaults to 10.”).
    // Források: NN/g, Users' Pagination Preferences and „View All” (Nielsen):
    // „the choice between two numbers, say 10 and 50, where the second number
    // is substantially bigger than the default”, és a felső határ „around 100
    // items” (https://www.nngroup.com/articles/item-list-view-all/); NN/g,
    // 10 Usability Heuristics, #6: „Minimize the user's memory load by making
    // elements, actions, and options visible.”
    // (https://www.nngroup.com/articles/ten-usability-heuristics/).
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    description:
      'Önálló aloldalak (pl. Rólunk, Szolgáltatások). A kezdőlapot a listában a „kezdolap” webcímre keresve találod meg.',
    preview: (doc) => buildAdminPreviewUrl('pages', doc?.slug),
    components: {
      // A fő oldalak gyorslinkje a lista fölött (az A-1 komponense, H08, R1 §2):
      // a Kezdőlap, Bemutatkozás, Szolgáltatások, Rólunk és Kapcsolat egy
      // kattintással, a menüben látható névvel.
      beforeListTable: ['/components/admin/GyakoriTeendok#FoOldalakGyorslinkjei'],
      edit: {
        PreviewButton: '/components/admin/ElonezetGomb#ElonezetGomb',
      },
    },
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
    ...felsoTajekoztatok,
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Cím',
      admin: {
        description:
          'Az oldal neve az admin listában. A legtöbb oldalon ez a lap nagy címe (a Kapcsolat oldalon is), és ha a SEO-cím üres, a böngészőfül és a Google-találat címe is. A kezdőlapon, amíg vannak Szekciói, a lapon nem jelenik meg.',
      },
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
      name: 'excerpt',
      type: 'textarea',
      label: 'Rövid bevezető',
      admin: {
        description:
          'A legtöbb oldalon a nagy cím alatti bevezető, és ha a SEO-leírás üres, a Google-találat leírása is. A kezdőlapon, amíg vannak Szekciói, csak az utóbbi. A Kapcsolat oldalon egyik sem: a lapon nem látszik, és üres SEO-leírásnál a weboldal beépített leírása kerül a Google-találatba.',
      },
    },
    {
      name: 'heroImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Fejléckép',
      admin: {
        // A végén a képmezők közös súgója (H34, src/blocks/kep-csere.ts).
        description: `A legtöbb oldalon a lap tetején, a cím mellett vagy alatt álló kép. Ha a Megosztási kép üres, ez látszik a Facebook- és a Messenger-előnézetben; ha ez is üres, a Kineticare alapképe (csapatfotó). A Kapcsolat oldalon a lapon nem jelenik meg, a kezdőlapon sem, amíg annak vannak Szekciói. ${KEP_CSERE_SUGO}`,
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
        // A rész neve a közös állandóból jön, így a leírás a csukott rész
        // fejlécét betűre idézi (WCAG 2.2 SC 3.2.4); a „Látható” pipa neve a
        // sectionSettings() visible mezőjének címkéje (teszt köti össze).
        description: `A lap látható részei, felülről lefelé ebben a sorrendben. Egy szekciót úgy rejthetsz el, hogy a tartalma megmarad: az alján nyisd ki a „${SECTION_SETTINGS_LABEL}” részt, és vedd ki a „Látható” pipát. Ha itt legalább egy szekció van, a lenti Tartalom a lapon nem jelenik meg.`,
      },
    },
    {
      name: 'regiTartalomTajekoztato',
      type: 'ui',
      admin: {
        ...NEM_OSZLOP,
        condition: (data) => vanSzekcio(data),
        components: {
          Field: '/components/admin/HomePageEditNotice#RegiTartalomNotice',
        },
      },
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
      label: 'Tartalom',
      admin: {
        description:
          'A Szekciók nélküli oldalak (például a jogi oldalak) fő szövege. Ha az oldalnak vannak Szekciói, ez a szöveg a lapon nem jelenik meg, a Kapcsolat oldalon pedig Szekciók nélkül sem. A felső eszköztárral formázhatsz, listázhatsz, linkelhetsz.',
      },
    },
    {
      name: 'seoTitle',
      type: 'text',
      label: 'SEO-cím',
      admin: {
        description:
          'A böngészőfül és a Google-találat címe. Ha üresen hagyod, a fenti Cím kerül oda.',
      },
    },
    {
      name: 'seoDescription',
      type: 'text',
      label: 'SEO-leírás',
      admin: {
        description:
          'A Google-találat rövid leírása (kb. 150 karakter). Ha üresen hagyod, a Rövid bevezető kerül oda, a Kapcsolat oldalon a weboldal beépített leírása.',
      },
    },
    seoKeywordsField,
    {
      name: 'ogImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Megosztási kép',
      admin: {
        description: `Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja az oldalt. Ha üres, a Fejléckép, annak híján a Kineticare alapképe (csapatfotó) látszik. ${KEP_CSERE_SUGO}`,
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
          'Az első közzététel napja, pl. 2026. 12. 20. Magától kitöltődik; csak akkor írd át, ha más dátumot akarsz mutatni.',
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
        // menük (src/lib/menus.ts) lekérdezésében él, az oldalakat semmi nem
        // rendezi vele. Az oszlop marad (séma), a szerkesztő elől rejtve, a
        // lista oszlopválasztójából is.
        hidden: true,
        ...NEM_OSZLOP,
      },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      label: SZERZO_CIMKE,
      filterOptions: staffOrOwnerUserFilter,
      // Alapból a bejelentkezett szerkesztő, átállítható, ha más nevében írsz.
      defaultValue: ({ user }) => user?.id,
      admin: {
        position: 'sidebar',
        allowCreate: false,
        description:
          'Alapból te vagy; ha más nevében írod az oldalt, itt átállíthatod. A szerzői doboz a lap alján jelenik meg; a kezdőlapon és a Kapcsolat oldalon nem, a „Tudástár-cikk tükre” oldalakon csak akkor, ha a blogbejegyzés nincs közzétéve. A doboz nevét, bemutatkozását és arcképét a Felhasználók között, a munkatárs adatlapján lehet átírni.',
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
          'A gyógytornász, aki az oldal szakmai állításait a forrásokkal együtt ellenőrizte. A listában csak munkatárs és tulajdonos van.',
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
      name: 'oldalGyikTajekoztato',
      type: 'ui',
      admin: {
        ...NEM_OSZLOP,
        condition: (data) =>
          typeof data === 'object' &&
          data !== null &&
          ['kezdolap', 'kapcsolat'].includes(String((data as Record<string, unknown>).slug)),
        components: {
          Field: {
            path: '/components/admin/HomePageEditNotice#OldalGyikNotice',
            clientProps: { gyikBlokkNev: blokkNev(pageBlocks, 'faq', 'GYIK') },
          },
        },
      },
    },
    {
      name: 'faq',
      type: 'array',
      maxRows: 6,
      label: OLDAL_GYIK_CIMKE,
      labels: { singular: 'Kérdés', plural: 'Kérdések' },
      admin: {
        description:
          'A lap alján (a Szekciók vagy a Tartalom után) jelenik meg; a kezdőlapon és a Kapcsolat oldalon nem, a „Tudástár-cikk tükre” oldalakon csak akkor, ha a blogbejegyzés nincs közzétéve. 2–6 rövid kérdés-válasz; a válasz önmagában is megálljon (2–4 mondat), mert a keresők és az AI-válaszok pontosan ezt idézik.',
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
      // Az Oldalak lista „Mi ez” oszlopa (H05). Adata nincs: a cella a sor
      // webcíméből számol (src/lib/admin/kotott-cimek.ts oldalFajta). A
      // szerkesztőben nem rajzol semmit (ui-mező Field komponens nélkül).
      name: 'oldalFajta',
      type: 'ui',
      label: OLDAL_FAJTA_OSZLOP,
      admin: {
        components: { Cell: '/components/admin/PageKindCell#PageKindCell' },
      },
    },
  ],
}
