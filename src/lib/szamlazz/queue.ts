import type { Payload } from 'payload'

import { ORDER_MAINTENANCE_QUEUE } from '../../jobs/queues'
import { logger as rootLogger, type Logger } from '../logger'

/**
 * A Számlázz.hu-jobok sorba állítása (C4/C5).
 *
 * A helyesbítő számla (C5) újrapróbálása: ha az inline kísérlet
 * ÚJRAPRÓBÁLHATÓ hibába fut (timeout/hálózat/5xx/szlahu_down), a
 * queueCorrectiveInvoiceJob állíthatja sorba a corrective-invoice-issue
 * taskot (a queueInvoiceIssueJob mintájára, src/lib/order-paid.ts). A
 * sorba állítás a HÍVÓ (refund-helyreállítás) döntése; a beküldés előtti
 * lekérdezés miatt az újrapróbálás biztonságos.
 *
 * A stornó (C4) NEM automatikus újrapróbálás: egy inline POST után az állapot
 * bizonytalan (F3), a vak retry dupla stornót okozhat. A queueStornoIssueJob
 * csak kézi / explicit újrasorbaállításra való, miután ember megerősítette,
 * hogy a Számlázz.hu-fiókban NINCS stornó.
 *
 * A sorba állítás maga is best-effort: hibája SOHA nem billentheti ki a már
 * sikeres visszatérítést — a függvények false-szal térnek vissza és naplóznak.
 * A HIÁNYZÓ JOB-SOR NEM LEHET NÉMA (P2 / W6): payload.jobs.queue nélkül
 * error-szintű RIASZTÁS megy ki (a queueInvoiceIssueJob mintájára).
 */

type JobsQueueLike = {
  queue?: (args: {
    task: string
    input?: Record<string, unknown>
    queue?: string
  }) => Promise<unknown>
}

async function queueOrderMaintenanceTask(
  payload: Payload,
  task: string,
  input: Record<string, unknown>,
  log?: Logger,
): Promise<boolean> {
  try {
    // A TypedJobs-generálás a konsolidációs migrációs loopig nem ismeri az új
    // taskokat — a runtime jobs.queue létezik, ezért strukturálisan castolunk.
    const jobs = (payload as unknown as { jobs?: JobsQueueLike }).jobs
    if (typeof jobs?.queue !== 'function') {
      const alertLog = log ?? rootLogger
      alertLog.error(
        'RIASZTÁS: a Payload job-sor nem érhető el (payload.jobs.queue hiányzik) — a ' +
          'számlázási job NEM állt sorba. Ellenőrizd a Payload jobs-konfigurációt és a ' +
          'task regisztrációját.',
        { task, ...input },
      )
      return false
    }
    await jobs.queue({ task, input, queue: ORDER_MAINTENANCE_QUEUE })
    log?.info('számlázási job sorba állítva', { task, ...input })
    return true
  } catch (error) {
    log?.warn('számlázási job sorba állítása sikertelen (best-effort)', {
      task,
      ...input,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * A stornó-kiállítás KÉZI / explicit újrapróbálása egy rendelésre.
 * Automatikus retry után (inline POST timeout) TILOS hívni — lásd
 * issueStornoBestEffort és a storno-issue task fejkommentjét.
 */
export function queueStornoIssueJob(
  payload: Payload,
  orderId: number,
  log?: Logger,
): Promise<boolean> {
  return queueOrderMaintenanceTask(payload, 'storno-issue', { orderId }, log)
}

/**
 * A helyesbítő számla kiállításának újrapróbálása egy részleges
 * visszatérítéshez (a refunds-nyom 1-alapú sorszámával — ez az idempotencia
 * kulcsa, az összeg a nyomból olvasható vissza).
 */
export function queueCorrectiveInvoiceJob(
  payload: Payload,
  orderId: number,
  refundSeq: number,
  log?: Logger,
): Promise<boolean> {
  return queueOrderMaintenanceTask(payload, 'corrective-invoice-issue', { orderId, refundSeq }, log)
}
