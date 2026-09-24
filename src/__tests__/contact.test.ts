import { describe, expect, it } from 'vitest'

import {
  buildSubmissionPayload,
  GENERIC_SUBMIT_ERROR,
  isTurnstileEnabled,
  submitContactForm,
} from '../app/(frontend)/kapcsolat/_lib/submit'
import {
  EMPTY_CONTACT_VALUES,
  isContactFormValid,
  MESSAGE_MIN_LENGTH,
  validateContactForm,
  type ContactFormValues,
} from '../app/(frontend)/kapcsolat/_lib/validation'
import { APPOINTMENT_CONSENT_ERROR } from '../lib/appointment/validation'
import { FREE_COURSE_CONSENT_ERROR } from '../lib/free-course/validation'
import { NEWSLETTER_CONSENT_ERROR } from '../lib/newsletter/validation'

/** Minden szempontból érvényes űrlap-állapot (a hozzájárulás bepipálva). */
function validValues(overrides: Partial<ContactFormValues> = {}): ContactFormValues {
  return {
    name: 'Kovács Anna',
    email: 'anna@pelda.hu',
    subject: 'Kérdés a kurzusról',
    message: 'Érdeklődnék a kézrehabilitációs program részleteiről.',
    consentPrivacy: true,
    ...overrides,
  }
}

describe('validateContactForm', () => {
  it('adatkezelési hozzájárulás nélkül blokkolja a beküldést (consent kötelező)', () => {
    const errors = validateContactForm(validValues({ consentPrivacy: false }))
    expect(errors.consentPrivacy).toBeDefined()
    expect(errors.consentPrivacy).toContain('hozzájárulás')
    expect(isContactFormValid(errors)).toBe(false)
  })

  /**
   * A NEGYEDIK űrlap felzárkóztatása (2026-08-22). A hozzájárulás-hiba a másik
   * három űrlapon már a teendőt mondja meg; a kapcsolat-űrlapon a szabályt
   * idézte („…megadása kötelező."). Ugyanaz a helyzet ugyanazt a mondatot kell
   * kapja: WCAG 2.2 · 3.2.4 Consistent Identification.
   * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
   */
  it('a hozzájárulás-hiba SZÓ SZERINT azonos a másik három űrlapéval (WCAG 3.2.4)', () => {
    const errors = validateContactForm(validValues({ consentPrivacy: false }))
    expect(errors.consentPrivacy).toBe('Pipáld be az adatkezelési hozzájárulást.')
    expect(errors.consentPrivacy).toBe(FREE_COURSE_CONSENT_ERROR)
    expect(errors.consentPrivacy).toBe(NEWSLETTER_CONSENT_ERROR)
    expect(errors.consentPrivacy).toBe(APPOINTMENT_CONSENT_ERROR)
  })

  it('üres űrlapra minden kötelező mezőre magyar hibaüzenetet ad', () => {
    const errors = validateContactForm(EMPTY_CONTACT_VALUES)
    expect(errors.name).toBeDefined()
    expect(errors.email).toBeDefined()
    expect(errors.subject).toBeDefined()
    expect(errors.message).toBeDefined()
    expect(errors.consentPrivacy).toBeDefined()
    expect(isContactFormValid(errors)).toBe(false)
  })

  it('csak whitespace-s kitöltést is hibának vesz', () => {
    const errors = validateContactForm(
      validValues({ name: '   ', subject: '  ', message: '        ' }),
    )
    expect(errors.name).toBeDefined()
    expect(errors.subject).toBeDefined()
    expect(errors.message).toBeDefined()
  })

  it('formailag hibás e-mail-címet visszautasít', () => {
    for (const email of ['nem-email', 'hianyzik@tld', '@pelda.hu', 'szokoz @pelda.hu']) {
      const errors = validateContactForm(validValues({ email }))
      expect(errors.email).toBeDefined()
    }
  })

  it(`a ${MESSAGE_MIN_LENGTH} karakternél rövidebb üzenetet visszautasít`, () => {
    const errors = validateContactForm(validValues({ message: 'rövid' }))
    expect(errors.message).toContain(String(MESSAGE_MIN_LENGTH))
  })

  it('teljes, hozzájárulást tartalmazó űrlapra nincs hiba', () => {
    const errors = validateContactForm(validValues())
    expect(isContactFormValid(errors)).toBe(true)
  })
})

describe('buildSubmissionPayload', () => {
  it('a T-016 szerződés szerinti mezőket küldi (name, email, subject, message, consentPrivacy)', () => {
    const payload = buildSubmissionPayload(validValues(), '42')
    expect(payload.form).toBe('42')
    expect(payload.submissionData).toEqual([
      { field: 'name', value: 'Kovács Anna' },
      { field: 'email', value: 'anna@pelda.hu' },
      { field: 'subject', value: 'Kérdés a kurzusról' },
      { field: 'message', value: 'Érdeklődnék a kézrehabilitációs program részleteiről.' },
      { field: 'consentPrivacy', value: 'true' },
    ])
    expect(payload.turnstileToken).toBeUndefined()
  })

  it('a mezőértékeket trimmeli', () => {
    const payload = buildSubmissionPayload(validValues({ name: '  Kovács Anna  ' }), '42')
    expect(payload.submissionData[0]).toEqual({ field: 'name', value: 'Kovács Anna' })
  })

  it('turnstileToken csak akkor kerül a törzsbe, ha van token', () => {
    const without = buildSubmissionPayload(validValues(), '42', null)
    expect('turnstileToken' in without).toBe(false)
    const withToken = buildSubmissionPayload(validValues(), '42', 'cf-token-123')
    expect(withToken.turnstileToken).toBe('cf-token-123')
  })
})

describe('submitContactForm (mockolt API)', () => {
  it('siker-ág: 201-es válaszra ok, és a T-016 végpontra POST-ol', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    const mockFetch = async (input: string, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ doc: { id: 7 } }), { status: 201 })
    }

    const result = await submitContactForm(
      buildSubmissionPayload(validValues(), '42', 'cf-token-123'),
      mockFetch,
    )

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe('/api/form-submissions')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(body.form).toBe('42')
    expect(body.turnstileToken).toBe('cf-token-123')
    const fields = (body.submissionData as Array<{ field: string }>).map((entry) => entry.field)
    expect(fields).toEqual(['name', 'email', 'subject', 'message', 'consentPrivacy'])
  })

  it('szerverhiba-ág: a Payload magyar hibaüzenetét továbbítja (pl. Turnstile 400)', async () => {
    const turnstileMessage =
      'A spam-ellenőrzés nem sikerült. Frissítsd az oldalt, és küldd el újra az űrlapot.'
    const mockFetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: turnstileMessage }] }), { status: 400 })

    const result = await submitContactForm(buildSubmissionPayload(validValues(), '42'), mockFetch)

    expect(result).toEqual({ ok: false, message: turnstileMessage })
  })

  it('nem JSON hibaválaszra általános magyar hibaüzenetet ad', async () => {
    const mockFetch = async () => new Response('Internal Server Error', { status: 500 })
    const result = await submitContactForm(buildSubmissionPayload(validValues(), '42'), mockFetch)
    expect(result).toEqual({ ok: false, message: GENERIC_SUBMIT_ERROR })
  })

  it('a Payload maszkolt angol 500-asa („Something went wrong.") helyett magyar üzenetet ad', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Something went wrong.' }] }), {
        status: 500,
      })
    const result = await submitContactForm(buildSubmissionPayload(validValues(), '42'), mockFetch)
    expect(result).toEqual({ ok: false, message: GENERIC_SUBMIT_ERROR })
  })

  it('hálózati hibára (fetch dob) általános magyar hibaüzenetet ad', async () => {
    const mockFetch = async () => {
      throw new Error('network down')
    }
    const result = await submitContactForm(buildSubmissionPayload(validValues(), '42'), mockFetch)
    expect(result).toEqual({ ok: false, message: GENERIC_SUBMIT_ERROR })
  })
})

describe('isTurnstileEnabled (widget környezetfüggő rejtése)', () => {
  it('site key nélkül a widget rejtve marad', () => {
    expect(isTurnstileEnabled(null)).toBe(false)
    expect(isTurnstileEnabled(undefined)).toBe(false)
    expect(isTurnstileEnabled('')).toBe(false)
    expect(isTurnstileEnabled('   ')).toBe(false)
  })

  it('beállított site key mellett a widget megjelenik', () => {
    expect(isTurnstileEnabled('0x4AAAAAA...')).toBe(true)
  })
})
