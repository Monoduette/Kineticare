import type { Payload } from 'payload'
import { isDeepStrictEqual } from 'node:util'
import type { Order, RefundIntent, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { withUserPurchasesLock } from '../user-purchases-lock'
import { applyRefundAccessCleanup, type RefundAccessBaseline } from './access-store'
import { logger, type Logger } from '../logger'
import { issueStornoForOrder, issueCorrectiveInvoiceForOrder } from '../szamlazz'
import {
  loadActiveRefundIntent,
  loadRefundIntentForOperation,
  transitionRefundIntent,
} from './intent-store'
import {
  productIds,
  isRecord,
  readReceipt,
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

const MANUAL =
  'A visszatérítés további ellenőrzést igényel. Ne indíts új pénzvisszatérítést. Ellenőrizd a Barion eredményét, a vevő hozzáféréseit és a bizonylatot.'
const CONTINUE =
  'A Barion sikeres eredménye rögzítve van. A hozzáférések, a napló és a bizonylat feldolgozása folytatható új pénzvisszatérítés nélkül.'
const COMPLETE = 'A visszatérítés helyi feldolgozása befejeződött.'

interface RecoveryOptions {
  payload: Payload
  orderNumber: string
  actor: User
  headers?: Headers
  ipAddress?: string
  logger?: Logger
  issueStorno?: RefundOrderOptions['issueStorno']
  issueCorrective?: RefundOrderOptions['issueCorrective']
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
  const proof = await readReceipt(payload, intent, RECEIPTS.provider)
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
      verified.cleanupKind === 'sql-access-v1'
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

/** Shared by the new-refund flow and explicit recovery. Never calls Barion. */
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
        const financial = await withAdvisoryLock(
          payload,
          refundLockKey(preOrder.id),
          async () => {
            const intent = await loadActiveRefundIntent(payload, preOrder.id)
            const order = await findRecoveryOrder(payload, orderNumber)
            if (!intent || !order || intent.state !== 'provider_succeeded') return null
            return { ...(await ensureFinancialEntry(payload, order, intent)), intent }
          },
          log,
        )
        if (!financial) {
          const status = await getRefundRecoveryStatus({ payload, orderNumber })
          return status.state === 'clear'
            ? { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
            : manual
        }
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
        if (!cleaned || !audited || !invoiced) return manual
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
      if (
        intent.state !== 'provider_succeeded' ||
        !(await readReceipt(payload, intent, RECEIPTS.provider))
      )
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
        : { orderNumber, state: 'manual_review', message: MANUAL }
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
    return { orderNumber, state: 'manual_review', message: MANUAL }
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
      message: MANUAL,
      operationState: 'pending',
    }
  }
}
