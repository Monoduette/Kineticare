import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { shouldEmitThrottledAlert } from '../alert-throttle'
import {
  BarionApiError,
  fetchPaymentState,
  mapBarionPaymentStatus,
  type BarionPaymentStateResponse,
} from '../barion'
import {
  isBarionAuthFailure,
  isPaymentDefinitelyNotFound,
  isUnverifiedNotFound,
} from '../barion-callback/process-callback'
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
 * Barion KIFEJEZETTEN nem ismeri (ismert not-found kód, lásd
 * isPaymentDefinitelyNotFound; a puszta 404 ide nem tartozik). Tipikus ok: a fizetés
 * a másik Barion-környezetben indult (teszt-kulcs ↔ éles kulcs váltás). A
 * 30 perces PaymentWindow kétszerese: egy frissen indított fizetés átmeneti
 * „nem ismerem" válasza (ha egyáltalán előfordul) belefér, a végleg ismeretlen viszont nem
 * marad örökre payment_pending — a checkout ugyanerre azonnal új Startot enged.
 * Fék: ha a futásban egyetlen GetState sem sikerült, a lezárás a futás végi
 * útvonal-próbától függ (lásd closeDeferredNotFound a pollPendingOrders-ben).
 * Ha a legutóbb frissült paid rendelés GetState-je is elbukik, vagy egy
 * futásban MAX_LEADING_FAILURES vagy több ilyen sor jön, egyik sem zárul le.
 */
export const UNKNOWN_PAYMENT_CANCEL_AFTER_MS = 60 * 60 * 1000 // 1 óra
/**
 * Ennyi idő után zárjuk le azt a függő rendelést, amelynek GetState-je puszta
 * (vagy ismeretlen kódú) HTTP 404-et ad — de CSAK akkor, ha ugyanabban a
 * futásban egy MÁSIK GetState sikeres volt (vagy a futás végi útvonal-próba,
 * lásd probeBarionRoute a pollPendingOrders-ben). A siker bizonyítja, hogy az
 * útvonal és a POSKey működik, tehát a 404 ennek az egy fizetésnek szól (pl.
 * a másik Barion-környezetben indult). Globális útvonalhibánál (minden hívás
 * 404) nincs siker, így semmi nem zárul le.
 *
 * A 24 óra a 30 perces PaymentWindow sokszorosa: ennyi idő után a fizetés a
 * Barionnál biztosan lejárt vagy lezárult. Ha a Barion később mégis
 * Succeeded-et ad rá (pl. a környezet visszaváltása után), a late-success scan
 * a lezárt rendelést paid-re viszi, de CSAK a létrehozástól számított 7 napon
 * belül (LATE_SUCCESS_LOOKBACK_MS); egy ennél régebbi rendelés késői
 * Succeeded-jét semmi nem veszi fel automatikusan. Enélkül a lezárás nélkül a
 * sor örökre payment_pending maradna, és a pénztár a vevőnek erre a kurzusra
 * minden próbálkozásra 503-at adna.
 */
export const UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS = 24 * 60 * 60 * 1000 // 24 óra
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
/**
 * A futásszintű (nem rendeléshez kötött) Barion-riasztások fojtása: a futás
 * eleji mennyezet (függő lapok, late-success scan) és a late-success scan
 * útvonal-gyanúja. Egy tartós állapot (pl. öt, a másik Barion-környezetből
 * maradt, lezárt sor csendes boltban) 5 percenként új error-sort írna;
 * óránként egy elég, a közbeeső futások warn-sort kapnak.
 */
export const RUN_LEVEL_ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1 óra
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

/**
 * A definitív rendelés-hiba forgatható; az ismeretlen hiba nem egészségbizonyíték.
 *
 * - `order`: a Barion kifejezett not-found kóddal jelzi, hogy nem ismeri a
 *   fizetést (isPaymentDefinitelyNotFound). Forgatható, a türelmi idő után a
 *   függő sor lezárható (bizonyíték nélkül csak akkor, ha az útvonal-próbának
 *   nincs jelöltje és kevés ilyen sor van, lásd UNKNOWN_PAYMENT_CANCEL_AFTER_MS).
 *   A futás eleji mennyezetbe nem számít.
 * - `unverified-404`: HTTP 404 not-found kód nélkül. Önmagában NEM bizonyítja,
 *   hogy a fizetés nem létezik (útvonal- vagy verzióváltás, közbülső 404),
 *   ezért erre az egy válaszra nem zárunk le semmit. A sort forgatjuk, hogy ne
 *   legyen sorfej-blokkoló, függő sornál riasztunk (fojtva; a late-success
 *   scan lezárt soraira csak warn-sor megy, a futásszintű útvonal-gyanút az
 *   útvonal-próba dönti el), és a futás eleji mennyezetbe
 *   beszámít: ha a futás minden hívása ilyen, az globális útvonalhiba, és a
 *   függő lapok feldolgozása megáll. Egyetlen lezárási út: a 24 óránál régebbi
 *   függő sor, ha a futásban MÁSIK GetState vagy az útvonal-próba sikeres volt
 *   (UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS).
 */
export type BarionFailureClass = 'auth' | 'order' | 'unverified-404' | 'transport' | 'unknown'

export function classifyBarionFailure(error: unknown): BarionFailureClass {
  if (!(error instanceof BarionApiError)) {
    return 'unknown'
  }
  if (isBarionAuthFailure(error)) {
    return 'auth'
  }
  if (error.kind === 'timeout' || error.kind === 'network') {
    return 'transport'
  }
  if ((error.httpStatus ?? 0) >= 500) {
    return 'transport'
  }
  if (isPaymentDefinitelyNotFound(error)) {
    return 'order'
  }
  return isUnverifiedNotFound(error) ? 'unverified-404' : 'unknown'
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

/**
 * A függő lap feldolgozásának kimenete:
 * - `abort`: hitelesítési vagy szállítási hiba. A futás minden további
 *   Barion-hívása ugyanígy járna, ezért a late-success scan is kimarad.
 * - `ceiling`: a futás eleji mennyezet (MAX_LEADING_FAILURES tisztázatlan hiba
 *   siker nélkül). Ezt rendelés-specifikus, tartós hibák is kiválthatják (pl.
 *   öt, a másik Barion-környezetből maradt függő sor), ezért csak a függő
 *   lapokat állítja meg; a late-success scan saját kerettel fut tovább.
 */
type PendingPageDecision = 'continue' | 'abort' | 'ceiling'

/**
 * Régi függő sor, amelyre a futásban „nincs ilyen fizetés" jött (puszta 404,
 * vagy not-found kód még sikeres GetState előtt): a futás végén dől el a sorsa.
 */
interface DeferredNotFound {
  order: Order
  orderLog: Logger
  error: unknown
  ageMs: number
}

/**
 * Az útvonal-próba kimenete (futásonként legfeljebb egyszer fut, az eredményt
 * minden döntés újrahasznosítja):
 * - `proved`: a jelölt GetState-je sikeres, az útvonal és a POSKey működik;
 * - `failed`: van jelölt, de a GetState-je hibát adott;
 * - `no-candidate`: nincs Barion-azonosítós paid rendelés (új bolt);
 * - `unreadable`: a jelölt lekérdezése elbukott (DB-hiba), nem tudjuk, van-e.
 */
type RouteProbeOutcome = 'proved' | 'failed' | 'no-candidate' | 'unreadable'

interface RouteProbeResult {
  outcome: RouteProbeOutcome
  probeOrderId: number | null
  failureClass: BarionFailureClass | null
  httpStatus: number | null
}

/**
 * Az útvonal-próba jelöltje: a legutóbb frissült, Barion-azonosítós paid
 * rendelés. A fizetés a Barionnál létezik, tehát a sikeres GetState-je
 * bizonyítja, hogy az útvonal és a POSKey működik.
 */
function routeProbeWhere(): { and: Array<Record<string, unknown>> } {
  return {
    and: [{ status: { equals: 'paid' } }, { barionPaymentId: { exists: true } }],
  }
}

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
   * GetState-re vagy definitív rendelésválaszra (not-found kód) nullázódik. Egy ilyen
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
  /**
   * Volt-e a futásban hitelesítési vagy szállítási megszakítás. Ilyenkor az
   * útvonal-próba sem futhat: ugyanúgy elhasalna, és csak terhelést adna.
   */
  let barionAborted = false
  /** A futásban puszta 404-et kapott, 24 óránál régebbi függő sorok. */
  const agedUnverifiedNotFound: DeferredNotFound[] = []
  /**
   * Not-found kódot (NotExistingPaymentId, PaymentNotFound) kapott, 1 óránál
   * régebbi függő sorok, amelyekre a válasz MÉG sikeres GetState előtt jött.
   * Lásd closeDeferredNotFound: globális félrekonfigurálásnál (másik
   * Barion-környezet, idegen POSKey) minden fizetésre ez jön, és egy futás
   * minden függő sort lezárna.
   */
  const deferredDefinitiveNotFound: DeferredNotFound[] = []
  /**
   * A late-success scanben puszta 404-et kapott lezárt sorok száma. Ha a
   * futásban semmi nem sikerül, ez egy globális útvonalhiba egyetlen jele
   * lehet a csendes boltban (lásd alertLateScanRouteSuspect).
   */
  let lateUnverifiedNotFound = 0
  /** Az útvonal-próba eredménye; null, amíg nem futott (lásd probeBarionRoute). */
  let routeProbe: RouteProbeResult | null = null

  const providerErrorCodesOf = (error: unknown): string[] =>
    error instanceof BarionApiError
      ? error.providerErrors.map((providerError) => providerError.ErrorCode)
      : []

  /**
   * Puszta 404 (not-found kód nélkül) egy FÜGGŐ sorra: rendelésenként FOJTOTT
   * riasztás. Az 5 percenkénti futás a cooldown alatt ugyanarra a sorra nem ír
   * új error-sort. Önmagában ez a válasz a sor lezárását nem indokolja. A
   * late-success scan (lezárt sorok) nem hívja: ott a szöveg nem igaz.
   */
  const alertUnverifiedNotFound = (order: Order, orderLog: Logger, error: unknown): void => {
    if (!shouldEmitThrottledAlert(`barion-unverified-404:${order.id}`, undefined, now)) {
      return
    }
    orderLog.error(
      'RIASZTÁS: a Barion PaymentState HTTP 404-et adott „nincs ilyen fizetés" jelzés nélkül — ' +
        'a rendelést most NEM zárjuk le, a következő futás újrapróbálja. Ha minden rendelésnél ' +
        'ez jön, ellenőrizd a BARION_API_URL-t és a PaymentState-útvonalat. Ha csak ennél, a ' +
        'fizetés valószínűleg a másik Barion-környezetben indult (BARION_ENVIRONMENT-váltás): ' +
        'a 24 óránál régebbi függő sort a poll lezárja, amint ugyanabban a futásban egy másik ' +
        'GetState vagy az útvonal-próba sikeres.',
      {
        orderStatus: order.status ?? null,
        httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
        providerErrorCodes: providerErrorCodesOf(error),
      },
    )
  }

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
          if (recoveryFailed) {
            orderLog.error(
              'RIASZTÁS: paid-reject recovery sikertelen — a következő futás újra ellenőrzi',
              recoveryCtx,
            )
          } else if (shouldEmitThrottledAlert(`refund-reconcile:${order.id}`, undefined, now)) {
            // A tartós refund-egyeztetés állapota futásról futásra ugyanaz: a
            // riasztás FOJTOTT (mint a 24 órás beragadásé), különben 5
            // percenként új error-sor íródna ugyanarra a nyitott ügyre. A
            // fenti info-sor minden futásban megmarad.
            orderLog.error(
              'RIASZTÁS: tartós refund ellenőrzésre vár — a sor forgatható új pénzművelet nélkül',
              recoveryCtx,
            )
          }
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

  /**
   * A Barion által kifejezetten nem ismert, 1 óránál régebbi függő sor
   * lezárása (#260, UNKNOWN_PAYMENT_CANCEL_AFTER_MS). Feltételes írás: a
   * közben paid-dé vált sort nem írja felül. Pénzmozgás nincs.
   */
  const cancelDefinitelyUnknown = async (
    order: Order,
    orderLog: Logger,
    error: unknown,
    ageMs: number,
  ): Promise<void> => {
    const cancelledWritten = await updateOrderStatusIfCurrent({
      payload: deps.payload,
      orderId: order.id,
      expected: 'payment_pending',
      next: 'cancelled',
    })
    if (!cancelledWritten) {
      orderLog.warn('ismeretlen fizetés: a sor már nem payment_pending — a cancelled írás kimarad')
      return
    }
    summary.cancelled += 1
    orderLog.warn(
      'a Barion kifejezetten jelzi, hogy nem ismeri a függő fizetést, és a PaymentWindow rég ' +
        'lejárt — cancelled; a vevő újrakezdheti a vásárlást (tipikus ok: teszt-környezetben ' +
        'indított fizetés)',
      {
        ageMs,
        httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
      },
    )
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
          barionAborted = true
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
            barionAborted = true
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
          const ageMs = now - createdAtMs
          const definitelyUnknown =
            order.status === 'payment_pending' &&
            error instanceof BarionApiError &&
            isPaymentDefinitelyNotFound(error) &&
            Number.isFinite(createdAtMs) &&
            ageMs >= UNKNOWN_PAYMENT_CANCEL_AFTER_MS
          if (definitelyUnknown && hadSuccessfulCall) {
            // Egy másik GetState már sikeres volt: az útvonal, a környezet és a
            // POSKey működik, a válasz tehát erre az egy fizetésre szól.
            await cancelDefinitelyUnknown(order, orderLog, error, ageMs)
          } else if (definitelyUnknown) {
            // Sikeres GetState még nem volt: a sorsa a futás végén dől el
            // (closeDeferredNotFound).
            deferredDefinitiveNotFound.push({ order, orderLog, error, ageMs })
            await rotateOrder(order)
          } else {
            await rotateOrder(order)
          }
        }

        if (failureClass === 'unverified-404') {
          const createdAtMs = Date.parse(order.createdAt ?? '')
          const ageMs = now - createdAtMs
          if (
            order.status === 'payment_pending' &&
            Number.isFinite(createdAtMs) &&
            ageMs >= UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS
          ) {
            // A sorsa a futás végén dől el (closeDeferredNotFound): a
            // bizonyító sikeres GetState a sorrendben később is jöhet.
            agedUnverifiedNotFound.push({ order, orderLog, error, ageMs })
          } else {
            alertUnverifiedNotFound(order, orderLog, error)
          }
          await rotateOrder(order)
        }

        if (
          !hadSuccessfulCall &&
          (failureClass === 'unknown' || failureClass === 'unverified-404')
        ) {
          leadingFailures += 1
          if (leadingFailures >= MAX_LEADING_FAILURES) {
            summary.skipped += remaining
            const ceilingContext = {
              barionErrorKind,
              httpStatus,
              failureClass,
              leadingFailures,
              skippedOrders: remaining,
            }
            // Futásszintű állapot: tartós oknál (pl. öt, a másik
            // környezetből maradt függő sor) minden futás ide ér, ezért fojtott.
            if (
              shouldEmitThrottledAlert('leading-ceiling:pending', RUN_LEVEL_ALERT_COOLDOWN_MS, now)
            ) {
              log.error(
                `RIASZTÁS: ${MAX_LEADING_FAILURES} tisztázatlan Barion-hiba a futás elején ` +
                  '(egyetlen sikeres válasz sem érkezett) — a függő rendelések feldolgozása ' +
                  'megszakadt, a maradék függő rendelés érintetlen (a late-success scan saját ' +
                  'kerettel fut). Ellenőrizd a Barion-környezetet, a POSKey-t és a szolgáltatás ' +
                  'állapotát; a következő ütemezett futás újrapróbálja.',
                ceilingContext,
              )
            } else {
              log.warn(
                'order-poll: a függő lapok ismét elérték a futás eleji mennyezetet (a RIASZTÁS ' +
                  'fojtva) — a maradék függő rendelés erre a futásra kimarad',
                ceilingContext,
              )
            }
            return 'ceiling'
          }
        }

        continue
      }

      await applyMappedState(order, state, orderLog)
    }

    return 'continue'
  }

  const runRouteProbe = async (): Promise<RouteProbeResult> => {
    let probeOrder: Order | undefined
    try {
      const result = await deps.payload.find({
        collection: 'orders',
        where: routeProbeWhere(),
        sort: '-updatedAt',
        limit: 1,
        depth: 0,
        overrideAccess: true,
      } as unknown as Parameters<Payload['find']>[0])
      probeOrder = (result.docs as Order[])[0]
    } catch (error) {
      log.warn('order-poll: az útvonal-próba jelöltje nem olvasható', {
        error: error instanceof Error ? error.message : String(error),
      })
      return { outcome: 'unreadable', probeOrderId: null, failureClass: null, httpStatus: null }
    }
    const probePaymentId = probeOrder?.barionPaymentId
    if (!probeOrder || typeof probePaymentId !== 'string' || probePaymentId.length === 0) {
      return { outcome: 'no-candidate', probeOrderId: null, failureClass: null, httpStatus: null }
    }
    try {
      await fetchState(probePaymentId)
      log.info('order-poll: útvonal-próba sikeres (egy paid rendelés GetState-je)', {
        probeOrderId: probeOrder.id,
      })
      return {
        outcome: 'proved',
        probeOrderId: probeOrder.id,
        failureClass: null,
        httpStatus: null,
      }
    } catch (error) {
      const failed: RouteProbeResult = {
        outcome: 'failed',
        probeOrderId: probeOrder.id,
        failureClass: classifyBarionFailure(error),
        httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
      }
      log.warn(
        'order-poll: útvonal-próba sikertelen (egy paid rendelés GetState-je is hibát adott)',
        {
          probeOrderId: failed.probeOrderId,
          failureClass: failed.failureClass,
          httpStatus: failed.httpStatus,
        },
      )
      return failed
    }
  }

  /**
   * Útvonal-próba: ha a futásban egyetlen GetState sem volt sikeres (csendes
   * bolt, csak beragadt vagy lezárt, tartósan hibás sorok), a legutóbb frissült
   * paid rendelés fizetésére kérdezünk rá. A siker ugyanazt bizonyítja, mint
   * bármely más sikeres GetState: az útvonal és a POSKey működik. Állapotot
   * nem ír. Futásonként legfeljebb EGYSZER hív GetState-et: az eredményt a
   * late-success mennyezet, a futás végi lezárások és az útvonal-gyanú riasztás
   * egyaránt ebből veszi. Auth/transport megszakítás után nem fut (null):
   * ugyanúgy elhasalna, és csak terhelést adna.
   */
  const probeBarionRoute = async (): Promise<RouteProbeOutcome | null> => {
    if (routeProbe === null) {
      if (barionAborted) {
        return null
      }
      routeProbe = await runRouteProbe()
    }
    return routeProbe.outcome
  }

  const routeProbeContext = (): Record<string, unknown> => ({
    routeProbe: routeProbe?.outcome ?? null,
    probeOrderId: routeProbe?.probeOrderId ?? null,
    probeFailureClass: routeProbe?.failureClass ?? null,
    probeHttpStatus: routeProbe?.httpStatus ?? null,
  })

  /**
   * A futás végén eldőlő lezárások. A sorrend mindegy (a bizonyító sikeres
   * GetState a sorban később is jöhet), ezért fut a két scan UTÁN.
   * Pénzmozgás nincs: csak a státusz íródik, feltételesen (a közben paid-dé
   * vált sort nem írja felül). Ha a futásban egyetlen GetState sem sikerült,
   * a döntés az útvonal-próbán múlik (futásonként legfeljebb egy hívás).
   *
   * 1. Not-found kód sikeres GetState előtt (deferredDefinitiveNotFound):
   *    útvonal-bizonyítékkal (másik sikeres GetState vagy sikeres próba)
   *    lezárul. Bizonyíték nélkül CSAK akkor, ha nincs próba-jelölt (új bolt,
   *    nincs Barion-azonosítós paid rendelés) és MAX_LEADING_FAILURES-nél
   *    kevesebb ilyen sor van (#260: egy-egy, a másik környezetből maradt
   *    fizetés). Ha a próba elbukik (egy paid rendelés fizetését sem ismeri a
   *    Barion), vagy ennyi sor jön egyszerre, az inkább globális
   *    félrekonfigurálás (BARION_ENVIRONMENT, idegen POSKey): egyik sem zárul
   *    le, egy fojtott RIASZTÁS megy. Ez a próba-alapú fék a szétszórt korú
   *    sorokat is megfogja, amelyek futásonként egyenként lépnék át az 1
   *    órát. Az ilyen hibák a mennyezetbe szándékosan nem számítanak (egy-egy
   *    ismeretlen fizetés nem állíthatja meg a mentőhálót), a fék tehát csak a
   *    lezárást tartja vissza, a lekérdezést nem. A visszatartott sor forog, a
   *    vevő a pénztárban a fizetési ablak után így is újrakezdhet.
   * 2. Puszta 404, 24 óránál régebbi sor (agedUnverifiedNotFound,
   *    UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS): CSAK útvonal-bizonyítékkal
   *    (másik sikeres GetState vagy sikeres útvonal-próba); nélküle a sor marad,
   *    és a szokásos fojtott riasztást kapja.
   */
  const closeDeferredNotFound = async (): Promise<void> => {
    if (agedUnverifiedNotFound.length === 0 && deferredDefinitiveNotFound.length === 0) {
      return
    }
    const probe = hadSuccessfulCall ? null : await probeBarionRoute()
    const routeProof: 'getstate' | 'probe' | null = hadSuccessfulCall
      ? 'getstate'
      : probe === 'proved'
        ? 'probe'
        : null

    if (deferredDefinitiveNotFound.length > 0) {
      const closeWithoutProof =
        probe === 'no-candidate' && deferredDefinitiveNotFound.length < MAX_LEADING_FAILURES
      if (routeProof !== null || closeWithoutProof) {
        for (const { order, orderLog, error, ageMs } of deferredDefinitiveNotFound) {
          try {
            await cancelDefinitelyUnknown(order, orderLog, error, ageMs)
          } catch (writeError) {
            orderLog.warn(
              'ismeretlen fizetés: a cancelled írás sikertelen — a következő futás újrapróbálja',
              { error: writeError instanceof Error ? writeError.message : String(writeError) },
            )
          }
        }
      } else {
        const unprovenContext = {
          count: deferredDefinitiveNotFound.length,
          orderNumbers: deferredDefinitiveNotFound
            .slice(0, 10)
            .map(({ order }) => order.orderNumber ?? null),
          providerErrorCodes: [
            ...new Set(
              deferredDefinitiveNotFound.flatMap(({ error }) => providerErrorCodesOf(error)),
            ),
          ],
          ...routeProbeContext(),
        }
        if (probe !== 'failed' && probe !== 'no-candidate') {
          // Auth/transport megszakítás (a futás RIASZTÁS-a már kiment) vagy
          // olvashatatlan próba-jelölt: nincs döntéshez elég adat, a sorok
          // maradnak, a következő futás újra dönt.
          log.warn(
            'order-poll: „nincs ilyen fizetés" útvonal-bizonyíték nélkül, a próba nem futott le ' +
              '— a lezárás a következő futásra marad',
            unprovenContext,
          )
        } else if (shouldEmitThrottledAlert('barion-not-found-unproven', undefined, now)) {
          const reason =
            probe === 'failed'
              ? 'A legutóbb frissült fizetett rendelés GetState-je (útvonal-próba) is hibát ' +
                'adott, ez valószínűleg konfigurációs hibára utal.'
              : 'Ennyi ismeretlen fizetés valószínűleg konfigurációs hibára utal.'
          log.error(
            `RIASZTÁS: ebben a futásban ${deferredDefinitiveNotFound.length} függő rendelésre a ` +
              'Barion azt válaszolta, hogy nem ismeri a fizetést, és a futásban egyetlen ' +
              `GetState sem sikerült. ${reason} Ezért a rendeléseket most NEM zárjuk le. ` +
              'Ellenőrizd a BARION_ENVIRONMENT-et és a POSKey-t (abban a környezetben és azzal ' +
              'a bolttal indultak-e a fizetések); ha rendben vannak, a sorok az első olyan ' +
              'futásban lezárulnak, amelyben egy GetState sikeres.',
            unprovenContext,
          )
        } else {
          log.warn(
            'order-poll: „nincs ilyen fizetés" útvonal-bizonyíték nélkül — lezárás nincs ' +
              '(a riasztás fojtva)',
            unprovenContext,
          )
        }
      }
    }

    for (const { order, orderLog, error, ageMs } of agedUnverifiedNotFound) {
      if (routeProof === null) {
        alertUnverifiedNotFound(order, orderLog, error)
        continue
      }
      let cancelledWritten: boolean
      try {
        cancelledWritten = await updateOrderStatusIfCurrent({
          payload: deps.payload,
          orderId: order.id,
          expected: 'payment_pending',
          next: 'cancelled',
        })
      } catch (writeError) {
        // Egy DB-hiba itt nem viheti el a futás hátralévő részét (a többi sor
        // lezárását és a számla-resweepet). A sor payment_pending marad, a
        // következő futás újra 404-et kap rá, és újra megpróbálja.
        orderLog.warn(
          'puszta 404-es régi függő sor: a cancelled írás sikertelen — a következő futás újrapróbálja',
          { error: writeError instanceof Error ? writeError.message : String(writeError) },
        )
        continue
      }
      if (!cancelledWritten) {
        orderLog.warn(
          'puszta 404-es régi függő sor: a sor már nem payment_pending — a cancelled írás kimarad',
        )
        continue
      }
      summary.cancelled += 1
      orderLog.error(
        'RIASZTÁS: 24 óránál régebbi függő rendelés lezárva (cancelled) — a Barion erre a ' +
          'fizetésre HTTP 404-et ad, miközben ebben a futásban egy másik GetState sikeres volt, ' +
          'tehát az útvonal működik. Tipikus ok: a fizetés a másik Barion-környezetben indult. ' +
          'Pénzmozgás nem történt, a vevő új fizetést indíthat. Ha a Barion később mégis ' +
          'Succeeded-et ad rá, a late-success scan csak a rendelés létrehozásától számított 7 ' +
          'napon belül viszi paid-re; egy ennél régebbi rendelés késői Succeeded-jét semmi nem ' +
          'veszi fel automatikusan (lásd lateSuccessRecoverable).',
        {
          orderNumber: order.orderNumber ?? null,
          ageMs,
          lateSuccessRecoverable: ageMs < LATE_SUCCESS_LOOKBACK_MS,
          routeProof,
          httpStatus: error instanceof BarionApiError ? (error.httpStatus ?? null) : null,
          providerErrorCodes: providerErrorCodesOf(error),
        },
      )
    }
  }

  /**
   * Csendes bolt, globális útvonalhiba: nincs függő sor, a late-success scan
   * néhány (MAX_LEADING_FAILURES-nél kevesebb) lezárt sorára puszta 404 jön, és
   * a futásban semmi nem sikerül. A mennyezet ilyenkor nem ér el, a lezárt
   * sorokra rendelésenként szándékosan nem riasztunk, így e nélkül senki nem
   * venné észre, hogy egyetlen GetState sem működik (egy elveszett callbackű,
   * közben Succeeded rendelés sem lenne paid). Az útvonal-próba dönt: ha egy
   * paid rendelés GetState-je is elbukik, fojtott RIASZTÁS megy; ha sikeres,
   * vagy nincs jelölt, a hibák sor-specifikusak, és a warn-sorok elegendők.
   * Ha a futásban a mennyezet (bármelyik scané) már döntött, vagy auth /
   * transport megszakítás volt, a riasztás ott már megtörtént.
   */
  const alertLateScanRouteSuspect = async (): Promise<void> => {
    if (
      lateUnverifiedNotFound === 0 ||
      hadSuccessfulCall ||
      barionAborted ||
      pendingCeilingHit ||
      lateCeilingHit
    ) {
      return
    }
    if ((await probeBarionRoute()) !== 'failed') {
      return
    }
    const suspectContext = { lateUnverifiedNotFound, ...routeProbeContext() }
    if (shouldEmitThrottledAlert('late-scan-route', RUN_LEVEL_ALERT_COOLDOWN_MS, now)) {
      log.error(
        `RIASZTÁS: a late-success scan ${lateUnverifiedNotFound} lezárt rendelésére a Barion ` +
          'PaymentState HTTP 404-et adott, és egyetlen GetState sem sikerült: a ' +
          'legutóbb frissült fizetett rendelés GetState-je (útvonal-próba) is hibát adott. Ez ' +
          'globális útvonal- vagy konfigurációs hibára utal. Amíg tart, a poll egyetlen ' +
          'fizetés állapotát sem tudja ellenőrizni, így az a sikeres fizetés sem kerül paid-re, ' +
          'amelynek a callbackje elveszett. Ellenőrizd a BARION_API_URL-t, a ' +
          'BARION_ENVIRONMENT-et és a POSKey-t.',
        suspectContext,
      )
    } else {
      log.warn(
        'order-poll: a late-success scan ismét csak 404-et kapott, és az útvonal-próba is ' +
          'elbukott (a riasztás fojtva)',
        suspectContext,
      )
    }
  }

  let page = await fetchPendingPage([])
  summary.scanned += page.length
  let extraPages = 0
  let pendingAborted = false
  let pendingCeilingHit = false
  /** A late-success scan elérte-e a futás eleji mennyezetet (ott dől el a riasztás). */
  let lateCeilingHit = false

  while (page.length > 0) {
    const pageLength = page.length
    const decision = await processPendingPage(page)
    if (decision === 'abort') {
      pendingAborted = true
      break
    }
    if (decision === 'ceiling') {
      pendingCeilingHit = true
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
  // a Succeeded sort. Auth/transport abort után NEM kérdezünk tovább. A futás
  // eleji mennyezet után viszont igen: ha öt tartósan 404-es függő sor áll a
  // sor elején, a mennyezet minden futásban kiütne, és egy elveszett callbackű,
  // később Succeeded cancelled rendelés sosem lenne paid (a vevő fizetett, de
  // nem kap hozzáférést).
  if (!pendingAborted) {
    if (pendingCeilingHit) {
      // Saját, friss keret: globális hibánál (minden hívás tisztázatlan) a
      // late-success scan is legfeljebb MAX_LEADING_FAILURES hívás után megáll,
      // egy futás tehát legfeljebb 2 × MAX_LEADING_FAILURES hívást tesz (plusz
      // legfeljebb egy útvonal-próbát, lásd probeBarionRoute).
      leadingFailures = 0
    }
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
            barionAborted = true
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
              barionAborted = true
              break
            }
          }
          if (failureClass === 'order') {
            consecutiveTransportFailures = 0
            await rotateOrder(order)
          }
          if (failureClass === 'unverified-404') {
            // NINCS rendelésenkénti RIASZTÁS: a late-success scan csak lezárt
            // (cancelled / payment_failed) sorokat néz, a függő sorokra szóló
            // „most NEM zárjuk le … a poll lezárja" szöveg itt nem igaz, és a
            // poll által épp lezárt régi sorra a 7 napos ablak végéig 6
            // óránként téves riasztás menne. A lezárt sorral nincs teendő (a
            // fenti warn-sor rögzíti a hibát). Globális útvonalhibát a futás
            // eleji mennyezet, a függő sorok riasztása, csendes boltban pedig a
            // futás végi útvonal-gyanú riasztás jelez (alertLateScanRouteSuspect).
            lateUnverifiedNotFound += 1
            await rotateOrder(order)
          }
          if (
            !hadSuccessfulCall &&
            (failureClass === 'unknown' || failureClass === 'unverified-404')
          ) {
            leadingFailures += 1
            if (leadingFailures >= MAX_LEADING_FAILURES) {
              summary.skipped += remaining
              lateCeilingHit = true
              const ceilingContext = { failureClass, leadingFailures, skippedOrders: remaining }
              if (pendingCeilingHit) {
                // Ugyanebben a futásban a függő lapok mennyezete már RIASZTÁS-t
                // írt ugyanerről a (valószínűleg globális) állapotról: a második
                // sor csak warn, különben globális hibánál futásonként két
                // riasztás menne.
                log.warn(
                  'order-poll: a late-success scan is elérte a futás eleji mennyezetet (a ' +
                    'RIASZTÁS a függő rendeléseknél már kiment) — a maradék cancelled rendelés ' +
                    'erre a futásra kimarad',
                  ceilingContext,
                )
              } else if ((await probeBarionRoute()) === 'proved') {
                // Az útvonal működik (egy paid rendelés GetState-je sikeres):
                // a hibák ezekre a lezárt sorokra szólnak (pl. a poll által
                // lezárt, a másik Barion-környezetből maradt fizetések), nem a
                // Barion-környezetre vagy a POSKey-re. Ezekkel a 7 napos ablak
                // végéig 5 percenként téves RIASZTÁS menne.
                log.warn(
                  'order-poll: a late-success scan elérte a futás eleji mennyezetet, de az ' +
                    'útvonal-próba sikeres — a hibák ezekre a lezárt sorokra szólnak; a maradék ' +
                    'cancelled rendelés erre a futásra kimarad',
                  { ...ceilingContext, ...routeProbeContext() },
                )
              } else if (
                shouldEmitThrottledAlert('leading-ceiling:late', RUN_LEVEL_ALERT_COOLDOWN_MS, now)
              ) {
                log.error(
                  `RIASZTÁS: ${MAX_LEADING_FAILURES} tisztázatlan Barion-hiba a futás elején ` +
                    '(egyetlen sikeres válasz sem érkezett) — a late-success scan megszakadt, a ' +
                    'maradék cancelled rendelés érintetlen. Ellenőrizd a Barion-környezetet, a ' +
                    'POSKey-t és a szolgáltatás állapotát; a következő ütemezett futás újrapróbálja.',
                  { ...ceilingContext, ...routeProbeContext() },
                )
              } else {
                log.warn(
                  'order-poll: a late-success scan ismét elérte a futás eleji mennyezetet (a ' +
                    'RIASZTÁS fojtva) — a maradék cancelled rendelés erre a futásra kimarad',
                  { ...ceilingContext, ...routeProbeContext() },
                )
              }
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

  await closeDeferredNotFound()
  await alertLateScanRouteSuspect()

  await resweepInvoices(deps, log, summary)

  if (rotationFailures > 0) {
    log.warn('order-poll: a sorforgatás részben sikertelen — a következő futás ismét ellenőrzi', {
      rotationFailures,
    })
  }

  log.info('order-poll futás kész', { ...summary })
  return summary
}
