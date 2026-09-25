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
const SUBJECT_HINT = 'a vevő címére küldött „Visszatérítés: KH-2026-000123” tárgyú levelet'
const TEMPLATE_MODULE = '../../lib/email/templates/refund'
const EMAIL_MODULE = '../../lib/email'

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
  vi.doUnmock(TEMPLATE_MODULE)
  vi.doUnmock(EMAIL_MODULE)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function send(
  responses: Array<() => Response | Promise<Response>>,
  options: { sleep?: (ms: number) => Promise<void> } = {},
) {
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
      await options.sleep?.(ms)
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
  it('tartós időtúllépés: három kérés, bizonytalan riasztás a levél tárgyával, „NEM ment ki” nélkül', async () => {
    const result = await send([timeout, timeout, timeout])
    expect(result.calls).toBe(3)
    expect(result.keys).toEqual([KEY, KEY, KEY])
    expect(result.sleeps).toEqual([1000, 3000])
    expect(result.errors).toHaveLength(1)
    const [alert] = result.errors
    expect(alert?.message).toMatch(
      /^RIASZTÁS: a vevői visszatérítési értesítő kiküldése bizonytalan/u,
    )
    // A Resend felületén biztosan kereshető fogódzó: a címzett és a tárgy.
    expect(alert?.message).toContain(`keresd meg a Resend felületén (Emails) ${SUBJECT_HINT}`)
    expect(alert?.message).not.toContain('NEM ment ki')
    expect(alert?.context).toMatchObject({
      alertCode: 'visszateritesi-ertesito-bizonytalan',
      idempotencyKey: KEY,
    })
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

  // A w1-fogyasztoi ág SMTP-szolgáltatója a levél lezárása után megszakadt
  // kapcsolatot `retryable: false, deliveryUncertain: true` eredménnyel adja
  // (a levél célba érhetett). Ez nem végleges elutasítás: a „küldd el kézzel”
  // a vevőnek második levelet íratna.
  it('bizonytalan kézbesítés (SMTP): egy kérés, újrapróbálás nélkül, bizonytalan riasztás', async () => {
    const uncertain = {
      ok: false,
      provider: 'smtp',
      retryable: false,
      deliveryUncertain: true,
      error: 'SMTP kapcsolat megszakadt a levél lezárása után',
    }
    const sendMail = vi.fn(async () => uncertain)
    vi.doMock(EMAIL_MODULE, async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../lib/email')>()),
      sendMail,
    }))
    const result = await send([])
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(result.calls).toBe(0)
    expect(result.sleeps).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).not.toContain('NEM ment ki')
    expect(result.errors[0]?.message).toContain('a levélküldő szolgáltató naplójában')
    expect(result.errors[0]?.context.alertCode).toBe('visszateritesi-ertesito-bizonytalan')
  })

  // Váratlan kivétel: innen nem tudható, hogy a levél előtt vagy után jött,
  // ezért nem mondhatja, hogy a levél NEM ment ki.
  it('váratlan kivétel (a sablon dob): nem dob tovább, bizonytalan riasztás a rendelésszámmal', async () => {
    vi.doMock(TEMPLATE_MODULE, async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../lib/email/templates/refund')>()),
      refundNoticeEmail: () => {
        throw new Error('SYNTHETIC sablonhiba')
      },
    }))
    const result = await send([])
    expect(result.calls).toBe(0)
    expect(result.errors).toHaveLength(1)
    const [alert] = result.errors
    expect(alert?.message).toMatch(/^RIASZTÁS: .*kiküldése bizonytalan/u)
    expect(alert?.message).not.toContain('NEM ment ki')
    expect(alert?.message).toContain('a KH-2026-000123 rendelésszámot a tárgyában viselő levelet')
    expect(alert?.context).toMatchObject({
      alertCode: 'visszateritesi-ertesito-bizonytalan',
      idempotencyKey: KEY,
    })
  })
})

describe('az időkeret az értesítő teljes idejét korlátozza', () => {
  // A szolgáltatói válasz és az injektált szünet is a (hamisított) órát
  // viszi előre, így a mért idő az értesítő kezdetétől a végéig tart.
  const after =
    (ms: number, answer: () => Response): (() => Response) =>
    () => {
      vi.setSystemTime(Date.now() + ms)
      return answer()
    }
  const upstream = () => new Response('upstream', { status: 503 })
  const slowTimeout = () => {
    vi.setSystemTime(Date.now() + 10_000)
    return timeout()
  }
  it.each([
    // Törő B4: lassú 5xx-ek után a harmadik, 10 másodperces kísérlet már nem fér bele.
    [
      'kétszer 5,5 s-os 503, majd egy időtúllépés',
      [after(5_500, upstream), after(5_500, upstream), slowTimeout],
      2,
      12_000,
    ],
    ['két 10 s-os időtúllépés', [slowTimeout, slowTimeout, slowTimeout], 2, 21_000],
    ['gyors átmeneti hibák', [upstream, upstream, upstream], 3, 4_000],
  ] as const)(
    '%s: a kísérletek száma és az értesítő ideje a 21 másodperces kereten belül',
    async (_label, answers, calls, elapsedMs) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const start = Date.now()
      const result = await send([...answers], {
        sleep: async (ms) => {
          vi.setSystemTime(Date.now() + ms)
        },
      })
      const elapsed = Date.now() - start
      expect(result.calls).toBe(calls)
      expect(elapsed).toBe(elapsedMs)
      expect(elapsed).toBeLessThanOrEqual(21_000)
      expect(result.errors.map((entry) => entry.context.alertCode)).toEqual([
        'visszateritesi-ertesito-bizonytalan',
      ])
    },
  )
})
