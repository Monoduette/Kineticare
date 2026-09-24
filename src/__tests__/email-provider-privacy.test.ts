import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appointmentStaffEmail } from '../lib/email/templates/appointment'
import { contactStaffEmail } from '../lib/email/templates/auth'

const transport = vi.hoisted(() => ({ smtp: vi.fn(), resend: vi.fn() }))
vi.mock('../lib/email/smtp', () => ({ sendViaSmtp: transport.smtp }))
vi.mock('../lib/email/resend', () => ({ sendViaResend: transport.resend }))

const markers = ['DUMMY_PRIVATE_NAME', '+36-00-987-6543', 'DUMMY_PRIVATE_REASON']
const templates = [
  appointmentStaffEmail({
    name: markers[0],
    phone: markers[1],
    reason: markers[2],
    email: 'visitor@example.test',
    availability: 'DUMMY',
    submittedAt: '2026-09-08',
  }),
  contactStaffEmail({
    name: markers[0],
    email: 'visitor@example.test',
    message: markers[2],
    submittedAt: '2026-09-08',
  }),
]

let lines: string[]
beforeEach(() => {
  vi.resetModules()
  transport.smtp.mockReset().mockResolvedValue(undefined)
  transport.resend.mockReset().mockResolvedValue({ id: 'DUMMY_PROVIDER_ID' })
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('SMTP_HOST', '')
  vi.stubEnv('LOG_LEVEL', 'debug')
  vi.stubGlobal('fetch', () => {
    throw new Error('DUMMY: unmocked network is forbidden')
  })
  lines = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('provider logger: a teljes tárgy és a tartalom egyik ágon sem kerül naplóba', () => {
  for (const provider of ['noop', 'smtp', 'resend'] as const) {
    for (const [index, template] of templates.entries()) {
      it(`${provider} siker: valódi sablon ${index}, változatlan átadás`, async () => {
        if (provider === 'smtp') vi.stubEnv('SMTP_HOST', 'smtp.example.test')
        if (provider === 'resend') vi.stubEnv('RESEND_API_KEY', 'DUMMY-NOT-A-REAL-KEY')
        const { sendMail } = await import('../lib/email/provider')
        const result = await sendMail({ to: 'staff@example.test', ...template })
        expect(result).toMatchObject({ ok: true, provider })
        if (provider === 'resend') {
          expect(result.id).toBe('DUMMY_PROVIDER_ID')
          expect(transport.resend.mock.calls[0][2]).toEqual({
            to: ['staff@example.test'],
            ...template,
          })
        }
        if (provider === 'smtp')
          expect(transport.smtp.mock.calls[0][1]).toEqual({
            to: ['staff@example.test'],
            ...template,
          })
        const output = lines.join('\n')
        expect(output).toContain('e-mail elküldve')
        expect(output).not.toContain(template.subject)
        for (const marker of markers) expect(output).not.toContain(marker)
        expect(output).not.toContain('"subject"')
        expect(output).not.toContain('staff@example.test')
      })
    }
  }

  it('üres címzettlistánál sem használja a tárgyat napló-azonosítóként', async () => {
    const { sendMail } = await import('../lib/email/provider')
    expect(await sendMail({ to: [], ...templates[0] })).toMatchObject({
      ok: false,
      retryable: false,
    })
    expect(lines.join('\n')).not.toContain(markers[0])
    expect(lines.join('\n')).not.toContain('"subject"')
    expect(transport.smtp).not.toHaveBeenCalled()
    expect(transport.resend).not.toHaveBeenCalled()
  })

  it.each(['retryable', 'permanent', 'unexpected'] as const)(
    'hiba (%s): a provider nem tükrözheti vissza a tárgyat',
    async (kind) => {
      vi.stubEnv('SMTP_HOST', 'smtp.example.test')
      const { EmailSendError } = await import('../lib/email/types')
      const { sendMail } = await import('../lib/email/provider')
      const detail = `${templates[0].subject} ${markers[2]} ${templates[0].text}`
      const failure =
        kind === 'unexpected' ? new Error(detail) : new EmailSendError(detail, kind === 'retryable')
      failure.name = markers[0]
      transport.smtp.mockRejectedValue(failure)
      expect(await sendMail({ to: 'staff@example.test', ...templates[0] })).toEqual({
        ok: false,
        provider: 'smtp',
        retryable: kind !== 'permanent',
        error: detail,
      })
      const output = lines.join('\n')
      expect(output).toContain('e-mail küldés sikertelen')
      for (const marker of markers) expect(output).not.toContain(marker)
      expect(output).not.toContain('"subject"')
    },
  )
})

describe('provider: melléklet átadása napló-szivárgás nélkül', () => {
  const attachment = {
    filename: 'DUMMY_PRIVATE_FILENAME.txt',
    content: `${markers[2]} melléklet-tartalom`,
    contentType: 'text/plain; charset=utf-8',
  }

  for (const provider of ['smtp', 'resend'] as const) {
    it(`${provider}: a melléklet változatlanul jut el, a naplóba csak a darabszáma kerül`, async () => {
      if (provider === 'smtp') vi.stubEnv('SMTP_HOST', 'smtp.example.test')
      if (provider === 'resend') vi.stubEnv('RESEND_API_KEY', 'DUMMY-NOT-A-REAL-KEY')
      const { sendMail } = await import('../lib/email/provider')
      const result = await sendMail({
        to: 'vevo@example.test',
        ...templates[0],
        attachments: [attachment],
      })
      expect(result).toMatchObject({ ok: true, provider })
      const message =
        provider === 'smtp' ? transport.smtp.mock.calls[0][1] : transport.resend.mock.calls[0][2]
      expect(message.attachments).toEqual([attachment])
      const output = lines.join('\n')
      expect(output).toContain('"attachmentCount":1')
      expect(output).not.toContain('DUMMY_PRIVATE_FILENAME')
      expect(output).not.toContain('melléklet-tartalom')
    })
  }

  it('üres melléklet-listánál a MailMessage-ben nincs attachments kulcs', async () => {
    vi.stubEnv('RESEND_API_KEY', 'DUMMY-NOT-A-REAL-KEY')
    const { sendMail } = await import('../lib/email/provider')
    await sendMail({ to: 'vevo@example.test', ...templates[0], attachments: [] })
    expect(transport.resend.mock.calls[0][2]).not.toHaveProperty('attachments')
  })
})
