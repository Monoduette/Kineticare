/**
 * Barion Pixel — vásárlási folyamat eseményei (Full Pixel).
 * A builderek a bp.js validate() szerződését követik: pontosan 3 paraméteres
 * `bp('track', …)`, csak felismert kulcsok, hiányzó kötelező mező → nem megy ki.
 * DOM-mentes, injektálható `bp` — teszt: barion-esemenyek.test.ts.
 * safeSend: a mérés sosem rontja el a vásárlást; PII (e-mail, név) nem ide tartozik.
 */

import { bp } from './barion-pixel'

/** A Barion Pixel küldő-függvényének alakja (a `bp` globális burkolója). */
export type BarionPixelSend = (...args: readonly unknown[]) => void

/** A követési események metódusa (bp.js: `msg[0]`). */
export const BARION_TRACK_METHOD = 'track'

/** A webshop devizája. Szállítás nincs, ezért `shipping` kulcs sem megy ki. */
export const BARION_CURRENCY = 'HUF'

/**
 * A tétel mennyiségi egysége. Digitális kurzusnál a „darab" a beszédes érték;
 * a mező szabad szöveg (bp.js: `to_str`), a magyar rövidítés a természetes.
 */
export const BARION_UNIT = 'db'

/**
 * A fizetési mód felirata az `addPaymentInfo` eseményhez. Egyetlen mód van: a
 * Barion Smart Gateway bankkártyás fizetése.
 */
export const BARION_PAYMENT_METHOD = 'Bankkártyás fizetés - Barion'

/**
 * A folyamat lépés-sorszámai. A `step` a Barion-tölcsér sorrendjét adja: a
 * pénztár megnyitása az 1., a fizetési mód rögzítése a 2., az átjáróra
 * irányítás a 3., a lezárt vásárlás a 4. lépés.
 *
 * A `purchaseFailed: -1` NEM önkényes: a hivatalos leírás szerint a `purchase`
 * a folyamat UTOLSÓ lépése, és SIKERTELEN fizetésnél `step: -1` megy ki. Ezen
 * a jelzésen múlik, hogy a Barion meg tudja-e különböztetni a bevételt a
 * meghiúsult fizetéstől — elrontva a konverziós adat NÉMÁN hamis lenne.
 */
export const BARION_STEP = {
  initiateCheckout: 1,
  addPaymentInfo: 2,
  initiatePurchase: 3,
  purchase: 4,
  purchaseFailed: -1,
} as const

/** A bp.js által elfogadott `contentType` értékek (in_list ellenőrzés). */
export type BarionContentType =
  | 'Page'
  | 'Product'
  | 'Article'
  | 'Promotion'
  | 'Banner'
  | 'Misc'

/** A bp.js által elfogadott `list` értékek (in_list ellenőrzés). */
export type BarionList =
  | 'HomePage'
  | 'SearchPage'
  | 'ProductPage'
  | 'Recommendation'
  | 'ComparisonPage'
  | 'BasketPage'
  | 'Checkout'
  | 'Misc'

/** Egy tétel a `contents` tömbben — a bp.js kötelező kulcsaival. */
export interface BarionContentItem {
  id: string
  contentType: 'Product'
  name: string
  unit: string
  unitPrice: number
  totalItemPrice: number
  currency: string
  quantity: number
  category?: string
  imageUrl?: string
}

/** A követendő kurzus adatai — ennyit tud a felület minden ponton. */
export interface BarionCourseInput {
  /** A termék adatbázis-azonosítója (a pixelbe stringként megy). */
  id: number
  /** A megjelenített kurzuscím. */
  name: string
  /** Bruttó ár forintban. Ingyenes kurzusnál 0. */
  priceHuf: number
  /** Alapértelmezés 1 — a kurzusból egy darab vásárolható. */
  quantity?: number
  category?: string | null
  imageUrl?: string | null
}

/** A `contentView` esemény törzse (`contentType: 'Product'` ág). */
export interface BarionContentViewPayload {
  contentType: 'Product'
  id: string
  name: string
  currency: string
  quantity: number
  unit: string
  unitPrice: number
  category?: string
  imageUrl?: string
  list?: BarionList
}

/** A tölcsér-események közös törzse (initiateCheckout / initiatePurchase / purchase). */
export interface BarionFunnelPayload {
  contents: BarionContentItem[]
  currency: string
  revenue: number
  step: number
  orderNumber?: string
  list?: BarionList
}

/** Az `addPaymentInfo` törzse — itt a `paymentMethod` a kötelező elem. */
export interface BarionPaymentInfoPayload {
  contents: BarionContentItem[]
  paymentMethod: string
  step: number
  currency?: string
  revenue?: number
  orderNumber?: string
}

/** A `signUp` törzse (`contentType: 'Page'`). */
export interface BarionSignUpPayload {
  contentType: 'Page'
  id: string
  name: string
}

/**
 * Egy NEM termék oldal `contentView` törzse (`contentType: 'Page'`).
 *
 * A termék-ág többlet-kötelezői (unitPrice, unit, currency, quantity) itt
 * SZÁNDÉKOSAN nincsenek: a bp.js `validate` csak akkor kéri őket, ha a
 * `contentType` értéke `'Product'` (a forrásban: `if (content_type ===
 * 'Product') { … content_view_product_mandatory_attrs … }`). Egy kezdőlapra
 * kitalált „egységár" hazug adat lenne a Barion riportjában.
 */
export interface BarionPageViewPayload {
  contentType: 'Page'
  id: string
  name: string
  list?: BarionList
}

/** Egy jelentendő signUp-esemény azonosítója és beszédes neve. */
export interface BarionSignUpEvent {
  id: string
  name: string
}

/** signUp szótár: belépésnél is signUp kell; `id` útvonaltól független riportkulcs. */
export const BARION_SIGNUP = {
  registration: { id: 'regisztracio', name: 'Regisztráció' },
  login: { id: 'belepes', name: 'Belépés' },
  newsletter: { id: 'hirlevel-feliratkozas', name: 'Hírlevél feliratkozás' },
  persistentLogin: { id: 'belepes-munkamenet', name: 'Belépés' },
} as const satisfies Record<string, BarionSignUpEvent>

/**
 * A NEM termék oldalak `contentView` bemenetei.
 *
 * A `list` csak ott szerepel, ahol a bp.js kötött listájából
 * (`['HomePage','SearchPage','ProductPage','Recommendation','ComparisonPage',
 * 'BasketPage','Checkout','Misc']`) van RÁILLŐ érték. A kurzuslistára és a
 * Tudástárra egyik felsorolt érték sem illik pontosan, és a `'Misc'` nem mond
 * többet a hiányzó mezőnél — a találgatás helyett inkább elhagyjuk. A
 * `'ProductPage'` a kurzus-oldalé (CourseBarionView), ide nem való.
 */
export const BARION_PAGE_VIEW = {
  home: { id: 'kezdolap', name: 'Kezdőlap', list: 'HomePage' },
  courseList: { id: 'kurzusok', name: 'Kurzusok' },
  knowledgeBase: { id: 'tudastar', name: 'Tudástár' },
} as const satisfies Record<string, BarionPageViewInput>

/**
 * Érvényes-e a pénzösszeg. A `null`/`undefined`/NaN/negatív értéket elutasítjuk:
 * a pixel `to_float` mezői valódi számot várnak, és a hibás összeg a
 * bevétel-riportot rontaná el.
 */
function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Érvényes-e a darabszám (pozitív, véges szám). */
function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Nem üres szöveg → trimmelt érték, egyébként `null`. */
function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Kurzus → `contents` tétel. `null`, ha az adat hiányos (nincs név, nincs
 * érvényes ár, nincs érvényes azonosító) — ilyenkor a hívó NEM küld eseményt.
 *
 * A `totalItemPrice` a `unitPrice * quantity` szorzat: a pixel nem számol
 * helyettünk, és a két mező egymásnak ellentmondó értéke a riportban néma
 * eltérésként jelenne meg.
 */
export function buildContentItem(course: BarionCourseInput): BarionContentItem | null {
  const name = cleanText(course.name)
  const quantity = course.quantity ?? 1
  if (
    name === null ||
    !Number.isInteger(course.id) ||
    course.id <= 0 ||
    !isValidAmount(course.priceHuf) ||
    !isValidQuantity(quantity)
  ) {
    return null
  }
  const category = cleanText(course.category)
  const imageUrl = cleanText(course.imageUrl)
  return {
    id: String(course.id),
    contentType: 'Product',
    name,
    unit: BARION_UNIT,
    unitPrice: course.priceHuf,
    totalItemPrice: course.priceHuf * quantity,
    currency: BARION_CURRENCY,
    quantity,
    ...(category !== null ? { category } : {}),
    ...(imageUrl !== null ? { imageUrl } : {}),
  }
}

/**
 * A `contentView` törzse a kurzus (TERMÉK) oldalára.
 *
 * `totalItemPrice` SZÁNDÉKOSAN nincs benne: a bp.js `contentView`-ágának
 * `type_conversion` táblája nem ismeri, tehát a pixel 13-as hibát adna rá és
 * törölné a mezőt. A termék-ág többlet-kötelezői (unitPrice, unit, currency,
 * quantity) viszont mind itt vannak.
 */
export function buildContentViewPayload(
  course: BarionCourseInput,
  options: { list?: BarionList } = {},
): BarionContentViewPayload | null {
  const item = buildContentItem(course)
  if (item === null) {
    return null
  }
  return {
    contentType: 'Product',
    id: item.id,
    name: item.name,
    currency: item.currency,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    ...(item.category !== undefined ? { category: item.category } : {}),
    ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
    ...(options.list !== undefined ? { list: options.list } : {}),
  }
}

/** A tölcsér-törzs összeállítása egyetlen kurzusból (a kosarunk egytételes). */
function buildFunnelPayload(
  course: BarionCourseInput,
  step: number,
  options: { orderNumber?: string | null; list?: BarionList } = {},
): BarionFunnelPayload | null {
  const item = buildContentItem(course)
  if (item === null) {
    return null
  }
  const orderNumber = cleanText(options.orderNumber)
  return {
    contents: [item],
    currency: BARION_CURRENCY,
    revenue: item.totalItemPrice,
    step,
    ...(orderNumber !== null ? { orderNumber } : {}),
    ...(options.list !== undefined ? { list: options.list } : {}),
  }
}

/** `initiateCheckout` — a pénztár megnyitása (1. lépés). */
export function buildInitiateCheckoutPayload(
  course: BarionCourseInput,
): BarionFunnelPayload | null {
  return buildFunnelPayload(course, BARION_STEP.initiateCheckout, { list: 'Checkout' })
}

/** `addPaymentInfo` — a fizetési mód rögzítése (2. lépés). */
export function buildAddPaymentInfoPayload(
  course: BarionCourseInput,
): BarionPaymentInfoPayload | null {
  const item = buildContentItem(course)
  if (item === null) {
    return null
  }
  return {
    contents: [item],
    paymentMethod: BARION_PAYMENT_METHOD,
    step: BARION_STEP.addPaymentInfo,
    currency: BARION_CURRENCY,
    revenue: item.totalItemPrice,
  }
}

/**
 * `initiatePurchase` — a vevő átirányítása a Barion Smart Gateway-re (3. lépés).
 * A rendelésszám itt már ismert, ezért `orderNumber`-rel megy ki: ez köti össze
 * a tölcsér ezen lépését a később beérkező `purchase` eseménnyel.
 */
export function buildInitiatePurchasePayload(
  course: BarionCourseInput,
  orderNumber: string | null,
): BarionFunnelPayload | null {
  return buildFunnelPayload(course, BARION_STEP.initiatePurchase, { orderNumber })
}

/**
 * `purchase` — a folyamat ZÁRÓ eseménye a köszönőoldalon.
 *
 * SIKERTELEN fizetésnél `step: -1` megy ki (és a `revenue` ilyenkor is a
 * meghiúsult kosárértéket írja le — a `step` mondja meg, hogy ez NEM bevétel).
 */
export function buildPurchasePayload(
  course: BarionCourseInput,
  input: { orderNumber: string | null; succeeded: boolean },
): BarionFunnelPayload | null {
  return buildFunnelPayload(
    course,
    input.succeeded ? BARION_STEP.purchase : BARION_STEP.purchaseFailed,
    { orderNumber: input.orderNumber },
  )
}

/**
 * `signUp` — regisztráció / belépés / hírlevél-feliratkozás.
 *
 * `contentType: 'Page'`, mert nem termékről van szó. A bp.js signUp-ága a
 * `step` kulcsot NEM ismeri, ezért az szándékosan hiányzik a törzsből.
 */
export function buildSignUpPayload(input: {
  id: string
  name: string
}): BarionSignUpPayload | null {
  const id = cleanText(input.id)
  const name = cleanText(input.name)
  if (id === null || name === null) {
    return null
  }
  return { contentType: 'Page', id, name }
}

/** Egy NEM termék oldal megtekintésének bemenete. */
export interface BarionPageViewInput {
  id: string
  name: string
  list?: BarionList
}

/**
 * `contentView` a NEM termék oldalakra (`contentType: 'Page'`).
 *
 * A `unitPrice` / `unit` / `currency` / `quantity` KIMARAD: a bp.js ezeket
 * csak a `'Product'` ágon követeli meg, viszont a `contentView`
 * `type_conversion` táblája ismeri őket, tehát elküldve NEM hibáznának — csak
 * hazudnának (egy kezdőlapnak nincs ára). A `totalItemPrice` és a `revenue`
 * ellenben ISMERETLEN kulcs a `contentView`-ban: azokat a pixel 13-as hibával
 * eldobná.
 */
export function buildPageViewPayload(input: BarionPageViewInput): BarionPageViewPayload | null {
  const id = cleanText(input.id)
  const name = cleanText(input.name)
  if (id === null || name === null) {
    return null
  }
  return {
    contentType: 'Page',
    id,
    name,
    ...(input.list !== undefined ? { list: input.list } : {}),
  }
}

/**
 * A KIMENŐ hívás egyetlen kapuja.
 *
 * Két dolgot garantál: (1) a hívási alak mindig háromelemű
 * (`'track'`, eseménynév, törzs) — a bp.js `msg.length !== 3` ellenőrzése így
 * sosem bukik; (2) a küldés SOSEM dob. A követés a vásárlás mellékszála: ha a
 * pixel hibázik, a vevő ebből semmit nem vehet észre.
 */
export type BarionEventPayload =
  | BarionContentViewPayload
  | BarionFunnelPayload
  | BarionPageViewPayload
  | BarionPaymentInfoPayload
  | BarionSignUpPayload

export function sendBarionEvent(
  eventName: string,
  payload: BarionEventPayload | null,
  send: BarionPixelSend = bp,
): boolean {
  if (payload === null) {
    return false
  }
  try {
    send(BARION_TRACK_METHOD, eventName, payload)
    return true
  } catch {
    return false
  }
}

/**
 * A küldők `send` paramétere SZÁNDÉKOSAN az utolsó, alapértékkel: a hívó
 * felület egyszerűen `trackContentView(course)`-t ír, a teszt viszont saját
 * kémet ad be — a hívási alakot így valódi állítással lehet ellenőrizni,
 * globális `window.bp` maszkolása nélkül (a vitest `environment: 'node'`).
 */

/** Termékoldal-megtekintés küldése. */
export function trackContentView(
  course: BarionCourseInput,
  options: { list?: BarionList } = {},
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent('contentView', buildContentViewPayload(course, options), send)
}

/** A pénztár megnyitásának küldése. */
export function trackInitiateCheckout(
  course: BarionCourseInput,
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent('initiateCheckout', buildInitiateCheckoutPayload(course), send)
}

/** A fizetési mód rögzítésének küldése. */
export function trackAddPaymentInfo(
  course: BarionCourseInput,
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent('addPaymentInfo', buildAddPaymentInfoPayload(course), send)
}

/** Az átjáróra irányítás küldése. */
export function trackInitiatePurchase(
  course: BarionCourseInput,
  orderNumber: string | null,
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent(
    'initiatePurchase',
    buildInitiatePurchasePayload(course, orderNumber),
    send,
  )
}

/** A lezárt (sikeres VAGY sikertelen) vásárlás küldése. */
export function trackPurchase(
  course: BarionCourseInput,
  input: { orderNumber: string | null; succeeded: boolean },
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent('purchase', buildPurchasePayload(course, input), send)
}

/** Regisztráció / belépés / hírlevél-feliratkozás küldése. */
export function trackSignUp(
  input: { id: string; name: string },
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent('signUp', buildSignUpPayload(input), send)
}

/**
 * NEM termék oldal megtekintésének küldése.
 *
 * A termékoldal `contentView`-ját NEM ez adja, hanem a `trackContentView`
 * (`components/courses/CourseBarionView.tsx`). A két küldő szándékosan külön
 * van: egy oldalon PONTOSAN az egyik fut, így a termékoldalon nem mehet ki két
 * `contentView`.
 */
export function trackPageView(
  input: BarionPageViewInput,
  send: BarionPixelSend = bp,
): boolean {
  return sendBarionEvent('contentView', buildPageViewPayload(input), send)
}

/* Kosár-pillanatkép sessionStorage-ban: a köszönőoldal purchase-hez kell cím/ár
   (a státusz API nem adja). Hiányzó pillanatkép → purchase kimarad, nem csonka esemény. */

/** A pillanatkép `sessionStorage`-kulcsának előtagja. */
export const BARION_CHECKOUT_SNAPSHOT_PREFIX = 'kc_barion_checkout:'

/** A tárolótól elvárt minimális felület (a `Storage` tesztelhető metszete). */
export interface BarionSnapshotStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function barionSnapshotKey(orderNumber: string): string {
  return `${BARION_CHECKOUT_SNAPSHOT_PREFIX}${orderNumber}`
}

/** A pillanatkép eltevése. Hibát SOSEM dob (kvóta, letiltott tároló). */
export function rememberCheckoutSnapshot(
  storage: BarionSnapshotStorage | null,
  orderNumber: string,
  course: BarionCourseInput,
): boolean {
  const key = cleanText(orderNumber)
  if (storage === null || key === null || buildContentItem(course) === null) {
    return false
  }
  try {
    storage.setItem(
      barionSnapshotKey(key),
      JSON.stringify({
        id: course.id,
        name: course.name,
        priceHuf: course.priceHuf,
        quantity: course.quantity ?? 1,
      }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * A pillanatkép visszaolvasása. `null`, ha nincs, sérült, vagy nem áll össze
 * belőle érvényes tétel — a hívó ilyenkor nem küld `purchase` eseményt.
 */
export function readCheckoutSnapshot(
  storage: BarionSnapshotStorage | null,
  orderNumber: string,
): BarionCourseInput | null {
  const key = cleanText(orderNumber)
  if (storage === null || key === null) {
    return null
  }
  let raw: string | null = null
  try {
    raw = storage.getItem(barionSnapshotKey(key))
  } catch {
    return null
  }
  if (raw === null) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const record = parsed as Record<string, unknown>
  const candidate: BarionCourseInput = {
    id: typeof record.id === 'number' ? record.id : 0,
    name: typeof record.name === 'string' ? record.name : '',
    priceHuf: typeof record.priceHuf === 'number' ? record.priceHuf : Number.NaN,
    quantity: typeof record.quantity === 'number' ? record.quantity : 1,
  }
  return buildContentItem(candidate) === null ? null : candidate
}

/** A pillanatkép eldobása (a `purchase` kiküldése után). */
export function forgetCheckoutSnapshot(
  storage: BarionSnapshotStorage | null,
  orderNumber: string,
): void {
  const key = cleanText(orderNumber)
  if (storage === null || key === null) {
    return
  }
  try {
    storage.removeItem(barionSnapshotKey(key))
  } catch {
    // A takarítás elmaradása nem hiba: a sessionStorage a fül bezárásakor
    // úgyis kiürül.
  }
}

/** A böngésző `sessionStorage`-a, SSR-ben és letiltott tárolónál `null`. */
export function browserSnapshotStorage(): BarionSnapshotStorage | null {
  try {
    if (typeof window === 'undefined' || window.sessionStorage === undefined) {
      return null
    }
    return window.sessionStorage
  } catch {
    return null
  }
}

/* Implicit signUp retesz: munkamenetenként egyszer (sessionStorage + memória). */

/**
 * A munkamenet-retesz `sessionStorage`-kulcsa. SAJÁT előtag: a kosár-pillanatkép
 * (`kc_barion_checkout:`) más életciklusú adat, a két kulcstér nem keveredhet.
 */
export const BARION_SESSION_SIGNUP_KEY = 'kc_barion_signup:session'

/** A memória-retesztől elvárt felület (a `Set<string>` metszete). */
export interface BarionOnceLatch {
  has: (key: string) => boolean
  add: (key: string) => void
}

/**
 * A modul-szintű memória-retesz. SZÁNDÉKOSAN nem exportált: a tesztek a
 * `claimBarionSessionSignUp` utolsó paraméterén adnak be sajátot, így nem kell
 * teszt-célú „reset” függvényt közzétenni, és két teszt sem szennyezi egymást.
 */
const barionMemoryLatch: BarionOnceLatch = new Set<string>()

/**
 * Elfoglalja a munkamenet signUp-reteszét.
 *
 * @returns `true`, ha MOST kell elküldeni a signUp-ot (ebben a munkamenetben
 *   még nem ment ki), `false`, ha már megtörtént.
 */
export function claimBarionSessionSignUp(
  storage: BarionSnapshotStorage | null,
  latch: BarionOnceLatch = barionMemoryLatch,
): boolean {
  if (latch.has(BARION_SESSION_SIGNUP_KEY)) {
    return false
  }
  latch.add(BARION_SESSION_SIGNUP_KEY)
  if (storage === null) {
    return true
  }
  try {
    if (storage.getItem(BARION_SESSION_SIGNUP_KEY) !== null) {
      return false
    }
  } catch {
    // Olvashatatlan tároló: marad a memória-retesz — inkább egy esemény
    // dokumentumonként, mint egy sem.
    return true
  }
  try {
    storage.setItem(BARION_SESSION_SIGNUP_KEY, '1')
  } catch {
    // Kvótahiba/privát mód: a memória-retesz így is megfogja az ismétlést.
  }
  return true
}

/**
 * A KIFEJEZETT belépés/regisztráció signUp-ja.
 *
 * Az esemény MINDIG kimegy (ez a felhasználó tényleges cselekvése), és mellette
 * elfoglalja a munkamenet-reteszt is: a beléptetés utáni átirányításkor a
 * fejléc implicit, munkamenet-nyitó signUp-ja már ugyanazt a belépést
 * jelentené másodszor.
 *
 * A hírlevél-feliratkozás NEM ezen megy: az nem beléptetés, tehát nem foglalhat
 * munkamenet-reteszt.
 */
export function trackAccountSignUp(
  event: BarionSignUpEvent,
  send: BarionPixelSend = bp,
  storage: BarionSnapshotStorage | null = browserSnapshotStorage(),
  latch: BarionOnceLatch = barionMemoryLatch,
): boolean {
  const sent = trackSignUp(event, send)
  claimBarionSessionSignUp(storage, latch)
  return sent
}
