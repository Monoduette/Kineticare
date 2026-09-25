/**
 * A riasztás-csatorna bekötése a loggerbe (szerveroldal).
 *
 * HOL FUT. A `src/jobs/tasks/order-poll.ts` modul betöltésekor hívódik, a
 * Payload-config pedig minden szerverfolyamatban betölti a job-taskokat
 * (`src/jobs/index.ts`): az admin, az API-route-ok és a cron ugyanabban a
 * folyamatban futnak, így a csatorna ott él, ahol a riasztás keletkezik. A
 * csatorna a `globalThis`-en regisztrálódik (lásd `setAlertSink`), tehát
 * egyetlen bekötés minden bundle logger-példányára érvényes.
 *
 * MIKOR NEM. Csak a Next Node-futtatókörnyezetében (`NEXT_RUNTIME ===
 * 'nodejs'`, a `next` CLI állítja be) és nem a build alatt (`NEXT_PHASE ===
 * 'phase-production-build'`, a `next build` állítja be) kapcsol be: a
 * CLI-szkriptek (migrate, seed, import), a tesztek és a build ne küldjenek
 * levelet a tulajdonosnak. A teszt a `force` kapcsolóval és injektált
 * függőségekkel hívja.
 */

const PRODUCTION_BUILD_PHASE = 'phase-production-build'

import { sendMail } from '../email'
import { createPostHogCapture } from '../feedback/posthog-capture'
import { hasAlertSink, logger as rootLogger, setAlertSink } from '../logger'
import { parseAlertRecipients } from './mail'
import { createAlertSink, type AlertSinkDeps, type AlertSinkHandle } from './sink'

export interface InstallAlertSinkOptions {
  /** A környezet (alapból `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Futtatókörnyezettől függetlenül bekapcsol (teszthez). */
  readonly force?: boolean
  /** Felülírható függőségek (teszthez: injektált levél és PostHog). */
  readonly deps?: Partial<AlertSinkDeps>
}

/**
 * Bekapcsolja a csatornát, ha még nincs. Visszatérés: a létrehozott
 * csatorna, vagy `null`, ha nem kapcsolt be (már élt, vagy nem Next-szerver).
 */
export function installAlertSink(options: InstallAlertSinkOptions = {}): AlertSinkHandle | null {
  const env = options.env ?? process.env
  if (
    options.force !== true &&
    (env.NEXT_RUNTIME !== 'nodejs' || env.NEXT_PHASE === PRODUCTION_BUILD_PHASE)
  ) {
    return null
  }
  if (hasAlertSink()) {
    return null
  }
  const handle = createAlertSink({
    sendMail: options.deps?.sendMail ?? sendMail,
    capture: options.deps?.capture ?? createPostHogCapture(),
    recipients: options.deps?.recipients ?? (() => parseAlertRecipients(env.OWNER_ALERT_EMAILS)),
    logger: options.deps?.logger ?? rootLogger,
    ...(options.deps?.now ? { now: options.deps.now } : {}),
    environment:
      options.deps?.environment ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? undefined,
  })
  setAlertSink(handle.sink)
  return handle
}
