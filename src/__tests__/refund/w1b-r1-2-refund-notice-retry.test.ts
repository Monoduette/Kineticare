import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Logger } from '../../lib/logger'
import type { Order, RefundIntent } from '../../payload-types'

/**
 * A vevői visszatérítési értesítő újrapróbálása a Resend-határon (W1B-5).
 *
 * A valódi sendMail → sendViaResend lánc fut, a hálózatot a `fetch` stubja
 * adja (CLAUDE.md 15. tanulság: valódi hívás nincs). A szünetet az injektált
 * `sleep` rögzíti, így a teszt nem vár. A szolgáltató-választás modul-szintű
 * gyorsítótár, ezért minden teszt friss modulgráfot tölt be.
 */

const INTENT_ID = 11
const KEY = `refund:${INTENT_ID}`

interface LoggedError {
  message: string
  context: Record<string, unknown>
}

function spyLogger() {
  const errors: LoggedError[] = []
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, context) => {
      errors.push({ message, context: (context ?? {}) as Record<string, unknown> })
    },
    child: () => log,
  }
  return { log, errors }
}

function ok(id: string): Response {
  return new Response(JSON.stringify({ id }), { status: 200 })
}

function timeout(): never {
  throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('RESEND_API_KEY', 'DUMMY-resend-key')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function send(responses: Array<() => Response | Promise<Response>>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = responses.shift()
    if (!next) throw new Error('UNEXPECTED EXTRA RESEND CALL')
    return next()
  })
  vi.stubGlobal('fetch', fetchMock)
  const { sendRefundNotice } = await import('../../lib/refund/refund-notice')
  const { log, errors } = spyLogger()
  const audits: Array<{ action: string; after: Record<string, unknown> }> = []
  const payload = {
    find: async () => ({ docs: [], totalDocs: 0 }),
    create: async ({ data }: { data: { action: string; after: Record<string, unknown> } }) => {
      audits.push(data)
      return { id: audits.length }
    },
  }
  const sleeps: number[] = []
  await sendRefundNotice({
    payload: payload as never,
    order: {
      id: 7,
      orderNumber: 'KH-2026-000123',
      customerEmail: 'vevo@example.com',
      customerSnapshot: { name: 'Teszt Vevő', email: 'vevo@example.com' },
      items: [{ product: 42, quantity: 1, titleSnapshot: 'Kézterápia alapok' }],
    } as unknown as Order,
    intent: { id: INTENT_ID, actor: 1, refundSequence: 1 } as unknown as RefundIntent,
    entry: {
      transactionId: 'tx',
      amountHuf: 5000,
      status: 'Succeeded',
      refundedAt: '2026-09-24T10:00:00.000Z',
      type: 'partial',
    },
    kind: 'partial',
    document: 'corrective',
    logger: log,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  const keys = fetchMock.mock.calls.map(
    ([, init]) => (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'],
  )
  return { calls: fetchMock.mock.calls.length, keys, errors, audits, sleeps }
}

describe('a vevői értesítő átmeneti Resend-hiba után ugyanazzal a kulccsal újra megy', () => {
  it.each([
    ['503', () => new Response('upstream', { status: 503 })],
    ['429', () => new Response('rate limited', { status: 429 })],
    [
      '409 concurrent_idempotent_requests',
      () =>
        new Response(JSON.stringify({ name: 'concurrent_idempotent_requests' }), { status: 409 }),
    ],
    [
      'hálózati hiba',
      () => {
        throw new TypeError('fetch failed')
      },
    ],
  ] as const)('%s, majd 200: két kérés, egy levél, riasztás nélkül', async (_label, first) => {
    const result = await send([first, () => ok('msg-2')])
    expect(result.calls).toBe(2)
    expect(result.keys).toEqual([KEY, KEY])
    expect(result.sleeps).toEqual([1000])
    expect(result.errors).toEqual([])
    expect(result.audits).toEqual([
      expect.objectContaining({
        action: 'refund-notice-email',
        after: expect.objectContaining({ providerMessageId: 'msg-2', idempotencyKey: KEY }),
      }),
    ])
  })
})

describe('a záró riasztás megkülönbözteti a biztos és a bizonytalan elmaradást', () => {
  it('tartós időtúllépés: három kérés, bizonytalan riasztás a kulccsal, „NEM ment ki” nélkül', async () => {
    const result = await send([timeout, timeout, timeout])
    expect(result.calls).toBe(3)
    expect(result.keys).toEqual([KEY, KEY, KEY])
    expect(result.sleeps).toEqual([1000, 3000])
    expect(result.errors).toHaveLength(1)
    const [alert] = result.errors
    expect(alert?.message).toMatch(
      /^RIASZTÁS: a vevői visszatérítési értesítő kiküldése bizonytalan/u,
    )
    expect(alert?.message).toContain(KEY)
    expect(alert?.message).not.toContain('NEM ment ki')
    expect(alert?.context.alertCode).toBe('visszateritesi-ertesito-bizonytalan')
    expect(result.audits).toEqual([])
  })

  it('végleges elutasítás (422): egy kérés, „NEM ment ki” riasztás a saját kódjával', async () => {
    const result = await send([
      () => new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }),
    ])
    expect(result.calls).toBe(1)
    expect(result.sleeps).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toMatch(
      /^RIASZTÁS: a vevői visszatérítési értesítő NEM ment ki\./u,
    )
    expect(result.errors[0]?.context.alertCode).toBe('visszateritesi-ertesito-nem-ment-ki')
  })

  it('lassú időtúllépéseknél az időkeret megállítja: két kérés, és a panel 30 másodperce alatt marad', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    // Egy valódi Resend-időtúllépés 10 másodpercig tart (email/resend.ts).
    const slowTimeout = () => {
      vi.setSystemTime(Date.now() + 10_000)
      return timeout()
    }
    const result = await send([slowTimeout, slowTimeout, slowTimeout])
    expect(result.calls).toBe(2)
    expect(result.sleeps).toEqual([1000])
    const elapsed = Date.now() - start + result.sleeps.reduce((sum, ms) => sum + ms, 0)
    expect(elapsed).toBeLessThan(30_000)
    expect(result.errors.map((entry) => entry.context.alertCode)).toEqual([
      'visszateritesi-ertesito-bizonytalan',
    ])
  })
})
