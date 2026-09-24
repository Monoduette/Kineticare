import { barionPost, getBarionConfig, type BarionClientConfig } from './client'
import { canonicalBarionGuid, canonicalizeBarionGuid } from './guid'
import {
  BarionApiError,
  type BarionItem,
  type BarionPaymentStartRequest,
  type BarionPaymentStartResponse,
  type BarionPaymentTransaction,
} from './types'

/**
 * Payment/Start v2 — új azonnali (Immediate) fizetés indítása a Barionban.
 *
 * Fix üzleti szabályok (a lib állítja, a hívó nem felülírható módon kapja):
 * - PaymentType: Immediate (előleg/részletfizetés nincs)
 * - GuestCheckOut: true (Barion-fiók nélkül is fizethet a vevő)
 * - FundingSources: ['All']
 * - Locale: 'hu-HU', Currency: 'HUF'
 * - PaymentWindow: default '00:30:00' (paraméterezhető)
 * - PaymentRequestId: a rendelés orderNumber-e (pl. KH-2026-000123) — ezzel
 *   idempotens a Start: ugyanazzal a PaymentRequestId-vel a Barion nem hoz
 *   létre új fizetést, hanem a meglévőt adja vissza.
 *
 * Összegszámítás NINCS a libben: a tranzakciók Total/ItemTotal értékeit a
 * hívó adja, szerver-oldalon validálva (az orders snapshot-árai a forrás).
 *
 * Recurring-előkészítés (jövőbeli tokenfizetés): az InitiateRecurrence és a
 * RecurrenceId csak akkor kerül a kérésbe, ha a BARION_RECURRING_ENABLED
 * feature-flag 'true' ÉS a hívó kéri. Flag nélkül a recurring-paraméter
 * megadása hibát dob — így nem maradhat észrevétlen, hogy a recurring
 * ténylegesen ki van kapcsolva.
 */

export const BARION_DEFAULT_PAYMENT_WINDOW = '00:30:00'

/** Egy tétel a Start-tranzakcióban (camelCase, a lib képezi a Barion Itemre). */
export interface StartPaymentItemInput {
  name: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  itemTotal: number
  sku?: string
}

/** Egy tranzakció a Start-kérésben. A total szerver-oldalon validált végösszeg. */
export interface StartPaymentTransactionInput {
  posTransactionId: string
  /** A kedvezményezett Barion e-mail-címe — alapból a konfigurált BARION_PAYEE_EMAIL. */
  payee?: string
  total: number
  comment?: string
  items: StartPaymentItemInput[]
}

/** Recurring-előkészítés paraméterei — csak BARION_RECURRING_ENABLED mellett aktív. */
export interface StartPaymentRecurringInput {
  /** true = a fizetés egyben recurring-szerződés kezdeményezése is. */
  initiateRecurrence: boolean
  /** Külső (kereskedőoldali) recurring-azonosító; initiateRecurrence esetén kötelező. */
  recurrenceId?: string
}

export interface StartPaymentParams {
  /** A rendelés orderNumber-e (KH-YYYY-NNNNNN) — ez lesz a Barion PaymentRequestId. */
  paymentRequestId: string
  redirectUrl: string
  callbackUrl: string
  transactions: StartPaymentTransactionInput[]
  payerHint?: string
  cardHolderNameHint?: string
  /** hh:mm:ss formátum; alapértelmezés: BARION_DEFAULT_PAYMENT_WINDOW. */
  paymentWindow?: string
  recurring?: StartPaymentRecurringInput
}

/**
 * A Barion mezőkorlátai. A CardHolderNameHint „Between 2 and 45 characters"
 * (docs.barion.com/Payment-Start-v2). Az Item-mezők korlátja a
 * docs.barion.com/Item oldalon van, amely ellenőrizhetően nem volt elérhető;
 * ezért óvatos felső korlátot alkalmazunk (név 250, leírás 500, SKU 100
 * karakter), és üres leírás helyett a tétel nevét küldjük. A korláton túli
 * mező miatt a Barion az egész fizetésindítást elutasítaná.
 */
export const BARION_CARD_HOLDER_NAME_MIN = 2
export const BARION_CARD_HOLDER_NAME_MAX = 45
export const BARION_ITEM_NAME_MAX = 250
export const BARION_ITEM_DESCRIPTION_MAX = 500
export const BARION_ITEM_SKU_MAX = 100

/** Egysoros, összevont szóközű szöveg, legfeljebb `max` karakter (Unicode-karakterben mérve). */
function fitText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(normalized)
  return chars.length <= max ? normalized : chars.slice(0, max).join('').trimEnd()
}

/** A kártyabirtokos-név javaslata a Barion 2–45 karakteres korlátján belül; rövidebbre nincs javaslat. */
export function cardHolderNameHintFor(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined
  }
  const hint = fitText(name, BARION_CARD_HOLDER_NAME_MAX)
  return Array.from(hint).length < BARION_CARD_HOLDER_NAME_MIN ? undefined : hint
}

function mapItem(item: StartPaymentItemInput): BarionItem {
  const name = fitText(item.name, BARION_ITEM_NAME_MAX)
  const description = fitText(item.description, BARION_ITEM_DESCRIPTION_MAX)
  return {
    Name: name,
    Description: description.length > 0 ? description : fitText(name, BARION_ITEM_DESCRIPTION_MAX),
    Quantity: item.quantity,
    Unit: item.unit,
    UnitPrice: item.unitPrice,
    ItemTotal: item.itemTotal,
    ...(item.sku !== undefined ? { SKU: fitText(item.sku, BARION_ITEM_SKU_MAX) } : {}),
  }
}

function mapTransaction(
  transaction: StartPaymentTransactionInput,
  defaultPayee: string,
): BarionPaymentTransaction {
  return {
    POSTransactionId: transaction.posTransactionId,
    Payee: transaction.payee ?? defaultPayee,
    Total: transaction.total,
    Currency: 'HUF',
    ...(transaction.comment !== undefined ? { Comment: transaction.comment } : {}),
    Items: transaction.items.map(mapItem),
  }
}

/** A Start-kérés body-építése külön, tisztán tesztelhető függvényben. */
export function buildPaymentStartRequest(
  params: StartPaymentParams,
  config: BarionClientConfig,
): Omit<BarionPaymentStartRequest, 'POSKey'> {
  if (params.transactions.length === 0) {
    throw new Error('Barion Payment/Start: legalább egy tranzakció kötelező.')
  }

  if (params.recurring !== undefined) {
    if (!config.recurringEnabled) {
      throw new Error(
        'Barion Payment/Start: recurring-előkészítést kért a hívó, de a funkció ki van kapcsolva ' +
          "(BARION_RECURRING_ENABLED !== 'true'). Kapcsold be a flaget, vagy ne add meg a recurring-paramétert.",
      )
    }
    if (params.recurring.initiateRecurrence && !params.recurring.recurrenceId) {
      throw new Error(
        'Barion Payment/Start: initiateRecurrence esetén a recurrenceId megadása kötelező.',
      )
    }
  }

  const cardHolderNameHint = cardHolderNameHintFor(params.cardHolderNameHint)

  return {
    PaymentType: 'Immediate',
    GuestCheckOut: true,
    FundingSources: ['All'],
    Locale: 'hu-HU',
    Currency: 'HUF',
    PaymentWindow: params.paymentWindow ?? BARION_DEFAULT_PAYMENT_WINDOW,
    PaymentRequestId: params.paymentRequestId,
    ...(params.payerHint !== undefined ? { PayerHint: params.payerHint } : {}),
    ...(cardHolderNameHint !== undefined ? { CardHolderNameHint: cardHolderNameHint } : {}),
    RedirectUrl: params.redirectUrl,
    CallbackUrl: params.callbackUrl,
    Transactions: params.transactions.map((transaction) =>
      mapTransaction(transaction, config.payeeEmail),
    ),
    ...(params.recurring?.initiateRecurrence
      ? { InitiateRecurrence: true, RecurrenceId: params.recurring.recurrenceId }
      : {}),
  }
}

/**
 * Fizetés indítása (Payment/Start v2). A válasz GatewayUrl-jére kell a vevőt
 * irányítani; a PaymentId-t a rendelésen rögzíti a hívó (orders.barionPaymentId).
 */
export async function startPayment(
  params: StartPaymentParams,
  config?: BarionClientConfig,
): Promise<BarionPaymentStartResponse> {
  const resolvedConfig = config ?? getBarionConfig()
  const request = buildPaymentStartRequest(params, resolvedConfig)
  const response = await barionPost<BarionPaymentStartResponse>(
    '/v2/Payment/Start',
    request,
    resolvedConfig,
  )
  // A PaymentId a Barionban kötőjeles és kötőjel nélküli alakban is előfordul;
  // a rendelésre a kanonikus alak kerül (guid.ts). GUID nélkül a fizetés nem
  // követhető, ezért ez érvénytelen válasz.
  const paymentId = canonicalBarionGuid(response.PaymentId)
  if (paymentId === null) {
    throw new BarionApiError({
      message: 'A Barion Start-válasz nem tartalmaz érvényes PaymentId-t.',
      kind: 'invalid_response',
      endpoint: 'POST /v2/Payment/Start',
    })
  }
  return {
    ...response,
    PaymentId: paymentId,
    ...(Array.isArray(response.Transactions)
      ? {
          Transactions: response.Transactions.map((transaction) => ({
            ...transaction,
            TransactionId: canonicalizeBarionGuid(transaction.TransactionId),
          })),
        }
      : {}),
  }
}
