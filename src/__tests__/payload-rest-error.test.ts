import { describe, expect, it } from 'vitest'

import { submitContactForm } from '../app/(frontend)/kapcsolat/_lib/submit'
import { APPOINTMENT_GENERIC_ERROR, submitAppointmentForm } from '../lib/appointment/submit'
import { NEWSLETTER_GENERIC_ERROR, submitNewsletterForm } from '../lib/newsletter/submit'
import {
  DUPLICATE_SUBMISSION_STATUS,
  extractPayloadErrorMessage,
  isSubmissionAccepted,
} from '../lib/payload-rest-error'

/**
 * A Payload REST hibaválaszának fordítása látogatói üzenetre. A Payload a nem
 * nyilvános 500-as hibák szövegét angol „Something went wrong."-ra cseréli;
 * ezt a látogató nem láthatja, helyette a hívó magyar általános üzenete jön.
 */

const TARTALEK = 'Általános magyar hibaüzenet.'

function jsonValasz(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('extractPayloadErrorMessage', () => {
  it('a saját magyar APIError-üzenetet szó szerint visszaadja', async () => {
    const uzenet = 'A spam-ellenőrzés most nem érhető el. Próbáld újra néhány perc múlva.'
    await expect(
      extractPayloadErrorMessage(jsonValasz({ errors: [{ message: uzenet }] }, 503), TARTALEK),
    ).resolves.toBe(uzenet)
  })

  it.each(['Something went wrong.', 'Something went wrong', '  something went wrong.  '])(
    'a Payload maszkolt angol hibája (%j) helyett a magyar tartalék jön',
    async (angol) => {
      await expect(
        extractPayloadErrorMessage(jsonValasz({ errors: [{ message: angol }] }, 500), TARTALEK),
      ).resolves.toBe(TARTALEK)
      await expect(
        extractPayloadErrorMessage(jsonValasz({ message: angol }), TARTALEK),
      ).resolves.toBe(TARTALEK)
    },
  )

  it('üres vagy csak szóközös üzenetnél a tartalék jön', async () => {
    await expect(
      extractPayloadErrorMessage(jsonValasz({ errors: [{ message: '' }] }), TARTALEK),
    ).resolves.toBe(TARTALEK)
    await expect(
      extractPayloadErrorMessage(jsonValasz({ errors: [{ message: '   ' }] }), TARTALEK),
    ).resolves.toBe(TARTALEK)
    await expect(extractPayloadErrorMessage(jsonValasz({}), TARTALEK)).resolves.toBe(TARTALEK)
  })

  it('üres első hiba után a felső szintű, megjeleníthető message jön', async () => {
    await expect(
      extractPayloadErrorMessage(
        jsonValasz({ errors: [{ message: '' }], message: 'Ellenőrizd az e-mail-címet.' }),
        TARTALEK,
      ),
    ).resolves.toBe('Ellenőrizd az e-mail-címet.')
    await expect(
      extractPayloadErrorMessage(
        jsonValasz({ errors: [{ message: 'Something went wrong.' }, { message: 'Pontos hiba.' }] }),
        TARTALEK,
      ),
    ).resolves.toBe('Pontos hiba.')
  })

  it('nem JSON válasznál a tartalék jön', async () => {
    await expect(
      extractPayloadErrorMessage(new Response('<html>502</html>', { status: 502 }), TARTALEK),
    ).resolves.toBe(TARTALEK)
  })

  it('a hívók magyar tartalékai érvényesülnek a maszkolt 500-asnál', async () => {
    for (const tartalek of [NEWSLETTER_GENERIC_ERROR, APPOINTMENT_GENERIC_ERROR]) {
      const valasz = jsonValasz({ errors: [{ message: 'Something went wrong.' }] }, 500)
      await expect(extractPayloadErrorMessage(valasz, tartalek)).resolves.toBe(tartalek)
    }
  })
})

describe('ismételt beküldés (409) a klienseken: sikerként', () => {
  const ismetles = async () =>
    Response.json(
      { errors: [{ message: 'Ezt a beküldést már megkaptuk, köszönjük.' }] },
      { status: DUPLICATE_SUBMISSION_STATUS },
    )

  it('isSubmissionAccepted: 2xx és 409 igen, más hiba nem', () => {
    expect(isSubmissionAccepted(new Response(null, { status: 201 }))).toBe(true)
    expect(isSubmissionAccepted(new Response(null, { status: 409 }))).toBe(true)
    expect(isSubmissionAccepted(new Response(null, { status: 400 }))).toBe(false)
    expect(isSubmissionAccepted(new Response(null, { status: 503 }))).toBe(false)
  })

  it('kapcsolat, hírlevél és időpontkérés: a 409 { ok: true }', async () => {
    await expect(submitContactForm({ form: '1', submissionData: [] }, ismetles)).resolves.toEqual({
      ok: true,
    })
    await expect(
      submitNewsletterForm({ form: '1', submissionData: [] }, ismetles),
    ).resolves.toEqual({ ok: true })
    await expect(
      submitAppointmentForm({ form: '1', submissionData: [] }, ismetles),
    ).resolves.toEqual({ ok: true })
  })
})
