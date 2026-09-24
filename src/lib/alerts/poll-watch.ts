/**
 * Az order-poll futás utáni őrfeladatok (a task a `src/jobs/tasks/order-poll.ts`).
 *
 *  1. Egy napnál régebbi `payment_pending` rendelés: azonnali riasztás,
 *     AKKOR IS, ha a GetState tartósan hibázik. A poll-szolgáltatás 24 órás
 *     riasztása csak sikeres GetState után szól (a-riasztas-10): egy soha
 *     ki nem olvasható fizetés (429, hibás azonosító) eddig csak 5 percenként
 *     egy warn-sort kapott. A rendelésenkénti fojtás kulcsa ugyanaz
 *     (`stuck-order:<id>`, 6 óra), mint a szolgáltatásé, így a két út nem
 *     riaszt kétszer ugyanarra.
 *  2. Reggeli napi összesítő, ha esedékes (`src/lib/alerts/digest.ts`).
 *  3. Életjel a külső figyelőnek (`src/lib/alerts/heartbeat.ts`), a futás
 *     LEGVÉGÉN: a ping azt jelenti, hogy a worker él és a poll lefutott.
 *
 * Egyik lépés sem buktatja a futást: a poll fő feladata a fizetések lezárása.
 */

import type { Payload } from 'payload'

import { shouldEmitThrottledAlert } from '../alert-throttle'
import type { SendMailInput } from '../email'
import type { SendResult } from '../email/types'
import type { FetchLike } from '../feedback/posthog-capture'
import type { Logger } from '../logger'
import { PENDING_PAYMENT_ALERT_AFTER_MS } from './attention'
import { ALERT_CODES } from './classify'
import { runDailyDigestIfDue, type DigestOutcome, type DigestState } from './digest'
import { emitAlert } from './emit'
import { pingHeartbeat, type HeartbeatResult } from './heartbeat'

/** Egy futásban legfeljebb ennyi régi függő rendelésről riasztunk. */
export const STUCK_PENDING_ALERT_BATCH = 25

export interface AfterOrderPollDeps {
  readonly payload: Pick<Payload, 'count' | 'find'>
  readonly logger: Logger
  readonly nowMs: number
  readonly sendMail: (input: SendMailInput) => Promise<SendResult>
  readonly recipients: () => readonly string[]
  readonly serverUrl: string
  readonly heartbeatUrl: string | undefined
  readonly vatMode?: string
  readonly fetchFn?: FetchLike
  readonly digestState?: DigestState
}

export interface AfterOrderPollResult {
  readonly stuckPendingAlerts: number
  readonly digest: DigestOutcome
  readonly heartbeat: HeartbeatResult
}

interface StuckPendingOrder {
  id: number
  orderNumber?: string | null
  createdAt?: string | null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 1. lépés: a 24 óránál régebbi függő rendelések riasztása (fojtva). */
export async function alertStuckPendingPayments(
  deps: Pick<AfterOrderPollDeps, 'payload' | 'logger' | 'nowMs'>,
): Promise<number> {
  const result = await deps.payload.find({
    collection: 'orders',
    where: {
      and: [
        { status: { equals: 'payment_pending' } },
        {
          createdAt: {
            less_than: new Date(deps.nowMs - PENDING_PAYMENT_ALERT_AFTER_MS).toISOString(),
          },
        },
      ],
    },
    sort: 'createdAt',
    limit: STUCK_PENDING_ALERT_BATCH,
    depth: 0,
    select: { orderNumber: true, createdAt: true },
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])

  let alerted = 0
  for (const order of result.docs as unknown as StuckPendingOrder[]) {
    if (!shouldEmitThrottledAlert(`stuck-order:${String(order.id)}`, undefined, deps.nowMs)) {
      continue
    }
    const createdAtMs = Date.parse(order.createdAt ?? '')
    const ageHours = Number.isFinite(createdAtMs)
      ? Math.floor((deps.nowMs - createdAtMs) / (60 * 60 * 1000))
      : null
    emitAlert(
      deps.logger.child({ orderId: order.id, orderNumber: order.orderNumber ?? null }),
      ALERT_CODES.fuggoFizetes24Ora,
      'RIASZTÁS: a rendelés egy napja függő fizetésben áll. A Barion-állapot nem zárult le, ' +
        'vagy nem olvasható ki. Nézd meg a fizetést a Barion-fiókban.',
      { ageHours },
    )
    alerted += 1
  }
  return alerted
}

export async function afterOrderPoll(deps: AfterOrderPollDeps): Promise<AfterOrderPollResult> {
  const log = deps.logger.child({ module: 'order-poll/watch' })

  let stuckPendingAlerts = 0
  try {
    stuckPendingAlerts = await alertStuckPendingPayments({ ...deps, logger: log })
  } catch (error) {
    log.warn('order-poll: a régi függő fizetések ellenőrzése nem futott le', {
      error: errorText(error),
    })
  }

  let digest: DigestOutcome = 'hiba'
  try {
    digest = await runDailyDigestIfDue({
      payload: deps.payload,
      sendMail: deps.sendMail,
      recipients: deps.recipients,
      logger: log,
      nowMs: deps.nowMs,
      serverUrl: deps.serverUrl,
      ...(deps.vatMode !== undefined ? { vatMode: deps.vatMode } : {}),
      ...(deps.digestState ? { state: deps.digestState } : {}),
    })
  } catch (error) {
    emitAlert(
      log,
      ALERT_CODES.napiOsszesitoHiba,
      'RIASZTÁS: a napi összesítő nem állt össze, a reggeli levél elmarad. A következő futás újrapróbálja.',
      { error: errorText(error) },
    )
  }

  const heartbeat = await pingHeartbeat({
    url: deps.heartbeatUrl,
    logger: log,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
  })

  return { stuckPendingAlerts, digest, heartbeat }
}
