import { after } from 'next/server'
import { getPayload, type Payload } from 'payload'

import { withAdvisoryLock } from '@/lib/advisory-lock'
import { canonicalBarionGuid } from '@/lib/barion/guid'
import { createBarionCallbackProcessor } from '@/lib/barion-callback/process-callback'
import { callbackLockKey } from '@/lib/barion-callback/route-handler'
import {
  isTerminallyProcessed,
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  webhookEventStore,
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
 * elindítja ugyanazt a feldolgozót, amit a callback-út és a webhook-retry is
 * futtat: callback-zár (`callbackLockKey`) → `processWebhook` →
 * `createBarionCallbackProcessor` (GetState + a közös állapotgép, soha nem a
 * plugin `confirmOrder`-je). A PaymentId-nkénti hívás-fojtás a
 * `fetchPaymentState` saját kapuja (w1-barion-platform); itt nincs külön
 * fojtó.
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
 * KORLÁTOK (visszaélés és ismétlés ellen):
 *  - csak `payment_pending` rendelésre, tárolt PaymentId-vel;
 *  - csak friss rendelésre (`THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS`): a
 *    visszatérés a fizetési ablakon (30 perc) belül történik, a régebbi
 *    függő sort az order-poll viszi;
 *  - a webhook-esemény kísérletszámát ez az út SOHA nem viszi a kimerülésig
 *    (`MAX_WEBHOOK_ATTEMPTS - 1`-nél megáll): a kimerülés riasztást ad és a
 *    retry-jobból kivenné az eseményt, azt pedig egy oldal-újratöltés nem
 *    okozhatja. Ez egyben felső korlát is: egy PaymentId-re ezen az úton
 *    legfeljebb néhány GetState megy, bárhányszor töltik újra a lapot.
 */

/** A visszatérés-ellenőrzés csak ennél fiatalabb rendelésre fut (a fizetési ablak 30 perc). */
export const THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS = 2 * 60 * 60 * 1000

export type ThankYouStateCheckOutcome =
  | 'invalid-order-number'
  | 'not-found'
  | 'not-pending'
  | 'no-payment-id'
  | 'too-old'
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

    const store = input.store ?? webhookEventStore(input.payload)
    const existing = await store.find({
      collection: 'webhook-events',
      where: {
        and: [{ provider: { equals: 'barion' } }, { externalId: { equals: paymentId } }],
      },
      limit: 1,
      overrideAccess: true,
    })
    const record = existing.docs[0]
    if (record !== undefined && isTerminallyProcessed(record)) {
      return 'already-processed'
    }
    if (record !== undefined && (record.attempts ?? 0) >= MAX_WEBHOOK_ATTEMPTS - 1) {
      return 'attempts-reserved'
    }

    const paymentLog = log.child({ paymentId })
    const outcome = await withAdvisoryLock(
      input.payload,
      callbackLockKey(paymentId),
      () =>
        processWebhook({
          store,
          provider: 'barion',
          externalId: paymentId,
          handler: createBarionCallbackProcessor({ payload: input.payload, store }),
        }),
      paymentLog,
    )
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
