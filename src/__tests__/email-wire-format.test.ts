import { describe, expect, it } from 'vitest'

import { buildMessage, formatFromHeader, stripHeaderBreaks } from '../lib/email/smtp'
import { appointmentStaffEmail } from '../lib/email/templates/appointment'
import { resetPasswordEmail, welcomeEmail } from '../lib/email/templates/auth'

const config = {
  host: 'smtp.example.test',
  port: 587,
  from: 'Kineticare Értesítő <staff@example.test>',
  fromAddress: 'staff@example.test',
}

function readParts(raw: string): string[] {
  const boundary = /boundary="([^"]+)"/.exec(raw)?.[1]
  expect(boundary).toBeDefined()
  return raw
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const bodyStart = part.indexOf('\r\n\r\n')
      expect(bodyStart).toBeGreaterThan(0)
      return part.slice(bodyStart + 4).replace(/\r\n$/, '')
    })
}

function header(raw: string, field: string): string {
  const match = new RegExp(`^${field}:([^\\r\\n]*(?:\\r\\n[ \\t][^\\r\\n]*)*)`, 'm').exec(raw)
  expect(match).not.toBeNull()
  return match![1].replace(/\r\n/g, '').trim()
}

function decodeWords(value: string): string {
  return value
    .replace(/(\?=)[ \t]+(?==\?UTF-8\?B\?)/g, '$1')
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_, encoded: string) => {
      const bytes = Buffer.from(encoded, 'base64')
      // Minden encoded-word külön is érvényes UTF-8, nincs kettévágott karakter.
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    })
}

describe('SMTP MIME törzsek: protokollkorlát és veszteségmentes tartalom', () => {
  const templates = [
    welcomeEmail({ name: 'DUMMY_SYNTHETIC_NAME', loginUrl: 'https://example.test/login' }),
    resetPasswordEmail({ name: 'DUMMY_SYNTHETIC_NAME', resetUrl: 'https://example.test/reset' }),
    appointmentStaffEmail({
      name: 'DUMMY_SYNTHETIC_NAME',
      phone: '+36-00-000-0000',
      email: 'visitor@example.test',
      availability: 'DUMMY_AVAILABILITY',
      reason: 'DUMMY_REASON',
      submittedAt: '2026-09-08',
    }),
  ]

  it.each(templates)('valós sablon: $subject', (template) => {
    const raw = buildMessage(config, { to: ['staff@example.test'], ...template })
    const parts = readParts(raw)
    expect(parts).toHaveLength(2)
    for (const [index, part] of parts.entries()) {
      expect(part.split('\r\n').every((line) => line.length <= 76)).toBe(true)
      expect(Buffer.from(part, 'base64')).toEqual(
        Buffer.from(index === 0 ? template.text : template.html),
      )
    }
    expect(raw.split('\r\n').every((line) => Buffer.byteLength(line) <= 998)).toBe(true)
    expect(raw.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  })

  it.each([
    '',
    'a',
    'ab',
    'abc',
    'x'.repeat(56),
    'x'.repeat(57),
    'x'.repeat(58),
    'árvíztűrő 🖐🏽 日本語\n.második\r\nharmadik\r'.repeat(100),
  ])('a törzsbájtok megmaradnak (%#)', (body) => {
    const raw = buildMessage(config, {
      to: ['staff@example.test'],
      subject: 'Teszt',
      text: body,
      html: body,
    })
    for (const part of readParts(raw)) {
      expect(part.split('\r\n').every((line) => line.length <= 76)).toBe(true)
      expect(Buffer.from(part, 'base64')).toEqual(Buffer.from(body, 'utf8'))
    }
  })
})

describe('SMTP fejléc: külön RFC 2047 korlátok', () => {
  it.each(['Árvíztűrő 🖐🏽 日本語 '.repeat(60), 'X'.repeat(1300), 'DUMMY  ASCII   NAME '.repeat(70)])(
    'a hosszú tárgy külön is dekódolható szavakból áll (%#)',
    (subject) => {
      const raw = buildMessage(config, { to: ['staff@example.test'], subject, text: '', html: '' })
      expect(decodeWords(header(raw, 'Subject'))).toBe(stripHeaderBreaks(subject))
      const words = header(raw, 'Subject').match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? []
      expect(words.length).toBeGreaterThan(1)
      expect(words.every((word) => word.length <= 75)).toBe(true)
      expect(
        raw
          .split('\r\n')
          .filter((line) => line.includes('=?UTF-8?B?'))
          .every((line) => line.length <= 76),
      ).toBe(true)
      expect(raw.split('\r\n').every((line) => Buffer.byteLength(line) <= 998)).toBe(true)
    },
  )

  it('hosszú feladónév mellett a cím megmarad és a tartalom nem módosul', () => {
    const name = 'DUMMY Értesítő 🖐 '.repeat(35).trim()
    const raw = buildMessage(
      { ...config, from: `${name} <staff@example.test>` },
      {
        to: Array.from({ length: 50 }, (_, index) => `recipient${index}@example.test`),
        subject: 'Teszt',
        text: '',
        html: '',
      },
    )
    expect(decodeWords(header(raw, 'From'))).toBe(`${name} <staff@example.test>`)
    expect(raw.split('\r\n').every((line) => Buffer.byteLength(line) <= 998)).toBe(true)
    expect(
      raw
        .split('\r\n')
        .filter((line) => line.includes('=?UTF-8?B?'))
        .every((line) => line.length <= 76),
    ).toBe(true)
    expect(header(raw, 'To').split(', ')).toHaveLength(50)
  })

  it('a megbízható hajtogatás nem engedi vissza a fejléc-injekciót', () => {
    const subject = `DUMMY${'ő'.repeat(100)}\r\nBcc: injected@example.test\r\n\r\n.body`
    const raw = buildMessage(config, {
      to: ['staff@example.test'],
      subject,
      text: 'DUMMY',
      html: 'DUMMY',
    })
    expect(raw).not.toMatch(/\r\nBcc:/)
    expect(decodeWords(header(raw, 'Subject'))).toBe(stripHeaderBreaks(subject))
    expect(
      formatFromHeader('DUMMY\r\nBcc: injected@example.test <staff@example.test>'),
    ).not.toMatch(/\r\nBcc:/)
    expect(readParts(raw)).toHaveLength(2)
  })
})
