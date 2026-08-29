import type { Payload } from 'payload'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'

import {
  classifyRefundedTransactionStatus,
  readRefundEntries,
  refundLockKey,
  RefundError,
  refundOrder,
} from '../lib/refund/refund-order'
import { userPurchasesLockKey } from '../lib/user-purchases-lock'
import type { Order, User } from '../payload-types'

/**
 * S3 — refund-megbízhatóság: a refund-ZÁR viselkedése (A) és a Barion
 * tranzakció-státuszra épülő hibaág (M-11).
 *
 * A zárat mockoljuk (a valódi Postgres advisory-zár egységtesztje az
 * advisory-lock.test.ts): itt az a kérdés, hogy a refund-szolgáltatás HELYESEN
 * HASZNÁLJA-e — jó kulccsal, a rendelést a záron belül ÚJRA olvasva, a
 * pénzmozgató Barion-hívást a záron belül, a lassú GetState-et pedig a záron
 * kívül tartva.
 *
 * A mock ad egy beavatkozási pontot is (`beforeEnter`): ezzel szimuláljuk azt a
 * párhuzamos refundot, amely a zárra várakozás közben módosítja a rendelést —
 * pontosan az a versenyhelyzet, ami miatt a zár kell.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
 */
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'

const PAYMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const TRANSACTION_ID = 'tx-1111-2222'
const CONCURRENT_TRANSACTION_ID = 'tx-parhuzamos-9999'
const ORDER_NUMBER = 'KH-2026-000777'
const ORDER_ID = 555
const TOTAL_HUF = 20000

/** A mockolt zár megfigyelhető állapota (vi.hoisted: a vi.mock factory előbb fut). */
const lockState = vi.hoisted(() => ({
  /** A megszerzett zárkulcsok, hívási sorrendben. */
  keys: [] as string[],
  /** Igaz, amíg a védett szakasz fut — a fetch-napló ezt rögzíti hívásonként. */
  held: false,
  /** „Párhuzamos" beavatkozás közvetlenül a zár megszerzése ELŐTT. */
  beforeEnter: null as null | (() => void | Promise<void>),
}))

vi.mock('../lib/advisory-lock', () => ({
  withAdvisoryLock: async <T>(
    _payload: unknown,
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    lockState.keys.push(lockKey)
    // A beforeEnter CSAK a rendelés-zárra fut: a nestelt purchases:user zár
    // másodszor is meghívná, és felülírná a záron belül már beírt refund-nyomot.
    if (lockState.beforeEnter && lockKey.startsWith('refund:order:')) {
      await lockState.beforeEnter()
    }
    lockState.held = true
    try {
      return await fn()
    } finally {
      lockState.held = false
    }
  },
}))

const fetchMock = vi.fn()
// A globális fetch-stub nem maradhat át más tesztfájlra (CLAUDE.md 15. tanulság):
// beforeEach-ben állítjuk be, az afterEach pedig visszaállítja.
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** A fetch-hívások naplója: URL + a zár állapota a hívás pillanatában. */
const fetchLog: Array<{ url: string; lockHeld: boolean }> = []
/** Előkészített válaszok sorrendben (Response vagy dobandó hiba). */
let responseQueue: Array<() => Response> = []

const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of ['BARION_API_URL', 'BARION_PAYEE_EMAIL', 'BARION_POSKEY_TEST']) {
    savedEnv[key] = process.env[key]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
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

beforeEach(() => {
  lockState.keys = []
  lockState.held = false
  lockState.beforeEnter = null
  fetchLog.length = 0
  responseQueue = []
  fetchMock.mockImplementation(async (url: unknown) => {
    fetchLog.push({ url: String(url), lockHeld: lockState.held })
    const next = responseQueue.shift()
    if (!next) {
      throw new Error('teszthiba: nincs több előkészített Barion-válasz')
    }
    return next()
  })
})

afterEach(() => {
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

const ACTOR = { id: 1, role: 'owner' } as unknown as User

function createOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    totalHufSnapshot: TOTAL_HUF,
    amount: TOTAL_HUF,
    barionPaymentId: PAYMENT_ID,
    invoiceNumber: 'KIN-2026-7',
    invoiceStatus: 'issued',
    customer: 7,
    items: [{ product: 42, quantity: 1 }],
    ...overrides,
  } as unknown as Order
}

function createMockPayload(order: Order) {
  const calls = {
    orderFinds: 0,
    protectedFindLocks: [] as string[][],
    update: [] as Array<{ collection: string; id: number | string; data: Record<string, unknown> }>,
    create: [] as Array<{ collection: string; data: Record<string, unknown> }>,
  }
  const payload = {
    find: vi.fn(async ({ where }: { collection: string; where?: unknown }) => {
      const json = JSON.stringify(where ?? {})
      if (json.includes('not_equals')) {
        // A revokePurchases „más paid rendelés" ellenőrzése.
        calls.protectedFindLocks.push([...lockState.keys])
        return { docs: [], totalDocs: 0 }
      }
      calls.orderFinds += 1
      return { docs: [order], totalDocs: 1 }
    }),
    findByID: vi.fn(async () => ({ id: 7, purchases: [42] }) as unknown as User),
    update: vi.fn(
      async (args: { collection: string; id: number | string; data: Record<string, unknown> }) => {
        calls.update.push(args)
        if (args.collection === 'orders') {
          Object.assign(order, args.data)
        }
        return args.data
      },
    ),
    create: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      calls.create.push(args)
      return args.data
    }),
    jobs: { queue: vi.fn(async () => ({ id: 1 })) },
  }
  return { payload: payload as unknown as Payload, calls, order }
}

function getStateResponse(): Response {
  return new Response(
    JSON.stringify({
      PaymentId: PAYMENT_ID,
      PaymentRequestId: ORDER_NUMBER,
      Status: 'Succeeded',
      Total: TOTAL_HUF,
      Transactions: [
        {
          TransactionId: TRANSACTION_ID,
          Total: TOTAL_HUF,
          Status: 'Succeeded',
          TransactionType: 'CardPayment',
        },
      ],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Payment/Refund v2 válasz — a tranzakciószintű Status paraméterezhető. */
function refundResponse(amount: number, status?: string): Response {
  return new Response(
    JSON.stringify({
      PaymentId: PAYMENT_ID,
      RefundedTransactions: [
        {
          TransactionId: TRANSACTION_ID,
          AmountToRefund: amount,
          ...(status === undefined ? {} : { Status: status }),
        },
      ],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Injektált (nem valódi) számlázási hívók — a bizonylat-indítás megfigyeléséhez. */
function invoiceSpies() {
  const issueStorno = vi.fn(async () => ({ outcome: 'issued' as const, stornoNumber: 'ST-1' }))
  const issueCorrective = vi.fn(async () => ({
    outcome: 'issued' as const,
    correctiveInvoiceNumber: 'HELY-1',
  }))
  return { issueStorno, issueCorrective }
}

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

function runRefund(
  payload: Payload,
  input: Record<string, unknown> = {},
  spies?: ReturnType<typeof invoiceSpies>,
) {
  return refundOrder({
    payload,
    orderNumber: ORDER_NUMBER,
    input,
    actor: ACTOR,
    ...(spies
      ? {
          issueStorno: spies.issueStorno as unknown as never,
          issueCorrective: spies.issueCorrective as unknown as never,
        }
      : {}),
  })
}

describe('refund-zár — a pénzmozgató szakasz sorosítása', () => {
  it('a rendelésre szabott kulccsal zár, és a Barion-refund a záron BELÜL fut (a GetState kívül)', async () => {
    const { payload, calls } = createMockPayload(createOrder())
    responseQueue = [getStateResponse, () => refundResponse(TOTAL_HUF, 'Refunded')]

    const result = await runRefund(payload, {}, invoiceSpies())

    // Rendelés-zár, majd a purchases user-zár (order → user, deadlock-szabály).
    expect(lockState.keys).toEqual([refundLockKey(ORDER_ID), userPurchasesLockKey(7)])
    expect(refundLockKey(ORDER_ID)).toBe(`refund:order:${ORDER_ID}`)

    // ZÁR-TARTOMÁNY: a lassú GetState a záron KÍVÜL, a pénzmozgató Refund BELÜL.
    expect(fetchLog).toHaveLength(2)
    expect(fetchLog[0]?.url).toContain('/v4/Payment/')
    expect(fetchLog[0]?.lockHeld).toBe(false)
    expect(fetchLog[1]?.url).toBe('https://api.test.barion.com/v2/Payment/Refund')
    expect(fetchLog[1]?.lockHeld).toBe(true)

    // A rendelést a záron belül ÚJRA olvassuk: kettő rendelés-lekérdezés történt.
    expect(calls.orderFinds).toBe(2)
    expect(result.orderStatus).toBe('refunded')
    expect(result.refundStatusOutcome).toBe('succeeded')
  })

  it('a „más paid rendelés" ellenőrzés a purchases-záron BELÜL fut (párhuzamos grant nem ékelődhet be)', async () => {
    const { payload, calls } = createMockPayload(createOrder())
    responseQueue = [getStateResponse, () => refundResponse(TOTAL_HUF, 'Refunded')]

    await runRefund(payload, {}, invoiceSpies())

    expect(calls.protectedFindLocks).toHaveLength(1)
    expect(calls.protectedFindLocks[0]).toEqual([refundLockKey(ORDER_ID), userPurchasesLockKey(7)])
  })

  it('a záron belüli FRISS olvasás beszámítja a közben lefutott párhuzamos refundot (nincs túlfizetés, nincs elveszett bejegyzés)', async () => {
    const order = createOrder()
    const { payload, calls } = createMockPayload(order)
    responseQueue = [getStateResponse, () => refundResponse(15000, 'Refunded')]

    // Egy párhuzamos kérés 5000 Ft-ot már visszatérített, MIELŐTT mi megkapjuk a zárat.
    const concurrentEntry = {
      transactionId: CONCURRENT_TRANSACTION_ID,
      amountHuf: 5000,
      status: 'PartiallyRefunded',
      refundedAt: '2026-08-01T10:00:00.000Z',
      type: 'partial' as const,
    }
    lockState.beforeEnter = () => {
      ;(order as unknown as { refunds: unknown[] }).refunds = [concurrentEntry]
    }

    const result = await runRefund(payload, {}, invoiceSpies())

    // A visszatérített összeg a MARADVÁNY, nem az elavult teljes végösszeg.
    const refundBody = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    ) as {
      TransactionsToRefund: Array<{ TransactionId: string; AmountToRefund: number }>
    }
    expect(refundBody.TransactionsToRefund[0]?.AmountToRefund).toBe(15000)
    // A FRISS példány tárolt TransactionId-je élvez elsőbbséget a záron kívül feloldottal szemben.
    expect(refundBody.TransactionsToRefund[0]?.TransactionId).toBe(CONCURRENT_TRANSACTION_ID)

    // A párhuzamos bejegyzés NEM veszett el: a nyomban mindkettő szerepel.
    const entries = readRefundEntries(order)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual(concurrentEntry)
    expect(entries[1]?.amountHuf).toBe(15000)

    expect(result).toMatchObject({
      amountHuf: 15000,
      alreadyRefundedHuf: 5000,
      totalRefundedHuf: TOTAL_HUF,
      orderStatus: 'refunded',
    })
    expect(calls.update.filter((call) => call.collection === 'orders')).toHaveLength(1)
  })

  it('ha a rendelés a zárra várakozás közben refunded lesz, a záron belüli újra-validálás 409-cel megállítja (Barion-refund NEM indul)', async () => {
    const order = createOrder()
    const { payload, calls } = createMockPayload(order)
    responseQueue = [getStateResponse]

    lockState.beforeEnter = () => {
      order.status = 'refunded'
    }

    await expect(runRefund(payload, {}, invoiceSpies())).rejects.toMatchObject({
      name: 'RefundError',
      status: 409,
    })

    // Csak a záron kívüli GetState futott le — pénzmozgás nem történt.
    expect(fetchLog).toHaveLength(1)
    expect(fetchLog[0]?.url).toContain('/v4/Payment/')
    expect(calls.update).toHaveLength(0)
  })

  it('a záron kívül elbukó elő-validáció zárat sem foglal (ismeretlen rendelés → 404)', async () => {
    const payload = {
      find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
    } as unknown as Payload

    await expect(runRefund(payload)).rejects.toMatchObject({ name: 'RefundError', status: 404 })
    expect(lockState.keys).toEqual([])
    expect(fetchLog).toHaveLength(0)
  })
})

describe('M-11 — a Barion tranzakció-státusz besorolása', () => {
  it.each([
    ['Succeeded', 'succeeded'],
    ['Refunded', 'succeeded'],
    ['PartiallyRefunded', 'succeeded'],
    ['RefundFailed', 'failed'],
    ['ValamiUjStatusz', 'unknown'],
    ['', 'unknown'],
  ])('%s → %s', (status, expected) => {
    expect(classifyRefundedTransactionStatus(status)).toBe(expected)
  })

  it('hiányzó státusz → unknown (sosem sikeres)', () => {
    expect(classifyRefundedTransactionStatus(undefined)).toBe('unknown')
    expect(classifyRefundedTransactionStatus(null)).toBe('unknown')
  })
})

describe('M-11 — RefundFailed hibaág', () => {
  it('RefundFailed → magyar hibaüzenet, NINCS refund-bejegyzés, NINCS számla-művelet', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, calls } = createMockPayload(order)
    const spies = invoiceSpies()
    responseQueue = [getStateResponse, () => refundResponse(TOTAL_HUF, 'RefundFailed')]

    const error = await runRefund(payload, {}, spies).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RefundError)
    const refundError = error as RefundError
    expect(refundError.status).toBe(502)
    // Magyar, adminnak szóló üzenet — a technikai státusz megnevezésével.
    expect(refundError.message).toContain('RefundFailed')
    expect(refundError.message).toContain('A rendelés nem változott')

    // SEMMI nem íródott: se refunds-nyom, se státusz, se purchases-levétel, se audit.
    expect(calls.update).toHaveLength(0)
    expect(calls.create).toHaveLength(0)
    expect(order.status).toBe('paid')
    expect(readRefundEntries(order)).toHaveLength(0)

    // Számla-műveletek nem indultak.
    expect(spies.issueStorno).not.toHaveBeenCalled()
    expect(spies.issueCorrective).not.toHaveBeenCalled()

    const logs = logOutput(logSpy)
    expect(logs).toContain('RefundFailed')
    expect(logs).not.toContain(DUMMY_POS_KEY)
  })

  it('részleges refundnál is hibaág: RefundFailed → 409/502 hiba és érintetlen rendelés', async () => {
    const order = createOrder()
    const { payload, calls } = createMockPayload(order)
    const spies = invoiceSpies()
    responseQueue = [getStateResponse, () => refundResponse(5000, 'RefundFailed')]

    await expect(runRefund(payload, { amountHuf: 5000 }, spies)).rejects.toMatchObject({
      name: 'RefundError',
      status: 502,
    })
    expect(calls.update).toHaveLength(0)
    expect(spies.issueCorrective).not.toHaveBeenCalled()
  })
})

describe('M-11 — ismeretlen/hiányzó tranzakció-státusz (konzervatív ág)', () => {
  it('hiányzó Status: a refund-nyom rögzül, de bizonylat NEM készül, és riasztás kerül a naplóba', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const order = createOrder()
    const { payload, calls } = createMockPayload(order)
    const spies = invoiceSpies()
    responseQueue = [getStateResponse, () => refundResponse(TOTAL_HUF)]

    const result = await runRefund(payload, {}, spies)

    expect(result.refundStatusOutcome).toBe('unknown')
    expect(result.refundedTransactionStatus).toBe('Unknown')

    // A nyom rögzül — így a maradvány nem téríthető vissza MÁSODSZOR.
    const entries = readRefundEntries(order)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.amountHuf).toBe(TOTAL_HUF)
    expect(calls.update.some((call) => call.collection === 'orders')).toBe(true)

    // Bizonylat NEM indult (sem stornó, sem helyesbítő).
    expect(spies.issueStorno).not.toHaveBeenCalled()
    expect(spies.issueCorrective).not.toHaveBeenCalled()

    const logs = logOutput(logSpy)
    expect(logs).toContain('RIASZTÁS')
    expect(logs).toContain('emberi ellenőrzés')
  })

  it('ismeretlen (jövőbeli) státusz szintén bizonylat nélkül zárul', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const spies = invoiceSpies()
    responseQueue = [getStateResponse, () => refundResponse(TOTAL_HUF, 'ValamiUjStatusz')]

    const result = await runRefund(payload, {}, spies)

    expect(result.refundStatusOutcome).toBe('unknown')
    expect(result.refundedTransactionStatus).toBe('ValamiUjStatusz')
    expect(spies.issueStorno).not.toHaveBeenCalled()
    expect(spies.issueCorrective).not.toHaveBeenCalled()
  })
})

describe('M-11 — igazolt sikernél a bizonylat változatlanul elindul', () => {
  it('teljes, első refund + Refunded státusz → STORNÓ', async () => {
    const { payload } = createMockPayload(createOrder())
    const spies = invoiceSpies()
    responseQueue = [getStateResponse, () => refundResponse(TOTAL_HUF, 'Refunded')]

    const result = await runRefund(payload, {}, spies)

    expect(result.refundStatusOutcome).toBe('succeeded')
    expect(spies.issueStorno).toHaveBeenCalledTimes(1)
    expect(spies.issueCorrective).not.toHaveBeenCalled()
  })

  it('részleges refund + PartiallyRefunded státusz → HELYESBÍTŐ', async () => {
    const { payload } = createMockPayload(createOrder())
    const spies = invoiceSpies()
    responseQueue = [getStateResponse, () => refundResponse(5000, 'PartiallyRefunded')]

    const result = await runRefund(payload, { amountHuf: 5000 }, spies)

    expect(result.refundStatusOutcome).toBe('succeeded')
    expect(result.type).toBe('partial')
    expect(spies.issueCorrective).toHaveBeenCalledTimes(1)
    expect(spies.issueStorno).not.toHaveBeenCalled()
  })
})
