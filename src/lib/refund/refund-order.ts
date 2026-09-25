import type { Payload } from 'payload'

import type { Order, RefundIntent, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import {
  BarionApiError,
  fetchPaymentState,
  refundPayment,
  type BarionPaymentStateResponse,
} from '../barion'
import { logger, type Logger } from '../logger'
import { validateRefundResponseProof } from '../barion/refund-response-proof'
import {
  classifyRefundRejection,
  expectedPosTransactionId,
  providerNoEffectEvidence,
  refundComment,
  refundRejectionMessage,
  rejectionReference,
  relatedRefundTotalHuf,
  sameBarionId,
  selectRefundSourceTransaction,
} from './barion-refund-evidence'
import { releaseNeverLaunchedIntent } from './provider-reconciliation'
import type {
  issueCorrectiveInvoiceForOrder,
  issueStornoForOrder,
  IssueCorrectiveInvoiceDeps,
  IssueStornoForOrderDeps,
} from '../szamlazz'
// Közvetlenül a kliens-modulból: a be/ki állapot tiszta env-olvasás, és így a
// számlázás többi részének tesztbeli helyettesítése nem érinti.
import { isSzamlazzEnabled } from '../szamlazz/client'
import { recordRefundAttemptOutcome, type RefundAttemptAuditInput } from './attempt-audit'
import { refundInvoiceGate } from './invoice-gate'
import { createRefundIntent, loadActiveRefundIntent, transitionRefundIntent } from './intent-store'
import {
  assertUnusedRefundTransaction,
  prepareRefundReceipt,
  productIds,
  RECEIPTS,
  relationId,
  writeReceipt,
} from './recovery-receipts'
import {
  getRefundRecoveryStatus,
  recoverRefundOrder,
  validatedRefundHistory,
} from './refund-recovery'
import { digestRefundIdempotencyKey, normalizeRefundReason } from './refund-intent'
import { REFUND_RECOVERY_ACTION_LABEL } from './recovery-action-label'

/**
 * Owner-only rendelés-visszatérítés. Check-then-act → advisory-zár
 * (`order:mutate:<id>` — ugyanaz, mint a paid-átmenet), záron belül
 * újraolvasott rendelés. GetState és számla a záron kívül; a záron belül
 * csak a Payment/Refund (timeout < 60s idle-in-transaction).
 *
 * Csak paid téríthető. TransactionId a v4 GetState-ből jön (az orders nem
 * tárolja). Bizonytalan eredmény: blokkoló intent, nincs order-írás; a Barion
 * végleges elutasítása (igazolt nullhatás) provider_failed, a rendelés újra
 * visszatéríthető. Teljes refund: stornó, purchases le;
 * részrefund és záró rész: helyesbítő. Stornó automatikus retry TILOS.
 *
 * HTTP-státuszok (a panel ezekből dönt, src/components/admin/refund-response.ts):
 * 4xx = pénzmozgás biztosan nem történt, a kérés javítás után megismételhető;
 * 503 = a kimenet vagy a helyi feldolgozás nincs lezárva, új pénzvisszatérítés tilos.
 */

/** Üzleti hiba HTTP-státusszal — a route-handler ezt képezi válaszra. */
export class RefundError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RefundError'
    this.status = status
  }
}

/** Egy refund-bejegyzés a rendelés refunds-nyomában (orders.refunds json). */
export interface OrderRefundEntry {
  /** A Barion TransactionId, amelyen a visszatérítés történt (későbbi részrefundok ezt újrahasználják). */
  transactionId: string
  /** A visszatérített összeg HUF-ban. */
  amountHuf: number
  /** A Barion RefundedTransactions tranzakció-státusza (pl. Refunded / PartiallyRefunded). */
  status: string
  refundedAt: string
  type: 'full' | 'partial'
  reason?: string | null
}

export interface RefundOrderInput {
  /** Stable caller operation identity; never regenerated for an uncertain response. */
  operationKey?: unknown
  /** Opcionális részösszeg HUF-ban; hiányában a maradék teljes összeg térül vissza. */
  amountHuf?: unknown
  /** Opcionális, szöveges refund-indok (teljes refundnál a refundReason-be is bekerül). */
  reason?: unknown
  /**
   * A panel opcionális, szabad szöveges indoka (a-refund-9). KIZÁRÓLAG a
   * kísérlet műveletnapló-sorába kerül (attempt-audit.ts): sem a kísérlet, sem
   * a rendelés, sem a bizonylat vagy a Barion-megjegyzés nem kapja meg, így a
   * vásárlóhoz semmilyen úton nem jut el.
   */
  note?: unknown
}

export interface RefundOrderOptions {
  payload: Payload
  orderNumber: string
  input: RefundOrderInput
  /** A műveletet végző owner (audit actor). */
  actor: User
  headers?: Headers
  ipAddress?: string
  /** A kérés azonosítója: a naplósorok és a kísérlet műveletnapló-sora ugyanezt hordozza. */
  requestId?: string
  logger?: Logger
  /**
   * Injektálható stornó-hívó (teszteléshez); alapból a valódi
   * issueStornoForOrder. Hibája nem fordítja vissza a pénzügyi eredményt,
   * de a feldolgozás csak tartós bizonylatbizonyítékkal lesz teljes.
   */
  issueStorno?: (
    order: Order,
    deps: IssueStornoForOrderDeps,
  ) => ReturnType<typeof issueStornoForOrder>
  /**
   * Injektálható helyesbítő-hívó (teszteléshez); alapból a valódi
   * issueCorrectiveInvoiceForOrder. Szintén best-effort.
   */
  issueCorrective?: (
    order: Order,
    deps: IssueCorrectiveInvoiceDeps,
  ) => ReturnType<typeof issueCorrectiveInvoiceForOrder>
}

export interface RefundOrderResult {
  orderNumber: string
  type: 'full' | 'partial'
  amountHuf: number
  transactionId: string
  refundedTransactionStatus: string
  alreadyRefundedHuf: number
  totalRefundedHuf: number
  orderStatus: 'refunded' | 'paid'
  /**
   * A korábbi válaszformátum megmarad. Az új folyamat csak igazolt siker és
   * befejezett feldolgozás után ad sikeres választ; bizonytalanságnál a tartós
   * intent blokkol, a HTTP-válasz kézi ellenőrzést kér.
   */
  refundStatusOutcome: 'succeeded' | 'unknown'
}

/** Paid-átmenet és refund közös rendelés-zára (`order:mutate:<id>`). */
export function refundLockKey(orderId: number | string): string {
  return `order:mutate:${orderId}`
}

/**
 * A Barion tranzakciószintű refund-státuszának besorolása (M-11).
 *
 * A Payment/Refund v2 válasza HTTP 200 és üres Errors mellett is jelezhet
 * TRANZAKCIÓ-SZINTŰ kudarcot a RefundedTransactions[].Status mezőben — ez
 * korábban csak eltárolódott, és a folyamat sikerként ment tovább (nyilvántartás
 * + stornó/helyesbítő számla indult egy meg nem történt visszatérítésre).
 */
export type RefundedTransactionOutcome = 'succeeded' | 'failed' | 'unknown'

/** Igazoltan megtörtént visszatérítést jelentő tranzakció-státuszok. */
const SUCCESSFUL_REFUND_STATUSES: ReadonlySet<string> = new Set([
  'Succeeded',
  'Refunded',
  'PartiallyRefunded',
])

/** Explicit, tranzakciószintű kudarc. */
const FAILED_REFUND_STATUS = 'RefundFailed'

export function classifyRefundedTransactionStatus(
  status: string | null | undefined,
): RefundedTransactionOutcome {
  if (typeof status !== 'string' || status.trim().length === 0) {
    return 'unknown'
  }
  if (status === FAILED_REFUND_STATUS) {
    return 'failed'
  }
  return SUCCESSFUL_REFUND_STATUSES.has(status) ? 'succeeded' : 'unknown'
}

/** A rendelés refunds-nyomának kiolvasása (típustalan json mező → validált bejegyzések). */
export function readRefundEntries(order: Order): OrderRefundEntry[] {
  const raw = (order as { refunds?: unknown }).refunds
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (entry): entry is OrderRefundEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { transactionId?: unknown }).transactionId === 'string' &&
      typeof (entry as { amountHuf?: unknown }).amountHuf === 'number',
  )
}

/** A már visszatérített összeg a refunds-nyomból. */
export function alreadyRefundedHuf(order: Order): number {
  return readRefundEntries(order).reduce((sum, entry) => sum + entry.amountHuf, 0)
}

/** Rendelés-keresés orderNumber alapján (a zár előtt és a záron belül is ez fut). */
async function findOrderByNumber(
  payload: Payload,
  orderNumber: string,
): Promise<Order | undefined> {
  const found = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  return found.docs[0] as Order | undefined
}

/** Egy konkrét rendelés-példányból levezetett refund-döntés. */
interface RefundDecision {
  totalHuf: number
  alreadyRefunded: number
  remainingHuf: number
  amountHuf: number
  type: 'full' | 'partial'
  reason: string | null
  /** A panel belső indoka; csak a műveletnaplóba kerül. */
  note: string | null
  /** A rendelés meglévő refund-nyoma (az új bejegyzés ehhez fűződik). */
  entries: OrderRefundEntry[]
  /** A korábbi refundból ismert Barion TransactionId (ha van). */
  storedTransactionId?: string
  /** A rendelés Barion fizetésazonosítója (validálva, tehát biztosan van). */
  barionPaymentId: string
}

/**
 * Állapotgép- és összeg-validáció EGY rendelés-példányon, hibánál RefundError-ral.
 *
 * Szándékosan tiszta (a naplózáson kívül mellékhatás-mentes) függvény: ugyanez
 * fut a záron KÍVÜL (gyors 4xx visszajelzés fölösleges zárfoglalás nélkül) és a
 * záron BELÜL, a FRISSEN újraolvasott rendelésen — a végleges döntést mindig az
 * utóbbi hozza, tehát egy közben lefutott párhuzamos refund maradvány-hatása
 * biztosan beszámítódik.
 */
function decideRefund(order: Order, input: RefundOrderInput, orderLog: Logger): RefundDecision {
  // Állapotgép-validáció: dupla refund → 409; nem paid → 409.
  if (order.status === 'refunded') {
    throw new RefundError(
      409,
      'Ez a rendelés már korábban teljes egészében visszatérítésre került.',
    )
  }
  if (order.status !== 'paid') {
    throw new RefundError(
      409,
      'Csak fizetett (paid) státuszú rendelés téríthető vissza. A rendelés jelenlegi státusza nem teszi ezt lehetővé.',
    )
  }

  // Összeg-feloldás és validáció.
  const totalHuf =
    typeof order.totalHufSnapshot === 'number'
      ? order.totalHufSnapshot
      : typeof order.amount === 'number'
        ? order.amount
        : null
  if (totalHuf === null || !Number.isSafeInteger(totalHuf) || totalHuf <= 0) {
    orderLog.error('refund: a paid rendeléshez nem tartozik érvényes végösszeg', {
      totalHufSnapshot: order.totalHufSnapshot ?? null,
      amount: order.amount ?? null,
    })
    throw new RefundError(
      409,
      'A rendeléshez nem tartozik érvényes végösszeg, így a visszatérítés nem végezhető el.',
    )
  }

  const entries = validatedRefundHistory(order)
  const alreadyRefunded = entries.reduce((sum, entry) => sum + entry.amountHuf, 0)
  const remainingHuf = totalHuf - alreadyRefunded
  if (remainingHuf <= 0) {
    // Védelmi ág: a nyom szerint minden visszatérült, pedig a státusz nem refunded.
    orderLog.error('refund: a refund-nyom szerint a rendelés már teljesen visszatérült', {
      totalHuf,
      alreadyRefunded,
    })
    throw new RefundError(409, 'Ez a rendelés már teljes egészében visszatérítésre került.')
  }

  // Az indok és a belső megjegyzés ugyanazt a szabályt követi, mint a
  // kísérlet tárolója (normalizeRefundReason), hogy a hiba itt, érthető
  // 400-zal derüljön ki, ne a kísérlet létrehozásánál.
  let reason: string | null
  let note: string | null
  try {
    reason = normalizeRefundReason(input.reason)
    note = normalizeRefundReason(input.note)
  } catch {
    throw new RefundError(
      400,
      'Az indok legfeljebb 1000 karakter lehet, sortörés és vezérlőkarakter nélkül.',
    )
  }

  let amountHuf = remainingHuf
  if (input.amountHuf !== undefined && input.amountHuf !== null) {
    const raw = typeof input.amountHuf === 'number' ? input.amountHuf : Number(input.amountHuf)
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new RefundError(
        400,
        'A visszatérítendő összeg (amountHuf) pozitív egész szám kell legyen.',
      )
    }
    if (raw > remainingHuf) {
      throw new RefundError(
        400,
        `A visszatérítendő összeg nem haladhatja meg a még visszatéríthető összeget (${remainingHuf} Ft).`,
      )
    }
    amountHuf = raw
  }

  if (!order.barionPaymentId) {
    orderLog.error('refund: a paid rendeléshez nem tartozik Barion PaymentId')
    throw new RefundError(
      409,
      'A rendeléshez nem tartozik Barion fizetésazonosító, így a visszatérítés nem végezhető el.',
    )
  }

  // K12: bekapcsolt számlázásnál csak kiállított számla után (invoice-gate.ts).
  // A záron belül a friss rendelésen fut újra, így a közben kiállt vagy
  // elbukott számla is beszámít; az automatikus (paid-reject) útra nem vonatkozik.
  const gate = refundInvoiceGate(order, isSzamlazzEnabled())
  if (gate) {
    orderLog.warn('refund: a számla nincs kiállítva, a visszatérítés nem indult el', {
      invoiceStatus: order.invoiceStatus ?? null,
      gate: gate.reason,
    })
    throw new RefundError(409, `${gate.message} Pénzmozgás nem történt.`)
  }

  // A hozzáférés-alapvonal (prepareRefundReceipt) ugyanezeket kéri. Itt, a
  // refund-kísérlet létrehozása ELŐTT ellenőrizve a hiány nem hagy blokkoló kísérletet.
  if (relationId(order.customer) === null) {
    orderLog.error('refund: a paid rendeléshez nem tartozik vásárlói fiók')
    throw new RefundError(409, MISSING_CUSTOMER)
  }
  try {
    productIds(order)
  } catch {
    orderLog.error('refund: a rendelés egyik tétele nem létező termékre mutat')
    throw new RefundError(409, MISSING_PRODUCT)
  }

  return {
    totalHuf,
    alreadyRefunded,
    remainingHuf,
    amountHuf,
    type: alreadyRefunded + amountHuf >= totalHuf ? 'full' : 'partial',
    reason,
    note,
    entries,
    ...(entries[0]?.transactionId ? { storedTransactionId: entries[0].transactionId } : {}),
    barionPaymentId: order.barionPaymentId,
  }
}

/**
 * TransactionId-feloldás a Barion v4 GetState-ből — REPÓ-TÉNY: az orderön nincs
 * tárolt Barion TransactionId (a T-021/T-022 csak barionPaymentId-t/
 * barionPaymentRequestId-t ment), ezért az első refund előtt újra le kell kérdezni.
 *
 * A hívás SZÁNDÉKOSAN a refund-záron KÍVÜL fut: tiszta olvasás, mellékhatás
 * nélkül, tehát nem kell sorosítani — és így a lassabbik HTTP-hívás nem tartja
 * nyitva a zár tranzakcióját (lásd a modul zár-tartomány szakaszát).
 *
 * Csak a rendelés saját fizetési tranzakciója választható: visszatéríthető
 * típus, Succeeded, és a checkout által adott `${orderNumber}-1` kereskedői
 * azonosító (selectRefundSourceTransaction). Díj-tranzakció így sosem kerül a
 * kérésbe. Mivel itt még nincs refund-kísérlet, minden hiba „nem indult el”.
 *
 * A `refundedHuf` a forrástranzakcióból a Barion szerint már visszatérített
 * összeg (relatedRefundTotalHuf); null, ha nem dönthető el. A hívó ezt veti
 * össze a helyi refund-nyommal (K17: a Barion felületén indított
 * visszatérítés felismerése).
 */
async function resolveBarionTransactionId(
  barionPaymentId: string,
  orderNumber: string,
  orderLog: Logger,
  expectedTransactionId?: string,
): Promise<{ transactionId: string; posTransactionId: string; refundedHuf: number | null }> {
  let state: BarionPaymentStateResponse
  try {
    state = await fetchPaymentState(barionPaymentId)
  } catch (error) {
    orderLog.error('refund: a fizetésállapot újralekérdezése sikertelen (Barion GetState)', {
      kind: error instanceof BarionApiError ? error.kind : 'unknown',
      error: error instanceof Error ? error.message : String(error),
    })
    throw new RefundError(424, BARION_UNAVAILABLE)
  }
  const posTransactionId = expectedPosTransactionId(orderNumber)
  const source =
    posTransactionId !== null && sameBarionId(state.PaymentId, barionPaymentId)
      ? selectRefundSourceTransaction(state, { posTransactionId })
      : null
  if (
    !source ||
    (expectedTransactionId !== undefined &&
      !sameBarionId(source.transactionId, expectedTransactionId))
  ) {
    orderLog.error('refund: a fizetésállapot nem tartalmaz visszatéríthető tranzakciót', {
      barionStatus: state.Status,
    })
    throw new RefundError(409, NO_REFUNDABLE_TRANSACTION)
  }
  return {
    transactionId: source.transactionId,
    posTransactionId: source.posTransactionId,
    refundedHuf: relatedRefundTotalHuf(state, source.transactionId),
  }
}

/** Pénzmozgás nélküli akadályok (4xx): a kérés javítás után megismételhető. */
const MISSING_CUSTOMER =
  'A rendeléshez nem tartozik vásárlói fiók, ezért a hozzáférés nem vonható vissza, és a visszatérítés nem indult el. Pénzmozgás nem történt. Jelezd az üzemeltetőnek.'
const MISSING_PRODUCT =
  'A rendelés egyik terméke már nem található, ezért a visszatérítés nem indult el. Pénzmozgás nem történt. Jelezd az üzemeltetőnek.'
const BARION_UNAVAILABLE =
  'A Barion most nem érhető el, ezért a visszatérítés nem indult el. Pénzmozgás nem történt. Próbáld újra néhány perc múlva.'
const NO_REFUNDABLE_TRANSACTION =
  'A Barion adatai szerint ennél a fizetésnél nincs a rendeléshez tartozó visszatéríthető tranzakció, ezért a visszatérítés nem indult el. Pénzmozgás nem történt. Ellenőrizd a fizetést a Barion-fiókodban, és ha ott rendben van, jelezd az üzemeltetőnek.'
const ORDER_CHANGED =
  'A rendelés visszatérítési adatai közben megváltoztak, ezért a visszatérítés nem indult el. Pénzmozgás nem történt. Frissítsd az oldalt, és nézd meg az aktuális állapotot.'
const INTENT_NOT_CREATED =
  'A visszatérítés nem indult el, a Barionnak nem ment kérés. Pénzmozgás nem történt. Frissítsd az oldalt, és nézd meg az aktuális állapotot.'
const FOREIGN_REFUND =
  'A Barion adatai szerint ebből a fizetésből más összeg ment már vissza, mint amennyit ez a rendelés nyilvántart (például a Barion felületén indítottak visszatérítést). A visszatérítés nem indult el, pénzmozgás nem történt. A Barion felületén ne indíts visszatérítést, és jelezd az üzemeltetőnek a rendelésszámmal együtt.'
const REFUNDED_TOTAL_UNCLEAR =
  'A Barion adataiból nem dönthető el, mennyi ment már vissza ebből a fizetésből (például egy korábbi visszatérítés még feldolgozás alatt áll, vagy sikertelen lett). A visszatérítés nem indult el, pénzmozgás nem történt. Nézz vissza néhány óra múlva, és ha ez marad, jelezd az üzemeltetőnek a rendelésszámmal együtt.'
const PREPARATION_FAILED =
  'A visszatérítés előkészítése nem sikerült, a Barionnak nem ment kérés. Pénzmozgás nem történt. Próbáld újra néhány perc múlva, és ha ismét ez történik, jelezd az üzemeltetőnek.'

/** Lezáratlan kimenet vagy feldolgozás (503): új pénzvisszatérítés tilos. A gombra a panel tényleges feliratával hivatkozunk. */
const RECOVER = `„${REFUND_RECOVERY_ACTION_LABEL}”`
const REFUND_PENDING =
  'Ennél a rendelésnél egy korábbi visszatérítés feldolgozása még nem zárult le. Ne indíts új pénzvisszatérítést, amíg az le nem zárul.'
const PREPARATION_UNRELEASED = `A visszatérítés előkészítése megszakadt, a Barionnak nem ment kérés. Ne indíts új pénzvisszatérítést: a ${RECOVER} gomb lezárja ezt a kísérletet.`
const PROVIDER_UNCERTAIN = `A Barion nem adott értékelhető választ, ezért nem tudni, megtörtént-e a visszatérítés. Ne indíts új pénzvisszatérítést: a ${RECOVER} gomb lekérdezi az eredményt a Barionból.`
const REJECTION_UNRECORDED = `A Barion elutasította a visszatérítést, de az elutasítás rögzítése nem sikerült. Ne indíts új pénzvisszatérítést: a ${RECOVER} gomb a Barion adatai alapján lezárja a kísérletet.`
const PROVIDER_SUCCEEDED_UNRECORDED = `A Barion visszaigazolta a visszatérítést, de a rögzítése nem fejeződött be. Ne indíts új pénzvisszatérítést: a ${RECOVER} gomb a Barion adatai alapján befejezi.`
const LOCAL_PROCESSING_INCOMPLETE =
  'A Barion visszaigazolta a visszatérítést, de a helyi feldolgozás (hozzáférés, számla) nem fejeződött be. Ne indíts új pénzvisszatérítést.'

/**
 * A kísérlet Barion-válaszának műveletnapló-sora (attempt-audit.ts), a
 * kérés azonosítójával, IP-címével és a panel indokával. Best-effort: a
 * pénzügyi döntést a tartós intent hordozza, ez a vitához kell.
 */
async function auditAttempt(
  options: RefundOrderOptions,
  intent: RefundIntent,
  outcome: Pick<
    RefundAttemptAuditInput,
    'outcome' | 'providerErrorCodes' | 'errorKind' | 'httpStatus'
  >,
  decision: Pick<RefundDecision, 'reason' | 'note'>,
): Promise<void> {
  await recordRefundAttemptOutcome(options.payload, {
    intent,
    ...outcome,
    requestId: options.requestId ?? null,
    ipAddress: options.ipAddress ?? null,
    reason: decision.reason,
    note: decision.note,
  })
}

/** Every new provider submission requires a durable claim; recovery never enters this function. */
export async function refundOrder(options: RefundOrderOptions): Promise<RefundOrderResult> {
  const { payload, orderNumber } = options
  const operationKey = options.input.operationKey
  try {
    digestRefundIdempotencyKey(operationKey as string)
  } catch {
    throw new RefundError(
      400,
      'A visszatérítéshez műveletazonosító szükséges. Frissítsd a rendelés nézetét.',
    )
  }
  const log = options.logger ?? logger
  const preOrder = await findOrderByNumber(payload, orderNumber)
  if (!preOrder) throw new RefundError(404, 'A megadott rendelés nem található.')
  if (await loadActiveRefundIntent(payload, preOrder.id)) throw new RefundError(503, REFUND_PENDING)
  const preDecision = decideRefund(preOrder, options.input, log)
  if ((await getRefundRecoveryStatus({ payload, orderNumber })).state !== 'clear')
    throw new RefundError(503, REFUND_PENDING)
  const resolved = await resolveBarionTransactionId(
    preDecision.barionPaymentId,
    orderNumber,
    log,
    preDecision.storedTransactionId,
  )
  // K17 és r-barion-8: a Barion szerint visszatérített összegnek egyeznie kell
  // a helyi refund-nyommal. Eltérésnél (például a Barion felületén indított
  // visszatérítés után) egy újabb visszatérítés dupla kifizetés lehetne, ezért
  // nem indul, és a tulajdonos riasztást kap. Pénzt a rendszer itt nem mozgat.
  if (resolved.refundedHuf !== preDecision.alreadyRefunded) {
    log.error(
      'RIASZTÁS: a Barion szerint visszatérített összeg eltér a rendelés nyilvántartásától, a tulajdonosi visszatérítés nem indult el; kézi egyeztetés szükséges',
      {
        alertCode: 'visszaterites-barion-elteres',
        orderId: preOrder.id,
        orderNumber,
        barionRefundedHuf: resolved.refundedHuf,
        localRefundedHuf: preDecision.alreadyRefunded,
        requestId: options.requestId ?? null,
      },
    )
    throw new RefundError(
      409,
      resolved.refundedHuf === null ? REFUNDED_TOTAL_UNCLEAR : FOREIGN_REFUND,
    )
  }
  const outcome = await withAdvisoryLock(
    payload,
    refundLockKey(preOrder.id),
    async () => {
      const order = await findOrderByNumber(payload, orderNumber)
      if (!order) throw new RefundError(404, 'A megadott rendelés nem található.')
      if (await loadActiveRefundIntent(payload, order.id))
        throw new RefundError(503, REFUND_PENDING)
      const decision = decideRefund(order, options.input, log)
      if ((await getRefundRecoveryStatus({ payload, orderNumber })).state !== 'clear')
        throw new RefundError(503, REFUND_PENDING)
      const transactionId = decision.storedTransactionId ?? resolved.transactionId
      // A zár előtti GetState csak a zár alatt is érvényes nyilvántartással vethető össze.
      if (
        !sameBarionId(transactionId, resolved.transactionId) ||
        decision.barionPaymentId !== preDecision.barionPaymentId ||
        resolved.refundedHuf !== decision.alreadyRefunded
      )
        throw new RefundError(409, ORDER_CHANGED)
      let intent: RefundIntent
      try {
        intent = await createRefundIntent(
          payload,
          {
            schemaVersion: 1,
            actorId: String(options.actor.id),
            orderId: String(order.id),
            provider: 'barion',
            providerPaymentId: decision.barionPaymentId,
            providerTransactionId: transactionId,
            refundSequence: decision.entries.length + 1,
            requestedAmountHuf: decision.amountHuf,
            currency: 'HUF',
            reason: decision.reason,
          },
          operationKey as string,
        )
      } catch {
        // Indítási engedély nélkül Barion-kérés nem mehetett (pl. a műveletazonosító már lezárult).
        log.warn('refund: a refund-kísérlet nem jött létre', { orderId: order.id })
        throw new RefundError(409, INTENT_NOT_CREATED)
      }
      // An unacknowledged baseline leaves no launch authorization and MUST NOT launch a provider request.
      try {
        await prepareRefundReceipt(payload, intent, order)
        intent = await transitionRefundIntent(payload, intent, 'provider_started')
      } catch {
        log.warn('refund: az előkészítés megszakadt, Barion-kérés nem indult', {
          orderId: order.id,
        })
        // Elveszett provider_started-nyugtánál a feltételes átmenet elbukik: az intent blokkol.
        try {
          await releaseNeverLaunchedIntent(payload, intent)
        } catch {
          throw new RefundError(503, PREPARATION_UNRELEASED)
        }
        throw new RefundError(409, PREPARATION_FAILED)
      }
      let response
      try {
        response = await refundPayment({
          paymentId: intent.providerPaymentId,
          transactionsToRefund: [
            {
              transactionId,
              posTransactionId: resolved.posTransactionId,
              amountToRefund: intent.requestedAmountHuf,
              comment: refundComment(order.orderNumber),
            },
          ],
        })
      } catch (error) {
        const rejection = classifyRefundRejection(error)
        const httpStatus = error instanceof BarionApiError ? (error.httpStatus ?? null) : null
        if (rejection) {
          // RIASZTÁS (K6, a-riasztas-5): a tulajdonos a panelen azonnal látja az
          // okot, a riasztás a hibakóddal és a kérésazonosítóval a naplóba és a
          // riasztás-csatornába megy, hogy a Barion-tárca vagy -fiók gondja ne
          // csak egy kattintás mögött derüljön ki.
          log.error(
            'RIASZTÁS: a Barion elutasította a tulajdonosi visszatérítést, pénzmozgás nem történt; a rendelés a hiba elhárítása után újra visszatéríthető',
            {
              alertCode: 'visszaterites-barion-elutasitotta',
              orderId: order.id,
              orderNumber: order.orderNumber ?? null,
              providerErrorCodes: rejection.codes,
              httpStatus,
              amountHuf: intent.requestedAmountHuf,
              requestId: options.requestId ?? null,
            },
          )
          await auditAttempt(
            options,
            intent,
            {
              outcome: 'rejected',
              providerErrorCodes: rejection.codes,
              errorKind: error instanceof BarionApiError ? error.kind : 'unknown',
              httpStatus,
            },
            decision,
          )
          try {
            await transitionRefundIntent(
              payload,
              intent,
              'provider_failed',
              providerNoEffectEvidence(rejectionReference(rejection)),
            )
          } catch {
            try {
              await transitionRefundIntent(payload, intent, 'provider_unknown')
            } catch {
              /* The launch claim remains blocking. */
            }
            throw new RefundError(503, REJECTION_UNRECORDED)
          }
          throw new RefundError(409, refundRejectionMessage(rejection, intent.requestedAmountHuf))
        }
        const errorKind = error instanceof BarionApiError ? error.kind : 'unknown'
        const providerErrorCodes =
          error instanceof BarionApiError && Array.isArray(error.providerErrors)
            ? error.providerErrors
                .map((item) => item?.ErrorCode)
                .filter((code): code is string => typeof code === 'string')
            : []
        log.error(
          `RIASZTÁS: a Barion-válaszból nem dönthető el a visszatérítés kimenete, a kísérlet blokkol; a ${REFUND_RECOVERY_ACTION_LABEL} lekérdezi az eredményt a Barionból`,
          {
            alertCode: 'visszaterites-kimenete-ismeretlen',
            orderId: order.id,
            orderNumber: order.orderNumber ?? null,
            errorKind,
            providerErrorCodes,
            httpStatus,
            amountHuf: intent.requestedAmountHuf,
            requestId: options.requestId ?? null,
          },
        )
        await auditAttempt(
          options,
          intent,
          { outcome: 'unknown', providerErrorCodes, errorKind, httpStatus },
          decision,
        )
        try {
          await transitionRefundIntent(payload, intent, 'provider_unknown')
        } catch {
          // The durable provider_started claim still blocks a new payment when the CAS is unacknowledged.
        }
        throw new RefundError(503, PROVIDER_UNCERTAIN)
      }
      const proof = validateRefundResponseProof(response, {
        paymentId: intent.providerPaymentId,
        sourceTransactionId: transactionId,
        posTransactionId: resolved.posTransactionId,
        amountHuf: intent.requestedAmountHuf,
      })
      const markUnknown = async (errorKind: string): Promise<never> => {
        log.error(
          `RIASZTÁS: a Barion válasza nem igazolja a visszatérítést, a kísérlet blokkol; a ${REFUND_RECOVERY_ACTION_LABEL} lekérdezi az eredményt a Barionból`,
          {
            alertCode: 'visszaterites-kimenete-ismeretlen',
            orderId: order.id,
            orderNumber: order.orderNumber ?? null,
            errorKind,
            amountHuf: intent.requestedAmountHuf,
            requestId: options.requestId ?? null,
          },
        )
        await auditAttempt(
          options,
          intent,
          { outcome: 'unknown', providerErrorCodes: [], errorKind, httpStatus: null },
          decision,
        )
        try {
          await transitionRefundIntent(payload, intent, 'provider_unknown')
        } catch {
          /* The launch claim remains blocking. */
        }
        throw new RefundError(503, PROVIDER_UNCERTAIN)
      }
      if (!proof) return markUnknown('unprovable-response')
      const status = proof.status
      try {
        await assertUnusedRefundTransaction(payload, intent, proof.refundTransactionId)
      } catch {
        return markUnknown('refund-transaction-consumed')
      }
      // Minimal correlated evidence, never the raw provider body. Lost acknowledgement remains blocking.
      try {
        await writeReceipt(payload, intent, RECEIPTS.provider, {
          version: 2,
          paymentId: intent.providerPaymentId,
          transactionId,
          refundTransactionId: proof.refundTransactionId,
          posTransactionId: resolved.posTransactionId,
          amountHuf: intent.requestedAmountHuf,
          sequence: intent.refundSequence,
          status,
          totalHuf: decision.totalHuf,
          alreadyRefundedHuf: decision.alreadyRefunded,
          type: decision.type,
        })
        await transitionRefundIntent(payload, intent, 'provider_succeeded')
      } catch {
        // A pénz a Barion szerint visszament, a rendszer ezt még nem rögzítette:
        // a kísérlet provider_started marad, és a „Feldolgozás folytatása” a
        // Barion adataiból (GetState) zárja le.
        log.error(
          `RIASZTÁS: a Barion visszaigazolta a visszatérítést, de a rögzítése nem fejeződött be; a ${REFUND_RECOVERY_ACTION_LABEL} a Barion adataiból befejezi`,
          {
            alertCode: 'visszaterites-rogzitese-elakadt',
            orderId: order.id,
            orderNumber: order.orderNumber ?? null,
            amountHuf: intent.requestedAmountHuf,
            requestId: options.requestId ?? null,
          },
        )
        await auditAttempt(
          options,
          intent,
          {
            outcome: 'unknown',
            providerErrorCodes: [],
            errorKind: 'provider-success-unrecorded',
            httpStatus: null,
          },
          decision,
        )
        throw new RefundError(503, PROVIDER_SUCCEEDED_UNRECORDED)
      }
      await auditAttempt(
        options,
        intent,
        { outcome: 'succeeded', providerErrorCodes: [], errorKind: null, httpStatus: null },
        decision,
      )
      return { decision, transactionId, status }
    },
    log,
  )
  const recovered = await recoverRefundOrder({ ...options, logger: log })
  if (recovered.recoveryStatus !== 'completed') {
    log.error(
      'RIASZTÁS: a visszatérítés a Barionban megtörtént, de a helyi feldolgozása (hozzáférés, számla) nem fejeződött be; a panel mutatja a teendőt',
      {
        alertCode: 'visszaterites-feldolgozasa-elakadt',
        orderId: preOrder.id,
        orderNumber,
        requestId: options.requestId ?? null,
      },
    )
    throw new RefundError(503, LOCAL_PROCESSING_INCOMPLETE)
  }
  const { decision, transactionId, status } = outcome
  return {
    orderNumber,
    type: decision.type,
    amountHuf: decision.amountHuf,
    transactionId,
    refundedTransactionStatus: status,
    alreadyRefundedHuf: decision.alreadyRefunded,
    totalRefundedHuf: decision.alreadyRefunded + decision.amountHuf,
    orderStatus: decision.type === 'full' ? 'refunded' : 'paid',
    refundStatusOutcome: 'succeeded',
  }
}
