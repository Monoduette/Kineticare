import type { Payload } from 'payload'

import type { Order, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { withUserPurchasesLock } from '../user-purchases-lock'
import { auditLogStore, writeAuditLog } from '../audit'
import {
  BarionApiError,
  fetchPaymentState,
  refundPayment,
  type BarionPaymentStateResponse,
} from '../barion'
import { logger, type Logger } from '../logger'
import { pickRefundableTransaction } from '../order-status/recover-paid-reject'
import {
  isRetryableCorrectiveError,
  isRetryableStornoError,
  issueCorrectiveInvoiceForOrder,
  issueStornoForOrder,
  queueCorrectiveInvoiceJob,
  type IssueCorrectiveInvoiceDeps,
  type IssueStornoForOrderDeps,
} from '../szamlazz'

/**
 * Owner-only rendelés-visszatérítés. Check-then-act → advisory-zár
 * (`refund:order:<id>`), záron belül újraolvasott rendelés. GetState és
 * számla a záron kívül; a záron belül csak a Payment/Refund (timeout < 60s
 * idle-in-transaction).
 *
 * Csak paid téríthető. TransactionId a v4 GetState-ből jön (az orders nem
 * tárolja). RefundFailed → semmi írás. Teljes refund: stornó, purchases le;
 * részrefund és záró rész: helyesbítő. Stornó automatikus retry TILOS.
 */

/** Üzleti hiba HTTP-státusszal — a route-handler ezt képezi válaszra. */
export class RefundError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RefundError'
    this.status = status
  }
}

/** Egy refund-bejegyzés a rendelés refunds-nyomában (orders.refunds json). */
export interface OrderRefundEntry {
  /** A Barion TransactionId, amelyen a visszatérítés történt (későbbi részrefundok ezt újrahasználják). */
  transactionId: string
  /** A visszatérített összeg HUF-ban. */
  amountHuf: number
  /** A Barion RefundedTransactions tranzakció-státusza (pl. Refunded / PartiallyRefunded). */
  status: string
  refundedAt: string
  type: 'full' | 'partial'
  reason?: string | null
}

export interface RefundOrderInput {
  /** Opcionális részösszeg HUF-ban; hiányában a maradék teljes összeg térül vissza. */
  amountHuf?: unknown
  /** Opcionális, szöveges refund-indok (teljes refundnál a refundReason-be is bekerül). */
  reason?: unknown
}

export interface RefundOrderOptions {
  payload: Payload
  orderNumber: string
  input: RefundOrderInput
  /** A műveletet végző owner (audit actor). */
  actor: User
  headers?: Headers
  ipAddress?: string
  logger?: Logger
  /**
   * Injektálható stornó-hívó (teszteléshez); alapból a valódi
   * issueStornoForOrder. A stornó best-effort: a kimenetele a refund
   * eredményét SOHA nem befolyásolja.
   */
  issueStorno?: (
    order: Order,
    deps: IssueStornoForOrderDeps,
  ) => ReturnType<typeof issueStornoForOrder>
  /**
   * Injektálható helyesbítő-hívó (teszteléshez); alapból a valódi
   * issueCorrectiveInvoiceForOrder. Szintén best-effort.
   */
  issueCorrective?: (
    order: Order,
    deps: IssueCorrectiveInvoiceDeps,
  ) => ReturnType<typeof issueCorrectiveInvoiceForOrder>
}

export interface RefundOrderResult {
  orderNumber: string
  type: 'full' | 'partial'
  amountHuf: number
  transactionId: string
  refundedTransactionStatus: string
  alreadyRefundedHuf: number
  totalRefundedHuf: number
  orderStatus: 'refunded' | 'paid'
  /**
   * A Barion tranzakció-státuszának besorolása (M-11). `'succeeded'`: a
   * visszatérítés igazoltan megtörtént, a bizonylat automatikusan elindult.
   * `'unknown'`: a Barion nem adott értelmezhető tranzakció-státuszt — a
   * refund-nyom rögzült (a maradvány így nem téríthető vissza másodszor), de
   * bizonylat NEM készült, emberi ellenőrzés szükséges. A `'failed'` eset nem
   * jelenik meg itt: az hibaágon (RefundError) végződik.
   */
  refundStatusOutcome: 'succeeded' | 'unknown'
}

/** A rendelés refund-műveletének advisory-zár kulcsa (egy rendelés = egy zár). */
export function refundLockKey(orderId: number | string): string {
  return `refund:order:${orderId}`
}

/**
 * A Barion tranzakciószintű refund-státuszának besorolása (M-11).
 *
 * A Payment/Refund v2 válasza HTTP 200 és üres Errors mellett is jelezhet
 * TRANZAKCIÓ-SZINTŰ kudarcot a RefundedTransactions[].Status mezőben — ez
 * korábban csak eltárolódott, és a folyamat sikerként ment tovább (nyilvántartás
 * + stornó/helyesbítő számla indult egy meg nem történt visszatérítésre).
 */
export type RefundedTransactionOutcome = 'succeeded' | 'failed' | 'unknown'

/** Igazoltan megtörtént visszatérítést jelentő tranzakció-státuszok. */
const SUCCESSFUL_REFUND_STATUSES: ReadonlySet<string> = new Set([
  'Succeeded',
  'Refunded',
  'PartiallyRefunded',
])

/** Explicit, tranzakciószintű kudarc. */
const FAILED_REFUND_STATUS = 'RefundFailed'

export function classifyRefundedTransactionStatus(
  status: string | null | undefined,
): RefundedTransactionOutcome {
  if (typeof status !== 'string' || status.trim().length === 0) {
    return 'unknown'
  }
  if (status === FAILED_REFUND_STATUS) {
    return 'failed'
  }
  return SUCCESSFUL_REFUND_STATUSES.has(status) ? 'succeeded' : 'unknown'
}

/** A rendelés refunds-nyomának kiolvasása (típustalan json mező → validált bejegyzések). */
export function readRefundEntries(order: Order): OrderRefundEntry[] {
  const raw = (order as { refunds?: unknown }).refunds
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (entry): entry is OrderRefundEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { transactionId?: unknown }).transactionId === 'string' &&
      typeof (entry as { amountHuf?: unknown }).amountHuf === 'number',
  )
}

/** A már visszatérített összeg a refunds-nyomból. */
export function alreadyRefundedHuf(order: Order): number {
  return readRefundEntries(order).reduce((sum, entry) => sum + entry.amountHuf, 0)
}

function orderProductIds(order: Order): number[] {
  const ids: number[] = []
  for (const item of order.items ?? []) {
    if (item.product === null || item.product === undefined) {
      continue
    }
    ids.push(typeof item.product === 'object' ? item.product.id : item.product)
  }
  return ids
}

function userPurchaseIds(user: User): number[] {
  return (user.purchases ?? []).map((entry) => (typeof entry === 'object' ? entry.id : entry))
}

/**
 * A purchases-jogosultság IDEMPOTENS levétele teljes refundnál.
 *
 * - Csak a ténylegesen eltávolítható termékeknél fut update: ami már nincs a
 *   felhasználó purchases-listájában, az no-op (dupla refund / részleges
 *   korábbi állapot esetén sem keletkezik felesleges írás).
 * - Védelem: ha a vevőnek UGYANAZRA a termékre van MÁS paid rendelése, az a
 *   jogosultság megmarad — a levétel kizárólag a visszatérített rendeléshez
 *   köthető hozzáférést szünteti meg.
 */
export async function revokePurchases(
  payload: Payload,
  order: Order,
  log: Logger,
): Promise<{ revoked: number }> {
  const customerRef = order.customer
  const customerId =
    typeof customerRef === 'object' && customerRef !== null ? customerRef.id : customerRef
  if (customerId === null || customerId === undefined) {
    log.warn('refund: a rendeléshez nem tartozik vevő — purchases-levétel kihagyva', {
      orderId: order.id,
    })
    return { revoked: 0 }
  }

  const productIds = orderProductIds(order)
  if (productIds.length === 0) {
    return { revoked: 0 }
  }

  // User-szintű zár a purchases RMW körül (order → user sorrend: a hívó
  // már tarthatja a `refund:order:<id>` zárat). A findByID a záron BELÜL
  // fut — a zár előtt olvasott snapshotot TILOS visszaírni (K1).
  return withUserPurchasesLock(
    payload,
    customerId,
    async () => {
      // Más paid rendelés ugyanerre a termékre → a hozzáférés megmarad.
      const protectedIds = new Set<number>()
      for (const productId of productIds) {
        const otherPaid = await payload.find({
          collection: 'orders',
          where: {
            and: [
              { customer: { equals: customerId } },
              { status: { equals: 'paid' } },
              { 'items.product': { equals: productId } },
              { id: { not_equals: order.id } },
            ],
          },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        } as unknown as Parameters<Payload['find']>[0])
        if (otherPaid.totalDocs > 0) {
          protectedIds.add(productId)
        }
      }

      const user = (await payload.findByID({
        collection: 'users',
        id: customerId,
        depth: 0,
        overrideAccess: true,
      })) as User

      const removable = new Set(productIds.filter((id) => !protectedIds.has(id)).map(String))
      const current = userPurchaseIds(user)
      const remaining = current.filter((id) => !removable.has(String(id)))

      if (remaining.length === current.length) {
        // Nincs eltávolítható jogosultság — idempotens no-op.
        return { revoked: 0 }
      }

      await payload.update({
        collection: 'users',
        id: customerId,
        data: { purchases: remaining },
        overrideAccess: true,
      })
      const revoked = current.length - remaining.length
      log.info('refund: purchases-jogosultság levéve', {
        userId: customerId,
        revokedCount: revoked,
        keptForOtherPaidOrders: [...protectedIds],
      })
      return { revoked }
    },
    log,
  )
}

/**
 * STORNÓ teljes visszatérítéshez — best-effort (C4).
 *
 * A kiállítás állapota a rendelésre kerül (stornoStatus/stornoNumber/…), így a
 * kimaradt bizonylat lekérdezhető. Ha az inline POST már elindult, és
 * újrapróbálható hibába (timeout/hálózat) fut, a storno-issue job NEM kerül
 * sorba: a job a F3 bizonytalan-állapot ágon soha nem POSTolna újra, viszont
 * a vak újrapróbálás dupla stornót okozhatna. Ilyenkor error-szintű RIASZTÁS
 * kéri az emberi ellenőrzést a Számlázz.hu-fiókban. A kimenetel a refund
 * HTTP-válaszát SOSEM befolyásolja.
 */
async function issueStornoBestEffort(params: {
  options: RefundOrderOptions
  order: Order
  log: Logger
  reason: string | null
}): Promise<void> {
  const { options, order, log, reason } = params
  try {
    const issueStorno = options.issueStorno ?? issueStornoForOrder
    const result = await issueStorno(order, {
      payload: options.payload,
      logger: log,
      ...(reason ? { reason } : {}),
    })
    if (result.outcome === 'failed') {
      log.warn(
        'refund: a stornó-számla kiállítása sikertelen — a refund ettől függetlenül sikeres (emberi pótlás szükséges)',
        { reason: result.reason ?? null },
      )
    } else {
      log.info('refund: stornó-számla feldolgozva', {
        outcome: result.outcome,
        stornoNumber: result.stornoNumber ?? null,
      })
    }
  } catch (error) {
    const retryable = isRetryableStornoError(error)
    if (retryable) {
      // Az inline POST már elindult (issueStornoForOrder a pending-írás
      // UTÁN dob retryable-t). A storno-issue job ilyenkor F3-on
      // (previousAttempts > 0, nincs stornoNumber) RIASZTÁS-sal megáll,
      // és SOHA nem POSTolna újra — a sorbaállítás tehát csapda volna.
      // Automatikus újrapróbálás TILOS (dupla stornó kockázata).
      log.error(
        'RIASZTÁS: a stornó-számla kiállítására már történt egy POST, az állapot bizonytalan — automatikus újrapróbálás TILOS (dupla stornó kockázata). A tulajdonosnak a Számlázz.hu-fiókban kell ellenőriznie, hogy készült-e stornó.',
        { retryable, error: error instanceof Error ? error.message : String(error) },
      )
    } else {
      log.error(
        'refund: a stornó-számla kiállítása hibával állt le (best-effort) — a refund eredménye ettől változatlan',
        { retryable, error: error instanceof Error ? error.message : String(error) },
      )
    }
  }
}

/**
 * HELYESBÍTŐ (módosító) számla részleges visszatérítéshez — best-effort (C5).
 *
 * A refundSeq a refunds-nyom 1-alapú sorszáma: ez köti a bizonylatot a
 * konkrét visszatérítéshez (idempotencia-kulcs), és ezzel áll sorba a
 * corrective-invoice-issue job is újrapróbálható hiba esetén.
 */
async function issueCorrectiveBestEffort(params: {
  options: RefundOrderOptions
  order: Order
  log: Logger
  reason: string | null
  refundSeq: number
  amountHuf: number
}): Promise<void> {
  const { options, order, log, reason, refundSeq, amountHuf } = params
  try {
    const issueCorrective = options.issueCorrective ?? issueCorrectiveInvoiceForOrder
    const result = await issueCorrective(order, {
      payload: options.payload,
      logger: log,
      refundSeq,
      amountHuf,
      ...(reason ? { reason } : {}),
    })
    if (result.outcome === 'failed') {
      log.warn(
        'refund: a helyesbítő számla kiállítása sikertelen — a részleges refund ettől függetlenül sikeres (emberi pótlás szükséges)',
        { reason: result.reason ?? null },
      )
    } else {
      log.info('refund: helyesbítő számla feldolgozva', {
        outcome: result.outcome,
        correctiveInvoiceNumber: result.correctiveInvoiceNumber ?? null,
        refundSeq,
      })
    }
  } catch (error) {
    const retryable = isRetryableCorrectiveError(error)
    log.error(
      'refund: a helyesbítő számla kiállítása hibával állt le (best-effort) — a refund eredménye ettől változatlan',
      { retryable, refundSeq, error: error instanceof Error ? error.message : String(error) },
    )
    if (retryable) {
      await queueCorrectiveInvoiceJob(options.payload, order.id, refundSeq, log)
    }
  }
}

/** Rendelés-keresés orderNumber alapján (a zár előtt és a záron belül is ez fut). */
async function findOrderByNumber(
  payload: Payload,
  orderNumber: string,
): Promise<Order | undefined> {
  const found = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  return found.docs[0] as Order | undefined
}

/** Egy konkrét rendelés-példányból levezetett refund-döntés. */
interface RefundDecision {
  totalHuf: number
  alreadyRefunded: number
  remainingHuf: number
  amountHuf: number
  type: 'full' | 'partial'
  reason: string | null
  /** A rendelés meglévő refund-nyoma (az új bejegyzés ehhez fűződik). */
  entries: OrderRefundEntry[]
  /** A korábbi refundból ismert Barion TransactionId (ha van). */
  storedTransactionId?: string
  /** A rendelés Barion fizetésazonosítója (validálva, tehát biztosan van). */
  barionPaymentId: string
}

/**
 * Állapotgép- és összeg-validáció EGY rendelés-példányon, hibánál RefundError-ral.
 *
 * Szándékosan tiszta (a naplózáson kívül mellékhatás-mentes) függvény: ugyanez
 * fut a záron KÍVÜL (gyors 4xx visszajelzés fölösleges zárfoglalás nélkül) és a
 * záron BELÜL, a FRISSEN újraolvasott rendelésen — a végleges döntést mindig az
 * utóbbi hozza, tehát egy közben lefutott párhuzamos refund maradvány-hatása
 * biztosan beszámítódik.
 */
function decideRefund(order: Order, input: RefundOrderInput, orderLog: Logger): RefundDecision {
  // Állapotgép-validáció: dupla refund → 409; nem paid → 409.
  if (order.status === 'refunded') {
    throw new RefundError(
      409,
      'Ez a rendelés már korábban teljes egészében visszatérítésre került.',
    )
  }
  if (order.status !== 'paid') {
    throw new RefundError(
      409,
      'Csak fizetett (paid) státuszú rendelés téríthető vissza. A rendelés jelenlegi státusza nem teszi ezt lehetővé.',
    )
  }

  // Összeg-feloldás és validáció.
  const totalHuf =
    typeof order.totalHufSnapshot === 'number'
      ? order.totalHufSnapshot
      : typeof order.amount === 'number'
        ? order.amount
        : null
  if (totalHuf === null || totalHuf <= 0) {
    orderLog.error('refund: a paid rendeléshez nem tartozik érvényes végösszeg', {
      totalHufSnapshot: order.totalHufSnapshot ?? null,
      amount: order.amount ?? null,
    })
    throw new RefundError(
      409,
      'A rendeléshez nem tartozik érvényes végösszeg, így a visszatérítés nem végezhető el.',
    )
  }

  const entries = readRefundEntries(order)
  const alreadyRefunded = alreadyRefundedHuf(order)
  const remainingHuf = totalHuf - alreadyRefunded
  if (remainingHuf <= 0) {
    // Védelmi ág: a nyom szerint minden visszatérült, pedig a státusz nem refunded.
    orderLog.error('refund: a refund-nyom szerint a rendelés már teljesen visszatérült', {
      totalHuf,
      alreadyRefunded,
    })
    throw new RefundError(409, 'Ez a rendelés már teljes egészében visszatérítésre került.')
  }

  const reason =
    typeof input.reason === 'string' && input.reason.trim().length > 0 ? input.reason.trim() : null

  let amountHuf = remainingHuf
  if (input.amountHuf !== undefined && input.amountHuf !== null) {
    const raw = typeof input.amountHuf === 'number' ? input.amountHuf : Number(input.amountHuf)
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new RefundError(
        400,
        'A visszatérítendő összeg (amountHuf) pozitív egész szám kell legyen.',
      )
    }
    if (raw > remainingHuf) {
      throw new RefundError(
        400,
        `A visszatérítendő összeg nem haladhatja meg a még visszatéríthető összeget (${remainingHuf} Ft).`,
      )
    }
    amountHuf = raw
  }

  if (!order.barionPaymentId) {
    orderLog.error('refund: a paid rendeléshez nem tartozik Barion PaymentId')
    throw new RefundError(
      409,
      'A rendeléshez nem tartozik Barion fizetésazonosító, így a visszatérítés nem végezhető el.',
    )
  }

  return {
    totalHuf,
    alreadyRefunded,
    remainingHuf,
    amountHuf,
    type: alreadyRefunded + amountHuf >= totalHuf ? 'full' : 'partial',
    reason,
    entries,
    ...(entries[0]?.transactionId ? { storedTransactionId: entries[0].transactionId } : {}),
    barionPaymentId: order.barionPaymentId,
  }
}

/**
 * TransactionId-feloldás a Barion v4 GetState-ből — REPÓ-TÉNY: az orderön nincs
 * tárolt Barion TransactionId (a T-021/T-022 csak barionPaymentId-t/
 * barionPaymentRequestId-t ment), ezért az első refund előtt újra le kell kérdezni.
 *
 * A hívás SZÁNDÉKOSAN a refund-záron KÍVÜL fut: tiszta olvasás, mellékhatás
 * nélkül, tehát nem kell sorosítani — és így a lassabbik HTTP-hívás nem tartja
 * nyitva a zár tranzakcióját (lásd a modul zár-tartomány szakaszát).
 */
async function resolveBarionTransactionId(
  barionPaymentId: string,
  orderLog: Logger,
): Promise<string> {
  let state: BarionPaymentStateResponse
  try {
    state = await fetchPaymentState(barionPaymentId)
  } catch (error) {
    orderLog.error('refund: a fizetésállapot újralekérdezése sikertelen (Barion GetState)', {
      kind: error instanceof BarionApiError ? error.kind : 'unknown',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  const refundable = pickRefundableTransaction(state)
  if (refundable === null) {
    orderLog.error('refund: a fizetésállapot nem tartalmaz visszatéríthető tranzakciót', {
      barionStatus: state.Status,
    })
    throw new RefundError(
      502,
      'A Barion oldalán most nincs visszatéríthető tranzakció ehhez a rendeléshez. Ellenőrizd a fizetést a Barionban, és ha ott rendben van, próbáld újra néhány perc múlva.',
    )
  }
  return refundable.transactionId
}

/** A refund-zár alatt született, a záron kívüli lépésekhez továbbadott eredmény. */
interface LockedRefundOutcome {
  /** A záron BELÜL frissen olvasott rendelés — az audit és a bizonylat is ezt használja. */
  order: Order
  decision: RefundDecision
  transactionId: string
  refundedTransactionStatus: string
  statusOutcome: 'succeeded' | 'unknown'
  refunds: OrderRefundEntry[]
  before: {
    status: Order['status']
    refunds: OrderRefundEntry[]
    refundReason: string | null
    refundedAt: string | null
  }
}

/**
 * A teljes refund-folyamat. Barion-hiba esetén a rendelés érintetlen marad —
 * a BarionApiError változatlanul propagálódik (a route-handler képezi válaszra).
 */
export async function refundOrder(options: RefundOrderOptions): Promise<RefundOrderResult> {
  const { payload, orderNumber } = options
  const log = options.logger ?? logger

  // 1. Rendelés-keresés — ismeretlen orderNumber → 404.
  const preOrder = await findOrderByNumber(payload, orderNumber)
  if (!preOrder) {
    throw new RefundError(404, 'A megadott rendelés nem található.')
  }
  const orderLog = log.child({ orderId: preOrder.id, orderNumber: preOrder.orderNumber })

  // 2–3. Elő-validáció a záron KÍVÜL: a nyilvánvalóan érvénytelen kérés (404/409/400)
  // így zárfoglalás nélkül, azonnal elbukik. A DÖNTŐ validáció a záron belül,
  // a frissen olvasott rendelésen ismétlődik meg.
  const preDecision = decideRefund(preOrder, options.input, orderLog)

  // 4. TransactionId elő-feloldás — GetState a záron KÍVÜL (tiszta olvasás).
  const preResolvedTransactionId =
    preDecision.storedTransactionId ??
    (await resolveBarionTransactionId(preDecision.barionPaymentId, orderLog))

  // 5. PÉNZMOZGATÓ SZAKASZ ADVISORY-ZÁR ALATT: friss olvasás → újra-validálás →
  // Barion-refund → a refunds-nyom írása. A záron belül minden döntés a FRISS
  // példányból születik, így két párhuzamos kérés nem térít vissza kétszer, és a
  // refunds-tömb írása sem veszíthet el bejegyzést.
  const outcome = await withAdvisoryLock<LockedRefundOutcome>(
    payload,
    refundLockKey(preOrder.id),
    async () => {
      // 5a. FRISS olvasás — a zár megszerzése közben egy párhuzamos refund már
      // módosíthatta a rendelést.
      const order = await findOrderByNumber(payload, orderNumber)
      if (!order) {
        throw new RefundError(404, 'A megadott rendelés nem található.')
      }
      const decision = decideRefund(order, options.input, orderLog)
      const { amountHuf, type, reason, entries } = decision

      // 5b. A tárolt TransactionId elsőbbsége: ha közben egy párhuzamos refund
      // beírta a sajátját, azt használjuk a záron kívül feloldott helyett.
      const transactionId = decision.storedTransactionId ?? preResolvedTransactionId

      // 5c. Barion-refund — ez az egyetlen pénzmozgató hívás. Hiba esetén (a
      // BarionApiError itt kibillen) a rendelésen SEMMI nem változik: a DB-írás
      // kizárólag a siker UTÁN következik.
      let refundResponse
      try {
        refundResponse = await refundPayment({
          paymentId: decision.barionPaymentId,
          transactionsToRefund: [{ transactionId, amountToRefund: amountHuf }],
        })
      } catch (error) {
        orderLog.error('refund: a Barion visszatérítés sikertelen — a rendelés változatlan', {
          kind: error instanceof BarionApiError ? error.kind : 'unknown',
          httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
          providerErrorCodes:
            error instanceof BarionApiError ? error.providerErrors.map((e) => e.ErrorCode) : [],
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }

      // 5d. M-11 — a TRANZAKCIÓ-SZINTŰ státusz kiértékelése.
      //
      // A Payment/Refund v2 HTTP 200-at és üres Errors tömböt ad akkor is, ha a
      // tranzakció maga nem térült vissza (RefundFailed). Korábban ez az érték
      // csak eltárolódott, és a folyamat sikerként futott tovább: refund-bejegyzés
      // keletkezett, a rendelés refundedre váltott, és stornó/helyesbítő számla
      // indult egy MEG NEM TÖRTÉNT visszatérítésre.
      const refundedTransaction = refundResponse.RefundedTransactions?.[0]
      const rawStatus = refundedTransaction?.Status
      const statusOutcome = classifyRefundedTransactionStatus(rawStatus)

      if (statusOutcome === 'failed') {
        // HIBAÁG: semmilyen írás. Szándékosan NEM írunk „sikertelen" refund-
        // bejegyzést sem: az alreadyRefundedHuf MINDEN bejegyzés összegét
        // beszámítja, tehát egy kudarc-bejegyzés hamisan csökkentené a még
        // visszatéríthető maradványt. A nyom így a strukturált napló.
        orderLog.error(
          'refund: a Barion tranzakciószintű státusza RefundFailed — a visszatérítés NEM történt meg, a rendelés változatlan, bizonylat nem készült',
          {
            transactionId,
            amountHuf,
            barionTransactionStatus: rawStatus ?? null,
          },
        )
        throw new RefundError(
          502,
          'A Barion elutasította a visszatérítést (a tranzakció státusza: RefundFailed). A rendelés nem változott, és bizonylat sem készült — ellenőrizd a Barion felületén, majd próbáld újra.',
        )
      }

      const refundedTransactionStatus = rawStatus ?? 'Unknown'
      if (statusOutcome === 'unknown') {
        // KONZERVATÍV, DOKUMENTÁLT KEZELÉS ismeretlen/hiányzó státuszra.
        // A Barion nem mondta ki, hogy a refund meghiúsult (azt a RefundFailed
        // jelentené), de azt sem, hogy sikerült. A két kockázat nem egyforma:
        //  - ha rögzítjük és mégsem történt meg → hiányzó visszatérítés, amit a
        //    napló-riasztás alapján ember pótol;
        //  - ha NEM rögzítjük és mégis megtörtént → a maradvány újra
        //    visszatéríthetőnek látszik, azaz DUPLA PÉNZKIFIZETÉS.
        // A pénzügyileg visszafordíthatatlan hibát kerüljük: a bejegyzés
        // rögzül (a nyom pontos marad), de bizonylat automatikusan NEM készül,
        // és error-szintű riasztás kéri az emberi ellenőrzést.
        orderLog.error(
          'RIASZTÁS: a Barion nem adott értelmezhető tranzakció-státuszt a visszatérítésre — a refund-nyom rögzült, de bizonylat NEM készült; emberi ellenőrzés szükséges a Barion felületén',
          {
            transactionId,
            amountHuf,
            barionTransactionStatus: rawStatus ?? null,
          },
        )
      }

      // 5e. A refunds-nyom írása a FRISS bejegyzésekre fűzve.
      const nowIso = new Date().toISOString()
      const newEntry: OrderRefundEntry = {
        transactionId,
        amountHuf,
        status: refundedTransactionStatus,
        refundedAt: nowIso,
        type,
        ...(reason ? { reason } : {}),
      }
      const refunds = [...entries, newEntry]

      // Részrefund-döntés (kommentezett): részösszeges visszatérítésnél a
      // rendelés státusza paid MARAD, és a vevő hozzáférése (purchases) is
      // MEGMARAD — a részrefund tipikusan kártérítés/kedvezmény, nem a vásárlás
      // felbontása; a digitális tartalomhoz való hozzáférés megszüntetése csak a
      // teljes refundhoz (a pénzügyi tranzakció teljes visszafordításához) kötődik.
      // A refunds-nyom mindkét esetben pontos pénzügyi auditot ad.
      const before = {
        status: order.status,
        refunds: entries,
        refundReason: order.refundReason ?? null,
        refundedAt: order.refundedAt ?? null,
      }

      if (type === 'full') {
        await payload.update({
          collection: 'orders',
          id: order.id,
          data: {
            status: 'refunded',
            refundedAt: nowIso,
            ...(reason ? { refundReason: reason } : {}),
            refunds,
          } as unknown as Record<string, unknown>,
          overrideAccess: true,
        })
        // A pénzügyi nyom már rögzült; a külön users-írás hibája nem görgeti vissza.
        // Csak a cleanup hibáját képezzük át, az order-írásét nem.
        try {
          await revokePurchases(payload, order, orderLog)
        } catch (error) {
          orderLog.error(
            'refund: a pénzügyi nyom rögzült, de a hozzáférések rendezése elakadt; kézi ellenőrzés szükséges',
            {
              phase: 'purchase-revocation',
              financialRecordPersisted: true,
              refundStatusOutcome: statusOutcome,
              errorKind: error instanceof Error ? 'error' : 'non-error',
            },
          )
          const recorded =
            statusOutcome === 'succeeded'
              ? 'A visszatérítés már rögzítve van'
              : 'A visszatérítési kísérlet már rögzítve van, de a Barion nem igazolta a sikerét'
          throw new RefundError(
            503,
            `${recorded}. A hozzáférések rendezésének eredménye nem igazolt. Ne indíts új pénzvisszatérítést. Kézi ellenőrzés és rendezés szükséges.`,
          )
        }
      } else {
        await payload.update({
          collection: 'orders',
          id: order.id,
          data: { refunds } as unknown as Record<string, unknown>,
          overrideAccess: true,
        })
      }

      return {
        order,
        decision,
        transactionId,
        refundedTransactionStatus,
        statusOutcome,
        refunds,
        before,
      }
    },
    orderLog,
  )

  const {
    order,
    decision,
    transactionId,
    refundedTransactionStatus,
    statusOutcome,
    refunds,
    before,
  } = outcome
  const { amountHuf, type, reason, alreadyRefunded } = decision
  const totalRefundedHuf = alreadyRefunded + amountHuf

  // 6. Audit-bejegyzés (az audit-logs collection létezik — best-effort).
  await writeAuditLog({
    store: auditLogStore(payload),
    actor: options.actor.id,
    action: type === 'full' ? 'order-refund' : 'order-partial-refund',
    entityType: 'orders',
    entityId: order.id,
    before,
    after: {
      status: type === 'full' ? 'refunded' : 'paid',
      refunds,
      amountHuf,
      transactionId,
      refundedTransactionStatus,
    },
    req: options.headers ? { headers: options.headers } : undefined,
    ipAddress: options.ipAddress,
  })

  orderLog.info('refund: visszatérítés rögzítve', {
    type,
    amountHuf,
    totalRefundedHuf,
    transactionId,
    refundedTransactionStatus,
  })

  // Bizonylat best-effort, záron kívül. Csak igazolt refundhoz.
  // Első teljes → stornó; rész / záró rész → helyesbítő (stornó duplán írna).
  // Stornó automatikus retry tilos. A bizonylat hibája a refundot nem billenti.
  if (statusOutcome !== 'succeeded') {
    orderLog.warn(
      'refund: a bizonylat automatikus kiállítása kimaradt, mert a Barion nem igazolta vissza a tranzakció sikerét — emberi pótlás szükséges',
      { refundedTransactionStatus, type, amountHuf },
    )
  } else if (type === 'full' && alreadyRefunded === 0) {
    await issueStornoBestEffort({ options, order, log: orderLog, reason })
  } else {
    await issueCorrectiveBestEffort({
      options,
      order,
      log: orderLog,
      reason,
      refundSeq: refunds.length,
      amountHuf,
    })
  }

  return {
    orderNumber: order.orderNumber ?? orderNumber,
    type,
    amountHuf,
    transactionId,
    refundedTransactionStatus,
    alreadyRefundedHuf: alreadyRefunded,
    totalRefundedHuf,
    orderStatus: type === 'full' ? 'refunded' : 'paid',
    refundStatusOutcome: statusOutcome,
  }
}
