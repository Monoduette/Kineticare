import { afterEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { documents, fixture, provider, store } from '../refund-fixture'
import { BarionApiError } from '../../lib/barion'
import { createRefundIntent } from '../../lib/refund/intent-store'
import { NO_PROVIDER_REQUEST_REFERENCE } from '../../lib/refund/refund-intent'
import { getRefundRecoveryStatus, recoverRefundOrder } from '../../lib/refund/refund-recovery'
import type { RefundIntent } from '../../payload-types'

/** A közös fixture a Barion-kérés indítását 2026-09-05T10:00:01Z-re rögzíti. */
const STARTED_AT = Date.parse('2026-09-05T10:00:01.000Z')
const at = (minutes: number) => new Date(STARTED_AT + minutes * 60_000)
const FIRST_REFUND = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
const SECOND_REFUND = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'
const SECOND_KEY = 'B'.repeat(42) + 'A'
const THIRD_KEY = 'C'.repeat(42) + 'A'

afterEach(() => {
  vi.useRealTimers()
})

function rejection(code: string) {
  return new BarionApiError({
    kind: 'http',
    message: 'SYNTHETIC',
    endpoint: 'POST /v2/Payment/Refund',
    httpStatus: 400,
    providerErrors: [{ ErrorCode: code, Title: 'SYNTHETIC', Description: 'SYNTHETIC' }],
  })
}

/** A fixture GetState-je kiegészítve a fizetés Total értékével és refund-tranzakciókkal. */
function paymentState(
  f: ReturnType<typeof fixture>,
  total: number,
  refunds: Array<{ id: string; amount: number; status?: string }> = [],
) {
  return {
    PaymentId: f.order.barionPaymentId,
    Status: 'Succeeded',
    Total: total,
    Transactions: [
      {
        TransactionId: 'SYNTHETIC-TX',
        POSTransactionId: `${f.order.orderNumber}-1`,
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: 20000,
      },
      ...refunds.map((refund) => ({
        TransactionId: refund.id,
        POSTransactionId: `${f.order.orderNumber}-1`,
        TransactionType: 'RefundToBankCard',
        Status: refund.status ?? 'Succeeded',
        Total: refund.amount,
        RelatedId: 'SYNTHETIC-TX',
      })),
    ],
  }
}

function timeoutOnce() {
  const original = provider.refund.getMockImplementation()!
  provider.refund.mockImplementationOnce(async () => {
    throw new BarionApiError({ kind: 'timeout', message: 'SYNTHETIC', endpoint: 'refund' })
  })
  return original
}

describe('tulajdonosi visszatérítés: végleges Barion-elutasítás', () => {
  it('TooLowBalanceToMakeRefund: 409 okkal és teendővel, a rendelés újra visszatéríthető', async () => {
    const f = fixture()
    provider.refund.mockRejectedValueOnce(rejection('TooLowBalanceToMakeRefund'))
    await expect(f.start()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('nincs elég egyenleg'),
    })
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'provider_failed',
      activeOrderKey: null,
      reconciliationReference: 'barion:refund-rejected:TooLowBalanceToMakeRefund',
    })
    expect(f.order).toMatchObject({ status: 'paid', refunds: [] })
    expect(f.user.purchases).toEqual([42, 99])
    expect(documents.storno).not.toHaveBeenCalled()
    expect(await f.status()).toMatchObject({ state: 'clear' })
    expect(
      await getRefundRecoveryStatus({ ...f.options, operationKey: 'A'.repeat(43) }),
    ).toMatchObject({ state: 'clear', operationState: 'no_effect' })
    await expect(f.start({ operationKey: SECOND_KEY })).resolves.toMatchObject({
      refundStatusOutcome: 'succeeded',
      type: 'full',
    })
    expect(provider.refund).toHaveBeenCalledTimes(2)
    expect(f.order.status).toBe('refunded')
  })

  it('ismeretlen hibakód vagy 5xx nem nullhatás: 503, blokkoló kísérlet', async () => {
    const f = fixture()
    provider.refund.mockRejectedValueOnce(
      new BarionApiError({
        kind: 'http',
        message: 'SYNTHETIC',
        endpoint: 'refund',
        httpStatus: 500,
        providerErrors: [{ ErrorCode: 'TooLowBalanceToMakeRefund', Title: '', Description: '' }],
      }),
    )
    await expect(f.start()).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('Ne indíts új pénzvisszatérítést'),
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    await expect(f.start({ operationKey: SECOND_KEY })).rejects.toMatchObject({ status: 503 })
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
})

describe('tulajdonosi visszatérítés: előfeltételek a kísérlet előtt', () => {
  it.each([
    ['vásárlói fiók nélkül', { customer: null }, 'nem tartozik vásárlói fiók'],
    ['törölt termékkel', { items: [{ product: null, quantity: 1 }] }, 'terméke már nem található'],
  ])('%s: 409, nincs GetState, nincs blokkoló kísérlet', async (_label, patch, text) => {
    const f = fixture()
    Object.assign(f.order, patch)
    await expect(f.start()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(text),
    })
    expect(provider.state).not.toHaveBeenCalled()
    expect(store.intents.get(f.payload)).toBeUndefined()
  })

  it.each([
    ['más kereskedői azonosító', { POSTransactionId: 'LEGACY-POS' }],
    ['díj-tranzakció', { TransactionType: 'GatewayFee' }],
    ['nem sikeres forrás', { Status: 'Prepared' }],
  ])('%s: nincs a rendeléshez tartozó forrás, 409 pénzmozgás nélkül', async (_label, patch) => {
    const f = fixture()
    const state = paymentState(f, 20000)
    Object.assign(state.Transactions[0], patch)
    provider.state.mockResolvedValue(state)
    await expect(f.start()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Pénzmozgás nem történt.'),
    })
    expect(provider.refund).not.toHaveBeenCalled()
    expect(store.intents.get(f.payload)).toBeUndefined()
  })

  it('a kötőjel nélküli, nagybetűs GetState-PaymentId-t is a rendeléshez köti', async () => {
    const f = fixture()
    f.order.barionPaymentId = '11111111-2222-3333-4444-555555555555'
    const state = paymentState(f, 20000)
    state.PaymentId = '11111111222233334444555555555555'.toUpperCase()
    provider.state.mockResolvedValue(state)
    provider.refund.mockResolvedValue({
      PaymentId: '11111111-2222-3333-4444-555555555555',
      RefundedTransactions: [
        {
          TransactionId: FIRST_REFUND,
          POSTransactionId: `${f.order.orderNumber}-1`,
          Total: 20000,
          Status: 'Succeeded',
        },
      ],
    })
    await expect(f.start()).resolves.toMatchObject({ refundStatusOutcome: 'succeeded' })
  })
})

describe('tulajdonosi visszatérítés: elakadt kísérlet egyeztetése a Barion-állapotból', () => {
  it('időtúllépés után a GetState-ben látszó sikert új POST nélkül feldolgozza', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    expect(await f.status()).toMatchObject({
      state: 'recoverable',
      message: expect.stringContaining('lekérdezi az eredményt a Barionból'),
    })
    provider.state.mockResolvedValue(paymentState(f, 0, [{ id: FIRST_REFUND, amount: 20000 }]))
    expect(await recoverRefundOrder({ ...f.options, now: at(3) })).toMatchObject({
      recoveryStatus: 'completed',
    })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(f.order.status).toBe('refunded')
    expect(f.user.purchases).toEqual([99])
    expect(documents.storno).toHaveBeenCalledTimes(1)
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(
      f.audits.find((audit) => audit.action === 'refund-provider-succeeded')?.after,
    ).toMatchObject({ refundTransactionId: FIRST_REFUND, reconciledFrom: 'barion-paymentstate' })
    expect(await f.status()).toMatchObject({ state: 'clear' })
  })

  it('refund-tranzakció nélkül csak negyedóra után zár nullhatással, utána új visszatérítés indítható', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    provider.state.mockResolvedValue(paymentState(f, 20000))
    const early = await recoverRefundOrder({ ...f.options, now: at(5) })
    expect(early).toMatchObject({ recoveryStatus: 'manual_review' })
    // 10:15:01 UTC = 12:15 Budapesten (nyári idő).
    expect(early.message).toContain('12:15 után')
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    expect(await recoverRefundOrder({ ...f.options, now: at(16) })).toMatchObject({
      recoveryStatus: 'completed',
      message: expect.stringContaining('új visszatérítés indítható'),
    })
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'provider_failed',
      reconciliationReference: 'barion:paymentstate:no-refund-transaction',
    })
    expect(f.order).toMatchObject({ status: 'paid', refunds: [] })
    expect(await f.status()).toMatchObject({ state: 'clear' })
    await expect(f.start({ operationKey: SECOND_KEY })).resolves.toMatchObject({
      refundStatusOutcome: 'succeeded',
    })
    expect(provider.refund).toHaveBeenCalledTimes(2)
  })

  it('folyamatban lévő Barion-visszatérítésnél vár, nem dönt', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    provider.state.mockResolvedValue(
      paymentState(f, 20000, [{ id: FIRST_REFUND, amount: 20000, status: 'Prepared' }]),
    )
    expect(await recoverRefundOrder({ ...f.options, now: at(30) })).toMatchObject({
      recoveryStatus: 'manual_review',
      message: expect.stringContaining('még feldolgozza'),
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
  })

  it('második részvisszatérítésnél az elsőt nem tulajdonítja a mostaninak', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    timeoutOnce()
    await expect(f.start({ amountHuf: 5000, operationKey: SECOND_KEY })).rejects.toMatchObject({
      status: 503,
    })
    provider.state.mockResolvedValue(paymentState(f, 15000, [{ id: FIRST_REFUND, amount: 5000 }]))
    expect(await recoverRefundOrder({ ...f.options, now: at(20) })).toMatchObject({
      recoveryStatus: 'completed',
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_failed')
    expect(f.order.refunds).toHaveLength(1)

    timeoutOnce()
    await expect(f.start({ amountHuf: 5000, operationKey: THIRD_KEY })).rejects.toMatchObject({
      status: 503,
    })
    provider.state.mockResolvedValue(
      paymentState(f, 10000, [
        { id: FIRST_REFUND, amount: 5000 },
        { id: SECOND_REFUND, amount: 5000 },
      ]),
    )
    expect(await recoverRefundOrder({ ...f.options, now: at(20) })).toMatchObject({
      recoveryStatus: 'completed',
    })
    expect(f.order.refunds).toHaveLength(2)
    expect(f.order.status).toBe('paid')
    expect(provider.refund).toHaveBeenCalledTimes(3)
  })

  it('egy korábbi, azonosító nélküli (V1) bizonyíték mellett nem dönt, kézi egyeztetést kér', async () => {
    const f = fixture()
    await f.start({ amountHuf: 5000 })
    const receipt = f.audits.find((audit) => audit.action === 'refund-provider-succeeded')!
    const data = receipt.after as Record<string, unknown>
    Object.assign(data, { version: 1 })
    delete data.refundTransactionId
    delete data.posTransactionId
    delete data.actorKind
    delete data.systemActor
    timeoutOnce()
    await expect(f.start({ amountHuf: 5000, operationKey: SECOND_KEY })).rejects.toMatchObject({
      status: 503,
    })
    provider.state.mockResolvedValue(paymentState(f, 15000, [{ id: FIRST_REFUND, amount: 5000 }]))
    expect(await recoverRefundOrder({ ...f.options, now: at(60) })).toMatchObject({
      recoveryStatus: 'manual_review',
      message: expect.stringContaining('kézi egyeztetést'),
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
  })

  it('elérhetetlen Barionnál az állapot változatlan, a panel újrapróbálást mond', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    provider.state.mockRejectedValue(
      new BarionApiError({ kind: 'network', message: 'SYNTHETIC', endpoint: 'state' }),
    )
    expect(await recoverRefundOrder({ ...f.options, now: at(60) })).toMatchObject({
      recoveryStatus: 'manual_review',
      message: expect.stringContaining('Próbáld újra néhány perc múlva'),
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
  })

  it('elveszett siker-nyugta után a rögzített bizonyítékból fejezi be, új POST nélkül', async () => {
    const f = fixture()
    f.failures.receipt = 'refund-provider-succeeded'
    f.failures.receiptAfterWrite = true
    await expect(f.start()).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('visszaigazolta a visszatérítést'),
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_started')
    f.failures.receipt = ''
    expect(await f.status()).toMatchObject({ state: 'recoverable' })
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(f.order.status).toBe('refunded')
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })

  it('frissen indított kísérletnél várakozást kér, gomb nélkül', async () => {
    const f = fixture()
    f.failures.receipt = 'refund-provider-succeeded'
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(1))
    expect(await f.status()).toMatchObject({
      state: 'manual_review',
      message: expect.stringContaining('Várj egy percet'),
    })
    vi.setSystemTime(at(3))
    expect(await f.status()).toMatchObject({ state: 'recoverable' })
  })

  it('előkészítés közben elakadt (prepared) kísérletet Barion-hívás nélkül lezár', async () => {
    const f = fixture()
    await createRefundIntent(
      f.payload,
      {
        schemaVersion: 1,
        actorId: '1',
        orderId: String(f.order.id),
        provider: 'barion',
        providerPaymentId: f.order.barionPaymentId!,
        providerTransactionId: 'SYNTHETIC-TX',
        refundSequence: 1,
        requestedAmountHuf: 20000,
        currency: 'HUF',
        reason: null,
      },
      'A'.repeat(43),
    )
    expect(await f.status()).toMatchObject({
      state: 'recoverable',
      message: expect.stringContaining('a Barionnak nem ment kérés'),
    })
    expect(await f.recover()).toMatchObject({
      recoveryStatus: 'completed',
      message: expect.stringContaining('új visszatérítés indítható'),
    })
    const released = store.intents.get(f.payload) as RefundIntent
    expect(released).toMatchObject({
      state: 'provider_failed',
      reconciliationReference: NO_PROVIDER_REQUEST_REFERENCE,
    })
    expect(provider.state).not.toHaveBeenCalled()
    expect(provider.refund).not.toHaveBeenCalled()
    await expect(f.start({ operationKey: SECOND_KEY })).resolves.toMatchObject({
      refundStatusOutcome: 'succeeded',
    })
  })
})
