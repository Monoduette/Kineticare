import type { TaskConfig } from 'payload'

import {
  getWebhookProcessor,
  isRetryDue,
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  webhookEventStore,
} from '../../lib/idempotency'
import { logger } from '../../lib/logger'
import { WEBHOOK_RETRY_CRON, WEBHOOK_RETRY_QUEUE } from '../queues'
import { createStaleAwareBeforeSchedule } from '../schedule-guard'

/**
 * webhook-retry: received/failed események újrafuttatása, exponenciális backoff.
 * A scan kizárja a kimerült rekordokat (különben eltömik a 25-ös ablakot).
 * `pending_repoll` kimerüléskor received marad (későbbi Succeeded callback).
 * Schedule nélkül soha nem kerül sorba. beforeSchedule: ../schedule-guard.ts.
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
      const outcome = await processWebhook({
        store,
        provider: event.provider,
        externalId: event.externalId,
        handler: processor,
      })
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
          logger.error('webhook-esemény újrapróbálásai kimerültek — owner beavatkozás szükséges', {
            provider: event.provider,
            externalId: event.externalId,
            eventId: event.id,
            attempts: outcome.attempts,
            error: outcome.error,
          })
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
