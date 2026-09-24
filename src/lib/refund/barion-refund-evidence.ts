import {
  BarionApiError,
  type BarionDetailedTransaction,
  type BarionPaymentStateResponse,
} from '../barion'
import { sameBarionGuid } from '../barion/guid'
import { formatPriceHuf } from '../format-price'
import type { RefundIntentProviderNoEffectEvidence } from './refund-intent'

/**
 * A Barion refund-válaszainak és GetState-adatainak tiszta (mellékhatás-mentes)
 * besorolása. Pénzügyi döntést csak a hívó hoz, ez a modul csak bizonyítékot ad.
 *
 * Források (docs.barion.com, Wayback-másolatok):
 * - Payment-Refund-v2 (oldid 4283) és Error_codes_notifications „Refunding a
 *   payment”: a refund lehetséges hibakódjai, köztük „TooLowBalanceToMakeRefund:
 *   There are not enough funds to fulfill the refund request.” és
 *   „InvalidTransactionType: … Only CardPayment, Shop and BankTransferPayment
 *   types are refundable.”
 * - Calling_the_API: „Every API response contains an Errors array. If this
 *   array is empty then the request was processed successfully.”
 * - TransactionType (oldid 4445), DetailedPaymentTransaction (oldid 4281):
 *   a refund-tranzakciók típusa Refund / RefundToBankCard / RefundToBankAccount,
 *   a RelatedId az eredeti fizetési tranzakcióra mutat
 *   (github.com/barion/barion-web-php/blob/master/docs/refund_payments.md).
 * - Barion ÁSZF 7.5: fedezet nélküli megbízást nem teljesít, részteljesítést nem végez.
 */

/** Két Barion-azonosító egyezése: pontos egyezés, vagy ugyanaz a GUID más alakban. */
export function sameBarionId(a: unknown, b: unknown): boolean {
  return (typeof a === 'string' && a.trim().length > 0 && a === b) || sameBarionGuid(a, b)
}

/** A visszatéríthető fizetési tranzakciók típusai (Payment-Refund-v2, InvalidTransactionType). */
export const REFUNDABLE_TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  'CardPayment',
  'Shop',
  'BankTransferPayment',
])

/** Ugyanazon fizetés visszatérítés-tranzakciói (TransactionType). */
const REFUND_TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  'Refund',
  'RefundToBankCard',
  'RefundToBankAccount',
])

/** Sikertelen visszatérítés sztornója: jelenléte mellett a kimenet nem bizonyítható. */
const REFUND_REVERSAL_TYPES: ReadonlySet<string> = new Set([
  'StornoUnSuccessfulRefundToBankCard',
  'StornoUnSuccessfulRefundToBankAccount',
])

/** Folyamatban lévő tranzakció-státuszok (TransactionStatus: Prepared, Started). */
const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set(['Prepared', 'Started'])

/** A checkout egyetlen fizetési tranzakciójának kereskedői azonosítója (start-checkout.ts). */
export function expectedPosTransactionId(orderNumber: string | null | undefined): string | null {
  return typeof orderNumber === 'string' && orderNumber.trim().length > 0
    ? `${orderNumber}-1`
    : null
}

/**
 * A visszatérítéshez küldött megjegyzés, amelyet a Barion az eredeti fizetőnek
 * megmutat (TransactionToRefund.Comment). A Start megjegyzésének párja
 * („Kineticare rendelés …”, start-checkout.ts), személyes adat nélkül.
 */
export function refundComment(orderNumber: string | null | undefined): string | undefined {
  return typeof orderNumber === 'string' && orderNumber.trim().length > 0
    ? `Kineticare visszatérítés ${orderNumber.trim()}`
    : undefined
}

export interface RefundSourceTransaction {
  transactionId: string
  posTransactionId: string
  /** A tranzakció eredeti összege, ha pozitív biztonságos egész; különben null. */
  totalHuf: number | null
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * A visszatérítendő eredeti fizetési tranzakció a GetState Transactions tömbjéből.
 *
 * Pontosan egy jelölt lehet: visszatéríthető típus, Succeeded státusz, nem üres
 * TransactionId és POSTransactionId, és ha a hívó megadja, a várt kereskedői
 * azonosító. Díj-tranzakció (GatewayFee, CardProcessingFee) és korábbi
 * visszatérítés (RefundToBankCard) így sosem választható. Több vagy nulla jelölt,
 * illetve ugyanaz a Barion-azonosító kétszer: nincs választás (null).
 */
export function selectRefundSourceTransaction(
  state: BarionPaymentStateResponse,
  options: { posTransactionId?: string } = {},
): RefundSourceTransaction | null {
  const transactions: unknown[] = Array.isArray(state.Transactions) ? state.Transactions : []
  const records = transactions.filter(
    (item): item is BarionDetailedTransaction => typeof item === 'object' && item !== null,
  )
  const candidates = records.filter(
    (tx) =>
      typeof tx.TransactionType === 'string' &&
      REFUNDABLE_TRANSACTION_TYPES.has(tx.TransactionType) &&
      tx.Status === 'Succeeded' &&
      nonEmpty(tx.TransactionId) &&
      nonEmpty(tx.POSTransactionId) &&
      (options.posTransactionId === undefined || tx.POSTransactionId === options.posTransactionId),
  )
  if (candidates.length !== 1) return null
  const [source] = candidates
  if (records.filter((tx) => sameBarionId(tx.TransactionId, source.TransactionId)).length !== 1)
    return null
  return {
    transactionId: source.TransactionId,
    posTransactionId: source.POSTransactionId as string,
    totalHuf:
      typeof source.Total === 'number' && Number.isSafeInteger(source.Total) && source.Total > 0
        ? source.Total
        : null,
  }
}

/**
 * A Payment/Refund v2 dokumentált, végleges elutasítási kódjai: a Barion a
 * kérést nem hajtotta végre, pénz nem mozdult. Az InternalServerError és minden
 * ismeretlen kód szándékosan hiányzik: ott a kimenet nem ismert.
 * A sorrend a tulajdonosnak szóló üzenet elsőbbsége is.
 */
export const DEFINITIVE_REFUND_REJECTION_CODES = [
  'TooLowBalanceToMakeRefund',
  'AmountToRefundIsGreaterThanTransactionAmount',
  'PaymentStatusNotValid',
  'SuspendedUserTriedToRefund',
  'InvalidAccount',
  'TheSourceAndDestinationAccountsAreMatched',
  'AuthenticationFailed',
  'InvalidTransactionType',
  'TransactionDoesNotBelongToPayment',
  'NotExistingPaymentId',
  'ModelValidationError',
] as const

export type RefundRejectionCode = (typeof DEFINITIVE_REFUND_REJECTION_CODES)[number]

/** A tulajdonos javítása (egyenleg, Barion-fiók) után az automatikus újrapróbálás értelmes. */
export const OWNER_FIXABLE_REJECTION_CODES: ReadonlySet<RefundRejectionCode> = new Set([
  'TooLowBalanceToMakeRefund',
  'SuspendedUserTriedToRefund',
  'InvalidAccount',
  'AuthenticationFailed',
])

const REJECTION_CODE_SET: ReadonlySet<string> = new Set(DEFINITIVE_REFUND_REJECTION_CODES)

function isRejectionCode(value: unknown): value is RefundRejectionCode {
  return typeof value === 'string' && REJECTION_CODE_SET.has(value)
}

export interface RefundRejection {
  /** Ismétlés nélkül, a Barion sorrendjében. */
  codes: readonly RefundRejectionCode[]
}

/**
 * Végleges Barion-elutasítás felismerése. Csak akkor az, ha a Barion ténylegesen
 * válaszolt (HTTP 4xx, kivéve a 408-at, vagy 2xx kitöltött Errors tömbbel), és
 * MINDEN hibakód a dokumentált elutasítási kódok közül való. Timeout, hálózati
 * hiba, 5xx, értelmezhetetlen válasz, ismeretlen vagy vegyes kód: null, tehát a
 * kimenet ismeretlen marad.
 */
export function classifyRefundRejection(error: unknown): RefundRejection | null {
  if (!(error instanceof BarionApiError)) return null
  const status = error.httpStatus
  const answered =
    (error.kind === 'http' &&
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      status !== 408) ||
    (error.kind === 'provider' &&
      (status === undefined || (typeof status === 'number' && status >= 200 && status < 300)))
  if (!answered || !Array.isArray(error.providerErrors) || error.providerErrors.length === 0)
    return null
  const codes: RefundRejectionCode[] = []
  for (const item of error.providerErrors) {
    const code: unknown = item?.ErrorCode
    if (!isRejectionCode(code)) return null
    if (!codes.includes(code)) codes.push(code)
  }
  return { codes }
}

const REJECTION_REFERENCE_PREFIX = 'barion:refund-rejected:'

/** A provider_failed átmenet tartós hivatkozása (kódok, nyers szöveg nélkül). */
export function rejectionReference(rejection: RefundRejection): string {
  return `${REJECTION_REFERENCE_PREFIX}${rejection.codes.join('+')}`
}

/** A tartós hivatkozásból visszaolvasott elutasítási kódok (más hivatkozásnál üres). */
export function rejectionCodesFromReference(
  reference: string | null | undefined,
): RefundRejectionCode[] {
  if (typeof reference !== 'string' || !reference.startsWith(REJECTION_REFERENCE_PREFIX)) return []
  return reference.slice(REJECTION_REFERENCE_PREFIX.length).split('+').filter(isRejectionCode)
}

/** GetState alapú nullhatás: a várakozási idő után sincs a kísérlethez tartozó visszatérítés. */
export const PAYMENT_STATE_NO_REFUND_REFERENCE = 'barion:paymentstate:no-refund-transaction'

export function providerNoEffectEvidence(
  reference: string,
  now: Date = new Date(),
): RefundIntentProviderNoEffectEvidence {
  return { kind: 'provider_confirmed_no_effect', confirmedAt: now.toISOString(), reference }
}

/**
 * A tulajdonosnak szóló üzenet végleges elutasításnál: mi történt, és mi a
 * teendő (GOV.UK Error message: „say what has happened and how to fix it”;
 * NN/g Error-Message Guidelines: „offer … remedies”). Hibakód nem kerül a
 * szövegbe (docs/ui-sztenderdek.md 2.7), az a naplóban van.
 */
export function refundRejectionMessage(rejection: RefundRejection, amountHuf: number): string {
  const code =
    DEFINITIVE_REFUND_REJECTION_CODES.find((item) => rejection.codes.includes(item)) ??
    'ModelValidationError'
  const noMoney = 'Pénzmozgás nem történt.'
  switch (code) {
    case 'TooLowBalanceToMakeRefund':
      return `A Barion elutasította a visszatérítést, mert a Barion-tárcádban nincs elég egyenleg. ${noMoney} Tölts fel annyit, hogy legalább ${formatPriceHuf(amountHuf)} legyen a tárcában, majd indítsd újra a visszatérítést.`
    case 'AmountToRefundIsGreaterThanTransactionAmount':
      return `A Barion szerint ebből a fizetésből ennyi már nem téríthető vissza, ezért elutasította a kérést. ${noMoney} Nézd meg a Barion-fiókodban, volt-e már visszatérítés ennél a fizetésnél (például közvetlenül a Barionban), és jelezd az üzemeltetőnek.`
    case 'PaymentStatusNotValid':
      return `A Barion szerint ez a fizetés nincs sikeres állapotban, ezért nem téríthető vissza. ${noMoney} Ellenőrizd a fizetést a Barion-fiókodban, és jelezd az eltérést az üzemeltetőnek.`
    case 'SuspendedUserTriedToRefund':
      return `A Barion felfüggesztette a fiókodat, ezért most nem indíthatsz visszatérítést. ${noMoney} Vedd fel a kapcsolatot a Barion ügyfélszolgálatával, majd indítsd újra a visszatérítést.`
    case 'InvalidAccount':
      return `A Barion szerint a fiókod most nem jogosult visszatérítésre. ${noMoney} Vedd fel a kapcsolatot a Barion ügyfélszolgálatával, majd indítsd újra a visszatérítést.`
    case 'TheSourceAndDestinationAccountsAreMatched':
      return `A Barion nem enged visszatérítést, mert ezt a rendelést a bolt saját Barion-fiókjából fizették ki. ${noMoney} Ezt a rendelést kézzel kell rendezni, jelezd az üzemeltetőnek.`
    case 'AuthenticationFailed':
      return `A Barion nem fogadta el a bolt azonosító kulcsát, ezért a visszatérítés nem indult el. ${noMoney} Jelezd az üzemeltetőnek, hogy ellenőrizze a Barion-beállításokat.`
    default:
      return `A Barion nem fogadta el a visszatérítési kérés adatait. ${noMoney} Jelezd az üzemeltetőnek a rendelésszámmal együtt.`
  }
}

/** Legalább ennyi idő a Barion-kérés indítása után, mielőtt a hiányzó visszatérítés nullhatásnak számít. */
export const PROVIDER_SETTLE_DELAY_MS = 15 * 60_000

export type PaymentStateRefundEvidence =
  | { kind: 'succeeded'; refundTransactionId: string; posTransactionId: string }
  | { kind: 'no_effect' }
  | { kind: 'in_progress' }
  | { kind: 'too_early'; notBefore: string }
  | { kind: 'unprovable' }

function isBarionGuidString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value)
  )
}

/**
 * Egy elindított, de bizonytalan kimenetű refund-kísérlet eredménye a friss
 * GetState-ből (Payment-PaymentState-v4).
 *
 * - succeeded: pontosan egy, más kísérlet által még fel nem használt,
 *   Succeeded refund-tranzakció kapcsolódik (RelatedId) az eredeti
 *   tranzakcióhoz, a kért összeggel.
 * - in_progress: a kapcsolódó refund-tranzakció még Prepared/Started.
 * - no_effect: nincs új kapcsolódó refund-tranzakció, a fizetés Total értéke a
 *   helyi nyilvántartás szerinti maradék, és az indítás óta eltelt a
 *   PROVIDER_SETTLE_DELAY_MS (a Barion egy kérést legfeljebb 30 másodpercig
 *   dolgoz fel: Calling_the_API, „The maximum duration for an HTTP request is
 *   30 seconds”).
 * - too_early: nincs refund-tranzakció, de még nem telt el a várakozási idő.
 * - unprovable: minden más (többértelmű, eltérő összeg, sztornó, idegen fizetés).
 */
export function refundEvidenceFromPaymentState(input: {
  state: BarionPaymentStateResponse
  paymentId: string
  sourceTransactionId: string
  amountHuf: number
  /** Más kísérletek már rögzített refund-tranzakciói; null, ha ez nem bizonyítható. */
  consumedRefundTransactionIds: readonly string[] | null
  /** A helyi nyilvántartás szerint még vissza nem térített összeg; null, ha nem bizonyítható. */
  expectedRemainingHuf: number | null
  providerStartedAt: string | null | undefined
  now: number
}): PaymentStateRefundEvidence {
  const { state } = input
  if (
    input.consumedRefundTransactionIds === null ||
    !sameBarionId(state.PaymentId, input.paymentId) ||
    state.Status !== 'Succeeded' ||
    !Array.isArray(state.Transactions)
  )
    return { kind: 'unprovable' }
  const records = (state.Transactions as unknown[]).filter(
    (item): item is BarionDetailedTransaction => typeof item === 'object' && item !== null,
  )
  const sources = records.filter((tx) => sameBarionId(tx.TransactionId, input.sourceTransactionId))
  if (sources.length !== 1 || !nonEmpty(sources[0].POSTransactionId)) return { kind: 'unprovable' }
  const posTransactionId = sources[0].POSTransactionId
  const related = records.filter((tx) => sameBarionId(tx.RelatedId, input.sourceTransactionId))
  if (related.some((tx) => REFUND_REVERSAL_TYPES.has(String(tx.TransactionType))))
    return { kind: 'unprovable' }
  const consumed = input.consumedRefundTransactionIds
  const refunds = related.filter((tx) => REFUND_TRANSACTION_TYPES.has(String(tx.TransactionType)))
  // Minden korábban rögzített visszatérítésnek pontosan egyszer látszania kell,
  // különben a Barion-adat és a helyi nyilvántartás nem vethető össze.
  if (
    !consumed.every((id) => refunds.filter((tx) => sameBarionId(tx.TransactionId, id)).length === 1)
  )
    return { kind: 'unprovable' }
  const fresh = refunds.filter((tx) => !consumed.some((id) => sameBarionId(id, tx.TransactionId)))
  if (fresh.length > 1) return { kind: 'unprovable' }
  if (fresh.length === 1) {
    const [refund] = fresh
    if (typeof refund.Status === 'string' && IN_PROGRESS_STATUSES.has(refund.Status))
      return { kind: 'in_progress' }
    if (
      refund.Status === 'Succeeded' &&
      refund.Total === input.amountHuf &&
      isBarionGuidString(refund.TransactionId) &&
      (!nonEmpty(refund.POSTransactionId) || refund.POSTransactionId === posTransactionId)
    )
      return { kind: 'succeeded', refundTransactionId: refund.TransactionId, posTransactionId }
    return { kind: 'unprovable' }
  }
  const startedAt =
    typeof input.providerStartedAt === 'string' ? Date.parse(input.providerStartedAt) : NaN
  if (
    input.expectedRemainingHuf === null ||
    state.Total !== input.expectedRemainingHuf ||
    !Number.isFinite(startedAt)
  )
    return { kind: 'unprovable' }
  if (input.now - startedAt < PROVIDER_SETTLE_DELAY_MS)
    return {
      kind: 'too_early',
      notBefore: new Date(startedAt + PROVIDER_SETTLE_DELAY_MS).toISOString(),
    }
  return { kind: 'no_effect' }
}
