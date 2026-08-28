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
 */

export const AUTO_REFUND_REJECT_REASONS = [
  'duplicate-paid-order',
  'guest-bind-privileged-account',
  'total-mismatch',
] as const

export type AutoRefundRejectReason = (typeof AUTO_REFUND_REJECT_REASONS)[number]

export type PaidRejectRecoveryAction = 'refunded' | 'skipped' | 'failed'

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

export interface RefundableBarionTransaction {
  transactionId: string
  amountHuf: number
  alreadyRefunded: boolean
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
    alreadyRefunded: status === 'Refunded' || status === 'PartiallyRefunded',
  }
}

function hasRecordedSuccessfulRefund(order: Order, transactionId: string): boolean {
  return readRefundEntries(order).some(
    (entry) =>
      entry.transactionId === transactionId &&
      classifyRefundedTransactionStatus(entry.status) === 'succeeded',
  )
}

async function persistAutoRefund(input: {
  payload: Payload
  order: Order
  transactionId: string
  amountHuf: number
  barionStatus: string
  reason: AutoRefundRejectReason
  log: Logger
}): Promise<void> {
  const { payload, order, transactionId, amountHuf, barionStatus, reason, log } = input
  await withAdvisoryLock(
    payload,
    refundLockKey(order.id),
    async () => {
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        depth: 0,
        overrideAccess: true,
      })) as Order
      if (fresh.status === 'refunded' && hasRecordedSuccessfulRefund(fresh, transactionId)) {
        return
      }
      if (hasRecordedSuccessfulRefund(fresh, transactionId)) {
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

      const nowIso = new Date().toISOString()
      const entry: OrderRefundEntry = {
        transactionId,
        amountHuf,
        status: barionStatus,
        refundedAt: nowIso,
        type: 'full',
        reason: hungarianAutoRefundReason(reason),
      }
      const refunds = [...readRefundEntries(fresh), entry]
      await payload.update({
        collection: 'orders',
        id: fresh.id,
        data: {
          status: 'refunded',
          refundedAt: nowIso,
          refundReason: hungarianAutoRefundReason(reason),
          refunds,
        } as unknown as Record<string, unknown>,
        overrideAccess: true,
      })
      log.info('paid-reject recovery: automatikus Barion-visszatérítés rögzítve', {
        reason,
        amountHuf,
        transactionId,
        barionTransactionStatus: barionStatus,
      })
    },
    log,
  )
}

/**
 * Terminális paid-reject után best-effort Barion Payment/Refund.
 * Üres Transactions / ismeretlen ok / már refundolt nyom: skip, nincs HTTP.
 */
export async function recoverRejectedSucceededPayment(
  input: RecoverRejectedSucceededPaymentInput,
): Promise<PaidRejectRecoveryResult> {
  const { payload, order, state, log } = input
  if (!isAutoRefundRejectReason(input.reason)) {
    return { action: 'skipped', detail: 'reason-not-refundable' }
  }
  const reason = input.reason
  if (order.status === 'refunded') {
    return { action: 'skipped', detail: 'already-refunded' }
  }
  if (typeof order.barionPaymentId !== 'string' || order.barionPaymentId.length === 0) {
    log.error(
      'RIASZTÁS: paid-reject recovery: nincs Barion PaymentId, automatikus visszatérítés nem indítható',
      { reason },
    )
    return { action: 'failed', detail: 'missing-payment-id' }
  }

  const refundable = pickRefundableTransaction(state)
  if (refundable === null) {
    log.error(
      'RIASZTÁS: paid-reject recovery: a GetState nem tartalmaz visszatéríthető tranzakciót — emberi ellenőrzés a Barionban',
      { reason, orderStatus: order.status },
    )
    return { action: 'skipped', detail: 'no-refundable-transaction' }
  }

  if (hasRecordedSuccessfulRefund(order, refundable.transactionId)) {
    return { action: 'skipped', detail: 'already-recorded' }
  }

  if (refundable.alreadyRefunded) {
    await persistAutoRefund({
      payload,
      order,
      transactionId: refundable.transactionId,
      amountHuf: refundable.amountHuf,
      barionStatus: 'Refunded',
      reason,
      log,
    })
    return { action: 'refunded', detail: 'already-refunded-at-barion' }
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
        { reason, transactionId: refundable.transactionId, amountHuf: refundable.amountHuf },
      )
      return { action: 'failed', detail: 'barion-refund-failed' }
    }
    barionStatus = rawStatus ?? 'Unknown'
    if (outcome === 'unknown') {
      log.error(
        'RIASZTÁS: paid-reject recovery: a Barion nem adott értelmezhető refund-státuszt — a nyomot rögzítjük, hogy ne legyen dupla kifizetés; ellenőrizd a Barion felületén',
        {
          reason,
          transactionId: refundable.transactionId,
          barionTransactionStatus: rawStatus ?? null,
        },
      )
    }
  } catch (error) {
    log.error(
      'RIASZTÁS: paid-reject recovery: a Barion visszatérítés sikertelen — a rendelés nem paid, a pénz még kint lehet',
      {
        reason,
        kind: error instanceof BarionApiError ? error.kind : 'unknown',
        httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
        error: error instanceof Error ? error.message : String(error),
      },
    )
    return { action: 'failed', detail: 'barion-refund-error' }
  }

  await persistAutoRefund({
    payload,
    order,
    transactionId: refundable.transactionId,
    amountHuf: refundable.amountHuf,
    barionStatus,
    reason,
    log,
  })
  return { action: 'refunded' }
}
