import type { Payload } from 'payload'

import type { PayloadJob } from '../payload-types'

/**
 * Az esemény-vezérelt Számlázz.hu-jobok (számla, stornó, helyesbítő) élő
 * példányainak felismerése a payload-jobs sorokból.
 *
 * Élő a job, ha vár a következő futására, vagy éppen fut. A Payload a lefutott
 * jobot `completedAt`-tel, a `retries` után is hibázót `hasError`-ral zárja.
 * Egyiket sem állítja semmi újra sorba magától, ezért ami nem élő, az a
 * háttérben már nem fog lefutni.
 */

/**
 * Ennyi idő után számít elhaltnak a futóként (`processing`) jelölt job. Egy
 * futás a Számlázz.hu-hívásokra a zárban legfeljebb 45 másodpercet használ
 * (LOCKED_SECTION_HTTP_BUDGET_MS, lib/szamlazz/lock-budget.ts), a zárra várás
 * és a lezárás írásai ennél rövidebbek. A futás közben elhalt folyamat
 * (deploy, összeomlás) sorát a Payload 3.88 nem engedi el: a sor `processing`
 * marad, de a job már nem fut tovább.
 */
export const EVENT_JOB_STALE_AFTER_MS = 15 * 60 * 1000

type EventJobTask = Extract<
  PayloadJob['taskSlug'],
  'invoice-issue' | 'storno-issue' | 'corrective-invoice-issue'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Az adott task élő jobjainak inputja (például `{ orderId, refundSeq }`). */
export async function liveJobInputs(
  payload: Payload,
  taskSlug: EventJobTask,
  nowMs: number,
): Promise<Array<Record<string, unknown>>> {
  const jobs = await payload.find({
    collection: 'payload-jobs',
    where: {
      and: [{ taskSlug: { equals: taskSlug } }, { completedAt: { exists: false } }],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const inputs: Array<Record<string, unknown>> = []
  for (const job of jobs.docs) {
    if (job.taskSlug !== taskSlug || job.completedAt || job.hasError === true) continue
    if (!isRecord(job.input)) continue
    if (job.processing) {
      const since = Date.parse(job.updatedAt)
      if (!Number.isFinite(since) || nowMs - since >= EVENT_JOB_STALE_AFTER_MS) continue
    }
    inputs.push(job.input)
  }
  return inputs
}
