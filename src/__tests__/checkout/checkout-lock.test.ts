import type { Payload } from 'payload'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'

import { CHECKOUT_PAYMENT_STATE_UNAVAILABLE } from '../../lib/checkout/pending-payment'
import {
  CHECKOUT_REFUNDED_RETRY,
  CheckoutError,
  startCheckout,
} from '../../lib/checkout/start-checkout'
import type { Order, Product, User } from '../../payload-types'

/**
 * S2 — checkout-zár (TOCTOU) + rendelésszám-újrapróbálás.
 *
 * (1) ZÁR: az `assertNoDuplicatePurchase` + `payload.create` pár klasszikus
 *     check-then-act. Zár nélkül két párhuzamos kérés MINDKETTŐ ellenőrzése
 *     átmegy (a másik rendelése még nem létezik), és két aktív payment_pending
 *     rendelés jön létre ugyanarra a kurzusra. A teszt a valódi advisory-zár
 *     helyére egy kulcsonkénti, in-memory mutexet tesz, és azt igazolja, hogy
 *     a védett szakaszok NEM lapolódnak át — így a második kérés már látja az
 *     elsőt, és 409-cel elhasal.
 *
 * (2) A Barion Payment/Start a záron KÍVÜL fut: a hálózati hívás nem tarthatja
 *     a zárat (a pool idle_in_transaction_session_timeout-ja 60 mp).
 *
 * (3) RETRY: a rendelésszám „max + 1" mintája egyidejű create-eknél 23505-öt
 *     adhat; ez újrapróbálandó ütközés, nem 500-as technikai hiba.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const DUMMY_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const ORDER_NUMBER = 'KH-2026-000123'
const GATEWAY_URL = `https://secure.test.barion.com/Pay?id=${DUMMY_PAYMENT_ID}`

/**
 * A valódi advisory-zár helyére kulcsonkénti in-memory mutex kerül. Így a
 * sorosítás determinisztikusan megfigyelhető, valódi Postgres nélkül.
 */
const lockState = {
  /** A védett szakaszok belépés/kilépés naplója (kulccsal). */
  events: [] as string[],
  /** Az egyidejűleg futó védett szakaszok maximuma — soros zárnál mindig 1. */
  maxConcurrent: 0,
  current: 0,
  chains: new Map<string, Promise<unknown>>(),
  reset(): void {
    this.events = []
    this.maxConcurrent = 0
    this.current = 0
    this.chains = new Map()
  },
}

vi.mock('../../lib/advisory-lock', () => ({
  withAdvisoryLock: async <T>(
    _payload: unknown,
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const previous = lockState.chains.get(lockKey) ?? Promise.resolve()
    const run = previous.then(async () => {
      lockState.events.push(`enter:${lockKey}`)
      lockState.current += 1
      lockState.maxConcurrent = Math.max(lockState.maxConcurrent, lockState.current)
      try {
        return await fn()
      } finally {
        lockState.current -= 1
        lockState.events.push(`exit:${lockKey}`)
      }
    })
    // A láncot a HIBÁS ág se törje meg: a következő várakozó akkor is induljon.
    lockState.chains.set(
      lockKey,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run as Promise<T>
  },
}))

const mockUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  role: 'customer',
} as unknown as User

const publishedProduct = {
  id: 42,
  sku: 'KURZUS-ALAP',
  status: 'published',
  priceInHUF: 5000,
  priceInHUFEnabled: true,
  shortDescription: 'Alap kurzus',
} as unknown as Product

const fetchMock = vi.fn()
// A globális fetch-stub nem maradhat át más tesztfájlra (CLAUDE.md 15. tanulság):
// beforeEach-ben állítjuk be, az afterEach pedig visszaállítja.
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function barionStartSuccess(): Response {
  return new Response(
    JSON.stringify({
      PaymentId: DUMMY_PAYMENT_ID,
      PaymentRequestId: ORDER_NUMBER,
      Status: 'Prepared',
      GatewayUrl: GATEWAY_URL,
      Transactions: [{ TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Postgres unique-violation a `pg` hibaobjektum alakjában (constraint mezővel). */
function orderNumberConflict(withConstraint = true): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    ...(withConstraint
      ? { constraint: 'orders_order_number_idx' }
      : { detail: 'Key (order_number)=(KH-2026-000123) already exists.' }),
  })
}

interface StoredOrder {
  id: number
  status: string
  customer: number
  productId: number
  createdAt: string
}

/**
 * ÁLLAPOTTARTÓ Payload-mock: a létrehozott rendeléseket megőrzi, és a
 * duplikáció-ellenőrző find MÁR LÁTJA őket. Enélkül a sorosítás hatása nem
 * lenne megfigyelhető.
 */
function createStatefulPayload(options: { createFailures?: Error[] } = {}) {
  const orders: StoredOrder[] = []
  const failures = [...(options.createFailures ?? [])]
  let nextId = 100
  const calls = { create: 0, find: 0 }

  const payload = {
    findByID: vi.fn(async () => publishedProduct),
    find: vi.fn(async ({ where }: { where?: unknown }) => {
      calls.find += 1
      const json = JSON.stringify(where ?? {})
      const wantedStatus = json.includes('payment_pending') ? 'payment_pending' : 'paid'
      const matched = orders.filter((order) => order.status === wantedStatus)
      return { docs: matched, totalDocs: matched.length }
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.create += 1
      const failure = failures.shift()
      if (failure) {
        throw failure
      }
      const items = data.items as Array<{ product: number; quantity: number }>
      const stored: StoredOrder = {
        id: (nextId += 1),
        status: String(data.status),
        customer: Number(data.customer),
        productId: items[0]?.product ?? 0,
        createdAt: new Date().toISOString(),
      }
      orders.push(stored)
      return {
        ...data,
        id: stored.id,
        orderNumber: ORDER_NUMBER,
        totalHufSnapshot: 5000,
        items: [
          {
            product: stored.productId,
            quantity: 1,
            titleSnapshot: 'KURZUS-ALAP',
            priceHufSnapshot: 5000,
          },
        ],
      } as unknown as Order
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
  }

  return { payload: payload as unknown as Payload, orders, calls }
}

const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of [
    'BARION_API_URL',
    'BARION_PAYEE_EMAIL',
    'BARION_POSKEY_TEST',
    'NEXT_PUBLIC_SERVER_URL',
  ]) {
    savedEnv[key] = process.env[key]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
  process.env.NEXT_PUBLIC_SERVER_URL = 'https://shop.example.test'
})

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

afterEach(() => {
  fetchMock.mockReset()
  lockState.reset()
})

/**
 * A `billing` a valódi pénztár-beküldés része (B): számlázási adat nélkül a
 * szolgáltatás 400-zal állna meg, és a zár-forgatókönyvek el sem indulnának.
 */
const happyInput = {
  productId: 42,
  consentWithdrawalWaiver: true,
  consentTerms: true,
  billing: {
    name: 'Minta Mari',
    zip: '1011',
    city: 'Budapest',
    street: 'Fő utca 1.',
  },
}

describe('checkout-zár — sorosítás (TOCTOU)', () => {
  it('két párhuzamos kérés: a védett szakaszok NEM lapolódnak át, csak EGY rendelés jön létre', async () => {
    fetchMock.mockResolvedValue(barionStartSuccess())
    const { payload, orders, calls } = createStatefulPayload()

    const results = await Promise.allSettled([
      startCheckout({ payload, user: mockUser, input: happyInput }),
      startCheckout({ payload, user: mockUser, input: happyInput }),
    ])

    // A zár soros: egyszerre legfeljebb egy védett szakasz futott.
    expect(lockState.maxConcurrent).toBe(1)
    expect(lockState.events).toEqual([
      'enter:checkout:7:42',
      'exit:checkout:7:42',
      'enter:checkout:7:42',
      'exit:checkout:7:42',
    ])

    // Pontosan EGY rendelés jött létre; a második kérés 409-cel elhasalt.
    expect(calls.create).toBe(1)
    expect(orders).toHaveLength(1)
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason as CheckoutError
    expect(reason).toBeInstanceOf(CheckoutError)
    expect(reason.status).toBe(409)
    expect(reason.message).toContain('nemrég már indult egy fizetés')
  })

  it('a zár kulcsa felhasználó–termék páronkénti (más termék nem várakozik)', async () => {
    fetchMock.mockResolvedValue(barionStartSuccess())
    const { payload } = createStatefulPayload()

    await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(lockState.events[0]).toBe('enter:checkout:7:42')
  })

  it('a Barion Payment/Start a záron KÍVÜL fut (a zár nem tart hálózati hívás alatt)', async () => {
    let fetchDuringLock = false
    fetchMock.mockImplementation(async () => {
      fetchDuringLock = lockState.current > 0
      return barionStartSuccess()
    })
    const { payload } = createStatefulPayload()

    await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchDuringLock).toBe(false)
    // A védett szakasz már lezárult, mire a Barion-hívás elindult.
    expect(lockState.events).toEqual(['enter:checkout:7:42', 'exit:checkout:7:42'])
  })
})

/**
 * VENDÉG-ÁG (P1) — a fiókhoz még nem kötött rendelést KIZÁRÓLAG az e-mail
 * azonosítja, ezért a zárkulcs vendégnél e-mail-hatókörű, a
 * duplavásárlás-blokk pedig MINDIG e-mail-hatókörű is (W2: bejelentkezett
 * vevőnél a customer-ág mellett).
 *
 * A HIÁNYZÓ MÉRÉS, amit ez pótol: a `start-checkout.ts` e-mail-hatókörű
 * `assertNoDuplicatePurchase({ kind: 'email' })` hívását elhagyva a
 * vendég-tesztkészlet zöld maradt. Két egyidejű vendég-fizetés így KÉT
 * aktív `payment_pending` rendelést hagyna ugyanarra a kurzusra — mindkettő
 * kifizethető, a másodikat pedig már csak a paid-átmenet K5-őre fogná meg,
 * amikor a pénz MÁR le van vonva.
 */
describe('checkout-zár — VENDÉG (fiók nélküli) vásárlás', () => {
  const guestInput = {
    ...happyInput,
    guest: { email: 'vendeg@example.test', name: 'Vendég Vevő' },
  }

  it('két párhuzamos vendég-kérés UGYANARRA az e-mailre: egy rendelés, a második 409', async () => {
    fetchMock.mockResolvedValue(barionStartSuccess())
    const { payload, orders, calls } = createStatefulPayload()

    const results = await Promise.allSettled([
      startCheckout({ payload, input: guestInput }),
      startCheckout({ payload, input: guestInput }),
    ])

    // A zár soros, és a kulcs a VENDÉG e-mailjére szól (nincs fiókazonosító).
    expect(lockState.maxConcurrent).toBe(1)
    expect(lockState.events).toEqual([
      'enter:checkout:guest:vendeg@example.test:42',
      'exit:checkout:guest:vendeg@example.test:42',
      'enter:checkout:guest:vendeg@example.test:42',
      'exit:checkout:guest:vendeg@example.test:42',
    ])

    // Pontosan EGY rendelés jött létre — a második a fizetés ELŐTT elakadt.
    expect(calls.create).toBe(1)
    expect(orders).toHaveLength(1)
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason as CheckoutError
    expect(reason).toBeInstanceOf(CheckoutError)
    expect(reason.status).toBe(409)
    expect(reason.message).toContain('nemrég már indult egy fizetés')
    // Csak az EGYETLEN sikeres rendeléshez indult Barion-fizetés.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a vendég zárkulcsa e-mail + termék páronkénti (checkout:guest:<email>:<productId>)', async () => {
    fetchMock.mockResolvedValue(barionStartSuccess())
    const { payload } = createStatefulPayload()

    await startCheckout({ payload, input: guestInput })

    expect(lockState.events[0]).toBe('enter:checkout:guest:vendeg@example.test:42')
  })
})

describe('checkout — rendelésszám-ütközés (23505) újrapróbálása', () => {
  it('egyetlen ütközés után a második kísérlet sikerül (a hívó nem lát hibát)', async () => {
    fetchMock.mockResolvedValue(barionStartSuccess())
    const { payload, calls, orders } = createStatefulPayload({
      createFailures: [orderNumberConflict()],
    })

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(result).toEqual({ orderNumber: ORDER_NUMBER, gatewayUrl: GATEWAY_URL })
    expect(calls.create).toBe(2)
    expect(orders).toHaveLength(1)
  })

  it('constraint mező nélkül is felismeri (fallback: 23505 + „order_number" a szövegben)', async () => {
    fetchMock.mockResolvedValue(barionStartSuccess())
    const { payload, calls } = createStatefulPayload({
      createFailures: [orderNumberConflict(false)],
    })

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(result.orderNumber).toBe(ORDER_NUMBER)
    expect(calls.create).toBe(2)
  })

  it('kimerülés (4 kísérlet) → magyar hibaüzenet, a Barion NEM hívódik', async () => {
    const { payload, calls } = createStatefulPayload({
      createFailures: [
        orderNumberConflict(),
        orderNumberConflict(),
        orderNumberConflict(),
        orderNumberConflict(),
        orderNumberConflict(),
      ],
    })

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })

    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 503 })
    await expect(promise).rejects.toThrowError(/Próbáld újra néhány másodperc múlva/)
    expect(calls.create).toBe(4)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('MÁS unique-ütközés (nem a rendelésszámé) NEM próbálkozik újra — azonnal felszínre kerül', async () => {
    const foreignConflict = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint: 'orders_barion_payment_id_idx',
      },
    )
    const { payload, calls } = createStatefulPayload({ createFailures: [foreignConflict] })

    await expect(
      startCheckout({ payload, user: mockUser, input: happyInput }),
    ).rejects.toThrowError(/duplicate key/)
    expect(calls.create).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * a-checkout-4 — a zárban NEM futhat Barion-hívás. Korábban a függő fizetés
 * GetPaymentState-je (1–2 mp, a timeoutig akár 15 mp) és a paid-reject
 * visszatérítés a zárban futott, és addig egy pool-kapcsolatot fogott. Most:
 * olvasás a zárban → Barion a záron kívül → újra zárolva döntés és írás.
 */
describe('checkout-zár — Barion-hívás csak a záron KÍVÜL', () => {
  const PENDING_PAYMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000077'

  function pendingRow(paymentId: string): Record<string, unknown> {
    return {
      id: 77,
      status: 'payment_pending',
      barionPaymentId: paymentId,
      orderNumber: 'KH-2026-000077',
      createdAt: new Date().toISOString(),
      totalHufSnapshot: 5000,
      customerSnapshot: {
        name: 'Minta Mari',
        billingName: 'Minta Mari',
        billingZip: '1011',
        billingCity: 'Budapest',
        billingStreet: 'Fő utca 1.',
        taxNumber: null,
      },
    }
  }

  function payloadWithPending(nextPaymentId: () => string) {
    const payload = {
      findByID: vi.fn(async () => publishedProduct),
      find: vi.fn(async ({ where }: { where?: unknown }) =>
        JSON.stringify(where ?? {}).includes('payment_pending') &&
        !JSON.stringify(where ?? {}).includes('createdAt')
          ? { docs: [pendingRow(nextPaymentId())], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
      ),
      create: vi.fn(async () => {
        throw new Error('TESZT: ebben az esetben rendelés nem jöhet létre')
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    }
    return payload
  }

  it('élő függő fizetés: a GetPaymentState a zárak KÖZÖTT fut, majd a második zárolt kör folytatja a fizetést', async () => {
    const locksHeldDuringFetch: number[] = []
    const fetchPaymentState = vi.fn(async () => {
      locksHeldDuringFetch.push(lockState.current)
      return { PaymentId: PENDING_PAYMENT_ID, Status: 'Prepared' } as never
    })
    const payload = payloadWithPending(() => PENDING_PAYMENT_ID)

    const result = await startCheckout({
      payload: payload as unknown as Payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState,
    })

    expect(result.gatewayUrl).toContain(PENDING_PAYMENT_ID)
    expect(fetchPaymentState).toHaveBeenCalledTimes(1)
    expect(locksHeldDuringFetch).toEqual([0])
    // Két zárolt kör: olvasás, majd a lekérdezett állapottal döntés.
    expect(lockState.events).toEqual([
      'enter:checkout:7:42',
      'exit:checkout:7:42',
      'enter:checkout:7:42',
      'exit:checkout:7:42',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kifizetett, de elutasított függő rendelés: a visszatérítés (Barion Refund) a záron KÍVÜL fut', async () => {
    const locksHeldDuringRefund: number[] = []
    const payload = payloadWithPending(() => PENDING_PAYMENT_ID)

    const error = await startCheckout({
      payload: payload as unknown as Payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: vi.fn(
        async () => ({ PaymentId: PENDING_PAYMENT_ID, Status: 'Succeeded' }) as never,
      ),
      applyBarionStateTransition: vi.fn(async () => ({
        action: 'rejected' as const,
        reason: 'total-mismatch',
      })),
      recoverRejectedPaid: vi.fn(async () => {
        locksHeldDuringRefund.push(lockState.current)
        return { action: 'refunded' as const }
      }),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CheckoutError)
    expect((error as CheckoutError).status).toBe(409)
    expect((error as CheckoutError).message).toBe(CHECKOUT_REFUNDED_RETRY)
    expect(locksHeldDuringRefund).toEqual([0])
  })

  it('ha a körök alatt folyton újabb függő fizetés jelenik meg: korlátos számú kör után 503, rendelés NÉLKÜL', async () => {
    let counter = 0
    const payload = payloadWithPending(() => {
      counter += 1
      return `aaaaaaaa-bbbb-cccc-dddd-${String(counter).padStart(12, '0')}`
    })
    const fetchPaymentState = vi.fn(async () => ({ Status: 'Prepared' }) as never)

    const error = await startCheckout({
      payload: payload as unknown as Payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CheckoutError)
    expect((error as CheckoutError).status).toBe(503)
    expect((error as CheckoutError).message).toBe(CHECKOUT_PAYMENT_STATE_UNAVAILABLE)
    expect(fetchPaymentState).toHaveBeenCalledTimes(4)
    expect(payload.create).not.toHaveBeenCalled()
  })
})
