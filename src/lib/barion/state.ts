import { createLogger } from '../logger'
import {
  barionGet,
  getBarionConfig,
  isBarionRateLimited,
  type BarionCallOptions,
  type BarionClientConfig,
} from './client'
import { barionGuidForPath, canonicalizeBarionGuid } from './guid'
import type { BarionPaymentStateResponse } from './types'

/**
 * Fizetésállapot-lekérdezés V4 — GET /v4/Payment/{PaymentId}/PaymentState.
 *
 * A régi, v2-es állapotlekérdező eljárás a Barionban deprecated, ezért a
 * modulban kizárólag a v4-es útvonal létezik (a Barion-callback-vezérelt
 * állapotgép is ezt fogja hívni a jóváhagyáskor — külön ticket).
 *
 * A hívás GET, a POSKey az x-pos-key headerben utazik (lásd client.ts).
 *
 * Az útvonalba a KÖTŐJEL NÉLKÜLI azonosító megy: kötőjelesre a Barion
 * Errors tömb nélküli 404-et ad (útvonal-eltérés, lásd guid.ts). Ezt a hívók
 * NEM veszik „nem létező fizetésnek", hanem újrapróbálható, riasztandó hibának
 * (barion-callback/process-callback.ts isUnverifiedNotFound). A válasz
 * azonosítói kanonikus (kisbetűs, kötőjeles) alakban jutnak tovább, így a
 * tárolt `barionPaymentId`-vel és a refund-intent adataival pontos egyezéssel
 * összevethetők.
 */

const stateLog = createLogger({ module: 'barion-state' })

/**
 * Rendelés-oldali fizetési állapot — a későbbi Barion-callback-vezérelt
 * állapotgép ezekre az értékekre képezi le a Barion-státuszokat.
 */
export type OrderPaymentState = 'paid' | 'cancelled' | 'payment_pending'

/**
 * Barion paymentStatus → rendelés-oldali állapot leképezés (M-07).
 *
 * A TELJES Barion-státuszkészletet (BarionPaymentStatus, types.ts) explicit
 * ágakra bontjuk — csendes default nincs.
 *
 * VÉGÁLLAPOTOK
 * - `Succeeded` → paid.
 * - `Canceled` / `Expired` / **`Failed`** → cancelled.
 *   A `Failed` korábban a defaultba esett, tehát payment_pending lett belőle.
 *   Ez éles hiba volt: a Barion szerint VÉGLEGESEN meghiúsult fizetés nálunk
 *   örökre „függő" maradt — az order-poll job 5 percenként újrapollolta, majd
 *   24 óra után csak riasztást írt (a lejárat-alapú lezárás kizárólag a
 *   barionPaymentId NÉLKÜLI, árva rendelésekre fut, lásd order-poll/service.ts).
 *   A rendelés így soha nem záródott le, a vevő pedig nem kapott tiszta
 *   „sikertelen fizetés" állapotot.
 *
 *   MIÉRT `cancelled` ÉS NEM `payment_failed`? A rendelés-státuszkészletben
 *   létezik `payment_failed`, DE az OrderPaymentState (és rá épülve az
 *   applyBarionStateTransition + a webhook-events `result` select) csak három
 *   értéket ismer. Egy negyedik kimenetel bevezetése a webhook-events `result`
 *   select bővítését — tehát enum-migrációt — igényelne, ami ebben a körben
 *   tiltott. A `cancelled` a MEGLÉVŐ készlet helyes végállapota: a fizetés nem
 *   jött létre, a rendelés lezárul, a vevő újrakezdheti a vásárlást; az
 *   állapotgép védelmei (paid → cancelled TILOS) változatlanul érvényesek.
 *   A finomabb `payment_failed` megkülönböztetés külön, migrációval járó
 *   ticket.
 *
 * FÜGGŐ ÁLLAPOTOK (a fizetés még folyamatban van)
 * - `Prepared` / `Started` / `InProgress` / `Waiting` → payment_pending.
 *   Ezek normális, átmeneti állapotok, nem naplózunk rájuk figyelmeztetést.
 *
 * FIGYELMEZTETETT ÁGAK (nálunk elő SEM fordulhatnának)
 * - `Reserved` / `Authorized`: foglalásos/hitelesítéses fizetéshez tartoznak,
 *   a checkout viszont `PaymentType: 'Immediate'`-tel indul (start.ts). Ha
 *   mégis ilyet látunk, az konfigurációs eltérés: a pénz nincs levonva, ezért
 *   konzervatívan payment_pending marad — de figyelmeztetést naplózunk.
 * - `PartiallySucceeded`: több payee-s fizetésnél fordul elő, nálunk egyetlen
 *   payee van. Részben teljesült fizetést SOSEM jelölünk paid-nek.
 * - ismeretlen/jövőbeli státusz: payment_pending + figyelmeztetés, hogy a
 *   naplóban látszódjon, ha a Barion új státuszt vezet be.
 *
 * A konzervatív alapelv változatlan: bizonytalan státuszra SOHA nem jelölünk
 * paid-et, és sosem lépünk vissza egy már paid rendelésről.
 */
export function mapBarionPaymentStatus(status: string): OrderPaymentState {
  switch (status) {
    case 'Succeeded':
      return 'paid'

    case 'Canceled':
    case 'Expired':
    case 'Failed':
      return 'cancelled'

    case 'Prepared':
    case 'Started':
    case 'InProgress':
    case 'Waiting':
      return 'payment_pending'

    case 'Reserved':
    case 'Authorized':
      stateLog.warn(
        'foglalásos/hitelesítéses Barion-státusz azonnali (Immediate) fizetésre — a rendelés függő marad, ellenőrzés szükséges',
        { barionStatus: status },
      )
      return 'payment_pending'

    case 'PartiallySucceeded':
      stateLog.warn(
        'részben teljesült Barion-fizetés — paid-nek SOSEM jelöljük, a rendelés függő marad (manuális ellenőrzés szükséges)',
        { barionStatus: status },
      )
      return 'payment_pending'

    default:
      stateLog.warn(
        'ismeretlen Barion-fizetésállapot — konzervatívan függő (payment_pending); a leképezést bővíteni kell',
        { barionStatus: status },
      )
      return 'payment_pending'
  }
}

/**
 * Két PaymentState-hívás között ugyanarra a PaymentId-re legalább ennyi idő
 * telik el (a-callback-8, a-checkout-5). A Barion szabálya: „if you call the
 * endpoint with the same PaymentID more than once within a 5-second interval,
 * for the following 5 seconds, further calls … return HTTP 429 Too many
 * requests”, és egy nem közölt küszöb fölött minden további hívás 429
 * (docs.barion.com/Callback_mechanism, Wayback 20260122005429). Az 5 s fölötti
 * fél másodperc a két óra (a miénk és a Barioné) eltérésének tartaléka.
 */
export const PAYMENT_STATE_MIN_INTERVAL_MS = 5_500

/** HTTP 429 után ennyit várunk az EGYETLEN újrapróbálás előtt (a Barion 5 s-os büntetőablaka + tartalék). */
export const PAYMENT_STATE_RATE_LIMIT_RETRY_DELAY_MS = 5_500

/** Ennyi bejegyzés fölött a kapu a lejárt (tétlen) bejegyzéseket kitakarítja. */
const GATE_PRUNE_THRESHOLD = 256

interface PaymentStateGateEntry {
  /** A folyamatban lévő (vagy a kötelező szünetre váró) hívás közös ígérete. */
  inFlight: Promise<BarionPaymentStateResponse> | null
  /** Az utolsó hívás befejezésének ideje (ms); ettől számít a kötelező szünet. */
  lastSettledAt: number
}

/**
 * Folyamaton belüli, PaymentId-nkénti kapu MINDEN PaymentState-hívóra (callback,
 * webhook-retry, order-poll, pénztár, köszönőoldal, refund). Egy replikával
 * fut a szolgáltatás (railway.json numReplicas: 1), tehát a folyamaton belüli
 * kapu elég; deploy-átfedésnél a két konténer között a 429 egyszeri
 * újrapróbálása véd.
 */
const paymentStateGate = new Map<string, PaymentStateGateEntry>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function prunePaymentStateGate(nowMs: number): void {
  if (paymentStateGate.size <= GATE_PRUNE_THRESHOLD) {
    return
  }
  for (const [key, entry] of paymentStateGate) {
    if (entry.inFlight === null && nowMs - entry.lastSettledAt >= PAYMENT_STATE_MIN_INTERVAL_MS) {
      paymentStateGate.delete(key)
    }
  }
}

/**
 * A fizetés aktuális állapotának lekérdezése a Bariontól (v4).
 * A válasz Transactions tömbje tartalmazza a tranzakciószintű TransactionId-kat
 * (ezek kellenek pl. a tranzakció-szintű refundhoz — lásd refund.ts).
 *
 * HÍVÁSFEGYELEM (a kapu minden hívóra automatikusan érvényes):
 * - ugyanarra a PaymentId-re az előző hívás VÉGE után legalább
 *   PAYMENT_STATE_MIN_INTERVAL_MS telik el, a hívó addig vár (friss állapotot
 *   kap, nem egy korábbi választ);
 * - az egyidejű hívók EGY ígéreten osztoznak: egy hívás megy ki, mindegyikük
 *   ugyanazt a választ vagy hibát kapja. Aki a kérés útja közben érkezik, az
 *   azt az állapotot látja, amelyet a Barion a kérés beérkezésekor mutatott; ha
 *   épp akkor változott, a következő callback, a webhook-retry vagy az
 *   order-poll hozza az újat;
 * - HTTP 429 (a Barion fojtása) átmeneti: egyszer, PAYMENT_STATE_RATE_LIMIT_RETRY_DELAY_MS
 *   múlva újrapróbáljuk, a második 429 a hívóhoz jut (isBarionRateLimited).
 */
export function fetchPaymentState(
  paymentId: string,
  config?: BarionClientConfig,
  options: BarionCallOptions = {},
): Promise<BarionPaymentStateResponse> {
  let resolvedConfig: BarionClientConfig
  try {
    resolvedConfig = config ?? getBarionConfig()
  } catch (error) {
    return Promise.reject(error)
  }
  const path = `/v4/Payment/${encodeURIComponent(barionGuidForPath(paymentId))}/PaymentState`
  const key = `${resolvedConfig.apiUrl}${path}`
  const existing = paymentStateGate.get(key)
  if (existing?.inFlight) {
    return existing.inFlight
  }

  const entry: PaymentStateGateEntry = existing ?? { inFlight: null, lastSettledAt: 0 }
  const callOnce = async (): Promise<BarionPaymentStateResponse> =>
    normalizePaymentStateIds(
      await barionGet<BarionPaymentStateResponse>(path, resolvedConfig, options),
    )

  const run = async (): Promise<BarionPaymentStateResponse> => {
    const waitMs = entry.lastSettledAt + PAYMENT_STATE_MIN_INTERVAL_MS - Date.now()
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    try {
      return await callOnce()
    } catch (error) {
      if (!isBarionRateLimited(error)) {
        throw error
      }
      stateLog.warn(
        'Barion PaymentState: HTTP 429 (ugyanarra a fizetésre túl sűrű lekérdezés) — egy újrapróbálás késleltetve',
        { retryDelayMs: PAYMENT_STATE_RATE_LIMIT_RETRY_DELAY_MS },
      )
      await sleep(PAYMENT_STATE_RATE_LIMIT_RETRY_DELAY_MS)
      return callOnce()
    }
  }

  const promise = run().finally(() => {
    entry.inFlight = null
    entry.lastSettledAt = Date.now()
    prunePaymentStateGate(entry.lastSettledAt)
  })
  entry.inFlight = promise
  paymentStateGate.set(key, entry)
  return promise
}

/** A v4 válasz Barion-azonosítói kanonikus alakban (a többi mező változatlan). */
export function normalizePaymentStateIds(
  response: BarionPaymentStateResponse,
): BarionPaymentStateResponse {
  return {
    ...response,
    PaymentId: canonicalizeBarionGuid(response.PaymentId),
    Transactions: Array.isArray(response.Transactions)
      ? response.Transactions.map((transaction) => ({
          ...transaction,
          TransactionId: canonicalizeBarionGuid(transaction.TransactionId),
          ...(typeof transaction.RelatedId === 'string'
            ? { RelatedId: canonicalizeBarionGuid(transaction.RelatedId) }
            : {}),
        }))
      : response.Transactions,
  }
}
