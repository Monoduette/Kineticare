import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDatabaseAvailable } from './helpers/db-available'
import { captureOwnedPostgresBootstrap } from './helpers/owned-postgres-bootstrap'

/**
 * Valódi Payload forgotPassword → konfigurált auth-sablon → adapter → Resend JSON.
 * Csak a fetch határ helyettesített: nincs levélküldés vagy alkalmazásszerver.
 * A token és a levéltörzs kizárólag memóriában marad; az ellenőrzések logikai
 * értéket hasonlítanak, így egy bukott assertion sem írja ki őket.
 */
if (process.env.DATABASE_URI) {
  const target = new URL(process.env.DATABASE_URI)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !['/kineticare_ci', '/kineticare_pr207_validation'].includes(target.pathname)
  ) {
    throw new Error('Auth email integration requires the disposable localhost CI database')
  }
}
const hasDb = await isDatabaseAvailable()

interface CapturedMail {
  to: string[]
  html: string
  text: string
}

describe.skipIf(!hasDb)(
  'auth email flow (real Payload and PostgreSQL, captured Resend wire)',
  () => {
    const origin = 'https://auth-flow.example.test'
    const returnUrl = '/kurzusaim/2'
    const accountEmail = `dummy-auth-${randomUUID()}@example.test`
    const outbox: CapturedMail[] = []
    const logs: string[] = []
    let unexpectedRequests = 0
    let payload: Payload | undefined
    let userId: number | undefined
    let releaseBootstrap: (() => void) | undefined
    const adapter = () => payload!.db as unknown as PostgresAdapter

    beforeAll(async () => {
      vi.stubEnv('NEXT_PUBLIC_SERVER_URL', origin)
      vi.stubEnv('RESEND_API_KEY', 'DUMMY_AUTH_FLOW_NOT_A_REAL_API_KEY')
      vi.stubEnv('EMAIL_FROM', 'Kineticare <dummy-sender@example.test>')
      vi.stubEnv('ENABLE_JOB_WORKERS', 'false')
      vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
        if (input !== 'https://api.resend.com/emails' || init?.method !== 'POST') {
          unexpectedRequests += 1
          throw new Error('Auth email integration forbids unplanned network requests')
        }
        const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '{}')
        if (typeof body !== 'object' || body === null) {
          throw new Error('Auth email wire body must be an object')
        }
        const record = body as Record<string, unknown>
        if (
          !Array.isArray(record.to) ||
          !record.to.every((value): value is string => typeof value === 'string') ||
          typeof record.html !== 'string' ||
          typeof record.text !== 'string'
        ) {
          throw new Error('Auth email wire body is missing required message fields')
        }
        outbox.push({ to: record.to, html: record.html, text: record.text })
        return Response.json({ id: 'DUMMY_AUTH_FLOW_MESSAGE_ID' })
      })
      for (const method of ['log', 'info', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(' '))
        })
      }

      // Import a dummy provider/origin beállítása UTÁN: a plugin és a provider
      // induláskor rögzíti ezeket. A valódi alkalmazáskonfigurációt használjuk.
      const config = await (await import('../payload.config')).default
      payload = await new BasePayload().init({
        config: {
          ...config,
          telemetry: false,
          typescript: { ...config.typescript, autoGenerate: false },
          jobs: { ...config.jobs, autoRun: [] },
          db: {
            ...config.db,
            init(options) {
              const db = config.db.init(options) as unknown as PostgresAdapter
              releaseBootstrap = captureOwnedPostgresBootstrap(db)
              return db
            },
          },
        },
        disableOnInit: true,
      })
      // Saját dummy sor: nem indít első-user bootstrapet vagy importfolyamatot.
      const result = await adapter().pool.query<{ id: number }>(
        'INSERT INTO users (name, role, email, password_setup_pending) VALUES ($1, $2, $3, true) RETURNING id',
        ['DUMMY Auth Flow', 'customer', accountEmail],
      )
      userId = result.rows[0].id
    }, 60_000)

    beforeEach(() => {
      outbox.length = 0
      logs.length = 0
      unexpectedRequests = 0
    })

    afterAll(async () => {
      try {
        if (payload) {
          const pool = adapter().pool
          try {
            if (userId !== undefined) {
              await pool.query('DELETE FROM users WHERE id = $1', [userId])
            }
          } finally {
            await payload.destroy()
            releaseBootstrap?.()
            await pool.end()
          }
        }
      } finally {
        outbox.length = 0
        logs.length = 0
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
      }
    }, 60_000)

    it('a valódi token, az egyórás lejárat és a fiókcím megmarad a HTML/plain-text levélben', async () => {
      const before = Date.now()
      const token: unknown = await payload!.forgotPassword({
        collection: 'users',
        data: { email: ` ${accountEmail.toUpperCase()} ` },
        req: { data: { returnUrl } },
      })
      const after = Date.now()
      expect(typeof token === 'string' && /^[a-f0-9]{40}$/.test(token)).toBe(true)
      expect(unexpectedRequests).toBe(0)
      expect(outbox.length).toBe(1)
      const mail = outbox[0]
      expect(mail.to.length === 1 && mail.to[0] === accountEmail).toBe(true)
      const expectedUrl = `${origin}/jelszo-visszaallitas?token=${String(token)}&returnUrl=${encodeURIComponent(returnUrl)}`
      expect(mail.html.includes(expectedUrl.replaceAll('&', '&amp;'))).toBe(true)
      expect(mail.text.includes(expectedUrl)).toBe(true)
      expect(mail.text.includes('&#8199;') || mail.text.includes('&#65279;')).toBe(false)
      for (const body of [mail.html, mail.text]) {
        expect(body.includes('A fiókod e-mail-címe:')).toBe(true)
        expect(body.includes(accountEmail)).toBe(true)
      }
      const stored = await adapter().pool.query<{
        reset_password_token: string
        reset_password_expiration: Date | string
        password_setup_pending: boolean
      }>(
        'SELECT reset_password_token, reset_password_expiration, password_setup_pending FROM users WHERE id = $1',
        [userId],
      )
      expect(stored.rows.length).toBe(1)
      expect(stored.rows[0].reset_password_token === token).toBe(true)
      const expiry = new Date(stored.rows[0].reset_password_expiration).getTime()
      expect(expiry >= before + 3_600_000 && expiry <= after + 3_600_000).toBe(true)
      expect(stored.rows[0].password_setup_pending).toBe(true)
      expect(logs.some((line) => line.includes(String(token)) || line.includes(expectedUrl))).toBe(
        false,
      )
    }, 30_000)

    it('ismeretlen címhez nem készül kimenő levél', async () => {
      const result: unknown = await payload!.forgotPassword({
        collection: 'users',
        data: { email: `dummy-unknown-${randomUUID()}@example.test` },
      })
      expect(result === null).toBe(true)
      expect(outbox.length).toBe(0)
      expect(unexpectedRequests).toBe(0)
    }, 30_000)
  },
)
