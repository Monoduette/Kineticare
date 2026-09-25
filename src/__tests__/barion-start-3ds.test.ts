import { readFileSync } from 'node:fs'

import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../lib/alert-throttle'
import { resolveAlertCode } from '../lib/alerts/classify'
import { ALERT_RUNBOOK_PATH, buildAlertMail, summarizeAlert } from '../lib/alerts/mail'
import type { BarionClientConfig } from '../lib/barion/client'
import {
  buildPaymentStartRequest,
  splitStreetLines,
  type StartPaymentParams,
  type StartPaymentThreeDsInput,
} from '../lib/barion/start'
import { CHECKOUT_START_REJECTED } from '../lib/checkout/form-submission'
import { CheckoutError, startCheckout } from '../lib/checkout/start-checkout'
import type { Logger } from '../lib/logger'
import type { Order, Product, User } from '../payload-types'

/**
 * r-barion-10, a-checkout-11, r-barion-14, a-checkout-15: a Payment/Start
 * body 3DS-adatai és az OrderNumber.
 *
 * Egy rossz mezőnév, enum-érték vagy túl hosszú érték miatt a Barion MINDEN
 * Startot elutasítana (ModelValidationError), vagyis az eladás megállna.
 * Ezért a body-t PONTOSAN állítjuk (toEqual), a forrásokkal egyeztetett
 * értékekkel (docs.barion.com Wayback-oldalai és a barion-web-php modelljei,
 * lásd src/lib/barion/start.ts fejléce), és a vészkapcsoló (BARION_SEND_3DS)
 * viselkedését is. A fájl hálózatot nem ér el: a fetch mockolt (CLAUDE.md 15.).
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'

const testConfig: BarionClientConfig = {
  environment: 'test',
  apiUrl: 'https://api.test.barion.com',
  posKey: DUMMY_POS_KEY,
  payeeEmail: 'payee@example.test',
  timeoutMs: 35_000,
  recurringEnabled: false,
}

const PURCHASE_DATE = new Date('2026-09-24T10:21:14.878Z')

const baseParams: StartPaymentParams = {
  paymentRequestId: 'KH-2026-000123',
  orderNumber: 'KH-2026-000123',
  redirectUrl: 'https://shop.example.test/fizetes/koszonom?order=KH-2026-000123',
  callbackUrl: 'https://shop.example.test/api/barion/callback',
  payerHint: 'vevo@example.test',
  cardHolderNameHint: 'Minta Mari',
  transactions: [
    {
      posTransactionId: 'KH-2026-000123-1',
      total: 5000,
      comment: 'Kineticare rendelés KH-2026-000123',
      items: [
        {
          name: 'KURZUS-ALAP',
          description: 'Alap kurzus',
          quantity: 1,
          unit: 'db',
          unitPrice: 5000,
          itemTotal: 5000,
          sku: 'KURZUS-ALAP',
        },
      ],
    },
  ],
}

const guestThreeDs: StartPaymentThreeDsInput = {
  billingAddress: { country: 'HU', zip: '1011', city: 'Budapest', street: 'Fő utca 1.' },
  deliveryEmailAddress: 'vevo@example.test',
  purchaseDate: PURCHASE_DATE,
  payerAccount: { kind: 'guest' },
}

let savedSend3ds: string | undefined
beforeEach(() => {
  savedSend3ds = process.env.BARION_SEND_3DS
  delete process.env.BARION_SEND_3DS
})
afterEach(() => {
  if (savedSend3ds === undefined) {
    delete process.env.BARION_SEND_3DS
  } else {
    process.env.BARION_SEND_3DS = savedSend3ds
  }
})

describe('buildPaymentStartRequest — 3DS és OrderNumber (pontos body)', () => {
  it('vendég: a teljes body pontosan (BillingAddress, PurchaseInformation, NoAccount, NoPreference, OrderNumber)', () => {
    expect(buildPaymentStartRequest({ ...baseParams, threeDs: guestThreeDs }, testConfig)).toEqual({
      PaymentType: 'Immediate',
      GuestCheckOut: true,
      FundingSources: ['All'],
      Locale: 'hu-HU',
      Currency: 'HUF',
      PaymentWindow: '00:30:00',
      PaymentRequestId: 'KH-2026-000123',
      OrderNumber: 'KH-2026-000123',
      PayerHint: 'vevo@example.test',
      CardHolderNameHint: 'Minta Mari',
      RedirectUrl: 'https://shop.example.test/fizetes/koszonom?order=KH-2026-000123',
      CallbackUrl: 'https://shop.example.test/api/barion/callback',
      Transactions: [
        {
          POSTransactionId: 'KH-2026-000123-1',
          Payee: 'payee@example.test',
          Total: 5000,
          Currency: 'HUF',
          Comment: 'Kineticare rendelés KH-2026-000123',
          Items: [
            {
              Name: 'KURZUS-ALAP',
              Description: 'Alap kurzus',
              Quantity: 1,
              Unit: 'db',
              UnitPrice: 5000,
              ItemTotal: 5000,
              SKU: 'KURZUS-ALAP',
            },
          ],
        },
      ],
      BillingAddress: { Country: 'HU', City: 'Budapest', Zip: '1011', Street: 'Fő utca 1.' },
      PurchaseInformation: {
        DeliveryTimeframe: 'ElectronicDelivery',
        DeliveryEmailAddress: 'vevo@example.test',
        ShippingAddressIndicator: 'DigitalGoods',
        PurchaseType: 'GoodsAndServicePurchase',
        // UTC, ezredmásodperccel, `Z` NÉLKÜL (docs: "2019-06-27T07:15:51.327").
        PurchaseDate: '2026-09-24T10:21:14.878',
      },
      PayerAccountInformation: { AccountCreationIndicator: 'NoAccount' },
      ChallengePreference: 'NoPreference',
    })
  })

  it.each([
    ['29 napos fiók', '2026-08-26T10:21:14.878Z', 'LessThan30Days'],
    ['45 napos fiók', '2026-08-10T10:21:14.878Z', 'Between30And60Days'],
    ['pontosan 60 napos fiók', '2026-07-26T10:21:14.878Z', 'Between30And60Days'],
    ['90 napos fiók', '2026-06-26T10:21:14.878Z', 'MoreThan60Days'],
  ])(
    'bejelentkezett vevő (%s): AccountId, AccountCreated (Z nélkül) és a fiók kora',
    (_label, created, indicator) => {
      const request = buildPaymentStartRequest(
        {
          ...baseParams,
          threeDs: {
            ...guestThreeDs,
            payerAccount: { kind: 'account', accountId: '7', accountCreated: new Date(created) },
          },
        },
        testConfig,
      )
      expect(request.PayerAccountInformation).toEqual({
        AccountId: '7',
        AccountCreated: created.replace(/Z$/, ''),
        AccountCreationIndicator: indicator,
      })
    },
  )

  it('bejelentkezett vevő érvénytelen vagy hiányzó létrehozási idővel: csak az AccountId megy ki', () => {
    for (const accountCreated of [null, new Date('nem dátum')]) {
      const request = buildPaymentStartRequest(
        {
          ...baseParams,
          threeDs: {
            ...guestThreeDs,
            payerAccount: { kind: 'account', accountId: '7', accountCreated },
          },
        },
        testConfig,
      )
      expect(request.PayerAccountInformation).toEqual({ AccountId: '7' })
    }
  })

  it('a hosszkorlátok: City 50, Zip 16, Street/Street2/Street3 egyenként 50, szóhatáron vágva', () => {
    const street =
      'Nagyon Hosszú Nevű Közterület Mellékutcája 123. B épület ' +
      'harmadik emelet huszonkettedik ajtó a lépcsőháztól balra ' +
      'a kapucsengő a portán, kérem csengessen kétszer egymás után mindig'
    const request = buildPaymentStartRequest(
      {
        ...baseParams,
        threeDs: {
          ...guestThreeDs,
          billingAddress: {
            country: 'HU',
            zip: '1011',
            city: 'Szabolcs-Szatmár-Bereg megyei Nyíregyháza-Sóstóhegy városrész',
            street,
          },
        },
      },
      testConfig,
    )
    const address = request.BillingAddress
    expect(address?.City).toBe('Szabolcs-Szatmár-Bereg megyei Nyíregyháza-Sóstóheg')
    expect(address?.City).toHaveLength(50)
    for (const line of [address?.Street, address?.Street2, address?.Street3]) {
      expect(line).toBeDefined()
      expect((line ?? '').length).toBeLessThanOrEqual(50)
      expect(line).not.toMatch(/^\s|\s$/)
    }
    expect(address?.Street).toBe('Nagyon Hosszú Nevű Közterület Mellékutcája 123. B')
    // A három sor együtt a cím eleje, szóközzel összefűzve.
    expect(street.startsWith([address?.Street, address?.Street2, address?.Street3].join(' '))).toBe(
      true,
    )
  })

  it('a hosszt UTF-16 egységben méri (a Barion .NET): az emoji két egység, félbe nem vágjuk', () => {
    const lines = splitStreetLines(`${'a'.repeat(49)}😀b`)
    expect(lines[0]).toBe('a'.repeat(49))
    expect(lines[1]).toBe('😀b')
    const request = buildPaymentStartRequest(
      {
        ...baseParams,
        threeDs: {
          ...guestThreeDs,
          billingAddress: { ...guestThreeDs.billingAddress, city: `${'á'.repeat(49)}😀` },
        },
      },
      testConfig,
    )
    expect(request.BillingAddress?.City).toBe('á'.repeat(49))
  })

  it('üres e-mail- és utcamező kimarad (üres string nem megy ki)', () => {
    const request = buildPaymentStartRequest(
      {
        ...baseParams,
        threeDs: {
          ...guestThreeDs,
          deliveryEmailAddress: '  ',
          billingAddress: { country: 'ZZ', zip: '', city: '', street: '' },
        },
      },
      testConfig,
    )
    expect(request.BillingAddress).toEqual({ Country: 'ZZ' })
    expect(request.PurchaseInformation).not.toHaveProperty('DeliveryEmailAddress')
  })

  it.each([['false'], ['FALSE'], [' False ']])(
    'BARION_SEND_3DS=%j: a négy 3DS-blokk kimarad, az OrderNumber marad',
    (value) => {
      process.env.BARION_SEND_3DS = value
      const request = buildPaymentStartRequest({ ...baseParams, threeDs: guestThreeDs }, testConfig)
      expect(request).not.toHaveProperty('BillingAddress')
      expect(request).not.toHaveProperty('PurchaseInformation')
      expect(request).not.toHaveProperty('PayerAccountInformation')
      expect(request).not.toHaveProperty('ChallengePreference')
      expect(request.OrderNumber).toBe('KH-2026-000123')
    },
  )

  it.each([['true'], ['0'], ['']])(
    'BARION_SEND_3DS=%j: nem kapcsol ki (csak a szó szerinti false)',
    (value) => {
      process.env.BARION_SEND_3DS = value
      const request = buildPaymentStartRequest({ ...baseParams, threeDs: guestThreeDs }, testConfig)
      expect(request.ChallengePreference).toBe('NoPreference')
    },
  )
})

/**
 * W1A-1: a félreértett érték ('0', 'off') a szigorú értelmezés miatt NEM
 * kapcsol ki, és ez ne maradjon néma: a folyamat egyszer figyelmeztet (a
 * Start minden hívása olvassa a kapcsolót, a napló mégse teljen meg). A
 * modul-szintű jelzőt friss modulpéldány nullázza (vi.resetModules), így
 * nincs csak tesztnek szóló visszaállító export.
 */
describe('BARION_SEND_3DS — nem ismert érték: egyszeri figyelmeztetés a naplóban', () => {
  async function freshBuild(): Promise<typeof buildPaymentStartRequest> {
    vi.resetModules()
    const fresh = await import('../lib/barion/start')
    return fresh.buildPaymentStartRequest
  }

  function send3dsWarnings(calls: ReadonlyArray<ReadonlyArray<unknown>>): string[] {
    return calls
      .map((call) => JSON.parse(String(call[0])) as { level?: string; msg?: string })
      .filter((line) => line.level === 'warn' && String(line.msg).includes('BARION_SEND_3DS'))
      .map((line) => String(line.msg))
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([['0'], ['off']])(
    'BARION_SEND_3DS=%j: a 3DS bekapcsolva marad, két Startra is csak egy figyelmeztetés',
    async (value) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const build = await freshBuild()
      process.env.BARION_SEND_3DS = value

      const first = build({ ...baseParams, threeDs: guestThreeDs }, testConfig)
      const second = build({ ...baseParams, threeDs: guestThreeDs }, testConfig)

      expect(first.ChallengePreference).toBe('NoPreference')
      expect(second.ChallengePreference).toBe('NoPreference')
      const warnings = send3dsWarnings(logSpy.mock.calls)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('bekapcsolva marad')
      expect(warnings[0]).toContain('„false”')
    },
  )

  it.each([[undefined], [''], ['true'], ['false'], [' FALSE ']])(
    'BARION_SEND_3DS=%j: ismert vagy üres érték, nincs figyelmeztetés',
    async (value) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const build = await freshBuild()
      if (value !== undefined) {
        process.env.BARION_SEND_3DS = value
      }

      const request = build({ ...baseParams, threeDs: guestThreeDs }, testConfig)

      expect(request.ChallengePreference).toBe(
        value?.trim().toLowerCase() === 'false' ? undefined : 'NoPreference',
      )
      expect(send3dsWarnings(logSpy.mock.calls)).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// A pénztár bekötése: a Barion felé ténylegesen kimenő body, és a Barion
// validációs elutasításának osztályozása (vezetői kikötés a 3DS-hez).
// ---------------------------------------------------------------------------

const ORDER_NUMBER = 'KH-2026-000123'
const DUMMY_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'

const publishedProduct = {
  id: 42,
  sku: 'KURZUS-ALAP',
  status: 'published',
  priceInHUF: 5000,
  priceInHUFEnabled: true,
  shortDescription: 'Alap kurzus',
} as unknown as Product

const loggedInUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  role: 'customer',
  createdAt: '2026-01-10T08:00:00.000Z',
} as unknown as User

const checkoutInput = {
  productId: 42,
  consentWithdrawalWaiver: true,
  consentTerms: true,
  billing: { name: 'Minta Mari', zip: '1011', city: 'Budapest', street: 'Fő utca 1.' },
}

function checkoutPayload() {
  const row: Record<string, unknown> = { id: 101, status: 'nincs-meg', orderNumber: ORDER_NUMBER }
  const payload = {
    findByID: vi.fn(async (args: { collection: string }) =>
      args.collection === 'orders' ? { ...row } : publishedProduct,
    ),
    find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, { status: 'payment_pending', createdAt: new Date().toISOString() })
      return {
        ...data,
        id: 101,
        orderNumber: ORDER_NUMBER,
        totalHufSnapshot: 5000,
        items: [{ product: 42, quantity: 1, titleSnapshot: 'KURZUS-ALAP', priceHufSnapshot: 5000 }],
      } as unknown as Order
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data)
      return { ...row }
    }),
  }
  return { payload: payload as unknown as Payload, row }
}

function captureLogger(): {
  log: Logger
  errors: Array<{ message: string; context: Record<string, unknown> }>
} {
  const errors: Array<{ message: string; context: Record<string, unknown> }> = []
  const nothing = (): void => undefined
  const log: Logger = {
    debug: nothing,
    info: nothing,
    warn: nothing,
    error: (message, context) => {
      errors.push({ message, context: context ?? {} })
    },
    child: () => log,
  }
  return { log, errors }
}

const fetchMock = vi.fn()
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
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  resetAlertThrottle()
})

/**
 * A tulajdonosnak menő riasztás-levél szövege abból a naplósorból, amelyet a
 * pénztár ténylegesen írt (a sink ugyanígy képzi: kód → összefoglaló → levél).
 */
function ownerAlertMail(entry: { message: string; context: Record<string, unknown> }): {
  alertCode: string | null
  text: string
} {
  const alertCode = resolveAlertCode(entry.message, {}, entry.context)
  const summary = summarizeAlert({
    alertCode: alertCode ?? 'nincs-kod',
    msg: entry.message,
    ts: PURCHASE_DATE.toISOString(),
    bindings: {},
    context: entry.context,
  })
  return { alertCode, text: buildAlertMail(summary, 0).text }
}

const RUNBOOK = readFileSync(new URL(`../../${ALERT_RUNBOOK_PATH}`, import.meta.url), 'utf8')

function startBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(String(call[1].body ?? '{}')) as Record<string, unknown>
}

describe('startCheckout → Payment/Start: a 3DS-adatok és az OrderNumber a kimenő kérésben', () => {
  it('bejelentkezett vevő: magyar számlázási cím, a fiók adatai, OrderNumber = rendelésszám', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          PaymentId: DUMMY_PAYMENT_ID,
          PaymentRequestId: ORDER_NUMBER,
          Status: 'Prepared',
          GatewayUrl: `https://secure.test.barion.com/Pay?id=${DUMMY_PAYMENT_ID}`,
          Transactions: [],
          Errors: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const { payload } = checkoutPayload()

    await startCheckout({
      payload,
      user: loggedInUser,
      input: checkoutInput,
      now: PURCHASE_DATE,
    })

    const body = startBody()
    expect(body).toMatchObject({
      PaymentRequestId: ORDER_NUMBER,
      OrderNumber: ORDER_NUMBER,
      BillingAddress: { Country: 'HU', City: 'Budapest', Zip: '1011', Street: 'Fő utca 1.' },
      PurchaseInformation: {
        DeliveryTimeframe: 'ElectronicDelivery',
        DeliveryEmailAddress: 'vevo@example.test',
        ShippingAddressIndicator: 'DigitalGoods',
        PurchaseType: 'GoodsAndServicePurchase',
        PurchaseDate: '2026-09-24T10:21:14.878',
      },
      PayerAccountInformation: {
        AccountId: '7',
        AccountCreated: '2026-01-10T08:00:00.000',
        AccountCreationIndicator: 'MoreThan60Days',
      },
      ChallengePreference: 'NoPreference',
    })
  })

  it('a Barion ModelValidationError-ja (400) → a vevő az elutasítás szövegét kapja, RIASZTÁS a hibakóddal (a levélben is, runbook-sorral), a rendelés payment_failed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Errors: [
            {
              ErrorCode: 'ModelValidationError',
              Title: 'The field BillingAddress.City must be a string with a maximum length of 50.',
              Description: 'x',
            },
          ],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const { payload, row } = checkoutPayload()
    const { log, errors } = captureLogger()

    let caught: unknown
    try {
      await startCheckout({ payload, user: loggedInUser, input: checkoutInput, logger: log })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CheckoutError)
    expect((caught as CheckoutError).status).toBe(502)
    expect((caught as CheckoutError).message).toBe(CHECKOUT_START_REJECTED)
    expect(row.status).toBe('payment_failed')
    const alert = errors.find((entry) => entry.message.startsWith('RIASZTÁS:'))
    expect(alert?.message).toContain('elutasította a fizetésindítást')
    expect(alert?.context).toMatchObject({
      httpStatus: 400,
      providerErrorCodes: ['ModelValidationError'],
    })
    expect(String(alert?.context.operatorHint)).toContain('nem felel meg a Barion szabályainak')

    // W1A-1: a tulajdonosi levél is megnevezi a Barion hibakódját (a
    // providerErrorCodes és az operatorHint nem jut át a levél szűrőjén), és a
    // riasztáskódhoz van teendő a runbookban.
    const mail = ownerAlertMail(alert ?? { message: '', context: {} })
    expect(mail.text).toContain('barionErrorKind: ModelValidationError')
    expect(mail.alertCode).toBe('a-barion-elutasitotta-a-fizetesinditast')
    expect(RUNBOOK).toContain(`\`${String(mail.alertCode)}\``)
  })
})
