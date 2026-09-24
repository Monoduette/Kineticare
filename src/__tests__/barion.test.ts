import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BARION_DEFAULT_TIMEOUT_MS,
  BARION_MAX_TIMEOUT_MS,
  getBarionConfig,
  type BarionClientConfig,
} from '../lib/barion/client'
import {
  BARION_DEFAULT_PAYMENT_WINDOW,
  buildPaymentStartRequest,
  startPayment,
  type StartPaymentParams,
} from '../lib/barion/start'
import { fetchPaymentState, mapBarionPaymentStatus } from '../lib/barion/state'
import { buildRefundRequest, refundPayment } from '../lib/barion/refund'
import { BarionApiError } from '../lib/barion/types'

/**
 * Barion-kliens egységtesztek — mockolt fetch-csel, hálózat nélkül.
 *
 * A DUMMY_POS_KEY szándékosan NEM valós POSKey-formátum és feliratozva is
 * dummy: titok (még teszt-jellegű sem) sosem kerülhet a repóba.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_PROD_POS_KEY = 'DUMMY-PROD-POSKEY-NEM-VALODI-TITOK'

const DUMMY_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const DUMMY_TRANSACTION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const testConfig: BarionClientConfig = {
  environment: 'test',
  apiUrl: 'https://api.test.barion.com',
  posKey: DUMMY_POS_KEY,
  payeeEmail: 'payee@example.test',
  timeoutMs: 15_000,
  recurringEnabled: false,
}

const validEnv = {
  BARION_ENVIRONMENT: 'test',
  BARION_API_URL: 'https://api.test.barion.com/',
  BARION_PAYEE_EMAIL: 'payee@example.test',
  BARION_POSKEY_TEST: DUMMY_POS_KEY,
  BARION_POSKEY_PROD: DUMMY_PROD_POS_KEY,
} as unknown as NodeJS.ProcessEnv

const fetchMock = vi.fn()
// A globális fetch-stub nem maradhat át más tesztfájlra (CLAUDE.md 15. tanulság):
// beforeEach-ben állítjuk be, az afterEach pedig visszaállítja.
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function lastRequest(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
  const [url, init] = call
  return {
    url,
    init,
    body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
  }
}

const startParams: StartPaymentParams = {
  paymentRequestId: 'KH-2026-000123',
  redirectUrl: 'https://shop.example.test/fizetes/koszonom',
  callbackUrl: 'https://shop.example.test/api/barion/callback',
  payerHint: 'vevo@example.test',
  cardHolderNameHint: 'Minta Mari',
  transactions: [
    {
      posTransactionId: 'KH-2026-000123-1',
      total: 24990,
      comment: 'Kurzuscsomag',
      items: [
        {
          name: 'Kézrehabilitációs alapkurs',
          description: 'Online videós kurzus',
          quantity: 1,
          unit: 'db',
          unitPrice: 24990,
          itemTotal: 24990,
          sku: 'kurzus-alap',
        },
      ],
    },
  ],
}

describe('getBarionConfig (env-assert)', () => {
  it('hiányzó teszt POSKey esetén értelmes magyar hibát dob, a kulcsnévvel', () => {
    const env = { ...validEnv, BARION_POSKEY_TEST: '' } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_POSKEY_TEST/)
    expect(() => getBarionConfig(env)).toThrowError(/nem indulhat el/)
  })

  it('prod környezetben a BARION_POSKEY_PROD kötelező', () => {
    const env = {
      ...validEnv,
      BARION_ENVIRONMENT: 'prod',
      BARION_POSKEY_PROD: '  ',
    } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_POSKEY_PROD/)
  })

  it('hiányzó BARION_API_URL és BARION_PAYEE_EMAIL is szerepel a hibaüzenetben', () => {
    const env = {
      BARION_POSKEY_TEST: DUMMY_POS_KEY,
    } as unknown as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_API_URL/)
    expect(() => getBarionConfig(env)).toThrowError(/BARION_PAYEE_EMAIL/)
  })

  it('érvénytelen BARION_ENVIRONMENT értékre dob', () => {
    const env = { ...validEnv, BARION_ENVIRONMENT: 'staging' } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_ENVIRONMENT/)
  })

  it('nem https BARION_API_URL-t elutasít', () => {
    const env = { ...validEnv, BARION_API_URL: 'http://api.test.barion.com' } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_API_URL/)
  })

  it('alapértelmezés test környezet, origin-normalizált apiUrl, default timeout', () => {
    const env = { ...validEnv } as NodeJS.ProcessEnv
    delete env.BARION_ENVIRONMENT
    const config = getBarionConfig(env)
    expect(config.environment).toBe('test')
    expect(config.apiUrl).toBe('https://api.test.barion.com')
    expect(config.posKey).toBe(DUMMY_POS_KEY)
    expect(config.timeoutMs).toBe(BARION_DEFAULT_TIMEOUT_MS)
    expect(config.recurringEnabled).toBe(false)
  })

  it('prod környezetben a PROD kulcsot választja, timeout envből felülírható', () => {
    const config = getBarionConfig({
      ...validEnv,
      BARION_ENVIRONMENT: 'prod',
      BARION_API_URL: 'https://api.barion.com',
      BARION_TIMEOUT_MS: '5000',
      BARION_RECURRING_ENABLED: 'true',
    } as NodeJS.ProcessEnv)
    expect(config.environment).toBe('prod')
    expect(config.posKey).toBe(DUMMY_PROD_POS_KEY)
    expect(config.timeoutMs).toBe(5000)
    expect(config.recurringEnabled).toBe(true)
  })

  it('érvénytelen BARION_TIMEOUT_MS esetén a default marad', () => {
    const config = getBarionConfig({
      ...validEnv,
      BARION_TIMEOUT_MS: 'nem-szam',
    } as NodeJS.ProcessEnv)
    expect(config.timeoutMs).toBe(BARION_DEFAULT_TIMEOUT_MS)
  })

  /**
   * A timeout PLAFONJA (B3-kiegészítés): a visszatérítés a Barion-hívást
   * rendelés-szintű advisory-zár ALATT futtatja, és a zár-tranzakció addig
   * „idle in transaction" marad. Egy 60 mp fölé állított timeout mellett a
   * Postgres/Railway oldali kapcsolat-bontás elvághatná a zárat úgy, hogy a
   * hívás sorsa ismeretlen — ezért a plafon érvényesül, nem a beállított érték.
   */
  it('a BARION_TIMEOUT_MS-t a plafon fogja (a zár-tartomány nem nyúlhat el)', () => {
    const config = getBarionConfig({
      ...validEnv,
      BARION_TIMEOUT_MS: '120000',
    } as NodeJS.ProcessEnv)
    expect(config.timeoutMs).toBe(BARION_MAX_TIMEOUT_MS)
    expect(BARION_MAX_TIMEOUT_MS).toBe(30_000)
  })

  /**
   * B3 — KÖRNYEZET ↔ API-HOSZT KONZISZTENCIA.
   *
   * A két érték szétcsúszása a legdrágább néma hiba: `prod` környezet +
   * teszt-hoszt esetén a vevő valódi kártyaadattal a Barion sandboxában
   * fizetne, a pénz sosem érkezne meg — a rendszer viszont sikeres fizetést
   * látna. A RÉGI kódon mindkét alábbi eset ÁTMENT.
   */
  it('prod környezet + TESZT API-hoszt → indulási hiba (a pénz sosem érkezne meg)', () => {
    const env = {
      ...validEnv,
      BARION_ENVIRONMENT: 'prod',
      BARION_API_URL: 'https://api.test.barion.com',
    } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_API_URL/)
    expect(() => getBarionConfig(env)).toThrowError(/api\.barion\.com/)
  })

  it('test környezet + ÉLES API-hoszt → szintén indulási hiba', () => {
    const env = {
      ...validEnv,
      BARION_ENVIRONMENT: 'test',
      BARION_API_URL: 'https://api.barion.com',
    } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/BARION_ENVIRONMENT/)
  })

  it('idegen hoszt (elgépelt vagy proxy-URL) sem fogadható el', () => {
    const env = { ...validEnv, BARION_API_URL: 'https://api.barion.example' } as NodeJS.ProcessEnv
    expect(() => getBarionConfig(env)).toThrowError(/api\.test\.barion\.com/)
  })

  it('az összeillő párok (test/prod) változatlanul átmennek', () => {
    expect(getBarionConfig({ ...validEnv } as NodeJS.ProcessEnv).apiUrl).toBe(
      'https://api.test.barion.com',
    )
    expect(
      getBarionConfig({
        ...validEnv,
        BARION_ENVIRONMENT: 'prod',
        BARION_API_URL: 'https://api.barion.com',
      } as NodeJS.ProcessEnv).apiUrl,
    ).toBe('https://api.barion.com')
  })
})

describe('buildPaymentStartRequest (Start payload-szabályok)', () => {
  it('fix üzleti mezők: Immediate, guest checkout, All, hu-HU, HUF, 30 perces ablak', () => {
    const request = buildPaymentStartRequest(startParams, testConfig)
    expect(request.PaymentType).toBe('Immediate')
    expect(request.GuestCheckOut).toBe(true)
    expect(request.FundingSources).toEqual(['All'])
    expect(request.Locale).toBe('hu-HU')
    expect(request.Currency).toBe('HUF')
    expect(request.PaymentWindow).toBe(BARION_DEFAULT_PAYMENT_WINDOW)
    expect(BARION_DEFAULT_PAYMENT_WINDOW).toBe('00:30:00')
  })

  it('PaymentRequestId = orderNumber; hintek és URL-ek átmennek; payee default a konfigurált email', () => {
    const request = buildPaymentStartRequest(startParams, testConfig)
    expect(request.PaymentRequestId).toBe('KH-2026-000123')
    expect(request.PayerHint).toBe('vevo@example.test')
    expect(request.CardHolderNameHint).toBe('Minta Mari')
    expect(request.RedirectUrl).toBe('https://shop.example.test/fizetes/koszonom')
    expect(request.CallbackUrl).toBe('https://shop.example.test/api/barion/callback')
    expect(request.Transactions[0]?.POSTransactionId).toBe('KH-2026-000123-1')
    expect(request.Transactions[0]?.Payee).toBe('payee@example.test')
    expect(request.Transactions[0]?.Total).toBe(24990)
    expect(request.Transactions[0]?.Items[0]).toMatchObject({
      Name: 'Kézrehabilitációs alapkurs',
      Quantity: 1,
      UnitPrice: 24990,
      ItemTotal: 24990,
      SKU: 'kurzus-alap',
    })
  })

  it('PaymentWindow paraméterezhető', () => {
    const request = buildPaymentStartRequest(
      { ...startParams, paymentWindow: '01:00:00' },
      testConfig,
    )
    expect(request.PaymentWindow).toBe('01:00:00')
  })

  it('a lib NEM számol összeget: a kapott Total/ItemTotal megy ki változatlanul', () => {
    const weirdTotals: StartPaymentParams = {
      ...startParams,
      transactions: [
        {
          posTransactionId: 'T-1',
          total: 123,
          items: [
            {
              name: 'Tétel',
              description: 'd',
              quantity: 3,
              unit: 'db',
              unitPrice: 50,
              itemTotal: 123,
            },
          ],
        },
      ],
    }
    const request = buildPaymentStartRequest(weirdTotals, testConfig)
    // Szándékosan "inkonzisztens" értékek: a lib nem javítja/újraszámolja őket.
    expect(request.Transactions[0]?.Total).toBe(123)
    expect(request.Transactions[0]?.Items[0]?.ItemTotal).toBe(123)
  })

  it('recurring kérés flag NÉLKÜL hibát dob (nem megy ki csendben)', () => {
    expect(() =>
      buildPaymentStartRequest(
        { ...startParams, recurring: { initiateRecurrence: true, recurrenceId: 'SUB-1' } },
        testConfig,
      ),
    ).toThrowError(/BARION_RECURRING_ENABLED/)
  })

  it('recurring flag mellett InitiateRecurrence + RecurrenceId bekerül a kérésbe', () => {
    const recurringConfig = { ...testConfig, recurringEnabled: true }
    const request = buildPaymentStartRequest(
      { ...startParams, recurring: { initiateRecurrence: true, recurrenceId: 'SUB-1' } },
      recurringConfig,
    )
    expect(request.InitiateRecurrence).toBe(true)
    expect(request.RecurrenceId).toBe('SUB-1')
  })

  it('recurring flag mellett, recurring-paraméter nélkül nincs InitiateRecurrence a kérésben', () => {
    const recurringConfig = { ...testConfig, recurringEnabled: true }
    const request = buildPaymentStartRequest(startParams, recurringConfig)
    expect(request.InitiateRecurrence).toBeUndefined()
    expect(request.RecurrenceId).toBeUndefined()
  })

  it('initiateRecurrence recurrenceId nélkül hibát dob', () => {
    const recurringConfig = { ...testConfig, recurringEnabled: true }
    expect(() =>
      buildPaymentStartRequest(
        { ...startParams, recurring: { initiateRecurrence: true } },
        recurringConfig,
      ),
    ).toThrowError(/recurrenceId/)
  })

  it('üres Transactions tömb hibát dob', () => {
    expect(() =>
      buildPaymentStartRequest({ ...startParams, transactions: [] }, testConfig),
    ).toThrowError(/tranzakció/)
  })
})

describe('startPayment (Payment/Start v2)', () => {
  it('sikeres Start-válasz parse: PaymentId, GatewayUrl, státusz', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID,
        PaymentRequestId: 'KH-2026-000123',
        Status: 'Prepared',
        GatewayUrl: 'https://secure.test.barion.com/Pay?id=' + DUMMY_PAYMENT_ID,
        QRUrl: 'https://api.test.barion.com/qr/x',
        Transactions: [
          { TransactionId: DUMMY_TRANSACTION_ID, POSTransactionId: 'KH-2026-000123-1' },
        ],
        Errors: [],
      }),
    )

    const response = await startPayment(startParams, testConfig)

    expect(response.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(response.Status).toBe('Prepared')
    expect(response.GatewayUrl).toContain(DUMMY_PAYMENT_ID)
    expect(response.Transactions?.[0]?.TransactionId).toBe(DUMMY_TRANSACTION_ID)

    const request = lastRequest()
    expect(request.url).toBe('https://api.test.barion.com/v2/Payment/Start')
    expect(request.init.method).toBe('POST')
    // A POSKey a body-ban utazik (nem az URL-ben, nem headerben).
    expect(request.body.POSKey).toBe(DUMMY_POS_KEY)
    expect(request.url).not.toContain(DUMMY_POS_KEY)
    expect(request.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('Barion hibaválasz (HTTP 400 + Errors) strukturált BarionApiError-é válik', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          Errors: [
            {
              ErrorCode: 'ModelValidationError',
              Title: 'Model validation failed',
              Description: 'The Transactions field is required.',
            },
          ],
        },
        400,
      ),
    )

    const promise = startPayment(startParams, testConfig)
    await expect(promise).rejects.toBeInstanceOf(BarionApiError)
    await expect(promise).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 400,
      providerErrors: [
        {
          ErrorCode: 'ModelValidationError',
          Title: 'Model validation failed',
          Description: 'The Transactions field is required.',
        },
      ],
    })
  })

  it('HTTP 200 + nemüres Errors tömb szintén provider-hiba', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Errors: [
          {
            ErrorCode: 'AuthenticationFailed',
            Title: 'User authentication failed',
            Description: 'Invalid POSKey.',
          },
        ],
      }),
    )

    const promise = startPayment(startParams, testConfig)
    await expect(promise).rejects.toMatchObject({
      kind: 'provider',
      providerErrors: [{ ErrorCode: 'AuthenticationFailed' }],
    })
  })

  it('timeout/abort kezelés: lassú válasz BarionApiError kind=timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'))
          })
        }),
    )

    const fastConfig = { ...testConfig, timeoutMs: 20 }
    const promise = startPayment(startParams, fastConfig)
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' })
    await expect(promise).rejects.toBeInstanceOf(BarionApiError)
  })

  it('hálózati hiba BarionApiError kind=network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(startPayment(startParams, testConfig)).rejects.toMatchObject({
      kind: 'network',
    })
  })
})

describe('mapBarionPaymentStatus (v4 státusz-leképezés)', () => {
  it('Succeeded → paid', () => {
    expect(mapBarionPaymentStatus('Succeeded')).toBe('paid')
  })

  it('Canceled → cancelled', () => {
    expect(mapBarionPaymentStatus('Canceled')).toBe('cancelled')
  })

  it('Expired → cancelled', () => {
    expect(mapBarionPaymentStatus('Expired')).toBe('cancelled')
  })

  it('Prepared → payment_pending', () => {
    expect(mapBarionPaymentStatus('Prepared')).toBe('payment_pending')
  })

  it('Started → payment_pending', () => {
    expect(mapBarionPaymentStatus('Started')).toBe('payment_pending')
  })

  it('ismeretlen/jövőbeli státusz konzervatívan payment_pending (sosem paid)', () => {
    expect(mapBarionPaymentStatus('InProgress')).toBe('payment_pending')
    expect(mapBarionPaymentStatus('Reserved')).toBe('payment_pending')
    expect(mapBarionPaymentStatus('ValamiUjStatusz')).toBe('payment_pending')
  })
})

describe('fetchPaymentState (Payment/PaymentState v4)', () => {
  it('v4 útvonalat hív GET-tel, x-pos-key headerrel; a válasz Transactions tartalmazza a TransactionId-t', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID,
        PaymentRequestId: 'KH-2026-000123',
        Status: 'Succeeded',
        Transactions: [
          {
            TransactionId: DUMMY_TRANSACTION_ID,
            POSTransactionId: 'KH-2026-000123-1',
            Total: 24990,
            Currency: 'HUF',
            Status: 'Succeeded',
          },
        ],
      }),
    )

    const response = await fetchPaymentState(DUMMY_PAYMENT_ID, testConfig)

    expect(response.Status).toBe('Succeeded')
    expect(response.Transactions[0]?.TransactionId).toBe(DUMMY_TRANSACTION_ID)
    expect(mapBarionPaymentStatus(response.Status)).toBe('paid')

    const request = lastRequest()
    // Az útvonalba a KÖTŐJEL NÉLKÜLI alak megy: kötőjelesre a Barion 404-et ad
    // (mérve 2026-09-24, élesben és teszt-környezetben; lib/barion/guid.ts).
    expect(request.url).toBe(
      `https://api.test.barion.com/v4/Payment/${DUMMY_PAYMENT_ID.replace(/-/g, '')}/PaymentState`,
    )
    // A v2-es deprecated útvonal SOHA nem hívódhat.
    expect(request.url).not.toContain('/v2/')
    expect(request.init.method ?? 'GET').toBe('GET')
    const headers = new Headers(request.init.headers)
    expect(headers.get('x-pos-key')).toBe(DUMMY_POS_KEY)
    expect(request.url).not.toContain(DUMMY_POS_KEY)
    expect(request.init.body).toBeUndefined()
  })

  it('a kötőjel nélküli (és nagybetűs) válasz-azonosítók kanonikus, kötőjeles alakba kerülnek', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID.replace(/-/g, '').toUpperCase(),
        Status: 'Succeeded',
        Transactions: [
          {
            TransactionId: DUMMY_TRANSACTION_ID.replace(/-/g, ''),
            TransactionType: 'CardPayment',
            RelatedId: DUMMY_PAYMENT_ID.replace(/-/g, ''),
          },
          { TransactionId: 'nem-guid', TransactionType: 'Fee' },
        ],
      }),
    )

    // A hívó kötőjeles vagy kötőjel nélküli alakot is adhat: az útvonal mindkét esetben azonos.
    const response = await fetchPaymentState(DUMMY_PAYMENT_ID.replace(/-/g, ''), testConfig)

    expect(lastRequest().url).toBe(
      `https://api.test.barion.com/v4/Payment/${DUMMY_PAYMENT_ID.replace(/-/g, '')}/PaymentState`,
    )
    expect(response.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(response.Transactions[0]?.TransactionId).toBe(DUMMY_TRANSACTION_ID)
    expect(response.Transactions[0]?.RelatedId).toBe(DUMMY_PAYMENT_ID)
    // Nem GUID-alakú érték változatlan marad (a hívó ellenőrzői döntenek róla).
    expect(response.Transactions[1]?.TransactionId).toBe('nem-guid')
  })
})

describe('Barion-azonosítók a Start- és a Refund-válaszban', () => {
  it('Start: a kötőjel nélküli PaymentId és TransactionId kanonikus alakba kerül', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID.replace(/-/g, ''),
        Status: 'Prepared',
        GatewayUrl: 'https://secure.test.barion.com/Pay?id=x',
        Transactions: [{ TransactionId: DUMMY_TRANSACTION_ID.replace(/-/g, '').toUpperCase() }],
      }),
    )

    const response = await startPayment(startParams, testConfig)

    expect(response.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(response.Transactions?.[0]?.TransactionId).toBe(DUMMY_TRANSACTION_ID)
  })

  it('Start: GUID nélküli PaymentId érvénytelen válasz (a fizetés nem követhető)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ PaymentId: 'nem-guid', Status: 'Prepared', GatewayUrl: 'https://x' }),
    )

    await expect(startPayment(startParams, testConfig)).rejects.toMatchObject({
      name: 'BarionApiError',
      kind: 'invalid_response',
    })
  })

  it('Refund: a kötőjel nélküli PaymentId és TransactionId kanonikus alakba kerül', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID.replace(/-/g, ''),
        RefundedTransactions: [
          {
            TransactionId: DUMMY_TRANSACTION_ID.replace(/-/g, ''),
            POSTransactionId: 'KH-2026-000123-1',
            Total: 100,
            Status: 'Succeeded',
          },
        ],
      }),
    )

    const response = await refundPayment(
      {
        paymentId: DUMMY_PAYMENT_ID,
        transactionsToRefund: [
          {
            transactionId: DUMMY_TRANSACTION_ID,
            posTransactionId: 'KH-2026-000123-1',
            amountToRefund: 100,
          },
        ],
      },
      testConfig,
    )

    expect(response.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(response.RefundedTransactions[0]?.TransactionId).toBe(DUMMY_TRANSACTION_ID)
    expect(response.RefundedTransactions[0]?.Status).toBe('Succeeded')
  })
})

describe('refundPayment (Payment/Refund v2)', () => {
  const posTransactionId = 'DUMMY-ORIGINAL-SHOP-TRANSACTION'
  const refundParams = {
    paymentId: DUMMY_PAYMENT_ID,
    transactionsToRefund: [
      { transactionId: DUMMY_TRANSACTION_ID, posTransactionId, amountToRefund: 10000 },
    ],
  }

  it('refund payload-építés: PaymentId + TransactionsToRefund {TransactionId, POSTransactionId, AmountToRefund}', () => {
    const request = buildRefundRequest(refundParams)
    expect(request.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(request.TransactionsToRefund).toEqual([
      {
        TransactionId: DUMMY_TRANSACTION_ID,
        POSTransactionId: posTransactionId,
        AmountToRefund: 10000,
      },
    ])
  })

  it('részösszeges refund kimegy a hívásban, a RefundedTransactions státusza visszaérkezik', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID,
        RefundedTransactions: [
          {
            TransactionId: DUMMY_TRANSACTION_ID,
            POSTransactionId: posTransactionId,
            Total: 10000,
            Status: 'PartiallyRefunded',
          },
        ],
      }),
    )

    const response = await refundPayment(refundParams, testConfig)

    expect(response.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(response.RefundedTransactions).toHaveLength(1)
    expect(response.RefundedTransactions[0]?.TransactionId).toBe(DUMMY_TRANSACTION_ID)
    expect(response.RefundedTransactions[0]?.Total).toBe(10000)
    expect(response.RefundedTransactions[0]?.POSTransactionId).toBe(posTransactionId)
    expect(response.RefundedTransactions[0]).not.toHaveProperty('AmountToRefund')
    expect(response.RefundedTransactions[0]?.Status).toBe('PartiallyRefunded')
    expect(response.Errors).toBeUndefined()

    const request = lastRequest()
    expect(request.url).toBe('https://api.test.barion.com/v2/Payment/Refund')
    expect(request.body.PaymentId).toBe(DUMMY_PAYMENT_ID)
    expect(request.body.POSKey).toBe(DUMMY_POS_KEY)
    expect(request.body.TransactionsToRefund).toEqual([
      {
        TransactionId: DUMMY_TRANSACTION_ID,
        POSTransactionId: posTransactionId,
        AmountToRefund: 10000,
      },
    ])
  })

  it('üres visszatérítés-lista és nem-pozitív összeg hibát dob', () => {
    expect(() =>
      buildRefundRequest({ paymentId: DUMMY_PAYMENT_ID, transactionsToRefund: [] }),
    ).toThrowError(/tranzakció/)
    expect(() =>
      buildRefundRequest({
        paymentId: DUMMY_PAYMENT_ID,
        transactionsToRefund: [
          { transactionId: DUMMY_TRANSACTION_ID, posTransactionId, amountToRefund: 0 },
        ],
      }),
    ).toThrowError(/amountToRefund/)
  })

  it('minden tranzakció eredeti kereskedői azonosítóját változatlanul továbbítja', () => {
    const transactions = [
      { transactionId: DUMMY_TRANSACTION_ID, posTransactionId, amountToRefund: 10000 },
      {
        transactionId: 'DUMMY-SECOND-TRANSACTION',
        posTransactionId: ' DUMMY-SECOND-SHOP-ID ',
        amountToRefund: 500,
      },
    ]
    const original = structuredClone(transactions)
    expect(
      buildRefundRequest({ paymentId: DUMMY_PAYMENT_ID, transactionsToRefund: transactions }),
    ).toEqual({
      PaymentId: DUMMY_PAYMENT_ID,
      TransactionsToRefund: [
        {
          TransactionId: DUMMY_TRANSACTION_ID,
          POSTransactionId: posTransactionId,
          AmountToRefund: 10000,
        },
        {
          TransactionId: 'DUMMY-SECOND-TRANSACTION',
          POSTransactionId: ' DUMMY-SECOND-SHOP-ID ',
          AmountToRefund: 500,
        },
      ],
    })
    expect(transactions).toEqual(original)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['', '   ', '\n\t', undefined, null, 0, false, {}, []])(
    'hibás posTransactionId esetén a teljes kérés transport előtt elutasítva: %j',
    async (invalidId) => {
      const params = {
        paymentId: DUMMY_PAYMENT_ID,
        transactionsToRefund: [
          ...refundParams.transactionsToRefund,
          {
            transactionId: 'DUMMY-SECOND-TRANSACTION',
            posTransactionId: invalidId as unknown as string,
            amountToRefund: 500,
          },
        ],
      }
      expect(() => buildRefundRequest(params)).toThrowError(/posTransactionId/)
      await expect(refundPayment(params, testConfig)).rejects.toThrowError(/posTransactionId/)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('a posTransactionId elhagyása típus- és futásidejű hiba', () => {
    expect(() =>
      buildRefundRequest({
        paymentId: DUMMY_PAYMENT_ID,
        transactionsToRefund: [
          // @ts-expect-error The merchant transaction identifier is required, not optional.
          { transactionId: DUMMY_TRANSACTION_ID, amountToRefund: 10000 },
        ],
      }),
    ).toThrowError(/posTransactionId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([undefined, []])(
    'hivatalos Total/Succeeded választ megőriz opcionális Errors mellett: %j',
    async (errors) => {
      const body = {
        PaymentId: DUMMY_PAYMENT_ID,
        RefundedTransactions: [
          {
            TransactionId: DUMMY_TRANSACTION_ID,
            POSTransactionId: posTransactionId,
            Total: 10000,
            Status: 'Succeeded',
          },
        ],
        ...(errors === undefined ? {} : { Errors: errors }),
      }
      fetchMock.mockResolvedValueOnce(jsonResponse(body))
      expect(await refundPayment(refundParams, testConfig)).toEqual(body)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('a refund-válasz jelen lévő szolgáltatói hibáit nem hagyja figyelmen kívül', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        PaymentId: DUMMY_PAYMENT_ID,
        RefundedTransactions: [],
        Errors: [
          {
            ErrorCode: 'DUMMY-REFUND-ERROR',
            Title: 'Synthetic rejection',
            Description: 'Synthetic refund rejected',
          },
        ],
      }),
    )
    await expect(refundPayment(refundParams, testConfig)).rejects.toMatchObject({
      kind: 'provider',
      providerErrors: [
        {
          ErrorCode: 'DUMMY-REFUND-ERROR',
          Title: 'Synthetic rejection',
          Description: 'Synthetic refund rejected',
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('titokvédelem: a POSKey sosem kerül a naplóba', () => {
  it('sikeres és hibás hívás naplóiban sem szerepel a POSKey', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ PaymentId: DUMMY_PAYMENT_ID, Status: 'Prepared', Errors: [] }),
      )
      await startPayment(startParams, testConfig)

      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            Errors: [
              { ErrorCode: 'AuthenticationFailed', Title: 'auth failed', Description: 'invalid' },
            ],
          },
          401,
        ),
      )
      await expect(startPayment(startParams, testConfig)).rejects.toBeInstanceOf(BarionApiError)

      const allLogOutput = logSpy.mock.calls
        .map((call) => call.map((arg) => String(arg)).join(' '))
        .join('\n')
      expect(allLogOutput.length).toBeGreaterThan(0)
      expect(allLogOutput).not.toContain(DUMMY_POS_KEY)
      expect(allLogOutput).not.toContain(DUMMY_PROD_POS_KEY)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('a kimenő kérés URL-je és fejlécei sem tartalmazzák a POSKey-t (POST)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ PaymentId: DUMMY_PAYMENT_ID, Status: 'Prepared', Errors: [] }),
    )
    await startPayment(startParams, testConfig)

    const request = lastRequest()
    expect(request.url).not.toContain(DUMMY_POS_KEY)
    const headers = new Headers(request.init.headers)
    for (const value of headers.values()) {
      expect(value).not.toContain(DUMMY_POS_KEY)
    }
  })
})
