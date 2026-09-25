import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requiredEnvVars } from '../../env'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { installAlertSink } from '../../lib/alerts/install'
import type { SendMailInput } from '../../lib/email'
import type { SendResult } from '../../lib/email/types'
import { hasAlertSink, setAlertSink } from '../../lib/logger'

/**
 * Codex P2 (PR #305, order-poll.ts:22): az induláskori RIASZTÁS-sor (itt:
 * bekapcsolt számlázás SZAMLAZZ_AFAKULCS nélkül) a tulajdonos levelébe is
 * eljusson. A csatorna eddig csak az order-poll modul betöltésekor kapcsolt
 * be, az env-ellenőrzés viszont a `register()`-ben, előtte fut.
 *
 * A levél- és a PostHog-hívó mock; a globális `fetch` hangosan dob, hogy
 * valódi hálózati hívás ne mehessen ki (CLAUDE.md 15. tanulság). Minden
 * titkot helyettesítő érték egyértelműen DUMMY.
 */

const { sendMailMock, captureMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn<(input: SendMailInput) => Promise<SendResult>>(async () => ({
    ok: true,
    provider: 'resend',
    id: 'riasztas-1',
  })),
  captureMock: vi.fn(async () => ({ allapot: 'rogzitve' as const })),
}))

vi.mock('../../lib/email', () => ({ sendMail: sendMailMock }))
vi.mock('../../lib/feedback/posthog-capture', () => ({
  createPostHogCapture: () => captureMock,
}))

const DUMMY_ENV_VALUE = 'DUMMY-42'

beforeEach(() => {
  setAlertSink(undefined)
  sendMailMock.mockClear()
  captureMock.mockClear()
  vi.stubGlobal('fetch', () => {
    throw new Error('valódi hálózati hívás tesztből tilos')
  })
  for (const key of requiredEnvVars) {
    vi.stubEnv(key, DUMMY_ENV_VALUE)
  }
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://dummy.example')
  vi.stubEnv('BARION_API_URL', 'https://api.test.barion.com')
  vi.stubEnv('BARION_POSKEY_TEST', '00000000-0000-0000-0000-000000000000')
  vi.stubEnv('RESEND_API_KEY', undefined)
  vi.stubEnv('SMTP_HOST', undefined)
  vi.stubEnv('SZAMLAZZ_AGENT_KEY', DUMMY_ENV_VALUE)
  vi.stubEnv('SZAMLAZZ_AFAKULCS', undefined)
  vi.stubEnv('OWNER_ALERT_EMAILS', 'tulajdonos@example.com')
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  vi.stubEnv('NEXT_PHASE', undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  setAlertSink(undefined)
  resetAlertThrottle()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('instrumentation.register: riasztás-csatorna az env-ellenőrzés előtt', () => {
  it('az induláskori RIASZTÁS levélben is kimegy, és az order-poll nem köt be második csatornát', async () => {
    const { register } = await import('../../instrumentation')
    await register()

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1))
    const mail = sendMailMock.mock.calls[0]?.[0]
    expect(mail?.to).toEqual(['tulajdonos@example.com'])
    expect(mail?.text).toContain('SZAMLAZZ_AFAKULCS nincs beállítva')

    // Az order-poll modul betöltéskori hívása: a csatorna már él, új nem jön létre.
    expect(hasAlertSink()).toBe(true)
    expect(installAlertSink()).toBeNull()
  })
})
