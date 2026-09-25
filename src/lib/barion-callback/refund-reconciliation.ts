import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { shouldEmitThrottledAlert } from '../alert-throttle'
import type { BarionDetailedTransaction, BarionPaymentStateResponse } from '../barion'
import { fetchPaymentState } from '../barion/state'
import { logger as rootLogger, type Logger } from '../logger'
import {
  expectedPosTransactionId,
  sameBarionId,
  selectRefundSourceTransaction,
} from '../refund/barion-refund-evidence'
import { loadActiveRefundIntent } from '../refund/intent-store'

/**
 * Visszatérítés-egyeztetés a Barion PaymentState-je és a rendelésen rögzített
 * visszatérítések (orders.refunds) között — CSAK JELEZ, soha nem mozgat pénzt és
 * nem vált állapotot (K17: visszatérítés kizárólag a Kineticare adminból).
 *
 * Miért kell (a-callback-6, a-refund-7, a-egyeztetes-2, r-barion-8):
 * - a Barion minden tranzakció-állapotváltáskor callbacket küld, a
 *   visszatérítésnél „A new refund-type transaction is added to the
 *   Transactions array … the status of these payments won't change”
 *   (docs.barion.com/Callback_mechanism, Wayback 20260122005429). A paid
 *   eseményre érkező későbbi callbacket a dedup eddig némán eldobta, így a
 *   Barion felületén indított visszatérítés sosem derült ki: a rendelés paid
 *   maradt, a számla stornó nélkül, a hozzáférés élt;
 * - egy kártyás visszatérítés később meghiúsulhat: „StornoUnSuccessfulRefundToBankCard:
 *   Cancellation of an unsuccessful refund to a bank card” (TransactionType),
 *   a pénz ilyenkor visszakerül a Barion-tárcába, a vevő nem kapja meg, nálunk
 *   pedig a rendelés visszatérítettnek látszik.
 *
 * Összevetés (a tranzakció-azonosítókat nem tudjuk párosítani: az
 * orders.refunds a forrástranzakciót rögzíti, a visszatérítés saját
 * Barion-azonosítóját még nem — lásd w3-schema-fin, refunds[].refundTransactionId):
 * - a forrástranzakcióhoz (RelatedId) kapcsolódó Refund / RefundToBankCard /
 *   RefundToBankAccount tranzakciók SIKERES összege ↔ a rögzített sikeres
 *   visszatérítések összege;
 * - folyamatban lévő visszatérítés-tranzakció (Codex, PR #307): nem számít
 *   visszatérítettnek, mert a pénz még nem biztos, hogy célba ért. Ha
 *   visszatérítettnek vennénk, a nálunk sikeresként rögzített, de a Barionban
 *   még függő visszatérítés az egy héttel későbbi újraellenőrzésen
 *   „egyezik”-kel zárulna, és többé senki nem nézné meg;
 * - sikertelen státuszú visszatérítés-tranzakció;
 * - sztornó-tranzakció (StornoUnSuccessfulRefundTo…);
 * - a fizetés Total-ja kisebb, mint a végösszeg mínusz a rögzített
 *   visszatérítések („Total … if the transaction is a refund of a previously
 *   completed payment, this can be lower than at payment creation time”,
 *   PaymentState v4).
 * Aktív visszatérítési szándéknál (a saját visszatérítésünk épp fut) az
 * összeg-eltérés és a folyamatban lévő tranzakció várható, ezért akkor csak a
 * sikertelen és a sztornózott visszatérítésre riasztunk.
 */

const REFUND_TYPES: ReadonlySet<string> = new Set([
  'Refund',
  'RefundToBankCard',
  'RefundToBankAccount',
])

const REVERSAL_TYPES: ReadonlySet<string> = new Set([
  'StornoUnSuccessfulRefundToBankCard',
  'StornoUnSuccessfulRefundToBankAccount',
])

/** Folyamatban lévő tranzakció-státuszok: se nem sikeresek, se nem kudarcok még. */
const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  'Prepared',
  'Started',
  'InProgress',
  'Pending',
  'Waiting',
  'Reserved',
  'Authorized',
])

/** A riasztás egy nyitott ügyre: rendelésenként és eltérés-fajtánként ennyi időnként ismétlődik. */
export const REFUND_RECONCILIATION_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000

export type RefundReconciliationFinding =
  | 'foreign-refund'
  | 'recorded-refund-missing'
  | 'refund-in-progress'
  | 'failed-refund'
  | 'refund-reversal'
  | 'total-below-recorded'

export interface RefundReconciliationComparison {
  findings: RefundReconciliationFinding[]
  /** A Barion szerint sikeresen visszatérített összeg, Ft. */
  barionRefundedHuf: number
  /** A rendelésen rögzített sikeres visszatérítések összege, Ft. */
  recordedRefundedHuf: number
  /** A Barionban még folyamatban lévő visszatérítés-tranzakciók száma. */
  inProgressRefundCount: number
  failedRefundCount: number
  reversalCount: number
  barionTotal: number | null
}

function transactionsOf(state: BarionPaymentStateResponse): BarionDetailedTransaction[] {
  const raw: unknown[] = Array.isArray(state.Transactions) ? state.Transactions : []
  return raw.filter(
    (item): item is BarionDetailedTransaction => typeof item === 'object' && item !== null,
  )
}

function amountOf(transaction: BarionDetailedTransaction): number {
  return typeof transaction.Total === 'number' && Number.isFinite(transaction.Total)
    ? Math.abs(transaction.Total)
    : 0
}

/** A rendelésen rögzített, a Barion szerint sikeres visszatérítések összege. */
export function recordedRefundedHuf(order: Pick<Order, 'refunds'>): number {
  const entries: unknown[] = Array.isArray(order.refunds) ? order.refunds : []
  let sum = 0
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { amountHuf, status } = entry as { amountHuf?: unknown; status?: unknown }
    if (status === 'Succeeded' && typeof amountHuf === 'number' && Number.isFinite(amountHuf)) {
      sum += amountHuf
    }
  }
  return sum
}

/**
 * Tiszta összevetés. Ha a forrástranzakció egyértelmű (selectRefundSourceTransaction,
 * `${orderNumber}-1`), csak a hozzá kapcsolódó tranzakciók számítanak; ha nem,
 * minden visszatérítés-jellegű tranzakció (egy fizetés = egy rendelés).
 */
export function compareRefundsWithPaymentState(
  order: Pick<Order, 'orderNumber' | 'refunds' | 'totalHufSnapshot'>,
  state: BarionPaymentStateResponse,
  options: { activeRefundIntent: boolean },
): RefundReconciliationComparison {
  const source = selectRefundSourceTransaction(state, {
    posTransactionId: expectedPosTransactionId(order.orderNumber) ?? undefined,
  })
  const related = transactionsOf(state).filter(
    (tx) => source === null || sameBarionId(tx.RelatedId, source.transactionId),
  )
  const refunds = related.filter((tx) => REFUND_TYPES.has(String(tx.TransactionType)))
  const reversals = related.filter((tx) => REVERSAL_TYPES.has(String(tx.TransactionType)))
  const inProgress = refunds.filter((tx) => IN_PROGRESS_STATUSES.has(String(tx.Status)))
  const failed = refunds.filter(
    (tx) => tx.Status !== 'Succeeded' && !IN_PROGRESS_STATUSES.has(String(tx.Status)),
  )
  const barionRefunded = refunds
    .filter((tx) => tx.Status === 'Succeeded')
    .reduce((sum, tx) => sum + amountOf(tx), 0)
  const recorded = recordedRefundedHuf(order)
  const barionTotal =
    typeof state.Total === 'number' && Number.isFinite(state.Total) ? state.Total : null

  const findings: RefundReconciliationFinding[] = []
  if (reversals.length > 0) findings.push('refund-reversal')
  if (failed.length > 0) findings.push('failed-refund')
  if (!options.activeRefundIntent) {
    if (inProgress.length > 0) findings.push('refund-in-progress')
    if (barionRefunded > recorded) findings.push('foreign-refund')
    if (barionRefunded < recorded) findings.push('recorded-refund-missing')
    const snapshot = order.totalHufSnapshot
    // A kisebb Total-t a nem rögzített és a még folyamatban lévő
    // visszatérítés is megmagyarázza; ezekről már szól a saját találatuk.
    if (
      !findings.includes('foreign-refund') &&
      !findings.includes('refund-in-progress') &&
      barionTotal !== null &&
      typeof snapshot === 'number' &&
      barionTotal < snapshot - recorded
    ) {
      findings.push('total-below-recorded')
    }
  }
  return {
    findings,
    barionRefundedHuf: barionRefunded,
    recordedRefundedHuf: recorded,
    inProgressRefundCount: inProgress.length,
    failedRefundCount: failed.length,
    reversalCount: reversals.length,
    barionTotal,
  }
}

const FINDING_TEXT: Record<RefundReconciliationFinding, string> = {
  'foreign-refund':
    'a Barionban több visszatérítés látszik, mint amennyit a rendszer rögzített (valószínűleg a ' +
    'Barion felületén indított visszatérítés)',
  'recorded-refund-missing':
    'a rendszer több sikeres visszatérítést rögzített, mint amennyit a Barion sikeresnek mutat',
  'refund-in-progress':
    'a Barionban folyamatban lévő (még nem sikeres) visszatérítés-tranzakció van: nem biztos, ' +
    'hogy a pénz célba ért',
  'failed-refund': 'a Barionban sikertelen visszatérítés-tranzakció van',
  'refund-reversal':
    'a Barion sztornózta egy sikertelen kártyás visszatérítést (StornoUnSuccessfulRefundToBankCard): ' +
    'a pénz visszakerült a Barion-tárcába, a vevő nem kapta meg',
  'total-below-recorded':
    'a fizetés Barion szerinti összege kisebb, mint a végösszeg és a rögzített visszatérítések különbsége',
}

export type RefundReconciliationOutcome =
  'match' | 'mismatch' | 'no-order' | 'no-refund-activity' | 'error'

export interface RunRefundReconciliationParams {
  payload: Payload
  order: Order
  /** Honnan indult: callback (paid eseményre érkező újabb kézbesítés) vagy az order-poll 7 napos újraellenőrzése. */
  trigger: 'callback' | 'order-poll'
  logger?: Logger
  /** Az order-poll a saját (injektálható) lekérdezőjét adja át; alapból a kapus fetchPaymentState. */
  fetchState?: (paymentId: string) => Promise<BarionPaymentStateResponse>
  now?: number
}

/**
 * Egy rendelés egyeztetése. Hiba esetén nem dob (a hívó a callback-dedup vagy
 * az order-poll, egyiket sem akaszthatja meg), hanem 'error'-t ad és naplóz.
 */
export async function runRefundReconciliation(
  params: RunRefundReconciliationParams,
): Promise<RefundReconciliationOutcome> {
  const { order } = params
  const log = (params.logger ?? rootLogger).child({
    module: 'refund-reconciliation',
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    trigger: params.trigger,
  })
  const paymentId = order.barionPaymentId
  if (typeof paymentId !== 'string' || paymentId.length === 0) {
    return 'no-order'
  }
  const fetchState =
    params.fetchState ?? ((id: string) => fetchPaymentState(id, undefined, { logger: log }))

  // Olvasási sorrend (BRK-R2-2): a saját admin-visszatérítésre is jön Barion-
  // callback, és a GetState a PaymentId-kapu miatt másodpercekig várhat. Ezalatt
  // a refundOrder rögzítheti a visszatérítést és elengedheti a szándékot. A
  // hívó rendelés-pillanatképe ezért elavult lehet: a szándékot a GetState
  // ELŐTT és UTÁN is olvassuk (bármelyik aktív → saját, folyamatban lévő
  // visszatérítés), a rendelést pedig a második szándék-olvasás UTÁN frissen.
  // A szándék csak azután zárul (committed), hogy a rendelés refunds-nyoma
  // már rögzítve van (refund-recovery), így ha a második olvasás már nem lát
  // aktív szándékot, a friss rendelés a rögzített visszatérítést is mutatja.
  let state: BarionPaymentStateResponse
  let activeRefundIntent: boolean
  let current: Order = order
  try {
    const activeBefore = (await loadActiveRefundIntent(params.payload, order.id)) !== null
    state = await fetchState(paymentId)
    const activeAfter = (await loadActiveRefundIntent(params.payload, order.id)) !== null
    activeRefundIntent = activeBefore || activeAfter
    const fresh = await params.payload.find({
      collection: 'orders',
      where: { id: { equals: order.id } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const freshOrder = fresh.docs[0] as Order | undefined
    if (freshOrder && freshOrder.id === order.id) current = freshOrder
  } catch (error) {
    log.warn(
      'visszatérítés-egyeztetés: a PaymentState, a visszatérítési szándék vagy a rendelés nem olvasható — később újra',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    )
    return 'error'
  }

  const comparison = compareRefundsWithPaymentState(current, state, { activeRefundIntent })
  const context = {
    barionStatus: state.Status,
    barionRefundedHuf: comparison.barionRefundedHuf,
    recordedRefundedHuf: comparison.recordedRefundedHuf,
    inProgressRefundCount: comparison.inProgressRefundCount,
    failedRefundCount: comparison.failedRefundCount,
    reversalCount: comparison.reversalCount,
    barionTotal: comparison.barionTotal,
    totalHufSnapshot: current.totalHufSnapshot ?? null,
    activeRefundIntent,
  }
  if (comparison.findings.length === 0) {
    const hadActivity =
      comparison.barionRefundedHuf > 0 ||
      comparison.recordedRefundedHuf > 0 ||
      comparison.inProgressRefundCount > 0
    log.info('visszatérítés-egyeztetés: a Barion és a rendelés adatai egyeznek', context)
    return hadActivity ? 'match' : 'no-refund-activity'
  }

  const key = `refund-reconciliation:${order.id}:${comparison.findings.join(',')}`
  if (shouldEmitThrottledAlert(key, REFUND_RECONCILIATION_ALERT_COOLDOWN_MS, params.now)) {
    log.error(
      'RIASZTÁS: a Barion visszatérítései nem egyeznek a rendelésen rögzítettekkel — ' +
        comparison.findings.map((finding) => FINDING_TEXT[finding]).join('; ') +
        '. Automatikus pénzmozgás és állapotváltás NEM történt. Nézd meg a fizetést a Barion ' +
        'felületén, és egyeztesd a rendelést, a számlát és a hozzáférést. Visszatérítést csak a ' +
        'Kineticare adminból indíts.',
      { ...context, findings: comparison.findings },
    )
  } else {
    log.warn('visszatérítés-egyeztetés: az eltérés továbbra is fennáll (a riasztás fojtva)', {
      ...context,
      findings: comparison.findings,
    })
  }
  return 'mismatch'
}
