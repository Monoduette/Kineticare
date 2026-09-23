import type { Instrumentation } from 'next'

/**
 * Next.js instrumentation: server_start napló (commitSha, nodeVersion), majd assertRequiredEnv.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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
