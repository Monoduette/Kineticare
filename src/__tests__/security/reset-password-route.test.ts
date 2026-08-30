import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PASSWORD_MIN_LENGTH } from '../../lib/security/password-policy'
import { RATE_LIMIT_MESSAGE, RATE_LIMIT_RULES, SlidingWindowRateLimiter } from '../../lib/security/rate-limit'
import {
  createResetPasswordHandler,
  RESET_BODY_TOO_LARGE_MESSAGE,
  RESET_INVALID_BODY_MESSAGE,
  RESET_MISSING_INPUT_MESSAGE,
  RESET_PASSWORD_BODY_MAX_BYTES,
  RESET_UNEXPECTED_ERROR_MESSAGE,
} from '../../lib/security/reset-password-route'

/**
 * C1 — POST /api/users/reset-password: a jelszó-politika SZERVEROLDALI
 * kikényszerítése a jelszó-visszaállítás útvonalán.
 *
 * A VALÓDI handler fut; a Payload local API és a beépített reset-végpont
 * injektált (a grant-purchase-route.test.ts és a checkout-start.test.ts
 * mintája). A kérés-korlátozó MINDEN esetben saját, friss példány, hogy a
 * tesztek ne fogyasszák egymás keretét (a modul-szintű alapértelmezett
 * számláló megosztott lenne).
 */

const URL = 'http://localhost:3000/api/users/reset-password'
const EMAIL = 'vevo@example.test'
// DUMMY fixtúrák, egyértelműen jelölve — NEM valódi token/jelszó (a repo
// titok-kapujának, a gitleaksnek a konvenciója: stopwordöt hordozó DUMMY-érték;
// a jelszó a .gitleaks.toml-ban már triázsolt minta).
const TOKEN = 'DUMMY-RESET-TOKEN-NEM-VALODI'
const STRONG_PASSWORD = 'DUMMY-Eros-Teszt-Jelszo-42'

interface HarnessOptions {
  /** A tokenhez feloldott e-mail; `null` = a token nem oldható fel (lejárt/ismeretlen). */
  email?: string | null
  /** Az e-mail-feloldás dobjon-e (DB-hiba szimulálása). */
  findThrows?: boolean
  /** A továbbadott (Payload-)végpont válasza. */
  forwardResponse?: () => Response
  /** A továbbadás dobjon-e (váratlan technikai hiba). */
  forwardThrows?: boolean
}

interface FindArgs {
  collection: string
  where?: Record<string, unknown>
  overrideAccess?: boolean
  limit?: number
}

function createHarness(options: HarnessOptions = {}) {
  const findCalls: FindArgs[] = []
  const forwarded: Request[] = []

  const payload = {
    find: vi.fn(async (args: FindArgs) => {
      findCalls.push(args)
      if (options.findThrows) {
        throw new Error('adatbázis nem elérhető')
      }
      const email = options.email === undefined ? EMAIL : options.email
      return email === null ? { docs: [] } : { docs: [{ id: 7, email }] }
    }),
  }

  const forwardToPayload = vi.fn(async (request: Request) => {
    forwarded.push(request)
    if (options.forwardThrows) {
      throw new Error('a Payload-végpont elszállt')
    }
    return (
      options.forwardResponse?.() ??
      Response.json(
        { message: 'Password reset successfully.', user: { id: 7, email: EMAIL } },
        { status: 200, headers: { 'Set-Cookie': 'payload-token=jwt; Path=/; HttpOnly' } },
      )
    )
  })

  const handler = createResetPasswordHandler({
    getPayload: async () => payload as unknown as Payload,
    forwardToPayload,
    // Friss számláló tesztenként — a kereten belüli hívások sosem ütköznek.
    rateLimit: { limiter: new SlidingWindowRateLimiter() },
  })

  return { handler, forwardToPayload, forwarded, findCalls, payload }
}

function postRequest(body: unknown, raw?: string): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  })
}

/**
 * A Payload ADMIN reset-oldala (`/admin/reset/<token>`) nem JSON-t küld: a
 * `@payloadcms/ui` Form komponense FormData-t POST-ol, a mezőket egyetlen
 * `_payload` nevű JSON-sztringbe csomagolva.
 */
function adminFormRequest(data: Record<string, unknown>): Request {
  const form = new FormData()
  form.set('_payload', JSON.stringify(data))
  return new Request(URL, { method: 'POST', body: form })
}

async function messageOf(response: Response): Promise<string> {
  const body = (await response.json()) as { errors?: Array<{ message?: string }> }
  return body.errors?.[0]?.message ?? ''
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reset-password végpont — a politika nem kerülhető meg', () => {
  it('a rövid jelszót elutasítja (400), és a Payload-végpont EL SEM INDUL', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest({ token: TOKEN, password: 'Rovid1' }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toContain(`legalább ${PASSWORD_MIN_LENGTH} karakter`)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('a hosszú, de csupa kisbetűs jelszót elutasítja (nagybetű + szám hiánya)', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest({ token: TOKEN, password: 'csupakisbetuvel' }))
    const message = await messageOf(response)

    expect(response.status).toBe(400)
    expect(message).toContain('nagybetűt')
    expect(message).toContain('számot')
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('a tokenből feloldott e-mailt tartalmazó jelszót elutasítja', async () => {
    const { handler, forwardToPayload } = createHarness({ email: EMAIL })

    const response = await handler(postRequest({ token: TOKEN, password: 'Vevo2026Kineti' }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toContain('nem tartalmazhatja az e-mail-címedet')
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('erős jelszóval a Payload-végpontra delegál, és a válaszát változatlanul adja vissza', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest({ token: TOKEN, password: STRONG_PASSWORD }))

    expect(forwardToPayload).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    // A session-sütit és a válaszformátumot végig a Payload adja — nem írjuk újra.
    expect(response.headers.get('Set-Cookie')).toContain('payload-token=')
    expect(await response.json()).toMatchObject({ user: { email: EMAIL } })
  })

  it('a továbbadott kérés törzse ÉRINTETLEN (a Payload ugyanazt olvassa ki)', async () => {
    const { handler, forwarded } = createHarness()
    const request = postRequest({ token: TOKEN, password: STRONG_PASSWORD })

    await handler(request)

    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]?.method).toBe('POST')
    expect(forwarded[0]?.url).toBe(URL)
    expect([...forwarded[0]!.headers.entries()]).toEqual([...request.headers.entries()])
    expect(await forwarded[0]!.json()).toEqual({ token: TOKEN, password: STRONG_PASSWORD })
  })

  it('a Payload hibáját (pl. 403 — lejárt token) változatlanul továbbengedi', async () => {
    const { handler } = createHarness({
      email: null,
      forwardResponse: () =>
        Response.json(
          { errors: [{ message: 'Token is either invalid or has expired.' }] },
          { status: 403 },
        ),
    })

    const response = await handler(postRequest({ token: TOKEN, password: STRONG_PASSWORD }))

    expect(response.status).toBe(403)
  })
})

describe('reset-password végpont — bemenet-ellenőrzés', () => {
  it('hiányzó token → 400, magyar üzenet, nincs továbbadás', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest({ password: STRONG_PASSWORD }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toBe(RESET_MISSING_INPUT_MESSAGE)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('hiányzó jelszó → 400, ugyanaz az üzenet (a két hiányt nem különbözteti meg)', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest({ token: TOKEN }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toBe(RESET_MISSING_INPUT_MESSAGE)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('nem szöveges mezők → 400 (a JSON-ból bármi jöhet)', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest({ token: 42, password: ['x'] }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toBe(RESET_MISSING_INPUT_MESSAGE)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('nem JSON törzs → 400, magyar üzenet', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest(undefined, 'nem-json'))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toBe(RESET_INVALID_BODY_MESSAGE)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('JSON null törzs → 400 (nem dob TypeError-t)', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(postRequest(undefined, 'null'))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toBe(RESET_MISSING_INPUT_MESSAGE)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('a ténylegesen túlméretes JSON-t hamis kis content-length mellett is 413-mal elutasítja', async () => {
    const { handler, forwardToPayload, payload } = createHarness()
    const request = new Request(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
      body: JSON.stringify({
        token: TOKEN,
        password: STRONG_PASSWORD,
        padding: 'x'.repeat(RESET_PASSWORD_BODY_MAX_BYTES),
      }),
    })

    const response = await handler(request)

    expect(response.status).toBe(413)
    expect(await messageOf(response)).toBe(RESET_BODY_TOO_LARGE_MESSAGE)
    expect(payload.find).not.toHaveBeenCalled()
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('a túlméretes chunked streamet az eredeti body olvasásakor megállítja és nem forwardolja', async () => {
    const { handler, forwardToPayload, payload } = createHarness()
    const chunk = new Uint8Array(Math.floor(RESET_PASSWORD_BODY_MAX_BYTES / 2) + 1)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    const request = new Request(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const response = await handler(request)

    expect(response.status).toBe(413)
    expect(await messageOf(response)).toBe(RESET_BODY_TOO_LARGE_MESSAGE)
    expect(payload.find).not.toHaveBeenCalled()
    expect(forwardToPayload).not.toHaveBeenCalled()
  })
})

describe('reset-password végpont — az admin űrlapja (multipart) is átmegy a politikán', () => {
  it('a multipart törzsben érkező gyenge jelszót elutasítja', async () => {
    const { handler, forwardToPayload } = createHarness()

    const response = await handler(adminFormRequest({ token: TOKEN, password: 'Rovid1' }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toContain(`legalább ${PASSWORD_MIN_LENGTH} karakter`)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('erős jelszóval továbbadja, és a multipart törzs olvasható marad', async () => {
    const { handler, forwarded } = createHarness()
    const request = adminFormRequest({ token: TOKEN, password: STRONG_PASSWORD })

    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(forwarded).toHaveLength(1)
    expect([...forwarded[0]!.headers.entries()]).toEqual([...request.headers.entries()])
    expect(await forwarded[0]!.formData().then((form) => form.get('_payload'))).toBe(
      JSON.stringify({ token: TOKEN, password: STRONG_PASSWORD }),
    )
  })

  it('`_payload` mező nélküli multipart → hiányzó adat, nincs továbbadás', async () => {
    const { handler, forwardToPayload } = createHarness()
    const form = new FormData()
    form.set('token', TOKEN)

    const response = await handler(new Request(URL, { method: 'POST', body: form }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toBe(RESET_MISSING_INPUT_MESSAGE)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('a ténylegesen túlméretes multipart törzset parse előtt 413-mal elutasítja', async () => {
    const { handler, forwardToPayload, payload } = createHarness()
    const boundary = '----kineticare-reset-cap-test'
    const rawPayload = JSON.stringify({
      token: TOKEN,
      password: STRONG_PASSWORD,
      padding: 'x'.repeat(RESET_PASSWORD_BODY_MAX_BYTES),
    })
    const rawMultipart =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="_payload"\r\n\r\n' +
      `${rawPayload}\r\n` +
      `--${boundary}--\r\n`
    const response = await handler(
      new Request(URL, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: rawMultipart,
      }),
    )

    expect(response.status).toBe(413)
    expect(await messageOf(response)).toBe(RESET_BODY_TOO_LARGE_MESSAGE)
    expect(payload.find).not.toHaveBeenCalled()
    expect(forwardToPayload).not.toHaveBeenCalled()
  })
})

describe('reset-password végpont — e-mail-feloldás', () => {
  it('a lekérdezés a tokenre ÉS az érvényességi időre szűr, access-ellenőrzés nélkül', async () => {
    const { handler, findCalls } = createHarness()

    await handler(postRequest({ token: TOKEN, password: STRONG_PASSWORD }))

    expect(findCalls).toHaveLength(1)
    expect(findCalls[0]?.collection).toBe('users')
    expect(findCalls[0]?.overrideAccess).toBe(true)
    expect(findCalls[0]?.limit).toBe(1)
    expect(findCalls[0]?.where).toMatchObject({ resetPasswordToken: { equals: TOKEN } })
    expect(findCalls[0]?.where).toHaveProperty('resetPasswordExpiration')
  })

  it('ha a feloldás dob (DB-hiba), a többi szabály ATTÓL MÉG érvényesül', async () => {
    const { handler, forwardToPayload } = createHarness({ findThrows: true })

    const response = await handler(postRequest({ token: TOKEN, password: 'rovid' }))

    expect(response.status).toBe(400)
    expect(await messageOf(response)).toContain(`legalább ${PASSWORD_MIN_LENGTH} karakter`)
    expect(forwardToPayload).not.toHaveBeenCalled()
  })

  it('ha a feloldás dob, az erős jelszó továbbmegy (a token sorsáról a Payload dönt)', async () => {
    const { handler, forwardToPayload } = createHarness({ findThrows: true })

    const response = await handler(postRequest({ token: TOKEN, password: STRONG_PASSWORD }))

    expect(response.status).toBe(200)
    expect(forwardToPayload).toHaveBeenCalledTimes(1)
  })
})

describe('reset-password végpont — kérés-korlát (A2)', () => {
  it('a keret fölött 429, Retry-After fejléccel, és a Payload-végpont EL SEM INDUL', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const forwardToPayload = vi.fn(async () => Response.json({ ok: true }, { status: 200 }))
    const handler = createResetPasswordHandler({
      getPayload: async () =>
        ({ find: async () => ({ docs: [] }) }) as unknown as Payload,
      forwardToPayload,
      rateLimit: { limiter },
    })
    const send = () => handler(postRequest({ token: TOKEN, password: STRONG_PASSWORD }))

    for (let index = 0; index < RATE_LIMIT_RULES['password-reset'].limit; index += 1) {
      expect((await send()).status).toBe(200)
    }

    const throttled = await send()

    expect(throttled.status).toBe(429)
    expect(await messageOf(throttled)).toBe(RATE_LIMIT_MESSAGE)
    expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(forwardToPayload).toHaveBeenCalledTimes(RATE_LIMIT_RULES['password-reset'].limit)
  })
})

describe('reset-password végpont — hibatűrés és naplózás', () => {
  it('a továbbadás váratlan hibája → 500, magyar üzenet (nem szivárog stacktrace)', async () => {
    const { handler } = createHarness({ forwardThrows: true })

    const response = await handler(postRequest({ token: TOKEN, password: STRONG_PASSWORD }))

    expect(response.status).toBe(500)
    expect(await messageOf(response)).toBe(RESET_UNEXPECTED_ERROR_MESSAGE)
  })

  it('sem a token, sem a jelszó NEM kerül a naplóba', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '))
    })
    const { handler } = createHarness()

    await handler(postRequest({ token: TOKEN, password: 'Gyenge1' }))

    // A politika-sértés naplózódik (különben a visszaélés-minta láthatatlan)…
    expect(lines.join('\n')).toContain('jelszó-politikának')
    // …de titok nélkül.
    expect(lines.join('\n')).not.toContain(TOKEN)
    expect(lines.join('\n')).not.toContain('Gyenge1')
  })
})
