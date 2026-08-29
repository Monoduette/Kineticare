import { describe, expect, it } from 'vitest'

import {
  MAX_FORGOT_BODY_BYTES,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
  checkForgotPasswordEmailRateLimit,
} from '../../lib/security/rate-limit'
import { readBodyBytesWithCap, readBodyWithCap } from '../../lib/security/request-body'

/**
 * ŐR — a törzs-plafon a TÉNYLEGESEN beolvasott bájtokat méri.
 *
 * A korábbi kapu a deklarált `content-length` fejlécre épült. Az a fejléc
 * KÉT módon is megkerülhető: chunked átvitelnél egyáltalán nincs (a Node
 * `Request` streamelt törzsnél nem tölti ki), és a kliens kisebbet is
 * hazudhat a valóságnál. Mindkét esetben a régi kód korlátlan méretű törzset
 * húzott a memóriába — pont azon a végponton, amelyik hitelesítés nélkül,
 * bárki által hívható.
 *
 * A keret VISELKEDÉSE nem változik: túl nagy törzsnél nincs cím-kulcsú keret
 * (marad az IP-keret), a normál törzs pedig ugyanúgy fogyaszt.
 */

const TEN_MINUTES = 10 * 60_000

/** A cím-keret 1-re szűkítve: a MÁSODIK hívás már elutasítás. */
const rules = {
  ...RATE_LIMIT_RULES,
  'password-forgot-email': { limit: 1, windowMs: TEN_MINUTES },
  'password-forgot': { limit: 100, windowMs: TEN_MINUTES },
}

const FORGOT_URL = 'https://kineticare.test/api/users/forgot-password'

/** JSON-törzs `pad` mezővel, hogy a méret pontosan állítható legyen. */
function jsonBody(padBytes: number): string {
  return JSON.stringify({ email: 'aldozat@example.test', pad: 'x'.repeat(padBytes) })
}

/** Streamelt (chunked) törzs — a Node ilyenkor NEM ad `content-length`-t. */
function streamedRequest(body: string, ip: string): Request {
  const bytes = new TextEncoder().encode(body)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Request(FORGOT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

/** Ugyanaz a törzs, de HAZUG (kicsi) `content-length` fejléccel. */
function lyingLengthRequest(body: string, ip: string): Request {
  return new Request(FORGOT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '12',
      'x-forwarded-for': ip,
    },
    body,
  })
}

describe('readBodyWithCap — a tényleges méret dönt', () => {
  it('content-length NÉLKÜL is elutasítja a plafon fölötti törzset', async () => {
    const request = streamedRequest(jsonBody(64), '203.0.113.60')
    expect(request.headers.get('content-length')).toBeNull()
    expect(await readBodyWithCap(request, 16)).toBeNull()
  })

  it('a HAZUG (kisebb) content-length nem engedi át a nagy törzset', async () => {
    const body = jsonBody(64)
    const request = lyingLengthRequest(body, '203.0.113.61')
    expect(request.headers.get('content-length')).toBe('12')
    expect(await readBodyWithCap(request, 16)).toBeNull()
  })

  it('a plafon alatti törzset változatlanul visszaadja', async () => {
    const body = jsonBody(4)
    expect(await readBodyWithCap(streamedRequest(body, '203.0.113.62'), 4096)).toBe(body)
  })

  it('a pontosan plafon-méretű törzs még átmegy, az eggyel nagyobb már nem', async () => {
    const body = 'x'.repeat(100)
    expect(await readBodyWithCap(streamedRequest(body, '203.0.113.63'), 100)).toBe(body)
    expect(await readBodyWithCap(streamedRequest(body, '203.0.113.64'), 99)).toBeNull()
  })

  it('törzs nélküli kérésnél üres bájttömb (nem hiba)', async () => {
    const request = new Request(FORGOT_URL, { method: 'POST' })
    const bytes = await readBodyBytesWithCap(request, 16)
    expect(bytes).not.toBeNull()
    expect(bytes?.byteLength).toBe(0)
  })

  it('KLÓNOZOTT törzsön sem akad meg: a megszakításra tilos várni (await → örök blokk)', async () => {
    const form = new FormData()
    form.set('_payload', JSON.stringify({ email: 'a@b.test', pad: 'x'.repeat(70_000) }))
    const request = new Request(FORGOT_URL, { method: 'POST', body: form })

    // A tee másik ágát SENKI nem olvassa — `await reader.cancel()` itt sosem
    // rendeződne, és a kérés végtelenül állna (a teszt időtúllépéssel bukna).
    expect(await readBodyBytesWithCap(request.clone(), 1024)).toBeNull()

    // Az EREDETI kérés törzse ettől érintetlenül olvasható marad.
    const form2 = await request.formData()
    expect(String(form2.get('_payload')).length).toBeGreaterThan(70_000)
  })
})

describe('checkForgotPasswordEmailRateLimit — a keret viselkedése változatlan', () => {
  it('NORMÁL törzsnél a cím-keret ugyanúgy fogyaszt', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const body = jsonBody(4)
    expect(
      await checkForgotPasswordEmailRateLimit(streamedRequest(body, '203.0.113.70'), {
        limiter,
        rules,
      }),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(streamedRequest(body, '198.51.100.70'), {
        limiter,
        rules,
      }),
    ).not.toBeNull()
  })

  it('PLAFON FÖLÖTTI, content-length nélküli törzsnél nincs cím-keret', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const big = jsonBody(MAX_FORGOT_BODY_BYTES + 1)

    for (const ip of ['203.0.113.71', '198.51.100.71', '192.0.2.71']) {
      expect(
        await checkForgotPasswordEmailRateLimit(streamedRequest(big, ip), { limiter, rules }),
      ).toBeNull()
    }
    // Egyetlen helyet sem fogyasztott: a normál kérés még belefér a keretbe.
    expect(
      await checkForgotPasswordEmailRateLimit(streamedRequest(jsonBody(4), '192.0.2.72'), {
        limiter,
        rules,
      }),
    ).toBeNull()
  })

  it('a multipart ág is a plafonig olvas, és a `_payload` mezőt így is érti', async () => {
    const limiter = new SlidingWindowRateLimiter()
    const multipart = (ip: string, pad: string): Request => {
      const form = new FormData()
      form.set('_payload', JSON.stringify({ email: 'admin-uton@example.test', pad }))
      return new Request(FORGOT_URL, {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
        body: form,
      })
    }

    expect(
      await checkForgotPasswordEmailRateLimit(multipart('203.0.113.73', 'x'), { limiter, rules }),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(multipart('198.51.100.73', 'x'), { limiter, rules }),
    ).not.toBeNull()

    // A plafon fölötti multipart törzsből nem lesz cím-kulcs.
    const nagyLimiter = new SlidingWindowRateLimiter()
    expect(
      await checkForgotPasswordEmailRateLimit(
        multipart('192.0.2.73', 'x'.repeat(MAX_FORGOT_BODY_BYTES + 1)),
        { limiter: nagyLimiter, rules },
      ),
    ).toBeNull()
    expect(
      await checkForgotPasswordEmailRateLimit(multipart('192.0.2.74', 'x'), {
        limiter: nagyLimiter,
        rules,
      }),
    ).toBeNull()
  })
})
