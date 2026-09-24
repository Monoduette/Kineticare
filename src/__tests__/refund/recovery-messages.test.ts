import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { documents, fixture, provider, store } from '../refund-fixture'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { BarionApiError, type BarionPaymentStateResponse } from '../../lib/barion'
import { createLogger } from '../../lib/logger'
import { recoverRejectedSucceededPayment } from '../../lib/order-status/recover-paid-reject'
import { automaticRefundRetryDelayMs } from '../../lib/refund/automatic-retry'
import { createRefundIntent } from '../../lib/refund/intent-store'
import { REFUND_RECOVERY_ACTION_LABEL } from '../../lib/refund/recovery-action-label'
import { getRefundRecoveryStatus, recoverRefundOrder } from '../../lib/refund/refund-recovery'
import type { Order } from '../../payload-types'

/**
 * H7/H8 (PR #304 regressziós vadászat): a tulajdonos panelje igazat mondjon.
 * - Átmeneti tároló- vagy kapcsolati hiba nem állíthat adateltérést.
 * - A soha ki nem fizetett rendelés automatikus visszatérítése (dupla
 *   vásárlás, késői fizetés) nem tűnhet el a panelről a kísérletek között.
 */

const STARTED_AT = Date.parse('2026-09-05T10:00:01.000Z')
const at = (minutes: number) => new Date(STARTED_AT + minutes * 60_000)
const REFUND = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
const MISMATCH = 'nem egyeznek a rendeléssel'

beforeEach(() => {
  resetAlertThrottle()
})
afterEach(() => {
  vi.useRealTimers()
})

function timeoutOnce() {
  provider.refund.mockImplementationOnce(async () => {
    throw new BarionApiError({ kind: 'timeout', message: 'SYNTHETIC', endpoint: 'refund' })
  })
}

function succeededState(f: ReturnType<typeof fixture>) {
  return {
    PaymentId: f.order.barionPaymentId,
    Status: 'Succeeded',
    Total: 0,
    Transactions: [
      {
        TransactionId: 'SYNTHETIC-TX',
        POSTransactionId: `${f.order.orderNumber}-1`,
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: 20000,
      },
      {
        TransactionId: REFUND,
        POSTransactionId: `${f.order.orderNumber}-1`,
        TransactionType: 'RefundToBankCard',
        Status: 'Succeeded',
        Total: 20000,
        RelatedId: 'SYNTHETIC-TX',
      },
    ],
  }
}

describe('Feldolgozás folytatása: átmeneti hiba nem állít adateltérést (H8)', () => {
  it('egy elbukó adatbázis-olvasás a gombnyomáskor újrapróbálást kér, a második nyomás befejezi', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    expect(await f.status()).toMatchObject({ state: 'recoverable' })
    const stateReads = provider.state.mock.calls.length
    vi.mocked(f.payload.find).mockRejectedValueOnce(new Error('SYNTHETIC connection terminated'))
    const first = await recoverRefundOrder({ ...f.options, now: at(20) })
    expect(first.recoveryStatus).toBe('manual_review')
    expect(first.message).not.toContain(MISMATCH)
    expect(first.message).toContain(`„${REFUND_RECOVERY_ACTION_LABEL}”`)
    expect(first.message).toContain('új pénzvisszatérítés nem indult')
    // Semmit nem hasonlított össze: a Barion-állapotot le sem kérdezte.
    expect(provider.state).toHaveBeenCalledTimes(stateReads)
    expect(await f.status()).toMatchObject({ state: 'recoverable' })
    provider.state.mockResolvedValue(succeededState(f))
    expect(await recoverRefundOrder({ ...f.options, now: at(21) })).toMatchObject({
      recoveryStatus: 'completed',
    })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })

  it('az egyeztetett Barion-siker nyugtájának írási hibája sem adateltérés', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    provider.state.mockResolvedValue(succeededState(f))
    f.failures.receipt = 'refund-provider-succeeded'
    const first = await recoverRefundOrder({ ...f.options, now: at(3) })
    expect(first.recoveryStatus).toBe('manual_review')
    expect(first.message).not.toContain(MISMATCH)
    expect(first.message).toContain('Frissítsd az oldalt')
    f.failures.receipt = ''
    expect(await recoverRefundOrder({ ...f.options, now: at(4) })).toMatchObject({
      recoveryStatus: 'completed',
    })
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })

  it('valódi, mentett eltérésnél a hiba után is a kézi ellenőrzés szövege marad', async () => {
    const f = fixture()
    // Rögzített visszatérítés a rendelésen, lezárt kísérlet nélkül: valódi eltérés.
    f.order.refunds = [
      {
        transactionId: 'SYNTHETIC-TX',
        amountHuf: 5000,
        status: 'Succeeded',
        refundedAt: '2026-09-05T10:00:00.000Z',
        type: 'partial',
      },
    ] as Order['refunds']
    vi.mocked(f.payload.find).mockRejectedValueOnce(new Error('SYNTHETIC connection terminated'))
    const result = await f.recover()
    expect(result).toMatchObject({ recoveryStatus: 'manual_review' })
    expect(result.message).toContain(MISMATCH)
    expect(result.message).toContain('Ne indíts új pénzvisszatérítést')
  })
})

describe('negyedórás nullhatás-szabály: a GetState lekérdezésének ideje számít', () => {
  it('a zárra várás alatt eltelt idő nem teszi a régi pillanatképet nullhatás-bizonyítékká', async () => {
    const f = fixture()
    timeoutOnce()
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    vi.useFakeTimers({ toFake: ['Date'] })
    // A lekérdezés 14 perccel az indítás után indul, a válasz 16 percnél érkezik.
    vi.setSystemTime(at(14))
    provider.state.mockImplementation(async () => {
      vi.setSystemTime(at(16))
      return {
        PaymentId: f.order.barionPaymentId,
        Status: 'Succeeded',
        Total: 20000,
        Transactions: [
          {
            TransactionId: 'SYNTHETIC-TX',
            POSTransactionId: `${f.order.orderNumber}-1`,
            TransactionType: 'CardPayment',
            Status: 'Succeeded',
            Total: 20000,
          },
        ],
      }
    })
    const result = await f.recover()
    expect(result.recoveryStatus).toBe('manual_review')
    expect(result.message).toContain('ne indíts új pénzvisszatérítést')
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    // A következő, már negyedóra utáni lekérdezés dönthet.
    provider.state.mockImplementation(async () => ({
      PaymentId: f.order.barionPaymentId,
      Status: 'Succeeded',
      Total: 20000,
      Transactions: [
        {
          TransactionId: 'SYNTHETIC-TX',
          POSTransactionId: `${f.order.orderNumber}-1`,
          TransactionType: 'CardPayment',
          Status: 'Succeeded',
          Total: 20000,
        },
      ],
    }))
    expect(await f.recover()).toMatchObject({ recoveryStatus: 'completed' })
    expect(store.intents.get(f.payload)?.state).toBe('provider_failed')
  })
})

describe('soha ki nem fizetett rendelés automatikus visszatérítése a tulajdonosi panelen (H7)', () => {
  const PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
  const TRANSACTION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const TOTAL = 19990

  function automaticOrder(status: Order['status'] = 'payment_pending'): Order {
    return {
      id: 101,
      orderNumber: 'KH-2026-000123',
      status,
      barionPaymentId: PAYMENT_ID,
      currency: 'HUF',
      totalHufSnapshot: TOTAL,
      refunds: [],
    } as unknown as Order
  }

  function paymentState(): BarionPaymentStateResponse {
    return {
      PaymentId: PAYMENT_ID,
      PaymentRequestId: 'KH-2026-000123',
      Status: 'Succeeded',
      Total: TOTAL,
      Currency: 'HUF',
      Transactions: [
        {
          TransactionId: TRANSACTION_ID,
          POSTransactionId: 'KH-2026-000123-1',
          TransactionType: 'CardPayment',
          Status: 'Succeeded',
          Total: TOTAL,
        },
      ],
    }
  }

  function rejection(code: string) {
    return new BarionApiError({
      kind: 'http',
      message: 'SYNTHETIC',
      endpoint: 'POST /v2/Payment/Refund',
      httpStatus: 400,
      providerErrors: [{ ErrorCode: code, Title: 'SYNTHETIC', Description: 'SYNTHETIC' }],
    })
  }

  function automatic(order: Order, refund: ReturnType<typeof vi.fn>) {
    const f = fixture(order)
    const run = (now: Date) =>
      recoverRejectedSucceededPayment({
        payload: f.payload,
        order,
        state: paymentState(),
        reason: 'duplicate-paid-order',
        log: createLogger(),
        source: 'order-poll',
        refundPayment: refund as never,
        now,
      })
    const status = (now: Date) =>
      getRefundRecoveryStatus({ payload: f.payload, orderNumber: order.orderNumber!, now })
    return { f, run, status }
  }

  it('TooLowBalance után a panel kimondja, mi történt, mikor jön az újabb kísérlet, és mennyi kell a tárcába', async () => {
    const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
    const order = automaticOrder()
    const { f, run, status } = automatic(order, refund)
    await run(at(1))
    const saved = await status(at(2))
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain('A vásárló fizetése a Barionban sikerült')
    expect(saved.message).toContain('nincs elég egyenleg')
    expect(saved.message).toContain('19 990 Ft')
    // 10:01:01 UTC + 1 óra = 13:01 Budapesten (nyári idő).
    expect(saved.message).toContain('szeptember 5. 13:01 után újra megpróbálja')
    expect(saved.message).toContain('A Barion felületén ne indíts visszatérítést.')
    expect(saved.message).not.toMatch(/nincs kifizetve|nincs mit visszatéríteni|[–—]/)
    // A Feldolgozás folytatása nem mozgat pénzt, és ugyanezt mondja.
    const recovered = await recoverRefundOrder({ ...f.options, now: at(2) })
    expect(recovered).toEqual({
      orderNumber: order.orderNumber,
      recoveryStatus: 'manual_review',
      message: saved.message,
    })
    expect(refund).toHaveBeenCalledTimes(1)
    expect(provider.state).not.toHaveBeenCalled()
  })

  it('a várakozás lejárta után „hamarosan”, 12 elutasítás után is napi újrapróbálást ír', async () => {
    const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
    const { run, status } = automatic(automaticOrder(), refund)
    let clock = at(1).getTime()
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await run(new Date(clock))
      clock += automaticRefundRetryDelayMs(attempt) + 60_000
    }
    expect(refund).toHaveBeenCalledTimes(12)
    const saved = await status(new Date(clock))
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain('A rendszer hamarosan újra megpróbálja')
    expect(saved.message).toContain('naponta próbálkozik, amíg sikerül')
  })

  it.each([
    [
      'nem javítható elutasítás',
      () => rejection('PaymentStatusNotValid'),
      'olyan okkal utasította el',
    ],
    [
      'a Barionban már visszatérített fizetés',
      () => rejection('AmountToRefundIsGreaterThanTransactionAmount'),
      'ennyi már nem téríthető vissza',
    ],
  ])('%s: a panel a leállást és a teendőt mondja ki', async (_label, error, reason) => {
    const refund = vi.fn().mockRejectedValue(error())
    const { run, status } = automatic(automaticOrder(), refund)
    expect(await run(at(1))).toEqual({ action: 'failed', detail: 'automatic-refund-rejected' })
    const saved = await status(at(2))
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain('leállt')
    expect(saved.message).toContain(reason)
    expect(saved.message).toContain('Jelezd az üzemeltetőnek a rendelésszámmal együtt.')
  })

  it('kimerült (kód nélküli) kísérletek után a leállást mondja, nem „nincs mit visszatéríteni”', async () => {
    const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
    const { run, status } = automatic(automaticOrder(), refund)
    let clock = at(1).getTime()
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await run(new Date(clock))
      clock += 16 * 60_000
      await run(new Date(clock))
      clock += automaticRefundRetryDelayMs(attempt) + 60_000
    }
    expect(await run(new Date(clock))).toEqual({
      action: 'failed',
      detail: 'automatic-refund-attempts-exhausted',
    })
    const saved = await status(new Date(clock))
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain('több sikertelen kísérlet után leállt')
  })

  it('elakadt, előkészített automatikus kísérletnél nem ígér új (tulajdonosi) visszatérítést', async () => {
    const order = automaticOrder('cancelled')
    const f = fixture(order)
    await createRefundIntent(
      f.payload,
      {
        schemaVersion: 2,
        actorId: null,
        actorKind: 'system',
        systemActor: 'paid-reject-recovery',
        orderId: String(order.id),
        provider: 'barion',
        providerPaymentId: PAYMENT_ID,
        providerTransactionId: TRANSACTION_ID,
        refundSequence: 1,
        requestedAmountHuf: TOTAL,
        currency: 'HUF',
        reason: 'SYNTHETIC',
      },
      'SYNTHETIC-STUCK-PREPARED',
    )
    const before = await f.status()
    expect(before.state).toBe('recoverable')
    expect(before.message).toContain('Az automatikus visszatérítés egyik kísérlete')
    expect(before.message).not.toContain('új visszatérítés indítható')
    const recovered = await recoverRefundOrder({ ...f.options, now: at(3) })
    expect(recovered.recoveryStatus).toBe('completed')
    expect(recovered.message).toContain('a Barionnak nem ment kérés')
    expect(recovered.message).toContain('fizetés-ellenőrzés gondoskodik')
    expect(recovered.message).not.toContain('a Barion adatai szerint')
    expect(store.intents.get(f.payload)?.state).toBe('provider_failed')
    const after = await getRefundRecoveryStatus({
      payload: f.payload,
      orderNumber: order.orderNumber!,
      now: at(4),
    })
    expect(after.state).toBe('manual_review')
    expect(after.message).toContain('újra megpróbálja')
    expect(provider.refund).not.toHaveBeenCalled()
  })

  it('előzmény nélküli, nem kifizetett rendelés továbbra is rendezett (nincs teendő)', async () => {
    const order = automaticOrder()
    const f = fixture(order)
    expect(await f.status()).toMatchObject({ state: 'clear' })
  })
})
