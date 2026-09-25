import type { Instrumentation } from 'next'

/**
 * Next.js instrumentation: riasztás-csatorna, server_start napló (commitSha,
 * nodeVersion), majd assertRequiredEnv.
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
