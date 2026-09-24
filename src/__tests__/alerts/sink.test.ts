import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../../lib/alert-throttle'
import { installAlertSink } from '../../lib/alerts/install'
import {
  alertIdempotencyKey,
  ALERT_POSTHOG_EVENT,
  parseAlertRecipients,
} from '../../lib/alerts/mail'
import {
  ALERT_MAIL_COOLDOWN_MS,
  createAlertSink,
  MAX_ALERT_MAILS_PER_HOUR,
  type AlertSinkDeps,
} from '../../lib/alerts/sink'
import type { SendMailInput } from '../../lib/email'
import type { SendResult } from '../../lib/email/types'
import type { PostHogCapture } from '../../lib/feedback/posthog-capture'
import {
  createLogger,
  hasAlertSink,
  setAlertSink,
  type LogContext,
  type Logger,
} from '../../lib/logger'

/**
 * A riasztás-csatorna: fojtott owner-levél (Resend-idempotenciakulccsal) és
 * PII-mentes PostHog `kc_alert` esemény, injektált levél- és PostHog-hívóval.
 * Valódi hálózati hívás egyik tesztben sincs (CLAUDE.md 15. tanulság).
 */

const NOW = Date.parse('2026-09-24T10:15:00Z')

interface Recorded {
  level: string
  msg: string
  context?: LogContext
}

function recordingLogger(entries: Recorded[]): Logger {
  const logger: Logger = {
    debug: (msg, context) => entries.push({ level: 'debug', msg, context }),
    info: (msg, context) => entries.push({ level: 'info', msg, context }),
    warn: (msg, context) => entries.push({ level: 'warn', msg, context }),
    error: (msg, context) => entries.push({ level: 'error', msg, context }),
    child: () => logger,
  }
  return logger
}

function harness(overrides: Partial<AlertSinkDeps> = {}) {
  const clock = { now: NOW }
  const mails: SendMailInput[] = []
  const events: Array<{ event: string; distinctId: string; properties: Record<string, unknown> }> =
    []
  const sinkLog: Recorded[] = []
  const sendMail = vi.fn(async (input: SendMailInput): Promise<SendResult> => {
    mails.push(input)
    return { ok: true, provider: 'resend', id: 'm1' }
  })
  const capture: PostHogCapture = vi.fn(async (event, distinctId, properties) => {
    events.push({ event, distinctId, properties: { ...properties } })
    return { allapot: 'rogzitve' as const }
  })
  const handle = createAlertSink({
    sendMail,
    capture,
    recipients: () => ['tulajdonos@example.com'],
    logger: recordingLogger(sinkLog),
    now: () => clock.now,
    environment: 'production',
    ...overrides,
  })
  setAlertSink(handle.sink)
  return { clock, mails, events, sinkLog, sendMail, capture, handle }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  setAlertSink(undefined)
  resetAlertThrottle()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('riasztás-csatorna — levél', () => {
  it('a riasztás a hívó után, aszinkron megy ki: a hívás nem vár a levélre', async () => {
    const h = harness()
    createLogger().error('RIASZTÁS: teszt riasztás')
    // A logger szinkron visszatért, a küldés még nem indult el.
    expect(h.sendMail).not.toHaveBeenCalled()
    await h.handle.flush()
    expect(h.sendMail).toHaveBeenCalledTimes(1)
  })

  it('levél a címzettnek, a tárgyban a riasztás, idempotenciakulccsal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const h = harness()
    createLogger({ module: 'order-poll' })
      .child({ orderId: 12, orderNumber: 'KH-2026-000012' })
      .error('RIASZTÁS: tartós refund ellenőrzésre vár — a sor forgatható')
    await h.handle.flush()

    expect(h.mails).toHaveLength(1)
    const mail = h.mails[0]
    expect(mail?.to).toEqual(['tulajdonos@example.com'])
    expect(mail?.subject).toBe(
      'Kineticare riasztás: tartós refund ellenőrzésre vár — a sor forgatható',
    )
    expect(mail?.idempotencyKey).toBe(alertIdempotencyKey('refund-ellenorzesre-var', NOW))
    expect(mail?.idempotencyKey).toBe('kc-riasztas-refund-ellenorzesre-var-2026-09-24T10')
    expect(mail?.text).toContain('Rendelésszám: KH-2026-000012')
    expect(mail?.text).toContain('@alertCode:refund-ellenorzesre-var')
    expect(mail?.text).toContain('2026. 09. 24. 12:15 (magyar idő)')
    vi.useRealTimers()
  })

  it('ugyanarra a kódra óránként legfeljebb egy levél; a következő jelzi az elnyelt ismétléseket', async () => {
    const h = harness()
    const log = createLogger()
    log.error('RIASZTÁS: ismétlődő hiba')
    await h.handle.flush()
    h.clock.now = NOW + 5 * 60_000
    log.error('RIASZTÁS: ismétlődő hiba')
    h.clock.now = NOW + 10 * 60_000
    log.error('RIASZTÁS: ismétlődő hiba')
    await h.handle.flush()
    expect(h.mails).toHaveLength(1)

    h.clock.now = NOW + ALERT_MAIL_COOLDOWN_MS
    log.error('RIASZTÁS: ismétlődő hiba')
    await h.handle.flush()
    expect(h.mails).toHaveLength(2)
    expect(h.mails[1]?.text).toContain('Az előző levél óta még 2 alkalommal jelentkezett.')
  })

  it('más kód külön levelet kap ugyanabban az órában', async () => {
    const h = harness()
    const log = createLogger()
    log.error('RIASZTÁS: egyik hiba')
    log.error('RIASZTÁS: másik hiba')
    await h.handle.flush()
    expect(h.mails.map((mail) => mail.subject)).toEqual([
      'Kineticare riasztás: egyik hiba',
      'Kineticare riasztás: másik hiba',
    ])
  })

  it('sikertelen küldés után a kód nem némul el: a következő előfordulás újrapróbálja', async () => {
    let fail = true
    const sendMail = vi.fn(async (): Promise<SendResult> => {
      if (fail) {
        return { ok: false, provider: 'resend', retryable: true, error: 'HTTP 503' }
      }
      return { ok: true, provider: 'resend' }
    })
    const h = harness({ sendMail })
    const log = createLogger()
    log.error('RIASZTÁS: hiba')
    await h.handle.flush()
    expect(h.sinkLog.some((entry) => entry.msg.includes('nem ment ki'))).toBe(true)
    fail = false
    h.clock.now = NOW + 60_000
    log.error('RIASZTÁS: hiba')
    await h.handle.flush()
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('OWNER_ALERT_EMAILS nélkül nincs levél, egyszer figyelmeztet, a PostHog-esemény megy', async () => {
    const h = harness({ recipients: () => [] })
    const log = createLogger()
    log.error('RIASZTÁS: első')
    log.error('RIASZTÁS: második')
    await h.handle.flush()
    expect(h.sendMail).not.toHaveBeenCalled()
    expect(h.sinkLog.filter((entry) => entry.msg.includes('OWNER_ALERT_EMAILS'))).toHaveLength(1)
    expect(h.events).toHaveLength(2)
  })

  it('hibaviharban folyamatonként óránként legfeljebb a plafonnyi levél megy ki', async () => {
    const h = harness()
    const log = createLogger()
    for (let index = 0; index < MAX_ALERT_MAILS_PER_HOUR + 5; index += 1) {
      log.error(`RIASZTÁS: vihar ${String.fromCharCode(97 + (index % 26))}${String(index)}`)
    }
    await h.handle.flush()
    expect(h.mails).toHaveLength(MAX_ALERT_MAILS_PER_HOUR)
  })

  it('a levél küldése közben írt riasztás-sor nem indít újabb küldést (nincs rekurzió)', async () => {
    const inner = createLogger({ module: 'email' })
    const sendMail = vi.fn(async (): Promise<SendResult> => {
      inner.error('RIASZTÁS: a levélküldés maga is hibát ír')
      return { ok: false, provider: 'resend', retryable: false, error: 'x' }
    })
    const h = harness({ sendMail })
    createLogger().error('RIASZTÁS: eredeti')
    await h.handle.flush()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('riasztás-csatorna — PostHog', () => {
  it('kc_alert esemény, csak a biztonságos mezőkkel (személyes adat nélkül)', async () => {
    const h = harness()
    createLogger({ requestId: 'req-9', module: 'barion-callback' })
      .child({ orderNumber: 'KH-2026-000031', customerId: 55 })
      .error('RIASZTÁS: vendég-fizetés staff fiókra — kötés elutasítva', {
        cimzett: 'v***@example.com',
        role: 'owner',
        httpStatus: 409,
        detail: 'összeg eltér: vevő@example.com',
      })
    await h.handle.flush()

    expect(h.events).toHaveLength(1)
    const event = h.events[0]
    expect(event?.event).toBe(ALERT_POSTHOG_EVENT)
    expect(event?.distinctId).toBe('kineticare-szerver')
    expect(event?.properties).toMatchObject({
      alertCode: 'vendeg-fizetes-staff-fiokra',
      orderNumber: 'KH-2026-000031',
      requestId: 'req-9',
      module: 'barion-callback',
      httpStatus: 409,
      environment: 'production',
      $process_person_profile: false,
    })
    const serialized = JSON.stringify(event?.properties)
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('customerId')
    expect(serialized).not.toContain('cimzett')
    expect(serialized).not.toContain('role')
    // A levélben sem jelenik meg személyes adat.
    expect(h.mails[0]?.text).not.toContain('example.com')
  })

  it('az üzenetben szereplő e-mail-cím a levélből kitakarva', async () => {
    const h = harness()
    createLogger().error('RIASZTÁS: hiba a vevo@example.com címmel')
    await h.handle.flush()
    expect(h.mails[0]?.text).toContain('[e-mail-cím]')
    expect(h.mails[0]?.text).not.toContain('vevo@example.com')
    expect(h.mails[0]?.subject).not.toContain('vevo@example.com')
  })

  it('a PostHog hibája nem akadályozza a levelet (független csatornák)', async () => {
    const h = harness({
      capture: vi.fn(async () => ({ allapot: 'hiba' as const, ok: 'HTTP 500' })),
    })
    createLogger().error('RIASZTÁS: teszt')
    await h.handle.flush()
    expect(h.mails).toHaveLength(1)
    expect(h.sinkLog.some((entry) => entry.msg.includes('PostHog'))).toBe(true)
  })
})

describe('címzettek és bekötés', () => {
  it('az OWNER_ALERT_EMAILS vesszővel, pontosvesszővel vagy szóközzel tagolt, az érvénytelen kimarad', () => {
    expect(parseAlertRecipients('a@x.hu, b@y.hu;c@z.hu  nem-cim a@x.hu')).toEqual([
      'a@x.hu',
      'b@y.hu',
      'c@z.hu',
    ])
    expect(parseAlertRecipients(undefined)).toEqual([])
    expect(parseAlertRecipients('')).toEqual([])
  })

  it('Next-szerveren kívül (teszt, CLI, build) nem kapcsol be', () => {
    expect(installAlertSink({ env: {} })).toBeNull()
    expect(
      installAlertSink({ env: { NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-build' } }),
    ).toBeNull()
    expect(hasAlertSink()).toBe(false)
  })

  it('Next-szerveren egyszer kapcsol be, a második hívás nem cseréli le', async () => {
    const sendMail = vi.fn(async (): Promise<SendResult> => ({ ok: true, provider: 'resend' }))
    const capture: PostHogCapture = vi.fn(async () => ({ allapot: 'rogzitve' as const }))
    const handle = installAlertSink({
      env: { NEXT_RUNTIME: 'nodejs', OWNER_ALERT_EMAILS: 'owner@example.com' },
      deps: { sendMail, capture, logger: recordingLogger([]) },
    })
    expect(handle).not.toBeNull()
    expect(hasAlertSink()).toBe(true)
    expect(installAlertSink({ env: { NEXT_RUNTIME: 'nodejs' } })).toBeNull()

    createLogger().error('RIASZTÁS: bekötés teszt')
    await handle?.flush()
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ['owner@example.com'] }))
  })
})
