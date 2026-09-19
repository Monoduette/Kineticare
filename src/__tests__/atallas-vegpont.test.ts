import { describe, expect, it, vi } from 'vitest'

import { kineticareEmailAdapter, plainTextFromHtml } from '../lib/email/adapter'
import { resetPasswordEmail } from '../lib/email/templates/auth'
import { buildPasswordResetUrl } from '../lib/password-reset-url'
import { RATE_LIMIT_MESSAGE, RATE_LIMIT_RULES } from '../lib/security/rate-limit'
import type { SendResult } from '../lib/email/types'

/**
 * Az átállási (régi vevő) végpont-lánc őr-tesztjei — WP41 (2026-09-16).
 *
 * A teljes utat helyben, Chromiummal is végigmértük (/belepes-atallas →
 * levél → /jelszo-visszaallitas → /kurzusaim → stream-token). Ami itt áll,
 * az a mérés közben talált egyetlen hiba és a doksi (docs/vasarlo-migracio-terv.md
 * 4.6/5.) állításainak kód-szintű őre.
 */

const sendMailMock = vi.hoisted(() =>
  vi.fn<(input: unknown) => Promise<SendResult>>(async () => ({ ok: true, provider: 'noop' })),
)
vi.mock('../lib/email/provider', () => ({ sendMail: sendMailMock }))

describe('Payload auth-levél: a text/plain rész SOSEM üres', () => {
  it('a forgot-password levél (csak HTML a Payloadtól) szöveges változatot is kap, a linkkel', async () => {
    const url = buildPasswordResetUrl('https://kineticare.hu', 'abc123def456')
    const { html } = resetPasswordEmail({ name: 'Kiss Anna', resetUrl: url })
    const adapter = kineticareEmailAdapter({ payload: {} as never })
    // A Payload forgotPassword művelete text mező NÉLKÜL hív (csak html).
    await adapter.sendEmail({ to: 'kiss.anna@example.com', subject: 'Jelszó visszaállítása', html })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sent = sendMailMock.mock.calls[0]?.[0] as unknown as { text: string; html: string }
    expect(sent.text.trim().length).toBeGreaterThan(0)
    // A link dekódolva (`&amp;` → `&`) — kattintható a szöveges olvasóban is.
    expect(sent.text).toContain(url)
    expect(sent.text).not.toContain('&amp;')
    expect(sent.text).not.toMatch(/<[a-z]/i)
    expect(sent.text).toContain('Kedves Kiss Anna!')
  })

  it('ha a hívó ad szöveget, azt nem írjuk felül', async () => {
    sendMailMock.mockClear()
    const adapter = kineticareEmailAdapter({ payload: {} as never })
    await adapter.sendEmail({
      to: 'a@example.com',
      subject: 't',
      html: '<p>html</p>',
      text: 'saját szöveg',
    })
    const sent = sendMailMock.mock.calls[0]?.[0] as unknown as { text: string }
    expect(sent.text).toBe('saját szöveg')
  })

  it('az auth-levél rejtett előnézeti kitöltése nem kerül a szöveges törzsbe', () => {
    const mail = resetPasswordEmail({
      email: 'pelda@example.test',
      resetUrl: 'https://example.test/reset',
    })
    const text = plainTextFromHtml(mail.html)
    expect(text).not.toContain('&#8199;')
    expect(text).not.toContain('&#65279;')
    expect(text).not.toContain('&#847;')
    expect(text).toContain('pelda@example.test')
    expect(text).toContain('https://example.test/reset')
  })

  it('plainTextFromHtml: style/script kimarad, sortörés a blokkoknál, entitások dekódolva', () => {
    const text = plainTextFromHtml(
      '<html><head><style>p{color:red}</style></head><body><h1>Cím</h1><p>Első &amp; második</p><p>Link: <a href="https://x.hu/?a=1&amp;b=2">https://x.hu/?a=1&amp;b=2</a></p><script>alert(1)</script></body></html>',
    )
    expect(text).toBe('Cím\nElső & második\nLink: https://x.hu/?a=1&b=2')
  })
})

describe('kérés-korlát a jelszó-emlékeztetőn (doksi 4.6/5. és a lap mondata)', () => {
  it('a címzett címére 3 kérés / 10 perc, a 4. a magyar üzenettel bukik', () => {
    expect(RATE_LIMIT_RULES['password-forgot-email']).toEqual({
      limit: 3,
      windowMs: 10 * 60 * 1000,
    })
    expect(RATE_LIMIT_RULES['password-forgot']).toEqual({ limit: 3, windowMs: 10 * 60 * 1000 })
    expect(RATE_LIMIT_MESSAGE).toBe('Túl sok próbálkozás. Próbáld újra pár perc múlva.')
  })
})

describe('a visszaállító levél tartalma (mérve: helyi SMTP-gyűjtő, WP41)', () => {
  it('tárgy, abszolút link a szerver-URL-ből, a returnUrl a Kurzusaim, a szöveges részben is ott a link', () => {
    const url = buildPasswordResetUrl('https://kineticare.hu/', 'tok')
    expect(url).toBe('https://kineticare.hu/jelszo-visszaallitas?token=tok&returnUrl=%2Fkurzusaim')
    const mail = resetPasswordEmail({ name: null, resetUrl: url })
    expect(mail.subject).toBe('Jelszó visszaállítása')
    expect(mail.html).toContain(
      'href="https://kineticare.hu/jelszo-visszaallitas?token=tok&amp;returnUrl=%2Fkurzusaim"',
    )
    expect(mail.text).toContain(url)
    expect(mail.text).toContain('Szia!')
  })
})
