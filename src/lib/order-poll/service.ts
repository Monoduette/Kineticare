import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { shouldEmitThrottledAlert } from '../alert-throttle'
import {
  BarionApiError,
  fetchPaymentState,
  mapBarionPaymentStatus,
  type BarionPaymentStateResponse,
} from '../barion'
import { isPaymentDefinitelyNotFound } from '../barion-callback/process-callback'
import { logger as rootLogger, type Logger } from '../logger'
import { onOrderPaid, queueInvoiceIssueJob, type OrderPaidAccount } from '../order-paid'
import {
  applyBarionStateTransition,
  isLateSuccessSourceStatus,
} from '../order-status/apply-barion-state'
import { updateOrderStatusIfCurrent } from '../order-status/conditional-status'
import {
  paidRejectRecoveryLogContext,
  recoverRejectedSucceededPayment,
  type RecoverRejectedSucceededPaymentInput,
  type PaidRejectRecoveryResult,
} from '../order-status/recover-paid-reject'
import { getSzamlazzConfig } from '../szamlazz'

/**
 * order-poll — payment_pending utánpollolás GetState v4-gyel (callback mentőháló).
 * A callback nem bizonyíték; a v4 válasz a végső igazság.
 */

export const ORDER_POLL_BATCH_SIZE = 25
/** Rejected sorfej után ennyi pótlap kérhető ugyanabban a futásban. */
export const ORDER_POLL_REFILL_PAGES = 1
/** Egymást követő szállítási hibák után megszakítás; sikeres GetState nullázza. */
export const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3

/** Az első siker előtt ennyi ismeretlen kimenet után megállás (pl. új auth-hibakód). */
export const MAX_LEADING_FAILURES = 5
// Az árva-rendelés lejárata 24 óra: a Barion PaymentWindow (30 perc) és a
// banki késleltetések mellett a 2 órás türelem túl szűk volt — a 2 óra UTÁN
// befejeződő fizetés a 'paid-not-allowed' állapotgép-védelembe ütközött
// (pénz felvéve, kurzus nem). A 24 óra a késői banki feldolgozás is belefér.
export const ORPHAN_ORDER_GRACE_MS = 24 * 60 * 60 * 1000 // 24 óra
export const STUCK_ORDER_WARN_MS = 24 * 60 * 60 * 1000 // 24 óra
/**
 * Ennyi idő után zárjuk le azt a függő rendelést, amelynek PaymentId-jét a
 * Barion DEFINITÍVEN nem ismeri (404 / PaymentNotFound). Tipikus ok: a fizetés
 * a másik Barion-környezetben indult (teszt-kulcs ↔ éles kulcs váltás). A
 * 30 perces PaymentWindow kétszerese: egy frissen indított fizetés átmeneti
 * 404-e (ha egyáltalán előfordul) belefér, a végleg ismeretlen viszont nem
 * marad örökre payment_pending — a checkout ugyanerre azonnal új Startot enged.
 */
export const UNKNOWN_PAYMENT_CANCEL_AFTER_MS = 60 * 60 * 1000 // 1 óra
/**
 * R-03: a checkout cancel-and-restart cancelled rendelést hagy, a poll
 * pedig csak payment_pending-et nézett. A késői Barion Succeeded-et
 * ennyi ideig keressük (a 30 perces PaymentWindow + banki késés +
 * másnapi újrapróbálás belefér).
 */
export const LATE_SUCCESS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
export const LATE_SUCCESS_BATCH_SIZE = 10
/** Expired/no-op sorfej után ennyi pótlap kérhető ugyanabban a futásban (RF-3). */
export const LATE_SUCCESS_REFILL_PAGES = 1
export const INVOICE_RESWEEP_BATCH_SIZE = 10
export const INVOICE_PENDING_STALE_MS = 10 * 60 * 1000 // 10 perc

/** Számla-resweep kimenet: `done` | `skipped-disabled` | `skipped-config-error` | `queue-unavailable`. */
export type InvoiceResweepStatus =
  'done' | 'skipped-disabled' | 'skipped-config-error' | 'queue-unavailable'

export interface OrderPollSummary {
  scanned: number
  transitionedPaid: number
  cancelled: number
  stillPending: number
  /**
   * Érdemi vizsgálat nélkül kihagyott rendelések: (1) még türelmi időn belüli
   * árva rendelés, (2) megszakított futásban a sorra már nem került maradék
   * (lásd classifyBarionFailure és MAX_CONSECUTIVE_TRANSPORT_FAILURES).
   */
  skipped: number
  failed: number
  orphaned: number
  invoiceRequeued: number
  /** Lefutott-e a számla-resweep, és ha nem, miért nem. */
  invoiceResweep: InvoiceResweepStatus
  /** R-03: cancelled / payment_failed rendelések, amelyekre GetState ment. */
  lateSuccessScanned: number
}

export interface OrderPollDeps {
  payload: Payload
  logger?: Logger
  /** Injektálható (teszteléshez); alapból a valódi fetchPaymentState. */
  fetchState?: (paymentId: string) => Promise<BarionPaymentStateResponse>
  /**
   * Injektálható (teszteléshez); alapból a valódi onOrderPaid. A második
   * paraméter a paid-átmenet által feloldott fiók — ettől függ a visszaigazoló
   * levél változata (jelszó-beállító link vagy belépés-hivatkozás).
   */
  onPaid?: (order: Order, account?: OrderPaidAccount) => Promise<void>
  /**
   * Injektálható (teszteléshez); alapból a valódi applyBarionStateTransition.
   * A W1 sorfej-teszt ezzel ad rejected / paid kimenetet GetState-enként,
   * élő Barion és a tilos-zónás állapotgép-modul módosítása nélkül.
   */
  applyTransition?: typeof applyBarionStateTransition
  /**
   * Injektálható (teszteléshez); alapból a valódi recoverRejectedSucceededPayment.
   * Terminális paid-reject után Barion-visszatérítés — élő hívás tesztből tilos.
   */
  recoverRejectedPaid?: (
    input: RecoverRejectedSucceededPaymentInput,
  ) => Promise<PaidRejectRecoveryResult>
  /** Injektálható (teszteléshez); alapból a valódi queueInvoiceIssueJob-hívás. */
  queueInvoice?: (orderId: number) => Promise<boolean>
  /**
   * Be van-e kapcsolva a Számlázz.hu-integráció? Injektálható (teszteléshez);
   * alapból a `getSzamlazzConfig().enabled` (azaz: van-e SZAMLAZZ_AGENT_KEY).
   */
  invoicingEnabled?: () => boolean
  now?: number
}

/** Ismert Barion auth-hibakódok (pontos egyezés — ne regex, poison pill ellen). */
export const BARION_AUTH_ERROR_CODES: readonly string[] = ['AuthenticationFailed']

/** A definitív rendelés-hiba forgatható; az ismeretlen hiba nem egészségbizonyíték. */
export type BarionFailureClass = 'auth' | 'order' | 'transport' | 'unknown'

export function classifyBarionFailure(error: unknown): BarionFailureClass {
  if (!(error instanceof BarionApiError)) {
    return 'unknown'
  }
  if (error.httpStatus === 401 || error.httpStatus === 403) {
    return 'auth'
  }
  if (
    error.providerErrors.some((providerError) =>
      BARION_AUTH_ERROR_CODES.some(
        (code) => code.toLowerCase() === providerError.ErrorCode.toLowerCase(),
      ),
    )
  ) {
    return 'auth'
  }
  if (error.kind === 'timeout' || error.kind === 'network') {
    return 'transport'
  }
  if ((error.httpStatus ?? 0) >= 500) {
    return 'transport'
  }
  return error.httpStatus === 404 ? 'order' : 'unknown'
}

/**
 * A Számlázz.hu-integráció állapota a poll szempontjából. A konfigfeloldás
 * DOBHAT (pl. elgépelt SZAMLAZZ_API_URL) — ezt itt elnyeljük: a poll fő
 * feladata a fizetések lezárása, azt egy számlázási konfighiba nem viheti el.
 * Hibás konfig esetén a számlázás úgysem működne, ezért a resweep kimarad — de
 * az ok RIASZTÁS-szintű naplósort kap, mert ez üzemeltetői beavatkozást kíván.
 */
function resolveInvoicingState(
  deps: OrderPollDeps,
  log: Logger,
): 'config-error' | 'disabled' | 'enabled' {
  try {
    const enabled = deps.invoicingEnabled ? deps.invoicingEnabled() : getSzamlazzConfig().enabled
    return enabled ? 'enabled' : 'disabled'
  } catch (error) {
    log.error(
      'RIASZTÁS: a Számlázz.hu-konfiguráció hibás — a számla-resweep kimarad, a kiesett ' +
        'számlák NEM állítódnak újra sorba. Ellenőrizd a Számlázz.hu környezeti változóit.',
      { error: error instanceof Error ? error.message : String(error) },
    )
    return 'config-error'
  }
}

async function resweepInvoices(
  deps: OrderPollDeps,
  log: Logger,
  summary: OrderPollSummary,
): Promise<void> {
  const invoicingState = resolveInvoicingState(deps, log)
  if (invoicingState !== 'enabled') {
    // Kikapcsolt integrációnál (nincs SZAMLAZZ_AGENT_KEY) az invoice-issue task
    // garantáltan 'disabled' kimenettel no-opol, az invoiceStatus tehát 'none'
    // marad — a resweep így MINDEN futásban újra sorba állítaná UGYANAZT a 10
    // rendelést. Élesben ez 5 percenként 10 fölösleges job-sor a payload_jobs
    // táblában (napi ~2900) és ugyanennyi félrevezető info-log. A kulcs
    // megérkezése után a resweep automatikusan behozza a lemaradást.
    // A kihagyás TÉNYE a summaryben (invoiceResweep) is látszik, tehát a
    // job-outputból megkülönböztethető a „nincs teendő" esettől.
    summary.invoiceResweep =
      invoicingState === 'disabled' ? 'skipped-disabled' : 'skipped-config-error'
    log.debug('order-poll: a számla-resweep kimarad', { invoiceResweep: summary.invoiceResweep })
    return
  }
  const now = deps.now ?? Date.now()
  const candidates = await deps.payload.find({
    collection: 'orders',
    where: {
      and: [{ status: { equals: 'paid' } }, { invoiceStatus: { in: ['none', 'pending'] } }],
    },
    sort: 'updatedAt',
    limit: INVOICE_RESWEEP_BATCH_SIZE,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])

  const queueInvoice =
    deps.queueInvoice ?? ((orderId: number) => queueInvoiceIssueJob(deps.payload, orderId, log))

  // A megpróbált és az elbukott sorba állítások száma. A kettő egyezése az
  // EGYETLEN jel arról, hogy a job-sor maga nem működik: ilyenkor a
  // `invoiceRequeued: 0` NEM azt jelenti, hogy nem volt teendő.
  let attempted = 0
  let refused = 0

  for (const order of candidates.docs as Order[]) {
    if (order.invoiceStatus === 'pending') {
      const updatedAtMs = Date.parse(order.updatedAt ?? '')
      if (Number.isFinite(updatedAtMs) && now - updatedAtMs < INVOICE_PENDING_STALE_MS) {
        continue // friss pending — valószínűleg most dolgozik rajta egy worker
      }
    }
    attempted += 1
    const queued = await queueInvoice(order.id)
    if (queued) {
      summary.invoiceRequeued += 1
    } else {
      refused += 1
    }
  }

  if (attempted > 0 && refused === attempted) {
    summary.invoiceResweep = 'queue-unavailable'
    log.error(
      'RIASZTÁS: a számla-resweep egyetlen jobot sem tudott sorba állítani — a kiesett ' +
        'számlák NEM készülnek el (a vevők viszont már kaptak számlát ígérő visszaigazolást). ' +
        'Legvalószínűbb ok: a Payload job-sor nem érhető el. Emberi beavatkozás szükséges.',
      { candidates: attempted },
    )
  }
}

/**
 * W1 — a függő ablak szűrője. Az első lap minden `payment_pending` sort
 * hoz `updatedAt` szerint; a pótlap a már látott azonosítókat kizárja, tehát
 * rejected sorokat NEM kérdezi újra (és GetState-et sem hív rájuk másodszor).
 */
function pendingOrdersWhere(excludeIds: ReadonlyArray<number>):
  | {
      status: { equals: 'payment_pending' }
    }
  | {
      and: [{ status: { equals: 'payment_pending' } }, { id: { not_in: number[] } }]
    } {
  if (excludeIds.length === 0) {
    return { status: { equals: 'payment_pending' } }
  }
  return {
    and: [{ status: { equals: 'payment_pending' } }, { id: { not_in: [...excludeIds] } }],
  }
}

function lateSuccessOrdersWhere(
  sinceIso: string,
  excludeIds: ReadonlyArray<number>,
): {
  and: Array<Record<string, unknown>>
} {
  const filters: Array<Record<string, unknown>> = [
    { status: { in: ['cancelled', 'payment_failed'] } },
    { createdAt: { greater_than_equal: sinceIso } },
    { barionPaymentId: { exists: true } },
  ]
  if (excludeIds.length > 0) {
    filters.push({ id: { not_in: [...excludeIds] } })
  }
  return { and: filters }
}

type PendingPageDecision = 'continue' | 'abort'

/** A poll-job egy futása. A visszaadott summary a job-output (és a napló). */
export async function pollPendingOrders(deps: OrderPollDeps): Promise<OrderPollSummary> {
  const log = (deps.logger ?? rootLogger).child({ module: 'order-poll' })
  const now = deps.now ?? Date.now()
  const fetchState = deps.fetchState ?? fetchPaymentState
  const onPaid =
    deps.onPaid ??
    ((order: Order, account?: OrderPaidAccount) =>
      onOrderPaid({
        payload: deps.payload,
        order,
        logger: log,
        ...(account ? { account } : {}),
      }))
  const applyTransition = deps.applyTransition ?? applyBarionStateTransition
  const recoverRejectedPaid = deps.recoverRejectedPaid ?? recoverRejectedSucceededPayment

  const summary: OrderPollSummary = {
    scanned: 0,
    transitionedPaid: 0,
    cancelled: 0,
    stillPending: 0,
    skipped: 0,
    failed: 0,
    orphaned: 0,
    invoiceRequeued: 0,
    invoiceResweep: 'done',
    lateSuccessScanned: 0,
  }

  /**
   * W1 — a legrégebben ÉRINTETT függő sorok jönnek elöl (`updatedAt` ASC).
   * A `createdAt` rendezés a rejected (mérgezett) sorokat örökre az ablak
   * elejére ragasztotta: az átmenet nem ír, a createdAt nem mozdul, a 26.
   * Succeeded rendeléshez a mentőháló sosem ért el.
   */
  const fetchPendingPage = async (excludeIds: ReadonlyArray<number>): Promise<Order[]> => {
    const page = await deps.payload.find({
      collection: 'orders',
      where: pendingOrdersWhere(excludeIds),
      sort: 'updatedAt',
      limit: ORDER_POLL_BATCH_SIZE,
      depth: 0,
      overrideAccess: true,
    } as unknown as Parameters<Payload['find']>[0])
    return page.docs as Order[]
  }

  /**
   * Egymást követő szállítási hibák (timeout / hálózat / 5xx) száma. SIKERES
   * GetState-re vagy definitív rendelésválaszra (404) nullázódik. Egy ilyen
   * válasz megszakítja a szállítási hibák egymásutánját.
   */
  let consecutiveTransportFailures = 0

  /**
   * Volt-e MÁR sikeres GetState ebben a futásban. Amíg nincs, a
   * `MAX_LEADING_FAILURES` mennyezet él (lásd ott).
   */
  let hadSuccessfulCall = false
  /** Ismeretlen kimenetű hívások száma az első SIKERES válaszig. */
  let leadingFailures = 0

  const seenIds = new Set<number>()
  let rotationFailures = 0

  // Az updatedAt a meglévő sorforgatási óra. Egy sikertelen touch nem lehet
  // új globális fék; egyetlen összegző figyelmeztetés jelzi a futás végén.
  const rotateOrder = async (order: Order): Promise<void> => {
    if (order.status !== 'payment_pending' && !isLateSuccessSourceStatus(order.status)) return
    try {
      await updateOrderStatusIfCurrent({
        payload: deps.payload,
        orderId: order.id,
        expected: order.status,
        next: order.status,
      })
    } catch {
      rotationFailures += 1
    }
  }

  const applyMappedState = async (
    order: Order,
    state: BarionPaymentStateResponse,
    orderLog: Logger,
  ): Promise<void> => {
    const mapped = mapBarionPaymentStatus(state.Status)
    const statusBefore = order.status
    if (mapped === 'payment_pending') {
      if (statusBefore === 'payment_pending') {
        summary.stillPending += 1
        const createdAtMs = Date.parse(order.createdAt ?? '')
        if (Number.isFinite(createdAtMs) && now - createdAtMs >= STUCK_ORDER_WARN_MS) {
          // A beragadt rendelés riasztása FOJTOTT (alert-throttle): az 5
          // percenkénti futás ugyanarra a — már felszínre hozott — rendelésre
          // korábban futásonként új error-sort írt; a cooldown lejártáig az
          // ismétlés elnyelődik, a nyitott ügy a cooldown után újra riaszt.
          if (shouldEmitThrottledAlert(`stuck-order:${order.id}`, undefined, now)) {
            orderLog.error(
              'RIASZTÁS: a rendelés 24 órája payment_pending — manuális ellenőrzés szükséges (Barion-státusz még mindig függő)',
              { barionStatus: state.Status, ageMs: now - createdAtMs },
            )
          }
        }
      }
      await rotateOrder(order)
      return
    }

    const transition = await applyTransition({
      payload: deps.payload,
      order,
      mapped,
      state,
      log: orderLog,
    })
    let recoveryFailed = false

    if (transition.transitionedToPaid) {
      await onPaid(
        order,
        transition.customer
          ? {
              passwordSetupPending: transition.customer.passwordSetupPending,
              alreadyLinked: transition.customer.alreadyLinked,
              email: transition.customer.email,
            }
          : undefined,
      )
      summary.transitionedPaid += 1
      orderLog.info(
        statusBefore === 'cancelled' || statusBefore === 'payment_failed'
          ? 'order-poll: késői Barion Succeeded — a cancelled rendelés paid (R-03)'
          : 'order-poll: elveszett callback pótolva — a rendelés paid (utánpollolással zárult)',
      )
    } else if (transition.action === 'paid') {
      summary.transitionedPaid += 1
    } else if (transition.action === 'cancelled') {
      if (statusBefore === 'payment_pending') {
        summary.cancelled += 1
        orderLog.info('order-poll: a fizetés lejárt/megszakadt — a rendelés cancelled')
      }
    } else if (transition.action === 'rejected') {
      summary.failed += 1
      if (mapped === 'paid') {
        const rejectReason = transition.reason ?? 'unknown'
        const recovery = await recoverRejectedPaid({
          payload: deps.payload,
          order,
          state,
          reason: rejectReason,
          log: orderLog,
          source: 'order-poll',
        })
        const recoveryCtx = paidRejectRecoveryLogContext({
          source: 'order-poll',
          action: recovery.action,
          detail: recovery.detail,
          reason: rejectReason,
          orderId: order.id,
        })
        orderLog.info('paid-reject recovery lefutott', recoveryCtx)
        if (recovery.action === 'failed') {
          recoveryFailed = recovery.detail !== 'refund-pending-reconciliation'
          orderLog.error(
            recoveryFailed
              ? 'RIASZTÁS: paid-reject recovery sikertelen — a következő futás újra ellenőrzi'
              : 'RIASZTÁS: tartós refund ellenőrzésre vár — a sor forgatható új pénzművelet nélkül',
            recoveryCtx,
          )
        }
      }
      if (!recoveryFailed && statusBefore === 'payment_pending') {
        await rotateOrder(order)
      }
      orderLog.warn('order-poll: az átmenet visszautasítva (állapotgép-védelem)', {
        reason: transition.reason ?? null,
      })
    }

    if (
      !recoveryFailed &&
      isLateSuccessSourceStatus(statusBefore) &&
      !transition.transitionedToPaid
    ) {
      await rotateOrder(order)
    }
  }

  const processPendingPage = async (pendingOrders: Order[]): Promise<PendingPageDecision> => {
    for (let index = 0; index < pendingOrders.length; index += 1) {
      const order = pendingOrders[index]
      seenIds.add(order.id)
      const orderLog = log.child({ orderId: order.id, orderNumber: order.orderNumber ?? null })

      if (!order.barionPaymentId) {
        // Árva rendelés: a Barion Payment/Start sosem jött létre (a checkout a
        // rendelés létrehozása után, a paymentId mentése előtt állt le).
        const createdAtMs = Date.parse(order.createdAt ?? '')
        if (Number.isFinite(createdAtMs) && now - createdAtMs >= ORPHAN_ORDER_GRACE_MS) {
          const cancelledWritten = await updateOrderStatusIfCurrent({
            payload: deps.payload,
            orderId: order.id,
            expected: 'payment_pending',
            next: 'cancelled',
          })
          if (!cancelledWritten) {
            summary.skipped += 1
            orderLog.warn('árva rendelés: a sor már nem payment_pending — a cancelled írás kimarad')
            continue
          }
          summary.orphaned += 1
          orderLog.warn(
            'árva rendelés (barionPaymentId nélkül) lejárt — cancelled; a vevő újrakezdheti a vásárlást',
            { ageMs: now - createdAtMs },
          )
        } else {
          summary.skipped += 1
        }
        continue
      }

      let state: BarionPaymentStateResponse
      try {
        state = await fetchState(order.barionPaymentId)
        consecutiveTransportFailures = 0
        hadSuccessfulCall = true
      } catch (error) {
        summary.failed += 1
        orderLog.warn('order-poll: GetState-hiba (a következő futás újrapollolja)', {
          error: error instanceof Error ? error.message : String(error),
        })

        const failureClass = classifyBarionFailure(error)
        const barionErrorKind = error instanceof BarionApiError ? error.kind : 'unknown'
        const httpStatus = error instanceof BarionApiError ? (error.httpStatus ?? null) : null
        const remaining = pendingOrders.length - (index + 1)

        if (failureClass === 'auth') {
          // Hitelesítési hiba: a maradék hívás garantáltan ugyanígy elhasal.
          summary.skipped += remaining
          log.error(
            'RIASZTÁS: Barion hitelesítési hiba (rossz vagy lejárt POSKey) — a futás azonnal ' +
              'megszakadt, a maradék függő rendelés érintetlen. Ellenőrizd a Barion-környezetet ' +
              'és a POSKey-t; a következő ütemezett futás újrapróbálja.',
            { barionErrorKind, httpStatus, skippedOrders: remaining },
          )
          return 'abort'
        }

        if (failureClass === 'transport') {
          consecutiveTransportFailures += 1
          if (consecutiveTransportFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
            summary.skipped += remaining
            log.error(
              `RIASZTÁS: ${MAX_CONSECUTIVE_TRANSPORT_FAILURES} egymást követő Barion-hiba ` +
                '(timeout / hálózat / 5xx) — a futás megszakadt, a maradék függő rendelés ' +
                'érintetlen. Valószínűleg szolgáltatói kimaradás; a következő ütemezett futás ' +
                'újrapróbálja.',
              {
                barionErrorKind,
                httpStatus,
                consecutiveTransportFailures,
                skippedOrders: remaining,
              },
            )
            return 'abort'
          }
        }

        if (failureClass === 'order') {
          consecutiveTransportFailures = 0
          const createdAtMs = Date.parse(order.createdAt ?? '')
          const definitelyUnknown =
            order.status === 'payment_pending' &&
            error instanceof BarionApiError &&
            isPaymentDefinitelyNotFound(error) &&
            Number.isFinite(createdAtMs) &&
            now - createdAtMs >= UNKNOWN_PAYMENT_CANCEL_AFTER_MS
          if (definitelyUnknown) {
            const cancelledWritten = await updateOrderStatusIfCurrent({
              payload: deps.payload,
              orderId: order.id,
              expected: 'payment_pending',
              next: 'cancelled',
            })
            if (cancelledWritten) {
              summary.cancelled += 1
              orderLog.warn(
                'a Barion nem ismeri a függő fizetést (404) és a PaymentWindow rég lejárt — cancelled; ' +
                  'a vevő újrakezdheti a vásárlást (tipikus ok: teszt-környezetben indított fizetés)',
                { ageMs: now - createdAtMs, httpStatus },
              )
            } else {
              orderLog.warn(
                'ismeretlen fizetés: a sor már nem payment_pending — a cancelled írás kimarad',
              )
            }
          } else {
            await rotateOrder(order)
          }
        }

        if (!hadSuccessfulCall && failureClass === 'unknown') {
          leadingFailures += 1
          if (leadingFailures >= MAX_LEADING_FAILURES) {
            summary.skipped += remaining
            log.error(
              `RIASZTÁS: ${MAX_LEADING_FAILURES} tisztázatlan Barion-hiba a futás elején ` +
                '(egyetlen sikeres válasz sem érkezett) — a futás megszakadt, a maradék függő ' +
                'rendelés érintetlen. Ellenőrizd a Barion-környezetet, a POSKey-t és a ' +
                'szolgáltatás állapotát; a következő ütemezett futás újrapróbálja.',
              {
                barionErrorKind,
                httpStatus,
                failureClass,
                leadingFailures,
                skippedOrders: remaining,
              },
            )
            return 'abort'
          }
        }

        continue
      }

      await applyMappedState(order, state, orderLog)
    }

    return 'continue'
  }

  let page = await fetchPendingPage([])
  summary.scanned += page.length
  let extraPages = 0
  let pendingAborted = false

  while (page.length > 0) {
    const pageLength = page.length
    const decision = await processPendingPage(page)
    if (decision === 'abort') {
      pendingAborted = true
      break
    }
    // Pótlap: teli ablak után egyszer, rejected ÉS still-pending sorfejre is —
    // különben 25 élő Prepared kitölti az ablakot, és a 26. Succeeded
    // (elveszett callback) erre a futásra nem kerül GetState-re.
    // A már látott azonosítók ki vannak zárva, GetState nem ismétlődik.
    if (pageLength < ORDER_POLL_BATCH_SIZE || extraPages >= ORDER_POLL_REFILL_PAGES) {
      break
    }
    extraPages += 1
    page = await fetchPendingPage([...seenIds])
    summary.scanned += page.length
  }

  // R-03 / RF-3: cancel-and-restart cancelled rendelést hagy. updatedAt ASC +
  // barionPaymentId a where-ben + egy pótlap, hogy az Expired fej ne éheztesse
  // a Succeeded sort. Auth/transport abort után NEM kérdezünk tovább.
  if (!pendingAborted) {
    const sinceIso = new Date(now - LATE_SUCCESS_LOOKBACK_MS).toISOString()
    const fetchLatePage = async (excludeIds: ReadonlyArray<number>): Promise<Order[]> => {
      const page = await deps.payload.find({
        collection: 'orders',
        where: lateSuccessOrdersWhere(sinceIso, excludeIds),
        sort: 'updatedAt',
        limit: LATE_SUCCESS_BATCH_SIZE,
        depth: 0,
        overrideAccess: true,
      } as unknown as Parameters<Payload['find']>[0])
      return page.docs as Order[]
    }

    const lateSeen = new Set<number>()
    let latePage = await fetchLatePage([])
    let lateExtraPages = 0
    let lateAborted = false

    while (latePage.length > 0) {
      summary.lateSuccessScanned += latePage.length
      const pageLength = latePage.length

      for (let index = 0; index < latePage.length; index += 1) {
        const order = latePage[index]
        lateSeen.add(order.id)
        const orderLog = log.child({ orderId: order.id, orderNumber: order.orderNumber ?? null })
        if (typeof order.barionPaymentId !== 'string' || order.barionPaymentId.length === 0) {
          continue
        }
        let state: BarionPaymentStateResponse
        try {
          state = await fetchState(order.barionPaymentId)
          consecutiveTransportFailures = 0
          hadSuccessfulCall = true
        } catch (error) {
          summary.failed += 1
          orderLog.warn('order-poll: late-success GetState-hiba (a következő futás újrapollolja)', {
            error: error instanceof Error ? error.message : String(error),
          })
          const failureClass = classifyBarionFailure(error)
          const remaining = latePage.length - (index + 1)
          if (failureClass === 'auth') {
            summary.skipped += remaining
            log.error(
              'RIASZTÁS: Barion hitelesítési hiba a late-success scan közben — a maradék cancelled rendelés erre a futásra kimarad',
              { failureClass, skippedOrders: remaining },
            )
            lateAborted = true
            break
          }
          if (failureClass === 'transport') {
            consecutiveTransportFailures += 1
            if (consecutiveTransportFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
              summary.skipped += remaining
              log.error(
                'RIASZTÁS: egymást követő Barion-hiba a late-success scan közben — a maradék cancelled rendelés erre a futásra kimarad',
                { failureClass, consecutiveTransportFailures, skippedOrders: remaining },
              )
              lateAborted = true
              break
            }
          }
          if (failureClass === 'order') {
            consecutiveTransportFailures = 0
            await rotateOrder(order)
          }
          if (!hadSuccessfulCall && failureClass === 'unknown') {
            leadingFailures += 1
            if (leadingFailures >= MAX_LEADING_FAILURES) {
              summary.skipped += remaining
              log.error(
                `RIASZTÁS: ${MAX_LEADING_FAILURES} tisztázatlan Barion-hiba a futás elején ` +
                  '(egyetlen sikeres válasz sem érkezett) — a late-success scan megszakadt, a ' +
                  'maradék cancelled rendelés érintetlen. Ellenőrizd a Barion-környezetet, a ' +
                  'POSKey-t és a szolgáltatás állapotát; a következő ütemezett futás újrapróbálja.',
                { failureClass, leadingFailures, skippedOrders: remaining },
              )
              lateAborted = true
              break
            }
          }
          continue
        }
        await applyMappedState(order, state, orderLog)
      }

      if (
        lateAborted ||
        pageLength < LATE_SUCCESS_BATCH_SIZE ||
        lateExtraPages >= LATE_SUCCESS_REFILL_PAGES
      ) {
        break
      }
      lateExtraPages += 1
      latePage = await fetchLatePage([...lateSeen])
    }
  }

  await resweepInvoices(deps, log, summary)

  if (rotationFailures > 0) {
    log.warn('order-poll: a sorforgatás részben sikertelen — a következő futás ismét ellenőrzi', {
      rotationFailures,
    })
  }

  log.info('order-poll futás kész', { ...summary })
  return summary
}
