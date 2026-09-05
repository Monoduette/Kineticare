/**
 * Barion Smart Gateway — hálózati (wire) típusok és a strukturált hibaosztály.
 *
 * A mezőnevek szándékosan PascalCase-ek: így utaznak a Barion API felé/Onnan,
 * a szerializáció 1:1-ben a dokumentált payloadokat tükrözi
 * (https://docs.barion.com). A lib belső, camelCase paraméterei a
 * start.ts / state.ts / refund.ts modulokban képződnek ezekre a típusokra.
 *
 * Verziók: Payment/Start v2, Payment/Refund v2, fizetésállapot-lekérdezés v4
 * (az állapotlekérdezés régi, v2-es eljárása deprecated — a kódban kizárólag a
 * v4-es útvonal szerepel).
 */

/** A Barion egységes hibaobjektuma — minden hibaválasz Errors tömbjében ilyen jön. */
export interface BarionError {
  ErrorCode: string
  Title: string
  Description: string
}

/** Barion fizetésállapot-enum (Payment/PaymentState v4 és Payment/Start v2 válasza). */
export type BarionPaymentStatus =
  | 'Prepared'
  | 'Started'
  | 'InProgress'
  | 'Waiting'
  | 'Reserved'
  | 'Authorized'
  | 'Canceled'
  | 'Succeeded'
  | 'Failed'
  | 'PartiallySucceeded'
  | 'Expired'

/** Tétel a Payment/Start tranzakcióban (Item struktúra). */
export interface BarionItem {
  Name: string
  Description: string
  Quantity: number
  Unit: string
  UnitPrice: number
  ItemTotal: number
  SKU?: string
}

/** Tranzakció a Payment/Start kérésben (PaymentTransaction struktúra). */
export interface BarionPaymentTransaction {
  POSTransactionId: string
  Payee: string
  Total: number
  Currency: 'HUF'
  Comment?: string
  Items: BarionItem[]
}

/**
 * Payment/Start v2 kérés-body. A fix üzleti értékeket (Immediate, GuestCheckOut,
 * FundingSources: All, hu-HU, HUF) a start.ts állítja be; a POSKey-t a client
 * injektálja a body-ba (sosem az URL-be — így nem kerülhet access logba).
 */
export interface BarionPaymentStartRequest {
  POSKey: string
  PaymentType: 'Immediate'
  GuestCheckOut: boolean
  FundingSources: ['All']
  Locale: 'hu-HU'
  Currency: 'HUF'
  PaymentWindow: string
  PaymentRequestId: string
  PayerHint?: string
  CardHolderNameHint?: string
  RedirectUrl: string
  CallbackUrl: string
  Transactions: BarionPaymentTransaction[]
  /** Recurring-előkészítés: csak feature-flag mellett kerül a kérésbe (lásd start.ts). */
  InitiateRecurrence?: boolean
  RecurrenceId?: string
}

/** Feldolgozott tranzakció a Payment/Start v2 válaszban. */
export interface BarionProcessedTransaction {
  TransactionId: string
  POSTransactionId?: string
  TransactionTime?: string
  Total?: number
  Currency?: string
  Status?: string
}

/** Payment/Start v2 válasz. */
export interface BarionPaymentStartResponse {
  PaymentId: string
  PaymentRequestId?: string
  Status: BarionPaymentStatus
  QRUrl?: string
  GatewayUrl?: string
  RedirectUrl?: string
  RecurrenceResult?: string
  Transactions?: BarionProcessedTransaction[]
  Errors?: BarionError[]
}

/** Részletes tranzakció a fizetésállapot v4 válasz Transactions tömbjében. */
export interface BarionDetailedTransaction {
  /** A Barion rendszerében generált egyedi tranzakció-azonosító (refundhoz kell). */
  TransactionId: string
  POSTransactionId?: string
  TransactionTime?: string
  Total?: number
  Currency?: string
  Comment?: string
  Status?: string
  TransactionType?: string
  RelatedId?: string | null
}

/**
 * Fizetésállapot-lekérdezés V4 válasza (GET /v4/Payment/{PaymentId}/PaymentState).
 */
export interface BarionPaymentStateResponse {
  PaymentId: string
  PaymentRequestId?: string
  Status: BarionPaymentStatus
  PaymentType?: string
  FundingSource?: string
  GuestCheckout?: boolean
  CreatedAt?: string
  ValidUntil?: string
  CompletedAt?: string | null
  Total?: number
  Currency?: string
  Transactions: BarionDetailedTransaction[]
  Errors?: BarionError[]
}

/** Egy visszatérítendő tranzakció a Payment/Refund v2 kérésben. */
export interface BarionTransactionToRefund {
  TransactionId: string
  /** Kötelező kereskedői tranzakcióazonosító: https://docs.barion.com/TransactionToRefund */
  POSTransactionId: string
  AmountToRefund: number
}

/** Payment/Refund v2 kérés-body (a POSKey-t a client injektálja). */
export interface BarionRefundRequest {
  POSKey: string
  PaymentId: string
  TransactionsToRefund: BarionTransactionToRefund[]
}

/** Egy visszatérített tranzakció a Payment/Refund v2 válaszban. */
export interface BarionRefundedTransaction {
  TransactionId: string
  /** A visszatérített összeg hivatalos mezője: https://docs.barion.com/RefundedTransaction */
  Total?: number
  /** Kompatibilitási mező; a hivatalos refund-válasz összege Total, nem AmountToRefund. */
  AmountToRefund?: number
  POSTransactionId?: string
  Comment?: string
  /** Tranzakciószintű státusz (jellemzően: Succeeded / Refunded / PartiallyRefunded / RefundFailed). */
  Status: string
}

/** Payment/Refund v2 válasz. */
export interface BarionRefundResponse {
  PaymentId: string
  RefundedTransactions: BarionRefundedTransaction[]
  /** Opcionális, a többi Barion-válaszhoz hasonlóan; a kliens a jelen lévő hibákat ellenőrzi. */
  Errors?: BarionError[]
}

/** A Barion-hívás hibájának fajtái — a hívó így tud különbséget tenni retry-szempontból. */
export type BarionErrorKind = 'timeout' | 'network' | 'http' | 'provider' | 'invalid_response'

/**
 * Strukturált Barion-hiba: a provider hibaobjektumai (ErrorCode/Title/Description)
 * elvesztés nélkül megőrződnek a providerErrors mezőben, a HTTP-státusz és a
 * hibafajta pedig gépileg feldolgozható.
 */
export class BarionApiError extends Error {
  readonly kind: BarionErrorKind
  readonly endpoint: string
  readonly httpStatus?: number
  readonly providerErrors: BarionError[]

  constructor(args: {
    message: string
    kind: BarionErrorKind
    endpoint: string
    httpStatus?: number
    providerErrors?: BarionError[]
  }) {
    super(args.message)
    this.name = 'BarionApiError'
    this.kind = args.kind
    this.endpoint = args.endpoint
    this.httpStatus = args.httpStatus
    this.providerErrors = args.providerErrors ?? []
  }
}
