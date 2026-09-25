import type { Instrumentation } from 'next'

import type { Logger } from './lib/logger'

/**
 * Next.js instrumentation: riasztás-csatorna, server_start napló (commitSha,
 * nodeVersion), majd assertRequiredEnv, végül a leállási (SIGTERM)
 * cron-lefolyatás bekötése.
 *
 * A riasztás-csatorna (e-mail + PostHog a RIASZTÁS-sorokra) az env-ellenőrzés
 * ELŐTT kapcsol be, különben az induláskori RIASZTÁS (pl. SZAMLAZZ_AGENT_KEY
 * SZAMLAZZ_AFAKULCS nélkül) csak a naplóba kerülne. A bekötés idempotens (a
 * csatorna a `globalThis`-en él), így az order-poll modul későbbi hívása nem
 * köt be második csatornát. Csak a Node-ágon: az edge-futtatókörnyezetbe nem
 * kerül.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installAlertSink } = await import('./lib/alerts/install')
    installAlertSink()

    const { logger } = await import('./lib/logger')
    logger.info('server_start', {
      nodeVersion: process.version,
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'ismeretlen',
    })

    const { assertRequiredEnv } = await import('./env')
    assertRequiredEnv((message, context) => logger.warn(message, context))

    installShutdownDrain({ log: logger.child({ module: 'shutdown' }) })
  }
}

/**
 * A route handlerből, renderből, server actionből vagy middleware-ből kiszökő
 * kivétel: strukturált, request ID-s naplósor és PostHog `$exception`
 * (`src/lib/request-error.ts`). Enélkül csak a Next nyers `⨯ …` sora maradna.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { reportRequestError } = await import('./lib/request-error')
  reportRequestError(error, request, context)
}

// ---------------------------------------------------------------------------
// Leállás: a Payload-cronok leállítása és a futó jobok kivárása (a-callback-2)
// ---------------------------------------------------------------------------

/**
 * Ennyit várunk SIGTERM után a még futó cron-jobokra. A Railway a SIGTERM és a
 * SIGKILL között a railway.json `deploy.drainingSeconds` idejét adja (60 s,
 * docs.railway.com/deployments/deployment-teardown: „the previous deployment is
 * sent a SIGTERM signal and given time to gracefully shutdown before being
 * forcefully stopped with a SIGKILL”); a maradék 15 s a Next saját leállásáé.
 */
export const SHUTDOWN_CRON_DRAIN_BUDGET_MS = 45_000
const SHUTDOWN_POLL_INTERVAL_MS = 250

/** A croner `Cron` példány itt használt felülete (payload.crons elemei). */
export interface DrainableCron {
  stop(): void
  isBusy(): boolean
}

function isDrainableCron(value: unknown): value is DrainableCron {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { stop?: unknown }).stop === 'function' &&
    typeof (value as { isBusy?: unknown }).isBusy === 'function'
  )
}

/**
 * A már inicializált Payload-példány(ok) cronjai. A Payload a példányt a
 * `global._payload` Map-ben tartja (payload/dist/index.js getPayload); ha még
 * nem indult el (pl. a healthcheck előtt jön a SIGTERM), üres a lista. Itt
 * SOSEM inicializálunk új példányt.
 */
export function readPayloadCrons(): DrainableCron[] {
  const cache = (globalThis as { _payload?: unknown })._payload
  if (!(cache instanceof Map)) {
    return []
  }
  const crons: DrainableCron[] = []
  for (const entry of cache.values()) {
    const list = (entry as { payload?: { crons?: unknown } } | undefined)?.payload?.crons
    if (Array.isArray(list)) {
      crons.push(...list.filter(isDrainableCron))
    }
  }
  return crons
}

export interface DrainCronsOptions {
  budgetMs?: number
  log: Logger
}

/**
 * Minden cron leállítása (új job már nem indul), majd várakozás, amíg a futók
 * befejeződnek, legfeljebb `budgetMs`-ig. Egy futó job megszakítása rosszabb
 * volna: a Payload `processing: true`-n hagyná, és az ütemezés a
 * schedule-guardig állna (a-callback-2 (b)).
 */
export async function drainCrons(
  crons: DrainableCron[],
  options: DrainCronsOptions,
): Promise<{ stopped: number; stillBusy: number }> {
  const budgetMs = options.budgetMs ?? SHUTDOWN_CRON_DRAIN_BUDGET_MS
  for (const cron of crons) {
    try {
      cron.stop()
    } catch (error) {
      options.log.warn('leállás: egy cron leállítása hibát adott', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const deadline = Date.now() + budgetMs
  let busy = crons.filter((cron) => cron.isBusy()).length
  while (busy > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_INTERVAL_MS))
    busy = crons.filter((cron) => cron.isBusy()).length
  }
  if (busy > 0) {
    options.log.error(
      'RIASZTÁS: leállás közben a várakozási keret alatt sem fejeződött be minden job — a ' +
        'megszakított job sorát a schedule-guard később lezárja; ha számlázás futott, ' +
        'ellenőrizd a rendelés számlaállapotát.',
      { stillBusy: busy, budgetMs },
    )
  } else {
    options.log.info('leállás: a Payload-cronok leálltak, futó job nincs', {
      stopped: crons.length,
    })
  }
  return { stopped: crons.length, stillBusy: busy }
}

/** A folyamat itt használt felülete (tesztben EventEmitter-alapú álfolyamat). */
export interface ShutdownProcess {
  once(event: 'SIGTERM', listener: () => void): unknown
  exit: (code?: number) => never
}

export interface InstallShutdownDrainOptions {
  log: Logger
  proc?: ShutdownProcess
  getCrons?: () => DrainableCron[]
  budgetMs?: number
}

/**
 * SIGTERM-kezelő: leállítja a Payload-cronokat, és a keretig kivárja a futó
 * jobot.
 *
 * Miért kell a `process.exit` visszatartása: a `next start` a saját
 * SIGTERM-kezelőjében a szerver bezárása és az `after()`-feladatok lefutása
 * után `process.exit(143)`-at hív (next/dist/server/lib/start-server.js), a
 * Payload-cronokról nem tud. A mi kezelőnk ezért a SIGTERM után a
 * `process.exit`-et addig tartja vissza, amíg a cronok le nem futottak (vagy a
 * keret le nem telt), utána a Next kérte kilépési kóddal lép ki. A visszatartás
 * csak SIGTERM után él, és csak egyszer települ.
 */
export function installShutdownDrain(options: InstallShutdownDrainOptions): void {
  const proc = options.proc ?? (process as unknown as ShutdownProcess)
  const getCrons = options.getCrons ?? readPayloadCrons
  proc.once('SIGTERM', () => {
    const originalExit = proc.exit
    let drained = false
    let exitRequested = false
    let requestedCode: number | undefined
    proc.exit = ((code?: number) => {
      if (drained) {
        return originalExit.call(proc, code)
      }
      exitRequested = true
      requestedCode = code
      return undefined as never
    }) as ShutdownProcess['exit']
    options.log.info('leállás: SIGTERM — a Payload-cronok leállítása és a futó jobok kivárása')
    void drainCrons(getCrons(), {
      log: options.log,
      ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
    })
      .catch((error: unknown) => {
        options.log.error('leállás: a cronok lefolyatása hibával állt le', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        drained = true
        proc.exit = originalExit
        if (exitRequested) {
          originalExit.call(proc, requestedCode)
        }
      })
  })
}
