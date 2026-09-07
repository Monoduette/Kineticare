import type { Payload } from 'payload'

import type { Order, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { withUserPurchasesLock } from '../user-purchases-lock'
import {
  BarionApiError,
  fetchPaymentState,
  refundPayment,
  type BarionPaymentStateResponse,
} from '../barion'
import { logger, type Logger } from '../logger'
import { pickRefundableTransaction } from '../order-status/recover-paid-reject'
import type {
  issueCorrectiveInvoiceForOrder,
  issueStornoForOrder,
  IssueCorrectiveInvoiceDeps,
  IssueStornoForOrderDeps,
} from '../szamlazz'
import { createRefundIntent, loadActiveRefundIntent, transitionRefundIntent } from './intent-store'
import { prepareRefundReceipt, RECEIPTS, writeReceipt } from './recovery-receipts'
import {
  getRefundRecoveryStatus,
  recoverRefundOrder,
  validatedRefundHistory,
} from './refund-recovery'
import { digestRefundIdempotencyKey } from './refund-intent'

/**
 * Owner-only rendelés-visszatérítés. Check-then-act → advisory-zár
 * (`order:mutate:<id>` — ugyanaz, mint a paid-átmenet), záron belül
 * újraolvasott rendelés. GetState és számla a záron kívül; a záron belül
 * csak a Payment/Refund (timeout < 60s idle-in-transaction).
 *
 * Csak paid téríthető. TransactionId a v4 GetState-ből jön (az orders nem
 * tárolja). Bizonytalan/elutasított eredmény: blokkoló intent, nincs order-írás.
 * Teljes refund: stornó, purchases le;
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
  /** Stable caller operation identity; never regenerated for an uncertain response. */
  operationKey?: unknown
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
   * issueStornoForOrder. Hibája nem fordítja vissza a pénzügyi eredményt,
   * de a feldolgozás csak tartós bizonylatbizonyítékkal lesz teljes.
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
   * A korábbi válaszformátum megmarad. Az új folyamat csak igazolt siker és
   * befejezett feldolgozás után ad sikeres választ; bizonytalanságnál a tartós
   * intent blokkol, a HTTP-válasz kézi ellenőrzést kér.
   */
  refundStatusOutcome: 'succeeded' | 'unknown'
}

/** Paid-átmenet és refund közös rendelés-zára (`order:mutate:<id>`). */
export function refundLockKey(orderId: number | string): string {
  return `order:mutate:${orderId}`
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
  // már tarthatja a `order:mutate:<id>` zárat). A findByID a záron BELÜL
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
  if (totalHuf === null || !Number.isSafeInteger(totalHuf) || totalHuf <= 0) {
    orderLog.error('refund: a paid rendeléshez nem tartozik érvényes végösszeg', {
      totalHufSnapshot: order.totalHufSnapshot ?? null,
      amount: order.amount ?? null,
    })
    throw new RefundError(
      409,
      'A rendeléshez nem tartozik érvényes végösszeg, így a visszatérítés nem végezhető el.',
    )
  }

  const entries = validatedRefundHistory(order)
  const alreadyRefunded = entries.reduce((sum, entry) => sum + entry.amountHuf, 0)
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
  expectedTransactionId?: string,
): Promise<{ transactionId: string; posTransactionId: string }> {
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
  const matching = Array.isArray(state.Transactions)
    ? state.Transactions.filter(
        (item) => item.TransactionId === (expectedTransactionId ?? refundable?.transactionId),
      )
    : []
  const original = matching.length === 1 ? matching[0] : null
  if (
    state.PaymentId !== barionPaymentId ||
    refundable === null ||
    !original ||
    typeof original.POSTransactionId !== 'string' ||
    !original.POSTransactionId.trim()
  ) {
    orderLog.error('refund: a fizetésállapot nem tartalmaz visszatéríthető tranzakciót', {
      barionStatus: state.Status,
    })
    throw new RefundError(
      502,
      'A Barion oldalán most nincs visszatéríthető tranzakció ehhez a rendeléshez. Ellenőrizd a fizetést a Barionban, és ha ott rendben van, próbáld újra néhány perc múlva.',
    )
  }
  return { transactionId: original.TransactionId, posTransactionId: original.POSTransactionId }
}

const RECOVERY_REQUIRED =
  'A visszatérítés eredménye vagy helyi feldolgozása ellenőrzést igényel. Ne indíts új pénzvisszatérítést. A feldolgozás folytatása kizárólag a helyreállítási művelettel történhet.'

/** Every new provider submission requires a durable claim; recovery never enters this function. */
export async function refundOrder(options: RefundOrderOptions): Promise<RefundOrderResult> {
  const { payload, orderNumber } = options
  const operationKey = options.input.operationKey
  try {
    digestRefundIdempotencyKey(operationKey as string)
  } catch {
    throw new RefundError(
      400,
      'A visszatérítéshez műveletazonosító szükséges. Frissítsd a rendelés nézetét.',
    )
  }
  const log = options.logger ?? logger
  const preOrder = await findOrderByNumber(payload, orderNumber)
  if (!preOrder) throw new RefundError(404, 'A megadott rendelés nem található.')
  if (await loadActiveRefundIntent(payload, preOrder.id))
    throw new RefundError(503, RECOVERY_REQUIRED)
  const preDecision = decideRefund(preOrder, options.input, log)
  if ((await getRefundRecoveryStatus({ payload, orderNumber })).state !== 'clear')
    throw new RefundError(503, RECOVERY_REQUIRED)
  const resolved = await resolveBarionTransactionId(
    preDecision.barionPaymentId,
    log,
    preDecision.storedTransactionId,
  )
  const outcome = await withAdvisoryLock(
    payload,
    refundLockKey(preOrder.id),
    async () => {
      const order = await findOrderByNumber(payload, orderNumber)
      if (!order) throw new RefundError(404, 'A megadott rendelés nem található.')
      if (await loadActiveRefundIntent(payload, order.id))
        throw new RefundError(503, RECOVERY_REQUIRED)
      const decision = decideRefund(order, options.input, log)
      if ((await getRefundRecoveryStatus({ payload, orderNumber })).state !== 'clear')
        throw new RefundError(503, RECOVERY_REQUIRED)
      const transactionId = decision.storedTransactionId ?? resolved.transactionId
      if (
        transactionId !== resolved.transactionId ||
        decision.barionPaymentId !== preDecision.barionPaymentId
      )
        throw new RefundError(503, RECOVERY_REQUIRED)
      let intent = await createRefundIntent(
        payload,
        {
          schemaVersion: 1,
          actorId: String(options.actor.id),
          orderId: String(order.id),
          provider: 'barion',
          providerPaymentId: decision.barionPaymentId,
          providerTransactionId: transactionId,
          refundSequence: decision.entries.length + 1,
          requestedAmountHuf: decision.amountHuf,
          currency: 'HUF',
          reason: decision.reason,
        },
        operationKey as string,
      )
      // An unacknowledged baseline leaves prepared active and MUST NOT launch a provider request.
      await prepareRefundReceipt(payload, intent, order)
      intent = await transitionRefundIntent(payload, intent, 'provider_started')
      let response
      try {
        response = await refundPayment({
          paymentId: intent.providerPaymentId,
          transactionsToRefund: [
            {
              transactionId,
              posTransactionId: resolved.posTransactionId,
              amountToRefund: intent.requestedAmountHuf,
            },
          ],
        })
      } catch {
        try {
          await transitionRefundIntent(payload, intent, 'provider_unknown')
        } catch {
          // The durable provider_started claim still blocks a new payment when the CAS is unacknowledged.
        }
        throw new RefundError(503, RECOVERY_REQUIRED)
      }
      const transaction =
        Array.isArray(response?.RefundedTransactions) && response.RefundedTransactions.length === 1
          ? response.RefundedTransactions[0]
          : null
      const correlated =
        response?.PaymentId === intent.providerPaymentId &&
        (response.Errors === undefined ||
          (Array.isArray(response.Errors) && response.Errors.length === 0)) &&
        transaction?.TransactionId === transactionId &&
        transaction.Total === intent.requestedAmountHuf &&
        (transaction.AmountToRefund === undefined ||
          transaction.AmountToRefund === intent.requestedAmountHuf) &&
        Number.isSafeInteger(transaction.Total)
      if (!correlated || classifyRefundedTransactionStatus(transaction?.Status) !== 'succeeded') {
        await transitionRefundIntent(payload, intent, 'provider_unknown')
        throw new RefundError(503, RECOVERY_REQUIRED)
      }
      const status = transaction!.Status
      // Minimal correlated evidence, never the raw provider body. Lost acknowledgement remains blocking.
      await writeReceipt(payload, intent, RECEIPTS.provider, {
        version: 1,
        paymentId: intent.providerPaymentId,
        transactionId,
        amountHuf: intent.requestedAmountHuf,
        sequence: intent.refundSequence,
        status,
        totalHuf: decision.totalHuf,
        alreadyRefundedHuf: decision.alreadyRefunded,
        type: decision.type,
      })
      await transitionRefundIntent(payload, intent, 'provider_succeeded')
      return { decision, transactionId, status }
    },
    log,
  )
  const recovered = await recoverRefundOrder(options)
  if (recovered.recoveryStatus !== 'completed') throw new RefundError(503, RECOVERY_REQUIRED)
  const { decision, transactionId, status } = outcome
  return {
    orderNumber,
    type: decision.type,
    amountHuf: decision.amountHuf,
    transactionId,
    refundedTransactionStatus: status,
    alreadyRefundedHuf: decision.alreadyRefunded,
    totalRefundedHuf: decision.alreadyRefunded + decision.amountHuf,
    orderStatus: decision.type === 'full' ? 'refunded' : 'paid',
    refundStatusOutcome: 'succeeded',
  }
}
