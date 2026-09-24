import { describe, expect, it } from 'vitest'

import {
  buildMessage,
  dotStuff,
  encodeWord,
  formatFromHeader,
  safeAttachmentFilename,
  stripHeaderBreaks,
} from '../lib/email/smtp'

/**
 * A kézzel írt SMTP-kliens TISZTA szeleteinek tesztjei (socket nélkül).
 *
 * A socketes munkamenet (connect/STARTTLS/AUTH/DATA) hálózat nélkül nem
 * fedezhető egységteszttel — az e2e-staging-runbook feladata. Itt az
 * üzenet-összeállítás és a karakterkódolás a tárgy: a magyar ékezetes
 * tárgy és a DATA-blokk dot-stuffingja a tipikus néma hibaforrás.
 */

describe('encodeWord', () => {
  it('ASCII-t változatlanul hagy', () => {
    expect(encodeWord('Kineticare')).toBe('Kineticare')
  })

  it('nem-ASCII-t RFC 2047 encoded-wordre alakít', () => {
    const encoded = encodeWord('Köszönjük a vásárlást!')
    expect(encoded.startsWith('=?UTF-8?B?')).toBe(true)
    expect(encoded.endsWith('?=')).toBe(true)
    // A base64-rész visszafejtve az eredeti szöveg:
    const base64 = encoded.slice('=?UTF-8?B?'.length, -2)
    expect(Buffer.from(base64, 'base64').toString('utf8')).toBe('Köszönjük a vásárlást!')
  })
})

describe('dotStuff', () => {
  it('a sor-eleji pontot megduplázza (SMTP DATA-lezárás védelme)', () => {
    expect(dotStuff('elso sor\r\n.masodik')).toBe('elso sor\r\n..masodik')
    expect(dotStuff('nincs benne pont')).toBe('nincs benne pont')
  })
})

describe('buildMessage', () => {
  const config = {
    host: 'smtp.example.test',
    port: 587,
    user: 'u',
    pass: 'DUMMY-NEM-VALODI-TITOK',
    from: 'Kineticare Értesítő',
    fromAddress: 'noreply@example.test',
  }

  it('multipart/alternative üzenetet épít base64 text+html résszel', () => {
    const raw = buildMessage(config, {
      to: ['a@example.test', 'b@example.test'],
      subject: 'Rendelés visszaigazolása',
      text: 'Szöveges változat',
      html: '<p>HTML változat</p>',
    })

    expect(raw).toContain('From: =?UTF-8?B?')
    expect(raw).toContain('To: a@example.test, b@example.test')
    expect(raw).toContain('MIME-Version: 1.0')
    expect(raw).toContain('multipart/alternative; boundary=')
    expect(raw).toContain(Buffer.from('Szöveges változat', 'utf8').toString('base64'))
    expect(raw).toContain(Buffer.from('<p>HTML változat</p>', 'utf8').toString('base64'))
    // CRLF-sorvégek mindenhol (SMTP-követelmény): a \r\n-párokat eltávolítva
    // nem maradhat magányos \r vagy \n:
    expect(raw.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  })

  it('melléklettel multipart/mixed: elöl a változatlan text+html alternatíva, utána a fájl', () => {
    const content = '﻿Általános Szerződési Feltételek\r\n'.repeat(40)
    const raw = buildMessage(config, {
      to: ['a@example.test'],
      subject: 'Sikeres vásárlás',
      text: 'Szöveges változat',
      html: '<p>HTML változat</p>',
      attachments: [
        { filename: 'Kineticare-ASZF.txt', content, contentType: 'text/plain; charset=utf-8' },
      ],
    })

    const mixed = /multipart\/mixed; boundary="([^"]+)"/.exec(raw)?.[1]
    const alternative = /multipart\/alternative; boundary="([^"]+)"/.exec(raw)?.[1]
    expect(mixed).toBeDefined()
    expect(alternative).toBeDefined()
    // Egyik határoló sem előtagja a másiknak (RFC 2046, 5.1.1).
    expect(mixed?.startsWith(alternative ?? '')).toBe(false)
    expect(alternative?.startsWith(mixed ?? '')).toBe(false)

    const parts = raw.split(`--${mixed}`)
    // preambulum, alternatíva, melléklet, záró
    expect(parts).toHaveLength(4)
    expect(parts[1]).toContain(`Content-Type: multipart/alternative; boundary="${alternative}"`)
    expect(parts[1]).toContain(Buffer.from('Szöveges változat', 'utf8').toString('base64'))
    expect(parts[2]).toContain(
      'Content-Type: text/plain; charset=utf-8; name="Kineticare-ASZF.txt"',
    )
    expect(parts[2]).toContain('Content-Disposition: attachment; filename="Kineticare-ASZF.txt"')
    const encoded = parts[2].split('\r\n\r\n')[1].replace(/\r\n/g, '')
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(content)
    expect(parts[2].split('\r\n').every((line) => line.length <= 76)).toBe(true)
    expect(parts[3].startsWith('--')).toBe(true)
    expect(raw.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  })

  it('melléklet nélkül NINCS multipart/mixed burok (a korábbi alak változatlan)', () => {
    const raw = buildMessage(config, {
      to: ['a@example.test'],
      subject: 'Teszt',
      text: 'törzs',
      html: '<b>törzs</b>',
      attachments: [],
    })
    expect(raw).not.toContain('multipart/mixed')
    expect(raw).not.toContain('Content-Disposition')
  })

  it('a melléklet nevébe rejtett fejléc-injekció és idézőjel nem jut ki', () => {
    expect(safeAttachmentFilename('ÁSZF "x".txt\r\nBcc: rossz@example.test')).toBe(
      '_SZF__x_.txt__Bcc__rossz_example.test',
    )
    expect(safeAttachmentFilename('')).toBe('melleklet')
    const raw = buildMessage(config, {
      to: ['a@example.test'],
      subject: 'Teszt',
      text: 'törzs',
      html: '<b>törzs</b>',
      attachments: [
        { filename: 'a"\r\nBcc: rossz@example.test', content: 'x', contentType: 'text/plain' },
      ],
    })
    expect(raw.split('\r\n').some((line) => line.startsWith('Bcc:'))).toBe(false)
  })

  it('a jelszó NEM kerül az üzenetbe', () => {
    const raw = buildMessage(config, {
      to: ['a@example.test'],
      subject: 'Teszt',
      text: 'törzs',
      html: '<b>törzs</b>',
    })
    expect(raw).not.toContain('DUMMY-NEM-VALODI-TITOK')
    expect(raw).not.toContain(config.pass)
  })
})

/**
 * A From fejléc RFC 2047 §5 szerint NEM tartalmazhat encoded-wordöt az
 * addr-specben („An encoded-word MUST NOT appear within a 'quoted-string'…"
 * és az addr-spec sem 'unstructured' mező) — a korábbi, EGÉSZ értéket kódoló
 * alak ékezetes feladónévnél az e-mail-címet is base64-be zárta, amit a
 * fogadó MTA nem tud kézbesíteni.
 */
describe('formatFromHeader', () => {
  it('a „Név <cím>" alakot BONTJA: csak a név megy encoded-wordbe', () => {
    const header = formatFromHeader('Kineticare Értesítő <noreply@example.test>')
    expect(header.endsWith(' <noreply@example.test>')).toBe(true)
    expect(header.startsWith('=?UTF-8?B?')).toBe(true)
    const encoded = header.slice(0, header.indexOf(' <'))
    const base64 = encoded.slice('=?UTF-8?B?'.length, -2)
    expect(Buffer.from(base64, 'base64').toString('utf8')).toBe('Kineticare Értesítő')
  })

  it('az e-mail-cím SOHA nem kerül base64-be', () => {
    for (const raw of [
      'Kineticare Értesítő <noreply@example.test>',
      'Ékezetes Név <ekezetes@example.test>',
      'noreply@example.test',
      '<noreply@example.test>',
    ]) {
      expect(formatFromHeader(raw)).toContain('@example.test')
    }
  })

  it('ASCII nevet változatlanul hagy', () => {
    expect(formatFromHeader('Kineticare <noreply@example.test>')).toBe(
      'Kineticare <noreply@example.test>',
    )
  })

  it('idézőjeles nevet is ért, és a puszta címet érintetlenül hagyja', () => {
    expect(formatFromHeader('"Kineticare" <noreply@example.test>')).toBe(
      'Kineticare <noreply@example.test>',
    )
    expect(formatFromHeader('noreply@example.test')).toBe('noreply@example.test')
    expect(formatFromHeader('<noreply@example.test>')).toBe('<noreply@example.test>')
  })

  it('a feladónévbe rejtett fejléc-injekció nem jut ki (nincs sortörés)', () => {
    const header = formatFromHeader('Rossz\r\nBcc: aldozat@example.test <noreply@example.test>')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header.endsWith(' <noreply@example.test>')).toBe(true)
  })
})

describe('stripHeaderBreaks', () => {
  it('a CR/LF (és a többi vezérlőkarakter) helyére szóköz kerül', () => {
    expect(stripHeaderBreaks('a\r\nb')).toBe('a b')
    expect(stripHeaderBreaks('a\nb')).toBe('a b')
    expect(stripHeaderBreaks('a\rb')).toBe('a b')
    expect(stripHeaderBreaks('\r\nvezeto')).toBe('vezeto')
  })

  it('a tiszta értéket nem bántja', () => {
    expect(stripHeaderBreaks('Rendelés visszaigazolása')).toBe('Rendelés visszaigazolása')
  })
})

/**
 * FEJLÉC-INJEKCIÓ: a `to` és a `subject` a hívótól jön (a címzett a
 * felhasználó által megadott e-mail-cím is lehet). CRLF-fel bármelyikbe
 * TOVÁBBI fejléc (Bcc:) vagy akár üres sor utáni saját törzs írható —
 * ezért a fejléc-építés ELŐTT eltűnnek a sortörések.
 */
describe('buildMessage — fejléc-injekció', () => {
  const config = {
    host: 'smtp.example.test',
    port: 587,
    from: 'Kineticare Értesítő <noreply@example.test>',
    fromAddress: 'noreply@example.test',
  }

  /** A fejrész (az első üres sorig) sorai — fejléc CSAK ezek között lehet. */
  const headerLinesOf = (raw: string): string[] => raw.split('\r\n\r\n')[0].split('\r\n')

  it('a tárgyba rejtett Bcc nem lesz külön fejléc', () => {
    const raw = buildMessage(config, {
      to: ['a@example.test'],
      subject: 'Rendeles\r\nBcc: aldozat@example.test',
      text: 'torzs',
      html: '<b>torzs</b>',
    })
    const lines = headerLinesOf(raw)
    expect(lines.some((line) => line.startsWith('Bcc:'))).toBe(false)
    // A beszúrt szöveg a Subject ÉRTÉKÉBEN marad, egyetlen sorban.
    expect(lines.filter((line) => line.includes('aldozat@example.test'))).toEqual([
      'Subject: Rendeles Bcc: aldozat@example.test',
    ])
  })

  it('a címzettbe rejtett fejléc sem jut ki', () => {
    const raw = buildMessage(config, {
      to: ['a@example.test\r\nBcc: aldozat@example.test'],
      subject: 'Teszt',
      text: 'torzs',
      html: '<b>torzs</b>',
    })
    const lines = headerLinesOf(raw)
    expect(lines.some((line) => line.startsWith('Bcc:'))).toBe(false)
    expect(lines[1]).toBe('To: a@example.test Bcc: aldozat@example.test')
  })

  it('a fejrészben a From után KÖZVETLENÜL a To és a Subject áll', () => {
    const raw = buildMessage(config, {
      to: ['a@example.test'],
      subject: 'Rendeles\r\nX-Hamis: 1',
      text: 'torzs',
      html: '<b>torzs</b>',
    })
    const headerLines = raw.split('\r\n\r\n')[0].split('\r\n')
    expect(headerLines[0].startsWith('From: ')).toBe(true)
    expect(headerLines[1]).toBe('To: a@example.test')
    expect(headerLines[2].startsWith('Subject: ')).toBe(true)
    expect(headerLines.some((line) => line.startsWith('X-Hamis:'))).toBe(false)
  })
})
