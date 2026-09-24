import type { Payload } from 'payload'
import { isDeepStrictEqual } from 'node:util'
import type { Order, RefundIntent, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { withUserPurchasesLock } from '../user-purchases-lock'
import { applyRefundAccessCleanup, type RefundAccessBaseline } from './access-store'
import { logger, type Logger } from '../logger'
import {
  canRecoverAutomaticRefund,
  commitAutomaticRefund,
  isAutomaticRefundIntent,
  verifyAutomaticRefundCompletion,
} from './auto-refund-recovery'
import { issueStornoForOrder, issueCorrectiveInvoiceForOrder } from '../szamlazz'
import { fetchPaymentState, type BarionPaymentStateResponse } from '../barion'
import {
  loadActiveRefundIntent,
  loadRefundIntentForOperation,
  transitionRefundIntent,
} from './intent-store'
import {
  reconcileLaunchedIntent,
  RECONCILABLE_LAUNCHED_STATES,
  releaseNeverLaunchedIntent,
  type IntentSettlement,
} from './provider-reconciliation'
import {
  productIds,
  isRecord,
  readReceipt,
  readProviderReceipt,
  RECEIPTS,
  relationId,
  writeReceipt,
} from './recovery-receipts'
import {
  classifyRefundedTransactionStatus,
  readRefundEntries,
  refundLockKey,
  type OrderRefundEntry,
  type RefundOrderOptions,
} from './refund-order'

/**
 * A tulajdonosnak szóló állapotüzenetek: mi a helyzet, és mi a következő lépés
 * (GOV.UK Error message: „say what has happened and how to fix it”; NN/g
 * Error-Message Guidelines). A panel a nem rendezett állapotok mellé a saját
 * általános útmutatóját is kiírja (src/components/admin/refund-response.ts).
 */
const MANUAL =
  'A visszatérítés mentett adatai nem egyeznek a rendeléssel, ezért ez kézi ellenőrzést igényel.'
const UNREADABLE =
  'A visszatérítés mentett állapota most nem olvasható. Frissítsd az oldalt pár perc múlva, és ha ez marad, jelezd az üzemeltetőnek.'
const LOCAL_BLOCKED =
  'A Barion visszaigazolta a visszatérítést, de a helyi feldolgozás (hozzáférés vagy számla) elakadt, és automatikusan nem folytatható. Ez kézi ellenőrzést igényel.'
const CONTINUE =
  'A Barion sikeres eredménye rögzítve van. A hozzáférések, a napló és a bizonylat feldolgozása folytatható új pénzvisszatérítés nélkül.'
const COMPLETE = 'A visszatérítés helyi feldolgozása befejeződött.'
const STUCK_PREPARED =
  'Egy korábbi visszatérítés előkészítése megszakadt, a Barionnak nem ment kérés, pénzmozgás nem történt. A „Feldolgozás folytatása” lezárja ezt a kísérletet, utána új visszatérítés indítható.'
const IN_FLIGHT =
  'A visszatérítési kérés most megy a Barionhoz, vagy épp most jött meg rá a válasz. Várj egy percet, majd frissítsd az oldalt.'
const UNKNOWN_OUTCOME =
  'A Barion válaszából nem derült ki biztosan, megtörtént-e a visszatérítés. A „Feldolgozás folytatása” lekérdezi az eredményt a Barionból, új pénzvisszatérítést nem indít.'
const NEVER_LAUNCHED_CLOSED =
  'A megszakadt kísérlet lezárva, a Barionnak nem ment kérés, pénzmozgás nem történt. A rendelésen új visszatérítés indítható.'
const NO_EFFECT_CLOSED =
  'A Barion adatai szerint ez a visszatérítés nem történt meg, pénzmozgás nem volt. A kísérlet lezárva, a rendelésen új visszatérítés indítható.'
const AUTOMATIC_ATTEMPT_CLOSED =
  'Az automatikus visszatérítés kísérlete lezárva: a Barion adatai szerint pénzmozgás nem történt. A további kísérletekről a fizetés-ellenőrzés gondoskodik.'
const RECONCILE_UNAVAILABLE =
  'A Barion most nem érhető el, ezért a visszatérítés eredménye nem kérdezhető le. Próbáld újra néhány perc múlva.'
const RECONCILE_CHANGED = 'A visszatérítés állapota közben megváltozott. Frissítsd az oldalt.'
const RECONCILE_IN_PROGRESS =
  'A Barion még feldolgozza a visszatérítést. Nézz vissza néhány perc múlva, és folytasd újra a feldolgozást.'
const RECONCILE_UNPROVABLE =
  'A Barion adataiból nem dönthető el egyértelműen, mi történt ezzel a visszatérítéssel (például a Barion felületén is indult visszatérítés). Ez kézi egyeztetést igényel az üzemeltetővel.'

/** Ennyi ideig egy provider_started kísérletnek még futhat az indítója (2 × Barion-plafon + tartalék). */
const IN_FLIGHT_WINDOW_MS = 2 * 60_000

const BUDAPEST_TIME = new Intl.DateTimeFormat('hu-HU', {
  timeZone: 'Europe/Budapest',
  hour: '2-digit',
  minute: '2-digit',
})

function reconcileTooEarlyMessage(notBefore: string | undefined): string {
  const at = notBefore ? Date.parse(notBefore) : NaN
  const when = Number.isFinite(at) ? `${BUDAPEST_TIME.format(at)} után` : 'negyedóra múlva'
  return `A Barionban még nem látszik ehhez a kísérlethez visszatérítés. Biztos eredmény ${when} kérdezhető le, addig ne indíts új pénzvisszatérítést.`
}

function pendingMessage(settlement: Extract<IntentSettlement, { kind: 'pending' }>): string {
  if (settlement.reason === 'in_progress') return RECONCILE_IN_PROGRESS
  if (settlement.reason === 'too_early') return reconcileTooEarlyMessage(settlement.notBefore)
  return RECONCILE_UNPROVABLE
}

/** Aktív, de nem provider_succeeded kísérlet állapota és üzenete. */
function stuckIntentStatus(
  intent: RefundIntent,
  now: number,
): { state: 'manual_review' | 'recoverable'; message: string } {
  if (intent.state === 'prepared') return { state: 'recoverable', message: STUCK_PREPARED }
  if (!RECONCILABLE_LAUNCHED_STATES.has(intent.state))
    return { state: 'manual_review', message: MANUAL }
  const startedAt = intent.providerStartedAt ? Date.parse(intent.providerStartedAt) : NaN
  if (
    intent.state === 'provider_started' &&
    Number.isFinite(startedAt) &&
    now - startedAt < IN_FLIGHT_WINDOW_MS
  )
    return { state: 'manual_review', message: IN_FLIGHT }
  return { state: 'recoverable', message: UNKNOWN_OUTCOME }
}

interface RecoveryOptions {
  payload: Payload
  orderNumber: string
  actor: User
  headers?: Headers
  ipAddress?: string
  logger?: Logger
  issueStorno?: RefundOrderOptions['issueStorno']
  issueCorrective?: RefundOrderOptions['issueCorrective']
  /** Injektálható idő (teszteléshez); alapból a pillanatnyi idő. */
  now?: Date
}

export async function findRecoveryOrder(
  payload: Payload,
  orderNumber: string,
): Promise<Order | null> {
  const found = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    limit: 2,
    depth: 0,
    overrideAccess: true,
  })
  if (found.totalDocs !== found.docs.length || found.docs.length !== 1) return null
  return found.docs[0]
}

export function validatedRefundHistory(order: Order): OrderRefundEntry[] {
  const raw: unknown = order.refunds
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new Error('refund recovery: malformed history')
  const entries = readRefundEntries(order)
  if (
    entries.length !== raw.length ||
    entries.some(
      (entry) =>
        !entry.transactionId ||
        !Number.isSafeInteger(entry.amountHuf) ||
        entry.amountHuf <= 0 ||
        !Number.isFinite(Date.parse(entry.refundedAt)) ||
        !['full', 'partial'].includes(entry.type) ||
        classifyRefundedTransactionStatus(entry.status) !== 'succeeded',
    )
  ) {
    throw new Error('refund recovery: unproven history')
  }
  return entries
}

function total(order: Order): number {
  const value = order.totalHufSnapshot ?? order.amount
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('refund recovery: invalid total')
  return value
}

/** Reconstruct only a correlated, durably acknowledged provider success. No financial API calls. */
async function ensureFinancialEntry(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
): Promise<{ order: Order; entry: OrderRefundEntry }> {
  const proof = await readProviderReceipt(payload, intent)
  if (
    !proof ||
    proof.paymentId !== intent.providerPaymentId ||
    proof.transactionId !== intent.providerTransactionId ||
    proof.amountHuf !== intent.requestedAmountHuf ||
    proof.sequence !== intent.refundSequence ||
    typeof proof.status !== 'string' ||
    classifyRefundedTransactionStatus(proof.status) !== 'succeeded' ||
    relationId(intent.order) !== order.id ||
    order.barionPaymentId !== intent.providerPaymentId ||
    !intent.providerResolvedAt
  )
    throw new Error('refund recovery: insufficient financial evidence')
  const entries = validatedRefundHistory(order)
  if (entries.length !== intent.refundSequence - 1 && entries.length !== intent.refundSequence)
    throw new Error('refund recovery: sequence conflict')
  const preceding = entries.slice(0, intent.refundSequence - 1)
  const previous = preceding.reduce((sum, item) => sum + item.amountHuf, 0)
  const after = previous + intent.requestedAmountHuf
  if (
    proof.totalHuf !== total(order) ||
    proof.alreadyRefundedHuf !== previous ||
    proof.type !== (after === total(order) ? 'full' : 'partial')
  )
    throw new Error('refund recovery: financial snapshot conflict')
  if (after > total(order) || preceding.some((item) => item.type === 'full'))
    throw new Error('refund recovery: amount conflict')
  const entry: OrderRefundEntry = {
    transactionId: intent.providerTransactionId,
    amountHuf: intent.requestedAmountHuf,
    status: proof.status,
    refundedAt: intent.providerResolvedAt,
    type: after === total(order) ? 'full' : 'partial',
    ...(intent.reason ? { reason: intent.reason } : {}),
  }
  const existing = entries[intent.refundSequence - 1]
  if (
    existing &&
    (existing.transactionId !== entry.transactionId ||
      existing.amountHuf !== entry.amountHuf ||
      existing.status !== entry.status ||
      existing.type !== entry.type ||
      existing.refundedAt !== entry.refundedAt ||
      (existing.reason ?? null) !== (entry.reason ?? null))
  )
    throw new Error('refund recovery: entry conflict')
  const status = entry.type === 'full' ? 'refunded' : 'paid'
  if (existing && order.status === status) {
    if (
      entry.type === 'full' &&
      (order.refundedAt !== entry.refundedAt ||
        (order.refundReason ?? null) !== (intent.reason ?? null))
    )
      throw new Error('refund recovery: inconsistent full refund')
    return { order, entry }
  }
  if (order.status !== 'paid') throw new Error('refund recovery: order state conflict')
  await payload.update({
    collection: 'orders',
    id: order.id,
    data: {
      refunds: existing ? entries : [...entries, entry],
      ...(entry.type === 'full'
        ? {
            status: 'refunded' as const,
            refundedAt: entry.refundedAt,
            ...(intent.reason ? { refundReason: intent.reason } : {}),
          }
        : {}),
    },
    overrideAccess: true,
  })
  const fresh = await findRecoveryOrder(payload, order.orderNumber!)
  if (
    !fresh ||
    fresh.status !== status ||
    !isDeepStrictEqual(validatedRefundHistory(fresh), existing ? entries : [...entries, entry]) ||
    (entry.type === 'full' &&
      (fresh.refundedAt !== entry.refundedAt ||
        (fresh.refundReason ?? null) !== (intent.reason ?? null)))
  )
    throw new Error('refund recovery: financial write unverified')
  return { order: fresh, entry }
}

async function cleanup(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
  entry: OrderRefundEntry,
): Promise<boolean> {
  const manual = async () => {
    await writeReceipt(payload, intent, RECEIPTS.cleanupManual, { version: 1, manual: true })
    return false
  }
  const done = await readReceipt(payload, intent, RECEIPTS.cleanupDone)
  if (done)
    return (
      done.completed === true &&
      (done.reason === 'partial'
        ? entry.type === 'partial'
        : done.reason === 'resolved' && done.cleanupKind === 'sql-access-v1')
    )
  if (entry.type === 'partial') {
    await writeReceipt(payload, intent, RECEIPTS.cleanupDone, {
      version: 1,
      completed: true,
      reason: 'partial',
    })
    return true
  }
  const prepared = await readReceipt(payload, intent, RECEIPTS.prepared)
  const customerId = relationId(order.customer)
  if (
    !prepared ||
    customerId === null ||
    prepared.customerId !== customerId ||
    !isRecord(prepared.accessBaseline) ||
    prepared.accessBaseline.customerId !== customerId
  )
    return manual()
  return withUserPurchasesLock(payload, customerId, async () => {
    // The access store atomically deletes only proven relation incarnations and writes the done receipt.
    // A separate read after its transaction is the commit evidence, never the returned update value.
    await applyRefundAccessCleanup(payload, {
      intent,
      baseline: prepared.accessBaseline as unknown as RefundAccessBaseline,
      productIds: productIds(order),
    })
    const verified = await readReceipt(payload, intent, RECEIPTS.cleanupDone)
    if (
      verified?.completed === true &&
      verified.reason === 'resolved' &&
      ['sql-access-v1', 'sql-access-v2'].includes(String(verified.cleanupKind))
    )
      return true
    return manual()
  })
}

function invoiceRecorded(
  order: Order,
  intent: RefundIntent,
  entry: OrderRefundEntry,
): string | null {
  if (entry.type === 'full' && intent.refundSequence === 1) {
    return order.stornoStatus === 'storned' && order.stornoNumber?.trim()
      ? order.stornoNumber
      : null
  }
  return order.correctiveInvoiceStatus === 'issued' &&
    order.correctiveInvoiceSeq === intent.refundSequence &&
    order.correctiveInvoiceNumber?.trim()
    ? order.correctiveInvoiceNumber
    : null
}

async function invoice(
  options: RecoveryOptions,
  order: Order,
  intent: RefundIntent,
  entry: OrderRefundEntry,
): Promise<boolean> {
  const { payload } = options
  let number = invoiceRecorded(order, intent, entry)
  const done = await readReceipt(payload, intent, RECEIPTS.invoiceDone)
  if (done)
    return (
      typeof done.number === 'string' &&
      done.number.length > 0 &&
      done.sequence === intent.refundSequence &&
      done.number === number
    )
  if (!number) {
    if (await readReceipt(payload, intent, RECEIPTS.invoiceStarted)) return false
    if (!order.invoiceNumber?.trim()) return false
    const storno = entry.type === 'full' && intent.refundSequence === 1
    if (
      storno
        ? (order.stornoAttempts ?? 0) > 0 ||
          order.stornoStatus === 'pending' ||
          order.stornoStatus === 'storned'
        : (order.correctiveInvoiceAttemptsSeq === intent.refundSequence &&
            (order.correctiveInvoiceAttempts ?? 0) > 0) ||
          order.correctiveInvoiceStatus === 'pending' ||
          (order.correctiveInvoiceSeq ?? 0) >= intent.refundSequence
    )
      return false
    // Existing helpers own their invoice locks and provider guards. No automatic retry job is queued.
    if (storno)
      await (options.issueStorno ?? issueStornoForOrder)(order, {
        payload,
        logger: options.logger,
        ...(intent.reason ? { reason: intent.reason } : {}),
      })
    else
      await (options.issueCorrective ?? issueCorrectiveInvoiceForOrder)(order, {
        payload,
        logger: options.logger,
        refundSeq: intent.refundSequence,
        amountHuf: intent.requestedAmountHuf,
        ...(intent.reason ? { reason: intent.reason } : {}),
      })
    const fresh = await findRecoveryOrder(payload, options.orderNumber)
    number = fresh ? invoiceRecorded(fresh, intent, entry) : null
  }
  if (!number) return false
  await writeReceipt(payload, intent, RECEIPTS.invoiceDone, {
    version: 1,
    number,
    sequence: intent.refundSequence,
  })
  return true
}

type StuckIntentOutcome =
  | { kind: 'none' }
  | { kind: 'succeeded' }
  | { kind: 'no_effect'; neverLaunched: boolean; automatic: boolean }
  | { kind: 'pending'; message: string }

/** A kísérlet előtti, validált refund-nyom; null, ha a sorszám nem ehhez a kísérlethez illik. */
function ownerLedger(
  order: Order,
  intent: RefundIntent,
): { totalHuf: number; alreadyRefundedHuf: number } | null {
  const entries = validatedRefundHistory(order)
  if (entries.length !== intent.refundSequence - 1) return null
  return {
    totalHuf: total(order),
    alreadyRefundedHuf: entries.reduce((sum, entry) => sum + entry.amountHuf, 0),
  }
}

/**
 * Elakadt (nem provider_succeeded) kísérlet lezárása bizonyíték alapján.
 * A GetState olvasás, pénzt nem mozgat, és a rendelés-zár ELŐTT fut; a zár
 * alatt csak akkor döntünk, ha a kísérlet azonosítója és állapota közben nem
 * változott (egy futó indító a teljes Barion-hívás alatt ugyanezt a zárat tartja).
 */
async function reconcileStuckIntent(
  options: RecoveryOptions,
  orderId: number,
  log: Logger,
): Promise<StuckIntentOutcome> {
  const { payload, orderNumber } = options
  const seen = await loadActiveRefundIntent(payload, orderId)
  if (!seen || seen.state === 'provider_succeeded') return { kind: 'none' }
  let state: BarionPaymentStateResponse | null = null
  if (RECONCILABLE_LAUNCHED_STATES.has(seen.state)) {
    try {
      state = await fetchPaymentState(seen.providerPaymentId)
    } catch {
      log.warn('refund recovery: a Barion-allapot nem kerdezheto le', { orderId })
      return { kind: 'pending', message: RECONCILE_UNAVAILABLE }
    }
  } else if (seen.state !== 'prepared') {
    return { kind: 'pending', message: MANUAL }
  }
  return withAdvisoryLock(
    payload,
    refundLockKey(orderId),
    async (): Promise<StuckIntentOutcome> => {
      const intent = await loadActiveRefundIntent(payload, orderId)
      const order = await findRecoveryOrder(payload, orderNumber)
      if (!intent || !order || intent.id !== seen.id || intent.state !== seen.state)
        return { kind: 'pending', message: RECONCILE_CHANGED }
      const automatic = isAutomaticRefundIntent(intent)
      if (intent.state === 'prepared') {
        await releaseNeverLaunchedIntent(payload, intent, options.now)
        return { kind: 'no_effect', neverLaunched: true, automatic }
      }
      if (!state) return { kind: 'pending', message: MANUAL }
      const settlement = await reconcileLaunchedIntent({
        payload,
        order,
        intent,
        state,
        ownerLedger: automatic ? null : ownerLedger(order, intent),
        now: options.now,
      })
      log.info('refund recovery: a Barion-allapot egyeztetve', {
        orderId,
        outcome: settlement.kind,
        ...(settlement.kind === 'pending' ? { reason: settlement.reason } : {}),
      })
      if (settlement.kind === 'succeeded') return { kind: 'succeeded' }
      if (settlement.kind === 'no_effect')
        return { kind: 'no_effect', neverLaunched: false, automatic }
      return { kind: 'pending', message: pendingMessage(settlement) }
    },
    log,
  )
}

/**
 * Shared by the new-refund flow and explicit recovery. Never sends money: an
 * unfinished attempt is settled only from evidence (the Barion GetState read).
 */
export async function recoverRefundOrder(options: RecoveryOptions): Promise<{
  orderNumber: string
  recoveryStatus: 'completed' | 'manual_review'
  message: string
}> {
  const { payload, orderNumber } = options
  const log = options.logger ?? logger
  const manual = { orderNumber, recoveryStatus: 'manual_review' as const, message: MANUAL }
  try {
    const preOrder = await findRecoveryOrder(payload, orderNumber)
    if (!preOrder) return manual
    // This coordinator serializes recovery without holding a user/order transaction over invoice HTTP.
    return await withAdvisoryLock(
      payload,
      `refund-recovery:order:${preOrder.id}`,
      async () => {
        const settled = await reconcileStuckIntent(options, preOrder.id, log)
        if (settled.kind === 'pending')
          return { orderNumber, recoveryStatus: 'manual_review' as const, message: settled.message }
        if (settled.kind === 'no_effect') {
          const status = await getRefundRecoveryStatus({ payload, orderNumber })
          return status.state === 'clear'
            ? {
                orderNumber,
                recoveryStatus: 'completed' as const,
                message: settled.automatic
                  ? AUTOMATIC_ATTEMPT_CLOSED
                  : settled.neverLaunched
                    ? NEVER_LAUNCHED_CLOSED
                    : NO_EFFECT_CLOSED,
              }
            : { orderNumber, recoveryStatus: 'manual_review' as const, message: status.message }
        }
        const financial = await withAdvisoryLock(
          payload,
          refundLockKey(preOrder.id),
          async () => {
            const intent = await loadActiveRefundIntent(payload, preOrder.id)
            const order = await findRecoveryOrder(payload, orderNumber)
            if (!intent || !order || intent.state !== 'provider_succeeded') return null
            if (isAutomaticRefundIntent(intent)) {
              await commitAutomaticRefund(payload, order, intent)
              return { automatic: true as const }
            }
            return {
              automatic: false as const,
              ...(await ensureFinancialEntry(payload, order, intent)),
              intent,
            }
          },
          log,
        )
        if (!financial) {
          const status = await getRefundRecoveryStatus({ payload, orderNumber })
          return status.state === 'clear'
            ? { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
            : { orderNumber, recoveryStatus: 'manual_review' as const, message: status.message }
        }
        if (financial.automatic)
          return { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
        const { order, intent, entry } = financial
        const phase = async (name: string, run: () => Promise<boolean>): Promise<boolean> => {
          try {
            return await run()
          } catch {
            log.warn('refund recovery: helyi feldolgozasi lepes ellenorzest igenyel', {
              phase: name,
              orderId: order.id,
            })
            return false
          }
        }
        const cleaned = await phase('cleanup', () =>
          withAdvisoryLock(
            payload,
            refundLockKey(order.id),
            () => cleanup(payload, order, intent, entry),
            log,
          ),
        )
        const audited = await phase('audit', () =>
          withAdvisoryLock(
            payload,
            refundLockKey(order.id),
            async () => {
              await writeReceipt(
                payload,
                intent,
                entry.type === 'full' ? 'order-refund' : 'order-partial-refund',
                {
                  version: 1,
                  orderId: order.id,
                  sequence: intent.refundSequence,
                  amountHuf: entry.amountHuf,
                  transactionId: entry.transactionId,
                  status: entry.status,
                },
              )
              return true
            },
            log,
          ),
        )
        const invoiced = await phase('invoice', async () => {
          const fresh = await findRecoveryOrder(payload, orderNumber)
          return fresh ? invoice(options, fresh, intent, entry) : false
        })
        if (!cleaned || !audited || !invoiced)
          return { orderNumber, recoveryStatus: 'manual_review' as const, message: LOCAL_BLOCKED }
        await withAdvisoryLock(
          payload,
          refundLockKey(order.id),
          async () => {
            const fresh = await loadActiveRefundIntent(payload, order.id)
            if (!fresh || fresh.id !== intent.id || fresh.state !== 'provider_succeeded')
              throw new Error('refund recovery: commit conflict')
            const verified = await findRecoveryOrder(payload, orderNumber)
            const cleanupProof = await readReceipt(payload, fresh, RECEIPTS.cleanupDone)
            const invoiceProof = await readReceipt(payload, fresh, RECEIPTS.invoiceDone)
            const auditProof = await readReceipt(
              payload,
              fresh,
              entry.type === 'full' ? 'order-refund' : 'order-partial-refund',
            )
            if (
              !verified ||
              cleanupProof?.completed !== true ||
              !auditProof ||
              invoiceProof?.number !== invoiceRecorded(verified, fresh, entry)
            )
              throw new Error('refund recovery: completion unverified')
            await ensureFinancialEntry(payload, verified, fresh)
            await transitionRefundIntent(payload, fresh, 'committed')
          },
          log,
        )
        return { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
      },
      log,
    )
  } catch {
    log.warn('refund recovery: tartos allapot ellenorzese szukseges', { orderNumber })
    return manual
  }
}

async function storageRecoveryStatus({
  payload,
  orderNumber,
}: {
  payload: Payload
  orderNumber: string
}): Promise<{
  orderNumber: string
  state: 'clear' | 'manual_review' | 'recoverable'
  message: string
}> {
  try {
    const order = await findRecoveryOrder(payload, orderNumber)
    if (!order) return { orderNumber, state: 'manual_review', message: MANUAL }
    const intent = await loadActiveRefundIntent(payload, order.id)
    if (intent) {
      // Elakadt kísérlet: a „Feldolgozás folytatása” bizonyítékból zárja le (reconcileStuckIntent).
      if (intent.state !== 'provider_succeeded')
        return { orderNumber, ...stuckIntentStatus(intent, Date.now()) }
      if (isAutomaticRefundIntent(intent)) {
        return (await canRecoverAutomaticRefund(payload, order, intent))
          ? {
              orderNumber,
              state: 'recoverable',
              message: 'A sikeres visszatérítés rögzítése folytatható új pénzvisszatérítés nélkül.',
            }
          : { orderNumber, state: 'manual_review', message: LOCAL_BLOCKED }
      }
      if (!(await readReceipt(payload, intent, RECEIPTS.provider)))
        return { orderNumber, state: 'manual_review', message: MANUAL }
      const entries = validatedRefundHistory(order)
      if (entries.length === intent.refundSequence - 1)
        return { orderNumber, state: 'recoverable', message: CONTINUE }
      if (entries.length !== intent.refundSequence)
        return { orderNumber, state: 'manual_review', message: MANUAL }
      const entry = entries[intent.refundSequence - 1]
      const cleanupDone = await readReceipt(payload, intent, RECEIPTS.cleanupDone)
      const cleanupBlocked =
        (await readReceipt(payload, intent, RECEIPTS.cleanupStarted)) ||
        (await readReceipt(payload, intent, RECEIPTS.cleanupManual))
      const auditDone = await readReceipt(
        payload,
        intent,
        entry.type === 'full' ? 'order-refund' : 'order-partial-refund',
      )
      const invoiceDone = await readReceipt(payload, intent, RECEIPTS.invoiceDone)
      const invoiceStarted = await readReceipt(payload, intent, RECEIPTS.invoiceStarted)
      const canCleanup =
        !cleanupDone && !cleanupBlocked && !!(await readReceipt(payload, intent, RECEIPTS.prepared))
      const canInvoice =
        !invoiceDone &&
        (!!invoiceRecorded(order, intent, entry) || (!invoiceStarted && !!order.invoiceNumber))
      const ready = cleanupDone?.completed === true && !!auditDone && !!invoiceDone
      return canCleanup || !auditDone || canInvoice || ready
        ? { orderNumber, state: 'recoverable', message: CONTINUE }
        : { orderNumber, state: 'manual_review', message: LOCAL_BLOCKED }
    }
    const entries = validatedRefundHistory(order)
    if (entries.length > 0 || order.status === 'refunded') {
      const committed = await payload.find({
        collection: 'refund-intents',
        where: { and: [{ order: { equals: order.id } }, { state: { equals: 'committed' } }] },
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      })
      if (
        committed.hasNextPage ||
        committed.totalDocs !== committed.docs.length ||
        committed.docs.length !== entries.length ||
        entries.length === 0
      ) {
        return { orderNumber, state: 'manual_review', message: MANUAL }
      }
      for (let index = 0; index < entries.length; index += 1) {
        const matching = committed.docs.filter((item) => item.refundSequence === index + 1)
        const entry = entries[index]
        if (matching.length !== 1) return { orderNumber, state: 'manual_review', message: MANUAL }
        const item = matching[0]
        if (isAutomaticRefundIntent(item)) {
          if (
            entries.length !== 1 ||
            !(await verifyAutomaticRefundCompletion(payload, order, item))
          )
            return { orderNumber, state: 'manual_review', message: MANUAL }
          continue
        }
        const invoiceProof = await readReceipt(payload, item, RECEIPTS.invoiceDone)
        if (
          relationId(item.order) !== order.id ||
          item.state !== 'committed' ||
          item.activeOrderKey != null ||
          item.requestedAmountHuf !== entry.amountHuf ||
          item.providerTransactionId !== entry.transactionId ||
          item.providerPaymentId !== order.barionPaymentId ||
          item.providerResolvedAt !== entry.refundedAt ||
          !(await readReceipt(payload, item, RECEIPTS.cleanupDone))?.completed ||
          typeof invoiceProof?.number !== 'string' ||
          !invoiceProof.number.trim() ||
          (index === entries.length - 1 &&
            invoiceProof.number !== invoiceRecorded(order, item, entry)) ||
          !(await readReceipt(
            payload,
            item,
            entry.type === 'full' ? 'order-refund' : 'order-partial-refund',
          ))
        ) {
          return { orderNumber, state: 'manual_review', message: MANUAL }
        }
      }
    }
    return { orderNumber, state: 'clear', message: COMPLETE }
  } catch {
    return { orderNumber, state: 'manual_review', message: UNREADABLE }
  }
}

export async function getRefundRecoveryStatus(options: {
  payload: Payload
  orderNumber: string
  operationKey?: string
}): Promise<{
  orderNumber: string
  state: 'clear' | 'manual_review' | 'recoverable'
  message: string
  operationState?: 'unseen' | 'pending' | 'completed' | 'no_effect'
}> {
  const status = await storageRecoveryStatus(options)
  if (options.operationKey === undefined) return status
  try {
    const order = await findRecoveryOrder(options.payload, options.orderNumber)
    if (!order) throw new Error('refund recovery: missing order')
    const intent = await loadRefundIntentForOperation(
      options.payload,
      order.id,
      options.operationKey,
    )
    const operationState = !intent
      ? 'unseen'
      : intent.state === 'provider_failed'
        ? 'no_effect'
        : intent.state === 'committed' && status.state === 'clear'
          ? 'completed'
          : 'pending'
    return { ...status, operationState }
  } catch {
    return {
      orderNumber: options.orderNumber,
      state: 'manual_review',
      message: UNREADABLE,
      operationState: 'pending',
    }
  }
}
