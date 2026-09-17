import type { Payload } from 'payload'

import type { Order, Product, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { isPaymentDefinitelyNotFound } from '../barion-callback/process-callback'
import {
  BARION_DEFAULT_PAYMENT_WINDOW,
  BarionApiError,
  fetchPaymentState,
  getBarionConfig,
  mapBarionPaymentStatus,
  startPayment,
  type BarionEnvironment,
  type BarionPaymentStateResponse,
} from '../barion'
import { coursePriceHuf } from '../courses'
import { durationDaysFromProduct } from '../access-grants'
import { resolveSingleCourseAccess } from '../course-access-lookup'
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
  CHECKOUT_PAYMENT_IN_PROGRESS,
  CHECKOUT_PAYMENT_STATE_UNAVAILABLE,
  barionPayUrl,
  decidePendingCheckout,
} from './pending-payment'
import { billingSummaryMessage, validateBilling, type NormalizedBilling } from './billing'
import { isGuestBindableAccount } from '../order-status/guest-bindable-account'
import {
  CHECKOUT_ALREADY_PURCHASED_ERROR,
  CHECKOUT_GUEST_EXISTING_ACCOUNT,
  CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED,
  CHECKOUT_REFUNDED_RETRY,
} from './form-submission'
import {
  GUEST_SUMMARY_MISSING,
  guestSummaryMessage,
  validateGuest,
  type NormalizedGuest,
} from './guest'

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
 * POST /api/checkout/start. Ár csak szerveroldali snapshot; kliens-ár nem
 * forrás. Duplavásárlás-blokk + rendelés-létrehozás egy zárban; Barion Start
 * a záron kívül. `paid` csak a callback/poll állapotgépen. Vendég: guest
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

/** Termék megvásárolhatóság (státusz + pozitív ár); elutasító ágak naplózva. */
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
  // Ár-kapu: csak pozitív ár (`coursePriceHuf`); 0 Ft = hiányzó konfig, nem ingyenes út.
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

function resolveBarionEnvironment(explicit: BarionEnvironment | undefined): BarionEnvironment {
  if (explicit === 'test' || explicit === 'prod') {
    return explicit
  }
  try {
    return getBarionConfig().environment
  } catch {
    throw new CheckoutError(503, CHECKOUT_PAYMENT_STATE_UNAVAILABLE)
  }
}

interface DuplicateCheckContext {
  payload: Payload
  scope: DuplicateScope
  product: Product
  user: User | null
  paidMessage: string
  log: Logger
  nowMs: number
  fetchPaymentState: typeof fetchPaymentState
  applyBarionStateTransition: typeof applyBarionStateTransition
  resolveSingleCourseAccess: typeof resolveSingleCourseAccess
  recoverRejectedPaid: (
    input: RecoverRejectedSucceededPaymentInput,
  ) => Promise<PaidRejectRecoveryResult>
  barionEnvironment: BarionEnvironment
}

/**
 * Duplavásárlás + függő Barion-fizetés.
 *
 * Először a még nyitott payment_pending-et nézzük (Baymard: ne indíts
 * második fizetést, folytasd a meglevőt). GetPaymentState a checkout-zárban
 * fut: szándékos, a dupla Start-ot így sorosítjuk. A hívás jellemzően 1–2 mp,
 * bőven a ~60 mp-es advisory-zár alatt. GetPaymentState hiba → 503,
 * fail-closed. Succeeded → helyi paid-átmenet, új Start tilos. Failed /
 * Expired / Canceled → helyi cancelled, új Start mehet.
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
    let mappedState: 'paid' | 'cancelled' | 'payment_pending' | 'unavailable' | 'not-found' | null =
      null
    let rawState: BarionPaymentStateResponse | null = null
    if (paymentId !== null) {
      try {
        rawState = await ctx.fetchPaymentState(paymentId)
        mappedState = mapBarionPaymentStatus(rawState.Status)
      } catch (error) {
        if (error instanceof BarionApiError && isPaymentDefinitelyNotFound(error)) {
          // A Barion nem ismeri a PaymentId-t (pl. teszt-környezetben indított
          // fizetés az éles kulccsal): a függő sor sosem zárulna le, a vevő
          // erre a termékre örökre 503-at kapna. Lezárjuk, új Start mehet.
          ctx.log.warn('checkout-start: a Barion nem ismeri a függő fizetést — a sor lezárul', {
            orderId: pending.id,
            httpStatus: error.httpStatus ?? null,
          })
          mappedState = 'not-found'
        } else {
          ctx.log.warn('checkout-start: a Barion fizetésállapot nem kérdezhető le', {
            orderId: pending.id,
            error: error instanceof Error ? error.message : String(error),
          })
          mappedState = 'unavailable'
        }
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
    if (decision.kind === 'wait-no-payment-id') {
      throw new CheckoutError(409, CHECKOUT_PAYMENT_IN_PROGRESS)
    }
    if (decision.kind === 'resume') {
      const orderNumber = pending.orderNumber
      if (typeof orderNumber !== 'string' || orderNumber.length === 0) {
        throw new CheckoutError(409, CHECKOUT_PAYMENT_IN_PROGRESS)
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
        const rejectReason = transition.reason ?? 'unknown'
        const recovery = await ctx.recoverRejectedPaid({
          payload: ctx.payload,
          order: pending,
          state: rawState,
          reason: rejectReason,
          log: ctx.log,
          source: 'checkout-start',
        })
        const recoveryCtx = paidRejectRecoveryLogContext({
          source: 'checkout-start',
          action: recovery.action,
          detail: recovery.detail,
          reason: rejectReason,
          orderId: pending.id,
        })
        ctx.log.info('paid-reject recovery lefutott', recoveryCtx)
        if (recovery.action === 'failed') {
          ctx.log.error(
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
    if (decision.kind === 'cancel-and-restart') {
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
 * A checkout-start teljes folyamata. Hiba esetén CheckoutError-t dob
 * (Barion Start-hibánál a rendelés `payment_pending` marad: a Start
 * nem fut újra a fizetési ablak végéig).
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

  const fetchPaymentStateFn = options.fetchPaymentState ?? fetchPaymentState
  const applyBarionStateTransitionFn =
    options.applyBarionStateTransition ?? applyBarionStateTransition
  const onOrderPaidFn = options.onOrderPaid ?? onOrderPaid
  const resolveSingleCourseAccessFn = options.resolveSingleCourseAccess ?? resolveSingleCourseAccess
  const recoverRejectedPaidFn = options.recoverRejectedPaid ?? recoverRejectedSucceededPayment
  const nowMs = (options.now ?? new Date()).getTime()

  const lockResult = await withAdvisoryLock(
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
      const barionEnvironment = resolveBarionEnvironment(options.barionEnvironment)
      const duplicateCtx = {
        payload,
        product,
        user,
        paidMessage,
        log,
        nowMs,
        fetchPaymentState: fetchPaymentStateFn,
        applyBarionStateTransition: applyBarionStateTransitionFn,
        resolveSingleCourseAccess: resolveSingleCourseAccessFn,
        recoverRejectedPaid: recoverRejectedPaidFn,
        barionEnvironment,
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
    },
    log,
  )

  if (lockResult.kind === 'resume') {
    log.info('checkout-start: függő Barion-fizetés folytatása', {
      orderNumber: lockResult.orderNumber,
      productId,
    })
    return { orderNumber: lockResult.orderNumber, gatewayUrl: lockResult.gatewayUrl }
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
    throw new CheckoutError(
      409,
      user !== null ? CHECKOUT_ALREADY_PURCHASED : CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
    )
  }

  if (lockResult.kind !== 'created') {
    throw new CheckoutError(
      500,
      'A rendelés létrehozása most nem sikerült. Próbáld újra néhány perc múlva.',
    )
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

  /**
   * Barion Start-hibánál a rendelés payment_pending marad. A fail-closed
   * `wait-no-payment-id` ág (decidePendingCheckout) nem indít második Startot
   * a fizetési ablak végéig. payment_failed-re állítás új Startot engedne.
   */
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
    // KANONIKUS (kisbetűs) alak az ÍRÁSHELYEN is: a callback-út a kisbetűs
    // alakkal keres (route-handler normalizePaymentId) — a Barion megfigyelt
    // viselkedése kisbetűs GUID, de ez itt garancia, nem feltételezés.
    barionPaymentId = startResponse.PaymentId.toLowerCase()
    barionPaymentRequestId = startResponse.PaymentRequestId ?? orderNumber
  } catch (error) {
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
    log.error(
      'checkout-start: a Barion-azonosító mentése kimerült — a fizetés elindult, a rendelés payment_pending marad',
      { orderId: order.id, orderNumber },
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
