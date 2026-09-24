import type { Config } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { maskEmail, parseFromAddress } from '../lib/email/mask'
import { resolveEmailProvider, sendMail } from '../lib/email/provider'
import { sendWithRetry, type RetryableMailInput } from '../lib/email/retry'
import {
  contactStaffEmail,
  resetPasswordEmail,
  verifyEmail,
  welcomeEmail,
} from '../lib/email/templates/auth'
import { escapeHtml, renderLayout } from '../lib/email/templates/layout'
import { usersAuthEmails } from '../lib/email/users-auth'
import type { SendResult } from '../lib/email/types'
import { PASSWORD_RESET_PATH, buildPasswordResetUrl } from '../lib/password-reset-url'

describe('resolveEmailProvider', () => {
  it('RESEND_API_KEY elsőbbséget élvez', () => {
    const provider = resolveEmailProvider({
      RESEND_API_KEY: 're_xxx',
      SMTP_HOST: 'smtp.example.com',
    })
    expect(provider.name).toBe('resend')
  })

  it('SMTP_HOST esetén smtp, port-fallback 587', () => {
    const provider = resolveEmailProvider({ SMTP_HOST: 'smtp.example.com' })
    expect(provider).toMatchObject({ name: 'smtp', smtp: { host: 'smtp.example.com', port: 587 } })
  })

  it('env nélkül noop-provider (sosem crashel)', () => {
    expect(resolveEmailProvider({}).name).toBe('noop')
  })
})

describe('sendMail noop-providerrel', () => {
  it('e-mail env-k nélkül is sikeres (noop), nem dob hibát', async () => {
    const result = await sendMail({
      to: 'valaki@example.com',
      subject: 'Teszt',
      html: '<p>Szia</p>',
      text: 'Szia',
    })
    expect(result).toMatchObject({ ok: true, provider: 'noop' })
  })

  it('üres címzettlista esetén ok:false, retryable:false, szintén hiba nélkül', async () => {
    const result = await sendMail({ to: [], subject: 'T', html: '', text: '' })
    expect(result).toMatchObject({ ok: false, retryable: false })
  })
})

/**
 * Kulcs nélküli indulás: a noop-figyelmeztetés EGYSZER szólal meg.
 *
 * A provider-modul memoizálja a feloldást, ezért a naplósor a folyamat
 * élettartama alatt egyszer megy ki — több száz levélnél nem szemeteli tele a
 * naplót. A teszt friss modulpéldányt tölt be (`resetModules`), hogy a többi
 * teszt már bemelegített cache-e ne zavarjon bele.
 */
describe('e-mail provider figyelmeztetése kulcs nélkül', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('a noop-figyelmeztetés csak EGYSZER kerül a naplóba', async () => {
    vi.resetModules()
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    const { sendMail: freshSendMail } = await import('../lib/email/provider')
    const message = { subject: 'T', html: '<p>x</p>', text: 'x' }
    await freshSendMail({ to: 'egy@example.com', ...message })
    await freshSendMail({ to: 'ketto@example.com', ...message })
    await freshSendMail({ to: 'harom@example.com', ...message })

    const warnings = lines.filter((line) => line.includes('e-mail provider nincs beállítva'))
    expect(warnings).toHaveLength(1)
    // A figyelmeztetés magyar, és megmondja, mi hiányzik.
    expect(warnings[0]).toContain('RESEND_API_KEY')
    expect(warnings[0]).toContain('"level":"warn"')
  })

  it('élesben a noop NEM „elküldve”: RIASZTÁS szól, az ismétlés fojtott warn', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('SMTP_HOST', '')
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    const { resetAlertThrottle } = await import('../lib/alert-throttle')
    resetAlertThrottle()
    const { sendMail: freshSendMail } = await import('../lib/email/provider')
    const message = { subject: 'T', html: '<p>x</p>', text: 'x' }
    const first = await freshSendMail({ to: 'egy@example.com', ...message })
    await freshSendMail({ to: 'ketto@example.com', ...message })
    vi.unstubAllEnvs()

    // A hívó a `provider: 'noop'` alapján dönt (order-paid, elállás).
    expect(first).toMatchObject({ ok: true, provider: 'noop' })
    expect(lines.some((line) => line.includes('e-mail elküldve'))).toBe(false)
    const alerts = lines.filter((line) => line.includes('"level":"error"'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain('RIASZTÁS')
    expect(alerts[0]).toContain('RESEND_API_KEY')
    expect(lines.filter((line) => line.includes('e-mail NEM ment ki'))).toHaveLength(1)
  })
})

describe('maskEmail / parseFromAddress', () => {
  it('a címzett maszkolva kerülne a logba', () => {
    expect(maskEmail('kiss.anna@example.com')).toBe('k***@example.com')
    expect(maskEmail('a@b.hu')).toBe('a***@b.hu')
    expect(maskEmail('nincs-kukac')).toBe('***')
  })

  it('"Név <cím>" és puszta cím formátumot is felold', () => {
    expect(parseFromAddress('Kineticare <hello@kineticare.hu>')).toEqual({
      name: 'Kineticare',
      address: 'hello@kineticare.hu',
    })
    expect(parseFromAddress('hello@kineticare.hu')).toEqual({
      name: 'Kineticare',
      address: 'hello@kineticare.hu',
    })
    expect(parseFromAddress(undefined)).toEqual({
      name: 'Kineticare',
      address: 'noreply@localhost',
    })
  })
})

describe('e-mail sablonok (magyar, HTML + plain-text)', () => {
  it('welcome: magyar tárgy, névvel, CTA-val, text-változattal', () => {
    const email = welcomeEmail({ name: 'Kiss Anna', loginUrl: 'https://pelda.hu/belepes' })
    expect(email.subject).toBe('Üdvözöl a Kineticare!')
    expect(email.html).toContain('Kedves Kiss Anna!')
    expect(email.html).toContain('https://pelda.hu/belepes')
    expect(email.html).toContain('Belépés')
    expect(email.text).toContain('Kedves Kiss Anna!')
    expect(email.text).toContain('https://pelda.hu/belepes')
  })

  it('reset: visszaállító linkkel, figyelmeztetéssel', () => {
    const email = resetPasswordEmail({
      name: null,
      resetUrl: 'https://pelda.hu/admin/reset/tok123',
    })
    expect(email.subject).toBe('Jelszó visszaállítása')
    expect(email.html).toContain('https://pelda.hu/admin/reset/tok123')
    expect(email.html).toContain('Ha nem te kérted')
    expect(email.html).not.toMatch(/[–—]/)
    expect(email.html).toContain('Beállítom az új jelszót')
    expect(email.html).toContain('továbbléphetsz a kurzusaidhoz')
    expect(email.text).toContain('továbbléphetsz a kurzusaidhoz')
    expect(email.text).toContain('tok123')
  })

  it('verify: megerősítő linkkel', () => {
    const email = verifyEmail({ verifyUrl: 'https://pelda.hu/admin/verify/abc' })
    expect(email.subject).toBe('Erősítsd meg az e-mail-címed')
    expect(email.html).toContain('https://pelda.hu/admin/verify/abc')
  })

  it('contact-staff: beküldő adataival, HTML-escape-elt üzenettel', () => {
    const email = contactStaffEmail({
      name: 'Teszt Elek',
      email: 'teszt@example.com',
      message: '<script>alert(1)</script>\nÜdv, érdeklődnék.',
      submittedAt: '2026-07-30 12:00',
    })
    expect(email.subject).toBe('Új kapcsolatfelvétel: Teszt Elek')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.text).toContain('teszt@example.com')
  })

  it('a váz mindig ad plain-text változatot és automatikus-üzenet láblécet', () => {
    const layout = renderLayout({ heading: 'Cím', paragraphsHtml: ['x'], paragraphsText: ['x'] })
    expect(layout.text).toContain('automatikus üzenet')
    expect(escapeHtml('<b>"i"</b>')).toBe('&lt;b&gt;&quot;i&quot;&lt;/b&gt;')
  })
})

describe('jelszó-beállító link', () => {
  it('a nyilvános oldalra mutat, URL-kódolt tokennel', () => {
    expect(buildPasswordResetUrl('https://kineticare.example.com', 'abc+def')).toBe(
      `https://kineticare.example.com${PASSWORD_RESET_PATH}?token=abc%2Bdef&returnUrl=%2Fkurzusaim`,
    )
  })

  it('a záró perjel nem duplázza az útvonalat', () => {
    expect(buildPasswordResetUrl('https://kineticare.example.com//', 'abc')).toBe(
      `https://kineticare.example.com${PASSWORD_RESET_PATH}?token=abc&returnUrl=%2Fkurzusaim`,
    )
  })
})

/**
 * A users auth e-mail-sablonok config-injekciója.
 *
 * A `usersAuthEmails` plugin a Users.ts collection-fájlhoz NEM nyúl — a
 * teszt is a config-transzformációt ellenőrzi, nem a collection forrását.
 */
describe('usersAuthEmails plugin', () => {
  const baseConfig = (): Config =>
    ({
      collections: [
        { slug: 'users', auth: {}, fields: [] },
        { slug: 'media', fields: [] },
      ],
    }) as unknown as Config

  /** A beinjektált forgot-password sablon kiszedése típusszűkítéssel (`any` nélkül). */
  const forgotPasswordHtml = async (
    config: Config,
    args: { token?: string; user?: unknown; req?: unknown },
  ): Promise<string> => {
    const users = (config.collections ?? []).find((collection) => collection.slug === 'users')
    const auth = typeof users?.auth === 'object' ? users.auth : undefined
    const forgotPassword =
      typeof auth?.forgotPassword === 'object' ? auth.forgotPassword : undefined
    const generate = forgotPassword?.generateEmailHTML
    if (typeof generate !== 'function') {
      throw new Error('Nincs beinjektálva forgot-password HTML-sablon.')
    }
    return String(await generate(args as never))
  }

  const withServerUrl = async <T>(url: string, run: () => Promise<T>): Promise<T> => {
    const previous = process.env.NEXT_PUBLIC_SERVER_URL
    process.env.NEXT_PUBLIC_SERVER_URL = url
    try {
      return await run()
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_SERVER_URL
      } else {
        process.env.NEXT_PUBLIC_SERVER_URL = previous
      }
    }
  }

  it('a reset-link a NYILVÁNOS oldalra mutat, nem az adminra', async () => {
    await withServerUrl('https://kineticare.example.com', async () => {
      const config = (await usersAuthEmails(baseConfig())) as Config
      const html = await forgotPasswordHtml(config, {
        token: 'tok123',
        user: { name: 'Kiss Anna' },
      })
      expect(html).toContain(`https://kineticare.example.com${PASSWORD_RESET_PATH}?token=tok123`)
      expect(html).not.toContain('/admin/reset/')
      expect(html).toContain('Kedves Kiss Anna!')
    })
  })

  it('a req.data.returnUrl a reset-linkbe kerül', async () => {
    await withServerUrl('https://kineticare.example.com', async () => {
      const config = (await usersAuthEmails(baseConfig())) as Config
      const html = await forgotPasswordHtml(config, {
        token: 'tok123',
        user: { name: 'Kiss Anna' },
        req: { data: { returnUrl: '/kurzusaim/12' } },
      })
      expect(html).toContain('returnUrl=%2Fkurzusaim%2F12')
    })
  })

  it('név nélküli felhasználónál is helyes a megszólítás', async () => {
    await withServerUrl('https://kineticare.example.com/', async () => {
      const config = (await usersAuthEmails(baseConfig())) as Config
      const html = await forgotPasswordHtml(config, { token: 'tok123' })
      expect(html).toContain('Szia!')
      // A záró perjel nem duplázhatja az útvonalat.
      expect(html).not.toContain('com//jelszo-visszaallitas')
    })
  })

  it('a users-en kívüli collectionöket érintetlenül hagyja', async () => {
    const config = (await usersAuthEmails(baseConfig())) as Config
    const media = (config.collections ?? []).find((collection) => collection.slug === 'media')
    expect(media?.auth).toBeUndefined()
  })
})

describe('sendWithRetry: automatikus újraküldés csak ott, ahol nem kettőzhet', () => {
  const LEVEL: RetryableMailInput = {
    to: 'vevo@example.test',
    subject: 'Teszt',
    html: '<p>Teszt</p>',
    text: 'Teszt',
    idempotencyKey: 'teszt:1',
  }

  // A bizonytalan kézbesítés (a levél célba érhetett) akkor sem ismételhető,
  // ha egy szolgáltató mellé `retryable: true`-t is ad: az ismétlés második
  // levél lenne. Az első sor a kontroll: ugyanaz `deliveryUncertain` nélkül
  // újrapróbál.
  it.each([
    { eset: 'átmeneti hiba', eredmeny: { retryable: true }, kiserletek: 3 },
    {
      eset: 'átmeneti, de bizonytalan kézbesítés',
      eredmeny: { retryable: true, deliveryUncertain: true },
      kiserletek: 1,
    },
  ])('$eset: $kiserletek kísérlet', async ({ eredmeny, kiserletek }) => {
    const hivasok: RetryableMailInput[] = []
    const kimenet = await sendWithRetry(
      async (input: RetryableMailInput): Promise<SendResult> => {
        hivasok.push(input)
        return { ok: false, provider: 'smtp', error: 'x', ...eredmeny }
      },
      LEVEL,
      { delaysMs: [1, 1], sleep: async () => {} },
    )
    expect(hivasok).toHaveLength(kiserletek)
    expect(kimenet.attempts).toBe(kiserletek)
  })
})
