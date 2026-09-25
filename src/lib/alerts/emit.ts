import type { LogContext, Logger } from '../logger'

/**
 * Riasztás kiírása strukturált kóddal.
 *
 * Az error-sor a context-ben `alert: true`-t és `alertCode`-ot kap; a logger
 * ebből a sor legfelső szintjére emeli a kettőt (Railway-szűrő:
 * `@alert:true`, `@alertCode:<kód>`), a regisztrált riasztás-csatorna pedig
 * e-mailt és PostHog-eseményt küld belőle (`src/lib/alerts/sink.ts`).
 *
 * Tiszta segédlet (csak a logger típusait használja), így bármelyik szerver-
 * oldali modulból hívható. A „RIASZTÁS:" előtagú régi hívóhelyek kód nélkül
 * is riasztanak; az új hívóhelyek ezt használják, hogy a kód stabil legyen.
 */
export function emitAlert(
  log: Logger,
  alertCode: string,
  msg: string,
  context: LogContext = {},
): void {
  log.error(msg, { ...context, alert: true, alertCode })
}
