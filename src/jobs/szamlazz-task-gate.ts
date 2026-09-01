import { getSzamlazzConfig, isSzamlazzEnabled } from '../lib/szamlazz'
import { logger } from '../lib/logger'

/**
 * A számla / stornó / helyesbítő jobok belépőkapuja.
 *
 * MIÉRT KÜLÖN FÜGGVÉNY (2026-08-28, R-04). A `getSzamlazzConfig()` DOBHAT:
 * agent-kulcs van, de a `SZAMLAZZ_AFAKULCS` hiányzik, vagy az API-URL érvénytelen.
 * A három task korábban EZT hívta a no-op ág eldöntésére — a dobás a
 * Payload job-runnerben piros taskot és 3 fölösleges retryt adott, még mielőtt
 * a disabled/no-op ág lefutott volna. A fizetés addigra megvolt, a számla
 * pipeline csendben halott.
 *
 * Sorrend:
 * 1. `isSzamlazzEnabled()` — SOSEM dob; nincs kulcs → disabled no-op.
 * 2. `getSzamlazzConfig()` try/catch — fél-lábas konfig → failed kimenet,
 *    NINCS throw (a job nem dől el, a poll resweep a konfig javítása után
 *    újra sorba állíthat).
 *
 * A job `reason` mezője szándékosan általános (nincs URL, nincs kulcs).
 * A technikai üzenet csak a naplóba megy, `error` kulccsal.
 */

export const SZAMLAZZ_TASK_CONFIG_FAILED_REASON = 'a Számlázz.hu-konfiguráció hibás'

export type SzamlazzTaskGate =
  | { kind: 'disabled' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ready' }

export function resolveSzamlazzTaskGate(taskSlug: string): SzamlazzTaskGate {
  if (!isSzamlazzEnabled()) {
    logger.debug(`${taskSlug}: a Számlázz.hu-integráció kikapcsolva (nincs agent-kulcs) — no-op`)
    return { kind: 'disabled' }
  }

  try {
    if (!getSzamlazzConfig().enabled) {
      logger.debug(`${taskSlug}: a Számlázz.hu-integráció ki van kapcsolva — no-op`)
      return { kind: 'disabled' }
    }
    return { kind: 'ready' }
  } catch (error) {
    logger.error(
      `RIASZTÁS: ${taskSlug}: a Számlázz.hu-konfiguráció hibás — a task nem POSTol, ` +
        'a job failed kimenettel zárul. Ellenőrizd a SZAMLAZZ_AFAKULCS és a SZAMLAZZ_API_URL értékét.',
      { error: error instanceof Error ? error.message : String(error) },
    )
    return { kind: 'failed', reason: SZAMLAZZ_TASK_CONFIG_FAILED_REASON }
  }
}
