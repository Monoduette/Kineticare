import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import { BlocksFeature, lexicalEditor } from '@payloadcms/richtext-lexical'
import type { CollectionOverride, Currency } from '@payloadcms/plugin-ecommerce/types'
import type { JSONSchema4 } from 'json-schema'
import type {
  CheckboxFieldValidation,
  Config,
  DateFieldValidation,
  Field,
  FieldAccess,
  NumberFieldSingleValidation,
  PayloadRequest,
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
import { coursePackage } from '../blocks/CoursePackage'
import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import {
  FREE_COURSE_GUARD_MESSAGE,
  MIN_PRICE_HUF,
  OWNER_ONLY_CHANGE_MESSAGE,
  PRICE_MESSAGE,
  PRODUCT_CONFIRMATIONS_KEY,
  PROMO_END_REQUIRED_MESSAGE,
  isPriceDrop,
  positivePriceOrNull,
  priceDropMessage,
  readProductConfirmations,
  type PriceFieldKind,
  type PriceReferenceSource,
  type ProductChangeConfirmations,
} from '../components/admin/huf-price'
import { preventCourseDeletionWithFiles } from '../access/courseFileDelete'
import { courseModulesField } from '../fields/course-modules'
import { seoKeywordsField } from '../fields/seo-keywords'
import { deleteCourseProgressOnParentDelete } from '../lib/course-progress/cleanup'
import { courseSlugField } from '../fields/course-slug'
import { budapestDateString } from '../lib/date/budapest'
import { formatPriceHuf } from '../lib/format-price'
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
  'promoPriceHuf',
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

/**
 * Az akció időablakának mezői (pipa, kezdet, vég): mivel ezek döntik el a
 * fizetendő árat, az Ár mezővel azonos owner-only írás védi őket (T-011).
 * Olvasásuk nyitott, mert a kurzusoldal és a kártya ebből számol.
 */
const promoWindowFieldAccess = {
  create: isOwnerFieldAccess,
  update: isOwnerFieldAccess,
}

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

/** A validátorok közös bemenete (a Payload validate-opcióinak az itt olvasott része). */
interface GuardOptions {
  data?: unknown
  siblingData?: unknown
  id?: number | string
  operation?: string
  overrideAccess?: boolean
  previousValue?: unknown
  req?: PayloadRequest
}

/**
 * Ki adhat megerősítést: a tulajdonos, aki a kurzus ár-, ingyenesség- és
 * akció-mezőit írhatja (T-011). Rendszerfolyamat (overrideAccess) és req
 * nélküli hívás tulajdonosként számít.
 *
 * r2-termekor (H2): ez NEM zárja ki a munkatársat az őrökből. A Payload a
 * munkatárs által nem írható mező beküldött értékét eldobja, és a tárolt
 * értéket teszi a helyére (payload/dist/fields/hooks/beforeValidate/
 * promise.js, access → getFallbackValue). A tárolt érték viszont a LEGUTÓBBI
 * VERZIÓ, autosave mellett tehát a tulajdonos piszkozata is lehet
 * (payload/dist/collections/operations/utilities/update.js: originalDoc =
 * getLatestCollectionVersion). Amikor az őrök a munkatársnál feltétel nélkül
 * átengedtek, a munkatárs Közzététel gombja a tulajdonos meg nem erősített,
 * piszkozatban hagyott ingyenes-, ár- vagy akció-módosítását vitte élesbe
 * (mérve valódi Payload + Postgres mellett). Ezért az őrök mindenkinél
 * ugyanúgy futnak; a zárás elleni védelmet a változatlan, már közzétett érték
 * kivételei adják (a munkatársnál a tárolt érték mindig a változatlan).
 * Megerősítést viszont csak a tulajdonos adhat: a beküldött adatban bárki
 * küldhetne `kcMegerositesek`-et.
 */
async function ownerMayWrite(options: GuardOptions): Promise<boolean> {
  const { overrideAccess, req, data, siblingData, id } = options
  if (overrideAccess === true || req === undefined) return true
  return Boolean(
    await isOwnerFieldAccess({
      req,
      data: data as Record<string, unknown> | undefined,
      siblingData: siblingData as Record<string, unknown> | undefined,
      id,
    }),
  )
}

/**
 * Az őr elutasító üzenete. A tulajdonos a teendőt kapja (javítsa vagy
 * erősítse meg); a munkatárs azt, hogy ezt csak a tulajdonos teheti közzé,
 * mert ő a mezőt nem írhatja át, és megerősítést sem adhat.
 */
async function refusalFor(options: GuardOptions, ownerMessage: string): Promise<string> {
  return (await ownerMayWrite(options)) ? ownerMessage : OWNER_ONLY_CHANGE_MESSAGE
}

type PublishedProduct = Record<string, unknown>

/**
 * A fő táblában álló kurzus-sor ár- és akció-mezői, bármilyen `_status`
 * mellett. A products autosave-es piszkozatot használ, ezért a Payload
 * `previousValue`-ja a legutóbbi PISZKOZAT értéke (payload/dist/collections/
 * operations/utilities/update.js: originalDoc = getLatestCollectionVersion).
 * Ha a tulajdonos beír egy hibás árat, az autosave validálás nélkül elmenti a
 * piszkozatba, és közzétételkor a `previousValue` már ezt a hibás árat mutatná
 * „változatlannak”. A közzétett érték dönti el, mi a régi ár.
 *
 * Visszatérés: `undefined`, ha nem olvasható (fail-closed: a hívó ilyenkor
 * nem tekinti az értéket réginek). A `trash: true` a lomtárból visszaállított
 * kurzust is megtalálja.
 */
async function readProductRow(
  req: PayloadRequest | undefined,
  id: number | string | undefined,
): Promise<PublishedProduct | undefined> {
  if (id === undefined || typeof req?.payload?.findByID !== 'function') return undefined
  try {
    const row = await req.payload.findByID({
      collection: 'products',
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      req,
      trash: true,
      select: {
        _status: true,
        deletedAt: true,
        priceInHUF: true,
        priceInHUFEnabled: true,
        promoEnabled: true,
        promoEnd: true,
        promoPriceHuf: true,
      },
    })
    return row as unknown as PublishedProduct
  } catch {
    return undefined
  }
}

/**
 * A fő tábla sora csak `_status === 'published'` mellett közzétett érték. A
 * fő táblába validálás nélkül is kerül adat, `_status: 'draft'`-tal: a
 * duplikálás (a Payload duplicate végpontja alapból draft=true, a
 * createOperation a másolatot a fő táblába írja, create.js), a lomtárba
 * helyezés (a PATCH a legutóbbi autosave-es piszkozatot írja a fő sorba,
 * update.js skipValidation) és a közzététel visszavonása. Az ilyen sor értékét
 * egyik őr sem tekintheti a vásárló által látott, már elfogadott állapotnak.
 */
function isPublishedRow(
  published: PublishedProduct | null | undefined,
): published is PublishedProduct {
  return published?._status === 'published'
}

/** A sor a lomtárban van (a Payload trash `deletedAt` mezője ki van töltve). */
function isTrashedRow(published: PublishedProduct): boolean {
  return published.deletedAt !== null && published.deletedAt !== undefined
}

/** Ennyi legutóbbi naplóbejegyzést néz át a pillanatkép keresése (kurzusonként). */
const LAST_PUBLISHED_LOOKBACK = 20

const asRecord = (value: unknown): PublishedProduct | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as PublishedProduct)
    : null

/**
 * A kurzus LEGUTÓBB KÖZZÉTETT állapota, ha a fő sor most nem közzétett
 * (r2-termekor, H3). A közzététel visszavonása (az admin UnpublishButton-ja:
 * PATCH `?unpublishAllLocales=true`, `_status: 'draft'`) a fő sort validálás
 * nélkül piszkozatra írja, a lomtárba helyezés pedig a piszkozatot írja oda.
 * A verziótábla nem megbízható forrás: a visszavonás a legutóbbi verziót
 * helyben felülírja (payload/dist/versions/saveVersion.js → updateLatestVersion),
 * és ha ez a közzétett volt, a `_products_v`-ben nem marad közzétett változat
 * (mérve: az egyetlen közzétett verzió `_status`-a draftra váltott).
 *
 * A műveletnapló igen: a közzétételt, a visszavonást és a lomtárba helyezést a
 * fő sor előtte/utána állapotával naplózzuk (src/plugins/audit.ts, a-cms-12),
 * a bejegyzést csak a rendszer írhatja (src/collections/AuditLogs.ts). A
 * legfrissebb bejegyzés, amelynek egyik oldala közzétett sor, a legutóbb
 * közzétett állapot: az utolsó közzététel utáni sor („after”), vagy a
 * visszavonás, lomtárba helyezés előtti („before”). A másolatnak és a soha
 * nem közzétett kurzusnak nincs ilyen bejegyzése. Hiány vagy olvasási hiba:
 * null, és a hívó ilyenkor nem ad kivételt.
 */
async function readLastPublishedSnapshot(
  req: PayloadRequest | undefined,
  id: number | string,
): Promise<PublishedProduct | null> {
  if (typeof req?.payload?.find !== 'function') return null
  try {
    const { docs } = await req.payload.find({
      collection: 'audit-logs',
      where: {
        and: [{ entityType: { equals: 'products' } }, { entityId: { equals: String(id) } }],
      },
      sort: '-createdAt',
      limit: LAST_PUBLISHED_LOOKBACK,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      select: { before: true, after: true },
    })
    for (const entry of docs) {
      for (const side of [entry.after, entry.before]) {
        const snapshot = asRecord(side)
        if (isPublishedRow(snapshot)) return snapshot
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * A mentés viszonyítási alapja frissítésnél (új kurzusnál, create: null, ott
 * nincs vásárló és nincs mihez mérni).
 * - `row`: a fő sor, ahogy most áll; `undefined`, ha nem olvasható.
 * - `lastPublished`: a legutóbb közzétett állapot: a közzétett fő sor, ha az
 *   most is közzétett, különben a napló pillanatképe; null, ha nincs.
 */
interface ProductReference {
  row: PublishedProduct | undefined
  lastPublished: PublishedProduct | null
}

async function productReference(options: GuardOptions): Promise<ProductReference | null> {
  if (options.operation !== 'update' || options.id === undefined) return null
  const row = await readProductRow(options.req, options.id)
  if (row === undefined) return { row, lastPublished: null }
  if (isPublishedRow(row)) return { row, lastPublished: row }
  return { row, lastPublished: await readLastPublishedSnapshot(options.req, options.id) }
}

/**
 * A tulajdonos megerősítései ehhez a mentéshez. Két forrásból: az admin
 * űrlap a mentés adataiban küldi (a HufPriceField jelölőnégyzete, kulcs:
 * PRODUCT_CONFIRMATIONS_KEY), a Local API-t hívó szkript a `req.context`-ben.
 * A kulcs nem séma-mező, a Payload nem tárolja (src/components/admin/huf-price.ts).
 * Más szerepkör (munkatárs) beküldött megerősítése nem számít (H2).
 */
async function ownerConfirmations(options: GuardOptions): Promise<ProductChangeConfirmations> {
  if (!(await ownerMayWrite(options))) return {}
  const fromContext = readProductConfirmations(options.req?.context?.[PRODUCT_CONFIRMATIONS_KEY])
  const data = options.data
  const fromData =
    typeof data === 'object' && data !== null
      ? readProductConfirmations((data as Record<string, unknown>)[PRODUCT_CONFIRMATIONS_KEY])
      : {}
  return { ...fromData, ...fromContext }
}

/**
 * WP58: az akció vége ne előzze meg a kezdetét. A dayOnly választó a napot
 * 12:00 UTC-ként menti, a REST API-n pedig éjfél is jöhet, ezért nem a
 * pillanatokat, hanem a Budapest szerinti NAPOKAT hasonlítjuk (azonos nap
 * megengedett: egynapos akció). A `value` futásidőben string vagy Date.
 *
 * r2-termekor (a-cms-9): bekapcsolt akcióhoz a vége is kötelező. Vég nélküli
 * akciónál a kurzusoldal visszavonásig érvényes akciót mutat, az áthúzott ár
 * pedig időkorlát nélkül áll. A már közzétett, vég nélküli akció nem zárja ki
 * a kurzus többi mezőjének mentését: az ilyen akció addig marad, amíg a
 * tulajdonos meg nem adja a végét. Csak ez az ág olvas adatbázist, ezért a
 * többi eset szinkron marad.
 *
 * A kivétel a legutóbb KÖZZÉTETT állapotra él (productReference): a
 * közzététel visszavonása vagy a lomtár után újra közzétett kurzus meglévő,
 * vég nélküli akciója nem „új” (H3). Egy élő kurzus másolata (a 4. kurzus is
 * így készült, docs/akcios-kurzus-2026-09-20.md) a vég nélküli akciót
 * piszkozat-sorként örökli, közzétett állapota viszont nincs; ha a kivétel ezt
 * is elfogadná, a másolat első közzétételével egy új termék menne élesbe vég
 * nélküli akcióval.
 */
export const validatePromoEnd: DateFieldValidation = (value, options) => {
  const sibling = options.siblingData as
    { promoStart?: unknown; promoEnabled?: unknown } | undefined
  const end = toValidDate(value)
  const start = toValidDate(sibling?.promoStart)
  if (end !== null && start !== null && budapestDateString(end) < budapestDateString(start)) {
    return PROMO_END_BEFORE_START_MESSAGE
  }
  if (end !== null || sibling?.promoEnabled !== true) {
    return true
  }
  return validatePromoEndRequired(options)
}

async function validatePromoEndRequired(options: GuardOptions): Promise<string | true> {
  const lastPublished = (await productReference(options))?.lastPublished ?? null
  if (
    lastPublished !== null &&
    lastPublished.promoEnabled === true &&
    (lastPublished.promoEnd === null || lastPublished.promoEnd === undefined)
  ) {
    return true
  }
  return refusalFor(options, PROMO_END_REQUIRED_MESSAGE)
}

export const PROMO_PRICE_MESSAGE = `Az akciós ár csak pozitív egész forintösszeg lehet, legalább ${MIN_PRICE_HUF} Ft, vagy hagyd üresen.`

/**
 * K21: a rendes árnál nem kisebb akciós ár üzenete. A kurzus-szerkesztő
 * állapotdoboza (src/components/admin/CoursePromoStatus.tsx) ugyanezt a
 * helyzetet a vásárló szemszögéből írja le, a két szöveg párban áll.
 *
 * Az üzenet megmondja, mi a baj és hogyan javítható (NN/g, Error-Message
 * Guidelines: „Offer constructive advice”,
 * https://www.nngroup.com/articles/error-message-guidelines/; GOV.UK Design
 * System, Error message: „tell someone what has happened and how to fix it”,
 * https://design-system.service.gov.uk/components/error-message/; WCAG 2.2
 * SC 3.3.3 Error Suggestion). Az ár a vásárlói felület formázójával áll
 * („79 500 Ft”), hogy a szerkesztő ugyanazt a számot lássa, mint a vásárló.
 */
export function promoPriceNotBelowRegularMessage(regularPriceHuf: number): string {
  return `Az akciós ár legyen kisebb a rendes árnál (${formatPriceHuf(regularPriceHuf)}). Írj be kisebb összeget, vagy hagyd üresen.`
}

/**
 * A rendes ár a `resolveCoursePromo` szabálya szerint (src/lib/course-promo.ts):
 * csak bekapcsolt „Fizetős kurzus” mellett, pozitív összegként létezik. Ha
 * nincs rendes ár, az akciós árnak nincs mihez képest kisebbnek lennie.
 */
export function regularPriceHufFrom(source: unknown): number | null {
  if (typeof source !== 'object' || source === null) return null
  const record = source as { priceInHUF?: unknown; priceInHUFEnabled?: unknown }
  if (record.priceInHUFEnabled !== true) return null
  const price = record.priceInHUF
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? Math.round(price) : null
}

/** Az árcsökkenés viszonyítási ára, a megnevezéséhez szükséges fajtával és forrással. */
interface DropReference {
  price: number
  kind: PriceFieldKind
  source: PriceReferenceSource
}

/**
 * Mihez mérjük az új ár csökkenését. Elsőként a legutóbb KÖZZÉTETT állapothoz
 * (a vásárló ezt látja most, vagy a közzététel visszavonása előtt ezt látta).
 * Ha a kurzusnak nincs ismert közzétett állapota (másolat, soha nem közzétett
 * kurzus, hiányzó naplóbejegyzés), a fő sorban eddig mentett árhoz: ez csak
 * megerősítést kérhet, átengedni semmit nem enged (H3, a közzététel
 * visszavonása után elütött 7 950 Ft). Akciós árnál az akciós ár, ha van,
 * különben a rendes ár (egy új, a rendes ár felénél kisebb akció is szokatlan).
 */
function dropReference(
  reference: ProductReference | null,
  kind: PriceFieldKind,
): DropReference | null {
  const source = reference?.lastPublished ?? reference?.row ?? null
  if (source === null) return null
  const origin: PriceReferenceSource = reference?.lastPublished ? 'kozzetett' : 'eddigi'
  if (kind === 'akcios') {
    const promo = positivePriceOrNull(source.promoPriceHuf)
    if (promo !== null) return { price: promo, kind: 'akcios', source: origin }
  }
  const regular = regularPriceHufFrom(source)
  return regular === null ? null : { price: regular, kind: 'rendes', source: origin }
}

/**
 * Változatlan, már közzétett érték: régi sor más mezőjének mentése nem bukhat
 * el rajta. Csak a legutóbb közzétett állapotra: a másolat vagy a soha nem
 * közzétett kurzus piszkozat-sorában álló hibás ár nem „régi”.
 */
function unchangedPublishedValue(
  options: GuardOptions,
  value: unknown,
  reference: ProductReference | null,
  field: 'priceInHUF' | 'promoPriceHuf',
): boolean {
  return (
    options.operation === 'update' &&
    value === options.previousValue &&
    reference?.lastPublished !== null &&
    reference?.lastPublished !== undefined &&
    reference.lastPublished[field] === value
  )
}

/**
 * r2-termekor (a-cms-2): a rendes ár (a plugin gyári `priceInHUF` mezője)
 * eddig semmilyen szerver-oldali ellenőrzést nem kapott. Mért hiba: a plugin
 * beviteli mezője a „79.500”-at 80 Ft-ként mentette, és a pénztár minden
 * pozitív árat elfogadott, így 80 Ft-os számla ment volna a NAV-hoz.
 *
 * A szabály: egész forint, legalább MIN_PRICE_HUF (a Barion kártyás alsó
 * határa); a legutóbb közzétett ár felénél kisebb új ár pedig csak a
 * tulajdonos kifejezett, erre az összegre szóló megerősítésével menthető
 * (WCAG 2.2 SC 3.3.4, Error Prevention: Legal, Financial, Data). Üres ár: a
 * kurzus nem vásárolható (a pénztár elutasítja), de nem is ingyenes, ezért
 * megengedett. A Payload ezt a validátort csak bekapcsolt „Fizetős kurzus”
 * mellett futtatja (a plugin mező-feltétele), és piszkozat mentésekor
 * egyáltalán nem. Ha a fő sor nem olvasható, a csökkenés nem mérhető: ilyenkor
 * is él az egész forint és a 10 Ft-os alsó határ (a mentés ugyanabban a
 * tranzakcióban úgyis az adatbázisra vár).
 */
export const validatePriceInHUF: NumberFieldSingleValidation = async (value, options) => {
  if (value === null || value === undefined) {
    return true
  }
  const reference = await productReference(options)
  if (!(Number.isSafeInteger(value) && value >= MIN_PRICE_HUF)) {
    return unchangedPublishedValue(options, value, reference, 'priceInHUF')
      ? true
      : refusalFor(options, PRICE_MESSAGE)
  }
  const drop = dropReference(reference, 'rendes')
  if (drop === null || !isPriceDrop(value, drop.price)) {
    return true
  }
  if ((await ownerConfirmations(options)).priceInHUF === value) {
    return true
  }
  return refusalFor(options, priceDropMessage('rendes', value, drop.price, drop.kind, drop.source))
}

/**
 * WP63 + K21: az akciós ár egész forint (a HUF-nak nincs tizedese), és kisebb
 * a rendes árnál (a resolveCoursePromo az egyenlő vagy nagyobb árat úgyis
 * figyelmen kívül hagyja, de korábban erre „Sikeresen frissítve.” jött).
 * r2-termekor: legalább MIN_PRICE_HUF (a Barion alsó határa; korábban 1 Ft is
 * átment), és a hivatkozási ár felénél kisebb új akciós ár megerősítést kér.
 *
 * A változatlan, már közzétett érték átmegy (previousValue ÉS a legutóbb
 * közzétett érték egyezik); a frissen beírt vagy csak piszkozatban álló hibás
 * érték viszont hibát ad. Így a rendes ár későbbi csökkentése sem zárja ki a
 * mentést; ezt a helyzetet az állapotdoboz jelzi.
 */
export const validatePromoPriceHuf: NumberFieldSingleValidation = async (value, options) => {
  if (value === null || value === undefined) {
    return true
  }
  const { data, siblingData } = options
  const regular = regularPriceHufFrom(siblingData) ?? regularPriceHufFrom(data)
  const message = !(Number.isSafeInteger(value) && value >= MIN_PRICE_HUF)
    ? PROMO_PRICE_MESSAGE
    : regular !== null && value >= regular
      ? promoPriceNotBelowRegularMessage(regular)
      : null
  const reference = await productReference(options)
  if (message !== null) {
    return unchangedPublishedValue(options, value, reference, 'promoPriceHuf')
      ? true
      : refusalFor(options, message)
  }
  const drop = dropReference(reference, 'akcios')
  if (drop === null || !isPriceDrop(value, drop.price)) {
    return true
  }
  if ((await ownerConfirmations(options)).promoPriceHuf === value) {
    return true
  }
  return refusalFor(options, priceDropMessage('akcios', value, drop.price, drop.kind, drop.source))
}

/**
 * A kurzus fizetett vagy visszatérített rendeléseinek száma; hiba esetén null
 * (a hívó ilyenkor fail-closed dönt).
 */
async function countPaidOrRefundedOrders(
  req: PayloadRequest | undefined,
  id: number | string,
): Promise<number | null> {
  if (typeof req?.payload?.count !== 'function') return null
  try {
    const { totalDocs } = await req.payload.count({
      collection: 'orders',
      overrideAccess: true,
      req,
      where: {
        and: [{ 'items.product': { equals: id } }, { status: { in: ['paid', 'refunded'] } }],
      },
    })
    return totalDocs
  } catch {
    return null
  }
}

/**
 * r2-termekor (a-cms-1): a „Fizetős kurzus” pipa kivétele INGYENESSÉ teszi a
 * kurzust (src/lib/courses.ts isFreeCourse), nem az eladást állítja le. A
 * régi felirat („Megvásárolható”, „Kikapcsolva a kurzus nem vásárolható
 * meg.”) az ellenkezőjét mondta: a 79 500 Ft-os program „szüneteltetése”
 * bárkinek ingyen, visszavonhatatlanul odaadta volna.
 *
 * Közzétételkor hibát ad, ha egy eddig fizetős kurzus ingyenes lenne, és van
 * ára vagy fizetett, visszatérített rendelése, kivéve, ha a tulajdonos a pipa
 * alatti jelölőnégyzettel kifejezetten megerősítette (WCAG 2.2 SC 3.3.4). A
 * már ingyenes kurzus (a közzétett érték is kikapcsolt) szabadon menthető. Új
 * kurzuson (create) nincs vásárló, ott nem kérdez. Ha a közzétett állapot vagy
 * a rendelések nem olvashatók, fail-closed: megerősítést kér.
 *
 * „Már ingyenes” csak a valóban közzétett, lomtáron kívüli fő sor lehet (a
 * napló pillanatképe itt nem számít: egy téves „már ingyenes” visszavonhatatlan
 * hozzáféréseket adna). A lomtárba helyezés és a „visszaállítás
 * piszkozatként” validálás nélkül a legutóbbi autosave-es piszkozatot írja a
 * fő sorba (update.js: skipValidation), így ott a kivett pipa ez az őr nélkül
 * is a fő sorba kerülhet, `_status: 'draft'`-tal. Ezért az ingyenes kurzust
 * kiadó utak (src/lib/free-course/request-access.ts,
 * src/lib/free-course-grant.ts) a piszkozat-sort nem tekintik élőnek (H4); a
 * „visszaállítás közzétettként” validál, és ezen az őrön megy át.
 */
export const validatePriceInHUFEnabled: CheckboxFieldValidation = async (value, options) => {
  if (value !== false || options.operation !== 'update' || options.id === undefined) {
    return true
  }
  if ((await ownerConfirmations(options)).freeCourse === true) {
    return true
  }
  const row = await readProductRow(options.req, options.id)
  if (isPublishedRow(row) && !isTrashedRow(row) && row.priceInHUFEnabled === false) {
    return true
  }
  const sibling = options.siblingData as { priceInHUF?: unknown } | undefined
  const hasPrice =
    positivePriceOrNull(sibling?.priceInHUF) !== null ||
    positivePriceOrNull(row?.priceInHUF) !== null
  const orders = await countPaidOrRefundedOrders(options.req, options.id)
  if (!hasPrice && orders === 0 && row !== undefined) {
    return true
  }
  return refusalFor(options, FREE_COURSE_GUARD_MESSAGE)
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
// WP63: az akciós ár (`promoPriceHuf`) is fizetendő ár, de saját mező, nem
// a plugin gyári mezője: az owner-only kapuja a mezőn közvetlenül áll.
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
/*
 * K34: a plugin gyári feliratai („Ár (HUF)”, „HUF ár engedélyezése”) a lap
 * többi „(Ft)” feliratával keveredtek; a szerkesztő a forintot „Ft”-nak hívja
 * (NN/g, Match Between the System and the Real World,
 * https://www.nngroup.com/articles/match-system-real-world/; WCAG 2.2 SC 3.2.4:
 * egy fogalom, egy név).
 */
const courseFieldAdminOverrides: Record<
  string,
  { description?: string; hidden?: boolean; label?: string }
> = {
  inventory: { hidden: true },
  priceInHUF: {
    label: 'Ár (Ft)',
    description: `A kurzus rendes, bruttó ára egész forintban, legalább ${MIN_PRICE_HUF} Ft. Ennyit fizet a vásárló a pénztárnál, ha nincs élő akció. Ezres tagolónak szóközt vagy pontot is írhatsz (79 500 vagy 79.500), a mező alatt látod, hogyan jelenik meg. Csak a tulajdonos állíthatja.`,
  },
  /*
   * r2-termekor (a-cms-1): a felirat azt mondja, amit a kód csinál. A régi
   * „Megvásárolható” / „Kikapcsolva a kurzus nem vásárolható meg.” szerint a
   * pipa kivétele az eladást állítja le, valójában a kurzust ingyenessé teszi
   * (src/lib/courses.ts isFreeCourse). NN/g, Match Between the System and the
   * Real World (https://www.nngroup.com/articles/match-system-real-world/);
   * GOV.UK Design System, hint text: „how their information will be used”
   * (https://design-system.service.gov.uk/components/text-input/).
   */
  priceInHUFEnabled: {
    label: 'Fizetős kurzus',
    description:
      'Bepipálva a vásárló az Ár (Ft) mezőben megadott összeget fizeti. Pipa nélkül a kurzus ingyenes: bárki megkapja, aki megadja a nevét és az e-mail-címét, és a hozzáférése akkor is megmarad, ha a pipát később visszateszed. Az eladás leállítása nem ez, hanem a „Megjelenés a weboldalon” mező „Archivált” értéke (a „Piszkozat” a vásárlóktól is elveszi a videókat). Csak a tulajdonos állíthatja.',
  },
}

/**
 * r2-termekor: a plugin két ár-mezőjének szerver-oldali validátora és admin
 * beviteli komponense. Csak a `validate` és az `admin.components.Field` kerül
 * a mezőre; az access (T-011, withOwnerOnlyPriceAccess), a feltétel, a lista
 * cellája és a többi admin-beállítás változatlan.
 * - Ár (Ft): a gyári PriceInput a pontot tizedesjelnek vette („79.500” → 80 Ft);
 *   a HufPriceField ezres tagolónak veszi, és megmutatja a mentendő összeget.
 * - Fizetős kurzus: a gyári pipa, alatta a kikapcsolás következményével és a
 *   megerősítő jelölőnégyzettel (PaidCourseField).
 */
const HUF_PRICE_FIELD_COMPONENT = '/components/admin/HufPriceField#HufPriceField'
const PAID_COURSE_FIELD_COMPONENT = '/components/admin/HufPriceField#PaidCourseField'

const pluginPriceFieldGuards: Record<
  string,
  {
    validate: NumberFieldSingleValidation | CheckboxFieldValidation
    Field: { path: string; clientProps?: Record<string, unknown> }
  }
> = {
  priceInHUF: {
    validate: validatePriceInHUF,
    Field: { path: HUF_PRICE_FIELD_COMPONENT, clientProps: { kind: 'rendes' } },
  },
  priceInHUFEnabled: {
    validate: validatePriceInHUFEnabled,
    Field: { path: PAID_COURSE_FIELD_COMPONENT },
  },
}

const withPluginPriceGuards = (field: Field): Field => {
  const named = namedField(field)
  const guard = named === null ? undefined : pluginPriceFieldGuards[named.name]
  if (named === null || guard === undefined) {
    return field
  }
  const admin = (named as { admin?: { components?: Record<string, unknown> } }).admin
  return {
    ...named,
    validate: guard.validate,
    admin: {
      ...admin,
      components: { ...admin?.components, Field: guard.Field },
    },
  } as Field
}

const withCourseFriendlyAdmin = (field: Field): Field => {
  const named = namedField(field)
  const override = named === null ? undefined : courseFieldAdminOverrides[named.name]
  if (named === null || override === undefined) {
    return field
  }
  return {
    ...named,
    ...(override.label === undefined ? {} : { label: override.label }),
    admin: {
      ...(named as { admin?: Record<string, unknown> }).admin,
      ...(override.hidden === undefined ? {} : { hidden: override.hidden }),
      ...(override.description === undefined ? {} : { description: override.description }),
    },
  } as Field
}

/** Van-e a mezőfában (névtelen konténereken át is) ilyen nevű mező. */
const containsFieldNamed = (fields: readonly Field[], name: string): boolean =>
  fields.some(
    (field) =>
      ('name' in field && field.name === name) ||
      ('fields' in field &&
        Array.isArray(field.fields) &&
        containsFieldNamed(field.fields as Field[], name)),
  )

/**
 * r2-termekor (H6): a plugin ár-csoportja (pricesField: NÉVTELEN group → row →
 * „Fizetős kurzus” + „Ár (Ft)”) címke nélkül érkezik. A Payload a mentés
 * hibaüzenetének mezőútvonalában a névtelen csoport helyére a mező TÍPUSÁT
 * írja (payload/dist/fields/hooks/beforeChange/promise.js: `fallbackLabel =
 * field?.label || (isNamedGroup ? field.name : field?.type)`), így az ár-őrök
 * elutasításakor a toast így szólt: „Javítsd ezt a mezőt: Ár és hozzáférés →
 * Group → Ár (Ft)”. A `label: false` kihagyja a csoportot az útvonalból
 * (ugyanott: `field?.label === false`), a felületen pedig nem változtat: a
 * Payload GroupField csak igaz értékű címkét rajzol ki.
 *
 * A csoport gyári, angol súgója („Prices for this product in different
 * currencies.”) a fül tetején állt; a két mező saját magyar súgója mindent
 * elmond, ezért elhagyjuk (a felületi szöveg magyar, CLAUDE.md).
 */
const withUnlabelledPriceGroup = (field: Field): Field => {
  if (
    field.type !== 'group' ||
    ('name' in field && typeof field.name === 'string' && field.name.length > 0) ||
    !containsFieldNamed(field.fields, 'priceInHUF')
  ) {
    return field
  }
  const admin = { ...field.admin }
  delete admin.description
  return { ...field, label: false, admin } as Field
}

/**
 * H13: a Kurzusok tömbjeinek beszédes sorcímkéje. Összecsukott állapotban a
 * Payload „Kérdés 01”, „Sor 03” feliratot adna, és a sor tartalma csak
 * kinyitva derülne ki; a közös ArrayRowLabel az első kitöltött cím-mezőt
 * mutatja („1. Mennyi idő naponta?”), üres sornál „3. kérdés (még üres)”,
 * képes sornál a kép leírását vagy fájlnevét (src/lib/section-row-label.ts,
 * a Pages.ts `faq` mezőjének mintája).
 *
 * Források: WCAG 2.2 SC 2.4.6 Headings and Labels („Headings and labels
 * describe topic or purpose”, https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels);
 * NN/g, Accordions on Desktop: „Ensure that the heading accurately reflects
 * the content within the panel.”
 * (https://www.nngroup.com/articles/accordions-on-desktop/).
 */
const KURZUS_TOMB_SORCIMKE = '/components/admin/SectionRowLabel#ArrayRowLabel'

const kurzusTombSorcimke = (
  singular: string,
  titleFields: readonly string[],
  imageField?: string,
) => ({
  RowLabel: {
    path: KURZUS_TOMB_SORCIMKE,
    clientProps: {
      singular,
      titleFields: [...titleFields],
      ...(imageField === undefined ? {} : { imageField }),
    },
  },
})

/**
 * H24: a Részletes leírás kulcsszavas címsorainak hatása, a leírás alatt.
 *
 * A kurzusoldal a leírás egyes szakaszait kiemeli a folyószövegből
 * (src/components/courses/sales-content.ts: classifyHeading, segmentDocument,
 * buildCourseSalesContent). A szerkesztő erről eddig semmit nem látott: egy
 * alcím átírása szakaszt tüntetett el vagy helyezett át. A mondat minden
 * állítása a kódból van mérve:
 *  - a címsor-minták: classifyHeading (részszó-egyezés, a tagadó ág dönt előbb);
 *  - a szakasz a következő azonos vagy magasabb szintű címsorig tart;
 *  - a kitöltött mező nyer, és a leírás kinyert szakasza ekkor sem kerül
 *    vissza a szövegbe (a `derived` jelzőt a mező kitöltöttsége nem érinti);
 *  - tartalom nélküli szakasz a helyén marad;
 *  - ingyenes kurzuson a garancia-szakasz sehol nem jelenik meg (`facts.free`);
 *  - üres Fő előnyöknél a törzs első felsorolásának első három sora lesz
 *    pipás sor, és a törzsben is megmarad.
 * A src/__tests__/kurzus-admin-sugok.test.ts minden idézett példacímsort a
 * classifyHeading-hez köt, és minden idézett mezőnevet a mező címkéjéhez.
 *
 * Források: W3C ATAG 2.0 A.4.2.2 Document All Features, (b) Described in the
 * Interface: „Use of the feature is explained in the authoring tool user
 * interface” (https://www.w3.org/TR/ATAG20/#sc_a422); NN/g, 10 Usability Heuristics,
 * #1 Visibility of System Status és #10 Help and Documentation
 * (https://www.nngroup.com/articles/ten-usability-heuristics/). A Payload saját
 * FieldDescription-komponense rajzolja (a src/blocks/film-hero.ts mintája),
 * így a többi mezőleírással azonos betűt és kontrasztot kap.
 */
export const RESZLETES_LEIRAS_CIMSORAI_SUGO =
  'Kulcsszavas címsorok a Részletes leírásban. A „Kinek nem való” vagy „Nem javasoljuk” típusú címsor alatti felsorolás a Kinek nem való listába kerül. A „Garancia” címsor és az alatta álló bekezdés a garancia-sávba kerül. A „Gyakori kérdések” vagy „GYIK” címsor alatt az alcímek a kérdések, az alattuk álló szöveg a válasz, és ezek a GYIK-be kerülnek. A „Kinek való”, „neked való” vagy „tökéletes számodra, ha” típusú címsor alatti felsorolás a Kinek való listába kerül. Elég, ha a címsor tartalmazza a kifejezést, például „30 napos kipróbálási garancia”. A szakasz a következő, vele azonos vagy magasabb szintű címsorig tart. Ha a megfelelő mező ki van töltve („Kinek nem való”, „Kinek való (pipás lista)”, „Gyakori kérdések (GYIK)”, a garanciánál a „Garancia címe” és a „Garancia szövege” együtt), a mező tartalma látszik, a leírás szakasza pedig sehol. Ha a szakaszból nem lesz tartalom (például nincs alatta felsorolás), a szöveg a helyén marad. Ingyenes kurzusnál a garancia-szakasz sehol nem jelenik meg. Ha a „Fő előnyök (pipás sorok)” mező üres, a leírásban maradó szöveg első felsorolásának első három sora pipás előny lesz, és a leírásban is megmarad. Egy ilyen címsor átírása ezért a szakaszt visszateheti a szövegbe, vagy kiveheti a sávból.'

const reszletesLeirasCimsorai: Field = {
  name: 'reszletesLeirasCimsorai',
  type: 'ui',
  admin: {
    components: {
      Field: {
        path: '@payloadcms/ui#FieldDescription',
        clientProps: {
          description: RESZLETES_LEIRAS_CIMSORAI_SUGO,
          marginPlacement: 'bottom',
        },
      },
    },
  },
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
    label: 'A kurzus belső azonosítója a vásárláskor',
    access: {
      create: () => false,
      update: () => false,
    },
    admin: {
      readOnly: true,
      description:
        'A kurzus belső azonosítója a vásárlás pillanatában. Nem változik, ha a kurzus címét később átírják.',
    },
  },
  {
    name: 'priceHufSnapshot',
    type: 'number',
    label: 'Ár a vásárláskor (Ft)',
    access: {
      create: () => false,
      update: () => false,
    },
    admin: {
      readOnly: true,
      description: 'A kurzus ára a vásárlás pillanatában, forintban. Élő akciónál ez az akciós ár.',
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

/*
 * K34 + K44 (admin-szótár: vásárló, nem „ügyfél”): a plugin gyári mezőinek
 * felirata. R1 #8: a `transactions` kapcsolat mindig üres (a paymentMethods
 * üres, a plugin tranzakciót nem hoz létre), és a Tranzakciók gyűjtemény
 * rejtett, ezért a mező sem látszik. Csak megjelenítés: a mező a sémában és a
 * form-állapotban megmarad (Payload admin.hidden: „Its value will still
 * submit … but the field itself will not be visible”,
 * https://payloadcms.com/docs/fields/overview).
 */
const orderPluginFieldAdmin: Record<string, { label?: string; hidden?: boolean }> = {
  customer: { label: 'Vásárló' },
  customerEmail: { label: 'Vásárló e-mail-címe' },
  transactions: { hidden: true },
}

const withOrderFriendlyAdmin = (field: Field): Field => {
  const named = namedField(field)
  const override = named === null ? undefined : orderPluginFieldAdmin[named.name]
  if (named === null || override === undefined) {
    return field
  }
  return {
    ...named,
    ...(override.label === undefined ? {} : { label: override.label }),
    admin: {
      ...(named as { admin?: Record<string, unknown> }).admin,
      ...(override.hidden === undefined ? {} : { hidden: override.hidden }),
    },
  } as Field
}

/**
 * K34: a számlázás, a stornó- és a helyesbítő számla 16 rendszermezője
 * (mérve: a rendelés fő hasábjában 18 rendszermező állt nyitva, a két
 * Barion-azonosítóval együtt) egy alapból csukott, név nélküli csoportba
 * kerül. A csoport NÉV NÉLKÜLI collapsible, ezért a tárolt útvonal és a séma
 * nem változik (a G2 őr, schema-config-sync.test.ts igazolja).
 *
 * Progresszív feltárás: a ritkán kellő adat egy kattintásnyira van, a
 * gyakori (rendelésszám, végösszeg, állapot, tételek) elöl marad (NN/g,
 * Progressive Disclosure: „disclose everything that users frequently need up
 * front”, https://www.nngroup.com/articles/progressive-disclosure/; GOV.UK
 * Design System, Details: „information that only some users will need”,
 * https://design-system.service.gov.uk/components/details/).
 *
 * A mezők definíciója a helyén marad (access, hook, típus érintetlen); ez a
 * függvény csak a sorrendet rendezi: a csoport az első számlázási mező helyére
 * kerül.
 */
export const ORDER_BILLING_SYSTEM_LABEL = 'Számlázás és visszatérítés: rendszeradatok'

const orderBillingSystemFieldNames: ReadonlySet<string> = new Set([
  'invoiceNumber',
  'invoicePdfUrl',
  'invoiceStatus',
  'invoiceAttempts',
  'invoiceLastError',
  'invoiceCompletionDate',
  'stornoStatus',
  'stornoNumber',
  'stornoAttempts',
  'stornoLastError',
  'correctiveInvoiceStatus',
  'correctiveInvoiceNumber',
  'correctiveInvoiceSeq',
  'correctiveInvoiceAttempts',
  'correctiveInvoiceLastError',
  'correctiveInvoiceAttemptsSeq',
])

const isOrderBillingSystemField = (field: Field): boolean => {
  const named = namedField(field)
  return named !== null && orderBillingSystemFieldNames.has(named.name)
}

export function withOrderBillingCollapsible(fields: Field[]): Field[] {
  const billing = fields.filter(isOrderBillingSystemField)
  if (billing.length === 0) {
    return fields
  }
  const group: Field = {
    type: 'collapsible',
    label: ORDER_BILLING_SYSTEM_LABEL,
    admin: {
      initCollapsed: true,
      description:
        'A számla, a stornószámla és a helyesbítő számla adatai. A rendszer tölti ki őket, kézzel nem módosíthatók. Hibakereséshez nyisd le.',
    },
    fields: billing,
  }
  const result: Field[] = []
  for (const field of fields) {
    if (!isOrderBillingSystemField(field)) {
      result.push(field)
    } else if (field === billing[0]) {
      result.push(group)
    }
  }
  return result
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
      'A megvásárolható kurzusok. Az árat és a közzétételt csak a tulajdonos állíthatja. Az előnézet a mentett kurzusoldalt mutatja, tananyag-hozzáférést nem ad.',
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
      mapFieldsDeep(
        mapFieldsDeep(
          mapFieldsDeep(defaultCollection.fields, withOwnerOnlyPriceAccess),
          withCourseFriendlyAdmin,
        ),
        withPluginPriceGuards,
      ),
      withUnlabelledPriceGroup,
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
          'A kurzus címe, ahogy a látogató látja (pl. „Kéztorna otthon: 8 hetes program”). Ebből készül a webcím is. Ha üresen hagyod, a lenti „Belső azonosító” jelenik meg helyette.',
      },
    },
    courseSlugField,
    {
      name: 'shortDescription',
      type: 'textarea',
      label: 'Rövid leírás',
      admin: {
        description:
          'Egy-három mondat. A kurzusoldal tetején, a kosárban, a Kapcsolódó kurzusok kártyáin és a blogbejegyzések kurzusajánlójában látszik. Az ingyenes kurzusnál a kezdőlapi sáv szövege is ez, ha ott nem írsz sajátot.',
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
      label: 'Kiemelt előnyök a kurzuskártyához',
      maxRows: 3,
      labels: {
        singular: 'Előny',
        plural: 'Előnyök',
      },
      admin: {
        // K34: a modul-térkép szerint ezt a mezőt ma semmi nem rajzolja ki. A
        // kezdőlapi és a Kurzusok oldali kártya (CourseShowcase.tsx) csak a
        // címet, a célközönséget, az árat és a gombot mutatja; a sorokat
        // kirajzoló ProductCard a használaton kívüli CourseCards-ból hívódik.
        // A súgó ezt őszintén kimondja (NN/g, Match Between the System and
        // the Real World).
        description:
          'Ma sehol nem jelenik meg a weboldalon: a kurzuskártya a kezdőlapon és a Kurzusok oldalon a címet, a célközönséget, az árat és a gombot mutatja. A beírt sorok megmaradnak. A kurzusoldal pipás sorait a lenti „Fő előnyök (pipás sorok)” mezőben írod.',
        components: kurzusTombSorcimke('Előny', ['text']),
      },
      fields: [
        {
          name: 'text',
          type: 'text',
          label: 'Előny szövege',
          required: true,
          maxLength: 80,
          admin: {
            description: 'Egy tömör, tényszerű állítás, legfeljebb 80 karakter.',
          },
        },
      ],
    },
    {
      name: 'longDescription',
      type: 'richText',
      label: 'Részletes leírás',
      editor: lexicalEditor({
        features: ({ rootFeatures }) => [
          ...rootFeatures,
          BlocksFeature({ blocks: [coursePackage] }),
        ],
      }),
      admin: {
        description:
          'A kurzusoldal „A kurzusról” szakaszának szövege. Egyes címsorok alatti részek innen külön sávba kerülnek, erről szól az alábbi leírás.',
      },
    },
    reszletesLeirasCimsorai,
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
          'Rövid, konkrét sorok a vásárlódobozban, pipával (pl. „Örökös hozzáférés”, „50+ videós gyakorlat”). Három sor a legjobb. Ha üresen hagyod, a sorok a Részletes leírás első felsorolásából, ennek hiányában a tananyag adataiból készülnek.',
        components: kurzusTombSorcimke('Előny', ['text']),
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
          'Mi történik a vásárlás után, lépésről lépésre. Arra a kérdésre felel, hogy a vásárló mikor és hogyan éri el a kurzust. Ha üresen hagyod, a vásárlás három alaplépése jelenik meg.',
        components: kurzusTombSorcimke('Lépés', ['title', 'text']),
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
          'Az „Ez a program neked való, ha…” lista sorai, soronként egy állítás. Ha üresen hagyod, a Részletes leírás ilyen című szakaszának felsorolásából készül.',
        components: kurzusTombSorcimke('Sor', ['text']),
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
      label: 'Kinek nem való',
      labels: { singular: 'Sor', plural: 'Sorok' },
      admin: {
        description:
          'A „Nem javasoljuk, ha…” lista sorai. Az őszinte kizárás bizalmat épít, és megelőzi a csalódott vásárlást. Ha üresen hagyod, a Részletes leírás ilyen című szakaszából készül.',
        components: kurzusTombSorcimke('Sor', ['text']),
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
        description: 'Egy-három mondat arról, mit vállalunk, és hogyan lehet élni vele.',
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
        components: kurzusTombSorcimke('Kérdés', ['question']),
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
        // H47 + H34: hol látszik (CourseShowcase, CourseCard, Kurzusaim; a
        // kezdőlap alsó felhívás-sávja: a HomeView → RenderBlocks → CtaBanner
        // montázs nélkül, a src/lib/cta-banner-course.ts resolveCtaBannerFigure
        // a gomb céljához tartozó kurzus borítóját adja, /kurzusok célnál az
        // első fizetős kurzusét; a kurzusoldal teteje: page.tsx previewFigure
        // ?? cover, az akciós nézet hőse mindig a borítókép), és a megosztási
        // tartaléklánc (src/lib/seo.ts productSeoDoc: heroImage = coverImage;
        // resolveOgImage: ogImage → heroImage → DEFAULT_OG_IMAGE). A mondat a
        // Posts.ts heroImage-súgójának mintája.
        // Források: GOV.UK Design System, Text input, Hint text: „Use hint text
        // for help that's relevant to the majority of users, like how their
        // information will be used, or where to find it.”
        // (https://design-system.service.gov.uk/components/text-input/), ezért
        // a súgó azt mondja meg, hol jelenik meg a kép; NN/g, 10 Usability
        // Heuristics, #10 Help and Documentation: „it may be necessary to
        // provide documentation to help users understand how to complete their
        // tasks.” (https://www.nngroup.com/articles/ten-usability-heuristics/),
        // ezért a tartaléklánc a mező mellett áll, nem külön kézikönyvben.
        description: `A kurzus kártyáján (kezdőlap, Kurzusok oldal, Kapcsolódó kurzusok, Kurzusaim), a kezdőlap alsó felhívás-sávjában és a kurzusoldal tetején látszik (az akciós megjelenésen kívül csak akkor, ha nincs Nyilvános előzetes videó). Ha a Megosztási kép üres, megosztáskor is ez látszik; ha ez is üres, a Kineticare alapképe (csapatfotó). ${KEP_CSERE_SUGO}`,
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
        // H23: a CourseGalleryFigure csak az ELSŐ feloldott képet rajzolja ki,
        // a kurzusoldalon az „A kurzusról” (Részletes leírás) szakasz után
        // (src/app/(frontend)/kurzusok/[slug]/page.tsx, firstGalleryMedia). A
        // régi „További képek a kurzus oldalára” többet ígért, mint ami
        // megjelenik (NN/g, Match Between the System and the Real World,
        // https://www.nngroup.com/articles/match-system-real-world/; GOV.UK
        // Design System, hint text: „how their information will be used”,
        // https://design-system.service.gov.uk/components/text-input/).
        description:
          'Jelenleg csak az első kép jelenik meg, a kurzusoldalon a Részletes leírás után. A további képek megmaradnak, de nem látszanak. Nem kötelező.',
        components: kurzusTombSorcimke('Kép', [], 'image'),
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Kép',
          admin: {
            description: KEP_CSERE_SUGO,
          },
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
        // H47: a Pages.ts ogImage-súgójának mintája, a kurzus képtartalékával
        // (src/lib/seo.ts productSeoDoc + resolveOgImage).
        // Források: GOV.UK Design System, Text input, Hint text: „Use hint text
        // for help that's relevant to the majority of users, like how their
        // information will be used, or where to find it.”
        // (https://design-system.service.gov.uk/components/text-input/), ezért
        // a súgó kimondja, hol és mikor látszik a kép; NN/g, 10 Usability
        // Heuristics, #2 Match Between the System and the Real World: „Use
        // words, phrases, and concepts familiar to the user, rather than
        // internal jargon.” (https://www.nngroup.com/articles/ten-usability-heuristics/),
        // ezért a súgó a szerkesztő által látott mezőnevet (Borítókép) és a
        // hétköznapi helyet (Facebook, Messenger) nevezi meg, nem az og:image-et.
        description: `Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja a kurzust. Ha üres, a Borítókép, annak híján a Kineticare alapképe (csapatfotó) látszik. ${KEP_CSERE_SUGO}`,
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
          'Ez dönti el, melyik célközönség felirata áll a kurzuskártyán és a kurzusoldalon: „Otthoni gyakorlóknak” vagy „Szakembereknek”. A Statisztika is e szerint csoportosít. Ha üresen marad, az otthoni csoportba kerül.',
      },
    },
    {
      name: 'previewVideoStreamId',
      type: 'text',
      label: 'Nyilvános előzetes videó',
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
          'A kurzus korábbi, modulok nélküli videólistája. Csak a régi kurzusokon látszik. Új leckét a fenti „Tananyag (modulok)” mezőben vegyél fel. Az itt lévő videókat nem kell átmozgatni, azok változatlanul működnek.',
        components: kurzusTombSorcimke('Videó', ['title']),
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
              'A korábbi lecke felvétele a védett videótárból. A lista és a vásárlók haladása megmarad.',
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
        // r2-termekor (a-cms-8): a hozzáférést a rendszer minden ellenőrzéskor
        // ebből a mezőből számolja (src/lib/course-access.ts
        // resolveCourseAccess), a vásárláskor nem készül róla pillanatkép. A
        // módosítás ezért a korábbi vásárlókra is visszamenőleg érvényes; a
        // súgó ezt a mező mellett mondja ki (NN/g, Confirmation Dialogs:
        // „Be specific and inform users about the consequence of their
        // action”, https://www.nngroup.com/articles/confirmation-dialog/; GOV.UK
        // Design System, Warning text: „warn users about something important,
        // such as legal consequences of an action”,
        // https://design-system.service.gov.uk/components/warning-text/).
        description:
          'Hány napig érvényes a hozzáférés a vásárlástól számítva. Hagyd üresen, ha a hozzáférés soha nem jár le. Figyelem: a módosítás a korábbi vásárlókra is érvényes, mert a rendszer a hozzáférést mindig ebből a mezőből számolja. Ha például 365 napra állítod, aki egy évnél régebben vásárolt, azonnal elveszíti a hozzáférést, pedig a kurzusoldal lejárat nélküli hozzáférést ígérhetett neki. Csak a tulajdonos állíthatja.',
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
       * tárolt útvonal és a feloldó bemenete egy. WP63: az Ár mező a RENDES ár
       * marad, az akciós ár külön mező; az időablakban a vevő az akciós árat
       * fizeti, a lejárat után magától a rendes árat (nincs visszaírás, a
       * fizetendő árat a `coursePriceHuf` számolja, src/lib/courses.ts).
       */
      type: 'collapsible',
      label: 'Akciós megjelenés',
      admin: {
        initCollapsed: false,
        // H37 (B20): az akciós sablon állandó feliratai kódban vannak
        // (src/components/courses/promo/PromoHero.tsx, PromoHighlights.tsx,
        // PromoClosingCta.tsx). A komponenseket a configba NEM importáljuk (a
        // payload CLI-t React-komponenssel terhelné): a szöveg literál, az
        // egyezést a src/__tests__/kurzus-admin-sugok.test.ts őrzi.
        description:
          'Az akciós kurzusoldal állandó feliratai („Akciós ár”, „A kurzus fő előnyei”, „Kezdd el az akciós áron”) a weboldal kódjában vannak, itt nem írhatók át.',
      },
      fields: [
        {
          name: 'promoEnabled',
          type: 'checkbox',
          defaultValue: false,
          label: 'Akciós kurzus',
          // WP63 óta a pipa és a két dátum dönti el, hogy a vevő az akciós vagy
          // a rendes árat fizeti (`coursePriceHuf`), tehát ár-mező: az Ár és az
          // Akciós ár mezővel azonos owner-only írás védi (T-011).
          access: promoWindowFieldAccess,
          admin: {
            description:
              'Bekapcsolva a megadott időablakban a kurzusoldal az akciós megjelenést kapja, a kurzuskártyán Akció címke jelenik meg, és a vásárló a lenti Akciós árat fizeti. Az akció végén magától a fenti Ár (Ft) érvényes újra. Csak a tulajdonos állíthatja.',
          },
        },
        {
          name: 'promoStart',
          type: 'date',
          label: 'Akció kezdete',
          access: promoWindowFieldAccess,
          admin: {
            description:
              'Az akció első napja, például 2026. 12. 20. Ha üresen hagyod, az akció azonnal érvényes.',
            // Csak NAP, óra nélkül (a Posts.ts reviewedAt mintája): a szerkesztő
            // napban gondolkodik, az órának itt nincs jelentése. Az oszlop
            // timestamp marad, a feloldó a Budapest szerinti napra vetít.
            // K25: számjegyes magyar keltezés, évvel kezdve (A magyar
            // helyesírás szabályai, 12. kiadás, 295. pont, pl. „2026. 09. 22.”).
            // A Payload 3.88 DatePicker a hu locale-t csak useEffect-ben
            // regisztrálja (node_modules/@payloadcms/ui/dist/elements/DatePicker/DatePicker.js:108-129),
            // ezért az első render angol (mérve: products/5 „2026. September 20.”).
            // Hónapnevet adó token (MMM, MMMM, LLL, EEE) ezért tilos.
            date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy. MM. dd.' },
          },
        },
        {
          name: 'promoEnd',
          type: 'date',
          label: 'Akció vége',
          access: promoWindowFieldAccess,
          validate: validatePromoEnd,
          admin: {
            description:
              'Az akció utolsó napja, például 2026. 12. 31. Az akció a megadott nap végéig, éjfélig él. Bekapcsolt akciónál kötelező; egy korábban vég nélkül közzétett akció addig marad így, amíg meg nem adod a végét.',
            date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy. MM. dd.' },
          },
        },
        {
          name: 'promoPriceHuf',
          type: 'number',
          label: 'Akciós ár (Ft)',
          // A tényleges alsó határt a validatePromoPriceHuf kényszeríti ki;
          // a `min` ugyanazt mondja, hogy a konfiguráció ne állítson mást.
          min: MIN_PRICE_HUF,
          // Fizetendő ár, ezért az Ár mezővel azonos owner-only írás védi
          // (T-011). Az `ownerOnlyProductFieldNames` bejárása csak a plugin
          // gyári mezőit éri el, ezért itt közvetlenül áll (őr:
          // src/__tests__/course-promo.test.ts).
          access: {
            create: isOwnerFieldAccess,
            update: isOwnerFieldAccess,
          },
          validate: validatePromoPriceHuf,
          admin: {
            step: 1,
            // r2-termekor: ugyanaz a forintos beviteli mező, mint az Ár (Ft)
            // mellett (ezres tagoló, előnézet, megerősítés nagy csökkentésnél).
            components: {
              Field: { path: HUF_PRICE_FIELD_COMPONENT, clientProps: { kind: 'akcios' } },
            },
            description: `Ezt fizeti a vásárló az akció ideje alatt, a fenti Ár (Ft) áthúzva jelenik meg mellette. Egész forint, legalább ${MIN_PRICE_HUF} Ft, és kisebb a rendes árnál. Ha üresen hagyod, az akció csak a megjelenést változtatja, az ár marad. Csak a tulajdonos állíthatja.`,
          },
        },
        {
          /*
           * ÖRÖKSÉG (WP58): a kézzel beírt áthúzott ár. A WP63-tól nem olvassa
           * senki (az áthúzott ár a rendes Ár). Rejtve marad, amíg a content-job
           * `akcios-ar-atallas` szabálya át nem viszi az értékét; utána külön
           * PR-ben, generált migrációval szűnik meg az oszlop.
           */
          name: 'promoOriginalPriceHuf',
          type: 'number',
          admin: { hidden: true },
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
      name: 'unlisted',
      type: 'checkbox',
      defaultValue: false,
      label: 'Rejtett kurzus (csak közvetlen linkkel)',
      access: {
        create: isOwnerFieldAccess,
        update: isOwnerFieldAccess,
      },
      admin: {
        position: 'sidebar',
        // K34: legfeljebb 150 karakter, hogy az oldalsáv keskeny hasábjában is
        // átlátható maradjon (a részletek: docs/course-unlisted.md).
        description:
          'Kimarad a listákból, ajánlókból és menükből, de linkkel megnyitható és megvásárolható. Ez nem hozzáférés-védelem. Csak a tulajdonos állíthatja.',
      },
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
      // Alapérték, hogy a mező SOSE maradjon jelöletlen: az üres select („Válassz
      // egy értéket”, korábban „Válasszon ki egy értéket”) volt a csapda egyik fele.
      defaultValue: 'draft',
      // A Payload a drafts `_status` mezőnek ugyanazt az enum-nevet generálná
      // (toSnakeCase('_status') === 'status'), így az alapértelmezett névütközés
      // miatt a 'archived' érték elveszne az adatbázis-enumokból. Külön enum-név
      // a products és a _products_v (versions) táblában is — az oszlopnév és az
      // API-mezőnév változatlanul `status` marad.
      enumName: ({ tableName }) => `enum_${tableName}_product_status`,
      options: [
        { label: 'Piszkozat (még nem látszik)', value: 'draft' },
        { label: 'Közzétéve (látszik az oldalon)', value: 'published' },
        { label: 'Archivált (levéve az oldalról)', value: 'archived' },
      ],
      admin: {
        // Az oldalsávban, a közzététel-gomb MELLETT a helye — nem az űrlap
        // közepén, 3000 px-rel lejjebb, ahol az audit szerint sosem találták meg.
        position: 'sidebar',
        description:
          'Ez dönti el, hogy a kurzus látszik-e a weboldalon. A lap tetején lévő „Állapot” a szerkesztői változatra vonatkozik, nem erre. Csak a tulajdonos állíthatja.',
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
      label: 'Belső azonosító',
      admin: {
        // H25, mérve: a rendelés LÉTREHOZÁSAKOR készül pillanatkép a sku-ról
        // (order-integrity.ts: `item.titleSnapshot = product.sku`, csak
        // create-kor), és a számla (szamlazz/invoice.ts), a visszaigazoló levél
        // (order-paid.ts) és a Barion-tétel (checkout/start-checkout.ts) ezt
        // olvassa; ezért igaz a „következő vásárlástól”. A weboldal a
        // courseTitle láncát követi (displayTitle, különben sku). Források:
        // NN/g, Match Between the System and the Real World
        // (https://www.nngroup.com/articles/match-system-real-world/); GOV.UK
        // Design System, hint text (https://design-system.service.gov.uk/components/text-input/).
        description:
          'A kurzus egyedi azonosítója, két kurzusnak nem lehet ugyanaz. Ez áll a számlán, a rendeléseken, a vásárlási visszaigazoló e-mailben és a Barion fizetőoldalán (egy módosítás a következő vásárlástól látszik). A weboldalon a fenti „Kurzus címe” látszik, ha ki van töltve, különben ez az azonosító.',
      },
    },
    {
      name: 'relatedProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Kapcsolódó kurzusok',
      admin: {
        // H37 (B20): a sáv címe és bevezetője a RelatedCourses.tsx
        // konstansaiban él (RELATED_COURSES_HEADING, CROSS_SELL_HEADING,
        // CROSS_SELL_LEAD*); a configba nem importáljuk (React-komponens), az
        // egyezést a src/__tests__/kurzus-admin-sugok.test.ts őrzi. Csak a
        // közzétett, nem rejtett kurzus látszik (isDiscoverableCourse).
        // Források (ez és az Akciós megjelenés súgója): W3C ATAG 2.0 A.4.2.2
        // (https://www.w3.org/TR/ATAG20/#sc_a422) és NN/g #10 Help and
        // Documentation (https://www.nngroup.com/articles/ten-usability-heuristics/):
        // a szerkesztő ott tudja meg, mit nem írhat át, ahol keresné.
        description:
          'A kurzusoldal alján ajánlott további kurzusok. Csak a közzétett, nem rejtett kurzusok látszanak. A sáv címe („Kapcsolódó kurzusok”, ingyenes kurzusnál „Mi jön az ingyenes kurzus után?”) és az ingyenes kurzusnál megjelenő bevezető szöveg a weboldal kódjában van, itt nem írható át.',
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
      'A leadott rendelések és a fizetésük állapota. A rendeléseket a rendszer kezeli, kézzel ne módosítsd őket.',
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
  fields: withOrderBillingCollapsible([
    ...mapFieldsDeep(
      mapFieldsDeep(defaultCollection.fields, visitOrderFields),
      withOrderFriendlyAdmin,
    ),
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
          'A rendszer adja a rendelés leadásakor, például KH-2026-000001 (év és hatjegyű sorszám). Később nem változik.',
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
        // K34: a listában „79 500 Ft” alakban, mint a Tételek oszlopban.
        components: {
          Cell: '/components/admin/OrderTotalCell#OrderTotalCell',
        },
        description:
          'A rendelés végösszege a vásárlás pillanatában: a tételek ára szorozva a darabszámmal. A jobb oldali Összeg mező ugyanezt mutatja.',
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
        description:
          'A fizetés azonosítója a Barionnál. Akkor kell, ha a Barionnal egyeztetsz egy fizetésről.',
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
        description: 'A számla állapota. A rendszer állítja be, kézzel nem módosítható.',
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
      label: 'Számlakiállítási próbálkozások',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'Hányszor próbálta a rendszer kiállítani a számlát. Legfeljebb ötször próbálkozik, utána kézzel kell rendezni.',
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
        description: 'Az utolsó sikertelen számlakiállítás hibaüzenete, hibakereséshez.',
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
          'Az eredeti számla teljesítési dátuma, például 2026-01-16. A helyesbítő számla ugyanezt a dátumot kapja. A rendszer állítja be.',
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
      label: 'Stornószámla állapota',
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
        description: 'A stornószámla állapota. A rendszer állítja be, kézzel nem módosítható.',
        readOnly: true,
      },
    },
    {
      // A kiállított stornó-számla száma — az invoiceNumber mezővel azonos
      // mezőszintű olvasás-védelemmel (pénzügyi bizonylatazonosító).
      name: 'stornoNumber',
      type: 'text',
      label: 'Stornószámla sorszáma',
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
      label: 'Stornózási próbálkozások',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'Hányszor próbálta a rendszer kiállítani a stornószámlát. Legfeljebb ötször próbálkozik, utána kézzel kell rendezni.',
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
        description: 'Az utolsó sikertelen stornózás hibaüzenete, hibakereséshez.',
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
        description:
          'A részleges visszatérítéskor kiállított helyesbítő számla állapota. A rendszer állítja be, kézzel nem módosítható.',
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
      label: 'Helyesbítő számla visszatérítési sorszáma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        // K34: belső sorszám, a szerkesztőnek nincs vele teendője.
        hidden: true,
        readOnly: true,
        description:
          'Belső sorszám: a visszatérítések közül melyikhez tartozik a legutóbbi helyesbítő számla. A rendszer állítja be.',
      },
    },
    {
      // A14: a helyesbítő-kiállítás kísérletei is plafonozva (max. 5).
      name: 'correctiveInvoiceAttempts',
      type: 'number',
      defaultValue: 0,
      label: 'Helyesbítő számla próbálkozásai',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description:
          'Hányszor próbálta a rendszer kiállítani a helyesbítő számlát. Legfeljebb ötször próbálkozik, utána kézzel kell rendezni.',
      },
    },
    {
      name: 'correctiveInvoiceLastError',
      type: 'text',
      label: 'Helyesbítő számla utolsó hibája',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        readOnly: true,
        description: 'Az utolsó sikertelen helyesbítő számla hibaüzenete, hibakereséshez.',
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
      label: 'Helyesbítő számla próbálkozásainak sorszáma',
      access: {
        create: denyFieldWrite,
        update: denyFieldWrite,
      },
      admin: {
        // K34: belső sorszám, a szerkesztőnek nincs vele teendője.
        hidden: true,
        readOnly: true,
        description:
          'Belső sorszám: melyik visszatérítés helyesbítő számlájához tartozik a próbálkozások száma. A rendszer állítja be.',
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
        // K01: csak olvasható JSON-nézet a CSP-tiltott Monaco-szerkesztő helyett.
        components: {
          Field: '/components/admin/JsonReadOnlyField#JsonReadOnlyField',
        },
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
      admin: {
        // K25: magyar, 24 órás alak (a globális admin.dateFormat mintája).
        date: { displayFormat: 'yyyy. MM. dd. HH:mm', timeFormat: 'HH:mm' },
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
      admin: {
        // K25: magyar, 24 órás alak (a globális admin.dateFormat mintája).
        date: { displayFormat: 'yyyy. MM. dd. HH:mm', timeFormat: 'HH:mm' },
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
        // K01: csak olvasható JSON-nézet a CSP-tiltott Monaco-szerkesztő helyett.
        components: {
          Field: '/components/admin/JsonReadOnlyField#JsonReadOnlyField',
        },
        description:
          'Az eddigi visszatérítések listája: összeg, a Barion válasza, időpont és típus (teljes vagy részleges). A rendszer írja.',
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
        description: 'A megrendelő gép IP-címe, csalásgyanús eset kivizsgálásához.',
      },
    },
  ]),
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
          // R1 vezetői döntés #4: a kosármentes pénztár (POST /api/checkout/start)
          // mellett ide semmi nem ír, ezért a menüpont halott. Csak az admin
          // felületről tűnik el (Payload: „exclude this Collection from
          // navigation and admin routing”,
          // https://payloadcms.com/docs/configuration/collections); a REST API,
          // az access és a plugin-beállítás változatlan.
          hidden: true,
          description:
            'A vásárlók félbehagyott kosarai. Automatikusan keletkeznek, ne szerkeszd őket.',
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
          // R1 vezetői döntés #4: a paymentMethods üres (lásd lent), ezért a
          // plugin tranzakciót sosem hoz létre; a menüpont halott. Csak az
          // admin felületről tűnik el, az API és az access változatlan.
          hidden: true,
          description: 'A fizetési tranzakciók nyoma. Csak a rendszer írja, ne szerkeszd.',
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
