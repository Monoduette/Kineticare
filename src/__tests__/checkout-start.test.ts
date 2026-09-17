import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BarionApiError } from '../lib/barion'
import type { Order, Product, User } from '../payload-types'
import { createCheckoutStartHandler } from '../lib/checkout/route-handler'
import {
  CHECKOUT_ALREADY_PURCHASED,
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED,
  CHECKOUT_REFUNDED_RETRY,
  CheckoutError,
  paymentWindowToMs,
  startCheckout,
} from '../lib/checkout/start-checkout'
import type { PaidRejectRecoveryResult } from '../lib/order-status/recover-paid-reject'
import { barionPaymentAdapter, withoutPluginPaymentEndpoints } from '../lib/payments/barion-adapter'
import { buyerFromOrder } from '../lib/szamlazz/invoice'
import { RATE_LIMIT_RULES, SlidingWindowRateLimiter } from '../lib/security/rate-limit'
import configPromise from '../payload.config'

/**
 * T-021 checkout-start + T-063 plugin-adapter-kontroll egységtesztek —
 * mockolt Payload local API-val és mockolt fetch-csel (valódi Barion-hívás
 * nélkül), az src/__tests__/barion.test.ts mintáját követve.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const DUMMY_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'

const ORDER_NUMBER = 'KH-2026-000123'
const GATEWAY_URL = `https://secure.test.barion.com/Pay?id=${DUMMY_PAYMENT_ID}`

const mockUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  role: 'customer',
  billingName: 'Minta Mari',
  billingZip: '1011',
  billingCity: 'Budapest',
  billingStreet: 'Fő utca 1.',
  taxNumber: null,
} as unknown as User

const publishedProduct = {
  id: 42,
  sku: 'KURZUS-ALAP',
  status: 'published',
  priceInHUF: 5000,
  priceInHUFEnabled: true,
  shortDescription: 'Alap kurzus',
} as unknown as Product

const createdOrderDoc = {
  id: 101,
  orderNumber: ORDER_NUMBER,
  totalHufSnapshot: 5000,
  items: [
    {
      product: 42,
      quantity: 1,
      titleSnapshot: 'KURZUS-ALAP',
      priceHufSnapshot: 5000,
    },
  ],
} as unknown as Order

type OrderRow = Record<string, unknown> & { id: number; status?: string }

interface MockPayloadOptions {
  product?: Product | null
  /** A duplikáció-ellenőrző find-hívások válasza (a where alapján dönthet). */
  findOrders?: (where: unknown) => { docs: unknown[]; totalDocs: number }
  orderDoc?: Order
  authUser?: User | null
  /** A Barion-azonosító mentése dobjon (persist-hiba ág). */
  persistBarionIdsFails?: boolean
  orderRows?: OrderRow[]
}

function readConditionalWhere(where: unknown): { id?: unknown; status?: unknown } {
  const clauses = (where as { and?: Array<Record<string, { equals?: unknown }>> } | null)?.and ?? []
  const parsed: { id?: unknown; status?: unknown } = {}
  for (const clause of clauses) {
    if (clause.id?.equals !== undefined) {
      parsed.id = clause.id.equals
    }
    if (clause.status?.equals !== undefined) {
      parsed.status = clause.status.equals
    }
  }
  return parsed
}

function createMockPayload(options: MockPayloadOptions = {}) {
  const calls = {
    create: [] as Array<Record<string, unknown>>,
    update: [] as Array<{ id: number | string; data: Record<string, unknown> }>,
    find: [] as unknown[],
    findByID: [] as Array<Record<string, unknown>>,
  }
  const orderRows = new Map<number, OrderRow>((options.orderRows ?? []).map((row) => [row.id, row]))
  const payload = {
    auth: vi.fn(async () => ({
      user: options.authUser === undefined ? mockUser : options.authUser,
    })),
    findByID: vi.fn(async (args: Record<string, unknown>) => {
      calls.findByID.push(args)
      if (args.collection === 'users') {
        return {
          id: mockUser.id,
          purchases: (mockUser as { purchases?: number[] }).purchases ?? [],
          accessGrants: [],
        }
      }
      if (args.collection === 'orders') {
        const row = orderRows.get(Number(args.id))
        if (!row) {
          throw new Error('Not Found')
        }
        return row
      }
      if (options.product === null) {
        throw new Error('Not Found')
      }
      return options.product ?? publishedProduct
    }),
    find: vi.fn(async (args: { where?: unknown }) => {
      calls.find.push(args.where)
      return options.findOrders ? options.findOrders(args.where) : { docs: [], totalDocs: 0 }
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.create.push(data)
      // A valódi rendszerben az orderIntegrity-beforeChange hook írja felül
      // (snapshot, orderNumber) — a mock a hook-OUTPUTOT adja vissza.
      return { ...data, ...(options.orderDoc ?? createdOrderDoc), id: 101 }
    }),
    update: vi.fn(
      async (args: { id?: number | string; where?: unknown; data: Record<string, unknown> }) => {
        const { id, where, data } = args
        if (where !== undefined) {
          const condition = readConditionalWhere(where)
          calls.update.push({ id: Number(condition.id), data })
          const row = orderRows.get(Number(condition.id))
          if (!row || (condition.status !== undefined && row.status !== condition.status)) {
            return { docs: [], errors: [] }
          }
          Object.assign(row, data)
          return { docs: [row], errors: [] }
        }
        calls.update.push({ id: id as number | string, data })
        if (options.persistBarionIdsFails === true && 'barionPaymentId' in data) {
          throw new Error('db write failed')
        }
        const row = orderRows.get(Number(id))
        if (row) {
          Object.assign(row, data)
        }
        return { id, ...data }
      },
    ),
  }
  return { payload: payload as unknown as Payload, calls, orderRows }
}

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

function lastBarionRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
  return JSON.parse(String(call[1].body ?? '{}')) as Record<string, unknown>
}

async function checkoutErrorFrom(promise: Promise<unknown>): Promise<CheckoutError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CheckoutError) {
      return error
    }
    throw error
  }
  throw new Error('TESZT: a hívás nem dobott CheckoutError-t')
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
})

/**
 * A `happyInput` az ÉLES kérésalak: a `billing` kötelező, profil-tartalék
 * nincs. Így minden alábbi teszt azon az alakon fut, amit a pénztár ténylegesen
 * küld — nem egy élesben elérhetetlen kódúton.
 */
const PROFILE_BILLING = {
  name: 'Minta Mari',
  zip: '1011',
  city: 'Budapest',
  street: 'Fő utca 1.',
}

const happyInput = {
  productId: 42,
  consentWithdrawalWaiver: true,
  // Az ÁSZF-elfogadás a szerveren is kötelező (a szerződés ettől jön létre,
  // ÁSZF 22. bekezdés). Az őre: src/__tests__/penztar-aszf-elfogadas.test.tsx.
  consentTerms: true,
  billing: PROFILE_BILLING,
}

/**
 * A pénztárban BEÍRT, a profiltól eltérő számlázási adatok. Az adószám
 * SZINTETIKUS, de szerkezetileg helyes (CDV + áfakód + megyekód) — nem valódi
 * cég adószáma.
 */
const CHECKOUT_BILLING = {
  name: 'Példa Kft.',
  zip: '9700',
  city: 'Szombathely',
  street: 'Fő tér 2/A',
  taxNumber: '12345676142',
}

describe('startCheckout — boldog út', () => {
  it('rendelés payment_pending + snapshot-árral, Barion Start a libből, válasz { orderNumber, gatewayUrl }', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(result).toEqual({ orderNumber: ORDER_NUMBER, gatewayUrl: GATEWAY_URL })

    // A rendelés payment_pending státusszal és waiver-timestamppel jön létre;
    // a kliens ára/snapshotja SOHA nem szerepel a create-adatban.
    const createData = calls.create[0] as Record<string, unknown>
    expect(createData.status).toBe('payment_pending')
    expect(createData.currency).toBe('HUF')
    expect(createData.customer).toBe(7)
    expect(createData.items).toEqual([{ product: 42, quantity: 1 }])
    expect(createData.consentWithdrawalWaiver).toBe(true)
    expect(typeof createData.consentWithdrawalWaiverAt).toBe('string')
    expect(createData.customerSnapshot).toMatchObject({
      id: 7,
      email: 'vevo@example.test',
      billingName: 'Minta Mari',
      billingZip: '1011',
    })
    expect(createData).not.toHaveProperty('amount')
    expect(createData).not.toHaveProperty('totalHufSnapshot')
    expect(createData).not.toHaveProperty('orderNumber')

    // A Barion Start: PaymentRequestId = orderNumber, Total = SZERVER snapshot-ár.
    const body = lastBarionRequestBody()
    expect(body.PaymentRequestId).toBe(ORDER_NUMBER)
    expect(body.PaymentType).toBe('Immediate')
    expect(body.GuestCheckOut).toBe(true)
    expect(body.CallbackUrl).toBe('https://shop.example.test/api/barion/callback')
    /**
     * B2 — a köszönőoldal a RENDELÉSSZÁMBÓL poll-ozza a státuszt. A `?order=`
     * nélkül MINDEN fizető vevő a „Hiányzik a rendelésszám" nézetet kapná
     * (src/app/(frontend)/fizetes/koszonom/page.tsx) — a RÉGI kódon ez az
     * állítás megbukik.
     */
    expect(body.RedirectUrl).toBe(
      `https://shop.example.test/fizetes/koszonom?order=${ORDER_NUMBER}`,
    )
    const transactions = body.Transactions as Array<Record<string, unknown>>
    expect(transactions[0]?.POSTransactionId).toBe(`${ORDER_NUMBER}-1`)
    expect(transactions[0]?.Total).toBe(5000)
    const items = transactions[0]?.Items as Array<Record<string, unknown>>
    expect(items[0]).toMatchObject({ UnitPrice: 5000, ItemTotal: 5000, SKU: 'KURZUS-ALAP' })

    // A PaymentId és a PaymentRequestId a rendelésre mentődik.
    expect(calls.update[0]).toMatchObject({
      id: 101,
      data: { barionPaymentId: DUMMY_PAYMENT_ID, barionPaymentRequestId: ORDER_NUMBER },
    })
    // A rendelés státusza NEM változik paid-re (az a callback-útvonal joga).
    expect(calls.update.every((call) => (call.data as { status?: string }).status !== 'paid')).toBe(
      true,
    )
  })

  /**
   * B2 — a visszairányítási URL-ből a köszönőoldal ténylegesen KI TUDJA OLVASNI
   * a rendelésszámot. Az állítás a felparszolt query-paraméterre megy, nem a
   * nyers stringre: így az esetleges kódolási hiba is kiütne.
   */
  it('a Barion RedirectUrl-jéből a köszönőoldal kiolvassa a rendelésszámot', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload } = createMockPayload()

    await startCheckout({ payload, user: mockUser, input: happyInput })

    const redirectUrl = new URL(String(lastBarionRequestBody().RedirectUrl))
    expect(redirectUrl.pathname).toBe('/fizetes/koszonom')
    expect(redirectUrl.searchParams.get('order')).toBe(ORDER_NUMBER)
  })

  it('a kliens által küldött EGYEZŐ ár elfogadható, de a végösszeg továbbra is szerver-oldali', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()

    const result = await startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, priceHuf: 5000 },
    })

    expect(result.orderNumber).toBe(ORDER_NUMBER)
    // A create-adat továbbra sem tartalmaz kliens-árat.
    expect(calls.create[0]).not.toHaveProperty('amount')
    const transactions = lastBarionRequestBody().Transactions as Array<Record<string, unknown>>
    expect(transactions[0]?.Total).toBe(5000)
  })
})

describe('startCheckout — számlázási adatok (B)', () => {
  it('a PÉNZTÁRBAN megadott adat FELÜLÍRJA a profilból jövő előkitöltést', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()

    await startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, billing: CHECKOUT_BILLING },
    })

    const snapshot = (calls.create[0] as Record<string, unknown>).customerSnapshot as Record<
      string,
      unknown
    >
    // A rendelésre a pénztárban beírt adat kerül — NEM a mockUser profilja
    // (Minta Mari / 1011 / Budapest / Fő utca 1.).
    expect(snapshot).toMatchObject({
      billingName: 'Példa Kft.',
      billingZip: '9700',
      billingCity: 'Szombathely',
      billingStreet: 'Fő tér 2/A',
      // Az adószám a hivatalos 12345676-1-42 alakra normalizálva megy tovább.
      taxNumber: '12345676-1-42',
    })
    expect(snapshot.billingName).not.toBe(mockUser.billingName)
    // A számla ebből a snapshotból készül: a kötelező vevőmezők megvannak.
    expect(buyerFromOrder({ customerSnapshot: snapshot } as unknown as Order)).toMatchObject({
      nev: 'Példa Kft.',
      irsz: '9700',
      telepules: 'Szombathely',
      cim: 'Fő tér 2/A',
      adoszam: '12345676-1-42',
    })
  })

  it('billing NÉLKÜL → 400: nincs csendes visszaesés a felhasználó profiljára', async () => {
    const { payload, calls } = createMockPayload()

    // A mockUser profilja HIÁNYTALAN — korábban a szolgáltatás abból dolgozott
    // volna. Innentől a hívónak ki kell mondania, mi kerül a számlára.
    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { productId: 42, consentWithdrawalWaiver: true, consentTerms: true },
    })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/számlázási adatok hiányosak/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HIÁNYOS pénztári adat → 400, rendelés NEM jön létre, Barion NEM hívódik', async () => {
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, billing: { ...CHECKOUT_BILLING, city: '   ' } },
    })

    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/Add meg a települést/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a részleges billing NEM egészül ki a profilból (kevert rekord tilos)', async () => {
    const { payload, calls } = createMockPayload()

    // A profilban minden megvan, a kérésben csak a név — a hiányzó mezőket a
    // szolgáltatás NEM pótolja, hanem elutasítja a kérést.
    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, billing: { name: 'Példa Kft.' } },
    })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/irányítószám/)
    expect(calls.create).toHaveLength(0)
  })

  it('érvénytelen irányítószám → 400 (négyjegyű szám kell)', async () => {
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, billing: { ...CHECKOUT_BILLING, zip: '9' } },
    })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/irányítószámot/)
    expect(calls.create).toHaveLength(0)
  })

  it('A HIBA GYÖKERE: üres számlázási adat → 400 (nem jön létre számlázhatatlan rendelés)', async () => {
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, billing: { name: '', zip: '', city: '', street: '' } },
    })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/számlázási adatok hiányosak/)
    // Korábban itt LÉTREJÖTT a rendelés, a fizetés lement, és a számla soha
    // nem állt ki (buyerFromOrder → null → invoiceStatus 'failed', retry nélkül).
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SZERKEZETILEG lehetetlen adószám → 400 (a Számla Agent visszautasítaná)', async () => {
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: mockUser,
      // Csak a hossz stimmel: a CDV, az áfakód és a megyekód is hibás.
      input: { ...happyInput, billing: { ...CHECKOUT_BILLING, taxNumber: '12345678-9-99' } },
    })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/adószám/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a hibaüzenet NEM mond hiányt ott, ahol az adat ki van töltve', async () => {
    const { payload } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, billing: { ...CHECKOUT_BILLING, taxNumber: 'HU12345676' } },
    })

    await expect(promise).rejects.toThrowError(/közösségi adószám/)
    await expect(promise).rejects.not.toThrowError(/hiányos/)
  })

  it('KÜLFÖLDI irányítószámmal is létrejön a rendelés (a vásárlás nem vész el)', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()

    await startCheckout({
      payload,
      user: mockUser,
      input: {
        ...happyInput,
        billing: { name: 'Kovács Béla', zip: '10115', city: 'Berlin', street: 'Torstraße 1.' },
      },
    })

    expect((calls.create[0] as Record<string, unknown>).customerSnapshot).toMatchObject({
      billingZip: '10115',
      billingCity: 'Berlin',
    })
  })
})

describe('startCheckout — szerver-oldali ár-kikényszerítés', () => {
  it('eltérő kliens-ár → 400, rendelés NEM jön létre, Barion NEM hívódik', async () => {
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, priceHuf: 1 },
    })

    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/eltér a termék aktuális árától/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('startCheckout — duplavásárlás-blokk', () => {
  const whereMentions = (where: unknown, needle: string): boolean =>
    JSON.stringify(where ?? {}).includes(needle)

  it('meglévő paid rendelés → 409, magyar üzenettel', async () => {
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, '"paid"')
          ? { docs: [{ id: 55, status: 'paid' }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(CHECKOUT_ALREADY_PURCHASED)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aktív (nem lejárt) payment_pending → 409', async () => {
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? { docs: [{ id: 56, status: 'payment_pending' }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(/folyamatban van egy fizetés/)
    expect(calls.create).toHaveLength(0)
  })

  it('bejelentkezve, korábbi vendég payment_pending ugyanarra az e-mailre → 409, nincs második rendelés', async () => {
    const { payload, calls } = createMockPayload({
      findOrders: (where) => {
        const text = JSON.stringify(where ?? {})
        // A customer-hatókörű ellenőrzés NEM látja a vendég-rendelést
        // (customer: null). Csak az e-mail-hatókörű találja meg.
        if (text.includes('"customerEmail"') && text.includes('payment_pending')) {
          return {
            docs: [
              {
                id: 88,
                status: 'payment_pending',
                customer: null,
                customerEmail: mockUser.email,
              },
            ],
            totalDocs: 1,
          }
        }
        return { docs: [], totalDocs: 0 }
      },
    })

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(/folyamatban van egy fizetés/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()

    const asText = calls.find.map((where) => JSON.stringify(where ?? {})).join('\n')
    expect(asText).toContain('"customerEmail"')
    expect(asText).toContain(mockUser.email)
    expect(asText).toContain('"customer"')
  })

  const stalePendingSetup = (rowStatus: string) => {
    const snapshot = {
      id: 77,
      status: 'payment_pending',
      createdAt: new Date(Date.now() - paymentWindowToMs() - 60_000).toISOString(),
      barionPaymentId: null,
      orderNumber: 'KH-REGI',
    }
    const row: OrderRow = { id: 77, status: rowStatus, orderNumber: 'KH-REGI' }
    return {
      ...createMockPayload({
        orderRows: [row],
        findOrders: (where) =>
          whereMentions(where, 'payment_pending')
            ? { docs: [snapshot], totalDocs: 1 }
            : { docs: [], totalDocs: 0 },
      }),
      row,
    }
  }

  it('lejárt payment_pending PaymentId nélkül: helyi cancelled, új Start mehet', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls, row } = stalePendingSetup('payment_pending')

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(calls.update.some((entry) => entry.data.status === 'cancelled')).toBe(true)
    expect(row.status).toBe('cancelled')
    expect(calls.create).toHaveLength(1)
    expect(result.orderNumber).toBe(ORDER_NUMBER)
  })

  it('a lezárás FELTÉTELES: a sor csak payment_pending állapotból vált cancelled-re', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = stalePendingSetup('payment_pending')

    await startCheckout({ payload, user: mockUser, input: happyInput })

    const conditional = calls.update.find((entry) => entry.data.status === 'cancelled')
    expect(conditional).toBeDefined()
    expect(payload.findByID).toHaveBeenCalledWith({
      collection: 'orders',
      id: 77,
      depth: 0,
      overrideAccess: true,
    })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'orders',
        id: 77,
        data: { status: 'cancelled' },
      }),
    )
  })

  it('verseny: a sor közben PAID lett → nincs felülírás, 409 az already-paid üzenettel', async () => {
    const { payload, calls, row } = stalePendingSetup('paid')

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_ALREADY_PURCHASED)
    expect(row.status).toBe('paid')
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verseny: a sor közben refunded lett → új rendelés indulhat (nincs élő fizetés)', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls, row } = stalePendingSetup('refunded')

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(row.status).toBe('refunded')
    expect(calls.create).toHaveLength(1)
    expect(result.orderNumber).toBe(ORDER_NUMBER)
  })

  it('verseny: a sor közben payment_failed lett → új rendelés indulhat', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = stalePendingSetup('payment_failed')

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(calls.create).toHaveLength(1)
    expect(result.orderNumber).toBe(ORDER_NUMBER)
  })

  it('nyitott Barion-fizetés: ugyanarra a Pay-URL-re visz, második Start nincs', async () => {
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? {
              docs: [
                {
                  id: 88,
                  status: 'payment_pending',
                  createdAt: new Date().toISOString(),
                  barionPaymentId: 'pay-open',
                  orderNumber: 'KH-NYITOTT',
                },
              ],
              totalDocs: 1,
            }
          : { docs: [], totalDocs: 0 },
    })

    const result = await startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: async () => ({ Status: 'Started' }) as never,
      barionEnvironment: 'test',
    })

    expect(result).toEqual({
      orderNumber: 'KH-NYITOTT',
      gatewayUrl: 'https://secure.test.barion.com/Pay?id=pay-open',
    })
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GetPaymentState hiba → 503, második Start tilos', async () => {
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? {
              docs: [
                {
                  id: 89,
                  status: 'payment_pending',
                  createdAt: new Date().toISOString(),
                  barionPaymentId: 'pay-err',
                  orderNumber: 'KH-HIBA',
                },
              ],
              totalDocs: 1,
            }
          : { docs: [], totalDocs: 0 },
    })

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: async () => {
        throw new Error('barion timeout')
      },
    })
    await expect(promise).rejects.toMatchObject({ status: 503 })
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a Barion nem ismeri a függő fizetést (404): a sor cancelled, új Start mehet', async () => {
    // Cáfolható állítás: a 404 eddig „unavailable"-ként 503-at adott, és a
    // vevő erre a termékre örökre kizárta magát (pl. teszt-környezetben indított
    // fizetés az éles kulcs alatt).
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const row: OrderRow = { id: 78, status: 'payment_pending', orderNumber: 'KH-ISMERETLEN' }
    const { payload, calls } = createMockPayload({
      orderRows: [row],
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? {
              docs: [
                {
                  id: 78,
                  status: 'payment_pending',
                  createdAt: new Date().toISOString(),
                  barionPaymentId: 'pay-ismeretlen',
                  orderNumber: 'KH-ISMERETLEN',
                },
              ],
              totalDocs: 1,
            }
          : { docs: [], totalDocs: 0 },
    })

    const result = await startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: async () => {
        throw new BarionApiError({
          message: 'DUMMY payment not found',
          kind: 'http',
          endpoint: 'GET /v4/Payment/{id}/PaymentState',
          httpStatus: 404,
        })
      },
    })

    expect(row.status).toBe('cancelled')
    expect(calls.update.some((entry) => entry.data.status === 'cancelled')).toBe(true)
    expect(calls.create).toHaveLength(1)
    expect(result.orderNumber).toBe(ORDER_NUMBER)
  })

  it('Succeeded függő rendelés: paid-átmenet, új Start 409', async () => {
    const pendingOrder = {
      id: 90,
      status: 'payment_pending',
      createdAt: new Date().toISOString(),
      barionPaymentId: 'pay-ok',
      orderNumber: 'KH-SIKER',
    }
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? { docs: [pendingOrder], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })
    const onOrderPaid = vi.fn()

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: async () => ({ Status: 'Succeeded' }) as never,
      applyBarionStateTransition: async () => ({
        action: 'paid',
        transitionedToPaid: true,
        customer: {
          userId: 7,
          created: false,
          alreadyLinked: false,
          passwordSetupPending: true,
          email: 'vevo@example.test',
          name: 'Minta Mari',
        },
      }),
      onOrderPaid,
      barionEnvironment: 'test',
    })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    expect(onOrderPaid).toHaveBeenCalledTimes(1)
    expect(onOrderPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          passwordSetupPending: true,
          email: 'vevo@example.test',
        }),
      }),
    )
    expect(calls.create).toHaveLength(0)
  })

  it('RF-4: Succeeded + paid-reject + recover failed → 409, source checkout-start', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pendingOrder = {
      id: 91,
      status: 'payment_pending',
      createdAt: new Date().toISOString(),
      barionPaymentId: 'pay-reject',
      orderNumber: 'KH-REJECT',
    }
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? { docs: [pendingOrder], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })
    const recoverRejectedPaid = vi.fn(async (input: { source?: string }) => {
      expect(input.source).toBe('checkout-start')
      return { action: 'failed' as const, detail: 'barion-refund-error' }
    })

    const promise = startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: async () => ({ Status: 'Succeeded' }) as never,
      applyBarionStateTransition: async () => ({
        action: 'rejected',
        reason: 'duplicate-paid-order',
      }),
      recoverRejectedPaid,
      barionEnvironment: 'test',
    })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    expect(recoverRejectedPaid).toHaveBeenCalledTimes(1)
    expect(calls.create).toHaveLength(0)
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })

  /**
   * P1 — a sikeres auto-refund UTÁN a „már megvásároltad" hazugság: a vevő
   * total-mismatch vagy privilegizált-kötés miatt NEM kapta meg a kurzust, a
   * pénze visszament. A 409 marad, de a szövegnek a visszatérítésről és a
   * következő lépésről kell szólnia. duplicate-paid-order esetén viszont VAN
   * élő hozzáférés, ott az already-paid üzenet igaz és marad.
   */
  function paidRejectRecoverySetup(
    reason: string,
    recovery: PaidRejectRecoveryResult = { action: 'refunded' },
  ) {
    const pendingOrder = {
      id: 92,
      status: 'payment_pending',
      createdAt: new Date().toISOString(),
      barionPaymentId: 'pay-refund',
      orderNumber: 'KH-REFUND',
    }
    const { payload, calls } = createMockPayload({
      findOrders: (where) =>
        whereMentions(where, 'payment_pending')
          ? { docs: [pendingOrder], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })
    const promise = startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      fetchPaymentState: async () => ({ Status: 'Succeeded' }) as never,
      applyBarionStateTransition: async () => ({ action: 'rejected', reason }),
      recoverRejectedPaid: vi.fn(async () => recovery),
      barionEnvironment: 'test',
    })
    return { promise, calls }
  }

  it('total-mismatch reject + sikeres refund → 409, PONTOSAN a retry-üzenettel', async () => {
    const { promise } = paidRejectRecoverySetup('total-mismatch')
    // A b1 mutációs próba igazolta: a laza (toContain) assert a felcserélt
    // üzeneteket is átengedte — ezért az ok→üzenet párosítás pontos egyezéssel
    // van leszögezve.
    await expect(promise).rejects.toMatchObject({ status: 409, message: CHECKOUT_REFUNDED_RETRY })
    expect(CHECKOUT_REFUNDED_RETRY).not.toBe(CHECKOUT_ALREADY_PURCHASED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('guest-bind-privileged reject + sikeres refund → 409, PONTOSAN a belépős üzenettel', async () => {
    const { promise } = paidRejectRecoverySetup('guest-bind-privileged-account')
    await expect(promise).rejects.toMatchObject({
      status: 409,
      message: CHECKOUT_REFUNDED_PRIVILEGED,
    })
    expect(CHECKOUT_REFUNDED_PRIVILEGED).not.toBe(CHECKOUT_ALREADY_PURCHASED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('duplicate-paid reject + sikeres refund → marad az already-paid 409 (van hozzáférés)', async () => {
    const { promise } = paidRejectRecoverySetup('duplicate-paid-order')
    await expect(promise).rejects.toMatchObject({
      status: 409,
      message: CHECKOUT_ALREADY_PURCHASED,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('total-mismatch + SIKERTELEN refund → 409 a felülvizsgálat-üzenettel (nem „már megvetted")', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { promise, calls } = paidRejectRecoverySetup('total-mismatch', {
      action: 'failed',
      detail: 'barion-refund-error',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
    expect(error.message).not.toBe(CHECKOUT_ALREADY_PURCHASED)
    expect(error.message).not.toBe(CHECKOUT_REFUNDED_RETRY)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('RIASZT')
    logSpy.mockRestore()
  })

  it('total-mismatch + skip (nincs visszatéríthető tranzakció) → 409 a felülvizsgálat-üzenettel', async () => {
    const { promise } = paidRejectRecoverySetup('total-mismatch', {
      action: 'skipped',
      detail: 'no-refundable-transaction',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('total-mismatch + régi skip jelzés → 409 ellenőrzés, nincs igazolatlan refundígéret', async () => {
    const { promise } = paidRejectRecoverySetup('total-mismatch', {
      action: 'skipped',
      detail: 'already-refunded',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('privilegizált kötés + régi skip jelzés → 409 ellenőrzés szükséges', async () => {
    const { promise } = paidRejectRecoverySetup('guest-bind-privileged-account', {
      action: 'skipped',
      detail: 'already-refunded',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
  })

  it('total-mismatch + régi helyi nyom skip → ellenőrzés szükséges', async () => {
    const { promise } = paidRejectRecoverySetup('total-mismatch', {
      action: 'skipped',
      detail: 'already-recorded',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['failed', CHECKOUT_PAID_UNDER_REVIEW],
    ['skipped', CHECKOUT_PAID_UNDER_REVIEW],
    ['refunded', CHECKOUT_REFUNDED_RETRY],
  ] as const)(
    'aktív refund reconciliation %s eredménye nem állíthat már megvett hozzáférést',
    async (action, message) => {
      const { promise, calls } = paidRejectRecoverySetup('refund-pending-reconciliation', {
        action,
        detail: 'refund-pending-reconciliation',
      })
      await expect(promise).rejects.toMatchObject({ status: 409, message })
      expect(message).not.toBe(CHECKOUT_ALREADY_PURCHASED)
      expect(calls.create).toHaveLength(0)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('refund-recorded reject (rögzített refund-nyomú függő rendelés) → felülvizsgálat-üzenet', async () => {
    const { promise } = paidRejectRecoverySetup('refund-recorded', {
      action: 'skipped',
      detail: 'reason-not-refundable',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
    expect(error.message).not.toBe(CHECKOUT_ALREADY_PURCHASED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('privilegizált kötés + részleges Barion-refund skip → 409 a felülvizsgálat-üzenettel', async () => {
    const { promise } = paidRejectRecoverySetup('guest-bind-privileged-account', {
      action: 'skipped',
      detail: 'barion-partially-refunded',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_PAID_UNDER_REVIEW)
    expect(error.message).not.toBe(CHECKOUT_REFUNDED_PRIVILEGED)
  })

  it('duplicate-paid + SIKERTELEN refund → az already-paid üzenet marad (van élő hozzáférés)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { promise } = paidRejectRecoverySetup('duplicate-paid-order', {
      action: 'failed',
      detail: 'barion-refund-error',
    })

    const error = await checkoutErrorFrom(promise)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CHECKOUT_ALREADY_PURCHASED)
    expect(error.message).not.toBe(CHECKOUT_PAID_UNDER_REVIEW)
    logSpy.mockRestore()
  })

  it('lejárt időkorlátos hozzáférés: bejelentkezve újravásárolható', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload({
      product: { ...publishedProduct, accessDurationDays: 365 } as Product,
      findOrders: (where) =>
        whereMentions(where, '"paid"')
          ? { docs: [{ id: 55, status: 'paid' }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })

    const result = await startCheckout({
      payload,
      user: mockUser,
      input: happyInput,
      resolveSingleCourseAccess: async () => ({
        hasAccess: false,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        reason: 'expired',
      }),
    })

    expect(calls.create).toHaveLength(1)
    expect(result.orderNumber).toBe(ORDER_NUMBER)
  })

  it('korlátlan SKU tulajdonlás (purchases): 409, hasAccess fail-open nem számít', async () => {
    const owner = { ...mockUser, purchases: [42] } as unknown as User
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({
      payload,
      user: owner,
      input: happyInput,
      resolveSingleCourseAccess: async () => ({
        hasAccess: true,
        expiresAt: null,
        reason: 'unlimited',
      }),
    })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    expect(calls.create).toHaveLength(0)
  })
})

describe('startCheckout — termék- és inputellenőrzés', () => {
  it('archived termék → 400, magyar üzenettel', async () => {
    const { payload, calls } = createMockPayload({
      product: { ...publishedProduct, status: 'archived' } as Product,
    })
    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/archivált/)
    expect(calls.create).toHaveLength(0)
  })

  it('draft termék → 400', async () => {
    const { payload } = createMockPayload({
      product: { ...publishedProduct, status: 'draft' } as Product,
    })
    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/jelenleg nem megvásárolható/)
  })

  /**
   * ÁR-KAPU (latens hiba, gomb-inventár mérés): a `priceInHUFEnabled: true` +
   * `priceInHUF: 0` páros korábban ÁTMENT a kapun, és VALÓDI Barion-fizetés
   * indult volna 0 Ft-ról — a Barion vagy hibázik (a vevő 502-t kap), vagy
   * létrejön egy 0 forintos rendelés és számla, amit kézzel kell takarítani.
   *
   * Az ingyenességet az ár-pipa `false` értéke fejezi ki (külön, Barion nélküli
   * út), NEM a 0 Ft — ezért a nulla és minden nem pozitív érték ugyanazon az
   * ágon bukik, mint a hiányzó ár.
   *
   * A fetch-mock itt HANGOSAN DOB: ha a kapu mégis átengedné, nem csendes
   * mellékhatás lesz belőle, hanem néven nevezett tesztbukás (és valódi
   * hálózati hívás így sem indulhat — CLAUDE.md 15. tanulság).
   */
  it.each([
    ['0 Ft', 0],
    ['negatív ár', -1],
    ['NaN ár (typeof number, de értelmezhetetlen)', Number.NaN],
  ])(
    'érvénytelen ár (%s) → 400, rendelés NEM jön létre, Barion NEM hívódik',
    async (_label, price) => {
      fetchMock.mockImplementation(() => {
        throw new Error('TESZT: érvénytelen árú terméknél NEM indulhat Barion-hívás')
      })
      const { payload, calls } = createMockPayload({
        product: { ...publishedProduct, priceInHUFEnabled: true, priceInHUF: price } as Product,
      })

      const promise = startCheckout({ payload, user: mockUser, input: happyInput })

      await expect(promise).rejects.toBeInstanceOf(CheckoutError)
      await expect(promise).rejects.toMatchObject({ status: 400 })
      await expect(promise).rejects.toThrowError(/nem tartozik érvényes ár/)
      expect(calls.create).toHaveLength(0)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('hiányzó ár (priceInHUF: null) → változatlanul 400, ugyanazzal az üzenettel', async () => {
    const { payload, calls } = createMockPayload({
      product: { ...publishedProduct, priceInHUFEnabled: true, priceInHUF: null } as Product,
    })

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/nem tartozik érvényes ár/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kikapcsolt ár-pipa (ingyenes kurzus) → 400: a fizetős úton nem indul Barion-hívás', async () => {
    const { payload, calls } = createMockPayload({
      product: { ...publishedProduct, priceInHUFEnabled: false, priceInHUF: 5000 } as Product,
    })

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })

    await expect(promise).rejects.toMatchObject({ status: 400 })
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('nem létező termék → 404', async () => {
    const { payload } = createMockPayload({ product: null })
    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toMatchObject({ status: 404 })
    await expect(promise).rejects.toThrowError(/nem található/)
  })

  it('hiányzó waiver → 400 (a mező rögzítése kötelező)', async () => {
    const { payload, calls } = createMockPayload()
    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { productId: 42, consentWithdrawalWaiver: false, consentTerms: true },
    })
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/elállási jog/)
    expect(calls.create).toHaveLength(0)
  })

  it('érvénytelen productId → 400', async () => {
    const { payload } = createMockPayload()
    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { productId: 'abc', consentWithdrawalWaiver: true, consentTerms: true },
    })
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/kurzus azonosítója/)
  })

  it('quantity 2 → 400: digitális kurzusból csak 1 példány vásárolható', async () => {
    const { payload, calls } = createMockPayload()
    const promise = startCheckout({
      payload,
      user: mockUser,
      input: { ...happyInput, quantity: 2 },
    })
    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrowError(/egy példány/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('startCheckout — piszkozat-regresszió (átadás-doksi 3. szakasz 3. sor)', () => {
  it('a terméket a PUBLIKÁLT sorral olvassa: a products findByID draft: true NÉLKÜL hívódik', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()

    await startCheckout({ payload, user: mockUser, input: happyInput })

    const productLookup = calls.findByID.find((args) => args.collection === 'products')
    expect(productLookup).toBeDefined()
    // A piszkozat-verzió (autosave) sosem lehet a vásárolhatóság forrása:
    // a draft kulcs vagy hiányzik az argsból, vagy kifejezetten false.
    expect(productLookup!.draft ?? false).toBe(false)
    // A belső olvasás továbbra is access-felülírással fut.
    expect(productLookup!.overrideAccess).toBe(true)
  })
})

describe('startCheckout — Barion-hibaág', () => {
  it('Barion Start-hiba esetén a rendelés payment_pending marad és 502 jelzés megy vissza', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Errors: [{ ErrorCode: 'AuthenticationFailed', Title: 'auth failed', Description: 'x' }],
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const { payload, calls } = createMockPayload()

    const promise = startCheckout({ payload, user: mockUser, input: happyInput })
    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 502 })
    await expect(promise).rejects.toThrowError(/fizetés indítása most nem sikerült/)

    expect(calls.update).toHaveLength(0)
    expect(
      calls.update.every((call) => (call.data as { status?: string }).status !== 'payment_failed'),
    ).toBe(true)
  })

  it('Barion Start siker + persist-hiba: a rendelés pending marad, a gateway URL visszamegy', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload({ persistBarionIdsFails: true })

    const result = await startCheckout({ payload, user: mockUser, input: happyInput })

    expect(result).toEqual({ orderNumber: ORDER_NUMBER, gatewayUrl: GATEWAY_URL })
    expect(
      calls.update.every((call) => (call.data as { status?: string }).status !== 'payment_failed'),
    ).toBe(true)
  })
})

describe('POST /api/checkout/start route-handler', () => {
  const makeRequest = (body: unknown, ip = '203.0.113.20'): NextRequest =>
    new NextRequest('https://shop.example.test/api/checkout/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  /**
   * A handler A2 óta IP-alapú kérés-korlátozón megy át. Minden teszt SAJÁT,
   * üres számlálót kap, hogy a tesztek se egymást, se a közös (folyamaton
   * belüli) számlálót ne befolyásolják.
   */
  const makeHandler = (getPayload: () => Promise<Payload>) =>
    createCheckoutStartHandler({
      getPayload,
      rateLimit: { limiter: new SlidingWindowRateLimiter() },
    })

  it('bejelentkezés nélkül, vendég-adat NÉLKÜL → 400, magyar üzenettel (a 401 megszűnt)', async () => {
    // VENDÉG-VÁSÁRLÁS: a végpont már nem követel munkamenetet — de az
    // azonosító adatok (e-mail + név) hiánya bemeneti hiba (400), nem
    // jogosultsági (401). A fizetés semmiképp nem indul el.
    const { payload } = createMockPayload({ authUser: null })
    const POST = makeHandler(async () => payload)

    const response = await POST(makeRequest(happyInput))

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('add meg az e-mail-címed és a neved')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bejelentkezés nélkül, TELJES vendég-adattal → 200 (a rendelés fiók nélkül, e-maillel jön létre)', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload({ authUser: null })
    const POST = makeHandler(async () => payload)

    const response = await POST(
      makeRequest({
        ...happyInput,
        guest: { email: 'Vendeg.Vevo@Example.TEST', name: 'Vendég Vevő' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ orderNumber: ORDER_NUMBER, gatewayUrl: GATEWAY_URL })
    const created = calls.create[0] as Record<string, unknown>
    // Fiók MÉG nincs — a kapocs kizárólag a (kisbetűsített) e-mail-cím.
    expect(created.customer).toBeUndefined()
    expect(created.customerEmail).toBe('vendeg.vevo@example.test')
  })

  it('bejelentkezett vevő → 200 { orderNumber, gatewayUrl }', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload } = createMockPayload()
    const POST = makeHandler(async () => payload)

    const response = await POST(makeRequest(happyInput))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ orderNumber: ORDER_NUMBER, gatewayUrl: GATEWAY_URL })
  })

  it('üzleti hiba (pl. duplavásárlás) → a CheckoutError státusza és magyar üzenete', async () => {
    const { payload } = createMockPayload({
      findOrders: (where) =>
        JSON.stringify(where ?? {}).includes('"paid"')
          ? { docs: [{ id: 55 }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })
    const POST = makeHandler(async () => payload)

    const response = await POST(makeRequest(happyInput))

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe(CHECKOUT_ALREADY_PURCHASED)
  })

  it('a KLIENS MEGKERÜLHETŐ: hiányos számlázási adattal küldött kérés → 400, magyar üzenettel', async () => {
    const { payload } = createMockPayload()
    const POST = makeHandler(async () => payload)

    const response = await POST(
      makeRequest({ ...happyInput, billing: { ...CHECKOUT_BILLING, street: '' } }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Add meg az utcát és a házszámot.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('teljes számlázási adattal → 200, és a snapshotba a KÉRÉSBEN küldött adat kerül', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()
    const POST = makeHandler(async () => payload)

    const response = await POST(makeRequest({ ...happyInput, billing: CHECKOUT_BILLING }))

    expect(response.status).toBe(200)
    expect((calls.create[0] as Record<string, unknown>).customerSnapshot).toMatchObject({
      billingCity: 'Szombathely',
      billingStreet: 'Fő tér 2/A',
    })
  })

  it('nem-JSON törzs → 400', async () => {
    const { payload } = createMockPayload()
    const POST = makeHandler(async () => payload)

    const response = await POST(makeRequest('ez nem json {'))

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toHaveProperty('error')
  })

  it('SEC-008: a méret-plafont túllépő törzs → 400, Barion NEM hívódik', async () => {
    const { payload } = createMockPayload()
    const POST = makeHandler(async () => payload)

    const response = await POST(makeRequest({ ...happyInput, pad: 'x'.repeat(70_000) }))

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('váratlan technikai hiba → 500, általános magyar üzenettel (a részletek csak a naplóba)', async () => {
    const POST = makeHandler(async () => {
      throw new Error('DB-kapcsolat megszakadt')
    })

    const response = await POST(makeRequest(happyInput))

    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    // §2.7: a helyzet + a teendő, technikai részlet nélkül.
    expect(body.error).toContain('A fizetés indítása most nem sikerült')
    expect(body.error).not.toContain('DB-kapcsolat')
  })

  it('A2 — az IP-nkénti keret felett 429, magyar üzenettel; Payload és Barion NEM hívódik', async () => {
    const limiter = new SlidingWindowRateLimiter()
    let payloadLoads = 0
    const { payload } = createMockPayload()
    const POST = createCheckoutStartHandler({
      getPayload: async () => {
        payloadLoads += 1
        return payload
      },
      rateLimit: { limiter },
    })

    const allowed = RATE_LIMIT_RULES['checkout-start'].limit
    for (let index = 0; index < allowed; index += 1) {
      fetchMock.mockResolvedValueOnce(barionStartSuccess())
      expect((await POST(makeRequest(happyInput, '203.0.113.30'))).status).toBe(200)
    }

    const throttled = await POST(makeRequest(happyInput, '203.0.113.30'))

    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0)
    const body = (await throttled.json()) as { error: string }
    expect(body.error).toContain('Túl sok próbálkozás')
    // A korlát a DRÁGA lépések előtt fog: nincs újabb Payload-betöltés és Barion-hívás.
    expect(payloadLoads).toBe(allowed)
    expect(fetchMock).toHaveBeenCalledTimes(allowed)

    // Másik IP kerete érintetlen.
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    expect((await POST(makeRequest(happyInput, '203.0.113.31'))).status).toBe(200)
  })
})

describe('T-063 — plugin-adapter-kontroll', () => {
  it('a végleges config NEM tartalmaz plugin /payments/* végpontot (confirmOrder-útvonal nem létezik)', async () => {
    const config = await configPromise
    const paths = (config.endpoints ?? []).map((endpoint) => endpoint.path)
    const paymentPaths = paths.filter((path) => path.startsWith('/payments/'))
    expect(paymentPaths).toEqual([])
  })

  it('az adapter confirmOrder-je SOHA nem fut le sikeresen (paid csak a Barion-callback-útvonalon)', async () => {
    const update = vi.fn()
    const fakeReq = {
      payload: { update },
      user: mockUser,
    }

    await expect(
      barionPaymentAdapter.confirmOrder({ data: { paymentID: 'x' }, req: fakeReq as never }),
    ).rejects.toThrowError(/confirmOrder nem ellenőrzi a fizetés tényleges státuszát/)

    // Bizonyíték: semmilyen rendelés-módosítás (paid-re állítás) nem történt.
    expect(update).not.toHaveBeenCalled()
  })

  it('a withoutPluginPaymentEndpoints szűrő eltávolítja a plugin payment-végpontjait', () => {
    const endpoints = [
      { path: '/payments/barion/initiate', method: 'post', handler: vi.fn() },
      { path: '/payments/barion/confirm-order', method: 'post', handler: vi.fn() },
      { path: '/egyeb', method: 'get', handler: vi.fn() },
    ] as never[]

    const kept = withoutPluginPaymentEndpoints(endpoints)

    expect(kept.map((endpoint) => endpoint.path)).toEqual(['/egyeb'])
  })

  it('az adapter initiatePayment-je a checkout-szolgáltatásra épül (startPayment a libből)', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload } = createMockPayload()
    const req = { payload, user: mockUser }

    const result = (await barionPaymentAdapter.initiatePayment({
      data: {
        cart: { items: [{ product: 42, quantity: 1 }] },
        currency: 'HUF',
        consentWithdrawalWaiver: true,
        consentTerms: true,
      } as never,
      req: req as never,
      transactionsSlug: 'transactions',
    })) as { message: string; orderNumber: string; gatewayUrl: string }

    expect(result.orderNumber).toBe(ORDER_NUMBER)
    expect(result.gatewayUrl).toBe(GATEWAY_URL)
    expect(lastBarionRequestBody().PaymentRequestId).toBe(ORDER_NUMBER)
  })

  it('az adapter név/címke bekötve (barion)', () => {
    expect(barionPaymentAdapter.name).toBe('barion')
    expect(barionPaymentAdapter.label).toContain('Barion')
  })
})
