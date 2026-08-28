import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { BarionApiError, refundPayment, type BarionPaymentStateResponse } from '../barion'
import type { Logger } from '../logger'
import {
  classifyRefundedTransactionStatus,
  readRefundEntries,
  refundLockKey,
  type OrderRefundEntry,
} from '../refund/refund-order'

/**
 * R-02 — automatikus Barion-visszatérítés, ha a GetState Succeeded, de a
 * paid-átmenet terminálisan elutasított. A pénz levonva, a kurzus nem
 * adható: duplicate-paid (élő SKU), staff/owner-kötés, összeg-eltérés.
 *
 * Nem a paid-only `refundOrder`: az owner-út stornót és purchases-levételt
 * vár. Itt a rendelés sosem lett paid, számla nincs, jogosultság nincs.
 * confirmOrder tilos. Tesztből élő Barion-hívás tilos (injektált refund).
 *
 * RF-1: a Payment/Refund HTTP az advisory lock + in-process mutex mögött
 * fut (mint `refundOrder`), friss olvasással. Tesztben a drizzle nincs
 * injektálva, a mutex nélkül két párhuzamos hívás mindkettő refundolna.
 * A persist NEM nyit második zárat (ugyanazon a kulcson deadlock).
 * RF-2: a Barion `PartiallyRefunded` NEM teljes refund — helyi `type:
 * 'partial'`, a rendelés NEM `refunded`, RIASZTÁS, teljes összegű
 * auto-retry tilos.
 */

export const AUTO_REFUND_REJECT_REASONS = [
  'duplicate-paid-order',
  'guest-bind-privileged-account',
  'total-mismatch',
] as const

export type AutoRefundRejectReason = (typeof AUTO_REFUND_REJECT_REASONS)[number]

export type PaidRejectRecoveryAction = 'refunded' | 'skipped' | 'failed'

export type RecoverPaidRejectSource = 'callback' | 'order-poll' | 'checkout-start'

export interface PaidRejectRecoveryResult {
  action: PaidRejectRecoveryAction
  detail?: string
}

export interface RecoverRejectedSucceededPaymentInput {
  payload: Payload
  order: Order
  /** A v4 GetState, amiből a paid-reject született (Succeeded). */
  state: BarionPaymentStateResponse
  reason: string
  log: Logger
  /** Melyik hívó indította: callback, poll vagy checkout. Kötelező a nyomhoz. */
  source: RecoverPaidRejectSource
  /** Injektálható (teszteléshez); alapból a valódi refundPayment. */
  refundPayment?: typeof refundPayment
}

export function isAutoRefundRejectReason(
  reason: string | undefined,
): reason is AutoRefundRejectReason {
  return (
    reason === 'duplicate-paid-order' ||
    reason === 'guest-bind-privileged-account' ||
    reason === 'total-mismatch'
  )
}

export function hungarianAutoRefundReason(reason: AutoRefundRejectReason): string {
  switch (reason) {
    case 'duplicate-paid-order':
      return 'Automatikus visszatérítés: a kurzushoz már van élő hozzáférés.'
    case 'guest-bind-privileged-account':
      return 'Automatikus visszatérítés: a fizetés staff vagy owner fiók e-mailjére érkezett, kötés tilos.'
    case 'total-mismatch':
      return 'Automatikus visszatérítés: a Barion összege nem egyezik a rendeléssel.'
  }
}

/** Egységes naplómezők: callback, poll és checkout ugyanazt írja. */
export function paidRejectRecoveryLogContext(input: {
  source: RecoverPaidRejectSource
  action: PaidRejectRecoveryAction
  detail?: string
  reason: string
  orderId: number
}): Record<string, unknown> {
  return {
    source: input.source,
    action: input.action,
    detail: input.detail ?? null,
    reason: input.reason,
    orderId: input.orderId,
  }
}

export interface RefundableBarionTransaction {
  transactionId: string
  amountHuf: number
  /** Csak a Barion `Refunded` — a `PartiallyRefunded` NEM teljes (RF-2). */
  alreadyRefunded: boolean
  alreadyPartiallyRefunded: boolean
}

/**
 * Visszatéríthető kártyás tranzakció a GetState Transactions tömbjéből.
 * Az orders nem tárol TransactionId-t (ugyanaz a szabály, mint a refundOrder).
 */
export function pickRefundableTransaction(
  state: BarionPaymentStateResponse,
): RefundableBarionTransaction | null {
  const transactions = state.Transactions ?? []
  const refundable =
    transactions.find((tx) => tx.TransactionType === 'CardPayment' && tx.Status === 'Succeeded') ??
    transactions.find((tx) => tx.TransactionType === 'CardPayment') ??
    transactions.find((tx) => tx.Status === 'Succeeded') ??
    transactions[0]
  if (
    !refundable ||
    typeof refundable.TransactionId !== 'string' ||
    refundable.TransactionId.length === 0
  ) {
    return null
  }
  const amountFromTx =
    typeof refundable.Total === 'number' &&
    Number.isFinite(refundable.Total) &&
    refundable.Total > 0
      ? refundable.Total
      : null
  const amountFromState =
    typeof state.Total === 'number' && Number.isFinite(state.Total) && state.Total > 0
      ? state.Total
      : null
  const amountHuf = amountFromTx ?? amountFromState
  if (amountHuf === null) {
    return null
  }
  const status = typeof refundable.Status === 'string' ? refundable.Status : ''
  return {
    transactionId: refundable.TransactionId,
    amountHuf,
    alreadyRefunded: status === 'Refunded',
    alreadyPartiallyRefunded: status === 'PartiallyRefunded',
  }
}

function hasRecordedFullRefund(order: Order, transactionId: string): boolean {
  return readRefundEntries(order).some(
    (entry) =>
      entry.transactionId === transactionId &&
      entry.type !== 'partial' &&
      classifyRefundedTransactionStatus(entry.status) !== 'failed',
  )
}

function hasRecordedPartialRefund(order: Order, transactionId: string): boolean {
  return readRefundEntries(order).some(
    (entry) => entry.transactionId === transactionId && entry.type === 'partial',
  )
}

/** Folyamat-szintű lánc: tesztben is serializál, ahol a drizzle-zár no-op. */
const inProcessRefundChains = new Map<number, Promise<unknown>>()

async function withSerializedOrderRefund<T>(orderId: number, fn: () => Promise<T>): Promise<T> {
  const previous = inProcessRefundChains.get(orderId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  inProcessRefundChains.set(orderId, chained)
  try {
    await previous.catch(() => undefined)
    return await fn()
  } finally {
    release()
    if (inProcessRefundChains.get(orderId) === chained) {
      inProcessRefundChains.delete(orderId)
    }
  }
}

async function persistAutoRefund(input: {
  payload: Payload
  orderId: number
  transactionId: string
  amountHuf: number
  barionStatus: string
  reason: AutoRefundRejectReason
  type: 'full' | 'partial'
  log: Logger
  source: RecoverPaidRejectSource
}): Promise<void> {
  const { payload, orderId, transactionId, amountHuf, barionStatus, reason, type, log, source } =
    input
  const fresh = (await payload.findByID({
    collection: 'orders',
    id: orderId,
    depth: 0,
    overrideAccess: true,
  })) as Order
  if (type === 'full' && hasRecordedFullRefund(fresh, transactionId)) {
    if (fresh.status !== 'refunded') {
      await payload.update({
        collection: 'orders',
        id: fresh.id,
        data: {
          status: 'refunded',
          refundedAt: fresh.refundedAt ?? new Date().toISOString(),
        },
        overrideAccess: true,
      })
    }
    return
  }
  if (type === 'partial' && hasRecordedPartialRefund(fresh, transactionId)) {
    return
  }

  const nowIso = new Date().toISOString()
  const entry: OrderRefundEntry = {
    transactionId,
    amountHuf,
    status: barionStatus,
    refundedAt: nowIso,
    type,
    reason: hungarianAutoRefundReason(reason),
  }
  const refunds = [...readRefundEntries(fresh), entry]
  const data: Record<string, unknown> =
    type === 'full'
      ? {
          status: 'refunded',
          refundedAt: nowIso,
          refundReason: hungarianAutoRefundReason(reason),
          refunds,
        }
      : { refunds }
  await payload.update({
    collection: 'orders',
    id: fresh.id,
    data: data as never,
    overrideAccess: true,
  })
  log.info('paid-reject recovery: automatikus Barion-visszatérítés rögzítve', {
    source,
    reason,
    amountHuf,
    transactionId,
    barionTransactionStatus: barionStatus,
    refundType: type,
  })
}

/**
 * Terminális paid-reject után Barion Payment/Refund a záron belül.
 * Üres Transactions / ismeretlen ok / már refundolt nyom: skip, nincs HTTP.
 */
export async function recoverRejectedSucceededPayment(
  input: RecoverRejectedSucceededPaymentInput,
): Promise<PaidRejectRecoveryResult> {
  const { payload, state, log, source } = input
  const orderId = input.order.id

  if (!isAutoRefundRejectReason(input.reason)) {
    log.info(
      'paid-reject recovery: kihagyva (nem auto-refund ok)',
      paidRejectRecoveryLogContext({
        source,
        action: 'skipped',
        detail: 'reason-not-refundable',
        reason: input.reason,
        orderId,
      }),
    )
    return { action: 'skipped', detail: 'reason-not-refundable' }
  }
  const reason = input.reason

  return withSerializedOrderRefund(orderId, () =>
    withAdvisoryLock(
      payload,
      refundLockKey(orderId),
      async () => {
        const order = (await payload.findByID({
          collection: 'orders',
          id: orderId,
          depth: 0,
          overrideAccess: true,
        })) as Order

        if (order.status === 'refunded') {
          return { action: 'skipped' as const, detail: 'already-refunded' }
        }
        if (typeof order.barionPaymentId !== 'string' || order.barionPaymentId.length === 0) {
          log.error(
            'RIASZTÁS: paid-reject recovery: nincs Barion PaymentId, automatikus visszatérítés nem indítható',
            { source, reason, orderId },
          )
          return { action: 'failed' as const, detail: 'missing-payment-id' }
        }

        const refundable = pickRefundableTransaction(state)
        if (refundable === null) {
          log.error(
            'RIASZTÁS: paid-reject recovery: a GetState nem tartalmaz visszatéríthető tranzakciót — emberi ellenőrzés a Barionban',
            { source, reason, orderId, orderStatus: order.status },
          )
          return { action: 'skipped' as const, detail: 'no-refundable-transaction' }
        }

        if (hasRecordedFullRefund(order, refundable.transactionId)) {
          return { action: 'skipped' as const, detail: 'already-recorded' }
        }

        if (
          refundable.alreadyPartiallyRefunded ||
          hasRecordedPartialRefund(order, refundable.transactionId)
        ) {
          if (!hasRecordedPartialRefund(order, refundable.transactionId)) {
            await persistAutoRefund({
              payload,
              orderId,
              transactionId: refundable.transactionId,
              amountHuf: refundable.amountHuf,
              barionStatus: 'PartiallyRefunded',
              reason,
              type: 'partial',
              log,
              source,
            })
          }
          log.error(
            'RIASZTÁS: paid-reject recovery: Barion részleges refund — teljes auto-refund tilos, emberi ellenőrzés kell',
            {
              source,
              reason,
              orderId,
              transactionId: refundable.transactionId,
              barionStatus: state.Status,
            },
          )
          return { action: 'skipped' as const, detail: 'barion-partially-refunded' }
        }

        if (refundable.alreadyRefunded) {
          await persistAutoRefund({
            payload,
            orderId,
            transactionId: refundable.transactionId,
            amountHuf: refundable.amountHuf,
            barionStatus: 'Refunded',
            reason,
            type: 'full',
            log,
            source,
          })
          return { action: 'refunded' as const, detail: 'already-refunded-at-barion' }
        }

        const runRefund = input.refundPayment ?? refundPayment
        let barionStatus = 'Unknown'
        try {
          const response = await runRefund({
            paymentId: order.barionPaymentId,
            transactionsToRefund: [
              { transactionId: refundable.transactionId, amountToRefund: refundable.amountHuf },
            ],
          })
          const rawStatus = response.RefundedTransactions?.[0]?.Status
          const outcome = classifyRefundedTransactionStatus(rawStatus)
          if (outcome === 'failed') {
            log.error(
              'RIASZTÁS: paid-reject recovery: a Barion tranzakciószintű státusza RefundFailed — a pénz NEM tért vissza, emberi ellenőrzés kell',
              {
                source,
                reason,
                orderId,
                transactionId: refundable.transactionId,
                amountHuf: refundable.amountHuf,
              },
            )
            return { action: 'failed' as const, detail: 'barion-refund-failed' }
          }
          if (rawStatus === 'PartiallyRefunded') {
            await persistAutoRefund({
              payload,
              orderId,
              transactionId: refundable.transactionId,
              amountHuf: refundable.amountHuf,
              barionStatus: 'PartiallyRefunded',
              reason,
              type: 'partial',
              log,
              source,
            })
            log.error(
              'RIASZTÁS: paid-reject recovery: a Barion csak részlegesen térített — teljes összegű újrapróba tilos',
              { source, reason, orderId, transactionId: refundable.transactionId },
            )
            return { action: 'skipped' as const, detail: 'barion-partially-refunded' }
          }
          barionStatus = rawStatus ?? 'Unknown'
          if (outcome === 'unknown') {
            await persistAutoRefund({
              payload,
              orderId,
              transactionId: refundable.transactionId,
              amountHuf: refundable.amountHuf,
              barionStatus,
              reason,
              type: 'full',
              log,
              source,
            })
            log.error(
              'RIASZTÁS: paid-reject recovery: a Barion nem adott értelmezhető refund-státuszt — a nyomot rögzítjük, hogy ne legyen dupla kifizetés; ellenőrizd a Barion felületén',
              {
                source,
                reason,
                orderId,
                transactionId: refundable.transactionId,
                barionTransactionStatus: rawStatus ?? null,
              },
            )
            return {
              action: 'failed' as const,
              detail: `unexpected-barion-status:${rawStatus ?? 'empty'}`,
            }
          }
        } catch (error) {
          log.error(
            'RIASZTÁS: paid-reject recovery: a Barion visszatérítés sikertelen — a rendelés nem paid, a pénz még kint lehet',
            {
              source,
              reason,
              orderId,
              kind: error instanceof BarionApiError ? error.kind : 'unknown',
              httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
              error: error instanceof Error ? error.message : String(error),
            },
          )
          return { action: 'failed' as const, detail: 'barion-refund-error' }
        }

        await persistAutoRefund({
          payload,
          orderId,
          transactionId: refundable.transactionId,
          amountHuf: refundable.amountHuf,
          barionStatus,
          reason,
          type: 'full',
          log,
          source,
        })
        return { action: 'refunded' as const }
      },
      log,
    ),
  )
}
