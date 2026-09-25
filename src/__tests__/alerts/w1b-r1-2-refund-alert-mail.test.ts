import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { fixture, provider } from '../refund-fixture'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { createAlertSink } from '../../lib/alerts/sink'
import { BarionApiError } from '../../lib/barion'
import type { SendMailInput } from '../../lib/email'
import type { SendResult } from '../../lib/email/types'
import type { PostHogCapture } from '../../lib/feedback/posthog-capture'
import { createLogger, setAlertSink, type Logger } from '../../lib/logger'
import { refundOrder } from '../../lib/refund/refund-order'

/**
 * A tulajdonosi visszatérítés két riasztásának levele (W1B-10). A levél és a
 * PostHog-esemény csak az engedélyezett skaláris mezőket viszi tovább
 * (alerts/mail.ts), ezért a Barion-hibakódnak és az összegeknek az üzenet
 * szövegében kell állniuk. A valódi refundOrder a valódi loggerrel ír, a
 * riasztás-csatorna injektált levélküldővel fut (sink.test.ts mintája).
 */

function sinkHarness() {
  const mails: SendMailInput[] = []
  const sendMail = vi.fn(async (input: SendMailInput): Promise<SendResult> => {
    mails.push(input)
    return { ok: true, provider: 'resend', id: 'SYNTHETIC-ALERT' }
  })
  const capture: PostHogCapture = vi.fn(async () => ({ allapot: 'rogzitve' as const }))
  const quiet: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => quiet,
  }
  const handle = createAlertSink({
    sendMail,
    capture,
    recipients: () => ['tulajdonos@example.com'],
    logger: quiet,
    now: () => Date.parse('2026-09-24T10:15:00Z'),
    environment: 'production',
  })
  setAlertSink(handle.sink)
  return { mails, handle }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  setAlertSink(undefined)
  resetAlertThrottle()
  vi.restoreAllMocks()
})

function start(f: ReturnType<typeof fixture>, input: Record<string, unknown> = {}) {
  return refundOrder({
    ...f.options,
    input: { operationKey: 'A'.repeat(43), ...input },
    requestId: 'SYNTHETIC-REQ-0001',
    logger: createLogger({ module: 'refund' }),
  })
}

describe('a visszatérítési riasztás levele önmagában is megmondja az okot', () => {
  it('Barion-elutasítás: a levélben a Barion-hibakód és az összeg', async () => {
    const h = sinkHarness()
    const f = fixture()
    provider.refund.mockRejectedValueOnce(
      new BarionApiError({
        kind: 'http',
        message: 'SYNTHETIC',
        endpoint: 'POST /v2/Payment/Refund',
        httpStatus: 400,
        providerErrors: [
          { ErrorCode: 'TooLowBalanceToMakeRefund', Title: 'SYNTHETIC', Description: 'SYNTHETIC' },
        ],
      }),
    )
    await expect(start(f)).rejects.toMatchObject({ status: 409 })
    await h.handle.flush()
    const mail = h.mails.find((item) => item.text.includes('visszaterites-barion-elutasitotta'))
    expect(mail?.text).toContain('TooLowBalanceToMakeRefund')
    expect(mail?.text).toMatch(/20\s000\sFt/u)
  })

  it('K17 eltérés: a levélben a Barion szerinti és a rendelés szerinti visszatérített összeg', async () => {
    const h = sinkHarness()
    const f = fixture()
    f.barionRefunds.push({
      TransactionId: 'cccccccc-bbbb-cccc-dddd-000000000009',
      POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
      TransactionType: 'RefundToBankCard',
      Status: 'Succeeded',
      Total: 5000,
      RelatedId: 'SYNTHETIC-TX',
    })
    await expect(start(f, { amountHuf: 5000 })).rejects.toMatchObject({ status: 409 })
    await h.handle.flush()
    const mail = h.mails.find((item) => item.text.includes('visszaterites-barion-elteres'))
    // A hu-HU formázás négy jegyig nem tagol (5000 Ft), onnan szóközzel (20 000 Ft).
    expect(mail?.text).toMatch(/a Barion szerint 5000\sFt/u)
    expect(mail?.text).toMatch(/a rendelés szerint 0\sFt ment vissza/u)
  })
})
