import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../lib/alert-throttle'
import {
  CHECKOUT_TURNSTILE_MISSING_ERROR,
  CHECKOUT_TURNSTILE_REJECTED_ERROR,
  CHECKOUT_TURNSTILE_UNAVAILABLE_ERROR,
  TURNSTILE_TOKEN_MAX_LENGTH,
  createCheckoutStartHandler,
} from '../lib/checkout/route-handler'
import { startCheckout } from '../lib/checkout/start-checkout'
import { TURNSTILE_SITEVERIFY_URL } from '../lib/security/turnstile-verify'
import { SlidingWindowRateLimiter } from '../lib/security/rate-limit'

/**
 * a-checkout-9 — LÁTHATATLAN TURNSTILE a POST /api/checkout/start előtt.
 *
 * A szerződés, amit ez a fájl véd:
 *  - bekapcsolt ellenőrzésnél (TURNSTILE_SECRET_KEY) token nélkül, rossz
 *    tokennel vagy elérhetetlen Cloudflare mellett a kérés a Payload-betöltés
 *    és az auth ELŐTT megáll: se rendelés, se Barion-fizetés nem születik;
 *  - a Cloudflare kiesése NEM néma: 503 + magyar üzenet a vevőnek és
 *    RIASZTÁS a naplóban (a form-builder útjának mintája), a rossz token
 *    viszont 400 (a vevő újrapróbálhat);
 *  - a token sehol nem kerül a naplóba.
 *
 * Valódi hálózati hívás nem mehet ki: a siteverify a globális `fetch` kémén
 * fut (CLAUDE.md 15.).
 */

/**
 * A szolgáltatás a VALÓDI `startCheckout`, csak megfigyelve: így látszik, mi
 * jut el hozzá a kérés törzséből (a token nem juthat).
 */
vi.mock('../lib/checkout/start-checkout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/checkout/start-checkout')>()
  return { ...actual, startCheckout: vi.fn(actual.startCheckout) }
})

const SECRET = 'DUMMY-TURNSTILE-SECRET-NEM-VALODI'
const TOKEN = 'DUMMY-TURNSTILE-TOKEN-0123456789'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(startCheckout).mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TURNSTILE_SECRET_KEY', SECRET)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetAlertThrottle()
})

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://shop.example.test/api/checkout/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.30' },
    body: JSON.stringify(body),
  })
}

const INPUT = {
  productId: 42,
  quantity: 1,
  consentWithdrawalWaiver: true,
  consentTerms: true,
  billing: { name: 'Minta Mari', zip: '1011', city: 'Budapest', street: 'Fő utca 1.' },
}

/** A Payload-betöltés kéme: ha a Turnstile megállít, ide el sem juthat a kérés. */
function handler() {
  const getPayload = vi.fn(async () => {
    // Vendég, `guest` blokk nélkül: a szolgáltatás magyar 400-zal áll meg,
    // tehát a továbbengedett kérés sem indít Barion-hívást.
    return { auth: async () => ({ user: null }) } as unknown as Payload
  })
  const POST = createCheckoutStartHandler({
    getPayload,
    rateLimit: { limiter: new SlidingWindowRateLimiter() },
  })
  return { POST, getPayload }
}

function siteverify(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/checkout/start — Turnstile a Payload-auth ELŐTT', () => {
  it('bekapcsolt ellenőrzésnél token nélkül 400, magyar üzenettel, Payload-betöltés és siteverify nélkül', async () => {
    const { POST, getPayload } = handler()

    const response = await POST(request(INPUT))

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe(
      CHECKOUT_TURNSTILE_MISSING_ERROR,
    )
    expect(getPayload).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * Mindhárom LÁTOGATÓI hibakód (Cloudflare, Turnstile server-side
   * validation, „Error codes"): a hamis vagy szemét token
   * `invalid-input-response`, az üres `missing-input-response`, a lejárt vagy
   * már felhasznált `timeout-or-duplicate`. Ezek a vevő (vagy a bot) oldalán
   * dőlnek el: 400, és NEM kiesés. Ha bármelyik kikerülne a látogatói kódok
   * közül, minden hamis tokenes botkérés 503-at adna, és a tulajdonos
   * Cloudflare-kiesésről kapna RIASZTÁS-t (a fojtás egy valódi kiesést is
   * elfedne).
   */
  it.each(['timeout-or-duplicate', 'invalid-input-response', 'missing-input-response'])(
    'elutasított tokennél (%s) 400 (újrapróbálható), RIASZTÁS nélkül, és a kérés nem jut a Payloadig',
    async (code) => {
      fetchMock.mockResolvedValueOnce(siteverify({ success: false, 'error-codes': [code] }))
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { POST, getPayload } = handler()

      const response = await POST(request({ ...INPUT, turnstileToken: TOKEN }))

      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toBe(
        CHECKOUT_TURNSTILE_REJECTED_ERROR,
      )
      expect(getPayload).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(TURNSTILE_SITEVERIFY_URL)
      expect(new URLSearchParams(String(init.body)).get('response')).toBe(TOKEN)
      const naplo = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join('\n')
      expect(naplo).not.toContain('RIASZTÁS')
    },
  )

  it.each([
    ['hálózati hiba', () => Promise.reject(new TypeError('fetch failed'))],
    ['HTTP 502', () => Promise.resolve(siteverify({}, 502))],
    ['nem értelmezhető törzs', () => Promise.resolve(siteverify({ valami: 1 }))],
    [
      'szolgáltatói hibakód',
      () => Promise.resolve(siteverify({ success: false, 'error-codes': ['internal-error'] })),
    ],
  ])(
    'elérhetetlen Cloudflare (%s): 503 magyar üzenettel, RIASZTÁS a naplóban, token nélkül',
    async (_nev, valasz) => {
      fetchMock.mockImplementationOnce(valasz)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { POST, getPayload } = handler()

      const response = await POST(request({ ...INPUT, turnstileToken: TOKEN }))

      expect(response.status).toBe(503)
      expect(((await response.json()) as { error: string }).error).toBe(
        CHECKOUT_TURNSTILE_UNAVAILABLE_ERROR,
      )
      expect(getPayload).not.toHaveBeenCalled()
      const naplo = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join('\n')
      expect(naplo).toContain('RIASZTÁS')
      expect(naplo).not.toContain(TOKEN)
    },
  )

  it('elfogadott tokennél a kérés továbbmegy a szolgáltatáshoz, a token nélkül', async () => {
    fetchMock.mockResolvedValueOnce(siteverify({ success: true }))
    const { POST, getPayload } = handler()

    const response = await POST(request({ ...INPUT, turnstileToken: TOKEN }))

    expect(getPayload).toHaveBeenCalledTimes(1)
    // A token csak az ellenőrzéshez kell: a szolgáltatás bemenetébe (és így a
    // rendelésre, a naplóba) nem jut el, a többi mező viszont változatlanul igen.
    expect(startCheckout).toHaveBeenCalledTimes(1)
    const input = vi.mocked(startCheckout).mock.calls[0][0].input
    expect(input).not.toHaveProperty('turnstileToken')
    expect(input).toEqual(INPUT)
    // Vendég-adat nélkül a szolgáltatás a saját 400-ját adja: a kérés tehát a
    // Turnstile-kapun túljutott, és Barion-hívás sem indult.
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain(
      'add meg az e-mail-címed és a neved',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('túl hosszú (a Cloudflare 2048 karakteres korlátja feletti) token 400, siteverify és RIASZTÁS nélkül', async () => {
    // Ha mégis kimenne, a siteverify kéréshibát adhatna, amit a pénztár a
    // szolgáltatás kiesésének (503 + RIASZTÁS) venne.
    fetchMock.mockResolvedValue(siteverify({ success: false, 'error-codes': ['bad-request'] }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST, getPayload } = handler()

    const response = await POST(
      request({ ...INPUT, turnstileToken: 'x'.repeat(TURNSTILE_TOKEN_MAX_LENGTH + 1) }),
    )

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe(
      CHECKOUT_TURNSTILE_REJECTED_ERROR,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getPayload).not.toHaveBeenCalled()
    const naplo = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join('\n')
    expect(naplo).not.toContain('RIASZTÁS')
  })

  it('secret nélkül (az ellenőrzés kikapcsolva) nincs siteverify-hívás, a kérés továbbmegy', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const { POST, getPayload } = handler()

    await POST(request(INPUT))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(getPayload).toHaveBeenCalledTimes(1)
  })
})
