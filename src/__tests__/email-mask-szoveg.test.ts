import { describe, expect, it } from 'vitest'

import { maskEmail, maskEmailsInText } from '../lib/email/mask'

/**
 * `maskEmailsInText` (H9): a szolgáltatói hibaszöveg a naplóba kerül, és egy
 * SMTP-elutasítás szó szerint megismételheti a vevő címét. A címnek csak a
 * maszkolt alakja maradhat, a diagnózishoz kellő szöveg (kód, ok) változatlan.
 */
describe('maskEmailsInText', () => {
  it.each([
    [
      'Postfix RCPT-elutasítás csúcsos zárójelben',
      'SMTP 450: 450 4.1.2 <anna.vevo@gmial.con>: Recipient address rejected: Domain not found',
      'SMTP 450: 450 4.1.2 <a***@gmial.con>: Recipient address rejected: Domain not found',
    ],
    [
      'Gmail 553, a cím a mondat közepén',
      'SMTP 553: 553 5.1.3 The recipient address <kiss.anna+teszt@pelda.hu> is not a valid RFC 5321 address',
      'SMTP 553: 553 5.1.3 The recipient address <k***@pelda.hu> is not a valid RFC 5321 address',
    ],
    [
      'több cím, idézőjelben és vesszővel',
      'to: "anna@pelda.hu", bela@pelda.hu; (cecil@pelda.hu)',
      'to: "a***@pelda.hu", b***@pelda.hu; (c***@pelda.hu)',
    ],
    ['szögletes zárójel', '[anna@pelda.hu]', '[a***@pelda.hu]'],
  ])('%s', (_nev, bemenet, elvart) => {
    expect(maskEmailsInText(bemenet)).toBe(elvart)
  })

  it('cím nélküli szöveget változatlanul hagy', () => {
    const szoveg =
      'Resend API hiba (HTTP 422): {"name":"validation_error","message":"Invalid `to` field."}'
    expect(maskEmailsInText(szoveg)).toBe(szoveg)
    expect(maskEmailsInText('')).toBe('')
  })

  it('a cím alakja ugyanaz, mint a maskEmail-é (a naplóban egységes)', () => {
    expect(maskEmailsInText('anna.vevo@example.test')).toBe(maskEmail('anna.vevo@example.test'))
  })

  it('a maszkolt szövegben a teljes cím helyi része sehol nem marad meg', () => {
    const kimenet = maskEmailsInText('<anna.vevo@example.test>: rejected <anna.vevo@example.test>')
    expect(kimenet).not.toContain('anna.vevo')
    expect(kimenet).toBe('<a***@example.test>: rejected <a***@example.test>')
  })
})
