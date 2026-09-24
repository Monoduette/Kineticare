import { createLogger } from '../logger'
import { barionGet, getBarionConfig, type BarionClientConfig } from './client'
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
 * A fizetés aktuális állapotának lekérdezése a Bariontól (v4).
 * A válasz Transactions tömbje tartalmazza a tranzakciószintű TransactionId-kat
 * (ezek kellenek pl. a tranzakció-szintű refundhoz — lásd refund.ts).
 */
export async function fetchPaymentState(
  paymentId: string,
  config?: BarionClientConfig,
): Promise<BarionPaymentStateResponse> {
  const resolvedConfig = config ?? getBarionConfig()
  const response = await barionGet<BarionPaymentStateResponse>(
    `/v4/Payment/${encodeURIComponent(barionGuidForPath(paymentId))}/PaymentState`,
    resolvedConfig,
  )
  return normalizePaymentStateIds(response)
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
