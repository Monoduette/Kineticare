import { describe, expect, it } from 'vitest'

import { APPOINTMENT_GENERIC_ERROR } from '../lib/appointment/submit'
import { NEWSLETTER_GENERIC_ERROR } from '../lib/newsletter/submit'
import { extractPayloadErrorMessage } from '../lib/payload-rest-error'

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
