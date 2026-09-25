/**
 * Riasztás-csatorna: a logger riasztás-sorait (lásd `src/lib/logger.ts`)
 * a tulajdonoshoz juttatja.
 *
 * MIÉRT. Élesben minden RIASZTÁS csak a Railway stdout-naplójában élt: a
 * Railway-nek nincs log drain-je és élesítés után nem figyeli a
 * healthcheck-et, a PostHog-projektben pedig egyetlen riasztás sincs
 * beállítva (a-riasztas-1, a-callback-4). Egy fizetési, számlázási vagy
 * visszatérítési hiba így csak panaszból derült ki.
 *
 * MIT CSINÁL, egymástól függetlenül:
 *  1. E-mail a `OWNER_ALERT_EMAILS` címre a meglévő `sendMail`-lel.
 *     Riasztáskódonként legfeljebb óránként egy levél (a meglévő
 *     `alert-throttle` kulcsán), Resend-idempotenciakulccsal, és
 *     folyamatonként óránként legfeljebb `MAX_ALERT_MAILS_PER_HOUR` levél,
 *     hogy egy hibavihar ne árassza el a postafiókot és a Resend-keretet.
 *  2. PostHog `kc_alert` esemény a meglévő szerver-szerver capture-rel,
 *     kódonként percenként legfeljebb egy. Ez a második, független csatorna:
 *     ha a levél nem megy ki, a PostHog-trendre állított e-mailes riasztás
 *     még szól (a hibakövetés riasztásainak nincs e-mail-csatornája,
 *     https://posthog.com/docs/error-tracking/alerts).
 *  A harmadik csatorna maga a naplósor `alert: true` és `alertCode` mezővel,
 *  ezt a logger írja ki.
 *
 * SOHA NEM DOB a hívó felé, és nem rekurzál: a küldés aszinkron, egy
 * `AsyncLocalStorage`-jelölt kontextusban fut, és ebben a kontextusban
 * keletkező újabb riasztás-sort (pl. ha egy jövőbeli `sendMail` error-szinten
 * naplózna) a csatorna nem küld tovább. A csatorna saját naplósorai legfeljebb
 * warn szintűek.
 *
 * HIÁNYZÓ BEÁLLÍTÁS. `OWNER_ALERT_EMAILS` nélkül a levél kimarad, és ezt
 * folyamatonként EGYSZER jelezzük (warn); a PostHog-kulcs hiánya ugyanígy.
 * Összeomlás egyik esetben sincs. Ha van címzett, de nincs e-mail-szolgáltató
 * (se `RESEND_API_KEY`, se `SMTP_HOST`), a levélmodul noop-szolgáltatója
 * `{ ok: true, provider: 'noop' }`-t ad, holott semmi nem ment ki (PR #305,
 * Codex): ezt NEM vesszük kézbesítésnek. A kód nem némul el egy órára, az
 * elnyelt ismétlések száma megmarad, a próba után a levélplafon helye
 * felszabadul, és a hiányt naponta egyszer jelezzük (warn).
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import { releaseThrottledAlert, shouldEmitThrottledAlert } from '../alert-throttle'
import type { SendMailInput } from '../email'
import type { SendResult } from '../email/types'
import type { PostHogCapture } from '../feedback/posthog-capture'
import type { AlertLogEntry, AlertSink, Logger } from '../logger'
import {
  ALERT_POSTHOG_DISTINCT_ID,
  ALERT_POSTHOG_EVENT,
  alertIdempotencyKey,
  alertPostHogProperties,
  buildAlertMail,
  summarizeAlert,
  type AlertSummary,
} from './mail'

/** Ugyanarra a riasztáskódra legfeljebb ennyi időnként megy levél. */
export const ALERT_MAIL_COOLDOWN_MS = 60 * 60 * 1000

/** Ugyanarra a riasztáskódra legfeljebb ennyi időnként megy PostHog-esemény. */
export const ALERT_POSTHOG_COOLDOWN_MS = 60 * 1000

/** Folyamatonként óránként legfeljebb ennyi riasztás-levél (vihar-plafon). */
export const MAX_ALERT_MAILS_PER_HOUR = 20

const HOUR_MS = 60 * 60 * 1000

/** A hiányzó e-mail-szolgáltatóról legfeljebb ennyi időnként szólunk. */
export const MAIL_PROVIDER_MISSING_WARN_MS = 24 * HOUR_MS

/** A csatorna saját naplósorainak modulneve; ezeket soha nem küldjük tovább. */
export const ALERT_SINK_MODULE = 'alerts'

export interface AlertSinkDeps {
  readonly sendMail: (input: SendMailInput) => Promise<SendResult>
  readonly capture: PostHogCapture
  /** A címzettek (az OWNER_ALERT_EMAILS feldolgozva); küldéskor olvassuk. */
  readonly recipients: () => readonly string[]
  readonly logger: Logger
  readonly now?: () => number
  /** A PostHog-eseménybe írt környezetnév (pl. production). */
  readonly environment?: string
}

export interface AlertSinkHandle {
  readonly sink: AlertSink
  /** Megvárja a folyamatban lévő küldéseket (teszthez és leállításhoz). */
  readonly flush: () => Promise<void>
}

const dispatchContext = new AsyncLocalStorage<true>()

/** Riasztás-küldés kontextusában fut-e a hívó (rekurzió-őr). */
export function isInsideAlertDispatch(): boolean {
  return dispatchContext.getStore() === true
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createAlertSink(deps: AlertSinkDeps): AlertSinkHandle {
  const now = deps.now ?? (() => Date.now())
  const log = deps.logger.child({ module: ALERT_SINK_MODULE })
  const pending = new Set<Promise<void>>()
  const suppressedByCode = new Map<string, number>()
  const mailTimestamps: number[] = []
  let recipientsWarned = false
  let postHogSkipWarned = false
  let mailCapWarnedAt: number | null = null
  let providerMissingWarnedAt: number | null = null

  async function sendPostHog(summary: AlertSummary, nowMs: number): Promise<void> {
    if (
      !shouldEmitThrottledAlert(
        `riasztas-posthog:${summary.alertCode}`,
        ALERT_POSTHOG_COOLDOWN_MS,
        nowMs,
      )
    ) {
      return
    }
    try {
      const result = await deps.capture(
        ALERT_POSTHOG_EVENT,
        ALERT_POSTHOG_DISTINCT_ID,
        alertPostHogProperties(summary, deps.environment),
      )
      if (result.allapot === 'hiba') {
        log.warn('riasztás: a PostHog-esemény nem ment ki', {
          alertCode: summary.alertCode,
          ok: result.ok,
        })
      } else if (result.allapot === 'kihagyva' && !postHogSkipWarned) {
        postHogSkipWarned = true
        log.warn('riasztás: a PostHog-csatorna nincs beállítva, a riasztás ott nem jelenik meg', {
          ok: result.ok,
        })
      }
    } catch (error) {
      log.warn('riasztás: a PostHog-esemény nem ment ki', {
        alertCode: summary.alertCode,
        ok: errorText(error),
      })
    }
  }

  function mailCapReached(nowMs: number): boolean {
    while (mailTimestamps.length > 0 && nowMs - (mailTimestamps[0] ?? nowMs) >= HOUR_MS) {
      mailTimestamps.shift()
    }
    return mailTimestamps.length >= MAX_ALERT_MAILS_PER_HOUR
  }

  async function sendAlertMail(summary: AlertSummary, nowMs: number): Promise<void> {
    const recipients = deps.recipients()
    if (recipients.length === 0) {
      if (!recipientsWarned) {
        recipientsWarned = true
        log.warn(
          'riasztás: az OWNER_ALERT_EMAILS nincs beállítva, riasztás-levél nem megy ki (a naplósor és a PostHog-esemény megmarad)',
          { alertCode: summary.alertCode },
        )
      }
      return
    }
    const throttleKey = `riasztas-level:${summary.alertCode}`
    if (!shouldEmitThrottledAlert(throttleKey, ALERT_MAIL_COOLDOWN_MS, nowMs)) {
      suppressedByCode.set(summary.alertCode, (suppressedByCode.get(summary.alertCode) ?? 0) + 1)
      return
    }
    if (mailCapReached(nowMs)) {
      releaseThrottledAlert(throttleKey)
      suppressedByCode.set(summary.alertCode, (suppressedByCode.get(summary.alertCode) ?? 0) + 1)
      if (mailCapWarnedAt === null || nowMs - mailCapWarnedAt >= HOUR_MS) {
        mailCapWarnedAt = nowMs
        log.warn('riasztás: az óránkénti levélplafon betelt, a további riasztás-levél vár', {
          maxPerHour: MAX_ALERT_MAILS_PER_HOUR,
        })
      }
      return
    }
    mailTimestamps.push(nowMs)
    const suppressed = suppressedByCode.get(summary.alertCode) ?? 0
    suppressedByCode.delete(summary.alertCode)
    const mail = buildAlertMail(summary, suppressed)
    let result: SendResult
    try {
      result = await deps.sendMail({
        to: [...recipients],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: alertIdempotencyKey(summary.alertCode, nowMs),
      })
    } catch (error) {
      result = { ok: false, provider: 'noop', retryable: true, error: errorText(error) }
    }
    if (result.ok && result.provider === 'noop') {
      // Nincs e-mail-szolgáltató: semmi nem ment ki. A kód nem némul el, az
      // elnyelt ismétlések száma megmarad, és a foglalt helyet a levélplafon
      // visszakapja (a plafon a valódi leveleké).
      releaseThrottledAlert(throttleKey)
      suppressedByCode.set(summary.alertCode, suppressed)
      const slot = mailTimestamps.lastIndexOf(nowMs)
      if (slot >= 0) {
        mailTimestamps.splice(slot, 1)
      }
      if (
        providerMissingWarnedAt === null ||
        nowMs - providerMissingWarnedAt >= MAIL_PROVIDER_MISSING_WARN_MS
      ) {
        providerMissingWarnedAt = nowMs
        log.warn(
          'riasztás: nincs e-mail-szolgáltató beállítva (RESEND_API_KEY vagy SMTP_HOST), riasztás-levél nem megy ki (a naplósor és a PostHog-esemény megmarad)',
          { alertCode: summary.alertCode },
        )
      }
      return
    }
    if (!result.ok) {
      // A kiesett levél ne némítsa el a kódot egy órára: a következő
      // előfordulás újra próbálkozik (a vihar-plafon továbbra is véd).
      releaseThrottledAlert(throttleKey)
      suppressedByCode.set(summary.alertCode, suppressed)
      log.warn('riasztás: a riasztás-levél nem ment ki', {
        alertCode: summary.alertCode,
        retryable: result.retryable ?? null,
      })
      return
    }
    log.info('riasztás: levél elküldve', {
      alertCode: summary.alertCode,
      recipientCount: recipients.length,
    })
  }

  async function dispatch(summary: AlertSummary): Promise<void> {
    const nowMs = now()
    await Promise.all([sendPostHog(summary, nowMs), sendAlertMail(summary, nowMs)])
  }

  const sink: AlertSink = (entry: AlertLogEntry) => {
    if (isInsideAlertDispatch() || entry.bindings.module === ALERT_SINK_MODULE) {
      return
    }
    const summary = summarizeAlert(entry)
    const task = dispatchContext.run(true, () =>
      Promise.resolve()
        .then(() => dispatch(summary))
        .catch((error: unknown) => {
          log.warn('riasztás: a riasztás továbbítása hibára futott', {
            alertCode: summary.alertCode,
            ok: errorText(error),
          })
        }),
    )
    pending.add(task)
    void task.finally(() => {
      pending.delete(task)
    })
  }

  return {
    sink,
    flush: async () => {
      while (pending.size > 0) {
        await Promise.all([...pending])
      }
    },
  }
}
