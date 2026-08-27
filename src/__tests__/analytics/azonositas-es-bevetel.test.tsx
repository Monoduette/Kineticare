import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { trackedLogin } from '@/components/auth/LoginForm'
import { trackedRegister } from '@/components/auth/RegisterForm'
import {
  purchaseEventProperties,
  shouldEmitPurchaseConfirmed,
} from '@/components/checkout/ThankYouView'
import { loginUser, registerUser } from '@/lib/auth-client'
import { createOrderStatusHandler } from '@/lib/checkout/order-status-handler'
import { logoutUser } from '@/lib/logout-client'
import { pollOrderStatus } from '@/lib/order-status-poll'

/**
 * ŐR-TESZT: PostHog AZONOSÍTÁS és BEVÉTEL-MÉRÉS.
 * 1. AZONOSÍTÁS. A `src/lib/analytics/posthog.ts` `person_profiles:
 * 'identified_only'` beállítása miatt person-profil KIZÁRÓLAG `identify()`
 * után jön létre. Enélkül a profilok száma tartósan nulla: minden esemény
 * anonim marad, és a „ki tért vissza / mekkora a megtartás / kik
 */

/** A globális `fetch` sosem hívható innen — ha mégis, hangosan bukik. */
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('TILOS: a teszt valódi hálózati hívást indított')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Valódi `Response` — a kiolvasás `response.clone().json()`-t használ. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A hívásokat rögzítő, injektált `fetch` (valódi hálózat nélkül). */
function fetchReturning(response: () => Response): {
  fetchImpl: typeof fetch
  calls: Array<{ url: string; init: RequestInit | undefined }>
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response()
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const LOGIN_INPUT = { email: 'teszt@example.invalid', password: 'nagyon-hosszu-jelszo' }
const REGISTER_INPUT = {
  email: 'teszt@example.invalid',
  password: 'nagyon-hosszu-jelszo',
  name: 'Teszt Elek',
}

describe('azonosítás — sikeres BELÉPÉS', () => {
  it('a sikeres belépés után identify() fut, a Payload user.id-val', async () => {
    // A Payload REST login-válasza: { message, user, token, exp }
    // (node_modules/payload/dist/auth/endpoints/login.js).
    const { fetchImpl, calls } = fetchReturning(() =>
      jsonResponse(200, {
        message: 'Auth Passed',
        token: 'nem-kerul-sehova',
        exp: 1893456000,
        user: { id: 4242, email: LOGIN_INPUT.email, name: 'Teszt Elek' },
      }),
    )
    const identified: Array<number | string> = []

    const result = await trackedLogin(LOGIN_INPUT, {
      login: loginUser,
      track: () => true,
      identify: (userId) => {
        identified.push(userId)
        return true
      },
      fetchImpl,
    })

    expect(result.ok).toBe(true)
    expect(calls.map((call) => call.url)).toEqual(['/api/users/login'])
    // A DÖNTŐ ÁLLÍTÁS: pontosan egy azonosítás, pontosan a Payload id-val.
    expect(identified).toEqual([4242])
  })

  it('SIKERTELEN belépés után NINCS identify (a hibás jelszó nem felhasználó)', async () => {
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse(401, { errors: [{ message: 'Hibás e-mail-cím vagy jelszó.' }] }),
    )
    const identified: Array<number | string> = []

    const result = await trackedLogin(LOGIN_INPUT, {
      login: loginUser,
      track: () => true,
      identify: (userId) => {
        identified.push(userId)
        return true
      },
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(identified).toEqual([])
  })

  it('E-MAIL, NÉV, JELSZÓ és IP SOHA nem kerül az azonosításba — csak a numerikus id', async () => {
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse(200, {
        message: 'Auth Passed',
        user: {
          id: 4242,
          email: LOGIN_INPUT.email,
          name: 'Teszt Elek',
          lastLoginIp: '203.0.113.7',
        },
      }),
    )
    const identified: unknown[] = []

    await trackedLogin(LOGIN_INPUT, {
      login: loginUser,
      track: () => true,
      identify: (userId) => {
        identified.push(userId)
        return true
      },
      fetchImpl,
    })

    expect(identified).toHaveLength(1)
    const payload = JSON.stringify(identified)
    for (const secret of [LOGIN_INPUT.email, LOGIN_INPUT.password, 'Teszt Elek', '203.0.113.7']) {
      expect(payload).not.toContain(secret)
    }
    expect(identified[0]).toBe(4242)
  })

  it('az AZONOSÍTÁS HIBÁJA nem ronthatja el a belépést', async () => {
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse(200, { message: 'Auth Passed', user: { id: 7 } }),
    )

    await expect(
      trackedLogin(LOGIN_INPUT, {
        login: loginUser,
        track: () => true,
        identify: () => {
          throw new Error('a PostHog elszállt')
        },
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true })
  })

  it('értelmezhetetlen válasz-törzs (nincs user.id) → nincs identify, de a belépés sikeres', async () => {
    const { fetchImpl } = fetchReturning(() => jsonResponse(200, { message: 'Auth Passed' }))
    const identified: Array<number | string> = []

    const result = await trackedLogin(LOGIN_INPUT, {
      login: loginUser,
      track: () => true,
      identify: (userId) => {
        identified.push(userId)
        return true
      },
      fetchImpl,
    })

    expect(result.ok).toBe(true)
    expect(identified).toEqual([])
  })
})

describe('azonosítás — sikeres REGISZTRÁCIÓ', () => {
  it('a sikeres regisztráció után identify() fut, az új doc.id-val', async () => {
    // A Payload REST create-válasza: { doc, message }, 201
    // (node_modules/payload/dist/collections/endpoints/create.js).
    const { fetchImpl, calls } = fetchReturning(() =>
      jsonResponse(201, {
        message: 'Users successfully created.',
        doc: { id: 99, email: REGISTER_INPUT.email, name: REGISTER_INPUT.name },
      }),
    )
    const identified: Array<number | string> = []

    const result = await trackedRegister(REGISTER_INPUT, {
      register: registerUser,
      track: () => true,
      identify: (userId) => {
        identified.push(userId)
        return true
      },
      fetchImpl,
    })

    expect(result.ok).toBe(true)
    expect(calls.map((call) => call.url)).toEqual(['/api/users'])
    expect(identified).toEqual([99])
    // Adatvédelmi őr: a beírt név és e-mail-cím nem hagyhatja el a láncot.
    const payload = JSON.stringify(identified)
    expect(payload).not.toContain(REGISTER_INPUT.email)
    expect(payload).not.toContain(REGISTER_INPUT.name)
  })

  it('ELUTASÍTOTT regisztráció (foglalt e-mail) után NINCS identify', async () => {
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse(409, { errors: [{ message: 'Ez az e-mail-cím már foglalt.' }] }),
    )
    const identified: Array<number | string> = []

    const result = await trackedRegister(REGISTER_INPUT, {
      register: registerUser,
      track: () => true,
      identify: (userId) => {
        identified.push(userId)
        return true
      },
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(identified).toEqual([])
  })
})

describe('reset() — KIJELENTKEZÉS', () => {
  it('sikeres kijelentkezés után elengedi az analitikai azonosságot', async () => {
    const { fetchImpl, calls } = fetchReturning(() =>
      jsonResponse(200, { message: 'Kijelentkezve' }),
    )
    let resets = 0

    const result = await logoutUser(fetchImpl, () => {
      resets += 1
    })

    expect(result).toEqual({ ok: true })
    expect(calls[0]?.url).toBe('/api/users/logout')
    // A DÖNTŐ ÁLLÍTÁS: reset nélkül a következő látogató eseményei az előző
    // felhasználó profiljára mennének (közös gép).
    expect(resets).toBe(1)
  })

  it('SIKERTELEN kijelentkezés után NINCS reset (a munkamenet még él)', async () => {
    const { fetchImpl } = fetchReturning(() => jsonResponse(400, { message: 'No User' }))
    let resets = 0

    const result = await logoutUser(fetchImpl, () => {
      resets += 1
    })

    expect(result.ok).toBe(false)
    expect(resets).toBe(0)
  })

  it('a reset HIBÁJA nem ronthatja el a kijelentkezést', async () => {
    const { fetchImpl } = fetchReturning(() => jsonResponse(200, { message: 'Kijelentkezve' }))

    await expect(
      logoutUser(fetchImpl, () => {
        throw new Error('a PostHog elszállt')
      }),
    ).resolves.toEqual({ ok: true })
  })
})

/** A státusz-végpont teszt-mockja (csak a saját rendelést adja vissza). */
function payloadWithOrder(order: Record<string, unknown> | null) {
  return {
    auth: vi.fn().mockResolvedValue({ user: { id: 7 } }),
    find: vi.fn().mockResolvedValue({ docs: order ? [order] : [] }),
  }
}

function statusRequest(): [Request, { params: Promise<{ orderNumber: string }> }] {
  const req = new Request('http://localhost/api/orders/KH-2026-000123/status', {
    headers: new Headers({ 'x-request-id': 'test-bevetel-1' }),
  })
  return [req, { params: Promise.resolve({ orderNumber: 'KH-2026-000123' }) }]
}

describe('bevétel — a státusz-végpont kiadja a végösszeget', () => {
  it('a totalHufSnapshot és a currency kimegy (a mérvadó mező a snapshot)', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () =>
        payloadWithOrder({
          status: 'paid',
          items: [{ product: 42 }],
          totalHufSnapshot: 19990,
          amount: 19990,
          currency: 'HUF',
        }) as never,
    })
    const [req, ctx] = statusRequest()
    const body = await (await handler(req as never, ctx)).json()

    expect(body).toEqual({
      status: 'paid',
      productId: 42,
      totalHufSnapshot: 19990,
      currency: 'HUF',
    })
  })

  it('a lekérdezés a SAJÁT rendelésre szűkít (customer = a belépett user) — ezért nem szivárgás', async () => {
    const payload = payloadWithOrder({
      status: 'paid',
      items: [],
      totalHufSnapshot: 19990,
      currency: 'HUF',
    })
    const handler = createOrderStatusHandler({ getPayload: async () => payload as never })
    const [req, ctx] = statusRequest()
    await handler(req as never, ctx)

    const where = (payload.find.mock.calls[0]?.[0] as { where: { and: unknown[] } }).where
    expect(where.and).toContainEqual({ customer: { equals: 7 } })
  })

  it('hiányzó snapshot esetén az amount a TARTALÉK', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () =>
        payloadWithOrder({
          status: 'paid',
          items: [],
          totalHufSnapshot: null,
          amount: 5000,
          currency: 'huf',
        }) as never,
    })
    const [req, ctx] = statusRequest()
    const body = await (await handler(req as never, ctx)).json()

    expect(body.totalHufSnapshot).toBe(5000)
    // A pénznem normalizálva megy ki (ISO-4217, nagybetűs).
    expect(body.currency).toBe('HUF')
  })

  it('érvénytelen összeg (NaN, negatív, szöveg) → null, NEM kivétel', async () => {
    for (const total of [Number.NaN, -1, '19990', undefined, null]) {
      const handler = createOrderStatusHandler({
        getPayload: async () =>
          payloadWithOrder({
            status: 'paid',
            items: [],
            totalHufSnapshot: total,
            currency: 'HUF',
          }) as never,
      })
      const [req, ctx] = statusRequest()
      const response = await handler(req as never, ctx)
      expect(response.status).toBe(200)
      expect((await response.json()).totalHufSnapshot).toBeNull()
    }
  })

  it('a 0 Ft ÉRVÉNYES összeg (ingyenes rendelés), nem hiányzó adat', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () =>
        payloadWithOrder({
          status: 'paid',
          items: [],
          totalHufSnapshot: 0,
          currency: 'HUF',
        }) as never,
    })
    const [req, ctx] = statusRequest()
    expect((await (await handler(req as never, ctx)).json()).totalHufSnapshot).toBe(0)
  })

  it('a válasz továbbra sem tartalmaz egyéb rendelésadatot (customer, e-mail, tételek)', async () => {
    const handler = createOrderStatusHandler({
      getPayload: async () =>
        payloadWithOrder({
          status: 'paid',
          items: [{ product: 42 }],
          totalHufSnapshot: 19990,
          currency: 'HUF',
          customer: 7,
          customerEmail: 'vevo@example.invalid',
          orderNumber: 'KH-2026-000123',
          barionPaymentId: 'guid-1',
          invoiceNumber: 'SZ-1',
        }) as never,
    })
    const [req, ctx] = statusRequest()
    const body = await (await handler(req as never, ctx)).json()

    expect(Object.keys(body)).toEqual(['status', 'productId', 'totalHufSnapshot', 'currency'])
    expect(JSON.stringify(body)).not.toContain('vevo@example.invalid')
  })
})

describe('bevétel — a poll továbbadja az összeget', () => {
  it('a 200-as törzsből value + currency lesz', async () => {
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse(200, {
        status: 'paid',
        productId: 42,
        totalHufSnapshot: 19990,
        currency: 'HUF',
      }),
    )

    expect(await pollOrderStatus('KH-2026-000123', fetchImpl)).toEqual({
      kind: 'status',
      status: 'paid',
      productId: 42,
      value: 19990,
      currency: 'HUF',
    })
  })

  it('hiányzó vagy érvénytelen összeg → value: null, a státusz attól még status', async () => {
    for (const total of [undefined, null, -5, 'sok', Number.NaN]) {
      const { fetchImpl } = fetchReturning(() =>
        jsonResponse(200, { status: 'paid', productId: 42, totalHufSnapshot: total }),
      )
      expect(await pollOrderStatus('X', fetchImpl)).toEqual({
        kind: 'status',
        status: 'paid',
        productId: 42,
        value: null,
        currency: null,
      })
    }
  })
})

describe('bevétel — a purchase_confirmed esemény tulajdonságai', () => {
  it('value + currency megy ki a rendelésszám mellett', () => {
    expect(purchaseEventProperties('KH-2026-000123', { value: 19990, currency: 'HUF' })).toEqual({
      orderNumber: 'KH-2026-000123',
      value: 19990,
      currency: 'HUF',
    })
  })

  it('hiányzó összeg esetén a kulcs KIMARAD (a value: null hamis nulla-bevétel lenne)', () => {
    expect(purchaseEventProperties('KH-2026-000123', { value: null, currency: null })).toEqual({
      orderNumber: 'KH-2026-000123',
    })
    expect(purchaseEventProperties('KH-2026-000123', { value: null, currency: 'HUF' })).toEqual({
      orderNumber: 'KH-2026-000123',
      currency: 'HUF',
    })
  })

  it('a 0 Ft-os rendelés összege KIMEGY (nem hiányzó adat)', () => {
    expect(purchaseEventProperties('KH-2026-000999', { value: 0, currency: 'HUF' })).toEqual({
      orderNumber: 'KH-2026-000999',
      value: 0,
      currency: 'HUF',
    })
  })

  it('SZEMÉLYES ADAT nem kerül az eseménybe — csak rendelésszám, összeg, pénznem', () => {
    const properties = purchaseEventProperties('KH-2026-000123', { value: 19990, currency: 'HUF' })
    expect(Object.keys(properties).sort()).toEqual(['currency', 'orderNumber', 'value'])
  })
})

describe('bevétel — purchase_confirmed CSAK paid státuszra megy ki', () => {
  /**
   * Vendég Barion-visszatérésnél a státusz-végpont 401 (`unauthorized`):
   * nincs munkamenet, a kliens nem tudja, paid-e a rendelés. Hamis
   * paid-eseményt küldeni rosszabb, mint a lyukat dokumentálni.
   * A kapu a ThankYouView exportált `shouldEmitPurchaseConfirmed`
   * függvénye — a poll-effekt DOM nélkül nem futtatható.
   */
  const paid = {
    kind: 'status' as const,
    status: 'paid' as const,
    productId: 42,
    value: 19990,
    currency: 'HUF',
  }

  it('kind: status + paid → megy (a bejelentkezett, visszaigazolt ág)', () => {
    expect(shouldEmitPurchaseConfirmed(paid)).toBe(true)
  })

  it('unauthorized / not-found / error / timeout → NEM megy', () => {
    expect(shouldEmitPurchaseConfirmed({ kind: 'unauthorized' })).toBe(false)
    expect(shouldEmitPurchaseConfirmed({ kind: 'not-found' })).toBe(false)
    expect(shouldEmitPurchaseConfirmed({ kind: 'error' })).toBe(false)
    expect(shouldEmitPurchaseConfirmed({ kind: 'timeout' })).toBe(false)
  })

  it('nem-paid státusz (elutasított, függő, törölt) → NEM megy', () => {
    for (const status of [
      'created',
      'payment_pending',
      'payment_failed',
      'cancelled',
      'refunded',
    ] as const) {
      expect(
        shouldEmitPurchaseConfirmed({
          kind: 'status',
          status,
          productId: 42,
          value: 19990,
          currency: 'HUF',
        }),
      ).toBe(false)
    }
  })

  it('a köszönőoldal a kapun keresztül küld — 401-es ágon nincs capture', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile('src/components/checkout/ThankYouView.tsx', 'utf8')
    expect(src).toContain('shouldEmitPurchaseConfirmed(result)')
    expect(src).toMatch(
      /if \(shouldEmitPurchaseConfirmed\(result\)[\s\S]*?captureAnalyticsEvent\(\s*'purchase_confirmed'/,
    )

    function agCaptureNelkul(kezdet: string): void {
      const start = src.indexOf(kezdet)
      expect(start, `hiányzik: ${kezdet}`).toBeGreaterThan(-1)
      const veg = src.indexOf('return', start)
      expect(veg).toBeGreaterThan(start)
      expect(src.slice(start, veg + 6)).not.toContain('captureAnalyticsEvent')
    }

    agCaptureNelkul("result.kind === 'unauthorized'")
    agCaptureNelkul("result.kind === 'not-found'")
    agCaptureNelkul("setState({ kind: 'timeout'")
  })
})
