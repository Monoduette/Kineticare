import type { Payload } from 'payload'
import type { Order, RefundIntent } from '../../payload-types'
import { loadRefundIntentsForOrder } from '../refund/intent-store'
import { isRefundIntentUnresolved } from '../refund/refund-intent'
import {
  isRecord,
  readReceipt,
  RECEIPTS,
  REFUND_INVOICE_NO_EFFECT_ACTION,
  REFUND_INVOICE_RESUBMIT_STARTED_ACTION,
  REFUND_INVOICE_RETRY_QUEUED_ACTION,
  relationId,
  retryQueuedAtMs,
  createReceipt,
} from '../refund/recovery-receipts'

type DocumentKind = 'storno' | 'corrective'
export interface ManagedRefundDocument {
  intent: RefundIntent
  kind: DocumentKind
  number: string | null
}

/**
 * A refund-őr elutasító szövege (belső, angol). A helyesbítő-kiállítás a
 * rendelés utolsó hibájaként menti, és a visszatérítési panel erről ismeri
 * fel, hogy nem a Számlázz.hu válasza, hanem a saját őrünk döntése
 * (refund-recovery.ts). A szöveg ezért nem változhat.
 */
export const REFUND_DOCUMENT_GUARD_REFUSAL =
  'Refund document requires verified reconciliation; automatic submission is blocked.'

/**
 * A refund-őr elutasítása: a bizonylat automatikusan nem küldhető be (nincs
 * igazolt egyeztetés, vagy egy korábbi beküldés kimenete nem zárható ki).
 * Újrapróbálás nem változtat rajta, ezért a helyesbítő-job nem dob vele
 * tovább (jobs/tasks/corrective-invoice-issue.ts).
 */
export class RefundDocumentGuardError extends Error {
  constructor() {
    super(REFUND_DOCUMENT_GUARD_REFUSAL)
    this.name = 'RefundDocumentGuardError'
  }
}

/**
 * Eddig dolgozhat a sorba állított helyesbítő-job (a refund-invoice-retry-queued
 * nyugta `queuedAt` idejétől). Utána a visszatérítési panel a kézi rendezést
 * kéri: előbb keresést a Számlázz.hu-fiókban, és csak üres találatnál kézi
 * kiállítást (refund-recovery.ts). Ezért az őr ettől kezdve ismételt beküldést
 * sem enged, különben a kézzel kiállított helyesbítő mellé egy késve futó job
 * is beküldhetne egyet.
 *
 * Miért 2 óra: az order-maintenance sor 5 percenként fut
 * (ORDER_MAINTENANCE_CRON, jobs/queues.ts), egy ütemben legfeljebb 3 jobot
 * vesz fel (ORDER_MAINTENANCE_AUTORUN_LIMIT, jobs/index.ts), a job pedig
 * `retries: 3` mellett legfeljebb négyszer fut, várakoztatás nélkül a
 * következő ütemekben: torlódás nélkül ez nagyjából 20 perc. A 2 óra ennek
 * hatszorosa, így egy újraindítás vagy egy Számlázz.hu-kimaradás utáni
 * torlódás sem vág el egy még élő jobot. Ugyanennyi a Figyelmet igényel
 * blokk türelmi ideje a hiányzó helyesbítőre (INVOICE_MISSING_AFTER_MS,
 * alerts/attention.ts).
 */
export const CORRECTIVE_RETRY_ESCALATION_MS = 2 * 60 * 60 * 1000

/** Lejárt-e a sorba állított helyesbítő-job ideje; a `queuedAt` nélküli (régi) nyugta nem jár le. */
export function isCorrectiveRetryExpired(
  receipt: Record<string, unknown> | null,
  nowMs: number,
): boolean {
  const queuedAt = retryQueuedAtMs(receipt)
  return queuedAt !== null && nowMs - queuedAt >= CORRECTIVE_RETRY_ESCALATION_MS
}

const SUCCESS = new Set(['Succeeded', 'Refunded', 'PartiallyRefunded'])

/**
 * Igazoltan hatás nélküli (no-effect) sikertelen kísérlet: provider_failed,
 * érvényes egyeztetési bizonyítékkal. A bizonyíték érvényességét ugyanaz a
 * szabály dönti el, mint az intent-tárolóét (isRefundIntentUnresolved): ami
 * bizonyíték nélküli vagy hibás, az továbbra is feloldatlannak, tehát
 * blokkolónak számít.
 */
function isProviderNoEffectFailure(intent: RefundIntent): boolean {
  if (
    intent.state !== 'provider_failed' ||
    typeof intent.reconciliationCheckedAt !== 'string' ||
    typeof intent.reconciliationReference !== 'string'
  ) {
    return false
  }
  return !isRefundIntentUnresolved('provider_failed', {
    kind: 'provider_confirmed_no_effect',
    confirmedAt: intent.reconciliationCheckedAt,
    reference: intent.reconciliationReference,
  })
}

/** Called under the existing document lock by every issuer, including jobs. */
export async function managedRefundDocument(
  payload: Payload,
  order: Order,
  kind: DocumentKind,
  sequence = 1,
  amountHuf?: number,
): Promise<ManagedRefundDocument | null> {
  // A Barion által igazoltan HATÁS NÉLKÜL lezárt kísérlet (provider_failed +
  // egyeztetési bizonyíték) nem mozgatott pénzt, tehát bizonylatot sem
  // igényel: a döntésből kimarad. Ha csak ilyenek vannak, a rendelés a
  // hagyományos (nem intent-kezelt) úton megy, ahogy intent nélkül is.
  const intents = (await loadRefundIntentsForOrder(payload, order.id)).filter(
    (intent) => !isProviderNoEffectFailure(intent),
  )
  if (intents.length === 0) return null
  const matching = intents.filter(
    (intent) =>
      intent.refundSequence === sequence &&
      (intent.state === 'provider_succeeded' || intent.state === 'committed'),
  )
  if (matching.length !== 1 || !Array.isArray(order.refunds)) throw new RefundDocumentGuardError()
  const intent = matching[0]
  const total = order.totalHufSnapshot ?? order.amount
  const history: unknown[] = order.refunds
  if (
    !Number.isSafeInteger(total) ||
    (total ?? 0) <= 0 ||
    sequence < 1 ||
    sequence > history.length
  ) {
    throw new RefundDocumentGuardError()
  }
  let refunded = 0
  let preceding = 0
  for (let index = 0; index < history.length; index++) {
    const entry = history[index]
    if (
      !isRecord(entry) ||
      typeof entry.transactionId !== 'string' ||
      !entry.transactionId ||
      typeof entry.amountHuf !== 'number' ||
      !Number.isSafeInteger(entry.amountHuf) ||
      entry.amountHuf <= 0 ||
      typeof entry.status !== 'string' ||
      !SUCCESS.has(entry.status) ||
      typeof entry.refundedAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.refundedAt))
    )
      throw new RefundDocumentGuardError()
    if (index === sequence - 1) preceding = refunded
    refunded += entry.amountHuf
    if (
      !Number.isSafeInteger(refunded) ||
      refunded > total! ||
      entry.type !== (refunded === total ? 'full' : 'partial')
    )
      throw new RefundDocumentGuardError()
  }
  if (order.status !== (refunded === total ? 'refunded' : 'paid'))
    throw new RefundDocumentGuardError()
  const entry = history[sequence - 1] as Record<string, unknown>
  const expectedKind = sequence === 1 && entry.type === 'full' ? 'storno' : 'corrective'
  if (
    kind !== expectedKind ||
    relationId(intent.order) !== order.id ||
    order.barionPaymentId !== intent.providerPaymentId ||
    entry.transactionId !== intent.providerTransactionId ||
    entry.amountHuf !== intent.requestedAmountHuf ||
    entry.refundedAt !== intent.providerResolvedAt ||
    (amountHuf !== undefined && amountHuf !== intent.requestedAmountHuf)
  )
    throw new RefundDocumentGuardError()
  const proof = await readReceipt(payload, intent, RECEIPTS.provider)
  if (
    !proof ||
    proof.paymentId !== intent.providerPaymentId ||
    proof.transactionId !== intent.providerTransactionId ||
    proof.amountHuf !== intent.requestedAmountHuf ||
    proof.sequence !== sequence ||
    proof.status !== entry.status ||
    proof.totalHuf !== total ||
    proof.alreadyRefundedHuf !== preceding ||
    proof.type !== entry.type
  ) {
    throw new RefundDocumentGuardError()
  }
  const done = await readReceipt(payload, intent, RECEIPTS.invoiceDone)
  if (
    done &&
    (done.sequence !== sequence || typeof done.number !== 'string' || !done.number.trim())
  ) {
    throw new RefundDocumentGuardError()
  }
  return { intent, kind, number: done ? (done.number as string) : null }
}

/**
 * Existing or unacknowledged claims never authorize another POST after a negative lookup.
 *
 * Egyetlen kivétel, csak helyesbítőnél (stornónál soha, F3): ha az ELSŐ
 * beküldés igazoltan hatás nélkül maradt (a no-effect nyugta az 1. kísérletre
 * szól, corrective.ts), a második beküldés egyszer engedélyezett. A hívó a
 * beküldés előtti szamlaKulsoAzon-lekérdezést ekkor már lefuttatta (negatív
 * volt), és a MAX_CORRECTIVE_ATTEMPTS plafon is előtte dönt. Az ismételt
 * beküldés nyugtája (resubmit-started) csak egyszer jöhet létre, így harmadik
 * beküldés nincs. A kivétel csak a sorba állított job idején belül él
 * (CORRECTIVE_RETRY_ESCALATION_MS a sorba állítás jelzésének `queuedAt`
 * idejétől); jelzés nélkül sem.
 */
export async function claimManagedRefundDocument(
  payload: Payload,
  managed: ManagedRefundDocument,
  previousAttempts: number,
): Promise<void> {
  if (managed.intent.state !== 'provider_succeeded' || managed.number)
    throw new RefundDocumentGuardError()
  const started = await readReceipt(payload, managed.intent, RECEIPTS.invoiceStarted)
  if (previousAttempts === 0 && !started) {
    await createReceipt(payload, managed.intent, RECEIPTS.invoiceStarted, {
      version: 1,
      kind: managed.kind,
      sequence: managed.intent.refundSequence,
    })
    return
  }
  if (
    managed.kind === 'corrective' &&
    previousAttempts === 1 &&
    started?.kind === 'corrective' &&
    (await provenNoEffectFirstSubmission(payload, managed.intent))
  ) {
    await createReceipt(payload, managed.intent, REFUND_INVOICE_RESUBMIT_STARTED_ACTION, {
      version: 1,
      kind: 'corrective',
      sequence: managed.intent.refundSequence,
      attempt: 2,
    })
    return
  }
  throw new RefundDocumentGuardError()
}

/**
 * Az első helyesbítő-beküldés igazoltan hatás nélkül maradt, és ismételt
 * beküldés még nem indult, a sorba állított job ideje pedig nem járt le.
 * Olvasható `queuedAt` nélkül (a sorba állítás jelzése nem íródott meg) a
 * határidő nem mérhető: ilyenkor a panel sem tiltja a kézi kiállítást, ezért
 * ismételt beküldés sincs.
 */
async function provenNoEffectFirstSubmission(
  payload: Payload,
  intent: RefundIntent,
): Promise<boolean> {
  const noEffect = await readReceipt(payload, intent, REFUND_INVOICE_NO_EFFECT_ACTION)
  if (noEffect?.kind !== 'corrective' || noEffect.attempt !== 1) return false
  if (await readReceipt(payload, intent, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)) return false
  const queued = await readReceipt(payload, intent, REFUND_INVOICE_RETRY_QUEUED_ACTION)
  return retryQueuedAtMs(queued) !== null && !isCorrectiveRetryExpired(queued, Date.now())
}
