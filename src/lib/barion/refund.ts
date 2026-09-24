import { barionPost, getBarionConfig, type BarionClientConfig } from './client'
import { canonicalizeBarionGuid } from './guid'
import type { BarionRefundRequest, BarionRefundResponse, BarionTransactionToRefund } from './types'

/**
 * Payment/Refund v2 — tranzakció-szintű (részösszeges is lehet) visszatérítés.
 *
 * Szabályok:
 * - Csak Succeeded állapotú fizetés téríthető vissza (Barion-szabály).
 * - A TransactionsToRefund elemenként tartalmazza a v4-es állapotlekérdezésből
 *   ismert TransactionId-t és a visszatérítendő (rész)összeget — a lib az
 *   összeget nem számolja, szerver-oldalon validált értéket vár.
 * - A válasz RefundedTransactions tömbje tranzakciónként adja vissza a
 *   tényleges státuszt (Status mező) — ezt a hívó a rendelésen rögzítheti.
 */

export interface RefundTransactionInput {
  /** A v4-es fizetésállapot-válasz Transactions tömbjéből származó Barion TransactionId. */
  transactionId: string
  /** Az eredeti fizetési tranzakció kereskedői azonosítója; nem új refund-azonosító. */
  posTransactionId: string
  /** Visszatérítendő összeg HUF-ban; lehet a tranzakció teljes összege vagy annál kisebb. */
  amountToRefund: number
  /**
   * Opcionális megjegyzés, amelyet a Barion az eredeti fizetőnek megmutat
   * (docs.barion.com/TransactionToRefund: „A comment associated with the refund.
   * This is shown to the original payer.”). Üres szöveg nem kerül a kérésbe.
   */
  comment?: string
}

/** A TransactionToRefund hivatalos, opcionális Comment mezőjével kiegészítve. */
export type TransactionToRefundWire = BarionTransactionToRefund & { Comment?: string }

/** A Refund-kérés törzse a POSKey nélkül (azt a kliens injektálja). */
export type RefundRequestBody = Omit<BarionRefundRequest, 'POSKey' | 'TransactionsToRefund'> & {
  TransactionsToRefund: TransactionToRefundWire[]
}

export interface RefundPaymentParams {
  paymentId: string
  transactionsToRefund: RefundTransactionInput[]
}

/** A Refund-kérés body-építése külön, tisztán tesztelhető függvényben. */
export function buildRefundRequest(params: RefundPaymentParams): RefundRequestBody {
  if (params.transactionsToRefund.length === 0) {
    throw new Error('Barion Payment/Refund: legalább egy visszatérítendő tranzakció kötelező.')
  }
  for (const transaction of params.transactionsToRefund) {
    if (typeof transaction.posTransactionId !== 'string' || !transaction.posTransactionId.trim()) {
      throw new Error('Barion Payment/Refund: nem üres posTransactionId kötelező.')
    }
    if (!(transaction.amountToRefund > 0)) {
      throw new Error(
        `Barion Payment/Refund: az amountToRefund pozitív kell legyen (TransactionId: ${transaction.transactionId}).`,
      )
    }
  }

  const transactionsToRefund: TransactionToRefundWire[] = params.transactionsToRefund.map(
    (transaction) => ({
      TransactionId: transaction.transactionId,
      POSTransactionId: transaction.posTransactionId,
      AmountToRefund: transaction.amountToRefund,
      ...(typeof transaction.comment === 'string' && transaction.comment.trim()
        ? { Comment: transaction.comment.trim() }
        : {}),
    }),
  )

  return {
    PaymentId: params.paymentId,
    TransactionsToRefund: transactionsToRefund,
  }
}

/**
 * Visszatérítés végrehajtása (Payment/Refund v2). A válasz
 * RefundedTransactions elemeit (TransactionId + Status) változatlanul adja
 * vissza; csak a Barion-azonosítók kerülnek kanonikus (kisbetűs, kötőjeles)
 * alakba, hogy a tárolt PaymentId-vel pontos egyezéssel összevethetők legyenek
 * (a Barion mindkét alakot használja, lásd guid.ts).
 */
export async function refundPayment(
  params: RefundPaymentParams,
  config?: BarionClientConfig,
): Promise<BarionRefundResponse> {
  const resolvedConfig = config ?? getBarionConfig()
  const request = buildRefundRequest(params)
  const response = await barionPost<BarionRefundResponse>(
    '/v2/Payment/Refund',
    request,
    resolvedConfig,
  )
  return {
    ...response,
    PaymentId: canonicalizeBarionGuid(response.PaymentId),
    RefundedTransactions: Array.isArray(response.RefundedTransactions)
      ? response.RefundedTransactions.map((transaction) => ({
          ...transaction,
          TransactionId: canonicalizeBarionGuid(transaction.TransactionId),
        }))
      : response.RefundedTransactions,
  }
}
