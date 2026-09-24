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
 * 3DS: számlázási cím (BillingAddress struktúra). A mezőnevek és a korlátok a
 * docs.barion.com/BillingAddress oldalról (Wayback 20241110122232: Country
 * „Required, Exactly 2 characters … If you are not able to provide the billing
 * address, send ZZ as the country code"; City, Zip „Maximum 50/16
 * characters"; Street/Street2/Street3 „Maximum 50 characters") és a
 * barion-web-php Models/ThreeDSecure/BillingAddressModel-ből (Country, Region,
 * City, Zip, Street, Street2, Street3). A Region nem megy ki.
 */
export interface BarionBillingAddress {
  Country: 'HU' | 'ZZ'
  City?: string
  Zip?: string
  Street?: string
  Street2?: string
  Street3?: string
}

/**
 * 3DS: a vásárlás adatai (PurchaseInformation struktúra, minden mező
 * opcionális). Az enum-értékek a docs.barion.com DeliveryTimeframeType,
 * ShippingAddressIndicator és PurchaseType oldalairól és a barion-web-php
 * Enumerations/ThreeDSecure enumjaiból: digitális kurzusra `ElectronicDelivery`
 * („The goods can be downloaded immediately."), `DigitalGoods`,
 * `GoodsAndServicePurchase`. A PurchaseDate „In UTC Expected format:
 * "2019-06-27T07:15:51.327"".
 */
export interface BarionPurchaseInformation {
  DeliveryTimeframe: 'ElectronicDelivery'
  DeliveryEmailAddress?: string
  ShippingAddressIndicator: 'DigitalGoods'
  PurchaseType: 'GoodsAndServicePurchase'
  PurchaseDate: string
}

/** 3DS: a fiók kora (AccountCreationIndicator enum, barion-web-php). */
export type BarionAccountCreationIndicator =
  | 'NoAccount'
  | 'CreatedDuringThisTransaction'
  | 'LessThan30Days'
  | 'Between30And60Days'
  | 'MoreThan60Days'

/**
 * 3DS: a vevő fiókja a bolt rendszerében (PayerAccountInformation struktúra,
 * docs.barion.com/PayerAccountInformation, minden mező opcionális). Az
 * AccountId „Max length 64 characters", az AccountCreated „In UTC Expected
 * format: "2019-06-27T07:15:51.327"".
 */
export interface BarionPayerAccountInformation {
  AccountId?: string
  AccountCreated?: string
  AccountCreationIndicator?: BarionAccountCreationIndicator
}

/**
 * 3DS: a kereskedő challenge-preferenciája. Csak a `NoPreference` megengedett:
 * a `NoChallengeNeeded` mellett a docs szerint (ChallengePreference, Wayback
 * 20260122020254) „the liability is on the merchant", a `ChallengeRequired`
 * pedig minden vevőt kihívásra kényszerítene.
 */
export type BarionChallengePreference = 'NoPreference'

/**
 * Payment/Start v2 kérés-body. A fix üzleti értékeket (Immediate, GuestCheckOut,
 * FundingSources: All, hu-HU, HUF) a start.ts állítja be; a POSKey-t a client
 * teszi bele: az x-pos-key fejlécbe ÉS a body POSKey mezőjébe (lásd client.ts
 * barionRequest). URL-be sosem kerül, így access logba sem.
 *
 * Az OrderNumber opcionális; a 3DS-blokkok (BillingAddress,
 * PurchaseInformation, PayerAccountInformation, ChallengePreference) a
 * Payment-Start-v2 oldalon „Required for 3DS" jelölésűek, de „if the merchant
 * does not provide 3DS-related properties, it doesn't mean that the payment
 * will fail"; a start.ts a BARION_SEND_3DS kapcsolóval hagyja ki őket.
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
  /** A bolt rendelésszáma (max 100 karakter); a havi kivonaton és az exportban is megjelenik. */
  OrderNumber?: string
  PayerHint?: string
  CardHolderNameHint?: string
  RedirectUrl: string
  CallbackUrl: string
  Transactions: BarionPaymentTransaction[]
  BillingAddress?: BarionBillingAddress
  PurchaseInformation?: BarionPurchaseInformation
  PayerAccountInformation?: BarionPayerAccountInformation
  ChallengePreference?: BarionChallengePreference
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
