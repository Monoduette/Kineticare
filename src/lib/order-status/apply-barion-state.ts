import type { Payload } from 'payload'

import type { Order, User } from '../../payload-types'
import { durationDaysFromProduct } from '../access-grants'
import { withAdvisoryLock } from '../advisory-lock'
import type { BarionPaymentStateResponse, OrderPaymentState } from '../barion'
import type { CourseAccessState } from '../course-access'
import {
  resolveSingleCourseAccess as defaultResolveSingleCourseAccess,
  type CourseAccessProduct,
} from '../course-access-lookup'
import { maskEmail } from '../email/mask'
import type { Logger } from '../logger'
import { withUserPurchasesLock } from '../user-purchases-lock'
import {
  GuestBindPrivilegedAccountError,
  resolveOrderCustomer,
  type OrderCustomerResolution,
} from './resolve-order-customer'

/**
 * Barion-állapot → rendelés-állapotgép. Callback és order-poll közös magja.
 *
 * paid: fiók-feloldás → purchases → csak utána pending/created → paid.
 * Más státuszból paid TILOS. cancelled: pending → cancelled; paid-ről nem.
 * Író ágak `order-transition` zár + újraolvasás; purchases: order → email →
 * user. GetState és onOrderPaid a záron kívül. confirmOrder tilos.
 */

export interface BarionTransitionInput {
  payload: Payload
  order: Order
  /** A v4 GetState-ból leképezett rendelés-oldali állapot. */
  mapped: OrderPaymentState
  /**
   * A v4 GetState NYERS válasza — a paid-átmenet ÖSSZEG-ASSERTJÉNEK forrása.
   * Szándékosan kötelező: a leképezett státusz önmagában nem elég bizonyíték,
   * a kifizetett összeget és devizát is a rendeléshez kell mérni.
   */
  state: BarionPaymentStateResponse
  log: Logger
  /**
   * Hozzáférés-óra (K5 megújítás). Teszthez injektálható; élesben a
   * `course-access-lookup` ugyanazt a szabályt adja, mint a checkout.
   */
  resolveSingleCourseAccess?: (input: {
    payload: Payload
    userId: number
    product: CourseAccessProduct
    logger?: Logger
  }) => Promise<CourseAccessState>
}

export type BarionTransitionAction = 'paid' | 'cancelled' | 'pending' | 'rejected'

export interface BarionTransitionResult {
  action: BarionTransitionAction
  /**
   * rejected akciónál az ok (paid-cancel-rejected / cancel-not-allowed /
   * paid-not-allowed / total-mismatch / duplicate-paid-order /
   * guest-bind-privileged-account).
   */
  reason?: string
  /** true, ha a rendelés már a célállapotban volt (no-op átmenet). */
  duplicate?: boolean
  /** true KIZÁRÓLAG friss paid-átmenetnél — az onOrderPaid mellékhatás triggere. */
  transitionedToPaid?: boolean
  purchasesGranted?: number
  /**
   * A rendeléshez feloldott fiók (paid ágon). Ebből dől el a visszaigazoló
   * levél változata: jelszó-beállító link (most létrehozott / még jelszó
   * nélküli fiók) vagy belépés-hivatkozás (meglévő, működő fiók).
   */
  customer?: OrderCustomerResolution
}

/** A rendelés végösszege a szerver-oldali snapshotból (más forrás nem elfogadható). */
function orderExpectedTotal(order: Order): number | null {
  return typeof order.totalHufSnapshot === 'number' && Number.isFinite(order.totalHufSnapshot)
    ? order.totalHufSnapshot
    : null
}

/** A rendelés devizája; hiányzó érték esetén null (= assert-bukás). */
function orderExpectedCurrency(order: Order): string | null {
  return typeof order.currency === 'string' && order.currency.trim().length > 0
    ? order.currency.trim().toUpperCase()
    : null
}

export interface PaymentAmountAssertResult {
  ok: boolean
  /** Bukásnál a gépileg feldolgozható ok — a naplóba és a hívó felé is ez megy. */
  detail?:
    | 'order-total-missing'
    | 'order-currency-missing'
    | 'state-total-missing'
    | 'state-currency-missing'
    | 'total-differs'
    | 'currency-differs'
  expectedTotal?: number | null
  actualTotal?: number | null
  expectedCurrency?: string | null
  actualCurrency?: string | null
}

/** Összeg-assert: GetState Total/Currency = rendelés snapshot; hiány/eltérés → bukás. */
export function assertPaymentAmountMatches(
  order: Order,
  state: BarionPaymentStateResponse,
): PaymentAmountAssertResult {
  const expectedTotal = orderExpectedTotal(order)
  const expectedCurrency = orderExpectedCurrency(order)
  const actualTotal =
    typeof state.Total === 'number' && Number.isFinite(state.Total) ? state.Total : null
  const actualCurrency =
    typeof state.Currency === 'string' && state.Currency.trim().length > 0
      ? state.Currency.trim().toUpperCase()
      : null

  const base = { expectedTotal, actualTotal, expectedCurrency, actualCurrency }

  if (expectedTotal === null) {
    return { ok: false, detail: 'order-total-missing', ...base }
  }
  if (expectedCurrency === null) {
    return { ok: false, detail: 'order-currency-missing', ...base }
  }
  if (actualTotal === null) {
    return { ok: false, detail: 'state-total-missing', ...base }
  }
  if (actualCurrency === null) {
    return { ok: false, detail: 'state-currency-missing', ...base }
  }
  if (actualCurrency !== expectedCurrency) {
    return { ok: false, detail: 'currency-differs', ...base }
  }
  // A HUF deviza decimals: 0 (src/plugins/ecommerce.ts), tehát egész értékek —
  // a pontos egyezés a helyes és egyben a legszigorúbb szabály.
  if (actualTotal !== expectedTotal) {
    return { ok: false, detail: 'total-differs', ...base }
  }
  return { ok: true, ...base }
}

function orderProductIds(order: Order): number[] {
  const items = order.items ?? []
  const ids: number[] = []
  for (const item of items) {
    if (item.product === null || item.product === undefined) {
      continue
    }
    ids.push(typeof item.product === 'object' ? item.product.id : item.product)
  }
  return ids
}

function userPurchaseIds(user: User): number[] {
  const purchases = user.purchases ?? []
  return purchases.map((entry) => (typeof entry === 'object' ? entry.id : entry))
}

/** Dupla-fizetés ellen: van-e más paid rendelés ugyanarra a vevő+termék párra. */
export async function hasPaidOrderFor(
  payload: Payload,
  input: { customerId: number | string; productIds: number[]; excludeOrderId: number | string },
): Promise<boolean> {
  const { customerId, productIds, excludeOrderId } = input
  if (productIds.length === 0) {
    return false
  }
  const result = await payload.find({
    collection: 'orders',
    where: {
      and: [
        { customer: { equals: customerId } },
        { 'items.product': { in: productIds } },
        { status: { equals: 'paid' } },
        { id: { not_equals: excludeOrderId } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    // A where-alak a generált Where-típusnál szűkebben igazolt (a
    // start-checkout.ts duplavásárlás-ellenőrzésének mintája).
  } as unknown as Parameters<Payload['find']>[0])
  return result.totalDocs > 0
}

/**
 * K5: a második paid csak akkor BLOKK, ha a meglévő paid még AKTÍV
 * hozzáférést ad. A checkout a lejárt időkorlátos SKU-t újra eladja
 * (`resolveDuplicatePurchase` + `reason === 'expired'`); a paid-őrnek
 * ugyanazt kell engednie, különben a pénz levonva, a kurzus nem újul.
 * Korlátlan SKU, élő hozzáférés, olvashatatlan termék: továbbra is blokk
 * (egyidejű dupla terhelés).
 */
export async function shouldBlockSecondPaidOrder(input: {
  payload: Payload
  customerId: number
  productIds: number[]
  excludeOrderId: number | string
  log: Logger
  resolveSingleCourseAccess?: BarionTransitionInput['resolveSingleCourseAccess']
}): Promise<boolean> {
  const hasPaid = await hasPaidOrderFor(input.payload, {
    customerId: input.customerId,
    productIds: input.productIds,
    excludeOrderId: input.excludeOrderId,
  })
  if (!hasPaid) {
    return false
  }

  const resolveAccess = input.resolveSingleCourseAccess ?? defaultResolveSingleCourseAccess
  for (const productId of input.productIds) {
    let product: CourseAccessProduct
    try {
      const raw: unknown = await input.payload.findByID({
        collection: 'products',
        id: productId,
        depth: 0,
        overrideAccess: true,
      })
      if (raw === null || typeof raw !== 'object') {
        input.log.error(
          'RIASZTÁS: dupla-fizetés-őr — a termék nem olvasható, a második paid BLOKKOLVA',
          { productId },
        )
        return true
      }
      const days = (raw as { accessDurationDays?: number | null }).accessDurationDays
      product = { id: productId, accessDurationDays: days ?? null }
    } catch {
      input.log.error(
        'RIASZTÁS: dupla-fizetés-őr — a termék olvasása sikertelen, a második paid BLOKKOLVA',
        { productId },
      )
      return true
    }

    if (durationDaysFromProduct(product) === null) {
      return true
    }

    const access = await resolveAccess({
      payload: input.payload,
      userId: input.customerId,
      product,
      logger: input.log,
    })
    if (access.reason !== 'expired') {
      return true
    }
  }
  return false
}

/**
 * A purchases-jogosultság idempotens beírása: csak a hiányzó termékek kerülnek
 * hozzá (már meglévő → no-op). Így a dupla callback és az újrapróbálás sem
 * hozhat létre dupla jogosultságot; részleges korábbi hiba esetén pedig
 * kijavítja a hiányt.
 */
export async function grantPurchases(
  payload: Payload,
  order: Order,
  log: Logger,
): Promise<{ granted: number; alreadyOwned: number }> {
  const customerRef = order.customer
  const customerId =
    typeof customerRef === 'object' && customerRef !== null ? customerRef.id : customerRef
  if (customerId === null || customerId === undefined) {
    // Rendelés vevő nélkül nem létezhet a checkout-folyamatban — ez adatinkonzisztencia.
    throw new Error('a rendeléshez nem tartozik vevő (customer) — jogosultság nem írható be')
  }

  const productIds = orderProductIds(order)

  // User-szintű zár: két különböző rendelés paid-átmenete ugyanarra a vevőre
  // ne írja felül egymás purchases-tömbjét. A zár előtt olvasott snapshotot
  // TILOS visszaírni — a findByID a záron BELÜL fut (K1).
  return withUserPurchasesLock(
    payload,
    customerId,
    async () => {
      const user = (await payload.findByID({
        collection: 'users',
        id: customerId,
        depth: 0,
        overrideAccess: true,
      })) as User

      const owned = new Set(userPurchaseIds(user).map(String))
      const missing = productIds.filter((productId) => !owned.has(String(productId)))

      if (missing.length > 0) {
        await payload.update({
          collection: 'users',
          id: customerId,
          data: { purchases: [...userPurchaseIds(user), ...missing] },
          overrideAccess: true,
        })
        log.info('purchases-jogosultság beírva', {
          userId: customerId,
          grantedProductIds: missing,
        })
      }

      return { granted: missing.length, alreadyOwned: productIds.length - missing.length }
    },
    log,
  )
}

/** A rendelés Barion-átmenetének advisory-zár kulcsa (egy rendelés = egy zár). */
export function orderTransitionLockKey(orderId: number | string): string {
  return `order-transition:order:${orderId}`
}

/**
 * Az állapotgép-átmenet végrehajtása a rendelésen. A visszaadott action
 * dönti el a hívó az esemény-lezárást / naplózást / mellékhatásokat.
 *
 * Az írást hordozó ágak (paid/cancelled) advisory-zár alatt, a rendelés
 * FRISSEN ÚJRAOLVASOTT példányán futnak (lásd a modul fejlécét — M5).
 */
export async function applyBarionStateTransition(
  input: BarionTransitionInput,
): Promise<BarionTransitionResult> {
  const { payload, order, mapped, log } = input

  if (mapped === 'payment_pending') {
    // Nincs írás — zárfoglalás sem kell (a friss példány itt nem hordoz döntést).
    if (order.status !== 'payment_pending' && order.status !== 'created') {
      log.warn('függő fizetésjelzés nem függő rendelésre — állapot változatlan', {
        orderStatus: order.status,
      })
    }
    return { action: 'pending' }
  }

  return withAdvisoryLock(
    payload,
    orderTransitionLockKey(order.id),
    async () => {
      // FRISS ÚJRAOLVASÁS a záron BELÜL: a hívó példánya elavult lehet (a poll a
      // futás elején olvasta be; a zárra várakozás közben egy párhuzamos szál —
      // callback vagy poll — már átállíthatta). Minden döntés ebből születik.
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        depth: 0,
        overrideAccess: true,
      })) as Order
      return applyBarionStateTransitionLocked({ ...input, order: fresh })
    },
    log,
  )
}

/**
 * A tényleges átmenet-logika — KIZÁRÓLAG a zár alatt, friss rendelés-példányon
 * szabad futnia (a publikus applyBarionStateTransition gondoskodik róla).
 */
async function applyBarionStateTransitionLocked(
  input: BarionTransitionInput,
): Promise<BarionTransitionResult> {
  const { payload, order, mapped, state, log } = input

  // K6 — explicit switch + never-exhaustiveness: a paid ág NEM `else`.
  // Az `OrderPaymentState` ma három értékű, de a `payment_failed` már
  // dokumentált (src/lib/barion/state.ts). Egy negyedik uniótag `else`-be
  // esve hamisan paid-nek jelölné a sikertelen fizetést.
  switch (mapped) {
    case 'payment_pending':
      // A publikus wrapper zár nélkül tér vissza; ide csak védelemként jut.
      if (order.status !== 'payment_pending' && order.status !== 'created') {
        log.warn('függő fizetésjelzés nem függő rendelésre — állapot változatlan', {
          orderStatus: order.status,
        })
      }
      return { action: 'pending' }

    case 'cancelled': {
      if (order.status === 'payment_pending') {
        await payload.update({
          collection: 'orders',
          id: order.id,
          data: { status: 'cancelled' },
          overrideAccess: true,
        })
        log.info('rendelés lemondva (Barion-státusz alapján)')
        return { action: 'cancelled' }
      }
      if (order.status === 'cancelled') {
        log.info('a rendelés már lemondott — duplikátum no-op')
        return { action: 'cancelled', duplicate: true }
      }
      if (order.status === 'paid') {
        // ÁLLAPOTGÉP-VÉDELEM: paid rendelést SOSEM állítunk vissza cancelledre.
        log.error(
          'RIASZTÁS: paid rendelésre cancelled Barion-jelzés érkezett — visszaállítás TILOS, állapot marad paid',
        )
        return { action: 'rejected', reason: 'paid-cancel-rejected' }
      }
      log.warn('cancelled jelzés nem lemondható kiinduló státuszból — állapot marad', {
        orderStatus: order.status,
      })
      return { action: 'rejected', reason: 'cancel-not-allowed' }
    }

    case 'paid': {
      if (
        order.status === 'cancelled' ||
        order.status === 'refunded' ||
        order.status === 'payment_failed'
      ) {
        log.error(
          'RIASZTÁS: paid jelzés nem engedélyezett kiinduló státuszból — állapot változatlan, manuális ellenőrzés szükséges',
          { orderStatus: order.status },
        )
        return { action: 'rejected', reason: 'paid-not-allowed' }
      }

      // ÖSSZEG-ASSERT: a paid-átmenet (és a már paid rendelésen a jogosultság-
      // ellenőrzés) KIZÁRÓLAG akkor futhat, ha a Barion által visszaadott
      // Total/Currency egyezik a rendelés szerver-oldali snapshotjával.
      const amountCheck = assertPaymentAmountMatches(order, state)
      if (!amountCheck.ok) {
        log.error(
          'RIASZTÁS: a Barion-fizetés összege/devizája NEM egyezik a rendelés snapshotjával — paid-átmenet elutasítva, manuális ellenőrzés szükséges',
          {
            detail: amountCheck.detail,
            expectedTotal: amountCheck.expectedTotal ?? null,
            actualTotal: amountCheck.actualTotal ?? null,
            expectedCurrency: amountCheck.expectedCurrency ?? null,
            actualCurrency: amountCheck.actualCurrency ?? null,
            barionStatus: state.Status,
            orderStatus: order.status,
          },
        )
        return { action: 'rejected', reason: 'total-mismatch' }
      }

      /**
       * FIÓK-FELOLDÁS — a hozzáférés-beírás előfeltétele. Vendég-vásárlásnál a
       * rendelés `customer` nélkül jött létre: itt dől el (az e-mail alapján,
       * idempotensen), melyik fiók kapja a kurzust, és a rendelés is ekkor
       * kötődik hozzá. Bejelentkezett vásárlásnál ez csak a fiók beolvasása.
       *
       * A SORREND szándékos: az ÖSSZEG-ASSERT UTÁN fut, tehát fedezet nélküli vagy
       * hamis fizetésre fiók sem jön létre. A K5 dupla-fizetés-őr viszont már a
       * feloldott fiókkal dolgozik — vendég-rendelésre is érvényes marad.
       */
      let customer: OrderCustomerResolution
      try {
        customer = await resolveOrderCustomer({ payload, order, log })
      } catch (error) {
        // Staff/owner e-mail: a kötés tilos, de generic Error örök retryt
        // okozna (pénz már levonva). Terminális reject — closeEvent rejected.
        if (error instanceof GuestBindPrivilegedAccountError) {
          log.error(
            'RIASZTÁS: vendég-fizetés staff/owner fiók e-mailjére érkezett — kötés elutasítva, manuális ellenőrzés szükséges',
            { cimzett: maskEmail(error.email), role: error.role },
          )
          return { action: 'rejected', reason: 'guest-bind-privileged-account' }
        }
        throw error
      }
      // A helyi példány elavult (a customer mezőt épp most írtuk ki), a
      // jogosultság-beírás viszont ebből olvassa a vevőt.
      const orderWithCustomer: Order = { ...order, customer: customer.userId }

      const alreadyPaid = order.status === 'paid'
      if (!alreadyPaid) {
        // K5 DUPLA-FIZETÉS BLOKK: más paid ugyanarra a vevő+termékre csak
        // akkor tilt, ha az még AKTÍV hozzáférést ad. Lejárt időkorlátos
        // SKU-nál a checkout újravásárlást enged — a paid-őrnek is. A MÁR
        // paid rendelés no-op ága szándékosan NEM érintett. A vevő a
        // FELOLDOTT fiók (vendég-úton is). A BLOKK HELYE KÖTÖTT: minden
        // írás ELŐTT.
        const customerId = customer.userId
        if (
          await shouldBlockSecondPaidOrder({
            payload,
            customerId,
            productIds: orderProductIds(order),
            excludeOrderId: order.id,
            log,
            resolveSingleCourseAccess: input.resolveSingleCourseAccess,
          })
        ) {
          log.error(
            'RIASZTÁS: a vevő+termék párhoz már létezik MÁS paid rendelés — a második paid-átmenet BLOKKOLVA, manuális ellenőrzés/visszatérítés szükséges',
            { customerId, orderStatus: order.status },
          )
          return { action: 'rejected', reason: 'duplicate-paid-order' }
        }
      }

      /** Paid írási sorrend: purchases ELŐBB, `status: paid` UTÁNA — különben megszakadásnál elmarad az e-mail. */
      const grant = await grantPurchases(payload, orderWithCustomer, log)

      if (alreadyPaid) {
        log.info('a rendelés már paid — átmenet no-op, jogosultság-ellenőrzés fut')
      } else {
        if (order.status === 'created') {
          log.warn('created státuszú rendelés ugrik paid-re (payment_pending átugorva)')
        }
        await payload.update({
          collection: 'orders',
          id: order.id,
          data: { status: 'paid' },
          overrideAccess: true,
        })
        log.info('rendelés paid-re állítva (Barion v4 verifikációval)')
      }

      return {
        action: 'paid',
        duplicate: alreadyPaid,
        transitionedToPaid: !alreadyPaid,
        purchasesGranted: grant.granted,
        customer,
      }
    }

    default: {
      const _exhaustive: never = mapped
      throw new Error(
        `ismeretlen Barion-leképezett állapot — paid-átmenet TILOS (${String(_exhaustive)})`,
      )
    }
  }
}
