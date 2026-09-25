import type { Payload } from 'payload'

import type { Order, Product, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { shouldEmitThrottledAlert } from '../alert-throttle'
import {
  isPaymentDefinitelyNotFound,
  isUnverifiedNotFound,
} from '../barion-callback/process-callback'
import {
  BARION_DEFAULT_PAYMENT_WINDOW,
  BarionApiError,
  fetchPaymentState,
  getBarionConfig,
  mapBarionPaymentStatus,
  startPayment,
  type BarionClientConfig,
  type BarionEnvironment,
  type BarionPaymentStateResponse,
  type OrderPaymentState,
} from '../barion'
import { canonicalBarionGuid } from '../barion/guid'
import { BARION_MIN_TRANSACTION_HUF, type StartPaymentPayerAccountInput } from '../barion/start'
import { coursePriceHuf } from '../courses'
import { durationDaysFromProduct } from '../access-grants'
import { resolveSingleCourseAccess } from '../course-access-lookup'
import { formatPriceHuf } from '../format-price'
import { logger, type Logger } from '../logger'
import { onOrderPaid } from '../order-paid'
import { applyBarionStateTransition } from '../order-status/apply-barion-state'
import { updateOrderStatusIfCurrent } from '../order-status/conditional-status'
import {
  paidRejectRecoveryLogContext,
  recoverRejectedSucceededPayment,
  type RecoverRejectedSucceededPaymentInput,
  type PaidRejectRecoveryResult,
} from '../order-status/recover-paid-reject'
import type { OrderCustomerResolution } from '../order-status/resolve-order-customer'
import {
  CHECKOUT_PAYMENT_STATE_UNAVAILABLE,
  CHECKOUT_PAYMENT_STATE_UNVERIFIED,
  barionPayUrl,
  checkoutPaymentInProgressMessage,
  checkoutStartRejectedWaitMessage,
  checkoutStartUncertainMessage,
  decidePendingCheckout,
  minutesLeftInWindow,
  pendingOrderMatchesRequest,
  type PendingResumeExpectation,
} from './pending-payment'
import { billingSummaryMessage, validateBilling, type NormalizedBilling } from './billing'
import { isGuestBindableAccount } from '../order-status/guest-bindable-account'
import {
  CHECKOUT_ALREADY_PURCHASED_ERROR,
  CHECKOUT_GUEST_EXISTING_ACCOUNT,
  CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_PAYEE_EMAIL_ACCOUNT,
  CHECKOUT_PAYEE_EMAIL_GUEST,
  CHECKOUT_PAYMENT_CONFIG_UNAVAILABLE,
  CHECKOUT_REFUNDED_PRIVILEGED,
  CHECKOUT_REFUNDED_RETRY,
  CHECKOUT_START_REJECTED,
  CHECKOUT_TERMS_ERROR,
} from './form-submission'
import {
  GUEST_SUMMARY_MISSING,
  guestSummaryMessage,
  validateGuest,
  type NormalizedGuest,
} from './guest'
import { classifyStartFailure } from './start-failure'
import { checkOrderLimits, reportGuestOrderBurst } from './abuse-limits'
import { CheckoutLockBusyError, withCheckoutLockSlot } from './lock-slots'

export {
  CHECKOUT_GUEST_EXISTING_ACCOUNT,
  CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED,
  CHECKOUT_REFUNDED_RETRY,
}

/**
 * Bejelentkezett duplavásárlás. A munkamenet a saját fiók, ez nem orákulum.
 * Ugyanaz a mondat, mint a pénztár kliens-blokkolója: a lejátszó a következő
 * lépés, nem egy meg nem nevezett „fiók”.
 */
export const CHECKOUT_ALREADY_PURCHASED = CHECKOUT_ALREADY_PURCHASED_ERROR

/**
 * Az elutasított Barion Start riasztásának fojtása hibakódonként. Rövidebb az
 * alapértelmezett 6 óránál: az elutasítás „az eladás áll" állapot, amelyről
 * óránként kell új riasztás, és egy megoldott, majd órákon belül visszatérő
 * ugyanilyen hiba se maradjon warn-sor.
 */
export const CHECKOUT_START_REJECTED_ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1 óra

/**
 * Az elindult, de a rendelésre el nem menthető fizetés és a bizonytalan
 * kimenetű Start riasztásának fojtása: ugyanaz az óránkénti ütem, mint az
 * elutasított Startnál (az adatbázis- vagy Barion-kiesés minden vevőt érint).
 */
export const CHECKOUT_START_UNCERTAIN_ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1 óra

/** A pénztár-zár sora betelt (túlterhelés): a vevő pár másodperc múlva újrapróbálhat. */
export const CHECKOUT_BUSY =
  'A fizetés indítása most nem sikerült a nagy terhelés miatt. Pénzt nem vontunk le. Próbáld újra néhány másodperc múlva.'

/**
 * A fizetés a Barionban elindult, de az azonosítóját nem tudtuk a rendelésre
 * menteni. A fizetési oldalt ezért NEM nyitjuk meg (a vevő így nem fizethet
 * olyan fizetést, amelyről a rendszer nem tud), a Barion-fizetés kifizetetlenül
 * lejár. Ha a rendelést sikerült lezárni, a vevő azonnal újrapróbálhat;
 * különben a fizetési ablak végéig vár (GOV.UK, There is a problem with the
 * service: mondd meg, mi lett a megkezdett ügyével és mikor próbálkozhat újra,
 * https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/).
 */
export const CHECKOUT_PAYMENT_NOT_SAVED_RETRY =
  'A fizetési oldal nem nyílt meg, mert egy hiba miatt nem tudtuk rögzíteni a fizetést. Pénzt nem vontunk le. Próbáld újra néhány perc múlva.'

export function checkoutPaymentNotSavedWaitMessage(minutesLeft: number): string {
  return (
    'A fizetési oldal nem nyílt meg, mert egy hiba miatt nem tudtuk rögzíteni a fizetést. ' +
    `Pénzt nem vontunk le. Erre a kurzusra ${minutesLeft} perc múlva indíthatsz új fizetést.`
  )
}

/**
 * A rendelés ára eltér attól, amit a kérés elején ellenőriztünk (az akció
 * vagy az ár a két olvasás között változott). A rendelés lezárul, fizetés nem
 * indul; a vevő a mostani árat kapja (ugyanaz a szerkezet, mint a kliens-ár
 * eltérésének szövege, a-checkout-16).
 */
export function checkoutPriceChangedMessage(currentPriceHuf: number): string {
  return (
    `Az ár közben megváltozott, a mostani ár ${formatPriceHuf(currentPriceHuf)}. Pénzt nem vontunk le. ` +
    'Frissítsd az oldalt, és indítsd újra a fizetést. A frissítés után a beírt adatokat újra meg kell adnod.'
  )
}

/**
 * Az ár közben olyanra változott, amelyen a kurzus nem fizethető ki (az ár
 * törölve, a kurzus ingyenes lett, vagy a Barion 10 Ft-os minimuma alatt
 * van). Ilyenkor nincs „mostani ár", amit megnevezhetnénk, és az újraindítást
 * sem ígérhetjük meg: a frissített oldal mutatja, mi a helyzet a kurzussal.
 * Mi történt, mi lett a pénzzel, mit tegyen (GOV.UK, Problem with the service
 * pages: „information about what has happened to their answers",
 * https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/;
 * NN/g, Error-Message Guidelines: „Concisely and precisely describe the issue",
 * „Offer constructive advice", https://www.nngroup.com/articles/error-message-guidelines/).
 */
export const CHECKOUT_PRICE_CHANGED_UNAVAILABLE_MESSAGE =
  'A kurzus ára közben megváltozott, ezért most nem vásárolható meg. Pénzt nem vontunk le. Frissítsd az oldalt.'

/**
 * POST /api/checkout/start. Ár csak szerveroldali snapshot; kliens-ár nem
 * forrás. Duplavásárlás-blokk + rendelés-létrehozás egy zárban; a zárban
 * SEMMILYEN Barion-hívás nem fut (Start, PaymentState, visszatérítés): a zár
 * alatt olvasunk, a záron kívül kérdezzük a Bariont, majd újra zárolva írunk
 * (a-checkout-4). `paid` csak a callback/poll állapotgépen. Vendég: guest
 * e-mail, fiók fizetés után. Bejelentkezett sessionnél az `input.guest`
 * figyelmen kívül. `billing` kötelező, profil-tartalék nincs.
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
  /** ÁSZF + adatvédelem egy jelölőből — kötelező (ingyenes terméken is); szerveroldali kapu. */
  consentTerms?: unknown
  /** Számlázási adatok — kötelező, nincs profil-tartalék; a snapshot/számla ebből készül. */
  billing?: unknown
  /** Vendég: `{ email, name }` — bejelentkezve figyelmen kívül. */
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
  /** Tesztben injektálható Barion-állapotlekérdezés. */
  fetchPaymentState?: typeof fetchPaymentState
  /** Tesztben injektálható paid-átmenet. */
  applyBarionStateTransition?: typeof applyBarionStateTransition
  /** Tesztben injektálható paid-mellékhatás. */
  onOrderPaid?: typeof onOrderPaid
  /** Tesztben injektálható hozzáférés-számítás. */
  resolveSingleCourseAccess?: typeof resolveSingleCourseAccess
  /** Tesztben injektálható „most". */
  now?: Date
  /** Tesztben injektálható Barion-környezet a Pay-URL-hez. */
  barionEnvironment?: BarionEnvironment
  /**
   * Tesztben injektálható paid-reject recovery (Barion-refund).
   * Tesztből élő Barion-hívás tilos.
   */
  recoverRejectedPaid?: (
    input: RecoverRejectedSucceededPaymentInput,
  ) => Promise<PaidRejectRecoveryResult>
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

function fieldErrorMessage<E extends { message: string }>(
  errors: readonly E[],
  summarize: (errors: readonly E[]) => string,
): string {
  const details = errors.map((item) => item.message)
  const summary = summarize(errors)
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
      throw new CheckoutError(400, 'Ebből a kurzusanyagból egyszerre csak egy példány vásárolható.')
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
      'A vásárláshoz el kell fogadnod, hogy a tartalom azonnali megnyitásával lemondasz az elállási jogodról.',
    )
  }

  // Az ÁSZF elfogadása (és az adatkezelési tájékoztató megismerése) — a
  // szerződés ettől jön létre (ÁSZF 22. bekezdés), ezért a kliens-oldali
  // jelölőnégyzet mellett a SZERVER is kikényszeríti. A mezőt a
  // `buildCustomerSnapshot` időbélyeggel rögzíti a rendelésre. A szöveg
  // ugyanaz, mint a pénztár kliensoldali hibája: ugyanarra a hiányra egy mondat.
  if (input.consentTerms !== true) {
    throw new CheckoutError(400, CHECKOUT_TERMS_ERROR)
  }

  // Számlázási adatok: csak a kérésből, profil-tartalék nélkül (kliens megkerülhető).
  const billingResult = validateBilling(input.billing)
  if (!billingResult.ok) {
    throw new CheckoutError(400, fieldErrorMessage(billingResult.errors, billingSummaryMessage))
  }

  // Vendég: bejelentkezve a session az igazság; különben kötelező e-mail + név.
  const guest = hasSession ? null : validateGuest(input.guest)
  if (guest !== null && !guest.ok) {
    throw new CheckoutError(400, fieldErrorMessage(guest.errors, guestSummaryMessage))
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
 * Termék megvásárolhatóság (státusz + legalább 10 Ft-os ár); elutasító ágak
 * naplózva. A visszatérési érték a MOST ellenőrzött ár: a létrehozott rendelés
 * végösszegének ezzel kell egyeznie.
 */
function assertPurchasable(
  product: Product,
  log: Logger,
  nowMs: number,
  priceHuf?: number,
): number {
  if (product.status === 'archived') {
    log.warn('checkout-start: vásárlás elutasítva — a termék archivált', {
      productId: product.id,
      productStatus: product.status,
      reason: 'archived',
    })
    // Ugyanaz a mondat, amit a pénztár archivált kurzusnál mutat (penztar/page.tsx).
    throw new CheckoutError(400, 'Ez a kurzus jelenleg nem vásárolható meg.')
  }
  if (product.status !== 'published') {
    log.warn('checkout-start: vásárlás elutasítva — a termék státusza nem publikált', {
      productId: product.id,
      productStatus: product.status,
      reason: 'status-not-published',
    })
    throw new CheckoutError(400, 'Ez a termék jelenleg nem megvásárolható.')
  }
  // Ár-kapu: csak pozitív ár (`coursePriceHuf`); 0 Ft = hiányzó konfig, nem ingyenes út.
  const price = product.priceInHUF
  const serverPriceHuf = coursePriceHuf(product)
  if (serverPriceHuf === null) {
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
  // A Barion kártyás minimuma alatti ár: a vevő nem fizethetné ki, a
  // tulajdonosnak viszont azonnal tudnia kell róla. Friss beírás ide már nem
  // juthat (a plugin `validatePriceInHUF`-ja a MIN_PRICE_HUF alatti új értéket
  // elutasítja); az ág a validátor előtt mentett, azóta változatlan publikált
  // árakért és a validációt kihagyó főrekord-írásokért van. A riasztás
  // termékenként fojtott; a levél a `source` mezőből tudja megnevezni a terméket.
  if (serverPriceHuf < BARION_MIN_TRANSACTION_HUF) {
    const context = {
      productId: product.id,
      serverPriceHuf,
      minimumHuf: BARION_MIN_TRANSACTION_HUF,
      reason: 'price-below-barion-minimum',
      source: `product-${product.id}`,
    }
    if (shouldEmitThrottledAlert(`checkout-price-below-minimum:${product.id}`, undefined, nowMs)) {
      log.error(
        'RIASZTÁS: a kurzus ára a Barion 10 Ft-os minimuma alatt van, így nem vásárolható meg. Javítsd az árat az adminban (Termékek).',
        context,
      )
    } else {
      log.warn(
        'checkout-start: vásárlás elutasítva — az ár a Barion-minimum alatt (fojtva)',
        context,
      )
    }
    throw new CheckoutError(400, 'A termékhez nem tartozik érvényes ár, így nem vásárolható meg.')
  }
  // Szerver-oldali ár-kikényszerítés: a kliens ára sosem forrás — ha eltér a
  // szerveren tárolt ártól, a kérést elutasítjuk (eltérés = 400).
  // WP63: a szerver ára a MOST fizetendő ár (akcióban az akciós ár); ha az
  // akció a lapnyitás és a fizetés között járt le, az eltérés 400, a vevő a
  // friss árat látja újratöltés után.
  if (priceHuf !== undefined && priceHuf !== serverPriceHuf) {
    log.warn('checkout-start: vásárlás elutasítva — a kliens ára eltér a szerver árától', {
      productId: product.id,
      productStatus: product.status,
      clientPriceHuf: priceHuf,
      serverPriceHuf,
      reason: 'client-price-mismatch',
    })
    // A vevő a mostani árat is megkapja, és azt is, hogy a frissítés a beírt
    // adatait elviszi (a pénztár nem tárol űrlapállapotot). GOV.UK: mondd meg,
    // megmaradtak-e a válaszai (problem-with-the-service-pages).
    throw new CheckoutError(
      400,
      `A kurzus ára időközben megváltozott, a mostani ár ${formatPriceHuf(serverPriceHuf)}. ` +
        'Frissítsd az oldalt, és indítsd újra a fizetést. A frissítés után a beírt adatokat újra meg kell adnod.',
    )
  }
  return serverPriceHuf
}

/**
 * A duplavásárlás-blokk SZŰRŐJE: a vevőt vagy a fiókja (bejelentkezve), vagy az
 * e-mail-címe (vendégként) azonosítja a rendeléseken.
 */
type DuplicateScope = { kind: 'customer'; userId: number } | { kind: 'email'; email: string }

function duplicateScopeWhere(scope: DuplicateScope, productId: number): Record<string, unknown> {
  return {
    ...(scope.kind === 'customer'
      ? { customer: { equals: scope.userId } }
      : { customerEmail: { equals: scope.email } }),
    'items.product': { equals: productId },
  }
}

/** Duplavásárlás-blokk: paid rendelés vagy AKTÍV (nem lejárt) payment_pending → 409. */
type DuplicateCheckResult =
  | { kind: 'ok' }
  | { kind: 'resume'; orderNumber: string; gatewayUrl: string }
  | {
      kind: 'already-paid'
      order: Order
      transitionedToPaid: boolean
      customer?: OrderCustomerResolution
    }
  /**
   * A függő fizetés Barion-állapota még nem ismert: a hívó a zárat elengedi,
   * a záron KÍVÜL lekérdezi, és újra zárolva dönt (a-checkout-4).
   */
  | { kind: 'need-state'; orderId: number; paymentId: string }
  /**
   * A Barion szerint kifizetett függő rendelést az állapotgép elutasította
   * (pl. összegeltérés): a visszatérítés Barion-hívás, tehát a záron kívül fut.
   */
  | { kind: 'paid-rejected'; order: Order; state: BarionPaymentStateResponse; reason: string }

/**
 * Egy függő fizetés Barion-állapotának eredménye, a záron KÍVÜL lekérdezve.
 * A `state` ág a nyers választ is hordozza (a paid-átmenetnek kell).
 */
type PaymentStateLookup =
  | { kind: 'state'; raw: BarionPaymentStateResponse; mapped: OrderPaymentState }
  | { kind: 'not-found' }
  | { kind: 'unverified-not-found' }
  | { kind: 'unavailable' }

/**
 * A függő fizetés állapotának lekérdezése — a checkout-zár ELENGEDÉSE UTÁN.
 * A hibaosztályozás és a naplózás ugyanaz, mint korábban a zárban.
 */
async function lookupPendingPaymentState(input: {
  orderId: number
  paymentId: string
  fetchPaymentState: typeof fetchPaymentState
  log: Logger
  nowMs: number
}): Promise<PaymentStateLookup> {
  const { orderId, log } = input
  try {
    const raw = await input.fetchPaymentState(input.paymentId)
    return { kind: 'state', raw, mapped: mapBarionPaymentStatus(raw.Status) }
  } catch (error) {
    if (error instanceof BarionApiError && isPaymentDefinitelyNotFound(error)) {
      // A Barion kifejezett hibajelzéssel nem ismeri a PaymentId-t (pl.
      // teszt-környezetben indított fizetés az éles kulccsal): a függő sor
      // sosem zárulna le, a vevő erre a termékre örökre 503-at kapna. A
      // fizetési ablak lejárta után lezárjuk, és új Start mehet.
      log.warn('checkout-start: a Barion kifejezetten jelzi, hogy nem ismeri a függő fizetést', {
        orderId,
        httpStatus: error.httpStatus ?? null,
        providerErrorCodes: error.providerErrors.map((providerError) => providerError.ErrorCode),
      })
      return { kind: 'not-found' }
    }
    if (error instanceof BarionApiError && isUnverifiedNotFound(error)) {
      // Puszta 404: útvonal- vagy verzióváltás, közbülső 404 is lehet. Ha
      // ezt „nincs ilyen fizetés"-nek vennénk, egy élő (akár már kifizetett)
      // fizetés mellé második indulna. Fail-closed 503 + riasztás. A
      // riasztás rendelésenként FOJTOTT: a vevő minden próbálkozása
      // ugyanezt látja, a nyitott ügyről elég egy error-sor a cooldown alatt.
      const alertContext = {
        orderId,
        httpStatus: error.httpStatus ?? null,
        providerErrorCodes: error.providerErrors.map((providerError) => providerError.ErrorCode),
      }
      if (shouldEmitThrottledAlert(`checkout-unverified-404:${orderId}`, undefined, input.nowMs)) {
        log.error(
          'RIASZTÁS: a Barion PaymentState HTTP 404-et adott „nincs ilyen fizetés" jelzés nélkül — ' +
            'a függő fizetést nem zárjuk le, új fizetés nem indul. Ha minden fizetésnél ez jön, ' +
            'ellenőrizd a BARION_API_URL-t és a PaymentState-útvonalat. Ha csak ennél, a fizetés ' +
            'valószínűleg a másik Barion-környezetben indult: a 24 óránál régebbi sort az ' +
            'order-poll lezárja, amint egy másik GetState vagy az útvonal-próba sikeres.',
          alertContext,
        )
      } else {
        log.warn(
          'checkout-start: a függő fizetésre ismét puszta HTTP 404 jött (a riasztás fojtva)',
          alertContext,
        )
      }
      return { kind: 'unverified-not-found' }
    }
    log.warn('checkout-start: a Barion fizetésállapot nem kérdezhető le', {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { kind: 'unavailable' }
  }
}

function purchaseIdsFromUser(user: User | null | undefined): Set<number> {
  const ids = new Set<number>()
  const purchases = user?.purchases
  if (!Array.isArray(purchases)) {
    return ids
  }
  for (const entry of purchases) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      ids.add(entry)
    } else if (entry && typeof entry === 'object' && typeof entry.id === 'number') {
      ids.add(entry.id)
    }
  }
  return ids
}

interface BarionCheckoutConfig {
  config: BarionClientConfig
  /** A Pay-URL környezete: a tesztben injektált érték, különben a konfiguráció. */
  environment: BarionEnvironment
}

/**
 * A Barion-konfiguráció feloldása a rendelés létrehozása ELŐTT. Hibás
 * konfigurációval egyetlen fizetés sem indulhat; ez üzemeltetői hiba, nem a
 * vevőé, ezért saját üzenetet és RIASZTÁS-t kap (korábban a „fizetés
 * állapotát nem tudtuk ellenőrizni" 503-ba és egy warn-sorba olvadt bele).
 * A hibaszöveg a változók NEVÉT és a nem titkos értékeket tartalmazza, kulcsot
 * soha (client.ts getBarionConfig).
 */
function resolveBarionCheckoutConfig(
  explicit: BarionEnvironment | undefined,
  log: Logger,
): BarionCheckoutConfig {
  let config: BarionClientConfig
  try {
    config = getBarionConfig()
  } catch (error) {
    log.error(
      'RIASZTÁS: a Barion-konfiguráció hibás — egyetlen fizetés sem indítható. Ellenőrizd a BARION_* környezeti változókat.',
      { error: error instanceof Error ? error.message : String(error) },
    )
    throw new CheckoutError(503, CHECKOUT_PAYMENT_CONFIG_UNAVAILABLE)
  }
  return {
    config,
    environment: explicit === 'test' || explicit === 'prod' ? explicit : config.environment,
  }
}

/**
 * A vevő e-mail-címe nem lehet a bolt Barion-fiókjáé (BARION_PAYEE_EMAIL): a
 * Barion a saját boltban fizetést elutasítja (docs.barion.com Troubleshooting,
 * „Paying in your own shop": „You cannot pay in your own shop."; Responsive
 * web payment: „Do not try to pay with the account that owns the shop!").
 * A rendelés létrehozása ELŐTT utasítjuk el, így nem marad függő rendelés.
 * A PayerHint csak előkitöltés: a Barion-oldalon begépelt címet ez nem fogja,
 * ezért a tulajdonosi próbavásárláshoz másik e-mail és kártya kell.
 */
function assertBuyerIsNotPayee(
  buyerEmail: string,
  loggedIn: boolean,
  payeeEmail: string,
  log: Logger,
): void {
  if (buyerEmail.trim().toLowerCase() !== payeeEmail.trim().toLowerCase()) {
    return
  }
  // Az e-mail-cím személyes adat: a naplóba csak a tény kerül.
  log.warn('checkout-start: a vevő e-mail-címe a Barion-kedvezményezetté — fizetés nem indul', {
    loggedIn,
    reason: 'payer-is-payee',
  })
  throw loggedIn
    ? new CheckoutError(409, CHECKOUT_PAYEE_EMAIL_ACCOUNT)
    : new CheckoutError(400, CHECKOUT_PAYEE_EMAIL_GUEST)
}

interface DuplicateCheckContext {
  payload: Payload
  scope: DuplicateScope
  product: Product
  user: User | null
  paidMessage: string
  log: Logger
  nowMs: number
  /** A záron kívül már lekérdezett állapotok PaymentId szerint (ebben a kérésben). */
  paymentStates: ReadonlyMap<string, PaymentStateLookup>
  applyBarionStateTransition: typeof applyBarionStateTransition
  resolveSingleCourseAccess: typeof resolveSingleCourseAccess
  barionEnvironment: BarionEnvironment
  /** A mostani kérés ára és számlázási adatai: csak egyezésnél folytatunk. */
  resumeExpectation: PendingResumeExpectation
}

/**
 * Duplavásárlás + függő Barion-fizetés — a checkout-zárban fut, de Barion-
 * hívás NÉLKÜL.
 *
 * Először a még nyitott payment_pending-et nézzük (Baymard: ne indíts
 * második fizetést, folytasd a meglevőt). Ha a függő sornak van PaymentId-ja,
 * és az állapota ebben a kérésben még nincs lekérdezve, `need-state`-tel
 * visszaadjuk: a hívó a zárat elengedi, a záron kívül kérdezi a Bariont, és
 * újra zárolva, friss olvasással dönt. Korábban a GetPaymentState (1–2 mp,
 * akár a 15 mp-es timeoutig) és a paid-reject visszatérítés a zárban futott, és
 * addig egy pool-kapcsolatot fogott (a-checkout-4).
 *
 * GetPaymentState hiba → 503, fail-closed. Succeeded → helyi paid-átmenet, új
 * Start tilos. Failed / Expired / Canceled → helyi cancelled, új Start mehet.
 *
 * Paid / purchases: vendégnek mindig 409 (nem áruljuk el a vásárlást).
 * Bejelentkezve a lejárt időkorlátos hozzáférés ÚJRA vásárolható; az
 * unlimited SKU-nál a tulajdonlás (purchases vagy paid) számít, nem a
 * hasAccess fail-open.
 */
async function resolveDuplicatePurchase(ctx: DuplicateCheckContext): Promise<DuplicateCheckResult> {
  const baseWhere = duplicateScopeWhere(ctx.scope, ctx.product.id)

  const pendingOrders = await ctx.payload.find({
    collection: 'orders',
    where: { and: [baseWhere, { status: { equals: 'payment_pending' } }] },
    limit: 1,
    depth: 0,
    sort: '-createdAt',
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])

  let pendingBecamePaid = false
  const pending = pendingOrders.docs[0] as Order | undefined
  if (pending) {
    const paymentId =
      typeof pending.barionPaymentId === 'string' && pending.barionPaymentId.trim().length > 0
        ? pending.barionPaymentId.trim()
        : null
    let mappedState:
      | 'paid'
      | 'cancelled'
      | 'payment_pending'
      | 'unavailable'
      | 'not-found'
      | 'unverified-not-found'
      | null = null
    let rawState: BarionPaymentStateResponse | null = null
    if (paymentId !== null) {
      const lookup = ctx.paymentStates.get(paymentId)
      if (lookup === undefined) {
        return { kind: 'need-state', orderId: pending.id, paymentId }
      }
      if (lookup.kind === 'state') {
        rawState = lookup.raw
        mappedState = lookup.mapped
      } else {
        mappedState = lookup.kind
      }
    }

    const decision = decidePendingCheckout({
      barionPaymentId: paymentId,
      createdAt: typeof pending.createdAt === 'string' ? pending.createdAt : null,
      mappedState,
      nowMs: ctx.nowMs,
      windowMs: paymentWindowToMs(),
    })

    if (decision.kind === 'barion-unavailable') {
      throw new CheckoutError(503, CHECKOUT_PAYMENT_STATE_UNAVAILABLE)
    }
    if (decision.kind === 'unverified-not-found') {
      throw new CheckoutError(503, CHECKOUT_PAYMENT_STATE_UNVERIFIED)
    }
    if (decision.kind === 'wait-no-payment-id' || decision.kind === 'wait-not-found') {
      throw new CheckoutError(409, checkoutPaymentInProgressMessage(decision.minutesLeft))
    }
    const resumeMatches =
      decision.kind === 'resume' && pendingOrderMatchesRequest(pending, ctx.resumeExpectation)
    if (decision.kind === 'resume' && !resumeMatches) {
      // Az élő fizetés más árral vagy más számlázási adatokkal indult: nem
      // küldjük vissza rá a vevőt. A régi sor lezárul, új fizetés indul; ha a
      // régi mégis teljesülne, a késői siker és a K5 duplafizetés-őr kezeli.
      ctx.log.info('checkout-start: a függő fizetés adatai eltérnek — új fizetés indul', {
        orderId: pending.id,
        priceMatches: pending.totalHufSnapshot === ctx.resumeExpectation.priceHuf,
      })
    }
    if (decision.kind === 'resume' && resumeMatches) {
      const orderNumber = pending.orderNumber
      if (typeof orderNumber !== 'string' || orderNumber.length === 0) {
        throw new CheckoutError(
          409,
          checkoutPaymentInProgressMessage(
            minutesLeftInWindow(
              typeof pending.createdAt === 'string' ? pending.createdAt : null,
              ctx.nowMs,
              paymentWindowToMs(),
            ),
          ),
        )
      }
      return {
        kind: 'resume',
        orderNumber,
        gatewayUrl: barionPayUrl(decision.paymentId, ctx.barionEnvironment),
      }
    }
    if (decision.kind === 'already-paid') {
      if (rawState === null) {
        throw new CheckoutError(503, CHECKOUT_PAYMENT_STATE_UNAVAILABLE)
      }
      const transition = await ctx.applyBarionStateTransition({
        payload: ctx.payload,
        order: pending,
        mapped: 'paid',
        state: rawState,
        log: ctx.log,
      })
      if (transition.action === 'rejected') {
        // A visszatérítés Barion-hívás: a záron kívül fut (lásd startCheckout).
        return {
          kind: 'paid-rejected',
          order: pending,
          state: rawState,
          reason: transition.reason ?? 'unknown',
        }
      }
      return {
        kind: 'already-paid',
        order:
          transition.customer !== undefined
            ? { ...pending, customer: transition.customer.userId }
            : pending,
        transitionedToPaid: transition.transitionedToPaid === true,
        ...(transition.customer !== undefined ? { customer: transition.customer } : {}),
      }
    }
    if (decision.kind === 'cancel-and-restart' || (decision.kind === 'resume' && !resumeMatches)) {
      const cancelled = await updateOrderStatusIfCurrent({
        payload: ctx.payload,
        orderId: pending.id,
        expected: 'payment_pending',
        next: 'cancelled',
      })
      if (!cancelled) {
        const fresh = (await ctx.payload.findByID({
          collection: 'orders',
          id: pending.id,
          depth: 0,
          overrideAccess: true,
        })) as Order
        pendingBecamePaid = fresh.status === 'paid'
      }
    }
  }

  const paidOrders = await ctx.payload.find({
    collection: 'orders',
    where: { and: [baseWhere, { status: { equals: 'paid' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  const hasPaidOrder = paidOrders.totalDocs > 0 || pendingBecamePaid
  const ownsInPurchases = purchaseIdsFromUser(ctx.user).has(ctx.product.id)

  if (!hasPaidOrder && !ownsInPurchases) {
    return { kind: 'ok' }
  }

  if (ctx.user === null) {
    throw new CheckoutError(409, ctx.paidMessage)
  }

  const durationDays = durationDaysFromProduct(ctx.product)
  if (durationDays === null) {
    throw new CheckoutError(409, ctx.paidMessage)
  }

  const access = await ctx.resolveSingleCourseAccess({
    payload: ctx.payload,
    userId: ctx.user.id,
    product: ctx.product,
    now: new Date(ctx.nowMs),
    logger: ctx.log,
  })
  if (access.reason === 'expired') {
    return { kind: 'ok' }
  }
  throw new CheckoutError(409, ctx.paidMessage)
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
 * Vevő-snapshot a rendelésre. Az ÁSZF-elfogadás: `consentTerms` + `consentTermsAt`
 * ugyanabban a JSON-snapshotban, mint a számlázási mezők.
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
    // K11: „Cégként vásárolok" (a számla vevőblokkja ebből dönthet az adóalanyiságról).
    companyPurchase: billing.companyPurchase,
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
    log.warn(
      'checkout-start: a vendég e-mailhez tartozó fiók keresése sikertelen (a checkout folytatódik)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    )
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
 * Hány zárolt kör lehet egy kérésben. Minden kör vagy dönt, vagy egy még
 * ismeretlen állapotú függő fizetést ad vissza lekérdezésre: a vevő
 * fiók-hatókörű és e-mail-hatókörű függő sora (2), plusz egy záró kör, plusz
 * egy tartalék arra, ha a körök között egy párhuzamos kérés újabb függő sort
 * mentett el PaymentId-val. Ennél több kör már állandó versengést jelez:
 * ilyenkor fail-closed 503 (új fizetés nem indul).
 */
const CHECKOUT_LOCK_MAX_ROUNDS = 4

/** A Barion 3DS-hez a fiók létrehozási ideje; hiányzó vagy érvénytelen érték → null. */
function accountCreatedAt(user: User): Date | null {
  const raw = (user as { createdAt?: unknown }).createdAt
  if (typeof raw !== 'string') {
    return null
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * A checkout-start teljes folyamata. Hiba esetén CheckoutError-t dob. Ha a
 * Barion hibajelzéssel elutasítja a Startot, a rendelés payment_failed lesz
 * (fizetés nem jött létre, a vevő újrapróbálhatja); bizonytalan kimenetnél
 * (timeout, hálózat, 5xx, értelmezhetetlen válasz) payment_pending marad, és
 * a Start nem fut újra a fizetési ablak végéig.
 */
export async function startCheckout(options: CheckoutStartOptions): Promise<CheckoutStartResult> {
  const { payload } = options
  const user = options.user ?? null
  const log = options.logger ?? logger
  const nowMs = (options.now ?? new Date()).getTime()
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
  const validatedPriceHuf = assertPurchasable(product, log, nowMs, priceHuf)

  const buyer = await resolveBuyer(payload, user, guest, log)
  const barion = resolveBarionCheckoutConfig(options.barionEnvironment, log)
  assertBuyerIsNotPayee(buyer.email, user !== null, barion.config.payeeEmail, log)

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
   * A KRITIKUS SZAKASZ: duplavásárlás-ellenőrzés, visszaélési korlátok és
   * rendelés-létrehozás egyben, vevőnkénti advisory-zár alatt (processzek
   * között is soros). A MÁS vevőt érintő checkout nem várakozik. Ugyanannak a
   * vevőnek két különböző kurzusa viszont sorba áll (Codex, PR #307): az
   * e-mail-szintű korlátok (abuse-limits.ts) a vevő összes rendelését számolják,
   * így termékenkénti zár mellett két párhuzamos kérés mindkettője a korlát
   * alatt láthatná a számot, és mindkettő rendelést és Barion-fizetést indítana.
   * A védett szakasz rövid (adatbázis-olvasás és -írás, a Barion a záron kívül),
   * így a sorba állás csak ugyanannak a vevőnek a párhuzamos kéréseit lassítja.
   *
   * A ZÁRKULCS vendégnél a MEGLÉVŐ fiók azonosítója (ha van), különben az
   * e-mail-cím — így ugyanaz a vevő akkor is egy sorban marad, ha az egyik
   * fülön belépve, a másikon vendégként indít fizetést.
   *
   * A zár ELŐTT a folyamaton belüli helykorlát (lock-slots.ts) áll: egyszerre
   * legfeljebb két pénztár-zár fog pool-kapcsolatot, így a védett szakaszok
   * lekérdezései mindig kapnak kapcsolatot (a-checkout-4).
   */
  const lockKey =
    buyer.existingUser !== null
      ? `checkout:${buyer.existingUser.id}`
      : `checkout:guest:${buyer.email}`
  const runLocked = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await withCheckoutLockSlot(() => withAdvisoryLock(payload, lockKey, fn, log))
    } catch (error) {
      if (error instanceof CheckoutLockBusyError) {
        log.warn('checkout-start: a pénztár-zár sora betelt — 503 (túlterhelés)', {
          productId,
          error: error.message,
        })
        throw new CheckoutError(503, CHECKOUT_BUSY)
      }
      throw error
    }
  }

  const fetchPaymentStateFn = options.fetchPaymentState ?? fetchPaymentState
  const applyBarionStateTransitionFn =
    options.applyBarionStateTransition ?? applyBarionStateTransition
  const onOrderPaidFn = options.onOrderPaid ?? onOrderPaid
  const resolveSingleCourseAccessFn = options.resolveSingleCourseAccess ?? resolveSingleCourseAccess
  const recoverRejectedPaidFn = options.recoverRejectedPaid ?? recoverRejectedSucceededPayment

  const paidMessage = user !== null ? CHECKOUT_ALREADY_PURCHASED : CHECKOUT_GUEST_FINISH_AFTER_LOGIN
  const paymentStates = new Map<string, PaymentStateLookup>()

  const lockedPhase = async (): Promise<
    Exclude<DuplicateCheckResult, { kind: 'ok' }> | { kind: 'created'; order: Order }
  > => {
    // K2 + W4: aktivált / staff / owner fiókra a vendég nem indít fizetést.
    // Az üzenet azonos, akár van kurzusuk, akár nincs.
    if (
      user === null &&
      buyer.existingUser !== null &&
      !isGuestBindableAccount(buyer.existingUser)
    ) {
      throw new CheckoutError(409, CHECKOUT_GUEST_EXISTING_ACCOUNT)
    }

    const duplicateCtx = {
      payload,
      product,
      user,
      paidMessage,
      log,
      nowMs,
      paymentStates,
      applyBarionStateTransition: applyBarionStateTransitionFn,
      resolveSingleCourseAccess: resolveSingleCourseAccessFn,
      barionEnvironment: barion.environment,
      resumeExpectation: {
        priceHuf: coursePriceHuf(product),
        buyerName: buyer.name,
        billing,
      },
    }

    if (buyer.existingUser !== null) {
      const customerResult = await resolveDuplicatePurchase({
        ...duplicateCtx,
        scope: { kind: 'customer', userId: buyer.existingUser.id },
      })
      if (customerResult.kind !== 'ok') {
        return customerResult
      }
    }
    // A fiókhoz még nem kötött (vendég) rendeléseket kizárólag az e-mail
    // azonosítja. Bejelentkezett vevőnél is le kell futtatni: a korábbi
    // vendég payment_pending (customer: null, customerEmail: ugyanaz)
    // egyébként láthatatlan maradna, és második Barion-terhelés indulna.
    // Vendég fiók nélkül: csak ez az e-mail-ág fut (existingUser null).
    const emailResult = await resolveDuplicatePurchase({
      ...duplicateCtx,
      scope: { kind: 'email', email: buyer.email },
    })
    if (emailResult.kind !== 'ok') {
      return emailResult
    }

    // Visszaélés elleni korlátok (a-checkout-9), közvetlenül a rendelés
    // létrehozása előtt, a duplavásárlás-döntés UTÁN.
    const limit = await checkOrderLimits({
      payload,
      email: buyer.email,
      guest: user === null,
      nowMs,
      paymentWindowMs: paymentWindowToMs(),
      log,
    })
    if (limit.kind !== 'ok') {
      throw new CheckoutError(limit.status, limit.message)
    }

    let lastConflict: unknown
    for (let attempt = 1; attempt <= ORDER_NUMBER_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
      try {
        return { kind: 'created' as const, order: await createOrderOnce() }
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
  }

  // Olvasás a zárban → Barion a záron kívül → újra zárolva döntés és írás.
  let lockResult: Awaited<ReturnType<typeof lockedPhase>> | null = null
  for (let round = 1; round <= CHECKOUT_LOCK_MAX_ROUNDS; round += 1) {
    const result = await runLocked(lockedPhase)
    if (result.kind !== 'need-state') {
      lockResult = result
      break
    }
    paymentStates.set(
      result.paymentId,
      await lookupPendingPaymentState({
        orderId: result.orderId,
        paymentId: result.paymentId,
        fetchPaymentState: fetchPaymentStateFn,
        log,
        nowMs,
      }),
    )
  }
  if (lockResult === null) {
    log.warn('checkout-start: a függő fizetések állapota a körök alatt sem állt össze — 503', {
      productId,
      rounds: CHECKOUT_LOCK_MAX_ROUNDS,
    })
    throw new CheckoutError(503, CHECKOUT_PAYMENT_STATE_UNAVAILABLE)
  }

  if (lockResult.kind === 'resume') {
    log.info('checkout-start: függő Barion-fizetés folytatása', {
      orderNumber: lockResult.orderNumber,
      productId,
    })
    return { orderNumber: lockResult.orderNumber, gatewayUrl: lockResult.gatewayUrl }
  }
  if (lockResult.kind === 'paid-rejected') {
    // A zár elengedése UTÁN: a visszatérítés Barion-hívás. A recovery saját
    // zárral és visszatérítési szándékkal (refund-intent) sorosít, ugyanúgy,
    // mint a callbackből és az order-pollból hívva.
    const pending = lockResult.order
    const rejectReason = lockResult.reason
    const recovery = await recoverRejectedPaidFn({
      payload,
      order: pending,
      state: lockResult.state,
      reason: rejectReason,
      log,
      source: 'checkout-start',
    })
    const recoveryCtx = paidRejectRecoveryLogContext({
      source: 'checkout-start',
      action: recovery.action,
      detail: recovery.detail,
      reason: rejectReason,
      orderId: pending.id,
    })
    log.info('paid-reject recovery lefutott', recoveryCtx)
    if (recovery.action === 'failed') {
      log.error(
        'RIASZTÁS: paid-reject recovery sikertelen — a checkout 409 marad, a pénz még kint lehet',
        recoveryCtx,
      )
    }
    // Sikeres refund + a vevő NEM kapott hozzáférést → az „already-paid"
    // válasz hamis lenne. duplicate-paid-order kivétel: ott van élő
    // hozzáférés, az already-paid üzenet igaz.
    const moneyReturned = recovery.action === 'refunded'
    if (rejectReason === 'total-mismatch' || rejectReason === 'refund-pending-reconciliation') {
      throw new CheckoutError(
        409,
        moneyReturned ? CHECKOUT_REFUNDED_RETRY : CHECKOUT_PAID_UNDER_REVIEW,
      )
    }
    if (rejectReason === 'guest-bind-privileged-account') {
      throw new CheckoutError(
        409,
        moneyReturned ? CHECKOUT_REFUNDED_PRIVILEGED : CHECKOUT_PAID_UNDER_REVIEW,
      )
    }
    if (rejectReason === 'refund-recorded') {
      throw new CheckoutError(409, CHECKOUT_PAID_UNDER_REVIEW)
    }
    throw new CheckoutError(409, paidMessage)
  }
  if (lockResult.kind === 'already-paid') {
    if (lockResult.transitionedToPaid) {
      await onOrderPaidFn({
        payload,
        order: lockResult.order,
        logger: log,
        ...(lockResult.customer
          ? {
              account: {
                passwordSetupPending: lockResult.customer.passwordSetupPending,
                alreadyLinked: lockResult.customer.alreadyLinked,
                email: lockResult.customer.email,
              },
            }
          : {}),
      })
    }
    throw new CheckoutError(409, paidMessage)
  }

  const order = lockResult.order
  const orderNumber = order.orderNumber
  if (!orderNumber) {
    log.error('checkout-start: a rendelés rendelésszám nélkül jött létre', { orderId: order.id })
    throw new CheckoutError(
      500,
      'A rendelés létrehozása most nem sikerült. Próbáld újra néhány perc múlva.',
    )
  }

  if (user === null) {
    await reportGuestOrderBurst({ payload, nowMs, log })
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

  // Ár-integritás (a-checkout-16): a hook a terméket a create pillanatában
  // újraolvassa, és AZ lesz a Barion-összeg. Ha az ár (vagy az akció) a kérés
  // eleji ellenőrzés és a create között változott, a vevő mást fizetne, mint
  // amit a pénztárban látott. Ilyenkor a rendelés lezárul, fizetés nem indul.
  if (totalHuf !== validatedPriceHuf * quantity) {
    log.warn('checkout-start: a rendelés végösszege eltér az ellenőrzött ártól — lezárjuk', {
      orderId: order.id,
      orderNumber,
      validatedPriceHuf,
      totalHuf,
      reason: 'price-changed-during-checkout',
    })
    try {
      await updateOrderStatusIfCurrent({
        payload,
        orderId: order.id,
        expected: 'payment_pending',
        next: 'cancelled',
      })
    } catch (cancelError) {
      log.error('checkout-start: az árváltozás miatti lezárás sikertelen', {
        orderId: order.id,
        orderNumber,
        error: cancelError instanceof Error ? cancelError.message : String(cancelError),
      })
    }
    // Csak kifizethető árat nevezünk meg (W1A-3): a törölt ár a hookban 0 Ft
    // lesz (`coursePriceHuf(product) ?? 0`), és a „mostani ár 0 Ft" hamis lenne.
    throw new CheckoutError(
      409,
      totalHuf >= BARION_MIN_TRANSACTION_HUF * quantity
        ? checkoutPriceChangedMessage(totalHuf)
        : CHECKOUT_PRICE_CHANGED_UNAVAILABLE_MESSAGE,
    )
  }

  const serverUrl = (options.serverUrl ?? process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(
    /\/+$/,
    '',
  )

  const payerAccount: StartPaymentPayerAccountInput =
    user !== null
      ? { kind: 'account', accountId: String(user.id), accountCreated: accountCreatedAt(user) }
      : { kind: 'guest' }

  /**
   * Barion Start-hiba két fajtája (start-failure.ts):
   * - ELUTASÍTOTT (4xx vagy 200 + Errors tömb): fizetés nem jött létre. A
   *   rendelés payment_failed lesz, így a vevő újrapróbálkozását nem fogja meg
   *   a „már folyamatban van egy fizetés" várakoztatás (a-checkout-2: a 401
   *   AuthenticationFailed eddig 30 percre kizárta a vevőt).
   * - BIZONYTALAN (timeout, hálózat, 5xx, értelmezhetetlen válasz): a Barion
   *   létrehozhatta a fizetést. A rendelés payment_pending marad, és a
   *   fail-closed `wait-no-payment-id` ág (decidePendingCheckout) nem indít
   *   második Startot a fizetési ablak végéig; a vevő megtudja, hány percig.
   */
  let gatewayUrl: string
  let barionPaymentId: string
  let barionPaymentRequestId: string
  try {
    const startResponse = await startPayment(
      {
        // PaymentRequestId = orderNumber: a Barion dokumentációja szerint ez
        // csak a bolt saját azonosítója (könyvelés, havi kivonat), a Barion
        // NEM deduplikál rá. Egy ismételt Start ÚJ fizetést hozhat létre, ezért
        // a Start sosem fut újra automatikusan (lásd a fenti hibaágakat).
        paymentRequestId: orderNumber,
        orderNumber,
        // A köszönőoldal a RENDELÉSSZÁMBÓL poll-ozza a státuszt (`?order=…`).
        // Enélkül minden fizető vevő a „Hiányzik a rendelésszám" nézetet kapná —
        // a Barion-visszatérés ugyanis nem hordoz más azonosítót, amit az oldal
        // használni tudna.
        redirectUrl: `${serverUrl}/fizetes/koszonom?order=${encodeURIComponent(orderNumber)}`,
        callbackUrl: `${serverUrl}/api/barion/callback`,
        payerHint: buyer.email || undefined,
        cardHolderNameHint: buyer.name ?? undefined,
        // 3DS (r-barion-10): a számlázási cím a validált, kizárólag magyar
        // címből (K11: a pénztár csak magyar irányítószámot fogad el), a
        // digitális kézbesítés címe a vevő e-mailje. A vészkapcsolót
        // (BARION_SEND_3DS) a start.ts kezeli.
        threeDs: {
          billingAddress: {
            country: 'HU',
            zip: billing.zip,
            city: billing.city,
            street: billing.street,
          },
          deliveryEmailAddress: buyer.email,
          purchaseDate: new Date(nowMs),
          payerAccount,
        },
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
      },
      barion.config,
    )
    if (!startResponse.GatewayUrl) {
      throw new BarionApiError({
        message: 'A Barion Start-válasz nem tartalmaz GatewayUrl-t.',
        kind: 'invalid_response',
        endpoint: 'POST /v2/Payment/Start',
      })
    }
    gatewayUrl = startResponse.GatewayUrl
    // KANONIKUS (kisbetűs, kötőjeles) alak az ÍRÁSHELYEN is: a callback-út
    // ugyanezzel az alakkal keres (route-handler normalizePaymentId), a Barion
    // viszont kötőjeles és kötőjel nélküli alakot is küld (lib/barion/guid.ts).
    const canonicalPaymentId = canonicalBarionGuid(startResponse.PaymentId)
    if (canonicalPaymentId === null) {
      throw new BarionApiError({
        message: 'A Barion Start-válasz nem tartalmaz érvényes PaymentId-t.',
        kind: 'invalid_response',
        endpoint: 'POST /v2/Payment/Start',
      })
    }
    barionPaymentId = canonicalPaymentId
    barionPaymentRequestId = startResponse.PaymentRequestId ?? orderNumber
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const minutesLeft = minutesLeftInWindow(
      typeof order.createdAt === 'string' ? order.createdAt : null,
      nowMs,
      paymentWindowToMs(),
    )
    const failure = classifyStartFailure(error)
    if (failure.kind === 'uncertain') {
      // A bizonytalan kimenet is RIASZTÁS (a-riasztas-3): tartós Barion- vagy
      // hálózati kiesésnél minden vevő ugyanezt kapja, és az order-poll
      // PaymentId híján nem látja ezeket a rendeléseket. Óránként fojtva.
      const uncertainContext = { orderId: order.id, orderNumber, error: errorMessage }
      if (
        shouldEmitThrottledAlert(
          'checkout-start-uncertain',
          CHECKOUT_START_UNCERTAIN_ALERT_COOLDOWN_MS,
          nowMs,
        )
      ) {
        log.error(
          'RIASZTÁS: a Barion fizetésindítás kimenete bizonytalan (timeout, hálózat vagy szerverhiba) — a rendelés payment_pending marad a fizetési ablak végéig',
          uncertainContext,
        )
      } else {
        log.error(
          'checkout-start: Barion fizetésindítás sikertelen, a kimenet bizonytalan — a rendelés payment_pending marad a fizetési ablak végéig (a riasztás fojtva)',
          uncertainContext,
        )
      }
      throw new CheckoutError(502, checkoutStartUncertainMessage(minutesLeft))
    }

    // A RIASZTÁS minden elutasításfajtára jár: a Start-kérést mi állítjuk
    // össze, tehát az elutasítás konfigurációs vagy integrációs hiba, ami
    // minden vevőt érint (AuthenticationFailed, ModelValidationError,
    // InvalidUser, UserCantReceiveEMoney, ShopIsClosed …). Épp ezért a
    // riasztás hibakódonként, óránként FOJTOTT (lásd
    // CHECKOUT_START_REJECTED_ALERT_COOLDOWN_MS): egy rossz POSKey mellett
    // minden vevő minden próbálkozása ugyanazt jelezné. Az ismétlés
    // warn-sorként, a rendelés adataival megmarad a naplóban.
    const rejectionContext = {
      orderId: order.id,
      orderNumber,
      httpStatus: failure.httpStatus,
      // A riasztás-levél csak lapos, kódszerű mezőt enged át (SAFE_ALERT_FIELDS):
      // ebből látja a tulajdonos a Barion hibakódját (pl. ModelValidationError).
      // Az első nem üres kód kell: az üres értéket a levél szűrője eldobná.
      barionErrorKind:
        failure.errorCodes.find((code) => code.trim() !== '') ??
        `http-${failure.httpStatus ?? 'ismeretlen'}`,
      providerErrorCodes: failure.errorCodes,
      operatorHint: failure.operatorHint,
      error: errorMessage,
    }
    const rejectionAlertKey = `checkout-start-rejected:${
      failure.errorCodes[0] ?? `http-${failure.httpStatus ?? 'ismeretlen'}`
    }`
    if (
      shouldEmitThrottledAlert(rejectionAlertKey, CHECKOUT_START_REJECTED_ALERT_COOLDOWN_MS, nowMs)
    ) {
      log.error(
        'RIASZTÁS: a Barion elutasította a fizetésindítást — fizetés nem jött létre, a rendelés payment_failed lesz',
        rejectionContext,
      )
    } else {
      log.warn(
        'checkout-start: a Barion ismét elutasította a fizetésindítást (a riasztás fojtva) — a rendelés payment_failed lesz',
        rejectionContext,
      )
    }
    let markedFailed: boolean
    try {
      markedFailed = await updateOrderStatusIfCurrent({
        payload,
        orderId: order.id,
        expected: 'payment_pending',
        next: 'payment_failed',
      })
    } catch (updateError) {
      // A sor payment_pending marad: a vevő új próbálkozását a várakoztató ág
      // fogja meg, ezért a várakozási időt kell közölni, nem az azonnali újrát.
      log.error(
        'checkout-start: a payment_failed írása sikertelen — a rendelés payment_pending marad a fizetési ablak végéig',
        {
          orderId: order.id,
          orderNumber,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        },
      )
      throw new CheckoutError(502, checkoutStartRejectedWaitMessage(minutesLeft))
    }
    if (!markedFailed) {
      log.warn(
        'checkout-start: a rendelés már nem payment_pending — a payment_failed írás kimarad',
        {
          orderId: order.id,
          orderNumber,
        },
      )
    }
    throw new CheckoutError(502, CHECKOUT_START_REJECTED)
  }

  const persistBarionIds = async (): Promise<boolean> => {
    try {
      await payload.update({
        collection: 'orders',
        id: order.id,
        data: {
          barionPaymentId,
          barionPaymentRequestId,
        },
        overrideAccess: true,
      })
      return true
    } catch (updateError) {
      log.warn('checkout-start: a Barion-azonosító mentése sikertelen', {
        orderId: order.id,
        orderNumber,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      })
      return false
    }
  }

  let persisted = await persistBarionIds()
  if (!persisted) {
    persisted = await persistBarionIds()
  }
  if (!persisted) {
    // FAIL-CLOSED (a-callback-9): a fizetési oldalt NEM adjuk ki. Ha a vevő
    // egy PaymentId nélküli rendelésre fizetne, azt csak a callback találná
    // meg; egy elveszett vagy eldobott callback után az order-poll 24 óra
    // múlva GetState nélkül lezárná a rendelést, a pénz pedig nálunk maradna.
    // GatewayUrl nélkül a Barion-fizetés kifizetetlenül lejár. A rendelést
    // megpróbáljuk payment_failed-re zárni, hogy a vevő azonnal
    // újrapróbálhasson; ha ez sem megy, a fizetési ablak végéig vár.
    let markedFailed = false
    try {
      markedFailed = await updateOrderStatusIfCurrent({
        payload,
        orderId: order.id,
        expected: 'payment_pending',
        next: 'payment_failed',
      })
    } catch (updateError) {
      log.warn('checkout-start: a payment_failed írása is sikertelen a mentési hiba után', {
        orderId: order.id,
        orderNumber,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      })
    }
    const notSavedContext = {
      orderId: order.id,
      orderNumber,
      barionPaymentId,
      markedFailed,
    }
    if (
      shouldEmitThrottledAlert(
        'checkout-start-payment-id-not-saved',
        CHECKOUT_START_UNCERTAIN_ALERT_COOLDOWN_MS,
        nowMs,
      )
    ) {
      log.error(
        'RIASZTÁS: a Barion-fizetés elindult, de az azonosítóját nem tudtuk a rendelésre menteni — a fizetési oldalt nem adtuk ki, a fizetés kifizetetlenül lejár. Ellenőrizd az adatbázis állapotát.',
        notSavedContext,
      )
    } else {
      log.error(
        'checkout-start: a Barion-azonosító mentése ismét sikertelen — a fizetési oldalt nem adtuk ki (a riasztás fojtva)',
        notSavedContext,
      )
    }
    const minutesLeft = minutesLeftInWindow(
      typeof order.createdAt === 'string' ? order.createdAt : null,
      nowMs,
      paymentWindowToMs(),
    )
    throw new CheckoutError(
      503,
      markedFailed
        ? CHECKOUT_PAYMENT_NOT_SAVED_RETRY
        : checkoutPaymentNotSavedWaitMessage(minutesLeft),
    )
  }

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
