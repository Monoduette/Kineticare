import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { BarionApiError, fetchPaymentState, mapBarionPaymentStatus } from '../barion'
import { canonicalBarionGuid, sameBarionGuid } from '../barion/guid'
import {
  registerWebhookProcessor,
  webhookEventStore,
  type WebhookEventDoc,
  type WebhookEventStore,
  type WebhookHandler,
} from '../idempotency'
import { logger, type Logger } from '../logger'
import { onOrderPaid } from '../order-paid'
import {
  applyBarionStateTransition,
  assertPaymentAmountMatches,
} from '../order-status/apply-barion-state'
import {
  paidRejectRecoveryLogContext,
  recoverRejectedSucceededPayment,
  type RecoverRejectedSucceededPaymentInput,
  type PaidRejectRecoveryResult,
} from '../order-status/recover-paid-reject'

/**
 * Barion-callback aszinkron feldolgozó. A payload nem bizonyíték: csak v4
 * GetState. Állapotgép: apply-barion-state (ugyanaz, mint az order-poll).
 * Prepared/Started → pending_repoll, processedAt NULL. Ismeretlen fizetés
 * (kifejezett Barion not-found kód) terminális rejected. GetState 5xx/timeout
 * és a Barion-hibajelzés nélküli HTTP 404 dob → retry.
 */

export interface BarionCallbackProcessorDeps {
  payload: Payload
  /** Injektálható tár (teszteléshez); alapból a valódi Payload-adapter. */
  store?: WebhookEventStore
  logger?: Logger
  /**
   * Injektálható (teszteléshez); alapból a valódi recoverRejectedSucceededPayment.
   * Tesztből élő Barion-refund tilos.
   */
  recoverRejectedPaid?: (
    input: RecoverRejectedSucceededPaymentInput,
  ) => Promise<PaidRejectRecoveryResult>
}

/** A webhook-events.result select értékei (a collection sémával szinkronban). */
export type BarionCallbackResult = 'paid' | 'cancelled' | 'pending_repoll' | 'rejected' | 'failed'

interface OrderLookupResult {
  order: Order
  /** true, ha a rendelés a barionPaymentId helyett az orderNumber (PaymentRequestId) alapján találódott. */
  foundByOrderNumber: boolean
}

/**
 * Barion provider-hibakódok, amelyek BIZTOSAN azt jelentik: nincs ilyen fizetés.
 *
 * BIZONYOSSÁG — pontosan ennyi: a `PaymentNotFound` a repo teszt-fixtúrájában
 * rögzített megfigyelés (a GetState ismeretlen PaymentId-re HTTP 4xx +
 * Errors tömbbel válaszol, lásd barion-callback.test.ts). A BARION_AUTH_ERROR_CODES
 * konvencióját követve PONTOS (kis-nagybetűt nem néző) egyezésre szűrünk —
 * egy tévedésből felvett kód VALÓDI, átmeneti hibát is véglegesen elutasítana.
 * Új kódot CSAK hivatkozott forrás alapján vegyél fel ide. A Barion egyetlen
 * dokumentált, ismeretlen fizetésre utaló kódja a `NotExistingPaymentId` („The
 * specified payment id is invalid."), de csak a Payment/Refund végpontnál
 * (Error_codes_notifications, Wayback 20241014080026); a PaymentState v4-re
 * nincs dokumentált not-found kód, ezért az éles válasz rögzítéséig nem
 * vesszük fel.
 */
export const BARION_PAYMENT_NOT_FOUND_ERROR_CODES: readonly string[] = ['PaymentNotFound']

/**
 * A GetState-hiba DEFINITÍV „nincs ilyen fizetés" kimenetel-e (M6).
 *
 * KIZÁRÓLAG egy ismert payment-not-found provider-hibakód számít (akár HTTP
 * 200-as Errors tömbben, akár 4xx mellett — a kliens mindkettőt megőrzi a
 * providerErrors-ben). A puszta HTTP 404 NEM elég: a Barion útvonal-eltérésre
 * is 404-et ad („No HTTP resource was found that matches the request URI",
 * Errors tömb nélkül, mérve 2026-09-24 a kötőjeles PaymentId-vel), és egy
 * közbülső proxy vagy CDN 404-e sem különböztethető meg tőle. Ha ezt „nincs
 * ilyen fizetés"-nek vennénk, egy útvonal- vagy verzióváltás után a fizetett
 * rendelések callbackje terminálisan elutasítódna, a függők pedig lezárulnának.
 *
 * Minden más hiba (timeout, hálózat, 5xx, hitelesítés, ismeretlen kód, puszta
 * 404) NEM terminális: azokra a webhook-retry újrapróbálása értelmes.
 */
export function isPaymentDefinitelyNotFound(error: BarionApiError): boolean {
  return error.providerErrors.some((providerError) =>
    BARION_PAYMENT_NOT_FOUND_ERROR_CODES.some(
      (code) => code.toLowerCase() === providerError.ErrorCode.toLowerCase(),
    ),
  )
}

/**
 * HTTP 404 ismert not-found kód nélkül: a válasz NEM bizonyítja, hogy a
 * fizetés nem létezik (útvonal- vagy verzióváltás, közbülső 404, azonosító-
 * formátum hiba). A hívók újrapróbálható, riasztandó hibaként kezelik.
 */
export function isUnverifiedNotFound(error: BarionApiError): boolean {
  return error.httpStatus === 404 && !isPaymentDefinitelyNotFound(error)
}

async function findOrderForPayment(
  payload: Payload,
  paymentId: string,
  paymentRequestId: string | undefined,
): Promise<OrderLookupResult | null> {
  const byPaymentId = await payload.find({
    collection: 'orders',
    where: { barionPaymentId: { equals: paymentId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const direct = byPaymentId.docs[0] as Order | undefined
  if (direct) {
    return { order: direct, foundByOrderNumber: false }
  }

  // Fallback: a checkout a barionPaymentId mentése ELŐTT állhatott meg — a
  // GetState-válasz (Barion által hitelesített!) PaymentRequestId-je az
  // orderNumber, azzal is megkeressük, és a hiányzó barionPaymentId-t pótoljuk.
  if (paymentRequestId) {
    const byOrderNumber = await payload.find({
      collection: 'orders',
      where: { orderNumber: { equals: paymentRequestId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const byNumber = byOrderNumber.docs[0] as Order | undefined
    if (byNumber) {
      return { order: byNumber, foundByOrderNumber: true }
    }
  }
  return null
}

/** Az esemény végleges lezárása: processedAt + result beírása. */
async function closeEvent(
  store: WebhookEventStore,
  event: WebhookEventDoc,
  result: BarionCallbackResult,
): Promise<void> {
  await store.update({
    collection: 'webhook-events',
    id: event.id,
    data: { processedAt: new Date().toISOString(), result },
    overrideAccess: true,
  })
}

/**
 * NEM TERMINÁLIS jelölés: CSAK a `result` íródik, a `processedAt` SZÁNDÉKOSAN
 * üresen marad — az esemény újrafeldolgozható (a státuszt a processWebhook
 * hagyja `received`-en, lásd isNonTerminalHandlerOutcome).
 */
async function markEventPending(store: WebhookEventStore, event: WebhookEventDoc): Promise<void> {
  await store.update({
    collection: 'webhook-events',
    id: event.id,
    data: { result: 'pending_repoll' satisfies BarionCallbackResult },
    overrideAccess: true,
  })
}

/**
 * A Barion callback-feldolgozó factory-ja — a visszaadott WebhookHandler a
 * processWebhook státuszgépébe és a webhook-retry jobba is beköthető.
 */
export function createBarionCallbackProcessor(deps: BarionCallbackProcessorDeps): WebhookHandler {
  const store = deps.store ?? webhookEventStore(deps.payload)
  const log = (deps.logger ?? logger).child({ module: 'barion-callback' })
  const recoverRejectedPaid = deps.recoverRejectedPaid ?? recoverRejectedSucceededPayment

  return async function processBarionCallbackEvent(event: WebhookEventDoc): Promise<unknown> {
    // KANONIKUS (kisbetűs, kötőjeles) alak: a Barion GUID kis-nagybetű- és
    // kötőjel-független, a Postgres `equals` nem. A route-handler már
    // kanonizál, de a KORÁBBAN tárolt webhook-events sorok externalId-ja más
    // alakú is lehet — kanonizálás nélkül a rendelés-lookup nem találna, a
    // barionPaymentId-összevetés pedig hamis alias-konfliktust jelezne.
    const paymentId = canonicalBarionGuid(event.externalId) ?? event.externalId.toLowerCase()
    const eventLog = log.child({ paymentId, eventId: event.id })

    try {
      // 1. Szerver-szerver verifikáció (v4) — az EGYETLEN bizonyíték.
      const state = await fetchPaymentState(paymentId)
      const mapped = mapBarionPaymentStatus(state.Status)
      eventLog.info('barion-callback: fizetésállapot verifikálva', {
        barionStatus: state.Status,
        mappedStatus: mapped,
      })

      // 2. Rendelés-azonosítás (barionPaymentId, fallback: PaymentRequestId = orderNumber).
      const found = await findOrderForPayment(deps.payload, paymentId, state.PaymentRequestId)
      if (!found) {
        // NEM csendes elnyelés: riasztás a naplóba + throw → failed (újrapróbálható,
        // kimerülésnél a retry-job owner-riasztást logol).
        eventLog.error(
          'RIASZTÁS: a Barion-fizetéshez nem található rendelés (ismeretlen vagy árva PaymentId)',
          {
            paymentRequestId: state.PaymentRequestId ?? null,
            barionStatus: state.Status,
          },
        )
        throw new Error(`a Barion-fizetéshez (${paymentId}) nem tartozik rendelés az adatbázisban`)
      }
      const { order } = found
      if (found.foundByOrderNumber) {
        // FALLBACK-PÁROSÍTÁS: itt NEM a barionPaymentId kötötte a fizetést a
        // rendeléshez, hanem a Barion által visszaadott PaymentRequestId. A
        // párosítás ezért önmagában gyengébb bizonyíték — mielőtt bármit
        // írnánk a rendelésre, az ÖSSZEG-ASSERTNEK is teljesülnie kell.
        const pairing = assertPaymentAmountMatches(order, state)
        if (!pairing.ok) {
          eventLog.error(
            'RIASZTÁS: orderNumber-alapú párosítás ELUTASÍTVA — a fizetés összege/devizája nem egyezik a rendeléssel',
            {
              orderId: order.id,
              orderNumber: order.orderNumber,
              detail: pairing.detail,
              expectedTotal: pairing.expectedTotal ?? null,
              actualTotal: pairing.actualTotal ?? null,
              expectedCurrency: pairing.expectedCurrency ?? null,
              actualCurrency: pairing.actualCurrency ?? null,
              barionStatus: state.Status,
            },
          )
          await closeEvent(store, event, 'rejected')
          return { status: 'rejected', reason: 'total-mismatch', orderId: order.id }
        }
        if (
          order.barionPaymentId &&
          order.barionPaymentId.toLowerCase() !== paymentId &&
          !sameBarionGuid(order.barionPaymentId, paymentId)
        ) {
          // A rendeléshez MÁS fizetés van kötve: a felülírás elszakítaná a
          // valódi fizetéstől. Nem írunk, riasztunk.
          eventLog.error(
            'RIASZTÁS: a rendeléshez már MÁS Barion-fizetés tartozik — a barionPaymentId felülírása elutasítva',
            { orderId: order.id, orderNumber: order.orderNumber },
          )
          await closeEvent(store, event, 'rejected')
          return { status: 'rejected', reason: 'payment-id-conflict', orderId: order.id }
        }
        eventLog.warn(
          'barion-callback: a rendelés orderNumber alapján találódott — barionPaymentId pótolva',
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
          },
        )
        await deps.payload.update({
          collection: 'orders',
          id: order.id,
          data: { barionPaymentId: paymentId },
          overrideAccess: true,
        })
      }
      const orderLog = eventLog.child({ orderId: order.id, orderNumber: order.orderNumber })

      // 3. Állapotgép-átmenet a KÖZÖS MAGGAL (a poll-job is ezt futtatja).
      //    A NYERS state is átmegy: a mag a Total/Currency mezőt a rendelés
      //    szerver-oldali snapshotjához méri, és eltérésnél elutasít. Ez az
      //    orderNumber-alapú fallback-párosítási ágra IS vonatkozik — ott a
      //    rendelést nem a barionPaymentId kötötte a fizetéshez, tehát az
      //    összeg-egyezés az egyetlen, ami a párosítást igazolja.
      const transition = await applyBarionStateTransition({
        payload: deps.payload,
        order,
        mapped,
        state,
        log: orderLog,
      })

      // 4. Friss paid-átmenet mellékhatásai (számla-job + visszaigazoló e-mail).
      //    Az onOrderPaid sosem dob — a callback-feldolgozás ettől nem bukhat el.
      //    A feloldott fiók (vendég-vásárlásnál MOST létrehozott vagy megtalált)
      //    dönti el a levél változatát: jelszó-beállító link vagy belépés.
      if (transition.transitionedToPaid) {
        await onOrderPaid({
          payload: deps.payload,
          order,
          logger: orderLog,
          ...(transition.customer
            ? {
                account: {
                  passwordSetupPending: transition.customer.passwordSetupPending,
                  alreadyLinked: transition.customer.alreadyLinked,
                  email: transition.customer.email,
                },
              }
            : {}),
        })
      }

      // 5. Esemény-lezárás az akcióhoz rendelt result-tal.
      if (transition.action === 'pending') {
        // B4 — A FÜGGŐ ÁLLAPOT NEM VÉGLEGES. A Barion ugyanezzel a PaymentId-vel
        // küld újabb callbacket a végleges státuszról (Succeeded/Canceled): ha az
        // eseményt itt lezárnánk, a dedup a LÉNYEGES kézbesítést dobná el
        // duplikátumként, és a rendelés sosem lenne paid a callback-úton.
        // Ezért csak a `result` jelölődik, a `processedAt` üresen marad, és a
        // `webhookNonTerminal` jelző a rekordot `received` státuszban hagyja.
        await markEventPending(store, event)
        return {
          status: 'payment_pending',
          webhookNonTerminal: true,
          orderId: order.id,
          orderNumber: order.orderNumber,
        }
      }
      if (transition.action === 'cancelled') {
        await closeEvent(store, event, 'cancelled')
        return {
          status: 'cancelled',
          ...(transition.duplicate ? { duplicate: true } : {}),
          orderId: order.id,
          orderNumber: order.orderNumber,
        }
      }
      if (transition.action === 'rejected') {
        if (mapped === 'paid') {
          const rejectReason = transition.reason ?? 'unknown'
          const recovery = await recoverRejectedPaid({
            payload: deps.payload,
            order,
            state,
            reason: rejectReason,
            log: orderLog,
            source: 'callback',
          })
          const recoveryCtx = paidRejectRecoveryLogContext({
            source: 'callback',
            action: recovery.action,
            detail: recovery.detail,
            reason: rejectReason,
            orderId: order.id,
          })
          orderLog.info('paid-reject recovery lefutott', recoveryCtx)
          if (recovery.action === 'failed') {
            orderLog.error(
              'RIASZTÁS: paid-reject recovery sikertelen — a webhook-esemény retryable marad',
              recoveryCtx,
            )
            throw new Error(`paid-reject recovery sikertelen (${recovery.detail ?? 'unknown'})`)
          }
        }
        await closeEvent(store, event, 'rejected')
        return { status: 'rejected', reason: transition.reason, orderId: order.id }
      }

      // transition.action === 'paid'
      await closeEvent(store, event, 'paid')
      return {
        status: 'paid',
        duplicate: transition.duplicate === true,
        orderId: order.id,
        orderNumber: order.orderNumber,
        purchasesGranted: transition.purchasesGranted,
      }
    } catch (error) {
      // M6 — TERMINÁLIS ÁG: a Barion szerint BIZTOSAN nincs ilyen fizetés
      // (ismert payment-not-found provider-kód). Az újrapróbálás
      // sosem sikerülhet, ezért az eseményt NEM failed-re, hanem rejected-re
      // zárjuk (processedAt beírva), és NEM dobunk — a processWebhook így
      // processed-re állítja, a webhook-retry pedig többé nem veszi sorra.
      // A riasztás megmarad: a hamis/árva GUID továbbra is látszik a naplóban.
      if (error instanceof BarionApiError && isPaymentDefinitelyNotFound(error)) {
        eventLog.error(
          'RIASZTÁS: ismeretlen vagy hamis PaymentId — a Barion szerint nincs ilyen fizetés; az esemény terminálisan elutasítva (újrapróbálás NEM indul)',
          {
            kind: error.kind,
            httpStatus: error.httpStatus ?? null,
            providerErrorCodes: error.providerErrors.map(
              (providerError) => providerError.ErrorCode,
            ),
            error: error.message,
          },
        )
        await closeEvent(store, event, 'rejected')
        return { status: 'rejected', reason: 'payment-not-found' }
      }

      // Hibaág: a result='failed' best-effort jelölés (a státuszt/lastErrort a
      // processWebhook állítja); a processedAt SZÁNDÉKOSAN NULL marad — az
      // esemény a webhook-retry jobbal újrapróbálható.
      await store
        .update({
          collection: 'webhook-events',
          id: event.id,
          data: { result: 'failed' },
          overrideAccess: true,
        })
        .catch(() => undefined)
      if (error instanceof BarionApiError) {
        if (isUnverifiedNotFound(error)) {
          // Puszta 404 (Barion-hibajelzés nélkül): nem bizonyítja, hogy nincs
          // ilyen fizetés. Az esemény újrapróbálható marad, de ez tipikusan
          // útvonal- vagy verzióváltás, ami MINDEN callbacket érint: riasztás.
          eventLog.error(
            'RIASZTÁS: a Barion PaymentState HTTP 404-et adott „nincs ilyen fizetés" jelzés nélkül — ' +
              'az esemény újrapróbálható marad. Ellenőrizd a BARION_API_URL-t és a PaymentState-útvonalat.',
            {
              kind: error.kind,
              httpStatus: error.httpStatus ?? null,
              providerErrorCodes: error.providerErrors.map(
                (providerError) => providerError.ErrorCode,
              ),
              error: error.message,
            },
          )
        } else if (error.kind === 'provider') {
          // Ismeretlen/árva PaymentId-gyanús provider-hiba (HTTP 200-as Errors
          // tömb) — riasztás, de az újrapróbálás még járhat (pl. átmeneti
          // szolgáltatói hiba is lehet).
          eventLog.error(
            'RIASZTÁS: ismeretlen vagy hamis PaymentId — a GetState hibát ad (lehetséges árva/ásított callback)',
            {
              kind: error.kind,
              httpStatus: error.httpStatus ?? null,
              error: error.message,
            },
          )
        } else {
          eventLog.warn('barion-callback: GetState-hiba (újrapróbálható)', {
            kind: error.kind,
            httpStatus: error.httpStatus ?? null,
            error: error.message,
          })
        }
      } else {
        eventLog.error('barion-callback: feldolgozási hiba (újrapróbálható)', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }
}

/**
 * A feldolgozó regisztrálása a webhook-retry jobhoz (T-014 registerWebhookProcessor).
 * A webhook-route import idején hívja — így a sikertelen (failed) eseményeket a
 * percenkénti retry-job a regisztrált handlerrel, exponenciális backoff-fal
 * futtatja újra, MAX_WEBHOOK_ATTEMPTS után owner-riasztással.
 */
export function registerBarionWebhookProcessor(getPayload: () => Promise<Payload>): void {
  registerWebhookProcessor('barion', async (event) => {
    const payload = await getPayload()
    return createBarionCallbackProcessor({ payload })(event)
  })
}
