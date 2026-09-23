import { revalidateTag } from 'next/cache'
import {
  ValidationError,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeValidateHook,
  type CollectionConfig,
} from 'payload'

import { visibleMenusOrAdmin } from '../access/menus-visibility'
import { rootMenuParentFilter } from '../lib/admin/relationship-filters'
import { MENUS_CACHE_TAG } from '../lib/cache-tags'
import { logger, type Logger } from '../lib/logger'
import {
  clearMismatchedMenuRef,
  filterMenuRefOptions,
  validateMenuParentChain,
  validateMenuTypeConsistency,
  type MenuValidationIssue,
} from '../lib/menu-validation'
import { validateCmsUrl } from '../lib/safe-url'
import { isTudastarKapcsolo } from '../lib/tudastar-kapcsolo'

/**
 * Menüfa-validáció (T-013): max 2 szint (gyökér → gyermek), nincs önmagára
 * mutatás/ciklus, és type-konzisztens cél (url → url kötelező; egyéb type →
 * ref kötelező és a type-hoz tartozó collectionre mutat). A szabálylogika az
 * src/lib/menu-validation.ts-ben él, DB nélkül unit-tesztelhető.
 */
const validateMenu: CollectionBeforeValidateHook = async ({ data, originalDoc, req }) => {
  if (!data) return data

  const normalized = clearMismatchedMenuRef(data)

  const issues: MenuValidationIssue[] = [
    ...validateMenuTypeConsistency(normalized),
    ...(await validateMenuParentChain({
      docId: originalDoc?.id ?? null,
      parent: data.parent,
      fetchById: async (id) => {
        try {
          const doc = await req.payload.findByID({
            collection: 'menus',
            id,
            depth: 0,
            overrideAccess: true,
          })
          return doc ? { id: doc.id, parent: doc.parent } : null
        } catch {
          return null
        }
      },
    })),
  ]

  if (issues.length > 0) {
    throw new ValidationError({
      collection: 'menus',
      errors: issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return normalized
}

export interface RevalidateMenusCacheDeps {
  revalidate?: (tag: string, profile: { expire: number }) => void
  log?: Pick<Logger, 'warn'>
}

export function revalidateMenusCache(deps: RevalidateMenusCacheDeps = {}): boolean {
  const revalidate = deps.revalidate ?? revalidateTag
  const log = deps.log ?? logger
  try {
    revalidate(MENUS_CACHE_TAG, { expire: 0 })
    return true
  } catch (error) {
    log.warn(
      'menü-gyorsítótár ürítése sikertelen — a navigáció legfeljebb a lejáratig régi maradhat',
      { error: error instanceof Error ? error.message : String(error) },
    )
    return false
  }
}

const revalidateMenusAfterChange: CollectionAfterChangeHook = ({ doc }) => {
  revalidateMenusCache()
  return doc
}

const revalidateMenusAfterDelete: CollectionAfterDeleteHook = ({ doc }) => {
  revalidateMenusCache()
  return doc
}

/**
 * Az űrlap élő értékei szerint a menüpont a Tudástár kapcsolója-e (`type='url'`
 * és a webcíme a /blog). A szabály EGY helyen él (src/lib/tudastar-kapcsolo.ts),
 * a tájékoztató mező feltétele is azt kérdezi, így nem csúszhat el a weboldal
 * tényleges viselkedésétől.
 */
export function isTudastarKapcsoloUrlap(siblingData: unknown): boolean {
  if (typeof siblingData !== 'object' || siblingData === null) {
    return false
  }
  const { type, url } = siblingData as Record<string, unknown>
  return isTudastarKapcsolo({
    type: typeof type === 'string' ? type : null,
    url: typeof url === 'string' ? url : null,
  })
}

export const Menus: CollectionConfig = {
  slug: 'menus',
  labels: {
    singular: 'Menüpont',
    plural: 'Menüpontok',
  },
  /*
   * A lista alapból Sorrend szerint rendez (K41): a menü ugyanabban a sorrendben
   * látszik, mint a weboldalon, és a Kezdőlap nem csúszik a 2. oldalra. A Payload
   * 3-ban ez GYŰJTEMÉNY-szintű beállítás, nem az `admin` alatt él („Pass a
   * top-level field to sort by default in the Collection List View”,
   * https://payloadcms.com/docs/configuration/collections). Mellékhatás: a
   * rendezés nélküli API-lekérdezés is `order` szerint jön; a navigáció
   * (src/lib/menus.ts) amúgy is `sort: 'order'`-rel kér, a Tudástár-kapcsoló és
   * a seed-keresések (címke + szülő szerint) pedig sorrendfüggetlenek. Holtversenynél
   * a Payload a létrehozás idejével dönt, így a lapozás stabil.
   */
  defaultSort: 'order',
  admin: {
    useAsTitle: 'label',
    group: 'Navigáció',
    // A szülő-oszlop mutatja a kétszintű szerkezetet. Mindhárom jelölőnégyzet
    // (a két kapcsoló és az „Új lapon nyíljon”) szöveges cellát kap
    // (BooleanCell.tsx), mert a gyári cella „igaz/hamis” kódot írt; a UI-mezők
    // pedig nem kínálhatók oszlopnak (disableListColumn). Mindkettőt a
    // menus-admin.test.ts a mezőket bejárva őrzi.
    defaultColumns: ['label', 'parent', 'order', 'visible', 'unlisted'],
    // H20: a menü két eleme nem innen jön. A Kurzusok pontot a withCoursesNavItem
    // teszi a menü elejére (src/lib/menu-tree.ts), ha itt nincs /kurzusok
    // főmenüpont. Az SOS pont „Ingyenes” előtagját a toNavItem KEZELI: csak a
    // Kurzus típusú, az SOS-kurzusra mutató, „SOS KézRelax” vagy „Ingyenes SOS
    // KézRelax” feliratú sornál, és mindkét irányba (ingyenes kurzusnál kiteszi,
    // fizetősnél leveszi); Webcím típusnál a beírt felirat marad. A mentés azonnal
    // hat: a gyűjteménynek nincs piszkozata, és az afterChange hook azonnal üríti
    // a menü gyorsítótárát (revalidateMenusCache).
    description:
      'A weboldal tetején látszó menü, legfeljebb két szinttel: főmenüpont és alatta almenüpontok. A mentés azonnal megjelenik a weboldalon. A menü első pontját (Kurzusok) a rendszer adja, ha itt nincs /kurzusok webcímű főmenüpont. A Kurzus típusú SOS KézRelax menüpont „Ingyenes” előtagját is a rendszer kezeli.',
  },
  access: {
    // T-013: nyilvános olvasás, de nem-admin csak a visible=true sorokat látja.
    // A centrális politika (src/access/policies.ts) ugyanezt a függvényt
    // applikálja — a kettő szándékosan azonos.
    read: visibleMenusOrAdmin,
  },
  hooks: {
    beforeValidate: [validateMenu],
    afterChange: [revalidateMenusAfterChange],
    afterDelete: [revalidateMenusAfterDelete],
  },
  fields: [
    {
      name: 'label',
      type: 'text',
      required: true,
      label: 'Felirat',
      admin: {
        // A kivétel a menu-tree.ts toNavItem feltétele, betűre: type 'product',
        // a felirat SOS_MENU_LABEL vagy SOS_FREE_MENU_LABEL, a cél slugja
        // 'sos-kezrelax-villamkurzus'; az eredmény isStorefrontFreeSos szerint
        // az egyik vagy a másik felirat. A seed (menu-seed.ts) éppen az
        // „Ingyenes SOS KézRelax” alakkal hozza létre, ezért mindkettőt és
        // mindkét irányt ki kell mondani (menus-admin.test.ts).
        description:
          'Ez a szöveg jelenik meg a menüben (pl. „Rólunk”). Kivétel a Kurzus típusú menüpont, ha az SOS KézRelax kurzusra mutat, és a felirata „SOS KézRelax” vagy „Ingyenes SOS KézRelax”: az „Ingyenes” szót ilyenkor a rendszer teszi ki vagy veszi le, aszerint, hogy a kurzus ingyenes-e.',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'page',
      label: 'Hová mutat',
      options: [
        { label: 'Oldal', value: 'page' },
        { label: 'Blogbejegyzés', value: 'post' },
        // Nem „Külső link”: saját lapra (pl. /blog) is ez a típus való, a
        // Tudástár kapcsolója is ilyen menüpont (src/lib/tudastar-kapcsolo.ts).
        { label: 'Webcím (saját vagy más oldal)', value: 'url' },
        { label: 'Kurzus', value: 'product' },
      ],
      admin: {
        description: 'Válaszd ki, milyen tartalomra visz a menüpont; ettől függ a következő mező.',
      },
    },
    {
      name: 'ref',
      type: 'relationship',
      relationTo: ['pages', 'posts', 'products'],
      label: 'Cél',
      filterOptions: ({ relationTo, siblingData }) =>
        filterMenuRefOptions({ relationTo, siblingData }),
      admin: {
        allowCreate: false,
        condition: (_, siblingData) => siblingData?.type !== 'url',
        description: 'Csak a fent választott típus elemei: oldal, blogbejegyzés vagy kurzus.',
      },
    },
    {
      name: 'url',
      type: 'text',
      label: 'Webcím',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'url',
        // A validateCmsUrl (src/lib/safe-url.ts) a perjeles saját útvonalat és a
        // https://-es teljes címet is elfogadja; a súgó ugyanezt mondja, mint a
        // hibaüzenete (CMS_URL_VALIDATION_MESSAGE).
        description:
          'A weboldal saját lapjához elég a perjellel kezdődő útvonal (pl. /blog), más weboldalhoz a teljes cím kell, https://-sel (pl. https://pelda.hu).',
      },
      /*
       * Szerver-oldali ellenőrzés MENTÉSKOR (src/lib/safe-url.ts).
       *
       * A `resolveMenuHref` (src/lib/menu-tree.ts) a tiltott alakú címet
       * csendben ejti — a menüpont egyszerűen kimarad a navigációból, és a
       * szerkesztő ebből semmit nem lát. Ez a validate a mező mellett, magyar
       * üzenettel szól.
       *
       * CSAK a „Webcím” típusnál fut: a mező az admin `condition`-je miatt
       * más típusnál nem is látszik, és a `resolveMenuHref` sem olvassa —
       * egy régi, típusváltás után benne ragadt érték ezért ne akadályozza meg
       * egy amúgy helyes menüpont mentését.
       *
       * A kötelezőséget NEM ez adja: „url" típusnál a `validateMenuTypeConsistency`
       * (src/lib/menu-validation.ts) követeli meg a kitöltést, a teljes menüpont
       * összefüggéseivel együtt.
       */
      validate: (value: string | null | undefined, { siblingData }: { siblingData?: unknown }) => {
        const type =
          typeof siblingData === 'object' && siblingData !== null
            ? (siblingData as Record<string, unknown>).type
            : undefined
        if (type !== 'url') {
          return true
        }
        return validateCmsUrl(value)
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'menus',
      label: 'Fölérendelt menüpont',
      filterOptions: rootMenuParentFilter,
      admin: {
        allowCreate: false,
        description:
          'Csak akkor töltsd ki, ha ez almenüpont. A listában csak főmenüpontok vannak: almenüpont alá már nem tehetsz továbbit.',
      },
    },
    {
      name: 'order',
      type: 'number',
      label: 'Sorrend',
      admin: {
        description: 'A menün belüli sorrend (kisebb szám = előrébb).',
      },
    },
    {
      /*
       * UI-mező (nem tárol adatot, nincs séma-hatása). Csak a Tudástár
       * kapcsolójánál látszik (type='url', webcím: /blog), és a két pipa
       * ELŐTT áll, hogy a szerkesztő a következményt a kattintás előtt lássa
       * (NN/g, Visibility of System Status: „No action with consequences to
       * users should be taken without informing them.”,
       * https://www.nngroup.com/articles/visibility-system-status/).
       */
      name: 'tudastarHatas',
      type: 'ui',
      label: 'A Tudástár kapcsolója',
      admin: {
        condition: (_, siblingData) => isTudastarKapcsoloUrlap(siblingData),
        disableListColumn: true,
        components: {
          Field: '/components/admin/MenuTudastarNotice#MenuTudastarNotice',
        },
      },
    },
    {
      /*
       * UI-mező (nem tárol adatot). Csak akkor ír ki bármit, ha a menüpontnak
       * van almenüpontja (K22): a szülő elrejtése a gyerekeket a főmenübe emeli
       * (src/lib/menu-tree.ts, „kiesett szülő” szabály), ezt a pipa előtt kell
       * megtudnia a szerkesztőnek.
       */
      name: 'almenupontokJelzes',
      type: 'ui',
      label: 'Almenüpontok',
      admin: {
        disableListColumn: true,
        components: {
          Field: '/components/admin/MenuChildrenNotice#MenuChildrenNotice',
        },
      },
    },
    {
      name: 'visible',
      type: 'checkbox',
      defaultValue: true,
      label: 'Látható',
      admin: {
        // A menu-tree.ts buildNavTree szűrője szerint: a sor kimarad, a
        // gyermekei gyökérré emelkednek, a cél-lap érintetlen (a menüpont nem
        // kapuzza a lapot). A /blog sor a Tudástár-kapcsoló.
        description:
          'Pipa nélkül a menüpont kimarad a weboldal menüjéből, de nem törlődik, és a célja a saját címén elérhető marad. Az almenüpontjai ilyenkor a főmenübe kerülnek. A /blog webcímű menüpontnál ez a pipa a Tudástár kapcsolója is.',
        components: {
          Cell: '/components/admin/BooleanCell#MenuLathatoCell',
        },
      },
    },
    {
      /*
       * „Rejtett link" (unlisted): a menüpont AKTÍV marad, a célja a közvetlen
       * linkjén elérhető, de a fejléc és a mobil menü nem mutatja. A szűrést a
       * `buildNavTree` végzi (src/lib/menu-tree.ts), az access-szabályok
       * (src/access/menus-visibility.ts) szándékosan érintetlenek: a sor
       * olvasható marad, csak a navigációból esik ki. A `visible` ettől
       * független kapcsoló marad (az „eltűnik az oldalról" jelentése nem
       * változik), így a két állapot nem keveredik a szerkesztő fejében.
       */
      name: 'unlisted',
      type: 'checkbox',
      defaultValue: false,
      label: 'Rejtett link (nem jelenik meg a menüben)',
      admin: {
        // A weboldalon a hatása azonos a „Látható” pipa kivételével (a
        // buildNavTree mindkettőt ugyanúgy szűri, a Tudástár-kapcsoló is
        // egyformán kezeli). Az egyetlen szerkesztői különbség a lenti
        // közvetlen-link doboz (MenuUnlistedLink.tsx).
        description:
          'Ugyanazt teszi, mint a „Látható” pipa kivétele: a menüpont kimarad a menüből, a célja elérhető marad, az almenüpontjai a főmenübe kerülnek. Az egyetlen különbség, hogy alább kimásolhatod a cél közvetlen linkjét. A /blog webcímű menüpontnál ez is kikapcsolja a Tudástárat.',
        components: {
          Cell: '/components/admin/BooleanCell#MenuRejtettLinkCell',
        },
      },
    },
    {
      /*
       * UI-mező (nem tárol adatot → nincs séma-hatása). Csak bekapcsolt
       * „Rejtett link" mellett látszik: a közvetlen, abszolút linket mutatja
       * másoló gombbal (src/components/admin/MenuUnlistedLink.tsx). A linket
       * UGYANAZ a feloldás adja, mint a navigációét (WCAG 2.2 SC 3.2.4,
       * Consistent Identification: ugyanaz a cél mindenhol ugyanazt a címet
       * kapja), ezért nem térhet el attól, amit a látogató a menüben kapna.
       */
      name: 'unlistedLinkPanel',
      type: 'ui',
      label: 'Közvetlen link',
      admin: {
        condition: (_, siblingData) => siblingData?.unlisted === true,
        // A Payload minden `ui` mezőt felkínál az „Oszlopok” választóban (üres
        // oszlopként), ha ez nincs rajta: „Set disableListColumn to true to
        // prevent fields from appearing in the list view column selector.”
        // (https://payloadcms.com/docs/fields/overview).
        disableListColumn: true,
        components: {
          Field: '/components/admin/MenuUnlistedLink#MenuUnlistedLink',
        },
      },
    },
    {
      /*
       * Feltétel NINCS rajta szándékosan (K41): a navigáció minden típusnál
       * érvényesíti (menu-tree.ts toNavItem → NavAnchor target="_blank"), tehát
       * oldal, blogbejegyzés és kurzus menüpontnál is hat. A leírás ezt mondja
       * ki; az alapértelmezés az NN/g ajánlása: „For the most part, always open
       * links in the same browser tab or window.”
       * (https://www.nngroup.com/articles/new-browser-windows-and-tabs/).
       */
      name: 'openInNewTab',
      type: 'checkbox',
      defaultValue: false,
      label: 'Új lapon nyíljon',
      admin: {
        description:
          'Bekapcsolva a menüpont új böngészőlapon nyílik, a céljától függetlenül. A legtöbb menüpontnál hagyd kikapcsolva: a látogató ugyanazon a lapon várja a folytatást.',
        // Az „Oszlopok” választóból ez is felvehető: saját cella nélkül a
        // gyári „igaz/hamis” kódot írná (K41).
        components: {
          Cell: '/components/admin/BooleanCell#BooleanCell',
        },
      },
    },
  ],
}
