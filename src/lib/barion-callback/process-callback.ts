import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withSessionAdvisoryLock } from '../advisory-lock'
import {
  BarionApiError,
  fetchPaymentState,
  mapBarionPaymentStatus,
  type BarionPaymentStateResponse,
} from '../barion'
import { isBarionRateLimited } from '../barion/client'
import { canonicalBarionGuid, sameBarionGuid } from '../barion/guid'
import {
  isTerminallyProcessed,
  processWebhook,
  registerWebhookProcessor,
  webhookEventStore,
  type ProcessWebhookOutcome,
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

/**
 * A zár ELŐTT lekért PaymentState (vagy a lekérés hibája). A callback-úton a
 * Barion-hívás nem mehet a callback-zár alá (a-callback-7): a futtató
 * (runBarionCallbackEvent) előbb lekéri, a feldolgozó ezt használja.
 */
export type PrefetchedPaymentState =
  { ok: true; state: BarionPaymentStateResponse } | { ok: false; error: unknown }

export interface BarionCallbackProcessorDeps {
  payload: Payload
  /** Injektálható tár (teszteléshez); alapból a valódi Payload-adapter. */
  store?: WebhookEventStore
  /** A kérés naplózója (requestId-vel); nélküle a gyökér-logger. */
  logger?: Logger
  /** Ha megadott, a feldolgozó NEM hív Bariont, ezt az eredményt használja. */
  prefetchedState?: PrefetchedPaymentState
  /**
   * Ha megadott, a friss paid-átmenet mellékhatását (onOrderPaid: e-mail,
   * számla-job) nem futtatja, hanem átadja: a futtató a zár elengedése UTÁN
   * indítja (a Resend-hívás ne tartsa a callback-zárat).
   */
  deferPaidSideEffect?: (run: () => Promise<void>) => void
  /**
   * true: a hibaágon a feldolgozó NEM jelöli az eseményt `result: 'failed'`-re.
   * A lezárt (cancelled) esemény újraellenőrzése (r-barion-7) használja: egy
   * lezárt rekord eredményét egy átmeneti hiba nem írhatja át, különben a
   * rekord `processed` + `failed` alakban többé nem lenne újraellenőrizhető
   * (minden későbbi callback duplikátum lenne), és a naplóból eltűnne az
   * eredeti `cancelled` kimenetel.
   */
  preserveResultOnError?: boolean
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

/** Ismert Barion auth-hibakódok (pontos egyezés — ne regex, poison pill ellen). */
export const BARION_AUTH_ERROR_CODES: readonly string[] = ['AuthenticationFailed']

/**
 * Hitelesítési hiba-e a Barion-válasz: HTTP 401/403, vagy ismert auth-hibakód
 * (akár HTTP 200-as Errors tömbben). Az order-poll ilyenkor az egész futást
 * megszakítja (classifyBarionFailure 'auth'), ezért a callback és a pénztár
 * sem vonhat le belőle semmit a fizetés létezéséről.
 */
export function isBarionAuthFailure(error: BarionApiError): boolean {
  if (error.httpStatus === 401 || error.httpStatus === 403) {
    return true
  }
  return error.providerErrors.some((providerError) =>
    BARION_AUTH_ERROR_CODES.some(
      (code) => code.toLowerCase() === providerError.ErrorCode.toLowerCase(),
    ),
  )
}

/**
 * Barion provider-hibakódok, amelyek BIZTOSAN azt jelentik: nincs ilyen fizetés.
 *
 * A BARION_AUTH_ERROR_CODES konvencióját követve PONTOS (kis-nagybetűt nem
 * néző) egyezésre szűrünk: egy tévedésből felvett kód VALÓDI, átmeneti hibát is
 * véglegesen elutasítana. Új kódot CSAK hivatkozott forrás alapján vegyél fel.
 *
 * - `NotExistingPaymentId`: a Barion egyetlen DOKUMENTÁLT, ismeretlen fizetésre
 *   utaló kódja („The specified payment id is invalid.", docs.barion.com
 *   Error_codes_notifications, Wayback 20241014080026). A dokumentáció a
 *   Payment/Refund résznél sorolja fel, de a kód nem csak ott fordul elő: a
 *   nyilvános go-barion kliens tesztje (github.com/miklosn/go-barion,
 *   pkg/barion/client_test.go, TestPaymentRequestError) egy Barion-hibatörzset
 *   használ, amelynek EndPoint mezője a v2 GetPaymentState-végpont, a kódja
 *   ugyanez („The given payment id is invalid"). Ez a törzs a HTTP-státuszra
 *   NEM bizonyíték: a teszt kézzel mockolt HTTP 501-es választ ad vele a
 *   Payment/Start-ra. A refund-ág már végleges kódnak veszi
 *   (refund/barion-refund-evidence.ts).
 * - `PaymentNotFound`: a repo korábbi teszt-fixtúrájának kódja (bb49a36). Élő
 *   forrása nincs; a korábbi viselkedés megőrzése miatt marad a listán.
 *
 * A PaymentState v4-re a Barion nem dokumentál saját not-found kódot. Ha az
 * éles válasz egyszer rögzítve lesz, és más kódot hoz, azt ide kell felvenni.
 * A puszta HTTP 404 (Errors tömb nélkül) SZÁNDÉKOSAN nincs itt, lásd
 * isPaymentDefinitelyNotFound.
 */
export const BARION_PAYMENT_NOT_FOUND_ERROR_CODES: readonly string[] = [
  'NotExistingPaymentId',
  'PaymentNotFound',
]

/**
 * A GetState-hiba DEFINITÍV „nincs ilyen fizetés" kimenetel-e (M6).
 *
 * KIZÁRÓLAG egy ismert payment-not-found provider-hibakód számít (akár HTTP
 * 200-as Errors tömbben, akár 4xx mellett — a kliens mindkettőt megőrzi a
 * providerErrors-ben; a 404 + NotExistingPaymentId tehát definitív). A puszta
 * HTTP 404 NEM elég: a Barion útvonal-eltérésre
 * is 404-et ad („No HTTP resource was found that matches the request URI",
 * Errors tömb nélkül, mérve 2026-09-24 a kötőjeles PaymentId-vel), és egy
 * közbülső proxy vagy CDN 404-e sem különböztethető meg tőle. Ha ezt „nincs
 * ilyen fizetés"-nek vennénk, egy útvonal- vagy verzióváltás után a fizetett
 * rendelések callbackje terminálisan elutasítódna, a függők pedig lezárulnának.
 *
 * Minden más hiba (timeout, hálózat, 5xx, hitelesítés, ismeretlen kód, puszta
 * 404) NEM terminális: azokra a webhook-retry újrapróbálása értelmes. Az 5xx
 * és a hitelesítési hiba (HTTP 401/403 vagy auth-hibakód, isBarionAuthFailure)
 * akkor sem definitív, ha a törzsében not-found kód áll: szerverhibánál a
 * törzs nem megbízható, egy elutasított kulcs pedig semmit nem mond arról,
 * hogy a fizetés létezik-e. Így mindhárom hívó (callback, pénztár, order-poll
 * „transport" / „auth") ugyanúgy, átmeneti hibaként kezeli.
 */
export function isPaymentDefinitelyNotFound(error: BarionApiError): boolean {
  if ((error.httpStatus ?? 0) >= 500 || isBarionAuthFailure(error)) {
    return false
  }
  return error.providerErrors.some((providerError) =>
    BARION_PAYMENT_NOT_FOUND_ERROR_CODES.some(
      (code) => code.toLowerCase() === providerError.ErrorCode.toLowerCase(),
    ),
  )
}

/**
 * HTTP 404 ismert not-found kód nélkül: a válasz NEM bizonyítja, hogy a
 * fizetés nem létezik (útvonal- vagy verzióváltás, közbülső 404, azonosító-
 * formátum hiba). A hívók újrapróbálható, riasztandó hibaként kezelik. Egyetlen
 * kivétel: az order-poll a 24 óránál régebbi függő sort lezárja, ha ugyanabban
 * a futásban egy MÁSIK GetState sikeres volt, vagy (csendes boltban) a futás
 * végi útvonal-próba, azaz a legutóbb frissült paid rendelés GetState-je
 * sikeres. Mindkettő azt bizonyítja, hogy az útvonal és a POSKey működik, a
 * 404 tehát csak erre a fizetésre vonatkozik (lásd order-poll/service.ts).
 * Auth-hibakóddal jött 404 nem ide tartozik: az hitelesítési hiba
 * (isBarionAuthFailure), mint az order-pollban.
 */
export function isUnverifiedNotFound(error: BarionApiError): boolean {
  return (
    error.httpStatus === 404 && !isPaymentDefinitelyNotFound(error) && !isBarionAuthFailure(error)
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
      // 1. Szerver-szerver verifikáció (v4) — az EGYETLEN bizonyíték. A
      //    callback-úton a futtató a zár ELŐTT kéri le (prefetchedState).
      const prefetched = deps.prefetchedState
      if (prefetched && !prefetched.ok) {
        throw prefetched.error
      }
      const state = prefetched
        ? prefetched.state
        : await fetchPaymentState(paymentId, undefined, { logger: eventLog })
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
        const runPaidSideEffect = () =>
          onOrderPaid({
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
        if (deps.deferPaidSideEffect) {
          deps.deferPaidSideEffect(runPaidSideEffect)
        } else {
          await runPaidSideEffect()
        }
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
      // esemény a webhook-retry jobbal újrapróbálható. A lezárt esemény
      // újraellenőrzésénél (preserveResultOnError) nincs jelölés: a rekord
      // lezárt és cancelled marad.
      if (!deps.preserveResultOnError) {
        await store
          .update({
            collection: 'webhook-events',
            id: event.id,
            data: { result: 'failed' },
            overrideAccess: true,
          })
          .catch(() => undefined)
      }
      if (error instanceof BarionApiError) {
        if (isBarionRateLimited(error)) {
          // HTTP 429 (a kapu egy késleltetett újrapróbálása után is): átmeneti
          // fojtás, a fizetésről nem mond semmit. A webhook-retry backoffal
          // újrapróbálja; nem riasztás.
          eventLog.warn(
            'barion-callback: a Barion fojtotta a PaymentState-et (HTTP 429) — újrapróbálható',
            {
              httpStatus: error.httpStatus ?? null,
            },
          )
        } else if (isUnverifiedNotFound(error)) {
          // Puszta 404 (Barion-hibajelzés nélkül): nem bizonyítja, hogy nincs
          // ilyen fizetés. Az esemény újrapróbálható marad (a callback-úton
          // SOSEM zárunk le heurisztikára), és riasztunk: ha minden callback
          // így jár, az útvonal- vagy verzióváltás.
          eventLog.error(
            'RIASZTÁS: a Barion PaymentState HTTP 404-et adott „nincs ilyen fizetés" jelzés nélkül — ' +
              'az esemény újrapróbálható marad. Ha minden fizetésnél ez jön, ellenőrizd a ' +
              'BARION_API_URL-t és a PaymentState-útvonalat; ha csak ennél, a fizetés valószínűleg ' +
              'a másik Barion-környezetben indult (BARION_ENVIRONMENT-váltás).',
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

/** A callback-feldolgozás (GetState-átmenet) sorosító advisory-zárának kulcsa egy PaymentId-re. */
export function callbackLockKey(paymentId: string): string {
  return `barion-callback:${paymentId}`
}

export interface RunBarionCallbackEventParams {
  payload: Payload
  /** KANONIKUS (kisbetűs, kötőjeles) PaymentId — a webhook-events externalId-ja. */
  paymentId: string
  store?: WebhookEventStore
  requestId?: string
  logger?: Logger
  recoverRejectedPaid?: BarionCallbackProcessorDeps['recoverRejectedPaid']
  /**
   * 'recheck-cancelled': a terminálisan `cancelled`-re zárt eseményt is
   * újrafeldolgozza (r-barion-7: egy fiatal rendelés lezárt fizetésére érkező
   * újabb callback a késői sikert hozhatja). A kísérletszám nem nő.
   */
  mode?: 'process' | 'recheck-cancelled'
}

/**
 * EGY callback-esemény teljes feldolgozása a route-on (`after`). A
 * webhook-retry NEM ezt hívja: ott a regisztrált feldolgozó ugyanazon a
 * callback-záron (callbackLockKey, session-szintű zár) fut, a GetState és a
 * paid-mellékhatás tehát a retry-úton a záron BELÜL marad (tétlen tranzakció
 * nincs, de egy dedikált kapcsolat a HTTP idejére foglalt; lásd
 * jobs/tasks/webhook-retry.ts).
 *
 * Sorrend (a-callback-7: kimenő HTTP nem tart adatbázis-zárat):
 * 1. PaymentState a zár ELŐTT (a PaymentId-nkénti kapun át; hibája is
 *    eredmény, a zár alatt a státuszgép rögzíti);
 * 2. session-szintű callback-zár (dedikált kapcsolat, nincs tétlen
 *    tranzakció) → processWebhook friss olvasással: ha közben egy másik futás
 *    lezárta, no-op;
 * 3. a zár elengedése UTÁN a paid-mellékhatás (onOrderPaid, soha nem dob).
 *
 * Egy elavult előre-lekérés nem árt: az állapotgép monoton (paid-ről nincs
 * visszalépés), a már lezárt eseményt a processWebhook nem futtatja újra, egy
 * függő (Prepared) eredmény pedig nem terminális — a következő callback vagy a
 * webhook-retry friss állapottal újra feldolgozza.
 */
export async function runBarionCallbackEvent(
  params: RunBarionCallbackEventParams,
): Promise<ProcessWebhookOutcome> {
  const store = params.store ?? webhookEventStore(params.payload)
  const log = params.logger ?? logger
  let prefetchedState: PrefetchedPaymentState
  try {
    prefetchedState = {
      ok: true,
      state: await fetchPaymentState(params.paymentId, undefined, { logger: log }),
    }
  } catch (error) {
    prefetchedState = { ok: false, error }
  }

  const deferred: { paidSideEffect: (() => Promise<void>) | null } = { paidSideEffect: null }
  const createHandler = (preserveResultOnError: boolean) =>
    createBarionCallbackProcessor({
      payload: params.payload,
      store,
      logger: log,
      prefetchedState,
      deferPaidSideEffect: (run) => {
        deferred.paidSideEffect = run
      },
      preserveResultOnError,
      ...(params.recoverRejectedPaid ? { recoverRejectedPaid: params.recoverRejectedPaid } : {}),
    })

  try {
    return await withSessionAdvisoryLock(
      params.payload,
      callbackLockKey(params.paymentId),
      async () => {
        if (params.mode === 'recheck-cancelled') {
          const existing = await store.find({
            collection: 'webhook-events',
            where: {
              and: [
                { provider: { equals: 'barion' } },
                { externalId: { equals: params.paymentId } },
              ],
            },
            limit: 1,
            overrideAccess: true,
          })
          const record = existing.docs[0]
          if (record && isTerminallyProcessed(record) && record.result === 'cancelled') {
            const attempts = record.attempts ?? 0
            if (!prefetchedState.ok) {
              // A GetState nem sikerült (átmeneti hiba, 429): nincs új
              // bizonyíték, a lezárt esemény érintetlen marad (status, result,
              // processedAt). A következő Barion-callback a fojtási ablak után
              // újra ellenőriz; a mentőháló a late-success scan.
              const error = prefetchedState.error
              log.warn(
                'barion-callback: a lezárt fizetés újraellenőrzése nem sikerült (GetState-hiba) — az esemény cancelled marad',
                {
                  eventId: record.id,
                  error: error instanceof Error ? error.message : String(error),
                },
              )
              return {
                kind: 'failed',
                eventId: record.id,
                attempts,
                retryable: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
            try {
              const result = await createHandler(true)(record)
              return { kind: 'processed', eventId: record.id, attempts, result }
            } catch (error) {
              // A lezárt esemény lezárt és cancelled marad (preserveResultOnError);
              // a mentőháló a következő callback és a late-success scan.
              return {
                kind: 'failed',
                eventId: record.id,
                attempts,
                retryable: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          }
        }
        return processWebhook({
          store,
          provider: 'barion',
          externalId: params.paymentId,
          ...(params.requestId ? { requestId: params.requestId } : {}),
          handler: createHandler(false),
        })
      },
      log,
    )
  } finally {
    // A paid-átmenet megtörtént: a mellékhatás a feldolgozás további
    // kimenetelétől (pl. a lezárás írásának hibájától) függetlenül fut, mert
    // egy újrapróbálás már paid rendelést lát, és nem indítaná újra.
    if (deferred.paidSideEffect !== null) {
      await deferred.paidSideEffect()
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
