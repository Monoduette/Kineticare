import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { BarionApiError, fetchPaymentState, mapBarionPaymentStatus } from '../barion'
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

/**
 * Barion-callback aszinkron feldolgozó. A payload nem bizonyíték: csak v4
 * GetState. Állapotgép: apply-barion-state (ugyanaz, mint az order-poll).
 * Prepared/Started → pending_repoll, processedAt NULL. Ismeretlen fizetés
 * (404) terminális rejected. GetState 5xx/timeout dob → retry.
 */

export interface BarionCallbackProcessorDeps {
  payload: Payload
  /** Injektálható tár (teszteléshez); alapból a valódi Payload-adapter. */
  store?: WebhookEventStore
  logger?: Logger
}

/** A webhook-events.result select értékei (a collection sémával szinkronban). */
export type BarionCallbackResult =
  | 'paid'
  | 'cancelled'
  | 'pending_repoll'
  | 'rejected'
  | 'failed'

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
 * Új kódot CSAK hivatkozott forrás alapján vegyél fel ide.
 */
export const BARION_PAYMENT_NOT_FOUND_ERROR_CODES: readonly string[] = ['PaymentNotFound']

/**
 * A GetState-hiba DEFINITÍV „nincs ilyen fizetés" kimenetel-e (M6).
 *
 * Két, egymást kiegészítő jel:
 * - HTTP 404: a v4 PaymentState-végpont szerint nem létezik a PaymentId;
 * - ismert payment-not-found provider-hibakód (akár HTTP 200-as Errors tömbben,
 *   akár 4xx mellett — a kliens mindkettőt megőrzi a providerErrors-ben).
 *
 * Minden más hiba (timeout, hálózat, 5xx, hitelesítés, ismeretlen kód) NEM
 * terminális: azokra a webhook-retry újrapróbálása továbbra is értelmes.
 */
export function isPaymentDefinitelyNotFound(error: BarionApiError): boolean {
  if (error.httpStatus === 404) {
    return true
  }
  return error.providerErrors.some((providerError) =>
    BARION_PAYMENT_NOT_FOUND_ERROR_CODES.some(
      (code) => code.toLowerCase() === providerError.ErrorCode.toLowerCase(),
    ),
  )
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
async function markEventPending(
  store: WebhookEventStore,
  event: WebhookEventDoc,
): Promise<void> {
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

  return async function processBarionCallbackEvent(event: WebhookEventDoc): Promise<unknown> {
    const paymentId = event.externalId
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
        if (order.barionPaymentId && order.barionPaymentId !== paymentId) {
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
      // (HTTP 404 vagy ismert payment-not-found provider-kód). Az újrapróbálás
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
            providerErrorCodes: error.providerErrors.map((providerError) => providerError.ErrorCode),
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
        if (error.kind === 'provider') {
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
