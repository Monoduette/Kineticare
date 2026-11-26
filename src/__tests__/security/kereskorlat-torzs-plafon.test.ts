import { describe, expect, it } from 'vitest'

import {
  MAX_FORGOT_BODY_BYTES,
  RATE_LIMIT_RULES,
  SlidingWindowRateLimiter,
  checkForgotPasswordEmailRateLimit,
  withPayloadRestRateLimit,
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
 * A normál törzs ugyanúgy fogyasztja a cím-keretet. Az a törzs, amelyből a
 * keret nem olvas ki egyértelmű címet (plafon fölötti vagy kétértelmű
 * multipart), a belépésen és a jelszó-emlékeztetőn 400-at kap, és el sem jut
 * a Payloadig. A Payload 2 MiB-ig, multipartot busboy-jal olvas, így az ilyen
 * törzsből különben levelet küldene a cím-keret megkerülésével.
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

/** Multipart törzs a Payload admin alakjában (`_payload` JSON-mező). */
function multipartInit(ip: string, payloadJson: string): RequestInit {
  const form = new FormData()
  form.set('_payload', payloadJson)
  return { method: 'POST', headers: { 'x-forwarded-for': ip }, body: form }
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

describe('cím-keret és törzs-plafon a belépésen és a jelszó-emlékeztetőn', () => {
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

  it('PLAFON FÖLÖTTI törzs: 400, a Payload-handler nem fut (a cím-keret nem kerülhető meg)', async () => {
    let forwarded = 0
    const handler = withPayloadRestRateLimit(
      async () => {
        forwarded += 1
        return Response.json({ message: 'ok' })
      },
      { limiter: new SlidingWindowRateLimiter(), rules },
    )
    const big = jsonBody(MAX_FORGOT_BODY_BYTES + 1)
    const loginUrl = 'https://kineticare.test/api/users/login'

    for (const ip of ['203.0.113.71', '198.51.100.71', '192.0.2.71']) {
      expect((await handler(streamedRequest(big, ip))).status).toBe(400)
      expect((await handler(new Request(FORGOT_URL, multipartInit(ip, big)))).status).toBe(400)
      expect((await handler(new Request(loginUrl, multipartInit(ip, big)))).status).toBe(400)
    }
    expect(forwarded).toBe(0)

    // Egyetlen helyet sem fogyasztott: a normál kérés átmegy, a második már nem.
    expect((await handler(streamedRequest(jsonBody(4), '192.0.2.72'))).status).toBe(200)
    expect((await handler(streamedRequest(jsonBody(4), '192.0.2.73'))).status).toBe(429)
    expect(forwarded).toBe(1)
  })

  /**
   * A FormData és a Payload busboy-parsere másképp olvassa a kétszer küldött
   * `_payload`-ot: a FormData az elsőt (üres → nincs cím), a Payload az utolsó
   * nem üreset (az áldozat címe). Fájl-részként küldött első `_payload`-nál
   * ugyanez a helyzet. Ezért csak pontosan egy szöveges `_payload` fogadható.
   */
  it('kétértelmű multipart `_payload` → 400, a Payload-handler nem fut', async () => {
    let forwarded = 0
    const handler = withPayloadRestRateLimit(
      async () => {
        forwarded += 1
        return Response.json({ message: 'ok' })
      },
      { limiter: new SlidingWindowRateLimiter(), rules },
    )
    const victim = JSON.stringify({ email: 'aldozat@example.test' })

    const emptyFirst = new FormData()
    emptyFirst.append('_payload', '')
    emptyFirst.append('_payload', victim)
    const fileFirst = new FormData()
    fileFirst.append('_payload', new Blob(['x']), 'x.txt')
    fileFirst.append('_payload', victim)

    for (const body of [emptyFirst, fileFirst]) {
      const request = new Request(FORGOT_URL, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.75' },
        body,
      })
      expect((await handler(request)).status).toBe(400)
    }
    expect(forwarded).toBe(0)
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
  })
})
