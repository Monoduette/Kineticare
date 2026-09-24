import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { documents, fixture, provider, store } from '../refund-fixture'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { BarionApiError, type BarionPaymentStateResponse } from '../../lib/barion'
import { createOrderStatusHandler } from '../../lib/checkout/order-status-handler'
import { createLogger, type Logger } from '../../lib/logger'
import { LATE_SUCCESS_LOOKBACK_MS } from '../../lib/order-poll/service'
import { recoverRejectedSucceededPayment } from '../../lib/order-status/recover-paid-reject'
import {
  AUTOMATIC_RETRY_CLOSED_ORDER_WINDOW_MS,
  automaticRefundRetryDelayMs,
  MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS,
} from '../../lib/refund/automatic-retry'
import { AUTOMATIC_REFUND_BLOCKED_ACTION } from '../../lib/refund/automatic-block'
import { createRefundIntent } from '../../lib/refund/intent-store'
import { releaseNeverLaunchedIntent } from '../../lib/refund/provider-reconciliation'
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
      // A lemondott rendelést a fizetés-ellenőrzés a létrehozása után egy hétig nézi.
      createdAt: '2026-09-05T09:55:00.000Z',
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

  function spyLogger() {
    const calls = { error: [] as string[], warn: [] as string[] }
    const log: Logger = {
      debug: () => {},
      info: () => {},
      warn: (message) => {
        calls.warn.push(message)
      },
      error: (message) => {
        calls.error.push(message)
      },
      child: () => log,
    }
    const alerts = () => calls.error.filter((message) => message.startsWith('RIASZTÁS'))
    return { log, calls, alerts }
  }

  function automatic(order: Order, refund: ReturnType<typeof vi.fn>, log = createLogger()) {
    const f = fixture(order)
    const run = (now: Date, state = paymentState()) =>
      recoverRejectedSucceededPayment({
        payload: f.payload,
        order,
        state,
        reason: 'duplicate-paid-order',
        log,
        source: 'order-poll',
        refundPayment: refund as never,
        now,
      })
    const status = (now: Date) =>
      getRefundRecoveryStatus({ payload: f.payload, orderNumber: order.orderNumber!, now })
    const blocks = () =>
      f.audits.filter((audit) => audit.action === AUTOMATIC_REFUND_BLOCKED_ACTION)
    return { f, run, status, blocks }
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
    expect(saved.message).toContain('legalább naponta próbálkozik, amíg sikerül')
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

  it('kód nélküli nullhatás után korlátozott újrapróbálást ír, nem „amíg sikerül”, és nem mondja, hogy nincs teendő', async () => {
    const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
    const { f, run, status } = automatic(automaticOrder(), refund)
    await run(at(1))
    // Negyedóra múlva a GetState-ben nincs visszatérítés: kód nélküli nullhatás.
    await run(at(17))
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'provider_failed',
      reconciliationReference: 'barion:paymentstate:no-refund-transaction',
    })
    const saved = await status(at(18))
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain('az oka nem ismert')
    expect(saved.message).toContain(
      `Ha egymás után ${MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS} kísérlet végződik így, a rendszer leáll`,
    )
    expect(saved.message).not.toMatch(/amíg sikerül|nincs teendőd/)
  })

  it('a kód nélküli keretet kimerítő kísérlet kézi lezárása a leállást mondja, nem a további kísérleteket', async () => {
    const refund = vi.fn().mockRejectedValue(new Error('SYNTHETIC response loss'))
    const { f, run } = automatic(automaticOrder(), refund)
    let clock = at(1).getTime()
    for (let attempt = 1; attempt < MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS; attempt += 1) {
      await run(new Date(clock))
      clock += 16 * 60_000
      await run(new Date(clock))
      clock += automaticRefundRetryDelayMs(attempt) + 60_000
    }
    await run(new Date(clock))
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    provider.state.mockResolvedValue(paymentState())
    const closed = await recoverRefundOrder({ ...f.options, now: new Date(clock + 16 * 60_000) })
    expect(store.intents.get(f.payload)?.state).toBe('provider_failed')
    expect(closed.recoveryStatus).toBe('manual_review')
    expect(closed.message).toContain('több sikertelen kísérlet után leállt')
    expect(closed.message).not.toContain('fizetés-ellenőrzés gondoskodik')
    expect(refund).toHaveBeenCalledTimes(MAX_UNEXPLAINED_AUTOMATIC_REFUND_ATTEMPTS)
  })

  it('nem automatikus (tulajdonosi) lezárt kísérlet mellett kézi ellenőrzést kér, nem újrapróbálást', async () => {
    const order = automaticOrder()
    const f = fixture(order)
    const owner = await createRefundIntent(
      f.payload,
      {
        schemaVersion: 1,
        actorId: '1',
        orderId: String(order.id),
        provider: 'barion',
        providerPaymentId: PAYMENT_ID,
        providerTransactionId: TRANSACTION_ID,
        refundSequence: 1,
        requestedAmountHuf: TOTAL,
        currency: 'HUF',
        reason: null,
      },
      'SYNTHETIC-OWNER-ATTEMPT',
    )
    await releaseNeverLaunchedIntent(f.payload, owner, at(1))
    const saved = await getRefundRecoveryStatus({
      payload: f.payload,
      orderNumber: order.orderNumber!,
      now: at(2),
    })
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain(MISMATCH)
    expect(saved.message).not.toContain('újra megpróbálja')
  })

  describe('kísérlet előtti, tartós leállás (idegen visszatérítés, megváltozott fizetés)', () => {
    const FOREIGN_REFUND = 'dddddddd-eeee-ffff-0000-000000000009'
    const FOREIGN = 'ehhez a fizetéshez már van visszatérítési tranzakció'

    /**
     * A forrásra kapcsolódó, a Barion felületén indított visszatérítés (K17). A
     * Barion a fizetés Total értékét a visszatérített összeggel csökkenti
     * (Payment-PaymentState-v4: „if the transaction is a refund of a previously
     * completed payment, this can be lower than at payment creation time”).
     */
    function withBarionUiRefund(refundHuf: number, total: number): BarionPaymentStateResponse {
      const state = paymentState()
      state.Total = total
      state.Transactions.push({
        TransactionId: FOREIGN_REFUND,
        POSTransactionId: '',
        TransactionType: 'RefundToBankCard',
        Status: 'Succeeded',
        Total: refundHuf,
        RelatedId: TRANSACTION_ID,
      })
      return state
    }

    it.each([
      [
        'teljes visszatérítés (a Total 0-ra csökken)',
        () => withBarionUiRefund(TOTAL, 0),
        'foreign-refund-detected',
        `a Barionban ${FOREIGN}`,
        FOREIGN,
      ],
      [
        'teljes visszatérítés, változatlan Total',
        () => withBarionUiRefund(TOTAL, TOTAL),
        'foreign-refund-detected',
        `a Barionban ${FOREIGN}`,
        FOREIGN,
      ],
      [
        'részleges visszatérítés (csökkent Total)',
        () => withBarionUiRefund(9990, TOTAL - 9990),
        'foreign-refund-detected',
        `a Barionban ${FOREIGN}`,
        FOREIGN,
      ],
      [
        'hiányzik a rendelés fizetési tranzakciója',
        () => ({ ...paymentState(), Transactions: [] }),
        'source-transaction-unproven',
        'a fizetés tranzakciói a Barionban nem egyeznek a rendeléssel',
        'tranzakciói nem egyeznek a rendeléssel',
      ],
      [
        'nulla összegű fizetés, visszatérítés nélkül',
        () => ({ ...paymentState(), Total: 0 }),
        'payment-state-unproven',
        'a fizetés adatai a Barionban nem egyeznek a rendeléssel',
        'adatai nem egyeznek a rendeléssel',
      ],
    ])(
      '%s: a panel és a RIASZTÁS a leállást mondja, nem ígér napi újrapróbálást és feltöltést',
      async (_label, blocked, detail, reason, alert) => {
        const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
        const { log, alerts } = spyLogger()
        const { f, run, status } = automatic(automaticOrder(), refund, log)
        await run(at(1))
        for (const minutes of [62, 60 * 24 * 2, 60 * 24 * 30])
          expect(await run(at(minutes), blocked())).toEqual({ action: 'failed', detail })
        expect(refund).toHaveBeenCalledTimes(1)
        // Az 1. elutasítás még csak figyelmeztetés; minden riasztás a leállásról szól.
        expect(alerts()).toHaveLength(3)
        for (const message of alerts()) expect(message).toContain(alert)
        const saved = await status(at(60 * 24 * 30))
        expect(saved.state).toBe('manual_review')
        expect(saved.message).toContain(reason)
        expect(saved.message).toContain('Jelezd az üzemeltetőnek a rendelésszámmal együtt.')
        expect(saved.message).not.toContain('naponta próbálkozik')
        expect(saved.message).not.toContain('feltöltés')
        // A Feldolgozás folytatása ugyanezt mondja, és nem mozgat pénzt.
        expect(await recoverRefundOrder({ ...f.options, now: at(60 * 24 * 30) })).toEqual({
          orderNumber: 'KH-2026-000123',
          recoveryStatus: 'manual_review',
          message: saved.message,
        })
        expect(refund).toHaveBeenCalledTimes(1)
      },
    )

    it('az első kísérlet előtti teljes Barion-felületi visszatérítés (Total 0) idegen visszatérítésként áll le, és a panel sem „rendezett” (K17)', async () => {
      const refund = vi.fn()
      const { log, alerts } = spyLogger()
      const { run, status } = automatic(automaticOrder(), refund, log)
      expect(await run(at(1), withBarionUiRefund(TOTAL, 0))).toEqual({
        action: 'failed',
        detail: 'foreign-refund-detected',
      })
      expect(refund).not.toHaveBeenCalled()
      expect(alerts()).toEqual([expect.stringContaining(FOREIGN)])
      const saved = await status(at(2))
      expect(saved.state).toBe('manual_review')
      expect(saved.message).toContain(`a Barionban ${FOREIGN}`)
    })

    it('egy később valóban elindult kísérlet felülírja a leállás-jelzést, egy újabb leállás pedig ismét a legújabbat mutatja', async () => {
      const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
      const { run, status, blocks } = automatic(automaticOrder(), refund)
      expect(await run(at(1), { ...paymentState(), Transactions: [] })).toEqual({
        action: 'failed',
        detail: 'source-transaction-unproven',
      })
      expect((await status(at(2))).message).toContain('leállt')
      await run(at(7))
      expect(refund).toHaveBeenCalledTimes(1)
      const retrying = await status(at(8))
      expect(retrying.message).toContain('nincs elég egyenleg')
      expect(retrying.message).toContain('naponta próbálkozik, amíg sikerül')
      // A várakozás után a Barion felületén közben visszatérítették: új leállás.
      expect(await run(at(7 + 61), withBarionUiRefund(TOTAL, 0))).toEqual({
        action: 'failed',
        detail: 'foreign-refund-detected',
      })
      expect(refund).toHaveBeenCalledTimes(1)
      expect(blocks()).toHaveLength(2)
      const stopped = await status(at(7 + 62))
      expect(stopped.state).toBe('manual_review')
      expect(stopped.message).toContain(`a Barionban ${FOREIGN}`)
      expect(stopped.message).toContain('leállt')
      expect(stopped.message).not.toContain('naponta próbálkozik')
      expect(stopped.message).not.toContain('feltöltés')
    })

    it('eltérő okú, egymás utáni leállás új bejegyzést kap, a panel a legújabb okot mondja; azonos ok nem szaporít', async () => {
      const refund = vi.fn()
      const { run, status, blocks } = automatic(automaticOrder(), refund)
      expect(await run(at(1), { ...paymentState(), Transactions: [] })).toEqual({
        action: 'failed',
        detail: 'source-transaction-unproven',
      })
      expect(await run(at(6), withBarionUiRefund(TOTAL, 0))).toEqual({
        action: 'failed',
        detail: 'foreign-refund-detected',
      })
      expect(await run(at(11), withBarionUiRefund(TOTAL, 0))).toEqual({
        action: 'failed',
        detail: 'foreign-refund-detected',
      })
      expect(blocks().map((audit) => (audit.after as { detail: string }).detail)).toEqual([
        'source-transaction-unproven',
        'foreign-refund-detected',
      ])
      expect((await status(at(12))).message).toContain(`a Barionban ${FOREIGN}`)
      expect(refund).not.toHaveBeenCalled()
    })

    it.each([
      ['olvasása', 'read'],
      ['írása', 'write'],
    ] as const)(
      'a leállás-jelzés %s elbukik: a döntés és a RIASZTÁS ugyanaz, nincs POST, a következő futás pótolja',
      async (_label, failing) => {
        const refund = vi.fn()
        const { log, calls, alerts } = spyLogger()
        const { f, run, status, blocks } = automatic(automaticOrder(), refund, log)
        if (failing === 'read')
          vi.mocked(f.payload.find).mockRejectedValueOnce(new Error('SYNTHETIC connection lost'))
        else f.failures.receipt = AUTOMATIC_REFUND_BLOCKED_ACTION
        expect(await run(at(1), withBarionUiRefund(TOTAL, 0))).toEqual({
          action: 'failed',
          detail: 'foreign-refund-detected',
        })
        expect(refund).not.toHaveBeenCalled()
        expect(alerts()).toEqual([expect.stringContaining(FOREIGN)])
        expect(blocks()).toEqual([])
        if (failing === 'read')
          expect(calls.warn).toContain(
            'automatikus visszatérítés: a leállás rögzítése nem sikerült',
          )
        f.failures.receipt = ''
        expect(await run(at(6), withBarionUiRefund(TOTAL, 0))).toEqual({
          action: 'failed',
          detail: 'foreign-refund-detected',
        })
        expect(blocks()).toHaveLength(1)
        expect((await status(at(7))).message).toContain(`a Barionban ${FOREIGN}`)
        expect(refund).not.toHaveBeenCalled()
      },
    )

    it('vásárlói köszönőoldal: a kísérlet előtti tartós leállás után sem sima függő fizetés', async () => {
      const order = {
        ...automaticOrder(),
        customer: 7,
        items: [{ product: 42 }],
      } as unknown as Order
      const { f, run } = automatic(order, vi.fn())
      expect(await run(at(1), withBarionUiRefund(9990, TOTAL))).toEqual({
        action: 'failed',
        detail: 'foreign-refund-detected',
      })
      // A köszönőoldal a bejelentkezett vevő saját rendelését kérdezi (customer = user.id).
      const payload = {
        ...f.payload,
        auth: async () => ({ user: { id: 7 } }),
        find: async (args: { collection: string }) =>
          args.collection === 'orders'
            ? { docs: [structuredClone(order)], totalDocs: 1, hasNextPage: false }
            : f.payload.find(args as never),
      }
      const handler = createOrderStatusHandler({ getPayload: async () => payload as never })
      const response = await handler(
        new Request('http://localhost/api/orders/KH-2026-000123/status') as never,
        { params: Promise.resolve({ orderNumber: 'KH-2026-000123' }) },
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        status: 'payment_pending',
        paymentReviewRequired: true,
      })
    })
  })

  it('lemondott rendelésnél csak a fizetés-ellenőrzés egyhetes ablakáig ígér újrapróbálást, utána a leállást mondja', async () => {
    const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
    const { run, status } = automatic(automaticOrder('cancelled'), refund)
    await run(at(1))
    const within = await status(at(2))
    expect(within.state).toBe('manual_review')
    // 10:01:01 UTC + 1 óra = 13:01; a rendelés 09:55 UTC + 7 nap, egy óra
    // tartalékkal rövidítve = szeptember 12. 10:55 (Budapest).
    expect(within.message).toContain('szeptember 5. 13:01 után újra megpróbálja')
    expect(within.message).toContain('szeptember 12. 10:55 után már nem próbálkozik')
    expect(within.message).not.toContain('amíg sikerül')
    const after = await status(new Date('2026-09-12T10:00:00.000Z'))
    expect(after.state).toBe('manual_review')
    expect(after.message).toContain('már nem ellenőrzi újra magától')
    expect(after.message).not.toContain('újra megpróbálja')
    // A határ a fizetés-ellenőrzés tényleges keresési ablaka.
    expect(AUTOMATIC_RETRY_CLOSED_ORDER_WINDOW_MS).toBe(LATE_SUCCESS_LOOKBACK_MS)
  })

  it('lemondott rendelés: az ablak utolsó kísérlete után a RIASZTÁS és a panel is a leállást mondja, már a határ előtt (K6)', async () => {
    const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
    const order = automaticOrder('cancelled')
    const { log, alerts } = spyLogger()
    const { run, status } = automatic(order, refund, log)
    // A fizetés-ellenőrzés 5 percenként, amíg a rendelés a késői sikerek ablakában van.
    const deadline = Date.parse(String(order.createdAt)) + LATE_SUCCESS_LOOKBACK_MS
    let lastPostAt = 0
    for (let clock = at(1).getTime(); clock <= deadline; clock += 5 * 60_000) {
      const posts = refund.mock.calls.length
      await run(new Date(clock))
      if (refund.mock.calls.length > posts) lastPostAt = clock
    }
    // Kísérletek +0, 1, 3, 7, 15, 31, 55, 79, 103, 127 és 151 óránál; a
    // következő (+175 óra) már az ablak (≈ +168 óra) utánra esne.
    expect(refund).toHaveBeenCalledTimes(11)
    expect(lastPostAt).toBe(at(1 + 151 * 60).getTime())
    const last = alerts().at(-1)
    expect(last).toContain('leállt')
    expect(last).not.toContain('újrapróbálja')
    expect(alerts().filter((message) => message.includes('leállt'))).toHaveLength(1)
    // A panel az utolsó kísérlet után, még a határ előtt sem ígér újabbat.
    expect(lastPostAt + 60_000).toBeLessThan(deadline)
    const before = await status(new Date(lastPostAt + 60_000))
    expect(before.state).toBe('manual_review')
    expect(before.message).toContain('már nem ellenőrzi újra magától')
    expect(before.message).not.toMatch(/újra megpróbálja|naponta próbálkozik/)
  })

  it("'created' rendelésnél egy kísérlet után leáll: ezt a rendelést a fizetés-ellenőrzés nem nézi", async () => {
    const refund = vi.fn().mockRejectedValue(rejection('TooLowBalanceToMakeRefund'))
    const { log, alerts } = spyLogger()
    const { run, status } = automatic(automaticOrder('created'), refund, log)
    expect(await run(at(1))).toEqual({ action: 'failed', detail: 'automatic-refund-window-closed' })
    expect(alerts()).toEqual([expect.stringContaining('leállt')])
    const saved = await status(at(2))
    expect(saved.state).toBe('manual_review')
    expect(saved.message).toContain('leállt')
    expect(saved.message).not.toContain('újra megpróbálja')
    expect(await run(at(60 * 24))).toEqual({
      action: 'failed',
      detail: 'automatic-refund-window-closed',
    })
    expect(refund).toHaveBeenCalledTimes(1)
  })

  it('előzmény nélküli, nem kifizetett rendelés továbbra is rendezett (nincs teendő)', async () => {
    const order = automaticOrder()
    const f = fixture(order)
    expect(await f.status()).toMatchObject({ state: 'clear' })
  })
})
