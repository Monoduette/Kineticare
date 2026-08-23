import type { Payload } from 'payload'

import type { Order, Product, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { BARION_DEFAULT_PAYMENT_WINDOW, BarionApiError, startPayment } from '../barion'
import { coursePriceHuf } from '../courses'
import { logger, type Logger } from '../logger'
import {
  billingSummaryMessage,
  validateBilling,
  type BillingFieldError,
  type NormalizedBilling,
} from './billing'
import { isGuestBindableAccount } from '../order-status/guest-bindable-account'
import {
  GUEST_SUMMARY_MISSING,
  guestSummaryMessage,
  validateGuest,
  type GuestFieldError,
  type NormalizedGuest,
} from './guest'

/**
 * Bejelentkezett duplavásárlás. A munkamenet a saját fiók, ez nem orákulum.
 * `docs/gomb-inventar.md` §7 jóváhagyott mondat.
 */
export const CHECKOUT_ALREADY_PURCHASED =
  'Ezt a kurzust már megvásároltad. A fiókodban éred el.'

/**
 * W4 + K2 vendégüzenet. Ugyanez megy, ha az e-mailhez aktivált fiók tartozik,
 * akár van kurzusuk, akár nincs: a válasz nem árulja el a vásárlást
 * (egészségügyi adat).
 *
 * Forrás:
 * - GOV.UK Design System, Passwords: ne áruld el, a felhasználónév vagy a
 *   jelszó volt-e hibás.
 *   https://design-system.service.gov.uk/patterns/passwords/
 * - OWASP Authentication Cheat Sheet: generic hiba, ne legyen
 *   user-enumeration eltérés.
 *   https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
 * - WCAG 2.2 3.3.3 Error Suggestion: mondd meg, hogyan javítható (belépés),
 *   ne extra állapotot.
 */
export const CHECKOUT_GUEST_EXISTING_ACCOUNT =
  'Ehhez az e-mail-címhez már van fiók. Jelentkezz be, és onnan tudod megvenni vagy megnyitni a kurzust.'

/**
 * Vendég, nincs aktivált fiók, de van paid rendelés az e-mailre: ne mondjuk,
 * hogy „már megvásároltad” (W4). A következő lépés a belépés / aktiválás.
 */
export const CHECKOUT_GUEST_FINISH_AFTER_LOGIN =
  'Ezt a lépést bejelentkezés után tudod befejezni.'

/**
 * Checkout-start szolgáltatás (T-021) — a POST /api/checkout/start végpont
 * üzleti logikája, transportfüggetlenül (a Payload-példány és a felhasználó
 * injektálva, így mockolt fetch-csel egységtesztelhető).
 *
 * A pénzügyi főlánc első láncszeme:
 *  1. input-validáció (productId, quantity, opcionális kliens-ár, waiver,
 *     SZÁMLÁZÁSI ADATOK + vendégnél az AZONOSÍTÓ ADATOK) — a számlázási mezők
 *     ellenőrzése itt is kötelező, mert a kliens megkerülhető, és hiányos
 *     vevőadattal a fizetés lemenne, a számla viszont soha nem állna ki,
 *  2. termék- és státuszellenőrzés (archived/draft nem megvásárolható),
 *  3. ADVISORY-ZÁR alatt (S2): duplavásárlás-blokk (paid vagy aktív
 *     payment_pending → 409) ÉS a rendelés létrehozása — a kettő együtt egy
 *     „check-then-act" pár, zár nélkül két párhuzamos kérés MINDKETTŐ
 *     ellenőrzése átmegy, és két aktív rendelés jön létre ugyanarra a kurzusra,
 *  4. a rendelés `payment_pending` státusszal jön létre — az árakat KIZÁRÓLAG
 *     szerver-oldalon olvassuk és az orders beforeChange-hookja SNAPSHOTOLJA
 *     (orderIntegrityBeforeChange); a kliens által küldött ár sosem forrás,
 *  5. Barion Payment/Start a tesztelt src/lib/barion klienssel
 *     (PaymentRequestId = orderNumber → Barion-oldali idempotencia) — ez a
 *     hálózati hívás SZÁNDÉKOSAN a záron KÍVÜL fut,
 *  6. barionPaymentId + barionPaymentRequestId mentése a rendelésre.
 *
 * A rendelés `paid`-re állítása NEM itt történik: az kizárólag a
 * Barion-callback-útvonal (T-022) joga (T-063).
 *
 * VENDÉG-VÁSÁRLÁS (tulajdonosi döntés, 2026-08-15). A pénztár bejelentkezés
 * NÉLKÜL is indítható: ilyenkor az `input.guest` (e-mail + név) azonosítja a
 * vevőt, a rendelés `customer` mező NÉLKÜL, de kitöltött `customerEmail`-lel
 * jön létre. A fiók a FIZETÉS UTÁN dől el (létrehozás vagy megtalálás az
 * e-mail alapján, idempotensen — src/lib/order-status/resolve-order-customer.ts).
 * Bejelentkezett munkamenetnél MINDEN a régi: az `input.guest` figyelmen kívül
 * marad (a kérés törzse megkerülhető, tehát idegen e-mailre szóló rendelést
 * sosem hozhat létre), a rendelés a munkamenet felhasználójához kötődik.
 *
 * SZÁMLÁZÁSI SZERZŐDÉS — EGYÁGÚ: a `billing` KÖTELEZŐ, profil-tartalék nincs.
 * Korábban a mező elhagyása a felhasználó tárolt profiljára esett vissza; ez
 * egyetlen hívót szolgált (a `barionPaymentAdapter.initiatePayment`), az pedig
 * élesben elérhetetlen (a plugin `paymentMethods` tömbje üres, a `/payments/*`
 * végpontokat a `withoutPluginPaymentEndpoints` szűrő eltávolítja). A tartalék
 * ára viszont valós volt: egy elfelejtett `billing` mező némán, egy AVULT
 * profilból állította volna elő a számlát. Az adapter azóta a hívó oldalán,
 * KIMONDVA építi a profilból a `billing`-et — ugyanazzal a kötelező
 * validációval, tehát hiányos profillal azon az úton sem jön létre rendelés.
 */

/** Üzleti hiba HTTP-státusszal — a route-handler ezt képezi válaszra. */
export class CheckoutError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CheckoutError'
    this.status = status
  }
}

export interface CheckoutStartInput {
  productId?: unknown
  quantity?: unknown
  /** Opcionális kliens-oldali ár (Ft) — eltérés esetén 400; sosem a végösszeg forrása. */
  priceHuf?: unknown
  /** Az elállási jogról való lemondás elfogadása — kötelező (true). */
  consentWithdrawalWaiver?: unknown
  /**
   * AZ ÁSZF ELFOGADÁSA + az adatkezelési tájékoztató megismerése, EGY
   * jelölőnégyzetből (az ÁSZF 22. bekezdése így írja le a szerződéskötést) —
   * kötelező (true).
   *
   * MIÉRT ITT IS, nem csak a kliensen: a pénztár űrlapja megkerülhető (a
   * végpont közvetlenül POST-olható), a szerződés viszont pontosan ettől a
   * jelöléstől jön létre. Elfogadás nélkül létrejövő rendelés az ÁSZF saját
   * szövegét tenné hamissá.
   *
   * A waivertől ELTÉRŐEN az ingyenes terméken is kötelező: a szerződés ott is
   * létrejön, és az ÁSZF felhasználási korlátja (lementés, másolás tilalma) az
   * ingyenes ismeretterjesztő videóra is vonatkozik.
   */
  consentTerms?: unknown
  /**
   * A számlázási adatok (név/irsz/település/cím + opcionális adószám) —
   * KÖTELEZŐ. Ez a rendelésre rögzített IGAZSÁG: a `customerSnapshot` — és így
   * a számla — ebből készül. Hiányzó, hiányos vagy hibás adat → 400, a
   * rendelés létrejötte és a Barion-hívás ELŐTT.
   *
   * Nincs profil-tartalék: a hívónak KI KELL MONDANIA, mi kerüljön a számlára.
   * (Az indoklás a fájl fejlécének „SZÁMLÁZÁSI SZERZŐDÉS" bekezdésében.)
   */
  billing?: unknown
  /**
   * VENDÉG-VÁSÁRLÓ azonosító adatai (`{ email, name }`) — kizárólag
   * bejelentkezés NÉLKÜL van szerepe, és akkor KÖTELEZŐ. Bejelentkezett
   * munkamenetnél a mezőt SZÁNDÉKOSAN figyelmen kívül hagyjuk: a kérés törzse
   * megkerülhető, tehát belépve senki nem rendelhet idegen e-mail-címre.
   */
  guest?: unknown
}

export interface CheckoutStartOptions {
  payload: Payload
  /**
   * A bejelentkezett vásárló. `null`/`undefined` = VENDÉG-vásárlás: a vevőt az
   * `input.guest` (e-mail + név) azonosítja.
   */
  user?: User | null
  input: CheckoutStartInput
  /** A kliens IP-címe (proxy-fejlécekből feloldva) — a rendelésen rögzítjük. */
  ipAddress?: string
  /** Publikus szerver-URL a Barion Redirect/Callback URL-ekhez; alapból NEXT_PUBLIC_SERVER_URL. */
  serverUrl?: string
  logger?: Logger
}

export interface CheckoutStartResult {
  orderNumber: string
  gatewayUrl: string
}

/** 'hh:mm:ss' → ezredmásodperc (a Barion PaymentWindow formátuma). */
export function paymentWindowToMs(window: string = BARION_DEFAULT_PAYMENT_WINDOW): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(window)
  if (!match) {
    return 30 * 60 * 1000
  }
  const [, hours, minutes, seconds] = match
  return (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
}

interface ParsedInput {
  productId: number
  quantity: number
  priceHuf?: number
  billing: NormalizedBilling
  /** Vendég-vásárlásnál a validált e-mail + név; bejelentkezve null. */
  guest: NormalizedGuest | null
}

/**
 * Magyar, a végpont hibaformátumába illeszkedő üzenet a számlázási hibákból.
 *
 * Az ÖSSZEFOGLALÓT a tényleges hibahalmazból származtatjuk
 * (`billingSummaryMessage`) — így a hibás adószám nem „hiányos adat"-ként megy
 * vissza. Ha az összefoglaló épp egybeesik az egyetlen mezőhibával, nem
 * ismételjük meg.
 */
function billingErrorMessage(errors: readonly BillingFieldError[]): string {
  const details = errors.map((item) => item.message)
  const summary = billingSummaryMessage(errors)
  return (details.includes(summary) ? details : [summary, ...details]).join(' ')
}

/** Ugyanaz a szerkezet a vendég-mezőkre (e-mail + név). */
function guestErrorMessage(errors: readonly GuestFieldError[]): string {
  const details = errors.map((item) => item.message)
  const summary = guestSummaryMessage(errors)
  return (details.includes(summary) ? details : [summary, ...details]).join(' ')
}

function parseInput(input: CheckoutStartInput, hasSession: boolean): ParsedInput {
  const rawId = input.productId
  const productId =
    typeof rawId === 'number' ? rawId : typeof rawId === 'string' ? Number(rawId) : Number.NaN
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new CheckoutError(
      400,
      'A kurzus azonosítója hiányzik vagy nem értelmezhető. Nyisd meg újra a kurzus oldalát, és onnan indítsd a fizetést.',
    )
  }

  // Digitális kurzus: a quantity a Barion tételösszegbe és a számlára megy,
  // a users.purchases viszont halmaz — 2–99× fizettetne egy hozzáférésért.
  // A storefront mindig 1-et küld; ettől eltérő API-hívás 400.
  let quantity = 1
  if (input.quantity !== undefined) {
    const rawQuantity = typeof input.quantity === 'number' ? input.quantity : Number(input.quantity)
    if (!Number.isInteger(rawQuantity) || rawQuantity !== 1) {
      throw new CheckoutError(
        400,
        'Ebből a kurzusanyagból egyszerre csak egy példány vásárolható.',
      )
    }
    quantity = 1
  }

  let priceHuf: number | undefined
  if (input.priceHuf !== undefined) {
    const rawPrice = typeof input.priceHuf === 'number' ? input.priceHuf : Number(input.priceHuf)
    if (!Number.isFinite(rawPrice) || rawPrice < 0) {
      throw new CheckoutError(
        400,
        'A kurzus ára nem értelmezhető. Frissítsd az oldalt, hogy a mai ár töltődjön be, és indítsd újra a fizetést.',
      )
    }
    priceHuf = rawPrice
  }

  // Az elállási-jog-lemondás (waiver) rögzítése API-szinten kötelező — a
  // kétlépcsős waiver-UX a storefront-ticketé, itt a mező biztos rögzítése a cél.
  if (input.consentWithdrawalWaiver !== true) {
    throw new CheckoutError(
      400,
      'A vásárláshoz el kell fogadnod, hogy a tartalom azonnali megnyitásával lemondasz az elállási jogodról (consentWithdrawalWaiver).',
    )
  }

  // Az ÁSZF elfogadása (és az adatkezelési tájékoztató megismerése) — a
  // szerződés ettől jön létre (ÁSZF 22. bekezdés), ezért a kliens-oldali
  // jelölőnégyzet mellett a SZERVER is kikényszeríti. A mezőt a
  // `buildCustomerSnapshot` időbélyeggel rögzíti a rendelésre.
  if (input.consentTerms !== true) {
    throw new CheckoutError(
      400,
      'A vásárláshoz el kell fogadnod az Általános szerződési feltételeket, és jelölnöd kell, hogy az Adatkezelési és adatvédelmi szabályzatot megismerted (consentTerms).',
    )
  }

  /**
   * SZÁMLÁZÁSI ADATOK — a kérésben küldött érték az EGYETLEN forrás. A
   * felhasználó profilja csak a pénztár űrlapjának ELŐKITÖLTÉSE (kliens-oldal);
   * a szolgáltatás nem esik vissza rá, és részlegesen kitöltött `billing`-et
   * sem egészít ki belőle — a kevert rekord később megmagyarázhatatlan számlát
   * adna.
   *
   * A validáció itt is KÖTELEZŐEN lefut — a kliens megkerülhető, hiányos
   * snapshottal pedig a fizetés lemenne, a számla viszont soha nem állna ki
   * (issueInvoiceForOrder `failed`-del, dobás nélkül zár → nincs retry).
   */
  const billingResult = validateBilling(input.billing)
  if (!billingResult.ok) {
    throw new CheckoutError(400, billingErrorMessage(billingResult.errors))
  }

  /**
   * VENDÉG-AZONOSÍTÁS. Bejelentkezve a munkamenet az igazság — a törzsben
   * küldött `guest` mezőt ilyenkor SEM olvassuk (különben egy belépett vevő
   * idegen e-mail-címre szóló rendelést hozhatna létre). Bejelentkezés nélkül
   * viszont az e-mail + név KÖTELEZŐ: ez az egyetlen kapocs a fizetés és a
   * vevő között (a hozzáférés és a jelszó-beállító link is ide megy).
   */
  const guest = hasSession ? null : validateGuest(input.guest)
  if (guest !== null && !guest.ok) {
    throw new CheckoutError(400, guestErrorMessage(guest.errors))
  }

  return {
    productId,
    quantity,
    ...(priceHuf !== undefined ? { priceHuf } : {}),
    billing: billingResult.value,
    guest: guest === null ? null : guest.value,
  }
}

/**
 * A termék megvásárolhatóságának ellenőrzése (státusz + ár), magyar üzenetekkel.
 *
 * MINDEN elutasító ág naplóz (warn) — ezek eddig némán estek el, pedig a
 * piszkozat-incidens (átadás-doksi 3. szakasz 3. sor) épp azt mutatta, hogy a
 * néma 400-as a legrosszabb hibaforma. A felhasználói üzenetek változatlanok.
 */
function assertPurchasable(product: Product, log: Logger, priceHuf?: number): void {
  if (product.status === 'archived') {
    log.warn('checkout-start: vásárlás elutasítva — a termék archivált', {
      productId: product.id,
      productStatus: product.status,
      reason: 'archived',
    })
    throw new CheckoutError(400, 'Ez a termék már nem megvásárolható (archivált).')
  }
  if (product.status !== 'published') {
    log.warn('checkout-start: vásárlás elutasítva — a termék státusza nem publikált', {
      productId: product.id,
      productStatus: product.status,
      reason: 'status-not-published',
    })
    throw new CheckoutError(400, 'Ez a termék jelenleg nem megvásárolható.')
  }
  /**
   * ÁR-KAPU: az ár-pipa MELLETT a szám ÉRTÉKE is számít — csak a POZITÍV ár
   * érvényes.
   *
   * ═══ A HIBA, AMIT BEZÁR ═══
   * A `priceInHUFEnabled: true` + `priceInHUF: 0` páros korábban átment ezen a
   * kapun, és VALÓDI Barion-fizetés indult volna 0 Ft-ról: a Barion vagy hibát
   * ad (a vevő magyarázat nélküli 502-t kap), vagy — rosszabb — létrejön egy
   * 0 forintos rendelés és számla, amit kézzel kell takarítani. A negatív ár
   * ugyanígy értelmezhetetlen, a `NaN` pedig `typeof 'number'`, tehát a régi
   * feltételen az is átcsúszott.
   *
   * ═══ MIÉRT NEM „INGYENES" A 0 Ft (a döntés, hogy egy refaktor se írja
   * vissza) ═══
   * Az ingyenességet EGY dolog fejezi ki: az ár-pipa `false` értéke
   * (`priceInHUFEnabled: false`) — arra van külön, Barion nélküli út
   * (/penztar ingyenes ága + free-course-grant). Ha a 0 Ft is „ingyenest"
   * jelentene, két, egymással versengő igazságforrás lenne ugyanarra az
   * állapotra, és a fizetési út némán szétágazna egy szerkesztői elgépeléstől.
   * Ezért a 0 (és minden nem pozitív érték) itt HIÁNYZÓ/HIBÁS konfiguráció:
   * ugyanaz az elutasító ág, mint a hiányzó áré.
   */
  //
  // ═══ MIÉRT A coursePriceHuf DÖNT (és nem egy itteni feltétel) ═══
  // Az „érvényes ár" fogalmának EGY implementációja van, a courses.ts-ben, és
  // azt hívja a gomb-logika (resolveCourseCta → isPaidCourse), az ár-címke és
  // ez a kapu is. Amíg a kapu saját másolatot tartott, a kettő elsodródott: a
  // felület ajánlott egy vásárlást, amit a szerver elutasított. A másolat
  // visszavezetése ezt a hibaosztályt szünteti meg, nem csak a mai példányát.
  const price = product.priceInHUF
  if (coursePriceHuf(product) === null) {
    log.warn('checkout-start: vásárlás elutasítva — a termékhez nincs érvényes ár', {
      productId: product.id,
      productStatus: product.status,
      priceEnabled: product.priceInHUFEnabled === true,
      // A megkülönböztetés a naplóban látszik: a hiányzó és a nem pozitív ár
      // ugyanazt az üzenetet adja a vevőnek, de az üzemeltetőnek mást jelent
      // (utóbbi szerkesztői elgépelés, ami adminban javítható).
      reason: typeof price === 'number' ? 'price-not-positive' : 'price-missing',
    })
    throw new CheckoutError(400, 'A termékhez nem tartozik érvényes ár, így nem vásárolható meg.')
  }
  // Szerver-oldali ár-kikényszerítés: a kliens ára sosem forrás — ha eltér a
  // szerveren tárolt ártól, a kérést elutasítjuk (eltérés = 400).
  if (priceHuf !== undefined && priceHuf !== product.priceInHUF) {
    log.warn('checkout-start: vásárlás elutasítva — a kliens ára eltér a szerver árától', {
      productId: product.id,
      productStatus: product.status,
      clientPriceHuf: priceHuf,
      serverPriceHuf: product.priceInHUF,
      reason: 'client-price-mismatch',
    })
    throw new CheckoutError(
      400,
      'A megadott ár eltér a termék aktuális árától. Frissítsd az oldalt, és próbáld újra.',
    )
  }
}

/**
 * A duplavásárlás-blokk SZŰRŐJE: a vevőt vagy a fiókja (bejelentkezve), vagy az
 * e-mail-címe (vendégként) azonosítja a rendeléseken.
 */
type DuplicateScope =
  | { kind: 'customer'; userId: number }
  | { kind: 'email'; email: string }

function duplicateScopeWhere(scope: DuplicateScope, productId: number): Record<string, unknown> {
  return {
    ...(scope.kind === 'customer'
      ? { customer: { equals: scope.userId } }
      : { customerEmail: { equals: scope.email } }),
    'items.product': { equals: productId },
  }
}

/** Duplavásárlás-blokk: paid rendelés vagy AKTÍV (nem lejárt) payment_pending → 409. */
async function assertNoDuplicatePurchase(
  payload: Payload,
  scope: DuplicateScope,
  productId: number,
  paidMessage: string,
): Promise<void> {
  const baseWhere = duplicateScopeWhere(scope, productId)

  const paidOrders = await payload.find({
    collection: 'orders',
    where: { and: [baseWhere, { status: { equals: 'paid' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  if (paidOrders.totalDocs > 0) {
    throw new CheckoutError(409, paidMessage)
  }

  // Csak a Barion-fizetési ablakban (default 30 perc) lévő payment_pending
  // számít aktívnak; a lejárt, befejezetlen fizetések nem blokkolják az új próbálkozást.
  const windowCutoff = new Date(Date.now() - paymentWindowToMs()).toISOString()
  const pendingOrders = await payload.find({
    collection: 'orders',
    where: {
      and: [
        baseWhere,
        { status: { equals: 'payment_pending' } },
        { createdAt: { greater_than: windowCutoff } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  if (pendingOrders.totalDocs > 0) {
    throw new CheckoutError(
      409,
      'Ehhez a termékhez már folyamatban van egy fizetés. Fejezd be azt, vagy várd meg a fizetési ablak lejártát.',
    )
  }
}

/**
 * Rendelésszám-ütközés (23505) felismerése.
 *
 * A rendelésszámot az orders beforeChange-hookja a „legnagyobb meglévő + 1"
 * mintával képzi (src/lib/order-number.ts), ami két egyidejű create esetén
 * ugyanazt az értéket adhatja. A végső garancia az orderNumber UNIQUE indexe:
 * a vesztes ág 23505-tel bukik. Ez NEM technikai hiba (500), hanem egy
 * újrapróbálható ütközés.
 *
 * ELSŐDLEGES jel a `pg` hibaobjektum strukturált `constraint` mezője (ez
 * pontosan megmondja, MELYIK kényszer sérült); FALLBACK a 23505-ös kód +
 * a hibaszövegben szereplő oszlopnév — így egy másik unique-ütközést (pl.
 * barionPaymentId) nem próbálunk vaktában újra.
 */
const ORDER_NUMBER_CONFLICT_MAX_ATTEMPTS = 4

function isOrderNumberConflict(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const candidate = current as {
      code?: unknown
      constraint?: unknown
      detail?: unknown
      message?: unknown
      cause?: unknown
    }
    if (typeof candidate.constraint === 'string' && candidate.constraint.includes('order_number')) {
      return true
    }
    if (candidate.code === '23505') {
      const text = [candidate.detail, candidate.message]
        .filter((part): part is string => typeof part === 'string')
        .join(' ')
      if (text.includes('order_number') || text.includes('orderNumber')) {
        return true
      }
    }
    current = candidate.cause
  }
  return false
}

/**
 * A rendelés VEVŐJE — a munkamenet felhasználója vagy a vendég-adatok.
 *
 * A `customerId` vendégnél SZÁNDÉKOSAN null: a rendelés fiók nélkül jön létre,
 * a fiók a fizetés UTÁN dől el. Az `existingUser` viszont már itt is
 * feloldódhat (ha az e-mailhez tartozik fiók) — a K2-kapuhoz, a
 * duplavásárlás-ellenőrzéshez és a zárkulcshoz, KÖTÉS NÉLKÜL.
 */
interface CheckoutBuyer {
  customerId: number | null
  existingUser: {
    id: number
    role?: string | null
    passwordSetupPending?: boolean | null
  } | null
  email: string
  name: string | null
}

/**
 * Vevő-snapshot a rendelésre (számlázási/audit célokra).
 *
 * A számlázási mezők forrása a VALIDÁLT `billing` — vagyis az, amit a hívó
 * (élesben: a pénztár űrlapja) ténylegesen megadott. A snapshot a rendeléshez
 * rögzített igazság: a Számlázz.hu-számla ebből készül (`buyerFromOrder`), a
 * felhasználó későbbi profilmódosítása már nem hat rá.
 *
 * A mező típusa JSON (src/plugins/ecommerce.ts), tehát a tartalma
 * sémaváltozás és migráció nélkül alakítható.
 *
 * ═══ AZ ÁSZF-ELFOGADÁS RÖGZÍTÉSE ═══
 * A pénztár azt ígéri a vevőnek, hogy „az elfogadásodat a rendszer a
 * rendelésen időbélyeggel rögzíti" — az ígéretet ez a két mező váltja be:
 *   consentTerms ... az elfogadás TÉNYE (true),
 *   consentTermsAt . az elfogadás ISO-időbélyege.
 * SZÁNDÉKOSAN a JSON-snapshotba kerül, nem külön oszlopba: séma-változás és
 * migráció nélkül rögzíthető, a rendeléshez kötött igazság része marad, és a
 * számlázási snapshottal együtt, egyetlen íráson belül keletkezik.
 *
 * Az `acceptedAtIso` UGYANAZ az időbélyeg, mint a `consentWithdrawalWaiverAt`:
 * a két nyilatkozat egyetlen beküldéssel, ugyanabban a pillanatban születik,
 * és két, ezredmásodpercben eltérő időpont csak látszatpontosságot adna.
 */
function buildCustomerSnapshot(
  buyer: CheckoutBuyer,
  billing: NormalizedBilling,
  acceptedAtIso: string,
): Record<string, unknown> {
  return {
    consentTerms: true,
    consentTermsAt: acceptedAtIso,
    // Vendég-vásárlásnál még nincs fiók — a `null` itt tényállítás, nem hiány:
    // a fizetés utáni fiók-feloldás az `email` mezőből dolgozik.
    id: buyer.customerId,
    email: buyer.email,
    name: buyer.name,
    billingName: billing.name,
    billingZip: billing.zip,
    billingCity: billing.city,
    billingStreet: billing.street,
    taxNumber: billing.taxNumber,
    snapshotAt: new Date().toISOString(),
  }
}

/**
 * Az e-mail-címhez tartozó MEGLÉVŐ fiók azonosítója (vendég-vásárláshoz).
 *
 * MIÉRT KELL MÁR ITT, a fizetés előtt: enélkül a saját fiókjából kijelentkezve
 * vásárló vevő MÉGEGYSZER megvehetné a már megvett kurzust — a dupla fizetést
 * ilyenkor a paid-átmenet K5-őre (`hasPaidOrderFor`) fogná meg, DE ott már
 * levonták a pénzt: a rendelés blokkolva marad, és kézi visszatérítés kell.
 * Sokkal jobb a vásárlás ELŐTT, magyar üzenettel elutasítani.
 *
 * A hiba NEM végzetes: ha a lekérdezés elszáll, a checkout mehet tovább (a
 * fiók-kötés úgyis a fizetés után dől el), csak a kényelmi ellenőrzés marad ki.
 */
async function findExistingUserByEmail(
  payload: Payload,
  email: string,
  log: Logger,
): Promise<CheckoutBuyer['existingUser']> {
  try {
    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const found = docs[0]
    if (typeof found?.id !== 'number') {
      return null
    }
    return {
      id: found.id,
      role: typeof found.role === 'string' ? found.role : null,
      passwordSetupPending:
        typeof found.passwordSetupPending === 'boolean' ? found.passwordSetupPending : null,
    }
  } catch (error) {
    log.warn('checkout-start: a vendég e-mailhez tartozó fiók keresése sikertelen (a checkout folytatódik)', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * A VEVŐ feloldása. Bejelentkezve a munkamenet felhasználója az igazság;
 * vendégként a validált e-mail + név, `customerId` NÉLKÜL — a fiók a fizetés
 * után dől el.
 */
async function resolveBuyer(
  payload: Payload,
  user: User | null,
  guest: NormalizedGuest | null,
  log: Logger,
): Promise<CheckoutBuyer> {
  if (user !== null) {
    return {
      customerId: user.id,
      existingUser: {
        id: user.id,
        role: user.role,
        passwordSetupPending: user.passwordSetupPending === true,
      },
      email: (user.email ?? '').trim().toLowerCase(),
      name: user.name ?? null,
    }
  }
  if (guest === null) {
    // VÉDŐHÁLÓ: ide nem juthatunk (a parseInput bejelentkezés nélkül kötelezővé
    // teszi és validálja a vendég-adatokat) — de ha egy későbbi átalakítás
    // mégis kinyitná ezt az utat, a vevő azonosítás NÉLKÜL nem fizethet.
    throw new CheckoutError(400, GUEST_SUMMARY_MISSING)
  }
  return {
    customerId: null,
    existingUser: await findExistingUserByEmail(payload, guest.email, log),
    email: guest.email,
    name: guest.name,
  }
}

/**
 * A checkout-start teljes folyamata. Hiba esetén CheckoutError-t dob
 * (a Barion-hibaágakban a rendelést `payment_failed`-re állítja).
 */
export async function startCheckout(options: CheckoutStartOptions): Promise<CheckoutStartResult> {
  const { payload } = options
  const user = options.user ?? null
  const log = options.logger ?? logger
  const { productId, quantity, priceHuf, billing, guest } = parseInput(options.input, user !== null)

  // A terméket a PUBLIKÁLT sorral olvassuk (draft nélkül) — így a checkout,
  // az ár-snapshot hook (src/lib/order-integrity.ts) és a storefront ugyanazzal
  // a verzióval dolgozik. A vásárlási jogosultságot a szerkesztői `status`
  // mező dönti el, nem a drafts _status — és a piszkozat-állapot (autosave)
  // sem billentheti át némán a vásárolhatóságot (átadás-doksi 3. szakasz 3.
  // sor: a piszkozatban átállított státusz az oldal frissülése nélkül
  // billentette a 400-as elutasításokat).
  const product = (await payload
    .findByID({
      collection: 'products',
      id: productId,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null)) as Product | null
  if (!product) {
    throw new CheckoutError(404, 'A megadott termék nem található.')
  }
  assertPurchasable(product, log, priceHuf)

  const buyer = await resolveBuyer(payload, user, guest, log)

  // Rendelés létrehozása: az árakat és a rendelésszámot az orders
  // beforeChange-hookja tölti szerver-oldali (DB) forrásból — a kliens
  // sem árat, sem snapshotot nem adhat meg (a mezők access-e is zárt).
  const nowIso = new Date().toISOString()
  const createOrderOnce = async (): Promise<Order> =>
    (await payload.create({
      collection: 'orders',
      data: {
        // Vendégnél a mező KIMARAD (nincs fiók, amihez kötni lehetne); a
        // kapcsolat ilyenkor a customerEmail, amiből a paid-átmenet oldja fel
        // (vagy hozza létre) a fiókot.
        ...(buyer.customerId !== null ? { customer: buyer.customerId } : {}),
        customerEmail: buyer.email,
        status: 'payment_pending',
        currency: 'HUF',
        items: [{ product: productId, quantity }],
        consentWithdrawalWaiver: true,
        consentWithdrawalWaiverAt: nowIso,
        customerSnapshot: buildCustomerSnapshot(buyer, billing, nowIso),
        ...(options.ipAddress ? { ipAddress: options.ipAddress } : {}),
      },
      overrideAccess: true,
      depth: 0,
    })) as Order

  /**
   * A KRITIKUS SZAKASZ: duplavásárlás-ellenőrzés + rendelés-létrehozás egyben,
   * felhasználó–termék páronkénti advisory-zár alatt (processzek között is
   * soros). A zár a legszűkebb hatókörre szól, hogy a párhuzamos, MÁS terméket
   * vagy MÁS vevőt érintő checkout ne várakozzon.
   *
   * A ZÁRKULCS vendégnél a MEGLÉVŐ fiók azonosítója (ha van), különben az
   * e-mail-cím — így ugyanaz a vevő akkor is egy sorban marad, ha az egyik
   * fülön belépve, a másikon vendégként indít fizetést.
   */
  const lockKey =
    buyer.existingUser !== null
      ? `checkout:${buyer.existingUser.id}:${productId}`
      : `checkout:guest:${buyer.email}:${productId}`

  const order = await withAdvisoryLock(
    payload,
    lockKey,
    async () => {
      // K2 + W4: aktivált / staff / owner fiókra a vendég nem indít fizetést.
      // Az üzenet azonos, akár van kurzusuk, akár nincs.
      if (
        user === null &&
        buyer.existingUser !== null &&
        !isGuestBindableAccount(buyer.existingUser)
      ) {
        throw new CheckoutError(409, CHECKOUT_GUEST_EXISTING_ACCOUNT)
      }

      const paidMessage =
        user !== null ? CHECKOUT_ALREADY_PURCHASED : CHECKOUT_GUEST_FINISH_AFTER_LOGIN

      if (buyer.existingUser !== null) {
        await assertNoDuplicatePurchase(
          payload,
          { kind: 'customer', userId: buyer.existingUser.id },
          productId,
          paidMessage,
        )
      }
      // A fiókhoz még nem kötött (vendég) rendeléseket kizárólag az e-mail
      // azonosítja. Bejelentkezett vevőnél is le kell futtatni: a korábbi
      // vendég payment_pending (customer: null, customerEmail: ugyanaz)
      // egyébként láthatatlan maradna, és második Barion-terhelés indulna.
      // Vendég fiók nélkül: csak ez az e-mail-ág fut (existingUser null).
      await assertNoDuplicatePurchase(
        payload,
        { kind: 'email', email: buyer.email },
        productId,
        paidMessage,
      )

      let lastConflict: unknown
      for (let attempt = 1; attempt <= ORDER_NUMBER_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
        try {
          return await createOrderOnce()
        } catch (error) {
          if (!isOrderNumberConflict(error)) {
            throw error
          }
          lastConflict = error
          log.warn('checkout-start: rendelésszám-ütközés (23505) — újrapróbálás', {
            attempt,
            maxAttempts: ORDER_NUMBER_CONFLICT_MAX_ATTEMPTS,
            userId: buyer.customerId,
            productId,
          })
          // Jitteres visszavárás: az ütköző tranzakciók azonnali újrapróbálása
          // újra ugyanazt a „max + 1"-et számolhatja ki egyszerre.
          await new Promise((resolve) =>
            setTimeout(resolve, 10 * attempt + Math.floor(Math.random() * 20)),
          )
        }
      }

      log.error('checkout-start: a rendelésszám-ütközés újrapróbálásai kimerültek', {
        attempts: ORDER_NUMBER_CONFLICT_MAX_ATTEMPTS,
        userId: buyer.customerId,
        productId,
        error: lastConflict instanceof Error ? lastConflict.message : String(lastConflict),
      })
      throw new CheckoutError(
        503,
        'A rendelés létrehozása most nem sikerült a nagy terhelés miatt. Próbáld újra néhány másodperc múlva.',
      )
    },
    log,
  )

  const orderNumber = order.orderNumber
  if (!orderNumber) {
    log.error('checkout-start: a rendelés rendelésszám nélkül jött létre', { orderId: order.id })
    throw new CheckoutError(
      500,
      'A rendelés létrehozása most nem sikerült. Próbáld újra néhány perc múlva.',
    )
  }

  // A végösszeg KIZÁRÓLAG a szerver-oldali snapshot: az orderIntegrity-hook
  // által a DB-árakból képzett totalHufSnapshot (fallback: item-snapshotok).
  const snapshotItems = (order.items ?? []) as Array<{
    titleSnapshot?: string | null
    priceHufSnapshot?: number | null
    quantity?: number | null
  }>
  const totalHuf =
    typeof order.totalHufSnapshot === 'number'
      ? order.totalHufSnapshot
      : snapshotItems.reduce(
          (sum, item) => sum + (item.priceHufSnapshot ?? 0) * (item.quantity ?? 1),
          0,
        )

  const serverUrl = (options.serverUrl ?? process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(
    /\/+$/,
    '',
  )

  /** Barion Start-hiba esetén a rendelést payment_failed-re állítjuk (best-effort). */
  const markPaymentFailed = async (): Promise<void> => {
    await payload
      .update({
        collection: 'orders',
        id: order.id,
        data: { status: 'payment_failed' },
        overrideAccess: true,
      })
      .catch((updateError) =>
        log.warn('checkout-start: a rendelés payment_failed-re állítása sikertelen', {
          orderId: order.id,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        }),
      )
  }

  let gatewayUrl: string
  let barionPaymentId: string
  let barionPaymentRequestId: string
  try {
    const startResponse = await startPayment({
      // PaymentRequestId = orderNumber → Barion-oldali idempotencia.
      paymentRequestId: orderNumber,
      // A köszönőoldal a RENDELÉSSZÁMBÓL poll-ozza a státuszt (`?order=…`).
      // Enélkül minden fizető vevő a „Hiányzik a rendelésszám" nézetet kapná —
      // a Barion-visszatérés ugyanis nem hordoz más azonosítót, amit az oldal
      // használni tudna.
      redirectUrl: `${serverUrl}/fizetes/koszonom?order=${encodeURIComponent(orderNumber)}`,
      callbackUrl: `${serverUrl}/api/barion/callback`,
      payerHint: buyer.email || undefined,
      cardHolderNameHint: buyer.name ?? undefined,
      transactions: [
        {
          posTransactionId: `${orderNumber}-1`,
          total: totalHuf,
          comment: `Kineticare rendelés ${orderNumber}`,
          items: snapshotItems.map((item) => {
            const itemQuantity = item.quantity ?? 1
            const unitPrice = item.priceHufSnapshot ?? 0
            return {
              name: item.titleSnapshot ?? product.sku ?? `Termék #${productId}`,
              description: product.shortDescription ?? '',
              quantity: itemQuantity,
              unit: 'db',
              unitPrice,
              itemTotal: unitPrice * itemQuantity,
              ...(product.sku ? { sku: product.sku } : {}),
            }
          }),
        },
      ],
    })
    if (!startResponse.GatewayUrl) {
      throw new BarionApiError({
        message: 'A Barion Start-válasz nem tartalmaz GatewayUrl-t.',
        kind: 'invalid_response',
        endpoint: 'POST /v2/Payment/Start',
      })
    }
    gatewayUrl = startResponse.GatewayUrl
    barionPaymentId = startResponse.PaymentId
    barionPaymentRequestId = startResponse.PaymentRequestId ?? orderNumber
  } catch (error) {
    await markPaymentFailed()
    log.error('checkout-start: Barion fizetésindítás sikertelen', {
      orderId: order.id,
      orderNumber,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new CheckoutError(
      502,
      'A fizetés indítása most nem sikerült. Próbáld újra néhány perc múlva.',
    )
  }

  await payload.update({
    collection: 'orders',
    id: order.id,
    data: {
      barionPaymentId,
      barionPaymentRequestId,
    },
    overrideAccess: true,
  })

  log.info('checkout-start: fizetés elindítva', {
    orderId: order.id,
    orderNumber,
    userId: buyer.customerId,
    // Vendég-vásárlásnál a rendelés (még) nem kötődik fiókhoz — ez a napló
    // egyetlen, e-mail-cím nélküli jelzése róla.
    guestCheckout: buyer.customerId === null,
    productId,
    totalHuf,
    // A számlázási adat SZEMÉLYES adat — sem a mezői, sem származtatott
    // értékük nem kerül a naplóba.
  })

  return { orderNumber, gatewayUrl }
}
