/**
 * Életjel (dead man's switch) a job-workerekhez.
 *
 * MIÉRT (a-riasztas-6, a-callback-10): a számlázás, a callback-mentőháló és a
 * késői Succeeded-helyreállítás mind a Payload-cronon fut, amely csak
 * `ENABLE_JOB_WORKERS=true` mellett indul. Ha a kapcsoló kiesik, a cron
 * hibára fut vagy a folyamat megakad, semmi nem szól: a Railway élesítés után
 * nem figyeli a healthcheck-et. A külső figyelő (pl. Healthchecks.io)
 * fordítva működik: akkor riaszt, ha a várt ping NEM érkezik meg időben.
 *
 * Az order-poll minden sikeres futása végén egy GET megy a
 * `HEALTHCHECK_PING_URL` címre. A Healthchecks.io a pinget „HEAD, GET, and
 * POST" metódussal fogadja, és a sikeres ping jelentése: „the job has been
 * completed successfully (or a continuously running process is still running
 * and healthy)" (https://healthchecks.io/docs/http_api/). A figyelőn az
 * időszakot 5 percre, a türelmi időt legalább 10 percre kell állítani
 * (docs/uzemeltetes/11-riasztas-es-ugyelet.md).
 *
 * A ping-cím maga titokszámba megy (aki ismeri, hamis életjelet küldhet),
 * ezért sem a cím, sem a hibaüzenetben esetleg visszaköszönő cím nem kerül
 * a naplóba. Hiányzó cím esetén folyamatonként EGYSZER írunk figyelmeztetést;
 * a ping hibája sosem buktatja a futást (warn).
 */

import type { FetchLike } from '../feedback/posthog-capture'
import type { Logger } from '../logger'

/** A ping időkorlátja: a poll-futás nem várhat sokáig egy külső figyelőre. */
export const HEARTBEAT_TIMEOUT_MS = 5_000

export type HeartbeatResult = 'elkuldve' | 'nincs-beallitva' | 'hibas-cim' | 'hiba'

export interface HeartbeatDeps {
  /** A ping-cím (a `HEALTHCHECK_PING_URL` értéke). */
  readonly url: string | undefined
  readonly logger: Logger
  /** Injektálható `fetch` — teszt SOSEM hív valódi hálózatot. */
  readonly fetchFn?: FetchLike
  readonly timeoutMs?: number
}

let missingUrlWarned = false
let invalidUrlWarned = false

/** Tesztek közötti izolációhoz. */
export function resetHeartbeatWarnings(): void {
  missingUrlWarned = false
  invalidUrlWarned = false
}

function parsePingUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function scrub(text: string, secret: string): string {
  return secret.length > 0 ? text.split(secret).join('[HEALTHCHECK_PING_URL]') : text
}

export async function pingHeartbeat(deps: HeartbeatDeps): Promise<HeartbeatResult> {
  const raw = deps.url?.trim() ?? ''
  if (raw.length === 0) {
    if (!missingUrlWarned) {
      missingUrlWarned = true
      deps.logger.warn(
        'életjel: a HEALTHCHECK_PING_URL nincs beállítva, a job-workerek leállását külső figyelő nem jelzi',
      )
    }
    return 'nincs-beallitva'
  }
  const url = parsePingUrl(raw)
  if (url === null) {
    if (!invalidUrlWarned) {
      invalidUrlWarned = true
      deps.logger.warn('életjel: a HEALTHCHECK_PING_URL nem érvényes http(s) cím, a ping kimarad')
    }
    return 'hibas-cim'
  }
  const fetchFn = deps.fetchFn ?? fetch
  try {
    const response = await fetchFn(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(deps.timeoutMs ?? HEARTBEAT_TIMEOUT_MS),
    })
    if (!response.ok) {
      deps.logger.warn('életjel: a figyelő nem fogadta a pinget', { httpStatus: response.status })
      return 'hiba'
    }
    return 'elkuldve'
  } catch (error) {
    deps.logger.warn('életjel: a ping nem ment ki', {
      error: scrub(error instanceof Error ? error.message : String(error), raw),
    })
    return 'hiba'
  }
}
