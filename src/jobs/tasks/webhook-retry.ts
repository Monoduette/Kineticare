import type { TaskConfig } from 'payload'

import { shouldEmitThrottledAlert } from '../../lib/alert-throttle'
import { withSessionAdvisoryLock } from '../../lib/advisory-lock'
import { callbackLockKey } from '../../lib/barion-callback/process-callback'
import { canonicalBarionGuid } from '../../lib/barion/guid'
import {
  getWebhookProcessor,
  isRetryDue,
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  webhookEventStore,
  type ProcessWebhookOutcome,
} from '../../lib/idempotency'
import { logger } from '../../lib/logger'
import { WEBHOOK_RETRY_CRON, WEBHOOK_RETRY_QUEUE } from '../queues'
import { createStaleAwareBeforeSchedule } from '../schedule-guard'

/**
 * webhook-retry: received/failed események újrafuttatása, exponenciális backoff.
 * A scan kizárja a kimerült rekordokat (különben eltömik a 25-ös ablakot).
 * `pending_repoll` kimerüléskor received marad (későbbi Succeeded callback).
 * Schedule nélkül soha nem kerül sorba. beforeSchedule: ../schedule-guard.ts.
 * K8: a batch per-esemény hibaizolációval fut — egyetlen mérgezett rekord
 * (státuszgépen kívüli throw) nem állíthatja le a futást és nem éheztetheti
 * ki a mögötte álló érvényes fizetéseket.
 * a-callback-8: a Barion-esemény UGYANAZON a PaymentId-nkénti callback-záron
 * fut, mint a route (callbackLockKey). Korábban zár nélkül futott, így egy
 * egyidejű callbackkel két feldolgozás és két PaymentState versenyzett. A zár
 * session-szintű (dedikált kapcsolat, nincs tétlen tranzakció), mert a
 * feldolgozás a záron belül HTTP-t is hív (GetState, visszaigazoló levél).
 */
const RETRY_BATCH_SIZE = 25

/** A task input/outputja (a TypedJobs a payload-types frissüléséig nem ismeri). */
interface WebhookRetryJobIO {
  input: Record<string, never>
  output: {
    scanned: number
    retried: number
    succeeded: number
    failed: number
    skipped: number
    exhausted: number
  }
}

export const webhookRetryTask: TaskConfig<WebhookRetryJobIO> = {
  slug: 'webhook-retry',
  // Job-szintű újrapróbálás: ha maga a task is elhasal (pl. DB-kimaradás),
  // a queue még egyszer megpróbálja, utána failed job + log.
  retries: 1,
  schedule: [
    {
      cron: WEBHOOK_RETRY_CRON,
      queue: WEBHOOK_RETRY_QUEUE,
      hooks: { beforeSchedule: createStaleAwareBeforeSchedule({ taskSlug: 'webhook-retry' }) },
    },
  ],
  outputSchema: [
    { name: 'scanned', type: 'number', required: true },
    { name: 'retried', type: 'number', required: true },
    { name: 'succeeded', type: 'number', required: true },
    { name: 'failed', type: 'number', required: true },
    { name: 'skipped', type: 'number', required: true },
    { name: 'exhausted', type: 'number', required: true },
  ],
  handler: async ({ req }) => {
    const store = webhookEventStore(req.payload)
    const nowMs = Date.now()

    const candidates = await store.find({
      collection: 'webhook-events',
      where: {
        and: [
          { status: { in: ['received', 'failed'] } },
          // K3 ablak-védelem: a kimerült (attempts >= MAX) rekordok KIZÁRVA —
          // különben a legrégebbit-előnyben-részesítő, 25-ös ablakot véglegesen
          // eltömik (az updatedAt-jük befagy), és az új failed események sosem
          // kerülnének sorra. A hiányzó attempts (régi/NULL sor) újrapróbálható,
          // azt az isRetryDue úgyis 0-ként kezeli.
          {
            or: [
              { attempts: { less_than: MAX_WEBHOOK_ATTEMPTS } },
              { attempts: { exists: false } },
            ],
          },
        ],
      },
      sort: 'updatedAt',
      limit: RETRY_BATCH_SIZE,
      overrideAccess: true,
    })

    let retried = 0
    let succeeded = 0
    let failed = 0
    let skipped = 0
    let exhausted = 0

    for (const event of candidates.docs) {
      const processor = getWebhookProcessor(event.provider)
      if (!processor) {
        skipped += 1
        continue
      }
      if (!isRetryDue(event, nowMs)) {
        skipped += 1
        continue
      }

      retried += 1
      // K8 — PER-ESEMÉNY HIBAIZOLÁCIÓ. A processWebhook a handler-hibákat és
      // a sikeres ág store.update hibáját is elkapja (attemptProcessing
      // try/catch) — ami KIREPÜLHET, az a processWebhook ELEJI findByKey
      // (store.find) és a nem-unique-violation store.create hibája (pl. sérült
      // azonosítón elhasaló lekérdezés). Ez korábban kiölte a ciklust: a batch
      // a mérgezett rekordnál megállt, és mivel a sor updatedAt-je nem
      // mozdult, a következő futás UGYANITT halt el — a mögötte álló érvényes
      // fizetések véglegesen kiéheztek. A catch: (1) a batch folytatódik,
      // (2) best-effort attempts++/failed írás, hogy a mérgezett sor backoffal
      // hátrébb sorolódjon és MAX után kiessen a scanből, (3) kimerüléskor
      // fojtott owner-riasztás (lásd alert-throttle — nem percenként ismétel).
      // Ismert, elfogadott verseny: a failed-írás a scan-pillanatkép id-jára
      // megy — ha közben egy route-kézbesítés terminálisra zárta a sort, a
      // státusz visszabillen failed-re, de a result/processedAt érintetlen, és
      // az újrafeldolgozás idempotens no-opként processed-re gyógyítja.
      let outcome: ProcessWebhookOutcome
      try {
        const retry = () =>
          processWebhook({
            store,
            provider: event.provider,
            externalId: event.externalId,
            handler: processor,
          })
        outcome =
          event.provider === 'barion'
            ? await withSessionAdvisoryLock(
                req.payload,
                // A route a kanonikus alakot zárja: a régi, más alakú sor is ugyanazt a kulcsot kapja.
                callbackLockKey(
                  canonicalBarionGuid(event.externalId) ?? event.externalId.toLowerCase(),
                ),
                retry,
                logger.child({ provider: event.provider, eventId: event.id }),
              )
            : await retry()
      } catch (error) {
        failed += 1
        const attempts = (event.attempts ?? 0) + 1
        const message = error instanceof Error ? error.message : String(error)
        await store
          .update({
            collection: 'webhook-events',
            id: event.id,
            data: { status: 'failed', attempts, lastError: message },
            overrideAccess: true,
          })
          .catch(() => undefined)
        if (attempts >= MAX_WEBHOOK_ATTEMPTS) {
          exhausted += 1
          if (shouldEmitThrottledAlert(`webhook-retry-crash:${event.provider}:${event.id}`)) {
            logger.error(
              'RIASZTÁS: webhook-esemény újrapróbálása a státuszgépen kívül hibázott és a kísérletek kimerültek — owner beavatkozás szükséges',
              {
                provider: event.provider,
                externalId: event.externalId,
                eventId: event.id,
                attempts,
                error: message,
              },
            )
          }
        } else {
          logger.warn(
            'webhook-esemény újrapróbálása a státuszgépen kívül hibázott — a batch folytatódik',
            {
              provider: event.provider,
              externalId: event.externalId,
              eventId: event.id,
              attempts,
              error: message,
            },
          )
        }
        continue
      }
      if (outcome.kind === 'processed') {
        if (outcome.nonTerminal && outcome.attempts >= MAX_WEBHOOK_ATTEMPTS) {
          // W13 — pending_repoll kimerülés: NEM terminális siker. A `failed`
          // számláló a dobó handleré (lásd lent); itt a handler lefutott, a
          // fizetés viszont továbbra is függő. A riasztást az
          // attemptProcessing már kiírta.
          exhausted += 1
        } else if (!outcome.nonTerminal) {
          succeeded += 1
        }
        // Köztes pending_repoll (attempts < MAX): retried nőtt, succeeded nem
        // — a kimenetel nem terminális győzelem, a következő scan még viszi.
      } else if (outcome.kind === 'already-processed') {
        succeeded += 1
      } else if (outcome.kind === 'failed') {
        if (!outcome.retryable) {
          // A kimerülés PILLANATA: ez volt az utolsó megengedett kísérlet — a
          // scan-szűrő (K3) többé nem adja vissza ezt a rekordot, tehát az
          // owner-riasztás ITT, egyszer, error-szinten megy ki.
          exhausted += 1
          failed += 1
          logger.error(
            'RIASZTÁS: webhook-esemény újrapróbálásai kimerültek — owner beavatkozás szükséges',
            {
              provider: event.provider,
              externalId: event.externalId,
              eventId: event.id,
              attempts: outcome.attempts,
              error: outcome.error,
            },
          )
        } else {
          failed += 1
          logger.warn('webhook-esemény újrapróbálása sikertelen', {
            provider: event.provider,
            externalId: event.externalId,
            eventId: event.id,
            attempts: outcome.attempts,
            retryable: outcome.retryable,
            error: outcome.error,
          })
        }
      }
    }

    logger.info('webhook-retry task lefutott', {
      queue: WEBHOOK_RETRY_QUEUE,
      scanned: candidates.docs.length,
      retried,
      succeeded,
      failed,
      skipped,
      exhausted,
    })

    return {
      output: {
        scanned: candidates.docs.length,
        retried,
        succeeded,
        failed,
        skipped,
        exhausted,
      },
    }
  },
}
