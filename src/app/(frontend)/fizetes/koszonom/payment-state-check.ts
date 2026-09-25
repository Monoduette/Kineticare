import { after } from 'next/server'
import { getPayload, type Payload } from 'payload'

import { withSessionAdvisoryLock } from '@/lib/advisory-lock'
import { fetchPaymentState, mapBarionPaymentStatus } from '@/lib/barion'
import { canonicalBarionGuid } from '@/lib/barion/guid'
import {
  callbackLockKey,
  createBarionCallbackProcessor,
} from '@/lib/barion-callback/process-callback'
import {
  isTerminallyProcessed,
  processWebhook,
  webhookEventStore,
  type ProcessWebhookOutcome,
  type WebhookEventDoc,
  type WebhookEventStore,
} from '@/lib/idempotency'
import { logger as rootLogger, type Logger } from '@/lib/logger'
import { ORDER_NUMBER_PATTERN } from '@/lib/order-number'
import type { Order } from '@/payload-types'

import config from '../../../../payload.config'

/**
 * PaymentState-ellenőrzés a Barion-visszatéréskor (a-callback-11, a-checkout-3,
 * r-barion-7 (3)).
 *
 * MIÉRT. A Barion callback-leírása a callback kiesésére tartalék-hívást kér:
 * „After redirection: the PaymentState endpoint should be called after the
 * customer is redirected to the RedirectUrl." (docs.barion.com,
 * Callback_mechanism, Fallback mechanism; Wayback 20260122005429). Eddig a
 * köszönőoldal csak az adatbázist olvasta, tehát elveszett callbacknél a
 * rendelés (és a visszaigazoló levél) az order-poll következő futásáig
 * függőben maradt.
 *
 * HOGYAN. A lap szerveroldali renderje a válasz UTÁN (`after`) egyszer
 * lekéri a fizetés állapotát, és ha az VÉGLEGES, elindítja ugyanazt a
 * feldolgozót, amit a callback-út és a webhook-retry is futtat, ugyanabban a
 * sorrendben, mint a callback-út futtatója (`runBarionCallbackEvent`,
 * a-callback-7: kimenő HTTP nem tart adatbázis-zárat):
 *  1. GetState a zár ELŐTT (az alábbi előzetes lekérés);
 *  2. session-szintű callback-zár (`withSessionAdvisoryLock`,
 *     `callbackLockKey`; dedikált kapcsolat, tétlen tranzakció nélkül) →
 *     `processWebhook` → `createBarionCallbackProcessor` az ELŐRE LEKÉRT
 *     állapottal (`prefetchedState`): a zár alatt nincs második GetState;
 *  3. a zár elengedése UTÁN a paid-mellékhatás (`onOrderPaid`: e-mail,
 *     számla-job; `deferPaidSideEffect`).
 * A közös állapotgép fut, soha nem a plugin `confirmOrder`-je. A
 * Barion-hívások PaymentId-nkénti fojtása a `fetchPaymentState` saját kapuja
 * (5,5 s, w1-barion-platform); az alábbi hűtés ettől független: azt
 * korlátozza, hányszor indíthatja a LAP ezt a munkát.
 *
 * AMIBEN NEM BÍZUNK:
 *  - a URL-ben érkező `paymentId`-ben SOHA: csak a rendelésszám választja ki
 *    a rendelést, a lekérdezett PaymentId a rendelés TÁROLT
 *    `barionPaymentId`-je;
 *  - a látogatóban sem: a rendelésszám sorszám, tehát kitalálható. Egy
 *    idegen rendelésszám legfeljebb egy olyan GetState-et vált ki, amelyet a
 *    callback úgyis kiváltana; a lap semmit nem árul el belőle (a munka a
 *    válasz után fut, a renderelt tartalom és az időzítés nem függ tőle).
 *
 * KORLÁTOK (visszaélés és ismétlés ellen; a rendelésszám kitalálható, a lapot
 * bárki, bármennyiszer, párhuzamosan is letöltheti):
 *  - csak `payment_pending` rendelésre, tárolt PaymentId-vel;
 *  - csak friss rendelésre (`THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS`): a
 *    visszatérés a fizetési ablakon (30 perc) belül történik, a régebbi
 *    függő sort az order-poll viszi;
 *  - FOLYAMATON BELÜLI HŰTÉS PaymentId-nként
 *    (`THANK_YOU_STATE_CHECK_COOLDOWN_MS`): egy letöltés-sorozat vagy
 *    párhuzamos letöltés ugyanarra a fizetésre egy replikán egyetlen
 *    ellenőrzést indít, a többi azonnal kilép. Így a lap sem GetState-vihart,
 *    sem advisory-zárra várakozó (és addig pool-kapcsolatot foglaló)
 *    tranzakció-sort nem gyárthat;
 *  - ELŐZETES GetState, a webhook-események érintése NÉLKÜL: amíg a Barion
 *    a fizetést függőnek mondja (a vevő még a Barion-oldalon van, vagy
 *    elhagyta), a lap SEMMIT nem ír. Enélkül egyetlen névtelen letöltés egy
 *    `pending_repoll` eseményt hozna létre, amit a webhook-retry job a
 *    fizetési ablakon belül kimerítene, és a tulajdonos hamis RIASZTÁS-t kapna
 *    egy egyszerű elhagyott kosárra. Csak VÉGLEGES állapot (paid, cancelled)
 *    megy tovább a callback-feldolgozóhoz;
 *  - kísérlet-keret (`THANK_YOU_STATE_CHECK_MAX_EVENT_ATTEMPTS`): a lap csak
 *    akkor futtatja a feldolgozót, ha még nincs esemény, vagy a meglévő
 *    nem terminális és 2-nél kevesebb kísérletnél tart. A keret jóval a
 *    kimerülési riasztás (`MAX_WEBHOOK_ATTEMPTS`) és a közeledési
 *    figyelmeztetés alatt van, tehát ez az út egyiket sem válthatja ki;
 *  - az őrt a callback-zár ALATT újra olvassuk: a zár előtti olvasás a zárra
 *    várakozás közben elavulhat (egy másik replika vagy a callback közben
 *    feldolgozta, illetve kísérletet használt).
 *
 * MIÉRT NEM MÁSODIK GetState. A PaymentId-nkénti kapu a második hívást
 * 5,5 s-ig várakoztatná; a zár alatt ez a callback-zárat és egy
 * pool-kapcsolatot tartana, és a paid-levél is ezt várná (a-callback-7, 6.
 * tanulság). Egy elavult előzetes állapot nem árt: az állapotgép monoton, a
 * lezárt eseményt a `processWebhook` nem futtatja újra, és a lap csak
 * VÉGLEGES állapotot ad tovább.
 */

/** A visszatérés-ellenőrzés csak ennél fiatalabb rendelésre fut (a fizetési ablak 30 perc). */
export const THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS = 2 * 60 * 60 * 1000

/**
 * Ugyanarra a PaymentId-re egy replikán ennyi időn belül csak egy ellenőrzés
 * indul. A Barion PaymentState-fojtása 5 s PaymentId-nként (Callback_mechanism);
 * a 30 s egy teljes újratöltés-sorozatot lefed, a valódi visszatérőnek pedig
 * az első letöltés ellenőrzése elég (utána a lap pollja és a callback visz).
 */
export const THANK_YOU_STATE_CHECK_COOLDOWN_MS = 30_000

/** A lap csak ennél kevesebb kísérletnél futtatja a callback-feldolgozót. */
export const THANK_YOU_STATE_CHECK_MAX_EVENT_ATTEMPTS = 2

/** A hűtési tábla mérete fölött a lejárt bejegyzéseket kitakarítjuk. */
const COOLDOWN_PRUNE_THRESHOLD = 500

/** PaymentId → az utolsó indított ellenőrzés ideje (ms). Replikánként külön. */
const lastCheckStartedAt = new Map<string, number>()

/**
 * Szinkron „ellenőriz és beállít": a JavaScript egyszálú, tehát két párhuzamos
 * kérés közül csak az egyik kaphat `true`-t. A visszafelé ugró óra (negatív
 * különbség) nem zárolhat örökre: az ilyen bejegyzést lejártnak vesszük.
 */
function claimCooldown(paymentId: string, now: number): boolean {
  const last = lastCheckStartedAt.get(paymentId)
  if (last !== undefined && now - last >= 0 && now - last < THANK_YOU_STATE_CHECK_COOLDOWN_MS) {
    return false
  }
  if (lastCheckStartedAt.size >= COOLDOWN_PRUNE_THRESHOLD) {
    for (const [key, startedAt] of lastCheckStartedAt) {
      if (now - startedAt >= THANK_YOU_STATE_CHECK_COOLDOWN_MS || now - startedAt < 0) {
        lastCheckStartedAt.delete(key)
      }
    }
  }
  lastCheckStartedAt.delete(paymentId)
  lastCheckStartedAt.set(paymentId, now)
  return true
}

/** A lap futtathatja-e a feldolgozót erre az eseményre (a zár előtt és alatt is). */
function eventBlocksCheck(
  record: WebhookEventDoc | undefined,
): 'already-processed' | 'attempts-reserved' | null {
  if (record === undefined) {
    return null
  }
  if (isTerminallyProcessed(record)) {
    return 'already-processed'
  }
  if ((record.attempts ?? 0) >= THANK_YOU_STATE_CHECK_MAX_EVENT_ATTEMPTS) {
    return 'attempts-reserved'
  }
  return null
}

async function findBarionEvent(
  store: WebhookEventStore,
  paymentId: string,
): Promise<WebhookEventDoc | undefined> {
  const existing = await store.find({
    collection: 'webhook-events',
    where: {
      and: [{ provider: { equals: 'barion' } }, { externalId: { equals: paymentId } }],
    },
    limit: 1,
    overrideAccess: true,
  })
  return existing.docs[0]
}

export type ThankYouStateCheckOutcome =
  | 'invalid-order-number'
  | 'not-found'
  | 'not-pending'
  | 'no-payment-id'
  | 'too-old'
  | 'cooldown'
  | 'still-pending'
  | 'already-processed'
  | 'attempts-reserved'
  | 'processed'
  | 'failed'

export interface ThankYouStateCheckInput {
  payload: Payload
  /** A URL-ből jött, a page által már normalizált rendelésszám. */
  orderNumber: string
  store?: WebhookEventStore
  logger?: Logger
  now?: number
}

/**
 * Egy visszatérés-ellenőrzés. SOHA nem dob: a hívó a válasz után futtatja,
 * ahol a kivételnek nincs gazdája.
 */
export async function runThankYouPaymentStateCheck(
  input: ThankYouStateCheckInput,
): Promise<ThankYouStateCheckOutcome> {
  const log = (input.logger ?? rootLogger).child({
    module: 'thank-you-payment-state',
    orderNumber: input.orderNumber,
  })
  try {
    if (!ORDER_NUMBER_PATTERN.test(input.orderNumber)) {
      return 'invalid-order-number'
    }
    const found = await input.payload.find({
      collection: 'orders',
      where: { orderNumber: { equals: input.orderNumber } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const order = found.docs[0] as Order | undefined
    if (order === undefined) {
      return 'not-found'
    }
    if (order.status !== 'payment_pending') {
      return 'not-pending'
    }
    const paymentId = canonicalBarionGuid(order.barionPaymentId)
    if (paymentId === null) {
      // A pénztár még nem mentette el az azonosítót (vagy nem is fog): nincs
      // mit lekérdezni, a mentőháló az order-poll.
      return 'no-payment-id'
    }
    const createdAtMs = Date.parse(order.createdAt)
    const now = input.now ?? Date.now()
    if (
      !Number.isFinite(createdAtMs) ||
      now - createdAtMs > THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS
    ) {
      return 'too-old'
    }

    if (!claimCooldown(paymentId, now)) {
      return 'cooldown'
    }

    const store = input.store ?? webhookEventStore(input.payload)
    const blocked = eventBlocksCheck(await findBarionEvent(store, paymentId))
    if (blocked !== null) {
      return blocked
    }

    const paymentLog = log.child({ paymentId })
    // Előzetes GetState, zár és esemény-írás nélkül: függő fizetésnél a lap
    // nem nyúl a webhook-eseményekhez (lásd a fejkomment KORLÁTOK pontját).
    // Hibája a külső catch-be fut: esemény nem íródik, a mentőháló a
    // callback, a retry-job és az order-poll.
    const probe = await fetchPaymentState(paymentId, undefined, { logger: paymentLog })
    if (mapBarionPaymentStatus(probe.Status) === 'payment_pending') {
      return 'still-pending'
    }

    // A friss paid-átmenet mellékhatása (onOrderPaid) a zár elengedése UTÁN
    // fut, a feldolgozás további kimenetelétől függetlenül (egy újrapróbálás
    // már paid rendelést látna, és nem indítaná újra); runBarionCallbackEvent.
    const deferred: { paidSideEffect: (() => Promise<void>) | null } = { paidSideEffect: null }
    let outcome: ProcessWebhookOutcome | 'already-processed' | 'attempts-reserved'
    try {
      outcome = await withSessionAdvisoryLock(
        input.payload,
        callbackLockKey(paymentId),
        async () => {
          // Az őr a ZÁR ALATT újra: a zárra várva egy másik futás (callback,
          // retry-job, másik replika) lezárhatta az eseményt vagy kísérletet
          // használhatott.
          const lockedBlock = eventBlocksCheck(await findBarionEvent(store, paymentId))
          if (lockedBlock !== null) {
            return lockedBlock
          }
          return processWebhook({
            store,
            provider: 'barion',
            externalId: paymentId,
            handler: createBarionCallbackProcessor({
              payload: input.payload,
              store,
              logger: paymentLog,
              prefetchedState: { ok: true, state: probe },
              deferPaidSideEffect: (run) => {
                deferred.paidSideEffect = run
              },
            }),
          })
        },
        paymentLog,
      )
    } finally {
      if (deferred.paidSideEffect !== null) {
        await deferred.paidSideEffect()
      }
    }
    if (typeof outcome === 'string') {
      return outcome
    }
    if (outcome.kind === 'failed') {
      paymentLog.warn(
        'köszönőoldal: a PaymentState-ellenőrzés nem sikerült (a retry-job és az order-poll folytatja)',
        {
          attempts: outcome.attempts,
          error: outcome.error,
        },
      )
      return 'failed'
    }
    paymentLog.info('köszönőoldal: PaymentState-ellenőrzés lefutott', { kind: outcome.kind })
    return 'processed'
  } catch (error) {
    log.warn('köszönőoldal: a PaymentState-ellenőrzés technikai hibával megállt', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}

/**
 * A lap renderjéből hívott ütemező: a munka a next/server `after()`-jében,
 * a válasz elküldése UTÁN fut. A render sosem vár a Barionra és nem is
 * bukhat el miatta: az ütemezés hibája (pl. kérés-környezeten kívüli hívás)
 * csak naplóba kerül.
 */
export function scheduleThankYouPaymentStateCheck(orderNumber: string): void {
  const log = rootLogger
  try {
    after(async () => {
      try {
        const payload = await getPayload({ config })
        await runThankYouPaymentStateCheck({ payload, orderNumber, logger: log })
      } catch (error) {
        log.warn('köszönőoldal: a PaymentState-ellenőrzés nem indult el', {
          orderNumber,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  } catch (error) {
    log.warn('köszönőoldal: a PaymentState-ellenőrzés ütemezése nem sikerült', {
      orderNumber,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
