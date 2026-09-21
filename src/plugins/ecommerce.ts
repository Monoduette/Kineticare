import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import type { CollectionOverride, Currency } from '@payloadcms/plugin-ecommerce/types'
import type { JSONSchema4 } from 'json-schema'
import type {
  Config,
  DateFieldValidation,
  Field,
  FieldAccess,
  NumberFieldSingleValidation,
} from 'payload'

import {
  adminOrPublishedStatus,
  applyCollectionAccessPolicies,
  isAdmin,
  isAdminFieldAccess,
  isDocumentOwner,
  isOwnerFieldAccess,
  denyFieldWrite,
  streamAssetReadAccess,
} from '../access'
import { revalidateMenusCache } from '../collections/Menus'
import { preventCourseDeletionWithFiles } from '../access/courseFileDelete'
import { courseModulesField } from '../fields/course-modules'
import { seoKeywordsField } from '../fields/seo-keywords'
import { deleteCourseProgressOnParentDelete } from '../lib/course-progress/cleanup'
import { courseSlugField } from '../fields/course-slug'
import { budapestDateString } from '../lib/date/budapest'
import { orderIntegrityBeforeChange } from '../lib/order-integrity'
import { withoutPluginPaymentEndpoints } from '../lib/payments/barion-adapter'
import { buildAdminPreviewUrl } from '../lib/preview/preview-target'

/**
 * Az „Akciós megjelenés” csoport mezői (WP58). Lapos nevek (collapsible, nem
 * group), hogy a tárolt útvonal és a `resolveCoursePromo` bemenete egy legyen.
 */
export const coursePromoFieldNames = [
  'promoEnabled',
  'promoStart',
  'promoEnd',
  'promoOriginalPriceHuf',
  'promoStatusPanel',
] as const

const coursePromoFieldNameSet: ReadonlySet<string> = new Set(coursePromoFieldNames)

/** A collapsible-nek nincs neve: a benne lévő promo-mezők alapján ismerjük fel. */
const isCoursePromoCollapsible = (field: Field): boolean =>
  field.type === 'collapsible' &&
  field.fields.some((inner) => 'name' in inner && coursePromoFieldNameSet.has(inner.name))

/** Unnamed tabs change layout only: stored paths and existing field objects survive. */
function courseEditorTabs(fields: Field[]): Field[] {
  const root: Field[] = []
  const tabs = [
    { label: 'Alapadatok', fields: [] as Field[] },
    { label: 'Ár és hozzáférés', fields: [] as Field[] },
    { label: 'Kurzusoldal', fields: [] as Field[] },
    { label: 'Tananyag', fields: [] as Field[] },
    { label: 'Haladás', fields: [] as Field[] },
  ]
  for (const field of fields) {
    const name = 'name' in field ? field.name : undefined
    if (
      field.admin?.position === 'sidebar' ||
      name === 'courseVisibilityNotice' ||
      name === 'courseEditorialChecklist'
    ) {
      if (name === 'courseVisibilityNotice') root.unshift(field)
      else root.push(field)
      continue
    }
    const tab =
      name === 'courseProgressPanel'
        ? 4
        : ['modules', 'videos'].includes(name ?? '')
          ? 3
          : name === 'accessDurationDays' ||
              (name !== undefined && coursePromoFieldNameSet.has(name)) ||
              isCoursePromoCollapsible(field) ||
              !name
            ? 1
            : [
                  'displayTitle',
                  'sku',
                  'slug',
                  'shortDescription',
                  'category',
                  'coverImage',
                ].includes(name)
              ? 0
              : 2
    tabs[tab].fields.push(field)
  }
  return [...root, { type: 'tabs', tabs: tabs.filter((tab) => tab.fields.length > 0) }]
}

/**
 * HUF deviza — a forintban nincs tizedesjegy (decimals: 0).
 */
export const HUF: Currency = {
  code: 'HUF',
  decimals: 0,
  label: 'Magyar forint',
  symbol: 'Ft',
}

/**
 * Az access-függvények az src/access/ központi modulból jönnek (T-011).
 * A plugin kötelező bekötése:
 * - isAdmin = staff+owner (a rendszer "admin" szintje)
 * - adminOnlyFieldAccess: a plugin pénzügyi default mezői (pl. amount,
 *   transactions) csak staff+owner-nek látszanak
 * - adminOrPublishedStatus: products read — staff/owner draftot is lát,
 *   mások csak a published draft-verziót (`_status` mező!)
 * - isDocumentOwner: customer csak a saját orders/carts dokumentumait
 */
const adminOnlyFieldAccess = isAdminFieldAccess

export const validateAccessDurationDays: NumberFieldSingleValidation = (
  value,
  { operation, previousValue },
) => {
  if (value === null || value === undefined || (Number.isSafeInteger(value) && value > 0)) {
    return true
  }
  // Régi 0/negatív sor más mezőjének mentése nem törhet el. Új create,
  // illetve az érték tényleges módosítása viszont mindig fail-closed.
  if (operation === 'update' && value === previousValue) {
    return true
  }
  return 'A hozzáférés hossza csak pozitív egész nap lehet, vagy hagyd üresen.'
}

const toValidDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const PROMO_END_BEFORE_START_MESSAGE =
  'Az akció vége nem lehet a kezdete előtt. Adj meg a kezdettel azonos vagy későbbi napot.'

/**
 * WP58: az akció vége ne előzze meg a kezdetét. A dayOnly választó a napot
 * 12:00 UTC-ként menti, a REST API-n pedig éjfél is jöhet, ezért nem a
 * pillanatokat, hanem a Budapest szerinti NAPOKAT hasonlítjuk (azonos nap
 * megengedett: egynapos akció). A `value` futásidőben string vagy Date.
 */
export const validatePromoEnd: DateFieldValidation = (value, { siblingData }) => {
  const end = toValidDate(value)
  const start = toValidDate((siblingData as { promoStart?: unknown } | undefined)?.promoStart)
  if (end === null || start === null) {
    return true
  }
  return budapestDateString(end) < budapestDateString(start) ? PROMO_END_BEFORE_START_MESSAGE : true
}

export const PROMO_ORIGINAL_PRICE_MESSAGE =
  'Az eredeti ár csak pozitív egész forintösszeg lehet, vagy hagyd üresen.'

/** WP58: az áthúzott ár egész, pozitív forint (a HUF-nak nincs tizedese). */
export const validatePromoOriginalPriceHuf: NumberFieldSingleValidation = (value) => {
  if (value === null || value === undefined || (Number.isSafeInteger(value) && value > 0)) {
    return true
  }
  return PROMO_ORIGINAL_PRICE_MESSAGE
}

/**
 * Rekurzív mezőfa-bejárás: a plugin gyári mezői group/row/tabs-struktúrába
 * ágyazottak (pl. a products ár-mezői egy group → row alatt, az orders items
 * egy tabs alatt), ezért a mezőszintű access- és snapshot-bekötés így éri el őket.
 */
const mapFieldsDeep = (fields: Field[], visit: (field: Field) => Field): Field[] =>
  fields.map((field) => {
    const visited = visit(field)
    if ('fields' in visited && Array.isArray(visited.fields)) {
      return { ...visited, fields: mapFieldsDeep(visited.fields as Field[], visit) } as Field
    }
    if (visited.type === 'tabs' && Array.isArray(visited.tabs)) {
      return {
        ...visited,
        tabs: visited.tabs.map((tab) => ({
          ...tab,
          fields: mapFieldsDeep(tab.fields as Field[], visit),
        })),
      } as Field
    }
    return visited
  })

interface FieldAccessShape {
  create?: FieldAccess
  read?: FieldAccess
  update?: FieldAccess
  delete?: FieldAccess
}

type NamedField = Field & { name: string; access?: FieldAccessShape }

const namedField = (field: Field): NamedField | null =>
  'name' in field && typeof field.name === 'string' && field.type !== 'ui'
    ? (field as NamedField)
    : null

/**
 * T-011: a products ár-mezői (priceInHUF, priceInHUFEnabled) create/update
 * kizárólag ownernek — a staff így nem módosíthat árat.
 */
const ownerOnlyProductFieldNames = new Set(['priceInHUF', 'priceInHUFEnabled'])

const withOwnerOnlyPriceAccess = (field: Field): Field => {
  const named = namedField(field)
  if (!named || !ownerOnlyProductFieldNames.has(named.name)) {
    return field
  }
  return {
    ...named,
    access: {
      ...named.access,
      create: isOwnerFieldAccess,
      update: isOwnerFieldAccess,
    },
  } as Field
}

/**
 * A plugin GYÁRI mezőleírásainak emberi nyelvre írása a kurzus-szerkesztőlapon.
 *
 * Az admin UX-audit két konkrét zavart mért:
 *  - Az „Ár (HUF)" alatt a plugin gyári, magyarra fordított szövege állt, amely
 *    SZÓ SZERINT az ellenkezőjét állítja a valóságnak: „ez az ár nem lesz
 *    felhasználva a fizetésnél" (a Kineticare-ben nincsenek változatok, ez a
 *    fizetendő ár). A mező a lap harmadik eleme, tehát azonnal szembejön.
 *  - A lap LEGELSŐ mezője a „Készlet" volt, 0 értékkel, magyarázat nélkül. Az
 *    `inventory` a kódban SEHOL nem használt; egy digitális kurzusnál a
 *    „Készlet: 0" azt sugallja, hogy elfogyott, és nem eladható.
 *
 * A mezőket nem távolítjuk el (a plugin sémájához tartoznak) — csak az
 * ADMIN-megjelenítésüket javítjuk, ami sem adatra, sem sémára nincs hatással.
 */
const courseFieldAdminOverrides: Record<string, { description?: string; hidden?: boolean }> = {
  inventory: { hidden: true },
  priceInHUF: {
    description:
      'A kurzus bruttó ára forintban — ennyit fizet a vásárló a pénztárnál. Csak tulajdonos állíthatja.',
  },
  priceInHUFEnabled: {
    description: 'Kikapcsolva a kurzus nem vásárolható meg.',
  },
}

const withCourseFriendlyAdmin = (field: Field): Field => {
  const named = namedField(field)
  const override = named === null ? undefined : courseFieldAdminOverrides[named.name]
  if (named === null || override === undefined) {
    return field
  }
  return {
    ...named,
    admin: {
      ...(named as { admin?: Record<string, unknown> }).admin,
      ...(override.hidden === undefined ? {} : { hidden: override.hidden }),
      ...(override.description === undefined ? {} : { description: override.description }),
    },
  } as Field
}

/**
 * T-017: item-szintű snapshot-mezők az orders items tömbjébe. A hook tölti őket
 * szerver-oldalon, create-kor; a kliens által küldött érték sosem forrás
 * (create/update access zárt, a hook amúgy is felülír).
 */
const orderItemSnapshotFields: Field[] = [
  {
    name: 'titleSnapshot',
    type: 'text',
    label: 'Kurzus neve a megrendeléskor',
    access: {
      create: () => false,
      update: () => false,
    },
    admin: {
      readOnly: true,
      description:
        'A termék azonosító-neve (sku) a megrendeléskor. SZÁNDÉKOSAN a sku, nem a kurzuscím (displayTitle): a rendelés- és számlasoron a stabil azonosító a hasznos, a marketingcím változhat.',
    },
  },
  {
    name: 'priceHufSnapshot',
    type: 'number',
    label: 'Ár a megrendeléskor (Ft)',
    access: {
      create: () => false,
      update: () => false,
    },
    admin: {
      readOnly: true,
      description: 'A termék priceInHUF értéke a megrendeléskor (szerver-oldali forrás).',
    },
  },
]

const withOrderItemSnapshots = (field: Field): Field => {
  const named = namedField(field)
  if (!named || named.name !== 'items' || named.type !== 'array') {
    return field
  }
  return {
    ...named,
    fields: [...(named.fields as Field[]), ...orderItemSnapshotFields],
  } as Field
}

/**
 * A Rendelések lista „Tételek" oszlopának cella-komponense (a megrendelő
 * „ki mit vett és mikor" igénye): a tételsorok (sku × db — tételár) az
 * OrderItemsCell-ben jelennek meg. A withOrderItemSnapshots ÁLTAL HOZZÁADOTT
 * MEZŐK ÉS A PLUGIN GYÁRI ADMIN-BEÁLLÍTÁSAI megmaradnak — csak a Cell kerül
 * be (a spread-sorrend miatt a snapshot-mezők itt már a named részei).
 */
const withOrderItemsCell = (field: Field): Field => {
  const named = namedField(field)
  if (!named || named.name !== 'items' || named.type !== 'array') {
    return field
  }
  return {
    ...named,
    admin: {
      ...named.admin,
      components: {
        ...named.admin?.components,
        Cell: '/components/admin/OrderItemsCell#OrderItemsCell',
      },
    },
  } as Field
}

/**
 * Az orders.refunds json-mező ERŐS típusa a generált payload-types.ts-hez.
 *
 * A `json` mezőkből a típusgenerátor alapból `unknown`-t (bármit) csinál — a
 * refunds-t viszont pénzügyi kód olvassa (src/lib/refund/*), ezért itt kézzel
 * megadjuk a séma-alakot. Így a `npm run generate:types` újrafuttatása után is
 * a bejegyzés-szintű mezők (transactionId, amountHuf, status, refundedAt, type,
 * reason) típusosak maradnak, és a fordító elkapja az elgépeléseket.
 *
 * A séma a refund-szolgáltatás által írt alakot tükrözi — ha ott új mező kerül
 * a bejegyzésbe, ezt is bővíteni kell.
 */
const refundsTypescriptSchema: JSONSchema4 = {
  type: ['array', 'null'],
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['transactionId', 'amountHuf', 'status', 'refundedAt', 'type'],
    properties: {
      transactionId: { type: 'string' },
      amountHuf: { type: 'number' },
      status: { type: 'string' },
      refundedAt: { type: 'string' },
      type: { type: 'string', enum: ['full', 'partial'] },
      reason: { type: ['string', 'null'] },
    },
  },
}

/**
 * T-021/T-063: az orders `status` mező üzleti állapotgépe.
 *
 * A plugin gyári állapotait (processing/completed/cancelled/refunded) a
 * pénzügyi főlánc állapotgépe váltja:
 *   created → payment_pending → paid | payment_failed (+ cancelled/refunded).
 * A `paid` átmenet KIZÁRÓLAG a Barion-callback-útvonal (T-022) joga — sem a
 * plugin confirmOrder-je (ismert beta-hiba: nem ellenőrzi a fizetés tényleges
 * státuszát), sem a checkout-start nem állíthat paid-re.
 *
 * DB-megjegyzés: az enum-értékcsere migrációt igényel (az enum_orders_status
 * újraépül); a régi processing/completed értékek kódoldalon megszűnnek.
 */
const orderStatusStateMachineOptions = [
  { label: 'Létrehozva', value: 'created' },
  { label: 'Fizetésre vár', value: 'payment_pending' },
  { label: 'Fizetve', value: 'paid' },
  { label: 'Sikertelen fizetés', value: 'payment_failed' },
  { label: 'Lemondva', value: 'cancelled' },
  { label: 'Visszatérítve', value: 'refunded' },
]

const withOrderStatusStateMachine = (field: Field): Field => {
  const named = namedField(field)
  if (!named || named.name !== 'status' || named.type !== 'select') {
    return field
  }
  return {
    ...named,
    defaultValue: 'created',
    options: orderStatusStateMachineOptions,
  } as Field
}

/**
 * A rendelés ezen plugin-mezőit kizárólag a szerveroldali checkout- és
 * fizetési folyamat írhatja. A local API `overrideAccess: true` útja megmarad.
 */
const systemOwnedOrderFieldNames = new Set([
  'items',
  'customer',
  'customerEmail',
  'transactions',
  'status',
  'amount',
  'currency',
])

const withSystemOwnedOrderWriteAccess = (field: Field): Field => {
  const named = namedField(field)
  if (!named || !systemOwnedOrderFieldNames.has(named.name)) {
    return field
  }
  return {
    ...named,
    access: {
      ...named.access,
      create: denyFieldWrite,
      update: denyFieldWrite,
    },
  } as Field
}

const visitOrderFields = (field: Field): Field =>
  withSystemOwnedOrderWriteAccess(
    withOrderStatusStateMachine(withOrderItemsCell(withOrderItemSnapshots(field))),
  )

/**
 * Admin-csoport a webshop-collectionöknek: a plugin gyári collectionjei
 * egységesen a „Webshop" fül alá kerülnek, magyar megnevezéssel — így a
 * szerkesztő az oldalsávban elkülönítve látja a tartalmat és a webshopot.
 */
const WEBSHOP_GROUP = 'Webshop'

/**
 * Products override: a plugin gyári mezői (inventory, priceInHUF…) megmaradnak,
 * a kurzus-specifikus mezők mögéjük kerülnek.
 *
 * `useAsTitle: 'sku'` marad a `displayTitle` bevezetése után is: a displayTitle
 * a régi sorokon üres, és a useAsTitle-t rá állítva az admin listája ezeknél
 * csak az azonosítót mutatná.
 */
const productsCollectionOverride: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  labels: {
    singular: 'Kurzus',
    plural: 'Kurzusok',
  },
  /**
   * A VERZIÓ-VÉGPONTOK lezárása (S2/d).
   *
   * A plugin a products collectionre `versions: { drafts: { autosave: true } }`-t
   * kapcsol (@payloadcms/plugin-ecommerce/dist/collections/products/
   * createProductsCollection.js), de `readVersions` szabályt NEM ad meg — csak
   * create/read/update/delete-et. Hiányzó access-függvénynél a Payload
   * `executeAccess`-e (payload/dist/auth/executeAccess.js) így dönt:
   *   if (access) { … }
   *   if (req.user) { return true }
   * vagyis BÁRMELY bejelentkezett felhasználó — a `customer` szerepkör is —
   * lekérdezhette a `GET /api/products/versions` és
   * `GET /api/products/versions/:id` végpontot (a `:id` a VERZIÓ azonosítója)
   * (payload/dist/collections/operations/findVersions.js és findVersionByID.js:
   * `collectionConfig.access.readVersions`).
   *
   * Ez MEGKERÜLTE a `read` szabályt: az `adminOrPublishedStatus` szándékosan
   * csak a published kurzusokat engedi ki a nem-adminoknak, a verzió-végpont
   * viszont a NEM PUBLIKÁLT (draft) állapotok TELJES tartalmát adta vissza —
   * árazással, videó-sorokkal, még meg nem hirdetett kurzusokkal együtt.
   *
   * `isAdmin` = staff+owner (src/access/isAdmin.ts), ugyanaz a szint, amivel a
   * plugin a create/update/delete-et is védi. Az admin verzió-nézete (a
   * dokumentum „Verziók" füle) staff/owner-ként fut, tehát változatlanul
   * működik.
   */
  access: {
    ...defaultCollection.access,
    readVersions: isAdmin,
  },
  hooks: {
    ...defaultCollection.hooks,
    // A menü szövege az ártól és a publikációtól is függ; mentés és törlés után újraépítendő.
    afterChange: [
      ...(defaultCollection.hooks?.afterChange ?? []),
      ({ doc }) => {
        revalidateMenusCache()
        return doc
      },
    ],
    afterDelete: [
      ...(defaultCollection.hooks?.afterDelete ?? []),
      ({ doc }) => {
        revalidateMenusCache()
        return doc
      },
    ],
    // A kurzus törlésekor a haladás-sorok takarítása. Ugyanaz a séma-ellentmondás,
    // mint a felhasználónál: course_progress.product_id NOT NULL, az idegen kulcs
    // viszont ON DELETE SET NULL — takarítás nélkül a törlés Postgres-hibával áll
    // le. Indoklás: src/lib/course-progress/cleanup.ts.
    beforeDelete: [
      preventCourseDeletionWithFiles,
      ...(defaultCollection.hooks?.beforeDelete ?? []),
      deleteCourseProgressOnParentDelete('product'),
    ],
  },
  admin: {
    ...defaultCollection.admin,
    useAsTitle: 'sku',
    group: WEBSHOP_GROUP,
    description:
      'A megvásárolható kurzusok. Az árat és a közzétételt csak tulajdonos állíthatja. Az előnézet a mentett kurzusoldalt mutatja, tananyag-hozzáférést nem ad.',
    // KÖTELEZŐ felülírás: a plugin `defaultColumns: ['prices']`-t állít be
    // (createProductsCollection), DE nincs `prices` nevű mező — a pricesField
    // egy NÉVTELEN group → row alá teszi a `priceInHUFEnabled` + `priceInHUF`
    // mezőket. A nem létező oszlopnév miatt a lista NULLA oszloppal rendelődik
    // ki: nincs cím, nincs kattintható link, a kurzus nem nyitható meg. A
    // `...defaultCollection.admin` ezt öröklené, ezért itt explicit lista kell.
    // Az első oszlop a dokumentumra mutató link, ezért `sku` áll elöl: ez a
    // useAsTitle, egyedi, és a gyakorlatban minden során ki van töltve — míg a
    // displayTitle a mező bevezetése előtti sorokon üres. (A `sku` nincs
    // `required`-re állítva, mert a plugin gyári mezője; a link üres címke
    // mellett is működik, csak a sor azonosíthatatlan lenne.)
    defaultColumns: ['sku', 'displayTitle', 'audience', 'priceInHUF', 'status', 'updatedAt'],
    // A useAsTitle önmagában csak a technikai azonosítóra keresne; a szerkesztő
    // a kurzus CÍMÉRE keres.
    listSearchableFields: ['sku', 'displayTitle'],
    preview: (doc) =>
      typeof doc.id === 'number' && Number.isSafeInteger(doc.id) && doc.id > 0
        ? buildAdminPreviewUrl('products', doc.slug)
        : null,
  },
  fields: courseEditorTabs([
    {
      name: 'courseEditorialChecklist',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/CourseEditorialChecklist#CourseEditorialChecklist',
        },
      },
    },
    {
      /**
       * A LEGELSŐ elem a lapon: kimondja, látszik-e a kurzus a weboldalon.
       *
       * Az admin UX-audit mérte, hogy a szerkesztő a felső sáv „Állapot:
       * Közzétett" feliratának hisz, miközben a bolt a `status` mezőt nézi — a
       * cáfolatnak ezért ugyanott kell lennie, ahol a téves üzenet.
       */
      name: 'courseVisibilityNotice',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/CourseVisibilityNotice#CourseVisibilityNotice',
        },
      },
    },
    ...mapFieldsDeep(
      mapFieldsDeep(defaultCollection.fields, withOwnerOnlyPriceAccess),
      withCourseFriendlyAdmin,
    ),
    {
      // C3: a látogatónak szóló kurzuscím. A `sku` egyszerre volt eddig
      // azonosító és megjelenő név; a displayTitle ezt szétválasztja, és ez a
      // slug ELSŐDLEGES forrása is (src/lib/course-url.ts). Nem kötelező: ha
      // üres, a megjelenő név a `sku` marad (src/lib/courses.ts courseTitle).
      name: 'displayTitle',
      type: 'text',
      label: 'Kurzus címe',
      admin: {
        description:
          'A kurzus címe, ahogy a látogató látja (pl. „Kéztorna otthon — 8 hetes program"). Ebből készül a webcím is. Ha üresen hagyod, a lenti „Kurzus neve (azonosító)" jelenik meg.',
      },
    },
    courseSlugField,
    {
      name: 'shortDescription',
      type: 'textarea',
      label: 'Rövid leírás',
      admin: {
        description: '1–3 mondat. A kurzuskártyákon és a kezdőlapon ez látszik.',
      },
    },
    {
      // A kurzuskártya „mini-buybox" pipás előny-sorai (kezdőlap M3). A
      // kártyán MINDEN szöveg a CMS-ből jön — a komponensben hardcode-olt
      // marketingszöveg nincs, csak a szekció-feliratok fallbackja.
      // Legfeljebb 3 sor: a kártya összehasonlítható marad (UX-kutatás B4.1 —
      // minden kártya UGYANAZOKAT a mezőket UGYANABBAN a sorrendben hozza), és
      // a negyedik sor már folyószöveggé olvadna.
      name: 'cardHighlights',
      type: 'array',
      label: 'Kiemelt előnyök (a kurzuskártyán)',
      maxRows: 3,
      labels: {
        singular: 'Előny',
        plural: 'Előnyök',
      },
      admin: {
        description:
          'Legfeljebb 3 rövid, pipával jelölt állítás a kezdőlapi kurzuskártyán (pl. „50+ videós gyakorlat”). Tényszerű, ellenőrizhető állítást írj — ígéretet ne. Ha üresen hagyod, a kártyán egyszerűen nem jelenik meg ez a rész.',
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          label: 'Előny szövege',
          required: true,
          maxLength: 80,
          admin: {
            description: 'Egy tömör állítás, legfeljebb 80 karakter — a kártyán egy sor.',
          },
        },
      ],
    },
    {
      name: 'longDescription',
      type: 'richText',
      label: 'Részletes leírás',
      admin: {
        description: 'A kurzus oldalán megjelenő teljes szöveg.',
      },
    },
    /**
     * Kurzusoldal strukturált szakaszai (előnyök, lépések, GYIK stb.) — mind opcionális;
     * üres mezőnél fallback: `src/components/courses/sales-content.ts`.
     */
    {
      name: 'salesHighlights',
      type: 'array',
      label: 'Fő előnyök (pipás sorok)',
      labels: { singular: 'Előny', plural: 'Előnyök' },
      maxRows: 5,
      admin: {
        description:
          'Rövid, konkrét sorok a vásárlódobozban, pipával (pl. „Örökös hozzáférés”, „50+ videós gyakorlat”). Három sor a legjobb. Ha üresen hagyod, a Részletes leírás első felsorolásából — annak hiányában a tananyag adataiból — képződik.',
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
          label: 'Előny',
        },
      ],
    },
    {
      name: 'howItWorks',
      type: 'array',
      label: 'Hogyan működik? (lépések)',
      labels: { singular: 'Lépés', plural: 'Lépések' },
      maxRows: 4,
      admin: {
        description:
          'Mi történik a vásárlás után, lépésről lépésre. Ez az ellenérv-csökkentő szakasz („mikor és hogyan érem el?”). Ha üresen hagyod, a vásárlási folyamat három tényszerű lépése jelenik meg.',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Lépés címe',
        },
        {
          name: 'text',
          type: 'textarea',
          label: 'Lépés leírása',
        },
      ],
    },
    {
      name: 'fitFor',
      type: 'array',
      label: 'Kinek való (pipás lista)',
      labels: { singular: 'Sor', plural: 'Sorok' },
      admin: {
        description:
          '„Ez a program neked való, ha…” — soronként egy állítás. Ha üresen hagyod, a Részletes leírás ilyen című szakaszának felsorolásából képződik.',
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
          label: 'Sor',
        },
      ],
    },
    {
      name: 'notFitFor',
      type: 'array',
      label: 'Kinek NEM való',
      labels: { singular: 'Sor', plural: 'Sorok' },
      admin: {
        description:
          '„Nem javasoljuk, ha…” — az őszinte kizárás bizalmat épít, és megelőzi a csalódott vásárlást. Ha üresen hagyod, a Részletes leírás ilyen című szakaszából képződik.',
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
          label: 'Sor',
        },
      ],
    },
    {
      name: 'guaranteeTitle',
      type: 'text',
      label: 'Garancia címe',
      admin: {
        description:
          'Pl. „30 napos kipróbálási garancia”. A garancia kiemelt sávba kerül a kurzusoldalon, és rövid formában a vásárlódobozban is látszik. Ha üresen hagyod, a Részletes leírás garancia-szakasza jelenik meg (ha van ilyen).',
      },
    },
    {
      name: 'guaranteeText',
      type: 'textarea',
      label: 'Garancia szövege',
      admin: {
        description: '1–3 mondat arról, mit ígérünk és hogyan lehet élni vele.',
      },
    },
    {
      name: 'faq',
      type: 'array',
      label: 'Gyakori kérdések (GYIK)',
      labels: { singular: 'Kérdés', plural: 'Kérdések' },
      admin: {
        description:
          'A kurzusoldal alján, összecsukható listában. Ide a vásárlás előtti kételyek valók (mennyi idő, kinek jó, meddig érem el). Ha üresen hagyod, a Részletes leírás kérdés-szakaszából képződik.',
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
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Borítókép',
      admin: {
        description: 'A kurzus kártyáján és az oldala tetején megjelenő kép.',
      },
    },
    {
      name: 'gallery',
      type: 'array',
      label: 'Képgaléria',
      labels: {
        singular: 'Kép',
        plural: 'Képek',
      },
      admin: {
        description: 'További képek a kurzus oldalára (nem kötelező).',
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Kép',
        },
      ],
    },
    // SEO-mezők — a Pages/Posts collectionök mintájára, azonos mezőnevekkel,
    // label-ekkel és pozícióval (a borítókép UTÁN), hogy a szerkesztő minden
    // tartalomtípusnál ugyanazt lássa ugyanott. A kurzusoldal fallback-lánca
    // ezekre épül (src/lib/seo.ts: seoTitle → név, seoDescription → rövid
    // leírás, seoKeywords → meta/JSON-LD, ogImage → borítókép).
    {
      name: 'seoTitle',
      type: 'text',
      label: 'SEO-cím',
      admin: {
        description: 'Ha üresen hagyod, a Google a kurzus nevét használja.',
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
          'Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja a kurzust.',
      },
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      label: 'Kategória',
      admin: {
        description:
          'Kötelező. Ha nincs megfelelő, előbb hozd létre a Tartalom → Kategóriák alatt.',
      },
    },
    {
      // Kétirányú kurzusstruktúra: a kínálat két ága. NEM kötelező, mert a mező
      // bevezetése előtti sorokban NULL marad — a felület minden nem-'szakember'
      // értéket a laikus ágba sorol (src/lib/course-audience.ts).
      name: 'audience',
      type: 'select',
      label: 'Kinek szól',
      defaultValue: 'laikus',
      options: [
        { label: 'Otthoni gyakorlóknak', value: 'laikus' },
        { label: 'Szakembereknek', value: 'szakember' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Ez dönti el, hogy a Kurzusok oldalon melyik sávban jelenik meg: „Otthoni gyakorlóknak" vagy „Szakembereknek". Ha üresen marad, az otthoni sávba kerül.',
      },
    },
    {
      name: 'previewVideoStreamId',
      type: 'text',
      label: 'Nyilvános bemutató videó',
      admin: {
        components: { Field: '/components/admin/BunnyVideoField#PublicBunnyVideoField' },
        description:
          'Vásárlás nélkül is látható a kurzusoldalon. Nem kötelező; ha nincs, a borítókép jelenik meg.',
      },
    },
    // A kurzus tananyaga fejezetekre bontva (modulok → leckék). A mező
    // szándékosan a régi, lapos `videos` lista ELŐTT áll: az új kurzusokat itt
    // kell összeállítani, a `videos` már csak a korábbi tartalom hordozója.
    // A két szerkezet egyesítése a src/lib/curriculum/curriculum.ts-ben él.
    courseModulesField,
    {
      name: 'videos',
      type: 'array',
      label: 'Videók (régi, fejezet nélküli lista)',
      labels: {
        singular: 'Videó',
        plural: 'Videók',
      },
      admin: {
        // CSAK a régi kurzusokon jelenik meg. Az admin UX-audit mérte, hogy ez
        // volt a lap legnagyobb eleme (1081 px), és egy ÚJ kurzuson is
        // megjelent, üresen: a szerkesztő két, majdnem azonos mezőt látott
        // („Tananyag (modulok)" és „Videók"), mindkettőben „hozzáadása"
        // gombbal, és a leírásból kellett kitalálnia, melyikbe NE tegyen
        // semmit. Ezt a döntést a felületnek kell meghoznia helyette.
        condition: (data: unknown) => {
          const videos = (data as { videos?: unknown } | null)?.videos
          return Array.isArray(videos) && videos.length > 0
        },
        description:
          'A kurzus fejezetek nélküli, RÉGI videólistája — csak a korábbi kurzusokon látszik. Új leckét a fenti „Tananyag (modulok)” mezőben vegyél fel. Az itt lévő videókat nem kell átmozgatni: azok változatlanul működnek.',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          label: 'Videó címe',
        },
        {
          name: 'streamAssetId',
          type: 'text',
          label: 'Lecke videója',
          admin: {
            components: { Field: '/components/admin/BunnyVideoField#ProtectedBunnyVideoField' },
            description:
              'A korábbi lecke felvétele a védett videótárból. A lista és a vevők haladása megmarad.',
          },
          // S2/b: a fizetős tartalom kulcsa nem kerülhet ki a nyilvános REST
          // API-n. Staff/owner és a terméket MEGVÁSÁRLÓ vevő olvassa; anonim és
          // nem-vevő felé a Payload törli a mezőt a válaszból. A szerver-oldali
          // lejátszási út (stream-token, lejátszó-oldal) overrideAccess: true-val
          // olvas, azt a szabály nem érinti — a részletek a függvény fejlécében
          // (src/access/streamAssetRead.ts).
          access: {
            read: streamAssetReadAccess,
          },
        },
        {
          name: 'durationSec',
          type: 'number',
          label: 'Hossz (másodperc)',
          admin: { readOnly: true, description: 'A videó kiválasztásakor átvett hossz.' },
        },
        {
          name: 'status',
          type: 'select',
          defaultValue: 'processing',
          label: 'Videó állapota',
          options: [
            { label: 'Feldolgozás alatt', value: 'processing' },
            { label: 'Kész', value: 'ready' },
            { label: 'Hiba', value: 'error' },
          ],
          admin: {
            readOnly: true,
            description:
              'A videó kiválasztásakor átvett feldolgozási állapot. Csak a Kész állapotú videó játszható le.',
          },
        },
      ],
    },
    {
      name: 'accessDurationDays',
      type: 'number',
      label: 'Hozzáférés hossza (nap)',
      access: {
        create: isOwnerFieldAccess,
        update: isOwnerFieldAccess,
      },
      validate: validateAccessDurationDays,
      admin: {
        description:
          'Hány napig érvényes a hozzáférés vásárlás után. Hagyd üresen, ha a hozzáférés soha nem jár le.',
      },
    },
    {
      /**
       * WP58 „Akciós megjelenés”: a szerkesztő egy időablakban akciósra
       * állíthatja a kurzust. Az időablakban a kurzusoldal az akciós sablont
       * kapja, a kurzuskártyán Akció címke áll; a döntést EGY helyen a
       * `resolveCoursePromo` hozza (src/lib/course-promo.ts), hogy az oldal, a
       * kártya és az admin állapotjelző ugyanazt mondja. Collapsible és NEM
       * group: a mezőnevek laposak maradnak (promoEnabled, promoStart…), így a
       * tárolt útvonal és a feloldó bemenete egy. A pipa az ÁRAT nem
       * változtatja: az árat továbbra is az Ár mezőben kell beállítani, a
       * csoport csak a megjelenést és az áthúzott eredeti árat vezérli.
       */
      type: 'collapsible',
      label: 'Akciós megjelenés',
      admin: {
        initCollapsed: false,
      },
      fields: [
        {
          name: 'promoEnabled',
          type: 'checkbox',
          defaultValue: false,
          label: 'Akciós kurzus',
          admin: {
            description:
              'Bekapcsolva a megadott időablakban a kurzusoldal az akciós megjelenést kapja, a kurzuskártyán pedig Akció címke jelenik meg. A pipa önmagában az árat nem változtatja: az akciós árat az Ár mezőben kell beállítani.',
          },
        },
        {
          name: 'promoStart',
          type: 'date',
          label: 'Akció kezdete',
          admin: {
            description: 'Ettől a naptól él az akció. Ha üresen hagyod, azonnal érvényes.',
            // Csak NAP, óra nélkül (a Posts.ts reviewedAt mintája): a szerkesztő
            // napban gondolkodik, az órának itt nincs jelentése. Az oszlop
            // timestamp marad, a feloldó a Budapest szerinti napra vetít.
            date: { pickerAppearance: 'dayOnly' },
          },
        },
        {
          name: 'promoEnd',
          type: 'date',
          label: 'Akció vége',
          validate: validatePromoEnd,
          admin: {
            description:
              'A megadott nap végéig él az akció. Ha üresen hagyod, az akciónak nincs vége.',
            date: { pickerAppearance: 'dayOnly' },
          },
        },
        {
          name: 'promoOriginalPriceHuf',
          type: 'number',
          label: 'Teljes ár (Ft, áthúzva jelenik meg)',
          min: 1,
          validate: validatePromoOriginalPriceHuf,
          admin: {
            step: 1,
            description:
              'Csak olyan összeg lehet, amelyen a kurzus ténylegesen elérhető volt vagy elérhető (például a teljes árú program ára). Csak akkor jelenik meg áthúzva a kurzusoldalon, ha nagyobb a kurzus tényleges áránál. Ha üresen hagyod, nincs áthúzott ár.',
          },
        },
        {
          /*
           * UI-mező (nem tárol adatot, nincs séma-hatása). Csak bekapcsolt
           * pipa mellett látszik, és kimondja, MOST él-e az akció, és mikortól
           * vagy meddig; a Menus.unlistedLinkPanel mintája
           * (src/components/admin/CoursePromoStatus.tsx).
           */
          name: 'promoStatusPanel',
          type: 'ui',
          label: 'Az akció állapota',
          admin: {
            condition: (_, siblingData) => siblingData?.promoEnabled === true,
            components: {
              Field: '/components/admin/CoursePromoStatus#CoursePromoStatus',
            },
          },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      /**
       * A címke SZÁNDÉKOSAN nem „Állapot".
       *
       * Az admin UX-audit mérte: a lap tetején a Payload dokumentum-státusza
       * áll („Állapot: Közzétett", `_status`), és a szerkesztő ANNAK hisz —
       * miközben a bolt kizárólag EZT a mezőt nézi (src/lib/courses.ts). A
       * normál folyamattal felvitt kurzus `_status=published`, `status=NULL`
       * állapotban maradt, és nem jelent meg a /kurzusok oldalon, figyelmeztetés
       * nélkül. Két, azonos nevű mező közül a láthatatlanabbik döntött.
       * A név most kimondja, mit csinál; a szomszédos figyelmeztető sáv
       * (CourseVisibilityNotice) pedig a lap tetején cáfolja a téves üzenetet.
       */
      label: 'Megjelenés a weboldalon',
      // Alapérték, hogy a mező SOSE maradjon jelöletlen: a „Válasszon ki egy
      // értéket" üres select volt a csapda egyik fele.
      defaultValue: 'draft',
      // A Payload a drafts `_status` mezőnek ugyanazt az enum-nevet generálná
      // (toSnakeCase('_status') === 'status'), így az alapértelmezett névütközés
      // miatt a 'archived' érték elveszne az adatbázis-enumokból. Külön enum-név
      // a products és a _products_v (versions) táblában is — az oszlopnév és az
      // API-mezőnév változatlanul `status` marad.
      enumName: ({ tableName }) => `enum_${tableName}_product_status`,
      options: [
        { label: 'Piszkozat — még nem látszik', value: 'draft' },
        { label: 'Közzétéve — látszik az oldalon', value: 'published' },
        { label: 'Archivált — levéve az oldalról', value: 'archived' },
      ],
      admin: {
        // Az oldalsávban, a közzététel-gomb MELLETT a helye — nem az űrlap
        // közepén, 3000 px-rel lejjebb, ahol az audit szerint sosem találták meg.
        position: 'sidebar',
        description:
          'Ez dönti el, hogy a kurzus látszik-e a weboldalon. A lap tetején lévő „Állapot” a szerkesztői változatra vonatkozik, nem erre. Csak tulajdonos állíthatja.',
      },
      // T-011: a publikálás/archiválás (status create/update) kizárólag owneri
      // döntés — a staff draftot készíthet, de nem publikálhat.
      access: {
        create: isOwnerFieldAccess,
        update: isOwnerFieldAccess,
      },
    },
    {
      name: 'sku',
      type: 'text',
      unique: true,
      label: 'Kurzus neve (azonosító)',
      admin: {
        description:
          'A kurzus egyedi azonosítója — két kurzusnak nem lehet ugyanaz. Ez jelenik meg a rendeléseken és a számlán. Ha a fenti „Kurzus címe" üres, a látogató is ezt látja.',
      },
    },
    {
      name: 'relatedProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Kapcsolódó kurzusok',
      admin: {
        description: 'A kurzus oldalán ajánlott további kurzusok.',
      },
    },
    {
      // Kurzus-haladás panel: „ki kezdte el, ki nem, és hány százaléknál tart".
      // UI-mező, NEM tárol adatot → nincs séma-változás, migrációt nem igényel
      // (a users.grantPurchasePanel és az orders.refundPanel mintája).
      //
      // Az adatot a GET /api/admin/course-progress végpont adja (staff+owner),
      // és a KÖZÖS summarizeCurriculum-mal számol — így az adminban és a
      // vásárló felületén definíció szerint UGYANAZ a szám áll. Ha a kettő
      // eltérne, a szerkesztő egyik számban sem bízna meg többé.
      //
      // A mező a lap VÉGÉN áll. Az admin UX-audit mérte, hogy az űrlap közepén
      // ülő panel 305 beiratkozottnál 17 126 px magas lett, és ennyivel tolta
      // lejjebb az utána következő öt SZERKESZTENDŐ mezőt — köztük épp azt,
      // amelyik a közzétételi csapdát feloldotta volna. Kimutatás nem
      // állhat szerkesztendő mezők útjában.
      name: 'courseProgressPanel',
      type: 'ui',
      label: 'Kurzus-haladás',
      admin: {
        components: {
          Field: '/components/admin/CourseProgressPanel#CourseProgressPanel',
        },
      },
    },
  ]),
})

/**
 * Orders override: a plugin gyári mezői (items, customer, status, amount…) megmaradnak,
 * a Barion-/számlázás-specifikus mezők mögéjük kerülnek.
 *
 * T-011 mezőszintű védelem:
 * - a pénzügyi/személyes mezők (customerSnapshot, ipAddress, invoiceNumber,
 *   barionPaymentId) read-access-e owner-only — a staff ugyan olvashatja a
 *   rendelést (collection-szint), de ezeket a mezőket nem;
 * - a checkout/refund által töltött mezők create/update access-e zárt; a
 *   szerveroldali `overrideAccess: true` folyamatok írják őket.
 *
 * T-017 rendelés-integritás:
 * - orderNumber + totalHufSnapshot + item-snapshotok (titleSnapshot,
 *   priceHufSnapshot) — mindegyiket az orderIntegrityBeforeChange hook tölti
 *   szerver-oldalon, kizárólag create-kor; update-kor újraszámolás nincs.
 *   A kliens ezeket nem írhatja (create/update access zárt).
 */
const ordersCollectionOverride: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  labels: {
    singular: 'Rendelés',
    plural: 'Rendelések',
  },
  admin: {
    ...defaultCollection.admin,
    group: WEBSHOP_GROUP,
    description:
      'A leadott rendelések és a fizetésük állapota. A rendeléseket a rendszer kezeli — kézzel ne módosítsd őket.',
    // A plugin `useAsTitle: 'createdAt'`-ot állít be. A lista keresőmezője a
    // useAsTitle mezőre tesz ILIKE-ot, egy timestamptz oszlopon viszont nincs
    // ilyen operátor: a keresés Postgres-hibára fut ("operator does not exist:
    // timestamp with time zone ~~* unknown"). A rendelésszám a helyes cím is:
    // egyedi, ember által olvasható, és a hook minden rendelésre kitölti.
    useAsTitle: 'orderNumber',
    // A plugin nem ad defaultColumns-t az ordersre, így a Payload automatikus
    // választása szerepelt — rendelésszám, összeg és fizetési állapot nélkül.
    defaultColumns: [
      'orderNumber',
      'createdAt',
      'customerEmail',
      // „Ki mit vett": a tételsorokat (sku × db — tételár) az OrderItemsCell
      // rendereli (lásd withOrderItemsCell). Az oszlopfejléc a plugin magyar
      // „Tételek" fordítása.
      'items',
      'totalHufSnapshot',
      'status',
      'invoiceStatus',
    ],
    // A szerkesztő rendelésszámra és e-mailre keres; a useAsTitle önmagában
    // csak az elsőt fedné.
    listSearchableFields: ['orderNumber', 'customerEmail'],
  },
  fields: [
    ...mapFieldsDeep(defaultCollection.fields, visitOrderFields),
    {
      name: 'orderNumber',
      type: 'text',
      label: 'Rendelésszám',
      // Postgresben a unique index több NULL-t is megenged, így gyakorlatilag sparse.
      unique: true,
      index: true,
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'Szerver-oldalon generált rendelésszám (KH-<év>-<6 jegyű sorszám>); create-kor töltődik, update-kor sosem számolódik újra.',
      },
    },
    {
      name: 'totalHufSnapshot',
      type: 'number',
      label: 'Végösszeg a megrendeléskor (Ft)',
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'A rendelés végösszege a megrendeléskor (az item-snapshotok ár × mennyiség összege). A plugin amount mezője ugyanezt tükrözi.',
      },
    },
    {
      name: 'barionPaymentId',
      type: 'text',
      label: 'Barion fizetésazonosító',
      // Postgresben a unique index több NULL-t is megenged, így gyakorlatilag sparse.
      unique: true,
      index: true,
      access: {
        read: isOwnerFieldAccess,
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description: 'A Barion oldali fizetés azonosítója — hibakereséshez.',
      },
    },
    {
      name: 'barionPaymentRequestId',
      type: 'text',
      label: 'Barion kérésazonosító',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      name: 'invoiceNumber',
      type: 'text',
      label: 'Számla sorszáma',
      access: {
        read: isOwnerFieldAccess,
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      name: 'invoicePdfUrl',
      type: 'text',
      label: 'Számla PDF linkje',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      name: 'invoiceStatus',
      type: 'select',
      defaultValue: 'none',
      label: 'Számla állapota',
      options: [
        { label: 'Nincs', value: 'none' },
        { label: 'Függőben', value: 'pending' },
        { label: 'Kiállítva', value: 'issued' },
        { label: 'Sikertelen', value: 'failed' },
      ],
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description: 'A számlázás állapota. A rendszer állítja — ne írd át.',
        readOnly: true,
      },
    },
    {
      // A Számlázz.hu hivatalos szabálya (A14): ugyanaz a kérés legfeljebb
      // ötször küldhető be, utána emberi beavatkozás kell — a perzisztens
      // számláló a job-újrapróbálás és a resweep együttesét is plafonozza.
      name: 'invoiceAttempts',
      type: 'number',
      defaultValue: 0,
      label: 'Számla-kísérletek száma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'A számlakiállítási kísérletek száma (legfeljebb 5, utána emberi beavatkozás kell). A rendszer állítja.',
      },
    },
    {
      name: 'invoiceLastError',
      type: 'text',
      label: 'Számlázás utolsó hibája',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description: 'Az utolsó sikertelen számlakiállítási kísérlet hibaüzenete — hibakereséshez.',
      },
    },
    {
      // Az eredeti számla teljesítési dátuma (ÉÉÉÉ-HH-NN). A helyesbítő számla
      // dátumszabálya (NAV): a helyesbítő teljesítési dátumának naptári hónapja
      // nem térhet el az eredetiétől — a bevett gyakorlat az eredeti dátum
      // megismétlése, ezért a kiállításkor küldött teljesítési dátum itt rögzül.
      name: 'invoiceCompletionDate',
      type: 'text',
      label: 'Számla teljesítési dátuma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'Az eredeti számla teljesítési dátuma (ÉÉÉÉ-HH-NN) — a helyesbítő számla ezt ismétli meg. A rendszer állítja.',
      },
    },
    {
      // Stornó-számla állapota (C4). Az invoiceStatus mintáját követi: a
      // rendszer (refund-folyamat + storno-issue job) állítja, kézzel nem
      // írandó. A 'storned' a végállapot — az issueStornoForOrder ezt (vagy a
      // stornoNumber meglétét) látva idempotens no-opot ad.
      name: 'stornoStatus',
      type: 'select',
      defaultValue: 'none',
      label: 'Stornó-számla állapota',
      options: [
        { label: 'Nincs', value: 'none' },
        { label: 'Függőben', value: 'pending' },
        { label: 'Stornózva', value: 'storned' },
        { label: 'Sikertelen', value: 'failed' },
      ],
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description: 'A stornó-számla állapota. A rendszer állítja — ne írd át.',
        readOnly: true,
      },
    },
    {
      // A kiállított stornó-számla száma — az invoiceNumber mezővel azonos
      // mezőszintű olvasás-védelemmel (pénzügyi bizonylatazonosító).
      name: 'stornoNumber',
      type: 'text',
      label: 'Stornó-számla sorszáma',
      access: {
        read: isOwnerFieldAccess,
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      name: 'stornoAttempts',
      type: 'number',
      defaultValue: 0,
      label: 'Stornó-kísérletek száma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'A stornó-kiállítási kísérletek száma (legfeljebb 5, utána emberi beavatkozás kell). A rendszer állítja.',
      },
    },
    {
      name: 'stornoLastError',
      type: 'text',
      label: 'Stornó utolsó hibája',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description: 'Az utolsó sikertelen stornó-kísérlet hibaüzenete — hibakereséshez.',
      },
    },
    {
      // Helyesbítő (módosító) számla állapota RÉSZLEGES visszatérítéshez (C5).
      // Teljes refundnál stornó készül, részlegesnél helyesbítő számla — a
      // döntést a refund összege hozza meg (src/lib/refund/refund-order.ts).
      name: 'correctiveInvoiceStatus',
      type: 'select',
      defaultValue: 'none',
      label: 'Helyesbítő számla állapota',
      options: [
        { label: 'Nincs', value: 'none' },
        { label: 'Függőben', value: 'pending' },
        { label: 'Kiállítva', value: 'issued' },
        { label: 'Sikertelen', value: 'failed' },
      ],
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description: 'A helyesbítő (módosító) számla állapota. A rendszer állítja — ne írd át.',
        readOnly: true,
      },
    },
    {
      // A LEGUTÓBB kiállított helyesbítő számla száma (több részrefund esetén
      // a korábbiak a naplóban és a Számlázz.hu-fiókban követhetők).
      name: 'correctiveInvoiceNumber',
      type: 'text',
      label: 'Helyesbítő számla sorszáma',
      access: {
        read: isOwnerFieldAccess,
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      // Idempotencia-horgony a helyesbítőhöz: a refunds-nyom hányadik (1-alapú)
      // bejegyzéséhez tartozik a legutóbbi helyesbítő számla. Ismételt futás
      // (job-retry) ezt látva no-opot ad; a provider-oldali horgony a
      // szamlaKulsoAzon = `${orderNumber}-HELYESBITO-<sorszám>`.
      name: 'correctiveInvoiceSeq',
      type: 'number',
      defaultValue: 0,
      label: 'Helyesbített visszatérítés sorszáma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'A refunds-nyom hányadik bejegyzéséhez tartozik a legutóbbi helyesbítő számla (idempotencia). A rendszer állítja.',
      },
    },
    {
      // A14: a helyesbítő-kiállítás kísérletei is plafonozva (max. 5).
      name: 'correctiveInvoiceAttempts',
      type: 'number',
      defaultValue: 0,
      label: 'Helyesbítő-kísérletek száma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'A helyesbítő-kiállítási kísérletek száma (legfeljebb 5, utána emberi beavatkozás kell). A rendszer állítja.',
      },
    },
    {
      name: 'correctiveInvoiceLastError',
      type: 'text',
      label: 'Helyesbítő utolsó hibája',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description: 'Az utolsó sikertelen helyesbítő-kísérlet hibaüzenete — hibakereséshez.',
      },
    },
    {
      // A helyesbítő-számláló BIZONYLAT-szintű kulcsa: melyik refund-sorszámhoz
      // tartozik a correctiveInvoiceAttempts. Eltérő sorszámú új bizonylatnál a
      // számláló nulláról indul — a hivatalos „ugyanaz a kérés max. 5×" szabály
      // kérésenként (bizonylatonként) értendő, nem rendelésenként.
      name: 'correctiveInvoiceAttemptsSeq',
      type: 'number',
      defaultValue: 0,
      label: 'Helyesbítő-kísérletek refund-sorszáma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'Melyik refund-sorszámú helyesbítőhöz tartozik a kísérletszámláló. A rendszer állítja.',
      },
    },
    {
      name: 'customerSnapshot',
      type: 'json',
      label: 'Vásárlói adatok a megrendeléskor',
      access: {
        read: isOwnerFieldAccess,
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description: 'A számlázási adatok mentett másolata a rendelés idejéből.',
      },
    },
    {
      name: 'consentWithdrawalWaiver',
      type: 'checkbox',
      defaultValue: false,
      label: 'Lemondott az elállási jogról',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description:
          'A vásárló a megrendeléskor kérte az azonnali hozzáférést, és tudomásul vette, hogy ezzel elveszti a 14 napos elállási jogát.',
      },
    },
    {
      name: 'consentWithdrawalWaiverAt',
      type: 'date',
      label: 'Elállási jogról lemondás időpontja',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      // Visszatérítés-panel (UI-mező, NEM tárol adatot → nincs séma-változás,
      // migrációt nem igényel). A meglévő, kész refund-szolgáltatás fölé épült
      // felület: a kliens-komponens a POST /api/admin/orders/[orderNumber]/refund
      // végpontot hívja (owner-only, minden szabályt a szerver kényszerít ki).
      name: 'refundPanel',
      type: 'ui',
      label: 'Visszatérítés',
      admin: {
        components: {
          Field: '/components/admin/RefundPanel#RefundPanel',
        },
      },
    },
    {
      name: 'refundReason',
      type: 'text',
      label: 'Visszatérítés indoka',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      name: 'refundedAt',
      type: 'date',
      label: 'Visszatérítés időpontja',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
    },
    {
      // Refund-nyom (pénzügyi audit): minden visszatérítés egy bejegyzés —
      // { transactionId, amountHuf, status (Barion RefundedTransactions-státusz),
      //   refundedAt, type: 'full' | 'partial', reason? }.
      // Kizárólag a refund-szolgáltatás írja (overrideAccess: true); a read
      // owner-only, mert pénzügyi tranzakció-adatokat hordoz.
      name: 'refunds',
      type: 'json',
      label: 'Visszatérítések',
      // A generált típus erős marad (lásd refundsTypescriptSchema). A kapott
      // sémát nem eldobjuk, hanem kiegészítjük — így az admin.description-ből
      // származó JSDoc-komment is megmarad a generált típuson.
      typescriptSchema: [({ jsonSchema }) => ({ ...jsonSchema, ...refundsTypescriptSchema })],
      access: {
        read: isOwnerFieldAccess,
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'Visszatérítési nyom: tranzakciós refund-bejegyzések (transactionId, összeg, Barion-státusz, időpont, típus).',
      },
    },
    {
      name: 'ipAddress',
      type: 'text',
      label: 'IP-cím a megrendeléskor',
      access: {
        read: isOwnerFieldAccess,
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        description: 'A megrendelés IP-címe — csalásgyanús eset kivizsgálásához.',
      },
    },
  ],
  hooks: {
    ...defaultCollection.hooks,
    beforeChange: [...(defaultCollection.hooks?.beforeChange ?? []), orderIntegrityBeforeChange],
  },
})

/**
 * Az ecommerce plugin bekötése.
 *
 * - Variants kikapcsolva: egy kurzus = egy ár.
 * - Addresses kikapcsolva: digitális termék, a számlázási cím a users-en él.
 *   A plugin 3.88.0 sanitizePluginConfig-ja az `addresses: false` értéket is
 *   alapértelmezett mezőkkel tölti fel (azaz a boolean false önmagában nem
 *   tiltja le a collectiont), ezért a plugin lefutása után szűrjük ki az
 *   `addresses` slugot.
 * - Guest cart kikapcsolva: nincs guest checkout, a fiók kötelező.
 * - paymentMethods üres (T-063 plugin-adapter-kontroll): a saját Barion
 *   PaymentAdapter az src/lib/payments/barion-adapter.ts-ben él, de NINCS
 *   regisztrálva itt, mert a plugin initiate/confirm végpontjai KOSÁR-
 *   szemantikát követelnek (cartID kötelező), ami ütközik a kosármentes
 *   checkout-folyamatunkkal (POST /api/checkout/start). Így a plugin
 *   /payments/* végpontjai létre sem jönnek — a confirmOrder (ismert
 *   beta-hiba: nem ellenőrzi a fizetés tényleges státuszát) HTTP-n nem
 *   hívható; a paid átmenet kizárólag a Barion-callback-útvonal (T-022) joga.
 *   Védelemképpen a plugin lefutása után a withoutPluginPaymentEndpoints
 *   szűrő akkor is eltávolít minden /payments/* végpontot, ha egy későbbi
 *   módosítás mégis regisztrálná az adaptert.
 * - A saját collectionök (pages/posts/menus/categories/media) access-politikája
 *   szintén itt, központilag kapcsolódik be (applyCollectionAccessPolicies) —
 *   a collection-fájlok a koordinátor fájl-scope-ján kívül esnek; a mátrix és a
 *   leképezés az src/access/policies.ts-ben dokumentált. A users collection
 *   politikája közvetlenül az src/collections/Users.ts-ben él.
 */
export const ecommerce = async (config: Config): Promise<Config> => {
  const withEcommerce = await ecommercePlugin({
    access: {
      adminOnlyFieldAccess,
      adminOrPublishedStatus,
      isAdmin,
      isDocumentOwner,
    },
    addresses: false,
    carts: {
      allowGuestCarts: false,
      cartsCollectionOverride: ({ defaultCollection }) => ({
        ...defaultCollection,
        labels: {
          singular: 'Kosár',
          plural: 'Kosarak',
        },
        admin: {
          ...defaultCollection.admin,
          group: WEBSHOP_GROUP,
          description: 'A vásárlók félbehagyott kosarai. Automatikusan keletkezik — ne szerkeszd.',
          // Ugyanaz a hiba, mint az ordersnél: a plugin `useAsTitle: 'createdAt'`-ja
          // miatt a lista keresője ILIKE-ot futtatna egy timestamptz oszlopon.
          // A kosárnak nincs ember által olvasható azonosítója, ezért az `id` —
          // erre a Payload külön, típushelyes keresést épít.
          useAsTitle: 'id',
        },
      }),
    },
    currencies: {
      defaultCurrency: 'HUF',
      supportedCurrencies: [HUF],
    },
    customers: {
      slug: 'users',
    },
    orders: {
      ordersCollectionOverride,
    },
    payments: {
      paymentMethods: [],
    },
    products: {
      productsCollectionOverride,
      variants: false,
    },
    transactions: {
      transactionsCollectionOverride: ({ defaultCollection }) => ({
        ...defaultCollection,
        labels: {
          singular: 'Tranzakció',
          plural: 'Tranzakciók',
        },
        admin: {
          ...defaultCollection.admin,
          group: WEBSHOP_GROUP,
          description: 'A fizetési tranzakciók nyoma. Csak a rendszer írja — ne szerkeszd.',
        },
      }),
    },
  })(config)

  withEcommerce.collections = applyCollectionAccessPolicies(
    (withEcommerce.collections ?? []).filter((collection) => collection.slug !== 'addresses'),
  )

  // T-063: a plugin /payments/* végpontjai (initiate + confirm-order) sosem
  // maradhatnak a végleges configban — lásd a fejléc- és a payments-kommentet.
  withEcommerce.endpoints = withoutPluginPaymentEndpoints(withEcommerce.endpoints)

  // A plugin typescript.schema-hookja az addresses-collectionre is $ref-et generál
  // (a fenti sanitize-hiba miatt) — mivel a collectiont kiszűrtük, a hivatkozást is
  // el kell távolítani, különben a generate:types hibára fut.
  withEcommerce.typescript = {
    ...withEcommerce.typescript,
    schema: [
      ...(withEcommerce.typescript?.schema ?? []),
      ({ jsonSchema }) => {
        const collections = jsonSchema.properties?.ecommerce?.properties?.collections as
          { properties?: Record<string, unknown>; required?: string[] } | undefined
        if (collections?.properties) {
          delete collections.properties.addresses
          if (Array.isArray(collections.required)) {
            collections.required = collections.required.filter((slug) => slug !== 'addresses')
          }
        }
        return jsonSchema
      },
    ],
  }

  return withEcommerce
}
