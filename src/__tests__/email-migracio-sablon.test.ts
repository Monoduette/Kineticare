import { afterEach, describe, expect, it, vi } from 'vitest'

import { ATALLAS_KERES_KORLAT_MONDAT } from '../app/(frontend)/belepes-atallas/page'
import { ctaLabel } from '../lib/cta-vocabulary'
import { sendViaResend } from '../lib/email/resend'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../lib/contact-email'
import { RATE_LIMIT_RULES } from '../lib/security/rate-limit'
import { buildMessage } from '../lib/email/smtp'
import { renderLayout } from '../lib/email/templates/layout'
import {
  MIGRATION_NOTICE_ACCESS_SENTENCE,
  MIGRATION_NOTICE_LINK_VALIDITY_MS,
  MIGRATION_NOTICE_PATH,
  MIGRATION_NOTICE_PREHEADER,
  MIGRATION_NOTICE_REPLY_TO,
  MIGRATION_NOTICE_SIGNATURE,
  MIGRATION_NOTICE_SUBJECT,
  buildMigrationNoticeUrl,
  migrationNoticeEmail,
  migrationNoticeLinkValiditySentence,
  migrationNoticeRateLimitSentence,
} from '../lib/email/templates/migration'
import configPromise from '../payload.config'
import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * WP40 – az átköltöztetési értesítő sablonja (src/lib/email/templates/migration.ts).
 *
 * MINDEN ADAT KITALÁLT (example.com); valódi cím és kulcs nem szerepel.
 * Hálózati hívás nincs: a Resend-ág `fetch`-e stubbolva.
 */

const SERVER_URL = 'https://kineticare.example.com/'

describe('Átállási értesítő: fizetős és ingyenes fiókok pontos tájékoztatása', () => {
  it('nem állítja, hogy a már aktivált fiók jelszavát újra le kell cserélni', () => {
    const email = migrationNoticeEmail({
      name: null,
      email: 'pelda@example.com',
      serverUrl: SERVER_URL,
    })
    for (const content of [email.html, email.text]) {
      expect(content).toContain(
        'Ha az új felületen már beállítottál jelszót, azzal továbbra is beléphetsz.',
      )
      expect(content).not.toContain('mindenkinek új jelszót')
      expect(content).not.toContain('kurzusaid megvannak')
      expect(content).toContain('ingyenes SOS')
    }
    expect(email.text).toContain('Szia!')
  })

  it('kiemeli a pontos fiókcímet, a Unicode nevet megőrzi, a HTML-t escape-eli', () => {
    const name = 'Őri <Próba> & Társa'
    const address = 'pelda+"teszt"&jel@example.com'
    const email = migrationNoticeEmail({ name, email: address, serverUrl: SERVER_URL })
    expect(email.text).toContain(`Kedves ${name}!`)
    expect(email.text).toContain(`A fiókod e-mail-címe: ${address}`)
    expect(email.html).toContain('Őri &lt;Próba&gt; &amp; Társa')
    expect(email.html).toContain('pelda+&quot;teszt&quot;&amp;jel@example.com')
    expect(email.html).not.toContain('<Próba>')
    expect(email.html).not.toContain('token=')
  })
})

function levél(name: string | null = 'Kiss Anna') {
  return migrationNoticeEmail({ name, email: 'kiss.anna@example.com', serverUrl: SERVER_URL })
}

describe('WP40 – átköltöztetési értesítő: a tulajdonos négy hangsúlya', () => {
  it('megújult az oldal; a régi jelszó elavult; a levél címére kell új jelszót állítani; Kurzusaim', () => {
    const email = levél()
    for (const variant of [email.html, email.text]) {
      expect(variant).toContain('megújult')
      expect(variant).toContain('a régi jelszavad nem költözött át')
      expect(variant).toContain('amelyre ezt a levelet kaptad')
      expect(variant).toContain('kiss.anna@example.com')
      expect(variant).toContain('A fiókod e-mail-címe:')
      expect(variant).toContain('Kurzusaim')
      expect(variant).toContain('megvásárolt kurzusaidra')
      expect(variant).toContain('ingyenes SOS KézRelax villámkurzusra')
    }
  })

  it('a közös kurzusútmutató mellett segítséget ad hiányzó hozzáférésnél', () => {
    const email = levél()
    expect(MIGRATION_NOTICE_ACCESS_SENTENCE).toBe(
      'A fiókodhoz tartozó kurzusokat belépés után a Kurzusaim oldalon találod.',
    )
    expect(email.text).toContain(MIGRATION_NOTICE_ACCESS_SENTENCE)
    expect(email.html).toContain(`<strong>${MIGRATION_NOTICE_ACCESS_SENTENCE}</strong>`)
    expect(email.text).toContain('ne vásárold meg újra, hanem írj nekünk')
  })
})

describe('WP40 – egy levél, egy gomb, aláírás (terv 1. alapelv, 3. pont)', () => {
  it('EGY link van a levélben, és az a /belepes-atallas abszolút címe (token nélkül)', () => {
    const email = levél()
    const url = buildMigrationNoticeUrl(SERVER_URL)
    expect(url).toBe(`https://kineticare.example.com${MIGRATION_NOTICE_PATH}`)
    expect(MIGRATION_NOTICE_PATH).toBe('/belepes-atallas')
    const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(hrefs)).toEqual(new Set([url]))
    expect(email.html).not.toMatch(/token=/)
    expect(email.text).not.toMatch(/token=/)
    // A text-változatban a link a saját sorában áll (Postmark: „links short and on their own lines").
    expect(email.text.split('\n')).toContain(`${ctaLabel('password-reset-set')}: ${url}`)
  })

  it('a gomb felirata a §3.2 #22 jóváhagyott E/1 alakja (egy cselekvés = egy felirat)', () => {
    const email = levél()
    expect(ctaLabel('password-reset-set')).toBe('Beállítom az új jelszót')
    expect(email.html).toContain('>Beállítom az új jelszót</a>')
    expect(email.html).not.toContain('Beállítom a jelszavam')
  })

  it('a záró bekezdés és az aláírás a gomb UTÁN áll, nem előtte', () => {
    const email = levél()
    const gomb = email.html.indexOf('>Beállítom az új jelszót</a>')
    const alairas = email.html.indexOf(MIGRATION_NOTICE_SIGNATURE)
    const segitseg = email.html.indexOf('válaszolj erre a levélre')
    expect(gomb).toBeGreaterThan(-1)
    expect(segitseg).toBeGreaterThan(gomb)
    expect(alairas).toBeGreaterThan(segitseg)
    expect(email.text).toContain(`Üdvözlettel: ${MIGRATION_NOTICE_SIGNATURE}`)
    expect(MIGRATION_NOTICE_SIGNATURE).toBe('a Kineticare csapata')
  })
})

describe('WP40 – tárgy, előnézet, lábléc', () => {
  it('a tárgy legfeljebb 60 karakter, a lényeg elöl, és nem kezdődik a márkanévvel önmagában', () => {
    expect(MIGRATION_NOTICE_SUBJECT.length).toBeLessThanOrEqual(60)
    expect(levél().subject).toBe(MIGRATION_NOTICE_SUBJECT)
    expect(MIGRATION_NOTICE_SUBJECT).toContain('jelsz')
  })

  it('van rejtett előnézeti sor, ami nem a wordmark', () => {
    const email = levél()
    expect(email.html).toContain(MIGRATION_NOTICE_PREHEADER)
    expect(MIGRATION_NOTICE_PREHEADER.length).toBeLessThanOrEqual(110)
    expect(email.html.indexOf(MIGRATION_NOTICE_PREHEADER)).toBeLessThan(
      email.html.indexOf('Kineti<span'),
    )
  })

  it('a lábléc kimondja, miért kapja (fiók-átköltöztetés) és hova válaszolhat; nincs „ne válaszolj"', () => {
    const email = levél()
    for (const variant of [email.html, email.text]) {
      expect(variant).toContain('az új felületen történő belépéshez küldünk segítséget')
      expect(variant).toContain('Válaszolj erre a levélre')
      expect(variant).toContain(KAPCSOLATI_EMAIL_TARTALEK)
      expect(variant).not.toContain('ne válaszolj')
    }
    expect(MIGRATION_NOTICE_REPLY_TO).toBe(KAPCSOLATI_EMAIL_TARTALEK)
  })

  it('a lábléc-mondat a feloldott kapcsolati e-mailt írja (a Reply-To-val azonos)', () => {
    const email = migrationNoticeEmail({
      name: 'Kiss Anna',
      email: 'kiss.anna@example.com',
      serverUrl: SERVER_URL,
      replyTo: 'rendelo@example.com',
    })
    for (const variant of [email.html, email.text]) {
      expect(variant).toContain('vagy írj a(z) rendelo@example.com címre.')
      expect(variant).not.toContain(KAPCSOLATI_EMAIL_TARTALEK)
    }
  })

  it('a megszólítás névvel és név nélkül is helyes', () => {
    expect(levél('Kiss Anna').text).toContain('Kedves Kiss Anna!')
    for (const name of [null, '', '   ']) {
      const email = levél(name)
      expect(email.text).toContain('Szia!')
      expect(email.html).not.toContain('Kedves !')
    }
  })
})

describe('WP40 – a két szám a levélben a kérés-korlát valódi értéke', () => {
  it('a mondat a password-forgot-email keretből épül, és bitre azonos a /belepes-atallas lapéval', () => {
    const keret = RATE_LIMIT_RULES['password-forgot-email']
    const mondat = migrationNoticeRateLimitSentence()
    expect(mondat).toContain(
      `${keret.windowMs / 60_000} percen belül legfeljebb ${keret.limit} levelet`,
    )
    expect(mondat).toBe(ATALLAS_KERES_KORLAT_MONDAT)
    const email = levél()
    expect(email.text).toContain(mondat)
    expect(email.html).toContain(mondat)
    expect(email.text).toContain('A link 1 óráig érvényes')
  })

  it('a link élettartama a payload.config users.auth.forgotPassword.expiration értéke (alap: 1 óra)', async () => {
    const config = await configPromise
    const users = (config.collections ?? []).find((collection) => collection.slug === 'users')
    expect(users).toBeDefined()
    const auth = users?.auth as { forgotPassword?: { expiration?: number } } | undefined
    // A Payload alapértéke 3 600 000 ms (1 óra), ha a collection nem ad meg sajátot.
    const expiration = auth?.forgotPassword?.expiration ?? 3_600_000
    expect(MIGRATION_NOTICE_LINK_VALIDITY_MS).toBe(expiration)
    const ora = expiration / 3_600_000
    expect(migrationNoticeLinkValiditySentence()).toBe(
      `A link ${ora} óráig érvényes; ha lejár, ugyanott kérhetsz újat.`,
    )
    expect(levél().text).toContain(migrationNoticeLinkValiditySentence())
  })
})

describe('WP40 – natív magyar mikroszöveg (§3.1) és biztonság', () => {
  it('sem a tárgyban, sem a szövegben nincs kvirtmínusz vagy töltelék gondolatjel', () => {
    const email = levél()
    expect(email.subject).not.toContain(EM_DASH)
    expect(email.subject).not.toContain(EN_DASH)
    expect(email.text).not.toContain(EM_DASH)
    expect(email.text).not.toContain(EN_DASH)
    expect(email.html).not.toContain(EM_DASH)
    expect(email.html).not.toContain(EN_DASH)
  })

  it('a szöveg tegez (E/2), a gomb E/1; nincs „Kérjük" udvariaskodás', () => {
    const email = levél()
    expect(email.text).toContain('nyisd meg')
    expect(email.text).not.toMatch(/Kérjük/u)
    expect(email.text).not.toMatch(/Önt\b|Önnek\b/u)
  })

  it('furcsa név és e-mail-cím NEM töri szét a HTML-t (escape)', () => {
    const email = migrationNoticeEmail({
      name: '<script>alert(1)</script>',
      email: `"><img src=x onerror=alert(1)>${'a'.repeat(200)}@example.com`,
      serverUrl: SERVER_URL,
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it('a HTML lang="hu", presentation-táblás, és a gomb szövege 4 szó vagy rövidebb', () => {
    const email = levél()
    expect(email.html).toContain('<html lang="hu">')
    expect(email.html).toContain('role="presentation"')
    expect(ctaLabel('password-reset-set').split(/\s+/u).length).toBeLessThanOrEqual(4)
  })
})

describe('WP40 – a váz és a szolgáltatók bővítése (reply-to, idempotencia)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renderLayout: footer nélkül a régi „ne válaszolj" sor marad (a többi sablon nem változik)', () => {
    const out = renderLayout({ heading: 'Próba', paragraphsHtml: ['x'], paragraphsText: ['x'] })
    expect(out.html).toContain('erre a címre ne válaszolj')
    expect(out.text).toContain('erre a címre ne válaszolj')
  })

  it('renderLayout: a closing bekezdések a gomb után, a note előtt kerülnek ki', () => {
    const out = renderLayout({
      heading: 'Próba',
      paragraphsHtml: ['első'],
      paragraphsText: ['első'],
      cta: { label: 'Gomb', url: 'https://example.com/x' },
      closingParagraphsHtml: ['záró'],
      closingParagraphsText: ['záró'],
      note: 'megjegyzés',
    })
    const gomb = out.html.indexOf('>Gomb</a>')
    expect(out.html.indexOf('záró')).toBeGreaterThan(gomb)
    expect(out.html.indexOf('megjegyzés')).toBeGreaterThan(out.html.indexOf('záró'))
    expect(out.text.indexOf('záró')).toBeGreaterThan(
      out.text.indexOf('Gomb: https://example.com/x'),
    )
  })

  it('Resend: a reply_to a törzsbe, az Idempotency-Key a FEJLÉCBE kerül', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'e-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendViaResend('teszt-kulcs-nem-valodi', 'Kineticare <noreply@example.test>', {
      to: ['vevo@example.test'],
      subject: 't',
      html: '<p>t</p>',
      text: 't',
      replyTo: 'info@example.test',
      idempotencyKey: 'migracio-42',
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('migracio-42')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.reply_to).toBe('info@example.test')
    expect(body).not.toHaveProperty('idempotencyKey')
  })

  it('Resend: kulcs és reply-to nélkül a kérés alakja változatlan', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'e-2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendViaResend('teszt-kulcs-nem-valodi', 'Kineticare <noreply@example.test>', {
      to: ['vevo@example.test'],
      subject: 't',
      html: '<p>t</p>',
      text: 't',
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers as Record<string, string>).not.toHaveProperty('Idempotency-Key')
    expect(JSON.parse(String(init.body)) as Record<string, unknown>).not.toHaveProperty('reply_to')
  })

  it('SMTP: a Reply-To fejléc csak akkor kerül be, ha kértük', () => {
    const config = {
      host: 'smtp.example.test',
      port: 587,
      from: 'Kineticare <noreply@example.test>',
      fromAddress: 'noreply@example.test',
    }
    const base = { to: ['vevo@example.test'], subject: 't', html: '<p>t</p>', text: 't' }
    expect(buildMessage(config, { ...base, replyTo: 'info@example.test' })).toContain(
      'Reply-To: info@example.test',
    )
    expect(buildMessage(config, base)).not.toContain('Reply-To:')
  })
})
