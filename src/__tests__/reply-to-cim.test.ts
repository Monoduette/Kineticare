import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isUsableReplyToAddress } from '../lib/email/reply-to'

/**
 * A stáb-értesítő Reply-To címének őre (src/lib/email/reply-to.ts).
 * Az SMTP (RFC 5321, 4.5.3.1) korlátain túli címet a Resend az EGÉSZ levéllel
 * együtt elutasítaná, így a stáb nem kapna értesítést: ilyenkor Reply-To nélkül
 * kell küldeni.
 */
describe('isUsableReplyToAddress', () => {
  it('a szokásos címet elfogadja', () => {
    expect(isUsableReplyToAddress('anna@pelda.hu')).toBe(true)
    expect(isUsableReplyToAddress(`${'a'.repeat(64)}@pelda.hu`)).toBe(true)
  })

  it('64 oktettnél hosszabb helyi részt elutasít (a teljes cím 254 alatt is)', () => {
    const cim = `${'a'.repeat(65)}@pelda.hu`
    expect(cim.length).toBeLessThan(254)
    expect(isUsableReplyToAddress(cim)).toBe(false)
  })

  it('nem ASCII címet nem ad át (a szolgáltató SMTPUTF8 nélkül elutasíthatja)', () => {
    expect(isUsableReplyToAddress(`${'é'.repeat(32)}@pelda.hu`)).toBe(false)
    expect(isUsableReplyToAddress('anna@példa.hu')).toBe(false)
    expect(isUsableReplyToAddress('anna@xn--plda-bpa.hu')).toBe(true)
  })

  it.each([
    'a..b@example.com',
    '.a@example.com',
    'a.@example.com',
    'a,@example.com',
    'a@-example.com',
    'a@example-.com',
    'a@example..com',
    'a@example.c',
    'a@example.123',
    'a@localhost',
    'a b@example.com',
    'a@b@example.com',
    `a@${'d'.repeat(64)}.hu`,
    'a@example.xn--abc-',
    'a@example.xn--',
  ])('formailag érvénytelen címet elutasít: %s', (cim) => {
    expect(isUsableReplyToAddress(cim)).toBe(false)
  })

  it.each([
    "o'brien+rendeles@pelda.hu",
    'a@pelda.xn--p1ai',
    'kata.kocsis@mail.pelda.co.uk',
    'a_b-c@x1.hu',
  ])('szabályos dot-atom címet elfogad: %s', (cim) => {
    expect(isUsableReplyToAddress(cim)).toBe(true)
  })

  it('254 oktettnél hosszabb címet és 253 feletti domaint elutasít', () => {
    const hosszuDomain = `${'d'.repeat(60)}.`.repeat(5) + 'hu'
    expect(isUsableReplyToAddress(`a@${hosszuDomain}`)).toBe(false)
  })

  it('formailag hibás vagy fejléc-injektáló címet elutasít', () => {
    expect(isUsableReplyToAddress('nem-email')).toBe(false)
    expect(isUsableReplyToAddress('anna@pelda.hu\r\nBcc: x@y.hu')).toBe(false)
    expect(isUsableReplyToAddress('')).toBe(false)
  })
})

describe('Turnstile-helyfoglalás (layout.css)', () => {
  const css = readFileSync(
    join(process.cwd(), 'src', 'app', '(frontend)', 'styles', 'layout.css'),
    'utf8',
  )

  it('a tároló konténer, a rajzolási hely 65 px-et, 300 px alatt 140 px-et foglal', () => {
    expect(css).toMatch(/\.kc-contact-form__turnstile\s*\{[^}]*container-type:\s*inline-size;/)
    expect(css).toMatch(/\.kc-contact-form__turnstile-hely\s*\{\s*min-height:\s*65px;/)
    expect(css).toMatch(
      /@container \(max-width: 299\.98px\)\s*\{\s*\.kc-contact-form__turnstile-hely\s*\{\s*min-height:\s*140px;/,
    )
  })
})
