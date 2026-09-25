import type { Payload } from 'payload'
import { isDeepStrictEqual } from 'node:util'
import type { Order, RefundIntent, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { withUserPurchasesLock } from '../user-purchases-lock'
import {
  applyRefundAccessCleanup,
  type RefundAccessBaseline,
  type RefundAccessCleanupResult,
} from './access-store'
import { courseTitle } from '../courses'
import { hatarozottNevelo } from '../email/templates/order'
import { logger, type Logger } from '../logger'
import {
  canRecoverAutomaticRefund,
  commitAutomaticRefund,
  isAutomaticRefundIntent,
  isNeverPaidRefundCandidate,
  verifyAutomaticRefundCompletion,
} from './auto-refund-recovery'
import {
  isCurrentAutomaticRefundBlock,
  readLatestAutomaticRefundBlock,
  type AutomaticRefundBlockDetail,
} from './automatic-block'
import {
  automaticRetryDeadline,
  decideAutomaticRetry,
  isResolvedAutomaticFailure,
  latestAutomaticFailure,
  MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS,
  nonFixableRejectionCode,
  type AutomaticRetryDecision,
} from './automatic-retry'
import { rejectionCodesFromReference } from './barion-refund-evidence'
import {
  isRetryableCorrectiveError,
  issueCorrectiveInvoiceForOrder,
  issueStornoForOrder,
  queueCorrectiveInvoiceJob,
} from '../szamlazz'
import { CORRECTIVE_LOCAL_ERROR_PREFIX } from '../szamlazz/corrective'
import { legacyCorrectiveKulsoAzon } from '../szamlazz/kulso-azon'
import { isCorrectiveRetryExpired, REFUND_DOCUMENT_GUARD_REFUSAL } from '../szamlazz/refund-guard'
import { fetchPaymentState, type BarionPaymentStateResponse } from '../barion'
import { formatPriceHuf } from '../format-price'
import {
  loadActiveRefundIntent,
  loadRefundIntentForOperation,
  loadRefundIntentsForOrder,
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
  REFUND_INVOICE_RETRY_QUEUED_ACTION,
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
import { sendRefundNotice, type SendRefundNoticeInput } from './refund-notice'
import { REFUND_RECOVERY_ACTION_LABEL } from './recovery-action-label'

/**
 * A tulajdonosnak szóló állapotüzenetek: mi a helyzet, és mi a következő lépés
 * (GOV.UK Error message: „say what has happened and how to fix it”; NN/g
 * Error-Message Guidelines: „offer … remedies”). Minden nem rendezett
 * állapot szövege önmagában teljes, a panel nem fűz hozzá általános
 * útmutatót (src/components/admin/RefundPanel.tsx). A gombra a tényleges
 * nevével hivatkozunk (recovery-action-label.ts, WCAG 2.2 SC 3.2.4).
 */
const RECOVER = `„${REFUND_RECOVERY_ACTION_LABEL}”`
const MANUAL =
  'A visszatérítés mentett adatai nem egyeznek a rendeléssel, ezért ez kézi ellenőrzést igényel. Ne indíts új pénzvisszatérítést, és jelezd az üzemeltetőnek a rendelésszámmal együtt.'
const UNREADABLE =
  'A visszatérítés mentett állapota most nem olvasható, ezért új pénzvisszatérítést most ne indíts. Frissítsd az oldalt pár perc múlva, és ha ez marad, jelezd az üzemeltetőnek.'
const INTERRUPTED = `A feldolgozás most nem fejeződött be, új pénzvisszatérítés nem indult. Frissítsd az oldalt, és ha a ${RECOVER} gomb ismét látszik, pár perc múlva próbáld újra. Ha ez ismétlődik, jelezd az üzemeltetőnek.`
const LOCAL_BLOCKED =
  'A Barion visszaigazolta a visszatérítést, de a helyi feldolgozás (hozzáférés vagy számla) elakadt, és automatikusan nem folytatható. Ne indíts új pénzvisszatérítést, és jelezd az üzemeltetőnek a rendelésszámmal együtt.'
const LOCAL_BLOCKED_LEAD =
  'A Barion visszaigazolta a visszatérítést, és a rendelésen rögzítve van, de a helyi feldolgozás elakadt.'
const NO_NEW_REFUND = 'Ne indíts új pénzvisszatérítést.'
const CONTINUE =
  'A Barion sikeres eredménye rögzítve van. A hozzáférések, a napló és a bizonylat feldolgozása folytatható új pénzvisszatérítés nélkül.'
const COMPLETE = 'A visszatérítés helyi feldolgozása befejeződött.'
const STUCK_PREPARED = `Egy korábbi visszatérítés előkészítése megszakadt, a Barionnak nem ment kérés, pénzmozgás nem történt. A ${RECOVER} lezárja ezt a kísérletet, utána új visszatérítés indítható.`
const STUCK_PREPARED_AUTOMATIC = `Az automatikus visszatérítés egyik kísérlete az előkészítésnél megszakadt, a Barionnak nem ment kérés, pénzmozgás nem történt. A ${RECOVER} lezárja ezt a kísérletet. A további kísérletekről a fizetés-ellenőrzés gondoskodik, itt nem kell visszatérítést indítanod.`
const IN_FLIGHT =
  'A visszatérítési kérés most megy a Barionhoz, vagy épp most jött meg rá a válasz. Várj egy percet, majd frissítsd az oldalt.'
const UNKNOWN_OUTCOME = `A Barion válaszából nem derült ki biztosan, megtörtént-e a visszatérítés. A ${RECOVER} lekérdezi az eredményt a Barionból, új pénzvisszatérítést nem indít.`
const NEVER_LAUNCHED_CLOSED =
  'A megszakadt kísérlet lezárva, a Barionnak nem ment kérés, pénzmozgás nem történt. A rendelésen új visszatérítés indítható.'
const NO_EFFECT_CLOSED =
  'A Barion adatai szerint ez a visszatérítés nem történt meg, pénzmozgás nem volt. A kísérlet lezárva, a rendelésen új visszatérítés indítható.'
const AUTOMATIC_ATTEMPT_CLOSED =
  'Az automatikus visszatérítés kísérlete lezárva: a Barion adatai szerint pénzmozgás nem történt. A további kísérletekről a fizetés-ellenőrzés gondoskodik.'
const AUTOMATIC_NEVER_LAUNCHED_CLOSED =
  'Az automatikus visszatérítés megszakadt kísérlete lezárva, a Barionnak nem ment kérés, pénzmozgás nem történt. A további kísérletekről a fizetés-ellenőrzés gondoskodik.'
const RECONCILE_UNAVAILABLE =
  'A Barion most nem érhető el, ezért a visszatérítés eredménye nem kérdezhető le. Próbáld újra néhány perc múlva.'
const RECONCILE_CHANGED = 'A visszatérítés állapota közben megváltozott. Frissítsd az oldalt.'
const RECONCILE_IN_PROGRESS =
  'A Barion még feldolgozza a visszatérítést. Nézz vissza néhány perc múlva, és folytasd újra a feldolgozást.'
const RECONCILE_UNPROVABLE =
  'A Barion adataiból nem dönthető el egyértelműen, mi történt ezzel a visszatérítéssel (például a Barion felületén is indult visszatérítés). Ne indíts új pénzvisszatérítést, ez kézi egyeztetést igényel az üzemeltetővel.'

/**
 * Soha ki nem fizetett rendelés automatikus visszatérítése (paid-reject): a
 * vásárló fizetése a Barionban sikerült, de a rendelést a rendszer nem fogadta
 * el. A szöveg a közös újrapróbálási szabályból (automatic-retry.ts) és a
 * tartós leállás-jelzésből (automatic-block.ts) mondja meg, mi lesz a
 * következő lépés, és csak azt ígéri, amit a rendszer valóban megtesz. A
 * tulajdonosnak ott van teendője, ahol az ok a Barion-fiókjában van (K6:
 * TooLowBalanceToMakeRefund), vagy ahol a rendszer leállt. A panel ezt az
 * „Ellenőrzés szükséges” doboz alatt mutatja, ezért a szöveg nem mondhatja,
 * hogy nincs teendő (NN/g 10 heuristics, #4 Consistency and standards:
 * https://www.nngroup.com/articles/ten-usability-heuristics/; GOV.UK Error
 * message, „say what has happened and how to fix it”:
 * https://design-system.service.gov.uk/components/error-message/).
 */
const AUTOMATIC_CONTEXT =
  'A vásárló fizetése a Barionban sikerült, de a rendelést a rendszer nem fogadta el (például dupla vásárlás miatt), ezért az összeget vissza kell téríteni a vásárlónak.'
const NO_BARION_UI_REFUND = 'A Barion felületén ne indíts visszatérítést.'
const AUTOMATIC_STOPPED_TAIL = `A rendszer nem mozgatott pénzt. Jelezd az üzemeltetőnek a rendelésszámmal együtt. ${NO_BARION_UI_REFUND}`

const AUTOMATIC_BLOCK_REASONS: Record<AutomaticRefundBlockDetail, string> = {
  'foreign-refund-detected':
    'Az automatikus visszatérítés leállt, mert a Barionban ehhez a fizetéshez már van visszatérítési tranzakció (például a Barion felületén indítottak visszatérítést).',
  'source-transaction-unproven':
    'Az automatikus visszatérítés leállt, mert a fizetés tranzakciói a Barionban nem egyeznek a rendeléssel (például hiányzik a rendelés fizetési tranzakciója, vagy más az összege).',
  'payment-state-unproven':
    'Az automatikus visszatérítés leállt, mert a fizetés adatai a Barionban nem egyeznek a rendeléssel.',
}

const BUDAPEST_DATE_TIME = new Intl.DateTimeFormat('hu-HU', {
  timeZone: 'Europe/Budapest',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** A leállás oka a közös döntésből (automatic-retry.ts); a kísérletet indító futás riasztása ugyanebből dönt. */
function automaticStopReason(
  detail: Extract<AutomaticRetryDecision, { kind: 'stop' }>['detail'],
  failures: readonly RefundIntent[],
): string {
  if (detail === 'automatic-refund-window-closed')
    return 'Az automatikus visszatérítés leállt, mert a rendszer ezt a rendelést már nem ellenőrzi újra magától, így új kísérletet sem indít.'
  if (detail === 'automatic-refund-attempts-exhausted')
    return 'Az automatikus visszatérítés több sikertelen kísérlet után leállt, mert a Barion adataiból nem derült ki, miért nem sikerül.'
  return nonFixableRejectionCode(failures) === 'AmountToRefundIsGreaterThanTransactionAmount'
    ? 'Az automatikus visszatérítés leállt, mert a Barion szerint ebből a fizetésből ennyi már nem téríthető vissza (például a Barion felületén már visszatérítették).'
    : 'Az automatikus visszatérítés leállt, mert a Barion olyan okkal utasította el, amelyet a rendszer magától nem tud megoldani.'
}

/** A soha ki nem fizetett rendelés automatikus visszatérítésének állapota és szövege. */
function automaticRefundStatus(
  order: Order,
  failures: readonly RefundIntent[],
  now: Date,
): { message: string; retrying: boolean } {
  const deadline = automaticRetryDeadline(order)
  const decision = decideAutomaticRetry(failures, now, { retryDeadlineMs: deadline })
  if (decision.kind === 'stop')
    return {
      message: `${AUTOMATIC_CONTEXT} ${automaticStopReason(decision.detail, failures)} ${AUTOMATIC_STOPPED_TAIL}`,
      retrying: false,
    }
  const next = decision.kind === 'wait' ? Date.parse(decision.notBefore) : now.getTime()
  const when = decision.kind === 'wait' ? `${BUDAPEST_DATE_TIME.format(next)} után` : 'hamarosan'
  const until =
    deadline === null
      ? ''
      : ` Ennél a rendelésnél ${BUDAPEST_DATE_TIME.format(deadline)} után már nem próbálkozik; ha addig nem sikerül, jelezd az üzemeltetőnek a rendelésszámmal együtt.`
  // Javítható ok: a rendszer addig próbálkozik, amíg sikerül (vagy a fenti határig).
  // A várakozás 1, 2, 4, 8, 16, majd 24 óra: „legalább naponta”, nem ritkábban.
  const retry =
    deadline === null
      ? `A rendszer ${when} újra megpróbálja, és legalább naponta próbálkozik, amíg sikerül.`
      : `A rendszer ${when} újra megpróbálja, és legalább naponta próbálkozik.${until}`
  const last = latestAutomaticFailure(failures)
  const codes = rejectionCodesFromReference(last?.reconciliationReference)
  if (codes.includes('TooLowBalanceToMakeRefund'))
    return {
      message: `${AUTOMATIC_CONTEXT} A Barion elutasította, mert a Barion-tárcádban nincs elég egyenleg, pénzmozgás nem történt. ${retry} A visszatérítéshez legalább ${formatPriceHuf(last?.requestedAmountHuf ?? 0)} kell a tárcában, ezt egy feltöltés vagy a következő eladások biztosítják. ${NO_BARION_UI_REFUND}`,
      retrying: true,
    }
  if (codes.includes('AuthenticationFailed'))
    return {
      message: `${AUTOMATIC_CONTEXT} A Barion elutasította, mert nem fogadta el a bolt azonosító kulcsát, pénzmozgás nem történt. Jelezd az üzemeltetőnek, hogy ellenőrizze a Barion-beállításokat. ${retry} ${NO_BARION_UI_REFUND}`,
      retrying: true,
    }
  if (codes.length > 0)
    return {
      message: `${AUTOMATIC_CONTEXT} A Barion elutasította, mert a fiókod most nem jogosult visszatérítésre, pénzmozgás nem történt. Vedd fel a kapcsolatot a Barion ügyfélszolgálatával. ${retry} ${NO_BARION_UI_REFUND}`,
      retrying: true,
    }
  // Ismeretlen ok: a kísérletek száma korlátos (automatic-retry.ts), ezt a szöveg is kimondja.
  return {
    message: `${AUTOMATIC_CONTEXT} A legutóbbi kísérlet pénzmozgás nélkül lezárult, az oka nem ismert. A rendszer ${when} újra megpróbálja. Ha egymás után ${MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS} kísérlet végződik így, a rendszer leáll, és ezen a panelen jelzi, mi a teendő.${until} ${NO_BARION_UI_REFUND}`,
    retrying: true,
  }
}

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
  if (intent.state === 'prepared')
    return {
      state: 'recoverable',
      // Az automatikus kísérlet soha ki nem fizetett rendelésen áll: ott a
      // tulajdonos nem indít visszatérítést, a következőt a rendszer indítja.
      message: isAutomaticRefundIntent(intent) ? STUCK_PREPARED_AUTOMATIC : STUCK_PREPARED,
    }
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
  // A kézi eset nyugtája a kurzust és az okot is hordozza (access-store.ts),
  // hogy a tulajdonosi üzenet megnevezhesse. Az első nyugta marad: egy
  // későbbi, más okú elakadás nem írja felül (a nyugta megváltoztathatatlan).
  const manual = async (result?: RefundAccessCleanupResult) => {
    if (!(await readReceipt(payload, intent, RECEIPTS.cleanupManual))) {
      const detail = result?.status === 'manual_review' ? result : undefined
      await writeReceipt(payload, intent, RECEIPTS.cleanupManual, {
        version: 1,
        manual: true,
        ...(detail?.detail ? { detail: detail.detail } : {}),
        ...(detail?.productId ? { productId: detail.productId } : {}),
      })
    }
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
    const result = await applyRefundAccessCleanup(payload, {
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
    return manual(result)
  })
}

/** A rendelés kurzusainak neve azonosítónként; a hiányzót a rendelés pillanatképe pótolja. */
async function orderCourseTitles(payload: Payload, order: Order): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  for (const item of order.items ?? []) {
    const id = relationId(item.product)
    if (id !== null) titles.set(id, item.titleSnapshot?.trim() || `Kurzus #${id}`)
  }
  if (titles.size === 0) return titles
  try {
    const found = await payload.find({
      collection: 'products',
      where: { id: { in: [...titles.keys()] } },
      depth: 0,
      limit: titles.size,
      pagination: false,
      overrideAccess: true,
      select: { displayTitle: true, sku: true },
    })
    for (const product of found.docs) titles.set(product.id, courseTitle(product))
  } catch {
    // A pillanatkép neve marad: az üzenet ettől még megnevezi a kurzust.
  }
  return titles
}

function quotedCourse(title: string): string {
  return `${hatarozottNevelo(title)} „${title}” kurzus`
}

/**
 * A hozzáférés kézi rendezését kérő mondat: melyik kurzus, miért, mi a
 * következő lépés (a-refund-10). A vásárló hozzáférését a rendszer nem vette
 * el (a tranzakció visszagördült), és a tulajdonos az adminban sem tudja
 * levenni (a purchases mező írása zárt), ezért a lépés az üzemeltető felé megy.
 */
async function cleanupBlockedSentence(
  payload: Payload,
  order: Order,
  receipt: Record<string, unknown>,
): Promise<string> {
  const titles = await orderCourseTitles(payload, order)
  const productId = typeof receipt.productId === 'number' ? receipt.productId : null
  const named =
    productId !== null && titles.has(productId)
      ? quotedCourse(titles.get(productId)!)
      : titles.size > 0
        ? [...titles.values()].map(quotedCourse).join(' és ')
        : 'a kurzus'
  const subject = `${named.charAt(0).toUpperCase()}${named.slice(1)} hozzáférését a rendszer`
  const why =
    receipt.detail === 'grant-provenance'
      ? `${subject} nem vonta vissza, mert a vásárló hozzáférése nem ehhez a rendeléshez van kötve (például korábbi, kézzel adott vagy az átállásból hozott hozzáférés), így a hozzáférés egyelőre megmaradt.`
      : receipt.detail === 'access-changed'
        ? `${subject} nem vonta vissza, mert a vásárló hozzáférései a visszatérítés indítása óta megváltozhattak (például új vásárlás vagy kézzel adott hozzáférés miatt), így a hozzáférés egyelőre megmaradt.`
        : `${subject} nem tudta automatikusan visszavonni, így a hozzáférés egyelőre megmaradt.`
  return `${why} Következő lépés: jelezd az üzemeltetőnek a rendelésszámmal és a kurzus nevével együtt, ő rendezi a hozzáférést.`
}

/**
 * A szamlazz refund-őr (refund-guard.ts) elutasító szövege: NEM a Számlázz.hu
 * válasza, hanem a saját őrünk döntése (a negatív lekérdezés után új
 * beküldést nem enged). A helyesbítő-kiállítás a rendelés utolsó hibájaként
 * menti, a panel pedig erről ismeri fel.
 */
function isRefundGuardRefusal(text: string | null | undefined): boolean {
  return !!text?.trim().startsWith(REFUND_DOCUMENT_GUARD_REFUSAL)
}

/**
 * A bizonylat legutóbbi hibaüzenete a panel mondatába. A címke semleges: a
 * mentett szöveg lehet a Számlázz.hu válasza, a kliens leírása egy
 * időtúllépésről vagy a rendszer saját indoklása is. A helyi (adatbázis,
 * kapcsolat) hiba és a saját őr elutasítása kimarad: technikai szöveg, a
 * tulajdonosnak nem ad teendőt, az üzemeltető a rendelés mezőjében és a
 * naplóban látja (GOV.UK Design System, Error message: „Do not use: technical
 * jargon like 'form post error'…”, https://design-system.service.gov.uk/components/error-message/;
 * NN/g, Error-Message Guidelines: „Avoid technical jargon and use language
 * familiar to your users instead.”, https://www.nngroup.com/articles/error-message-guidelines/).
 */
function szamlazzErrorDetail(text: string | null | undefined): string {
  const lastError = text?.trim()
  if (
    !lastError ||
    isRefundGuardRefusal(lastError) ||
    lastError.startsWith(CORRECTIVE_LOCAL_ERROR_PREFIX.trim())
  )
    return ''
  return ` A legutóbbi hibaüzenet: ${/[.!?…]$/.test(lastError) ? lastError : `${lastError}.`}`
}

/** A helyesbítő rendelésszáma a Számlázz.hu-ban (erre lehet keresni a fiókban). */
function correctiveSearchKey(order: Order, intent: RefundIntent): string {
  return legacyCorrectiveKulsoAzon(order.orderNumber ?? '', intent.refundSequence)
}

/**
 * Helyesbítőnél az igénylés rögzült, de szám nincs, a keresés-átvétel job
 * nincs sorba állítva, és az állapot sem végleges (nem 'failed', tehát a
 * refund-őr sem utasította el). Jellemzően a folyamat a beküldés után leállt
 * (újraindítás, összeomlás), és a státusz 'pending' maradt. Ilyenkor a
 * folytatás sorba állítja a jobot (invoice()), ezért a panel a folytatás
 * gombját mutatja (storageRecoveryStatus). A stornó soha (F3).
 */
async function correctiveRetryQueueable(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
  entry: OrderRefundEntry,
  claimed: boolean,
): Promise<boolean> {
  if (!claimed || (entry.type === 'full' && intent.refundSequence === 1)) return false
  if (invoiceRecorded(order, intent, entry) || order.correctiveInvoiceStatus === 'failed')
    return false
  return !(await readReceipt(payload, intent, REFUND_INVOICE_RETRY_QUEUED_ACTION))
}

/** A helyesbítő keresés-átvétel jobjának taskja (jobs/tasks/corrective-invoice-issue.ts). */
const CORRECTIVE_JOB_TASK = 'corrective-invoice-issue'

/**
 * Ennyi idő után számít elhaltnak a futóként (`processing`) jelölt
 * helyesbítő-job. Egy futás a Számlázz.hu-hívásokra a zárban legfeljebb 45
 * másodpercet használ (LOCKED_SECTION_HTTP_BUDGET_MS, szamlazz/lock-budget.ts),
 * a zárra várás és a lezárás írásai ennél rövidebbek. A futás közben elhalt
 * folyamat (deploy, összeomlás) sorát a Payload 3.88 nem engedi el: a sor
 * `processing` marad, de a job már nem fut tovább.
 */
export const CORRECTIVE_JOB_STALE_AFTER_MS = 15 * 60 * 1000

/**
 * Él-e még a helyesbítő sorba állított jobja ehhez a visszatérítéshez: vár a
 * következő futására, vagy éppen fut. A Payload a hibára futott jobot a
 * `retries` erejéig futtatja újra, utána `hasError`-ral zárja, a lefutott job
 * pedig `completedAt`-et kap. A jobot semmi nem állítja újra sorba, ezért a
 * panel csak élő job mellett ígérhet háttérbeli újrapróbálást (hibavadász C,
 * PR #307).
 */
async function correctiveJobAlive(
  payload: Payload,
  orderId: number,
  refundSeq: number,
  nowMs: number,
): Promise<boolean> {
  const jobs = await payload.find({
    collection: 'payload-jobs',
    where: {
      and: [{ taskSlug: { equals: CORRECTIVE_JOB_TASK } }, { completedAt: { exists: false } }],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return jobs.docs.some((job) => {
    const input = job.input
    if (job.taskSlug !== CORRECTIVE_JOB_TASK || job.completedAt || job.hasError === true)
      return false
    if (!isRecord(input) || input.orderId !== orderId || input.refundSeq !== refundSeq) return false
    if (!job.processing) return true
    const since = Date.parse(job.updatedAt)
    return Number.isFinite(since) && nowMs - since < CORRECTIVE_JOB_STALE_AFTER_MS
  })
}

/** A bizonylat elakadásának mondata: mi történt, újrapróbálja-e a rendszer, mi a teendő (a-refund-4). */
async function invoiceBlockedSentence(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
  entry: OrderRefundEntry,
  now: Date,
): Promise<string | null> {
  if (invoiceRecorded(order, intent, entry)) return null
  const invoiceNumber = order.invoiceNumber?.trim()
  if (!invoiceNumber)
    return 'A rendeléshez nem tartozik kiállított számla, ezért stornó vagy helyesbítő számla nem készíthető. Jelezd az üzemeltetőnek a rendelésszámmal együtt.'
  const storno = entry.type === 'full' && intent.refundSequence === 1
  const started = await readReceipt(payload, intent, RECEIPTS.invoiceStarted)
  if (storno) {
    const submitted = !!started || (order.stornoAttempts ?? 0) > 0
    if (!submitted && order.stornoStatus !== 'failed') return null
    const detail = szamlazzErrorDetail(order.stornoLastError)
    // Stornót a rendszer beküldés után nem küld újra (F3, storno.ts): egy
    // elveszett válasz mögött már létező stornó lehet, a második dupla
    // érvénytelenítés volna. A kézi rögzítés külön, jóváhagyott lépés (H2).
    return submitted
      ? `A stornószámla nem készült el biztosan: a kérés elment a Számlázz.hu-nak, de a rendelésen nincs rögzített stornó.${detail} Nézd meg a Számlázz.hu-fiókodban, készült-e stornó a(z) ${invoiceNumber} számú számlához, és jelezd az üzemeltetőnek a rendelésszámmal együtt. A rendszer a stornót nem küldi be újra.`
      : `A stornószámla nem készült el, a Számlázz.hu-nak nem ment kérés.${detail} Jelezd az üzemeltetőnek a rendelésszámmal együtt.`
  }
  // A sorba állított job a beküldés előtt a Számlázz.hu-ban keresi a
  // helyesbítőt (corrective.ts), és ha megvan vagy elkészül, rögzíti a számát,
  // majd a visszatérítés feldolgozását is lezárja
  // (jobs/tasks/corrective-invoice-issue.ts).
  const retryQueued = await readReceipt(payload, intent, REFUND_INVOICE_RETRY_QUEUED_ACTION)
  const attempted =
    started ||
    retryQueued ||
    (order.correctiveInvoiceAttemptsSeq === intent.refundSequence &&
      (order.correctiveInvoiceAttempts ?? 0) > 0) ||
    order.correctiveInvoiceStatus === 'failed'
  if (!attempted) return null
  const detail = szamlazzErrorDetail(order.correctiveInvoiceLastError)
  const search = `Nézd meg a Számlázz.hu-fiókodban, készült-e helyesbítő a(z) ${correctiveSearchKey(order, intent)} rendelésszámmal`
  const guardRefused =
    order.correctiveInvoiceStatus === 'failed' &&
    isRefundGuardRefusal(order.correctiveInvoiceLastError)
  // A szövegek azt mondják, mi történt, mit tesz még a rendszer, és mi a
  // tulajdonos teendője (GOV.UK Design System, Error message: „Describe what
  // has happened and tell them how to fix it.”,
  // https://design-system.service.gov.uk/components/error-message/; NN/g,
  // Error-Message Guidelines: „offer some potential remedies”,
  // https://www.nngroup.com/articles/error-message-guidelines/). Amíg
  // automatikus beküldés még lehetséges, a kézi kiállítás tilos (dupla
  // NAV-bizonylat lenne); kézi kiállítást csak akkor kér, amikor a refund-őr
  // már semmilyen beküldést nem enged (CORRECTIVE_RETRY_ESCALATION_MS).
  //
  // Negatív ág: a job lefutott, a lekérdezés nem talált bizonylatot, és a
  // refund-őr az új beküldést megtagadta (az utolsó hiba az őr szövege). A
  // háttérbeli ellenőrzés tehát véget ért; ígérni már nem szabad.
  if (retryQueued && guardRefused)
    return 'A helyesbítő számla nem készült el. A rendszer a háttérben megnézte a Számlázz.hu-ban, de ehhez a visszatérítéshez nem talált helyesbítő számlát, és nem küldi be újra. Jelezd az üzemeltetőnek a rendelésszámmal együtt.'
  // Háttérbeli újrapróbálást csak élő job mellett ígérünk (hibavadász C, PR
  // #307). A job legfeljebb négyszer fut, és a végleges hiba, a kimerülés vagy
  // a futás közbeni összeomlás után semmi nem állítja újra sorba.
  const jobAlive =
    retryQueued !== null &&
    (await correctiveJobAlive(payload, order.id, intent.refundSequence, now.getTime()))
  // A határidő után igénylés mellett beküldés már nem indulhat: a kérés csak
  // igénylés után mehetett ki, az ismételt beküldést pedig az őr a határidő
  // után nem engedi. Egy még élő job legfeljebb átveheti a bizonylatot. Az
  // egyetlen kivétel az éppen futó beküldés ('pending' élő job mellett): addig
  // nem kér kézi kiállítást. Elhalt job mellett a 'pending' már nem változik.
  if (
    retryQueued &&
    started &&
    isCorrectiveRetryExpired(retryQueued, now.getTime()) &&
    !(order.correctiveInvoiceStatus === 'pending' && jobAlive)
  )
    return `A helyesbítő számla nem készült el biztosan, és a háttérbeli ellenőrzés sem járt sikerrel.${detail} ${search}. Ha készült, jelezd az üzemeltetőnek a számával együtt. Ha nem, állítsd ki kézzel (05-ös útmutató, 4. pont), és jelezd az üzemeltetőnek a rendelésszámmal együtt.`
  if (jobAlive)
    return `A helyesbítő számla kiállítása nem fejeződött be.${detail} A rendszer a háttérben újra megpróbálja: előbb megnézi a Számlázz.hu-ban, elkészült-e, és ha a helyesbítő megvan vagy elkészül, a visszatérítés feldolgozását is magától befejezi. Ne állíts ki kézzel helyesbítőt, amíg ez az üzenet látszik. Ha egy nap múlva is ezt látod, jelezd az üzemeltetőnek a rendelésszámmal együtt.`
  // A job véget ért, igénylés nélkül: a Számlázz.hu-nak nem ment kérés, és a
  // folytatás gombja az első beküldést próbálja újra (invoice()). Kézi
  // kiállítás mellett ez második helyesbítőt adna, ezért azt nem kérjük.
  if (retryQueued && !started && order.correctiveInvoiceStatus !== 'failed')
    return `A helyesbítő számla nem készült el, és a háttérbeli újrapróbálás véget ért. A Számlázz.hu-nak nem ment kérés.${detail} Próbáld újra a ${RECOVER} gombbal. Ha így sem sikerül, jelezd az üzemeltetőnek a rendelésszámmal együtt. Kézzel ne állíts ki helyesbítőt, mert a gomb megnyomásakor a rendszer is kiállítja, és akkor kettő lenne belőle.`
  // Az igénylés rögzült, a kérés elmehetett, a kimenet ismeretlen: a végleges
  // „nem készült el” csak igénylés nélkül igaz (a stornó ága mintájára).
  if (started && !guardRefused)
    return `A helyesbítő számla nem készült el biztosan: a kérés elmehetett a Számlázz.hu-nak, de a rendelésen nincs rögzített helyesbítő.${detail} ${search}, és jelezd az üzemeltetőnek a rendelésszámmal együtt. A rendszer a helyesbítőt nem küldi be újra.`
  return `A helyesbítő számla nem készült el.${detail} Jelezd az üzemeltetőnek a rendelésszámmal együtt; a rendszer nem küldi be újra.`
}

/**
 * Az elakadt helyi feldolgozás tulajdonosi üzenete: a hozzáférés és a
 * bizonylat konkrét állapota, a következő lépéssel (GOV.UK Error message:
 * „say what has happened and how to fix it”). Ha egyik sem ismerhető fel, a
 * közös, általános szöveg marad.
 */
async function localBlockedMessage(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
  entry: OrderRefundEntry,
  now: Date,
): Promise<string> {
  try {
    const parts: string[] = []
    const manual = await readReceipt(payload, intent, RECEIPTS.cleanupManual)
    if (manual) parts.push(await cleanupBlockedSentence(payload, order, manual))
    const invoice = await invoiceBlockedSentence(payload, order, intent, entry, now)
    if (invoice) parts.push(invoice)
    if (parts.length === 0) return LOCAL_BLOCKED
    return `${LOCAL_BLOCKED_LEAD} ${parts.join(' ')} ${NO_NEW_REFUND}`
  } catch {
    return LOCAL_BLOCKED
  }
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

/**
 * A helyesbítő keresés-átvétel jobjának sorba állítása, kísérletenként
 * egyszer: a jelzés (retry-queued nyugta) egyszer írható, ezért előbb
 * olvasunk, és csak hiányában írunk. A `queuedAt`-ből tudja a panel és a
 * refund-őr, mikor járt le a job ideje (CORRECTIVE_RETRY_ESCALATION_MS).
 * Soha nem dob: a hívó az eredeti hibát adja tovább, és egy olvasási hiba sem
 * takarhatja el.
 */
async function queueCorrectiveRetry(
  options: RecoveryOptions,
  order: Order,
  intent: RefundIntent,
): Promise<void> {
  const { payload } = options
  try {
    if (await readReceipt(payload, intent, REFUND_INVOICE_RETRY_QUEUED_ACTION)) return
    const queued = await queueCorrectiveInvoiceJob(
      payload,
      order.id,
      intent.refundSequence,
      options.logger,
    )
    if (queued)
      await writeReceipt(payload, intent, REFUND_INVOICE_RETRY_QUEUED_ACTION, {
        version: 1,
        kind: 'corrective',
        sequence: intent.refundSequence,
        queuedAt: (options.now ?? new Date()).toISOString(),
      })
  } catch (error) {
    ;(options.logger ?? logger).warn(
      'refund recovery: a helyesbito ujraprobalo jobjanak jelzese nem rogzitheto',
      {
        orderId: order.id,
        refundSequence: intent.refundSequence,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
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
    if (await readReceipt(payload, intent, RECEIPTS.invoiceStarted)) {
      // Helyesbítő: az igénylés rögzült, de szám nincs, és job sincs sorban
      // (a folyamat a beküldés után leállt, vagy a sorba állítás elmaradt). A
      // keresés-átvétel job átveszi a bizonylatot, ha elkészült; új beküldést
      // a refund-őr csak igazoltan hatás nélküli első kísérlet után enged.
      // Stornónál soha (F3).
      if (await correctiveRetryQueueable(payload, order, intent, entry, true))
        await queueCorrectiveRetry(options, order, intent)
      return false
    }
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
    // Existing helpers own their invoice locks and provider guards. A tulajdonos
    // indoka (intent.reason) a műveletnaplóé és a rendelésé, a bizonylatra nem
    // kerül: a stornó és a helyesbítő megjegyzése a vevőnek is látszik.
    if (storno) {
      // Stornó: automatikus újrapróbálás TILOS (F3, storno.ts): egy beküldés
      // után az állapot bizonytalan, a vak ismétlés dupla stornót okozhat.
      await (options.issueStorno ?? issueStornoForOrder)(order, {
        payload,
        logger: options.logger,
      })
    } else {
      try {
        await (options.issueCorrective ?? issueCorrectiveInvoiceForOrder)(order, {
          payload,
          logger: options.logger,
          refundSeq: intent.refundSequence,
          amountHuf: intent.requestedAmountHuf,
        })
      } catch (error) {
        // Helyesbítő: az újrapróbálható hiba (időtúllépés, hálózat, 5xx,
        // szlahu_down), és az igénylés utáni BÁRMILYEN hiba (a kérés
        // elmehetett, például csak a szám mentése bukott el) a
        // corrective-invoice-issue jobhoz megy (a-refund-4, W1B-4). A job
        // minden beküldés ELŐTT szamlaKulsoAzon-lekérdezéssel keres, és
        // találatnál átveszi a bizonylatot. Beküldeni csak két esetben küld:
        // ha a hiba az igénylés ELŐTT történt (ilyenkor a Számlázz.hu-nak
        // semmi nem ment ki, és a job beküldése az első), vagy ha az igénylés
        // utáni első beküldés igazoltan hatás nélkül maradt (szlahu_down,
        // kapcsolódás előtti hálózati hiba): ez az egyetlen ismételt beküldés
        // (refund-guard.ts). Minden más igénylés utáni esetben csak átvesz.
        // Siker után a visszatérítés feldolgozását is lezárja. A jelzés a
        // panelnek szól: a rendszer a háttérben még dolgozik a bizonylaton.
        let claimed = false
        try {
          claimed = !!(await readReceipt(payload, intent, RECEIPTS.invoiceStarted))
        } catch {
          // Az olvasási hiba nem takarhatja el az eredeti hibát.
        }
        if (isRetryableCorrectiveError(error) || claimed)
          await queueCorrectiveRetry(options, order, intent)
        throw error
      }
    }
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
  // A negyedórás nullhatás-szabály a lekérdezés INDÍTÁSÁHOZ mér: a Barion
  // pillanatképe legalább ilyen friss, a zárra várás ideje nem számít bele.
  const stateObservedAt = options.now ?? new Date()
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
        stateObservedAt,
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
  // A lezárást végző ág itt jelöli ki a vevői értesítőt; a küldés a finally-ben,
  // a koordinátor-zár elengedése UTÁN megy (lásd ott).
  const deferred: { notice: SendRefundNoticeInput | null } = { notice: null }
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
          const status = await storageRecoveryStatus({ payload, orderNumber, now: options.now })
          // Az automatikus kísérlet lezárása után a rendelés a következő
          // automatikus kísérletre vár: ez rendezett állapot, nem kézi eset.
          return status.state === 'clear' || (settled.automatic && status.automaticRetry)
            ? {
                orderNumber,
                recoveryStatus: 'completed' as const,
                message: settled.automatic
                  ? settled.neverLaunched
                    ? AUTOMATIC_NEVER_LAUNCHED_CLOSED
                    : AUTOMATIC_ATTEMPT_CLOSED
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
              const commit = await commitAutomaticRefund(payload, order, intent)
              return { automatic: true as const, commit }
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
          const status = await getRefundRecoveryStatus({ payload, orderNumber, now: options.now })
          return status.state === 'clear'
            ? { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
            : { orderNumber, recoveryStatus: 'manual_review' as const, message: status.message }
        }
        if (financial.automatic) {
          // A vevői értesítő csak a lezárást végző hívótól, minden zár után (finally).
          if (financial.commit)
            deferred.notice = {
              payload,
              ...financial.commit,
              kind: 'order-not-accepted',
              document: 'none',
              logger: log,
            }
          return { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
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
        if (!cleaned || !audited || !invoiced) {
          const current = (await findRecoveryOrder(payload, orderNumber)) ?? order
          return {
            orderNumber,
            recoveryStatus: 'manual_review' as const,
            message: await localBlockedMessage(
              payload,
              current,
              intent,
              entry,
              options.now ?? new Date(),
            ),
          }
        }
        const committed = await withAdvisoryLock(
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
            return {
              order: verified,
              intent: await transitionRefundIntent(payload, fresh, 'committed'),
            }
          },
          log,
        )
        // A vevői értesítő a lezárás UTÁN, minden zár elengedése után megy ki
        // (finally); a committed CAS miatt pontosan egyszer (refund-notice.ts).
        deferred.notice = {
          payload,
          order: committed.order,
          intent: committed.intent,
          entry,
          kind: entry.type,
          document: entry.type === 'full' && intent.refundSequence === 1 ? 'storno' : 'corrective',
          logger: log,
        }
        return { orderNumber, recoveryStatus: 'completed' as const, message: COMPLETE }
      },
      log,
    )
  } catch {
    // Átmeneti hiba (tároló, kapcsolat, zár) és valódi ütközés is ide fut. A
    // szöveget a tartós állapot dönti el: valódi eltérésnél ugyanazt mondja,
    // amit a panel állapota; folytatható vagy rendezett állapotnál nem állít
    // eltérést, csak újrapróbálást kér (a getRefundRecoveryStatus nem dob).
    log.warn('refund recovery: tartos allapot ellenorzese szukseges', { orderNumber })
    const status = await getRefundRecoveryStatus({ payload, orderNumber, now: options.now })
    return {
      orderNumber,
      recoveryStatus: 'manual_review' as const,
      message: status.state === 'manual_review' ? status.message : INTERRUPTED,
    }
  } finally {
    // A levél HTTP-hívás, zár alatt tilos (advisory-lock.ts): a koordinátor
    // tranzakciója a szakasz alatt tétlen, és 60 s után a Postgres bontja
    // (idle_in_transaction_session_timeout, payload.config.ts), ezért a levél
    // ideje nem számíthat bele. Akkor is kimegy, ha a kész szakasz után maga a
    // zár hibázott (a tétlen tranzakció COMMIT-ja bontott kapcsolaton): a
    // kísérlet ekkor már committed, és más hívó nem küldi el. Sosem dob.
    if (deferred.notice) await sendRefundNotice(deferred.notice)
  }
}

interface StorageRecoveryStatus {
  orderNumber: string
  state: 'clear' | 'manual_review' | 'recoverable'
  message: string
  /** Belső jelzés: soha ki nem fizetett rendelés, a következő automatikus kísérletre vár. */
  automaticRetry?: true
}

async function storageRecoveryStatus({
  payload,
  orderNumber,
  now = new Date(),
}: {
  payload: Payload
  orderNumber: string
  now?: Date
}): Promise<StorageRecoveryStatus> {
  try {
    const order = await findRecoveryOrder(payload, orderNumber)
    if (!order) return { orderNumber, state: 'manual_review', message: MANUAL }
    const intent = await loadActiveRefundIntent(payload, order.id)
    if (intent) {
      // Elakadt kísérlet: a „Feldolgozás folytatása” bizonyítékból zárja le (reconcileStuckIntent).
      if (intent.state !== 'provider_succeeded')
        return { orderNumber, ...stuckIntentStatus(intent, now.getTime()) }
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
      // A helyesbítő igénylése után szám nélkül (a folyamat a beküldés után
      // leállt) a folytatás sorba állítja a keresés-átvétel jobot (invoice()).
      const canInvoice =
        !invoiceDone &&
        (!!invoiceRecorded(order, intent, entry) ||
          (!invoiceStarted && !!order.invoiceNumber) ||
          (await correctiveRetryQueueable(payload, order, intent, entry, !!invoiceStarted)))
      const ready = cleanupDone?.completed === true && !!auditDone && !!invoiceDone
      return canCleanup || !auditDone || canInvoice || ready
        ? { orderNumber, state: 'recoverable', message: CONTINUE }
        : {
            orderNumber,
            state: 'manual_review',
            message: await localBlockedMessage(payload, order, intent, entry, now),
          }
    }
    if (isNeverPaidRefundCandidate(order)) {
      // A soha ki nem fizetett rendelésen csak automatikus visszatérítés lehet.
      // Lezárt, hatástalan kísérletek után a panel nem mondhatja, hogy nincs
      // mit visszatéríteni: a vásárló pénze még a boltnál van.
      const history = await loadRefundIntentsForOrder(payload, order.id)
      if (!history.every(isResolvedAutomaticFailure))
        return { orderNumber, state: 'manual_review', message: MANUAL }
      // Kísérlet előtti, tartós leállás (idegen visszatérítés, megváltozott
      // fizetés): az előzmény ezt nem mutatja, a jelzés igen.
      const block = await readLatestAutomaticRefundBlock(payload, order.id)
      if (isCurrentAutomaticRefundBlock(block, history))
        return {
          orderNumber,
          state: 'manual_review',
          message: `${AUTOMATIC_CONTEXT} ${AUTOMATIC_BLOCK_REASONS[block.detail]} ${AUTOMATIC_STOPPED_TAIL}`,
        }
      if (history.length === 0) return { orderNumber, state: 'clear', message: COMPLETE }
      const automatic = automaticRefundStatus(order, history, now)
      return automatic.retrying
        ? { orderNumber, state: 'manual_review', message: automatic.message, automaticRetry: true }
        : { orderNumber, state: 'manual_review', message: automatic.message }
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
  /** Injektálható idő (teszteléshez); alapból a pillanatnyi idő. */
  now?: Date
}): Promise<{
  orderNumber: string
  state: 'clear' | 'manual_review' | 'recoverable'
  message: string
  operationState?: 'unseen' | 'pending' | 'completed' | 'no_effect'
}> {
  const stored = await storageRecoveryStatus(options)
  // A belső jelzés nem része a válasznak.
  const status = { orderNumber: stored.orderNumber, state: stored.state, message: stored.message }
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

/**
 * A helyesbítő megvan (a corrective-invoice-issue job kiállította vagy
 * átvette): a visszatérítés feldolgozását a rendszer maga fejezi be (W1B-6,
 * tulajdonosi döntés: nem várunk admin-műveletre). Ugyanaz a
 * recoverRefundOrder fut, amit a „Feldolgozás folytatása” gomb indít, a
 * kísérletet indító felhasználó nevében. Szerepkör-ellenőrzés nincs benne (az
 * az útvonalé), a saját zárait veszi, pénzt nem mozgat (provider_succeeded
 * kísérletnél Barion-hívás sincs), és a committed átmenet egyetlen feltételes
 * írás, így a vevői értesítő akkor is egyszer megy ki, ha a tulajdonos
 * ugyanekkor nyomja meg a gombot.
 *
 * Soha nem dob: a jobban egy dobás a helyesbítő újrafuttatását okozná, holott
 * a bizonylat már megvan. Ha itt valami elakad, a panel a folytatás gombját
 * mutatja.
 */
export async function finishRefundAfterCorrective(
  payload: Payload,
  order: Order,
  refundSequence: number,
  log: Logger = logger,
): Promise<void> {
  const context = { orderId: order.id, refundSequence }
  try {
    if (!order.orderNumber) return
    const intents = (await loadRefundIntentsForOrder(payload, order.id)).filter(
      (intent) => intent.refundSequence === refundSequence && intent.state === 'provider_succeeded',
    )
    if (intents.length !== 1) return
    const actorId = relationId(intents[0].actor)
    const actor =
      actorId === null
        ? null
        : ((await payload.findByID({
            collection: 'users',
            id: actorId,
            depth: 0,
            overrideAccess: true,
          })) as User | null)
    if (!actor) {
      log.warn(
        'refund recovery: a helyesbito utan a feldolgozas nem folytathato automatikusan (az indito felhasznalo nem olvashato)',
        context,
      )
      return
    }
    const result = await recoverRefundOrder({
      payload,
      orderNumber: order.orderNumber,
      actor,
      logger: log,
    })
    log.info('refund recovery: a helyesbito utan a feldolgozas folytatva', {
      ...context,
      recoveryStatus: result.recoveryStatus,
    })
  } catch (error) {
    log.warn('refund recovery: a helyesbito utani automatikus folytatas nem sikerult', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
