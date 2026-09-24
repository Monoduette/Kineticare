import { describe, expect, it, vi } from 'vitest'

import { fixture, provider, store } from './refund-fixture'
import { createRefundHandler } from '../lib/refund/route-handler'

async function transportFixture() {
  const f = fixture()
  const actual = await vi.importActual<typeof import('../lib/barion')>('../lib/barion')
  vi.stubEnv('BARION_API_URL', 'https://api.test.barion.com')
  vi.stubEnv('BARION_PAYEE_EMAIL', 'dummy-payee@example.test')
  vi.stubEnv('BARION_POSKEY_TEST', 'DUMMY-TRANSPORT-KEY-NOT-A-REAL-SECRET')
  provider.state.mockImplementation(actual.fetchPaymentState)
  provider.refund.mockImplementation(actual.refundPayment)
  const wire = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/PaymentState')) {
      return Response.json({
        PaymentId: f.order.barionPaymentId,
        Status: 'Succeeded',
        Transactions: [
          {
            TransactionId: 'SYNTHETIC-TX',
            POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
            TransactionType: 'CardPayment',
            Status: 'Succeeded',
            Total: 20000,
          },
        ],
        Errors: [],
      })
    }
    if (path === 'https://api.test.barion.com/v2/Payment/Refund') {
      expect(init?.method).toBe('POST')
      expect(store.intents.get(f.payload)?.state).toBe('provider_started')
      expect(f.audits.some((entry) => entry.action === 'refund-prepared')).toBe(true)
      return Response.json({
        PaymentId: f.order.barionPaymentId,
        RefundedTransactions: [
          {
            TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
            POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
            Total: 5000,
            Status: 'Succeeded',
          },
        ],
        Errors: [],
      })
    }
    throw new Error('Unexpected synthetic transport destination')
  })
  vi.stubGlobal('fetch', wire)
  const request = () =>
    createRefundHandler({ getPayload: async () => f.payload })(
      new Request(`https://shop.example.test/api/admin/orders/${f.order.orderNumber}/refund`, {
        method: 'POST',
        headers: { origin: 'https://shop.example.test', 'content-type': 'application/json' },
        body: JSON.stringify({ operationKey: 'A'.repeat(43), amountHuf: 5000 }),
      }),
      { params: Promise.resolve({ orderNumber: f.order.orderNumber! }) },
    )
  return { ...f, wire, request }
}

describe('refund route through the real Barion transport contract', () => {
  it('sends original transaction identity and requested amount only after a durable claim', async () => {
    const f = await transportFixture()
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      type: 'partial',
      amountHuf: 5000,
      refundStatusOutcome: 'succeeded',
      orderStatus: 'paid',
    })
    const posts = f.wire.mock.calls.filter(([url]) => String(url).endsWith('/Payment/Refund'))
    expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({
      PaymentId: f.order.barionPaymentId,
      TransactionsToRefund: [
        {
          TransactionId: 'SYNTHETIC-TX',
          POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
          AmountToRefund: 5000,
          // A Barion ezt a megjegyzést mutatja meg a fizetőnek (TransactionToRefund.Comment).
          Comment: 'Kineticare visszatérítés SYNTHETIC-RECOVERY-11',
        },
      ],
    })
    expect(f.user.purchases).toEqual([42, 99])
    expect(f.order.refunds).toHaveLength(1)
    // A retry after committed success must not become a second partial refund.
    expect((await f.request()).status).not.toBe(200)
    expect(
      f.wire.mock.calls.filter(([url]) => String(url).endsWith('/Payment/Refund')),
    ).toHaveLength(1)
  })

  it.each(['network', 'timeout'] as const)(
    'a GetState %s hibája még kísérlet előtt: 424, pénzmozgás nélkül, újrapróbálható üzenettel',
    async (kind) => {
      const f = await transportFixture()
      const error = new Error('DUMMY-PRIVATE-TRANSPORT-ERROR')
      if (kind === 'timeout') error.name = 'TimeoutError'
      f.wire.mockRejectedValue(error)
      const response = await f.request()
      expect(response.status).toBe(424)
      expect(store.intents.get(f.payload)).toBeUndefined()
      expect(provider.refund).not.toHaveBeenCalled()
      const body = await response.json()
      expect(body).toEqual({ error: expect.stringContaining('Pénzmozgás nem történt.') })
      expect(body.error).toContain('Próbáld újra néhány perc múlva.')
      expect(JSON.stringify(body)).not.toContain(error.message)
    },
  )

  it.each([
    ['HTTP 400', 400],
    ['HTTP 200 + Errors', 200],
  ] as const)(
    'végleges TooLowBalanceToMakeRefund (%s): nincs zár, ok és teendő, feltöltés után új kísérlet sikerül',
    async (_label, httpStatus) => {
      const f = await transportFixture()
      const original = f.wire.getMockImplementation()!
      let balanceTooLow = true
      f.wire.mockImplementation(async (url, init) => {
        if (String(url).endsWith('/Payment/Refund') && balanceTooLow) {
          return Response.json(
            {
              Errors: [
                {
                  ErrorCode: 'TooLowBalanceToMakeRefund',
                  Title: 'There are not enough funds to fulfill the refund request.',
                  Description: '',
                },
              ],
            },
            { status: httpStatus },
          )
        }
        return original(url, init)
      })
      const response = await f.request()
      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body).not.toHaveProperty('manualReviewRequired')
      expect(body.error).toContain('nincs elég egyenleg')
      expect(body.error).toContain('Pénzmozgás nem történt.')
      expect(body.error).toMatch(/legalább 5000\sFt legyen a tárcában/u)
      expect(store.intents.get(f.payload)).toMatchObject({
        state: 'provider_failed',
        activeOrderKey: null,
        reconciliationReference: 'barion:refund-rejected:TooLowBalanceToMakeRefund',
      })
      expect(f.order).toMatchObject({ status: 'paid', refunds: [] })
      expect(await f.status()).toMatchObject({ state: 'clear' })

      balanceTooLow = false
      const retry = await createRefundHandler({ getPayload: async () => f.payload })(
        new Request(`https://shop.example.test/api/admin/orders/${f.order.orderNumber}/refund`, {
          method: 'POST',
          headers: { origin: 'https://shop.example.test', 'content-type': 'application/json' },
          body: JSON.stringify({ operationKey: 'B'.repeat(42) + 'A', amountHuf: 5000 }),
        }),
        { params: Promise.resolve({ orderNumber: f.order.orderNumber! }) },
      )
      expect(retry.status).toBe(200)
      expect(f.order.refunds).toHaveLength(1)
      expect(
        f.wire.mock.calls.filter(([url]) => String(url).endsWith('/Payment/Refund')),
      ).toHaveLength(2)
    },
  )

  it('retains an uncertain provider attempt without exposing credentials in output', async () => {
    const f = await transportFixture()
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const original = f.wire.getMockImplementation()!
      f.wire.mockImplementation(async (url, init) => {
        if (String(url).endsWith('/Payment/Refund')) {
          return Response.json({ Errors: [{ ErrorCode: 'DUMMY-REFUND-ERROR' }] }, { status: 400 })
        }
        return original(url, init)
      })
      const response = await f.request()
      expect(response.status).toBe(503)
      expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
      expect(f.order.refunds).toEqual([])
      const visible = JSON.stringify([await response.json(), output.mock.calls])
      expect(visible).not.toContain('DUMMY-TRANSPORT-KEY-NOT-A-REAL-SECRET')
      expect(visible).not.toContain('A'.repeat(43))
    } finally {
      output.mockRestore()
    }
  })
})
